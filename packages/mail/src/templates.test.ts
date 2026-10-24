import { describe, expect, it } from 'bun:test';
import {
  formatMailDate,
  formatMailMoney,
  formatMailShortDay,
  toMailLocale,
  type MailLocale
} from './locale';
import {
  accountBannedMail,
  accountUnbannedMail,
  adminApprovalRequestSubmittedMail,
  adminBillingAlertMail,
  approvalExpiringMail,
  approvalGrantedMail,
  approvalRequestRejectedMail,
  approvalRequestSubmittedMail,
  approvalRevokedMail,
  contractBillingNoticeMail,
  familyWelcomeMail,
  magicLinkMail,
  providerWelcomeMail,
  referralInviteMail,
  safetyVerificationExpiringMail,
  safetyVerificationInviteMail,
  vouchRequestMail,
  type MailContent,
  type MailRole
} from './templates';

const expiresAt = new Date('2027-01-01T00:00:00.000Z');
const nbsp = ' ';

/** Every template, rendered for one locale and role. */
const allTemplates = (
  locale: MailLocale | undefined,
  role: MailRole
): Record<string, MailContent> => ({
  familyWelcome: familyWelcomeMail({
    name: 'Sam',
    profileLink: 'https://app.test/family/profile',
    needsLink: 'https://app.test/family/needs',
    documentsLink: 'https://app.test/family/documents',
    findLink: 'https://app.test/family/find',
    locale
  }),
  providerWelcome: providerWelcomeMail({
    name: 'Sam',
    profileLink: 'https://app.test/sp/profile',
    documentsLink: 'https://app.test/sp/documents',
    servicesLink: 'https://app.test/sp/services',
    approvalLink: 'https://app.test/sp/approval',
    findLink: 'https://app.test/sp/find',
    locale
  }),
  magicLink: magicLinkMail({ link: 'https://app.test/magic', locale }),
  referralInvite: referralInviteMail({
    inviterName: 'Maria',
    role,
    link: 'https://app.test/sign-up',
    locale
  }),
  vouchRequest: vouchRequestMail({
    applicantName: 'Maria',
    relationship: 'Voisine',
    link: 'https://app.test/vouches',
    locale
  }),
  approvalRequestSubmitted: approvalRequestSubmittedMail({ name: 'Sam', role, locale }),
  adminApprovalRequestSubmitted: adminApprovalRequestSubmittedMail({
    applicantName: 'Sam',
    applicantEmail: 'sam@example.com',
    role,
    locale
  }),
  approvalRequestRejected: approvalRequestRejectedMail({
    name: 'Sam',
    role,
    reason: 'Documents manquants',
    locale
  }),
  approvalGranted: approvalGrantedMail({ name: 'Sam', role, expiresAt, locale }),
  approvalRevoked: approvalRevokedMail({ name: 'Sam', role, reason: 'Plainte', locale }),
  approvalExpiring: approvalExpiringMail({
    name: 'Sam',
    role,
    expiresAt,
    daysRemaining: 5,
    link: 'https://app.test',
    locale
  }),
  safetyVerificationInvite: safetyVerificationInviteMail({
    name: 'Sam',
    link: 'https://app.test/check',
    locale
  }),
  safetyVerificationExpiring: safetyVerificationExpiringMail({
    name: 'Sam',
    role,
    expiresOn: '2027-01-01',
    daysRemaining: 1,
    link: 'https://app.test/verification',
    locale
  }),
  accountBanned: accountBannedMail({ name: 'Sam', reason: 'Fraude', locale }),
  accountUnbanned: accountUnbannedMail({ name: 'Sam', link: 'https://app.test/sign-in', locale }),
  contractBillingNotice: contractBillingNoticeMail({
    name: 'Sam',
    subject: 'Votre contrat a repris',
    paragraphs: ['Votre contrat a repris.'],
    link: 'https://app.test/contracts/1',
    linkLabel: 'Voir le contrat',
    locale
  }),
  adminBillingAlert: adminBillingAlertMail({ subject: 'Alerte', lines: ['Ligne'], locale })
});

/** English words that must never survive in a French mail. */
const englishLeftovers =
  /\b(Hi|the|your|you|and|with|sign in|email|helper|service provider|approval|Reason)\b/i;

