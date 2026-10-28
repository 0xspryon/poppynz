import { defaultMailLocale, formatMailDate, type MailLocale } from './locale';

/** The roles a mail can address. Mirrors the invitable roles in the api's
 * auth model without depending on it. */
export type MailRole = 'family' | 'service-provider';

export type MailContent = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Copy conventions
 *
 * Every template keeps its copy in a `Record<MailLocale, …>` object: whole
 * sentences per locale (functions where a sentence carries a value), never
 * translated fragments glued together. The template skeleton — which
 * paragraphs exist and which are HTML-escaped — is shared, so the English
 * output stays exactly what it was before French existed.
 *
 * French (Canada): formal "vous", typographic apostrophe ’, a non-breaking
 * space ( ) before ":", "courriel", and one term for helpers and service
 * providers alike: "aidant(e)" / "aidant(e)s".
 */

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Picks a role-specific value. */
const byRole = <T>(role: MailRole, values: { family: T; 'service-provider': T }) => values[role];

const greetings: Record<MailLocale, (name: string | null) => string> = {
  en: (name) => (name ? `Hi ${name},` : 'Hi,'),
  fr: (name) => (name ? `Bonjour ${name},` : 'Bonjour,')
};

/** A labelled line in the plain-text part: "Get started: https://…". */
const labelled: Record<MailLocale, (label: string, value: string) => string> = {
  en: (label, value) => `${label}: ${value}`,
  fr: (label, value) => `${label} : ${value}`
};

const reasonLabel: Record<MailLocale, string> = {
  en: 'Reason:',
  fr: 'Motif :'
};

const layoutCopy: Record<MailLocale, { footer: string }> = {
  en: { footer: 'You received this email because of activity on your Poppynz account.' },
  fr: { footer: 'Vous recevez ce courriel en raison d’une activité dans votre compte Poppynz.' }
};

const layout = (paragraphsHtml: string, locale: MailLocale) => `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;padding:0;background-color:#f5f5f4;font-family:Helvetica,Arial,sans-serif;color:#1c1917;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:20px;font-weight:700;margin:0 0 24px;">Poppynz</p>
      <div style="background:#ffffff;border-radius:12px;padding:24px;font-size:15px;line-height:1.6;">
        ${paragraphsHtml}
      </div>
      <p style="font-size:12px;color:#78716c;margin:24px 0 0;">
        ${layoutCopy[locale].footer}
      </p>
    </div>
  </body>
</html>`;

const paragraph = (html: string) => `<p style="margin:0 0 16px;">${html}</p>`;

// Mirrors the app's primary CTA: Sky Action blue, pill-shaped
// (--color-primary / .btn-primary in apps/web/src/app.css).
const button = (href: string, label: string) =>
  `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#37b5ff;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 24px;font-weight:600;">${escapeHtml(label)}</a></p>`;

type Step = { text: string; href: string; linkLabel: string };
type StepCopy = { text: string; linkLabel: string };

const numberedSteps = (steps: ReadonlyArray<Step>) =>
  `<ol style="margin:0 0 16px;padding-left:20px;">${steps
    .map(
      (step) =>
        `<li style="margin:0 0 12px;">${escapeHtml(step.text)}<br /><a href="${escapeHtml(step.href)}" style="color:#37b5ff;font-weight:600;text-decoration:none;">${escapeHtml(step.linkLabel)}</a></li>`
    )
    .join('')}</ol>`;

const numberedStepsText = (steps: ReadonlyArray<{ text: string; href: string }>) =>
  steps.flatMap((step, index) => [`${index + 1}. ${step.text}`, `   ${step.href}`]).join('\n');

// --- welcome mails -----------------------------------------------------------

const familyWelcomeCopy: Record<
  MailLocale,
  {
    subject: string;
    intro: string;
    location: StepCopy;
    needs: StepCopy;
    safety: StepCopy;
    find: StepCopy;
    button: string;
  }
