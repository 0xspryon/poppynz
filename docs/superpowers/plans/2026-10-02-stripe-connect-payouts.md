# Helper Payout Accounts (Stripe Connect, piece 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Helpers set up a Stripe Connect Express payout account on Stripe's hosted pages and see whether they are payment-ready; pieces 3 and 4 get `isPaymentReady(userId)`, and nothing in 2b blocks acceptance.

**Architecture:** `@repo/payments` gains four payout operations on the existing `Payments` port in `src/port.ts` (mock in `src/mock.ts`: instantly enabled; Stripe: `accounts` / `accountLinks` / login links in a new `src/stripe-connect.ts` spread into 2a's `makeStripePayments`). A new `payout_accounts` table stores one re-fetched snapshot per helper, with the status derived by a pure function in `apps/api/src/lib/payouts.ts`. New `/payouts` routes (permission `payouts`), an `account.updated` case in 2a's `processStripeEvent` (`/webhooks/stripe`), `payoutsReady` on the contract detail, and a web Payouts page, sidebar badge and acceptance reminder.

**Tech Stack:** Bun workspaces + Turborepo, Effect 3, Hono RPC, Drizzle (hand-written SQL migrations), `stripe` Node SDK (installed by 2a; types checked against `stripe@23.0.0`, API version `2026-09-30.endive`), SvelteKit 5 (runes) + DaisyUI 5, vitest (api, web), `bun test` (packages), Stripe CLI 1.53 (local e2e).

**Spec:** `docs/superpowers/specs/2026-10-02-stripe-connect-payouts-design.md` (builds on `docs/superpowers/specs/2026-10-02-stripe-payments-design.md`; umbrella `docs/superpowers/specs/2026-09-24-stripe-contract-billing-design.md` §3 "Helper Connect onboarding", §6 "Payment-readiness gate").

## Global Constraints

- Work in the worktree `/run/media/hbt/work/poppynz/stripe-integration`. Never `cd` into another worktree; never `git stash`.
- **Piece 2a has landed** on `feature/stripe-integration` (reconciled against HEAD `b67bb83`). This plan uses its real names:
  - `@repo/payments` is split into `src/port.ts` (types, `PaymentOperation` union, `PaymentProviderError`, `PaymentWebhookSignatureError`, the `Payments` tag), `src/mock.ts` (`makeMockPayments(options)`, `PaymentsMock`, `makePaymentsTest(partial)`), `src/stripe.ts` (`StripeApi` — the narrow SDK slice — `makeStripeClient(secretKey)`, `makeStripePayments({ client, webhookSecret })`, `STRIPE_API_VERSION = '2026-09-30.endive'`) and `src/layer.ts` (`PaymentsLive`, which reads `stripeConfig` and refuses a non-`sk_test_`/`rk_test_` key). `src/index.ts` only re-exports `port`, `mock` and `layer`.
  - `verifyWebhook(rawBody, signatureHeader)` uses `client.webhooks.constructEventAsync` (async: under Bun the SDK's SubtleCrypto provider can't verify synchronously) and returns `PaymentWebhookEvent = { eventId, type, objectId, paymentReference: string | null, account: string | null }` — `account` is already filled from `event.account` for Connect events.
  - `stripeConfig` (`@repo/env`): `{ provider: 'mock' | 'stripe' (PAYMENTS_PROVIDER, default mock), secretKey, webhookSecret (Option<Redacted>), settleAfterMinutes, abandonAfterHours }`.
  - `POST /webhooks/stripe` (`apps/api/src/routes/webhooks/stripe.ts`): `stripeWebhookProgram(rawBody, signature)` verifies, `StripeWebhookEventRepo.record` → `'new' | 'unprocessed' | 'processed'`, runs `processStripeEvent(event)` (returns a log note string; any failure → `markFailed` + 500), then `markProcessed`. `bodyLimit` (512 KiB) sits in front. `processStripeEvent` already has an `account.updated` placeholder case for 2b.
  - Contract detail already carries `hasPaymentMethod: boolean | null` (family viewer only); `billing: ['read','write']` is a family-only permission.
  - 2a's provider-switch rule: a stored provider reference only counts while its `provider` equals `payments.provider` (`toCard` in `@repo/billing`, `BillingCustomerRepo.upsertCustomer` replaces a row from another provider). 2b follows the same rule for payout accounts.
- Stripe is imported **only inside `@repo/payments`** (`src/stripe.ts`, `src/stripe-connect.ts`, `scripts/`). Nothing in `apps/` imports `stripe`. Inside the package, `stripe-connect.ts` imports from `./port` (never `./index`, which re-exports `layer` → `stripe` → `stripe-connect`).
- **Test mode only.** Never use or print a live key; scripts refuse any key that doesn't start with `sk_test_`. Never print `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` or any `CREDIBLED_*` value.
- **Provider-scoped accounts (2a's rule).** A `payout_accounts` row counts only while `row.provider === payments.provider`; under another provider it reads as "no account", and `PayoutAccountRepo.create` replaces it (resetting the snapshot). This is what keeps a `mock_acct_…` row from a mock run from being sent to Stripe, or reported ready, after `PAYMENTS_PROVIDER=stripe`.
- Express accounts: country `CA`, `business_type: 'individual'`, `capabilities.transfers.requested: true`, `metadata.user_id`, idempotency key `payout-account:<userId>`. Onboarding via Account Links (`type: 'account_onboarding'`), never stored.
- Payment-ready = `details_submitted` AND `payouts_enabled` AND `capabilities.transfers === 'active'`. Status is always re-fetched from Stripe, never read from a webhook payload.
- Status derivation (exact): `ready` = all three true; `disabled` = `disabledReason` starts with `rejected.`; `restricted` = details submitted but not ready; `onboarding` = otherwise.
- **2b doesn't block anything.** Acceptance is never gated on payout readiness; the reminder and the badge only inform.
- Config (exact): `APP_WEB_ORIGIN` default `https://app.poppynz.com` (local `.env`: `http://localhost:5175`); `PAYOUTS_REFRESH_AFTER_MINUTES` default `60`. Return URL `<APP_WEB_ORIGIN>/service-provider/payouts?from=stripe`; refresh URL `<APP_WEB_ORIGIN>/service-provider/payouts?refresh=1`.
- Permission (exact): `payouts: ['read', 'write']`, granted to the service-provider role. `GET /payouts` needs `read`; the three `POST`s need `write`.
- Error codes (exact): `NO_PAYOUT_ACCOUNT` (409, refresh/dashboard without an account), `PAYOUTS_PROVIDER_ERROR` (502), `PAYOUTS_LOOKUP_FAILED` (500). Auth errors use the existing `authErrorToResponse` codes.
- Migration `0026_payout_accounts` (2a's `0025_stripe_payments` is the last, journal `when` `1788160000000`; 2b uses `1788170000000`). Hand-authored SQL plus a hand-added `meta/_journal.json` entry. Never run `drizzle-kit generate`. All new foreign keys are `ON DELETE restrict`.
- Type-checks: `bunx tsc -p tsconfig.build.json --noEmit` in `apps/api` only covers `src/hc.ts`'s graph (app routes, `@repo/*` sources). It does **not** reach `src/index.ts`, the webhook routes or any test file; Tasks 6 and 11 use 2a's throwaway entry config for those.
- AGENTS.md rules: route error types derived from programs (`Effect.Effect.Error<ReturnType<typeof program>>`); mappers switch on `_tag` and end in `handleNever`; new route/domain programs get focused unit tests; pipe repo/provider calls through mappers (`repo.x().pipe((errors) => mapPayoutsRepoError(errors))`); permissions, not role checks; user-facing outcomes are toasts.
- Reminder copy (exact): "**You'll need a payout account to collect your earnings.** Set it up now, or later — you'll be asked again before your first payment."
- Commit after every task with a conventional message ending in the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/payments/src/port.ts` (2a) | Payout types, four payout operations on `Payments`, four names appended to `PaymentOperation` |
| `packages/payments/src/mock.ts` (2a) | Mock implementations in `makeMockPayments` |
| `packages/payments/src/payouts-mock.test.ts` | Mock contract tests |
| `packages/payments/src/stripe-connect.ts` | Stripe adapter for the four operations + snapshot normalisation |
| `packages/payments/src/stripe-connect.test.ts` | Adapter tests against a faked Stripe client |
| `packages/payments/src/stripe.ts` (2a) | `StripeApi` widened with the Connect slice; operations spread into `makeStripePayments`; `verifyWebhook` tries the Connect secret too |
| `packages/payments/src/stripe.test.ts` (2a) | One Connect-signed `verifyWebhook` case |
| `packages/payments/src/layer.ts` (2a) | Passes `connectWebhookSecret` to `makeStripePayments` |
| `packages/payments/src/webhook-secrets.ts` (+ `.test.ts`) | Verify a signature (async) against the platform OR Connect endpoint secret |
| `packages/payments/scripts/e2e-payout-account.ts` | Local e2e helper (test mode): payout-ready Custom account, `touch` |
| `packages/env/src/index.ts` | `payoutsConfig`; `stripeConfig.connectWebhookSecret` |
| `packages/db/src/migrations/0026_payout_accounts.sql` + `meta/_journal.json` | Table, enum, FK, unique index |
| `packages/db/src/schema.ts` | `payoutAccountStatus`, `payoutAccount` |
| `packages/db/src/repos/payout-account-repo.ts` | `PayoutAccountRepo`, `makePayoutAccountRepoTest`, `makeInMemoryPayoutAccountRepo`, `dummyPayoutAccount` (2a's `billing-customer-repo.ts` pattern) |
| `apps/api/src/lib/payouts.ts` | Derivation, labels, refresh rule, `isPaymentReady`, `hasReadyPayoutAccount`, `handleAccountUpdated` |
| `apps/api/src/lib/payouts.test-support.ts` | `readySnapshot` (a `@repo/payments` type, so it can't live in `@repo/db`) |
| `apps/api/src/lib/payouts.unit.test.ts` | Domain tests |
| `apps/api/src/lib/auth-roles.ts` | `payouts` permission |
| `apps/api/src/routes/app/payouts/payouts.handler.ts`, `payouts.ts`, `payouts.unit.test.ts` | `/payouts` routes |
| `apps/api/src/routes/app/index.ts`, `managed-runtime.ts`, `app-env.ts` | Registration (`apps/worker` is unchanged: it builds `PaymentsLive`, which gains the operations, and 2b has no worker job) |
| `apps/api/src/routes/webhooks/stripe.ts` (2a) (+ `stripe.unit.test.ts`) | `account.updated` case in `processStripeEvent`; `makeWorld` gains a payout repo |
| `apps/api/src/routes/app/contracts/contracts.handler.ts` (+ unit test) | `payoutsReady` on the detail |
| `apps/web/src/lib/api/payouts.ts` | RPC wrappers |
| `apps/web/src/lib/payouts-badge.svelte.ts` (+ `payouts-badge.test.ts`) | Sidebar badge store |
| `apps/web/src/lib/components/SidebarNav.svelte` | `badge` accepts a string |
| `apps/web/src/routes/service-provider/+layout.svelte` | Payouts nav item + badge |
| `apps/web/src/lib/components/payouts/PayoutsPage.svelte` (+ mount test) | Status-driven page |
| `apps/web/src/routes/service-provider/payouts/+page.svelte` | Route: reads `?from=stripe` / `?refresh=1` |
| `apps/web/src/lib/components/payouts/PayoutsReminder.svelte` (+ mount test) | Acceptance reminder |
| `apps/web/src/lib/components/admin/ConfirmDialog.svelte` (+ mount test) | Optional `children` snippet |
| `apps/web/src/lib/components/contracts/ContractDetailPage.svelte` | Reminder in the accept dialog |
| `.env.example`, `apps/api/.env.example`, `docs/activating-stripe-connect.md` | Config + live notes |

---

### Task 1: Payout operations on the payment port, with the mock

**Files:**
- Modify: `packages/payments/src/port.ts`, `packages/payments/src/mock.ts`
- Create: `packages/payments/src/payouts-mock.test.ts`

**Interfaces:**
- Consumes: 2a's `Payments` tag and `PaymentOperation` union (`src/port.ts`), `makeMockPayments(options: { failStart?, failRefund?, now? })` and `makePaymentsTest(partial)` (`src/mock.ts`), `PaymentProviderError` (`{ operation: PaymentOperation; cause: unknown }`).
- Produces (exported from `@repo/payments` through `index.ts`'s `export * from './port'`):
  - `type PayoutAccountSnapshot = { readonly detailsSubmitted: boolean; readonly payoutsEnabled: boolean; readonly transfersActive: boolean; readonly requirementsDue: ReadonlyArray<string>; readonly disabledReason: string | null }`
  - `type PayoutAccountCreated = { readonly reference: string }`
  - `type OnboardingLink = { readonly url: string; readonly expiresAt: Date }`
  - `type DashboardLink = { readonly url: string }`
  - `Payments` service gains:
    - `createPayoutAccount(input: { userId: string; email: string }): Effect<PayoutAccountCreated, PaymentProviderError>`
    - `createOnboardingLink(input: { reference: string; returnUrl: string; refreshUrl: string }): Effect<OnboardingLink, PaymentProviderError>`
    - `getPayoutAccount(reference: string): Effect<PayoutAccountSnapshot, PaymentProviderError>`
    - `createDashboardLink(reference: string): Effect<DashboardLink, PaymentProviderError>`
  - `PaymentOperation` (and so `PaymentProviderError['operation']`) includes `'createPayoutAccount' | 'createOnboardingLink' | 'getPayoutAccount' | 'createDashboardLink'`.

- [ ] **Step 1: Write the failing test**

`packages/payments/src/payouts-mock.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { makeMockPayments } from './mock';
import { PaymentProviderError } from './port';

describe('mock payout accounts', () => {
  const payments = makeMockPayments({ now: () => new Date('2026-10-02T12:00:00Z') });

  it('creates one account per user (same reference on a retry)', async () => {
    const first = await Effect.runPromise(
      payments.createPayoutAccount({ userId: 'helper-1', email: 'h@example.com' })
    );
    const again = await Effect.runPromise(
      payments.createPayoutAccount({ userId: 'helper-1', email: 'h@example.com' })
    );
    expect(first.reference).toBe('mock_acct_helper-1');
    expect(again).toEqual(first);
  });

  it('sends onboarding straight back to the return page', async () => {
    const link = await Effect.runPromise(
      payments.createOnboardingLink({
        reference: 'mock_acct_helper-1',
        returnUrl: 'http://localhost:5175/service-provider/payouts?from=stripe',
        refreshUrl: 'http://localhost:5175/service-provider/payouts?refresh=1'
      })
    );
    expect(link.url).toBe('http://localhost:5175/service-provider/payouts?from=stripe');
    expect(link.expiresAt.toISOString()).toBe('2026-10-02T12:05:00.000Z');
  });

  it('reports every account as fully enabled straight away', async () => {
    const snapshot = await Effect.runPromise(payments.getPayoutAccount('mock_acct_helper-1'));
    expect(snapshot).toEqual({
      detailsSubmitted: true,
      payoutsEnabled: true,
      transfersActive: true,
      requirementsDue: [],
      disabledReason: null
    });
  });

  it('returns a harmless dashboard URL', async () => {
    const link = await Effect.runPromise(payments.createDashboardLink('mock_acct_helper-1'));
    expect(link.url).toBe('about:blank');
  });

  it('names payout operations on provider errors', () => {
    const error = new PaymentProviderError({ operation: 'getPayoutAccount', cause: 'x' });
    expect(error.operation).toBe('getPayoutAccount');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/payments && bun test src/payouts-mock.test.ts`
Expected: FAIL — `payments.createPayoutAccount is not a function` (and a type error on `'getPayoutAccount'` if run through tsc).

- [ ] **Step 3: Add the types and port operations**

In `packages/payments/src/port.ts`:

1. Append the four payout names to 2a's `PaymentOperation` union (`PaymentProviderError` takes `operation: PaymentOperation`, so it widens with it). The union becomes:

```ts
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
  | 'verifyWebhook'
  | 'createPayoutAccount'
  | 'createOnboardingLink'
  | 'getPayoutAccount'
  | 'createDashboardLink';
```

2. Add these types after `ProviderCardSetup` (before `PaymentWebhookEvent`):

```ts
/** A helper's payout account as the provider reports it, normalised. Always
 * re-fetched — a webhook only says "something changed", never what. */
export type PayoutAccountSnapshot = {
  readonly detailsSubmitted: boolean;
  readonly payoutsEnabled: boolean;
  /** The `transfers` capability is `active`. */
  readonly transfersActive: boolean;
  /** Provider requirement codes due now or past due, deduplicated. */
  readonly requirementsDue: ReadonlyArray<string>;
  readonly disabledReason: string | null;
};

export type PayoutAccountCreated = {
  /** The connected account id (`acct_…` on Stripe). */
  readonly reference: string;
};

/** A single-use hosted-onboarding URL. Short-lived; never stored. */
export type OnboardingLink = {
  readonly url: string;
  readonly expiresAt: Date;
};

export type DashboardLink = {
  readonly url: string;
};
```

3. Add the four operations to the `Payments` service type in the `Context.Tag('@repo/payments/Payments')` declaration, after `removeCard` and before `verifyWebhook`:

```ts
    /** Creates the helper's connected account. Same user → same account
     * (idempotency key `payout-account:<userId>`). */
    createPayoutAccount: (input: {
      userId: string;
      email: string;
    }) => Effect.Effect<PayoutAccountCreated, PaymentProviderError>;
    /** Hosted onboarding for an existing account. */
    createOnboardingLink: (input: {
      reference: string;
      returnUrl: string;
      refreshUrl: string;
    }) => Effect.Effect<OnboardingLink, PaymentProviderError>;
    getPayoutAccount: (reference: string) => Effect.Effect<PayoutAccountSnapshot, PaymentProviderError>;
    /** A login link to the provider's payout dashboard. */
    createDashboardLink: (reference: string) => Effect.Effect<DashboardLink, PaymentProviderError>;
```

4. In `packages/payments/src/mock.ts`, in the object returned by `makeMockPayments`, add after `removeCard: () => Effect.void,` and before `verifyWebhook` (`now` is already in scope; the import list needs nothing new):

```ts
    // Payout accounts: enabled straight away, so the whole helper flow runs
    // without Stripe. The "hosted onboarding" is the return page itself.
    createPayoutAccount: ({ userId }) => Effect.succeed({ reference: `mock_acct_${userId}` }),

    createOnboardingLink: ({ returnUrl }) =>
      Effect.sync(() => ({
        url: returnUrl,
        expiresAt: new Date(now().getTime() + 5 * 60 * 1000)
      })),

    getPayoutAccount: () =>
      Effect.succeed({
        detailsSubmitted: true,
        payoutsEnabled: true,
        transfersActive: true,
        requirementsDue: [],
        disabledReason: null
      }),

    createDashboardLink: () => Effect.succeed({ url: 'about:blank' }),
```

- [ ] **Step 4: Run the tests and the type-check**

Run: `cd packages/payments && bun test src`
Expected: PASS (2a's tests and the new file).

Run: `cd apps/api && bunx tsc -p tsconfig.build.json --noEmit`
Expected: one error, in `packages/payments/src/stripe.ts`: the object `makeStripePayments` returns (typed `Context.Tag.Service<Payments>`) lacks the four new operations. Leave it; Task 2 adds them.

- [ ] **Step 5: Commit**

```bash
git add packages/payments/src/port.ts packages/payments/src/mock.ts packages/payments/src/payouts-mock.test.ts
git commit -m "feat(payments): payout account operations on the port, mock enabled instantly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stripe Connect adapter

**Files:**
- Create: `packages/payments/src/stripe-connect.ts`, `packages/payments/src/stripe-connect.test.ts`
- Modify: `packages/payments/src/stripe.ts` (2a)

**Interfaces:**
- Consumes: Task 1 types; `stripe@^23.0.0` (already in `packages/payments/package.json`); 2a's `StripeApi` (the narrow SDK slice `makeStripeClient` returns and `makeStripePayments({ client, webhookSecret })` takes) in `src/stripe.ts`.
- Produces:
  - `type StripeConnectClient = { accounts: Pick<Stripe['accounts'], 'create' | 'retrieve' | 'createLoginLink'>; accountLinks: Pick<Stripe['accountLinks'], 'create'> }` (a real `Stripe` instance satisfies it)
  - `StripeApi` (2a) becomes `{ …2a's six resources… } & StripeConnectClient`
  - `toPayoutAccountSnapshot(account: Stripe.Account): PayoutAccountSnapshot`
  - `makeStripeConnectOperations(stripe: StripeConnectClient): Pick<Context.Tag.Service<Payments>, 'createPayoutAccount' | 'createOnboardingLink' | 'getPayoutAccount' | 'createDashboardLink'>`

- [ ] **Step 1: Write the failing test**

`packages/payments/src/stripe-connect.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';
import type Stripe from 'stripe';
import {
  makeStripeConnectOperations,
  toPayoutAccountSnapshot,
  type StripeConnectClient
} from './stripe-connect';

const account = (overrides: Record<string, unknown> = {}): Stripe.Account =>
  ({
    id: 'acct_123',
    object: 'account',
    type: 'express',
    charges_enabled: false,
    details_submitted: false,
    payouts_enabled: false,
    email: 'helper@example.com',
    capabilities: { transfers: 'inactive' },
    requirements: {
      currently_due: ['external_account', 'individual.dob.day'],
      past_due: ['individual.dob.day', 'tos_acceptance.date'],
      disabled_reason: 'requirements.past_due'
    },
    ...overrides
  }) as unknown as Stripe.Account;

type Call = { method: string; args: Array<unknown> };

const makeFakeStripe = (options: { retrieved?: Stripe.Account; failWith?: Error } = {}) => {
  const calls: Array<Call> = [];
  const respond = <T>(method: string, args: Array<unknown>, value: T) => {
    calls.push({ method, args });
    return options.failWith ? Promise.reject(options.failWith) : Promise.resolve(value);
  };
  const client = {
    accounts: {
      create: (...args: Array<unknown>) => respond('accounts.create', args, account()),
      retrieve: (...args: Array<unknown>) =>
        respond('accounts.retrieve', args, options.retrieved ?? account()),
      createLoginLink: (...args: Array<unknown>) =>
        respond('accounts.createLoginLink', args, {
          object: 'login_link',
          created: 1790000000,
          url: 'https://connect.stripe.com/express/acct_123/login'
        })
    },
    accountLinks: {
      create: (...args: Array<unknown>) =>
        respond('accountLinks.create', args, {
          object: 'account_link',
          created: 1790000000,
          expires_at: 1790000300,
          url: 'https://connect.stripe.com/setup/e/acct_123/abc'
        })
    }
  } as unknown as StripeConnectClient;
  return { client, calls };
};

describe('toPayoutAccountSnapshot', () => {
  it('normalises a fully enabled account', () => {
    expect(
      toPayoutAccountSnapshot(
        account({
          details_submitted: true,
          payouts_enabled: true,
          capabilities: { transfers: 'active' },
          requirements: { currently_due: [], past_due: [], disabled_reason: null }
        })
      )
    ).toEqual({
      detailsSubmitted: true,
      payoutsEnabled: true,
      transfersActive: true,
      requirementsDue: [],
      disabledReason: null
    });
  });

  it('merges currently due and past due without duplicates', () => {
    const snapshot = toPayoutAccountSnapshot(account());
    expect(snapshot.requirementsDue).toEqual([
      'external_account',
      'individual.dob.day',
      'tos_acceptance.date'
    ]);
    expect(snapshot.transfersActive).toBe(false);
    expect(snapshot.disabledReason).toBe('requirements.past_due');
  });

  it('treats a pending transfers capability and missing requirements as not ready', () => {
    const snapshot = toPayoutAccountSnapshot(
      account({ capabilities: { transfers: 'pending' }, requirements: undefined })
    );
    expect(snapshot.transfersActive).toBe(false);
    expect(snapshot.requirementsDue).toEqual([]);
    expect(snapshot.disabledReason).toBeNull();
  });
});

describe('makeStripeConnectOperations', () => {
  it('creates a Canadian individual Express account with transfers, keyed per user', async () => {
    const { client, calls } = makeFakeStripe();
    const result = await Effect.runPromise(
      makeStripeConnectOperations(client).createPayoutAccount({
        userId: 'helper-1',
        email: 'helper@example.com'
      })
    );
    expect(result).toEqual({ reference: 'acct_123' });
    expect(calls).toEqual([
      {
        method: 'accounts.create',
        args: [
          {
            type: 'express',
            country: 'CA',
            business_type: 'individual',
            email: 'helper@example.com',
            capabilities: { transfers: { requested: true } },
            metadata: { user_id: 'helper-1' }
          },
          { idempotencyKey: 'payout-account:helper-1' }
        ]
      }
    ]);
  });

  it('creates an account_onboarding link and converts its expiry', async () => {
    const { client, calls } = makeFakeStripe();
    const link = await Effect.runPromise(
      makeStripeConnectOperations(client).createOnboardingLink({
        reference: 'acct_123',
        returnUrl: 'http://localhost:5175/service-provider/payouts?from=stripe',
        refreshUrl: 'http://localhost:5175/service-provider/payouts?refresh=1'
      })
    );
    expect(link).toEqual({
      url: 'https://connect.stripe.com/setup/e/acct_123/abc',
      expiresAt: new Date(1790000300 * 1000)
    });
    expect(calls[0]).toEqual({
      method: 'accountLinks.create',
      args: [
        {
          account: 'acct_123',
          type: 'account_onboarding',
          return_url: 'http://localhost:5175/service-provider/payouts?from=stripe',
          refresh_url: 'http://localhost:5175/service-provider/payouts?refresh=1'
        }
      ]
    });
  });

  it('re-fetches the account by reference', async () => {
    const { client, calls } = makeFakeStripe();
    const snapshot = await Effect.runPromise(
      makeStripeConnectOperations(client).getPayoutAccount('acct_123')
    );
    expect(calls).toEqual([{ method: 'accounts.retrieve', args: ['acct_123'] }]);
    expect(snapshot.detailsSubmitted).toBe(false);
  });

  it('creates an Express dashboard login link', async () => {
    const { client, calls } = makeFakeStripe();
    const link = await Effect.runPromise(
      makeStripeConnectOperations(client).createDashboardLink('acct_123')
    );
    expect(link).toEqual({ url: 'https://connect.stripe.com/express/acct_123/login' });
    expect(calls).toEqual([{ method: 'accounts.createLoginLink', args: ['acct_123'] }]);
  });

  it('wraps a Stripe failure in PaymentProviderError naming the operation', async () => {
    const { client } = makeFakeStripe({ failWith: new Error('boom') });
    const exit = await Effect.runPromiseExit(
      makeStripeConnectOperations(client).getPayoutAccount('acct_123')
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain('getPayoutAccount');
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/payments && bun test src/stripe-connect.test.ts`
Expected: FAIL — `Cannot find module './stripe-connect'`.

- [ ] **Step 3: Write the adapter**

`packages/payments/src/stripe-connect.ts`:

```ts
import { Effect, type Context } from 'effect';
import type Stripe from 'stripe';
import { PaymentProviderError, type Payments, type PayoutAccountSnapshot } from './port';

/**
 * Stripe Connect (Express) for helper payout accounts — piece 2b.
 *
 * Only the four calls 2b needs, typed structurally (like 2a's `StripeApi`) so
 * tests pass a fake and the real `Stripe` client satisfies it as is.
 */
export type StripeConnectClient = {
  accounts: Pick<Stripe['accounts'], 'create' | 'retrieve' | 'createLoginLink'>;
  accountLinks: Pick<Stripe['accountLinks'], 'create'>;
};

type ConnectOperations = Pick<
  Context.Tag.Service<Payments>,
  'createPayoutAccount' | 'createOnboardingLink' | 'getPayoutAccount' | 'createDashboardLink'
>;

/** Payment-ready needs all three flags; the requirement lists only explain
 * what is missing. `past_due` is a subset of what blocks payouts now, so the
 * two lists are merged. */
export const toPayoutAccountSnapshot = (account: Stripe.Account): PayoutAccountSnapshot => {
  const due = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? [])
  ];
  return {
    detailsSubmitted: account.details_submitted,
    payoutsEnabled: account.payouts_enabled,
    transfersActive: account.capabilities?.transfers === 'active',
    requirementsDue: [...new Set(due)],
    disabledReason: account.requirements?.disabled_reason ?? null
  };
};

export const makeStripeConnectOperations = (stripe: StripeConnectClient): ConnectOperations => ({
  createPayoutAccount: ({ userId, email }) =>
    Effect.tryPromise({
      try: () =>
        stripe.accounts.create(
          {
            type: 'express',
            country: 'CA',
            business_type: 'individual',
            email,
            capabilities: { transfers: { requested: true } },
            metadata: { user_id: userId }
          },
          // A retried request returns the same account instead of a second one.
          { idempotencyKey: `payout-account:${userId}` }
        ),
      catch: (cause) => new PaymentProviderError({ operation: 'createPayoutAccount', cause })
    }).pipe(Effect.map((account) => ({ reference: account.id }))),

  createOnboardingLink: ({ reference, returnUrl, refreshUrl }) =>
    Effect.tryPromise({
      try: () =>
        stripe.accountLinks.create({
          account: reference,
          type: 'account_onboarding',
          return_url: returnUrl,
          refresh_url: refreshUrl
        }),
      catch: (cause) => new PaymentProviderError({ operation: 'createOnboardingLink', cause })
    }).pipe(Effect.map((link) => ({ url: link.url, expiresAt: new Date(link.expires_at * 1000) }))),

  getPayoutAccount: (reference) =>
    Effect.tryPromise({
      try: () => stripe.accounts.retrieve(reference),
      catch: (cause) => new PaymentProviderError({ operation: 'getPayoutAccount', cause })
    }).pipe(Effect.map(toPayoutAccountSnapshot)),

  createDashboardLink: (reference) =>
    Effect.tryPromise({
      try: () => stripe.accounts.createLoginLink(reference),
      catch: (cause) => new PaymentProviderError({ operation: 'createDashboardLink', cause })
    }).pipe(Effect.map((link) => ({ url: link.url })))
});
```

- [ ] **Step 4: Run the adapter tests**

Run: `cd packages/payments && bun test src/stripe-connect.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Spread the operations into 2a's Stripe service**

In `packages/payments/src/stripe.ts`:

1. Add the import below the `./port` import:

```ts
import { makeStripeConnectOperations, type StripeConnectClient } from './stripe-connect';
```

2. Widen 2a's `StripeApi` with the Connect slice (a `new Stripe(...)` still satisfies it, so `makeStripeClient` is unchanged):

```ts
/** The slice of the SDK this adapter uses. Narrow on purpose: a test fake only
 * has to implement these methods. */
export type StripeApi = {
  paymentIntents: Pick<Stripe['paymentIntents'], 'create' | 'retrieve' | 'cancel'>;
  setupIntents: Pick<Stripe['setupIntents'], 'create' | 'retrieve'>;
  customers: Pick<Stripe['customers'], 'create'>;
  paymentMethods: Pick<Stripe['paymentMethods'], 'detach'>;
  refunds: Pick<Stripe['refunds'], 'create'>;
  webhooks: Pick<Stripe['webhooks'], 'constructEventAsync'>;
} & StripeConnectClient;
```

3. In `makeStripePayments`, spread the operations into the returned object, right after `removeCard` and before `verifyWebhook` (2a's client variable is `client`):

```ts
    removeCard: (cardReference) =>
      call('removeCard', () => client.paymentMethods.detach(cardReference)).pipe(Effect.asVoid),

    // Helper payout accounts (Stripe Connect Express, piece 2b).
    ...makeStripeConnectOperations(client),

    verifyWebhook: (rawBody, signatureHeader) =>
```

2a's `fakeStripe()` in `stripe.test.ts` casts `as unknown as StripeApi`, so it keeps compiling without `accounts`/`accountLinks`; none of its tests reach them.

- [ ] **Step 6: Type-check and run the package suite**

Run: `cd apps/api && bunx tsc -p tsconfig.build.json --noEmit`
Expected: no errors.

Run: `cd packages/payments && bun test src`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/payments/src/stripe-connect.ts packages/payments/src/stripe-connect.test.ts packages/payments/src/stripe.ts packages/payments/src
git commit -m "feat(payments): Stripe Connect Express adapter for payout accounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `payout_accounts` table and `PayoutAccountRepo`

**Files:**
- Create: `packages/db/src/migrations/0026_payout_accounts.sql`, `packages/db/src/repos/payout-account-repo.ts`
- Modify: `packages/db/src/migrations/meta/_journal.json`, `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `apps/api/src/app-env.ts`, `apps/api/src/managed-runtime.ts`

**Interfaces:**
- Produces (from `@repo/db`):
  - `payoutAccountStatus` enum, `payoutAccount` table
  - `type PayoutAccount` (select model: `userId, provider, accountReference, status, detailsSubmitted, payoutsEnabled, transfersActive, requirementsDue: Array<string>, disabledReason: string | null, refreshedAt: Date | null, createdAt, updatedAt`)
  - `type PayoutAccountStatus = 'onboarding' | 'ready' | 'restricted' | 'disabled'`
  - `type PayoutAccountCreateInput = { userId: string; provider: string; accountReference: string }`
  - `type PayoutAccountSnapshotInput = { status: PayoutAccountStatus; detailsSubmitted: boolean; payoutsEnabled: boolean; transfersActive: boolean; requirementsDue: Array<string>; disabledReason: string | null; refreshedAt: Date }`
  - `PayoutAccountRepo` with `findByUserId(userId): Effect<PayoutAccount | null, SqlError>`, `findByReference(reference): Effect<PayoutAccount | null, SqlError>`, `create(input): Effect<PayoutAccount, SqlError | DBNotFoundError>` (same provider already on file → that row, untouched, so a concurrent duplicate is a no-op; a row from ANOTHER provider → replaced and its snapshot reset, like 2a's `BillingCustomerRepo.upsertCustomer`), `applySnapshot(userId, snapshot): Effect<PayoutAccount, SqlError | DBNotFoundError>`
  - `PayoutAccountRepoDefault`
  - `makePayoutAccountRepoTest(partial)` (2a's `makeStripeWebhookEventRepoTest` style: lookups default to `null`, writes die)
  - `type AppliedPayoutSnapshot = { userId: string; snapshot: PayoutAccountSnapshotInput }`
  - `makeInMemoryPayoutAccountRepo(initial?, applied?) → { layer, rows }` and `dummyPayoutAccount(overrides?)` (2a's `makeInMemoryBillingCustomerRepo` / `dummyBillingCustomer` pattern; `dummyPayoutAccount` defaults to `userId 'helper-1'`, `provider 'stripe'`, `accountReference 'acct_123'`, `status 'onboarding'`, `refreshedAt` now)

There is no database test harness in `packages/db` (repos are exercised through api unit tests with test layers and by the local e2e, Task 12). This task's gate is the type-check; Task 12 applies the migration and exercises the repo against Postgres.

- [ ] **Step 1: Write the migration**

`packages/db/src/migrations/0026_payout_accounts.sql`:

```sql
-- Helper payout accounts (Stripe Connect Express), piece 2b.
--
-- One row per helper. Stripe hosts onboarding; Poppynz stores only the
-- connected account id and the last snapshot it RE-FETCHED from Stripe (never
-- a webhook payload). `status` is derived from the three flags by the API:
--   ready      details submitted, payouts enabled, transfers capability active
--   disabled   Stripe rejected the account (disabled_reason 'rejected.*')
--   restricted details submitted but not ready
--   onboarding otherwise
-- refreshed_at drives the read-time re-fetch (PAYOUTS_REFRESH_AFTER_MINUTES);
-- NULL means never fetched. user_id is restrict: a helper with a payout
-- account is never hard-deleted under it.
CREATE TYPE "app_db"."payout_account_status" AS ENUM('onboarding', 'ready', 'restricted', 'disabled');--> statement-breakpoint
CREATE TABLE "app_db"."payout_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"account_reference" text NOT NULL,
	"status" "app_db"."payout_account_status" DEFAULT 'onboarding' NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"transfers_active" boolean DEFAULT false NOT NULL,
	"requirements_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disabled_reason" text,
	"refreshed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "app_db"."payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_db"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- How an account.updated webhook finds its helper.
CREATE UNIQUE INDEX "payout_accounts_account_reference_uidx" ON "app_db"."payout_accounts" USING btree ("account_reference");
```

- [ ] **Step 2: Add the journal entry**

`packages/db/src/migrations/meta/_journal.json` is one line. Append an entry after 2a's `0025_stripe_payments` entry (inside the `entries` array, before `]}`), with `idx` 26 and a `when` larger than 0025's:

```json
, {"idx": 26, "version": "7", "when": 1788170000000, "tag": "0026_payout_accounts", "breakpoints": true}
```

Check: `bun -e "const j=require('./packages/db/src/migrations/meta/_journal.json'); console.log(j.entries.slice(-2).map(e=>e.idx+' '+e.tag+' '+e.when).join('\n'))"` (from the worktree root)
Expected:

```
25 0025_stripe_payments 1788160000000
26 0026_payout_accounts 1788170000000
```

- [ ] **Step 3: Add the schema**

In `packages/db/src/schema.ts` (`boolean`, `jsonb`, `text`, `timestamp`, `uniqueIndex` and `sql` are already imported), after the `vouchStatus` enum (line 149, with the other enums):

```ts
// Derived by the API from the three Stripe readiness flags; see
// migrations/0026_payout_accounts.sql.
export const payoutAccountStatus = appDb.enum('payout_account_status', [
  'onboarding',
  'ready',
  'restricted',
  'disabled'
]);
```

After 2a's `stripeWebhookEvent` table (after its closing `);`, around line 539 — the payment tables 2a added are `payment`, `billingCustomer`, `stripeWebhookEvent`, in that order):

```ts
// A helper's payout account (Stripe Connect Express). Holds the last snapshot
// RE-FETCHED from the provider — never webhook payload contents.
export const payoutAccount = appDb.table(
  'payout_accounts',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    accountReference: text('account_reference').notNull(),
    status: payoutAccountStatus('status').notNull().default('onboarding'),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    transfersActive: boolean('transfers_active').notNull().default(false),
    // Raw provider requirement codes; the API turns them into labels.
    requirementsDue: jsonb('requirements_due')
      .$type<Array<string>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    disabledReason: text('disabled_reason'),
    // Null until the first re-fetch; drives PAYOUTS_REFRESH_AFTER_MINUTES.
    refreshedAt: timestamp('refreshed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex('payout_accounts_account_reference_uidx').on(table.accountReference)
  ]
);
```

- [ ] **Step 4: Write the repo**

`packages/db/src/repos/payout-account-repo.ts`:

```ts
import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { eq, sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { payoutAccount } from '../schema';

export type PayoutAccount = InferSelectModel<typeof payoutAccount>;
export type PayoutAccountStatus = PayoutAccount['status'];
export type PayoutAccountCreateInput = Pick<
  InferInsertModel<typeof payoutAccount>,
  'userId' | 'provider' | 'accountReference'
>;
/** One re-fetched provider snapshot plus the status the API derived from it. */
export type PayoutAccountSnapshotInput = Pick<
  PayoutAccount,
  | 'status'
  | 'detailsSubmitted'
  | 'payoutsEnabled'
  | 'transfersActive'
  | 'requirementsDue'
  | 'disabledReason'
> & { refreshedAt: Date };

export class PayoutAccountRepo extends Context.Tag('@repo/db/PayoutAccountRepo')<
  PayoutAccountRepo,
  {
    findByUserId: (userId: string) => Effect.Effect<PayoutAccount | null, SqlError>;
    /** How an account.updated webhook finds its helper. */
    findByReference: (reference: string) => Effect.Effect<PayoutAccount | null, SqlError>;
    /** Records the helper's account. One account per helper per provider: an
     * existing row for the same provider is returned untouched (a racing
     * second create is a no-op); a row from ANOTHER provider (mock → stripe)
     * is replaced and its snapshot reset. */
    create: (
      input: PayoutAccountCreateInput
    ) => Effect.Effect<PayoutAccount, SqlError | DBNotFoundError>;
    applySnapshot: (
      userId: string,
      snapshot: PayoutAccountSnapshotInput
    ) => Effect.Effect<PayoutAccount, SqlError | DBNotFoundError>;
  }
>() {}

/** What a new or replaced account starts from: nothing fetched yet. */
const unfetched = {
  status: 'onboarding' as const,
  detailsSubmitted: false,
  payoutsEnabled: false,
  transfersActive: false,
  requirementsDue: [] as Array<string>,
  disabledReason: null,
  refreshedAt: null
};

const firstOrNull = (rows: Array<PayoutAccount>) => rows[0] ?? null;

export const PayoutAccountRepoLive = Layer.effect(
  PayoutAccountRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const orNotFound = (userId: string) => (row: PayoutAccount | null | undefined) =>
      row
        ? Effect.succeed(row)
        : Effect.fail(new DBNotFoundError({ entity: 'payoutAccount', value: userId }));

    const findByUserId = (userId: string) =>
      db
        .select()
        .from(payoutAccount)
        .where(eq(payoutAccount.userId, userId))
        .limit(1)
        .pipe(Effect.map(firstOrNull));

    return {
      findByUserId,

      findByReference: (reference) =>
        db
          .select()
          .from(payoutAccount)
          .where(eq(payoutAccount.accountReference, reference))
          .limit(1)
          .pipe(Effect.map(firstOrNull)),

      create: (input) =>
        Effect.gen(function* () {
          const written = yield* db
            .insert(payoutAccount)
            .values(input)
            .onConflictDoUpdate({
              target: payoutAccount.userId,
              set: {
                provider: input.provider,
                accountReference: input.accountReference,
                ...unfetched,
                updatedAt: new Date()
              },
              setWhere: sql`${payoutAccount.provider} <> ${input.provider}`
            })
            .returning();
          if (written[0]) return written[0];
          // Same provider already on file: keep it.
          return yield* findByUserId(input.userId).pipe(Effect.flatMap(orNotFound(input.userId)));
        }),

      applySnapshot: (userId, snapshot) =>
        db
          .update(payoutAccount)
          .set({ ...snapshot, updatedAt: new Date() })
          .where(eq(payoutAccount.userId, userId))
          .returning()
          .pipe(Effect.flatMap((rows) => orNotFound(userId)(rows[0])))
    };
  })
);

export const PayoutAccountRepoDefault = PayoutAccountRepoLive.pipe(Layer.provide(DrizzleLive));

/** Lookups find nothing and writes die unless the test supplies them. */
export const makePayoutAccountRepoTest = (
  implementation: Partial<Context.Tag.Service<PayoutAccountRepo>>
) =>
  Layer.succeed(PayoutAccountRepo, {
    findByUserId: () => Effect.succeed(null),
    findByReference: () => Effect.succeed(null),
    create: () => Effect.die('PayoutAccountRepo.create not stubbed'),
    applySnapshot: () => Effect.die('PayoutAccountRepo.applySnapshot not stubbed'),
    ...implementation
  });

/** A stored account, for fixtures: a Stripe account still onboarding. */
export const dummyPayoutAccount = (overrides: Partial<PayoutAccount> = {}): PayoutAccount => ({
  userId: 'helper-1',
  provider: 'stripe',
  accountReference: 'acct_123',
  status: 'onboarding',
  detailsSubmitted: false,
  payoutsEnabled: false,
  transfersActive: false,
  requirementsDue: [],
  disabledReason: null,
  refreshedAt: new Date(),
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides
});

export type AppliedPayoutSnapshot = { userId: string; snapshot: PayoutAccountSnapshotInput };

/** In-memory stand-in with the live repo's semantics, for unit tests. Every
 * `applySnapshot` is also appended to `applied`. */
export const makeInMemoryPayoutAccountRepo = (
  initial: ReadonlyArray<PayoutAccount> = [],
  applied: Array<AppliedPayoutSnapshot> = []
): {
  layer: Layer.Layer<PayoutAccountRepo>;
  rows: Map<string, PayoutAccount>;
} => {
  const rows = new Map(initial.map((row) => [row.userId, row] as const));
  return {
    rows,
    layer: Layer.succeed(PayoutAccountRepo, {
      findByUserId: (userId) => Effect.succeed(rows.get(userId) ?? null),
      findByReference: (reference) =>
        Effect.succeed(
          [...rows.values()].find((row) => row.accountReference === reference) ?? null
        ),
      create: (input) =>
        Effect.sync(() => {
          const existing = rows.get(input.userId);
          if (existing && existing.provider === input.provider) return existing;
          const row = dummyPayoutAccount({
            ...input,
            ...unfetched,
            createdAt: existing?.createdAt ?? new Date(),
            updatedAt: new Date()
          });
          rows.set(input.userId, row);
          return row;
        }),
      applySnapshot: (userId, snapshot) =>
        Effect.sync(() => {
          applied.push({ userId, snapshot });
          const row = {
            ...(rows.get(userId) ?? dummyPayoutAccount({ userId })),
            ...snapshot,
            updatedAt: new Date()
          };
          rows.set(userId, row);
          return row;
        })
    })
  };
};
```

- [ ] **Step 5: Export and register**

`packages/db/src/index.ts`: after 2a's `export * from './repos/stripe-webhook-event-repo';` add:

```ts
export * from './repos/payout-account-repo';
```

`apps/api/src/app-env.ts`: add `PayoutAccountRepo,` to the `@repo/db` type import (after `PaymentRepo,`) and `| PayoutAccountRepo` to `AppServices` (after 2a's `| StripeWebhookEventRepo`).

`apps/api/src/managed-runtime.ts`: add `PayoutAccountRepoDefault,` to the `@repo/db` import (after `PaymentRepoDefault,`) and to `AppLive` (after 2a's `StripeWebhookEventRepoDefault,`).

`apps/worker` needs nothing: no worker job reads payout accounts in 2b, and its `PaymentsLive` picks up the new operations by itself.

- [ ] **Step 6: Type-check**

Run: `cd apps/api && bunx tsc -p tsconfig.build.json --noEmit`
Expected: no errors.

Run: `grep -c "0026_payout_accounts" packages/db/src/migrations/meta/_journal.json`
Expected: `1`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src apps/api/src/app-env.ts apps/api/src/managed-runtime.ts
git commit -m "feat(db): payout_accounts table and PayoutAccountRepo (migration 0026)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Payout domain in the API (config, derivation, refresh rule, readiness)

**Files:**
- Modify: `packages/env/src/index.ts`, `.env.example`, `apps/api/.env.example`
- Create: `apps/api/src/lib/payouts.ts`, `apps/api/src/lib/payouts.test-support.ts`, `apps/api/src/lib/payouts.unit.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Payments.getPayoutAccount`, `Payments.provider`, `PayoutAccountSnapshot`, `PaymentProviderError`); Task 3 (`PayoutAccountRepo`, `PayoutAccount`, `PayoutAccountStatus`, `PayoutAccountSnapshotInput`, `makePayoutAccountRepoTest`, `makeInMemoryPayoutAccountRepo`, `dummyPayoutAccount`, `AppliedPayoutSnapshot`).
- Produces:
  - `@repo/env`: `payoutsConfig: Config<{ appWebOrigin: string; refreshAfterMinutes: number }>`
  - `apps/api/src/lib/payouts.ts`:
    - `class PayoutsRepoError` (`_tag: 'PayoutsRepoError'`, `cause: SqlError | DBNotFoundError`)
    - `class PayoutsProviderError` (`_tag: 'PayoutsProviderError'`, `cause: PaymentProviderError`)
    - `mapPayoutsRepoError(effect)`, `mapPayoutsProviderError(effect)`
    - `payoutsPolicy: Effect<{ appWebOrigin: string; refreshAfterMinutes: number }>`
    - `derivePayoutStatus(snapshot: PayoutAccountSnapshot): PayoutAccountStatus`
    - `isStale(account: Pick<PayoutAccount, 'refreshedAt'>, now: Date, refreshAfterMinutes: number): boolean`
    - `requirementLabels(codes: ReadonlyArray<string>): Array<string>`
    - `toSnapshotInput(snapshot: PayoutAccountSnapshot, refreshedAt: Date): PayoutAccountSnapshotInput`
    - `loadPayoutAccount(userId): Effect<PayoutAccount | null, PayoutsRepoError, Payments | PayoutAccountRepo>` (null when the row belongs to another provider)
    - `refreshPayoutAccount(account: PayoutAccount): Effect<PayoutAccount, PayoutsProviderError | PayoutsRepoError, Payments | PayoutAccountRepo>`
    - `currentPayoutAccount(userId): Effect<PayoutAccount | null, PayoutsRepoError, Payments | PayoutAccountRepo>` (re-fetches when stale; a provider failure keeps the stored row)
    - `isPaymentReady(userId): Effect<boolean, never, Payments | PayoutAccountRepo>` (for pieces 3 and 4)
    - `hasReadyPayoutAccount(userId): Effect<boolean, never, Payments | PayoutAccountRepo>` (stored snapshot only; for the contract detail, whose program already needs `Payments` for 2a's `cardOnFile`)
    - `handleAccountUpdated(accountReference): Effect<'applied' | 'unknown_account', PayoutsProviderError | PayoutsRepoError, Payments | PayoutAccountRepo>`
  - `apps/api/src/lib/payouts.test-support.ts`: `readySnapshot(overrides?)` (the db fixtures live in `@repo/db`, Task 3)

- [ ] **Step 1: Add the config**

In `packages/env/src/index.ts`, after 2a's `stripeConfig`:

```ts
// Helper payout accounts (Stripe Connect, piece 2b).
// APP_WEB_ORIGIN is the ONE web origin Stripe's hosted onboarding returns to;
// TRUSTED_ORIGINS is a list, so it can't serve as a single return address.
// A stored payout status older than PAYOUTS_REFRESH_AFTER_MINUTES is
// re-fetched from the provider when read.
export const payoutsConfig = Config.all({
  appWebOrigin: Config.string('APP_WEB_ORIGIN').pipe(
    Config.withDefault('https://app.poppynz.com'),
    Config.map((origin) => origin.trim().replace(/\/+$/, ''))
  ),
  refreshAfterMinutes: Config.integer('PAYOUTS_REFRESH_AFTER_MINUTES').pipe(
    Config.withDefault(60)
  )
});
```

Append to both `.env.example` (root, after the safety-verification block — 2a added no Stripe block there) and `apps/api/.env.example` (after 2a's Stripe block, which ends `PAYMENTS_ABANDON_AFTER_HOURS=24`):

```dotenv
# --- Helper payout accounts (Stripe Connect, piece 2b) ---
# The web origin Stripe's hosted onboarding returns to (production default
# https://app.poppynz.com). Local web runs on 5175.
APP_WEB_ORIGIN=http://localhost:5175
# Re-fetch a helper's payout status from Stripe when the stored one is older.
PAYOUTS_REFRESH_AFTER_MINUTES=60
```

- [ ] **Step 2: Write the api test support**

`apps/api/src/lib/payouts.test-support.ts`:

```ts
import type { PayoutAccountSnapshot } from '@repo/payments';

/** Test-only: a provider snapshot of a fully enabled account. The stored-row
 * fixtures (`dummyPayoutAccount`, `makeInMemoryPayoutAccountRepo`) live in
 * `@repo/db`, next to the repo. */
export const readySnapshot = (
  overrides: Partial<PayoutAccountSnapshot> = {}
): PayoutAccountSnapshot => ({
  detailsSubmitted: true,
  payoutsEnabled: true,
  transfersActive: true,
  requirementsDue: [],
  disabledReason: null,
  ...overrides
});
```

- [ ] **Step 3: Write the failing tests**

`apps/api/src/lib/payouts.unit.test.ts`:

```ts
import { SqlError } from '@effect/sql/SqlError';
import {
  dummyPayoutAccount,
  makeInMemoryPayoutAccountRepo,
  makePayoutAccountRepoTest,
  type AppliedPayoutSnapshot
} from '@repo/db';
import { makePaymentsTest, PaymentProviderError } from '@repo/payments';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  derivePayoutStatus,
  handleAccountUpdated,
  hasReadyPayoutAccount,
  isPaymentReady,
  isStale,
  requirementLabels
} from './payouts';
import { readySnapshot } from './payouts.test-support';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

/** A Stripe-backed Payments (dummyPayoutAccount rows are `provider: 'stripe'`). */
const paymentsReturning = (
  fetched: Array<string>,
  snapshot = readySnapshot(),
  fail = false
) =>
  makePaymentsTest({
    provider: 'stripe',
    getPayoutAccount: (reference) => {
      fetched.push(reference);
      return fail
        ? Effect.fail(new PaymentProviderError({ operation: 'getPayoutAccount', cause: 'down' }))
        : Effect.succeed(snapshot);
    }
  });

describe('derivePayoutStatus', () => {
  it('is ready only when all three flags are true', () => {
    expect(derivePayoutStatus(readySnapshot())).toBe('ready');
    expect(derivePayoutStatus(readySnapshot({ transfersActive: false }))).toBe('restricted');
    expect(derivePayoutStatus(readySnapshot({ payoutsEnabled: false }))).toBe('restricted');
  });

  it('is disabled when Stripe rejected the account', () => {
    expect(
      derivePayoutStatus(
        readySnapshot({
          detailsSubmitted: true,
          payoutsEnabled: false,
          transfersActive: false,
          disabledReason: 'rejected.fraud'
        })
      )
    ).toBe('disabled');
  });

  it('is restricted when details are in but Stripe still needs something', () => {
    expect(
      derivePayoutStatus(
        readySnapshot({
          payoutsEnabled: false,
          requirementsDue: ['external_account'],
          disabledReason: 'requirements.past_due'
        })
      )
    ).toBe('restricted');
  });

  it('is onboarding before details are submitted', () => {
    expect(
      derivePayoutStatus({
        detailsSubmitted: false,
        payoutsEnabled: false,
        transfersActive: false,
        requirementsDue: ['individual.dob.day'],
        disabledReason: 'requirements.past_due'
      })
    ).toBe('onboarding');
  });
});

describe('isStale', () => {
  it('re-fetches a never-fetched or older-than-the-window snapshot only', () => {
    const now = new Date();
    expect(isStale({ refreshedAt: null }, now, 60)).toBe(true);
    expect(isStale({ refreshedAt: minutesAgo(61) }, now, 60)).toBe(true);
    expect(isStale({ refreshedAt: minutesAgo(30) }, now, 60)).toBe(false);
  });
});

describe('requirementLabels', () => {
  it('turns Stripe codes into deduplicated, human-readable labels', () => {
    expect(
      requirementLabels([
        'external_account',
        'individual.dob.day',
        'individual.dob.month',
        'individual.verification.document',
        'tos_acceptance.date',
        'something.new'
      ])
    ).toEqual([
      'A bank account for your payouts',
      'Date of birth',
      'Photo ID',
      "Accept Stripe's terms of service",
      'Other details Stripe needs'
    ]);
  });
});

describe('isPaymentReady', () => {
  it('is false without a payout account', async () => {
    const { layer } = makeInMemoryPayoutAccountRepo();
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(layer, paymentsReturning([]))))
    );
    expect(ready).toBe(false);
  });

  it('uses a fresh stored snapshot without calling the provider', async () => {
    const fetched: Array<string> = [];
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'ready', refreshedAt: minutesAgo(5) })
    ]);
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(layer, paymentsReturning(fetched))))
    );
    expect(ready).toBe(true);
    expect(fetched).toEqual([]);
  });

  it('re-fetches a stale snapshot and stores it', async () => {
    const fetched: Array<string> = [];
    const applied: Array<AppliedPayoutSnapshot> = [];
    const { layer } = makeInMemoryPayoutAccountRepo(
      [dummyPayoutAccount({ status: 'onboarding', refreshedAt: minutesAgo(90) })],
      applied
    );
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(layer, paymentsReturning(fetched))))
    );
    expect(ready).toBe(true);
    expect(fetched).toEqual(['acct_123']);
    expect(applied[0].snapshot).toMatchObject({ status: 'ready', transfersActive: true });
  });

  it('keeps the stored answer when the provider is down', async () => {
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'restricted', refreshedAt: minutesAgo(90) })
    ]);
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning([], readySnapshot(), true)))
      )
    );
    expect(ready).toBe(false);
  });

  it('answers false when the database fails', async () => {
    const failing = makePayoutAccountRepoTest({
      findByUserId: () => Effect.fail(new SqlError({ cause: 'db down' })),
      findByReference: () => Effect.die('not used'),
      create: () => Effect.die('not used'),
      applySnapshot: () => Effect.die('not used')
    });
    const ready = await Effect.runPromise(
      isPaymentReady('helper-1').pipe(Effect.provide(Layer.merge(failing, paymentsReturning([]))))
    );
    expect(ready).toBe(false);
  });
});

describe('hasReadyPayoutAccount', () => {
  it('reads the stored status only', async () => {
    const fetched: Array<string> = [];
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ status: 'ready', refreshedAt: minutesAgo(600) })
    ]);
    const provided = Layer.merge(layer, paymentsReturning(fetched));
    expect(
      await Effect.runPromise(hasReadyPayoutAccount('helper-1').pipe(Effect.provide(provided)))
    ).toBe(true);
    expect(
      await Effect.runPromise(hasReadyPayoutAccount('nobody').pipe(Effect.provide(provided)))
    ).toBe(false);
    expect(fetched).toEqual([]);
  });

  it("ignores an account from another provider (2a's mock → stripe rule)", async () => {
    const { layer } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({
        provider: 'mock',
        accountReference: 'mock_acct_helper-1',
        status: 'ready'
      })
    ]);
    expect(
      await Effect.runPromise(
        hasReadyPayoutAccount('helper-1').pipe(
          Effect.provide(Layer.merge(layer, paymentsReturning([])))
        )
      )
    ).toBe(false);
  });
});

describe('handleAccountUpdated', () => {
  it('re-fetches and stores the snapshot of a known account', async () => {
    const fetched: Array<string> = [];
    const applied: Array<AppliedPayoutSnapshot> = [];
    const { layer, rows } = makeInMemoryPayoutAccountRepo([dummyPayoutAccount()], applied);
    const outcome = await Effect.runPromise(
      handleAccountUpdated('acct_123').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning(fetched)))
      )
    );
    expect(outcome).toBe('applied');
    expect(fetched).toEqual(['acct_123']);
    expect(rows.get('helper-1')?.status).toBe('ready');
  });

  it('ignores an account Poppynz does not know', async () => {
    const fetched: Array<string> = [];
    const { layer } = makeInMemoryPayoutAccountRepo([dummyPayoutAccount()]);
    const outcome = await Effect.runPromise(
      handleAccountUpdated('acct_unknown').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning(fetched)))
      )
    );
    expect(outcome).toBe('unknown_account');
    expect(fetched).toEqual([]);
  });

  it('is safe to apply twice (a redelivered event lands on the same state)', async () => {
    const applied: Array<AppliedPayoutSnapshot> = [];
    const { layer, rows } = makeInMemoryPayoutAccountRepo([dummyPayoutAccount()], applied);
    const provided = Layer.merge(layer, paymentsReturning([]));
    await Effect.runPromise(handleAccountUpdated('acct_123').pipe(Effect.provide(provided)));
    const once = rows.get('helper-1');
    await Effect.runPromise(handleAccountUpdated('acct_123').pipe(Effect.provide(provided)));
    expect(rows.get('helper-1')?.status).toBe(once?.status);
    expect(applied.map((entry) => entry.snapshot.status)).toEqual(['ready', 'ready']);
  });

  it('fails with PayoutsProviderError so the webhook answers 500 and Stripe retries', async () => {
    const { layer } = makeInMemoryPayoutAccountRepo([dummyPayoutAccount()]);
    const exit = await Effect.runPromiseExit(
      handleAccountUpdated('acct_123').pipe(
        Effect.provide(Layer.merge(layer, paymentsReturning([], readySnapshot(), true)))
      )
    );
    expect(JSON.stringify(exit)).toContain('PayoutsProviderError');
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `cd apps/api && bunx vitest run src/lib/payouts.unit.test.ts`
Expected: FAIL — `Failed to resolve import "./payouts"`.

- [ ] **Step 5: Write the domain module**

`apps/api/src/lib/payouts.ts`:

```ts
import type { SqlError } from '@effect/sql/SqlError';
import {
  PayoutAccountRepo,
  type DBNotFoundError,
  type PayoutAccount,
  type PayoutAccountSnapshotInput,
  type PayoutAccountStatus
} from '@repo/db';
import { payoutsConfig } from '@repo/env';
import { Payments, type PaymentProviderError, type PayoutAccountSnapshot } from '@repo/payments';
import { Data, Effect } from 'effect';

/**
 * Helper payout accounts (piece 2b). Stripe owns the truth; Poppynz keeps the
 * last snapshot it RE-FETCHED and derives one status from it. Nothing here
 * blocks a helper — pieces 3 and 4 enforce readiness via `isPaymentReady`.
 */

export class PayoutsRepoError extends Data.TaggedError('PayoutsRepoError')<{
  cause: SqlError | DBNotFoundError;
}> {}

export class PayoutsProviderError extends Data.TaggedError('PayoutsProviderError')<{
  cause: PaymentProviderError;
}> {}

export const mapPayoutsRepoError = <A, R>(
  effect: Effect.Effect<A, SqlError | DBNotFoundError, R>
): Effect.Effect<A, PayoutsRepoError, R> =>
  effect.pipe(Effect.mapError((cause) => new PayoutsRepoError({ cause })));

export const mapPayoutsProviderError = <A, R>(
  effect: Effect.Effect<A, PaymentProviderError, R>
): Effect.Effect<A, PayoutsProviderError, R> =>
  effect.pipe(Effect.mapError((cause) => new PayoutsProviderError({ cause })));

/** Config read collapses to the documented defaults rather than surfacing
 * ConfigError into every route program — same treatment as the contract window. */
export const payoutsPolicy = payoutsConfig.pipe(
  Effect.orElseSucceed(() => ({ appWebOrigin: 'https://app.poppynz.com', refreshAfterMinutes: 60 }))
);

/** The founder's definition: onboarding complete, identity verified, eligible
 * bank account, capabilities active — i.e. all three Stripe flags. */
export const derivePayoutStatus = (snapshot: PayoutAccountSnapshot): PayoutAccountStatus => {
  if (snapshot.detailsSubmitted && snapshot.payoutsEnabled && snapshot.transfersActive) {
    return 'ready';
  }
  if (snapshot.disabledReason?.startsWith('rejected.')) return 'disabled';
  if (snapshot.detailsSubmitted) return 'restricted';
  return 'onboarding';
};

export const isStale = (
  account: Pick<PayoutAccount, 'refreshedAt'>,
  now: Date,
  refreshAfterMinutes: number
): boolean =>
  account.refreshedAt === null ||
  now.getTime() - account.refreshedAt.getTime() > refreshAfterMinutes * 60 * 1000;

/** Prefix → label. A code matches its prefix exactly or as `prefix.<more>`. */
const REQUIREMENT_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['external_account', 'A bank account for your payouts'],
  ['individual.verification', 'Photo ID'],
  ['individual.id_number', 'Social Insurance Number'],
  ['individual.dob', 'Date of birth'],
  ['individual.address', 'Home address'],
  ['individual.first_name', 'Legal name'],
  ['individual.last_name', 'Legal name'],
  ['individual.email', 'Email address'],
  ['individual.phone', 'Phone number'],
  ['business_profile', 'What you do on Poppynz'],
  ['tos_acceptance', "Accept Stripe's terms of service"]
];

export const requirementLabels = (codes: ReadonlyArray<string>): Array<string> => [
  ...new Set(
    codes.map(
      (code) =>
        REQUIREMENT_LABELS.find(
          ([prefix]) => code === prefix || code.startsWith(`${prefix}.`)
        )?.[1] ?? 'Other details Stripe needs'
    )
  )
];

export const toSnapshotInput = (
  snapshot: PayoutAccountSnapshot,
  refreshedAt: Date
): PayoutAccountSnapshotInput => ({
  status: derivePayoutStatus(snapshot),
  detailsSubmitted: snapshot.detailsSubmitted,
  payoutsEnabled: snapshot.payoutsEnabled,
  transfersActive: snapshot.transfersActive,
  requirementsDue: [...snapshot.requirementsDue],
  disabledReason: snapshot.disabledReason,
  refreshedAt
});

/** The helper's account under the CURRENT provider. A row left by another
 * provider (a `mock_acct_…` after switching to Stripe) reads as no account —
 * 2a's rule for stored references (`toCard` in `@repo/billing`). */
export const loadPayoutAccount = (userId: string) =>
  Effect.gen(function* () {
    const repo = yield* PayoutAccountRepo;
    const payments = yield* Payments;
    const account = yield* repo
      .findByUserId(userId)
      .pipe((errors) => mapPayoutsRepoError(errors));
    return account !== null && account.provider === payments.provider ? account : null;
  });

/** Re-fetch from the provider and store. Never trusts a webhook body. */
export const refreshPayoutAccount = (account: PayoutAccount) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* PayoutAccountRepo;
    const snapshot = yield* payments
      .getPayoutAccount(account.accountReference)
      .pipe((errors) => mapPayoutsProviderError(errors));
    return yield* repo
      .applySnapshot(account.userId, toSnapshotInput(snapshot, new Date()))
      .pipe((errors) => mapPayoutsRepoError(errors));
  });

/** The stored account, re-fetched first when older than the refresh window.
 * A provider failure keeps (and returns) the stored state. */
export const currentPayoutAccount = (userId: string) =>
  Effect.gen(function* () {
    const account = yield* loadPayoutAccount(userId);
    if (!account) return null;
    const { refreshAfterMinutes } = yield* payoutsPolicy;
    if (!isStale(account, new Date(), refreshAfterMinutes)) return account;
    return yield* refreshPayoutAccount(account).pipe(
      Effect.catchTag('PayoutsProviderError', (error) =>
        Effect.logWarning('payout account refresh failed; using stored state', error.cause).pipe(
          Effect.as(account)
        )
      )
    );
  });

/** For pieces 3 and 4 (cycle start, transfers). Any failure answers false:
 * money never moves on an unknown status. */
export const isPaymentReady = (
  userId: string
): Effect.Effect<boolean, never, Payments | PayoutAccountRepo> =>
  currentPayoutAccount(userId).pipe(
    Effect.map((account) => account?.status === 'ready'),
    Effect.orElseSucceed(() => false)
  );

/** Stored snapshot only — cheap enough for every contract detail read. */
export const hasReadyPayoutAccount = (
  userId: string
): Effect.Effect<boolean, never, Payments | PayoutAccountRepo> =>
  loadPayoutAccount(userId).pipe(
    Effect.map((account) => account?.status === 'ready'),
    Effect.orElseSucceed(() => false)
  );

/** `account.updated` (a Connect event): a wake-up signal only. */
export const handleAccountUpdated = (accountReference: string) =>
  Effect.gen(function* () {
    const repo = yield* PayoutAccountRepo;
    const payments = yield* Payments;
    const account = yield* repo
      .findByReference(accountReference)
      .pipe((errors) => mapPayoutsRepoError(errors));
    if (!account || account.provider !== payments.provider) return 'unknown_account' as const;
    yield* refreshPayoutAccount(account);
    return 'applied' as const;
  });
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/api && bunx vitest run src/lib/payouts.unit.test.ts`
Expected: PASS (all tests).

Run: `cd apps/api && bunx tsc -p tsconfig.build.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/env/src/index.ts .env.example apps/api/.env.example apps/api/src/lib/payouts.ts apps/api/src/lib/payouts.test-support.ts apps/api/src/lib/payouts.unit.test.ts
git commit -m "feat(api): payout status derivation, refresh rule and isPaymentReady

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `payouts` permission and the `/payouts` routes

**Files:**
- Modify: `apps/api/src/lib/auth-roles.ts`, `apps/api/src/routes/app/index.ts`
- Create: `apps/api/src/routes/app/payouts/payouts.handler.ts`, `apps/api/src/routes/app/payouts/payouts.ts`, `apps/api/src/routes/app/payouts/payouts.unit.test.ts`

**Interfaces:**
- Consumes: Task 4 (`currentPayoutAccount`, `loadPayoutAccount`, `refreshPayoutAccount`, `requirementLabels`, `payoutsPolicy`, `mapPayoutsProviderError`, `mapPayoutsRepoError`, `readySnapshot`); Task 3 (`PayoutAccountRepo.create`, `makeInMemoryPayoutAccountRepo`, `dummyPayoutAccount`, `AppliedPayoutSnapshot`); Task 1 (`Payments.createPayoutAccount`, `createOnboardingLink`, `createDashboardLink`, `provider`).
- Produces:
  - Response shape `PayoutsResponse = { status: PayoutAccountStatus | null; paymentReady: boolean; requirementsDue: Array<string>; provider: PaymentProvider; hasAccount: boolean }` for `GET /payouts` and `POST /payouts/refresh`
  - `POST /payouts/onboarding` → `{ url: string }`; `POST /payouts/dashboard` → `{ url: string }`
  - Exports: `getPayoutsRouteProgram(headers)`, `startPayoutsOnboardingRouteProgram(headers)`, `refreshPayoutsRouteProgram(headers)`, `payoutsDashboardRouteProgram(headers)`, `NoPayoutAccountError`, `payoutsRoute`
  - RPC paths for the web: `apiClient.payouts.$get`, `apiClient.payouts.onboarding.$post`, `apiClient.payouts.refresh.$post`, `apiClient.payouts.dashboard.$post`

- [ ] **Step 1: Grant the permission**

In `apps/api/src/lib/auth-roles.ts`:
- in `createAccessControl({...})`, after `kycDocumentType: ['read', 'write'],` add:

```ts
  // A helper's own payout account (Stripe Connect). Ownership is implicit:
  // every /payouts route acts on the session user only.
  payouts: ['read', 'write'],
```

- in `spRole`, after `kycDocument: ['write'],` add `payouts: ['read', 'write'],`.

(Families and admins don't get it: families don't receive payouts, and an admin acting for a helper does so by impersonation, which carries the helper's role.)

- [ ] **Step 2: Write the failing tests**

`apps/api/src/routes/app/payouts/payouts.unit.test.ts`:

```ts
import {
  dummyPayoutAccount,
  makeInMemoryPayoutAccountRepo,
  makeSessionRepoTest,
  makeUserRepoTest,
  type AppliedPayoutSnapshot,
  type PayoutAccount,
  type Session,
  type User
} from '@repo/db';
import { makePaymentsTest, PaymentProviderError } from '@repo/payments';
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from 'effect';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { readySnapshot } from '@/api/lib/payouts.test-support';
import {
  getPayoutsRouteProgram,
  payoutsDashboardRouteProgram,
  refreshPayoutsRouteProgram,
  startPayoutsOnboardingRouteProgram
} from './payouts.handler';
import { payoutsRoute } from './payouts';

const helper = (): User => ({
  id: 'helper-1',
  name: 'Priya Helper',
  email: 'priya@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  isAnonymous: false,
  role: 'service-provider',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
});

const session = (): Session => ({
  id: 'session-1',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  token: 'token',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId: 'helper-1',
  impersonatedBy: null,
  activeOrganizationId: null
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

type Recorded = {
  created: Array<{ userId: string; email: string }>;
  links: Array<{ reference: string; returnUrl: string; refreshUrl: string }>;
  fetched: Array<string>;
  dashboards: Array<string>;
  applied: Array<AppliedPayoutSnapshot>;
};

const makeLayer = (
  options: {
    hasPermission?: boolean;
    accounts?: Array<PayoutAccount>;
    snapshot?: ReturnType<typeof readySnapshot>;
    providerFails?: boolean;
    recorded?: Recorded;
  } = {}
) => {
  const recorded = options.recorded ?? {
    created: [],
    links: [],
    fetched: [],
    dashboards: [],
    applied: []
  };
  const providerFailure = (operation: 'createPayoutAccount' | 'getPayoutAccount') =>
    Effect.fail(new PaymentProviderError({ operation, cause: 'stripe down' }));
  const { layer: repoLayer } = makeInMemoryPayoutAccountRepo(
    options.accounts ?? [],
    recorded.applied
  );
  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: 'helper-1' }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: () => Effect.succeed(helper()),
      findByEmail: () => Effect.die('not used')
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session()) }),
    repoLayer,
    makePaymentsTest({
      provider: 'stripe',
      createPayoutAccount: (input) => {
        recorded.created.push(input);
        return options.providerFails
          ? providerFailure('createPayoutAccount')
          : Effect.succeed({ reference: 'acct_new' });
      },
      createOnboardingLink: (input) => {
        recorded.links.push(input);
        return Effect.succeed({
          url: `https://connect.stripe.com/setup/e/${input.reference}/abc`,
          expiresAt: new Date(Date.now() + 300_000)
        });
      },
      getPayoutAccount: (reference) => {
        recorded.fetched.push(reference);
        return options.providerFails
          ? providerFailure('getPayoutAccount')
          : Effect.succeed(options.snapshot ?? readySnapshot());
      },
      createDashboardLink: (reference) => {
        recorded.dashboards.push(reference);
        return Effect.succeed({ url: `https://connect.stripe.com/express/${reference}` });
      }
    })
  );
};

const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /payouts', () => {
  it('reports no account yet', async () => {
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(result).toEqual({
      status: null,
      paymentReady: false,
      requirementsDue: [],
      provider: 'stripe',
      hasAccount: false
    });
  });

  it('serves a snapshot younger than the refresh window without calling Stripe', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            recorded,
            accounts: [dummyPayoutAccount({ status: 'onboarding', refreshedAt: minutesAgo(30) })]
          })
        )
      )
    );
    expect(result).toMatchObject({ status: 'onboarding', paymentReady: false, hasAccount: true });
    expect(recorded.fetched).toEqual([]);
  });

  it('re-fetches a snapshot older than 1 hour and stores it', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            recorded,
            accounts: [dummyPayoutAccount({ status: 'onboarding', refreshedAt: minutesAgo(61) })]
          })
        )
      )
    );
    expect(recorded.fetched).toEqual(['acct_123']);
    expect(recorded.applied).toHaveLength(1);
    expect(result).toMatchObject({ status: 'ready', paymentReady: true });
  });

  it('honours PAYOUTS_REFRESH_AFTER_MINUTES', async () => {
    vi.stubEnv('PAYOUTS_REFRESH_AFTER_MINUTES', '10');
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({ recorded, accounts: [dummyPayoutAccount({ refreshedAt: minutesAgo(15) })] })
        )
      )
    );
    expect(recorded.fetched).toEqual(['acct_123']);
  });

  it('keeps the stored state when Stripe is down', async () => {
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            providerFails: true,
            accounts: [dummyPayoutAccount({ status: 'onboarding', refreshedAt: minutesAgo(90) })]
          })
        )
      )
    );
    expect(result).toMatchObject({ status: 'onboarding', hasAccount: true });
  });

  it('lists what Stripe needs as readable labels', async () => {
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            accounts: [
              dummyPayoutAccount({
                status: 'restricted',
                detailsSubmitted: true,
                requirementsDue: ['external_account', 'individual.verification.document'],
                refreshedAt: minutesAgo(1)
              })
            ]
          })
        )
      )
    );
    expect(result.requirementsDue).toEqual(['A bank account for your payouts', 'Photo ID']);
  });

  it('fails with ForbiddenError without the payouts permission', async () => {
    const exit = await Effect.runPromiseExit(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});

describe('POST /payouts/onboarding', () => {
  it('creates the account once, stores it and returns the Stripe link', async () => {
    vi.stubEnv('APP_WEB_ORIGIN', 'http://localhost:5175/');
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    const result = await Effect.runPromise(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ recorded }))
      )
    );
    expect(recorded.created).toEqual([{ userId: 'helper-1', email: 'priya@example.com' }]);
    expect(recorded.links).toEqual([
      {
        reference: 'acct_new',
        returnUrl: 'http://localhost:5175/service-provider/payouts?from=stripe',
        refreshUrl: 'http://localhost:5175/service-provider/payouts?refresh=1'
      }
    ]);
    expect(result).toEqual({ url: 'https://connect.stripe.com/setup/e/acct_new/abc' });
  });

  it('defaults the return origin to https://app.poppynz.com', async () => {
    vi.stubEnv('APP_WEB_ORIGIN', undefined);
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    await Effect.runPromise(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ recorded }))
      )
    );
    expect(recorded.links[0].returnUrl).toBe(
      'https://app.poppynz.com/service-provider/payouts?from=stripe'
    );
  });

  it('reuses an existing account instead of creating another', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    await Effect.runPromise(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ recorded, accounts: [dummyPayoutAccount()] }))
      )
    );
    expect(recorded.created).toEqual([]);
    expect(recorded.links[0].reference).toBe('acct_123');
  });

  it('replaces an account left by another provider (mock → stripe) with a Stripe one', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    await Effect.runPromise(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            recorded,
            accounts: [
              dummyPayoutAccount({
                provider: 'mock',
                accountReference: 'mock_acct_helper-1',
                status: 'ready'
              })
            ]
          })
        )
      )
    );
    expect(recorded.created).toEqual([{ userId: 'helper-1', email: 'priya@example.com' }]);
    expect(recorded.links[0].reference).toBe('acct_new');
  });

  it('fails with PayoutsProviderError when Stripe refuses', async () => {
    const exit = await Effect.runPromiseExit(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ providerFails: true }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'PayoutsProviderError' });
  });

  it('fails with ForbiddenError without the payouts permission', async () => {
    const exit = await Effect.runPromiseExit(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});

describe('POST /payouts/refresh', () => {
  it('re-fetches even a fresh snapshot', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    const result = await Effect.runPromise(
      refreshPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({ recorded, accounts: [dummyPayoutAccount({ refreshedAt: new Date() })] })
        )
      )
    );
    expect(recorded.fetched).toEqual(['acct_123']);
    expect(result).toMatchObject({ status: 'ready', paymentReady: true, hasAccount: true });
  });

  it('fails with NoPayoutAccountError without an account', async () => {
    const exit = await Effect.runPromiseExit(
      refreshPayoutsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'NoPayoutAccountError' });
  });
});

