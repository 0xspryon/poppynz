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
  findLink: string;
}): MailContent => {
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
          "Welcome to Poppynz! Every helper on our marketplace is identity- and background-vetted before families can find them. Here's how to get set up:"
        ) +
        numberedSteps(steps) +
        button(mail.profileLink, 'Get started')
    ),
    text: [
      greeting(mail.name),
      '',
      "Welcome to Poppynz! Every helper on our marketplace is identity- and background-vetted before families can find them. Here's how to get set up:",
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

export const approvalRequestSubmittedMail = (mail: { name: string | null }): MailContent => ({
  subject: 'We received your approval request',
  html: layout(
    paragraph(escapeHtml(greeting(mail.name))) +
      paragraph(
        'Your request to be approved as a service provider on Poppynz has been submitted. Our team will review your profile, documents, and services.'
      ) +
      paragraph("We'll email you as soon as the review is complete.")
  ),
  text: [
    greeting(mail.name),
    '',
    'Your request to be approved as a service provider on Poppynz has been submitted. Our team will review your profile, documents, and services.',
    '',
    "We'll email you as soon as the review is complete."
  ].join('\n')
});

export const adminApprovalRequestSubmittedMail = (mail: {
  providerName: string | null;
  providerEmail: string;
}): MailContent => {
  const provider = mail.providerName
    ? `${mail.providerName} (${mail.providerEmail})`
    : mail.providerEmail;
  return {
    subject: 'New service provider approval request',
    html: layout(
      paragraph('Hi,') +
        paragraph(
          `<strong>${escapeHtml(provider)}</strong> submitted a service provider approval request and is waiting for review.`
        ) +
        paragraph('Review the request in the Poppynz admin dashboard.')
    ),
    text: [
      'Hi,',
      '',
      `${provider} submitted a service provider approval request and is waiting for review.`,
      '',
      'Review the request in the Poppynz admin dashboard.'
    ].join('\n')
  };
};

export const approvalRequestRejectedMail = (mail: {
  name: string | null;
  reason: string;
}): MailContent => ({
  subject: 'An update on your Poppynz approval request',
  html: layout(
    paragraph(escapeHtml(greeting(mail.name))) +
      paragraph("We reviewed your approval request and can't approve it at this time.") +
      paragraph(`<strong>Reason:</strong> ${escapeHtml(mail.reason)}`) +
      paragraph(
        'You can update your profile, documents, or services and submit a new approval request at any time.'
      )
  ),
  text: [
    greeting(mail.name),
    '',
    "We reviewed your approval request and can't approve it at this time.",
    '',
    `Reason: ${mail.reason}`,
    '',
    'You can update your profile, documents, or services and submit a new approval request at any time.'
  ].join('\n')
});

export const approvalGrantedMail = (mail: {
  name: string | null;
  expiresAt: Date;
}): MailContent => {
  const expires = mail.expiresAt.toISOString().slice(0, 10);
  return {
    subject: "You're approved on Poppynz",
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(
          "Great news — your approval request has been accepted. You're now an approved service provider on Poppynz and can be found by families searching for services."
        ) +
        paragraph(`Your approval is valid until <strong>${expires}</strong>.`)
    ),
    text: [
      greeting(mail.name),
      '',
      "Great news — your approval request has been accepted. You're now an approved service provider on Poppynz and can be found by families searching for services.",
      '',
      `Your approval is valid until ${expires}.`
    ].join('\n')
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
  reason: string;
}): MailContent => ({
  subject: 'Your Poppynz approval has been revoked',
  html: layout(
    paragraph(escapeHtml(greeting(mail.name))) +
      paragraph('Your service provider approval on Poppynz has been revoked.') +
      paragraph(`<strong>Reason:</strong> ${escapeHtml(mail.reason)}`) +
      paragraph(
        'Your profile is no longer visible to families searching for services. If you believe this is a mistake, please contact support.'
      )
  ),
  text: [
    greeting(mail.name),
    '',
    'Your service provider approval on Poppynz has been revoked.',
    '',
    `Reason: ${mail.reason}`,
    '',
    'Your profile is no longer visible to families searching for services. If you believe this is a mistake, please contact support.'
  ].join('\n')
});

export const approvalExpiringMail = (mail: {
  name: string | null;
  expiresAt: Date;
  daysRemaining: number;
  link: string;
}): MailContent => {
  const expires = mail.expiresAt.toISOString().slice(0, 10);
  const when = mail.daysRemaining === 1 ? 'tomorrow' : `in ${mail.daysRemaining} days`;
  return {
    subject: `Your Poppynz approval expires ${when}`,
    html: layout(
      paragraph(escapeHtml(greeting(mail.name))) +
        paragraph(
          `Your service provider approval expires ${escapeHtml(when)}, on <strong>${expires}</strong>. Once it expires, your profile will no longer appear when families search for services.`
        ) +
        paragraph(
          'To stay approved, submit a new approval request from your profile before then.'
        ) +
        button(mail.link, 'Open Poppynz')
    ),
    text: [
      greeting(mail.name),
      '',
      `Your service provider approval expires ${when}, on ${expires}. Once it expires, your profile will no longer appear when families search for services.`,
      '',
      'To stay approved, submit a new approval request from your profile before then.',
      '',
      `Open Poppynz: ${mail.link}`
    ].join('\n')
  };
};
