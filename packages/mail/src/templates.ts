/** The roles a mail can address. Mirrors the invitable roles in the api's
 * auth model without depending on it. */
export type MailRole = 'family' | 'service-provider';

export type MailContent = {
  subject: string;
  html: string;
  text: string;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const roleLabel = (role: MailRole) => (role === 'service-provider' ? 'service provider' : role);

/** What approval unlocks, in the applicant's own terms. */
const approvalUnlocks = (role: MailRole) =>
  role === 'family'
    ? 'be found by helpers and reach out to the ones you like'
    : 'be found by families searching for services';

/** What the review looks at — families list no services. */
const reviewedThings = (role: MailRole) =>
  role === 'family' ? 'profile and documents' : 'profile, documents, and services';

const greeting = (name: string | null) => (name ? `Hi ${name},` : 'Hi,');

const layout = (paragraphsHtml: string) => `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f5f5f4;font-family:Helvetica,Arial,sans-serif;color:#1c1917;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <p style="font-size:20px;font-weight:700;margin:0 0 24px;">Poppynz</p>
      <div style="background:#ffffff;border-radius:12px;padding:24px;font-size:15px;line-height:1.6;">
        ${paragraphsHtml}
      </div>
      <p style="font-size:12px;color:#78716c;margin:24px 0 0;">
        You received this email because of activity on your Poppynz account.
      </p>
    </div>
  </body>
</html>`;

const paragraph = (html: string) => `<p style="margin:0 0 16px;">${html}</p>`;

// Mirrors the app's primary CTA: Sky Action blue, pill-shaped
// (--color-primary / .btn-primary in apps/web/src/app.css).
const button = (href: string, label: string) =>
  `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#37b5ff;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 24px;font-weight:600;">${escapeHtml(label)}</a></p>`;

const numberedSteps = (steps: ReadonlyArray<{ text: string; href: string; linkLabel: string }>) =>
  `<ol style="margin:0 0 16px;padding-left:20px;">${steps
    .map(
      (step) =>
        `<li style="margin:0 0 12px;">${escapeHtml(step.text)}<br /><a href="${escapeHtml(step.href)}" style="color:#37b5ff;font-weight:600;text-decoration:none;">${escapeHtml(step.linkLabel)}</a></li>`
    )
    .join('')}</ol>`;

const numberedStepsText = (steps: ReadonlyArray<{ text: string; href: string }>) =>
  steps.flatMap((step, index) => [`${index + 1}. ${step.text}`, `   ${step.href}`]).join('\n');

export const familyWelcomeMail = (mail: {
  name: string | null;
  profileLink: string;
  needsLink: string;
  documentsLink: string;
  findLink: string;
}): MailContent => {
  // Mirrors the in-app getting-started checklist step for step — the safety
  // check is what makes a family discoverable, so it is a step, not a footnote.
  const steps = [
    {
      text: 'Set your home location. Searches are centered on it, and it lets vetted helpers nearby find your family.',
      href: mail.profileLink,
      linkLabel: 'Set your location'
    },
    {
      text: "Tell us which services you need — regular childcare, after-school pickup, meal prep, anything you're looking for.",
      href: mail.needsLink,
      linkLabel: 'List the services you need'
    },
    {
      text: 'Complete your safety check by uploading a vulnerable sector check from your local police service. Safety runs both ways on Poppynz — helpers only see families who have been verified, just as you only see vetted helpers.',
      href: mail.documentsLink,
      linkLabel: 'Upload your safety check'
    },
    {
      text: 'Browse vetted helpers near you and find the right fit for your family.',
      href: mail.findLink,
      linkLabel: 'Find help near you'
    }
  ];
  return {
    subject: "Welcome to Poppynz — here's how to get started",
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(
          "Welcome to Poppynz! Every helper on our marketplace is identity- and background-vetted before families can find them — and every family completes a safety check before helpers can find them. Here's how to get set up:"
        ) +
        numberedSteps(steps) +
        button(mail.profileLink, 'Get started')
    ),
    text: [
      greeting(mail.name),
      '',
      "Welcome to Poppynz! Every helper on our marketplace is identity- and background-vetted before families can find them — and every family completes a safety check before helpers can find them. Here's how to get set up:",
      '',
      numberedStepsText(steps),
      '',
      `Get started: ${mail.profileLink}`
    ].join('\n')
  };
};

