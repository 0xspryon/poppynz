import { mailConfig, type AppEnvironment } from '@repo/env';
import { Context, Data, Effect, Layer, Option } from 'effect';
import type { MailLocale } from './locale';
import type { MailRole } from './templates';
import {
  accountBannedMail,
  accountUnbannedMail,
  adminApprovalRequestSubmittedMail,
  adminBillingAlertMail,
  contractBillingNoticeMail,
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
  referralInviteMail,
  vouchRequestMail
} from './templates';

export class MailerError extends Data.TaggedError('MailerError')<{
  cause: unknown;
}> {}

export type MagicLinkMail = {
  email: string;
  link: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type ReferralInviteMail = {
  email: string;
  /** Display name the invite is attributed to ("from Poppynz with your name on it"). */
  inviterName: string;
  role: MailRole;
  link: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type VouchRequestMail = {
  email: string;
  applicantName: string;
  relationship: string;
  link: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type ApprovalRequestSubmittedMail = {
  email: string;
  name: string | null;
  role: MailRole;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

/** Recipients come from ADMIN_NOTIFICATION_EMAILS, not from the payload. */
export type AdminApprovalRequestSubmittedMail = {
  applicantName: string | null;
  applicantEmail: string;
  role: MailRole;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type ApprovalRequestRejectedMail = {
  email: string;
  name: string | null;
  role: MailRole;
  reason: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type ApprovalGrantedMail = {
  email: string;
  name: string | null;
  role: MailRole;
  expiresAt: Date;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type ApprovalRevokedMail = {
  email: string;
  name: string | null;
  role: MailRole;
  reason: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type ApprovalExpiringMail = {
  email: string;
  name: string | null;
  role: MailRole;
  expiresAt: Date;
  daysRemaining: number;
  link: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type SafetyVerificationInviteMail = {
  email: string;
  name: string | null;
  link: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type SafetyVerificationExpiringMail = {
  email: string;
  name: string | null;
  role: 'family' | 'service-provider';
  expiresOn: string;
  daysRemaining: number;
  link: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type FamilyWelcomeMail = {
  email: string;
  name: string | null;
  profileLink: string;
  needsLink: string;
  documentsLink: string;
  findLink: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type ProviderWelcomeMail = {
  email: string;
  name: string | null;
  profileLink: string;
  documentsLink: string;
  servicesLink: string;
  approvalLink: string;
  findLink: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type AccountBannedMail = {
  email: string;
  name: string | null;
  reason: string | null;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export type AccountUnbannedMail = {
  email: string;
  name: string | null;
  link: string;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

/** A contract-billing notice (piece 3). The copy is composed by the billing
 * domain, which knows the amounts and dates; this layer only lays it out. */
export type ContractBillingNoticeMail = {
  email: string;
  name: string | null;
  subject: string;
  paragraphs: ReadonlyArray<string>;
  link: string;
  linkLabel: string;
  /** A second call to action under the first (e.g. "Find a replacement"). */
  secondaryLink?: { href: string; label: string; intro?: string } | null;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

/** Recipients come from ADMIN_NOTIFICATION_EMAILS, not from the payload. */
export type AdminBillingAlertMail = {
  subject: string;
  lines: ReadonlyArray<string>;
  /** The recipient's language; English when unknown. */
  locale?: MailLocale;
};

export class Mailer extends Context.Tag('@api/lib/Mailer')<
  Mailer,
  {
    sendMagicLink: (mail: MagicLinkMail) => Effect.Effect<void, MailerError>;
    sendFamilyWelcome: (mail: FamilyWelcomeMail) => Effect.Effect<void, MailerError>;
    sendProviderWelcome: (mail: ProviderWelcomeMail) => Effect.Effect<void, MailerError>;
    sendReferralInvite: (mail: ReferralInviteMail) => Effect.Effect<void, MailerError>;
    sendVouchRequest: (mail: VouchRequestMail) => Effect.Effect<void, MailerError>;
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
    sendContractBillingNotice: (
      mail: ContractBillingNoticeMail
    ) => Effect.Effect<void, MailerError>;
    sendAdminBillingAlert: (mail: AdminBillingAlertMail) => Effect.Effect<void, MailerError>;
  }
>() {}

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

  // Production and staging mail everyone (staging since 96b814e: UAT testers
  // use their own addresses). Dev only mails @poppynz.com addresses and the
  // admin accounts, so local test users never receive real mail.
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
    sendVouchRequest: (mail) => deliver([mail.email], vouchRequestMail(mail)),
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
    sendAccountUnbanned: (mail) => deliver([mail.email], accountUnbannedMail(mail)),
    sendContractBillingNotice: (mail) => deliver([mail.email], contractBillingNoticeMail(mail)),
    sendAdminBillingAlert: (mail) =>
      config.adminNotificationEmails.length === 0
        ? Effect.sync(() =>
            console.warn(`[mail] admin billing alert with no recipients: ${mail.subject}`)
          )
        : deliver(config.adminNotificationEmails, adminBillingAlertMail(mail))
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
    sendVouchRequest: () => Effect.void,
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
    sendContractBillingNotice: () => Effect.void,
    sendAdminBillingAlert: () => Effect.void,
    ...implementation
  });