> = {
  en: {
    subject: "Welcome to Poppynz — here's how to get started",
    intro:
      "Welcome to Poppynz! Every helper on our marketplace is identity- and background-vetted before families can find them — and every family completes a safety check before helpers can find them. Here's how to get set up:",
    location: {
      text: 'Set your home location. Searches are centered on it, and it lets vetted helpers nearby find your family.',
      linkLabel: 'Set your location'
    },
    needs: {
      text: "Tell us which services you need — regular childcare, after-school pickup, meal prep, anything you're looking for.",
      linkLabel: 'List the services you need'
    },
    safety: {
      text: 'Complete your safety check by uploading a vulnerable sector check from your local police service. Safety runs both ways on Poppynz — helpers only see families who have been verified, just as you only see vetted helpers.',
      linkLabel: 'Upload your safety check'
    },
    find: {
      text: 'Browse vetted helpers near you and find the right fit for your family.',
      linkLabel: 'Find help near you'
    },
    button: 'Get started'
  },
  fr: {
    subject: 'Bienvenue sur Poppynz — voici comment commencer',
    intro:
      'Bienvenue sur Poppynz! Chaque aidant(e) de notre plateforme fait l’objet d’une vérification d’identité et des antécédents avant que les familles puissent le ou la trouver — et chaque famille complète une vérification de sécurité avant que les aidant(e)s puissent la trouver. Voici comment bien commencer :',
    location: {
      text: 'Indiquez l’emplacement de votre domicile. Les recherches sont centrées sur celui-ci, et il permet aux aidant(e)s vérifié(e)s à proximité de trouver votre famille.',
      linkLabel: 'Indiquer votre emplacement'
    },
    needs: {
      text: 'Dites-nous de quels services vous avez besoin — garde d’enfants régulière, sortie d’école, préparation de repas, tout ce que vous recherchez.',
      linkLabel: 'Indiquer les services dont vous avez besoin'
    },
    safety: {
      text: 'Complétez votre vérification de sécurité en téléversant une vérification des antécédents judiciaires pour le secteur vulnérable obtenue auprès de votre service de police local. Sur Poppynz, la sécurité va dans les deux sens — les aidant(e)s ne voient que les familles vérifiées, tout comme vous ne voyez que des aidant(e)s vérifié(e)s.',
      linkLabel: 'Téléverser votre vérification de sécurité'
    },
    find: {
      text: 'Parcourez les profils d’aidant(e)s vérifié(e)s près de chez vous et trouvez la personne qui convient à votre famille.',
      linkLabel: 'Trouver de l’aide près de chez vous'
    },
    button: 'Commencer'
  }
};

export const familyWelcomeMail = (mail: {
  name: string | null;
  profileLink: string;
  needsLink: string;
  documentsLink: string;
  findLink: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = familyWelcomeCopy[locale];
  const greeting = greetings[locale](mail.name);
  // Mirrors the in-app getting-started checklist step for step — the safety
  // check is what makes a family discoverable, so it is a step, not a footnote.
  const steps: Array<Step> = [
    { ...copy.location, href: mail.profileLink },
    { ...copy.needs, href: mail.needsLink },
    { ...copy.safety, href: mail.documentsLink },
    { ...copy.find, href: mail.findLink }
  ];
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(copy.intro) +
        numberedSteps(steps) +
        button(mail.profileLink, copy.button),
      locale
    ),
    text: [
      greeting,
      '',
      copy.intro,
      '',
      numberedStepsText(steps),
      '',
      labelled[locale](copy.button, mail.profileLink)
    ].join('\n')
  };
};

const providerWelcomeCopy: Record<
  MailLocale,
  {
    subject: string;
    intro: string;
    profile: StepCopy;
    documents: StepCopy;
    services: StepCopy;
    approval: StepCopy;
    find: StepCopy;
    button: string;
  }
> = {
  en: {
    subject: "Welcome to Poppynz — here's how to get started",
    intro:
      "Welcome to Poppynz! Families here look for vetted helpers, so a complete, approved profile is how you get found. Here's how to get set up:",
    profile: {
      text: 'Complete your profile, including your location and a short bio families will see.',
      linkLabel: 'Set up your profile'
    },
    documents: {
      text: 'Upload your identity and background documents.',
      linkLabel: 'Upload your documents'
    },
    services: {
      text: 'Pick the services you offer and set your rates.',
      linkLabel: 'Set up services & rates'
    },
    approval: {
      text: 'Submit for approval — our team reviews every helper before they go live.',
      linkLabel: 'Request approval'
    },
    find: {
      text: "Once you're approved, browse families looking for help near you and find a great fit.",
      linkLabel: 'Find families'
    },
    button: 'Set up your profile'
  },
  fr: {
    subject: 'Bienvenue sur Poppynz — voici comment commencer',
    intro:
      'Bienvenue sur Poppynz! Les familles y recherchent des aidant(e)s vérifié(e)s : un profil complet et approuvé est donc la clé pour être trouvé(e). Voici comment bien commencer :',
    profile: {
      text: 'Complétez votre profil, y compris votre emplacement et une courte biographie que les familles verront.',
      linkLabel: 'Configurer votre profil'
    },
    documents: {
      text: 'Téléversez vos pièces d’identité et vos documents de vérification des antécédents.',
      linkLabel: 'Téléverser vos documents'
    },
    services: {
      text: 'Choisissez les services que vous offrez et fixez vos tarifs.',
      linkLabel: 'Configurer vos services et tarifs'
    },
    approval: {
      text: 'Soumettez votre demande d’approbation — notre équipe examine chaque aidant(e) avant sa mise en ligne.',
      linkLabel: 'Demander l’approbation'
    },
    find: {
      text: 'Une fois approuvé(e), parcourez les familles qui cherchent de l’aide près de chez vous et trouvez celle qui vous convient.',
      linkLabel: 'Trouver des familles'
    },
    button: 'Configurer votre profil'
  }
};

