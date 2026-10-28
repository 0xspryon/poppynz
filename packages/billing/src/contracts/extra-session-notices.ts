import type { Contract, ExtraSession } from '@repo/db';
import {
  formatMailMoney,
  formatMailShortDay,
  intlLocale,
  Mailer,
  type MailLocale
} from '@repo/mail';
import { publishNotificationBestEffort } from '@repo/notify';
import { Effect } from 'effect';
import { payoutsPolicy } from '../payouts';
import { cycleDates, personName, type NoticeParty } from './notices';

/**
 * Extra-session notices (Tier 3 step 3): every event emails BOTH parties,
 * each in their own language, plus a realtime `contract.extra_session` event
 * so open pages refetch. Best-effort, like every billing notice: a failed
 * send is logged and never undoes the change that caused it.
 */

export type ExtraSessionEvent =
  | 'proposed'
  | 'withdrawn'
  | 'declined'
  | 'lapsed'
  | 'agreed'
  | 'cancelled'
  | 'in_cycle'
  | 'charged'
  | 'charge_failed';

export type ExtraSessionNoticeContext = {
  contract: Contract;
  extra: ExtraSession;
  /** Who acted (null: the system — a lapse, a charge). */
  actorUserId: string | null;
  /** The contract zone (deadlines are shown in it). */
  zone: string;
  chargeDelayMinutes: number;
  retryHours: number;
  /** The cycle's dates, for a session folded into its charge. */
  cycle?: { startsOn: string; endsOn: string } | null;
};

type Copy = { subject: string; paragraphs: Array<string>; link: 'session' | 'card' };

export type ExtraSessionNoticeValues = {
  /** Who acted ("Maria T."), or null when it was the recipient. */
  actor: string | null;
  counterpart: string;
  /** "Childcare, Tue, Nov 3, 3:30 p.m.–5:30 p.m." */
  session: string;
  day: string;
  /** What the family pays for it (care + fee + tax). */
  amount: string;
  /** The answer deadline, in the contract zone. */
  deadline: string;
  /** "1 hour", "45 minutes". */
  delay: string;
  retryHours: number;
  cycleDates: string;
};

const clock = (minutes: number, locale: MailLocale) =>
  minutes >= 24 * 60
    ? locale === 'fr'
      ? 'minuit'
      : 'midnight'
    : new Intl.DateTimeFormat(intlLocale(locale), {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC'
      }).format(new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)));

const instant = (at: Date, zone: string, locale: MailLocale) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short'
  }).format(at);

/** "1 hour", "2 hours", "45 minutes" / "1 heure", "45 minutes". */
export const formatDelay = (minutes: number, locale: MailLocale) => {
  if (minutes === 0) return locale === 'fr' ? 'quelques instants' : 'a few moments';
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return locale === 'fr'
      ? `${hours} heure${hours > 1 ? 's' : ''}`
      : `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${minutes} minute${minutes > 1 ? 's' : ''}`;
};

/** Whole sentences per locale. `mine`: the recipient acted. */
const copy: Record<
  MailLocale,
  (event: ExtraSessionEvent, party: NoticeParty, mine: boolean, v: ExtraSessionNoticeValues) => Copy
