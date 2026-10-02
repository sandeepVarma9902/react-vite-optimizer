# rvo Roadmap — from optimizer to modernization platform

## Vision
`rvo` becomes **the codebase modernizer**: point it at an aging codebase, get a
working modern one out. Start where we're strongest (React/JS), expand language
by language. The CLI name `rvo` stays (short, brandable); the tagline grows from
"React + Vite optimizer" to "modernize any codebase".

> Open decision: npm package stays `react-vite-optimizer` for now (renames are
> painful). Revisit at v3.0 when polyglot ships.

## v2.0 — Migrations (in build now)
New top-level command: `rvo migrate`. Every migration follows the same
pipeline: **detect → plan → transform → verify**. `--dry-run` prints the plan
without touching files. `--yes` skips confirmations.

### `rvo migrate cra-to-vite` (the killer feature)
CRA is deprecated; thousands of production apps are stuck on `react-scripts`.
- Detect: `react-scripts` in deps, `public/index.html`, `src/index.js`.
- `vite.config.js` generated from CRA setup (dev-server proxy, env, aliases).
- `public/index.html` → root `index.html` (`%PUBLIC_URL%` rewritten).
- Env vars: `REACT_APP_*` → `VITE_*` codemod across code + `.env*` files.
- `package.json` scripts rewritten (`react-scripts start/build/test` → vite).
- Absolute imports: `jsconfig.json` `baseUrl: "src"` → `vite.resolve.alias` +
  `tsconfig`/`jsconfig` paths.
- SVG-as-component: `import { ReactComponent }` → `vite-plugin-svgr` (added +
  configured automatically).
- `src/setupTests.js`, web-vitals, PWA/workbox: migrated or flagged.
- Node polyfills CRA injected (process, Buffer): flagged with fix suggestion.
- Jest: left in place, reported as follow-up (Vitest migration = v2.1).
- Verify: `npm run build` must pass after migration; report lists manual
  follow-ups.

### `rvo migrate react-19` (and 17 → 18)
- Dep upgrade with peer-compat precheck (flags libraries known-broken on 19).
- Codemods: `ReactDOM.render` → `createRoot`, legacy contextTypes/string refs,
  `ref` as prop, `use()`-ready patterns flagged, PropTypes → TS suggestions.
- Wraps official `react-codemod` transforms where they exist; rvo adds
  Vite/build-aware checks the official ones don't do.

### Pricing
Migrations are high willingness-to-pay (enterprises pay 6 figures for Java
upgrades). New tier: **Migration — $99 one-time per codebase** (launch),
regular $149. Solo $29 / Team $99 stay for optimize-only. Added to Lemon
Squeezy as third product when v2.0 ships.

## v2.1 — Migration follow-ups
- `rvo migrate jest-to-vitest`
- `rvo migrate webpack-to-vite` (custom webpack, non-CRA)
- `rvo migrate pages-router-to-app` (Next.js) — maybe; evaluate demand

## v3.0 — Polyglot platform (pipeline, not yet building)
Plugin architecture: `src/languages/<lang>/` adapters, each with its own
parser (tree-sitter), rule set, and migrations. JS/TS adapter is the reference
implementation extracted from v1/v2.
- **Java**: 8 → 17 → 21 LTS jumps (`javax.*` → `jakarta.*`, modules, records,
  text blocks, virtual threads readiness). This is the enterprise money.
- **Python**: 3.x upgrades (deprecated stdlib APIs, `asyncio` changes), 2→3
  remnants cleanup.
- **Go**: module/toolchain upgrades, generics adoption hints.
- Each language ships its own `rvo migrate` set; analyze/fix/upgrade stay
  per-language.

## What we're NOT doing
- Rewriting app logic or frameworks (no Angular→React).
- Hosting/CI services. rvo stays a local CLI.
- Free migrations: `analyze`/`doctor` stay free; `migrate` is paid (it's the
  highest-value command).

## Sequencing
1. v2.0: migrate framework + cra-to-vite + react-19 → publish 2.0.0, add
   Migration tier to Lemon Squeezy, launch post #2 ("we migrate your CRA app").
2. Measure: which migrations get run (telemetry: command names only, opt-in).
3. v3.0: extract JS adapter → plugin API → Java first (enterprise demand).
