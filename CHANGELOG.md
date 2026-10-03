# Changelog

## 2.1.0 — 2026-10-03

- **New: `rvo seo`** (free) — website SEO analyzer. Fetches a URL (+
  `/robots.txt`, `/sitemap.xml`) and scores five categories (meta tags,
  social cards, structure, crawlability, performance) with a 0–100 score,
  A–F grade, and prioritized issues each carrying a one-line fix hint.
  `--json` / `--html` reports. Zero new dependencies (Node built-ins for
  fetching, incl. gzip/brotli decoding). Static-HTML analysis: it can't
  see JS-rendered content or Core Web Vitals lab data — the report says
  so in its footer.

## 1.2.1 — 2026-10-02

- Linked the GitHub repository (`sandeepVarma9902/react-vite-optimizer`) and
  homepage in `package.json` — the npm page now points at the public source.

## 2.0.0 — 2026-10-02

The migration release. `analyze`, `doctor`, `assess` and `split` (analysis)
are free forever; `fix` / `upgrade` / `migrate` / `plan` / `split convert`
require a commercial license key (same gate). The license engine is untouched.

### Cross-framework migration (React → Vue / Angular)
- **New: `rvo assess`** (free) — migration readiness analyzer. Inventory
  (components, hooks, router, state, styling, tests), a 107-library
  framework-equivalence knowledge base (`src/assess-libs.json`: native /
  binding / replace / blocked per target), blockers flagged up front
  (React-only libraries with file + suggested alternative, react-native
  imports, `dangerouslySetInnerHTML`, custom webpack config), per-module
  red/yellow/green complexity scores, leaf-first migration order, and a
  `feasible` / `feasible-with-caveats` / `high-risk` verdict. `--json` /
  `--html` reports.
- **New: `rvo plan`** (license required) — generates the migration
  architecture blueprint from the assess output: target decisions (state,
  router, styling, testing) with rationale, per-module S/M/L effort in
  migration order, scaffold checklist, and a risk register.
- **New: `rvo migrate --to <vue|angular> --out <dir>`** (license required) —
  mechanical component converter (Vue Composition-API SFCs; Angular
  standalone components + signals). Conservative by design: anything it
  can't confidently convert gets a loud `TODO(human)` marker instead of
  silently wrong code. Never touches source; `--dry-run` previews.

### Microfrontends
- **New: `rvo split`** (free) — microfrontend readiness analysis: feature
  detection (dirs + route groups), cross-feature coupling matrix with
  high-risk pairs flagged, shared surface (components, context, state
  libs), per-feature size estimates, and an honest
  `not-needed` / `worth-considering` / `recommended` verdict with a
  hand-editable plan JSON.
