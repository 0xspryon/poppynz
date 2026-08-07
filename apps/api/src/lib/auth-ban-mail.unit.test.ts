import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { notifyBanStatusChangeEffect } from './auth';
import { MailerError, makeMailerTest } from './mailer';
import { trustedUiOrigins } from './ui-origin';

const bannedUser = {
  email: 'provider@example.com',
  name: 'Provider User',
  banReason: 'Repeated no-shows'
};

const makeRecorder = (options: { fail?: boolean } = {}) => {
  const sentMails: Array<{ kind: string; mail: unknown }> = [];
  const layer = makeMailerTest({
    sendAccountBanned: (mail) => {
      sentMails.push({ kind: 'banned', mail });
      return options.fail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
    },
    sendAccountUnbanned: (mail) => {
      sentMails.push({ kind: 'unbanned', mail });
      return options.fail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
    }
  });
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
        mail: { email: 'provider@example.com', name: 'Provider User', reason: 'Repeated no-shows' }
      }
    ]);
  });

  it('sends an unbanned mail with a sign-in link for the unban endpoint', async () => {
    const { sentMails, layer } = makeRecorder();

    await Effect.runPromise(
      notifyBanStatusChangeEffect(
        { email: 'provider@example.com', name: 'Provider User' },
        '/admin/unban-user'
      ).pipe(Effect.provide(layer))
    );

    expect(sentMails).toEqual([
      {
        kind: 'unbanned',
        mail: {
          email: 'provider@example.com',
          name: 'Provider User',
          link: new URL('/auth/sign-in', trustedUiOrigins[0]).toString()
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
});