> = {
  en: (event, party, mine, v) => {
    const who = v.actor ?? 'You';
    switch (event) {
      case 'proposed':
        if (mine) {
          return {
            subject: `You proposed an extra session on ${v.day}`,
            paragraphs: [
              `You proposed an extra session with ${v.counterpart}: ${v.session}.`,
              ...(party === 'family'
                ? [
                    `You authorised Poppynz to charge your card ${v.amount} for it once ${v.counterpart} confirms.`
                  ]
                : []),
              `${v.counterpart} has until ${v.deadline} to confirm it. Without an answer the proposal lapses and nothing is charged.`
            ],
            link: 'session'
          };
        }
        return party === 'family'
          ? {
              subject: `${who} proposed an extra session on ${v.day}`,
              paragraphs: [
                `${who} proposed an extra session: ${v.session}.`,
                `If you confirm it, Poppynz charges your card ${v.amount} for it (care, the service fee and tax). Please confirm or decline by ${v.deadline}. Without an answer it lapses and nothing is charged.`
              ],
              link: 'session'
            }
          : {
              subject: `${who} proposed an extra session on ${v.day}`,
              paragraphs: [
                `${who} proposed an extra session: ${v.session}. They have authorised the charge for it.`,
                `Please confirm or decline by ${v.deadline}. Without an answer it lapses.`
              ],
              link: 'session'
            };
      case 'withdrawn':
        return {
          subject: mine
            ? `You withdrew your extra session proposal (${v.day})`
            : `${who} withdrew an extra session proposal (${v.day})`,
          paragraphs: [
            mine
              ? `You withdrew your proposal for an extra session: ${v.session}. Nothing is charged.`
              : `${who} withdrew their proposal for an extra session: ${v.session}. Nothing is charged.`
          ],
          link: 'session'
        };
      case 'declined':
        return {
          subject: mine
            ? `You declined an extra session (${v.day})`
            : `${who} declined the extra session (${v.day})`,
          paragraphs: [
            mine
              ? `You declined the extra session ${v.counterpart} proposed: ${v.session}. Nothing is charged.`
              : `${who} declined the extra session you proposed: ${v.session}. Nothing is charged.`
          ],
          link: 'session'
        };
      case 'lapsed':
        return {
          subject: `An extra session proposal lapsed (${v.day})`,
          paragraphs: [
            `Nobody confirmed the extra session in time (${v.session}), so the proposal lapsed. Nothing is charged.`
          ],
          link: 'session'
        };
      case 'agreed':
        return party === 'family'
          ? {
              subject: `Extra session confirmed for ${v.day}`,
              paragraphs: [
                `The extra session with ${v.counterpart} is confirmed: ${v.session}.`,
                `You'll be charged ${v.amount} for it in ${v.delay} unless either of you cancels it before then. Cancelling until then costs nothing.`
              ],
              link: 'session'
            }
          : {
              subject: `Extra session confirmed for ${v.day}`,
              paragraphs: [
                `The extra session with ${v.counterpart} is confirmed: ${v.session}.`,
                `The family is charged for it in ${v.delay}, and you are paid for it once their payment succeeds. Either of you can cancel it at no cost until then.`
              ],
              link: 'session'
            };
      case 'cancelled':
        return {
          subject: mine
            ? `You cancelled the extra session (${v.day})`
            : `${who} cancelled the extra session (${v.day})`,
          paragraphs: [
            `${mine ? 'You' : who} cancelled the extra session (${v.session}) before it was charged. Nothing is charged.`
          ],
          link: 'session'
        };
      case 'in_cycle':
        return party === 'family'
          ? {
              subject: `Extra session added to your charge for ${v.cycleDates}`,
              paragraphs: [
                `The extra session (${v.session}) is part of your charge for ${v.cycleDates}: about ${v.amount}.`
              ],
              link: 'session'
            }
          : {
              subject: `Extra session included in the cycle (${v.day})`,
              paragraphs: [
                `The extra session (${v.session}) is included in the family's charge for ${v.cycleDates}. You are paid for it with the cycle.`
              ],
              link: 'session'
            };
      case 'charged':
        return party === 'family'
          ? {
              subject: `You were charged ${v.amount} for an extra session`,
              paragraphs: [
                `Poppynz charged your card ${v.amount} for the extra session with ${v.counterpart} (${v.session}).`
              ],
              link: 'session'
            }
          : {
              subject: `The extra session on ${v.day} is paid`,
              paragraphs: [
                `The family's payment for the extra session (${v.session}) went through. You are paid for it with your next transfer.`
              ],
              link: 'session'
            };
      case 'charge_failed':
        return party === 'family'
          ? {
              subject: 'Your card was declined for an extra session — please update it',
              paragraphs: [
                `We couldn't charge ${v.amount} for the extra session with ${v.counterpart} (${v.session}).`,
                `Please update your card. We try again every ${v.retryHours} hours, and straight away when you replace it. Your regular sessions are not affected.`
              ],
              link: 'card'
            }
          : {
              subject: `The family's payment for the extra session on ${v.day} didn't go through`,
              paragraphs: [
                `The family's card was declined for the extra session (${v.session}). You are paid for it once their payment goes through; your regular sessions are not affected.`
              ],
              link: 'session'
            };
    }
  },
  fr: (event, party, mine, v) => {
    const who = v.actor ?? 'Vous';
    switch (event) {
      case 'proposed':
        if (mine) {
          return {
            subject: `Vous avez proposé une séance supplémentaire le ${v.day}`,
            paragraphs: [
              `Vous avez proposé une séance supplémentaire à ${v.counterpart} : ${v.session}.`,
              ...(party === 'family'
                ? [
                    `Vous avez autorisé Poppynz à prélever ${v.amount} sur votre carte pour cette séance dès que ${v.counterpart} l’aura confirmée.`
                  ]
                : []),
              `${v.counterpart} a jusqu’au ${v.deadline} pour la confirmer. Sans réponse, la proposition expire et rien n’est prélevé.`
            ],
            link: 'session'
          };
        }
        return party === 'family'
          ? {
              subject: `${who} propose une séance supplémentaire le ${v.day}`,
              paragraphs: [
                `${who} propose une séance supplémentaire : ${v.session}.`,
                `Si vous la confirmez, Poppynz prélèvera ${v.amount} sur votre carte pour cette séance (services, frais de service et taxes). Veuillez la confirmer ou la refuser d’ici le ${v.deadline}. Sans réponse, elle expire et rien n’est prélevé.`
              ],
              link: 'session'
            }
          : {
              subject: `${who} propose une séance supplémentaire le ${v.day}`,
              paragraphs: [
                `${who} propose une séance supplémentaire : ${v.session}. La famille a autorisé le paiement de cette séance.`,
                `Veuillez la confirmer ou la refuser d’ici le ${v.deadline}. Sans réponse, elle expire.`
              ],
              link: 'session'
            };
      case 'withdrawn':
        return {
          subject: mine
            ? `Vous avez retiré votre proposition de séance supplémentaire (${v.day})`
            : `${who} a retiré une proposition de séance supplémentaire (${v.day})`,
          paragraphs: [
            mine
              ? `Vous avez retiré votre proposition de séance supplémentaire : ${v.session}. Rien n’est prélevé.`
              : `${who} a retiré sa proposition de séance supplémentaire : ${v.session}. Rien n’est prélevé.`
          ],
          link: 'session'
        };
      case 'declined':
        return {
          subject: mine
            ? `Vous avez refusé une séance supplémentaire (${v.day})`
            : `${who} a refusé la séance supplémentaire (${v.day})`,
          paragraphs: [
            mine
              ? `Vous avez refusé la séance supplémentaire proposée par ${v.counterpart} : ${v.session}. Rien n’est prélevé.`
              : `${who} a refusé la séance supplémentaire que vous avez proposée : ${v.session}. Rien n’est prélevé.`
          ],
          link: 'session'
        };
      case 'lapsed':
        return {
          subject: `Une proposition de séance supplémentaire a expiré (${v.day})`,
          paragraphs: [
            `Personne n’a confirmé la séance supplémentaire à temps (${v.session}); la proposition a donc expiré. Rien n’est prélevé.`
          ],
          link: 'session'
        };
      case 'agreed':
        return party === 'family'
          ? {
              subject: `Séance supplémentaire confirmée le ${v.day}`,
              paragraphs: [
                `La séance supplémentaire avec ${v.counterpart} est confirmée : ${v.session}.`,
                `${v.amount} sera prélevé sur votre carte dans ${v.delay}, à moins que l’un de vous ne l’annule d’ici là. L’annuler d’ici là ne coûte rien.`
              ],
              link: 'session'
            }
          : {
              subject: `Séance supplémentaire confirmée le ${v.day}`,
              paragraphs: [
                `La séance supplémentaire avec ${v.counterpart} est confirmée : ${v.session}.`,
                `La famille sera facturée dans ${v.delay}, et vous serez payé(e) pour cette séance dès que son paiement est accepté. L’un ou l’autre peut l’annuler sans frais d’ici là.`
              ],
              link: 'session'
            };
      case 'cancelled':
        return {
          subject: mine
            ? `Vous avez annulé la séance supplémentaire (${v.day})`
            : `${who} a annulé la séance supplémentaire (${v.day})`,
          paragraphs: [
            mine
              ? `Vous avez annulé la séance supplémentaire (${v.session}) avant qu’elle soit facturée. Rien n’est prélevé.`
              : `${who} a annulé la séance supplémentaire (${v.session}) avant qu’elle soit facturée. Rien n’est prélevé.`
          ],
          link: 'session'
        };
      case 'in_cycle':
        return party === 'family'
          ? {
              subject: `Séance supplémentaire ajoutée à votre paiement du ${v.cycleDates}`,
              paragraphs: [
                `La séance supplémentaire (${v.session}) fait partie de votre paiement pour le ${v.cycleDates} : environ ${v.amount}.`
              ],
              link: 'session'
            }
          : {
              subject: `Séance supplémentaire incluse dans le cycle (${v.day})`,
              paragraphs: [
                `La séance supplémentaire (${v.session}) est incluse dans le paiement de la famille pour le ${v.cycleDates}. Vous êtes payé(e) pour celle-ci avec le cycle.`
              ],
              link: 'session'
            };
      case 'charged':
        return party === 'family'
          ? {
              subject: `${v.amount} prélevé pour une séance supplémentaire`,
              paragraphs: [
                `Poppynz a prélevé ${v.amount} sur votre carte pour la séance supplémentaire avec ${v.counterpart} (${v.session}).`
              ],
              link: 'session'
            }
          : {
              subject: `La séance supplémentaire du ${v.day} est payée`,
              paragraphs: [
                `Le paiement de la famille pour la séance supplémentaire (${v.session}) a été accepté. Vous êtes payé(e) pour celle-ci avec votre prochain virement.`
              ],
              link: 'session'
            };
      case 'charge_failed':
        return party === 'family'
          ? {
              subject:
                'Votre carte a été refusée pour une séance supplémentaire — veuillez la mettre à jour',
              paragraphs: [
                `Nous n’avons pas pu prélever ${v.amount} pour la séance supplémentaire avec ${v.counterpart} (${v.session}).`,
                `Veuillez mettre votre carte à jour. Nous réessayons toutes les ${v.retryHours} heures, et immédiatement dès que vous la remplacez. Vos séances habituelles ne sont pas touchées.`
              ],
              link: 'card'
            }
          : {
              subject: `Le paiement de la famille pour la séance supplémentaire du ${v.day} n’a pas abouti`,
              paragraphs: [
                `La carte de la famille a été refusée pour la séance supplémentaire (${v.session}). Vous êtes payé(e) pour celle-ci dès que son paiement est accepté; vos séances habituelles ne sont pas touchées.`
              ],
              link: 'session'
            };
    }
  }
};

