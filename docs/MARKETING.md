# rvo Marketing Plan — owned by Muse

Sandeep delegated the entire marketing function to Muse (2026-09-24):
*"show this to the right person who can spend on things like this."*
This document is the operating plan. Muse runs it; Sandeep only touches what
requires his identity/accounts (publishing from his personal profiles).

## 1. Who pays for this (ICP)

The buyer is **not** "all React devs". It's people with budget and pain:

1. **Freelance React devs & small agencies** (highest intent) — they inherit
   slow client codebases, bill by the project, and $29 to skip an afternoon
   of codemod tedium is an instant yes. They also rebuy per client (Team).
2. **Indie hackers / solopreneurs** — shipping their own SaaS, performance
   affects their revenue directly. Hang out on X, Indie Hackers, Product Hunt.
3. **Startup CTOs / eng managers** — buy Team licenses; care about the
   verification report (proof for the team) and the guarantee.

Everyone else (students, hobbyists) gets `analyze` free — they're the top of
the funnel, not the buyers.

## 2. Positioning (one line each)

- **Promise:** "Your React app is slower than it should be. Fix it in 30 seconds."
- **Proof:** free `analyze` before you pay + before/after verification report.
- **Price:** one-time, not a subscription. 14-day money-back guarantee.
- **Enemy:** the manual performance audit nobody has time for.

Never promise "makes your app fast". Promise "finds and fixes these specific
issues, with proof" — that's what the guarantee covers.

## 3. Channels & tactics

### Launch week (when Sandeep says "launch")
| # | Channel | Asset | Owner |
|---|---|---|---|
| 1 | Hacker News "Show HN" | Launch post (draft in docs/LAUNCH.md) | Sandeep posts, Muse drafts + monitors thread |
| 2 | r/reactjs, r/webdev | Value-first post: "I built a CLI that auto-fixes React perf issues — analyze is free" | Sandeep posts |
| 3 | dev.to | Tutorial: "Find every wasted re-render in your React app in 30 seconds" | Muse drafts, Sandeep publishes |
| 4 | X/Twitter | 8-post thread: before/after screenshots of a real codebase | Muse drafts, Sandeep posts |
| 5 | Product Hunt | Launch listing (needs screenshots + maker account) | Sandeep lists, Muse prepares assets |
| 6 | Indie Hackers | "I built a $29 dev tool" build-in-public post | Sandeep posts |
| 7 | React Status newsletter | Submission via their tip form | Muse submits |
| 8 | npm + GitHub | Publish package, public repo with issue templates | Sandeep publishes (his accounts) |

### Ongoing (Muse runs weekly)
- **Case-study content:** run rvo on public open-source React apps, publish
  before/after numbers (X thread + dev.to). This is the engine — proof sells.
- **Build in public:** weekly X posts with real numbers (downloads, revenue,
  issues fixed). Drafted by Muse, posted by Sandeep.
- **Feedback loop:** every GitHub issue / `rvo feedback` message is triaged
  within 48h; feature requests feed the roadmap; fixed bugs become changelog +
  content ("you asked, we shipped").
- **SEO:** landing page + README + npm page target "react performance cli",
  "react lazy codemod", "vite bundle optimization".
- **Launch pricing urgency:** "first 100 licenses at $29/$99, then $49/$149"
  — real scarcity, shown on the pricing section.

### Explicitly NOT doing (yet)
- Paid ads (no budget approved; revisit at $1k MRR).
- YouTube (his channel is AI/mythology content — wrong audience).

## 4. Muse's operating cadence

- **Daily:** monitor for feedback/issues/mentions Sandeep forwards; triage.
- **Weekly:** draft 2–3 content pieces (case study or build-in-public post);
  queue them for Sandeep with one-tap posting instructions.
- **After launch:** weekly metrics check-in (visits, checkout starts,
  conversion %, refunds, npm downloads, stars) with one concrete next action.
- **Monthly:** review positioning against refund reasons and feedback themes;
  update landing page copy accordingly.

## 5. Metrics that matter

| Metric | Target (90 days) | Source |
|---|---|---|
| Landing visits | 10,000 | Netlify analytics / plausible |
| analyze runs (npm dl) | 2,000 | npm stats |
| Checkout conversion | ≥ 3% of visits | Lemon Squeezy |
| Paid licenses | 100 (sell out launch pricing) | Lemon Squeezy |
| Refund rate | < 5% | Lemon Squeezy |
| GitHub stars | 200 | GitHub |

If refund reasons cluster on one theme → that's the next product fix, and it
gets built before more marketing spend.

## 6. Pre-launch checklist (status 2026-09-24)

- [x] Product: license gating, verification report, 70 tests passing
- [x] Landing page live with real checkout links
- [x] Lemon Squeezy store + products + license keys (awaiting KYC approval)
- [x] Feedback system (`rvo feedback`, issue templates)
- [x] User manual (docs/USER-MANUAL.md)
- [ ] npm publish (needs Sandeep's npm account)
- [ ] GitHub repo public (needs Sandeep to create)
- [ ] Test-mode OFF (after KYC approval)
- [ ] Launch copy final review (docs/LAUNCH.md — update for license model)
- [ ] Sandeep: pick launch date → Muse runs the launch-week sequence

## 7. What Sandeep never has to do

Everything except: publishing from his own accounts (HN, Reddit, X, dev.to,
Product Hunt), npm/GitHub creation, and KYC/bank. Muse drafts every word,
queues every post, tracks every metric, and iterates the messaging.
