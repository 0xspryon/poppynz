import {
  DBNotFoundError,
  EmptySafetyVerificationRepoTest,
  FamilySearchOutboxRepo,
  makeSafetyVerificationRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  SafetyVerificationRepo,
  type SafetyVerification,
  type User
} from '@repo/db';
import { makeMailerTest, MailerError, type SafetyVerificationExpiringMail } from '@repo/mail';
import { FamilySearchQueue } from '@repo/queue';
import { Context, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { processSafetyVerificationExpiries } from './safety-verification-expiry-processor';

const now = new Date('2026-07-24T02:00:00.000Z');
const uiOrigin = 'https://app.poppynz.com';

const record = (overrides: Partial<SafetyVerification> = {}): SafetyVerification =>
  ({
    id: 'sv-1',
    userId: 'provider-1',
    role: 'service-provider',
    status: 'verified',
    expiresOn: '2026-08-03',
    ...overrides
  }) as SafetyVerification;

const emptyRepo = Effect.runSync(
  SafetyVerificationRepo.pipe(Effect.provide(EmptySafetyVerificationRepoTest))
);

const run = (
  expiring: Array<SafetyVerification>,
  options: { languages?: Record<string, string>; failMail?: boolean } = {}
) => {
  const sent: Array<SafetyVerificationExpiringMail> = [];
  const notified: Array<string> = [];
  const layer = Layer.mergeAll(
    makeSafetyVerificationRepoTest({
      ...(emptyRepo as Context.Tag.Service<SafetyVerificationRepo>),
      listExpiringForNotification: () => Effect.succeed(expiring),
      markExpiryNotified: (id) => {
        notified.push(id);
        return Effect.succeed(record({ id }));
      }
    }),
    makeUserRepoTest({
      findById: (id) =>
        Effect.succeed({ id, email: `${id}@example.com`, name: 'Pat' } as unknown as User),
      findByEmail: () => Effect.die('unused')
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('unused'),
      findByUserId: (userId) =>
        options.languages && userId in options.languages
          ? Effect.succeed({ userId, language: options.languages[userId] } as never)
          : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
      updateByUserId: () => Effect.die('unused'),
      updateLocationByUserId: () => Effect.die('unused')
    }),
    makeMailerTest({
      sendSafetyVerificationExpiring: (mail) => {
        sent.push(mail);
        return options.failMail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
      }
    }),
    // Nothing lapses in these cases, so the family re-index is never reached.
    Layer.succeed(FamilySearchOutboxRepo, {} as Context.Tag.Service<FamilySearchOutboxRepo>),
    Layer.succeed(FamilySearchQueue, {} as Context.Tag.Service<FamilySearchQueue>)
  );
  return Effect.runPromise(
    processSafetyVerificationExpiries(now, uiOrigin).pipe(Effect.provide(layer))
  ).then((summary) => ({ summary, sent, notified }));
};

describe('processSafetyVerificationExpiries reminders', () => {
  it('reminds an expiring applicant in English by default and stamps the record', async () => {
    const { summary, sent, notified } = await run([record()]);

    expect(summary).toMatchObject({ candidates: 1, notified: 1, failed: 0 });
    expect(sent).toEqual([
      {
        email: 'provider-1@example.com',
        name: 'Pat',
        role: 'service-provider',
        expiresOn: '2026-08-03',
        daysRemaining: 10,
        link: `${uiOrigin}/service-provider/verification`,
        locale: 'en'
      }
    ]);
    expect(notified).toEqual(['sv-1']);
  });

  it("writes the reminder in the applicant's profile language", async () => {
    const { sent } = await run(
      [record(), record({ id: 'sv-2', userId: 'family-1', role: 'family' })],
      { languages: { 'family-1': 'fr' } }
    );

    expect(sent.map((mail) => [mail.email, mail.locale])).toEqual([
      ['provider-1@example.com', 'en'],
      ['family-1@example.com', 'fr']
    ]);
  });

  it('leaves a failed send unstamped so the next sweep retries', async () => {
    const { summary, notified } = await run([record()], { failMail: true });

    expect(summary).toMatchObject({ notified: 0, failed: 1 });
    expect(notified).toEqual([]);
  });
});
