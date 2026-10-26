# Stripe Payments (piece 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock payment provider with Stripe (test mode) for background-check payments, give families one saved card with a Billing page, and require that card before contract terms can be sent.

**Architecture:** The `Payments` port in `@repo/payments` becomes two-step (`startPayment` → browser confirms with the Payment Element → server re-fetches) and gains customer, card-setup and webhook operations; a Stripe adapter (the only code importing the `stripe` SDK) sits behind `PaymentsLive`, which picks `mock` or `stripe` from `PAYMENTS_PROVIDER`. A new `@repo/billing` package owns the one `settle(paymentId)` path and the card-on-file rules, shared by the API (order confirm, billing routes, `POST /webhooks/stripe`) and the worker (15-minute recovery job). Migration `0025_stripe_payments` adds `billing_customers`, `stripe_webhook_events` and `payments.receipt_url`; the web app gets a shared `PaymentModal`, a `/family/billing` page and a card prompt in the contract editor.

**Tech Stack:** Bun 1.3.14 workspaces + Turborepo, Effect 3 (`^3.21.2`), Hono RPC, Drizzle (hand-written SQL migrations), SvelteKit 5 (runes) + DaisyUI 5, vitest 4 (api, worker, web), `bun test` (packages). New: **`stripe@23.0.0`** (Node SDK; pins API version **`2026-09-30.endive`**), **`@stripe/stripe-js@10.0.0`**. Stripe CLI 1.53.0 (already at `~/.bun/bin/stripe`) for local webhooks.

**Spec:** `docs/superpowers/specs/2026-10-02-stripe-payments-design.md` (umbrella: `docs/superpowers/specs/2026-09-24-stripe-contract-billing-design.md` §3).

## Global Constraints

- Work in the worktree `/run/media/hbt/work/poppynz/stripe-integration` (branch `feature/stripe-integration`). Never `cd` into another worktree; never `git stash`. Use absolute paths or `cd` inside a single command.
- `PAYMENTS_PROVIDER` = `mock` | `stripe`, **default `mock`**. The API and the worker both build their `Payments` layer from it (`PaymentsLive`).
- **The `stripe` Node SDK is imported only inside `@repo/payments`** (`packages/payments/src/stripe.ts` and its test). The web app uses `@stripe/stripe-js` only in `apps/web/src/lib/stripe.ts` and `PaymentModal.svelte`.
- **Test mode only.** `PaymentsLive` refuses any `STRIPE_SECRET_KEY` that does not start with `sk_test_` or `rk_test_`.
- **Webhook signature enforcement is never disabled.** No secret configured ⇒ every delivery is refused with 400. Do NOT copy anything from the disabled-signature block in `apps/api/src/routes/webhooks/credibled.ts`.
- Webhook = wake-up signal: verify the signature over the RAW body, then re-fetch from Stripe and act only on the fetched object.
- All new foreign keys are `ON DELETE restrict`.
- Migration is hand-written: `packages/db/src/migrations/0025_stripe_payments.sql` plus a hand-added `meta/_journal.json` entry (`idx` 25, `when` 1788160000000). Never run `drizzle-kit generate`.
- Error codes (exact): `PAYMENT_METHOD_REQUIRED` (422, message "Add a card in Billing before sending — it's used for contract billing."), plus this plan's `BILLING_CARD_SETUP_NOT_FOUND` (404), `BILLING_CARD_SETUP_INCOMPLETE` (409), `BILLING_PROVIDER_UNAVAILABLE` (503), `INVALID_BILLING_INPUT` (400). Existing codes keep their meaning.
- New permission statement `billing: ['read', 'write']`, granted to the family role only. Who keeps a card is decided by `billing:write`, never by a role check.
- AGENTS.md rules: route error types derived from programs (`Effect.Effect.Error<ReturnType<typeof program>>`); response mappers switch on `_tag` and end with `handleNever(c, error)`; repo/provider errors piped through mappers (`repo.x().pipe((errors) => mapXError(errors))`); every new route/domain program gets focused unit tests (success, validation, permission denial, error translation); user-facing success/error messages are toasts (Stripe's own card messages inside the payment modal are the spec'd exception).
- Commit after every task with a conventional message ending in the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pre-existing, not ours: `apps/api/src/lib/mailer.unit.test.ts` has 2 failing tests (ENVIRONMENT gating); prettier already flags `packages/env/src/index.ts`, `packages/db/src/repos/check-order-repo.ts` and `safety-verification.handler.ts` before this work; `DocumentTypeDialog.svelte` has one `{@debug}` lint warning. Compare against that baseline, don't chase it.
- The worktree carries the user's uncommitted edits to `apps/api/.env.example` (a `# stripe` block) and `apps/web/.env.example` (`PUBLIC_STRIPE_PUBLISHABLE_KEY`). Keep them; Task 2 extends and commits them. Never put real keys in any `.env.example`, and never print the values in `apps/api/.env` or `apps/web/.env`.

## Spec ambiguities resolved here

1. **"Family" vs "helper" in the order flow** → the `billing:write` permission (families only), checked with `AuthService.userHasPermission`, per AGENTS.md.
2. **A declined attempt (`failed`) is not terminal at Stripe** (the intent can be confirmed again with another card). `settle` therefore **cancels the intent before marking the row failed**; if the cancel reports `succeeded` it captures instead. The modal ends a refused attempt and the next "Pay" starts a fresh payment.
3. **Port fields added beyond the spec table**, all needed by the spec's own rules: `StartedPayment.paymentMethodReference` (to only offer one-click when the intent really carries the saved card), `ProviderPayment.customer` / `savesCard` (save a card only for the payment's own customer and only when the intent was created to keep it), `ProviderPayment.refundedCents` (`charge.refunded` only moves a fully refunded row), `PaymentWebhookEvent.paymentReference` (charge and dispute events name their PaymentIntent). `cancelPayment` returns the re-fetched payment.
4. **Currency check**: rows store `'CAD'`, Stripe reports `'cad'` — compared case-insensitively.
5. **`payment_required` response** also carries `savesCard` (the modal shows the "card will be saved" notice only then); `savedCard` is always present (`null` when absent). The paid response gains `status: 'paid'`.
6. **Duplicate webhooks**: only an event already *processed* is acknowledged as a duplicate; one recorded but failed is reprocessed, so Stripe's retry after our 500 works.
7. **Provider switch with old data**: a `billing_customers` row or card from the other provider is ignored (`cardOnFile`) and replaced on next use (`upsertCustomer`); a `payments` row from another provider is `skipped` by settle.
8. **Where `settle` lives**: new package `@repo/billing` (API and worker both need it; apps cannot import each other).
9. **Repo methods added beyond the spec list**: `BillingCustomerRepo.findByCustomerReference`, `PaymentRepo.listStalePending` (recovery job), `CheckOrderRepo.findByPaymentId` (settle starts from a payment). `listByUser` leaves out rows that never reached the provider.
10. **"Prompted on the spot" for contracts** → §5's wording: the editor shows "Add a card to send — your card is used for contract billing" linking to `/family/billing`, Send is disabled, and `PAYMENT_METHOD_REQUIRED` becomes a toast.
11. **SDK reality vs spec wording**: stripe@23 removed `payment_method_types`; card-only is `allowed_payment_method_types: ['card']`. Under Bun the SDK resolves to its web build whose crypto is async-only, so signatures use `constructEventAsync` / `generateTestHeaderStringAsync` (the sync variants throw "SubtleCryptoProvider cannot be used in a synchronous context").
12. **Resume**: `GET /safety-verification` gains `canResumePayment`; the panel shows "Continue payment", which calls `POST /order` again (resume, never a second intent).
13. **Notifications**: `safety_verification.updated` gains statuses `payment_pending` (settled) and `not_started` (failed) so an open page refreshes; neither shows a toast.

## File Structure

| File | Responsibility |
|---|---|
| `packages/payments/src/port.ts` (new, from `index.ts`) | Port types, errors, `Payments` tag, `quoteFromPolicy` |
| `packages/payments/src/mock.ts` (new, from `index.ts`) | `makeMockPayments`, `PaymentsMock`, `makePaymentsTest`, `mockCard` |
| `packages/payments/src/stripe.ts` (new) | The Stripe adapter — the only `stripe` import |
| `packages/payments/src/layer.ts` (new) | `PaymentsLive` (provider switch, test-key guard) |
| `packages/payments/src/index.ts` | Re-exports port, mock, layer |
| `packages/payments/src/{mock,stripe,layer}.test.ts` (new) | Package tests (`bun test src`) |
| `packages/env/src/index.ts` | `stripeConfig` |
| `packages/db/src/migrations/0025_stripe_payments.sql` + `meta/_journal.json` | Tables, column, index |
| `packages/db/src/schema.ts` | `billingCustomer`, `stripeWebhookEvent`, `payment.receiptUrl` |
| `packages/db/src/repos/billing-customer-repo.ts` (new) | `BillingCustomerRepo` + in-memory test repo + fixture |
| `packages/db/src/repos/stripe-webhook-event-repo.ts` (new) | `StripeWebhookEventRepo` |
| `packages/db/src/repos/payment-repo.ts` | `findByProviderReference`, `listByUser`, `listStalePending`, `advance` |
| `packages/db/src/repos/check-order-repo.ts` | `findByPaymentId`; partial test helper |
| `packages/billing/*` (new package) | `settlePayment`, `settlePaymentByReference`, `mismatchReason`, `ensureBillingCustomer`, `cardOnFile`, `toCard`, `saveCard`, `applyCardSetup` |
| `packages/notify/src/events.ts` | Two more `safety_verification.updated` statuses |
| `packages/queue/src/index.ts` | `recoverPayments` job name, `paymentRecoverySchedulerId` |
| 5 × `Dockerfile*.production` | Copy `packages/billing/package.json` into the deps layer |
| `apps/api/src/lib/auth-roles.ts` | `billing` permission |
| `apps/api/src/managed-runtime.ts`, `app-env.ts` | `PaymentsLive`, new repos |
| `apps/api/src/routes/app/safety-verification/*` | Two-step order, resume, `POST /order/confirm`, `canResumePayment` |
| `apps/api/src/routes/app/billing/*` (new) | `GET /billing`, `POST /billing/card/setup`, `POST /billing/card/confirm` |
| `apps/api/src/routes/app/contracts/*` | `PAYMENT_METHOD_REQUIRED`, `hasPaymentMethod`, `canSend` |
| `apps/api/src/routes/webhooks/stripe.ts` (+ test, new) | `POST /webhooks/stripe` |
| `apps/api/src/index.ts`, `routes/app/index.ts` | Mount webhook and billing routes |
| `apps/worker/src/payment-recovery-processor.ts` (+ test, new) | Recovery job |
| `apps/worker/src/index.ts` | `PaymentsLive`, billing repo, queue layer, scheduler, job branch |
| `apps/web/src/lib/stripe.ts`, `payment-cards.ts` (+ test) (new) | Stripe.js loader, card labels |
| `apps/web/src/lib/api/billing.ts` (new), `api/safety-verification.ts` | Clients |
| `apps/web/src/lib/components/payments/PaymentModal.svelte` (+ mount test, new) | Shared Payment Element modal |
| `apps/web/src/lib/components/verification/SafetyCheckPanel.svelte` (+ mount test) | Pay / resume flow |
| `apps/web/src/routes/family/billing/+page.svelte` (+ mount test, new), `routes/family/+layout.svelte` | Billing page, sidenav item |
| `apps/web/src/lib/components/contracts/ContractTermsEditor.svelte` (+ test), `ContractDetailPage.svelte` | Card prompt, toast |

---

### Task 1: Two-step payment port and mock

Splits `packages/payments/src/index.ts` into `port.ts` (contract) and `mock.ts` (mock + test helper), and widens the port to everything §1 lists. `authorise` stays on the port for now, marked deprecated, so the API keeps compiling until Task 5 moves its last caller to `startPayment`.

**Files:**
- Create: `packages/payments/src/port.ts`, `packages/payments/src/mock.ts`, `packages/payments/src/mock.test.ts`
- Modify: `packages/payments/src/index.ts` (becomes re-exports only), `packages/payments/package.json` (test script)

**Interfaces:**
- Produces (exported from `@repo/payments`):
  - types `PaymentProvider = 'mock' | 'stripe'`, `QuoteLineItem`, `QuotePolicy`, `Money` (unchanged)
  - `type ProviderPaymentStatus = 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'canceled'`
  - `type CardDetails = { reference; brand; last4; expMonth; expYear }`
  - `type StartedPayment = { reference: string; clientSecret: string; status: ProviderPaymentStatus; paymentMethodReference: string | null }`
  - `type ProviderPayment = { reference; status; amountCents; currency /* lower case */; metadata: Record<string,string>; customer: string | null; savesCard: boolean; failureReason: string | null; receiptUrl: string | null; refundedCents: number; paymentMethod: CardDetails | null }`
  - `type CardSetup = { reference; clientSecret }`, `type ProviderCardSetup = { reference; status: ProviderPaymentStatus; customer: string | null; paymentMethod: CardDetails | null }`
  - `type PaymentWebhookEvent = { eventId; type; objectId; paymentReference: string | null; account: string | null }`
  - `type StartPaymentInput = { quote: Money; idempotencyKey: string; metadata: { payment_id: string } & Record<string,string>; customer?: string | null; savedCard?: string | null; saveCard: boolean }`
  - `type PaymentOperation` (every operation name), errors `PaymentDeclinedError { reason }`, `PaymentProviderError { operation: PaymentOperation; cause }`, `PaymentWebhookSignatureError { reason }`
  - `Payments` tag service: `provider`, `quote`, `startPayment`, `resumePayment(reference)`, `getPayment(reference)`, `cancelPayment(reference) → ProviderPayment`, `refund({ reference, reason, idempotencyKey })`, `ensureCustomer({ userId, email, name, existing })`, `startCardSetup(customer)`, `getCardSetup(reference)`, `removeCard(cardReference)`, `verifyWebhook(rawBody, signatureHeader: string | null)`; plus deprecated `authorise` until Task 5
  - `quoteFromPolicy`, `mockCard(reference)`, `makeMockPayments({ failStart?, failRefund?, now? })`, `PaymentsMock`, `makePaymentsTest(partial)`
- Mock behaviour later tasks rely on: `startPayment` → reference `mock_pi_<idempotencyKey>`, client secret `mock_secret_<reference>`, status `succeeded`, `paymentMethodReference = savedCard ?? null`, `getPayment` returns the stored intent (`currency: 'cad'`, `metadata` as given, `savesCard = saveCard`); `ensureCustomer` → `existing ?? 'mock_cus_<userId>'`; `startCardSetup(customer)` → `mock_seti_<n>` that `getCardSetup` reports `succeeded` with Visa 4242 (`mock_pm_mock_seti_<n>`); `verifyWebhook` always fails.

- [ ] **Step 1: Add the test script**

In `packages/payments/package.json` add, after `"exports": {…},`:

```json
  "scripts": {
    "test": "bun test src"
  },
```

- [ ] **Step 2: Write the failing mock tests**

`packages/payments/src/mock.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';
import { makeMockPayments } from './mock';
import { quoteFromPolicy } from './port';

const quote = quoteFromPolicy([{ label: 'Check', costCents: 4500 }], {
  adminFeeCents: 500,
  taxRateBasisPoints: 0
});

describe('quoteFromPolicy', () => {
  it('adds the fee and tax to the lines, in integer cents', () => {
    const taxed = quoteFromPolicy([{ label: 'Check', costCents: 4500 }], {
      adminFeeCents: 500,
      taxRateBasisPoints: 1300
    });
    expect(taxed).toMatchObject({
      amountCents: 4500,
      feeCents: 500,
      taxCents: 650,
      totalCents: 5650
    });
  });

  it('charges nothing at all for an empty basket', () => {
    expect(quoteFromPolicy([], { adminFeeCents: 500, taxRateBasisPoints: 1300 }).totalCents).toBe(
      0
    );
  });
});

describe('mock payments', () => {
  it('settles a payment the moment it starts, once per key', async () => {
    const payments = makeMockPayments();
    const input = {
      quote,
      idempotencyKey: 'payment-1',
      metadata: { payment_id: 'payment-1' },
      saveCard: false
    };
    const first = await Effect.runPromise(payments.startPayment(input));
    const again = await Effect.runPromise(payments.startPayment(input));

    expect(first.status).toBe('succeeded');
    expect(first.clientSecret).toStartWith('mock_secret_');
    expect(again.reference).toBe(first.reference);

    const fetched = await Effect.runPromise(payments.getPayment(first.reference));
    expect(fetched).toMatchObject({
      status: 'succeeded',
      amountCents: 5000,
      currency: 'cad',
      metadata: { payment_id: 'payment-1' }
    });
  });

  it('completes a card setup immediately with a fake Visa 4242', async () => {
    const payments = makeMockPayments();
    const setup = await Effect.runPromise(payments.startCardSetup('mock_cus_u1'));
    const fetched = await Effect.runPromise(payments.getCardSetup(setup.reference));
    expect(fetched).toMatchObject({ status: 'succeeded', customer: 'mock_cus_u1' });
    expect(fetched.paymentMethod).toMatchObject({ brand: 'visa', last4: '4242' });
  });

  it('accepts no webhook at all', async () => {
    const exit = await Effect.runPromiseExit(makeMockPayments().verifyWebhook('{}', 't=1,v1=x'));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('declines on demand', async () => {
    const exit = await Effect.runPromiseExit(
      makeMockPayments({ failStart: true }).startPayment({
        quote,
        idempotencyKey: 'payment-1',
        metadata: { payment_id: 'payment-1' },
        saveCard: false
      })
    );
    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'PaymentDeclinedError' }) as never)
    );
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/packages/payments && bun test src`
Expected: FAIL — `Cannot find module './mock'`.

- [ ] **Step 4: Write the port**

`packages/payments/src/port.ts`:

```ts
import { Context, Data, Effect } from 'effect';

/**
 * The seam Stripe plugs into.
 *
 * Nothing outside this package may import Stripe — that rule is why the
 * persisted columns are `provider` + `provider_reference` rather than
 * `stripe_*`, and why every operation here speaks in references and cents.
 *
 * Payment is TWO-STEP. `startPayment` creates the provider's intent and hands
 * back a client secret for the browser to confirm (3-D Secure included); money
 * is only ever recorded as taken by a server-side re-fetch (`getPayment`),
 * never by the browser saying so. The mock settles instantly so the ordering,
 * refund and retry paths stay exercised without a provider.
 *
 * Three properties matter more than the provider:
 *
 *   - A quote is ITEMISED and frozen. The caller stores the breakdown in cents
 *     and never recomputes it for display.
 *   - Starting a payment is IDEMPOTENT on a caller-supplied key, so a retried
 *     order can't create a second charge.
 *   - Refund exists from day one, keyed the same way.
 */

/** Which gateway a reference belongs to. Persisted next to the reference so a
 * row is meaningful on its own. */
export type PaymentProvider = 'mock' | 'stripe';

/** One priced line on a quote. */
export type QuoteLineItem = {
  readonly label: string;
  readonly costCents: number;
};

/** Fee and tax policy for one purpose. Pre-tax, in cents and basis points. */
export type QuotePolicy = {
  readonly adminFeeCents: number;
  readonly taxRateBasisPoints: number;
};

export type Money = {
  /** Sum of the selected checks, pre-tax. */
  readonly amountCents: number;
  readonly lineItems: ReadonlyArray<QuoteLineItem>;
  /** Poppynz administration fee, pre-tax. */
  readonly feeCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly currency: 'CAD';
};

/** A provider-side status, normalised. `failed` is an attempt that was
 * declined and left waiting for another card; `canceled` is terminal. */
export type ProviderPaymentStatus =
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/** Display details of a card plus its provider reference. Never a full
 * number — the provider holds the card. */
export type CardDetails = {
  readonly reference: string;
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
};

export type StartedPayment = {
  /** Opaque to everything above this port (a PaymentIntent id for Stripe). */
  readonly reference: string;
  /** Handed to the browser so it can confirm the payment. Never stored. */
  readonly clientSecret: string;
  readonly status: ProviderPaymentStatus;
  /** The card already attached to the intent (a family's saved card), if any. */
  readonly paymentMethodReference: string | null;
};

/** What the provider says about a payment, re-fetched — the only thing the
 * settle path acts on. */
export type ProviderPayment = {
  readonly reference: string;
  readonly status: ProviderPaymentStatus;
  readonly amountCents: number;
  /** Lower-case ISO code as the provider reports it, e.g. `cad`. */
  readonly currency: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly customer: string | null;
  /** True when the intent was created to keep the card for later. */
  readonly savesCard: boolean;
  readonly failureReason: string | null;
  readonly receiptUrl: string | null;
  readonly refundedCents: number;
  readonly paymentMethod: CardDetails | null;
};

/** @deprecated The pre-Stripe one-step result. Removed in Task 5 together
 * with `authorise`'s last caller. */
export type PaymentAuthorisation = {
  readonly reference: string;
  readonly authorisedAt: Date;
};

export type PaymentRefund = {
  readonly refundReference: string;
  readonly refundedAt: Date;
};

export type CardSetup = {
  readonly reference: string;
  readonly clientSecret: string;
};

export type ProviderCardSetup = {
  readonly reference: string;
  readonly status: ProviderPaymentStatus;
  readonly customer: string | null;
  readonly paymentMethod: CardDetails | null;
};

/** A verified webhook delivery, reduced to what routing needs. The payload's
 * object is never acted on — callers re-fetch by reference. */
export type PaymentWebhookEvent = {
  readonly eventId: string;
  readonly type: string;
  readonly objectId: string;
  /** For charge and dispute events, the PaymentIntent the object belongs to. */
  readonly paymentReference: string | null;
  /** The connected account, for Connect events (piece 2b). */
  readonly account: string | null;
};

export type PaymentOperation =
  | 'startPayment'
  | 'resumePayment'
  | 'getPayment'
  | 'cancelPayment'
  | 'refund'
  | 'ensureCustomer'
  | 'startCardSetup'
  | 'getCardSetup'
  | 'removeCard'
  | 'verifyWebhook';

export class PaymentDeclinedError extends Data.TaggedError('PaymentDeclinedError')<{
  reason: string;
}> {}

export class PaymentProviderError extends Data.TaggedError('PaymentProviderError')<{
  operation: PaymentOperation;
  cause: unknown;
}> {}

export class PaymentWebhookSignatureError extends Data.TaggedError('PaymentWebhookSignatureError')<{
  reason: string;
}> {}

export type StartPaymentInput = {
  quote: Money;
  /** Same key must produce the same intent, never a second charge. */
  idempotencyKey: string;
  /** `payment_id` is always our `payments.id`; the settle path checks it. */
  metadata: { payment_id: string } & Record<string, string>;
  /** Provider customer reference (families only). */
  customer?: string | null;
  /** Saved card reference to pre-attach for one-click payment. */
  savedCard?: string | null;
  /** Keep the card for off-session use (a family's first card). */
  saveCard: boolean;
};

export class Payments extends Context.Tag('@repo/payments/Payments')<
  Payments,
  {
    readonly provider: PaymentProvider;
    /** Itemises what somebody will pay before anything is charged. */
    quote: (lineItems: ReadonlyArray<QuoteLineItem>, policy: QuotePolicy) => Effect.Effect<Money>;
    /** @deprecated Replaced by `startPayment`; removed in Task 5 with its last
     * caller (the safety-verification order route). */
    authorise: (input: {
      userId: string;
      quote: Money;
      idempotencyKey: string;
    }) => Effect.Effect<PaymentAuthorisation, PaymentDeclinedError | PaymentProviderError>;
    startPayment: (
      input: StartPaymentInput
    ) => Effect.Effect<StartedPayment, PaymentDeclinedError | PaymentProviderError>;
    /** A fresh client secret for an unfinished intent — never a second intent. */
    resumePayment: (reference: string) => Effect.Effect<StartedPayment, PaymentProviderError>;
    getPayment: (reference: string) => Effect.Effect<ProviderPayment, PaymentProviderError>;
    /** Cancels an unfinished intent and returns its state afterwards. An
     * intent that already succeeded comes back as `succeeded`, untouched. */
    cancelPayment: (reference: string) => Effect.Effect<ProviderPayment, PaymentProviderError>;
    refund: (input: {
      reference: string;
      reason: string;
      /** Same key must resolve to the same refund, never a second one. */
      idempotencyKey: string;
    }) => Effect.Effect<PaymentRefund, PaymentProviderError>;
    /** The provider customer for a paying user, created when `existing` is null. */
    ensureCustomer: (input: {
      userId: string;
      email: string;
      name: string;
      existing: string | null;
    }) => Effect.Effect<string, PaymentProviderError>;
    startCardSetup: (customer: string) => Effect.Effect<CardSetup, PaymentProviderError>;
    getCardSetup: (reference: string) => Effect.Effect<ProviderCardSetup, PaymentProviderError>;
    /** Detaches a card from its customer. */
    removeCard: (cardReference: string) => Effect.Effect<void, PaymentProviderError>;
    verifyWebhook: (
      rawBody: string,
      signatureHeader: string | null
    ) => Effect.Effect<PaymentWebhookEvent, PaymentWebhookSignatureError>;
  }
>() {}

export const quoteFromPolicy = (
  lineItems: ReadonlyArray<QuoteLineItem>,
  policy: QuotePolicy
): Money => {
  const amountCents = lineItems.reduce((total, item) => total + item.costCents, 0);
  // An empty basket is quoted as nothing at all — charging the administration
  // fee on zero checks would bill somebody for ordering nothing.
  const feeCents = lineItems.length === 0 ? 0 : policy.adminFeeCents;
  const taxable = amountCents + feeCents;
  // Integer arithmetic throughout — a float here shows up as a cent that
  // doesn't reconcile.
  const taxCents = Math.round((taxable * policy.taxRateBasisPoints) / 10_000);

  return {
    amountCents,
    lineItems,
    feeCents,
    taxCents,
    totalCents: taxable + taxCents,
    currency: 'CAD'
  };
};
```

- [ ] **Step 5: Write the mock**

`packages/payments/src/mock.ts`:

```ts
import { Context, Effect, Layer } from 'effect';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentWebhookSignatureError,
  Payments,
  quoteFromPolicy,
  type CardDetails,
  type PaymentAuthorisation,
  type PaymentOperation,
  type PaymentRefund,
  type ProviderCardSetup,
  type ProviderPayment,
  type StartPaymentInput
} from './port';

/** The card every mock setup and mock payment "uses". */
export const mockCard = (reference: string): CardDetails => ({
  reference,
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2034
});

/**
 * Mock provider.
 *
 * Payments succeed the moment they start and card setups succeed immediately
 * with a fake Visa •••• 4242, so the whole flow runs without a provider.
 * `failStart` and `failRefund` exist so the decline and refund paths can be
 * exercised — those are exactly the paths that are painful to test once money
 * is real. `verifyWebhook` accepts nothing: the mock has no webhooks.
 */
export const makeMockPayments = (
  options: {
    failStart?: boolean;
    failRefund?: boolean;
    now?: () => Date;
  } = {}
): Context.Tag.Service<Payments> => {
  const now = options.now ?? (() => new Date());
  const started = new Map<string, { input: StartPaymentInput; reference: string }>();
  const byReference = new Map<string, ProviderPayment>();
  const refunds = new Map<string, PaymentRefund>();
  const setups = new Map<string, ProviderCardSetup>();
  const authorisations = new Map<string, PaymentAuthorisation>();

  const unknown = (operation: PaymentOperation, reference: string) =>
    Effect.fail(
      new PaymentProviderError({ operation, cause: `mock: unknown reference ${reference}` })
    );

  return {
    provider: 'mock',

    quote: (lineItems, policy) => Effect.succeed(quoteFromPolicy(lineItems, policy)),

    // Deprecated one-step path, kept only until Task 5 moves the order route
    // to startPayment.
    authorise: ({ idempotencyKey }) =>
      Effect.gen(function* () {
        if (options.failStart) {
          return yield* Effect.fail(new PaymentDeclinedError({ reason: 'mock decline' }));
        }
        const existing = authorisations.get(idempotencyKey);
        if (existing) {
          return existing;
        }
        const authorisation: PaymentAuthorisation = {
          reference: `mock_auth_${idempotencyKey}`,
          authorisedAt: now()
        };
        authorisations.set(idempotencyKey, authorisation);
        return authorisation;
      }),

    startPayment: (input) =>
      Effect.gen(function* () {
        if (options.failStart) {
          return yield* Effect.fail(new PaymentDeclinedError({ reason: 'mock decline' }));
        }
        // Idempotency is part of the contract, not an implementation detail —
        // the mock has to honour it or the retry path tests nothing.
        const existing = started.get(input.idempotencyKey);
        const reference = existing?.reference ?? `mock_pi_${input.idempotencyKey}`;
        if (!existing) {
          started.set(input.idempotencyKey, { input, reference });
          byReference.set(reference, {
            reference,
            status: 'succeeded',
            amountCents: input.quote.totalCents,
            currency: input.quote.currency.toLowerCase(),
            metadata: { ...input.metadata },
            customer: input.customer ?? null,
            savesCard: input.saveCard,
            failureReason: null,
            receiptUrl: null,
            refundedCents: 0,
            paymentMethod: mockCard(input.savedCard ?? `mock_pm_${input.idempotencyKey}`)
          });
        }
        return {
          reference,
          clientSecret: `mock_secret_${reference}`,
          status: 'succeeded' as const,
          paymentMethodReference: input.savedCard ?? null
        };
      }),

    resumePayment: (reference) => {
      const payment = byReference.get(reference);
      return payment
        ? Effect.succeed({
            reference,
            clientSecret: `mock_secret_${reference}`,
            status: payment.status,
            paymentMethodReference: payment.paymentMethod?.reference ?? null
          })
        : unknown('resumePayment', reference);
    },

    getPayment: (reference) => {
      const payment = byReference.get(reference);
      return payment ? Effect.succeed(payment) : unknown('getPayment', reference);
    },

    cancelPayment: (reference) => {
      const payment = byReference.get(reference);
      if (!payment) return unknown('cancelPayment', reference);
      if (payment.status === 'succeeded') return Effect.succeed(payment);
      const canceled = { ...payment, status: 'canceled' as const };
      byReference.set(reference, canceled);
      return Effect.succeed(canceled);
    },

    refund: ({ reference, idempotencyKey }) =>
      Effect.gen(function* () {
        if (options.failRefund) {
          return yield* Effect.fail(
            new PaymentProviderError({ operation: 'refund', cause: 'mock refund failure' })
          );
        }
        const existing = refunds.get(idempotencyKey);
        if (existing) {
          return existing;
        }
        const refund: PaymentRefund = {
          refundReference: `mock_refund_${reference}`,
          refundedAt: now()
        };
        refunds.set(idempotencyKey, refund);
        return refund;
      }),

    ensureCustomer: ({ userId, existing }) => Effect.succeed(existing ?? `mock_cus_${userId}`),

    startCardSetup: (customer) => {
      const reference = `mock_seti_${setups.size + 1}`;
      setups.set(reference, {
        reference,
        status: 'succeeded',
        customer,
        paymentMethod: mockCard(`mock_pm_${reference}`)
      });
      return Effect.succeed({ reference, clientSecret: `mock_secret_${reference}` });
    },

    getCardSetup: (reference) => {
      const setup = setups.get(reference);
      return setup ? Effect.succeed(setup) : unknown('getCardSetup', reference);
    },

    removeCard: () => Effect.void,

    verifyWebhook: () =>
      Effect.fail(new PaymentWebhookSignatureError({ reason: 'the mock provider has no webhooks' }))
  };
};

export const PaymentsMock = Layer.sync(Payments, () => makeMockPayments());

export const makePaymentsTest = (implementation: Partial<Context.Tag.Service<Payments>>) =>
  Layer.succeed(Payments, { ...makeMockPayments(), ...implementation });
```

Replace the whole of `packages/payments/src/index.ts` with:

```ts
// The port and the mock. The provider-selecting layer joins in Task 2; the
// Stripe adapter is reached only through it — nothing outside this package
// imports Stripe.
export * from './port';
export * from './mock';
```

- [ ] **Step 6: Run the tests and the API build**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/packages/payments && bun test src`
Expected: PASS (6 tests).

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bun run build`
Expected: exits 0 (the order route still compiles against the deprecated `authorise`).

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run src/routes/app/safety-verification && cd ../worker && bunx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add packages/payments
git commit -m "feat(payments): two-step payment port with cards and webhooks; mock implements it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stripe adapter, `PaymentsLive` and configuration

**Files:**
- Create: `packages/payments/src/stripe.ts`, `packages/payments/src/layer.ts`, `packages/payments/src/stripe.test.ts`, `packages/payments/src/layer.test.ts`
- Modify: `packages/payments/package.json` (deps), `packages/payments/src/index.ts`, `packages/env/src/index.ts` (append `stripeConfig`), `apps/api/src/managed-runtime.ts`, `apps/worker/src/index.ts` (swap `PaymentsMock` → `PaymentsLive`), `apps/api/.env.example`, `apps/web/.env.example`, `bun.lock`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces:
  - `@repo/env`: `stripeConfig` → `{ provider: 'mock' | 'stripe'; secretKey: Option<Redacted<string>>; webhookSecret: Option<Redacted<string>>; settleAfterMinutes: number; abandonAfterHours: number }` (env `PAYMENTS_PROVIDER` default `mock`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENTS_SETTLE_AFTER_MINUTES` default 10, `PAYMENTS_ABANDON_AFTER_HOURS` default 24)
  - `@repo/payments`: `PaymentsLive: Layer<Payments, ConfigError>`
  - Internal to the package (not re-exported): `STRIPE_API_VERSION = '2026-09-30.endive'`, `type StripeApi`, `makeStripeClient(secretKey)`, `makeStripePayments({ client: StripeApi; webhookSecret: string | null })`, `normaliseStatus(status, hasError)`, `normalisePaymentIntent`, `cardDetails`

SDK facts this task relies on (verified against `stripe@23.0.0`'s `.d.ts` and by running it under Bun): default export class `Stripe`; types as `Stripe.PaymentIntent`, `Stripe.PaymentMethod`; `new Stripe(key, { apiVersion: '2026-09-30.endive', maxNetworkRetries, appInfo })`; `paymentIntents.create(params, { idempotencyKey })` with **`allowed_payment_method_types`** (`payment_method_types` no longer exists), `capture_method`, `setup_future_usage: 'off_session'`, `payment_method`, `customer`, `metadata`; `paymentIntents.retrieve(id, { expand })`, `paymentIntents.cancel(id, { expand })`; `setupIntents.create({ customer, usage: 'off_session', allowed_payment_method_types: ['card'] })`; `setupIntents.retrieve(id, { expand: ['payment_method'] })`; `customers.create(params, { idempotencyKey })`; `paymentMethods.detach(id)`; `refunds.create({ payment_intent, reason: 'requested_by_customer', metadata }, { idempotencyKey })`; `webhooks.constructEventAsync(payload, header, secret)` and `Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, timestamp? })` (the sync variants throw under Bun); error classes `Stripe.errors.StripeCardError`, `StripeInvalidRequestError` (`code === 'payment_intent_unexpected_state'` when cancelling a finished intent), `StripeAPIError`.

- [ ] **Step 1: Install the SDK and declare the env dependency**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration/packages/payments && bun add stripe@^23.0.0
```

