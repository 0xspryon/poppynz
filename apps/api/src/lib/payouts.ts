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

/** Re-fetch from the provider and store. Never trusts a webhook body. A
 * compare-and-set on the reference it was fetched for: if the account on
 * file changed (or vanished) under us — `applySnapshot` returns null — we
 * no-op back to the stored row instead of failing. */
export const refreshPayoutAccount = (account: PayoutAccount) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* PayoutAccountRepo;
    const snapshot = yield* payments
      .getPayoutAccount(account.accountReference)
      .pipe((errors) => mapPayoutsProviderError(errors));
    const updated = yield* repo
      .applySnapshot(account.userId, account.accountReference, toSnapshotInput(snapshot, new Date()))
      .pipe((errors) => mapPayoutsRepoError(errors));
    return updated ?? account;
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
