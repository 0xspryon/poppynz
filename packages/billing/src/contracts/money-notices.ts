import type { Contract } from '@repo/db';
import { formatMailMoney, formatMailShortDay, Mailer, type MailLocale } from '@repo/mail';
import { publishNotificationBestEffort } from '@repo/notify';
import { Effect } from 'effect';
import { payoutsPolicy } from '../payouts';
import { personName } from './notices';

/**
 * Money notices (Tier 3 step 2, spec §10): the family is emailed when a
 * session refund is issued, succeeds or fails; the helper when a cycle's
 * transfer is sent or held. Each in the recipient's language (EN / FR),
 * with a realtime `contract.billing` nudge so open pages refetch.
 * Best-effort: a failed send is logged and never undoes the money step.
 */

export type MoneyNoticeKind =
  | 'refund_issued'
  | 'refund_succeeded'
  | 'refund_failed'
  | 'transfer_sent'
  | 'transfer_held';

export type MoneyNoticeContext = {
  contract: Contract;
  cycleId: string;
  amountCents: number;
  /** A refund's session: its date and service. */
  session?: { date: string; serviceName: string } | null;
  /** A transfer: its cycle's dates and how many sessions are held back. */
  cycleDates?: { startsOn: string; endsOn: string } | null;
  heldSessions?: number;
  /** Why a transfer is held: the payout account, or nothing to send yet. */
  heldReason?: 'payout_account' | null;
};

type Copy = { subject: string; paragraphs: Array<string>; linkLabel: string };

const money = (cents: number, locale: MailLocale) => formatMailMoney(cents, locale);

/** The copy for one notice, in one language (exported for tests). */
export const moneyNoticeCopy = (
  kind: MoneyNoticeKind,
  ctx: MoneyNoticeContext,
  names: { family: string; helper: string },
  locale: MailLocale
): Copy => {
  const amount = money(ctx.amountCents, locale);
  const day = ctx.session ? formatMailShortDay(ctx.session.date, locale) : '';
  const service = ctx.session?.serviceName ?? '';
  const dates = ctx.cycleDates
    ? `${formatMailShortDay(ctx.cycleDates.startsOn, locale)} – ${formatMailShortDay(ctx.cycleDates.endsOn, locale)}`
    : '';
  const held = ctx.heldSessions ?? 0;
  if (locale === 'fr') {
    switch (kind) {
      case 'refund_issued':
        return {
          subject: `Remboursement de ${amount} en cours`,
          paragraphs: [
            `Nous remboursons ${amount} sur la carte qui a payé la séance ${service} du ${day} avec ${names.helper}.`,
            'Le montant apparaît habituellement sur votre relevé d’ici 5 à 10 jours ouvrables. Votre reçu de remboursement, avec les taxes remboursées, est dans Facturation.'
          ],
          linkLabel: 'Voir la facturation'
        };
      case 'refund_succeeded':
        return {
          subject: `Remboursement de ${amount} effectué`,
          paragraphs: [
            `Nous avons remboursé ${amount} sur la carte qui a payé la séance ${service} du ${day} avec ${names.helper}.`,
            'Selon votre banque, le montant apparaît sur votre relevé d’ici 5 à 10 jours ouvrables. Votre reçu de remboursement, avec les taxes remboursées, est dans Facturation.'
          ],
          linkLabel: 'Voir le reçu'
        };
      case 'refund_failed':
        return {
          subject: `Le remboursement de ${amount} n’a pas abouti`,
          paragraphs: [
            `Le remboursement de ${amount} pour la séance ${service} du ${day} n’a pas pu être versé sur votre carte (elle a peut-être été annulée ou remplacée).`,
            'Notre équipe a été avertie et communiquera avec vous pour vous rembourser autrement. Vous n’avez rien à faire.'
          ],
          linkLabel: 'Voir la facturation'
        };
      case 'transfer_sent':
        return {
          subject: `Paiement de ${amount} envoyé`,
          paragraphs: [
            `Nous avons envoyé ${amount} pour vos séances avec ${names.family} (${dates}) à votre compte de paiement. Il arrive à votre banque selon votre calendrier de versements habituel.`,
            ...(held > 0
              ? [
                  held === 1
                    ? 'Une séance faisant l’objet d’un signalement ou d’un litige est retenue; elle vous sera payée (ou non) dès qu’une décision sera prise.'
                    : `${held} séances faisant l’objet d’un signalement ou d’un litige sont retenues; elles vous seront payées (ou non) dès qu’une décision sera prise.`
                ]
              : [])
          ],
          linkLabel: 'Voir mes paiements'
        };
      case 'transfer_held':
        return {
          subject: `Paiement de vos séances retenu`,
          paragraphs: [
            `Votre paiement pour vos séances avec ${names.family} (${dates}) est retenu : votre compte de paiement ne peut pas recevoir de virements pour le moment.`,
            'Ouvrez Paiements pour voir ce qu’il faut fournir. Le paiement part dès que votre compte est prêt; nous ne pouvons pas encore vous donner de date d’arrivée.'
          ],
          linkLabel: 'Ouvrir Paiements'
        };
    }
  }
  switch (kind) {
    case 'refund_issued':
      return {
        subject: `Refund of ${amount} on its way`,
        paragraphs: [
          `We are refunding ${amount} to the card that paid for ${service} on ${day} with ${names.helper}.`,
          'It usually appears on your statement within 5–10 business days. Your refund receipt, with the tax returned, is in Billing.'
        ],
        linkLabel: 'View billing'
      };
    case 'refund_succeeded':
      return {
        subject: `Refund of ${amount} issued`,
        paragraphs: [
          `We refunded ${amount} to the card that paid for ${service} on ${day} with ${names.helper}.`,
          'Depending on your bank it appears on your statement within 5–10 business days. Your refund receipt, with the tax returned, is in Billing.'
        ],
        linkLabel: 'View the receipt'
      };
    case 'refund_failed':
      return {
        subject: `Your refund of ${amount} didn't go through`,
        paragraphs: [
          `The refund of ${amount} for ${service} on ${day} could not be returned to your card (it may have been cancelled or replaced).`,
          "Our team has been told and will contact you to refund you another way. There's nothing you need to do."
        ],
        linkLabel: 'View billing'
      };
    case 'transfer_sent':
      return {
        subject: `${amount} payment sent`,
        paragraphs: [
          `We sent ${amount} for your sessions with ${names.family} (${dates}) to your payout account. It reaches your bank on your usual payout schedule.`,
          ...(held > 0
            ? [
                held === 1
                  ? 'One session with an open report or dispute is held back; it is paid (or not) as soon as it is decided.'
                  : `${held} sessions with an open report or dispute are held back; they are paid (or not) as soon as they are decided.`
              ]
            : [])
        ],
        linkLabel: 'View my payouts'
      };
    case 'transfer_held':
      return {
        subject: 'Payment for your sessions is on hold',
        paragraphs: [
          `Your payment for your sessions with ${names.family} (${dates}) is on hold: your payout account can't receive transfers right now.`,
          "Open Payouts to see what's needed. The payment goes out as soon as your account is ready; we can't give you an arrival date yet."
        ],
        linkLabel: 'Open Payouts'
      };
  }
};

