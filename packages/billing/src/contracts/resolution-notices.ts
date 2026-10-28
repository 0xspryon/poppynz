import type {
  Contract,
  SessionRecord,
  SessionResolution,
  SessionResolutionDecision,
  SessionResolutionKind
} from '@repo/db';
import { formatMailShortDay, intlLocale, Mailer, type MailLocale } from '@repo/mail';
import { publishNotificationBestEffort } from '@repo/notify';
import { Effect } from 'effect';
import { payoutsPolicy } from '../payouts';
import { alertAdmins, personName, type NoticeParty } from './notices';

/**
 * Session-resolution notices (Tier 3, spec §3a): every recorded, confirmed,
 * contested, declined, lapsed and decided event emails BOTH parties, each in
 * their own language, plus a realtime `contract.session` event; a contest
 * also alerts the admins. A helper's cancellation tells the family how to
 * find a replacement (copy only for now: the link opens Find help filtered
 * by the session's service; the templated replacement flow is step 1b).
 * Best-effort, like billing notices: a failed send is logged and never
 * undoes the change that caused it. No money is mentioned — step 1 doesn't
 * change any amount.
 */

export type ResolutionEvent =
  | 'recorded'
  | 'confirmed'
  | 'contested'
  | 'declined'
  | 'lapsed'
  | 'decided';

export type ResolutionNoticeContext = {
  contract: Contract;
  session: Pick<
    SessionRecord,
    'id' | 'cycleId' | 'date' | 'startMinutes' | 'endMinutes' | 'elapsedMinutes' | 'serviceName'
  >;
  resolution: SessionResolution;
  /** The contract zone (deadlines are shown in it). */
  zone: string;
  policy: { cancellationNoticeHours: number; reportResponseHours: number };
};

type Copy = {
  subject: string;
  paragraphs: Array<string>;
  replacement?: { intro: string; label: string };
};

/** The formatted pieces a notice's sentences carry. */
export type NoticeValues = {
  /** Who acted ("Maria T."), or null when it was the recipient. */
  actor: string | null;
  /** The other party's name, from the recipient's point of view. */
  counterpart: string;
  /** "Childcare, Tue, Nov 3, 3:30 p.m.–5:30 p.m." */
  session: string;
  day: string;
  service: string;
  /** The response deadline in the contract zone ('' without one). */
  deadline: string;
  noticeHours: number;
  responseHours: number;
  /** "1.5 h of 2 h" for reduced hours ('' otherwise). */
  worked: string;
  note: string | null;
  decision: string;
  decisionReason: string;
};

const clock = (minutes: number, locale: MailLocale) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
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
    timeZone: zone
  }).format(at);

const hours = (minutes: number, locale: MailLocale) =>
  new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(minutes / 60);

/** The kind as a phrase inside a sentence. */
const kindPhrase: Record<MailLocale, Record<SessionResolutionKind | 'as_scheduled', string>> = {
  en: {
    family_cancelled_early: 'an early cancellation by the family',
    family_cancelled_late: 'a late cancellation by the family',
    family_no_show: 'a family no-show',
    family_reduced_hours: 'reduced hours (an early dismissal)',
    helper_cancelled: 'a cancellation by the helper',
    helper_no_show: 'a helper no-show',
    day_off_agreed: 'an agreed day off',
    disputed: 'care that was not provided',
    as_scheduled: 'the session went ahead as scheduled'
  },
  fr: {
    family_cancelled_early: 'une annulation dans les délais par la famille',
    family_cancelled_late: 'une annulation tardive par la famille',
    family_no_show: 'une absence de la famille',
    family_reduced_hours: 'des heures réduites (fin hâtive)',
    helper_cancelled: 'une annulation par l’aidant(e)',
    helper_no_show: 'une absence de l’aidant(e)',
    day_off_agreed: 'un congé convenu',
    disputed: 'des services non fournis',
    as_scheduled: 'la séance a eu lieu comme prévu'
  }
};

export const resolutionKindPhrase = (
  kind: SessionResolutionKind | SessionResolutionDecision,
  locale: MailLocale = 'en'
) => kindPhrase[locale][kind];