describe('POST /payouts/dashboard', () => {
  it('returns the Express dashboard link', async () => {
    const result = await Effect.runPromise(
      payoutsDashboardRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ accounts: [dummyPayoutAccount({ status: 'ready' })] }))
      )
    );
    expect(result).toEqual({ url: 'https://connect.stripe.com/express/acct_123' });
  });

  it('answers 409 NO_PAYOUT_ACCOUNT without an account', async () => {
    const runtime = ManagedRuntime.make(makeLayer());
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('runtime', runtime as never);
        await next();
      })
      .route('/payouts', payoutsRoute);
    const response = await app.request('/payouts/dashboard', { method: 'POST' });
    const body = await response.json();
    await runtime.dispose();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: { code: 'NO_PAYOUT_ACCOUNT' } });
  });

  it('fails with ForbiddenError without the payouts permission', async () => {
    const exit = await Effect.runPromiseExit(
      payoutsDashboardRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/payouts/payouts.unit.test.ts`
Expected: FAIL — `Failed to resolve import "./payouts.handler"`.

- [ ] **Step 4: Write the handler**

`apps/api/src/routes/app/payouts/payouts.handler.ts`:

```ts
import { PayoutAccountRepo, type PayoutAccount } from '@repo/db';
import { Payments, type PaymentProvider } from '@repo/payments';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import {
  currentPayoutAccount,
  loadPayoutAccount,
  mapPayoutsProviderError,
  mapPayoutsRepoError,
  payoutsPolicy,
  refreshPayoutAccount,
  requirementLabels
} from '@/api/lib/payouts';

/**
 * Helper payout account (piece 2b). Stripe hosts onboarding and the payout
 * dashboard; these routes create the account, hand out short-lived links and
 * report the status. They never block anything.
 */

export class NoPayoutAccountError extends Data.TaggedError('NoPayoutAccountError')<{}> {}

const toPayoutsResponse = (account: PayoutAccount | null, provider: PaymentProvider) => ({
  status: account?.status ?? null,
  paymentReady: account?.status === 'ready',
  requirementsDue: account ? requirementLabels(account.requirementsDue) : [],
  provider,
  hasAccount: account !== null
});

const requireAccount = (userId: string) =>
  Effect.gen(function* () {
    const account = yield* loadPayoutAccount(userId);
    if (!account) return yield* Effect.fail(new NoPayoutAccountError());
    return account;
  });

export const getPayoutsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const account = yield* currentPayoutAccount(userAndSession.user.id);
    return toPayoutsResponse(account, payments.provider);
  });

export const startPayoutsOnboardingProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* PayoutAccountRepo;
    const { appWebOrigin } = yield* payoutsPolicy;
    const { id: userId, email } = userAndSession.user;

    let account = yield* loadPayoutAccount(userId);
    if (!account) {
      const created = yield* payments
        .createPayoutAccount({ userId, email })
        .pipe((errors) => mapPayoutsProviderError(errors));
      account = yield* repo
        .create({ userId, provider: payments.provider, accountReference: created.reference })
        .pipe((errors) => mapPayoutsRepoError(errors));
    }

    const link = yield* payments
      .createOnboardingLink({
        reference: account.accountReference,
        returnUrl: `${appWebOrigin}/service-provider/payouts?from=stripe`,
        refreshUrl: `${appWebOrigin}/service-provider/payouts?refresh=1`
      })
      .pipe((errors) => mapPayoutsProviderError(errors));
    return { url: link.url };
  });