Then make `packages/payments/package.json`'s `dependencies` exactly:

```json
  "dependencies": {
    "@repo/env": "*",
    "effect": "^3.21.2",
    "stripe": "^23.0.0"
  }
```

and run `cd /run/media/hbt/work/poppynz/stripe-integration && bun install`.
Expected: `bun.lock` gains `stripe@23.0.0`; `grep '"version"' packages/payments/node_modules/stripe/package.json` prints `23.0.0` (or the root `node_modules` copy, depending on hoisting).

- [ ] **Step 2: Add the configuration**

Append to `packages/env/src/index.ts`:

```ts
// Stripe — card payments (piece 2a of the contract-billing design).
//
// PAYMENTS_PROVIDER picks the gateway for the API and the worker alike and
// defaults to `mock`, so a checkout without Stripe keys keeps working and
// never charges anything. With `stripe` the secret key is required and must
// be a TEST-mode key: live activation is a separate, deliberate step
// (docs/activating-stripe-connect.md). Both secrets are Redacted — read them
// with `Redacted.value` at the call site only.
//
// A payment left unconfirmed (tab closed mid-3-D Secure, webhook lost) is
// re-fetched by the worker after PAYMENTS_SETTLE_AFTER_MINUTES and cancelled
// after PAYMENTS_ABANDON_AFTER_HOURS, which returns its order to the basket.
export const stripeConfig = Config.all({
  provider: Config.literal('mock', 'stripe')('PAYMENTS_PROVIDER').pipe(
    Config.withDefault('mock' as const)
  ),
  secretKey: Config.option(Config.redacted('STRIPE_SECRET_KEY')),
  webhookSecret: Config.option(Config.redacted('STRIPE_WEBHOOK_SECRET')),
  settleAfterMinutes: Config.integer('PAYMENTS_SETTLE_AFTER_MINUTES').pipe(Config.withDefault(10)),
  abandonAfterHours: Config.integer('PAYMENTS_ABANDON_AFTER_HOURS').pipe(Config.withDefault(24))
});
```

- [ ] **Step 3: Write the failing adapter and layer tests**

`packages/payments/src/stripe.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import Stripe from 'stripe';
import { Effect, Exit } from 'effect';
import { quoteFromPolicy } from './port';
import { makeStripePayments, normaliseStatus, type StripeApi } from './stripe';

const WEBHOOK_SECRET = 'whsec_test_secret';

type Recorded = { method: string; params: [unknown, unknown] };

const intent = (overrides: Record<string, unknown> = {}) => ({
  id: 'pi_123',
  object: 'payment_intent',
  amount: 7500,
  currency: 'cad',
  status: 'requires_payment_method',
  client_secret: 'pi_123_secret_abc',
  last_payment_error: null,
  latest_charge: null,
  customer: null,
  payment_method: null,
  setup_future_usage: null,
  metadata: { payment_id: 'payment-1' },
  ...overrides
});

const card = {
  id: 'pm_card',
  object: 'payment_method',
  card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2034 }
};

/** A fake of the SDK slice the adapter uses. Every call is recorded; each
 * resource answers with what the test hands it. */
const fakeStripe = (
  answers: {
    create?: () => unknown;
    retrieve?: () => unknown;
    cancel?: () => unknown;
    setupCreate?: () => unknown;
    setupRetrieve?: () => unknown;
  } = {}
) => {
  const calls: Array<Recorded> = [];
  const record =
    (method: string, answer: () => unknown) => async (first?: unknown, second?: unknown) => {
      calls.push({ method, params: [first, second] });
      return answer() as never;
    };
  const client = {
    paymentIntents: {
      create: record('paymentIntents.create', answers.create ?? (() => intent())),
      retrieve: record('paymentIntents.retrieve', answers.retrieve ?? (() => intent())),
      cancel: record('paymentIntents.cancel', answers.cancel ?? (() => intent()))
    },
    setupIntents: {
      create: record(
        'setupIntents.create',
        answers.setupCreate ?? (() => ({ id: 'seti_1', client_secret: 'seti_1_secret' }))
      ),
      retrieve: record(
        'setupIntents.retrieve',
        answers.setupRetrieve ??
          (() => ({
            id: 'seti_1',
            status: 'succeeded',
            last_setup_error: null,
            customer: 'cus_1',
            payment_method: card
          }))
      )
    },
    customers: { create: record('customers.create', () => ({ id: 'cus_new' })) },
    paymentMethods: { detach: record('paymentMethods.detach', () => card) },
    refunds: { create: record('refunds.create', () => ({ id: 're_1', created: 1_790_000_000 })) },
    // The real verifier: signatures are what this suite is about.
    webhooks: Stripe.webhooks
  } as unknown as StripeApi;
  return { client, calls };
};

const quote = quoteFromPolicy([{ label: 'Check', costCents: 7000 }], {
  adminFeeCents: 500,
  taxRateBasisPoints: 0
});

describe('normaliseStatus', () => {
  it('folds Stripe intent statuses into the port statuses', () => {
    expect(normaliseStatus('succeeded', false)).toBe('succeeded');
    expect(normaliseStatus('processing', false)).toBe('processing');
    expect(normaliseStatus('canceled', false)).toBe('canceled');
    expect(normaliseStatus('requires_action', false)).toBe('requires_action');
    expect(normaliseStatus('requires_confirmation', false)).toBe('requires_action');
    // Waiting for a card vs. a declined attempt.
    expect(normaliseStatus('requires_payment_method', false)).toBe('requires_action');
    expect(normaliseStatus('requires_payment_method', true)).toBe('failed');
  });
});

describe('startPayment', () => {
  it('creates a card-only, automatically captured intent keyed on the caller key', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });

    const result = await Effect.runPromise(
      payments.startPayment({
        quote,
        idempotencyKey: 'payment-1',
        metadata: { payment_id: 'payment-1' },
        saveCard: false
      })
    );

    expect(result).toEqual({
      reference: 'pi_123',
      clientSecret: 'pi_123_secret_abc',
      status: 'requires_action',
      paymentMethodReference: null
    });
    const [params, options] = calls[0]!.params as [Record<string, unknown>, unknown];
    expect(params).toEqual({
      amount: 7500,
      currency: 'cad',
      allowed_payment_method_types: ['card'],
      capture_method: 'automatic',
      metadata: { payment_id: 'payment-1' }
    });
    expect(options).toEqual({ idempotencyKey: 'payment-payment-1' });
  });

  it('asks Stripe to keep a family card for off-session use', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    await Effect.runPromise(
      payments.startPayment({
        quote,
        idempotencyKey: 'payment-1',
        metadata: { payment_id: 'payment-1' },
        customer: 'cus_1',
        saveCard: true
      })
    );
    const params = calls[0]!.params[0] as Record<string, unknown>;
    expect(params).toMatchObject({ customer: 'cus_1', setup_future_usage: 'off_session' });
    expect(params).not.toHaveProperty('payment_method');
  });

  it('pre-attaches a saved card for one-click payment and does not save again', async () => {
    const { client, calls } = fakeStripe({
      create: () => intent({ payment_method: 'pm_saved', status: 'requires_confirmation' })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(
      payments.startPayment({
        quote,
        idempotencyKey: 'payment-1',
        metadata: { payment_id: 'payment-1' },
        customer: 'cus_1',
        savedCard: 'pm_saved',
        saveCard: false
      })
    );
    const params = calls[0]!.params[0] as Record<string, unknown>;
    expect(params).toMatchObject({ customer: 'cus_1', payment_method: 'pm_saved' });
    expect(params).not.toHaveProperty('setup_future_usage');
    expect(result.paymentMethodReference).toBe('pm_saved');
  });

  it('turns a card error into a decline and anything else into a provider error', async () => {
    const declined = makeStripePayments({
      client: fakeStripe({
        create: () => {
          throw new Stripe.errors.StripeCardError({ message: 'Your card was declined.' });
        }
      }).client,
      webhookSecret: WEBHOOK_SECRET
    });
    const input = {
      quote,
      idempotencyKey: 'payment-1',
      metadata: { payment_id: 'payment-1' },
      saveCard: false
    };
    const declinedExit = await Effect.runPromiseExit(declined.startPayment(input));
    expect(declinedExit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'PaymentDeclinedError' }) as never)
    );

    const broken = makeStripePayments({
      client: fakeStripe({
        create: () => {
          throw new Stripe.errors.StripeAPIError({ message: 'boom' });
        }
      }).client,
      webhookSecret: WEBHOOK_SECRET
    });
    const brokenExit = await Effect.runPromiseExit(broken.startPayment(input));
    expect(brokenExit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'PaymentProviderError',
          operation: 'startPayment'
        }) as never
      )
    );
  });
});

describe('getPayment', () => {
  it('normalises the re-fetched intent with its charge and card', async () => {
    const { client, calls } = fakeStripe({
      retrieve: () =>
        intent({
          status: 'succeeded',
          customer: 'cus_1',
          setup_future_usage: 'off_session',
          payment_method: card,
          latest_charge: {
            id: 'ch_1',
            receipt_url: 'https://pay.stripe.com/receipts/r1',
            amount_refunded: 0
          }
        })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });

    const result = await Effect.runPromise(payments.getPayment('pi_123'));

    expect(result).toEqual({
      reference: 'pi_123',
      status: 'succeeded',
      amountCents: 7500,
      currency: 'cad',
      metadata: { payment_id: 'payment-1' },
      customer: 'cus_1',
      savesCard: true,
      failureReason: null,
      receiptUrl: 'https://pay.stripe.com/receipts/r1',
      refundedCents: 0,
      paymentMethod: {
        reference: 'pm_card',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2034
      }
    });
    expect(calls[0]!.params).toEqual(['pi_123', { expand: ['latest_charge', 'payment_method'] }]);
  });

  it('reports a declined attempt as failed with Stripe’s message', async () => {
    const { client } = fakeStripe({
      retrieve: () =>
        intent({ last_payment_error: { message: 'Your card has insufficient funds.' } })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(payments.getPayment('pi_123'));
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('Your card has insufficient funds.');
  });
});

describe('cancelPayment', () => {
  it('returns the intent as it is when Stripe refuses because it already succeeded', async () => {
    const { client } = fakeStripe({
      cancel: () => {
        throw new Stripe.errors.StripeInvalidRequestError({
          message: 'cannot cancel',
          code: 'payment_intent_unexpected_state'
        });
      },
      retrieve: () => intent({ status: 'succeeded' })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(payments.cancelPayment('pi_123'));
    expect(result.status).toBe('succeeded');
  });
});

describe('customers, cards and refunds', () => {
  it('creates a customer once per user and reuses an existing one', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const created = await Effect.runPromise(
      payments.ensureCustomer({ userId: 'u1', email: 'a@b.c', name: 'A', existing: null })
    );
    const reused = await Effect.runPromise(
      payments.ensureCustomer({ userId: 'u1', email: 'a@b.c', name: 'A', existing: 'cus_old' })
    );
    expect(created).toBe('cus_new');
    expect(reused).toBe('cus_old');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([
      { email: 'a@b.c', name: 'A', metadata: { user_id: 'u1' } },
      { idempotencyKey: 'customer-u1' }
    ]);
  });

  it('starts an off-session card-only setup and reads its card back', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const setup = await Effect.runPromise(payments.startCardSetup('cus_1'));
    const fetched = await Effect.runPromise(payments.getCardSetup('seti_1'));
    expect(setup).toEqual({ reference: 'seti_1', clientSecret: 'seti_1_secret' });
    expect(calls[0]!.params).toEqual([
      { customer: 'cus_1', usage: 'off_session', allowed_payment_method_types: ['card'] },
      undefined
    ]);
    expect(fetched).toMatchObject({ status: 'succeeded', customer: 'cus_1' });
    expect(fetched.paymentMethod?.last4).toBe('4242');
  });

  it('refunds against the intent under the caller key', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const refund = await Effect.runPromise(
      payments.refund({ reference: 'pi_123', reason: 'order failed', idempotencyKey: 'payment-1' })
    );
    expect(refund.refundReference).toBe('re_1');
    expect(calls[0]!.params).toEqual([
      {
        payment_intent: 'pi_123',
        reason: 'requested_by_customer',
        metadata: { reason: 'order failed' }
      },
      { idempotencyKey: 'refund-payment-1' }
    ]);
  });
});

describe('verifyWebhook', () => {
  const payload = JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type: 'charge.refunded',
    data: { object: { id: 'ch_1', object: 'charge', payment_intent: 'pi_123' } }
  });
  const sign = (options: { secret?: string; timestamp?: number } = {}) =>
    Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: options.secret ?? WEBHOOK_SECRET,
      ...(options.timestamp ? { timestamp: options.timestamp } : {})
    });
  const payments = makeStripePayments({
    client: fakeStripe().client,
    webhookSecret: WEBHOOK_SECRET
  });

  it('accepts a correctly signed delivery and reduces it to routing ids', async () => {
    const event = await Effect.runPromise(payments.verifyWebhook(payload, await sign()));
    expect(event).toEqual({
      eventId: 'evt_1',
      type: 'charge.refunded',
      objectId: 'ch_1',
      paymentReference: 'pi_123',
      account: null
    });
  });

  it('refuses a tampered body', async () => {
    const header = await sign();
    const exit = await Effect.runPromiseExit(
      payments.verifyWebhook(payload.replace('pi_123', 'pi_999'), header)
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses a signature made with another secret', async () => {
    const exit = await Effect.runPromiseExit(
      payments.verifyWebhook(payload, await sign({ secret: 'whsec_other' }))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses a stale timestamp', async () => {
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const exit = await Effect.runPromiseExit(
      payments.verifyWebhook(payload, await sign({ timestamp: anHourAgo }))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses everything when no webhook secret is configured', async () => {
    const unconfigured = makeStripePayments({ client: fakeStripe().client, webhookSecret: null });
    const exit = await Effect.runPromiseExit(unconfigured.verifyWebhook(payload, await sign()));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
```

`packages/payments/src/layer.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Effect, Exit, Layer } from 'effect';
import { PaymentsLive } from './layer';
import { Payments } from './port';

const providerUnder = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    Payments.pipe(
      Effect.map((payments) => payments.provider),
      Effect.provide(
        PaymentsLive.pipe(
          Layer.provide(
            Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env))))
          )
        )
      )
    )
  );

describe('PaymentsLive', () => {
  it('defaults to the mock', async () => {
    expect(await providerUnder({})).toEqual(Exit.succeed('mock'));
  });

  it('builds the Stripe adapter from a test-mode key', async () => {
    const exit = await providerUnder({
      PAYMENTS_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123'
    });
    expect(exit).toEqual(Exit.succeed('stripe'));
  });

  it('refuses to boot Stripe without a secret key', async () => {
    expect(Exit.isFailure(await providerUnder({ PAYMENTS_PROVIDER: 'stripe' }))).toBe(true);
  });

  it('refuses a live key — this piece is test mode only', async () => {
    const exit = await providerUnder({
      PAYMENTS_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_live_123'
    });
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses an unknown provider name', async () => {
    expect(Exit.isFailure(await providerUnder({ PAYMENTS_PROVIDER: 'paypal' }))).toBe(true);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/packages/payments && bun test src`
Expected: FAIL — `Cannot find module './stripe'` / `'./layer'`.

- [ ] **Step 5: Write the adapter**

`packages/payments/src/stripe.ts`:

```ts
import Stripe from 'stripe';
import { Context, Effect } from 'effect';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentWebhookSignatureError,
  quoteFromPolicy,
  type CardDetails,
  type PaymentOperation,
  type Payments,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type StartedPayment
} from './port';

/**
 * Stripe adapter for the `Payments` port. The ONLY file in the monorepo that
 * imports `stripe`.
 *
 * Cards only, automatic capture, test mode only (the layer refuses a live
 * key). The client is injected so tests run against a fake.
 */

/** The API version this adapter was written against — the one pinned by the
 * installed SDK (stripe@23.0.0). Bumping the SDK means re-reading this file. */
export const STRIPE_API_VERSION = '2026-09-30.endive' as const;

/** The slice of the SDK this adapter uses. Narrow on purpose: a test fake only
 * has to implement these methods. */
export type StripeApi = {
  paymentIntents: Pick<Stripe['paymentIntents'], 'create' | 'retrieve' | 'cancel'>;
  setupIntents: Pick<Stripe['setupIntents'], 'create' | 'retrieve'>;
  customers: Pick<Stripe['customers'], 'create'>;
  paymentMethods: Pick<Stripe['paymentMethods'], 'detach'>;
  refunds: Pick<Stripe['refunds'], 'create'>;
  webhooks: Pick<Stripe['webhooks'], 'constructEventAsync'>;
};

export const makeStripeClient = (secretKey: string): StripeApi =>
  new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    appInfo: { name: 'poppynz' }
  });

const providerError = (operation: PaymentOperation) => (cause: unknown) =>
  new PaymentProviderError({ operation, cause });

const call = <A>(operation: PaymentOperation, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: providerError(operation) });

/** Stripe's seven intent statuses, folded into the port's five. A
 * `requires_payment_method` intent with an error on it is a declined attempt;
 * without one it is simply waiting for a card. */
export const normaliseStatus = (status: string, hasError: boolean): ProviderPaymentStatus => {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
      return 'processing';
    case 'canceled':
      return 'canceled';
    case 'requires_payment_method':
      return hasError ? 'failed' : 'requires_action';
    default:
      // requires_action, requires_confirmation, requires_capture (never used —
      // capture is automatic) and anything Stripe adds later.
      return 'requires_action';
  }
};

const idOf = (value: string | { id: string } | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : value.id;

export const cardDetails = (method: string | Stripe.PaymentMethod | null): CardDetails | null => {
  if (method === null || typeof method === 'string' || !method.card) return null;
  return {
    reference: method.id,
    brand: method.card.brand,
    last4: method.card.last4,
    expMonth: method.card.exp_month,
    expYear: method.card.exp_year
  };
};

export const normalisePaymentIntent = (intent: Stripe.PaymentIntent): ProviderPayment => {
  const charge =
    intent.latest_charge !== null && typeof intent.latest_charge !== 'string'
      ? intent.latest_charge
      : null;
  return {
    reference: intent.id,
    status: normaliseStatus(intent.status, intent.last_payment_error !== null),
    amountCents: intent.amount,
    currency: intent.currency,
    metadata: { ...intent.metadata },
    customer: idOf(intent.customer),
    savesCard: intent.setup_future_usage === 'off_session',
    failureReason: intent.last_payment_error?.message ?? null,
    receiptUrl: charge?.receipt_url ?? null,
    refundedCents: charge?.amount_refunded ?? 0,
    paymentMethod: cardDetails(intent.payment_method)
  };
};

const started =
  (operation: PaymentOperation) =>
  (intent: Stripe.PaymentIntent): Effect.Effect<StartedPayment, PaymentProviderError> =>
    intent.client_secret
      ? Effect.succeed({
          reference: intent.id,
          clientSecret: intent.client_secret,
          status: normaliseStatus(intent.status, intent.last_payment_error !== null),
          paymentMethodReference: idOf(intent.payment_method)
        })
      : Effect.fail(
          new PaymentProviderError({
            operation,
            cause: `PaymentIntent ${intent.id} has no client secret`
          })
        );

/** Fields the settle path needs in one round trip. */
const PAYMENT_EXPAND = ['latest_charge', 'payment_method'];

/** Stripe refuses to cancel an intent that already succeeded. */
const isUnexpectedState = (cause: unknown) =>
  cause instanceof Stripe.errors.StripeInvalidRequestError &&
  cause.code === 'payment_intent_unexpected_state';

/** Webhook payloads are routed by id only; this is the shape we read. */
type RoutedObject = { id?: unknown; payment_intent?: unknown };

export const makeStripePayments = (options: {
  client: StripeApi;
  /** Null when STRIPE_WEBHOOK_SECRET is unset: every delivery is then refused. */
  webhookSecret: string | null;
}): Context.Tag.Service<Payments> => {
  const { client, webhookSecret } = options;

  const retrieve = (operation: PaymentOperation, reference: string) =>
    call(operation, () =>
      client.paymentIntents.retrieve(reference, { expand: PAYMENT_EXPAND })
    ).pipe(Effect.map(normalisePaymentIntent));

  return {
    provider: 'stripe',

    quote: (lineItems, policy) => Effect.succeed(quoteFromPolicy(lineItems, policy)),

    // Deprecated one-step path: Stripe only supports the two-step flow.
    // Removed in Task 5 with the port method.
    authorise: () =>
      Effect.fail(new PaymentDeclinedError({ reason: 'Stripe payments start with startPayment' })),

    startPayment: (input) =>
      call('startPayment', () =>
        client.paymentIntents.create(
          {
            amount: input.quote.totalCents,
            currency: input.quote.currency.toLowerCase(),
            // Cards only: no redirect-based methods, so 3-D Secure is the
            // only extra step and it happens in the modal.
            allowed_payment_method_types: ['card'],
            capture_method: 'automatic',
            metadata: input.metadata,
            ...(input.customer ? { customer: input.customer } : {}),
            ...(input.savedCard ? { payment_method: input.savedCard } : {}),
            ...(input.saveCard ? { setup_future_usage: 'off_session' as const } : {})
          },
          { idempotencyKey: `payment-${input.idempotencyKey}` }
        )
      ).pipe(
        // A saved card can be declined at creation; anything else is the
        // provider's problem, not the card's.
        Effect.mapError((error) =>
          error.cause instanceof Stripe.errors.StripeCardError
            ? new PaymentDeclinedError({ reason: error.cause.message })
            : error
        ),
        Effect.flatMap(started('startPayment'))
      ),

    resumePayment: (reference) =>
      call('resumePayment', () => client.paymentIntents.retrieve(reference)).pipe(
        Effect.flatMap(started('resumePayment'))
      ),

    getPayment: (reference) => retrieve('getPayment', reference),

    cancelPayment: (reference) =>
      call('cancelPayment', () =>
        client.paymentIntents.cancel(reference, { expand: PAYMENT_EXPAND })
      ).pipe(
        Effect.map(normalisePaymentIntent),
        // Already finished (succeeded or canceled): report what it is now.
        Effect.catchIf(
          (error) => isUnexpectedState(error.cause),
          () => retrieve('cancelPayment', reference)
        )
      ),

    refund: ({ reference, reason, idempotencyKey }) =>
      call('refund', () =>
        client.refunds.create(
          {
            payment_intent: reference,
            reason: 'requested_by_customer',
            metadata: { reason: reason.slice(0, 500) }
          },
          { idempotencyKey: `refund-${idempotencyKey}` }
        )
      ).pipe(
        Effect.map((refund) => ({
          refundReference: refund.id,
          refundedAt: new Date(refund.created * 1000)
        }))
      ),

    ensureCustomer: ({ userId, email, name, existing }) =>
      existing !== null
        ? Effect.succeed(existing)
        : call('ensureCustomer', () =>
            client.customers.create(
              { email, name, metadata: { user_id: userId } },
              // One customer per user even if two requests race here.
              { idempotencyKey: `customer-${userId}` }
            )
          ).pipe(Effect.map((customer) => customer.id)),

    startCardSetup: (customer) =>
      call('startCardSetup', () =>
        client.setupIntents.create({
          customer,
          usage: 'off_session',
          allowed_payment_method_types: ['card']
        })
      ).pipe(
        Effect.flatMap((intent) =>
          intent.client_secret
            ? Effect.succeed({ reference: intent.id, clientSecret: intent.client_secret })
            : Effect.fail(
                new PaymentProviderError({
                  operation: 'startCardSetup',
                  cause: `SetupIntent ${intent.id} has no client secret`
                })
              )
        )
      ),

    getCardSetup: (reference) =>
      call('getCardSetup', () =>
        client.setupIntents.retrieve(reference, { expand: ['payment_method'] })
      ).pipe(
        Effect.map((intent) => ({
          reference: intent.id,
          status: normaliseStatus(intent.status, intent.last_setup_error !== null),
          customer: idOf(intent.customer),
          paymentMethod: cardDetails(intent.payment_method)
        }))
      ),

    removeCard: (cardReference) =>
      call('removeCard', () => client.paymentMethods.detach(cardReference)).pipe(Effect.asVoid),

    verifyWebhook: (rawBody, signatureHeader) =>
      Effect.gen(function* () {
        if (webhookSecret === null) {
          return yield* Effect.fail(
            new PaymentWebhookSignatureError({ reason: 'STRIPE_WEBHOOK_SECRET is not set' })
          );
        }
        if (!signatureHeader) {
          return yield* Effect.fail(
            new PaymentWebhookSignatureError({ reason: 'missing Stripe-Signature header' })
          );
        }
        // The async variant: under Bun the SDK resolves to its web build, whose
        // SubtleCrypto provider cannot verify synchronously.
        const event = yield* Effect.tryPromise({
          try: () => client.webhooks.constructEventAsync(rawBody, signatureHeader, webhookSecret),
          catch: (cause) =>
            new PaymentWebhookSignatureError({
              reason: cause instanceof Error ? cause.message : 'invalid signature'
            })
        });
        const object = event.data.object as RoutedObject;
        return {
          eventId: event.id,
          type: event.type,
          objectId: typeof object.id === 'string' ? object.id : '',
          paymentReference:
            typeof object.payment_intent === 'string' ? object.payment_intent : null,
          account: event.account ?? null
        };
      })
  };
};
```

- [ ] **Step 6: Write the layer and export it**

`packages/payments/src/layer.ts`:

```ts
import { stripeConfig } from '@repo/env';
import { ConfigError, Effect, Layer, Option, Redacted } from 'effect';
import { makeMockPayments } from './mock';
import { Payments } from './port';
import { makeStripeClient, makeStripePayments } from './stripe';

const secretValue = (value: Option.Option<Redacted.Redacted<string>>) =>
  Option.match(value, {
    onNone: () => null,
    onSome: (secret) => {
      const raw = Redacted.value(secret).trim();
      return raw.length > 0 ? raw : null;
    }
  });

/**
 * The `Payments` layer both the API and the worker build, chosen by
 * PAYMENTS_PROVIDER (default `mock`). With `stripe`, a missing or live secret
 * key fails the layer — and so the process — at boot: this piece is test mode
 * only, and a misconfigured deploy must not limp along on the mock.
 */
export const PaymentsLive = Layer.effect(
  Payments,
  Effect.gen(function* () {
    const config = yield* stripeConfig;
    if (config.provider === 'mock') {
      return makeMockPayments();
    }
    const secretKey = secretValue(config.secretKey);
    if (secretKey === null) {
      return yield* Effect.fail(
        ConfigError.MissingData(
          ['STRIPE_SECRET_KEY'],
          'PAYMENTS_PROVIDER=stripe needs STRIPE_SECRET_KEY'
        )
      );
    }
    if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('rk_test_')) {
      return yield* Effect.fail(
        ConfigError.InvalidData(['STRIPE_SECRET_KEY'], 'Only Stripe test-mode keys are accepted')
      );
    }
    const webhookSecret = secretValue(config.webhookSecret);
    if (webhookSecret === null) {
      console.warn(
        '[payments] STRIPE_WEBHOOK_SECRET is not set — every Stripe webhook will be refused'
      );
    }
    return makeStripePayments({ client: makeStripeClient(secretKey), webhookSecret });
  })
);
```

Replace `packages/payments/src/index.ts` with:

```ts
// The port, the mock and the provider-selecting layer. The Stripe adapter
// (./stripe) is reached only through PaymentsLive — nothing outside this
// package imports Stripe.
export * from './port';
export * from './mock';
export * from './layer';
```

- [ ] **Step 7: Run the package tests**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/packages/payments && bun test src`
Expected: PASS (27 tests across 3 files), including the four signature cases (valid, tampered, wrong secret, stale timestamp).

- [ ] **Step 8: Wire `PaymentsLive` into the API and the worker**

In `apps/api/src/managed-runtime.ts` replace `import { PaymentsMock } from '@repo/payments';` with `import { PaymentsLive } from '@repo/payments';`, and replace

```ts
  // Stripe lands in its own PR; until then the port resolves to the mock so
  // the ordering, refund and retry paths are exercised end to end.
  PaymentsMock,
```

with

```ts
  // PAYMENTS_PROVIDER picks the gateway (default `mock`); with `stripe` a
  // missing or live secret key fails the boot rather than charging nothing.
  PaymentsLive,
```

In `apps/worker/src/index.ts` replace `import { PaymentsMock } from '@repo/payments';` with `import { PaymentsLive } from '@repo/payments';`, and replace

```ts
  // Stripe lands in its own PR; the mock keeps the refund and retry paths
  // exercised until then.
  PaymentsMock,
```

with

```ts
  // Same PAYMENTS_PROVIDER switch as the API (default `mock`).
  PaymentsLive,
```

- [ ] **Step 9: Document the variables**

`apps/api/.env.example` already ends with the user's uncommitted lines `# stripe` / `STRIPE_SECRET_KEY=xxxx…`. Replace those two lines with:

```dotenv
# Stripe — test mode only (live keys are refused at boot). PAYMENTS_PROVIDER is
# mock (default; nothing is charged) or stripe. STRIPE_WEBHOOK_SECRET comes from
# `stripe listen --print-secret` locally, or the dashboard endpoint elsewhere.
PAYMENTS_PROVIDER=mock
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
# A payment left unconfirmed is re-checked after this many minutes, and
# cancelled (its order back to the basket) after this many hours.
PAYMENTS_SETTLE_AFTER_MINUTES=10
PAYMENTS_ABANDON_AFTER_HOURS=24
```

Replace the single line in `apps/web/.env.example` with:

```dotenv
# Stripe.js publishable key (test mode: pk_test_…). Used only by the payment modal.
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 10: Build and test the callers**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bun run build && bunx vitest run src/routes/app/safety-verification && cd ../worker && bunx vitest run`
Expected: build exits 0; tests PASS.

- [ ] **Step 11: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add packages/payments packages/env/src/index.ts apps/api/src/managed-runtime.ts apps/worker/src/index.ts apps/api/.env.example apps/web/.env.example bun.lock
git commit -m "feat(payments): Stripe adapter behind PAYMENTS_PROVIDER (test mode only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration `0025_stripe_payments`, schema and repositories

**Files:**
- Create: `packages/db/src/migrations/0025_stripe_payments.sql`, `packages/db/src/repos/billing-customer-repo.ts`, `packages/db/src/repos/stripe-webhook-event-repo.ts`
- Modify: `packages/db/src/migrations/meta/_journal.json`, `packages/db/src/schema.ts`, `packages/db/src/repos/payment-repo.ts` (rewrite), `packages/db/src/repos/check-order-repo.ts`, `packages/db/src/index.ts`, `apps/api/src/managed-runtime.ts`, `apps/api/src/app-env.ts`

**Interfaces:**
- Produces (from `@repo/db`):
  - tables `billingCustomer`, `stripeWebhookEvent`; `Payment` gains `receiptUrl: string | null`
  - `type BillingCustomer`, `type BillingCard = { reference; brand; last4; expMonth; expYear }`
  - `BillingCustomerRepo`: `findByUserId(userId) → BillingCustomer | null`, `findByCustomerReference(provider, customerReference) → BillingCustomer | null`, `upsertCustomer({ userId, provider, customerReference }) → BillingCustomer` (same-provider row kept; other-provider row replaced and its card cleared), `setCard(userId, BillingCard) → BillingCustomer | null`, `clearCard(userId) → BillingCustomer | null` — all `SqlError`
  - `BillingCustomerRepoDefault`, `makeInMemoryBillingCustomerRepo(rows?) → { layer; rows: Map<userId, BillingCustomer> }`, `dummyBillingCustomer(overrides?)` (family-1, provider `mock`, customer `mock_cus_family-1`, card `mock_pm_saved` Visa 4242 12/2034)
  - `PaymentRepo` adds `findByProviderReference(provider, reference) → Payment | null`, `listByUser(userId) → Array<PaymentHistoryItem>` (`Payment & { description }`, newest first, only rows with a provider reference), `listStalePending(provider, createdBefore) → Array<Payment>`, `advance(id, { from: PaymentStatus | PaymentStatus[]; set }) → Payment | null`; `type PaymentAdvanceInput`, `type PaymentHistoryItem`, `paymentKindDescriptions`; `makePaymentRepoTest(partial)` (missing methods behave like an empty table)
  - `CheckOrderRepo.findByPaymentId(paymentId) → CheckOrder | null`; `makeCheckOrderRepoTest(partial)`
  - `StripeWebhookEventRepo`: `record({ eventId, type, objectId }) → 'new' | 'unprocessed' | 'processed'`, `markProcessed(eventId)`, `markFailed(eventId, error)`; `StripeWebhookEventRepoDefault`, `makeStripeWebhookEventRepoTest(partial)`, `type StripeWebhookRecordResult`
  - `AppServices` gains `BillingCustomerRepo | StripeWebhookEventRepo`

This package has no unit-test runner; the repos are verified against a real Postgres (Step 7) and exercised through fakes by every later task.

- [ ] **Step 1: Write the migration**

`packages/db/src/migrations/0025_stripe_payments.sql`:

```sql
-- Stripe card payments (piece 2a of the contract-billing design).
--
-- billing_customers: a paying user's customer at the gateway and the one card
--   kept on file (families only). Card columns are display copies — the card
--   itself never leaves the gateway.
-- payments.receipt_url: the gateway's receipt page for a captured charge,
--   shown in the family's payment history.
-- stripe_webhook_events: one row per accepted delivery, for de-duplication
--   (Stripe delivers at least once) and audit. The payload is not stored;
--   handlers re-fetch from Stripe.
--
-- Every new foreign key is `restrict`.

CREATE TABLE "app_db"."billing_customers" (
  "user_id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "customer_reference" text NOT NULL,
  "card_reference" text,
  "card_brand" text,
  "card_last4" text,
  "card_exp_month" integer,
  "card_exp_year" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."billing_customers"
  ADD CONSTRAINT "billing_customers_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_provider_customer_uidx"
  ON "app_db"."billing_customers" ("provider", "customer_reference");--> statement-breakpoint

ALTER TABLE "app_db"."payments" ADD COLUMN "receipt_url" text;--> statement-breakpoint
-- The recovery job's scan: charges still waiting on the provider.
CREATE INDEX "payments_pending_created_at_idx"
  ON "app_db"."payments" ("created_at")
  WHERE "status" = 'pending' AND "provider_reference" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "app_db"."stripe_webhook_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "object_id" text NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "processed_at" timestamp,
  "error" text
);--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_received_at_idx"
  ON "app_db"."stripe_webhook_events" ("received_at");
```

In `packages/db/src/migrations/meta/_journal.json` (one line), append after the `0024_contract_dates` entry, inside `entries`:

```json
, {"idx": 25, "version": "7", "when": 1788160000000, "tag": "0025_stripe_payments", "breakpoints": true}
```

- [ ] **Step 2: Update the Drizzle schema**

In `packages/db/src/schema.ts`:

Replace the comment above `export const paymentStatus` (the three lines beginning `// \`captured\` has no writer yet`) with:

```ts
// `captured` is what the settle path writes once the provider confirms the
// money (automatic capture). `authorised` remains for rows the pre-Stripe
// mock wrote and for a later hold-then-capture flow (contract billing).
```

In the `payment` table, after `refundedAt: timestamp('refunded_at'),` add:

```ts
    // The provider's receipt page for a captured charge (Stripe hosts it).
    // Shown in the family's payment history; null for mock payments.
    receiptUrl: text('receipt_url'),
```

Replace the `payment` table's extras array tail

```ts
    index('payments_user_id_idx').on(table.userId),
    index('payments_status_idx').on(table.status)
  ]
);
```

with (this also adds the two new tables right after `payment`):

```ts
    index('payments_user_id_idx').on(table.userId),
    index('payments_status_idx').on(table.status),
    // The recovery job's scan: charges still waiting on the provider.
    index('payments_pending_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending' and ${table.providerReference} is not null`)
  ]
);

// A paying user's customer at the payment gateway, and the one card kept on
// file for them (families only today — helpers pay one-off). The card columns
// are display copies; the card itself lives with the gateway. `restrict`, so
// a user with a gateway customer cannot be deleted from under it.
export const billingCustomer = appDb.table(
  'billing_customers',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    customerReference: text('customer_reference').notNull(),
    cardReference: text('card_reference'),
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    cardExpMonth: integer('card_exp_month'),
    cardExpYear: integer('card_exp_year'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    // How a webhook's customer finds its user.
    uniqueIndex('billing_customers_provider_customer_uidx').on(
      table.provider,
      table.customerReference
    )
  ]
);

// Every Stripe webhook delivery we accepted, by event id: de-duplication
// (Stripe delivers at least once) and an audit trail. The payload is NOT
// stored — handlers re-fetch the object from Stripe and act on that.
export const stripeWebhookEvent = appDb.table(
  'stripe_webhook_events',
  {
    eventId: text('event_id').primaryKey(),
    type: text('type').notNull(),
    objectId: text('object_id').notNull(),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
    error: text('error')
  },
  (table) => [index('stripe_webhook_events_received_at_idx').on(table.receivedAt)]
);
```

After the existing `paymentRelations` block add:

```ts
export const billingCustomerRelations = relations(billingCustomer, ({ one }) => ({
  user: one(user, {
    fields: [billingCustomer.userId],
    references: [user.id]
  })
}));
```

- [ ] **Step 3: Rewrite the payment repository**

Replace `packages/db/src/repos/payment-repo.ts` with:

```ts
import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { payment } from '../schema';

export type Payment = InferSelectModel<typeof payment>;
export type PaymentInsert = InferInsertModel<typeof payment>;
export type PaymentStatus = Payment['status'];
export type PaymentKind = Payment['kind'];

/** A row is created `pending`, before the provider is asked for money, so the
 * breakdown and the purpose are the only things the caller decides. */
export type PaymentCreateInput = Pick<
  PaymentInsert,
  'userId' | 'kind' | 'provider' | 'amountCents' | 'feeCents' | 'taxCents' | 'totalCents'
> &
  Partial<Pick<PaymentInsert, 'currency'>>;

export type PaymentUpdateInput = Partial<
  Omit<Payment, 'id' | 'userId' | 'kind' | 'createdAt' | 'updatedAt'>
>;

/** A guarded transition: `set` lands only if the row is still in one of the
 * `from` statuses. Null means it had already moved — the caller lost a race
 * and must not assume its write happened. */
export type PaymentAdvanceInput = {
  from: PaymentStatus | ReadonlyArray<PaymentStatus>;
  set: PaymentUpdateInput;
};

/** A row of the payer's history, with what it was for. */
export type PaymentHistoryItem = Payment & { description: string };

/** Statuses under which the money is ours to spend or to give back. */
export const settledPaymentStatuses: Array<PaymentStatus> = ['authorised', 'captured'];

export const isSettledPayment = (record: Pick<Payment, 'status'> | null): boolean =>
  record !== null && settledPaymentStatuses.includes(record.status);

/** What each kind of charge is called in the payer's history. */
export const paymentKindDescriptions: Record<PaymentKind, string> = {
  credibled_order: 'Background check'
};

export class PaymentRepo extends Context.Tag('@repo/db/PaymentRepo')<
  PaymentRepo,
  {
    findById: (id: string) => Effect.Effect<Payment, SqlError | DBNotFoundError>;
    /** How an inbound provider event finds its row. */
    findByProviderReference: (
      provider: string,
      reference: string
    ) => Effect.Effect<Payment | null, SqlError>;
    /** The payer's history, newest first. Rows that never reached the
     * provider (a lost claim race) are not history and are left out. */
    listByUser: (userId: string) => Effect.Effect<Array<PaymentHistoryItem>, SqlError>;
    /** Charges still waiting on `provider` that were started before
     * `createdBefore` — the recovery job's work list. */
    listStalePending: (
      provider: string,
      createdBefore: Date
    ) => Effect.Effect<Array<Payment>, SqlError>;
    create: (input: PaymentCreateInput) => Effect.Effect<Payment, SqlError>;
    /** For fields that carry no state (references, error notes). Status
     * changes that race something else go through `advance`. */
    update: (
      id: string,
      input: PaymentUpdateInput
    ) => Effect.Effect<Payment, SqlError | DBNotFoundError>;
    /** Compare-and-set on status: the browser, the webhook and the recovery
     * job may all settle the same payment, and each outcome must be applied
     * exactly once. */
    advance: (id: string, input: PaymentAdvanceInput) => Effect.Effect<Payment | null, SqlError>;
  }
>() {}

export const PaymentRepoLive = Layer.effect(
  PaymentRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const oneOrNotFound = (id: string) => (rows: Array<Payment>) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new DBNotFoundError({ entity: 'payment', value: id }));

    return {
      findById: (id) =>
        db
          .select()
          .from(payment)
          .where(eq(payment.id, id))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      findByProviderReference: (provider, reference) =>
        db
          .select()
          .from(payment)
          .where(and(eq(payment.provider, provider), eq(payment.providerReference, reference)))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),

      listByUser: (userId) =>
        db
          .select()
          .from(payment)
          .where(and(eq(payment.userId, userId), isNotNull(payment.providerReference)))
          .orderBy(desc(payment.createdAt))
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({ ...row, description: paymentKindDescriptions[row.kind] }))
            )
          ),

      listStalePending: (provider, createdBefore) =>
        db
          .select()
          .from(payment)
          .where(
            and(
              eq(payment.status, 'pending'),
              eq(payment.provider, provider),
              isNotNull(payment.providerReference),
              lt(payment.createdAt, createdBefore)
            )
          )
          .orderBy(payment.createdAt),

      create: (input) =>
        db
          .insert(payment)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),

      update: (id, input) =>
        db
          .update(payment)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(payment.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      advance: (id, input) => {
        const statuses: Array<PaymentStatus> = Array.isArray(input.from)
          ? [...(input.from as ReadonlyArray<PaymentStatus>)]
          : [input.from as PaymentStatus];
        return db
          .update(payment)
          .set({ ...input.set, updatedAt: new Date() })
          .where(and(eq(payment.id, id), inArray(payment.status, statuses)))
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null));
      }
    };
  })
);

export const PaymentRepoDefault = PaymentRepoLive.pipe(Layer.provide(DrizzleLive));

const notFound = () => Effect.fail(new DBNotFoundError({ entity: 'payment', value: '' }));

const emptyPaymentRepo: Context.Tag.Service<PaymentRepo> = {
  findById: notFound,
  findByProviderReference: () => Effect.succeed(null),
  listByUser: () => Effect.succeed([]),
  listStalePending: () => Effect.succeed([]),
  create: () => notFound() as never,
  update: notFound,
  advance: () => Effect.succeed(null)
};

/** Unspecified methods behave like an empty table. */
export const makePaymentRepoTest = (implementation: Partial<Context.Tag.Service<PaymentRepo>>) =>
  Layer.succeed(PaymentRepo, { ...emptyPaymentRepo, ...implementation });

export const EmptyPaymentRepoTest = makePaymentRepoTest({});
```

- [ ] **Step 4: Add the billing-customer and webhook-event repositories**

`packages/db/src/repos/billing-customer-repo.ts`:

```ts
import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, eq, sql, type InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { billingCustomer } from '../schema';

export type BillingCustomer = InferSelectModel<typeof billingCustomer>;

/** Display details of the card on file, plus the gateway's reference for it. */
export type BillingCard = {
  reference: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export class BillingCustomerRepo extends Context.Tag('@repo/db/BillingCustomerRepo')<
  BillingCustomerRepo,
  {
    findByUserId: (userId: string) => Effect.Effect<BillingCustomer | null, SqlError>;
    /** How a gateway event (a SetupIntent, a PaymentIntent's customer) finds
     * the user it belongs to. */
    findByCustomerReference: (
      provider: string,
      customerReference: string
    ) => Effect.Effect<BillingCustomer | null, SqlError>;
    /** Records the gateway customer for a user. One customer per user per
     * gateway: an existing row for the same gateway is returned untouched (a
     * racing second create is a no-op); a row from ANOTHER gateway (mock →
     * stripe) is replaced and its card forgotten. */
    upsertCustomer: (input: {
      userId: string;
      provider: string;
      customerReference: string;
    }) => Effect.Effect<BillingCustomer, SqlError>;
    /** Null when the user has no customer row. */
    setCard: (userId: string, card: BillingCard) => Effect.Effect<BillingCustomer | null, SqlError>;
    clearCard: (userId: string) => Effect.Effect<BillingCustomer | null, SqlError>;
  }
>() {}

const firstOrNull = (rows: Array<BillingCustomer>) => rows[0] ?? null;

export const BillingCustomerRepoLive = Layer.effect(
  BillingCustomerRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    const findByUserId = (userId: string) =>
      db
        .select()
        .from(billingCustomer)
        .where(eq(billingCustomer.userId, userId))
        .limit(1)
        .pipe(Effect.map(firstOrNull));

    return {
      findByUserId,

      findByCustomerReference: (provider, customerReference) =>
        db
          .select()
          .from(billingCustomer)
          .where(
            and(
              eq(billingCustomer.provider, provider),
              eq(billingCustomer.customerReference, customerReference)
            )
          )
          .limit(1)
          .pipe(Effect.map(firstOrNull)),

      upsertCustomer: (input) =>
        Effect.gen(function* () {
          const written = yield* db
            .insert(billingCustomer)
            .values(input)
            .onConflictDoUpdate({
              target: billingCustomer.userId,
              set: {
                provider: input.provider,
                customerReference: input.customerReference,
                cardReference: null,
                cardBrand: null,
                cardLast4: null,
                cardExpMonth: null,
                cardExpYear: null,
                updatedAt: new Date()
              },
              setWhere: sql`${billingCustomer.provider} <> ${input.provider}`
            })
            .returning();
          if (written[0]) return written[0];
          // Same gateway already on file: keep it.
          const existing = yield* findByUserId(input.userId);
          return existing!;
        }),

      setCard: (userId, card) =>
        db
          .update(billingCustomer)
          .set({
            cardReference: card.reference,
            cardBrand: card.brand,
            cardLast4: card.last4,
            cardExpMonth: card.expMonth,
            cardExpYear: card.expYear,
            updatedAt: new Date()
          })
          .where(eq(billingCustomer.userId, userId))
          .returning()
          .pipe(Effect.map(firstOrNull)),

      clearCard: (userId) =>
        db
          .update(billingCustomer)
          .set({
            cardReference: null,
            cardBrand: null,
            cardLast4: null,
            cardExpMonth: null,
            cardExpYear: null,
            updatedAt: new Date()
          })
          .where(eq(billingCustomer.userId, userId))
          .returning()
          .pipe(Effect.map(firstOrNull))
    };
  })
);

export const BillingCustomerRepoDefault = BillingCustomerRepoLive.pipe(Layer.provide(DrizzleLive));

/** In-memory stand-in with the live repo's semantics, for unit tests. */
export const makeInMemoryBillingCustomerRepo = (
  initial: Array<BillingCustomer> = []
): {
  layer: Layer.Layer<BillingCustomerRepo>;
  rows: Map<string, BillingCustomer>;
} => {
  const rows = new Map(initial.map((row) => [row.userId, row]));
  const cardless = {
    cardReference: null,
    cardBrand: null,
    cardLast4: null,
    cardExpMonth: null,
    cardExpYear: null
  };
  const update = (userId: string, patch: Partial<BillingCustomer>) => {
    const row = rows.get(userId);
    if (!row) return null;
    const next = { ...row, ...patch, updatedAt: new Date() };
    rows.set(userId, next);
    return next;
  };
  return {
    rows,
    layer: Layer.succeed(BillingCustomerRepo, {
      findByUserId: (userId) => Effect.succeed(rows.get(userId) ?? null),
      findByCustomerReference: (provider, customerReference) =>
        Effect.succeed(
          [...rows.values()].find(
            (row) => row.provider === provider && row.customerReference === customerReference
          ) ?? null
        ),
      upsertCustomer: (input) =>
        Effect.sync(() => {
          const existing = rows.get(input.userId);
          if (existing && existing.provider === input.provider) return existing;
          const row: BillingCustomer = {
            ...input,
            ...cardless,
            createdAt: existing?.createdAt ?? new Date(),
            updatedAt: new Date()
          };
          rows.set(input.userId, row);
          return row;
        }),
      setCard: (userId, card) =>
        Effect.sync(() =>
          update(userId, {
            cardReference: card.reference,
            cardBrand: card.brand,
            cardLast4: card.last4,
            cardExpMonth: card.expMonth,
            cardExpYear: card.expYear
          })
        ),
      clearCard: (userId) => Effect.sync(() => update(userId, cardless))
    })
  };
};

/** A row with a card, for fixtures. */
export const dummyBillingCustomer = (
  overrides: Partial<BillingCustomer> = {}
): BillingCustomer => ({
  userId: 'family-1',
  provider: 'mock',
  customerReference: 'mock_cus_family-1',
  cardReference: 'mock_pm_saved',
  cardBrand: 'visa',
  cardLast4: '4242',
  cardExpMonth: 12,
  cardExpYear: 2034,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides
});
```

`packages/db/src/repos/stripe-webhook-event-repo.ts`:

```ts
import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { stripeWebhookEvent } from '../schema';

/**
 * `new`: first delivery of this event. `unprocessed`: seen before but never
 * finished (an earlier attempt failed) — Stripe is retrying, so process it.
 * `processed`: a duplicate of a delivery we already handled — acknowledge it.
 */
export type StripeWebhookRecordResult = 'new' | 'unprocessed' | 'processed';

export class StripeWebhookEventRepo extends Context.Tag('@repo/db/StripeWebhookEventRepo')<
  StripeWebhookEventRepo,
  {
    record: (input: {
      eventId: string;
      type: string;
      objectId: string;
    }) => Effect.Effect<StripeWebhookRecordResult, SqlError>;
    markProcessed: (eventId: string) => Effect.Effect<void, SqlError>;
    markFailed: (eventId: string, error: string) => Effect.Effect<void, SqlError>;
  }
>() {}

export const StripeWebhookEventRepoLive = Layer.effect(
  StripeWebhookEventRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      record: (input) =>
        Effect.gen(function* () {
          const inserted = yield* db
            .insert(stripeWebhookEvent)
            .values(input)
            .onConflictDoNothing({ target: stripeWebhookEvent.eventId })
            .returning();
          if (inserted.length > 0) return 'new' as const;
          const existing = yield* db
            .select()
            .from(stripeWebhookEvent)
            .where(eq(stripeWebhookEvent.eventId, input.eventId))
            .limit(1);
          return existing[0]?.processedAt ? ('processed' as const) : ('unprocessed' as const);
        }),

      markProcessed: (eventId) =>
        db
          .update(stripeWebhookEvent)
          .set({ processedAt: new Date(), error: null })
          .where(eq(stripeWebhookEvent.eventId, eventId))
          .pipe(Effect.asVoid),

      markFailed: (eventId, error) =>
        db
          .update(stripeWebhookEvent)
          .set({ error: error.slice(0, 2000) })
          .where(eq(stripeWebhookEvent.eventId, eventId))
          .pipe(Effect.asVoid)
    };
  })
);

export const StripeWebhookEventRepoDefault = StripeWebhookEventRepoLive.pipe(
  Layer.provide(DrizzleLive)
);

export const makeStripeWebhookEventRepoTest = (
  implementation: Partial<Context.Tag.Service<StripeWebhookEventRepo>>
) =>
  Layer.succeed(StripeWebhookEventRepo, {
    record: () => Effect.succeed('new' as const),
    markProcessed: () => Effect.void,
    markFailed: () => Effect.void,
    ...implementation
  });
```

In `packages/db/src/index.ts`, after `export * from './repos/payment-repo';` add:

```ts
export * from './repos/billing-customer-repo';
export * from './repos/stripe-webhook-event-repo';
```

- [ ] **Step 5: `findByPaymentId` and a partial test helper on the check-order repo**

In `packages/db/src/repos/check-order-repo.ts`:

In the `CheckOrderRepo` service type, directly above the `/** Correlation for inbound Credibled webhooks` doc comment, add:

```ts
    /** The order a payment was claimed for — how the settle path, which
     * starts from a payment, finds what the money was for. */
    findByPaymentId: (paymentId: string) => Effect.Effect<CheckOrder | null, SqlError>;
```

In `CheckOrderRepoLive`, directly above `findByCredibledUuid: (uuid) =>`, add:

```ts
      findByPaymentId: (paymentId) =>
        db
          .select()
          .from(checkOrder)
          .where(and(eq(checkOrder.paymentId, paymentId), isNull(checkOrder.deletedAt)))
          .limit(1)
          .pipe(Effect.map(firstOrNull)),

```

Replace everything from `export const makeCheckOrderRepoTest` to the end of the file with:

```ts
const notFound = () => Effect.fail(new DBNotFoundError({ entity: 'checkOrder', value: '' }));

const emptyCheckOrderRepo: Context.Tag.Service<CheckOrderRepo> = {
  findById: notFound,
  findOpen: () => Effect.succeed(null),
  findByPaymentId: () => Effect.succeed(null),
  findByCredibledUuid: () => Effect.succeed(null),
  create: () => notFound() as never,
  update: notFound,
  claimForPayment: () => Effect.succeed(null),
  advance: () => Effect.succeed(null),
  complete: () => Effect.succeed(null),
  listInFlight: () => Effect.succeed([]),
  listAwaitingPlacement: () => Effect.succeed([]),
  listItems: () => Effect.succeed([]),
  listWithItems: () => Effect.succeed([]),
  addItem: () => notFound() as never,
  removeItem: notFound
};

/** Unspecified methods behave like an empty table. */
export const makeCheckOrderRepoTest = (
  implementation: Partial<Context.Tag.Service<CheckOrderRepo>>
) => Layer.succeed(CheckOrderRepo, { ...emptyCheckOrderRepo, ...implementation });

export const EmptyCheckOrderRepoTest = makeCheckOrderRepoTest({});
```

(Existing callers pass a full implementation; with a `Partial` they keep working unchanged.)

- [ ] **Step 6: Register the repositories in the API runtime**

In `apps/api/src/managed-runtime.ts`: add `BillingCustomerRepoDefault,` to the `@repo/db` import list (after `ApprovalRequestRepoDefault,`) and `StripeWebhookEventRepoDefault,` (after `SafetyVerificationRepoDefault,`); in `AppLive` add after `PaymentRepoDefault,`:

```ts
  BillingCustomerRepoDefault,
  StripeWebhookEventRepoDefault,
```

In `apps/api/src/app-env.ts`: add `BillingCustomerRepo,` (after `ApprovalRequestRepo,`) and `StripeWebhookEventRepo,` (after `SafetyVerificationRepo,`) to the type import from `@repo/db`, and in `AppServices` after `| PaymentRepo` add:

```ts
  | BillingCustomerRepo
  | StripeWebhookEventRepo
```

- [ ] **Step 7: Type-check and run against a real Postgres**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bun run build && bunx vitest run`
Expected: build exits 0; only the 2 pre-existing `mailer.unit.test.ts` failures.

Apply every migration to a throwaway Postgres (does not touch the dev stack) and exercise the new repos:

```bash
docker run --rm -d --name pg-stripe-0025 -e POSTGRES_PASSWORD=pw -e POSTGRES_USER=u -e POSTGRES_DB=d \
  -p 127.0.0.1:55432:5432 postgres:18.1-alpine3.23
sleep 6
cd /run/media/hbt/work/poppynz/stripe-integration/packages/db
DATABASE_URL=postgres://u:pw@127.0.0.1:55432/d bunx drizzle-kit migrate
docker exec pg-stripe-0025 psql -U u -d d -c '\d app_db.billing_customers' -c '\d app_db.stripe_webhook_events' -c '\d app_db.payments' \
  | grep -E 'billing_customers_user_id_user_id_fk|ON DELETE RESTRICT|billing_customers_provider_customer_uidx|stripe_webhook_events_pkey|receipt_url|payments_pending_created_at_idx'
```

Expected: `migrations applied successfully`; the grep prints the FK (with `ON DELETE RESTRICT`), both indexes, the primary key and `receipt_url`.

Then a repo smoke test (delete the file afterwards; it is not committed):

```bash
cd /run/media/hbt/work/poppynz/stripe-integration/packages/db
docker exec pg-stripe-0025 psql -U u -d d -c "insert into app_db.\"user\"(id,name,email) values ('u1','U One','u1@x.y')"
cat > repo-smoke.ts <<'EOF'
import { Effect, Layer } from 'effect';
import { BillingCustomerRepo, BillingCustomerRepoDefault, PaymentRepo, PaymentRepoDefault, StripeWebhookEventRepo, StripeWebhookEventRepoDefault } from './src/index';
const program = Effect.gen(function* () {
  const b = yield* BillingCustomerRepo; const p = yield* PaymentRepo; const w = yield* StripeWebhookEventRepo;
  yield* b.upsertCustomer({ userId: 'u1', provider: 'mock', customerReference: 'mock_cus_u1' });
  yield* b.setCard('u1', { reference: 'pm_1', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030 });
  console.log('same provider keeps card:', (yield* b.upsertCustomer({ userId: 'u1', provider: 'mock', customerReference: 'x' })).cardReference);
  console.log('other provider clears card:', (yield* b.upsertCustomer({ userId: 'u1', provider: 'stripe', customerReference: 'cus_9' })).cardReference);
  const pay = yield* p.create({ userId: 'u1', kind: 'credibled_order', provider: 'stripe', amountCents: 1, feeCents: 0, taxCents: 0, totalCents: 1 });
  yield* p.update(pay.id, { providerReference: 'pi_1' });
  console.log('stale:', (yield* p.listStalePending('stripe', new Date(Date.now() + 1000))).length);
  console.log('advance:', (yield* p.advance(pay.id, { from: 'pending', set: { status: 'captured' } }))?.status, yield* p.advance(pay.id, { from: 'pending', set: { status: 'failed' } }));
  console.log('history:', (yield* p.listByUser('u1')).map((r) => r.description));
  console.log('events:', yield* w.record({ eventId: 'evt_1', type: 't', objectId: 'o' }), yield* w.record({ eventId: 'evt_1', type: 't', objectId: 'o' }));
  yield* w.markProcessed('evt_1');
  console.log('after processed:', yield* w.record({ eventId: 'evt_1', type: 't', objectId: 'o' }));
});
await Effect.runPromise(program.pipe(Effect.provide(Layer.mergeAll(BillingCustomerRepoDefault, PaymentRepoDefault, StripeWebhookEventRepoDefault)), Effect.scoped));
process.exit(0);
EOF
DATABASE_URL=postgres://u:pw@127.0.0.1:55432/d bun repo-smoke.ts; rm repo-smoke.ts
docker stop pg-stripe-0025
```

Expected output:

```
same provider keeps card: pm_1
other provider clears card: null
stale: 1
advance: captured null
history: [ "Background check" ]
events: new unprocessed
after processed: processed
```

- [ ] **Step 8: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add packages/db apps/api/src/managed-runtime.ts apps/api/src/app-env.ts
git commit -m "feat(db): billing customers, Stripe webhook events and payment receipts (0025)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `@repo/billing` — the one settle path and the card on file

**Files:**
- Create: `packages/billing/package.json`, `packages/billing/src/index.ts`, `packages/billing/src/cards.ts`, `packages/billing/src/settle.ts`, `packages/billing/src/cards.test.ts`, `packages/billing/src/settle.test.ts`
- Modify: `packages/notify/src/events.ts`, `apps/api/Dockerfile.production`, `apps/worker/Dockerfile.production`, `apps/web/Dockerfile.production`, `Dockerfile.seeds.production`, `Dockerfile.migrations.production`, `bun.lock`

**Interfaces:**
- Consumes: `Payments` port (Task 1), repos and fixtures (Task 3), `SafetyVerificationQueue` from `@repo/queue`, `publishNotificationBestEffort` from `@repo/notify`.
- Produces (from `@repo/billing`):
  - `toCard(row: BillingCustomer | null, provider: string): BillingCard | null` — only a complete card at the active provider
  - `cardOnFile(userId) → Effect<BillingCard | null, SqlError, BillingCustomerRepo | Payments>`
  - `ensureBillingCustomer({ id, email, name }) → Effect<BillingCustomer, SqlError | PaymentProviderError, BillingCustomerRepo | Payments>`
  - `saveCard(userId, card: CardDetails) → Effect<BillingCustomer | null, SqlError, …>` (detaches the replaced card, best-effort)
  - `applyCardSetup(reference, userId: string | null) → Effect<{ outcome: 'saved'; card: BillingCard } | { outcome: 'not_found' } | { outcome: 'incomplete' }, SqlError | PaymentProviderError, …>`; `type CardSetupResult`
  - `settlePayment(paymentId, now?) → Effect<SettleResult, SqlError | DBNotFoundError | PaymentProviderError | SafetyVerificationQueueError, PaymentRepo | CheckOrderRepo | BillingCustomerRepo | Payments | SafetyVerificationQueue | NotificationHub>`
  - `settlePaymentByReference(reference, now?) → same, plus { outcome: 'unknown' }`
  - `type SettleResult` = `{ outcome: 'captured' | 'failed' | 'pending' | 'final' | 'skipped'; payment } | { outcome: 'mismatch'; payment; reason }`
  - `mismatchReason(row: Payment, fetched: ProviderPayment): string | null`
- `safety_verification.updated` payload `status` gains `'not_started' | 'payment_pending'`.

- [ ] **Step 1: Create the package and link it**

`packages/billing/package.json`:

```json
{
  "name": "@repo/billing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test src"
  },
  "dependencies": {
    "@repo/db": "*",
    "@repo/notify": "*",
    "@repo/payments": "*",
    "@repo/queue": "*",
    "effect": "^3.21.2"
  }
}
```

`packages/billing/src/index.ts`:

```ts
// Payment settlement and the card on file — the domain logic the API (order
// confirmation, billing routes, webhook) and the worker (recovery job) share.
// Speaks only to the Payments port; never to Stripe.
export * from './cards';
export * from './settle';
```

Run: `cd /run/media/hbt/work/poppynz/stripe-integration && bun install`
Expected: `packages/billing/node_modules/@repo/{db,notify,payments,queue}` are symlinks; `bun.lock` lists `packages/billing`.

In each of `apps/api/Dockerfile.production`, `apps/worker/Dockerfile.production`, `apps/web/Dockerfile.production`, `Dockerfile.seeds.production`, `Dockerfile.migrations.production`, insert immediately above the line `COPY packages/calendar/package.json packages/calendar/`:

```dockerfile
COPY packages/billing/package.json packages/billing/
```

Verify: `grep -c "packages/billing/package.json" apps/api/Dockerfile.production apps/worker/Dockerfile.production apps/web/Dockerfile.production Dockerfile.seeds.production Dockerfile.migrations.production` → each prints `1`.

- [ ] **Step 2: Let a payment's own events refresh the verification page**

In `packages/notify/src/events.ts` replace the `'safety_verification.updated'` entry (and its doc comment) with:

```ts
  /** The viewer's safety check moved: its payment settled (payment_pending —
   * the order is being placed) or failed (not_started — back to the basket),
   * Credibled set it up (invited), is processing it, finished it (awaiting
   * review), or an admin decided. Deliberately thin — a page showing the
   * verification refetches its summary on receipt; anywhere else it is just a
   * toast (payment events have no toast: the payer is on the page). */
  'safety_verification.updated': {
    status:
      | 'not_started'
      | 'payment_pending'
      | 'invited'
      | 'in_progress'
      | 'review_required'
      | 'verified'
      | 'rejected';
  };
```

- [ ] **Step 3: Write the failing tests**