export const providerWelcomeMail = (mail: {
  name: string | null;
  profileLink: string;
  documentsLink: string;
  servicesLink: string;
  approvalLink: string;
  findLink: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = providerWelcomeCopy[locale];
  const greeting = greetings[locale](mail.name);
  const steps: Array<Step> = [
    { ...copy.profile, href: mail.profileLink },
    { ...copy.documents, href: mail.documentsLink },
    { ...copy.services, href: mail.servicesLink },
    { ...copy.approval, href: mail.approvalLink },
    { ...copy.find, href: mail.findLink }
  ];
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(copy.intro) +
        numberedSteps(steps) +
        button(mail.profileLink, copy.button),
      locale
    ),
    text: [
      greeting,
      '',
      copy.intro,
      '',
      numberedStepsText(steps),
      '',
      labelled[locale](copy.button, mail.profileLink)
    ].join('\n')
  };
};

// --- sign-in -----------------------------------------------------------------

const magicLinkCopy: Record<
  MailLocale,
  { subject: string; useButton: string; useLink: string; button: string; ignore: string }
> = {
  en: {
    subject: 'Your Poppynz sign-in link',
    useButton: 'Use the button below to sign in to Poppynz. This link can only be used once.',
    useLink: 'Use the link below to sign in to Poppynz. This link can only be used once.',
    button: 'Sign in to Poppynz',
    ignore: "If you didn't request this email, you can safely ignore it."
  },
  fr: {
    subject: 'Votre lien de connexion Poppynz',
    useButton:
      'Utilisez le bouton ci-dessous pour vous connecter à Poppynz. Ce lien ne peut être utilisé qu’une seule fois.',
    useLink:
      'Utilisez le lien ci-dessous pour vous connecter à Poppynz. Ce lien ne peut être utilisé qu’une seule fois.',
    button: 'Se connecter à Poppynz',
    ignore: 'Si vous n’avez pas demandé ce courriel, vous pouvez simplement l’ignorer.'
  }
};

export const magicLinkMail = (mail: { link: string; locale?: MailLocale }): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = magicLinkCopy[locale];
  const greeting = greetings[locale](null);
  return {
    subject: copy.subject,
    html: layout(
      paragraph(greeting) +
        paragraph(copy.useButton) +
        button(mail.link, copy.button) +
        paragraph(copy.ignore),
      locale
    ),
    text: [greeting, '', copy.useLink, '', mail.link, '', copy.ignore].join('\n')
  };
};

// --- referrals and vouches ---------------------------------------------------

const referralInviteCopy: Record<
  MailLocale,
  {
    subject: (inviter: string) => string;
    invited: (inviter: string, role: MailRole) => string;
    button: string;
    ignore: string;
  }
> = {
  en: {
    subject: (inviter) => `${inviter} invited you to join Poppynz`,
    invited: (inviter, role) =>
      byRole(role, {
        family: `${inviter} invited you to join Poppynz as a family.`,
        'service-provider': `${inviter} invited you to join Poppynz as a service provider.`
      }),
    button: 'Accept your invite',
    ignore: "If you weren't expecting this invitation, you can safely ignore it."
  },
  fr: {
    subject: (inviter) => `${inviter} vous invite à vous joindre à Poppynz`,
    invited: (inviter, role) =>
      byRole(role, {
        family: `${inviter} vous invite à vous joindre à Poppynz en tant que famille.`,
        'service-provider': `${inviter} vous invite à vous joindre à Poppynz en tant qu’aidant(e).`
      }),
    button: 'Accepter l’invitation',
    ignore: 'Si vous ne vous attendiez pas à cette invitation, vous pouvez simplement l’ignorer.'
  }
};

