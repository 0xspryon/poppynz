# Stripe payments: design (piece 2a)

Status: **approved 2026-10-02**. Piece 2a of the [Stripe contract-billing umbrella design](2026-09-24-stripe-contract-billing-design.md) (§3). Piece 2b, [helper payout accounts](2026-10-02-stripe-connect-payouts-design.md), is designed alongside it and implemented after it.

## Goal

Replace the mock payment provider with Stripe for real card payments:
- background-check orders, paid by families and helpers;
- a saved card for families, with a Billing section showing the card and payment history;
- sending contract terms requires a saved card.

Contract billing (cycles, holds, captures) is piece 3 and **out of scope here**.

## Decisions

1. **Embedded Payment Element**, cards only (no redirect payment methods). Card data never touches Poppynz servers.
2. **Only families save a card** (one per family). Helpers pay one-off.
3. **A saved card is required to send contract terms** (`422 PAYMENT_METHOD_REQUIRED`), and the family is prompted on the spot.
4. **Billing section** (families): the card on file, plus payment history with Stripe receipt links. No invoices or tax receipts yet; those wait for the accountant's tax sign-off.
5. **Background-check payments are captured immediately** (automatic capture).
6. **Webhook = wake-up signal.** Verify the signature over the raw body, then re-fetch from Stripe and act only on the fetched object.
7. **Test mode only** for development. Live activation is in [docs/activating-stripe-connect.md](../../activating-stripe-connect.md).

## 1. Architecture and the payment interface

- **Provider switch:** `PAYMENTS_PROVIDER` = `mock` | `stripe`, **default `mock`**. The API (`apps/api/src/managed-runtime.ts`) and the worker (`apps/worker/src/index.ts`) build their `Payments` layer from it, replacing the hard-wired `PaymentsMock`.
- **Config** in `@repo/env`, as a new `stripeConfig`:
  - `STRIPE_SECRET_KEY` (redacted, required when the provider is `stripe`)
  - `STRIPE_WEBHOOK_SECRET` (redacted)
  - `PAYMENTS_SETTLE_AFTER_MINUTES` (default 10)
  - `PAYMENTS_ABANDON_AFTER_HOURS` (default 24)
  
  The web app reads `PUBLIC_STRIPE_PUBLISHABLE_KEY` from `apps/web/.env`.
- **The Stripe code lives in `@repo/payments`** (`src/stripe.ts`, using the official `stripe` Node SDK). Nothing outside the package imports Stripe.
- **The port becomes two-step** (replacing `authorise`):

| Operation | Contract |
|---|---|
| `quote(lineItems, policy)` | Unchanged |
| `startPayment({ quote, idempotencyKey, metadata, customer?, savedCard?, saveCard })` | Creates a PaymentIntent with automatic capture, card only. Returns `{ reference, clientSecret, status }`. `metadata.payment_id` is always our `payments.id`. `saveCard` sets `setup_future_usage: off_session`. `savedCard` pre-attaches the family's saved card for one-click payment. Calling it again with the same idempotency key returns the same intent |
| `resumePayment(reference)` | Re-fetches an unfinished intent and returns a fresh `clientSecret` |
| `getPayment(reference)` | Re-fetches and normalises: `status` (`requires_action` \| `processing` \| `succeeded` \| `failed` \| `canceled`), `amountCents`, `currency`, `metadata`, `failureReason`, `receiptUrl`, `paymentMethod` (card brand, last 4, expiry and reference, when present) |
| `cancelPayment(reference)` | Cancels an unfinished intent (used by the recovery job) |
| `refund({ reference, reason, idempotencyKey })` | Unchanged contract |
| `ensureCustomer({ userId, email, name, existing? })` | Returns the Stripe Customer reference, creating it when `existing` is null |
| `startCardSetup(customer)` | A SetupIntent (`usage: off_session`, card only), returning `{ reference, clientSecret }` |
| `getCardSetup(reference)` | Re-fetches the SetupIntent: `status`, `customer`, `paymentMethod` (as above) |
| `removeCard(cardReference)` | Detaches a card from its customer |
| `verifyWebhook(rawBody, signatureHeader)` | Verifies `Stripe-Signature`. Returns `{ eventId, type, objectId, account? }` or fails with `PaymentWebhookSignatureError`. The payload body is never trusted |