`packages/billing/src/settle.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  dummyBillingCustomer,
  makeCheckOrderRepoTest,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  DBNotFoundError,
  type BillingCustomer,
  type CheckOrder,
  type Payment
} from '@repo/db';
import { makeNotificationHubTest, type NotificationInput } from '@repo/notify';
import { makePaymentsTest, type ProviderPayment } from '@repo/payments';
import { makeSafetyVerificationQueueTest } from '@repo/queue';
import { Effect, Layer } from 'effect';
import { settlePayment, settlePaymentByReference } from './settle';

const NOW = new Date('2026-10-02T12:00:00.000Z');

const paymentRow = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'payment-1',
  userId: 'family-1',
  kind: 'credibled_order',
  status: 'pending',
  provider: 'stripe',
  providerReference: 'pi_1',
  refundReference: null,
  amountCents: 7000,
  feeCents: 500,
  taxCents: 0,
  totalCents: 7500,
  currency: 'CAD',
  lastError: null,
  authorisedAt: null,
  capturedAt: null,
  refundedAt: null,
  receiptUrl: null,
  createdAt: new Date('2026-10-02T11:00:00.000Z'),
  updatedAt: new Date('2026-10-02T11:00:00.000Z'),
  ...overrides
});

const orderRow = (overrides: Partial<CheckOrder> = {}): CheckOrder =>
  ({
    id: 'order-1',
    userId: 'family-1',
    role: 'family',
    status: 'payment_pending',
    paymentId: 'payment-1',
    consentAt: null,
    consentPolicyVersion: '2026-08-22',
    deletedAt: null,
    ...overrides
  }) as CheckOrder;

const fetched = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  reference: 'pi_1',
  status: 'succeeded',
  amountCents: 7500,
  currency: 'cad',
  metadata: { payment_id: 'payment-1' },
  customer: 'cus_1',
  savesCard: false,
  failureReason: null,
  receiptUrl: 'https://pay.stripe.com/receipts/r1',
  refundedCents: 0,
  paymentMethod: null,
  ...overrides
});

const card = (reference: string) => ({
  reference,
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2034
});

/** One payment row and one order, held in memory with the live repos'
 * compare-and-set semantics, so concurrent settles really race. */
const makeWorld = (
  options: {
    payment?: Payment;
    order?: CheckOrder | null;
    provider?: ProviderPayment;
    afterCancel?: ProviderPayment;
    billing?: Array<BillingCustomer>;
  } = {}
) => {
  let payment = options.payment ?? paymentRow();
  let order = options.order === undefined ? orderRow() : options.order;
  const calls = {
    getPayment: 0,
    cancelled: [] as Array<string>,
    removedCards: [] as Array<string>,
    enqueued: [] as Array<string>,
    notified: [] as Array<{ userId: string; input: NotificationInput }>
  };
  const billing = makeInMemoryBillingCustomerRepo(options.billing ?? []);

  const layer = Layer.mergeAll(
    makePaymentRepoTest({
      findById: (id) =>
        id === payment.id
          ? Effect.succeed(payment)
          : Effect.fail(new DBNotFoundError({ entity: 'payment', value: id })),
      findByProviderReference: (_provider, reference) =>
        Effect.succeed(payment.providerReference === reference ? payment : null),
      update: (_id, input) => Effect.sync(() => (payment = { ...payment, ...input })),
      advance: (_id, input) =>
        Effect.sync(() => {
          const from = Array.isArray(input.from) ? input.from : [input.from];
          if (!from.includes(payment.status)) return null;
          payment = { ...payment, ...input.set };
          return payment;
        })
    }),
    makeCheckOrderRepoTest({
      findByPaymentId: (paymentId) =>
        Effect.succeed(order && order.paymentId === paymentId ? order : null),
      advance: (_id, input) =>
        Effect.sync(() => {
          const from = Array.isArray(input.from.status) ? input.from.status : [input.from.status];
          if (order === null || !from.includes(order.status)) return null;
          if (input.from.paymentId !== undefined && order.paymentId !== input.from.paymentId) {
            return null;
          }
          order = { ...order, ...input.set } as CheckOrder;
          return order;
        })
    }),
    makePaymentsTest({
      provider: 'stripe',
      getPayment: () =>
        Effect.sync(() => {
          calls.getPayment += 1;
          return options.provider ?? fetched();
        }),
      cancelPayment: (reference) =>
        Effect.sync(() => {
          calls.cancelled.push(reference);
          return options.afterCancel ?? fetched({ status: 'canceled' });
        }),
      removeCard: (reference) => Effect.sync(() => void calls.removedCards.push(reference))
    }),
    billing.layer,
    makeSafetyVerificationQueueTest({
      enqueueOrder: ({ orderId }) =>
        Effect.sync(() => {
          calls.enqueued.push(orderId);
          return { id: 'job-1', name: 'place' };
        })
    }),
    makeNotificationHubTest({
      publish: (userId, input) => Effect.sync(() => void calls.notified.push({ userId, input })),
      subscribe: () => Effect.die('not used')
    })
  );

  return {
    layer,
    calls,
    billing,
    payment: () => payment,
    order: () => order
  };
};

const run = <A, E>(world: ReturnType<typeof makeWorld>, effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect);

const settle = (world: ReturnType<typeof makeWorld>, paymentId = 'payment-1') =>
  run(world, settlePayment(paymentId, () => NOW).pipe(Effect.provide(world.layer)));

describe('settlePayment', () => {
  it('captures a succeeded payment, marks the order paid and hands it to the worker', async () => {
    const world = makeWorld();
    const result = await settle(world);

    expect(result.outcome).toBe('captured');
    expect(world.payment()).toMatchObject({
      status: 'captured',
      capturedAt: NOW,
      receiptUrl: 'https://pay.stripe.com/receipts/r1'
    });
    expect(world.order()).toMatchObject({ status: 'paid', consentAt: NOW });
    expect(world.calls.enqueued).toEqual(['order-1']);
    expect(world.calls.notified[0]?.input).toEqual({
      type: 'safety_verification.updated',
      payload: { status: 'payment_pending' }
    });
  });

  it('fails a declined payment after cancelling it, and returns the order to the basket', async () => {
    const world = makeWorld({
      provider: fetched({ status: 'failed', failureReason: 'Your card was declined.' })
    });
    const result = await settle(world);

    expect(result.outcome).toBe('failed');
    expect(world.calls.cancelled).toEqual(['pi_1']);
    expect(world.payment()).toMatchObject({
      status: 'failed',
      lastError: 'Your card was declined.'
    });
    expect(world.order()).toMatchObject({ status: 'draft', paymentId: null });
    expect(world.calls.enqueued).toEqual([]);
  });

  it('captures instead when the declined intent succeeded before it could be cancelled', async () => {
    const world = makeWorld({
      provider: fetched({ status: 'failed' }),
      afterCancel: fetched({ status: 'succeeded' })
    });
    const result = await settle(world);
    expect(result.outcome).toBe('captured');
    expect(world.order()?.status).toBe('paid');
  });

  it('fails a canceled payment without cancelling it again', async () => {
    const world = makeWorld({ provider: fetched({ status: 'canceled' }) });
    const result = await settle(world);
    expect(result.outcome).toBe('failed');
    expect(world.calls.cancelled).toEqual([]);
    expect(world.payment().lastError).toBe('The payment was cancelled.');
  });

  it('changes nothing while the provider still needs the payer or is processing', async () => {
    for (const status of ['requires_action', 'processing'] as const) {
      const world = makeWorld({ provider: fetched({ status }) });
      const result = await settle(world);
      expect(result.outcome).toBe('pending');
      expect(world.payment().status).toBe('pending');
      expect(world.order()?.status).toBe('payment_pending');
    }
  });

  it('flags an amount mismatch and changes nothing else', async () => {
    const world = makeWorld({ provider: fetched({ amountCents: 100 }) });
    const result = await settle(world);
    expect(result.outcome).toBe('mismatch');
    expect(world.payment()).toMatchObject({ status: 'pending' });
    expect(world.payment().lastError).toContain('amount');
    expect(world.order()?.status).toBe('payment_pending');
  });

  it('flags a metadata mismatch — an intent that is not this row', async () => {
    const world = makeWorld({ provider: fetched({ metadata: { payment_id: 'payment-9' } }) });
    const result = await settle(world);
    expect(result.outcome).toBe('mismatch');
    expect(world.payment().lastError).toContain('payment-9');
    expect(world.calls.enqueued).toEqual([]);
  });

  it('flags a currency mismatch but accepts the provider’s lower case', async () => {
    const usd = makeWorld({ provider: fetched({ currency: 'usd' }) });
    expect((await settle(usd)).outcome).toBe('mismatch');
    const cad = makeWorld({ provider: fetched({ currency: 'cad' }) });
    expect((await settle(cad)).outcome).toBe('captured');
  });

  it('skips a payment that is already final without asking the provider', async () => {
    const world = makeWorld({ payment: paymentRow({ status: 'refunded' }) });
    const result = await settle(world);
    expect(result.outcome).toBe('final');
    expect(world.calls.getPayment).toBe(0);
  });

  it('finishes the order of an already-captured payment whose follow-up never ran', async () => {
    const world = makeWorld({ payment: paymentRow({ status: 'captured' }) });
    const result = await settle(world);
    expect(result.outcome).toBe('final');
    expect(world.order()?.status).toBe('paid');
    expect(world.calls.enqueued).toEqual(['order-1']);
  });

  it('leaves a payment recorded under another provider alone', async () => {
    const world = makeWorld({ payment: paymentRow({ provider: 'mock' }) });
    const result = await settle(world);
    expect(result.outcome).toBe('skipped');
    expect(world.calls.getPayment).toBe(0);
  });

  it('applies the outcome exactly once when the browser, webhook and job race', async () => {
    const world = makeWorld();
    const results = await Promise.all([settle(world), settle(world), settle(world)]);
    const outcomes = results.map((result) => result.outcome).sort();
    expect(outcomes).toEqual(['captured', 'final', 'final']);
    expect(world.calls.enqueued.filter((id) => id === 'order-1').length).toBeGreaterThanOrEqual(1);
    expect(world.order()?.status).toBe('paid');
  });

  it('flags money taken for an order that no longer waits for it', async () => {
    const world = makeWorld({ order: null });
    await settle(world);
    expect(world.payment()).toMatchObject({ status: 'captured' });
    expect(world.payment().lastError).toContain('needs manual settlement');
  });
});

describe('saving the card on a family’s first payment', () => {
  it('saves the paying card for the customer that owns the payment', async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [
        dummyBillingCustomer({
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: null,
          cardBrand: null,
          cardLast4: null,
          cardExpMonth: null,
          cardExpYear: null
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('family-1')).toMatchObject({
      cardReference: 'pm_new',
      cardLast4: '4242'
    });
  });

  it('replaces an older card and detaches it at the provider', async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [
        dummyBillingCustomer({
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: 'pm_old'
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
    expect(world.calls.removedCards).toEqual(['pm_old']);
  });

  it('saves nothing for a one-off payment (a helper, or another card)', async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: false, paymentMethod: card('pm_once') }),
      billing: [
        dummyBillingCustomer({
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: 'pm_saved'
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_saved');
  });

  it("never saves a card onto another user's customer", async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [
        dummyBillingCustomer({
          userId: 'someone-else',
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: null
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('someone-else')?.cardReference).toBeNull();
  });
});

describe('settlePaymentByReference', () => {
  it('settles the row the provider reference points at', async () => {
    const world = makeWorld();
    const result = await run(
      world,
      settlePaymentByReference('pi_1', () => NOW).pipe(Effect.provide(world.layer))
    );
    expect(result.outcome).toBe('captured');
  });

  it('reports an intent we never created as unknown', async () => {
    const world = makeWorld();
    const result = await run(
      world,
      settlePaymentByReference('pi_unknown', () => NOW).pipe(Effect.provide(world.layer))
    );
    expect(result).toEqual({ outcome: 'unknown' });
    expect(world.calls.getPayment).toBe(0);
  });
});
```

`packages/billing/src/cards.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  dummyBillingCustomer,
  makeInMemoryBillingCustomerRepo,
  type BillingCustomer
} from '@repo/db';
import { makePaymentsTest, type ProviderCardSetup } from '@repo/payments';
import { Effect, Layer } from 'effect';
import { applyCardSetup, cardOnFile, ensureBillingCustomer } from './cards';

const setup = (overrides: Partial<ProviderCardSetup> = {}): ProviderCardSetup => ({
  reference: 'seti_1',
  status: 'succeeded',
  customer: 'cus_1',
  paymentMethod: { reference: 'pm_new', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 },
  ...overrides
});

const makeWorld = (rows: Array<BillingCustomer>, fetchedSetup = setup()) => {
  const billing = makeInMemoryBillingCustomerRepo(rows);
  const removed: Array<string> = [];
  const created: Array<string> = [];
  const layer = Layer.mergeAll(
    billing.layer,
    makePaymentsTest({
      provider: 'stripe',
      ensureCustomer: ({ userId, existing }) =>
        Effect.sync(() => {
          created.push(userId);
          return existing ?? `cus_${userId}`;
        }),
      getCardSetup: () => Effect.succeed(fetchedSetup),
      removeCard: (reference) => Effect.sync(() => void removed.push(reference))
    })
  );
  return { billing, removed, created, layer };
};

const stripeFamily = (overrides: Partial<BillingCustomer> = {}) =>
  dummyBillingCustomer({ provider: 'stripe', customerReference: 'cus_1', ...overrides });

describe('ensureBillingCustomer', () => {
  it('creates the gateway customer once and records it', async () => {
    const world = makeWorld([]);
    const user = { id: 'family-1', email: 'f@example.com', name: 'Fam' };
    const first = await Effect.runPromise(
      ensureBillingCustomer(user).pipe(Effect.provide(world.layer))
    );
    const second = await Effect.runPromise(
      ensureBillingCustomer(user).pipe(Effect.provide(world.layer))
    );
    expect(first.customerReference).toBe('cus_family-1');
    expect(second.customerReference).toBe('cus_family-1');
    expect(world.created).toEqual(['family-1']);
  });

  it('replaces a customer left by another gateway and forgets its card', async () => {
    const world = makeWorld([dummyBillingCustomer({ provider: 'mock' })]);
    const row = await Effect.runPromise(
      ensureBillingCustomer({ id: 'family-1', email: 'f@example.com', name: 'Fam' }).pipe(
        Effect.provide(world.layer)
      )
    );
    expect(row).toMatchObject({ provider: 'stripe', cardReference: null });
  });
});

describe('cardOnFile', () => {
  it('returns the card saved at the active gateway', async () => {
    const world = makeWorld([stripeFamily()]);
    const card = await Effect.runPromise(cardOnFile('family-1').pipe(Effect.provide(world.layer)));
    expect(card).toEqual({
      reference: 'mock_pm_saved',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2034
    });
  });

  it('ignores a card saved under another gateway', async () => {
    const world = makeWorld([dummyBillingCustomer({ provider: 'mock' })]);
    const card = await Effect.runPromise(cardOnFile('family-1').pipe(Effect.provide(world.layer)));
    expect(card).toBeNull();
  });
});

describe('applyCardSetup', () => {
  it('saves the new card for its owner and detaches the one it replaces', async () => {
    const world = makeWorld([stripeFamily({ cardReference: 'pm_old' })]);
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', 'family-1').pipe(Effect.provide(world.layer))
    );
    expect(result).toMatchObject({ outcome: 'saved', card: { reference: 'pm_new' } });
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
    expect(world.removed).toEqual(['pm_old']);
  });

  it("refuses a setup that belongs to another user's customer", async () => {
    const world = makeWorld([stripeFamily({ userId: 'someone-else' })]);
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', 'family-1').pipe(Effect.provide(world.layer))
    );
    expect(result).toEqual({ outcome: 'not_found' });
    expect(world.billing.rows.get('someone-else')?.cardReference).toBe('mock_pm_saved');
  });

  it('reports an unfinished setup as incomplete and saves nothing', async () => {
    const world = makeWorld([stripeFamily()], setup({ status: 'requires_action' }));
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', 'family-1').pipe(Effect.provide(world.layer))
    );
    expect(result).toEqual({ outcome: 'incomplete' });
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('mock_pm_saved');
  });

  it('applies for whichever user owns the customer when called from the webhook', async () => {
    const world = makeWorld([stripeFamily()]);
    const result = await Effect.runPromise(
      applyCardSetup('seti_1', null).pipe(Effect.provide(world.layer))
    );
    expect(result.outcome).toBe('saved');
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/packages/billing && bun test src`
Expected: FAIL — `Cannot find module './settle'` / `'./cards'`.

- [ ] **Step 5: Implement the card rules**

`packages/billing/src/cards.ts`:

```ts
import { BillingCustomerRepo, type BillingCard, type BillingCustomer } from '@repo/db';
import { Payments, type CardDetails } from '@repo/payments';
import { Effect } from 'effect';

/** The card on file for a user at the ACTIVE gateway, or null. A card saved
 * under another provider (the mock, before Stripe was switched on) cannot be
 * charged here and does not count. */
export const cardOnFile = (userId: string) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const row = yield* repo.findByUserId(userId);
    return toCard(row, payments.provider);
  });

export const toCard = (row: BillingCustomer | null, provider: string): BillingCard | null =>
  row !== null &&
  row.provider === provider &&
  row.cardReference !== null &&
  row.cardBrand !== null &&
  row.cardLast4 !== null &&
  row.cardExpMonth !== null &&
  row.cardExpYear !== null
    ? {
        reference: row.cardReference,
        brand: row.cardBrand,
        last4: row.cardLast4,
        expMonth: row.cardExpMonth,
        expYear: row.cardExpYear
      }
    : null;

/** The user's gateway customer, created on first use. A row left by another
 * gateway is replaced. */
export const ensureBillingCustomer = (user: { id: string; email: string; name: string }) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const existing = yield* repo.findByUserId(user.id);
    const current = existing !== null && existing.provider === payments.provider ? existing : null;
    if (current !== null) return current;
    const customerReference = yield* payments.ensureCustomer({
      userId: user.id,
      email: user.email,
      name: user.name,
      existing: null
    });
    return yield* repo.upsertCustomer({
      userId: user.id,
      provider: payments.provider,
      customerReference
    });
  });

/** Makes `card` the user's one card on file. The card it replaces is
 * detached at the gateway — best-effort: a card left attached is harmless,
 * failing a settled payment over it is not. Null when the user has no
 * customer row (helpers never do). */
export const saveCard = (userId: string, card: CardDetails) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const before = yield* repo.findByUserId(userId);
    if (before === null) return null;
    if (before.cardReference === card.reference) return before;
    const after = yield* repo.setCard(userId, {
      reference: card.reference,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear
    });
    if (before.cardReference !== null && before.provider === payments.provider) {
      yield* payments
        .removeCard(before.cardReference)
        .pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(`could not detach replaced card for ${userId}`, error)
          )
        );
    }
    return after;
  });

export type CardSetupResult =
  | { outcome: 'saved'; card: BillingCard }
  /** Not a setup of ours, or of another user's customer. */
  | { outcome: 'not_found' }
  /** Ours, but not finished (or finished without a card). */
  | { outcome: 'incomplete' };

/** Applies a card setup the browser (or the webhook) says finished: re-fetch
 * it, check it belongs to `userId` when one is given, and make its card the
 * card on file. */
export const applyCardSetup = (reference: string, userId: string | null) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const setup = yield* payments.getCardSetup(reference);
    const owner =
      setup.customer === null
        ? null
        : yield* repo.findByCustomerReference(payments.provider, setup.customer);
    if (owner === null || (userId !== null && owner.userId !== userId)) {
      return { outcome: 'not_found' as const };
    }
    if (setup.status !== 'succeeded' || setup.paymentMethod === null) {
      return { outcome: 'incomplete' as const };
    }
    yield* saveCard(owner.userId, setup.paymentMethod);
    const { reference: cardReference, brand, last4, expMonth, expYear } = setup.paymentMethod;
    return {
      outcome: 'saved' as const,
      card: { reference: cardReference, brand, last4, expMonth, expYear }
    };
  });
```

- [ ] **Step 6: Implement settle**

`packages/billing/src/settle.ts`:

```ts
import { BillingCustomerRepo, CheckOrderRepo, PaymentRepo, type Payment } from '@repo/db';
import { publishNotificationBestEffort } from '@repo/notify';
import { Payments, type ProviderPayment } from '@repo/payments';
import { SafetyVerificationQueue } from '@repo/queue';
import { Effect } from 'effect';
import { saveCard } from './cards';

/**
 * settle(paymentId): the ONE path that records money as taken or not.
 *
 * Three callers reach it — the browser's confirm request, the Stripe webhook
 * and the worker's recovery job — in any order and possibly at once. It never
 * trusts the caller: it re-fetches the payment from the provider, checks the
 * fetched object against our row, and applies the outcome with compare-and-set
 * writes, so each outcome lands exactly once whoever gets there first.
 */

export type SettleResult =
  /** This call recorded the capture and moved the order on. */
  | { outcome: 'captured'; payment: Payment }
  /** This call recorded the failure and returned the order to the basket. */
  | { outcome: 'failed'; payment: Payment }
  /** The provider has not finished (3-D Secure, processing): nothing changed. */
  | { outcome: 'pending'; payment: Payment }
  /** Already settled by an earlier or concurrent caller. */
  | { outcome: 'final'; payment: Payment }
  /** The fetched object does not match our row; flagged, nothing else done. */
  | { outcome: 'mismatch'; payment: Payment; reason: string }
  /** Recorded under another provider than the active one; left alone. */
  | { outcome: 'skipped'; payment: Payment };

/** Statuses after which a payment row never moves again here. `authorised`
 * rows are the pre-Stripe mock's settled charges. */
const finalStatuses: ReadonlyArray<Payment['status']> = [
  'captured',
  'authorised',
  'refunded',
  'failed'
];

/** Every check the spec asks for, in order. Null when the fetched intent is
 * ours and for the amount we priced. */
export const mismatchReason = (row: Payment, fetched: ProviderPayment): string | null => {
  if (fetched.metadata.payment_id !== row.id) {
    return `provider payment ${fetched.reference} belongs to ${fetched.metadata.payment_id ?? 'nobody'}, not ${row.id}`;
  }
  if (fetched.amountCents !== row.totalCents) {
    return `provider amount ${fetched.amountCents} does not match ${row.totalCents}`;
  }
  if (fetched.currency.toLowerCase() !== row.currency.toLowerCase()) {
    return `provider currency ${fetched.currency} does not match ${row.currency}`;
  }
  return null;
};

/** The order the payment paid for moves to `paid` and is handed to the
 * worker. Safe to repeat: an order already past `payment_pending` is left
 * alone, and a `paid` one is re-enqueued (the queue dedupes on the order). */
const finishOrder = (payment: Payment, at: Date) =>
  Effect.gen(function* () {
    const orders = yield* CheckOrderRepo;
    const paymentRepo = yield* PaymentRepo;
    const queue = yield* SafetyVerificationQueue;

    const order = yield* orders.findByPaymentId(payment.id);
    if (order !== null && order.status === 'paid') {
      yield* queue.enqueueOrder({ orderId: order.id });
      return;
    }
    if (order !== null && order.status !== 'payment_pending') {
      return;
    }
    const paid =
      order === null
        ? null
        : yield* orders.advance(order.id, {
            from: { status: 'payment_pending', paymentId: payment.id },
            set: { status: 'paid', consentAt: order.consentAt ?? at }
          });
    if (paid === null) {
      const current = yield* orders.findByPaymentId(payment.id);
      if (current !== null && current.status !== 'payment_pending') return;
      // Money was taken and no order is waiting for it. Never silent: the
      // payment carries the note so somebody settles it by hand.
      yield* paymentRepo.update(payment.id, {
        lastError:
          'charge settled but the order was no longer awaiting it — needs manual settlement'
      });
      return;
    }
    // Placing the order happens in the worker so a Credibled outage is a
    // retry rather than a lost payment.
    yield* queue.enqueueOrder({ orderId: paid.id });
    yield* publishNotificationBestEffort(paid.userId, {
      type: 'safety_verification.updated',
      payload: { status: 'payment_pending' }
    });
  });

/** A family's first payment saves its card (`savesCard`). Only for the
 * customer the payment's own user holds — never someone else's. */
const rememberCard = (payment: Payment, fetched: ProviderPayment) =>
  Effect.gen(function* () {
    if (!fetched.savesCard || fetched.paymentMethod === null || fetched.customer === null) {
      return;
    }
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const owner = yield* repo.findByCustomerReference(payments.provider, fetched.customer);
    if (owner === null || owner.userId !== payment.userId) return;
    yield* saveCard(owner.userId, fetched.paymentMethod);
  }).pipe(
    // The charge is recorded; a card we failed to remember can be re-added
    // in Billing. Failing here would only make the webhook retry forever.
    Effect.catchAll((error) => Effect.logWarning(`could not save card for ${payment.id}`, error))
  );

const capture = (row: Payment, fetched: ProviderPayment, at: Date) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const captured = yield* paymentRepo.advance(row.id, {
      from: 'pending',
      set: { status: 'captured', capturedAt: at, receiptUrl: fetched.receiptUrl, lastError: null }
    });
    if (captured === null) {
      return { outcome: 'final' as const, payment: yield* paymentRepo.findById(row.id) };
    }
    yield* finishOrder(captured, at);
    yield* rememberCard(captured, fetched);
    return { outcome: 'captured' as const, payment: captured };
  });

const fail = (row: Payment, reason: string) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const orders = yield* CheckOrderRepo;
    const failed = yield* paymentRepo.advance(row.id, {
      from: 'pending',
      set: { status: 'failed', lastError: reason }
    });
    if (failed === null) {
      return { outcome: 'final' as const, payment: yield* paymentRepo.findById(row.id) };
    }
    // Back to the basket so the applicant can pay again with a fresh charge.
    // Guarded on OUR payment so it can never clobber a re-claim.
    const order = yield* orders.findByPaymentId(row.id);
    if (order !== null) {
      const reverted = yield* orders.advance(order.id, {
        from: { status: 'payment_pending', paymentId: row.id },
        set: { status: 'draft', paymentId: null }
      });
      if (reverted !== null) {
        yield* publishNotificationBestEffort(reverted.userId, {
          type: 'safety_verification.updated',
          payload: { status: 'not_started' }
        });
      }
    }
    return { outcome: 'failed' as const, payment: failed };
  });

const settleRow = (row: Payment, now: () => Date) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;

    if (finalStatuses.includes(row.status)) {
      // A capture whose follow-up never ran (crash between the two writes)
      // is finished here; otherwise this is a no-op.
      if (row.status === 'captured' || row.status === 'authorised') {
        yield* finishOrder(row, now());
      }
      return { outcome: 'final' as const, payment: row };
    }
    if (row.provider !== payments.provider) {
      return { outcome: 'skipped' as const, payment: row };
    }
    if (row.providerReference === null) {
      // The provider was never reached; the order route retries the start.
      return { outcome: 'pending' as const, payment: row };
    }

    const fetched = yield* payments.getPayment(row.providerReference);
    const mismatch = mismatchReason(row, fetched);
    if (mismatch !== null) {
      const flagged = yield* paymentRepo.update(row.id, { lastError: mismatch });
      return { outcome: 'mismatch' as const, payment: flagged, reason: mismatch };
    }

    switch (fetched.status) {
      case 'succeeded':
        return yield* capture(row, fetched, now());
      case 'failed': {
        // A declined intent can still be confirmed with another card. Cancel
        // it before releasing the order so nothing can succeed afterwards —
        // and if it succeeded in the meantime, record that instead.
        const after = yield* payments.cancelPayment(row.providerReference);
        return after.status === 'succeeded'
          ? yield* capture(row, after, now())
          : yield* fail(row, fetched.failureReason ?? 'The payment was declined.');
      }
      case 'canceled':
        return yield* fail(row, fetched.failureReason ?? 'The payment was cancelled.');
      default:
        return { outcome: 'pending' as const, payment: row };
    }
  });

export const settlePayment = (paymentId: string, now: () => Date = () => new Date()) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const row = yield* paymentRepo.findById(paymentId);
    const result: SettleResult = yield* settleRow(row, now);
    return result;
  });

/** The webhook's entry point: it knows the provider's reference, not our id.
 * `unknown` for an intent we never created (another integration on the same
 * Stripe account, or a test event). */
export const settlePaymentByReference = (reference: string, now: () => Date = () => new Date()) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const row = yield* paymentRepo.findByProviderReference(payments.provider, reference);
    if (row === null) return { outcome: 'unknown' as const };
    const result: SettleResult = yield* settleRow(row, now);
    return result;
  });
```

- [ ] **Step 7: Run the tests**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/packages/billing && bun test src`
Expected: PASS (27 tests across 2 files) — succeeded, failed (cancel first), failed-but-succeeded-on-cancel, canceled, requires_action/processing, amount/metadata/currency mismatch, unknown reference, already final, captured-but-unfinished, other provider, three concurrent callers, manual-settlement flag, and the card cases.

- [ ] **Step 8: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add packages/billing packages/notify/src/events.ts bun.lock apps/api/Dockerfile.production apps/worker/Dockerfile.production apps/web/Dockerfile.production Dockerfile.seeds.production Dockerfile.migrations.production
git commit -m "feat(billing): one settle path for browser, webhook and worker; card on file rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Two-step background-check payment, resume and confirm

The order route stops calling `authorise`. It starts a payment (families get a customer and either keep their first card or pay one-click with the saved one; helpers pay one-off), records the provider reference on the `pending` row, and either returns `payment_required` with a client secret or — when the provider settled at once (the mock) — runs `settle` and returns the paid summary. A `payment_pending` order with a `pending` row is resumed, never restarted. `POST /safety-verification/order/confirm` settles a payment for its owner. `authorise` is then deleted from the port.

**Files:**
- Modify: `apps/api/package.json` (dependency), `apps/api/src/lib/auth-roles.ts`, `apps/api/src/routes/app/safety-verification/safety-verification.validator.ts`, `…/safety-verification.handler.ts`, `…/safety-verification.ts`, `…/safety-verification.unit.test.ts`, `packages/payments/src/port.ts`, `packages/payments/src/mock.ts`, `packages/payments/src/stripe.ts`, `bun.lock`

**Interfaces:**
- Consumes: `settlePayment`, `ensureBillingCustomer`, `cardOnFile`, `toCard` (Task 4); `makeInMemoryBillingCustomerRepo`, `dummyBillingCustomer`, `PaymentAdvanceInput` (Task 3); `StartedPayment`, `StartPaymentInput`, `ProviderPaymentStatus` (Task 1).
- Produces:
  - permission statement `billing: ['read', 'write']` on `appAc`, granted to `familyRole`
  - `POST /safety-verification/order` → `{ status: 'paid'; verification }` **or** `{ status: 'payment_required'; paymentId: string; clientSecret: string; provider: 'mock' | 'stripe'; savesCard: boolean; savedCard: { brand; last4; expMonth; expYear } | null }`
  - `POST /safety-verification/order/confirm` body `{ paymentId }` → `{ status: 'paid' | 'failed' | 'pending'; message: string | null }` (`SAFETY_VERIFICATION_NOT_FOUND` for someone else's payment, `SAFETY_VERIFICATION_UNAVAILABLE` when the provider is unreachable)
  - `GET /safety-verification` gains `canResumePayment: boolean`
  - exported `confirmSafetyCheckPaymentRouteProgram`, `confirmSafetyCheckPaymentHandler`, `validateSafetyVerificationConfirmInput`
  - `Payments` no longer has `authorise`; `PaymentAuthorisation` is gone.

- [ ] **Step 1: Dependency and permission**

In `apps/api/package.json` `dependencies`, add `"@repo/billing": "*",` directly above `"@repo/calendar": "*",`, then run `cd /run/media/hbt/work/poppynz/stripe-integration && bun install`.

In `apps/api/src/lib/auth-roles.ts`, in `createAccessControl({…})` add after `approvalRequest: ['read', 'write', 'review'],`:

```ts
  // The card on file and payment history. Only families keep a card (it
  // funds contract billing); helpers pay one-off and never hold this.
  billing: ['read', 'write'],
```

and in `familyRole` add after `profile: ['read', 'update'],`:

```ts
  billing: ['read', 'write'],
```

(`spRole` and `adminRole` do not get it.)

- [ ] **Step 2: Update the unit-test harness**

In `apps/api/src/routes/app/safety-verification/safety-verification.unit.test.ts`:

Add `dummyBillingCustomer,` after `DBNotFoundError,` and `makeInMemoryBillingCustomerRepo,` after `makeCheckOrderRepoTest,` in the `@repo/db` import; add `type PaymentAdvanceInput,` before `type PaymentCreateInput,`.

Replace `import { makeMockPayments, makePaymentsTest, PaymentDeclinedError } from '@repo/payments';` with:

```ts
import {
  makeMockPayments,
  makePaymentsTest,
  PaymentDeclinedError,
  PaymentProviderError,
  type ProviderPaymentStatus,
  type StartPaymentInput
} from '@repo/payments';
```

In the import from `./safety-verification.handler` add `confirmSafetyCheckPaymentRouteProgram,` and `getMySafetyVerificationRouteProgram,` (alphabetical).

In `type Recorded`, replace

```ts
  /** Idempotency keys handed to the provider — one per charge attempt. */
  authorised: Array<string>;
```

with

```ts
  /** What the provider was asked to start — one per charge attempt. */
  started: Array<StartPaymentInput>;
  /** Provider references resumed instead of started again. */
  resumed: Array<string>;
  cancelled: Array<string>;
  paymentAdvances: Array<PaymentAdvanceInput>;
```

and in `record()` replace `authorised: [],` with:

```ts
  started: [],
  resumed: [],
  cancelled: [],
  paymentAdvances: [],
```

In `makeLayer`'s options type, after `declineCharge?: boolean;` add:

```ts
    /** Holds billing:write — keeps a card on file (families). */
    keepsCard?: boolean;
    billing?: ReturnType<typeof makeInMemoryBillingCustomerRepo>;
    /** Overrides the mock's instant success when a payment starts. */
    startedStatus?: ProviderPaymentStatus;
    resumedStatus?: ProviderPaymentStatus;
    /** What re-fetching the payment from the provider says. */
    fetchedStatus?: ProviderPaymentStatus;
    providerDown?: boolean;
```

Replace

```ts
  // The payment row this request creates, so a later update sees the frozen
  // amounts the way the real repository would.
  let current: Payment | null = null;
  const mockPayments = makeMockPayments();
```

with

```ts
  // The order and payment rows as the request leaves them, so settle reads
  // back what the request wrote, the way the real repositories would.
  let currentOrder: CheckOrder | null = openOrder;
  let current: Payment | null = options.paymentById ?? null;
  const mockPayments = makeMockPayments();
  const providerError = (operation: 'getPayment' | 'resumePayment') =>
    Effect.fail(new PaymentProviderError({ operation, cause: 'provider down' }));
```

Replace `userHasPermission: () => Effect.succeed(options.hasPermission ?? true)` (in `makeLayer`'s `makeAuthServiceTest`) with:

```ts
      userHasPermission: (_headers, permissions) =>
        Effect.succeed(
          'billing' in permissions ? (options.keepsCard ?? false) : (options.hasPermission ?? true)
        )
```

In `makeCheckOrderRepoTest({…})` replace the `findById` entry and add `findByPaymentId` right after `findOpen`:

```ts
      findById: (id) =>
        currentOrder && currentOrder.id === id
          ? Effect.succeed(currentOrder)
          : Effect.fail(new DBNotFoundError({ entity: 'checkOrder', value: id })),
      findOpen: () => Effect.succeed(openOrder),
      findByPaymentId: (paymentId) =>
        Effect.succeed(currentOrder?.paymentId === paymentId ? currentOrder : null),
```

and replace its `claimForPayment` and `advance` entries with:

```ts
      claimForPayment: (_id, input) => {
        recorded.claims.push(input);
        if (options.claimLost) return Effect.succeed(null);
        currentOrder = order({
          ...(currentOrder ?? {}),
          status: 'payment_pending',
          paymentId: input.paymentId
        } as Partial<CheckOrder>);
        return Effect.succeed(currentOrder);
      },
      advance: (_id, input) => {
        recorded.advances.push(input);
        if (options.advanceLost) return Effect.succeed(null);
        currentOrder = order({ ...(currentOrder ?? {}), ...input.set } as Partial<CheckOrder>);
        return Effect.succeed(currentOrder);
      },
```

Replace the whole `makePaymentRepoTest({…}),` and `makePaymentsTest({…}),` pair with:

```ts
    makePaymentRepoTest({
      findById: (id) =>
        current && current.id === id
          ? Effect.succeed(current)
          : Effect.fail(new DBNotFoundError({ entity: 'payment', value: id })),
      create: (input) => {
        recorded.paymentsCreated.push(input);
        current = payment({ ...input } as Partial<Payment>);
        return Effect.succeed(current);
      },
      update: (_id, input) => {
        recorded.paymentUpdates.push(input);
        current = payment({ ...(current ?? {}), ...input } as Partial<Payment>);
        return Effect.succeed(current);
      },
      advance: (_id, input) => {
        recorded.paymentAdvances.push(input);
        const from = Array.isArray(input.from) ? input.from : [input.from];
        if (current === null || !from.includes(current.status)) return Effect.succeed(null);
        current = payment({ ...current, ...input.set } as Partial<Payment>);
        return Effect.succeed(current);
      }
    }),
    (options.billing ?? makeInMemoryBillingCustomerRepo([])).layer,
    makePaymentsTest({
      startPayment: (input) => {
        recorded.started.push(input);
        return options.declineCharge
          ? Effect.fail(new PaymentDeclinedError({ reason: 'card declined' }))
          : mockPayments
              .startPayment(input)
              .pipe(
                Effect.map((started) =>
                  options.startedStatus ? { ...started, status: options.startedStatus } : started
                )
              );
      },
      resumePayment: (reference) => {
        recorded.resumed.push(reference);
        return options.providerDown
          ? providerError('resumePayment')
          : Effect.succeed({
              reference,
              clientSecret: `secret_${reference}`,
              status: options.resumedStatus ?? 'requires_action',
              paymentMethodReference: null
            });
      },
      // A payment this request started is the mock's own; one left by an
      // earlier attempt (`paymentById`) reports the status the test asks for.
      getPayment: (reference) => {
        if (options.providerDown) return providerError('getPayment');
        if (reference.startsWith('mock_pi_')) return mockPayments.getPayment(reference);
        const status = options.fetchedStatus ?? 'succeeded';
        return Effect.succeed({
          reference,
          status,
          amountCents: current?.totalCents ?? 0,
          currency: 'cad',
          metadata: { payment_id: current?.id ?? '' },
          customer: null,
          savesCard: false,
          failureReason: status === 'failed' ? 'Your card was declined.' : null,
          receiptUrl: null,
          refundedCents: 0,
          paymentMethod: null
        });
      },
      cancelPayment: (reference) => {
        recorded.cancelled.push(reference);
        return Effect.succeed({
          reference,
          status: 'canceled' as const,
          amountCents: current?.totalCents ?? 0,
          currency: 'cad',
          metadata: { payment_id: current?.id ?? '' },
          customer: null,
          savesCard: false,
          failureReason: null,
          receiptUrl: null,
          refundedCents: 0,
          paymentMethod: null
        });
      }
    }),