export const refreshPayoutsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const account = yield* requireAccount(userAndSession.user.id);
    const refreshed = yield* refreshPayoutAccount(account);
    return toPayoutsResponse(refreshed, payments.provider);
  });

export const payoutsDashboardProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const account = yield* requireAccount(userAndSession.user.id);
    const link = yield* payments
      .createDashboardLink(account.accountReference)
      .pipe((errors) => mapPayoutsProviderError(errors));
    return { url: link.url };
  });

// ---------------------------------------------------------------------------
// Route programs (authenticate + authorize + domain)

const authorized = (headers: Headers, action: 'read' | 'write') =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    return yield* requirePermissions(headers, { payouts: [action] })(authenticated);
  });

export const getPayoutsRouteProgram = (headers: Headers) =>
  authorized(headers, 'read').pipe(Effect.flatMap(getPayoutsProgram));

export const startPayoutsOnboardingRouteProgram = (headers: Headers) =>
  authorized(headers, 'write').pipe(Effect.flatMap(startPayoutsOnboardingProgram));

export const refreshPayoutsRouteProgram = (headers: Headers) =>
  authorized(headers, 'write').pipe(Effect.flatMap(refreshPayoutsProgram));

export const payoutsDashboardRouteProgram = (headers: Headers) =>
  authorized(headers, 'write').pipe(Effect.flatMap(payoutsDashboardProgram));

