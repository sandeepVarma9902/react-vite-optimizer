# Monetization plan — react-vite-optimizer

Owner: Sandeep. Maintained by Muse (docs, code, releases, marketing assets).
Last updated: 2026-09-24.

## The model: dual license, one-time payment

- **Free forever** for personal projects, education, open-source work, and
  30-day evaluation. This is the adoption engine — the npm package is fully
  functional, no feature gating in v1.
- **Paid commercial license** for any work use: **$29 one-time per
  developer** (Solo), **$99 one-time for teams up to 10** (Team). Lifetime
  updates for v1.x. These are **launch prices for the first 100 licenses**;
  regular pricing is $49 / $149 afterwards.
- Why one-time instead of subscription: the tool's value is a one-time
  migration/optimization pass per codebase. Developers hate subscriptions for
  that; they will happily pay once. (One-shot pricing is the proven pattern
  for this category.)

No license-key enforcement in v1 — honor system plus invoice. Companies
comply with licenses; pirates were never going to pay. Key validation
(`rvo activate <key>`) can be added later via Lemon Squeezy's license API if
abuse appears.

## Payment provider: Lemon Squeezy (recommended)

| Provider | Fee | Merchant of Record | Verdict |
|---|---|---|---|
| **Lemon Squeezy** | 5% + 50¢ | Yes — handles VAT/GST/sales tax globally | **Use this.** Built-in license keys, checkout overlays, API. Owned by Stripe. |
| Paddle | 5% + 50¢ | Yes | Solid, but B2B-SaaS focused and slower verification. Backup option. |
| Gumroad | ~10% + processing (~13% effective) | Yes | Creator-focused, much higher cut. No. |
| Stripe direct | 2.9% + 30¢ | **No — you handle global taxes** | No. Tax compliance across countries is not a solo-dev job. |

Why Lemon Squeezy specifically for us: Sandeep is India-based selling in USD
worldwide. As Merchant of Record, Lemon Squeezy is the legal seller — they
collect and remit every country's VAT/GST/sales tax. Without an MoR, Sandeep
would personally owe tax paperwork in the EU, UK, US states, etc. The 5% is
a tax-compliance subscription disguised as a transaction fee, and it pays
out to Indian bank accounts.

What a $29 launch sale nets: $29 − (5% + $0.50) ≈ **$26.95**.
At regular pricing: $49 − (5% + $0.50) ≈ **$45.95**.

## Unit economics & targets

- Launch price: $29 Solo / $99 Team (first 100 licenses); regular $49 / $149.
- Realistic funnel for a niche dev tool: npm/GitHub/launch traffic →
  1–3% convert to paid (companies).
- 20 Solo sales/month at launch ≈ $540/mo ≈ ₹45k/mo. 100 sales/mo ≈ $2.7k/mo
  (more at regular pricing).
- Costs: $0/mo infra (npm + GitHub free, Lemon Squeezy takes % only,
  landing page on free static hosting).

## Distribution

1. **npm** — `react-vite-optimizer` (name verified available, 2026-09-24).
   Free package = marketing. README carries the commercial-license section.
2. **GitHub** — public repo = trust + SEO + issues as a feedback channel.
3. **Landing page** — `landing/index.html` in this repo, deploy to any static
   host. Buy buttons point at the Lemon Squeezy checkout links.
4. Launch blasts (drafts in `docs/LAUNCH.md`): Show HN, r/reactjs,
   r/webdev, dev.to article, X thread, Product Hunt.

## What Sandeep must do personally (cannot be delegated)

These need his identity, money, or accounts — 30–60 minutes total:

1. **Create the Lemon Squeezy store** (lemonsqueezy.com) — sign up, complete
   identity verification (KYC: PAN/Aadhaar or passport), add payout details
   (Indian bank account), create two products: "rvo Solo — $29" and
   "rvo Team — $99" (launch prices; regular $49/$149 after 100 sales),
   enabled. Paste the two checkout URLs into `landing/index.html` and the
   README (marked `TODO` now).
2. **npm account** — create at npmjs.com, then either run `npm publish`
   himself or hand Muse a publish token (via the Secure Vault) and Muse
   publishes.
3. **GitHub repo** — create `react-vite-optimizer` under his account, push
   this project, and post the launch drafts from his own accounts (HN,
   Reddit, X, Product Hunt all need his identity).

Everything else — code, docs, releases, changelog, marketing copy, landing
page, pricing page updates — is Muse's standing responsibility.

## Roadmap to more revenue (later, in order)

1. **v1.1** — `rvo activate <key>` license validation (Lemon Squeezy API),
   `--ci` mode with exit codes for pipelines (Pro differentiator).
2. **v1.2** — paid-only rules: bundle-size budgets, prop-drilling
   detection, unused-export pruning (gives the free tier a reason to stay
   free while commercial users upgrade).
3. **Sponsorships** — GitHub Sponsors as a tip jar alongside licenses.
4. **Consulting upsell** — "we'll optimize your codebase for you" as a
   high-ticket offer on the landing page.
