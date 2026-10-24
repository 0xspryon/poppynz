import type { ContactDetailKind } from '@repo/db';

/**
 * Recognises contact details typed into chat (UAT #38). Sharing them stays
 * allowed — this only decides when both people are warned that dealings off
 * Poppynz aren't covered, and when that warning is recorded.
 *
 * Deliberately simple and a little generous: a missed number is worse than
 * an extra warning. Phone: 10+ digits allowing spaces, dots, dashes and
 * brackets (North American and international). Email: the usual local@domain.
 * Link: http(s)://, www., or a bare domain with a common TLD.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const LINK =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|ca|net|org|io|co|me|app|ly|info|biz)\b(?:\/\S*)?/i;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{8,}\d/g;

const hasPhone = (text: string) =>
  (text.match(PHONE_CANDIDATE) ?? []).some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  });

export const detectContactDetails = (body: string): Array<ContactDetailKind> => {
  const kinds: Array<ContactDetailKind> = [];
  if (hasPhone(body)) kinds.push('phone');
  const withoutEmails = body.replace(new RegExp(EMAIL.source, 'gi'), ' ');
  if (EMAIL.test(body)) kinds.push('email');
  // An email's domain is not a separate link.
  if (LINK.test(withoutEmails)) kinds.push('link');
  return kinds;
};