/** The notice's copy for one party, in their language (exported for tests). */
export const extraSessionCopyFor = (
  event: ExtraSessionEvent,
  party: NoticeParty,
  ctx: ExtraSessionNoticeContext,
  names: { family: string; helper: string },
  locale: MailLocale
): Copy => {
  const { contract, extra } = ctx;
  const recipientId = party === 'family' ? contract.familyUserId : contract.providerUserId;
  const mine = ctx.actorUserId !== null && ctx.actorUserId === recipientId;
  const actor =
    ctx.actorUserId === null || mine
      ? null
      : ctx.actorUserId === contract.familyUserId
        ? names.family
        : ctx.actorUserId === contract.providerUserId
          ? names.helper
          : 'Poppynz';
  const day = formatMailShortDay(extra.date, locale);
  return copy[locale](event, party, mine, {
    actor,
    counterpart: party === 'family' ? names.helper : names.family,
    day,
    session: `${extra.serviceName}, ${day}, ${clock(extra.startMinutes, locale)}–${clock(extra.endMinutes, locale)}`,
    amount: formatMailMoney(extra.familyTotalCents ?? extra.quotedTotalCents, locale),
    deadline: instant(extra.respondBy, ctx.zone, locale),
    delay: formatDelay(ctx.chargeDelayMinutes, locale),
    retryHours: ctx.retryHours,
    cycleDates: ctx.cycle ? cycleDates(ctx.cycle, locale) : day
  });
};