export type PayoutsRouteError =
  | Effect.Effect.Error<ReturnType<typeof getPayoutsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof startPayoutsOnboardingRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof refreshPayoutsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof payoutsDashboardRouteProgram>>;

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
    500
  );

const payoutsErrorToResponse = (c: HonoContext<HonoEnv>, error: PayoutsRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'NoPayoutAccountError':
      return c.json(
        {
          error: {
            code: 'NO_PAYOUT_ACCOUNT' as const,
            message: 'Set up your payout account first.'
          }
        },
        409
      );
    case 'PayoutsProviderError':
      return c.json(
        {
          error: {
            code: 'PAYOUTS_PROVIDER_ERROR' as const,
            message: "Stripe couldn't be reached. Please try again in a moment."
          }
        },
        502
      );
    case 'PayoutsRepoError':
      return c.json(
        {
          error: {
            code: 'PAYOUTS_LOOKUP_FAILED' as const,
            message: 'Unable to load your payout account right now.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, PayoutsRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return payoutsErrorToResponse(c, failure.value);
      }
      return unexpected(c);
    }
  });

export async function getPayoutsHandler(c: HonoContext<HonoEnv>) {
  const exit = await c.get('runtime').runPromiseExit(getPayoutsRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function startPayoutsOnboardingHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(startPayoutsOnboardingRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function refreshPayoutsHandler(c: HonoContext<HonoEnv>) {
  const exit = await c.get('runtime').runPromiseExit(refreshPayoutsRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function payoutsDashboardHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(payoutsDashboardRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}
```

- [ ] **Step 5: Write the route and register it**

`apps/api/src/routes/app/payouts/payouts.ts`:

```ts
import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  getPayoutsHandler,
  payoutsDashboardHandler,
  refreshPayoutsHandler,
  startPayoutsOnboardingHandler
} from './payouts.handler';

export const payoutsRoute = new Hono<HonoEnv>()
  .get('/', (c) => getPayoutsHandler(c))
  .post('/onboarding', (c) => startPayoutsOnboardingHandler(c))
  .post('/refresh', (c) => refreshPayoutsHandler(c))
  .post('/dashboard', (c) => payoutsDashboardHandler(c));
```

`apps/api/src/routes/app/index.ts`: add `import { payoutsRoute } from './payouts/payouts';` after the `contractsRoute` import, and `.route('/payouts', payoutsRoute)` after `.route('/contracts', contractsRoute)`.

- [ ] **Step 6: Run the tests and the type-check**

Run: `cd apps/api && bunx vitest run src/routes/app/payouts/payouts.unit.test.ts`
Expected: PASS.

Run: `cd apps/api && bunx tsc -p tsconfig.build.json --noEmit`
Expected: no errors (the mapper's `handleNever` proves every tag is handled).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/auth-roles.ts apps/api/src/routes/app/index.ts apps/api/src/routes/app/payouts
git commit -m "feat(api): /payouts routes for helper payout accounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `account.updated` on the Stripe webhook (and the Connect signing secret)

**Files:**
- Create: `packages/payments/src/webhook-secrets.ts`, `packages/payments/src/webhook-secrets.test.ts`
- Modify: `packages/payments/src/stripe.ts` (2a's `makeStripePayments` options and `verifyWebhook`), `packages/payments/src/stripe.test.ts` (2a), `packages/payments/src/layer.ts` (2a's `PaymentsLive`), `packages/env/src/index.ts` (`stripeConfig`), `apps/api/src/routes/webhooks/stripe.ts` (2a's `processStripeEvent`), `apps/api/src/routes/webhooks/stripe.unit.test.ts` (2a's `makeWorld`), `apps/api/.env.example`, `docs/activating-stripe-connect.md`

**Interfaces:**
- Consumes: Task 4 `handleAccountUpdated(accountReference)` (fails with `PayoutsProviderError | PayoutsRepoError`); 2a's `PaymentWebhookEvent` (`{ eventId, type, objectId, paymentReference, account }`), `processStripeEvent(event)` (returns a log-note string; any failure makes `stripeWebhookProgram` call `markFailed` and answer 500), the `makeWorld(options)` harness in `stripe.unit.test.ts` (`world.post(signature?, body?)`, `world.log.{recorded,processed,failed}`, `options.verified` / `options.seen`).
- Produces:
  - `constructEventWithAnySecret<T>(construct: (secret: string) => Promise<T>, secrets: ReadonlyArray<string>): Promise<T>`
  - `stripeConfig.connectWebhookSecret: Option<Redacted<string>>` (env `STRIPE_CONNECT_WEBHOOK_SECRET`)
  - `makeStripePayments({ client, webhookSecret, connectWebhookSecret? })` — `connectWebhookSecret?: string | null`, default `null`
  - Webhook behaviour: `account.updated` → `handleAccountUpdated(event.objectId)` (for this event the object IS the connected account, so `objectId === account`); unknown account → recorded, 200; provider/DB failure → `markFailed`, 500.

Why the second secret: Stripe delivers Connect events (`account.updated` on connected accounts) only to endpoints created with "Listen to events on Connected accounts", and each dashboard endpoint has its own signing secret. Locally `stripe listen` signs both streams with one secret, but staging/live will have two endpoints pointing at the same `/webhooks/stripe` URL. Verification stays mandatory: `STRIPE_WEBHOOK_SECRET` is still required (2a refuses everything without it), and an event must match one of the configured secrets.

stripe@23 verifies asynchronously (`constructEventAsync`; 2a's `StripeApi.webhooks` is `Pick<Stripe['webhooks'], 'constructEventAsync'>`), so the helper takes and returns promises.

- [ ] **Step 1: Write the failing test for the multi-secret helper**

`packages/payments/src/webhook-secrets.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { constructEventWithAnySecret } from './webhook-secrets';

const constructWith = (validSecret: string) => async (secret: string) => {
  if (secret !== validSecret) throw new Error(`bad signature for ${secret}`);
  return { id: 'evt_1' };
};

describe('constructEventWithAnySecret', () => {
  it('accepts an event signed with the platform secret', async () => {
    expect(
      await constructEventWithAnySecret(constructWith('whsec_platform'), [
        'whsec_platform',
        'whsec_connect'
      ])
    ).toEqual({ id: 'evt_1' });
  });

  it('accepts an event signed with the Connect secret', async () => {
    expect(
      await constructEventWithAnySecret(constructWith('whsec_connect'), [
        'whsec_platform',
        'whsec_connect'
      ])
    ).toEqual({ id: 'evt_1' });
  });

  it('rejects an event matching neither, with the last verification error', async () => {
    await expect(
      constructEventWithAnySecret(constructWith('whsec_other'), ['whsec_platform', 'whsec_connect'])
    ).rejects.toThrow('bad signature for whsec_connect');
  });

  it('rejects everything when no secret is configured', async () => {
    await expect(constructEventWithAnySecret(constructWith('x'), [])).rejects.toThrow(
      'no Stripe webhook secret configured'
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/payments && bun test src/webhook-secrets.test.ts`
Expected: FAIL — `Cannot find module './webhook-secrets'`.

- [ ] **Step 3: Write the helper**

`packages/payments/src/webhook-secrets.ts`:

```ts
/**
 * Stripe signs platform events and Connect events with different endpoint
 * secrets once they are registered as two dashboard endpoints (both pointing
 * at /webhooks/stripe). An event is accepted when it verifies against ANY
 * configured secret — never when none is configured. Async because stripe@23
 * verifies with `constructEventAsync` (SubtleCrypto under Bun).
 */
export const constructEventWithAnySecret = async <T>(
  construct: (secret: string) => Promise<T>,
  secrets: ReadonlyArray<string>
): Promise<T> => {
  let lastError: unknown = new Error('no Stripe webhook secret configured');
  for (const secret of secrets) {
    try {
      return await construct(secret);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/payments && bun test src/webhook-secrets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing Connect-secret case in 2a's adapter suite**

In `packages/payments/src/stripe.test.ts`, inside `describe('verifyWebhook', () => { … })`, after `'refuses everything when no webhook secret is configured'`, add (it reuses 2a's `payments`, `fakeStripe` and `WEBHOOK_SECRET`):

```ts
  it('accepts a Connect event signed with the Connect endpoint secret, keeping its account', async () => {
    const connectPayload = JSON.stringify({
      id: 'evt_2',
      object: 'event',
      type: 'account.updated',
      account: 'acct_123',
      data: { object: { id: 'acct_123', object: 'account' } }
    });
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: connectPayload,
      secret: 'whsec_connect'
    });
    const withConnect = makeStripePayments({
      client: fakeStripe().client,
      webhookSecret: WEBHOOK_SECRET,
      connectWebhookSecret: 'whsec_connect'
    });
    expect(await Effect.runPromise(withConnect.verifyWebhook(connectPayload, header))).toEqual({
      eventId: 'evt_2',
      type: 'account.updated',
      objectId: 'acct_123',
      paymentReference: null,
      account: 'acct_123'
    });
    // Without the Connect secret configured, the same delivery is refused.
    const exit = await Effect.runPromiseExit(payments.verifyWebhook(connectPayload, header));
    expect(Exit.isFailure(exit)).toBe(true);
  });
```

Run: `cd packages/payments && bun test src/stripe.test.ts -t "Connect endpoint secret"`
Expected: FAIL — the Connect-signed delivery is refused (only `STRIPE_WEBHOOK_SECRET` is tried).

- [ ] **Step 6: Wire the Connect secret into config, the adapter and the layer**

`packages/env/src/index.ts`, inside 2a's `stripeConfig = Config.all({ … })`, after `webhookSecret: Config.option(Config.redacted('STRIPE_WEBHOOK_SECRET')),`:

```ts
  // The Connect endpoint's signing secret (account.updated on connected
  // accounts). Optional: locally `stripe listen` signs both streams with
  // STRIPE_WEBHOOK_SECRET.
  connectWebhookSecret: Config.option(Config.redacted('STRIPE_CONNECT_WEBHOOK_SECRET')),
```

`packages/payments/src/stripe.ts`:

1. Add the import below the `./stripe-connect` import (Task 2):

```ts
import { constructEventWithAnySecret } from './webhook-secrets';
```

2. Replace the head of `makeStripePayments` (its options type and destructuring):

```ts
export const makeStripePayments = (options: {
  client: StripeApi;
  /** Null when STRIPE_WEBHOOK_SECRET is unset: every delivery is then refused. */
  webhookSecret: string | null;
  /** STRIPE_CONNECT_WEBHOOK_SECRET — the Connect endpoint's secret, tried
   * after the platform one. Optional (local `stripe listen` uses one secret). */
  connectWebhookSecret?: string | null;
}): Context.Tag.Service<Payments> => {
  const { client, webhookSecret, connectWebhookSecret = null } = options;
```

3. In `verifyWebhook`, replace 2a's single-secret `Effect.tryPromise` (the `const event = yield* Effect.tryPromise({ try: () => client.webhooks.constructEventAsync(rawBody, signatureHeader, webhookSecret), … })`) with:

```ts
        // The async variant: under Bun the SDK resolves to its web build, whose
        // SubtleCrypto provider cannot verify synchronously. Platform secret
        // first, then the Connect endpoint's (piece 2b).
        const event = yield* Effect.tryPromise({
          try: () =>
            constructEventWithAnySecret(
              (secret) => client.webhooks.constructEventAsync(rawBody, signatureHeader, secret),
              connectWebhookSecret === null ? [webhookSecret] : [webhookSecret, connectWebhookSecret]
            ),
          catch: (cause) =>
            new PaymentWebhookSignatureError({
              reason: cause instanceof Error ? cause.message : 'invalid signature'
            })
        });
```

Everything else in `verifyWebhook` stays: the `webhookSecret === null` and missing-header refusals before it, and the normalisation after it (which already sets `account: event.account ?? null`).

`packages/payments/src/layer.ts`: in `PaymentsLive`, replace the final `return makeStripePayments({ client: makeStripeClient(secretKey), webhookSecret });` with:

```ts
    return makeStripePayments({
      client: makeStripeClient(secretKey),
      webhookSecret,
      connectWebhookSecret: secretValue(config.connectWebhookSecret)
    });
```

Append to `apps/api/.env.example` (below Task 4's block):

```dotenv
# Signing secret of the Connect webhook endpoint (staging/live only; local
# `stripe listen` uses STRIPE_WEBHOOK_SECRET for both streams).
STRIPE_CONNECT_WEBHOOK_SECRET=
```

Run: `cd packages/payments && bun test src`
Expected: PASS — 2a's signature tests (valid, tampered, other secret, stale timestamp, no secret) unchanged, plus the Connect case.

- [ ] **Step 7: Write the failing webhook tests**

In `apps/api/src/routes/webhooks/stripe.unit.test.ts`, give 2a's `makeWorld` a payout repo (every world gets one, since `processStripeEvent` now requires `PayoutAccountRepo`):

1. Imports — add `dummyPayoutAccount`, `makeInMemoryPayoutAccountRepo` and `type PayoutAccount` to the `@repo/db` import; add `PaymentProviderError` to the `@repo/payments` import; add:

```ts
import { readySnapshot } from '@/api/lib/payouts.test-support';
```

2. In `makeWorld`'s `options` type, after `cardOnFile?: string | null;`:

```ts
    /** Helper payout accounts on file (piece 2b). */
    payoutAccounts?: Array<PayoutAccount>;
    /** Stripe can't be reached when a payout account is re-fetched. */
    payoutProviderFails?: boolean;
```

3. In `makeWorld`'s `log` object, replace its last entry `updates: [] as Array<Partial<Payment>>` with:

```ts
    updates: [] as Array<Partial<Payment>>,
    /** Payout accounts re-fetched from the provider. */
    fetchedAccounts: [] as Array<string>
```

4. After the `const billing = makeInMemoryBillingCustomerRepo([...]);` statement:

```ts
  const payouts = makeInMemoryPayoutAccountRepo(options.payoutAccounts ?? []);
```

5. In the `makePaymentsTest({ provider: 'stripe', … })` call, after the `getCardSetup` override:

```ts
      getPayoutAccount: (reference) => {
        log.fetchedAccounts.push(reference);
        return options.payoutProviderFails
          ? Effect.fail(new PaymentProviderError({ operation: 'getPayoutAccount', cause: 'down' }))
          : Effect.succeed(readySnapshot());
      },
```

6. In the `Layer.mergeAll(...)` list, after `billing.layer,` add `payouts.layer,`.

7. In the returned object, add `payouts` (after `billing`).

Then append a new suite at the end of the file:

```ts
describe('account.updated (piece 2b)', () => {
  const accountUpdated = (overrides: Partial<PaymentWebhookEvent> = {}) =>
    event({
      eventId: 'evt_acct_1',
      type: 'account.updated',
      objectId: 'acct_123',
      account: 'acct_123',
      ...overrides
    });

  it('re-fetches a known account and stores the snapshot', async () => {
    const world = makeWorld({ verified: accountUpdated(), payoutAccounts: [dummyPayoutAccount()] });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(world.log.fetchedAccounts).toEqual(['acct_123']);
    expect(world.payouts.rows.get('helper-1')?.status).toBe('ready');
    expect(world.log.processed).toEqual(['evt_acct_1']);
  });

  it('records an unknown account and answers 200', async () => {
    const world = makeWorld({
      verified: accountUpdated({ eventId: 'evt_acct_2', objectId: 'acct_unknown', account: 'acct_unknown' }),
      payoutAccounts: []
    });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(world.log.fetchedAccounts).toEqual([]);
    expect(world.log.recorded).toEqual(['evt_acct_2']);
    expect(world.log.processed).toEqual(['evt_acct_2']);
  });

  it('answers 200 to a duplicate delivery without re-fetching', async () => {
    const world = makeWorld({
      verified: accountUpdated(),
      payoutAccounts: [dummyPayoutAccount()],
      seen: 'processed'
    });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(world.log.fetchedAccounts).toEqual([]);
  });

  it('marks the event failed and answers 500 when Stripe cannot be reached', async () => {
    const world = makeWorld({
      verified: accountUpdated(),
      payoutAccounts: [dummyPayoutAccount()],
      payoutProviderFails: true
    });
    const response = await world.post();
    expect(response.status).toBe(500);
    expect(world.log.failed).toEqual(['evt_acct_1']);
    expect(world.log.processed).toEqual([]);
  });
});
```

Run: `cd apps/api && bunx vitest run src/routes/webhooks/stripe.unit.test.ts -t "account.updated"`
Expected: FAIL — the known-account case answers 200 without re-fetching (`fetchedAccounts` is `[]`: 2a's placeholder returns `'account.updated: not handled yet'`), and the provider-failure case answers 200 instead of 500. The unknown-account and duplicate cases already pass.

- [ ] **Step 8: Replace 2a's placeholder case**

In `apps/api/src/routes/webhooks/stripe.ts`:

- add the import after the `@repo/payments` import:

```ts
import { handleAccountUpdated } from '@/api/lib/payouts';
```

- in `processStripeEvent`'s `switch (event.type)`, replace 2a's placeholder

```ts
      case 'account.updated':
        // Connected accounts arrive with piece 2b (helper payout accounts).
        return 'account.updated: not handled yet';
```

with

```ts
      case 'account.updated': {
        // Connect (piece 2b): a helper's payout account changed. A wake-up
        // signal only — the account is re-fetched and stored; an account we
        // don't know is acknowledged and ignored. The event's object IS the
        // connected account, so objectId is its acct_ id.
        const outcome = yield* handleAccountUpdated(event.objectId);
        return `payout account: ${outcome}`;
      }
```

No error mapping is needed: `stripeWebhookProgram` runs `processStripeEvent(event).pipe(Effect.exit)` and treats ANY failure (here `PayoutsProviderError` / `PayoutsRepoError`) as `markFailed` + 500. `PayoutAccountRepo` (Task 3) and `Payments` (2a) are already in `AppLive`, so the webhook runtime provides them.

- [ ] **Step 9: Run the webhook suite and type-check the entry point**

Run: `cd apps/api && bunx vitest run src/routes/webhooks`
Expected: PASS (2a's cases and the four new ones; the credibled e2e unchanged).

Run: `cd packages/payments && bun test src`
Expected: PASS.

`bun run build` only compiles `src/hc.ts`'s graph, which does not include the webhook routes, so type-check the entry point (and this task's test file) with 2a's throwaway config:

```bash
cd /run/media/hbt/work/poppynz/stripe-integration/apps/api
cat > "${TMPDIR:-/tmp}/tsconfig.api-entry.json" <<JSON
{ "extends": "$PWD/tsconfig.build.json",
  "compilerOptions": { "noEmit": true, "declaration": false, "declarationMap": false, "rootDir": "$PWD/src" },
  "files": ["$PWD/src/index.ts", "$PWD/src/hc.ts", "$PWD/src/routes/webhooks/stripe.unit.test.ts"] }
JSON
node_modules/.bin/tsc -p "${TMPDIR:-/tmp}/tsconfig.api-entry.json" && echo ENTRY_OK
```

Expected: `ENTRY_OK`.

- [ ] **Step 10: Document the live endpoints**

In `docs/activating-stripe-connect.md`, replace the bullet that starts "A live webhook endpoint in the dashboard pointing at" with:

```markdown
- Two live webhook endpoints in the dashboard, both pointing at `https://<api host>/webhooks/stripe`:
  - **Your account** events (payments, setup intents, refunds, disputes), with its signing secret as `STRIPE_WEBHOOK_SECRET`;
  - **Connected accounts** events, subscribed to `account.updated`, with its signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`.
  
  Set both in the production environment only. Staging, on test keys, needs the same two endpoints in test mode.
- `APP_WEB_ORIGIN=https://app.poppynz.com` (the default) — where Stripe's hosted onboarding returns helpers.
```

- [ ] **Step 11: Commit**

```bash
git add packages/payments/src/webhook-secrets.ts packages/payments/src/webhook-secrets.test.ts packages/payments/src/stripe.ts packages/payments/src/stripe.test.ts packages/payments/src/layer.ts packages/env/src/index.ts apps/api/src/routes/webhooks apps/api/.env.example docs/activating-stripe-connect.md
git commit -m "feat(api): account.updated refreshes helper payout accounts; Connect webhook secret

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `payoutsReady` on the contract detail

**Files:**
- Modify: `apps/api/src/routes/app/contracts/contracts.handler.ts` (`getContractProgram`, line 1046)
- Test: `apps/api/src/routes/app/contracts/contracts.unit.test.ts` (`makeLayer` line 230, `describe('GET /contracts/:id')` line 1738)

**Interfaces:**
- Consumes: Task 4 `hasReadyPayoutAccount(userId): Effect<boolean, never, Payments | PayoutAccountRepo>`; Task 3 `makePayoutAccountRepoTest`, `dummyPayoutAccount`, `PayoutAccountStatus`; 2a's `hasPaymentMethod` (computed just above, family-only, `null` for the provider).
- Produces: contract detail field `payoutsReady: boolean | null` — `true`/`false` for the helper (provider) viewer, `null` for the family viewer (the mirror of 2a's `hasPaymentMethod`). `actions.canAccept` is unchanged (never gated on it).

- [ ] **Step 1: Give the test layer a payout account**

In `contracts.unit.test.ts`:
- add to the `@repo/db` import: `dummyPayoutAccount,`, `makePayoutAccountRepoTest,` and `type PayoutAccountStatus,`
- add to `makeLayer`'s `options` type, after 2a's `familyCard?: boolean;`:

```ts
    /** The helper's stored payout status; null/undefined = no payout account. */
    payoutAccountStatus?: PayoutAccountStatus | null;
```

- add to the `Layer.mergeAll(...)` list in `makeLayer`, right after 2a's `makePaymentsTest({}),` (whose provider is `'mock'` — the fixture row must match it, or Task 4's provider rule hides it):

```ts
    makePayoutAccountRepoTest({
      findByUserId: (userId) =>
        Effect.succeed(
          options.payoutAccountStatus
            ? dummyPayoutAccount({
                userId,
                provider: 'mock',
                accountReference: `mock_acct_${userId}`,
                status: options.payoutAccountStatus
              })
            : null
        )
    }),
```

- [ ] **Step 2: Write the failing tests**

Append inside `describe('GET /contracts/:id', () => { … })`:

```ts
  describe('payoutsReady (reminder only — never blocks accepting)', () => {
    const helperLayer = (payoutAccountStatus?: PayoutAccountStatus | null) =>
      makeLayer({
        viewer: providerUser(),
        contractWithContext: withContext(
          baseContract({ status: 'proposed' }),
          [proposedVersion()],
          'provider-1'
        ),
        conversationById: activeConversation(),
        payoutAccountStatus
      });

    it('is false for a helper without a payout account, and Accept stays available', async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(helperLayer(null))
        )
      );
      expect(contract.payoutsReady).toBe(false);
      expect(contract.actions.canAccept).toBe(true);
    });

    it('is false while the payout account is still restricted', async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(helperLayer('restricted'))
        )
      );
      expect(contract.payoutsReady).toBe(false);
    });

    it('is true once the payout account is ready', async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(helperLayer('ready'))
        )
      );
      expect(contract.payoutsReady).toBe(true);
    });

    it('is null for the family viewer', async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              contractWithContext: withContext(
                baseContract({ status: 'proposed' }),
                [proposedVersion()],
                'family-1'
              ),
              conversationById: activeConversation(),
              payoutAccountStatus: 'ready'
            })
          )
        )
      );
      expect(contract.payoutsReady).toBeNull();
    });
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts -t "payoutsReady"`
Expected: FAIL — `expected undefined to be false`.

- [ ] **Step 4: Add the field**

In `contracts.handler.ts`:
- add the import after the other `@/api/lib/*` imports: `import { hasReadyPayoutAccount } from '@/api/lib/payouts';`
- in `getContractProgram`, right after 2a's `hasPaymentMethod` (the `const hasPaymentMethod = isFamily ? … : null;` statement), add:

```ts
    // The mirror for the helper (piece 2b): told whether payouts are ready,
    // for the reminder at acceptance; null for the family. Stored snapshot
    // only, and readiness never gates accepting — pieces 3 and 4 enforce it.
    const payoutsReady = isFamily ? null : yield* hasReadyPayoutAccount(viewer.id);
```

- in the returned `contract` object, after 2a's `hasPaymentMethod,` add `payoutsReady,`.

- [ ] **Step 5: Run the contracts suite, the api suite and build the RPC types**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts`
Expected: PASS (whole file).

Run: `cd apps/api && bunx vitest run`
Expected: PASS (whole api suite).

Run: `cd apps/api && bun run build`
Expected: exits 0 (refreshes `dist/hc.d.ts`, which the web RPC types read — including `/payouts` from Task 5).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/app/contracts
git commit -m "feat(api): payoutsReady on the contract detail for the helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Web API client, sidebar badge and Payouts nav item

**Files:**
- Create: `apps/web/src/lib/api/payouts.ts`, `apps/web/src/lib/payouts-badge.svelte.ts`, `apps/web/src/lib/payouts-badge.test.ts`
- Modify: `apps/web/src/lib/components/SidebarNav.svelte`, `apps/web/src/routes/service-provider/+layout.svelte`

**Interfaces:**
- Consumes: Task 5 RPC endpoints (after Task 7's `bun run build`).
- Produces:
  - `getPayouts()`, `startPayoutsOnboarding()`, `refreshPayouts()`, `openPayoutsDashboard()` → `ApiResult<…>`
  - `type PayoutsState = { status: 'onboarding' | 'ready' | 'restricted' | 'disabled' | null; paymentReady: boolean; requirementsDue: string[]; provider: 'mock' | 'stripe'; hasAccount: boolean }` (inferred)
  - `payoutsBadge: { needsSetup: boolean; refresh(): Promise<void> }`
  - `SidebarItem.badge?: number | string`

- [ ] **Step 1: Write the API wrappers**

`apps/web/src/lib/api/payouts.ts`:

```ts
/** Helper payout account (Stripe Connect, piece 2b), backed by /payouts. */
import { apiClient, call, type ErrorsOf } from './client';

const statusEndpoint = apiClient.payouts.$get;
const onboardingEndpoint = apiClient.payouts.onboarding.$post;
const refreshEndpoint = apiClient.payouts.refresh.$post;
const dashboardEndpoint = apiClient.payouts.dashboard.$post;

export type PayoutsState = Extract<Awaited<ReturnType<typeof getPayouts>>, { ok: true }>['data'];
export type PayoutsStatus = NonNullable<PayoutsState['status']>;

export type PayoutsStatusError = ErrorsOf<typeof statusEndpoint>;
export type PayoutsOnboardingError = ErrorsOf<typeof onboardingEndpoint>;
export type PayoutsRefreshError = ErrorsOf<typeof refreshEndpoint>;
export type PayoutsDashboardError = ErrorsOf<typeof dashboardEndpoint>;

export async function getPayouts() {
	return call(statusEndpoint());
}

/** Creates the account if needed; returns a short-lived Stripe onboarding URL. */
export async function startPayoutsOnboarding() {
	return call(onboardingEndpoint());
}

/** Re-fetches the status from Stripe (after returning from Stripe's pages). */
export async function refreshPayouts() {
	return call(refreshEndpoint());
}

/** A login link to the Stripe Express payout dashboard. */
export async function openPayoutsDashboard() {
	return call(dashboardEndpoint());
}
```

- [ ] **Step 2: Write the failing badge test**

`apps/web/src/lib/payouts-badge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getPayouts } = vi.hoisted(() => ({ getPayouts: vi.fn() }));
vi.mock('$lib/api/payouts', () => ({ getPayouts }));

import { payoutsBadge } from './payouts-badge.svelte';

const state = (overrides: Record<string, unknown> = {}) => ({
	status: null,
	paymentReady: false,
	requirementsDue: [],
	provider: 'stripe',
	hasAccount: false,
	...overrides
});

describe('payoutsBadge', () => {
	afterEach(() => {
		vi.clearAllMocks();
		payoutsBadge.needsSetup = false;
	});

	it('flags a helper with no payout account', async () => {
		getPayouts.mockResolvedValue({ ok: true, data: state() });
		await payoutsBadge.refresh();
		expect(payoutsBadge.needsSetup).toBe(true);
	});

	it('flags an account that is not ready yet', async () => {
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'restricted' })
		});
		await payoutsBadge.refresh();
		expect(payoutsBadge.needsSetup).toBe(true);
	});

	it('clears once the account is ready', async () => {
		payoutsBadge.needsSetup = true;
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'ready', paymentReady: true })
		});
		await payoutsBadge.refresh();
		expect(payoutsBadge.needsSetup).toBe(false);
	});

	it('keeps the last value when the request fails', async () => {
		payoutsBadge.needsSetup = true;
		getPayouts.mockResolvedValue({ ok: false, error: { code: 'UNEXPECTED', message: 'x', status: null } });
		await payoutsBadge.refresh();
		expect(payoutsBadge.needsSetup).toBe(true);
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/web && bunx vitest run src/lib/payouts-badge.test.ts`
Expected: FAIL — `Failed to resolve import "./payouts-badge.svelte"`.

- [ ] **Step 4: Write the store**

`apps/web/src/lib/payouts-badge.svelte.ts`:

```ts
/**
 * Sidebar "Payouts" badge: shown while the helper has no payout account or it
 * isn't payment-ready yet. A reminder only — nothing is blocked (piece 2b).
 * The layout refreshes it on navigation; the Payouts page sets it directly
 * after each status it loads.
 */
import { getPayouts } from './api/payouts';

class PayoutsBadgeStore {
	needsSetup = $state(false);

	async refresh(): Promise<void> {
		const result = await getPayouts();
		if (result.ok) this.needsSetup = !result.data.paymentReady;
	}
}

export const payoutsBadge = new PayoutsBadgeStore();
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd apps/web && bunx vitest run src/lib/payouts-badge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Let a badge be a marker, add the nav item**

`apps/web/src/lib/components/SidebarNav.svelte`, in `SidebarItem`:

```ts
		/** Pink attention badge: a count (e.g. missing documents) or a short
		 * marker such as '!'; hidden when falsy. */
		badge?: number | string;
```

`apps/web/src/routes/service-provider/+layout.svelte`:
- add `import { payoutsBadge } from '$lib/payouts-badge.svelte';` after the `contractsBadge` import;
- in `$effect(() => { if (authorized) void refreshBadge(); });` add the payouts refresh:

```ts
	$effect(() => {
		if (authorized) {
			void refreshBadge();
			void payoutsBadge.refresh();
		}
	});
```

- in `afterNavigate`, add `void payoutsBadge.refresh();` after `void contractsBadge.refresh();`;
- in `items`, after the Contracts item:

```ts
		{
			href: resolve('/service-provider/payouts'),
			label: 'Payouts',
			icon: 'la-wallet',
			badge: payoutsBadge.needsSetup ? '!' : undefined,
			group: 'Your Poppynz'
		},
```

- [ ] **Step 7: Type-check**

Run: `cd apps/web && bun run check`
Expected: `svelte-check found 0 errors` — except the missing `/service-provider/payouts` route for `resolve(...)`, if svelte-check reports one; Task 9 creates the route. If it reports it, continue and confirm it is gone after Task 9.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/api/payouts.ts apps/web/src/lib/payouts-badge.svelte.ts apps/web/src/lib/payouts-badge.test.ts apps/web/src/lib/components/SidebarNav.svelte apps/web/src/routes/service-provider/+layout.svelte
git commit -m "feat(web): payouts API client, sidebar Payouts item and badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Payouts page

**Files:**
- Create: `apps/web/src/lib/components/payouts/PayoutsPage.svelte`, `apps/web/src/lib/components/payouts/PayoutsPage.mount.test.ts`, `apps/web/src/routes/service-provider/payouts/+page.svelte`

**Interfaces:**
- Consumes: Task 8 (`getPayouts`, `startPayoutsOnboarding`, `refreshPayouts`, `openPayoutsDashboard`, `PayoutsState`, `payoutsBadge`); `toast` from `$lib/toast.svelte`.
- Produces: `PayoutsPage` props `returnState?: 'stripe' | 'refresh' | null`, `onreturnhandled?: () => void`, `navigate?: (url: string) => void` (default `window.location.assign`).

- [ ] **Step 1: Write the failing mount tests**

`apps/web/src/lib/components/payouts/PayoutsPage.mount.test.ts`:

```ts
// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getPayouts, startPayoutsOnboarding, refreshPayouts, openPayoutsDashboard } = vi.hoisted(
	() => ({
		getPayouts: vi.fn(),
		startPayoutsOnboarding: vi.fn(),
		refreshPayouts: vi.fn(),
		openPayoutsDashboard: vi.fn()
	})
);

vi.mock('$lib/api/payouts', () => ({
	getPayouts,
	startPayoutsOnboarding,
	refreshPayouts,
	openPayoutsDashboard
}));

import PayoutsPage from './PayoutsPage.svelte';

const state = (overrides: Record<string, unknown> = {}) => ({
	status: null,
	paymentReady: false,
	requirementsDue: [],
	provider: 'stripe',
	hasAccount: false,
	...overrides
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

describe('PayoutsPage', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('offers "Set up payouts" without an account and sends the helper to Stripe', async () => {
		getPayouts.mockResolvedValue({ ok: true, data: state() });
		startPayoutsOnboarding.mockResolvedValue({
			ok: true,
			data: { url: 'https://connect.stripe.com/setup/e/acct_1/abc' }
		});
		const navigate = vi.fn();
		const app = mount(PayoutsPage, { target: document.body, props: { navigate } });
		await settle();
		button('Set up payouts')?.click();
		await settle();
		unmount(app);
		expect(startPayoutsOnboarding).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/abc');
	});

	it('offers "Continue setup" while onboarding', async () => {
		getPayouts.mockResolvedValue({ ok: true, data: state({ hasAccount: true, status: 'onboarding' }) });
		const app = mount(PayoutsPage, { target: document.body, props: { navigate: vi.fn() } });
		await settle();
		const found = button('Continue setup') !== undefined;
		unmount(app);
		expect(found).toBe(true);
	});

	it('lists what Stripe needs and offers "Fix in Stripe" when restricted', async () => {
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({
				hasAccount: true,
				status: 'restricted',
				requirementsDue: ['A bank account for your payouts', 'Photo ID']
			})
		});
		const app = mount(PayoutsPage, { target: document.body, props: { navigate: vi.fn() } });
		await settle();
		const items = [...document.querySelectorAll('li')].map((li) => li.textContent?.trim());
		const found = button('Fix in Stripe') !== undefined;
		unmount(app);
		expect(items).toEqual(['A bank account for your payouts', 'Photo ID']);
		expect(found).toBe(true);
	});

	it('shows a support message and no action when disabled', async () => {
		getPayouts.mockResolvedValue({ ok: true, data: state({ hasAccount: true, status: 'disabled' }) });
		const app = mount(PayoutsPage, { target: document.body, props: { navigate: vi.fn() } });
		await settle();
		const text = document.body.textContent ?? '';
		const buttons = document.querySelectorAll('section button').length;
		unmount(app);
		expect(text).toContain('contact Poppynz support');
		expect(buttons).toBe(0);
	});

	it('shows ready and opens the Stripe dashboard', async () => {
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'ready', paymentReady: true })
		});
		openPayoutsDashboard.mockResolvedValue({
			ok: true,
			data: { url: 'https://connect.stripe.com/express/acct_1' }
		});
		const navigate = vi.fn();
		const app = mount(PayoutsPage, { target: document.body, props: { navigate } });
		await settle();
		const text = document.body.textContent ?? '';
		button('View payouts in Stripe')?.click();
		await settle();
		unmount(app);
		expect(text).toContain('Ready to be paid');
		expect(navigate).toHaveBeenCalledWith('https://connect.stripe.com/express/acct_1');
	});

	it('refreshes from Stripe on return (?from=stripe)', async () => {
		refreshPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'ready', paymentReady: true })
		});
		const onreturnhandled = vi.fn();
		const app = mount(PayoutsPage, {
			target: document.body,
			props: { navigate: vi.fn(), returnState: 'stripe', onreturnhandled }
		});
		await settle();
		unmount(app);
		expect(refreshPayouts).toHaveBeenCalledTimes(1);
		expect(getPayouts).not.toHaveBeenCalled();
		expect(onreturnhandled).toHaveBeenCalledTimes(1);
	});

	it('asks for a fresh onboarding link when the old one expired (?refresh=1)', async () => {
		startPayoutsOnboarding.mockResolvedValue({
			ok: true,
			data: { url: 'https://connect.stripe.com/setup/e/acct_1/new' }
		});
		const navigate = vi.fn();
		const app = mount(PayoutsPage, {
			target: document.body,
			props: { navigate, returnState: 'refresh', onreturnhandled: vi.fn() }
		});
		await settle();
		unmount(app);
		expect(navigate).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/new');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && bunx vitest run src/lib/components/payouts/PayoutsPage.mount.test.ts`
Expected: FAIL — `Failed to resolve import "./PayoutsPage.svelte"`.

- [ ] **Step 3: Write the component**

`apps/web/src/lib/components/payouts/PayoutsPage.svelte`:

```svelte
<script lang="ts">
	/** Helper payout account (piece 2b). Stripe hosts onboarding and the payout
	 * dashboard; this page shows the status Poppynz last fetched and sends the
	 * helper to Stripe. Nothing here blocks accepting contracts. */
	import {
		getPayouts,
		openPayoutsDashboard,
		refreshPayouts,
		startPayoutsOnboarding,
		type PayoutsState
	} from '$lib/api/payouts';
	import { payoutsBadge } from '$lib/payouts-badge.svelte';
	import { toast } from '$lib/toast.svelte';
	import { onMount } from 'svelte';

	interface Props {
		/** `stripe`: back from Stripe's hosted pages; `refresh`: the onboarding link expired. */
		returnState?: 'stripe' | 'refresh' | null;
		/** Called once the return is handled, so the route can drop the query. */
		onreturnhandled?: () => void;
		/** Leaves the app for a Stripe-hosted page. Injected in tests. */
		navigate?: (url: string) => void;
	}

	let {
		returnState = null,
		onreturnhandled,
		navigate = (url: string) => window.location.assign(url)
	}: Props = $props();

	let payouts = $state<PayoutsState | null>(null);
	let loading = $state(true);
	let busy = $state(false);

	async function load(request: typeof getPayouts | typeof refreshPayouts) {
		loading = true;
		const result = await request();
		loading = false;
		if (result.ok) {
			payouts = result.data;
			payoutsBadge.needsSetup = !result.data.paymentReady;
		} else {
			toast.error(result.error.message, { title: 'Payouts unavailable' });
		}
	}

	/** Returns true when the browser is leaving for Stripe. */
	async function goToStripe(
		request: typeof startPayoutsOnboarding | typeof openPayoutsDashboard,
		failureTitle: string
	): Promise<boolean> {
		if (busy) return false;
		busy = true;
		const result = await request();
		if (result.ok) {
			// Stay busy: the page is being replaced by Stripe's.
			navigate(result.data.url);
			return true;
		}
		busy = false;
		toast.error(result.error.message, { title: failureTitle });
		return false;
	}

	onMount(() => {
		void (async () => {
			if (returnState === 'refresh') {
				onreturnhandled?.();
				const leaving = await goToStripe(startPayoutsOnboarding, "Couldn't reopen Stripe");
				if (!leaving) await load(getPayouts);
				return;
			}
			if (returnState === 'stripe') {
				onreturnhandled?.();
				await load(refreshPayouts);
				return;
			}
			await load(getPayouts);
		})();
	});
</script>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Payouts</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Poppynz pays your earnings through Stripe. Stripe verifies your identity and your bank
		account — Poppynz never sees those details.
	</p>

	<section class="rounded-xl border border-card-border bg-base-100 p-5 lg:p-6" aria-live="polite">
		{#if loading}
			<span class="loading loading-spinner loading-md" aria-label="Loading"></span>
		{:else if payouts === null}
			<p class="text-sm text-base-content-muted">
				Your payout status couldn't be loaded. Refresh the page to try again.
			</p>
		{:else if !payouts.hasAccount}
			<h2 class="text-[15px] font-bold text-base-content">Set up your payout account</h2>
			<p class="mt-1 text-sm text-base-content-muted">
				It takes a few minutes on Stripe. You can accept contracts before it's done, but you'll
				need it to be paid.
			</p>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, "Couldn't open Stripe")}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				Set up payouts
			</button>
		{:else if payouts.status === 'ready'}
			<div class="flex items-center gap-2 text-success">
				<i class="las la-check-circle text-xl" aria-hidden="true"></i>
				<h2 class="text-[15px] font-bold">Ready to be paid</h2>
			</div>
			<p class="mt-1 text-sm text-base-content-muted">
				Your payout account is set up. Stripe sends your earnings to your bank account.
			</p>
			<button
				type="button"
				class="btn mt-4 btn-outline"
				disabled={busy}
				onclick={() => goToStripe(openPayoutsDashboard, "Couldn't open Stripe")}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				View payouts in Stripe
			</button>
		{:else if payouts.status === 'restricted'}
			<h2 class="text-[15px] font-bold text-base-content">Stripe needs a few more details</h2>
			<ul class="mt-2 list-disc pl-5 text-sm text-base-content">
				{#each payouts.requirementsDue as label (label)}
					<li>{label}</li>
				{/each}
			</ul>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, "Couldn't open Stripe")}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				Fix in Stripe
			</button>
		{:else if payouts.status === 'disabled'}
			<h2 class="text-[15px] font-bold text-error">Payouts are turned off</h2>
			<p class="mt-1 text-sm text-base-content-muted">
				Stripe can't pay out to this account. Please contact Poppynz support so we can help you
				sort it out.
			</p>
		{:else}
			<h2 class="text-[15px] font-bold text-base-content">Your setup isn't finished</h2>
			<p class="mt-1 text-sm text-base-content-muted">Pick up where you left off on Stripe.</p>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, "Couldn't open Stripe")}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				Continue setup
			</button>
		{/if}
	</section>
</div>
```

- [ ] **Step 4: Write the route**

`apps/web/src/routes/service-provider/payouts/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PayoutsPage from '$lib/components/payouts/PayoutsPage.svelte';

	// Stripe returns helpers here: ?from=stripe after onboarding, ?refresh=1
	// when the onboarding link expired. Read once on arrival.
	const returnState: 'stripe' | 'refresh' | null =
		page.url.searchParams.get('from') === 'stripe'
			? 'stripe'
			: page.url.searchParams.get('refresh') === '1'
				? 'refresh'
				: null;

	function dropQuery() {
		void goto(resolve('/service-provider/payouts'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<svelte:head>
	<title>Payouts · Poppynz</title>
</svelte:head>

<PayoutsPage {returnState} onreturnhandled={dropQuery} />
```

- [ ] **Step 5: Run the tests and the type-check**

Run: `cd apps/web && bunx vitest run src/lib/components/payouts/PayoutsPage.mount.test.ts`
Expected: PASS (7 tests).

Run: `cd apps/web && bun run check`
Expected: `svelte-check found 0 errors`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/payouts apps/web/src/routes/service-provider/payouts
git commit -m "feat(web): helper Payouts page driven by the payout account status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Reminder at acceptance

**Files:**
- Create: `apps/web/src/lib/components/payouts/PayoutsReminder.svelte`, `apps/web/src/lib/components/payouts/PayoutsReminder.mount.test.ts`, `apps/web/src/lib/components/admin/ConfirmDialog.mount.test.ts`
- Modify: `apps/web/src/lib/components/admin/ConfirmDialog.svelte`, `apps/web/src/lib/components/contracts/ContractDetailPage.svelte` (accept `ConfirmDialog`, line 850)

**Interfaces:**
- Consumes: Task 7 `ContractDetail['payoutsReady']: boolean | null` (via the RPC types built in Task 7).
- Produces: `ConfirmDialog` optional prop `children?: Snippet` (rendered under `body`); `PayoutsReminder` (no props).

- [ ] **Step 1: Write the failing mount tests**

`apps/web/src/lib/components/payouts/PayoutsReminder.mount.test.ts`:

```ts
// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PayoutsReminder from './PayoutsReminder.svelte';

describe('PayoutsReminder', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('reminds without blocking and links to Payouts', () => {
		const app = mount(PayoutsReminder, { target: document.body });
		flushSync();
		const bold = document.querySelector('strong')?.textContent;
		const text = document.body.textContent?.replace(/\s+/g, ' ').trim();
		const link = document.querySelector('a')?.getAttribute('href');
		unmount(app);
		expect(bold).toBe("You'll need a payout account to collect your earnings.");
		expect(text).toBe(
			"You'll need a payout account to collect your earnings. Set it up now, or later — you'll be asked again before your first payment."
		);
		expect(link).toBe('/service-provider/payouts');
	});
});
```

`apps/web/src/lib/components/admin/ConfirmDialog.mount.test.ts`:

```ts
// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from './ConfirmDialog.svelte';

describe('ConfirmDialog', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('renders extra content under the body', () => {
		const children = createRawSnippet(() => ({
			render: () => '<p data-testid="extra">Extra note</p>'
		}));
		const app = mount(ConfirmDialog, {
			target: document.body,
			props: {
				open: true,
				title: 'Accept & sign this contract?',
				body: 'Signing activates the contract.',
				onconfirm: vi.fn(),
				oncancel: vi.fn(),
				children
			}
		});
		flushSync();
		const extra = document.querySelector('[data-testid="extra"]')?.textContent;
		unmount(app);
		expect(extra).toBe('Extra note');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && bunx vitest run src/lib/components/payouts/PayoutsReminder.mount.test.ts src/lib/components/admin/ConfirmDialog.mount.test.ts`
Expected: FAIL — `PayoutsReminder.svelte` doesn't exist; `[data-testid="extra"]` not rendered.

- [ ] **Step 3: Write the reminder and let the dialog take children**

`apps/web/src/lib/components/payouts/PayoutsReminder.svelte`:

```svelte
<script lang="ts">
	/** Shown in the helper's accept confirmation while payouts aren't ready.
	 * A reminder only — accepting is never blocked (piece 2b). */
	import { resolve } from '$app/paths';
</script>

<p class="rounded-lg bg-base-200 px-3 py-2.5 text-[13px] leading-relaxed text-base-content" role="note">
	<strong>You'll need a payout account to collect your earnings.</strong>
	<a class="link font-semibold link-primary" href={resolve('/service-provider/payouts')}>Set it up now</a>, or later — you'll be asked again before your first payment.
</p>
```

`apps/web/src/lib/components/admin/ConfirmDialog.svelte`:
- add `import type { Snippet } from 'svelte';` at the top of the script;
- in `Props` add:

```ts
		/** Optional extra content under the body (e.g. a reminder with a link). */
		children?: Snippet;
```

- add `children` to the destructured `$props()`;
- after `<p class="py-3 text-sm text-base-content-muted">{body}</p>` add:

```svelte
			{#if children}
				<div class="pb-1">{@render children()}</div>
			{/if}
```

- [ ] **Step 4: Show it in the accept confirmation**

`apps/web/src/lib/components/contracts/ContractDetailPage.svelte`:
- add `import PayoutsReminder from '$lib/components/payouts/PayoutsReminder.svelte';` after the `ConfirmDialog` import;
- replace the self-closing accept dialog

```svelte
<ConfirmDialog
	open={acceptConfirmOpen}
	title="Accept & sign this contract?"
	body="Signing activates the contract — contact details are shared and weekly payments are set up on Poppynz."
	confirmLabel="Accept & sign"
	confirmClass="btn-primary"
	{busy}
	onconfirm={handleAccept}
	oncancel={() => (acceptConfirmOpen = false)}
/>
```

with

```svelte
<ConfirmDialog
	open={acceptConfirmOpen}
	title="Accept & sign this contract?"
	body="Signing activates the contract — contact details are shared and weekly payments are set up on Poppynz."
	confirmLabel="Accept & sign"
	confirmClass="btn-primary"
	{busy}
	onconfirm={handleAccept}
	oncancel={() => (acceptConfirmOpen = false)}
>
	{#if role === 'service-provider' && contract?.payoutsReady === false}
		<PayoutsReminder />
	{/if}
</ConfirmDialog>
```

- [ ] **Step 5: Run the tests and the type-check**

Run: `cd apps/web && bunx vitest run src/lib/components/payouts src/lib/components/admin`
Expected: PASS.

Run: `cd apps/web && bun run check`
Expected: `svelte-check found 0 errors`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/payouts apps/web/src/lib/components/admin/ConfirmDialog.svelte apps/web/src/lib/components/admin/ConfirmDialog.mount.test.ts apps/web/src/lib/components/contracts/ContractDetailPage.svelte
git commit -m "feat(web): payout reminder in the helper's accept confirmation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Whole-repo verification

**Files:** none new (fixes only if a check fails).

- [ ] **Step 1: Stripe stays inside `@repo/payments`**

Run: `grep -rln "from 'stripe'\|require('stripe')" apps packages --include=*.ts --include=*.svelte | grep -v node_modules | grep -v '^packages/payments/'`
Expected: no output.

- [ ] **Step 2: No placeholders or live keys in the diff**

Run: `git diff develop --stat && git diff develop | grep -nE "sk_live_|pk_live_|whsec_[A-Za-z0-9]{10,}|TODO|TBD" || echo clean`
Expected: `clean` (test fixtures only use `whsec_platform` / `whsec_connect`, which the pattern doesn't match).

- [ ] **Step 3: Lint, types, tests**

Run from the worktree root:

```bash
bun run lint
bun run check-types
cd packages/payments && bun test src && cd ../..
cd packages/billing && bun test src && cd ../..
cd apps/api && bunx vitest run && bun run build && cd ../..
cd apps/worker && bunx vitest run && cd ../..
cd apps/web && bun run check && bunx vitest run && cd ../..
```

`packages/billing` and `apps/worker` build `Payments` through `makePaymentsTest` / `PaymentsLive`, which gained the four operations; their suites must stay green.

Then type-check what `bun run build` doesn't reach — the API entry point (webhook routes) and 2b's api test files (vitest doesn't type-check):

```bash
cd /run/media/hbt/work/poppynz/stripe-integration/apps/api
cat > "${TMPDIR:-/tmp}/tsconfig.api-entry.json" <<JSON
{ "extends": "$PWD/tsconfig.build.json",
  "compilerOptions": { "noEmit": true, "declaration": false, "declarationMap": false, "rootDir": "$PWD/src" },
  "files": [
    "$PWD/src/index.ts",
    "$PWD/src/hc.ts",
    "$PWD/src/lib/payouts.unit.test.ts",
    "$PWD/src/routes/app/payouts/payouts.unit.test.ts",
    "$PWD/src/routes/webhooks/stripe.unit.test.ts"
  ] }
JSON
node_modules/.bin/tsc -p "${TMPDIR:-/tmp}/tsconfig.api-entry.json" && echo ENTRY_OK
```

Expected: every command exits 0 and the last prints `ENTRY_OK`. (`contracts.unit.test.ts` is left out on purpose: at 2a's HEAD it already has two type errors unrelated to payments — a `SafeUserProfile` fixture missing `image`, line 114, and an `Effect<…, any>` at line 2591 — so its Task 7 additions are covered by vitest only.) Fix and re-run anything that fails; commit fixes as `fix: …` with the trailer.

- [ ] **Step 4: Confirm the tree**

Run: `git status --short`
Expected: clean (or only the intentional fix commits made in Step 3).

---

### Task 12: Local end-to-end (test mode)

**Files:**
- Create: `packages/payments/scripts/e2e-payout-account.ts`
- Modify (local only, never committed): `apps/api/.env` (only if a value below is missing). The `web-stripe` entry in `/run/media/hbt/work/poppynz/.claude/launch.json` already exists (2a added it); don't add another.

> **WARNING — real Credibled key.** As 2a left it, `apps/api/.env` (symlinked as `apps/worker/.env` and `packages/db/.env`) has `PAYMENTS_PROVIDER=stripe` **and the real Credibled provider key** (`CREDIBLED_BASE_URL=https://api.credibled.com/…`, `CREDIBLED_PROVIDER_API_KEY` set). A paid background-check order placed in this stack is a real Credibled order. 2b's e2e must not trigger any background-check order:
> - Never open a Safety verification checkout, never pay or "Pay & order" anything, never confirm a `PaymentModal`. The helpers signed up below only need the Payouts page; stop the sign-up wizard before any safety-verification step.
> - Never run `stripe trigger …`, `stripe events resend …` or replay a `payment_intent.*` / `charge.*` event — the only Stripe events 2b generates are `account.updated` for the test connected accounts.
> - Stop the worker for the whole task (Step 3) — 2b needs no worker job, and it is the process that places Credibled orders — and record `check_orders` before and after (Steps 3 and 10); the count must not change.
> - Never print or copy any `CREDIBLED_*` or `STRIPE_*` secret value.

Rules for this task: test-mode keys only; never print `STRIPE_SECRET_KEY` or the webhook secret; **never fill in or click through Stripe-hosted pages** (look, screenshot, go back). An Express account can't be completed through the API (its terms of service must be accepted on Stripe's pages), so the "complete a test account through the API" scenario uses a test-mode **Custom** account created by the e2e script only, prefilled with Stripe's documented test values (`dob 1901-01-01`, `address_full_match`, `id_number 000000000`, phone `0000000000`, CA bank `11000-000` / `000123456789`, `tos_acceptance` set by the platform). The app's own code still creates Express accounts only.

- [ ] **Step 1: Write the e2e helper script**

`packages/payments/scripts/e2e-payout-account.ts`:

```ts
/**
 * LOCAL END-TO-END ONLY (piece 2b). Test mode only: refuses any key that
 * isn't sk_test_. Never imported by the app.
 *
 *   create-ready [--with-card-payments]
 *       Creates a CUSTOM connected account in Canada prefilled with Stripe's
 *       documented test values, so it becomes payout-ready without anyone
 *       filling Stripe's hosted pages (an Express account can't: its terms
 *       must be accepted there). Prints the id and readiness flags as JSON.
 *   touch <acct_id>
 *       Updates the account's metadata so Stripe emits account.updated
 *       (forwarded locally by `stripe listen --forward-connect-to`).
 *
 * Run from the worktree root; the key is read from the env file, never printed:
 *   bun --env-file=apps/api/.env packages/payments/scripts/e2e-payout-account.ts create-ready
 */
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../src/stripe';

const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!key.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY must be a test-mode key (sk_test_…). Refusing to run.');
  process.exit(1);
}

// Same pinned API version as the app's adapter (2a).
const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });

const flags = (account: Stripe.Account) => ({
  id: account.id,
  details_submitted: account.details_submitted,
  payouts_enabled: account.payouts_enabled,
  transfers: account.capabilities?.transfers ?? null,
  currently_due: account.requirements?.currently_due ?? [],
  disabled_reason: account.requirements?.disabled_reason ?? null
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createReady = async (withCardPayments: boolean) => {
  const account = await stripe.accounts.create({
    type: 'custom',
    country: 'CA',
    business_type: 'individual',
    email: 'e2e-helper@example.com',
    capabilities: {
      transfers: { requested: true },
      ...(withCardPayments ? { card_payments: { requested: true } } : {})
    },
    business_profile: {
      mcc: '8351',
      product_description: 'Childcare booked through Poppynz (local e2e test account)'
    },
    individual: {
      first_name: 'Test',
      last_name: 'Helper',
      email: 'e2e-helper@example.com',
      phone: '0000000000',
      dob: { day: 1, month: 1, year: 1901 },
      id_number: '000000000',
      address: {
        line1: 'address_full_match',
        city: 'Winnipeg',
        state: 'MB',
        postal_code: 'R3C 0A1',
        country: 'CA'
      }
    },
    external_account: {
      object: 'bank_account',
      country: 'CA',
      currency: 'cad',
      routing_number: '11000-000',
      account_number: '000123456789'
    },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
    metadata: { e2e: 'payouts-2b' }
  });

  // Test-mode verification settles asynchronously; poll for up to a minute.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await stripe.accounts.retrieve(account.id);
    if (
      current.details_submitted &&
      current.payouts_enabled &&
      current.capabilities?.transfers === 'active'
    ) {
      console.log(JSON.stringify(flags(current)));
      return;
    }
    await sleep(3000);
  }
  console.log(JSON.stringify(flags(await stripe.accounts.retrieve(account.id))));
  process.exitCode = 2;
};

const touch = async (accountId: string) => {
  const updated = await stripe.accounts.update(accountId, {
    metadata: { e2e_touched_at: new Date().toISOString() }
  });
  console.log(JSON.stringify(flags(updated)));
};

const [command, argument] = process.argv.slice(2);
try {
  if (command === 'create-ready') {
    await createReady(argument === '--with-card-payments');
  } else if (command === 'touch' && argument?.startsWith('acct_')) {
    await touch(argument);
  } else {
    console.error('Usage: create-ready [--with-card-payments] | touch <acct_id>');
    process.exitCode = 1;
  }
} catch (error) {
  // Stripe errors carry no secrets; print the message only.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
```

Commit it (it is part of the deliverable):

```bash
git add packages/payments/scripts/e2e-payout-account.ts
git commit -m "test(payments): local e2e helper for a payout-ready test account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Local env (never printed)**

Run from the worktree root, in one Bash call:

```bash
cd /run/media/hbt/work/poppynz/stripe-integration
set_env() { if grep -q "^$1=" apps/api/.env; then sed -i "s|^$1=.*|$1=$2|" apps/api/.env; else printf '%s=%s\n' "$1" "$2" >> apps/api/.env; fi; }
STRIPE_KEY=$(grep -E '^STRIPE_SECRET_KEY=' apps/api/.env | cut -d= -f2- | tr -d '"')
case "$STRIPE_KEY" in sk_test_*) ;; *) echo "not a test key — stop"; exit 1;; esac
set_env PAYMENTS_PROVIDER stripe
set_env APP_WEB_ORIGIN http://localhost:5175
set_env PAYOUTS_REFRESH_AFTER_MINUTES 60
set_env STRIPE_WEBHOOK_SECRET "$(stripe listen --api-key "$STRIPE_KEY" --print-secret)"
grep -cE '^(PAYMENTS_PROVIDER=stripe|APP_WEB_ORIGIN=http://localhost:5175|STRIPE_WEBHOOK_SECRET=whsec_)' apps/api/.env
grep -c 'localhost:5175' apps/api/.env
```

Expected: `3`, then at least `2` (`TRUSTED_ORIGINS` already lists 5175). At 2a's HEAD `PAYMENTS_PROVIDER=stripe`, a `sk_test_` key and a `whsec_` secret are already set; the script only adds `APP_WEB_ORIGIN` / `PAYOUTS_REFRESH_AFTER_MINUTES` and rewrites the webhook secret with the CLI's stable one. `apps/worker/.env` and `packages/db/.env` are symlinks to `apps/api/.env`. Don't touch any `CREDIBLED_*` line.

- [ ] **Step 3: Start the stack from this worktree**

Run: `docker inspect api --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null || echo none`
- If it prints another worktree's path: stop and ask the user before taking that stack down.
- Otherwise: `mkdir -p bun_node_modules && docker compose up -d && docker restart api` (the api container misses host edits, and must re-read `.env`).

Then stop the worker (it places Credibled orders; 2b needs no worker job) and record the order count:

```bash
docker stop worker
docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from app_db.check_orders"'
```

Note the number; Step 10 checks it is unchanged.

Run: `docker logs migrations 2>&1 | tail -5`
Expected: migrations applied without error.

Run: `docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d app_db.payout_accounts"'`
Expected: the table with `user_id` PK, `payout_accounts_account_reference_uidx`, and FK `payout_accounts_user_id_user_id_fk … ON DELETE RESTRICT`.

Run: `curl -s localhost:3000/api/v1/health`
Expected: `Up!` (`API_BASE_PATH` is `/api/v1`; the webhook stays at `/webhooks/stripe`, outside it).

- [ ] **Step 4: Forward webhooks (platform and Connect)**

Start in the background (Bash `run_in_background: true`), from the worktree root:

```bash
STRIPE_KEY=$(grep -E '^STRIPE_SECRET_KEY=' apps/api/.env | cut -d= -f2- | tr -d '"'); stripe listen --api-key "$STRIPE_KEY" --forward-to localhost:3000/webhooks/stripe --forward-connect-to localhost:3000/webhooks/stripe
```

Expected in its output: `Ready! … Your webhook signing secret is whsec_…` (the same secret Step 2 stored — `--print-secret` returns the CLI's stable secret). Don't copy the secret into chat or notes.

- [ ] **Step 5: Web on port 5175**

`/run/media/hbt/work/poppynz/.claude/launch.json` already has 2a's entry for this worktree:

```json
    {
      "name": "web-stripe",
      "runtimeExecutable": "bun",
      "runtimeArgs": ["run", "--cwd", "stripe-integration/apps/web", "dev", "--port", "5175", "--strictPort"],
      "port": 5175,
      "autoPort": false
    }
```

Make sure no other 5175 entry is running (`web-develop`, `web-contract-dates`, `web-sidenav` share the port), then start `web-stripe` with the preview tool and open `http://localhost:5175`.

- [ ] **Step 6: Scenario A — create an account through the app and reach Stripe's page**

1. Sign up helper A (`e2e-payouts-a@example.com`, role Mom Helper) through the magic-link flow; the link is in `docker logs api 2>&1 | grep -o 'http[^ ]*magic-link[^ ]*' | tail -1` (dev mail log-mode).
2. Screenshot: the sidebar shows **Payouts** with the `!` badge; `/service-provider/payouts` shows "Set up payouts".
3. Click **Set up payouts**. Expected: the browser lands on a `connect.stripe.com` onboarding page. Screenshot it. **Do not fill anything.** Navigate back.
4. DB check: `docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select status, provider, left(account_reference,5) as ref, refreshed_at from app_db.payout_accounts"'` → one row, `onboarding`, `stripe`, `acct_`.
5. Open `http://localhost:5175/service-provider/payouts?refresh=1` → redirected to a fresh Stripe onboarding page (expired-link path). Screenshot, go back.
6. Open `http://localhost:5175/service-provider/payouts?from=stripe` → the query is dropped, the page shows "Your setup isn't finished" + **Continue setup**; `refreshed_at` in the DB is now recent.

- [ ] **Step 7: Scenario B — a test account completed through the API, webhook to Ready**

1. Sign up helper B (`e2e-payouts-b@example.com`, Mom Helper). Get the id: `docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select id from app_db.\"user\" where email = '"'"'e2e-payouts-b@example.com'"'"'"'`.
2. `bun --env-file=apps/api/.env packages/payments/scripts/e2e-payout-account.ts create-ready`
   Expected: JSON with `"details_submitted":true,"payouts_enabled":true,"transfers":"active"`. If Stripe rejects the creation because `transfers` needs `card_payments` for this account, re-run with `--with-card-payments`. If after a minute any flag is still false (exit code 2), stop and report the printed `currently_due` / `disabled_reason` — do not weaken the readiness rule.
   The `stripe listen` output shows `account.updated` events for the new account answered `[200]` — the unknown-account path (no row yet).
3. Link it to helper B: `docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "insert into app_db.payout_accounts (user_id, provider, account_reference) values ('"'"'<B id>'"'"', '"'"'stripe'"'"', '"'"'<acct id>'"'"')"'`
4. `bun --env-file=apps/api/.env packages/payments/scripts/e2e-payout-account.ts touch <acct id>`
   Expected: `stripe listen` shows `account.updated` → `[200]`; the row now has `status = ready`, `details_submitted/payouts_enabled/transfers_active = t`, `refreshed_at` recent; `app_db.stripe_webhook_events` has the event with `processed_at` set.
5. As helper B, open `/service-provider/payouts`: **Ready to be paid**, and no badge on Payouts. Screenshot.
6. **View payouts in Stripe**: a Custom account has no Express dashboard, so expect the `PAYOUTS_PROVIDER_ERROR` toast ("Stripe couldn't be reached…") and an `accounts.createLoginLink` error in `docker logs api`. This confirms the error path; the dashboard link itself is verified in Step 9.

- [ ] **Step 8: Refresh rule**

1. `docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update app_db.payout_accounts set refreshed_at = now() - interval '"'"'2 hours'"'"', status = '"'"'onboarding'"'"' where account_reference = '"'"'<acct id>'"'"'"'`
2. Reload `/service-provider/payouts` as helper B → back to **Ready to be paid**; `refreshed_at` is recent again (the stale snapshot was re-fetched on read).
3. Set `refreshed_at = now() - interval '10 minutes'` with `status = 'onboarding'`, reload → still "Your setup isn't finished" (fresh snapshot, no re-fetch). Restore with `touch`.

- [ ] **Step 9: Optional, by the user — hosted onboarding and the dashboard link**

Ask the user whether they want to complete Stripe's hosted onboarding once for helper A (Stripe's test-mode pages offer test data; the agent must not fill them). If they do: after they return to `/service-provider/payouts?from=stripe`, verify **Ready to be paid**, then click **View payouts in Stripe** → the Express dashboard opens. Screenshot.

- [ ] **Step 10: Report and tidy**

- Stop `stripe listen` (TaskStop on the background command).
- Re-run the `check_orders` count from Step 3: it must equal the number noted there. If it changed, say so first in the report.
- `docker start worker`.
- Leave `apps/api/.env` as configured (it is gitignored) and say so in the report, including `PAYMENTS_PROVIDER=stripe` and that the real Credibled key is still in it.
- `git status --short` → clean (launch.json was not changed).
- Report each scenario with pass/fail and the screenshots. The Custom test account(s) remain in the Stripe test account; mention their ids so the user can delete them from the dashboard if they want.

---

## Self-review notes

- Spec coverage: §1 port + mock (Tasks 1–2); §2 table, derivation, repo (Tasks 3–4); §3 permission, `GET /payouts` with the 1-hour rule, onboarding/refresh/dashboard with 409, `APP_WEB_ORIGIN`, webhook `account.updated` with unknown accounts → 200, `isPaymentReady`, contract `payoutsReady` (Tasks 4–7); §4 page states, return handling, badge, reminder (Tasks 8–10); §5 unit, web mount and local e2e (each task, Task 12).
- Names used across tasks: `PayoutAccountSnapshot`, `PayoutAccountRepo.{findByUserId,findByReference,create,applySnapshot}`, `makePayoutAccountRepoTest`, `makeInMemoryPayoutAccountRepo`, `dummyPayoutAccount`, `AppliedPayoutSnapshot`, `readySnapshot`, `StripeConnectClient`, `makeStripeConnectOperations`, `constructEventWithAnySecret`, `connectWebhookSecret`, `derivePayoutStatus`, `isPaymentReady`, `hasReadyPayoutAccount`, `handleAccountUpdated`, `PayoutsRepoError`, `PayoutsProviderError`, `NoPayoutAccountError`, `payoutsBadge.needsSetup`, `payoutsReady`.
- Reconciled with 2a at `b67bb83`: port/mock live in `src/port.ts` / `src/mock.ts` (not `index.ts`); `PaymentOperation` is a named union; the Stripe client is `StripeApi` and is called `client` inside `makeStripePayments`; webhook verification is async (`constructEventAsync`), so the multi-secret helper is async; `PaymentWebhookEvent` already carries `account`; the webhook dispatcher is `processStripeEvent` (a string-returning switch with an `account.updated` placeholder) and its test harness is `makeWorld`; repos follow `billing-customer-repo.ts` (in-memory repo + `dummy*` in `@repo/db`); payout rows are provider-scoped like 2a's billing customers.
