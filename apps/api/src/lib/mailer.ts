import { Context, Data, Effect, Layer } from "effect";
import type { Role } from "./auth-roles";

export class MailerError extends Data.TaggedError("MailerError")<{
  cause: unknown;
}> { }

export type ReferralInviteMail = {
  email: string;
  /** Display name the invite is attributed to ("from Poppynz with your name on it"). */
  inviterName: string;
  role: Role;
  link: string;
};

export class Mailer extends Context.Tag("@api/lib/Mailer")<
  Mailer,
  {
    sendReferralInvite: (mail: ReferralInviteMail) => Effect.Effect<void, MailerError>;
  }
>() { }

/** No mail provider is wired up yet — like sendMagicLink, deliveries are
 * logged so the flow is testable end-to-end in dev. */
export const MailerLive = Layer.succeed(Mailer, {
  sendReferralInvite: (mail) =>
    Effect.sync(() => {
      console.log(
        `Referral invite for ${mail.email} (as ${mail.role}, from ${mail.inviterName}): ${mail.link}`,
      );
    }),
});

export const makeMailerTest = (implementation: Context.Tag.Service<Mailer>) =>
  Layer.succeed(Mailer, implementation);