```

Replace the whole `describe('ordering a check', () => { … });` block with:

```ts
describe('ordering a check', () => {
  const basketReady = {
    openOrder: order(),
    items: [
      item(),
      item({
        id: 'item-2',
        credibledCheckTypeValue: 'request_motor_vehicle_records',
        costCents: 2500
      })
    ]
  };
  const family = user({ id: 'family-1', role: 'family', name: 'Fam Ily', email: 'f@example.com' });

  const placeOrder = (options: Parameters<typeof makeLayer>[0]) =>
    Effect.runPromise(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer(options))
      )
    );

  it('charges the summed basket once and, when the provider settles at once, hands the order to the worker', async () => {
    const recorded = record();
    const result = await placeOrder({ ...basketReady, recorded });

    // A payment row exists before the provider is asked, frozen at the quote:
    // 4500 + 2500 checks, + 500 fee, 0 tax.
    expect(recorded.paymentsCreated).toHaveLength(1);
    expect(recorded.paymentsCreated[0]).toMatchObject({
      kind: 'credibled_order',
      provider: 'mock',
      amountCents: 7000,
      feeCents: 500,
      totalCents: 7500
    });
    expect(recorded.claims[0]?.paymentId).toBe('payment-1');
    // The payment row is the idempotency key and the intent's metadata.
    expect(recorded.started[0]).toMatchObject({
      idempotencyKey: 'payment-1',
      metadata: { payment_id: 'payment-1', order_id: 'order-1' }
    });
    expect(recorded.paymentUpdates[0]?.providerReference).toBe('mock_pi_payment-1');
    // Settled through the shared path: captured, then the order is paid —
    // only if still claimed for THIS payment.
    expect(recorded.paymentAdvances[0]).toMatchObject({
      from: 'pending',
      set: { status: 'captured' }
    });
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-1' },
      set: { status: 'paid' }
    });
    expect(recorded.enqueued).toEqual(['order-1']);
    expect(recorded.verificationsCreated).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'paid',
      verification: { status: 'payment_pending', cost: { totalCents: 7500 } }
    });
  });

  it('returns a client secret while the payer still has to confirm in the browser', async () => {
    const recorded = record();
    const result = await placeOrder({ ...basketReady, startedStatus: 'requires_action', recorded });

    expect(result).toEqual({
      status: 'payment_required',
      paymentId: 'payment-1',
      clientSecret: 'mock_secret_mock_pi_payment-1',
      provider: 'mock',
      savesCard: false,
      savedCard: null
    });
    // Nothing is recorded as paid until settle sees the provider confirm.
    expect(recorded.paymentAdvances).toHaveLength(0);
    expect(recorded.advances).toHaveLength(0);
    expect(recorded.enqueued).toHaveLength(0);
  });

  it("creates a family's customer and asks for the first card to be kept", async () => {
    const recorded = record();
    const billing = makeInMemoryBillingCustomerRepo([]);
    const result = await placeOrder({
      ...basketReady,
      user: family,
      keepsCard: true,
      billing,
      startedStatus: 'requires_action',
      recorded
    });

    expect(recorded.started[0]).toMatchObject({
      customer: 'mock_cus_family-1',
      savedCard: null,
      saveCard: true
    });
    // The modal tells the family their new card will be kept.
    expect(result).toMatchObject({ status: 'payment_required', savesCard: true });
    expect(billing.rows.get('family-1')?.customerReference).toBe('mock_cus_family-1');
  });

  it('offers a family with a saved card one-click payment with it', async () => {
    const recorded = record();
    const result = await placeOrder({
      ...basketReady,
      user: family,
      keepsCard: true,
      billing: makeInMemoryBillingCustomerRepo([dummyBillingCustomer()]),
      startedStatus: 'requires_action',
      recorded
    });

    expect(recorded.started[0]).toMatchObject({ savedCard: 'mock_pm_saved', saveCard: false });
    expect(result).toMatchObject({
      status: 'payment_required',
      savesCard: false,
      savedCard: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 }
    });
  });

  it('charges a helper one-off: no customer, nothing kept', async () => {
    const recorded = record();
    await placeOrder({ ...basketReady, keepsCard: false, recorded });
    expect(recorded.started[0]).toMatchObject({ customer: null, savedCard: null, saveCard: false });
  });

  it('releases the order and records the failure when the provider refuses to start', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, declineCharge: true, recorded }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationPaymentError');
    expect(recorded.paymentUpdates[0]).toMatchObject({
      status: 'failed',
      lastError: 'card declined'
    });
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-1' },
      set: { status: 'draft', paymentId: null }
    });
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('never charges twice when two requests race for the same draft', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ ...basketReady, claimLost: true, recorded }))
      )
    );

    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
    expect(recorded.paymentUpdates[0]?.status).toBe('failed');
    expect(recorded.started).toHaveLength(0);
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('flags a settled charge whose order moved before it could be marked paid', async () => {
    const recorded = record();
    await placeOrder({ ...basketReady, advanceLost: true, recorded });

    expect(recorded.paymentUpdates.at(-1)?.lastError).toMatch(/manual settlement/);
    expect(recorded.enqueued).toHaveLength(0);
  });

  it('finishes an order whose charge already landed instead of charging again', async () => {
    const recorded = record();
    const result = await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({
        id: 'payment-0',
        status: 'captured',
        providerReference: 'mock_pi_payment-0',
        totalCents: 7500
      }),
      items: basketReady.items,
      recorded
    });

    expect(recorded.paymentsCreated).toHaveLength(0);
    expect(recorded.started).toHaveLength(0);
    expect(recorded.advances[0]).toMatchObject({
      from: { status: 'payment_pending', paymentId: 'payment-0' },
      set: { status: 'paid' }
    });
    expect(recorded.enqueued).toEqual(['order-1']);
    expect(result).toMatchObject({ status: 'paid', verification: { cost: { totalCents: 7500 } } });
  });

  it('restarts a payment the provider never received against the same row and key', async () => {
    const recorded = record();
    await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({ id: 'payment-0', status: 'pending', providerReference: null }),
      items: basketReady.items,
      recorded
    });

    expect(recorded.paymentsCreated).toHaveLength(0);
    expect(recorded.claims).toHaveLength(0);
    expect(recorded.started.map((input) => input.idempotencyKey)).toEqual(['payment-0']);
  });

  it('resumes an unfinished payment with a fresh client secret — never a second intent', async () => {
    const recorded = record();
    const result = await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({ id: 'payment-0', status: 'pending', providerReference: 'pi_0' }),
      items: basketReady.items,
      recorded
    });

    expect(recorded.resumed).toEqual(['pi_0']);
    expect(recorded.started).toHaveLength(0);
    expect(recorded.paymentsCreated).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'payment_required',
      paymentId: 'payment-0',
      clientSecret: 'secret_pi_0'
    });
  });

  it('settles a resumed payment the provider already finished', async () => {
    const recorded = record();
    const result = await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({
        id: 'payment-0',
        status: 'pending',
        providerReference: 'pi_0',
        totalCents: 7500
      }),
      resumedStatus: 'succeeded',
      fetchedStatus: 'succeeded',
      items: basketReady.items,
      recorded
    });

    expect(result).toMatchObject({ status: 'paid' });
    expect(recorded.enqueued).toEqual(['order-1']);
  });

  it('starts a fresh payment when the resumed one had been declined', async () => {
    const recorded = record();
    await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({
        id: 'payment-0',
        status: 'pending',
        providerReference: 'pi_0',
        totalCents: 7500
      }),
      resumedStatus: 'failed',
      fetchedStatus: 'failed',
      items: basketReady.items,
      recorded
    });

    // The declined intent is cancelled and its order released by settle;
    // then the basket is claimed again for a new row.
    expect(recorded.cancelled).toEqual(['pi_0']);
    expect(recorded.claims[0]?.from).toEqual({ status: 'draft', paymentId: null });
    expect(recorded.started[0]?.idempotencyKey).toBe('payment-1');
  });

  it('resumes an order whose previous charge failed', async () => {
    const recorded = record();
    await placeOrder({
      openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
      paymentById: payment({ id: 'payment-0', status: 'failed' }),
      items: basketReady.items,
      recorded
    });

    expect(recorded.claims[0]?.from).toEqual({ status: 'payment_pending', paymentId: 'payment-0' });
    expect(recorded.enqueued).toEqual(['order-1']);
  });

  it('refuses to charge for an empty basket', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ openOrder: order(), items: [] }))
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses when nothing has been selected at all', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer())
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationValidationError');
  });

  it('refuses a second order while one is in progress', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(makeLayer({ openOrder: order({ status: 'invited' }) }))
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
  });

  it('refuses to order while a verdict is live', async () => {
    const recorded = record();
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: true }), new Headers()).pipe(
        Effect.provide(
          makeLayer({ ...basketReady, live: verification({ status: 'review_required' }), recorded })
        )
      )
    );
    expect(failureTag(exit)).toBe('SafetyVerificationConflictError');
    expect(recorded.paymentsCreated).toHaveLength(0);
  });

  it('requires consent', async () => {
    const exit = await Effect.runPromiseExit(
      orderSafetyCheckRouteProgram(contextWithJson({ consentAccepted: false }), new Headers()).pipe(
        Effect.provide(makeLayer(basketReady))
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('tells the page a started payment can be resumed', async () => {
    const result = await Effect.runPromise(
      getMySafetyVerificationRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
            paymentById: payment({ id: 'payment-0', status: 'pending', providerReference: 'pi_0' }),
            items: basketReady.items
          })
        )
      )
    );
    expect(result.canResumePayment).toBe(true);
  });
});

describe('confirming a payment from the browser', () => {
  const pendingPayment = {
    openOrder: order({ status: 'payment_pending', paymentId: 'payment-0' }),
    paymentById: payment({
      id: 'payment-0',
      status: 'pending',
      providerReference: 'pi_0',
      totalCents: 7500
    })
  };
  const confirm = (
    options: Parameters<typeof makeLayer>[0],
    body: unknown = { paymentId: 'payment-0' }
  ) =>
    Effect.runPromiseExit(
      confirmSafetyCheckPaymentRouteProgram(contextWithJson(body), new Headers()).pipe(
        Effect.provide(makeLayer(options))
      )
    );

  it('reports paid once the provider confirms, and moves the order on', async () => {
    const recorded = record();
    const exit = await confirm({ ...pendingPayment, fetchedStatus: 'succeeded', recorded });
    expect(exit).toEqual(Exit.succeed({ status: 'paid', message: null }));
    expect(recorded.enqueued).toEqual(['order-1']);
  });

  it("reports a decline with the provider's message and releases the order", async () => {
    const recorded = record();
    const exit = await confirm({ ...pendingPayment, fetchedStatus: 'failed', recorded });
    expect(exit).toEqual(Exit.succeed({ status: 'failed', message: 'Your card was declined.' }));
    expect(recorded.advances.at(-1)).toMatchObject({ set: { status: 'draft', paymentId: null } });
  });

  it('reports pending while 3-D Secure is still open', async () => {
    const exit = await confirm({ ...pendingPayment, fetchedStatus: 'requires_action' });
    expect(exit).toEqual(Exit.succeed({ status: 'pending', message: null }));
  });

  it("refuses somebody else's payment as not found", async () => {
    const exit = await confirm({
      ...pendingPayment,
      paymentById: payment({ id: 'payment-0', userId: 'someone-else', providerReference: 'pi_0' })
    });
    expect(failureTag(exit)).toBe('SafetyVerificationNotFoundError');
  });

  it('turns an unreachable provider into an unavailable error', async () => {
    const exit = await confirm({ ...pendingPayment, providerDown: true });
    expect(failureTag(exit)).toBe('SafetyVerificationVendorError');
  });

  it('denies an applicant without the write permission', async () => {
    const exit = await confirm({ ...pendingPayment, hasPermission: false });
    expect(failureTag(exit)).toBe('ForbiddenError');
  });

  it('rejects a body without a payment id', async () => {
    const exit = await confirm(pendingPayment, {});
    expect(failureTag(exit)).toBe('RequestValidationError');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run src/routes/app/safety-verification`
Expected: FAIL — `confirmSafetyCheckPaymentRouteProgram` is not exported, and the ordering tests fail on `recorded.started` / `status: 'payment_required'`.

- [ ] **Step 4: Validator for the confirm body**

In `safety-verification.validator.ts`, insert before the `/**\n * Submitting an existing vulnerable-sector document.` doc comment:

```ts
/** The browser finished (or abandoned) confirming a payment. Only the id
 * travels — what happened is re-fetched from the provider. */
export const safetyVerificationConfirmSchema = Schema.Struct({
  paymentId: trimmedNonEmptyString.pipe(Schema.maxLength(64))
});

```

and before `export const validateSafetyVerificationDocumentInput = validateInput(`:

```ts
export const validateSafetyVerificationConfirmInput = validateInput(
  safetyVerificationConfirmSchema,
  safetyVerificationValidationError
);
```

- [ ] **Step 5: Rewrite the order program and add the confirm program**

In `safety-verification.handler.ts`:

Imports — add `import { cardOnFile, ensureBillingCustomer, settlePayment, toCard } from '@repo/billing';` after the `SqlError` import; add `type BillingCard,` before `type CheckOrder,` in the `@repo/db` import; replace

```ts
import { Payments, type QuoteLineItem } from '@repo/payments';
import { SafetyVerificationQueue } from '@repo/queue';
```

with

```ts
import {
  Payments,
  type PaymentProviderError,
  type QuoteLineItem,
  type StartedPayment
} from '@repo/payments';
import type { SafetyVerificationQueueError } from '@repo/queue';
```

add `AuthService,` as the first name in the `@/api/lib/effect-auth` import, and `validateSafetyVerificationConfirmInput,` before `validateSafetyVerificationDecisionInput,` in the validator import.

Directly above `/** Admins are not screened — they have no applicant record and never will. */` add:

```ts
const PAYMENTS_UNAVAILABLE = 'Payments are temporarily unavailable. Please try again shortly.';

/** The provider (or our record of the customer) could not be reached. */
const mapPaymentServiceError = <A, R>(
  effect: Effect.Effect<A, SqlError | PaymentProviderError, R>
): Effect.Effect<A, SafetyVerificationRepoError | SafetyVerificationVendorError, R> =>
  effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new SafetyVerificationRepoError({ cause })),
      PaymentProviderError: () =>
        Effect.fail(new SafetyVerificationVendorError({ reason: PAYMENTS_UNAVAILABLE }))
    })
  );

/** Everything the shared settle path can fail with, as route errors. */
const mapSettleError = <A, R>(
  effect: Effect.Effect<
    A,
    SqlError | DBNotFoundError | PaymentProviderError | SafetyVerificationQueueError,
    R
  >
): Effect.Effect<
  A,
  | SafetyVerificationRepoError
  | SafetyVerificationNotFoundError
  | SafetyVerificationVendorError
  | SafetyVerificationQueueingError,
  R
> =>
  effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new SafetyVerificationRepoError({ cause })),
      DBNotFoundError: () => Effect.fail(new SafetyVerificationNotFoundError()),
      PaymentProviderError: () =>
        Effect.fail(new SafetyVerificationVendorError({ reason: PAYMENTS_UNAVAILABLE })),
      SafetyVerificationQueueError: (error) =>
        Effect.fail(new SafetyVerificationQueueingError({ cause: error.cause }))
    })
  );
```

In `getMySafetyVerificationRouteProgram`'s return value replace

```ts
      canOrderThroughCredibled:
        orderableCheckTypes.length > 0 && credibled.isConfigured(credibledAudienceForRole(role))
    };
```

with

```ts
      canOrderThroughCredibled:
        orderableCheckTypes.length > 0 && credibled.isConfigured(credibledAudienceForRole(role)),
      // A payment was started and the payer never finished confirming it
      // (tab closed, 3-D Secure abandoned): ordering again resumes it.
      canResumePayment: openOrder?.status === 'payment_pending' && payment?.status === 'pending'
    };
```

Replace everything from `export const orderSafetyCheckRouteProgram = ` up to (not including) `export const submitSafetyDocumentRouteProgram = ` with:

```ts
export const orderSafetyCheckRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, safetyVerificationJsonError);
    yield* validateSafetyVerificationOrderInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['write']
    })(authenticated);
    const role = yield* applicantRole(userAndSession);
    const userId = userAndSession.user.id;

    const repo = yield* SafetyVerificationRepo;
    const orders = yield* CheckOrderRepo;
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const credibled = yield* Credibled;
    const typeRepo = yield* KycDocumentTypeRepo;
    const authService = yield* AuthService;
    const policy = yield* policyConfig;

    const audience = credibledAudienceForRole(role);
    if (!credibled.isConfigured(audience)) {
      return yield* Effect.fail(
        new SafetyVerificationVendorError({
          reason: 'Ordering is not available for this account yet.'
        })
      );
    }

    const [types, verification, openOrder] = yield* Effect.all(
      [
        mapRepoError(typeRepo.listActive()),
        mapRepoError(repo.findLive(userId, role)),
        mapRepoError(orders.findOpen(userId, role))
      ],
      { concurrency: 'unbounded' }
    );

    if (verification !== null) {
      return yield* Effect.fail(alreadyInProgress());
    }
    // Ordering settles an existing basket — there is nothing to charge for
    // until the applicant has chosen at least one check.
    if (openOrder === null) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'Choose at least one check before starting.'
        })
      );
    }

    // Only a basket, or a previous attempt at paying for one, can be paid for.
    if (openOrder.status !== 'draft' && openOrder.status !== 'payment_pending') {
      return yield* Effect.fail(alreadyInProgress());
    }

    const items = yield* mapRepoError(orders.listItems(openOrder.id));
    if (items.length === 0) {
      return yield* Effect.fail(
        new SafetyVerificationValidationError({
          message: 'Choose at least one check before starting.'
        })
      );
    }

    const quote = yield* payments.quote(toLineItems(items, types), policy);

    // Who keeps a card on file for later (contract billing) is a permission,
    // not a role check: families hold billing:write, helpers pay one-off.
    const keepsCard = yield* authService.userHasPermission(headers, { billing: ['write'] });

    /** The payer still has to confirm in the browser (card form, 3-D Secure,
     * or one click with the saved card). */
    const paymentRequired = (
      payment: Payment,
      started: StartedPayment,
      card: BillingCard | null
    ) => ({
      status: 'payment_required' as const,
      paymentId: payment.id,
      clientSecret: started.clientSecret,
      provider: payments.provider,
      // A family paying with a new card keeps it: the modal says so.
      savesCard: keepsCard && card === null,
      // Only when the intent really carries the saved card — the modal's
      // one-click button confirms without collecting anything.
      savedCard:
        card !== null && started.paymentMethodReference === card.reference
          ? {
              brand: card.brand,
              last4: card.last4,
              expMonth: card.expMonth,
              expYear: card.expYear
            }
          : null
    });

    /** Money is taken and settle moved the order on: the existing summary. */
    const paidResponse = (orderId: string, payment: Payment) =>
      Effect.gen(function* () {
        const order = yield* orders.findById(orderId).pipe((errors) => mapRepoError(errors));
        return {
          status: 'paid' as const,
          verification: toApplicantSummary({ verification: null, order, payment }, today())
        };
      });

    /** The provider says the payment finished (the mock settles at once):
     * record it through the one settle path, then answer with what it did. */
    const settleAndRespond = (
      order: CheckOrder,
      payment: Payment,
      started: StartedPayment,
      card: BillingCard | null
    ) =>
      Effect.gen(function* () {
        const result = yield* settlePayment(payment.id).pipe((errors) => mapSettleError(errors));
        if (isSettledPayment(result.payment)) {
          return yield* paidResponse(order.id, result.payment);
        }
        if (result.payment.status === 'failed') {
          return yield* Effect.fail(
            new SafetyVerificationPaymentError({
              reason: result.payment.lastError ?? 'The payment was declined.'
            })
          );
        }
        return paymentRequired(result.payment, started, card);
      });

    /** Ask the provider to start a payment against a payment row. */
    const charge = (claimed: CheckOrder, payment: Payment) =>
      Effect.gen(function* () {
        const declined = (reason: string) =>
          Effect.gen(function* () {
            // Release the order so the applicant can try again with a fresh
            // charge; the failed row stays as the record of the attempt. The
            // revert is guarded on OUR payment so it cannot clobber a re-claim
            // that got in first.
            yield* mapRepoError(
              paymentRepo.update(payment.id, { status: 'failed', lastError: reason })
            );
            yield* mapRepoError(
              orders.advance(claimed.id, {
                from: { status: 'payment_pending', paymentId: payment.id },
                set: { status: 'draft', paymentId: null }
              })
            );
            return yield* Effect.fail(new SafetyVerificationPaymentError({ reason }));
          });

        const customer = keepsCard
          ? yield* ensureBillingCustomer({
              id: userId,
              email: userAndSession.user.email,
              name: userAndSession.user.name
            }).pipe((errors) => mapPaymentServiceError(errors))
          : null;
        const card = toCard(customer, payments.provider);

        // The payment row's id is the idempotency key: a retry against the
        // same row is the same intent at the provider, never a second one.
        const started = yield* payments
          .startPayment({
            quote,
            idempotencyKey: payment.id,
            metadata: { payment_id: payment.id, order_id: claimed.id, kind: payment.kind },
            customer: customer?.customerReference ?? null,
            savedCard: card?.reference ?? null,
            // A family's first card is kept for contract billing.
            saveCard: keepsCard && card === null
          })
          .pipe(
            Effect.catchTags({
              PaymentDeclinedError: (error) => declined(error.reason),
              PaymentProviderError: () => declined('Payment could not be processed.')
            })
          );

        const recorded = yield* paymentRepo
          .update(payment.id, { providerReference: started.reference, lastError: null })
          .pipe((errors) => mapRepoError(errors));

        return started.status === 'succeeded'
          ? yield* settleAndRespond(claimed, recorded, started, card)
          : paymentRequired(recorded, started, card);
      });

    /** A fresh payment row, and the order claimed for it. Compare-and-set:
     * two concurrent requests can both reach here with the same draft, but
     * only one claim lands. The loser's row never reaches the provider, so it
     * is closed out rather than left pending. */
    const claimWithNewPayment = (from: CheckOrderClaimInput['from']) =>
      Effect.gen(function* () {
        // The row exists BEFORE the provider is asked for money. The itemised
        // breakdown is frozen here and never recomputed for display, so a
        // later fee or tax change cannot rewrite what somebody was charged.
        const payment = yield* mapRepoError(
          paymentRepo.create({
            userId,
            kind: 'credibled_order',
            provider: payments.provider,
            amountCents: quote.amountCents,
            feeCents: quote.feeCents,
            taxCents: quote.taxCents,
            totalCents: quote.totalCents,
            currency: quote.currency
          })
        );
        const claimed = yield* mapRepoError(
          orders.claimForPayment(openOrder.id, { paymentId: payment.id, from })
        );
        if (claimed === null) {
          yield* paymentRepo
            .update(payment.id, {
              status: 'failed',
              lastError: 'order was claimed by a concurrent request'
            })
            .pipe(Effect.ignore);
          return yield* Effect.fail(alreadyInProgress());
        }
        return yield* charge(claimed, payment);
      });

    if (openOrder.status === 'draft') {
      return yield* claimWithNewPayment({ status: 'draft', paymentId: openOrder.paymentId });
    }

    // An order left in `payment_pending` is a previous attempt that never
    // finished. Its payment row says which kind, and each is recoverable —
    // a stale claim must never lock the applicant out, and a charge that
    // landed must never be taken again:
    //   - settled: settle finishes the job with the money already taken;
    //   - pending, provider never reached: start again with the SAME row and
    //     key, so the provider sees one intent, not two;
    //   - pending at the provider: resume that intent with a fresh client
    //     secret — never a second intent;
    //   - failed (or gone): start over with a fresh row, claiming from exactly
    //     the state we saw.
    const previous = openOrder.paymentId
      ? yield* mapRepoError(orNull(paymentRepo.findById(openOrder.paymentId)))
      : null;
    if (previous !== null && isSettledPayment(previous)) {
      const result = yield* settlePayment(previous.id).pipe((errors) => mapSettleError(errors));
      return yield* paidResponse(openOrder.id, result.payment);
    }
    if (previous !== null && previous.status === 'pending') {
      if (previous.providerReference === null) {
        return yield* charge(openOrder, previous);
      }
      const resumed = yield* payments
        .resumePayment(previous.providerReference)
        .pipe((errors) => mapPaymentServiceError(errors));
      if (resumed.status === 'requires_action') {
        const card = keepsCard
          ? yield* cardOnFile(userId).pipe((errors) => mapPaymentServiceError(errors))
          : null;
        return paymentRequired(previous, resumed, card);
      }
      // The provider already decided. Record it; a failure released the
      // order, so this request starts a fresh payment for the same basket.
      const result = yield* settlePayment(previous.id).pipe((errors) => mapSettleError(errors));
      if (isSettledPayment(result.payment)) {
        return yield* paidResponse(openOrder.id, result.payment);
      }
      if (result.payment.status === 'failed') {
        return yield* claimWithNewPayment({ status: 'draft', paymentId: null });
      }
      return yield* Effect.fail(
        new SafetyVerificationConflictError({
          message: 'Your previous payment is still being processed. Check back in a few minutes.'
        })
      );
    }
    return yield* claimWithNewPayment({
      status: 'payment_pending',
      paymentId: openOrder.paymentId
    });
  });

/** Called by the payment modal once the browser has confirmed (or failed to
 * confirm). Never trusts the browser: it settles from the provider's state. */
export const confirmSafetyCheckPaymentRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, safetyVerificationJsonError);
    const input = yield* validateSafetyVerificationConfirmInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, {
      safetyVerification: ['write']
    })(authenticated);
    yield* applicantRole(userAndSession);

    const paymentRepo = yield* PaymentRepo;
    const payment = yield* paymentRepo
      .findById(input.paymentId)
      .pipe((errors) => mapRepoError(errors));
    // Owner only — somebody else's payment id reads as not found.
    if (payment.userId !== userAndSession.user.id) {
      return yield* Effect.fail(new SafetyVerificationNotFoundError());
    }

    const result = yield* settlePayment(payment.id).pipe((errors) => mapSettleError(errors));
    if (isSettledPayment(result.payment)) {
      return { status: 'paid' as const, message: null };
    }
    if (result.payment.status === 'failed') {
      return {
        status: 'failed' as const,
        message: result.payment.lastError ?? 'The payment was declined.'
      };
    }
    return { status: 'pending' as const, message: null };
  });
```

In `type SafetyVerificationRouteError`, after the `orderSafetyCheckRouteProgram` line add:

```ts
  | Effect.Effect.Error<ReturnType<typeof confirmSafetyCheckPaymentRouteProgram>>
```

(No mapper change: every error the new programs raise is an existing tag — `errorToResponse` still ends in `handleNever`.)

Above `export async function submitSafetyDocumentHandler` add:

```ts
export async function confirmSafetyCheckPaymentHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    confirmSafetyCheckPaymentRouteProgram(c, c.req.raw.headers)
  );
  return exitToResponse(c, exit);
}

```

- [ ] **Step 6: Mount the confirm route**

In `safety-verification.ts` add `confirmSafetyCheckPaymentHandler,` to the handler import; replace the doc comment's last line ` * settles it with \`/order\`. */` with

```ts
 * pays for it with `/order`; the payment modal reports back to
 * `/order/confirm`. */
```

and after `.post('/order', (c) => orderSafetyCheckHandler(c))` add:

```ts
  .post('/order/confirm', (c) => confirmSafetyCheckPaymentHandler(c))
```

- [ ] **Step 7: Remove `authorise` from the port**

- `packages/payments/src/port.ts`: delete the `PaymentAuthorisation` type (with its doc comment) and the deprecated `authorise` member of `Payments` (with its doc comment).
- `packages/payments/src/mock.ts`: delete `type PaymentAuthorisation,` from the import, the `authorisations` map, and the whole `authorise: …` entry with its two comment lines.
- `packages/payments/src/stripe.ts`: delete the `authorise: () => …` entry with its two comment lines.

Verify: `grep -rn "authorise\b\|PaymentAuthorisation" packages/payments/src apps/api/src apps/worker/src --include=*.ts | grep -v "authorised"` → no output.

- [ ] **Step 8: Run the tests and the build**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/packages/payments && bun test src && cd ../billing && bun test src`
Expected: PASS.

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bun run build && bunx vitest run src/routes/app/safety-verification`
Expected: build exits 0; 54 tests PASS.

- [ ] **Step 9: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/api packages/payments bun.lock
git commit -m "feat(api): two-step check payments with saved cards, resume and confirm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Billing routes

**Files:**
- Create: `apps/api/src/routes/app/billing/billing.validator.ts`, `billing.handler.ts`, `billing.ts`, `billing.unit.test.ts`
- Modify: `apps/api/src/routes/app/index.ts`

**Interfaces:**
- Consumes: `ensureBillingCustomer`, `applyCardSetup`, `toCard` (Task 4); `BillingCustomerRepo`, `PaymentRepo.listByUser` (Task 3); `billing` permission (Task 5).
- Produces:
  - `GET /billing` (`billing:read`) → `{ card: { brand; last4; expMonth; expYear } | null; payments: Array<{ id; createdAt: string; description; totalCents; currency; status: 'paid' | 'refunded' | 'failed' | 'pending'; receiptUrl: string | null }>; provider: 'mock' | 'stripe' }`
  - `POST /billing/card/setup` (`billing:write`) → `{ setupId; clientSecret; provider }`
  - `POST /billing/card/confirm` (`billing:write`) body `{ setupId }` → `{ card: { brand; last4; expMonth; expYear } }`
  - error codes `BILLING_CARD_SETUP_NOT_FOUND` 404, `BILLING_CARD_SETUP_INCOMPLETE` 409, `BILLING_PROVIDER_UNAVAILABLE` 503, `INVALID_BILLING_INPUT` 400, `INTERNAL_SERVER_ERROR` 500, plus the auth codes

- [ ] **Step 1: Write the failing tests**

`apps/api/src/routes/app/billing/billing.unit.test.ts`:

```ts
import { SqlError } from '@effect/sql/SqlError';
import {
  DBNotFoundError,
  dummyBillingCustomer,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type BillingCustomer,
  type PaymentHistoryItem,
  type Session,
  type User
} from '@repo/db';
import { makePaymentsTest, PaymentProviderError, type ProviderCardSetup } from '@repo/payments';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  confirmCardSetupRouteProgram,
  getBillingRouteProgram,
  startCardSetupRouteProgram
} from './billing.handler';

const family = {
  id: 'family-1',
  name: 'Fam Ily',
  email: 'family@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  isAnonymous: false,
  role: 'family',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
} as User;

const session = { id: 'session-1', userId: 'family-1' } as Session;

const historyRow = (overrides: Partial<PaymentHistoryItem> = {}): PaymentHistoryItem =>
  ({
    id: 'payment-1',
    userId: 'family-1',
    kind: 'credibled_order',
    status: 'captured',
    provider: 'mock',
    providerReference: 'mock_pi_payment-1',
    totalCents: 7500,
    currency: 'CAD',
    receiptUrl: 'https://pay.stripe.com/receipts/r1',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    description: 'Background check',
    ...overrides
  }) as PaymentHistoryItem;

const contextWithJson = (body: unknown) =>
  ({ req: { json: () => Promise.resolve(body) } }) as unknown as HonoContext<HonoEnv>;

const failureTag = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  return Option.isSome(failure) ? (failure.value as { _tag: string })._tag : null;
};

const makeLayer = (
  options: {
    hasPermission?: boolean;
    billing?: Array<BillingCustomer>;
    history?: Array<PaymentHistoryItem>;
    historyFails?: boolean;
    setup?: ProviderCardSetup;
    providerDown?: boolean;
    removed?: Array<string>;
  } = {}
) => {
  const billing = makeInMemoryBillingCustomerRepo(options.billing ?? []);
  const layer = Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: family.id }, session: { id: session.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: (id) =>
        id === family.id
          ? Effect.succeed(family)
          : Effect.fail(new DBNotFoundError({ entity: 'user', value: id })),
      findByEmail: () => Effect.succeed(family)
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session) }),
    billing.layer,
    makePaymentRepoTest({
      listByUser: () =>
        options.historyFails
          ? Effect.fail(new SqlError({ cause: 'down' }))
          : Effect.succeed(options.history ?? [])
    }),
    makePaymentsTest({
      startCardSetup: (customer) =>
        options.providerDown
          ? Effect.fail(new PaymentProviderError({ operation: 'startCardSetup', cause: 'down' }))
          : Effect.succeed({ reference: `seti_for_${customer}`, clientSecret: 'seti_secret' }),
      getCardSetup: (reference) =>
        Effect.succeed(
          options.setup ?? {
            reference,
            status: 'succeeded',
            customer: 'mock_cus_family-1',
            paymentMethod: {
              reference: 'mock_pm_new',
              brand: 'mastercard',
              last4: '4444',
              expMonth: 3,
              expYear: 2031
            }
          }
        ),
      removeCard: (reference) => Effect.sync(() => void options.removed?.push(reference))
    })
  );
  return { layer, billing };
};

describe('GET /billing', () => {
  it('shows the card on file and the payment history, newest first as the repo returns it', async () => {
    const { layer } = makeLayer({
      billing: [dummyBillingCustomer()],
      history: [historyRow(), historyRow({ id: 'payment-0', status: 'failed', receiptUrl: null })]
    });
    const result = await Effect.runPromise(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({
      card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 },
      payments: [
        {
          id: 'payment-1',
          createdAt: '2026-10-01T10:00:00.000Z',
          description: 'Background check',
          totalCents: 7500,
          currency: 'CAD',
          status: 'paid',
          receiptUrl: 'https://pay.stripe.com/receipts/r1'
        },
        {
          id: 'payment-0',
          createdAt: '2026-10-01T10:00:00.000Z',
          description: 'Background check',
          totalCents: 7500,
          currency: 'CAD',
          status: 'failed',
          receiptUrl: null
        }
      ],
      provider: 'mock'
    });
  });

  it('shows no card when none is saved', async () => {
    const { layer } = makeLayer();
    const result = await Effect.runPromise(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(result.card).toBeNull();
  });

  it('denies a user without the billing permission (helpers)', async () => {
    const { layer } = makeLayer({ hasPermission: false });
    const exit = await Effect.runPromiseExit(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(failureTag(exit)).toBe('ForbiddenError');
  });

  it('maps a database failure to the repo error', async () => {
    const { layer } = makeLayer({ historyFails: true });
    const exit = await Effect.runPromiseExit(
      getBillingRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(failureTag(exit)).toBe('BillingRepoError');
  });
});

describe('POST /billing/card/setup', () => {
  it("creates the family's customer on first use and starts a setup for it", async () => {
    const { layer, billing } = makeLayer();
    const result = await Effect.runPromise(
      startCardSetupRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(result).toEqual({
      setupId: 'seti_for_mock_cus_family-1',
      clientSecret: 'seti_secret',
      provider: 'mock'
    });
    expect(billing.rows.get('family-1')?.customerReference).toBe('mock_cus_family-1');
  });

  it('maps an unreachable provider to the provider error', async () => {
    const { layer } = makeLayer({ providerDown: true });
    const exit = await Effect.runPromiseExit(
      startCardSetupRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(failureTag(exit)).toBe('BillingProviderError');
  });

  it('denies a user without the billing permission', async () => {
    const { layer } = makeLayer({ hasPermission: false });
    const exit = await Effect.runPromiseExit(
      startCardSetupRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(failureTag(exit)).toBe('ForbiddenError');
  });
});

describe('POST /billing/card/confirm', () => {
  const confirm = (
    layer: ReturnType<typeof makeLayer>['layer'],
    body: unknown = { setupId: 'seti_1' }
  ) =>
    Effect.runPromiseExit(
      confirmCardSetupRouteProgram(contextWithJson(body), new Headers()).pipe(Effect.provide(layer))
    );

  it('replaces the card on file and detaches the old one', async () => {
    const removed: Array<string> = [];
    const { layer, billing } = makeLayer({ billing: [dummyBillingCustomer()], removed });
    const exit = await confirm(layer);

    expect(exit).toEqual(
      Exit.succeed({ card: { brand: 'mastercard', last4: '4444', expMonth: 3, expYear: 2031 } })
    );
    expect(billing.rows.get('family-1')?.cardReference).toBe('mock_pm_new');
    expect(removed).toEqual(['mock_pm_saved']);
  });

  it("refuses a setup that belongs to another user's customer", async () => {
    const { layer } = makeLayer({
      billing: [dummyBillingCustomer()],
      setup: {
        reference: 'seti_1',
        status: 'succeeded',
        customer: 'mock_cus_someone-else',
        paymentMethod: null
      }
    });
    expect(failureTag(await confirm(layer))).toBe('BillingCardSetupNotFoundError');
  });

  it('refuses a setup the provider has not finished', async () => {
    const { layer } = makeLayer({
      billing: [dummyBillingCustomer()],
      setup: {
        reference: 'seti_1',
        status: 'requires_action',
        customer: 'mock_cus_family-1',
        paymentMethod: null
      }
    });
    expect(failureTag(await confirm(layer))).toBe('BillingCardSetupIncompleteError');
  });

  it('rejects a body without a setup id', async () => {
    const { layer } = makeLayer({ billing: [dummyBillingCustomer()] });
    expect(failureTag(await confirm(layer, {}))).toBe('RequestValidationError');
  });

  it('denies a user without the billing permission', async () => {
    const { layer } = makeLayer({ hasPermission: false });
    expect(failureTag(await confirm(layer))).toBe('ForbiddenError');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run src/routes/app/billing`
