import { addDays, dateIn } from '@repo/calendar';
import type { Contract, ContractVersion } from '@repo/db';

/**
 * When a contract stops working — shared by the contract routes (what the
 * detail shows) and billing (which sessions and cycles exist), so the two can
 * never disagree.
 */

/** The notice period is part of the agreed terms ("either side can end with
 * 2 weeks' notice"), not an operational knob. */
export const END_NOTICE_DAYS = 14;

/** Last working day of the notice flow: the notice moment's calendar date in
 * the contract zone plus 14 calendar days — derived, never stored. */
export const noticeEndsOn = (
  contract: Pick<Contract, 'endNoticedAt'>,
  accepted: Pick<ContractVersion, 'timeZone'> | null
) =>
  contract.endNoticedAt !== null && accepted?.timeZone
    ? addDays(dateIn(contract.endNoticedAt, accepted.timeZone), END_NOTICE_DAYS)
    : null;

/** The date the contract actually stops working — the earlier of the notice
 * flow's last working day and the negotiated end-date term — and which one it
 * was. Only a negotiated end carries a last-day end time; on a tie the
 * negotiated end wins so its end time still applies. */
export const effectiveEnd = (
  contract: Pick<Contract, 'endNoticedAt'>,
  accepted: Pick<ContractVersion, 'timeZone' | 'endsOn' | 'endsAtMinutes'> | null
) => {
  const notice = noticeEndsOn(contract, accepted);
  const negotiated = accepted?.endsOn ?? null;
  if (negotiated !== null && (notice === null || negotiated <= notice)) {
    return {
      endsOn: negotiated,
      source: 'negotiated' as const,
      endsAtMinutes: accepted?.endsAtMinutes ?? null
    };
  }
  if (notice !== null) {
    return { endsOn: notice, source: 'notice' as const, endsAtMinutes: null };
  }
  return null;
};

export const effectiveEndsOn = (
  contract: Pick<Contract, 'endNoticedAt'>,
  accepted: Pick<ContractVersion, 'timeZone' | 'endsOn' | 'endsAtMinutes'> | null
) => effectiveEnd(contract, accepted)?.endsOn ?? null;
