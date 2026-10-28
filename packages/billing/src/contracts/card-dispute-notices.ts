import type { Contract } from '@repo/db';
import { formatMailMoney, formatMailShortDay, Mailer, type MailLocale } from '@repo/mail';
import { publishNotificationBestEffort } from '@repo/notify';
import { Effect } from 'effect';
import { payoutsPolicy } from '../payouts';
import { personName } from './notices';

/**
 * Card dispute notices to the parties (Tier 3 step 4, umbrella §9). Founder
 * rules: the family is never emailed about their own bank dispute — only, if
 * an admin suspends their contracts, a neutral "under review" notice; the
 * helper is told when a contract is paused or resumed, and when a lost
 * dispute is recovered from their future payouts (with the reason). Each in
 * the recipient's language; best-effort (a failed send never undoes the
 * action that caused it).
 */

export type CardDisputeNoticeKind = 'review_suspended' | 'review_resumed' | 'helper_recovery';
export type CardDisputeNoticeParty = 'family' | 'helper';

export type CardDisputeNoticeContext = {
  contract: Contract;
  /** helper_recovery: the session, what the helper bears, and why. */
  session?: { date: string; serviceName: string } | null;
  amountCents?: number;
  /** helper_recovery: deducted from future payouts (pay already sent), or
   * simply not paid (pay not sent yet). */
  recovered?: boolean;
  reason?: string | null;
};

type Copy = { subject: string; paragraphs: Array<string>; linkLabel: string };

/** The copy for one notice, one party, one language (exported for tests);
 * null when that party gets no mail for it. */
export const cardDisputeNoticeCopy = (
  kind: CardDisputeNoticeKind,
  party: CardDisputeNoticeParty,
  ctx: CardDisputeNoticeContext,
  names: { family: string; helper: string },
  locale: MailLocale
): Copy | null => {
  const amount = formatMailMoney(ctx.amountCents ?? 0, locale);
  const day = ctx.session ? formatMailShortDay(ctx.session.date, locale) : '';
  const service = ctx.session?.serviceName ?? '';
  const other = party === 'family' ? names.helper : names.family;
  if (locale === 'fr') {
    switch (kind) {
      case 'review_suspended':
        return party === 'family'
          ? {
              subject: 'Votre contrat est en cours de vérification',
              paragraphs: [
                `Notre équipe vérifie un paiement lié à votre compte. Pendant cette vérification, votre contrat avec ${other} est suspendu : aucune nouvelle séance n’est facturée ni prévue.`,
                'Nous communiquerons avec vous. Si vous avez des questions, répondez simplement à ce courriel.'
              ],
              linkLabel: 'Voir le contrat'
            }
          : {
              subject: `Contrat avec ${other} suspendu`,
              paragraphs: [
                `Notre équipe vérifie un paiement de la famille. Le contrat avec ${other} est suspendu en attendant : les séances à venir ne sont pas financées, veuillez ne pas les effectuer.`,
                'Les séances déjà effectuées et payées ne sont pas touchées. Nous vous écrirons dès que le contrat reprend.'
              ],
              linkLabel: 'Voir le contrat'
            };
      case 'review_resumed':
        return {
          subject: `Contrat avec ${other} repris`,
          paragraphs: [
            `La vérification est terminée : votre contrat avec ${other} reprend selon son horaire habituel.`
          ],
          linkLabel: 'Voir le contrat'
        };
      case 'helper_recovery':
        if (party !== 'helper') return null;
        return {
          subject: `Paiement de la séance du ${day} contesté`,
          paragraphs: [
            `La banque de ${other} a annulé le paiement de la séance ${service} du ${day}. Après examen, notre équipe a conclu que la séance n’a pas été fournie.`,
            ctx.recovered
              ? `${amount} déjà versés pour cette séance seront déduits de vos prochains paiements. Vos paiements passés ne sont pas annulés.`
              : `${amount} pour cette séance ne vous seront pas versés.`,
            ...(ctx.reason ? [`Motif : ${ctx.reason}`] : []),
            'Si vous n’êtes pas d’accord, répondez à ce courriel avec ce qui montre que la séance a eu lieu.'
          ],
          linkLabel: 'Voir mes paiements'
        };
    }
  }
  switch (kind) {
    case 'review_suspended':
      return party === 'family'
        ? {
            subject: 'Your contract is under review',
            paragraphs: [
              `Our team is reviewing a payment on your account. While we do, your contract with ${other} is paused: no new sessions are charged or scheduled.`,
              "We'll be in touch. If you have any questions, just reply to this email."
            ],
            linkLabel: 'View the contract'
          }
        : {
            subject: `Contract with ${other} paused`,
            paragraphs: [
              `Our team is reviewing a payment from the family. Your contract with ${other} is paused meanwhile: upcoming sessions are not funded, so please don't work them.`,
              "Sessions you already worked and were paid for aren't affected. We'll email you as soon as the contract resumes."
            ],
            linkLabel: 'View the contract'
          };
    case 'review_resumed':
      return {
        subject: `Contract with ${other} resumed`,
        paragraphs: [`The review is over: your contract with ${other} resumes on its usual schedule.`],
        linkLabel: 'View the contract'
      };
    case 'helper_recovery':
      if (party !== 'helper') return null;
      return {
        subject: `Payment for ${day} disputed`,
        paragraphs: [
          `${other}'s bank reversed the payment for ${service} on ${day}. After reviewing it, our team found that the session was not provided.`,
          ctx.recovered
            ? `${amount} already paid to you for this session will be deducted from your next payouts. Past payouts are not reversed.`
            : `${amount} for this session will not be paid to you.`,
          ...(ctx.reason ? [`Reason: ${ctx.reason}`] : []),
          "If you disagree, reply to this email with anything that shows the session took place."
        ],
        linkLabel: 'View my payouts'
      };
  }
};

/** Emails the notice to the given parties and nudges their open pages. */
export const sendCardDisputeNotice = (
  kind: CardDisputeNoticeKind,
  parties: ReadonlyArray<CardDisputeNoticeParty>,
  ctx: CardDisputeNoticeContext
) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    const { appWebOrigin } = yield* payoutsPolicy;
    const family = yield* personName(ctx.contract.familyUserId);
    const helper = yield* personName(ctx.contract.providerUserId);
    for (const party of parties) {
      const userId = party === 'family' ? ctx.contract.familyUserId : ctx.contract.providerUserId;
      const me = party === 'family' ? family : helper;
      yield* publishNotificationBestEffort(userId, {
        type: 'contract.billing',
        payload: { contractId: ctx.contract.id, kind }
      });
      const copy = cardDisputeNoticeCopy(
        kind,
        party,
        ctx,
        { family: family.name, helper: helper.name },
        me.locale
      );
      if (copy === null) continue;
      if (!me.email) {
        yield* Effect.logWarning(`[card-dispute] notice ${kind} skipped: no email on file`);
        continue;
      }
      yield* mailer
        .sendContractBillingNotice({
          email: me.email,
          name: me.firstName,
          subject: copy.subject,
          paragraphs: copy.paragraphs,
          link:
            kind === 'helper_recovery'
              ? `${appWebOrigin}/service-provider/payouts`
              : `${appWebOrigin}/${party === 'family' ? 'family' : 'service-provider'}/contracts/${ctx.contract.id}`,
          linkLabel: copy.linkLabel,
          locale: me.locale
        })
        .pipe(
          Effect.catchAll((error) => Effect.logWarning(`card dispute notice ${kind} not sent`, error))
        );
    }
  }).pipe(Effect.catchAll((error) => Effect.logWarning(`card dispute notice ${kind} failed`, error)));
