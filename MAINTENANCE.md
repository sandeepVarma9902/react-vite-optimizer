# Maintenance — react-vite-optimizer

Muse's standing responsibility: keep this tool working, documented, and
sellable. Sandeep only steps in for accounts, money, and publishing
credentials (see docs/BUSINESS.md).

## Ongoing duties

- **Bug fixes** — any reported bug gets a regression test in `test/` and a
  fix, promptly. The aggressive suite (`test/aggressive.js`) is the bar:
  new transforms must survive hostile input.
- **Dependency freshness** — the tool's own deps (`@babel/*`, etc.) get a
  monthly `rvo upgrade`-style review; it should dogfood itself.
- **Docs** — README, BUSINESS.md, LAUNCH.md, and the landing page stay
  consistent with the code. Pricing changes go in all four places.
- **Changelog** — every release gets a CHANGELOG.md entry. No silent
  changes.

## Release process

1. `npm test` green (both suites).
2. Bump `version` in package.json (semver).
3. Add CHANGELOG.md entry.
4. `npm pack --dry-run` — verify files list (bin, src, README, LICENSE).
5. Publish: `npm publish` (needs Sandeep's npm token via Secure Vault, or he
   runs it).
6. Git tag `v<version>`, push to GitHub.
7. Update landing page version badge if present.

## Versioning policy (matches the license promise)

- v1.x — bug fixes, new detection rules, new codemods. Free lifetime
  updates for all license holders.
- v2.0 — reserved for breaking changes (config format, dropped Node
  versions). Commercial licenses are per-major-version.

## Support

- GitHub Issues is the support channel (free users: best effort;
  commercial: priority).
- Security issues: fix first, disclose after release, credit the reporter.
