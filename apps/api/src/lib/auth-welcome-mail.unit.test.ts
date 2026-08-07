import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { sendWelcomeMailEffect } from './auth';
import { MailerError, makeMailerTest } from './mailer';
import { trustedUiOrigins } from './ui-origin';

const makeRecorder = (options: { fail?: boolean } = {}) => {
  const sentMails: Array<{ kind: string; mail: unknown }> = [];
  const layer = makeMailerTest({
    sendFamilyWelcome: (mail) => {
      sentMails.push({ kind: 'family', mail });
      return options.fail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
    },
    sendProviderWelcome: (mail) => {
      sentMails.push({ kind: 'provider', mail });
      return options.fail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
    }
  });
  return { sentMails, layer };
};

const link = (path: string) => new URL(path, trustedUiOrigins[0]).toString();

describe('sendWelcomeMailEffect', () => {
  it('sends the family next-steps mail to new family accounts', async () => {
    const { sentMails, layer } = makeRecorder();

    await Effect.runPromise(
      sendWelcomeMailEffect({ email: 'family@example.com', name: 'Fiona', role: 'family' }).pipe(
        Effect.provide(layer)
      )
    );

    expect(sentMails).toEqual([
      {
        kind: 'family',
        mail: {
          email: 'family@example.com',
          name: 'Fiona',
          profileLink: link('/family/profile'),
          needsLink: link('/family/needs'),
          findLink: link('/family/find')
        }
      }
    ]);
  });

  it('sends the provider next-steps mail to new service-provider accounts', async () => {
    const { sentMails, layer } = makeRecorder();

    await Effect.runPromise(
      sendWelcomeMailEffect({
        email: 'provider@example.com',
        name: null,
        role: 'service-provider'
      }).pipe(Effect.provide(layer))
    );

    expect(sentMails).toEqual([
      {
        kind: 'provider',
        mail: {
          email: 'provider@example.com',
          name: null,
          profileLink: link('/service-provider/profile'),
          documentsLink: link('/service-provider/documents'),
          servicesLink: link('/service-provider/services'),
          approvalLink: link('/service-provider/approval'),
          findLink: link('/service-provider/find')
        }
      }
    ]);
  });

  it('rebases links onto a trusted calling origin', async () => {
    const { sentMails, layer } = makeRecorder();
    const origin = trustedUiOrigins[trustedUiOrigins.length - 1];

    await Effect.runPromise(
      sendWelcomeMailEffect(
        { email: 'family@example.com', name: null, role: 'family' },
        new Headers({ origin })
      ).pipe(Effect.provide(layer))
    );

    expect(sentMails[0]?.mail).toMatchObject({
      profileLink: new URL('/family/profile', origin).toString()
    });
  });

  it('treats an empty name as null', async () => {
    const { sentMails, layer } = makeRecorder();

    await Effect.runPromise(
      sendWelcomeMailEffect({ email: 'family@example.com', name: '', role: 'family' }).pipe(
        Effect.provide(layer)
      )
    );

    expect(sentMails[0]?.mail).toMatchObject({ name: null });
  });

  it('sends nothing for admin or unknown roles', async () => {
    const { sentMails, layer } = makeRecorder();

    await Effect.runPromise(
      Effect.all([
        sendWelcomeMailEffect({ email: 'admin@example.com', role: 'admin' }).pipe(
          Effect.provide(layer)
        ),
        sendWelcomeMailEffect({ email: 'nobody@example.com', role: null }).pipe(
          Effect.provide(layer)
        ),
        sendWelcomeMailEffect({ email: 'nobody@example.com' }).pipe(Effect.provide(layer))
      ])
    );

    expect(sentMails).toEqual([]);
  });

  it('does not fail account creation when the mail send fails', async () => {
    const { layer } = makeRecorder({ fail: true });

    await expect(
      Effect.runPromise(
        sendWelcomeMailEffect({ email: 'family@example.com', role: 'family' }).pipe(
          Effect.provide(layer)
        )
      )
    ).resolves.toBeUndefined();
  });
});