export const referralInviteMail = (mail: {
  inviterName: string;
  role: MailRole;
  link: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = referralInviteCopy[locale];
  const greeting = greetings[locale](null);
  return {
    subject: copy.subject(mail.inviterName),
    html: layout(
      paragraph(greeting) +
        paragraph(copy.invited(escapeHtml(mail.inviterName), mail.role)) +
        button(mail.link, copy.button) +
        paragraph(copy.ignore),
      locale
    ),
    text: [
      greeting,
      '',
      copy.invited(mail.inviterName, mail.role),
      '',
      labelled[locale](copy.button, mail.link),
      '',
      copy.ignore
    ].join('\n')
  };
};

const vouchRequestCopy: Record<
  MailLocale,
  {
    subject: (applicant: string) => string;
    askedHtml: (applicantHtml: string, relationshipHtml: string) => string;
    askedText: (applicant: string) => string;
    relationship: string;
    explainer: string;
    button: string;
    decline: string;
  }
> = {
  en: {
    subject: (applicant) => `${applicant} asked you to vouch for them on Poppynz`,
    askedHtml: (applicant, relationship) =>
      `${applicant} is applying to be a helper on Poppynz and asked you to vouch for them. They describe how they know you as: <i>${relationship}</i>.`,
    askedText: (applicant) =>
      `${applicant} is applying to be a helper on Poppynz and asked you to vouch for them.`,
    relationship: 'How they know you',
    explainer:
      'A vouch is a personal endorsement. Only say yes if you know this person and would trust them with care. Your answers are seen only by the Poppynz team, never by the applicant.',
    button: 'Review the request',
    decline: "If you don't know this person, decline the request."
  },
  fr: {
    subject: (applicant) => `${applicant} vous demande une recommandation sur Poppynz`,
    askedHtml: (applicant, relationship) =>
      `${applicant} présente une demande pour devenir aidant(e) sur Poppynz et vous demande une recommandation. Voici comment cette personne décrit votre relation : <i>${relationship}</i>.`,
    askedText: (applicant) =>
      `${applicant} présente une demande pour devenir aidant(e) sur Poppynz et vous demande une recommandation.`,
    relationship: 'Votre relation, selon cette personne',
    explainer:
      'Une recommandation est un appui personnel. N’acceptez que si vous connaissez cette personne et que vous lui feriez confiance pour prendre soin de vos proches. Vos réponses ne sont vues que par l’équipe Poppynz, jamais par la personne qui fait la demande.',
    button: 'Examiner la demande',
    decline: 'Si vous ne connaissez pas cette personne, refusez la demande.'
  }
};

export const vouchRequestMail = (mail: {
  applicantName: string;
  relationship: string;
  link: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = vouchRequestCopy[locale];
  const greeting = greetings[locale](null);
  return {
    subject: copy.subject(mail.applicantName),
    html: layout(
      paragraph(greeting) +
        paragraph(copy.askedHtml(escapeHtml(mail.applicantName), escapeHtml(mail.relationship))) +
        paragraph(copy.explainer) +
        button(mail.link, copy.button) +
        paragraph(copy.decline),
      locale
    ),
    text: [
      greeting,
      '',
      copy.askedText(mail.applicantName),
      labelled[locale](copy.relationship, mail.relationship),
      '',
      copy.explainer,
      '',
      labelled[locale](copy.button, mail.link),
      '',
      copy.decline
    ].join('\n')
  };
};

// --- approval requests -------------------------------------------------------

const approvalRequestSubmittedCopy: Record<
  MailLocale,
  { subject: string; body: (role: MailRole) => string; next: string }
> = {
  en: {
    subject: 'We received your approval request',
    body: (role) =>
      byRole(role, {
        family:
          'Your request to be approved as a family on Poppynz has been submitted. Our team will review your profile and documents.',
        'service-provider':
          'Your request to be approved as a service provider on Poppynz has been submitted. Our team will review your profile, documents, and services.'
      }),
    next: "We'll email you as soon as the review is complete."
  },
  fr: {
    subject: 'Nous avons reçu votre demande d’approbation',
    body: (role) =>
      byRole(role, {
        family:
          'Votre demande d’approbation en tant que famille sur Poppynz a été soumise. Notre équipe examinera votre profil et vos documents.',
        'service-provider':
          'Votre demande d’approbation en tant qu’aidant(e) sur Poppynz a été soumise. Notre équipe examinera votre profil, vos documents et vos services.'
      }),
    next: 'Nous vous enverrons un courriel dès que l’examen sera terminé.'
  }
};

export const approvalRequestSubmittedMail = (mail: {
  name: string | null;
  role: MailRole;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = approvalRequestSubmittedCopy[locale];
  const greeting = greetings[locale](mail.name);
  const body = copy.body(mail.role);
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) + paragraph(escapeHtml(body)) + paragraph(copy.next),
      locale
    ),
    text: [greeting, '', body, '', copy.next].join('\n')
  };
};

/** Admin-facing: callers send it in English; the French copy exists so every
 * template speaks both languages. */
const adminApprovalRequestSubmittedCopy: Record<
  MailLocale,
  {
    subject: (role: MailRole) => string;
    submitted: (applicant: string, role: MailRole) => string;
    review: string;
  }