export const providerWelcomeMail = (mail: {
  name: string | null;
  profileLink: string;
  documentsLink: string;
  servicesLink: string;
  approvalLink: string;
  findLink: string;
}): MailContent => {
  const steps = [
    {
      text: 'Complete your profile, including your location and a short bio families will see.',
      href: mail.profileLink,
      linkLabel: 'Set up your profile'
    },
    {
      text: 'Upload your identity and background documents.',
      href: mail.documentsLink,
      linkLabel: 'Upload your documents'
    },
    {
      text: 'Pick the services you offer and set your rates.',
      href: mail.servicesLink,
      linkLabel: 'Set up services & rates'
    },
    {
      text: 'Submit for approval — our team reviews every helper before they go live.',
      href: mail.approvalLink,
      linkLabel: 'Request approval'
    },
    {
      text: "Once you're approved, browse families looking for help near you and find a great fit.",
      href: mail.findLink,
      linkLabel: 'Find families'
    }
  ];
  return {
    subject: "Welcome to Poppynz — here's how to get started",
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(
          "Welcome to Poppynz! Families here look for vetted helpers, so a complete, approved profile is how you get found. Here's how to get set up:"
        ) +
        numberedSteps(steps) +
        button(mail.profileLink, 'Set up your profile')
    ),
    text: [
      greeting(mail.name),
      '',
      "Welcome to Poppynz! Families here look for vetted helpers, so a complete, approved profile is how you get found. Here's how to get set up:",
      '',
      numberedStepsText(steps),
      '',
      `Set up your profile: ${mail.profileLink}`
    ].join('\n')
  };
};

export const magicLinkMail = (mail: { link: string }): MailContent => ({
  subject: 'Your Poppynz sign-in link',
  html: layout(
    paragraph('Hi,') +
      paragraph('Use the button below to sign in to Poppynz. This link can only be used once.') +
      button(mail.link, 'Sign in to Poppynz') +
      paragraph("If you didn't request this email, you can safely ignore it.")
  ),
  text: [
    'Hi,',
    '',
    'Use the link below to sign in to Poppynz. This link can only be used once.',
    '',
    mail.link,
    '',
    "If you didn't request this email, you can safely ignore it."
  ].join('\n')
});

export const referralInviteMail = (mail: {
  inviterName: string;
  role: MailRole;
  link: string;
}): MailContent => ({
  subject: `${mail.inviterName} invited you to join Poppynz`,
  html: layout(
    paragraph('Hi,') +
      paragraph(
        `${escapeHtml(mail.inviterName)} invited you to join Poppynz as a ${escapeHtml(roleLabel(mail.role))}.`
      ) +
      button(mail.link, 'Accept your invite') +
      paragraph("If you weren't expecting this invitation, you can safely ignore it.")
  ),
  text: [
    'Hi,',
    '',
    `${mail.inviterName} invited you to join Poppynz as a ${roleLabel(mail.role)}.`,
    '',
    `Accept your invite: ${mail.link}`,
    '',
    "If you weren't expecting this invitation, you can safely ignore it."
  ].join('\n')
});

export const approvalRequestSubmittedMail = (mail: {
  name: string | null;
  role: MailRole;
}): MailContent => {
  const body = `Your request to be approved as a ${roleLabel(mail.role)} on Poppynz has been submitted. Our team will review your ${reviewedThings(mail.role)}.`;
  return {
    subject: 'We received your approval request',
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(escapeHtml(body)) +
        paragraph("We'll email you as soon as the review is complete.")
    ),
    text: [
      greeting(mail.name),
      '',
      body,
      '',
      "We'll email you as soon as the review is complete."
    ].join('\n')
  };
};

