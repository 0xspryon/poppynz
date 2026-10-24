import { UserProfileRepo, UserRepo, type Contract, type ContractCycle } from '@repo/db';
import {
  formatMailMoney,
  formatMailShortDay,
  Mailer,
  toMailLocale,
  type MailLocale
} from '@repo/mail';
import { publishNotificationBestEffort } from '@repo/notify';
import { Effect } from 'effect';
import { payoutsPolicy } from '../payouts';

/**
 * Contract-billing notices (piece 3 spec §6): a realtime nudge so an open
 * page refetches, an email with the amounts and dates, and admin alerts.
 * Best-effort throughout — a notice that fails to send is logged and never
 * undoes the state change that caused it.
 */

export type BillingNoticeKind =
  | 'readiness_reminder'
  | 'cancelled_not_ready'
  | 'hold_declined'
  | 'payment_pending'
  | 'suspended'
  | 'resumed'
  | 'helper_not_ready'
  | 'charge_failed';

export type NoticeParty = 'family' | 'helper';

/** "Mon, Nov 2" / "lun. 2 nov." — one day of a cycle. */
const day = (date: string, locale: MailLocale) => formatMailShortDay(date, locale);

/** A cycle's dates, in English unless asked otherwise (admin alerts and
 * payment descriptions stay English). */
export const cycleDates = (
  cycle: Pick<ContractCycle, 'startsOn' | 'endsOn'>,
  locale: MailLocale = 'en'
) =>
  cycle.startsOn === cycle.endsOn
    ? day(cycle.startsOn, locale)
    : `${day(cycle.startsOn, locale)} – ${day(cycle.endsOn, locale)}`;

type NoticeContext = {
  contract: Contract;
  cycle?: Pick<ContractCycle, 'startsOn' | 'endsOn'> | null;
  amountCents?: number | null;
  /** The helper's side of the amount (what they receive), when it differs. */
  helperAmountCents?: number | null;
  /** readiness_reminder: days until the start date (0 = acceptance). */
  daysToStart?: number;
  startsOn?: string;
};

/** Where a notice's button leads. */
type NoticeLink = 'card' | 'payouts' | 'contract';

type Copy = { subject: string; paragraphs: Array<string>; linkLabel: string; link: NoticeLink };

/** The values a notice's sentences carry, already formatted for the locale. */
type NoticeValues = {
  counterpart: string;
  /** The cycle's dates ('' without a cycle). */
  dates: string;
  /** The amount for this party ('' without one). */
  amount: string;
  /** readiness_reminder: the contract's start day, when known. */
  startsOn: string | null;
};

/** Whole sentences per locale, per notice and party. `null`: this party gets
 * no mail for this notice. */
const noticeCopy: Record<
  MailLocale,
  (kind: BillingNoticeKind, party: NoticeParty, values: NoticeValues) => Copy | null