> = {
  en: {
    subject: (role) =>
      byRole(role, {
        family: 'New family approval request',
        'service-provider': 'New service provider approval request'
      }),
    submitted: (applicant, role) =>
      byRole(role, {
        family: `${applicant} submitted a family approval request and is waiting for review.`,
        'service-provider': `${applicant} submitted a service provider approval request and is waiting for review.`
      }),
    review: 'Review the request in the Poppynz admin dashboard.'
  },
  fr: {
    subject: (role) =>
      byRole(role, {
        family: 'Nouvelle demande d’approbation d’une famille',
        'service-provider': 'Nouvelle demande d’approbation d’un(e) aidant(e)'
      }),
    submitted: (applicant, role) =>
      byRole(role, {
        family: `${applicant} a soumis une demande d’approbation en tant que famille et attend un examen.`,
        'service-provider': `${applicant} a soumis une demande d’approbation en tant qu’aidant(e) et attend un examen.`
      }),
    review: 'Examinez la demande dans le tableau de bord d’administration de Poppynz.'
  }
};

export const adminApprovalRequestSubmittedMail = (mail: {
  applicantName: string | null;
  applicantEmail: string;
  role: MailRole;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = adminApprovalRequestSubmittedCopy[locale];
  const greeting = greetings[locale](null);
  const applicant = mail.applicantName
    ? `${mail.applicantName} (${mail.applicantEmail})`
    : mail.applicantEmail;
  return {
    subject: copy.subject(mail.role),
    html: layout(
      paragraph(greeting) +
        paragraph(copy.submitted(`<strong>${escapeHtml(applicant)}</strong>`, mail.role)) +
        paragraph(copy.review),
      locale
    ),
    text: [greeting, '', copy.submitted(applicant, mail.role), '', copy.review].join('\n')
  };
};

const approvalRequestRejectedCopy: Record<
  MailLocale,
  { subject: string; declined: string; next: (role: MailRole) => string }
> = {
  en: {
    subject: 'An update on your Poppynz approval request',
    declined: "We reviewed your approval request and can't approve it at this time.",
    next: (role) =>
      byRole(role, {
        family:
          'You can update your profile and documents and submit a new approval request at any time.',
        'service-provider':
          'You can update your profile, documents, and services and submit a new approval request at any time.'
      })
  },
  fr: {
    subject: 'Une mise à jour concernant votre demande d’approbation Poppynz',
    declined:
      'Nous avons examiné votre demande d’approbation et ne pouvons pas l’approuver pour le moment.',
    next: (role) =>
      byRole(role, {
        family:
          'Vous pouvez mettre à jour votre profil et vos documents, puis soumettre une nouvelle demande d’approbation à tout moment.',
        'service-provider':
          'Vous pouvez mettre à jour votre profil, vos documents et vos services, puis soumettre une nouvelle demande d’approbation à tout moment.'
      })
  }
};

export const approvalRequestRejectedMail = (mail: {
  name: string | null;
  role: MailRole;
  reason: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = approvalRequestRejectedCopy[locale];
  const greeting = greetings[locale](mail.name);
  const next = copy.next(mail.role);
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(copy.declined) +
        paragraph(`<strong>${reasonLabel[locale]}</strong> ${escapeHtml(mail.reason)}`) +
        paragraph(escapeHtml(next)),
      locale
    ),
    text: [greeting, '', copy.declined, '', `${reasonLabel[locale]} ${mail.reason}`, '', next].join(
      '\n'
    )
  };
};

// --- approvals ---------------------------------------------------------------

const approvalGrantedCopy: Record<
  MailLocale,
  {
    subject: string;
    body: (role: MailRole) => string;
    validUntil: (dateHtml: string) => string;
  }
> = {
  en: {
    subject: "You're approved on Poppynz",
    body: (role) =>
      byRole(role, {
        family:
          "Great news — your approval request has been accepted. You're now an approved family on Poppynz and can be found by helpers and reach out to the ones you like.",
        'service-provider':
          "Great news — your approval request has been accepted. You're now an approved service provider on Poppynz and can be found by families searching for services."
      }),
    validUntil: (date) => `Your approval is valid until ${date}.`
  },
  fr: {
    subject: 'Vous êtes approuvé(e) sur Poppynz',
    body: (role) =>
      byRole(role, {
        family:
          'Bonne nouvelle — votre demande d’approbation a été acceptée. Vous êtes maintenant une famille approuvée sur Poppynz : les aidant(e)s peuvent vous trouver, et vous pouvez communiquer avec ceux et celles qui vous plaisent.',
        'service-provider':
          'Bonne nouvelle — votre demande d’approbation a été acceptée. Vous êtes maintenant un(e) aidant(e) approuvé(e) sur Poppynz, et les familles qui recherchent des services peuvent vous trouver.'
      }),
    validUntil: (date) => `Votre approbation est valide jusqu’au ${date}.`
  }
};

