# Store setup — Lemon Squeezy (do once, ~30 min)

The landing page's Buy buttons are fully wired. They open the real
Lemon Squeezy checkout (in-page overlay) the moment the two URLs below
exist in `landing/index.html`. Until then, buttons collect "reserve my
launch price" emails into the browser's localStorage.

## Steps

1. **Sign up** at https://www.lemonsqueezy.com — verify your email.
2. **Get approved**: Settings → complete the business/tax profile and add
   payout details (Indian bank account). Your store must be approved
   before you can take live payments.
3. **Create product 1**: Products → New product →
   - Name: `rvo Solo`
   - Payment: one-time, **$29**
   - Enable **Generate license keys**
   - (Optional) Add a 100%-off discount code for your own test purchase.
4. **Create product 2**: same flow, name `rvo Team`, one-time **$99**,
   license keys on.
5. **Copy checkout links**: open each product → Share → copy the checkout
   URL. It looks like `https://<your-store>.lemonsqueezy.com/checkout/buy/<id>`.
6. **Paste into the page**: in `landing/index.html`, find the
   `STORE` config at the bottom of the file and fill it in:
   ```js
   const STORE = {
     solo: "https://<your-store>.lemonsqueezy.com/checkout/buy/<solo-id>",
     team: "https://<your-store>.lemonsqueezy.com/checkout/buy/<team-id>",
   };
   ```
7. **Test**: Lemon Squeezy has a test mode — run a test checkout
   end-to-end (buy → license key email) before announcing.
8. **Redeploy** the landing page. Done — Buy buttons now take real money
   and buyers automatically get license keys + invoices.

## After the first 100 licenses

Regular pricing is $49 / $149. When launch pricing ends, edit the two
product prices in Lemon Squeezy and update the numbers in
`landing/index.html`, `README.md`, `LICENSE.md`, and `docs/BUSINESS.md`.

## Collecting reservation emails properly

Pre-launch, reservations are stored in each visitor's own browser
(localStorage) — fine for testing, not for real lead capture. For real
collection, point the reservation form at a free endpoint instead:
- **Formspree** (free tier): create a form, then in `reserveModal`'s
  submit handler, `fetch('https://formspree.io/f/<id>', { method:'POST',
  body: JSON.stringify({ plan, email }) })` before showing success.
- Or **ConvertKit / Kit**: same idea, one fetch call.

The exact spot is marked in the code with:
`// Persist locally. For real email collection, POST to Formspree/ConvertKit here.`

## Configured 2026-09-24
- Store: https://rvo-tools.lemonsqueezy.com (store #482343, currency INR)
- rvo Solo — ₹2,567 (~$29): https://rvo-tools.lemonsqueezy.com/checkout/buy/a3eb5f02-a932-4eca-8602-905d3fa41f27
- rvo Team — ₹8,762 (~$99): https://rvo-tools.lemonsqueezy.com/checkout/buy/73e93c8c-f537-44be-a861-3f6e6062cb17
- License keys enabled on both (default 1-year length, 5 activations).
- NOTE: store currency is INR (existing store). Switch to USD in Settings → General before live sales if desired.
- Store in Test mode until KYC + activation complete.