> = {
  en: (kind, party, { counterpart, dates, amount, startsOn }) => {
    switch (kind) {
      case 'readiness_reminder':
        return party === 'helper'
          ? {
              subject: 'Set up your payout account so your contract can start',
              paragraphs: [
                `Your contract with ${counterpart} starts on ${startsOn ?? 'its start date'}, but your payout account isn't ready yet.`,
                'Until it is, the family is not charged and the contract cannot start. If it is still not ready when the first payment is due, the contract is cancelled.'
              ],
              linkLabel: 'Set up payouts',
              link: 'payouts'
            }
          : {
              subject: `${counterpart} hasn't finished setting up payouts yet`,
              paragraphs: [
                `Your contract with ${counterpart} starts on ${startsOn ?? 'its start date'}, but their payout account isn't ready yet. Nothing has been charged.`,
                'If it is still not ready when the first payment is due, the contract is cancelled and you are not charged.'
              ],
              linkLabel: 'View the contract',
              link: 'contract'
            };
      case 'cancelled_not_ready':
        return {
          subject: 'Your contract was cancelled before it started',
          paragraphs: [
            party === 'helper'
              ? `Your contract with ${counterpart} was cancelled because your payout account wasn't ready in time.`
              : `Your contract with ${counterpart} was cancelled because their payout account wasn't ready in time.`,
            'Nothing was charged. You can agree new terms from your conversation.'
          ],
          linkLabel: 'View the contract',
          link: 'contract'
        };
      case 'hold_declined':
        return {
          subject: 'Your card was declined — update it to keep your care booked',
          paragraphs: [
            `We couldn't place the ${amount} hold for your care with ${counterpart} on ${dates}.`,
            'Please update your card before the first day of these dates. We will try again automatically, and straight away when you replace the card. If it still fails, these sessions are suspended.'
          ],
          linkLabel: 'Update your card',
          link: 'card'
        };
      case 'payment_pending':
        return {
          subject: `Payment for ${dates} is pending`,
          paragraphs: [
            `${counterpart}'s payment for ${dates} hasn't gone through yet. We are retrying it.`,
            "We'll let you know before the first session whether these dates go ahead."
          ],
          linkLabel: 'View the contract',
          link: 'contract'
        };
      case 'suspended':
        return party === 'helper'
          ? {
              subject: `Don't work ${dates} — payment hasn't been received`,
              paragraphs: [
                `The payment for your sessions with ${counterpart} on ${dates} wasn't received, so the contract is suspended.`,
                'Please do not work these sessions: suspended days are never billed. We will email you as soon as it resumes.'
              ],
              linkLabel: 'View the contract',
              link: 'contract'
            }
          : {
              subject: `Your care on ${dates} is suspended`,
              paragraphs: [
                `We couldn't take the payment for your care with ${counterpart} on ${dates}, so the contract is suspended and ${counterpart} has been told not to work.`,
                'Suspended days are never billed. Update your card to resume: the rest of these dates is charged straight away.'
              ],
              linkLabel: 'Update your card',
              link: 'card'
            };
      case 'resumed':
        return {
          subject: 'Your contract has resumed',
          paragraphs: [
            party === 'helper'
              ? `Your contract with ${counterpart} has resumed: ${amount} was received for the rest of ${dates}.`
              : `Your contract with ${counterpart} has resumed: ${amount} was charged for the rest of ${dates}.`,
            party === 'helper'
              ? 'Please work the remaining sessions as agreed.'
              : 'Your remaining sessions go ahead as agreed.'
          ],
          linkLabel: 'View the contract',
          link: 'contract'
        };
      case 'helper_not_ready':
        return party === 'helper'
          ? {
              subject: 'Your payout account needs attention',
              paragraphs: [
                `Your payout account isn't ready, so the payment for ${dates} with ${counterpart} can't be taken and those sessions can't go ahead.`,
                'Fix your payout account to continue: the contract resumes automatically once it is ready.'
              ],
              linkLabel: 'Fix payouts',
              link: 'payouts'
            }
          : {
              subject: `Your care on ${dates} is on hold`,
              paragraphs: [
                `${counterpart}'s payout account needs attention, so we haven't charged you for ${dates} and those sessions can't go ahead yet.`,
                'You do not need to do anything. The contract resumes automatically once their account is ready.'
              ],
              linkLabel: 'View the contract',
              link: 'contract'
            };
      case 'charge_failed':
        return party === 'family'
          ? {
              subject: 'We still could not charge your card',
              paragraphs: [
                `The ${amount} charge for your care with ${counterpart} on ${dates} was declined. Your contract stays suspended.`,
                'Please replace your card to resume.'
              ],
              linkLabel: 'Update your card',
              link: 'card'
            }
          : null;
    }
  },
  fr: (kind, party, { counterpart, dates, amount, startsOn }) => {
    switch (kind) {
      case 'readiness_reminder':
        return party === 'helper'
          ? {
              subject:
                'Configurez votre compte de versement pour que votre contrat puisse commencer',
              paragraphs: [
                startsOn
                  ? `Votre contrat avec ${counterpart} commence le ${startsOn}, mais votre compte de versement n’est pas encore prêt.`
                  : `Votre contrat avec ${counterpart} commence à sa date de début prévue, mais votre compte de versement n’est pas encore prêt.`,
                'D’ici là, la famille n’est pas facturée et le contrat ne peut pas commencer. S’il n’est toujours pas prêt à l’échéance du premier paiement, le contrat est annulé.'
              ],
              linkLabel: 'Configurer les versements',
              link: 'payouts'
            }
          : {
              subject: `${counterpart} n’a pas encore terminé la configuration de ses versements`,
              paragraphs: [
                startsOn
                  ? `Votre contrat avec ${counterpart} commence le ${startsOn}, mais son compte de versement n’est pas encore prêt. Rien n’a été facturé.`
                  : `Votre contrat avec ${counterpart} commence à sa date de début prévue, mais son compte de versement n’est pas encore prêt. Rien n’a été facturé.`,
                'S’il n’est toujours pas prêt à l’échéance du premier paiement, le contrat est annulé et rien ne vous est facturé.'
              ],
              linkLabel: 'Voir le contrat',
              link: 'contract'
            };
      case 'cancelled_not_ready':
        return {
          subject: 'Votre contrat a été annulé avant de commencer',
          paragraphs: [
            party === 'helper'
              ? `Votre contrat avec ${counterpart} a été annulé parce que votre compte de versement n’était pas prêt à temps.`
              : `Votre contrat avec ${counterpart} a été annulé parce que son compte de versement n’était pas prêt à temps.`,
            'Rien n’a été facturé. Vous pouvez convenir de nouvelles conditions à partir de votre conversation.'
          ],
          linkLabel: 'Voir le contrat',
          link: 'contract'
        };
      case 'hold_declined':
        return {
          subject: 'Votre carte a été refusée — mettez-la à jour pour conserver votre réservation',
          paragraphs: [
            `Nous n’avons pas pu effectuer la préautorisation de ${amount} pour vos services avec ${counterpart} (${dates}).`,
            'Veuillez mettre à jour votre carte avant le premier jour de ces dates. Nous réessaierons automatiquement, et immédiatement lorsque vous remplacerez la carte. En cas de nouvel échec, ces séances seront suspendues.'
          ],
          linkLabel: 'Mettre à jour votre carte',
          link: 'card'
        };
      case 'payment_pending':
        return {
          subject: `Paiement en attente (${dates})`,
          paragraphs: [
            `Le paiement de ${counterpart} (${dates}) n’a pas encore abouti. Nous réessayons.`,
            'Nous vous dirons avant la première séance si ces dates sont maintenues.'
          ],
          linkLabel: 'Voir le contrat',
          link: 'contract'
        };
      case 'suspended':
        return party === 'helper'
          ? {
              subject: `Paiement non reçu — ne travaillez pas (${dates})`,
              paragraphs: [
                `Le paiement de vos séances avec ${counterpart} (${dates}) n’a pas été reçu; le contrat est donc suspendu.`,
                'Veuillez ne pas effectuer ces séances : les jours suspendus ne sont jamais facturés. Nous vous écrirons dès que le contrat reprendra.'
              ],
              linkLabel: 'Voir le contrat',
              link: 'contract'
            }
          : {
              subject: `Vos services (${dates}) sont suspendus`,
              paragraphs: [
                `Nous n’avons pas pu prélever le paiement de vos services avec ${counterpart} (${dates}); le contrat est donc suspendu et ${counterpart} a été avisé(e) de ne pas travailler.`,
                'Les jours suspendus ne sont jamais facturés. Mettez à jour votre carte pour reprendre : le reste de ces dates sera facturé immédiatement.'
              ],
              linkLabel: 'Mettre à jour votre carte',
              link: 'card'
            };
      case 'resumed':
        return {
          subject: 'Votre contrat a repris',
          paragraphs: [
            party === 'helper'
              ? `Votre contrat avec ${counterpart} a repris : un montant de ${amount} a été reçu pour le reste de la période (${dates}).`
              : `Votre contrat avec ${counterpart} a repris : un montant de ${amount} a été facturé pour le reste de la période (${dates}).`,
            party === 'helper'
              ? 'Veuillez effectuer les séances restantes comme convenu.'
              : 'Vos séances restantes ont lieu comme convenu.'
          ],
          linkLabel: 'Voir le contrat',
          link: 'contract'
        };
      case 'helper_not_ready':
        return party === 'helper'
          ? {
              subject: 'Votre compte de versement nécessite votre attention',
              paragraphs: [
                `Votre compte de versement n’est pas prêt; le paiement de vos séances avec ${counterpart} (${dates}) ne peut donc pas être prélevé, et ces séances ne peuvent pas avoir lieu.`,
                'Corrigez votre compte de versement pour continuer : le contrat reprendra automatiquement dès qu’il sera prêt.'
              ],
              linkLabel: 'Corriger les versements',
              link: 'payouts'
            }
          : {
              subject: `Vos services (${dates}) sont en attente`,
              paragraphs: [
                `Le compte de versement de ${counterpart} nécessite une intervention; nous ne vous avons donc rien facturé pour ces dates (${dates}), et ces séances ne peuvent pas encore avoir lieu.`,
                'Vous n’avez rien à faire. Le contrat reprendra automatiquement dès que son compte sera prêt.'
              ],
              linkLabel: 'Voir le contrat',
              link: 'contract'
            };
      case 'charge_failed':
        return party === 'family'
          ? {
              subject: 'Nous n’avons toujours pas pu débiter votre carte',
              paragraphs: [
                `Le prélèvement de ${amount} pour vos services avec ${counterpart} (${dates}) a été refusé. Votre contrat reste suspendu.`,
                'Veuillez remplacer votre carte pour reprendre.'
              ],
              linkLabel: 'Mettre à jour votre carte',
              link: 'card'
            }
          : null;
    }
  }
};