export const approvalGrantedMail = (mail: {
  name: string | null;
  role: MailRole;
  expiresAt: Date;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = approvalGrantedCopy[locale];
  const greeting = greetings[locale](mail.name);
  const expires = formatMailDate(mail.expiresAt, locale);
  const body = copy.body(mail.role);
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(escapeHtml(body)) +
        paragraph(copy.validUntil(`<strong>${expires}</strong>`)),
      locale
    ),
    text: [greeting, '', body, '', copy.validUntil(expires)].join('\n')
  };
};

const approvalRevokedCopy: Record<
  MailLocale,
  { subject: string; intro: (role: MailRole) => string; effect: (role: MailRole) => string }
> = {
  en: {
    subject: 'Your Poppynz approval has been revoked',
    intro: (role) =>
      byRole(role, {
        family: 'Your family approval on Poppynz has been revoked.',
        'service-provider': 'Your service provider approval on Poppynz has been revoked.'
      }),
    effect: (role) =>
      byRole(role, {
        family:
          'Your profile is no longer visible to helpers, and you can no longer search for or reach out to them. If you believe this is a mistake, please contact support.',
        'service-provider':
          'Your profile is no longer visible to families searching for services. If you believe this is a mistake, please contact support.'
      })
  },
  fr: {
    subject: 'Votre approbation Poppynz a été révoquée',
    intro: (role) =>
      byRole(role, {
        family: 'Votre approbation en tant que famille sur Poppynz a été révoquée.',
        'service-provider': 'Votre approbation en tant qu’aidant(e) sur Poppynz a été révoquée.'
      }),
    effect: (role) =>
      byRole(role, {
        family:
          'Votre profil n’est plus visible par les aidant(e)s, et vous ne pouvez plus les rechercher ni communiquer avec eux. Si vous croyez qu’il s’agit d’une erreur, veuillez communiquer avec notre équipe de soutien.',
        'service-provider':
          'Votre profil n’est plus visible par les familles qui recherchent des services. Si vous croyez qu’il s’agit d’une erreur, veuillez communiquer avec notre équipe de soutien.'
      })
  }
};

export const approvalRevokedMail = (mail: {
  name: string | null;
  role: MailRole;
  reason: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = approvalRevokedCopy[locale];
  const greeting = greetings[locale](mail.name);
  const intro = copy.intro(mail.role);
  const effect = copy.effect(mail.role);
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(escapeHtml(intro)) +
        paragraph(`<strong>${reasonLabel[locale]}</strong> ${escapeHtml(mail.reason)}`) +
        paragraph(escapeHtml(effect)),
      locale
    ),
    text: [greeting, '', intro, '', `${reasonLabel[locale]} ${mail.reason}`, '', effect].join('\n')
  };
};

/** "tomorrow" / "in 5 days", as used in expiry subjects and sentences. */
const expiresWhen: Record<MailLocale, (daysRemaining: number) => string> = {
  en: (days) => (days === 1 ? 'tomorrow' : `in ${days} days`),
  fr: (days) => (days === 1 ? 'demain' : `dans ${days} jours`)
};

const approvalExpiringCopy: Record<
  MailLocale,
  {
    subject: (when: string) => string;
    body: (role: MailRole, when: string, dateHtml: string) => string;
    renew: string;
    button: string;
  }
> = {
  en: {
    subject: (when) => `Your Poppynz approval expires ${when}`,
    body: (role, when, date) =>
      byRole(role, {
        family: `Your family approval expires ${when}, on ${date}. Once it expires, helpers will no longer see your profile and you will not be able to search for or reach out to them.`,
        'service-provider': `Your service provider approval expires ${when}, on ${date}. Once it expires, your profile will no longer appear when families search for services.`
      }),
    renew: 'To stay approved, submit a new approval request from your profile before then.',
    button: 'Open Poppynz'
  },
  fr: {
    subject: (when) => `Votre approbation Poppynz expire ${when}`,
    body: (role, when, date) =>
      byRole(role, {
        family: `Votre approbation en tant que famille expire ${when}, le ${date}. Une fois qu’elle sera expirée, les aidant(e)s ne verront plus votre profil et vous ne pourrez plus les rechercher ni communiquer avec eux.`,
        'service-provider': `Votre approbation en tant qu’aidant(e) expire ${when}, le ${date}. Une fois qu’elle sera expirée, votre profil n’apparaîtra plus lorsque les familles recherchent des services.`
      }),
    renew:
      'Pour conserver votre approbation, soumettez une nouvelle demande d’approbation à partir de votre profil d’ici là.',
    button: 'Ouvrir Poppynz'
  }
};

