/**
 * DEV ONLY. The billing clock and fixture can move money in Stripe test mode
 * and write test users, so they refuse to start anywhere but a local
 * development stack:
 *
 *   - ENVIRONMENT must be set explicitly to `dev` (its default is not
 *     enough: an unset variable must never enable this);
 *   - BILLING_DEV_CLOCK must be `enabled`;
 *   - ENVIRONMENT=production or NODE_ENV=production always refuses.
 *
 *   - the process must run in UTC (TZ=UTC), as the API and worker containers
 *     do: the database's `timestamp` and `date` columns carry no zone, so a
 *     tool running in another zone would read and write instants shifted
 *     by its offset.
 *
 * PaymentsLive additionally refuses any live Stripe key.
 */
export type DevGuardResult = { ok: true } | { ok: false; reason: string };

export const checkDevClock = (
  env: Record<string, string | undefined>,
  utcOffsetMinutes: number = new Date().getTimezoneOffset()
): DevGuardResult => {
  if (env.ENVIRONMENT === 'production' || env.NODE_ENV === 'production') {
    return { ok: false, reason: 'refusing to run in production' };
  }
  if (env.ENVIRONMENT !== 'dev') {
    return { ok: false, reason: 'ENVIRONMENT must be set to "dev" explicitly' };
  }
  if (env.BILLING_DEV_CLOCK !== 'enabled') {
    return { ok: false, reason: 'set BILLING_DEV_CLOCK=enabled to use the dev billing tools' };
  }
  if (utcOffsetMinutes !== 0) {
    return { ok: false, reason: 'run with TZ=UTC, like the API and worker containers' };
  }
  return { ok: true };
};

/** Exits the process unless the dev tools may run. */
export const requireDevClock = (env: Record<string, string | undefined> = process.env) => {
  const result = checkDevClock(env);
  if (!result.ok) {
    console.error(`[dev-billing] ${result.reason}. Nothing was done.`);
    process.exit(1);
  }
};

/** Local Postgres hosts the dev tools may write to (host or compose). */
export const LOCAL_DATABASE_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', 'postgres']);

/** DATABASE_URL must point at a local Postgres: a dev clock against a shared
 * or remote database would bill real contracts on a fake clock. */
export const checkLocalDatabase = (databaseUrl: string | undefined): DevGuardResult => {
  let host: string | null = null;
  try {
    host = new URL(databaseUrl ?? '').hostname;
  } catch {
    host = null;
  }
  return host !== null && LOCAL_DATABASE_HOSTS.has(host)
    ? { ok: true }
    : {
        ok: false,
        reason: 'DATABASE_URL must point at a local Postgres (localhost, 127.0.0.1 or postgres)'
      };
};

/** Exits the process unless DATABASE_URL is a local Postgres. */
export const requireLocalDatabase = (env: Record<string, string | undefined> = process.env) => {
  const result = checkLocalDatabase(env.DATABASE_URL);
  if (!result.ok) {
    console.error(`[dev-billing] ${result.reason}. Nothing was done.`);
    process.exit(1);
  }
};