/** Emails the notice's recipient (refunds: the family; transfers: the
 * helper) and nudges their open pages. */
export const sendMoneyNotice = (kind: MoneyNoticeKind, ctx: MoneyNoticeContext) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    const { appWebOrigin } = yield* payoutsPolicy;
    const family = yield* personName(ctx.contract.familyUserId);
    const helper = yield* personName(ctx.contract.providerUserId);
    const toFamily = kind.startsWith('refund_');
    const userId = toFamily ? ctx.contract.familyUserId : ctx.contract.providerUserId;
    const me = toFamily ? family : helper;
    yield* publishNotificationBestEffort(userId, {
      type: 'contract.billing',
      payload: { contractId: ctx.contract.id, kind }
    });
    if (!me.email) {
      yield* Effect.logWarning(`[money] notice ${kind} skipped: no email on file`);
      return;
    }
    const copy = moneyNoticeCopy(
      kind,
      ctx,
      { family: family.name, helper: helper.name },
      me.locale
    );
    yield* mailer
      .sendContractBillingNotice({
        email: me.email,
        name: me.firstName,
        subject: copy.subject,
        paragraphs: copy.paragraphs,
        link: toFamily
          ? `${appWebOrigin}/family/billing`
          : `${appWebOrigin}/service-provider/payouts`,
        linkLabel: copy.linkLabel,
        locale: me.locale
      })
      .pipe(
        Effect.tap(() => Effect.logInfo(`[money] notice ${kind} sent to ${userId}`)),
        Effect.catchAll((error) => Effect.logWarning(`money notice ${kind} not sent`, error))
      );
  }).pipe(Effect.catchAll((error) => Effect.logWarning(`money notice ${kind} failed`, error)));