export const approvalExpiringMail = (mail: {
  name: string | null;
  role: MailRole;
  expiresAt: Date;
  daysRemaining: number;
  link: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = approvalExpiringCopy[locale];
  const greeting = greetings[locale](mail.name);
  const expires = formatMailDate(mail.expiresAt, locale);
  const when = expiresWhen[locale](mail.daysRemaining);
  return {
    subject: copy.subject(when),
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(copy.body(mail.role, escapeHtml(when), `<strong>${expires}</strong>`)) +
        paragraph(copy.renew) +
        button(mail.link, copy.button),
      locale
    ),
    text: [
      greeting,
      '',
      copy.body(mail.role, when, expires),
      '',
      copy.renew,
      '',
      labelled[locale](copy.button, mail.link)
    ].join('\n')
  };
};

// --- account status ----------------------------------------------------------

const accountBannedCopy: Record<
  MailLocale,
  { subject: string; suspended: string; mistake: string }
> = {
  en: {
    subject: 'Your Poppynz account has been suspended',
    suspended: 'Your Poppynz account has been suspended and you can no longer sign in.',
    mistake: 'If you believe this is a mistake, please contact support.'
  },
  fr: {
    subject: 'Votre compte Poppynz a été suspendu',
    suspended: 'Votre compte Poppynz a été suspendu et vous ne pouvez plus vous connecter.',
    mistake:
      'Si vous croyez qu’il s’agit d’une erreur, veuillez communiquer avec notre équipe de soutien.'
  }
};

export const accountBannedMail = (mail: {
  name: string | null;
  reason: string | null;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = accountBannedCopy[locale];
  const greeting = greetings[locale](mail.name);
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(copy.suspended) +
        (mail.reason
          ? paragraph(`<strong>${reasonLabel[locale]}</strong> ${escapeHtml(mail.reason)}`)
          : '') +
        paragraph(copy.mistake),
      locale
    ),
    text: [
      greeting,
      '',
      copy.suspended,
      ...(mail.reason ? ['', `${reasonLabel[locale]} ${mail.reason}`] : []),
      '',
      copy.mistake
    ].join('\n')
  };
};

const accountUnbannedCopy: Record<
  MailLocale,
  { subject: string; reinstated: string; button: string; signIn: string }
> = {
  en: {
    subject: 'Your Poppynz account has been reinstated',
    reinstated: 'Good news — your Poppynz account has been reinstated. You can sign in again.',
    button: 'Sign in to Poppynz',
    signIn: 'Sign in'
  },
  fr: {
    subject: 'Votre compte Poppynz a été rétabli',
    reinstated:
      'Bonne nouvelle — votre compte Poppynz a été rétabli. Vous pouvez de nouveau vous connecter.',
    button: 'Se connecter à Poppynz',
    signIn: 'Se connecter'
  }
};

export const accountUnbannedMail = (mail: {
  name: string | null;
  link: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = accountUnbannedCopy[locale];
  const greeting = greetings[locale](mail.name);
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) + paragraph(copy.reinstated) + button(mail.link, copy.button),
      locale
    ),
    text: [greeting, '', copy.reinstated, '', labelled[locale](copy.signIn, mail.link)].join('\n')
  };
};

// --- safety verification -----------------------------------------------------

const safetyVerificationInviteCopy: Record<
  MailLocale,
  { subject: string; ready: string; privacy: string; button: string }
> = {
  en: {
    subject: 'Complete your Poppynz safety check',
    ready:
      'Your safety check is ready. Use the secure link below to confirm your identity and complete your screening with our provider.',
    privacy:
      'Poppynz never sees your identity documents — you provide them directly to the screening provider.',
    button: 'Complete your check'
  },
  fr: {
    subject: 'Complétez votre vérification de sécurité Poppynz',
    ready:
      'Votre vérification de sécurité est prête. Utilisez le lien sécurisé ci-dessous pour confirmer votre identité et compléter votre vérification auprès de notre fournisseur.',
    privacy:
      'Poppynz ne voit jamais vos pièces d’identité — vous les fournissez directement au fournisseur de vérification.',
    button: 'Compléter votre vérification'
  }
};

export const safetyVerificationInviteMail = (mail: {
  name: string | null;
  link: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = safetyVerificationInviteCopy[locale];
  const greeting = greetings[locale](mail.name);
  return {
    subject: copy.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(copy.ready) +
        paragraph(copy.privacy) +
        button(mail.link, copy.button),
      locale
    ),
    text: [
      greeting,
      '',
      copy.ready,
      '',
      copy.privacy,
      '',
      labelled[locale](copy.button, mail.link)
    ].join('\n')
  };
};

