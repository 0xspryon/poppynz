// Staging UAT accounts (docs/staging-uat.md), run by scripts/run-seeds.sh
// after the tracked seeds: `bun --filter @repo/seeder uat:fixtures`.
//
// NOT a tracked seed on purpose: a seed is applied once per database, while
// these accounts must be re-created after a staging reset and follow a
// changed UAT_EMAIL_BASE or UAT_HELPER_PAYOUT_ACCOUNT on the next deploy.
// Idempotent (everything is matched by its natural key).
//
// Runs only when ENVIRONMENT is explicitly `staging` or `dev` and
// UAT_FIXTURES=enabled — never for production or an unset ENVIRONMENT.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@repo/db/schema';
import { checkUatFixtures } from '@repo/env';
import { isPayoutAccountReference, runUatFixtures } from './fixtures';

export const uatFixtureSettings = (env: Record<string, string | undefined>) => {
  const gate = checkUatFixtures(env);
  if (!gate.enabled) return { run: false as const, reason: gate.reason };
  const emailBase = env.UAT_EMAIL_BASE?.trim() || null;
  const payout = env.UAT_HELPER_PAYOUT_ACCOUNT?.trim() || null;
  if (payout && !isPayoutAccountReference(payout)) {
    return {
      run: false as const,
      reason: 'UAT_HELPER_PAYOUT_ACCOUNT must be a Stripe account id (acct_…)'
    };
  }
  return { run: true as const, emailBase, payoutAccountReference: payout };
};

const main = async () => {
  const settings = uatFixtureSettings(process.env);
  if (!settings.run) {
    console.log(`UAT accounts skipped: ${settings.reason}`);
    return;
  }
  if (new Date().getTimezoneOffset() !== 0) {
    throw new Error('run with TZ=UTC (date columns carry no zone)');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? '' });
  try {
    const lines = await runUatFixtures(drizzle(pool, { schema }), {
      emailBase: settings.emailBase,
      payoutAccountReference: settings.payoutAccountReference,
      replacementHelpers: true,
      accountant: true
    });
    console.log('UAT accounts ready');
    for (const line of lines) console.log(line);
  } finally {
    await pool.end();
  }
};

if (import.meta.main) {
  await main().catch((error) => {
    console.error('UAT accounts failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