export const copyFor = (
  kind: BillingNoticeKind,
  party: NoticeParty,
  context: NoticeContext,
  counterpart: string,
  locale: MailLocale = 'en'
): Copy | null => {
  const cents =
    party === 'helper' && context.helperAmountCents != null
      ? context.helperAmountCents
      : context.amountCents;
  return noticeCopy[locale](kind, party, {
    counterpart,
    dates: context.cycle ? cycleDates(context.cycle, locale) : '',
    amount: cents != null ? formatMailMoney(cents, locale) : '',
    startsOn: context.startsOn ? day(context.startsOn, locale) : null
  });
};

const displayName = (
  profile: { firstName: string | null; lastName: string | null } | null,
  fallback: string
) => {
  if (!profile?.firstName) return fallback;
  return profile.lastName
    ? `${profile.firstName} ${profile.lastName.charAt(0)}.`
    : profile.firstName;
};

/** "Sam T." — how a counterpart is named in notices and descriptions. */
export const personName = (userId: string) =>
  Effect.gen(function* () {
    const users = yield* UserRepo;
    const profiles = yield* UserProfileRepo;
    const user = yield* users.findById(userId).pipe(Effect.orElseSucceed(() => null));
    const profile = yield* profiles.findByUserId(userId).pipe(Effect.orElseSucceed(() => null));
    return {
      email: user?.email ?? null,
      firstName: profile?.firstName ?? null,
      name: displayName(profile, user?.name ?? 'Poppynz member'),
      /** The language their mails are written in; English when unknown. */
      locale: toMailLocale(profile?.language)
    };
  });

