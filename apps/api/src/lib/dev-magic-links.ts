/**
 * Dev-only memory of the last magic link sent to each address, behind the
 * check-email page's "Mock inbox" (UAT #32, B10). The real link is still
 * mailed (or logged) as usual; this only lets a developer open it without a
 * mailbox. Lives in this process's memory and is written only when
 * ENVIRONMENT is dev, so it holds nothing on staging or production.
 */
const latest = new Map<string, { link: string; sentAt: Date }>();

const isDev = () => (process.env.ENVIRONMENT ?? 'dev') === 'dev';

export const rememberDevMagicLink = (email: string, link: string, now = new Date()) => {
  if (!isDev()) return;
  latest.set(email.trim().toLowerCase(), { link, sentAt: now });
};

export const latestDevMagicLink = (email: string) => latest.get(email.trim().toLowerCase()) ?? null;

export const forgetDevMagicLinks = () => latest.clear();