/** The visible text of the html part (tags and the inline styles dropped). */
const visibleText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ');

describe('English mails (default locale)', () => {
  it('keeps the magic-link mail exactly as before', () => {
    const mail = magicLinkMail({ link: 'https://app.test/magic' });
    expect(mail.subject).toBe('Your Poppynz sign-in link');
    expect(mail.text).toBe(
      [
        'Hi,',
        '',
        'Use the link below to sign in to Poppynz. This link can only be used once.',
        '',
        'https://app.test/magic',
        '',
        "If you didn't request this email, you can safely ignore it."
      ].join('\n')
    );
    expect(mail.html).toContain('<html lang="en">');
    expect(mail.html).toContain(
      'You received this email because of activity on your Poppynz account.'
    );
    expect(mail.html).toContain('>Sign in to Poppynz</a>');
  });

  it('keeps the approval-granted mail exactly as before, with the ISO date', () => {
    const mail = approvalGrantedMail({ name: 'Sam', role: 'service-provider', expiresAt });
    expect(mail.subject).toBe("You're approved on Poppynz");
    expect(mail.text).toBe(
      [
        'Hi Sam,',
        '',
        "Great news — your approval request has been accepted. You're now an approved service provider on Poppynz and can be found by families searching for services.",
        '',
        'Your approval is valid until 2027-01-01.'
      ].join('\n')
    );
    expect(mail.html).toContain(
      'Great news — your approval request has been accepted. You&#39;re now an approved service provider'
    );
    expect(mail.html).toContain('Your approval is valid until <strong>2027-01-01</strong>.');
  });

  it('keeps the referral invite and safety-expiry copy', () => {
    const invite = referralInviteMail({
      inviterName: 'Maria Santos',
      role: 'family',
      link: 'https://app.test/sign-up'
    });
    expect(invite.subject).toBe('Maria Santos invited you to join Poppynz');
    expect(invite.text).toContain('Maria Santos invited you to join Poppynz as a family.');
    expect(invite.text).toContain('Accept your invite: https://app.test/sign-up');

    const expiring = safetyVerificationExpiringMail({
      name: null,
      role: 'family',
      expiresOn: '2027-01-01',
      daysRemaining: 5,
      link: 'https://app.test/v'
    });
    expect(expiring.subject).toBe('Your Poppynz safety verification expires in 5 days');
    expect(expiring.text).toContain(
      'Your Poppynz safety verification expires in 5 days, on 2027-01-01. Once it expires, you will not be able to make new bookings until it is renewed.'
    );
  });

  it('renders the same mail with locale "en" as with no locale', () => {
    for (const role of ['family', 'service-provider'] as const) {
      expect(allTemplates('en', role)).toEqual(allTemplates(undefined, role));
    }
  });
});