- **Errors:** `PaymentDeclinedError` and `PaymentProviderError` (with `operation` widened to every operation), plus the new `PaymentWebhookSignatureError`.
- **The mock** implements everything:
  - payments succeed immediately with `clientSecret: 'mock_secret_…'`;
  - card setups succeed immediately with a fake "Visa •••• 4242";
  - `verifyWebhook` accepts nothing.
  
  The web app skips the Payment Element when the provider is the mock (the API says which provider is active).

## 2. Data model: migration `0025_stripe_payments`

All new foreign keys are `restrict`.

- **`billing_customers`**: `user_id` (PK, references `user`), `provider`, `customer_reference` (unique per provider), `card_reference` (nullable), `card_brand`, `card_last4`, `card_exp_month`, `card_exp_year` (display only), `created_at`, `updated_at`.
- **`payments`** gains `receipt_url` (nullable).
- **`stripe_webhook_events`**: `event_id` (PK), `type`, `object_id`, `received_at`, `processed_at` (nullable), `error` (nullable). Used for de-duplication and audit. The payload is not stored.
- **Repos:**
  - `BillingCustomerRepo`: `findByUserId`, `upsertCustomer`, `setCard`, `clearCard`.
  - `PaymentRepo` gains `findByProviderReference` and `listByUser` (newest first, with an order/kind description), plus a guarded `advance(id, { from, set })` that follows the `CheckOrderRepo.advance` compare-and-set pattern.
  - `StripeWebhookEventRepo`: `record` (insert or detect duplicate), `markProcessed`, `markFailed`.

## 3. API

### Background-check payment (`POST /safety-verification/order`)

- Keep the existing claim, the `payments` row inserted as `pending` first (its id is the idempotency key), and the resume rules.
- Replace `authorise` with `startPayment`:
  - **Family:** `ensureCustomer`; `saveCard: true` when they have no saved card; `savedCard` set when they have one.
  - **Helper:** no customer and no save.
- **Response:**
  - `{ status: 'payment_required', paymentId, clientSecret, provider, savedCard? }` while the order is `payment_pending`;
  - or the existing paid response when the provider settles immediately (the mock).
- **Resume:** for an order in `payment_pending` whose payment row is `pending`, call `resumePayment(reference)` and return a fresh `clientSecret`. Never start a second intent.

### `settle(paymentId)`: one function, three callers

Called from `POST /safety-verification/order/confirm` (`{ paymentId }`, for the owner only), the webhook, and the recovery job. Steps:

1. Load the row. Skip it if it's already final (`captured` / `refunded` / `failed`).
2. `getPayment(row.providerReference)`.
3. **Check the fetched intent against our row:**
   - `metadata.payment_id === row.id`;
   - the amount equals `row.totalCents`;
   - the currency equals `row.currency` (lowercase CAD).
   
   On any mismatch, set `lastError` and change nothing else.
4. Act on the status:
   - **`succeeded`:** `PaymentRepo.advance` from `pending` → `captured` (`capturedAt`, `receiptUrl`). Then the existing `finish` (order `payment_pending` → `paid`, enqueue Credibled). For a family with a returned `paymentMethod`, `BillingCustomerRepo.setCard`, and detach the previous card if it differs.
   - **`failed` / `canceled`:** `advance` `pending` → `failed` (`lastError` = `failureReason`), and the order returns to `draft` via the existing guarded revert.
   - **`requires_action` / `processing`:** no change.
5. Every transition is a compare-and-set, so concurrent callers (browser, webhook, job) apply each outcome exactly once.

### Billing (families; new `billing: ['read', 'write']` permission granted to the family role)

- **`GET /billing`:** `{ card: { brand, last4, expMonth, expYear } | null, payments: [{ id, createdAt, description, totalCents, currency, status, receiptUrl }], provider }`.
- **`POST /billing/card/setup`:** `ensureCustomer`, then `startCardSetup`. Returns `{ setupId, clientSecret, provider }`.
- **`POST /billing/card/confirm`:** `{ setupId }`.
  1. `getCardSetup`; require `succeeded` and that the customer is the caller's.
  2. `setCard`, and detach the previous card.
  3. Return the new card.

### Contracts

- **`sendContractProgram`:** after the existing checks, a family without `billing_customers.card_reference` fails with `PaymentMethodRequiredError` → `422 PAYMENT_METHOD_REQUIRED` ("Add a card in Billing before sending — it's used for contract billing.").
- **The contract detail** gains `hasPaymentMethod` (family viewer only). `actions.canSend` also requires it.

