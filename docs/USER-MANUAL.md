# rvo User Manual

**react-vite-optimizer · v1.1.0**

This manual covers installation, licensing, every command, the verification
report, recommended workflows, troubleshooting, and support. It is written for
working React developers. No marketing language — just how the tool works.

---

## 1. What rvo is

`rvo` is a zero-config command-line tool that scans a React codebase, finds
common performance issues, and fixes them with safe, idempotent codemods. It
detects three classes of issues:

- **React.lazy code-splitting** — route-level components, files in
  `pages/`/`routes/`/`views/`, files importing heavy libraries
  (recharts, three, d3, monaco, …), or large files, converted from static
  imports to `lazy(() => import('…'))` with `<Suspense>` boundaries added at
  render sites (react-router v5 aware).
- **React.memo** — top-level components receiving props that aren't memoized
  yet, including `forwardRef` components.
- **useMemo** — expensive render-time computations (`map`/`filter`/`reduce`
  chains, `JSON.parse`, …) with statically inferred dependency lists.

It also upgrades project dependencies to their latest stable versions via the
npm registry (major versions opt-in). Everything it emits is standard ESM +
`import()`, which Vite code-splits automatically.

---

## 2. Prerequisites

| Requirement | Version / detail | Why it's needed |
|---|---|---|
| **Node.js** | 16 or newer | rvo runs on Node; the CLI parses your code with Babel and shells out to `npm` for upgrades. |
| **npm** | ships with Node | `rvo upgrade` rewrites `package.json` and runs `npm install` unless you pass `--no-install`. |
| **A React project** | any React setup; **Vite recommended** | The codemods work on any React codebase (JS/JSX/TS/TSX), but Vite is what turns the emitted `import()` calls into real code-split chunks at build time. Without Vite you still get correct code, just less automatic benefit. |
| **Git** (recommended) | any recent version | `rvo fix` rewrites source files. A clean `git status` before you run it means you can `git diff` every change, review it line by line, and `git checkout` to undo. |

`rvo` needs **no configuration files and no project changes** to run. Point it
at a directory and it works.

---

## 3. Installation

### One-off (no install)

```bash
npx react-vite-optimizer analyze ./my-app
```

`npx` downloads the latest published version, runs it once, and discards it.
Good for trying `analyze` on a single project.

### Global install (recommended for regular use)

```bash
npm install -g react-vite-optimizer
```

This gives you the short `rvo` alias everywhere:

```bash
rvo analyze ./my-app
rvo fix ./my-app
```

Both entry points (`react-vite-optimizer` and `rvo`) run the same CLI.

### Checking your installation

```bash
rvo --version     # prints the installed version (e.g. 1.1.0)
rvo --help        # full command list with examples
rvo <command> --help   # options for one command, e.g. rvo fix --help
```

---

## 4. Licensing

### The model

| Command | Cost |
|---|---|
| `rvo analyze` | **Free forever** — for everyone, no key, no account |
| `rvo fix`, `rvo upgrade`, `rvo all` | Commercial license key required |
| `rvo license`, `rvo feedback` | Free (license management / support) |

The intent is try-before-you-buy: `analyze` shows you exactly what rvo found
in *your* codebase before you spend anything. If it finds nothing, it tells
you so — and there's nothing to buy.

### License tiers

- **Solo** — 1 developer
- **Team** — up to 10 developers

Both are **one-time payments** (not subscriptions), sold through Lemon Squeezy,
which acts as the merchant of record (handles VAT/GST, invoicing, and
chargebacks). Current prices are listed on the store. Every purchase includes
a **14-day money-back guarantee**: if rvo doesn't do what this manual says it
does, you get a refund — no forms, no interrogation.

**Buy a key:** https://rvo-tools.lemonsqueezy.com

Your license key is delivered by email after checkout (check spam if you don't
see it).

### Activating your key

```bash
rvo license              # secure hidden prompt — key never hits shell history
rvo license <your-key>   # or pass it as an argument (convenient, but visible
                         # in shell history and the process list)
```

This activates the key against the Lemon Squeezy license API (claiming one
activation on your key) and stores it on your machine at
`~/.rvo/license.json` (file permissions restricted to your user). On success
you'll see the product name and which commands are unlocked. Re-running
`rvo license` with the same key does not consume another activation — it
simply re-validates the one this machine already holds.