/** Emails both parties (each in their language) and nudges open pages. */
export const sendExtraSessionNotice = (event: ExtraSessionEvent, ctx: ExtraSessionNoticeContext) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    const { appWebOrigin } = yield* payoutsPolicy;
    const { contract, extra } = ctx;
    const family = yield* personName(contract.familyUserId);
    const helper = yield* personName(contract.providerUserId);
    for (const party of ['family', 'helper'] as const) {
      const userId = party === 'family' ? contract.familyUserId : contract.providerUserId;
      const me = party === 'family' ? family : helper;
      yield* publishNotificationBestEffort(userId, {
        type: 'contract.extra_session',
        payload: {
          contractId: contract.id,
          extraSessionId: extra.id,
          cycleId: extra.cycleId,
          event
        }
      });
      if (!me.email) {
        yield* Effect.logWarning(`[extra-sessions] notice ${event} to ${party} skipped: no email`);
        continue;
      }
      const text = extraSessionCopyFor(
        event,
        party,
        ctx,
        { family: family.name, helper: helper.name },
        me.locale
      );
      const base = party === 'family' ? 'family' : 'service-provider';
      const link =
        text.link === 'card'
          ? `${appWebOrigin}/family/billing`
          : extra.cycleId
            ? `${appWebOrigin}/${base}/contracts/${contract.id}/cycles/${extra.cycleId}`
            : `${appWebOrigin}/${base}/contracts/${contract.id}`;
      yield* mailer
        .sendContractBillingNotice({
          email: me.email,
          name: me.firstName,
          subject: text.subject,
          paragraphs: text.paragraphs,
          link,
          linkLabel:
            text.link === 'card'
              ? me.locale === 'fr'
                ? 'Mettre ma carte à jour'
                : 'Update your card'
              : me.locale === 'fr'
                ? 'Voir la séance'
                : 'View the session',
          locale: me.locale
        })
        .pipe(
          Effect.tap(() =>
            Effect.logInfo(`[extra-sessions] notice ${event} sent to ${party} ${userId}`)
          ),
          Effect.catchAll((error) =>
            Effect.logWarning(`extra session notice ${event} not sent`, error)
          )
        );
    }
  }).pipe(
    Effect.catchAll((error) => Effect.logWarning(`extra session notice ${event} failed`, error))
  );