### Webhook: `POST /webhooks/stripe`

1. Mounted outside `appRoutes`, next to Credibled's.
2. Read the raw body (with a size limit), then `verifyWebhook` → **400** if invalid. **Enforcement is never disabled.**
3. `record` the event. A duplicate returns 200 immediately.
4. Dispatch:
   - `payment_intent.succeeded` / `payment_failed` / `canceled` / `processing`: `findByProviderReference(objectId)`, then `settle`.
   - `setup_intent.succeeded`: card-setup confirmation for the matching customer.
   - `charge.refunded`: re-fetch, then `advance` → `refunded` if not already.
   - `charge.dispute.created`: set `lastError` ("card dispute opened") on the payment for admin attention. Full handling is piece 4.
   - `account.updated`: handled by piece 2b.
   - Unknown types: record and 200.
5. On a processing failure: `markFailed`, and respond **500** so Stripe retries.

### Errors

New tagged errors are mapped by `_tag` in each route's response mapper, ending in `handleNever` (AGENTS.md).

## 4. Worker

- **Payment recovery job, on the existing 15-minute schedule:**
  - `pending` payments with a provider reference, older than `PAYMENTS_SETTLE_AFTER_MINUTES` → `settle`;
  - still unfinished after `PAYMENTS_ABANDON_AFTER_HOURS` → `cancelPayment`, then `settle` (which marks the payment failed and returns the order to `draft`).
- **Refunds** (`refundAndFail` in `safety-verification-order-processor.ts`) keep using `refund`; the webhook confirms them.

## 5. Web

- **`@stripe/stripe-js`.** A shared `PaymentModal` component wraps the Payment Element in `payment` mode (a `clientSecret` from an intent) and `setup` mode (from a SetupIntent). It confirms with `redirect: 'if_required'`, so 3-D Secure appears in-modal, and calls the matching confirm endpoint afterwards. Stripe's error messages show inside the modal.
- **`SafetyCheckPanel`** opens the modal on "Pay":
  - **Family with a saved card:** "Pay $X with Visa •••• 4242", plus "Use another card".
  - **Family entering a new card:** the notice "Your card will be saved for future Poppynz payments, such as contract billing. You can replace it in Billing."
  - **Helper:** the plain card form.
  - **Mock provider:** no modal.
- **New `/family/billing` page**, with a "Billing" item in the family sidenav:
  - the card on file with **Replace card**, or **Add a card** when there's none;
  - payment history: date, description, amount, status (Paid / Refunded / Failed / Pending), Receipt link.
- **`ContractTermsEditor`:** when `hasPaymentMethod` is false, show "**Add a card** to send — your card is used for contract billing" (link to `/family/billing`) and disable Send. Map `PAYMENT_METHOD_REQUIRED` to a toast with the API message.

## 6. Testing

- **`@repo/payments`:** the Stripe adapter against a faked Stripe client. Covers status normalisation, idempotency keys passed through, card-only intents, `saveCard` / `savedCard`, and `verifyWebhook` with `stripe.webhooks.generateTestHeaderString` (valid, tampered, wrong secret, stale timestamp).
- **API:**
  - `settle` for succeeded, failed, canceled, processing, amount mismatch, metadata mismatch, unknown reference, already final, and concurrent calls;
  - the order flow (start, resume, confirm);
  - billing routes, including permission denial;
  - the webhook: bad signature 400, duplicate 200, a dispatch failure records the error and returns 500;
  - `PAYMENT_METHOD_REQUIRED` and `canSend`.
- **Worker:** the recovery job (settle after 10 minutes, abandon after 24 hours).
- **Web:** mount tests for the modal states, the Billing page and the editor card prompt.
- **End to end, locally** (test keys, `stripe listen --forward-to localhost:3000/webhooks/stripe`):
  - test cards: `4242 4242 4242 4242` succeeds; `4000 0025 0000 3155` needs 3-D Secure; `4000 0000 0000 9995` is declined;
  - family check payment with the card saved, then a one-click repeat;
  - helper one-off payment;
  - adding and replacing a card;
  - the webhook arriving before or after the browser's confirmation;
  - the recovery job settling a payment whose tab was closed.

## Out of scope

Contract billing, holds and captures (piece 3); transfers, payouts and dispute handling (piece 4); invoices and tax receipts; non-card payment methods; live activation.
