# Launch kit — react-vite-optimizer

All copy below is ready to post. Replace TODO links after the store is live.

## One-liner

`rvo` — the 30-second performance pass your React app needed months ago: safe React.lazy, React.memo, and useMemo codemods plus dependency upgrades. One command.

## Show HN

Title: **Show HN: rvo – I automated the React performance pass every team postpones**

Body:
> Every React team knows their app needs code-splitting, memoization, and
> a dependency upgrade — and nobody ever has time to do it by hand. So I
> built rvo (react-vite-optimizer), a CLI that does the whole pass in
> ~30 seconds, and only applies what AST analysis proves safe:
>
> - `React.lazy` + Suspense for route/page components (default AND named
>   imports, React Router v5 aware, skips unused imports and name collisions)
> - `React.memo` for function components that take props (handles
>   forwardRef, skips already-memoized)
> - `useMemo` for expensive render-time computations with statically
>   inferred dependency arrays (skips anything ambiguous — no stale-closure
>   roulette)
> - plus `rvo upgrade`: bumps deps to latest stable via the npm registry
>   (major upgrades opt-in)
>
> Everything is a real Babel AST transform, not regex. `analyze` is free
> forever and touches nothing — run it first to see exactly what rvo finds
> before you pay anything. `fix` is idempotent and ends with a before/after
> verification report proving what was done. Commercial license (unlocks
> fix/upgrade) is $29 launch price ($49 regular), one-time, 14-day
> money-back guarantee.
>
> `npx react-vite-optimizer analyze ./my-app`
>
> Looking for feedback on the detection heuristics — what would make you
> trust a codemod on your codebase?

## Reddit r/reactjs

Title: **I made a CLI that applies React.lazy / memo / useMemo to your codebase only where analysis says it's safe**

Body: (same core as HN, slightly more casual — end with)
> It's free to analyze any project — no key, no signup. Roast my heuristics —
> what false positives would scare you away from running this?

## X thread

1. Your React app is slower than it should be, and you know it. You just
   never have time to fix it by hand. So I built a tool that does the
   entire performance pass in 30 seconds. 🧵
2. `rvo analyze` scans your Vite + React codebase and finds exactly where
   React.lazy, React.memo, and useMemo actually help. No regex — real AST
   transforms.
3. It handles the annoying cases: named imports (`lazy(() =>
   import('./x').then(m => ({ default: m.Y })))`), React Router v5,
   forwardRef, TS/TSX, and it skips anything ambiguous instead of guessing.
4. `rvo fix` applies it all. Idempotent — second run is a no-op. Then
   `rvo upgrade` bumps your deps to latest stable (majors are opt-in).
5. Free for personal + open source. $29 launch price if your company uses it
   ($49 regular).
   Try it: npx react-vite-optimizer analyze ./your-app

## dev.to article outline

Title: "Stop hand-optimizing React renders — let AST analysis decide"

1. The problem: memo/lazy/useMemo applied by gut feel, often wrong.
2. What the tool checks before touching code (the safety rules).
3. Before/after on a real component (use the test fixture).
4. Why codemods beat regexes (one horror story).
5. CTA: install, pricing, repo link.

## Product Hunt

Tagline: "One-command React performance: lazy-load, memoize, and upgrade deps"
First comment: the HN body, plus "Maker here — happy to answer anything
about the AST heuristics."

## Launch checklist

- [ ] Lemon Squeezy products live; checkout URLs in README + landing page
- [ ] `npm publish` (v1.0.0)
- [ ] GitHub repo public with README, LICENSE.md, docs
- [ ] Post Show HN (Tuesday–Thursday morning US time works best)
- [ ] Post r/reactjs + r/webdev (stagger by a day, not the same hour as HN)
- [ ] Publish dev.to article, link it in the HN/Reddit threads
- [ ] X thread from personal account
- [ ] Product Hunt launch (needs a hunter or self-submit)
- [ ] Reply to every comment within 24h — early replies drive ranking