const isCancellation = (kind: SessionResolutionKind) =>
  kind === 'family_cancelled_early' ||
  kind === 'family_cancelled_late' ||
  kind === 'helper_cancelled';

/** Whole sentences per locale. `mine`: the recipient acted. */
const copy: Record<
  MailLocale,
  (event: ResolutionEvent, r: SessionResolution, mine: boolean, v: NoticeValues) => Copy
> = {
  en: (event, r, mine, v) => {
    const what = kindPhrase.en[r.kind];
    const who = v.actor ?? 'You';
    switch (event) {
      case 'recorded':
        if (r.kind === 'helper_cancelled') {
          return mine
            ? {
                subject: `You cancelled ${v.day}`,
                paragraphs: [
                  `You cancelled ${v.session}. ${v.counterpart} has been told.`,
                  'If you change your mind, talk to them in your conversation.'
                ]
              }
            : {
                subject: `${who} cancelled ${v.day}`,
                paragraphs: [`${who} can't make ${v.session} and has cancelled it.`],
                replacement: {
                  intro: `Need care that day? Find another helper offering ${v.service} quickly — you can start a short contract based on this one.`,
                  label: 'Find a replacement'
                }
              };
        }
        if (isCancellation(r.kind)) {
          const timing =
            r.kind === 'family_cancelled_early'
              ? `It counts as an early cancellation: it was recorded at least ${v.noticeHours} hours before the session.`
              : `It counts as a late cancellation: it was recorded less than ${v.noticeHours} hours before the session.`;
          return mine
            ? {
                subject: `You cancelled ${v.day}`,
                paragraphs: [
                  `You cancelled ${v.session}. ${timing}`,
                  `${v.counterpart} has been told.`
                ]
              }
            : {
                subject: `${who} cancelled ${v.day}`,
                paragraphs: [
                  `${who} cancelled ${v.session}. ${timing}`,
                  "You don't need to work this session."
                ]
              };
        }
        if (r.kind === 'day_off_agreed') {
          return mine
            ? {
                subject: `You asked for a day off on ${v.day}`,
                paragraphs: [
                  `You asked ${v.counterpart} for a day off on ${v.session}.`,
                  `It only takes effect once they confirm. Without an answer by ${v.deadline} the request lapses and the session goes ahead.`
                ]
              }
            : {
                subject: `${who} asked for a day off on ${v.day}`,
                paragraphs: [
                  `${who} asked for a day off on ${v.session}.`,
                  `Please confirm or decline it by ${v.deadline}. Without an answer the request lapses and the session goes ahead.`
                ]
              };
        }
        if (r.kind === 'disputed') {
          return {
            subject: mine ? `You disputed ${v.day}` : `${who} disputed ${v.day}`,
            paragraphs: [
              mine
                ? `You reported that the care on ${v.session} was not provided.`
                : `${who} reported that the care on ${v.session} was not provided.`,
              'A Poppynz admin will review it and let you both know the outcome.'
            ]
          };
        }
        return mine
          ? {
              subject: `You reported ${what} for ${v.day}`,
              paragraphs: [
                `You reported ${what}${v.worked ? ` (${v.worked} worked)` : ''} for ${v.session}.`,
                `${v.counterpart} has until ${v.deadline} to accept or contest it. Without an answer it counts as accepted.`
              ]
            }
          : {
              subject: `${who} reported ${what} for ${v.day}`,
              paragraphs: [
                `${who} reported ${what}${v.worked ? ` (${v.worked} worked)` : ''} for ${v.session}.`,
                `If you disagree, contest it by ${v.deadline}. Without an answer it counts as accepted.`
              ]
            };
      case 'confirmed':
        if (r.kind === 'day_off_agreed') {
          return {
            subject: `Day off agreed for ${v.day}`,
            paragraphs: [`The day off on ${v.session} is agreed. Nobody works this session.`]
          };
        }
        return {
          subject: `Confirmed: ${what} on ${v.day}`,
          paragraphs: [
            r.respondedByUserId === null
              ? `The report of ${what} for ${v.session} is confirmed: no answer came within ${v.responseHours} hours.`
              : mine
                ? `You accepted the report of ${what} for ${v.session}.`
                : `${who} accepted the report of ${what} for ${v.session}.`
          ]
        };
      case 'contested':
        return {
          subject: `${v.day} is disputed`,
          paragraphs: [
            mine
              ? `You disputed ${what} for ${v.session}.`
              : `${who} disputed ${what} for ${v.session}.`,
            ...(v.note ? [`Statement: “${v.note}”`] : []),
            'A Poppynz admin will review it and let you both know the outcome.'
          ]
        };
      case 'declined':
        return {
          subject: `Day off declined for ${v.day}`,
          paragraphs: [
            mine
              ? `You declined the day off on ${v.session}. The session goes ahead as agreed.`
              : `${who} declined the day off on ${v.session}. The session goes ahead as agreed.`
          ]
        };
      case 'lapsed':
        return {
          subject: `Day-off request lapsed for ${v.day}`,
          paragraphs: [
            `The day-off request for ${v.session} wasn't confirmed before the cutoff, so it lapsed. The session goes ahead as agreed.`
          ]
        };
      case 'decided':
        return {
          subject: `Dispute decided for ${v.day}`,
          paragraphs: [
            `A Poppynz admin reviewed the dispute about ${v.session}. Outcome: ${v.decision}.`,
            `Reason: ${v.decisionReason}`
          ]
        };
    }
  },
  fr: (event, r, mine, v) => {
    const what = kindPhrase.fr[r.kind];
    const who = v.actor ?? 'Vous';
    switch (event) {
      case 'recorded':
        if (r.kind === 'helper_cancelled') {
          return mine
            ? {
                subject: `Vous avez annulé la séance du ${v.day}`,
                paragraphs: [
                  `Vous avez annulé la séance (${v.session}). ${v.counterpart} a été avisé(e).`,
                  'Si vous changez d’avis, parlez-en dans votre conversation.'
                ]
              }
            : {
                subject: `${who} a annulé la séance du ${v.day}`,
                paragraphs: [`${who} ne peut pas assurer la séance (${v.session}) et l’a annulée.`],
                replacement: {
                  intro: `Besoin de services ce jour-là? Trouvez rapidement un(e) autre aidant(e) qui offre ${v.service} — vous pouvez commencer un court contrat basé sur celui-ci.`,
                  label: 'Trouver un remplacement'
                }
              };
        }
        if (isCancellation(r.kind)) {
          const timing =
            r.kind === 'family_cancelled_early'
              ? `Il s’agit d’une annulation dans les délais : elle a été enregistrée au moins ${v.noticeHours} heures avant la séance.`
              : `Il s’agit d’une annulation tardive : elle a été enregistrée moins de ${v.noticeHours} heures avant la séance.`;
          return mine
            ? {
                subject: `Vous avez annulé la séance du ${v.day}`,
                paragraphs: [
                  `Vous avez annulé la séance (${v.session}). ${timing}`,
                  `${v.counterpart} a été avisé(e).`
                ]
              }
            : {
                subject: `${who} a annulé la séance du ${v.day}`,
                paragraphs: [
                  `${who} a annulé la séance (${v.session}). ${timing}`,
                  'Vous n’avez pas à travailler pendant cette séance.'
                ]
              };
        }
        if (r.kind === 'day_off_agreed') {
          return mine
            ? {
                subject: `Vous avez demandé un congé le ${v.day}`,
                paragraphs: [
                  `Vous avez demandé à ${v.counterpart} un congé pour la séance (${v.session}).`,
                  `Il ne s’applique qu’une fois confirmé. Sans réponse d’ici le ${v.deadline}, la demande expire et la séance a lieu.`
                ]
              }
            : {
                subject: `${who} demande un congé le ${v.day}`,
                paragraphs: [
                  `${who} demande un congé pour la séance (${v.session}).`,
                  `Veuillez l’accepter ou le refuser d’ici le ${v.deadline}. Sans réponse, la demande expire et la séance a lieu.`
                ]
              };
        }
        if (r.kind === 'disputed') {
          return {
            subject: mine
              ? `Vous avez contesté la séance du ${v.day}`
              : `${who} a contesté la séance du ${v.day}`,
            paragraphs: [
              mine
                ? `Vous avez signalé que les services prévus (${v.session}) n’ont pas été fournis.`
                : `${who} a signalé que les services prévus (${v.session}) n’ont pas été fournis.`,
              'Un administrateur de Poppynz examinera la situation et vous informera tous les deux de la décision.'
            ]
          };
        }
        return mine
          ? {
              subject: `Vous avez signalé ${what} (${v.day})`,
              paragraphs: [
                `Vous avez signalé ${what}${v.worked ? ` (${v.worked} travaillées)` : ''} pour la séance (${v.session}).`,
                `${v.counterpart} a jusqu’au ${v.deadline} pour l’accepter ou le contester. Sans réponse, le signalement est considéré comme accepté.`
              ]
            }
          : {
              subject: `${who} a signalé ${what} (${v.day})`,
              paragraphs: [
                `${who} a signalé ${what}${v.worked ? ` (${v.worked} travaillées)` : ''} pour la séance (${v.session}).`,
                `Si vous n’êtes pas d’accord, contestez-le d’ici le ${v.deadline}. Sans réponse, le signalement est considéré comme accepté.`
              ]
            };
      case 'confirmed':
        if (r.kind === 'day_off_agreed') {
          return {
            subject: `Congé convenu le ${v.day}`,
            paragraphs: [
              `Le congé pour la séance (${v.session}) est convenu. Personne ne travaille pendant cette séance.`
            ]
          };
        }
        return {
          subject: `Confirmé : ${what} (${v.day})`,
          paragraphs: [
            r.respondedByUserId === null
              ? `Le signalement (${what}) pour la séance (${v.session}) est confirmé : aucune réponse n’a été reçue dans les ${v.responseHours} heures.`
              : mine
                ? `Vous avez accepté le signalement (${what}) pour la séance (${v.session}).`
                : `${who} a accepté le signalement (${what}) pour la séance (${v.session}).`
          ]
        };
      case 'contested':
        return {
          subject: `La séance du ${v.day} est contestée`,
          paragraphs: [
            mine
              ? `Vous avez contesté ${what} pour la séance (${v.session}).`
              : `${who} a contesté ${what} pour la séance (${v.session}).`,
            ...(v.note ? [`Déclaration : « ${v.note} »`] : []),
            'Un administrateur de Poppynz examinera la situation et vous informera tous les deux de la décision.'
          ]
        };
      case 'declined':
        return {
          subject: `Congé refusé le ${v.day}`,
          paragraphs: [
            mine
              ? `Vous avez refusé le congé pour la séance (${v.session}). La séance a lieu comme convenu.`
              : `${who} a refusé le congé pour la séance (${v.session}). La séance a lieu comme convenu.`
          ]
        };
      case 'lapsed':
        return {
          subject: `Demande de congé expirée (${v.day})`,
          paragraphs: [
            `La demande de congé pour la séance (${v.session}) n’a pas été confirmée avant l’heure limite; elle a donc expiré. La séance a lieu comme convenu.`
          ]
        };
      case 'decided':
        return {
          subject: `Litige tranché (${v.day})`,
          paragraphs: [
            `Un administrateur de Poppynz a examiné le litige concernant la séance (${v.session}). Décision : ${v.decision}.`,
            `Motif : ${v.decisionReason}`
          ]
        };
    }
  }
};

