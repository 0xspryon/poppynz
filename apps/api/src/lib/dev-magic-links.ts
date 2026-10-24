/**
 * Dev-only memory of the last magic link sent to each address, behind the
 * check-email page's "Mock inbox" (UAT #32, B10). The real link is still
 * mailed (or logged) as usual; this only lets a developer open it without a
 * mailbox. Lives in this process's memory.
 *
 * Fails closed, like the worker's dev billing guard: the inbox exists only
 * when ENVIRONMENT is set *explicitly* to `dev` (the shared config's default
 * of `dev` is not enough, so an unset variable never enables it) and
 * NODE_ENV is not `production`. Outside that, links are never stored and the
 * route is not even registered.
 */
const latest = new Map<string, { link: string; sentAt: Date }>();

export const isDevInboxEnabled = (
  env: Record<string, string | undefined> = process.env
): boolean => {
  const environment = env.ENVIRONMENT?.trim().toLowerCase();
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  return environment === 'dev' && nodeEnv !== 'production';
};

export const rememberDevMagicLink = (
  email: string,
  link: string,
  now = new Date(),
  env: Record<string, string | undefined> = process.env
) => {
  if (!isDevInboxEnabled(env)) return;
  latest.set(email.trim().toLowerCase(), { link, sentAt: now });
};

export const latestDevMagicLink = (email: string) => latest.get(email.trim().toLowerCase()) ?? null;

export const forgetDevMagicLinks = () => latest.clear();