Expected: FAIL — `Cannot find module './billing.handler'`.

- [ ] **Step 3: Implement the routes**

`apps/api/src/routes/app/billing/billing.validator.ts`:

```ts
import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const billingValidationError = {
  code: 'INVALID_BILLING_INPUT',
  message: 'Billing input contains invalid or unsupported fields.'
} as const;

/** The browser finished a card setup. Only the id travels — what happened is
 * re-fetched from the provider. */
export const billingCardConfirmSchema = Schema.Struct({
  setupId: Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(255))
});

export const validateBillingCardConfirmInput = validateInput(
  billingCardConfirmSchema,
  billingValidationError
);

export const billingJsonError = billingValidationError;
```

`apps/api/src/routes/app/billing/billing.handler.ts`:

```ts
import type { SqlError } from '@effect/sql/SqlError';
import { applyCardSetup, ensureBillingCustomer, toCard } from '@repo/billing';
import { BillingCustomerRepo, PaymentRepo, type BillingCard } from '@repo/db';
import { Payments, type PaymentProviderError } from '@repo/payments';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authenticate,
  authErrorToResponse,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import { billingJsonError, validateBillingCardConfirmInput } from './billing.validator';

export class BillingRepoError extends Data.TaggedError('BillingRepoError')<{ cause: SqlError }> {}
export class BillingProviderError extends Data.TaggedError('BillingProviderError')<{}> {}
/** A setup id that is not the caller's (or not ours at all). */
export class BillingCardSetupNotFoundError extends Data.TaggedError(
  'BillingCardSetupNotFoundError'
)<{}> {}
/** The setup exists but the provider has not finished it. */
export class BillingCardSetupIncompleteError extends Data.TaggedError(
  'BillingCardSetupIncompleteError'
)<{}> {}

const mapBillingError = <A, R>(
  effect: Effect.Effect<A, SqlError | PaymentProviderError, R>
): Effect.Effect<A, BillingRepoError | BillingProviderError, R> =>
  effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new BillingRepoError({ cause })),
      PaymentProviderError: () => Effect.fail(new BillingProviderError())
    })
  );

const mapRepoError = <A, R>(
  effect: Effect.Effect<A, SqlError, R>
): Effect.Effect<A, BillingRepoError, R> =>
  effect.pipe(Effect.catchTag('SqlError', (cause) => Effect.fail(new BillingRepoError({ cause }))));

/** Display fields only — the card reference never leaves the server. */
const toCardResponse = (card: BillingCard | null) =>
  card === null
    ? null
    : { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear };

const paymentStatusLabel = {
  pending: 'pending',
  authorised: 'paid',
  captured: 'paid',
  refunded: 'refunded',
  failed: 'failed'
} as const;

/** The card on file and the payment history. */
export const getBillingRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { billing: ['read'] })(authenticated);
    const userId = userAndSession.user.id;
    const repo = yield* BillingCustomerRepo;
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;

    const [customer, history] = yield* Effect.all(
      [
        repo.findByUserId(userId).pipe((errors) => mapRepoError(errors)),
        paymentRepo.listByUser(userId).pipe((errors) => mapRepoError(errors))
      ],
      { concurrency: 'unbounded' }
    );

    return {
      card: toCardResponse(toCard(customer, payments.provider)),
      payments: history.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        description: row.description,
        totalCents: row.totalCents,
        currency: row.currency,
        status: paymentStatusLabel[row.status],
        receiptUrl: row.receiptUrl
      })),
      provider: payments.provider
    };
  });

/** Starts adding (or replacing) the card on file: a setup the browser
 * confirms in the payment modal. */
export const startCardSetupRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { billing: ['write'] })(
      authenticated
    );
    const payments = yield* Payments;
    const customer = yield* ensureBillingCustomer({
      id: userAndSession.user.id,
      email: userAndSession.user.email,
      name: userAndSession.user.name
    }).pipe((errors) => mapBillingError(errors));
    const setup = yield* payments
      .startCardSetup(customer.customerReference)
      .pipe((errors) => mapBillingError(errors));
    return {
      setupId: setup.reference,
      clientSecret: setup.clientSecret,
      provider: payments.provider
    };
  });

/** The browser finished a setup: re-fetch it and make its card the one on
 * file (detaching the card it replaces). */
export const confirmCardSetupRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, billingJsonError);
    const input = yield* validateBillingCardConfirmInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { billing: ['write'] })(
      authenticated
    );
    const result = yield* applyCardSetup(input.setupId, userAndSession.user.id).pipe((errors) =>
      mapBillingError(errors)
    );
    switch (result.outcome) {
      case 'not_found':
        return yield* Effect.fail(new BillingCardSetupNotFoundError());
      case 'incomplete':
        return yield* Effect.fail(new BillingCardSetupIncompleteError());
      case 'saved': {
        const { brand, last4, expMonth, expYear } = result.card;
        return { card: { brand, last4, expMonth, expYear } };
      }
    }
  });

export type BillingRouteError =
  | Effect.Effect.Error<ReturnType<typeof getBillingRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof startCardSetupRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof confirmCardSetupRouteProgram>>;

const billingErrorToResponse = (c: HonoContext<HonoEnv>, error: BillingRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'BillingCardSetupNotFoundError':
      return c.json(
        {
          error: {
            code: 'BILLING_CARD_SETUP_NOT_FOUND' as const,
            message: 'That card setup was not found.'
          }
        },
        404
      );
    case 'BillingCardSetupIncompleteError':
      return c.json(
        {
          error: {
            code: 'BILLING_CARD_SETUP_INCOMPLETE' as const,
            message: 'The card has not been confirmed yet. Please try again.'
          }
        },
        409
      );
    case 'BillingProviderError':
      return c.json(
        {
          error: {
            code: 'BILLING_PROVIDER_UNAVAILABLE' as const,
            message: 'Payments are temporarily unavailable. Please try again shortly.'
          }
        },
        503
      );
    case 'BillingRepoError':
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, BillingRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return billingErrorToResponse(c, failure.value);
      }
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function getBillingHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(getBillingRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function startCardSetupHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(startCardSetupRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function confirmCardSetupHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(confirmCardSetupRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
```

`apps/api/src/routes/app/billing/billing.ts`:

```ts
import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  confirmCardSetupHandler,
  getBillingHandler,
  startCardSetupHandler
} from './billing.handler';

/** A family's card on file and payment history (billing permission). */
export const billingRoute = new Hono<HonoEnv>()
  .get('/', (c) => getBillingHandler(c))
  .post('/card/setup', (c) => startCardSetupHandler(c))
  .post('/card/confirm', (c) => confirmCardSetupHandler(c));
```

In `apps/api/src/routes/app/index.ts` add `import { billingRoute } from './billing/billing';` after the `approvalRoute` import, and after `.route('/safety-verification', safetyVerificationRoute)` add:

```ts
  .route('/billing', billingRoute)
```

- [ ] **Step 4: Run the tests and the build**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run src/routes/app/billing && bun run build`
Expected: 12 tests PASS; build exits 0.

- [ ] **Step 5: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/api/src/routes/app/billing apps/api/src/routes/app/index.ts
git commit -m "feat(api): billing — card on file, card setup and payment history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A card on file is required to send contract terms

**Files:**
- Modify: `apps/api/src/routes/app/contracts/contracts.handler.ts`, `apps/api/src/routes/app/contracts/contracts.unit.test.ts`

**Interfaces:**
- Consumes: `cardOnFile` (Task 4); `makeInMemoryBillingCustomerRepo`, `dummyBillingCustomer` (Task 3); `makePaymentsTest` (Task 1).
- Produces: `PaymentMethodRequiredError` (exported) → `422 PAYMENT_METHOD_REQUIRED` with message "Add a card in Billing before sending — it's used for contract billing."; `GET /contracts/:id` → `contract.hasPaymentMethod: boolean | null` (null for the provider viewer); `contract.actions.canSend` additionally requires `hasPaymentMethod === true`.

- [ ] **Step 1: Give the test layer a card and add the failing tests**

In `contracts.unit.test.ts`: add `dummyBillingCustomer,` before `dummyContract,` and `makeInMemoryBillingCustomerRepo,` after `dummyContractVersion,` in the `@repo/db` import; add `import { makePaymentsTest } from '@repo/payments';` after the `@repo/notify` import.

In `makeLayer`'s options type, after the `familyLocation` option add:

```ts
    /** Whether the family has a card on file. Defaults to true. */
    familyCard?: boolean;
```

and make the first entries of its `Layer.mergeAll(` call:

```ts
  return Layer.mergeAll(
    // Sending needs a card on file; these suites assert other behaviour, so
    // the family has one unless a test says otherwise.
    makeInMemoryBillingCustomerRepo(options.familyCard === false ? [] : [dummyBillingCustomer()])
      .layer,
    makePaymentsTest({}),
```

In `describe('POST /contracts/:id/send'…)`, directly above `it("stamps the family's time zone on the version it sends"`, add:

```ts
  it('refuses to send without a card on file — contract billing charges it', async () => {
    const calls: Array<string> = [];
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            familyCard: false,
            calls
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'PaymentMethodRequiredError' });
    expect(calls).toEqual([]);
  });
```

In `describe('GET /contracts/:id'…)`, directly above `it("uses the family's current zone, not an old version's, while they revise"`, add:

```ts
  it('tells the family whether a card is on file and offers Send only with one', async () => {
    const detail = (familyCard: boolean) =>
      Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              familyCard,
              contractWithContext: withContext(
                baseContract({ status: 'draft' }),
                [draftVersion()],
                'family-1'
              ),
              conversationById: activeConversation()
            })
          )
        )
      );

    const withCard = (await detail(true)).contract;
    expect(withCard.hasPaymentMethod).toBe(true);
    expect(withCard.actions.canSend).toBe(true);

    const withoutCard = (await detail(false)).contract;
    expect(withoutCard.hasPaymentMethod).toBe(false);
    expect(withoutCard.actions).toMatchObject({ canEditTerms: true, canSend: false });
  });

  it('does not tell the provider about the family card', async () => {
    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractWithContext: withContext(
              baseContract({ status: 'proposed' }),
              [proposedVersion()],
              'provider-1'
            ),
            conversationById: activeConversation()
          })
        )
      )
    );
    expect(contract.hasPaymentMethod).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run src/routes/app/contracts`
Expected: FAIL — the three new tests (no `PaymentMethodRequiredError`, `hasPaymentMethod` undefined); the existing 109 pass.

- [ ] **Step 3: Implement**

In `contracts.handler.ts`:

Add `import { cardOnFile } from '@repo/billing';` after the `SqlError` import.

Above `/** Postgres unique-constraint violation (SQLSTATE 23505)` add:

```ts
/** Sending terms needs a card on file — contract billing charges it. */
export class PaymentMethodRequiredError extends Data.TaggedError(
  'PaymentMethodRequiredError'
)<{}> {}

```

In `sendContractProgram`, directly after

```ts
    if (pending.startsOn <= todayIn(timeZone)) {
      return yield* Effect.fail(new StartDateNotInFutureError());
    }
```

add:

```ts
    // Contract billing charges the family's card, so terms only go out once
    // there is one on file. Checked last: every other problem with the draft
    // is something to fix in the editor first.
    const card = yield* cardOnFile(viewer.id).pipe((errors) => mapContractRepoError(errors));
    if (card === null) {
      return yield* Effect.fail(new PaymentMethodRequiredError());
    }
```

In `getContractProgram`, directly above `const effective = effectiveEnd(row, accepted);` add:

```ts
    // Only the family pays, so only the family is told whether a card is on
    // file; for the provider it is null rather than a misleading false.
    const hasPaymentMethod = isFamily
      ? (yield* cardOnFile(viewer.id).pipe((errors) => mapContractRepoError(errors))) !== null
      : null;
```

In its returned `contract`, after `acceptBlockedReason,` add `hasPaymentMethod,`, and replace the `canSend` entry (with its comment) by:

```ts
          // Send stamps the family's zone and needs a card on file; without
          // either it would refuse (FAMILY_LOCATION_REQUIRED /
          // PAYMENT_METHOD_REQUIRED), so it isn't offered.
          canSend:
            isFamily &&
            preActiveEditable &&
            pending?.status === 'draft' &&
            timeZone !== null &&
            hasPaymentMethod === true,
```

In `contractRouteErrorToResponse`, directly above `case 'ContractStartDatePassedError':` add:

```ts
    case 'PaymentMethodRequiredError':
      return c.json(
        {
          error: {
            code: 'PAYMENT_METHOD_REQUIRED' as const,
            message: "Add a card in Billing before sending — it's used for contract billing."
          }
        },
        422
      );
```

- [ ] **Step 4: Run the tests and the build**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run src/routes/app/contracts src/routes/app/conversations && bun run build`
Expected: contracts 112 PASS, conversations PASS; build exits 0.

- [ ] **Step 5: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/api/src/routes/app/contracts
git commit -m "feat(api): require a card on file to send contract terms (PAYMENT_METHOD_REQUIRED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `POST /webhooks/stripe`

**Files:**
- Create: `apps/api/src/routes/webhooks/stripe.ts`, `apps/api/src/routes/webhooks/stripe.unit.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `Payments.verifyWebhook` / `getPayment` (Tasks 1–2), `StripeWebhookEventRepo`, `PaymentRepo.findByProviderReference` / `advance` / `update` (Task 3), `settlePaymentByReference`, `applyCardSetup`, `mismatchReason` (Task 4).
- Produces: `stripeWebhookRoute` mounted at `/webhooks/stripe` (outside `/api/v1`, next to Credibled's); exported `processStripeEvent(event) → Effect<string, …>` and `stripeWebhookProgram(rawBody, signature) → Effect<{ status: 200 | 400 | 413 | 500; body }, SqlError, …>`. Responses: bad/missing signature 400 `{ error: 'invalid signature' }`; body over 512 KiB 413; already-processed event 200 `{ received: true, duplicate: true }`; processed 200 `{ received: true }`; processing failure → `markFailed` + 500.

Event dispatch: `payment_intent.succeeded | payment_failed | canceled | processing` → `settlePaymentByReference(objectId)`; `setup_intent.succeeded` → `applyCardSetup(objectId, null)`; `charge.refunded` → re-fetch the intent and `advance` captured/authorised → `refunded` only when fully refunded; `charge.dispute.created` → `lastError: 'card dispute opened'`; `account.updated` → acknowledged (piece 2b); anything else → acknowledged.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/routes/webhooks/stripe.unit.test.ts`:

```ts
import { SqlError } from '@effect/sql/SqlError';
import {
  dummyBillingCustomer,
  makeCheckOrderRepoTest,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  makeStripeWebhookEventRepoTest,
  type CheckOrder,
  type Payment,
  type StripeWebhookRecordResult
} from '@repo/db';
import { NoopNotificationHubTest } from '@repo/notify';
import {
  makePaymentsTest,
  PaymentWebhookSignatureError,
  type PaymentWebhookEvent,
  type ProviderPayment
} from '@repo/payments';
import { makeSafetyVerificationQueueTest } from '@repo/queue';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { BaseAppEnv } from '@/api/app-env';
import { processStripeEvent, stripeWebhookRoute } from './stripe';

// Public ingress with no session: the signature is the only authentication,
// and every object is re-fetched before anything is written.

const GOOD_SIGNATURE = 't=1,v1=good';

const paymentRow = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-1',
    userId: 'family-1',
    kind: 'credibled_order',
    status: 'pending',
    provider: 'stripe',
    providerReference: 'pi_1',
    totalCents: 7500,
    currency: 'CAD',
    lastError: null,
    ...overrides
  }) as Payment;

const fetched = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  reference: 'pi_1',
  status: 'succeeded',
  amountCents: 7500,
  currency: 'cad',
  metadata: { payment_id: 'payment-1' },
  customer: null,
  savesCard: false,
  failureReason: null,
  receiptUrl: null,
  refundedCents: 0,
  paymentMethod: null,
  ...overrides
});

const event = (overrides: Partial<PaymentWebhookEvent> = {}): PaymentWebhookEvent => ({
  eventId: 'evt_1',
  type: 'payment_intent.succeeded',
  objectId: 'pi_1',
  paymentReference: null,
  account: null,
  ...overrides
});

const makeWorld = (
  options: {
    payment?: Payment | null;
    provider?: ProviderPayment;
    verified?: PaymentWebhookEvent;
    seen?: StripeWebhookRecordResult;
    /** The payment table is down while the event is applied. */
    processingFails?: boolean;
  } = {}
) => {
  let payment = options.payment === undefined ? paymentRow() : options.payment;
  let order = { id: 'order-1', status: 'payment_pending', paymentId: 'payment-1' } as CheckOrder;
  const log = {
    recorded: [] as Array<string>,
    processed: [] as Array<string>,
    failed: [] as Array<string>,
    enqueued: [] as Array<string>,
    updates: [] as Array<Partial<Payment>>
  };
  const billing = makeInMemoryBillingCustomerRepo([
    dummyBillingCustomer({ provider: 'stripe', customerReference: 'cus_1', cardReference: null })
  ]);

  const layer = Layer.mergeAll(
    makePaymentsTest({
      provider: 'stripe',
      verifyWebhook: (_raw, signature) =>
        signature === GOOD_SIGNATURE
          ? Effect.succeed(options.verified ?? event())
          : Effect.fail(new PaymentWebhookSignatureError({ reason: 'bad signature' })),
      getPayment: () => Effect.succeed(options.provider ?? fetched()),
      getCardSetup: (reference) =>
        Effect.succeed({
          reference,
          status: 'succeeded',
          customer: 'cus_1',
          paymentMethod: {
            reference: 'pm_new',
            brand: 'visa',
            last4: '4242',
            expMonth: 12,
            expYear: 2034
          }
        })
    }),
    makeStripeWebhookEventRepoTest({
      record: ({ eventId }) =>
        Effect.sync(() => {
          log.recorded.push(eventId);
          return options.seen ?? 'new';
        }),
      markProcessed: (eventId) => Effect.sync(() => void log.processed.push(eventId)),
      markFailed: (eventId) => Effect.sync(() => void log.failed.push(eventId))
    }),
    makePaymentRepoTest({
      findById: () => Effect.succeed(payment!),
      findByProviderReference: (_provider, reference) =>
        options.processingFails
          ? Effect.fail(new SqlError({ cause: 'database is down' }))
          : Effect.succeed(payment && payment.providerReference === reference ? payment : null),
      update: (_id, input) =>
        Effect.sync(() => {
          log.updates.push(input);
          payment = { ...payment!, ...input };
          return payment;
        }),
      advance: (_id, input) =>
        Effect.sync(() => {
          const from = Array.isArray(input.from) ? input.from : [input.from];
          if (!payment || !from.includes(payment.status)) return null;
          payment = { ...payment, ...input.set };
          return payment;
        })
    }),
    makeCheckOrderRepoTest({
      findByPaymentId: (paymentId) => Effect.succeed(order.paymentId === paymentId ? order : null),
      advance: (_id, input) =>
        Effect.sync(() => {
          order = { ...order, ...input.set } as CheckOrder;
          return order;
        })
    }),
    billing.layer,
    makeSafetyVerificationQueueTest({
      enqueueOrder: ({ orderId }) =>
        Effect.sync(() => {
          log.enqueued.push(orderId);
          return { id: 'job-1', name: 'place' };
        })
    }),
    NoopNotificationHubTest
  );

  const runtime = ManagedRuntime.make(layer);
  const app = new Hono<BaseAppEnv>()
    .use('*', async (c, next) => {
      c.set('runtime', runtime as never);
      await next();
    })
    .route('/webhooks/stripe', stripeWebhookRoute);

  const post = (signature: string | null = GOOD_SIGNATURE, body = '{"id":"evt_1"}') =>
    app.request('/webhooks/stripe', {
      method: 'POST',
      headers: signature === null ? {} : { 'stripe-signature': signature },
      body
    });

  return { post, layer, log, billing, payment: () => payment, order: () => order };
};

describe('POST /webhooks/stripe', () => {
  it('refuses a bad signature with 400 and records nothing', async () => {
    const world = makeWorld();
    const response = await world.post('t=1,v1=forged');
    expect(response.status).toBe(400);
    expect(world.log.recorded).toEqual([]);
    expect(world.payment()?.status).toBe('pending');
  });

  it('refuses a delivery with no signature at all', async () => {
    const world = makeWorld();
    expect((await world.post(null)).status).toBe(400);
  });

  it('refuses an oversized body before reading it', async () => {
    const world = makeWorld();
    const response = await world.post(GOOD_SIGNATURE, 'x'.repeat(600 * 1024));
    expect(response.status).toBe(413);
  });

  it('settles a succeeded payment from the re-fetched intent and marks the event processed', async () => {
    const world = makeWorld();
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(world.payment()?.status).toBe('captured');
    expect(world.order().status).toBe('paid');
    expect(world.log.enqueued).toEqual(['order-1']);
    expect(world.log.processed).toEqual(['evt_1']);
  });

  it('acknowledges a duplicate of a processed event without touching anything', async () => {
    const world = makeWorld({ seen: 'processed' });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(world.payment()?.status).toBe('pending');
  });

  it('reprocesses an event whose earlier delivery failed', async () => {
    const world = makeWorld({ seen: 'unprocessed' });
    expect((await world.post()).status).toBe(200);
    expect(world.payment()?.status).toBe('captured');
  });

  it('records a processing failure and answers 500 so Stripe retries', async () => {
    const world = makeWorld({ processingFails: true });
    const response = await world.post();
    expect(response.status).toBe(500);
    expect(world.log.failed).toEqual(['evt_1']);
    expect(world.log.processed).toEqual([]);
  });

  it('acknowledges an event type it does not handle', async () => {
    const world = makeWorld({ verified: event({ type: 'customer.created', objectId: 'cus_1' }) });
    expect((await world.post()).status).toBe(200);
    expect(world.log.processed).toEqual(['evt_1']);
  });
});

describe('processStripeEvent', () => {
  const run = (world: ReturnType<typeof makeWorld>, input: PaymentWebhookEvent) =>
    Effect.runPromise(processStripeEvent(input).pipe(Effect.provide(world.layer)));

  it('fails a payment Stripe reports as canceled', async () => {
    const world = makeWorld({ provider: fetched({ status: 'canceled' }) });
    await run(world, event({ type: 'payment_intent.canceled' }));
    expect(world.payment()?.status).toBe('failed');
    expect(world.order()).toMatchObject({ status: 'draft', paymentId: null });
  });

  it('ignores a payment intent we never created', async () => {
    const world = makeWorld({ payment: null });
    expect(await run(world, event())).toBe('settle: unknown');
  });

  it('saves the card of a finished setup for the customer that owns it', async () => {
    const world = makeWorld();
    await run(world, event({ type: 'setup_intent.succeeded', objectId: 'seti_1' }));
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
  });

  it('marks a fully refunded charge refunded', async () => {
    const world = makeWorld({
      payment: paymentRow({ status: 'captured' }),
      provider: fetched({ refundedCents: 7500 })
    });
    const note = await run(
      world,
      event({ type: 'charge.refunded', objectId: 'ch_1', paymentReference: 'pi_1' })
    );
    expect(note).toBe('refunded');
    expect(world.payment()?.status).toBe('refunded');
  });

  it('leaves a partial refund alone', async () => {
    const world = makeWorld({
      payment: paymentRow({ status: 'captured' }),
      provider: fetched({ refundedCents: 1000 })
    });
    await run(
      world,
      event({ type: 'charge.refunded', objectId: 'ch_1', paymentReference: 'pi_1' })
    );
    expect(world.payment()?.status).toBe('captured');
  });

  it('flags a payment when its card dispute opens', async () => {
    const world = makeWorld({ payment: paymentRow({ status: 'captured' }) });
    await run(
      world,
      event({ type: 'charge.dispute.created', objectId: 'dp_1', paymentReference: 'pi_1' })
    );
    expect(world.payment()?.lastError).toBe('card dispute opened');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run src/routes/webhooks/stripe`
Expected: FAIL — `Cannot find module './stripe'`.

- [ ] **Step 3: Implement the route**

`apps/api/src/routes/webhooks/stripe.ts`:

```ts
import { applyCardSetup, mismatchReason, settlePaymentByReference } from '@repo/billing';
import { PaymentRepo, StripeWebhookEventRepo } from '@repo/db';
import { Payments, type PaymentWebhookEvent } from '@repo/payments';
import { Cause, Effect, Exit } from 'effect';
import { Hono } from 'hono';
import type { BaseAppEnv, HonoContext } from '@/api/app-env';

/**
 * Stripe webhooks.
 *
 * Mounted OUTSIDE the authenticated app router: public ingress with no
 * session, so every guarantee comes from the signature and from how events
 * are applied. A delivery is a wake-up signal, nothing more:
 *
 *   1. The `Stripe-Signature` is verified over the RAW body. Enforcement is
 *      never disabled — no secret configured means every delivery is refused.
 *   2. The event id is recorded; a delivery we already processed is
 *      acknowledged and dropped (Stripe delivers at least once).
 *   3. The handler re-fetches the object from Stripe and acts only on that,
 *      through the same settle path the browser and the recovery job use.
 *   4. A processing failure is recorded and answered 500, so Stripe retries.
 */

/** Stripe events are a few kilobytes; anything near this is not one. */
const MAX_BODY_BYTES = 512 * 1024;

const paymentIntentEvents = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'payment_intent.processing'
]);

/** A charge was refunded. Only a FULL refund moves our row (the worker's
 * refund path has usually got there first); partial refunds are piece 4. */
const recordRefund = (event: PaymentWebhookEvent) =>
  Effect.gen(function* () {
    if (event.paymentReference === null) return 'no payment intent on the charge';
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const row = yield* paymentRepo.findByProviderReference(
      payments.provider,
      event.paymentReference
    );
    if (row === null) return 'unknown payment';
    const fetched = yield* payments.getPayment(event.paymentReference);
    const mismatch = mismatchReason(row, fetched);
    if (mismatch !== null) return `ignored: ${mismatch}`;
    if (fetched.refundedCents < row.totalCents) return 'partial refund — left for dispute handling';
    const refunded = yield* paymentRepo.advance(row.id, {
      from: ['captured', 'authorised'],
      set: { status: 'refunded', refundedAt: new Date() }
    });
    return refunded === null ? 'already refunded' : 'refunded';
  });

/** A card dispute opened. Flagged on the payment for an administrator;
 * handling disputes is piece 4. */
const flagDispute = (event: PaymentWebhookEvent) =>
  Effect.gen(function* () {
    if (event.paymentReference === null) return 'no payment intent on the dispute';
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const row = yield* paymentRepo.findByProviderReference(
      payments.provider,
      event.paymentReference
    );
    if (row === null) return 'unknown payment';
    yield* paymentRepo.update(row.id, { lastError: 'card dispute opened' });
    return 'dispute flagged';
  });

/** Applies one verified event. Returns a short note for the log. */
export const processStripeEvent = (event: PaymentWebhookEvent) =>
  Effect.gen(function* () {
    if (paymentIntentEvents.has(event.type)) {
      const result = yield* settlePaymentByReference(event.objectId);
      return `settle: ${result.outcome}`;
    }
    switch (event.type) {
      case 'setup_intent.succeeded': {
        const result = yield* applyCardSetup(event.objectId, null);
        return `card setup: ${result.outcome}`;
      }
      case 'charge.refunded':
        return yield* recordRefund(event);
      case 'charge.dispute.created':
        return yield* flagDispute(event);
      case 'account.updated':
        // Connected accounts arrive with piece 2b (helper payout accounts).
        return 'account.updated: not handled yet';
      default:
        return 'ignored';
    }
  });

export type StripeWebhookResponse = {
  status: 200 | 400 | 413 | 500;
  body: { received: true; duplicate?: true } | { error: string };
};

/** The whole delivery, as a program the route runs and the tests drive. */
export const stripeWebhookProgram = (rawBody: string, signature: string | null) =>
  Effect.gen(function* () {
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return { status: 413, body: { error: 'payload too large' } } as StripeWebhookResponse;
    }
    const payments = yield* Payments;
    const events = yield* StripeWebhookEventRepo;

    const verified = yield* payments.verifyWebhook(rawBody, signature).pipe(Effect.either);
    if (verified._tag === 'Left') {
      yield* Effect.logWarning(`[stripe:webhook] refused: ${verified.left.reason}`);
      // Deliberately terse: a verbose reason here is a signing oracle.
      return { status: 400, body: { error: 'invalid signature' } } as StripeWebhookResponse;
    }
    const event = verified.right;

    const seen = yield* events.record({
      eventId: event.eventId,
      type: event.type,
      objectId: event.objectId
    });
    if (seen === 'processed') {
      return { status: 200, body: { received: true, duplicate: true } } as StripeWebhookResponse;
    }

    const processed = yield* processStripeEvent(event).pipe(Effect.exit);
    if (Exit.isFailure(processed)) {
      const reason = Cause.pretty(processed.cause);
      yield* events.markFailed(event.eventId, reason);
      yield* Effect.logError(`[stripe:webhook] ${event.eventId} ${event.type} failed`, reason);
      // 5xx: Stripe retries, and the next delivery reprocesses the event.
      return { status: 500, body: { error: 'processing failed' } } as StripeWebhookResponse;
    }
    yield* events.markProcessed(event.eventId);
    yield* Effect.logInfo(`[stripe:webhook] ${event.eventId} ${event.type}: ${processed.value}`);
    return { status: 200, body: { received: true } } as StripeWebhookResponse;
  });

const handle = async (c: HonoContext<BaseAppEnv>) => {
  const declaredLength = Number.parseInt(c.req.header('content-length') ?? '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return c.json({ error: 'payload too large' }, 413);
  }
  // The raw text, unparsed: the signature covers these exact bytes.
  const raw = await c.req.text();
  const exit = await c
    .get('runtime')
    .runPromiseExit(stripeWebhookProgram(raw, c.req.header('stripe-signature') ?? null));
  if (Exit.isFailure(exit)) {
    // The event log itself is unreachable: let Stripe retry.
    console.error('[stripe:webhook] could not record the delivery', Cause.pretty(exit.cause));
    return c.json({ error: 'processing failed' }, 500);
  }
  return c.json(exit.value.body, exit.value.status);
};

export const stripeWebhookRoute = new Hono<BaseAppEnv>().post('/', handle);
```

In `apps/api/src/index.ts` add `import { stripeWebhookRoute } from './routes/webhooks/stripe';` after the Credibled webhook import, and after `.route('/webhooks/credibled', credibledWebhookRoute)` add:

```ts
    // Same posture for Stripe: the signature over the raw body is the only
    // authentication, and the handler re-fetches every object it acts on.
    .route('/webhooks/stripe', stripeWebhookRoute)
```

- [ ] **Step 4: Run the tests and type-check the entry point**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run src/routes/webhooks`
Expected: stripe 14 PASS; credibled e2e unchanged.

`bun run build` only compiles `src/hc.ts`'s graph, which does not include the webhook routes, so type-check the entry point with a throwaway config:

```bash
cd /run/media/hbt/work/poppynz/stripe-integration/apps/api
cat > "${TMPDIR:-/tmp}/tsconfig.api-entry.json" <<EOF
{ "extends": "$PWD/tsconfig.build.json",
  "compilerOptions": { "noEmit": true, "declaration": false, "declarationMap": false, "rootDir": "$PWD/src" },
  "files": ["$PWD/src/index.ts", "$PWD/src/hc.ts"] }
