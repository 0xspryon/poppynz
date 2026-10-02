# Helper payout accounts (Stripe Connect): design (piece 2b)

Status: **approved 2026-10-02**. Piece 2b of the [Stripe contract-billing umbrella design](2026-09-24-stripe-contract-billing-design.md) (§3 "Helper Connect onboarding", §6 "Payment-readiness gate"). It builds on [piece 2a](2026-10-02-stripe-payments-design.md): the same provider switch, port, webhook endpoint and event log.

## Goal

Helpers can set up a Stripe payout account and see whether they are **payment-ready**. Pieces 3 and 4 consume that status. 2b **doesn't block** anything: the founder decided a helper may accept contracts before setting up payouts. Pieces 3 and 4 enforce readiness at the start of each cycle and at transfer time.

## Decisions

1. **Express connected accounts**: country `CA`, business type `individual`, `transfers` capability requested.
2. **Onboarding on Stripe's hosted pages**, through Account Links. Poppynz never collects ID or bank details.
3. **Payment-ready** = details submitted, payouts enabled, and the `transfers` capability active. This is the founder's definition: onboarding complete, identity verified, eligible bank account, capabilities active.
4. **Status is always re-fetched from Stripe.** It's never derived from webhook payload contents.
5. **2b reminds, it doesn't block.** There's a reminder at acceptance and a badge on the Payouts link.

## 1. Payment interface additions (`@repo/payments`)

| Operation | Contract |
|---|---|
| `createPayoutAccount({ userId, email })` | Creates an Express account (CA, individual, `transfers` requested, `metadata.user_id`). Returns `{ reference }`. Idempotency key `payout-account:<userId>` |
| `createOnboardingLink({ reference, returnUrl, refreshUrl })` | An Account Link (`account_onboarding`). Returns `{ url, expiresAt }`. Never stored |
| `getPayoutAccount(reference)` | Re-fetches and normalises to `{ detailsSubmitted, payoutsEnabled, transfersActive, requirementsDue: string[], disabledReason: string \| null }` |
| `createDashboardLink(reference)` | An Express dashboard login link. Returns `{ url }` |

The mock creates accounts that are fully enabled straight away.

## 2. Data: migration `0026_payout_accounts`

- **`payout_accounts`** (one per helper):
  - `user_id` (PK, references `user`, `restrict`)
  - `provider`, `account_reference` (unique)
  - `status` (`onboarding` | `ready` | `restricted` | `disabled`)
  - `details_submitted`, `payouts_enabled`, `transfers_active` (booleans)
  - `requirements_due` (jsonb string array), `disabled_reason`
  - `refreshed_at`, `created_at`, `updated_at`
- **Status derivation**, a pure function in the API:
  - `ready` = all three flags true;
  - `disabled` = `disabledReason` starts with `rejected.`;
  - `restricted` = details submitted but not ready;
  - `onboarding` = otherwise.
- **`PayoutAccountRepo`:** `findByUserId`, `findByReference`, `create`, `applySnapshot(userId, snapshot)`.

## 3. API (new `payouts: ['read', 'write']` permission, granted to the service-provider role)

- **`GET /payouts`:** `{ status, paymentReady, requirementsDue (human-readable labels), provider, hasAccount }`. Re-fetches from Stripe when `refreshed_at` is older than 1 hour (`PAYOUTS_REFRESH_AFTER_MINUTES`, default 60).
- **`POST /payouts/onboarding`:** creates the account if missing, then returns `{ url }` from `createOnboardingLink`:
  - `returnUrl` = `<web origin>/service-provider/payouts?from=stripe`
  - `refreshUrl` = `<web origin>/service-provider/payouts?refresh=1`
  
  The web origin comes from a new `APP_WEB_ORIGIN` config, defaulting to `https://app.poppynz.com`; local `.env` files set `http://localhost:5175`. `TRUSTED_ORIGINS` is a list, so it can't serve as one return address.
- **`POST /payouts/refresh`:** re-fetches and stores the snapshot. Returns the same shape as `GET`.
- **`POST /payouts/dashboard`:** `{ url }`. **409** when there's no account.
- **Webhook:** on `account.updated` (a Connect event on the same `/webhooks/stripe` endpoint and event log), `findByReference(objectId)`, then re-fetch and `applySnapshot`. Unknown accounts are recorded and get a 200.
- **Internal:** `isPaymentReady(userId): Effect<boolean>` for pieces 3 and 4.
- **Contract detail** (helper viewer) gains `payoutsReady: boolean`, used for the reminder at acceptance.

## 4. Web

- **New `/service-provider/payouts` page**, with a "Payouts" item in the helper sidenav:

  | Status | What the helper sees |
  |---|---|
  | No account | "Set up payouts" |
  | `onboarding` | "Continue setup" |
  | `restricted` | The requirements list and "Fix in Stripe" |
  | `disabled` | A support message |
  | `ready` | Green status and "View payouts in Stripe" (dashboard link) |

  The buttons call the endpoints, then `window.location.assign(url)`. On return (`?from=stripe` or `?refresh=1`), the page calls `/payouts/refresh`, or `/payouts/onboarding` again for an expired link.
- **Badge** on the Payouts link while the helper has no account or isn't ready.
- **Reminder at acceptance**, in the accept confirmation when `payoutsReady` is false: "**You'll need a payout account to collect your earnings.** Set it up now, or later — you'll be asked again before your first payment." It links to Payouts and doesn't block.

## 5. Testing

- **Unit:**
  - status derivation for each state from Stripe account fixtures;
  - adapter calls (create, link, retrieve, login link), with idempotency keys;
  - routes, including permission denial, the 409 dashboard response with no account, and the 1-hour refresh rule;
  - the `account.updated` webhook: known account, unknown account, duplicate event;
  - `isPaymentReady`.
- **Web:** mount tests for each Payouts page state, and for the reminder at acceptance.
- **End to end, locally** (`stripe listen --forward-to localhost:3000/webhooks/stripe --forward-connect-to localhost:3000/webhooks/stripe`):
  - create an account through the app and follow the onboarding link up to Stripe's page (not filled in by the agent);
  - complete a test account through the API with Stripe's test values;
  - check that `account.updated` arrives and the page shows Ready;
  - check that the dashboard link opens;
  - optionally, the user completes the hosted onboarding manually once.

## Out of scope

Transfers, payouts and the transfer schedule (piece 4); blocking acceptance or cycle start on payment readiness (pieces 3 and 4); manual off-Stripe payouts (piece 4).
