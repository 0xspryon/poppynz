# Activating Stripe Connect for live

Connect is already enabled in **test mode**. As of 2 October 2026, the test account (CAD, Canada) has at least one Express connected account. Live mode is activated separately, at launch. When you do, choose these options in the Stripe dashboard (Connect → Get started / Platform profile):

1. **Account type: Express.**
   Stripe hosts the helper's onboarding: identity verification, bank account and payout dashboard. Poppynz only stores the connected account id and reads its status. The design relies on this (umbrella spec §3 "Helper Connect onboarding" and the piece 2b spec).

2. **Pricing: the platform (Poppynz) handles pricing.**
   Poppynz charges its own commissions: a 5% family service fee and a 15% helper commission. Stripe bills its processing and Connect fees to the platform. Under this model the platform pays CA$2 per active connected account per month plus 0.25% + CA$0.25 per payout. These are illustrative 2026 prices; check the live pricing page.

3. **Funds flow: separate charges and transfers, with the platform liable for refunds and disputes.**
   Poppynz charges the family as the merchant of record, then transfers the helper's share after each cycle. Refunds and card disputes are debited from the Poppynz balance. The platform must accept responsibility for negative balances and losses, as the umbrella spec's dispute rules assume (§9).

## Also needed when switching to live

- Live API keys: `STRIPE_SECRET_KEY=sk_live_…` (API) and `PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…` (web), set in the production environment only. Never commit them.
- A live webhook endpoint in the dashboard pointing at `https://<api host>/webhooks/stripe`, subscribed to the events the code listens for, with its signing secret set as `STRIPE_WEBHOOK_SECRET` in production.
- Business verification and the live platform profile completed, and Connect's terms of service accepted in Poppynz's name. This is an account-owner action.
- The founder's launch checks from the umbrella spec (§3, §12): verify authorisation and capture windows, Connect capabilities and payout timing, partial capture and refunds, and dispute handling in test mode; and get the accountant's written sign-off before any taxable charge goes live.

Related: [umbrella design](superpowers/specs/2026-09-24-stripe-contract-billing-design.md).