### Managing your license

```bash
rvo license --check    # re-validate the stored key with the license server
rvo license --remove   # release this machine's activation on the license
                       # server, then remove the key from this machine
```

`--remove` needs a network connection: the activation slot stays counted
against your key until the server confirms the deactivation. If you're
offline, the local key is kept and you'll be asked to retry when connected.

### CI / automated environments

Don't commit keys to repos. Provide the key via environment variable instead:

```bash
RVO_LICENSE_KEY=<your-key> rvo fix ./my-app
```

The environment variable takes precedence over the stored key and is ideal
for CI pipelines.

### Offline behavior

- After a key is activated, the validation result is **cached locally** and
  re-validated against the license server at most **once per week**.
- If you're offline but the key validated before, `fix`/`upgrade`/`all`
  **keep working for up to 30 days** from the last successful validation
  (offline grace). You'll only be blocked if the machine has never
  successfully validated a key, the cached key itself was rejected, or the
  offline grace period has expired.

### What a locked command looks like

Running `rvo fix` without a key prints a short explanation (including the
reminder that `analyze` is free) and exits with a non-zero status — it never
touches your files.

---

## 5. Command reference

In every command, `[dir]` is optional and defaults to the current directory.
rvo walks upward from `[dir]` to the nearest directory containing
`package.json` and treats that as the project root.

### `rvo analyze [dir]` — free

Scans the codebase and prints a report. **Never modifies files.**

```bash
rvo analyze                    # scan the current project
rvo analyze ./my-app           # scan a specific directory
rvo analyze --only lazy        # only code-splitting candidates
rvo analyze --only memo,usememo
rvo analyze --json             # machine-readable output (for CI / tooling)
rvo analyze --json > report.json
rvo analyze --html             # self-contained HTML report (rvo-report.html)
rvo analyze --html --output docs/report.html
rvo analyze --ci --max-issues 10    # fail CI when more than 10 issues
rvo analyze --ci --fail-on error    # fail CI on any error-severity finding
rvo doctor                     # environment + project health check (free)
```

The report lists, per file: lazy-loading candidates (component, source
module, reason), memo candidates (component, line, props), and useMemo
candidates (component, expression, line, inferred deps), plus two advisory
sections: **bundle budget** (oversized `dist/` chunks after `vite build`)
and **image optimization hints** (large or legacy-format images). It ends
with either "`N` optimization(s) found. Run `rvo fix` to apply them." or
"Already optimized — nothing found."

`--only` accepts any comma-separated subset of `lazy`, `memo`, `usememo`,
`bundle`, `images`. Unknown values are ignored. `bundle`/`images` are
advisory-only — `fix` never touches them. Every finding carries a
`severity` (`info`, `warning`, `error`); `--json` output also includes a
`summary` with the total and per-severity counts.

### `rvo fix [dir]` — license required

Applies the codemods, then re-scans and prints the verification report
(see §6).

```bash
rvo fix                        # interactive: confirms each rule group first
rvo fix -y                     # apply everything without prompting
rvo fix --dry-run              # preview only — no files are written
rvo fix --only lazy            # only apply code-splitting transforms
rvo fix ./my-app -y --only memo,usememo
```

Behavior notes:

- Without `-y` or `--dry-run`, rvo asks once per rule group
  ("Apply N lazy-loading transform(s)?"). Answering "no" skips that group.
- `--dry-run` prints the full fix summary with zero file writes. Use it to
  preview on unfamiliar codebases.
- Transforms are **idempotent**: running `fix` on an already-fixed codebase
  reports "Already optimized" and changes nothing.
- Cases rvo can't prove safe are **skipped with a printed reason** (e.g.
  ambiguous props, unsafe patterns). Files that fail safe analysis
  (duplicate declarations, unparseable syntax) are skipped entirely — rvo
  never guesses.

### `rvo upgrade [dir]` — license required

Checks the npm registry for newer stable versions of your dependencies and,
with confirmation, rewrites `package.json` and runs `npm install`.

```bash
rvo upgrade                    # check, confirm, apply, install
rvo upgrade --dry-run          # show what's available; change nothing
rvo upgrade -y                 # apply without prompting
rvo upgrade --include-major    # also offer major version bumps (off by default)
rvo upgrade --no-install       # update package.json only, skip npm install
rvo upgrade --verify           # run `npm run build` after installing
```