/** Sends one notice to the given parties. */
export const sendBillingNotice = (
  kind: BillingNoticeKind,
  parties: ReadonlyArray<NoticeParty>,
  context: NoticeContext
) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    const { appWebOrigin } = yield* payoutsPolicy;
    const family = yield* personName(context.contract.familyUserId);
    const helper = yield* personName(context.contract.providerUserId);
    for (const party of parties) {
      const userId =
        party === 'family' ? context.contract.familyUserId : context.contract.providerUserId;
      const me = party === 'family' ? family : helper;
      const other = party === 'family' ? helper : family;
      yield* publishNotificationBestEffort(userId, {
        type: 'contract.billing',
        payload: { contractId: context.contract.id, kind }
      });
      const copy = copyFor(kind, party, context, other.name, me.locale);
      if (!copy) continue;
      if (!me.email) {
        yield* Effect.logWarning(`[billing] notice ${kind} to ${party} skipped: no email on file`);
        continue;
      }
      const link =
        copy.link === 'card'
          ? `${appWebOrigin}/family/billing`
          : copy.link === 'payouts'
            ? `${appWebOrigin}/service-provider/payouts`
            : `${appWebOrigin}/${party === 'family' ? 'family' : 'service-provider'}/contracts/${context.contract.id}`;
      yield* mailer
        .sendContractBillingNotice({
          email: me.email,
          name: me.firstName,
          subject: copy.subject,
          paragraphs: copy.paragraphs,
          link,
          linkLabel: copy.linkLabel,
          locale: me.locale
        })
        .pipe(
          // Logged on every runtime alike (api and worker), so a notice is
          // traceable wherever the billing step ran.
          Effect.tap(() => Effect.logInfo(`[billing] notice ${kind} sent to ${party} ${me.email}`)),
          Effect.catchAll((error) => Effect.logWarning(`billing notice ${kind} not sent`, error))
        );
    }
  }).pipe(Effect.catchAll((error) => Effect.logWarning(`billing notice ${kind} failed`, error)));

/** An immediate alert to the admins (ADMIN_NOTIFICATION_EMAILS). */
export const alertAdmins = (subject: string, lines: ReadonlyArray<string>) =>
  Mailer.pipe(
    Effect.flatMap((mailer) => mailer.sendAdminBillingAlert({ subject, lines })),
    Effect.tap(() => Effect.logWarning(`[billing] admin alert: ${subject}`)),
    Effect.catchAll((error) => Effect.logError(`admin billing alert not sent: ${subject}`, error))
  );
