import { mailConfig, type AppEnvironment } from '@repo/env';
import { Context, Data, Effect, Layer, Option } from 'effect';
import type { MailRole } from './templates';
import {
  accountBannedMail,
  accountUnbannedMail,
  adminApprovalRequestSubmittedMail,
  approvalExpiringMail,
  safetyVerificationExpiringMail,
  safetyVerificationInviteMail,
  approvalGrantedMail,
  approvalRequestRejectedMail,
  approvalRequestSubmittedMail,
  approvalRevokedMail,
  familyWelcomeMail,
  magicLinkMail,
  type MailContent,
  providerWelcomeMail,
  referralInviteMail
} from './templates';

export class MailerError extends Data.TaggedError('MailerError')<{
  cause: unknown;
}> { }

export type MagicLinkMail = {
  email: string;
  link: string;
};

export type ReferralInviteMail = {
  email: string;
  /** Display name the invite is attributed to ("from Poppynz with your name on it"). */
  inviterName: string;
  role: MailRole;
  link: string;
};

export type ApprovalRequestSubmittedMail = {
  email: string;
  name: string | null;
};

/** Recipients come from ADMIN_NOTIFICATION_EMAILS, not from the payload. */
export type AdminApprovalRequestSubmittedMail = {
  providerName: string | null;
  providerEmail: string;
};

export type ApprovalRequestRejectedMail = {
  email: string;
  name: string | null;
  reason: string;
};

export type ApprovalGrantedMail = {
  email: string;
  name: string | null;
  expiresAt: Date;
};

export type ApprovalRevokedMail = {
  email: string;
  name: string | null;
  reason: string;
};

export type ApprovalExpiringMail = {
  email: string;
  name: string | null;
  expiresAt: Date;
  daysRemaining: number;
  link: string;
};

export type SafetyVerificationInviteMail = {
  email: string;
  name: string | null;
  link: string;
};

export type SafetyVerificationExpiringMail = {
  email: string;
  name: string | null;
  role: 'family' | 'service-provider';
  expiresOn: string;
  daysRemaining: number;
  link: string;
};

export type FamilyWelcomeMail = {
  email: string;
  name: string | null;
  profileLink: string;
  needsLink: string;
  findLink: string;
};

export type ProviderWelcomeMail = {
  email: string;
  name: string | null;
  profileLink: string;
  documentsLink: string;
  servicesLink: string;
  approvalLink: string;
  findLink: string;
};

export type AccountBannedMail = {
  email: string;
  name: string | null;
  reason: string | null;
};

export type AccountUnbannedMail = {
  email: string;
  name: string | null;
  link: string;
};

export class Mailer extends Context.Tag('@api/lib/Mailer')<
  Mailer,
  {
    sendMagicLink: (mail: MagicLinkMail) => Effect.Effect<void, MailerError>;
    sendFamilyWelcome: (mail: FamilyWelcomeMail) => Effect.Effect<void, MailerError>;
    sendProviderWelcome: (mail: ProviderWelcomeMail) => Effect.Effect<void, MailerError>;
    sendReferralInvite: (mail: ReferralInviteMail) => Effect.Effect<void, MailerError>;
    sendApprovalRequestSubmitted: (
      mail: ApprovalRequestSubmittedMail
    ) => Effect.Effect<void, MailerError>;
    sendAdminApprovalRequestSubmitted: (
      mail: AdminApprovalRequestSubmittedMail
    ) => Effect.Effect<void, MailerError>;
    sendApprovalRequestRejected: (
      mail: ApprovalRequestRejectedMail
    ) => Effect.Effect<void, MailerError>;
    sendApprovalGranted: (mail: ApprovalGrantedMail) => Effect.Effect<void, MailerError>;
    sendApprovalRevoked: (mail: ApprovalRevokedMail) => Effect.Effect<void, MailerError>;
    sendApprovalExpiring: (mail: ApprovalExpiringMail) => Effect.Effect<void, MailerError>;
    sendSafetyVerificationInvite: (
      mail: SafetyVerificationInviteMail
    ) => Effect.Effect<void, MailerError>;
    sendSafetyVerificationExpiring: (
      mail: SafetyVerificationExpiringMail
    ) => Effect.Effect<void, MailerError>;
    sendAccountBanned: (mail: AccountBannedMail) => Effect.Effect<void, MailerError>;
    sendAccountUnbanned: (mail: AccountUnbannedMail) => Effect.Effect<void, MailerError>;
  }
>() { }

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