export const adminApprovalRequestSubmittedMail = (mail: {
  applicantName: string | null;
  applicantEmail: string;
  role: MailRole;
}): MailContent => {
  const applicant = mail.applicantName
    ? `${mail.applicantName} (${mail.applicantEmail})`
    : mail.applicantEmail;
  const label = roleLabel(mail.role);
  return {
    subject: `New ${label} approval request`,
    html: layout(
      paragraph('Hi,') +
        paragraph(
          `<strong>${escapeHtml(applicant)}</strong> submitted a ${escapeHtml(label)} approval request and is waiting for review.`
        ) +
        paragraph('Review the request in the Poppynz admin dashboard.')
    ),
    text: [
      'Hi,',
      '',
      `${applicant} submitted a ${label} approval request and is waiting for review.`,
      '',
      'Review the request in the Poppynz admin dashboard.'
    ].join('\n')
  };
};

export const approvalRequestRejectedMail = (mail: {
  name: string | null;
  role: MailRole;
  reason: string;
}): MailContent => {
  const next = `You can update your ${reviewedThings(mail.role)} and submit a new approval request at any time.`;
  return {
    subject: 'An update on your Poppynz approval request',
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph("We reviewed your approval request and can't approve it at this time.") +
        paragraph(`<strong>Reason:</strong> ${escapeHtml(mail.reason)}`) +
        paragraph(escapeHtml(next))
    ),
    text: [
      greeting(mail.name),
      '',
      "We reviewed your approval request and can't approve it at this time.",
      '',
      `Reason: ${mail.reason}`,
      '',
      next
    ].join('\n')
  };
};

export const approvalGrantedMail = (mail: {
  name: string | null;
  role: MailRole;
  expiresAt: Date;
}): MailContent => {
  const expires = mail.expiresAt.toISOString().slice(0, 10);
  const body = `Great news — your approval request has been accepted. You're now an approved ${roleLabel(mail.role)} on Poppynz and can ${approvalUnlocks(mail.role)}.`;
  return {
    subject: "You're approved on Poppynz",
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(escapeHtml(body)) +
        paragraph(`Your approval is valid until <strong>${expires}</strong>.`)
    ),
    text: [greeting(mail.name), '', body, '', `Your approval is valid until ${expires}.`].join('\n')
  };
};

export const accountBannedMail = (mail: {
  name: string | null;
  reason: string | null;
}): MailContent => ({
  subject: 'Your Poppynz account has been suspended',
  html: layout(
    paragraph(escapeHtml(greeting(mail.name))) +
      paragraph('Your Poppynz account has been suspended and you can no longer sign in.') +
      (mail.reason ? paragraph(`<strong>Reason:</strong> ${escapeHtml(mail.reason)}`) : '') +
      paragraph('If you believe this is a mistake, please contact support.')
  ),
  text: [
    greeting(mail.name),
    '',
    'Your Poppynz account has been suspended and you can no longer sign in.',
    ...(mail.reason ? ['', `Reason: ${mail.reason}`] : []),
    '',
    'If you believe this is a mistake, please contact support.'
  ].join('\n')
});

export const accountUnbannedMail = (mail: { name: string | null; link: string }): MailContent => ({
  subject: 'Your Poppynz account has been reinstated',
  html: layout(
    paragraph(escapeHtml(greeting(mail.name))) +
      paragraph('Good news — your Poppynz account has been reinstated. You can sign in again.') +
      button(mail.link, 'Sign in to Poppynz')
  ),
  text: [
    greeting(mail.name),
    '',
    'Good news — your Poppynz account has been reinstated. You can sign in again.',
    '',
    `Sign in: ${mail.link}`
  ].join('\n')
});

