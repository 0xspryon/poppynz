import { DBNotFoundError, makeUserProfileRepoTest } from '@repo/db';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { notifyBanStatusChangeEffect } from './auth';
import { MailerError, makeMailerTest } from './mailer';
import { trustedUiOrigins } from './ui-origin';

const bannedUser = {
  id: 'provider-1',
  email: 'provider@example.com',
  name: 'Provider User',
  banReason: 'Repeated no-shows'
};

/** Profile languages by user id; a missing entry is a failed lookup. */
const profilesLayer = (languages: Record<string, string>) =>
  makeUserProfileRepoTest({
    create: () => Effect.die('unused'),
    findByUserId: (userId) =>
      userId in languages
        ? Effect.succeed({ userId, language: languages[userId] } as never)
        : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
    updateByUserId: () => Effect.die('unused'),
    updateLocationByUserId: () => Effect.die('unused')
  });

const makeRecorder = (options: { fail?: boolean; languages?: Record<string, string> } = {}) => {
  const sentMails: Array<{ kind: string; mail: unknown }> = [];
  const mailerLayer = makeMailerTest({
    sendAccountBanned: (mail) => {
      sentMails.push({ kind: 'banned', mail });
      return options.fail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
    },
    sendAccountUnbanned: (mail) => {
      sentMails.push({ kind: 'unbanned', mail });
      return options.fail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
    }
  });
  const layer = Layer.merge(mailerLayer, profilesLayer(options.languages ?? {}));
  return { sentMails, layer };
};

describe('notifyBanStatusChangeEffect', () => {
  it('sends a banned mail with the reason for the ban endpoint', async () => {
    const { sentMails, layer } = makeRecorder();

    await Effect.runPromise(
      notifyBanStatusChangeEffect(bannedUser, '/admin/ban-user').pipe(Effect.provide(layer))
    );

    expect(sentMails).toEqual([
      {
        kind: 'banned',
        mail: {
          email: 'provider@example.com',
          name: 'Provider User',
          reason: 'Repeated no-shows',
          locale: 'en'
        }
      }
    ]);
  });

  it('sends an unbanned mail with a sign-in link for the unban endpoint', async () => {
    const { sentMails, layer } = makeRecorder();

    await Effect.runPromise(
      notifyBanStatusChangeEffect(
        { id: 'provider-1', email: 'provider@example.com', name: 'Provider User' },
        '/admin/unban-user'
      ).pipe(Effect.provide(layer))
    );

    expect(sentMails).toEqual([
      {
        kind: 'unbanned',
        mail: {
          email: 'provider@example.com',
          name: 'Provider User',
          link: new URL('/auth/sign-in', trustedUiOrigins[0]).toString(),
          locale: 'en'
        }
      }
    ]);
  });

  it('sends nothing for other user updates, including the banExpires auto-unban', async () => {
    const { sentMails, layer } = makeRecorder();

    await Effect.runPromise(
      Effect.all([
        notifyBanStatusChangeEffect(bannedUser, '/get-session').pipe(Effect.provide(layer)),
        notifyBanStatusChangeEffect(bannedUser, undefined).pipe(Effect.provide(layer))
      ])
    );

    expect(sentMails).toEqual([]);
  });

  it('does not fail the hook when the mail send fails', async () => {
    const { layer } = makeRecorder({ fail: true });

    await expect(
      Effect.runPromise(
        notifyBanStatusChangeEffect(bannedUser, '/admin/ban-user').pipe(Effect.provide(layer))
      )
    ).resolves.toBeUndefined();
  });

  it("writes the mail in the user's profile language, not the admin's", async () => {
    const { sentMails, layer } = makeRecorder({ languages: { 'provider-1': 'fr' } });

    await Effect.runPromise(
      notifyBanStatusChangeEffect(
        bannedUser,
        '/admin/ban-user',
        new Headers({ cookie: 'PARAGLIDE_LOCALE=en' })
      ).pipe(Effect.provide(layer))
    );

    expect(sentMails[0]?.mail).toMatchObject({ locale: 'fr' });
  });
});