/** Who acted for this event: the reporter, the responder, or an admin. */
const actorOf = (event: ResolutionEvent, r: SessionResolution): string | null => {
  switch (event) {
    case 'recorded':
      return r.reportedByUserId;
    case 'confirmed':
    case 'declined':
      return r.respondedByUserId;
    case 'contested':
      return r.respondedByUserId ?? r.reportedByUserId;
    case 'lapsed':
      return null;
    case 'decided':
      return r.decidedByUserId;
  }
};

/** The notice's copy for one party, in their language (exported for tests). */
export const resolutionCopyFor = (
  event: ResolutionEvent,
  party: NoticeParty,
  ctx: ResolutionNoticeContext,
  names: { family: string; helper: string },
  locale: MailLocale
): Copy => {
  const { contract, resolution: r, session } = ctx;
  const recipientId = party === 'family' ? contract.familyUserId : contract.providerUserId;
  const actorId = actorOf(event, r);
  const mine = actorId === recipientId;
  const actor =
    actorId === null || mine
      ? null
      : actorId === contract.familyUserId
        ? names.family
        : actorId === contract.providerUserId
          ? names.helper
          : 'Poppynz';
  const day = formatMailShortDay(session.date, locale);
  const worked =
    r.kind === 'family_reduced_hours' && r.minutesWorked !== null
      ? locale === 'fr'
        ? `${hours(r.minutesWorked, locale)} h sur ${hours(session.elapsedMinutes, locale)} h`
        : `${hours(r.minutesWorked, locale)} h of ${hours(session.elapsedMinutes, locale)} h`
      : '';
  const values: NoticeValues = {
    actor,
    counterpart: party === 'family' ? names.helper : names.family,
    day,
    service: session.serviceName,
    session: `${session.serviceName}, ${day}, ${clock(session.startMinutes, locale)}–${clock(session.endMinutes, locale)}`,
    deadline: r.respondBy ? instant(r.respondBy, ctx.zone, locale) : '',
    noticeHours: ctx.policy.cancellationNoticeHours,
    responseHours: ctx.policy.reportResponseHours,
    worked,
    note: event === 'contested' ? (r.responseNote ?? r.note) : null,
    decision: r.decision ? kindPhrase[locale][r.decision] : '',
    decisionReason: r.decisionReason ?? ''
  };
  return copy[locale](event, r, mine, values);
};

