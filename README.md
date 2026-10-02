# rvo — react-vite-optimizer

**Your React app is slower than it should be. Fix it in 30 seconds.**

`rvo` is a zero-config CLI that scans your React + Vite codebase, finds the
performance issues everyone ships and nobody fixes, and applies safe,
idempotent codemods to resolve them — with a before/after verification report
proving exactly what was done.

```bash
npx react-vite-optimizer analyze ./my-app   # free forever — see what it finds
```

## What it does

| Command | What happens | Cost |
|---|---|---|
| `rvo analyze [dir]` | Scans and reports optimization opportunities. No changes. `--json` for CI. | **Free forever** |
| `rvo fix [dir]` | Applies safe codemods, then re-scans and prints a before → after verification report. | License key |
| `rvo upgrade [dir]` | Bumps dependencies to latest stable from the npm registry (majors opt-in), then runs `npm install`. | License key |
| `rvo all [dir]` | `fix`, then `upgrade`. | License key |
| `rvo migrate [id] [dir]` | Codebase migrations: `cra-to-vite`, `react-19` — detect → plan → transform → verify. | License key |
| `rvo license <key>` | Activates your commercial license key on this machine. | — |

**The codemods** (all idempotent — running `fix` twice is a no-op):

- **React.lazy code-splitting** — route components, files in
  `pages/`/`routes/`/`views/`, files importing heavy libraries (recharts,
  three, d3, monaco, …), or large files. Static imports become
  `const X = lazy(() => import('…'))` with `<Suspense>` boundaries added at
  render sites (react-router v5 aware).
- **React.memo** — for top-level components receiving props that aren't
  memoized yet (including `forwardRef`).
- **useMemo** — for expensive render-time computations (`map`/`filter`/`reduce`
  chains, `JSON.parse`, …) with statically inferred dependency lists.

Unsafe cases are **skipped, never guessed**. Files that fail safe analysis
(duplicate declarations, broken syntax) are skipped with a reason. Everything
emitted is standard ESM + `import()`, which Vite code-splits automatically.

## Prerequisites

- **Node.js 16+** and **npm**
- A **React project** (Vite recommended; works with any React setup for the
  codemods, Vite unlocks automatic code-splitting of the emitted `import()`)
- **Git** recommended — so you can `git diff` every change before committing

## Install & quickstart

```bash
# 1. See what rvo finds — free, no changes, no key needed
npx react-vite-optimizer analyze ./my-app

# 2. Get a license key (one-time payment, 14-day money-back guarantee)
#    https://rvo-tools.lemonsqueezy.com

# 3. Activate it on your machine
npx react-vite-optimizer license <your-key>

# 4. Apply the fixes — with a verification report at the end
npx react-vite-optimizer fix ./my-app

# Or install globally
npm i -g react-vite-optimizer
rvo all ./my-app
```

`[dir]` defaults to the current directory (walks up to the nearest
`package.json`).

### Options

```
rvo analyze [dir] [--only lazy,memo,usememo] [--json]
rvo fix [dir] [--only lazy,memo,usememo] [--dry-run] [-y/--yes]
rvo upgrade [dir] [--include-major] [--dry-run] [-y/--yes] [--no-install] [--verify]
rvo migrate [cra-to-vite|react-19] [dir] [--dry-run] [-y/--yes] [--no-install]
rvo license [key] [--check] [--remove]
```

- `--dry-run` previews every change without writing files.
- `--verify` (upgrade) runs `npm run build` after installing.
- License keys can also be provided via the `RVO_LICENSE_KEY` environment
  variable (handy for CI). Running bare `rvo license` prompts for the key
  with hidden input, so it never lands in shell history.

## The verification report

After every `fix`, rvo re-scans your codebase and prints a receipt:

```
Verification — re-scanned after fix
  ✓ Lazy-loading issues: 4 → 0 remaining
  ✓ React.memo issues: 7 → 0 remaining
  ✓ useMemo issues: 1 → 0 remaining

✓ All 12 detected issue(s) resolved.
```

This is the tool's proof of work — exactly what was found and fixed, in your
own terminal. If `analyze` finds nothing, it tells you upfront: there was
nothing to fix.

## Why not just ask an AI?

Fair question — here's the honest answer:

- **Proof, not promises.** After every `fix`, rvo re-scans your codebase and
  prints a before → after verification report. An AI chat gives you rewritten
  code and hopes it works; rvo shows you the receipt.
- **Whole codebase, one command.** rvo scans hundreds of files in about a
  second and fixes every instance of a pattern consistently. With an AI you
  paste files one by one and review every diff by hand.
- **Deterministic, not probabilistic.** Every transform is a Babel AST edit
  with conservative guards — ambiguous cases are skipped, never guessed at.
  The tool is idempotent: run `fix` twice and the second run is a no-op. An
  AI gives you a different rewrite every time and occasionally hallucinates
  an API.
- **Repeatable in CI.** `analyze --ci` with quality gates fails the build
  when new performance issues appear. You can't put "ask ChatGPT" in a
  pipeline and get the same answer twice.

None of this replaces AI for novel refactors and judgment calls — that's what
it's great at. rvo is the deterministic layer underneath: the known-safe
performance fixes, applied everywhere, with proof. Use both.

## Migrations

Bigger than a codemod: whole-project upgrades, run as a four-stage pipeline —

1. **Detect** — is this migration applicable? What variants does this project have?
2. **Plan** — a readable checklist of exactly what will change (`--dry-run` stops here).
3. **Transform** — the changes, with a per-file summary.
4. **Verify** — every change re-checked; `npm run build` when it can run.

`rvo migrate` with no migration id detects which migrations apply to the
project and tells you.

| Migration | What it does |
|---|---|
| `cra-to-vite` | Moves a Create React App project to Vite: `vite.config.js` (proxy, env prefix, `@` alias, SVGR), `index.html` moved to root with `%PUBLIC_URL%` rewritten, `REACT_APP_*` → `VITE_*` in code and `.env*`, scripts rewritten, `react-scripts` replaced by `vite` + `@vitejs/plugin-react`. Flags Jest, `setupProxy.js`, Node polyfills, service workers and web-vitals as manual follow-ups in `MIGRATION-NOTES.md`. |
| `react-19` | Upgrades React 17/18 → 19 with a peer-compat precheck (flags known-risk packages like enzyme, MUI v4, `react-test-renderer`), codemods `ReactDOM.render`/`hydrate` → `createRoot`/`hydrateRoot` and string refs → `createRef`, and runs the official `react-codemod` transforms when installed locally. Reports `contextTypes`, `findDOMNode`, `forwardRef` and PropTypes as follow-ups in `MIGRATION-NOTES.md`. |

```bash
rvo migrate cra-to-vite --dry-run   # see the whole plan first
rvo migrate react-19 -y --no-install
```

All migrations are idempotent where safe, and they are paid commands like
`fix`, `upgrade` and `all` — `analyze` and `doctor` remain free.

## Licensing

- **Free** for personal, educational, and open-source use (`analyze` is free
  for everyone, forever).
- **Commercial** use requires a one-time license:
  - **Solo** — 1 developer
  - **Team** — up to 10 developers
- 14-day money-back guarantee. If rvo doesn't do what it says, you get your
  money back — no forms, no interrogation.

Get a key: https://rvo-tools.lemonsqueezy.com

## Feedback & support

Found a bug, or want a rule rvo doesn't detect yet? We read everything:

- **In your terminal:** `rvo feedback "your message"` — saved locally and
  tells you exactly where to send it.
- **GitHub issues:** https://github.com/rvo-dev/react-vite-optimizer/issues
  (bug report & feature request templates provided)
- **Email:** support@rvo-tools.lemonsqueezy.com

## Troubleshooting

| Symptom | Fix |
|---|---|
| `A license key is required` | Run `rvo analyze` free first, then `rvo license <key>` after purchase |
| `Could not reach the license server` | Check your connection; a previously activated key keeps working offline |
| `fix` changed nothing | Run `analyze` — if it reports "Already optimized", there was nothing to fix |
| Transform skipped | The report says why (e.g. ambiguous props, unsafe pattern) — skipped is safe by design |
| `upgrade` shows no updates | You're current; majors are hidden unless `--include-major` |

## Development

```bash
npm test          # 215 assertions: license 37, run 23, aggressive 47, v12 47, migrate 61
npm pack --dry-run
```

See [MAINTENANCE.md](MAINTENANCE.md) and [CHANGELOG.md](CHANGELOG.md).
