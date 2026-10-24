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
 * Helper payout accounts (piece 2b), shared by the API (routes, webhook) and
 * the worker (contract billing's readiness checks). Stripe owns the truth; Poppynz keeps the
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

/** A provider error's `cause` is `unknown` (whatever the SDK throws). Pull out
 * only a message and, if present, a type — never the full object, which may
 * carry request/response internals. */
const describeProviderErrorCause = (cause: unknown): { message: string; type?: string } => {
  if (cause && typeof cause === 'object') {
    const record = cause as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : String(cause);
    const type = typeof record.type === 'string' ? record.type : undefined;
    return type ? { message, type } : { message };
  }
  return { message: String(cause) };
};

/** The one choke point every payouts provider call goes through, so every
 * `/payouts/*` route logs a failure here instead of answering 502 silently
 * (piece 2b e2e bug B1). */
export const mapPayoutsProviderError = <A, R>(
  effect: Effect.Effect<A, PaymentProviderError, R>
): Effect.Effect<A, PayoutsProviderError, R> =>
  effect.pipe(
    Effect.tapError((error) =>
      Effect.logError(
        `payouts: Stripe ${error.operation} failed`,
        describeProviderErrorCause(error.cause)
      )
    ),
    Effect.mapError((cause) => new PayoutsProviderError({ cause }))
  );

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
    const account = yield* repo.findByUserId(userId).pipe((errors) => mapPayoutsRepoError(errors));
    return account !== null && account.provider === payments.provider ? account : null;
  });

/** Re-fetch from the provider and store. Never trusts a webhook body. The
 * write is a compare-and-set on the reference it was fetched for AND on the
 * fetch time (taken before the call): `applySnapshot` returns null when the
 * account on file changed or vanished under us, or when a snapshot fetched
 * later already landed. Then we return what is on file now (the newer
 * snapshot), falling back to the row we were given — never an error. */
export const refreshPayoutAccount = (account: PayoutAccount) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* PayoutAccountRepo;
    const fetchedAt = new Date();
    const snapshot = yield* payments
      .getPayoutAccount(account.accountReference)
      .pipe((errors) => mapPayoutsProviderError(errors));
    const updated = yield* repo
      .applySnapshot(account.userId, account.accountReference, toSnapshotInput(snapshot, fetchedAt))
      .pipe((errors) => mapPayoutsRepoError(errors));
    if (updated) return updated;
    return (yield* loadPayoutAccount(account.userId)) ?? account;
  });

/** The stored account, re-fetched first when older than the refresh window.
 * A provider failure keeps (and returns) the stored state — fine for showing
 * the helper their page, never for deciding to move money. */
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

/** What contract billing may conclude about a helper's payout account:
 *  - `ready`: a snapshot inside the refresh window says ready;
 *  - `not_ready`: the account is missing, or a confirmed (fresh) snapshot
 *    says it is not ready;
 *  - `unknown`: nothing fresh could be had — the refresh failed, or left
 *    only stale data on file. Never a reason to move OR to release money:
 *    the caller retries on its next tick. */
export type PaymentReadiness = 'ready' | 'not_ready' | 'unknown';

export const paymentReadiness = (
  userId: string
): Effect.Effect<PaymentReadiness, never, Payments | PayoutAccountRepo> =>
  Effect.gen(function* () {
    const stored = yield* loadPayoutAccount(userId);
    if (!stored) return 'not_ready' as const;
    const { refreshAfterMinutes } = yield* payoutsPolicy;
    const account = isStale(stored, new Date(), refreshAfterMinutes)
      ? yield* refreshPayoutAccount(stored)
      : stored;
    if (isStale(account, new Date(), refreshAfterMinutes)) return 'unknown' as const;
    return account.status === 'ready' ? ('ready' as const) : ('not_ready' as const);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(`payout readiness of ${userId} unknown; retrying later`, error).pipe(
        Effect.as('unknown' as const)
      )
    )
  );

/** For pieces 3 and 4 (cycle start, transfers). Strict: true only when a
 * snapshot inside the refresh window says `ready`. A stale row is re-fetched
 * with NO stored fallback, and any failure — or a refresh that still leaves
 * only stale data on file — answers false: money never moves on an
 * unconfirmed status. Contract billing uses `paymentReadiness`, which tells
 * "not ready" apart from "could not tell". */
export const isPaymentReady = (
  userId: string
): Effect.Effect<boolean, never, Payments | PayoutAccountRepo> =>
  paymentReadiness(userId).pipe(Effect.map((readiness) => readiness === 'ready'));

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