Behavior notes:

- **Major versions are excluded by default.** They appear as a separate
  "available" list with a hint to re-run with `--include-major`. This is
  deliberate: majors are where breaking changes live.
- Non-semver ranges (e.g. `*`, git URLs, `file:`) are skipped, never
  rewritten.
- If the npm registry is unreachable, the command fails cleanly with
  "Could not reach the npm registry" and changes nothing.
- `--verify` runs your project's own `npm run build` after install as a
  smoke test. If your project has no `build` script, npm will report that.

### `rvo all [dir]` — license required

Runs `fix`, then `upgrade`, in one invocation. Accepts the union of both
commands' options:

```bash
rvo all -y                     # fix + upgrade, no prompts
rvo all --dry-run              # preview both steps, change nothing
rvo all --only lazy --include-major --no-install
```

If the license check fails, neither step runs.

### `rvo license [key]` — free

Covered in §4: `rvo license <key>` activates, `--check` re-validates,
`--remove` deletes the stored key.

### `rvo feedback [message]` — free

```bash
rvo feedback                                  # prints where to reach us
rvo feedback "memo rule missed my HOC"        # saves your note locally
```

With a message, rvo appends an entry (timestamp, rvo version, platform, Node
version, your message, max 2000 chars) to `~/.rvo/feedback-outbox.jsonl` and
prints the support channels. Without a message it just prints the channels.
Bug reports are most useful with the output of `rvo analyze --json` attached.

---

## 6. The verification report

After every `fix` that actually changed files, rvo **re-scans the codebase
from scratch** and prints a before → after panel:

```
Verification — re-scanned after fix
  ✓ Lazy-loading issues: 4 → 0 remaining
  ✓ React.memo issues: 7 → 0 remaining
  ✓ useMemo issues: 1 → 0 remaining

✓ All 12 detected issue(s) resolved.
```

### How to read it

- Each row is one rule class: issues found **before** the fix, issues
  **remaining** after it.
- A green `✓` means that class is fully resolved. A yellow `●` means some
  items remain — these are the ones rvo skipped for safety, and the reasons
  are printed in the fix summary above the panel.
- The totals line tells you the outcome in one glance: all resolved, or
  "N of M resolved; K remain".

### Why it exists

This panel is the tool's **proof of work**. It answers the only question that
matters after an automated codemod: *did it actually do what it claimed?*
Because the "after" numbers come from a fresh scan of your real files — not
from the transform log — a `0 remaining` line means the issues are genuinely
gone from the codebase, not just marked done.

Two honest limits:

1. The report proves the **mechanical issues were fixed**, not that your app
   got faster. If your bottleneck is a slow API, oversized images, or
   layout thrash, no codemod fixes that — and rvo doesn't claim otherwise.
2. If `analyze` found nothing to begin with, `fix` tells you so and stops.
   "Nothing to fix" is a valid, complete result.

---

## 7. Recommended workflow

```bash
# 1. Start clean — so every change is reviewable
git status          # commit or stash first; you want a clean tree
git checkout -b perf/rvo-pass

# 2. See what rvo finds (free, read-only)
rvo analyze ./my-app

# 3. Preview the changes without writing anything
rvo fix --dry-run ./my-app

# 4. Apply (license required)
rvo fix ./my-app
#    → review the fix summary, skipped items, and verification report

# 5. Review the actual diff
git diff --stat
git diff            # read what changed; it's your code, own the review

# 6. Prove nothing broke
npm test            # or your test command
npm run build       # or: rvo upgrade --verify covers the build step

# 7. Ship it
git add -A && git commit -m "perf: rvo codemod pass (lazy/memo/useMemo)"
```

**For upgrades**, the same shape applies: `rvo upgrade --dry-run` first,
review the list, then apply — and keep `--include-major` as a separate,
deliberate decision, ideally on its own branch.

**For CI**, use the built-in gates instead of scripting your own:

```bash
rvo analyze --ci --max-issues 10   # fail when more than 10 issues
rvo analyze --ci --fail-on error    # fail on any error-severity finding
```

