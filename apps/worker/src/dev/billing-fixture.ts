/**
 * DEV ONLY — prepares a local database so a human can exercise contract
 * billing in the browser (web on http://localhost:5173, API on :3000, Stripe
 * TEST mode). Idempotent: rerunning reuses every row it created.
 *
 * From the host (worktree root, docker Postgres published on localhost):
 *
 *   TZ=UTC ENVIRONMENT=dev BILLING_DEV_CLOCK=enabled \
 *     DATABASE_URL=postgres://user:pass@localhost:5432/poppynz_dev \
 *     bun apps/worker/src/dev/billing-fixture.ts [--payout-account acct_…] \
 *       [--replacement-helpers]
 *
 * Inside the worker container:
 *
 *   docker compose exec worker sh -c 'cd /usr/src/app && ENVIRONMENT=dev \
 *     BILLING_DEV_CLOCK=enabled bun apps/worker/src/dev/billing-fixture.ts'
 *
 * The accounts themselves — Fiona billing-family@example.test (Toronto ON),
 * Hana billing-helper@example.test (Winnipeg MB, Childcare $25/h) and, with
 * `--replacement-helpers`, Robin, Theo and Paula — are created by the shared
 * UAT fixture (@repo/seeder/uat/fixtures, see its header), which the staging
 * UAT step (UAT_FIXTURES=enabled) also runs. This wrapper only adds the
 * local-only guards and the command line.
 *
 * `--payout-account acct_…` also upserts Hana's Stripe payout account in
 * `onboarding`, re-fetched from Stripe on first use.
 *
 * Sign-in is by magic link only: request one on the sign-in page; the link is
 * printed in the api logs (`docker logs api 2>&1 | grep 'Magic link for'`).
 */
import { requireDevClock, requireLocalDatabase } from './guard';

requireDevClock();

requireLocalDatabase();

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const payoutAccountReference = argument('payout-account');
const withReplacementHelpers = process.argv.includes('--replacement-helpers');
if (process.argv.includes('--payout-account') && !/^acct_\w+$/.test(payoutAccountReference ?? '')) {
  console.error(
    '[dev-billing] --payout-account expects a Stripe account id (acct_…). Nothing was done.'
  );
  process.exit(1);
}

// Imported only after the guards so nothing touches the database before them.
const { db } = await import('@repo/db');
const { runUatFixtures } = await import('@repo/seeder/uat/fixtures');

try {
  const lines = await runUatFixtures(db, {
    emailBase: null,
    payoutAccountReference: payoutAccountReference ?? null,
    replacementHelpers: withReplacementHelpers,
    // The dev accountant comes from seed 0006_dev_accountant.
    accountant: false
  });
  console.log('[dev-billing] fixture ready');
  for (const line of lines) console.log(line);
  console.log(
    "  sign in: request a magic link on the sign-in page; the link is printed in the api logs: docker logs api 2>&1 | grep 'Magic link for'"
  );
} catch (error) {
  console.error('[dev-billing] fixture failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
