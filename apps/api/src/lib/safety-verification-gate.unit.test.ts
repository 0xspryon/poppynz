import { SqlError } from '@effect/sql/SqlError';
import { makeSafetyVerificationRepoTest, type SafetyVerification, type User } from '@repo/db';
import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { UserAndSession } from './effect-auth';
import { requireVerifiedSafety } from './safety-verification-gate';

const userAndSession = (role: string | null): UserAndSession =>
  ({ user: { id: 'user-1', role }, session: { id: 'session-1' } }) as unknown as UserAndSession;

const repo = (live: Partial<SafetyVerification> | null, fail = false) =>
  makeSafetyVerificationRepoTest({
    findLive: () =>
      fail
        ? Effect.fail(new SqlError({ cause: 'connection lost' }))
        : Effect.succeed(live as SafetyVerification | null),
    findById: () => Effect.die('unused'),
    findByCredibledUuid: () => Effect.succeed(null),
    listByUser: () => Effect.succeed([]),
    listForReview: () => Effect.succeed([]),
    create: () => Effect.die('unused'),
    update: () => Effect.die('unused'),
    listExpiringForNotification: () => Effect.succeed([]),
    markExpiryNotified: () => Effect.die('unused'),
    listLapsed: () => Effect.succeed([]),
    listInFlight: () => Effect.succeed([]),
    listAwaitingOrder: () => Effect.succeed([])
  });

const run = (role: string | null, live: Partial<SafetyVerification> | null, fail = false) =>
  Effect.runPromiseExit(requireVerifiedSafety(userAndSession(role)).pipe(Effect.provide(repo(live, fail))));

const tagOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  return Option.isSome(failure) ? (failure.value as { _tag: string })._tag : 'DEFECT';
};

const verified = { status: 'verified', expiresOn: '2099-01-01' };

describe('the safety verification gate', () => {
  it('lets a verified helper through', async () => {
    expect(Exit.isSuccess(await run('service-provider', verified))).toBe(true);
  });

  it('lets a verified family through', async () => {
    // The whole point of this work: families were never gated before.
    expect(Exit.isSuccess(await run('family', verified))).toBe(true);
  });

  it('blocks a family with no verification at all', async () => {
    expect(tagOf(await run('family', null))).toBe('SafetyVerificationRequiredError');
  });

  it('blocks a helper with no verification at all', async () => {
    expect(tagOf(await run('service-provider', null))).toBe('SafetyVerificationRequiredError');
  });

  it('blocks a submitted-but-unreviewed document', async () => {
    expect(
      tagOf(await run('family', { status: 'review_required', expiresOn: '2099-01-01' }))
    ).toBe('SafetyVerificationRequiredError');
  });

  it('blocks a lapsed verification without waiting for the nightly sweep', async () => {
    // Stored status is still `verified`; only the date has passed.
    expect(tagOf(await run('family', { status: 'verified', expiresOn: '2020-01-01' }))).toBe(
      'SafetyVerificationRequiredError'
    );
  });

  it('blocks a verified record with no expiry date recorded', async () => {
    expect(tagOf(await run('family', { status: 'verified', expiresOn: null }))).toBe(
      'SafetyVerificationRequiredError'
    );
  });

  it('fails CLOSED when the lookup itself fails', async () => {
    // A database error must never open a safety gate.
    expect(tagOf(await run('family', null, true))).toBe('SafetyVerificationGateUnavailableError');
  });

  it('does not screen admins', async () => {
    expect(Exit.isSuccess(await run('admin', null))).toBe(true);
  });
});