(`analyze` needs no license, so it's free in pipelines.) `--ci` defaults to
`--max-issues 0`; pass a large `--max-issues` alongside `--fail-on` to gate
on severity alone. With `--json`, the verdict goes to stderr so stdout stays
parseable.

---

## 8. Troubleshooting

| Symptom | What's happening | What to do |
|---|---|---|
| `A license key is required for this command` | `fix`/`upgrade`/`all` need a commercial key | Run `rvo analyze` free first; buy at https://rvo-tools.lemonsqueezy.com, then `rvo license <key>` |
| `This license key is not valid` | The server rejected the key | Check for typos/extra spaces; the key from your purchase email must be pasted whole. Still failing → contact support with your order email |
| `Could not reach the license server` | No network path to the license API | Check your connection and retry. A previously activated key keeps working offline |
| `Could not reach the npm registry` (upgrade) | Registry unreachable | Check network/proxy; nothing was changed |
| `fix` changed nothing | Either already optimized, or everything was skipped | Run `rvo analyze`: "Already optimized" means there's genuinely nothing to fix |
| Transform listed as `skipped` | rvo couldn't prove it safe | Read the printed reason — skipping is by design, not a bug. Ambiguous cases are left for you |
| `upgrade` shows no updates | Dependencies are current | Majors are hidden unless `--include-major`; non-semver ranges are skipped by design |
| `fix` asks to confirm every time | Default interactive mode | Pass `-y` / `--yes` to apply without prompting |
| `rvo` command not found | Global install missing or PATH issue | `npm install -g react-vite-optimizer`, then check `npm bin -g` is on your PATH; or use `npx` |
| Key works on laptop but not CI | Keys are per-machine by default | Use the `RVO_LICENSE_KEY` env var in CI instead of a stored key |

---

## 9. FAQ

**Is it safe?**
rvo is built around a conservative rule: *skip anything it can't prove
safe, and say why.* Files that fail analysis are skipped, not forced.
Transforms are idempotent. That said, it rewrites your source files, so the
safety net is yours too: run it on a clean git tree, read the diff, run your
tests and build.

**Will it break my code?**
It shouldn't — every transform is a narrow, well-tested codemod (70 assertions in the test suite, including hostile inputs), and ambiguous cases
are skipped rather than guessed. But "shouldn't" isn't "can't": always run
your test suite and `npm run build` after a fix pass. If something does
break, `git checkout` restores you, and we'd like to hear about it
(`rvo feedback`, §10).

**Does it work without Vite?**
The codemods work on any React codebase (JS/JSX/TS/TSX). What Vite adds is
automatic code-splitting of the emitted `import()` calls at build time. On
Create React App, Next.js, or other bundlers the code is still correct, but
verify code-splitting behavior with your bundler's own tooling.

**What data leaves my machine?**
Two network calls exist, both narrow: (1) license validation sends your key
and a machine identifier (`rvo-cli:<hostname>:<user>`) to Lemon Squeezy's
license API; (2) `rvo upgrade` queries the public npm registry for version
metadata. Your source code is parsed and transformed **locally** — it is
never uploaded anywhere.

**What if I buy and it doesn't work for me?**
`analyze` is free precisely so this doesn't happen: you see the findings
before paying. If `fix` still doesn't do what this manual describes, the
14-day money-back guarantee applies — email support with your order details.

**Can I get a refund?**
Yes, within 14 days of purchase, no interrogation. Email
support@rvo-tools.lemonsqueezy.com with the email address used at checkout.

**One key, multiple machines?**
Activate the same key on each machine you work on (`rvo license <key>` per
machine), within your tier's developer limit (Solo: 1, Team: up to 10).
Use `RVO_LICENSE_KEY` for CI agents.

---

## 10. Feedback & support

We read everything. Three channels, pick whichever is easiest:

- **From your terminal:** `rvo feedback "your message"` — saves locally with
  version/platform info and shows you where to send it.
- **GitHub issues:** https://github.com/rvo-dev/react-vite-optimizer/issues
  — bug reports and feature requests (attach `rvo analyze --json` output for
  bugs).
- **Email:** support@rvo-tools.lemonsqueezy.com — licensing, refunds, and
  anything account-related.

When reporting a problem, include: rvo version (`rvo --version`), Node
version, the command you ran, and the full terminal output. For missed
detections or bad transforms, a minimal code snippet reproducing it is worth
more than a long description.

---

*End of manual · rvo v1.1.0 · https://rvo-tools.lemonsqueezy.com*