export const approvalRevokedMail = (mail: {
  name: string | null;
  role: MailRole;
  reason: string;
}): MailContent => {
  const intro = `Your ${roleLabel(mail.role)} approval on Poppynz has been revoked.`;
  const effect =
    mail.role === 'family'
      ? 'Your profile is no longer visible to helpers, and you can no longer search for or reach out to them. If you believe this is a mistake, please contact support.'
      : 'Your profile is no longer visible to families searching for services. If you believe this is a mistake, please contact support.';
  return {
    subject: 'Your Poppynz approval has been revoked',
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(escapeHtml(intro)) +
        paragraph(`<strong>Reason:</strong> ${escapeHtml(mail.reason)}`) +
        paragraph(escapeHtml(effect))
    ),
    text: [greeting(mail.name), '', intro, '', `Reason: ${mail.reason}`, '', effect].join('\n')
  };
};

export const safetyVerificationInviteMail = (mail: {
  name: string | null;
  link: string;
}): MailContent => ({
  subject: 'Complete your Poppynz safety check',
  html: layout(
    paragraph(escapeHtml(greeting(mail.name))) +
      paragraph(
        'Your safety check is ready. Use the secure link below to confirm your identity and complete your screening with our provider.'
      ) +
      paragraph(
        'Poppynz never sees your identity documents — you provide them directly to the screening provider.'
      ) +
      button(mail.link, 'Complete your check')
  ),
  text: [
    greeting(mail.name),
    '',
    'Your safety check is ready. Use the secure link below to confirm your identity and complete your screening with our provider.',
    '',
    'Poppynz never sees your identity documents — you provide them directly to the screening provider.',
    '',
    `Complete your check: ${mail.link}`
  ].join('\n')
});

export const safetyVerificationExpiringMail = (mail: {
  name: string | null;
  role: 'family' | 'service-provider';
  expiresOn: string;
  daysRemaining: number;
  link: string;
}): MailContent => {
  const when = mail.daysRemaining === 1 ? 'tomorrow' : `in ${mail.daysRemaining} days`;
  const consequence =
    mail.role === 'family'
      ? 'you will not be able to make new bookings'
      : 'your profile will no longer appear when families search, and you will not be able to take new bookings';
  return {
    subject: `Your Poppynz safety verification expires ${when}`,
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(
          `Your Poppynz safety verification expires ${escapeHtml(when)}, on <strong>${escapeHtml(mail.expiresOn)}</strong>. Once it expires, ${escapeHtml(consequence)} until it is renewed.`
        ) +
        paragraph('Renewing takes a few minutes and keeps your account active.') +
        button(mail.link, 'Renew your verification')
    ),
    text: [
      greeting(mail.name),
      '',
      `Your Poppynz safety verification expires ${when}, on ${mail.expiresOn}. Once it expires, ${consequence} until it is renewed.`,
      '',
      'Renewing takes a few minutes and keeps your account active.',
      '',
      `Renew your verification: ${mail.link}`
    ].join('\n')
  };
};

export const approvalExpiringMail = (mail: {
  name: string | null;
  role: MailRole;
  expiresAt: Date;
  daysRemaining: number;
  link: string;
}): MailContent => {
  const expires = mail.expiresAt.toISOString().slice(0, 10);
  const when = mail.daysRemaining === 1 ? 'tomorrow' : `in ${mail.daysRemaining} days`;
  const consequence =
    mail.role === 'family'
      ? 'Once it expires, helpers will no longer see your profile and you will not be able to search for or reach out to them.'
      : 'Once it expires, your profile will no longer appear when families search for services.';
  return {
    subject: `Your Poppynz approval expires ${when}`,
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(
          `Your ${escapeHtml(roleLabel(mail.role))} approval expires ${escapeHtml(when)}, on <strong>${expires}</strong>. ${escapeHtml(consequence)}`
        ) +
        paragraph(
          'To stay approved, submit a new approval request from your profile before then.'
        ) +
        button(mail.link, 'Open Poppynz')
    ),
    text: [
      greeting(mail.name),
      '',
      `Your ${roleLabel(mail.role)} approval expires ${when}, on ${expires}. ${consequence}`,
      '',
      'To stay approved, submit a new approval request from your profile before then.',
      '',
      `Open Poppynz: ${mail.link}`
    ].join('\n')
  };
};