EOF
node_modules/.bin/tsc -p "${TMPDIR:-/tmp}/tsconfig.api-entry.json" && echo ENTRY_OK
```

Expected: `ENTRY_OK`.

- [ ] **Step 5: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/api/src/routes/webhooks/stripe.ts apps/api/src/routes/webhooks/stripe.unit.test.ts apps/api/src/index.ts
git commit -m "feat(api): Stripe webhook — verified raw body, de-duplicated, re-fetch then settle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Worker payment recovery job

**Files:**
- Create: `apps/worker/src/payment-recovery-processor.ts`, `apps/worker/src/payment-recovery-processor.unit.test.ts`
- Modify: `packages/queue/src/index.ts`, `apps/worker/src/index.ts`, `apps/worker/package.json`, `bun.lock`

**Interfaces:**
- Consumes: `settlePayment` (Task 4), `PaymentRepo.listStalePending` (Task 3), `stripeConfig.settleAfterMinutes` / `abandonAfterHours` (Task 2), `Payments.cancelPayment`.
- Produces: `recoverPendingPayments(now: Date) → Effect<{ checked; captured; failed; abandoned; errors }, SqlError, …>`; `safetyVerificationJobNames.recoverPayments = 'recover-pending-payments'`; `paymentRecoverySchedulerId = 'payment-recovery'` scheduled on `safetyVerificationReconcileCronPattern` (every 15 minutes).

- [ ] **Step 1: Dependency, job name and scheduler id**

In `apps/worker/package.json` `dependencies`, add `"@repo/billing": "*",` directly above `"@repo/credibled": "*",`; run `cd /run/media/hbt/work/poppynz/stripe-integration && bun install`.

In `packages/queue/src/index.ts` replace

```ts
  /** Daily expiry sweep and pre-expiry reminders. */
  sweepExpiries: 'sweep-safety-verification-expiries'
} as const;
```

with

```ts
  /** Daily expiry sweep and pre-expiry reminders. */
  sweepExpiries: 'sweep-safety-verification-expiries',
  /** Backstop for payments whose browser tab closed or whose Stripe webhook
   * was lost: settles them, and cancels the ones abandoned for a day. */
  recoverPayments: 'recover-pending-payments'
} as const;
```

and above `export const safetyVerificationExpirySchedulerId` add:

```ts
// Runs on the reconcile cadence above (every 15 minutes).
export const paymentRecoverySchedulerId = 'payment-recovery';
```

- [ ] **Step 2: Write the failing tests**

`apps/worker/src/payment-recovery-processor.unit.test.ts`:

```ts
import {
  makeCheckOrderRepoTest,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  type CheckOrder,
  type Payment
} from '@repo/db';
import { NoopNotificationHubTest } from '@repo/notify';
import { makePaymentsTest, type ProviderPayment } from '@repo/payments';
import { makeSafetyVerificationQueueTest } from '@repo/queue';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { recoverPendingPayments } from './payment-recovery-processor';

// The backstop for a closed tab or a lost webhook: nothing here may take
// money twice, and an abandoned payment must free its order.

const NOW = new Date('2026-10-02T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const paymentRow = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-1',
    userId: 'family-1',
    kind: 'credibled_order',
    status: 'pending',
    provider: 'stripe',
    providerReference: 'pi_1',
    totalCents: 7500,
    currency: 'CAD',
    lastError: null,
    createdAt: minutesAgo(30),
    ...overrides
  }) as Payment;

const intent = (status: ProviderPayment['status']): ProviderPayment => ({
  reference: 'pi_1',
  status,
  amountCents: 7500,
  currency: 'cad',
  metadata: { payment_id: 'payment-1' },
  customer: null,
  savesCard: false,
  failureReason: null,
  receiptUrl: null,
  refundedCents: 0,
  paymentMethod: null
});

const makeWorld = (options: { payment: Payment; provider: ProviderPayment['status'] }) => {
  let payment = options.payment;
  let providerStatus = options.provider;
  let order = { id: 'order-1', status: 'payment_pending', paymentId: 'payment-1' } as CheckOrder;
  const seen = {
    staleBefore: [] as Array<Date>,
    cancelled: [] as Array<string>,
    enqueued: [] as Array<string>
  };

  const layer = Layer.mergeAll(
    makePaymentRepoTest({
      listStalePending: (_provider, createdBefore) =>
        Effect.sync(() => {
          seen.staleBefore.push(createdBefore);
          return payment.createdAt < createdBefore && payment.status === 'pending' ? [payment] : [];
        }),
      findById: () => Effect.sync(() => payment),
      update: (_id, input) => Effect.sync(() => (payment = { ...payment, ...input })),
      advance: (_id, input) =>
        Effect.sync(() => {
          const from = Array.isArray(input.from) ? input.from : [input.from];
          if (!from.includes(payment.status)) return null;
          payment = { ...payment, ...input.set };
          return payment;
        })
    }),
    makeCheckOrderRepoTest({
      findByPaymentId: (paymentId) =>
        Effect.sync(() => (order.paymentId === paymentId ? order : null)),
      advance: (_id, input) =>
        Effect.sync(() => {
          order = { ...order, ...input.set } as CheckOrder;
          return order;
        })
    }),
    makePaymentsTest({
      provider: 'stripe',
      getPayment: () => Effect.sync(() => intent(providerStatus)),
      cancelPayment: (reference) =>
        Effect.sync(() => {
          seen.cancelled.push(reference);
          if (providerStatus !== 'succeeded') providerStatus = 'canceled';
          return intent(providerStatus);
        })
    }),
    makeInMemoryBillingCustomerRepo([]).layer,
    makeSafetyVerificationQueueTest({
      enqueueOrder: ({ orderId }) =>
        Effect.sync(() => {
          seen.enqueued.push(orderId);
          return { id: 'job-1', name: 'place' };
        })
    }),
    NoopNotificationHubTest
  );
  const run = () => Effect.runPromise(recoverPendingPayments(NOW).pipe(Effect.provide(layer)));
  return { run, seen, payment: () => payment, order: () => order };
};