const safetyVerificationExpiringCopy: Record<
  MailLocale,
  {
    subject: (when: string) => string;
    body: (role: MailRole, when: string, dateHtml: string) => string;
    renew: string;
    button: string;
  }
> = {
  en: {
    subject: (when) => `Your Poppynz safety verification expires ${when}`,
    body: (role, when, date) =>
      byRole(role, {
        family: `Your Poppynz safety verification expires ${when}, on ${date}. Once it expires, you will not be able to make new bookings until it is renewed.`,
        'service-provider': `Your Poppynz safety verification expires ${when}, on ${date}. Once it expires, your profile will no longer appear when families search, and you will not be able to take new bookings until it is renewed.`
      }),
    renew: 'Renewing takes a few minutes and keeps your account active.',
    button: 'Renew your verification'
  },
  fr: {
    subject: (when) => `Votre vérification de sécurité Poppynz expire ${when}`,
    body: (role, when, date) =>
      byRole(role, {
        family: `Votre vérification de sécurité Poppynz expire ${when}, le ${date}. Une fois qu’elle sera expirée, vous ne pourrez plus faire de nouvelles réservations tant qu’elle n’aura pas été renouvelée.`,
        'service-provider': `Votre vérification de sécurité Poppynz expire ${when}, le ${date}. Une fois qu’elle sera expirée, votre profil n’apparaîtra plus dans les recherches des familles et vous ne pourrez plus accepter de nouvelles réservations tant qu’elle n’aura pas été renouvelée.`
      }),
    renew: 'Le renouvellement ne prend que quelques minutes et garde votre compte actif.',
    button: 'Renouveler votre vérification'
  }
};

export const safetyVerificationExpiringMail = (mail: {
  name: string | null;
  role: 'family' | 'service-provider';
  /** 'YYYY-MM-DD'. */
  expiresOn: string;
  daysRemaining: number;
  link: string;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const copy = safetyVerificationExpiringCopy[locale];
  const greeting = greetings[locale](mail.name);
  const when = expiresWhen[locale](mail.daysRemaining);
  const expiresOn = formatMailDate(mail.expiresOn, locale);
  return {
    subject: copy.subject(when),
    html: layout(
      paragraph(escapeHtml(greeting)) +
        paragraph(
          copy.body(mail.role, escapeHtml(when), `<strong>${escapeHtml(expiresOn)}</strong>`)
        ) +
        paragraph(copy.renew) +
        button(mail.link, copy.button),
      locale
    ),
    text: [
      greeting,
      '',
      copy.body(mail.role, when, expiresOn),
      '',
      copy.renew,
      '',
      labelled[locale](copy.button, mail.link)
    ].join('\n')
  };
};

// --- contract billing --------------------------------------------------------

/** A contract-billing notice. The billing domain composes the subject and
 * paragraphs in the recipient's locale; this only lays them out. */
export const contractBillingNoticeMail = (mail: {
  name: string | null;
  subject: string;
  paragraphs: ReadonlyArray<string>;
  link: string;
  linkLabel: string;
  secondaryLink?: { href: string; label: string; intro?: string } | null;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  const greeting = greetings[locale](mail.name);
  const second = mail.secondaryLink ?? null;
  return {
    subject: mail.subject,
    html: layout(
      paragraph(escapeHtml(greeting)) +
        mail.paragraphs.map((text) => paragraph(escapeHtml(text))).join('') +
        button(mail.link, mail.linkLabel) +
        (second
          ? (second.intro ? paragraph(escapeHtml(second.intro)) : '') +
            button(second.href, second.label)
          : ''),
      locale
    ),
    text: [
      greeting,
      '',
      ...mail.paragraphs.flatMap((text) => [text, '']),
      labelled[locale](mail.linkLabel, mail.link),
      ...(second
        ? ['', ...(second.intro ? [second.intro] : []), labelled[locale](second.label, second.href)]
        : [])
    ].join('\n')
  };
};

const adminBillingAlertCopy: Record<MailLocale, { subject: (subject: string) => string }> = {
  en: { subject: (subject) => `[Poppynz billing] ${subject}` },
  fr: { subject: (subject) => `[Facturation Poppynz] ${subject}` }
};

/** Admin-facing: callers send it in English. */
export const adminBillingAlertMail = (mail: {
  subject: string;
  lines: ReadonlyArray<string>;
  locale?: MailLocale;
}): MailContent => {
  const locale = mail.locale ?? defaultMailLocale;
  return {
    subject: adminBillingAlertCopy[locale].subject(mail.subject),
    html: layout(mail.lines.map((line) => paragraph(escapeHtml(line))).join(''), locale),
    text: mail.lines.join('\n')
  };
};