describe('French mails', () => {
  for (const role of ['family', 'service-provider'] as const) {
    const english = allTemplates('en', role);
    const french = allTemplates('fr', role);

    for (const [name, mail] of Object.entries(french)) {
      it(`${name} (${role}) is written in French`, () => {
        if (name !== 'contractBillingNotice') {
          // The billing notice's subject is composed by the caller.
          expect(mail.subject).not.toBe(english[name]!.subject);
        }
        expect(mail.subject).not.toMatch(englishLeftovers);
        expect(visibleText(mail.text)).not.toMatch(englishLeftovers);
        expect(visibleText(mail.html)).not.toMatch(englishLeftovers);
        expect(mail.html).toContain('<html lang="fr">');
        expect(mail.html).toContain(
          'Vous recevez ce courriel en raison d’une activité dans votre compte Poppynz.'
        );
        if (name !== 'adminBillingAlert') {
          expect(mail.text.split('\n')[0]).toMatch(/^Bonjour( Sam)?,$/);
        }
        // Typographic apostrophes only, and never a bare space before ":".
        expect(mail.text).not.toContain("'");
        expect(mail.text).not.toMatch(/ :/);
      });
    }
  }

  it('greets without a name as "Bonjour,"', () => {
    const mail = accountBannedMail({ name: null, reason: null, locale: 'fr' });
    expect(mail.text.startsWith('Bonjour,\n')).toBe(true);
    expect(mail.html).toContain('<p style="margin:0 0 16px;">Bonjour,</p>');
  });

  it('writes the magic-link mail in French', () => {
    const mail = magicLinkMail({ link: 'https://app.test/magic', locale: 'fr' });
    expect(mail.subject).toBe('Votre lien de connexion Poppynz');
    expect(mail.html).toContain('>Se connecter à Poppynz</a>');
    expect(mail.text).toContain(
      'Utilisez le lien ci-dessous pour vous connecter à Poppynz. Ce lien ne peut être utilisé qu’une seule fois.'
    );
  });

  it('labels links and reasons with a non-breaking space before the colon', () => {
    const invite = referralInviteMail({
      inviterName: 'Maria',
      role: 'service-provider',
      link: 'https://app.test/sign-up',
      locale: 'fr'
    });
    expect(invite.subject).toBe('Maria vous invite à vous joindre à Poppynz');
    expect(invite.text).toContain(
      'Maria vous invite à vous joindre à Poppynz en tant qu’aidant(e).'
    );
    expect(invite.text).toContain(`Accepter l’invitation${nbsp}: https://app.test/sign-up`);

    const rejected = approvalRequestRejectedMail({
      name: 'Sam',
      role: 'family',
      reason: 'Documents manquants',
      locale: 'fr'
    });
    expect(rejected.text).toContain(`Motif${nbsp}: Documents manquants`);
    expect(rejected.html).toContain(`<strong>Motif${nbsp}:</strong> Documents manquants`);
  });

  it('formats dates in fr-CA', () => {
    const granted = approvalGrantedMail({ name: 'Sam', role: 'family', expiresAt, locale: 'fr' });
    expect(granted.text).toContain('Votre approbation est valide jusqu’au 1 janvier 2027.');
    expect(granted.html).toContain('<strong>1 janvier 2027</strong>');

    const expiring = safetyVerificationExpiringMail({
      name: 'Sam',
      role: 'service-provider',
      expiresOn: '2027-01-01',
      daysRemaining: 1,
      link: 'https://app.test/v',
      locale: 'fr'
    });
    expect(expiring.subject).toBe('Votre vérification de sécurité Poppynz expire demain');
    expect(expiring.text).toContain('expire demain, le 1 janvier 2027.');

    const approval = approvalExpiringMail({
      name: 'Sam',
      role: 'family',
      expiresAt,
      daysRemaining: 14,
      link: 'https://app.test',
      locale: 'fr'
    });
    expect(approval.subject).toBe('Votre approbation Poppynz expire dans 14 jours');
  });
});

describe('locale helpers', () => {
  it('formats CAD money per locale', () => {
    expect(formatMailMoney(12500)).toBe('$125.00');
    expect(formatMailMoney(12500, 'en')).toBe('$125.00');
    expect(formatMailMoney(12500, 'fr')).toBe(`125,00${nbsp}$`);
  });

  it('formats calendar dates per locale', () => {
    expect(formatMailDate(expiresAt, 'en')).toBe('2027-01-01');
    expect(formatMailDate('2027-01-01', 'en')).toBe('2027-01-01');
    expect(formatMailDate(expiresAt, 'fr')).toBe('1 janvier 2027');
    expect(formatMailDate('2027-03-15', 'fr')).toBe('15 mars 2027');
    expect(formatMailDate('', 'fr')).toBe('');
    expect(formatMailShortDay('2027-01-01', 'en')).toBe('Fri, Jan 1');
    expect(formatMailShortDay('2027-01-01', 'fr')).toBe('ven. 1 janv.');
  });

  it('normalises stored languages to a mail locale', () => {
    expect(toMailLocale('fr')).toBe('fr');
    expect(toMailLocale('fr-CA')).toBe('fr');
    expect(toMailLocale('FR')).toBe('fr');
    expect(toMailLocale('en')).toBe('en');
    expect(toMailLocale('es')).toBe('en');
    expect(toMailLocale('french')).toBe('en');
    expect(toMailLocale(null)).toBe('en');
    expect(toMailLocale(undefined)).toBe('en');
  });
});