/** Emails both parties (each in their language) and nudges open pages. */
export const sendResolutionNotice = (event: ResolutionEvent, ctx: ResolutionNoticeContext) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    const { appWebOrigin } = yield* payoutsPolicy;
    const { contract, resolution, session } = ctx;
    const family = yield* personName(contract.familyUserId);
    const helper = yield* personName(contract.providerUserId);
    for (const party of ['family', 'helper'] as const) {
      const userId = party === 'family' ? contract.familyUserId : contract.providerUserId;
      const me = party === 'family' ? family : helper;
      yield* publishNotificationBestEffort(userId, {
        type: 'contract.session',
        payload: {
          contractId: contract.id,
          cycleId: session.cycleId,
          sessionId: session.id,
          resolutionId: resolution.id,
          event
        }
      });
      if (!me.email) {
        yield* Effect.logWarning(`[resolutions] notice ${event} to ${party} skipped: no email`);
        continue;
      }
      const text = resolutionCopyFor(
        event,
        party,
        ctx,
        { family: family.name, helper: helper.name },
        me.locale
      );
      const base = party === 'family' ? 'family' : 'service-provider';
      yield* mailer
        .sendContractBillingNotice({
          email: me.email,
          name: me.firstName,
          subject: text.subject,
          paragraphs: text.paragraphs,
          link: `${appWebOrigin}/${base}/contracts/${contract.id}/cycles/${session.cycleId}`,
          linkLabel: me.locale === 'fr' ? 'Voir la séance' : 'View the session',
          secondaryLink: text.replacement
            ? {
                intro: text.replacement.intro,
                label: text.replacement.label,
                href: `${appWebOrigin}/family/find?service=${encodeURIComponent(session.serviceName)}`
              }
            : null,
          locale: me.locale
        })
        .pipe(
          Effect.tap(() =>
            Effect.logInfo(`[resolutions] notice ${event} sent to ${party} ${userId}`)
          ),
          Effect.catchAll((error) =>
            Effect.logWarning(`resolution notice ${event} not sent`, error)
          )
        );
    }
    if (event === 'contested' || (event === 'recorded' && resolution.status === 'contested')) {
      yield* alertAdmins(`Session dispute on contract ${contract.id}`, [
        `${family.name} and ${helper.name}: ${kindPhrase.en[resolution.kind]} on ${session.serviceName}, ${session.date} is contested.`,
        `Review it: ${appWebOrigin}/admin/session-disputes/${resolution.id}`
      ]);
    }
  }).pipe(
    Effect.catchAll((error) => Effect.logWarning(`resolution notice ${event} failed`, error))
  );
