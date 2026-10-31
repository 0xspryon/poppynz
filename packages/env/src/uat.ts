import { Config } from 'effect';

/**
 * Staging UAT switches (docs/staging-uat.md). Both read the RAW environment
 * on purpose: `environmentConfig` defaults to `dev`, and an unset ENVIRONMENT
 * must never enable test accounts or a billing clock — so ENVIRONMENT has to
 * be set explicitly to `staging` or `dev`. NODE_ENV is not checked: staging
 * runs production builds (NODE_ENV=production) by design.
 */
export type UatGate = { enabled: true } | { enabled: false; reason: string };

type RawEnv = Record<string, string | undefined>;

const normalised = (value: string | undefined) => value?.trim().toLowerCase() ?? '';

/** The environments where the UAT tools may run: never production, never unset. */
export const uatEnvironments = ['staging', 'dev'] as const;

const uatEnvironment = (env: RawEnv): UatGate => {
  const environment = normalised(env.ENVIRONMENT);
  if (environment === 'production') return { enabled: false, reason: 'ENVIRONMENT is production' };
  if (!(uatEnvironments as ReadonlyArray<string>).includes(environment)) {
    return { enabled: false, reason: 'ENVIRONMENT must be set explicitly to "staging" or "dev"' };
  }
  return { enabled: true };
};

/** The ready-made UAT accounts (Fiona, Hana, Robin, Theo, Paula, the
 * accountant): ENVIRONMENT staging|dev and UAT_FIXTURES=enabled. */
export const checkUatFixtures = (env: RawEnv): UatGate => {
  const environment = uatEnvironment(env);
  if (!environment.enabled) return environment;
  if (normalised(env.UAT_FIXTURES) !== 'enabled') {
    return { enabled: false, reason: 'UAT_FIXTURES is not "enabled"' };
  }
  return { enabled: true };
};

/**
 * The admin billing fast-forward: ENVIRONMENT staging|dev,
 * BILLING_TIME_TRAVEL=enabled and — when Stripe is the provider — a TEST
 * secret key (`sk_test_…`): a fast-forward makes real provider calls at
 * the real time, so it must never reach a live account.
 */
export const checkBillingTimeTravel = (env: RawEnv): UatGate => {
  const environment = uatEnvironment(env);
  if (!environment.enabled) return environment;
  if (normalised(env.BILLING_TIME_TRAVEL) !== 'enabled') {
    return { enabled: false, reason: 'BILLING_TIME_TRAVEL is not "enabled"' };
  }
  if (normalised(env.PAYMENTS_PROVIDER) === 'stripe') {
    const key = env.STRIPE_SECRET_KEY?.trim() ?? '';
    if (!key.startsWith('sk_test_')) {
      return { enabled: false, reason: 'STRIPE_SECRET_KEY is not a test key (sk_test_…)' };
    }
  }
  return { enabled: true };
};

/** How far ahead of the real time an admin may run a contract's billing. */
export const billingTimeTravelConfig = Config.all({
  maxDays: Config.integer('BILLING_TIME_TRAVEL_MAX_DAYS').pipe(
    Config.withDefault(60),
    Config.validate({
      message: 'BILLING_TIME_TRAVEL_MAX_DAYS must be a whole number of days between 1 and 366',
      validation: (value) => value >= 1 && value <= 366
    })
  )
});

/** `kay@poppynz.com` + `fiona` → `kay+fiona@poppynz.com`; null when the base
 * is not a plain address. An existing `+tag` on the base is replaced. */
export const uatEmail = (base: string, alias: string): string | null => {
  const match = /^([^@\s+]+)(?:\+[^@\s]*)?@([^@\s]+\.[^@\s]+)$/.exec(base.trim().toLowerCase());
  if (!match) return null;
  return `${match[1]}+${alias}@${match[2]}`;
};
