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
 * PaymentsLive additionally refuses any live Stripe key.
 */
export type DevGuardResult = { ok: true } | { ok: false; reason: string };

export const checkDevClock = (env: Record<string, string | undefined>): DevGuardResult => {
  if (env.ENVIRONMENT === 'production' || env.NODE_ENV === 'production') {
    return { ok: false, reason: 'refusing to run in production' };
  }
  if (env.ENVIRONMENT !== 'dev') {
    return { ok: false, reason: 'ENVIRONMENT must be set to "dev" explicitly' };
  }
  if (env.BILLING_DEV_CLOCK !== 'enabled') {
    return { ok: false, reason: 'set BILLING_DEV_CLOCK=enabled to use the dev billing tools' };
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
