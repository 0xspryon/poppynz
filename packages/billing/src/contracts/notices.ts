import { UserProfileRepo, UserRepo, type Contract, type ContractCycle } from '@repo/db';
import { Mailer } from '@repo/mail';
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

const dollars = (cents: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);

const day = (date: string) =>
  new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00.000Z`));

export const cycleDates = (cycle: Pick<ContractCycle, 'startsOn' | 'endsOn'>) =>
  cycle.startsOn === cycle.endsOn
    ? day(cycle.startsOn)
    : `${day(cycle.startsOn)} – ${day(cycle.endsOn)}`;

type NoticeContext = {
  contract: Contract;
  cycle?: Pick<ContractCycle, 'startsOn' | 'endsOn'> | null;
  amountCents?: number | null;
  /** readiness_reminder: days until the start date (0 = acceptance). */
  daysToStart?: number;
  startsOn?: string;
};

type Copy = { subject: string; paragraphs: Array<string>; linkLabel: string };

const copyFor = (
  kind: BillingNoticeKind,
  party: NoticeParty,
  context: NoticeContext,
  counterpart: string
): Copy | null => {
  const dates = context.cycle ? cycleDates(context.cycle) : '';
  const amount = context.amountCents != null ? dollars(context.amountCents) : '';
  switch (kind) {
    case 'readiness_reminder':
      return party === 'helper'
        ? {
            subject: 'Set up your payout account so your contract can start',
            paragraphs: [
              `Your contract with ${counterpart} starts on ${context.startsOn ? day(context.startsOn) : 'its start date'}, but your payout account isn't ready yet.`,
              'Until it is, the family is not charged and the contract cannot start. If it is still not ready when the first payment is due, the contract is cancelled.'
            ],
            linkLabel: 'Set up payouts'
          }
        : {
            subject: `${counterpart} hasn't finished setting up payouts yet`,
            paragraphs: [
              `Your contract with ${counterpart} starts on ${context.startsOn ? day(context.startsOn) : 'its start date'}, but their payout account isn't ready yet. Nothing has been charged.`,
              'If it is still not ready when the first payment is due, the contract is cancelled and you are not charged.'
            ],
            linkLabel: 'View the contract'
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
        linkLabel: 'View the contract'
      };
    case 'hold_declined':
      return {
        subject: 'Your card was declined — update it to keep your care booked',
        paragraphs: [
          `We couldn't place the ${amount} hold for your care with ${counterpart} on ${dates}.`,
          'Please update your card before the first day of these dates. We will try again automatically, and straight away when you replace the card. If it still fails, these sessions are suspended.'
        ],
        linkLabel: 'Update your card'
      };
    case 'payment_pending':
      return {
        subject: `Payment for ${dates} is pending`,
        paragraphs: [
          `${counterpart}'s payment for ${dates} hasn't gone through yet. We are retrying it.`,
          "We'll let you know before the first session whether these dates go ahead."
        ],
        linkLabel: 'View the contract'
      };
    case 'suspended':
      return party === 'helper'
        ? {
            subject: `Don't work ${dates} — payment hasn't been received`,
            paragraphs: [
              `The payment for your sessions with ${counterpart} on ${dates} wasn't received, so the contract is suspended.`,
              'Please do not work these sessions: suspended days are never billed. We will email you as soon as it resumes.'
            ],
            linkLabel: 'View the contract'
          }
        : {
            subject: `Your care on ${dates} is suspended`,
            paragraphs: [
              `We couldn't take the payment for your care with ${counterpart} on ${dates}, so the contract is suspended and ${counterpart} has been told not to work.`,
              'Suspended days are never billed. Update your card to resume: the rest of these dates is charged straight away.'
            ],
            linkLabel: 'Update your card'
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
        linkLabel: 'View the contract'
      };
    case 'helper_not_ready':
      return party === 'helper'
        ? {
            subject: 'Your payout account needs attention',
            paragraphs: [
              `Your payout account isn't ready, so the payment for ${dates} with ${counterpart} can't be taken and those sessions can't go ahead.`,
              'Fix your payout account to continue: the contract resumes automatically once it is ready.'
            ],
            linkLabel: 'Fix payouts'
          }
        : {
            subject: `Your care on ${dates} is on hold`,
            paragraphs: [
              `${counterpart}'s payout account needs attention, so we haven't charged you for ${dates} and those sessions can't go ahead yet.`,
              'You do not need to do anything. The contract resumes automatically once their account is ready.'
            ],
            linkLabel: 'View the contract'
          };
    case 'charge_failed':
      return party === 'family'
        ? {
            subject: 'We still could not charge your card',
            paragraphs: [
              `The ${amount} charge for your care with ${counterpart} on ${dates} was declined. Your contract stays suspended.`,
              'Please replace your card to resume.'
            ],
            linkLabel: 'Update your card'
          }
        : null;
  }
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
      name: displayName(profile, user?.name ?? 'Poppynz member')
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
      const copy = copyFor(kind, party, context, other.name);
      if (!copy || !me.email) continue;
      const card = copy.linkLabel === 'Update your card';
      const payouts = copy.linkLabel === 'Set up payouts' || copy.linkLabel === 'Fix payouts';
      const link = card
        ? `${appWebOrigin}/family/billing`
        : payouts
          ? `${appWebOrigin}/service-provider/payouts`
          : `${appWebOrigin}/${party === 'family' ? 'family' : 'service-provider'}/contracts/${context.contract.id}`;
      yield* mailer
        .sendContractBillingNotice({
          email: me.email,
          name: me.firstName,
          subject: copy.subject,
          paragraphs: copy.paragraphs,
          link,
          linkLabel: copy.linkLabel
        })
        .pipe(
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