- **New: `rvo split convert --plan <plan.json> --out <dir>`** (license
  required) — generates a Module Federation monorepo (shell + remotes,
  `@originjs/vite-plugin-federation` configs with REVIEW headers,
  `MIGRATION-NOTES.md` with manual steps and an explicit "what rvo did
  NOT do" section). Runs only from your approved plan.

### CRA → Vite and React 19 migrations
Previously implemented and tested locally, now published in this release.

- **New top-level command: `rvo migrate`** (`src/migrate.js`). Every migration
  follows the same pipeline: **detect → plan → transform → verify**.
  `--dry-run` prints the plan without touching files; `-y/--yes` skips
  confirmations; `--no-install` skips `npm install`. Running bare
  `rvo migrate [dir]` detects which migrations apply to the project.
- **`rvo migrate cra-to-vite`**: migrates Create React App (react-scripts)
  projects to Vite — generates `vite.config.js` (dev-server proxy from
  `package.json`, `@` alias from `jsconfig.json` `baseUrl`,
  `vite-plugin-svgr` when `ReactComponent` SVG imports are found), moves
  `public/index.html` to the root (rewriting `%PUBLIC_URL%`, injecting the
  entry `<script type="module">`), codemods `REACT_APP_*` → `VITE_*` across
  source and `.env*` files (`process.env.` → `import.meta.env.`), rewrites
  `package.json` scripts (`start` → `vite`, `build` → `vite build`,
  `test` → `vitest run`), removes `react-scripts` in favour of
  `vite` + `@vitejs/plugin-react`, and writes `MIGRATION-NOTES.md` with the
  manual follow-ups (Jest/Vitest, `setupProxy.js`, Node polyfills,
  service worker, web-vitals). Verify re-checks every step and runs
  `npm run build` when dependencies are installed.
- **`rvo migrate react-19`**: upgrades React 17/18 → 19 (registry-resolved
  versions, offline fallback) with a peer-compat precheck against a curated
  known-risk list (enzyme, MUI v4, react-test-renderer, react-redux < 9,
  react-router-dom < 6.28, styled-components < 6.1, …). Codemods:
  `ReactDOM.render`/`hydrate` → `createRoot`/`hydrateRoot` (with
  `react-dom/client` import repair) and string refs → `createRef`
  (constructor injection, `this.refs.x` → `this.x.current`, collision-safe).
  Runs the official `react-codemod` transforms (`rename-unsafe-lifecycles`,
  `update-react-imports`) when `react-codemod` is installed locally —
  best-effort, never fails the migration. Legacy `contextTypes`,
  `findDOMNode` (removed in 19), `forwardRef` (ref-as-prop opportunity) and
  PropTypes are reported as follow-ups, not auto-rewritten.
- 61 new test assertions in `test/migrate.js` (temp CRA + React 17
  fixtures, dry-run immutability, license gating), wired into `npm test`.

## 1.1.1 — 2026-09-26

- **Search discoverability**: added npm keywords (react, vite, optimizer,
  performance, bundle, codemod, cli, webperf, …). 1.1.0 shipped with no
  keywords, making the package nearly invisible in npm search.

## 1.2.0 — 2026-09-28

Not published yet. Everything in this section is implemented and tested
locally; `analyze` remains free, and the license engine is untouched.

- **Report formats**: `rvo analyze --json` now emits a `summary`
  (`total` + `bySeverity` counts) alongside the findings, and every finding
  carries a `severity` (`info`/`warning`/`error`). New
  `rvo analyze --html` writes a self-contained HTML report
  (`rvo-report.html`, or `--output <file>` for either format).
- **CI mode**: `rvo analyze --ci` exits non-zero when quality gates fail.
  `--max-issues N` fails when the total finding count exceeds N (default 0
  under `--ci`); `--fail-on <severity>` fails when any finding is at or
  above that severity. Passing either gate option implies `--ci`.
- **`rvo doctor`** (new, free): checks Node.js/npm versions, then verifies
  the project looks like a Vite+React app (package.json, react/react-dom,
  vite or vite.config.*, src/, build script). Exits 1 when a check fails.
- **New advisory checks** (analyze-only, never touched by `fix`):
  - Bundle budget: flags `dist/assets/*.js` chunks over
    `bundleBudgetKb` (default 500, `error`) or over 80% of it (`warning`).
  - Image hints: flags images over `imageBudgetKb` (default 250, `info`)
    and legacy formats (BMP/TIFF), suggesting compression or WebP/AVIF.
  - Both are configurable via `.rvorc.json` and selectable with
    `--only bundle,images`.
- 40+ new test assertions in `test/v12.js` covering every feature above.

## 1.1.0 — 2026-09-24

Professional release. Published to npm as `react-vite-optimizer@1.1.0`.

- **License enforcement**: `rvo analyze` is free forever. `rvo fix`,
  `rvo upgrade`, and `rvo all` now require a commercial license key.
- **License engine** (verified against the official Lemon Squeezy License API
  reference):
  - Requests are `application/x-www-form-urlencoded` per the documented contract.
  - `rvo license` activates via `POST /v1/licenses/activate` (consuming one
    activation) and stores the returned instance id; `--check`/gates validate
    via `POST /v1/licenses/validate` with that instance id; `--remove`
    releases the activation via `POST /v1/licenses/deactivate` before deleting
    the local cache.
  - Keys for other products are rejected (product allowlist); expired/disabled
    keys and keys whose activation was removed elsewhere are rejected with a
    clear message. Re-activating the same key on the same machine does not
    burn another activation slot.
  - Offline grace is bounded: a previously validated key keeps working up to
    30 days from its last successful validation, then requires connectivity.
  - `rvo license` with no argument prompts for the key with hidden input
    (no shell history); `RVO_LICENSE_KEY` remains for CI.
- **`rvo license` command**: activate, `rvo license --check` to re-validate,
  `rvo license --remove` to deactivate. Keys are cached in
  `~/.rvo/license.json` (weekly re-validation, 30-day offline grace).
- **Verification report**: after every `fix`, rvo re-scans the codebase
  and prints a before → after panel — the tool's receipt proving exactly
  what was done (e.g. "12 issues found → 0 remaining").
- CLI help now shows examples and the free-vs-licensed model.
- 107 test assertions: license API contract (37), gating + verification
  output, aggressive edge cases (TS/TSX, forwardRef, class components,
  250-file perf sweep).

## 1.0.0 — 2026-09-24

Initial release.

- `rvo analyze` — AST-based detection of React.lazy, React.memo, and
  useMemo opportunities (JS/JSX/TS/TSX).
- `rvo fix` — idempotent codemods: lazy + Suspense (default & named
  imports, Router v5 aware), memo (incl. forwardRef), useMemo with inferred
  deps. Skips ambiguous cases instead of guessing; skips files that fail
  safe analysis (duplicate declarations, broken syntax).
- `rvo upgrade` — bumps deps to latest stable from the npm registry;
  major upgrades opt-in via `--include-major`; non-semver ranges skipped.
- `rvo all` — fix then upgrade.
- Dual license: free for personal/educational/open-source, $29/$99
  launch pricing ($49/$149 regular) one-time commercial.
