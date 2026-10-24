/** The languages a mail can be written in. Mirrors the web app's Paraglide
 * locales and `user_profile.language`. */
export type MailLocale = 'en' | 'fr';

export const mailLocales = ['en', 'fr'] as const satisfies ReadonlyArray<MailLocale>;

export const defaultMailLocale: MailLocale = 'en';

/** Normalises a stored or requested language ('fr', 'fr-CA', 'FR', null…)
 * to a mail locale. Anything that is not French is English. */
export const toMailLocale = (value: string | null | undefined): MailLocale =>
  typeof value === 'string' && /^fr(?:[-_]|$)/i.test(value.trim()) ? 'fr' : 'en';

/** The Intl locale mails are formatted in: Canadian English or French. */
export const intlLocale = (locale: MailLocale) => (locale === 'fr' ? 'fr-CA' : 'en-CA');

/** CAD amount: "$125.00" in English, "125,00 $" in French. */
export const formatMailMoney = (cents: number, locale: MailLocale = defaultMailLocale) =>
  new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'CAD' }).format(
    cents / 100
  );

const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date (a `Date` read in UTC, or a 'YYYY-MM-DD' string):
 * "2027-01-01" in English (the historical format), "1 janvier 2027" in
 * French. A string that is not a date-only value is returned as is. */
export const formatMailDate = (value: Date | string, locale: MailLocale = defaultMailLocale) => {
  if (typeof value === 'string' && !isoDateOnly.test(value)) {
    return value;
  }
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
  return locale === 'fr'
    ? new Intl.DateTimeFormat('fr-CA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(date)
    : new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'UTC'
      }).format(date);
};

/** A short day for billing notices: "Fri, Jan 1" / "ven. 1 janv.". */
export const formatMailShortDay = (date: string, locale: MailLocale = defaultMailLocale) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00.000Z`));
