import type { Vouch, VoucherStanding, VouchStatus, VouchWithVoucher } from '@repo/db';
import { vouchRequestTtlMs } from './constants';

/**
 * The vouch rules, in one place and free of I/O. Nothing here is stored:
 * whether a vouch has expired or still counts is decided at read time from
 * the row and the voucher's CURRENT standing, so a voucher who is banned or
 * loses their approval stops counting the moment it happens.
 *
 * Vouches never gate approval — these answers drive the applicant's nudge
 * and the admin queue only.
 */

export type PresentedVouchStatus = VouchStatus | 'expired';

export const presentedVouchStatus = (
  vouch: Pick<Vouch, 'status' | 'expiresAt'>,
  now: Date
): PresentedVouchStatus =>
  vouch.status === 'pending' && vouch.expiresAt <= now ? 'expired' : vouch.status;

export const isBannedNow = (
  account: { banned: boolean | null; banExpires: Date | null },
  now: Date
) => account.banned === true && (account.banExpires === null || account.banExpires > now);

/** Families and helpers alike: approved, verified email, not banned. */
export const canVouch = (standing: VoucherStanding, now: Date) =>
  !isBannedNow(standing, now) && standing.emailVerified && standing.hasLiveApproval;

export const vouchCounts = (vouch: VouchWithVoucher, now: Date) =>
  presentedVouchStatus(vouch, now) === 'accepted' && canVouch(vouch.voucher, now);

export const summariseVouches = (vouches: Array<VouchWithVoucher>, now: Date) => {
  // Distinct vouchers: one person can never fill two slots.
  const counting = new Set(
    vouches.filter((vouch) => vouchCounts(vouch, now)).map((vouch) => vouch.voucherUserId)
  );
  const hasConcern = vouches.some(
    (vouch) =>
      vouch.status === 'flagged' ||
      (vouch.status === 'accepted' && vouch.answers?.hasConcerns === true)
  );
  return { counting: counting.size, hasConcern };
};

/** What the applicant may see. Flagged, revoked and a voucher who lost
 * standing all collapse into one vague state, so nobody learns which
 * voucher raised a concern or why. */
export type ApplicantVouchStatus = 'pending' | 'completed' | 'declined' | 'expired' | 'not_counted';

export const applicantVouchStatus = (vouch: VouchWithVoucher, now: Date): ApplicantVouchStatus => {
  switch (presentedVouchStatus(vouch, now)) {
    case 'pending':
      return 'pending';
    case 'declined':
      return 'declined';
    case 'expired':
      return 'expired';
    case 'accepted':
      return canVouch(vouch.voucher, now) ? 'completed' : 'not_counted';
    default:
      return 'not_counted';
  }
};

/**
 * Whether this pair's history stops the applicant asking the same voucher
 * again. An admin flag or admin revoke closes the pair for good; the voucher
 * declining or withdrawing closes it for one request window, so a "no"
 * can't be turned into a stream of fresh requests.
 */
export const pairBlocksNewRequest = (
  history: ReadonlyArray<Vouch>,
  voucherUserId: string,
  now: Date
) =>
  history.some((vouch) => {
    const byVoucher = vouch.revokedBy === voucherUserId;
    if (vouch.status === 'flagged' || (vouch.status === 'revoked' && !byVoucher)) return true;
    if (vouch.status === 'declined' || vouch.status === 'revoked') {
      const decidedAt = vouch.decidedAt ?? vouch.updatedAt;
      return now.getTime() - decidedAt.getTime() < vouchRequestTtlMs;
    }
    return false;
  });