const makeResendDeliver =
  (options: { apiKey: string; from: string }) =>
    (to: ReadonlyArray<string>, content: MailContent): Effect.Effect<void, MailerError> =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(RESEND_EMAILS_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: options.from,
              to,
              subject: content.subject,
              html: content.html,
              text: content.text
            })
          });
          if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Resend responded ${response.status}: ${body}`);
          }
        },
        catch: (cause) => new MailerError({ cause })
      });

/** Dev log-mode delivery. The magic-link line keeps its exact historical
 * format — the local sign-in recipe reads the link out of the api logs. */
const makeLogDeliver =
  () =>
    (to: ReadonlyArray<string>, content: MailContent): Effect.Effect<void, MailerError> =>
      Effect.sync(() => {
        console.log(`[mail] to ${to.join(', ')}: ${content.subject}\n${content.text}`);
      });

export const makeMailer = (config: {
  resendApiKey: Option.Option<string>;
  from: string;
  adminNotificationEmails: ReadonlyArray<string>;
  environment: AppEnvironment;
  adminAccounts: ReadonlyArray<string>;
}): Context.Tag.Service<Mailer> => {
  const logMode = Option.isNone(config.resendApiKey);
  const logDeliver = makeLogDeliver();
  const send = Option.match(config.resendApiKey, {
    onNone: () => logDeliver,
    onSome: (apiKey) => makeResendDeliver({ apiKey, from: config.from })
  });
  const adminAccounts = new Set(config.adminAccounts.map((email) => email.trim().toLowerCase()));

  // Production mails everyone; staging and dev only @poppynz.com addresses
  // and the admin accounts, so test users can never receive real mail.
  const isAllowed = (recipient: string) => {
    if (config.environment === 'production' || config.environment === 'staging') {
      return true;
    }

    const email = recipient.trim().toLowerCase();
    return email.endsWith('@poppynz.com') || adminAccounts.has(email);
  };

  const deliver = (
    to: ReadonlyArray<string>,
    content: MailContent
  ): Effect.Effect<void, MailerError> => {
    if (logMode) {
      return logDeliver(to, content);
    }

    const allowed = to.filter(isAllowed);
    const suppressed = to.filter((recipient) => !isAllowed(recipient));
    return Effect.all(
      [
        config.environment === 'dev' ? logDeliver(to, content) : Effect.void,
        suppressed.length === 0
          ? Effect.void
          : Effect.sync(() => {
            console.log(
              `[mail] suppressed (${config.environment}) to ${suppressed.join(', ')}: ${content.subject}`
            );
          }),
        allowed.length === 0 ? Effect.void : send(allowed, content)
      ],
      { discard: true }
    );
  };

  return {
    sendMagicLink: (mail) => {
      const logLine = Effect.sync(() => {
        console.log(`Magic link for ${mail.email}: ${mail.link}`);
      });
      if (logMode) {
        return logLine;
      }

      // Dev keeps the historical log line even when a key is set — the local
      // sign-in recipe reads the link out of the api logs.
      return config.environment === 'dev'
        ? logLine.pipe(Effect.zipRight(deliver([mail.email], magicLinkMail(mail))))
        : deliver([mail.email], magicLinkMail(mail));
    },
    sendFamilyWelcome: (mail) => deliver([mail.email], familyWelcomeMail(mail)),
    sendProviderWelcome: (mail) => deliver([mail.email], providerWelcomeMail(mail)),
    sendReferralInvite: (mail) => deliver([mail.email], referralInviteMail(mail)),
    sendApprovalRequestSubmitted: (mail) =>
      deliver([mail.email], approvalRequestSubmittedMail(mail)),
    sendAdminApprovalRequestSubmitted: (mail) =>
      config.adminNotificationEmails.length === 0
        ? Effect.void
        : deliver(config.adminNotificationEmails, adminApprovalRequestSubmittedMail(mail)),
    sendApprovalRequestRejected: (mail) => deliver([mail.email], approvalRequestRejectedMail(mail)),
    sendApprovalGranted: (mail) => deliver([mail.email], approvalGrantedMail(mail)),
    sendApprovalRevoked: (mail) => deliver([mail.email], approvalRevokedMail(mail)),
    sendApprovalExpiring: (mail) => deliver([mail.email], approvalExpiringMail(mail)),
    sendSafetyVerificationInvite: (mail) =>
      deliver([mail.email], safetyVerificationInviteMail(mail)),
    sendSafetyVerificationExpiring: (mail) =>
      deliver([mail.email], safetyVerificationExpiringMail(mail)),
    sendAccountBanned: (mail) => deliver([mail.email], accountBannedMail(mail)),
    sendAccountUnbanned: (mail) => deliver([mail.email], accountUnbannedMail(mail))
  };
};

export const MailerLive = Layer.effect(Mailer, mailConfig.pipe(Effect.map(makeMailer)));

/** Review-state notifications are best-effort: the state change has already
 * committed, so a failed lookup or delivery is logged instead of failing the
 * mutation the admin/provider just made. */
export const sendMailBestEffort = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchAll((error) => Effect.logWarning(`${label} mail delivery failed`, error))
  );

export const makeMailerTest = (implementation: Partial<Context.Tag.Service<Mailer>>) =>
  Layer.succeed(Mailer, {
    sendMagicLink: () => Effect.void,
    sendFamilyWelcome: () => Effect.void,
    sendProviderWelcome: () => Effect.void,
    sendReferralInvite: () => Effect.void,
    sendApprovalRequestSubmitted: () => Effect.void,
    sendAdminApprovalRequestSubmitted: () => Effect.void,
    sendApprovalRequestRejected: () => Effect.void,
    sendApprovalGranted: () => Effect.void,
    sendApprovalRevoked: () => Effect.void,
    sendApprovalExpiring: () => Effect.void,
    sendSafetyVerificationInvite: () => Effect.void,
    sendSafetyVerificationExpiring: () => Effect.void,
    sendAccountBanned: () => Effect.void,
    sendAccountUnbanned: () => Effect.void,
    ...implementation
  });