describe('recoverPendingPayments', () => {
  it('only looks at payments older than the settle window', async () => {
    const world = makeWorld({ payment: paymentRow(), provider: 'succeeded' });
    await world.run();
    expect(world.seen.staleBefore).toEqual([minutesAgo(10)]);
  });

  it('settles a payment whose tab closed after 10 minutes', async () => {
    const world = makeWorld({
      payment: paymentRow({ createdAt: minutesAgo(11) }),
      provider: 'succeeded'
    });
    const summary = await world.run();
    expect(summary).toEqual({ checked: 1, captured: 1, failed: 0, abandoned: 0, errors: 0 });
    expect(world.payment().status).toBe('captured');
    expect(world.seen.enqueued).toEqual(['order-1']);
  });

  it('leaves a payment the payer is still confirming alone inside a day', async () => {
    const world = makeWorld({
      payment: paymentRow({ createdAt: minutesAgo(60) }),
      provider: 'requires_action'
    });
    const summary = await world.run();
    expect(summary).toMatchObject({ checked: 1, captured: 0, failed: 0, abandoned: 0 });
    expect(world.seen.cancelled).toEqual([]);
    expect(world.payment().status).toBe('pending');
  });

  it('cancels a payment unfinished after 24 hours and returns its order to the basket', async () => {
    const world = makeWorld({
      payment: paymentRow({ createdAt: minutesAgo(24 * 60 + 1) }),
      provider: 'requires_action'
    });
    const summary = await world.run();
    expect(summary).toEqual({ checked: 1, captured: 0, failed: 1, abandoned: 1, errors: 0 });
    expect(world.seen.cancelled).toEqual(['pi_1']);
    expect(world.payment().status).toBe('failed');
    expect(world.order()).toMatchObject({ status: 'draft', paymentId: null });
  });

  it('captures instead when an "abandoned" payment had in fact succeeded', async () => {
    const world = makeWorld({
      payment: paymentRow({ createdAt: minutesAgo(24 * 60 + 1) }),
      provider: 'succeeded'
    });
    const summary = await world.run();
    expect(summary).toMatchObject({ captured: 1, abandoned: 1 });
    expect(world.payment().status).toBe('captured');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/worker && bunx vitest run src/payment-recovery-processor.unit.test.ts`
Expected: FAIL — `Cannot find module './payment-recovery-processor'`.

- [ ] **Step 4: Implement the job**

`apps/worker/src/payment-recovery-processor.ts`:

```ts
import { settlePayment } from '@repo/billing';
import { PaymentRepo } from '@repo/db';
import { stripeConfig } from '@repo/env';
import { Payments } from '@repo/payments';
import { Effect } from 'effect';

/**
 * Payment recovery, every 15 minutes.
 *
 * The browser's confirm request and the Stripe webhook normally settle a
 * payment within seconds. This job is the backstop for when neither arrives
 * (tab closed mid-3-D Secure, webhook lost): a payment still `pending` after
 * PAYMENTS_SETTLE_AFTER_MINUTES is settled from the provider's state, and one
 * still unfinished after PAYMENTS_ABANDON_AFTER_HOURS is cancelled first —
 * settle then marks it failed and returns its order to the basket.
 */

const windows = stripeConfig.pipe(
  Effect.map((config) => ({
    settleAfterMinutes: config.settleAfterMinutes,
    abandonAfterHours: config.abandonAfterHours
  })),
  Effect.orElseSucceed(() => ({ settleAfterMinutes: 10, abandonAfterHours: 24 }))
);

export type PaymentRecoverySummary = {
  checked: number;
  captured: number;
  failed: number;
  abandoned: number;
  errors: number;
};

export const recoverPendingPayments = (now: Date) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const { settleAfterMinutes, abandonAfterHours } = yield* windows;

    const stale = yield* paymentRepo.listStalePending(
      payments.provider,
      new Date(now.getTime() - settleAfterMinutes * 60_000)
    );
    const abandonBefore = now.getTime() - abandonAfterHours * 3_600_000;

    const outcomes = yield* Effect.forEach(
      stale,
      (payment) =>
        Effect.gen(function* () {
          const abandoned =
            payment.providerReference !== null && payment.createdAt.getTime() < abandonBefore;
          if (abandoned) {
            // Cancelling first means nothing can succeed after the order is
            // released. An intent that had in fact succeeded comes back as
            // such and is captured below.
            yield* payments.cancelPayment(payment.providerReference!);
          }
          const result = yield* settlePayment(payment.id, () => now);
          return { abandoned, outcome: result.outcome };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(`payment recovery: ${payment.id} failed`, error).pipe(
              Effect.as({ abandoned: false, outcome: 'error' as const })
            )
          )
        ),
      { concurrency: 3 }
    );

    return {
      checked: outcomes.length,
      captured: outcomes.filter((entry) => entry.outcome === 'captured').length,
      failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
      abandoned: outcomes.filter((entry) => entry.abandoned).length,
      errors: outcomes.filter((entry) => entry.outcome === 'error').length
    } satisfies PaymentRecoverySummary;
  });
```

- [ ] **Step 5: Wire it into the worker**

In `apps/worker/src/index.ts`:

- `@repo/db` import: add `BillingCustomerRepoDefault,` after `ApprovalRepoDefault,`.
- `@repo/queue` import: add `SafetyVerificationQueueLive,` after `FamilySearchQueueLive,` and `paymentRecoverySchedulerId,` after `getRedisConnection,`.
- Add `import { recoverPendingPayments } from './payment-recovery-processor';` after the `family-search-processor` import.
- In `WorkerLive`, replace

```ts
  PaymentRepoDefault,
  UserRepoDefault,
  CredibledDefault,
  // Same PAYMENTS_PROVIDER switch as the API (default `mock`).
  PaymentsLive,
```

with

```ts
  PaymentRepoDefault,
  // Settling a family's first payment saves its card.
  BillingCustomerRepoDefault,
  UserRepoDefault,
  CredibledDefault,
  // Same PAYMENTS_PROVIDER switch as the API (default `mock`).
  PaymentsLive,
  // A payment the recovery job settles hands its order to the place-order
  // job, exactly as the API's settle does.
  SafetyVerificationQueueLive,
```

- In the safety-verification `Worker` callback, directly above `if (job.name === safetyVerificationJobNames.sweepExpiries) {` add:

```ts
    if (job.name === safetyVerificationJobNames.recoverPayments) {
      const summary = await runtime.runPromise(recoverPendingPayments(new Date()));
      console.log(
        `payment recovery: ${summary.captured} captured, ${summary.failed} failed ` +
          `(${summary.abandoned} abandoned), ${summary.errors} errors of ${summary.checked}`
      );
      return;
    }

```

- In `scheduleSafetyVerificationJobs`, directly above the `safetyVerificationExpirySchedulerId` upsert add:

```ts
  // Backstop for payments neither the browser nor a webhook settled.
  await safetyVerificationQueue.upsertJobScheduler(
    paymentRecoverySchedulerId,
    { pattern: safetyVerificationReconcileCronPattern },
    { name: safetyVerificationJobNames.recoverPayments, data: {} }
  );
```

- [ ] **Step 6: Run the tests and type-check the worker**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/worker && bunx vitest run`
Expected: 32 tests PASS (5 new).

The worker has no type-check script; use a throwaway config:

```bash
cd /run/media/hbt/work/poppynz/stripe-integration/apps/worker
cat > "${TMPDIR:-/tmp}/tsconfig.worker.json" <<EOF
{ "compilerOptions": { "strict": true, "skipLibCheck": true, "noEmit": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler" },
  "files": ["$PWD/src/index.ts", "$PWD/src/payment-recovery-processor.ts", "$PWD/src/payment-recovery-processor.unit.test.ts"] }
EOF
../api/node_modules/.bin/tsc -p "${TMPDIR:-/tmp}/tsconfig.worker.json" && echo WORKER_OK
```

Expected: `WORKER_OK`.

- [ ] **Step 7: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/worker packages/queue/src/index.ts bun.lock
git commit -m "feat(worker): recover payments the browser and webhook never settled

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Web — Stripe.js loader, card labels, API clients and `PaymentModal`

**Files:**
- Create: `apps/web/src/lib/stripe.ts`, `apps/web/src/lib/payment-cards.ts`, `apps/web/src/lib/payment-cards.test.ts`, `apps/web/src/lib/api/billing.ts`, `apps/web/src/lib/components/payments/PaymentModal.svelte`, `apps/web/src/lib/components/payments/PaymentModal.mount.test.ts`
- Modify: `apps/web/package.json`, `apps/web/src/lib/api/safety-verification.ts`, `bun.lock`

**Interfaces:**
- Consumes: the RPC types of `/billing/*` and `/safety-verification/order/confirm` (Tasks 5–6) via `api/hc` — rebuild `apps/api` first.
- Produces:
  - `getStripe(): Promise<Stripe | null>` (`$lib/stripe`; null without `PUBLIC_STRIPE_PUBLISHABLE_KEY`)
  - `cardBrandName(brand)`, `cardLabel({ brand, last4 })` → "Visa •••• 4242", `cardExpiry({ expMonth, expYear })` → "03/2031" (`$lib/payment-cards`)
  - `$lib/api/billing`: `getBilling()`, `startCardSetup()`, `confirmCardSetup(setupId)`; types `BillingData`, `BillingCard`, `BillingPayment`, `BillingError`, `CardSetupError`
  - `$lib/api/safety-verification`: `confirmSafetyCheckPayment(paymentId)`; types `OrderSafetyCheckResult`, `PaymentRequired`
  - `PaymentModal.svelte` props: `mode: 'payment' | 'setup'`, `clientSecret`, `title`, `submitLabel`, `savedCard?: { brand; last4 } | null`, `notice?: string | null`, `onconfirmed: () => Promise<void>`, `onfailed?: () => void`, `oncancel: () => void`. With `savedCard` it shows "<submitLabel> with Visa •••• 4242" and "Use another card"; otherwise it mounts the Payment Element. Confirms with `redirect: 'if_required'`. A Stripe error is shown in the modal; in payment mode a non-validation error ends the attempt (only Close remains) and calls `onfailed`.

- [ ] **Step 1: Install Stripe.js and rebuild the API types**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bun add @stripe/stripe-js@^10.0.0
cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bun run build
```

Expected: `apps/web/package.json` lists `"@stripe/stripe-js": "^10.0.0"` (tab-indented, after `"@repo/ui"`); the api build exits 0.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/payment-cards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cardBrandName, cardExpiry, cardLabel } from './payment-cards';

describe('payment card labels', () => {
	it('names known brands and capitalises unknown ones', () => {
		expect(cardBrandName('visa')).toBe('Visa');
		expect(cardBrandName('amex')).toBe('American Express');
		expect(cardBrandName('link')).toBe('Link');
	});

	it('shows only the last four digits', () => {
		expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('Visa •••• 4242');
	});

	it('pads the expiry month', () => {
		expect(cardExpiry({ expMonth: 3, expYear: 2031 })).toBe('03/2031');
	});
});
```

`apps/web/src/lib/components/payments/PaymentModal.mount.test.ts`:

```ts
// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getStripe, stripe, paymentElement } = vi.hoisted(() => {
	const paymentElement = { mount: vi.fn() };
	const elementsGroup = { create: vi.fn(() => paymentElement) };
	const stripe = {
		elements: vi.fn(() => elementsGroup),
		confirmPayment: vi.fn(),
		confirmSetup: vi.fn()
	};
	return { getStripe: vi.fn(async () => stripe), stripe, paymentElement };
});

vi.mock('$lib/stripe', () => ({ getStripe }));

import PaymentModal from './PaymentModal.svelte';

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const button = (label: string) =>
	[...document.querySelectorAll('button')].find((candidate) =>
		candidate.textContent?.includes(label)
	) as HTMLButtonElement;

const baseProps = {
	mode: 'payment' as const,
	clientSecret: 'pi_1_secret',
	title: 'Pay for your checks',
	submitLabel: 'Pay $75.00',
	oncancel: vi.fn()
};

describe('PaymentModal', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('pays with the saved card in one click, without a card form', async () => {
		stripe.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
		const onconfirmed = vi.fn(async () => {});
		const app = mount(PaymentModal, {
			target: document.body,
			props: { ...baseProps, savedCard: { brand: 'visa', last4: '4242' }, onconfirmed }
		});
		flushSync();
		const label = button('Pay $75.00').textContent?.replace(/\s+/g, ' ').trim();
		const offersAnotherCard = button('Use another card') !== undefined;
		button('Pay $75.00').click();
		await settle();
		unmount(app);

		expect(label).toBe('Pay $75.00 with Visa •••• 4242');
		expect(offersAnotherCard).toBe(true);
		expect(stripe.elements).not.toHaveBeenCalled();
		expect(stripe.confirmPayment).toHaveBeenCalledWith({
			clientSecret: 'pi_1_secret',
			redirect: 'if_required'
		});
		expect(onconfirmed).toHaveBeenCalledOnce();
	});

	it('switches to the card form for another card', async () => {
		const app = mount(PaymentModal, {
			target: document.body,
			props: { ...baseProps, savedCard: { brand: 'visa', last4: '4242' }, onconfirmed: vi.fn() }
		});
		flushSync();
		button('Use another card').click();
		await settle();
		unmount(app);

		expect(stripe.elements).toHaveBeenCalledWith({ clientSecret: 'pi_1_secret' });
		expect(paymentElement.mount).toHaveBeenCalledOnce();
	});

	it('confirms a new card through the Payment Element and shows the notice', async () => {
		stripe.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
		const onconfirmed = vi.fn(async () => {});
		const app = mount(PaymentModal, {
			target: document.body,
			props: {
				...baseProps,
				notice: 'Your card will be saved for future Poppynz payments.',
				onconfirmed
			}
		});
		await settle();
		const text = document.body.textContent;
		button('Pay $75.00').click();
		await settle();
		unmount(app);

		expect(text).toContain('Your card will be saved for future Poppynz payments.');
		expect(stripe.confirmPayment).toHaveBeenCalledWith({
			elements: expect.anything(),
			redirect: 'if_required'
		});
		expect(onconfirmed).toHaveBeenCalledOnce();
	});

	it("shows Stripe's message for a refused card, ends the attempt and reports it", async () => {
		stripe.confirmPayment.mockResolvedValue({
			error: { type: 'card_error', message: 'Your card was declined.' }
		});
		const onconfirmed = vi.fn(async () => {});
		const onfailed = vi.fn();
		const app = mount(PaymentModal, {
			target: document.body,
			props: { ...baseProps, onconfirmed, onfailed }
		});
		await settle();
		button('Pay $75.00').click();
		await settle();
		const alert = document.querySelector('[role="alert"]')?.textContent;
		const closeLabel = button('Close')?.textContent?.trim();
		unmount(app);

		expect(alert).toBe('Your card was declined.');
		expect(closeLabel).toBe('Close');
		expect(onfailed).toHaveBeenCalledOnce();
		expect(onconfirmed).not.toHaveBeenCalled();
	});

	it('keeps the form open on a validation error', async () => {
		stripe.confirmPayment.mockResolvedValue({
			error: { type: 'validation_error', message: 'Your card number is incomplete.' }
		});
		const onfailed = vi.fn();
		const app = mount(PaymentModal, {
			target: document.body,
			props: { ...baseProps, onconfirmed: vi.fn(), onfailed }
		});
		await settle();
		button('Pay $75.00').click();
		await settle();
		const stillPayable = button('Pay $75.00') !== undefined;
		unmount(app);

		expect(onfailed).not.toHaveBeenCalled();
		expect(stillPayable).toBe(true);
	});

	it('confirms a card setup in setup mode', async () => {
		stripe.confirmSetup.mockResolvedValue({ setupIntent: { status: 'succeeded' } });
		const onconfirmed = vi.fn(async () => {});
		const app = mount(PaymentModal, {
			target: document.body,
			props: {
				...baseProps,
				mode: 'setup',
				clientSecret: 'seti_1_secret',
				title: 'Add a card',
				submitLabel: 'Save card',
				onconfirmed
			}
		});
		await settle();
		button('Save card').click();
		await settle();
		unmount(app);

		expect(stripe.elements).toHaveBeenCalledWith({ clientSecret: 'seti_1_secret' });
		expect(stripe.confirmSetup).toHaveBeenCalledWith({
			elements: expect.anything(),
			redirect: 'if_required'
		});
		expect(onconfirmed).toHaveBeenCalledOnce();
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bunx vitest run src/lib/payment-cards.test.ts src/lib/components/payments`
Expected: FAIL — modules not found.

- [ ] **Step 4: Loader, labels and clients**

`apps/web/src/lib/stripe.ts`:

```ts
import { env } from '$env/dynamic/public';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Stripe.js, loaded from Stripe on first use and shared after that. Card data
 * goes from the Payment Element straight to Stripe — never through Poppynz.
 * Resolves to null when PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured.
 */
export function getStripe(): Promise<Stripe | null> {
	const key = env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
	if (!key) return Promise.resolve(null);
	stripePromise ??= loadStripe(key);
	return stripePromise;
}
```

`apps/web/src/lib/payment-cards.ts`:

```ts
/** Display helpers for a saved card (brand + last four digits only). */

const BRAND_NAMES: Record<string, string> = {
	amex: 'American Express',
	diners: 'Diners Club',
	discover: 'Discover',
	jcb: 'JCB',
	mastercard: 'Mastercard',
	unionpay: 'UnionPay',
	visa: 'Visa'
};

/** Stripe's brand code → the name people know, e.g. "visa" → "Visa". */
export function cardBrandName(brand: string): string {
	return BRAND_NAMES[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** "Visa •••• 4242". */
export function cardLabel(card: { brand: string; last4: string }): string {
	return `${cardBrandName(card.brand)} •••• ${card.last4}`;
}

/** "12/2034". */
export function cardExpiry(card: { expMonth: number; expYear: number }): string {
	return `${String(card.expMonth).padStart(2, '0')}/${card.expYear}`;
}
```

`apps/web/src/lib/api/billing.ts`:

```ts
/** A family's card on file and payment history, backed by /billing. */
import { apiClient, call, type ErrorsOf } from './client';

const getEndpoint = apiClient.billing.$get;
const setupEndpoint = apiClient.billing.card.setup.$post;
const confirmEndpoint = apiClient.billing.card.confirm.$post;

export type BillingData = Extract<Awaited<ReturnType<typeof getBilling>>, { ok: true }>['data'];
export type BillingCard = NonNullable<BillingData['card']>;
export type BillingPayment = BillingData['payments'][number];
export type BillingError = ErrorsOf<typeof getEndpoint>;
export type CardSetupError = ErrorsOf<typeof setupEndpoint> | ErrorsOf<typeof confirmEndpoint>;

export async function getBilling() {
	return call(getEndpoint());
}

/** Starts adding or replacing the card: a setup the Payment Element confirms. */
export async function startCardSetup() {
	return call(setupEndpoint());
}

/** After the browser confirmed the setup: the server re-fetches it and keeps
 * the card. */
export async function confirmCardSetup(setupId: string) {
	return call(confirmEndpoint({ json: { setupId } }));
}
```

In `apps/web/src/lib/api/safety-verification.ts`: after the `orderEndpoint` constant add

```ts
const confirmPaymentEndpoint = apiClient['safety-verification'].order.confirm.$post;
```

after `export type SafetyVerificationError = ErrorsOf<typeof getEndpoint>;` add

```ts
export type OrderSafetyCheckResult = Extract<
	Awaited<ReturnType<typeof orderSafetyCheck>>,
	{ ok: true }
>['data'];
export type PaymentRequired = Extract<OrderSafetyCheckResult, { status: 'payment_required' }>;
```

and after `orderSafetyCheck()` add

```ts

/** After the payment modal confirmed (or failed to): the server settles the
 * payment from the provider's own state and says how it ended. */
export async function confirmSafetyCheckPayment(paymentId: string) {
	return call(confirmPaymentEndpoint({ json: { paymentId } }));
}
```

- [ ] **Step 5: The modal**

`apps/web/src/lib/components/payments/PaymentModal.svelte`:

```svelte
<script lang="ts">
	/** Stripe's Payment Element in a modal, for paying (`payment` mode, a
	 * PaymentIntent's client secret) or saving a card (`setup` mode, a
	 * SetupIntent's). Confirms with `redirect: 'if_required'` — cards only, so
	 * 3-D Secure opens over the modal instead of leaving the page. Stripe's own
	 * messages show here; whether money moved is decided by the server, which
	 * the caller asks through `onconfirmed` / `onfailed`. */
	import type { Stripe, StripeElements, StripeError } from '@stripe/stripe-js';
	import { getStripe } from '$lib/stripe';
	import { cardLabel } from '$lib/payment-cards';

	interface Props {
		mode: 'payment' | 'setup';
		clientSecret: string;
		title: string;
		/** e.g. "Pay $75.00" or "Save card". */
		submitLabel: string;
		/** Payment mode: the family's saved card, already attached to the intent —
		 * offered as one click, with "Use another card" for the form. */
		savedCard?: { brand: string; last4: string } | null;
		/** Shown above the card form, e.g. that a new card will be kept. */
		notice?: string | null;
		/** Stripe confirmed. The caller settles through its confirm endpoint and
		 * closes the modal. */
		onconfirmed: () => Promise<void>;
		/** Payment mode: Stripe refused the card. The caller settles (the server
		 * releases the order); the modal stays open to show why. */
		onfailed?: () => void;
		oncancel: () => void;
	}

	let {
		mode,
		clientSecret,
		title,
		submitLabel,
		savedCard = null,
		notice = null,
		onconfirmed,
		onfailed,
		oncancel
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	let useSavedCard = $state(savedCard !== null);
	// Raw, not deep state: Stripe's objects must not be wrapped in proxies.
	let stripe = $state.raw<Stripe | null>(null);
	let elements = $state.raw<StripeElements | null>(null);
	let elementHost = $state<HTMLDivElement | null>(null);
	let submitting = $state(false);
	let message = $state<string | null>(null);
	/** A refused payment cannot be retried on the same intent: only Close. */
	let finished = $state(false);

	// Load Stripe.js once; mount the Payment Element whenever the card form is
	// on screen.
	$effect(() => {
		if (useSavedCard || !elementHost || elements) return;
		const host = elementHost;
		void getStripe().then((loaded) => {
			if (!loaded) {
				message = 'Card payments are not available right now.';
				return;
			}
			stripe = loaded;
			const group = loaded.elements({ clientSecret });
			group.create('payment', { layout: 'tabs' }).mount(host);
			elements = group;
		});
	});

	function handleError(error: StripeError) {
		message = error.message ?? 'Your card could not be used.';
		// A card that was refused (not a typo in the form) ends this attempt.
		if (mode === 'payment' && error.type !== 'validation_error') {
			finished = true;
			onfailed?.();
		}
	}

	async function submit() {
		if (submitting || finished) return;
		submitting = true;
		message = null;
		const loaded = stripe ?? (await getStripe());
		if (!loaded) {
			message = 'Card payments are not available right now.';
			submitting = false;
			return;
		}
		const result =
			mode === 'setup'
				? await loaded.confirmSetup({ elements: elements!, redirect: 'if_required' })
				: useSavedCard
					? await loaded.confirmPayment({ clientSecret, redirect: 'if_required' })
					: await loaded.confirmPayment({ elements: elements!, redirect: 'if_required' });
		if (result.error) {
			handleError(result.error);
		} else {
			await onconfirmed();
		}
		submitting = false;
	}
</script>

<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={title}>
	<div class="modal-box max-w-md border border-card-border">
		<h3 class="font-display text-xl font-bold text-base-content">{title}</h3>

		{#if notice && !useSavedCard}
			<p class="mt-2 text-sm text-base-content-muted">{notice}</p>
		{/if}

		{#if useSavedCard && savedCard}
			<button
				type="button"
				class="btn btn-primary mt-4 w-full"
				disabled={submitting || finished}
				onclick={submit}
			>
				{#if submitting}<span class="loading loading-spinner loading-sm"></span>{/if}
				{submitLabel} with {cardLabel(savedCard)}
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-sm mt-2 w-full"
				disabled={submitting || finished}
				onclick={() => (useSavedCard = false)}
			>
				Use another card
			</button>
		{:else}
			<div class="mt-4 min-h-24" bind:this={elementHost}></div>
		{/if}

		{#if message}
			<p class="mt-3 text-sm font-medium text-error" role="alert">{message}</p>
		{/if}

		<div class="modal-action">
			<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={submitting}>
				{finished ? 'Close' : 'Cancel'}
			</button>
			{#if !useSavedCard && !finished}
				<button
					type="button"
					class="btn btn-primary"
					disabled={submitting || !elements}
					onclick={submit}
				>
					{#if submitting}<span class="loading loading-spinner loading-sm"></span>{/if}
					{submitLabel}
				</button>
			{/if}
		</div>
	</div>
	<button
		type="button"
		class="modal-backdrop"
		onclick={oncancel}
		disabled={submitting}
		aria-label="Close"
	></button>
</div>
```

(`$state.raw` for the Stripe objects: deep state would wrap them in proxies.)

- [ ] **Step 6: Run the tests and svelte-check**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bunx vitest run src/lib/payment-cards.test.ts src/lib/components/payments && bun run check`
Expected: 9 tests PASS; `0 ERRORS 0 WARNINGS`.

- [ ] **Step 7: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/web/package.json apps/web/src/lib/stripe.ts apps/web/src/lib/payment-cards.ts apps/web/src/lib/payment-cards.test.ts apps/web/src/lib/api/billing.ts apps/web/src/lib/api/safety-verification.ts apps/web/src/lib/components/payments bun.lock
git commit -m "feat(web): Stripe Payment Element modal, card labels and billing client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Web — paying for checks in `SafetyCheckPanel`

**Files:**
- Modify: `apps/web/src/lib/components/verification/SafetyCheckPanel.svelte`
- Create: `apps/web/src/lib/components/verification/SafetyCheckPanel.mount.test.ts`

**Interfaces:**
- Consumes: `orderSafetyCheck`, `confirmSafetyCheckPayment`, `PaymentRequired`, `SafetyVerificationState.canResumePayment` (Tasks 5, 10); `PaymentModal` (Task 10).
- Produces: "Pay $X and start" opens the modal for `payment_required` (helper: plain form; family new card: the save notice; family saved card: "Pay $X with Visa •••• 4242" + "Use another card"); a `paid` response (the mock) shows no modal; "Continue payment" appears while `canResumePayment`. Outcomes are toasts.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/components/verification/SafetyCheckPanel.mount.test.ts`:

```ts
// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { orderSafetyCheck, confirmSafetyCheckPayment, getStripe } = vi.hoisted(() => ({
	orderSafetyCheck: vi.fn(),
	confirmSafetyCheckPayment: vi.fn(),
	getStripe: vi.fn(async () => ({
		elements: () => ({ create: () => ({ mount: vi.fn() }) }),
		confirmPayment: vi.fn(),
		confirmSetup: vi.fn()
	}))
}));

vi.mock('$lib/api/safety-verification', () => ({
	orderSafetyCheck,
	confirmSafetyCheckPayment,
	removeSafetyVerificationItem: vi.fn()
}));
vi.mock('$lib/stripe', () => ({ getStripe }));

import SafetyCheckPanel from './SafetyCheckPanel.svelte';

const verification = {
	status: 'not_started',
	route: null,
	consentAt: null,
	issuedOn: null,
	expiresOn: null,
	decisionReason: null,
	applicationUrl: null,
	cost: null
};

const summary = (overrides: Record<string, unknown> = {}) =>
	({
		verification,
		basket: [
			{
				id: 'item-1',
				documentTypeId: 'type-1',
				name: 'Criminal record check',
				credibledLabel: 'Enhanced',
				costCents: 7000
			}
		],
		quote: { amountCents: 7000, feeCents: 500, taxCents: 0, totalCents: 7500, currency: 'CAD' },
		orderableCheckTypes: [{ documentTypeId: 'type-1' }],
		canOrderThroughCredibled: true,
		canResumePayment: false,
		...overrides
	}) as never;

const paymentRequired = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	data: {
		status: 'payment_required',
		paymentId: 'payment-1',
		clientSecret: 'pi_1_secret',
		provider: 'stripe',
		savesCard: false,
		savedCard: null,
		...overrides
	}
});

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const button = (label: string) =>
	[...document.querySelectorAll('button')].find((candidate) =>
		candidate.textContent?.includes(label)
	) as HTMLButtonElement | undefined;

const openPanel = async (props: Record<string, unknown> = {}) => {
	const onchanged = vi.fn(async () => {});
	const app = mount(SafetyCheckPanel, {
		target: document.body,
		props: { summary: summary(), onchanged, ...props }
	});
	flushSync();
	button('Pay $75.00 and start')?.click();
	await settle();
	return { app, onchanged };
};

describe('SafetyCheckPanel payment', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('opens the plain card form for a helper', async () => {
		orderSafetyCheck.mockResolvedValue(paymentRequired());
		const { app } = await openPanel();
		const dialog = document.querySelector('[role="dialog"]');
		const text = dialog?.textContent ?? '';
		unmount(app);

		expect(dialog).not.toBeNull();
		expect(text).not.toContain('Your card will be saved');
		expect(text).not.toContain('Use another card');
	});

	it('tells a family paying with a new card that it will be kept', async () => {
		orderSafetyCheck.mockResolvedValue(paymentRequired({ savesCard: true }));
		const { app } = await openPanel();
		const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
		unmount(app);

		expect(text).toContain(
			'Your card will be saved for future Poppynz payments, such as contract billing. You can replace it in Billing.'
		);
	});

	it('offers a family with a saved card one-click payment and another card', async () => {
		orderSafetyCheck.mockResolvedValue(
			paymentRequired({ savedCard: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 } })
		);
		const { app } = await openPanel();
		const oneClick = button('with Visa')?.textContent?.replace(/\s+/g, ' ').trim();
		const another = button('Use another card');
		unmount(app);

		expect(oneClick).toBe('Pay $75.00 with Visa •••• 4242');
		expect(another).toBeDefined();
	});

	it('shows no modal when the provider settled at once (the mock)', async () => {
		orderSafetyCheck.mockResolvedValue({ ok: true, data: { status: 'paid', verification: {} } });
		const { app, onchanged } = await openPanel();
		const dialog = document.querySelector('[role="dialog"]');
		unmount(app);

		expect(dialog).toBeNull();
		expect(onchanged).toHaveBeenCalledOnce();
	});

	it('offers to continue a payment that was started and never finished', async () => {
		const app = mount(SafetyCheckPanel, {
			target: document.body,
			props: {
				summary: summary({
					verification: { ...verification, status: 'payment_pending' },
					canResumePayment: true
				}),
				onchanged: vi.fn(async () => {})
			}
		});
		flushSync();
		const resume = button('Continue payment');
		unmount(app);

		expect(resume).toBeDefined();
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bunx vitest run src/lib/components/verification`
Expected: FAIL — no dialog opens, no "Continue payment".

- [ ] **Step 3: Implement**

In `SafetyCheckPanel.svelte`:

Replace the `$lib/api/safety-verification` import and add the modal import:

```svelte
	import {
		confirmSafetyCheckPayment,
		orderSafetyCheck,
		removeSafetyVerificationItem,
		type PaymentRequired,
		type SafetyVerificationState
	} from '$lib/api/safety-verification';
	import PaymentModal from '$lib/components/payments/PaymentModal.svelte';
```

After `let removingId = $state<string | null>(null);` add:

```svelte
	/** The payment the modal is confirming (Stripe only — the mock settles at once). */
	let payment = $state<PaymentRequired | null>(null);

	const SAVE_NOTICE =
		'Your card will be saved for future Poppynz payments, such as contract billing. You can replace it in Billing.';
```

Replace the whole `async function order() { … }` with:

```svelte
	/** Starts the payment — or resumes the one already started. */
	async function order() {
		if (ordering) return;
		ordering = true;
		const result = await orderSafetyCheck();
		if (result.ok) {
			if (result.data.status === 'paid') {
				toast.success('Payment received. We are setting up your check now.');
				await onchanged();
			} else {
				payment = result.data;
				// The mock has no card form: there is nothing for the payer to do.
				if (result.data.provider === 'mock') await paymentConfirmed();
			}
		} else {
			toast.error(
				result.error.code === 'SAFETY_VERIFICATION_UNAVAILABLE'
					? 'Ordering is temporarily unavailable. Please try again shortly.'
					: result.error.code === 'SAFETY_VERIFICATION_PAYMENT_FAILED'
						? result.error.message
						: RETRY_MESSAGE,
				{ title: 'Check not ordered' }
			);
		}
		ordering = false;
	}

	/** Stripe confirmed in the browser; the server decides from Stripe's own
	 * record whether the money moved. */
	async function paymentConfirmed() {
		const current = payment;
		if (!current) return;
		const result = await confirmSafetyCheckPayment(current.paymentId);
		payment = null;
		if (!result.ok) {
			toast.error(RETRY_MESSAGE, { title: 'Payment not confirmed' });
		} else if (result.data.status === 'paid') {
			toast.success('Payment received. We are setting up your check now.');
		} else if (result.data.status === 'failed') {
			toast.error(result.data.message ?? 'The payment was declined.', {
				title: 'Payment declined'
			});
		} else {
			toast.info('We are confirming your payment. This usually takes a moment.');
		}
		await onchanged();
	}

	/** Stripe refused the card. The server releases the order so the basket
	 * can be paid again; the modal keeps Stripe's reason on screen. */
	function paymentFailed() {
		const current = payment;
		if (!current) return;
		void confirmSafetyCheckPayment(current.paymentId).then(() => onchanged());
	}
```

Directly above `{#if summary.verification.applicationUrl}` (inside the status card) add:

```svelte
	{#if summary.canResumePayment}
		<button type="button" class="btn btn-primary btn-sm mt-3" disabled={ordering} onclick={order}>
			{#if ordering}<span class="loading loading-spinner loading-xs"></span>{/if}
			Continue payment
		</button>
	{/if}
```

At the very end of the file add:

```svelte

{#if payment}
	<PaymentModal
		mode="payment"
		clientSecret={payment.clientSecret}
		title="Pay for your checks"
		submitLabel="Pay {money(summary.quote.totalCents)}"
		savedCard={payment.savedCard}
		notice={payment.savesCard ? SAVE_NOTICE : null}
		onconfirmed={paymentConfirmed}
		onfailed={paymentFailed}
		oncancel={() => {
			payment = null;
			void onchanged();
		}}
	/>
{/if}
```

- [ ] **Step 4: Run the tests and svelte-check**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bunx vitest run src/lib/components/verification && bun run check`
Expected: 5 tests PASS; `0 ERRORS`.

- [ ] **Step 5: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/web/src/lib/components/verification
git commit -m "feat(web): pay for checks in the Payment Element, one click with a saved card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Web — `/family/billing` and the sidenav item

**Files:**
- Create: `apps/web/src/routes/family/billing/+page.svelte`, `apps/web/src/routes/family/billing/billing.mount.test.ts`
- Modify: `apps/web/src/routes/family/+layout.svelte`

**Interfaces:**
- Consumes: `getBilling`, `startCardSetup`, `confirmCardSetup` (Task 10), `PaymentModal` (setup mode), `cardLabel`, `cardExpiry`, `formatDate`, `StatusChip`.
- Produces: route `/family/billing` (card on file with **Replace card**, or **Add a card**; payment history with date, description, amount, Paid / Refunded / Failed / Pending chip, Receipt link); "Billing" sidenav item (`la-credit-card`) after "Approval". Mock provider: the setup is confirmed straight away, no modal.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/routes/family/billing/billing.mount.test.ts`:

```ts
// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getBilling, startCardSetup, confirmCardSetup, getStripe } = vi.hoisted(() => ({
	getBilling: vi.fn(),
	startCardSetup: vi.fn(),
	confirmCardSetup: vi.fn(),
	getStripe: vi.fn(async () => ({
		elements: () => ({ create: () => ({ mount: vi.fn() }) }),
		confirmPayment: vi.fn(),
		confirmSetup: vi.fn()
	}))
}));

vi.mock('$lib/api/billing', () => ({ getBilling, startCardSetup, confirmCardSetup }));
vi.mock('$lib/stripe', () => ({ getStripe }));

import BillingPage from './+page.svelte';

const billing = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	data: {
		card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 },
		payments: [
			{
				id: 'payment-1',
				createdAt: '2026-10-01T10:00:00.000Z',
				description: 'Background check',
				totalCents: 7500,
				currency: 'CAD',
				status: 'paid',
				receiptUrl: 'https://pay.stripe.com/receipts/r1'
			},
			{
				id: 'payment-0',
				createdAt: '2026-09-30T10:00:00.000Z',
				description: 'Background check',
				totalCents: 7500,
				currency: 'CAD',
				status: 'failed',
				receiptUrl: null
			}
		],
		provider: 'stripe',
		...overrides
	}
});

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const button = (label: string) =>
	[...document.querySelectorAll('button')].find((candidate) =>
		candidate.textContent?.includes(label)
	) as HTMLButtonElement | undefined;

describe('family billing page', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('shows the card on file with Replace, and the payment history with receipts', async () => {
		getBilling.mockResolvedValue(billing());
		const app = mount(BillingPage, { target: document.body });
		await settle();
		const text = document.body.textContent?.replace(/\s+/g, ' ') ?? '';
		const receipts = [...document.querySelectorAll('a')].filter((a) =>
			a.textContent?.includes('Receipt')
		);
		const replace = button('Replace card');
		unmount(app);

		expect(text).toContain('Visa •••• 4242');
		expect(text).toContain('Expires 12/2034');
		expect(replace).toBeDefined();
		expect(text).toContain('Paid');
		expect(text).toContain('Failed');
		expect(text).toContain('$75.00');
		expect(receipts).toHaveLength(1);
		expect(receipts[0]?.getAttribute('href')).toBe('https://pay.stripe.com/receipts/r1');
	});

	it('offers Add a card when there is none', async () => {
		getBilling.mockResolvedValue(billing({ card: null, payments: [] }));
		const app = mount(BillingPage, { target: document.body });
		await settle();
		const add = button('Add a card');
		const text = document.body.textContent ?? '';
		unmount(app);

		expect(add).toBeDefined();
		expect(text).toContain('No payments yet.');
	});

	it('opens the card form in setup mode for Stripe', async () => {
		getBilling.mockResolvedValue(billing({ card: null }));
		startCardSetup.mockResolvedValue({
			ok: true,
			data: { setupId: 'seti_1', clientSecret: 'seti_1_secret', provider: 'stripe' }
		});
		const app = mount(BillingPage, { target: document.body });
		await settle();
		button('Add a card')?.click();
		await settle();
		const dialog = document.querySelector('[role="dialog"]');
		unmount(app);

		expect(dialog?.getAttribute('aria-label')).toBe('Add a card');
		expect(confirmCardSetup).not.toHaveBeenCalled();
	});

	it('saves straight away with the mock provider — no card form', async () => {
		getBilling.mockResolvedValue(billing({ card: null, provider: 'mock' }));
		startCardSetup.mockResolvedValue({
			ok: true,
			data: { setupId: 'mock_seti_1', clientSecret: 'mock_secret', provider: 'mock' }
		});
		confirmCardSetup.mockResolvedValue({
			ok: true,
			data: { card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 } }
		});
		const app = mount(BillingPage, { target: document.body });
		await settle();
		button('Add a card')?.click();
		await settle();
		const dialog = document.querySelector('[role="dialog"]');
		unmount(app);

		expect(dialog).toBeNull();
		expect(confirmCardSetup).toHaveBeenCalledWith('mock_seti_1');
		expect(getBilling).toHaveBeenCalledTimes(2);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bunx vitest run src/routes/family/billing`
Expected: FAIL — `./+page.svelte` not found.

- [ ] **Step 3: Implement the page and the nav item**

`apps/web/src/routes/family/billing/+page.svelte`:

```svelte
<script lang="ts">
	/** A family's card on file and payment history. The card funds contract
	 * billing, so it can be replaced but not simply removed. Receipts are
	 * Stripe's; invoices and tax receipts wait for the accountant's sign-off. */
	import { onMount } from 'svelte';
	import {
		confirmCardSetup,
		getBilling,
		startCardSetup,
		type BillingData,
		type BillingPayment
	} from '$lib/api/billing';
	import PaymentModal from '$lib/components/payments/PaymentModal.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatDate } from '$lib/date';
	import { cardExpiry, cardLabel } from '$lib/payment-cards';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	let billing = $state<BillingData | null>(null);
	let loading = $state(true);
	let loadFailed = $state(false);
	let starting = $state(false);
	/** The card setup the modal is confirming. */
	let setup = $state<{ setupId: string; clientSecret: string } | null>(null);

	async function load() {
		const result = await getBilling();
		if (result.ok) {
			billing = result.data;
			loadFailed = false;
		} else {
			loadFailed = true;
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	async function addCard() {
		if (starting) return;
		starting = true;
		const result = await startCardSetup();
		starting = false;
		if (!result.ok) {
			toast.error(
				result.error.code === 'BILLING_PROVIDER_UNAVAILABLE' ? result.error.message : RETRY_MESSAGE,
				{ title: 'Card not added' }
			);
			return;
		}
		setup = { setupId: result.data.setupId, clientSecret: result.data.clientSecret };
		// The mock has no card form: its setup is already complete.
		if (result.data.provider === 'mock') await setupConfirmed();
	}

	async function setupConfirmed() {
		const current = setup;
		if (!current) return;
		const result = await confirmCardSetup(current.setupId);
		setup = null;
		if (result.ok) {
			toast.success(`${cardLabel(result.data.card)} is now your card on file.`, {
				title: 'Card saved'
			});
			await load();
		} else {
			toast.error(
				result.error.code === 'BILLING_CARD_SETUP_INCOMPLETE'
					? result.error.message
					: RETRY_MESSAGE,
				{ title: 'Card not saved' }
			);
		}
	}

	const chip: Record<BillingPayment['status'], { status: ChipStatus; label: string }> = {
		paid: { status: 'approved', label: 'Paid' },
		refunded: { status: 'expired', label: 'Refunded' },
		failed: { status: 'rejected', label: 'Failed' },
		pending: { status: 'in-progress', label: 'Pending' }
	};

	const money = (cents: number, currency: string) =>
		new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
</script>

<svelte:head>
	<title>Billing · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Billing</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Your card on file and what you have paid through Poppynz.
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if loadFailed || !billing}
		<p role="alert" class="text-sm font-medium text-error">{RETRY_MESSAGE}</p>
	{:else}
		<section class="rounded-xl border border-card-border bg-base-100 p-5">
			<h2 class="text-base font-semibold text-base-content">Card on file</h2>
			{#if billing.card}
				<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="text-sm font-medium text-base-content">{cardLabel(billing.card)}</p>
						<p class="text-xs text-base-content-muted">Expires {cardExpiry(billing.card)}</p>
					</div>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						disabled={starting}
						onclick={addCard}
					>
						{#if starting}<span class="loading loading-spinner loading-xs"></span>{/if}
						Replace card
					</button>
				</div>
			{:else}
				<p class="mt-1 text-sm text-base-content-muted">
					No card yet. Your card is used for contract billing — you need one to send contract terms.
				</p>
				<button
					type="button"
					class="btn btn-primary btn-sm mt-3"
					disabled={starting}
					onclick={addCard}
				>
					{#if starting}<span class="loading loading-spinner loading-xs"></span>{/if}
					Add a card
				</button>
			{/if}
		</section>

		<h2 class="mt-8 mb-3 text-lg font-semibold text-base-content">Payment history</h2>
		{#if billing.payments.length === 0}
			<p class="text-sm text-base-content-muted">No payments yet.</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
				<table class="table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Description</th>
							<th class="text-right">Amount</th>
							<th>Status</th>
							<th><span class="sr-only">Receipt</span></th>
						</tr>
					</thead>
					<tbody>
						{#each billing.payments as row (row.id)}
							<tr>
								<td class="whitespace-nowrap">{formatDate(row.createdAt)}</td>
								<td>{row.description}</td>
								<td class="text-right tabular-nums">{money(row.totalCents, row.currency)}</td>
								<td>
									<StatusChip status={chip[row.status].status} label={chip[row.status].label} />
								</td>
								<td>
									{#if row.receiptUrl}
										<a
											class="link text-sm"
											href={row.receiptUrl}
											target="_blank"
											rel="external noopener noreferrer"
										>
											Receipt
										</a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

{#if setup && billing?.provider !== 'mock'}
	<PaymentModal
		mode="setup"
		clientSecret={setup.clientSecret}
		title={billing?.card ? 'Replace your card' : 'Add a card'}
		submitLabel="Save card"
		notice="Your card is kept for Poppynz payments such as contract billing. Nothing is charged now."
		onconfirmed={setupConfirmed}
		oncancel={() => (setup = null)}
	/>
{/if}
```

In `apps/web/src/routes/family/+layout.svelte`, after the `/family/approval` item add:

```svelte
		{ href: resolve('/family/billing'), label: 'Billing', icon: 'la-credit-card' },
```

- [ ] **Step 4: Run the tests, svelte-check and lint**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bunx vitest run src/routes/family/billing && bun run check && bun run lint`
Expected: 4 tests PASS; `0 ERRORS`; lint shows only the pre-existing `{@debug}` warning.

- [ ] **Step 5: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/web/src/routes/family/billing apps/web/src/routes/family/+layout.svelte
git commit -m "feat(web): family Billing page — card on file and payment history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Web — the card prompt in the contract editor

**Files:**
- Modify: `apps/web/src/lib/components/contracts/ContractTermsEditor.svelte`, `apps/web/src/lib/components/contracts/ContractTermsEditor.mount.test.ts`, `apps/web/src/lib/components/contracts/ContractDetailPage.svelte`

**Interfaces:**
- Consumes: `contract.hasPaymentMethod` and `PAYMENT_METHOD_REQUIRED` (Task 7), `/family/billing` (Task 12).
- Produces: `ContractTermsEditor` props `paymentMethodMissing?: boolean` (default false) and `billingHref?: ResolvedPathname | null`; while missing it shows "Add a card to send — your card is used for contract billing." (link on "Add a card") and disables Send.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('ContractTermsEditor', …)` block of `ContractTermsEditor.mount.test.ts`, after the "blocks sending and points to the profile" test:

```ts
	it('blocks sending and points to Billing while the family has no card', () => {
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: {
				...baseProps,
				onsend: vi.fn(),
				paymentMethodMissing: true,
				billingHref: '/family/billing' as never
			}
		});
		flushSync();
		const disabled = sendButton().disabled;
		const prompt = document
			.querySelector('[role="alert"]')
			?.textContent?.replace(/\s+/g, ' ')
			.trim();
		const link = document.querySelector('a[href="/family/billing"]')?.textContent;
		unmount(app);
		expect(disabled).toBe(true);
		expect(link).toBe('Add a card');
		expect(prompt).toBe('Add a card to send — your card is used for contract billing.');
	});

	it('lets a family with a card send', () => {
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: { ...baseProps, onsend: vi.fn(), paymentMethodMissing: false }
		});
		flushSync();
		const disabled = sendButton().disabled;
		unmount(app);
		expect(disabled).toBe(false);
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bunx vitest run src/lib/components/contracts/ContractTermsEditor.mount.test.ts`
Expected: FAIL — Send is enabled and there is no Billing link.

- [ ] **Step 3: Implement**

In `ContractTermsEditor.svelte`, in `interface Props` after `profileHref?: ResolvedPathname | null;` add:

```svelte
		/** No card on file: contract billing charges it, so sending is blocked. */
		paymentMethodMissing?: boolean;
		/** Where the family adds a card. */
		billingHref?: ResolvedPathname | null;
```

In the props destructuring after `profileHref = null,` add `paymentMethodMissing = false,` and `billingHref = null,`.

Directly above `<div class="mt-4 flex items-center gap-2.5">` (the Send/Save row) add:

```svelte
	{#if paymentMethodMissing}
		<p class="mt-3 rounded-lg bg-base-300 px-4 py-3 text-[12.5px] text-neutral" role="alert">
			{#if billingHref}
				<a class="font-semibold text-secondary hover:underline" href={billingHref}>Add a card</a>
			{:else}
				Add a card
			{/if}
			to send — your card is used for contract billing.
		</p>
	{/if}

```

and change the Send button's `disabled={busy || items.length === 0 || locationMissing}` to:

```svelte
			disabled={busy || items.length === 0 || locationMissing || paymentMethodMissing}
```

In `ContractDetailPage.svelte`, in `termsErrorToast`, directly after the `START_DATE_REQUIRED || START_DATE_NOT_IN_FUTURE || FAMILY_LOCATION_REQUIRED` branch add:

```svelte
		} else if (error.code === 'PAYMENT_METHOD_REQUIRED') {
			toast.error(error.message, { title: 'Card needed' });
			void refresh(contractId);
```

and on the `<ContractTermsEditor …>` element, after `profileHref={resolve('/family/profile')}` add:

```svelte
						paymentMethodMissing={contract.hasPaymentMethod === false}
						billingHref={resolve('/family/billing')}
```

- [ ] **Step 4: Run the tests and svelte-check**

Run: `cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bunx vitest run src/lib/components/contracts && bun run check`
Expected: 10 tests PASS; `0 ERRORS`.

- [ ] **Step 5: Commit**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git add apps/web/src/lib/components/contracts
git commit -m "feat(web): prompt for a card before sending contract terms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Whole-repo verification

**Files:** none new (fixes only if a check fails; commit them as `fix: …`).

- [ ] **Step 1: Stripe stays inside its packages**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
grep -rln "from 'stripe'" apps packages --include=*.ts --include=*.svelte | grep -v node_modules
grep -rln "@stripe/stripe-js" apps/web/src
grep -rn "STRIPE_WEBHOOK_INSECURE\|skipVerif\|constructEventWithoutVerification" apps packages --include=*.ts | grep -v node_modules
```

Expected: first command prints only `packages/payments/src/stripe.ts` and `packages/payments/src/stripe.test.ts`; second only `apps/web/src/lib/stripe.ts` and `apps/web/src/lib/components/payments/PaymentModal.svelte`; third prints nothing.

- [ ] **Step 2: Lint, types, tests, build**

Run from the worktree root, one at a time:

```bash
cd /run/media/hbt/work/poppynz/stripe-integration && bun run lint
cd /run/media/hbt/work/poppynz/stripe-integration && bun run check-types
cd /run/media/hbt/work/poppynz/stripe-integration/packages/payments && bun test src
cd /run/media/hbt/work/poppynz/stripe-integration/packages/billing && bun test src
cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bunx vitest run && bun run build
cd /run/media/hbt/work/poppynz/stripe-integration/apps/worker && bunx vitest run
cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && bun run check && bunx vitest run
```

Expected: lint — 0 errors (1 pre-existing warning); check-types — all turbo tasks successful; payments 27 pass; billing 27 pass; api — only the 2 pre-existing `mailer.unit.test.ts` failures, build exits 0; worker 32 pass; web `0 ERRORS` and 74 tests pass.

Re-run the two throwaway type-checks from Task 8 Step 4 (`ENTRY_OK`) and Task 9 Step 6 (`WORKER_OK`).

- [ ] **Step 3: Formatting of what this branch touched**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
git diff --name-only develop... -- '*.ts' '*.svelte' | xargs node_modules/.bin/prettier --check
```

Expected: only the three files listed as pre-existing in Global Constraints may warn. Format anything else with `--write`, re-run the affected tests, commit as `style: …`.

---

### Task 15: Local end-to-end in Stripe test mode

Drives the real flow: Docker stack from this worktree, `stripe listen` forwarding to the API, the web app on port 5175. Every scenario in spec §6. Do not print secrets: read keys from `.env` into shell variables only.

**Files:** `apps/api/.env` (local only, gitignored — `apps/worker/.env` is a symlink to it). Nothing is committed in this task except fixes.

- [ ] **Step 1: Make sure this worktree owns the stack**

```bash
docker ps --format '{{.Names}}'
docker inspect api --format '{{range .Mounts}}{{.Source}} {{end}}' 2>/dev/null
```

If `api` is running from another worktree, ask the user before taking it over (the compose project is always `poppynz_dev`, so `up` from here recreates the containers on this checkout).

- [ ] **Step 2: Configure test mode (no values printed)**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
mkdir -p bun_node_modules postgres_data
grep -c '^STRIPE_SECRET_KEY=sk_test_' apps/api/.env            # expect 1
grep -c '^PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_' apps/web/.env # expect 1
grep -c '^TRUSTED_ORIGINS=.*localhost:5175' apps/api/.env       # expect 1
```

If either key is missing, stop and ask the user to add it — never paste keys into commands or files yourself.

Every real Credibled order costs money and `CREDIBLED_PROVIDER_API_KEY` in `apps/api/.env` is live. Put Credibled in log mode for this run (paid orders then get a synthetic `log-mode-…` check id) — comment the key out and remember to restore it in Step 10:

```bash
sed -i 's/^CREDIBLED_PROVIDER_API_KEY=/#E2E# CREDIBLED_PROVIDER_API_KEY=/' apps/api/.env
```

Switch the provider and store the CLI's webhook secret (stable per Stripe CLI login, the same one `stripe listen` prints as "Your webhook signing secret is whsec_…"):

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
STRIPE_KEY="$(sed -n 's/^STRIPE_SECRET_KEY=//p' apps/api/.env)"
WHSEC="$(stripe listen --api-key "$STRIPE_KEY" --print-secret)"
sed -i '/^PAYMENTS_PROVIDER=/d; /^STRIPE_WEBHOOK_SECRET=/d' apps/api/.env
printf 'PAYMENTS_PROVIDER=stripe\nSTRIPE_WEBHOOK_SECRET=%s\n' "$WHSEC" >> apps/api/.env
unset WHSEC
grep -c '^STRIPE_WEBHOOK_SECRET=whsec_' apps/api/.env   # expect 1
```

- [ ] **Step 3: Start the stack and apply 0025**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
docker compose up -d
docker compose up migrations
docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d app_db.billing_customers" -c "\d app_db.stripe_webhook_events"' | head -5
```

Expected: both tables exist. If migrations report success but the tables are missing, Docker Desktop is serving a stale `_journal.json` (a known local gotcha) — apply the file by hand and record it so drizzle stays consistent:

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
docker exec -i postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < packages/db/src/migrations/0025_stripe_payments.sql
HASH="$(sha256sum packages/db/src/migrations/0025_stripe_payments.sql | cut -d' ' -f1)"
echo "INSERT INTO drizzle_app_db.__drizzle_migrations_app (hash, created_at) VALUES ('$HASH', 1788160000000);" \
  | docker exec -i postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

`.env` changes need a recreate, code changes a restart:

```bash
docker compose up -d --force-recreate api worker   # after editing apps/api/.env
docker restart api                                 # after changing apps/api code (no hot reload in the container)
docker logs api 2>&1 | grep -i "stripe\|payments" | tail -5
```

Expected: no `STRIPE_SECRET_KEY` / "Only Stripe test-mode keys" error; no "STRIPE_WEBHOOK_SECRET is not set" warning.

- [ ] **Step 4: Forward webhooks**

In a second terminal (keep it running; it prints every delivery and our status code):

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
stripe listen --api-key "$(sed -n 's/^STRIPE_SECRET_KEY=//p' apps/api/.env)" \
  --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,payment_intent.processing,setup_intent.succeeded,charge.refunded,charge.dispute.created \
  --forward-to localhost:3000/webhooks/stripe
```

Smoke-check both ends of the signature rule:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/webhooks/stripe -H 'stripe-signature: t=1,v1=forged' -d '{}'
stripe trigger payment_intent.succeeded --api-key "$(sed -n 's/^STRIPE_SECRET_KEY=//p' /run/media/hbt/work/poppynz/stripe-integration/apps/api/.env)"
```

Expected: `400` from curl; the listener shows the triggered events answered `[200]` (an intent we never created settles as `unknown`).

- [ ] **Step 5: Web app on 5175**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration/apps/api && bun run build
cd /run/media/hbt/work/poppynz/stripe-integration/apps/web && PORT=5175 bun run dev --strictPort
```

(or a root `.claude/launch.json` entry pointing at `stripe-integration/apps/web` on 5175 `--strictPort`, started with the preview tool). Only `http://localhost:5175` is used — it is in `TRUSTED_ORIGINS`.

Accounts: sign up a family and a helper at `http://localhost:5175/auth/sign-up`; the magic links are logged by the API (`docker logs api 2>&1 | grep -o 'http[^ "]*magic-link/verify[^ "]*' | tail -1`). Families' "Enhanced Canadian Criminal Record Check" and helpers' Credibled checks are orderable from the seeds. Shortcuts for SQL checks below:

```bash
# SQL goes in on stdin, so quotes inside the statement need no escaping.
PSQL() { echo "$1" | docker exec -i postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }
PSQLV() { echo "$1" | docker exec -i postgres sh -c 'psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }
```

Test cards (any future expiry, any CVC, any postcode): `4242 4242 4242 4242` succeeds; `4000 0025 0000 3155` requires 3-D Secure (complete it in the popup); `4000 0000 0000 9995` is declined (insufficient funds).

- [ ] **Step 6: Family check payment saves the card, then a one-click repeat**

1. Family → Documents → add the Credibled check → Safety verification → "Pay $… and start". The modal shows the card form and the notice "Your card will be saved for future Poppynz payments, such as contract billing. You can replace it in Billing." Pay with `4242…` → toast "Payment received…", status "Payment in progress" then "Waiting on you" (worker placed the log-mode order).
2. `PSQL "select status, provider, receipt_url is not null as has_receipt from app_db.payments order by created_at desc limit 1"` → `captured | stripe | t`; `PSQL "select provider, card_brand, card_last4 from app_db.billing_customers"` → `stripe | visa | 4242`.
3. The listener shows `payment_intent.succeeded [200]` (the browser's confirm usually wins; the webhook then settles as `final`).
4. Free the slot for a second order: `PSQL "update app_db.check_orders set status='cancelled' where status in ('invited','in_progress')"`. Add the check again → Pay: the modal shows "Pay $… with Visa •••• 4242" and "Use another card", no notice. Click the one-click button → paid, no card form. `/family/billing` lists both payments as Paid with Receipt links (they open Stripe's receipt).

- [ ] **Step 7: Helper one-off, 3-D Secure, decline**

1. Helper → add a Credibled check → Pay. Plain form, no notice, no saved card. Pay with `4000 0025 0000 3155`, complete 3-D Secure → paid. `PSQL "select u.email from app_db.billing_customers b join app_db.\"user\" u on u.id = b.user_id"` lists only the family. The helper has no Billing item and `GET /api/v1/billing` answers 403.
2. Family (after freeing the slot as in Step 6.4) → Pay → "Use another card" → `4000 0000 0000 9995`. The modal shows Stripe's decline message and only Close; the toast says the payment was declined; the panel is back to the basket. `PSQL "select status, last_error from app_db.payments order by created_at desc limit 1"` → `failed | Your card has insufficient funds.`; in the Stripe dashboard (test mode) that PaymentIntent is **Canceled**. The saved card is still Visa •••• 4242.

- [ ] **Step 8: Adding and replacing a card; contract send gate**

1. `/family/billing` → Replace card → `4000 0025 0000 3155` → 3-D Secure → toast "Visa •••• 3155 is now your card on file." The listener shows `setup_intent.succeeded [200]`. The old card is detached — this lists only the …3155 card:

```bash
CUS="$(PSQLV "select customer_reference from app_db.billing_customers where provider = 'stripe' limit 1")"
stripe payment_methods list --customer "$CUS" --type card \
  --api-key "$(sed -n 's/^STRIPE_SECRET_KEY=//p' /run/media/hbt/work/poppynz/stripe-integration/apps/api/.env)" | grep '"last4"'
```
2. Optional (needs an approved helper with services and an unlocked conversation): with the family's card cleared (`PSQL "update app_db.billing_customers set card_reference=null, card_brand=null, card_last4=null, card_exp_month=null, card_exp_year=null"`), the contract editor shows "Add a card to send — your card is used for contract billing" and Send is disabled; restoring a card via Billing re-enables it.

- [ ] **Step 9: Webhook before the browser, and the recovery job**

1. **Webhook first:** in the browser's DevTools → Network → block request URL `*order/confirm*`. Pay for a (freed) check with `4242…`. The confirm call is blocked; the webhook alone settles it: the listener shows `payment_intent.succeeded [200]`, the payment is `captured`, and the open page refreshes itself (SSE `safety_verification.updated`). Unblock afterwards.
2. **Webhook after the browser:** a normal payment (Step 6) — the webhook arrives second and is answered 200 with nothing changed (`docker logs api 2>&1 | grep 'stripe:webhook' | tail -3` shows `settle: final`).
3. **Recovery after 10 minutes (tab closed, webhook lost):** stop `stripe listen` (Ctrl-C), block `*order/confirm*` again, pay with `4242…`, close the tab. `PSQL "select status from app_db.payments order by created_at desc limit 1"` → `pending`. Age it and run the job now instead of waiting for the 15-minute schedule:

```bash
PSQL "update app_db.payments set created_at = now() - interval '11 minutes' where status = 'pending'"
docker exec -w /usr/src/app/apps/worker worker bun -e "import { Queue } from 'bullmq'; import { getRedisConnection } from '@repo/queue'; const q = new Queue('safety-verification', { connection: getRedisConnection() }); await q.add('recover-pending-payments', {}); await q.close();"
sleep 5; docker logs worker 2>&1 | grep 'payment recovery' | tail -1
```

Expected: `payment recovery: 1 captured, 0 failed (0 abandoned), 0 errors of 1`; the payment is `captured` and its order moves on.
4. **Abandoned after 24 hours:** open the payment modal and close it without paying (row `pending`, intent waiting for a card). Then:

```bash
PSQL "update app_db.payments set created_at = now() - interval '25 hours' where status = 'pending'"
docker exec -w /usr/src/app/apps/worker worker bun -e "import { Queue } from 'bullmq'; import { getRedisConnection } from '@repo/queue'; const q = new Queue('safety-verification', { connection: getRedisConnection() }); await q.add('recover-pending-payments', {}); await q.close();"
sleep 5; docker logs worker 2>&1 | grep 'payment recovery' | tail -1
```

Expected: `… 1 failed (1 abandoned) …`; the intent is Canceled in Stripe; the order is back to the basket (`not_started`).

Restart `stripe listen` and unblock the URL when done.

- [ ] **Step 10: Restore the local configuration and report**

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
sed -i 's/^#E2E# CREDIBLED_PROVIDER_API_KEY=/CREDIBLED_PROVIDER_API_KEY=/' apps/api/.env
docker compose up -d --force-recreate api worker
git status --short
```

Leave `PAYMENTS_PROVIDER=stripe` only if the user wants it (default back to `mock` otherwise). Expected `git status`: clean (or only committed fixes). Report each scenario of Steps 4–9 with pass/fail and screenshots of the modal states (form + notice, one-click saved card, decline message) and the Billing page before any push or PR.
