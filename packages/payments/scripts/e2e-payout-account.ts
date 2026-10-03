/**
 * LOCAL END-TO-END ONLY (piece 2b). Test mode only: refuses any key that
 * isn't sk_test_. Never imported by the app.
 *
 *   create-ready [--with-card-payments]
 *       Creates a CUSTOM connected account in Canada prefilled with Stripe's
 *       documented test values, so it becomes payout-ready without anyone
 *       filling Stripe's hosted pages (an Express account can't: its terms
 *       must be accepted there). Prints the id and readiness flags as JSON.
 *   touch <acct_id>
 *       Updates the account's metadata so Stripe emits account.updated
 *       (forwarded locally by `stripe listen --forward-connect-to`).
 *
 * Run from the worktree root; the key is read from the env file, never printed:
 *   bun --env-file=apps/api/.env packages/payments/scripts/e2e-payout-account.ts create-ready
 */
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../src/stripe';

const key = process.env.STRIPE_SECRET_KEY ?? '';
if (!key.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY must be a test-mode key (sk_test_…). Refusing to run.');
  process.exit(1);
}

// Same pinned API version as the app's adapter (2a).
const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });

const flags = (account: Stripe.Account) => ({
  id: account.id,
  details_submitted: account.details_submitted,
  payouts_enabled: account.payouts_enabled,
  transfers: account.capabilities?.transfers ?? null,
  currently_due: account.requirements?.currently_due ?? [],
  disabled_reason: account.requirements?.disabled_reason ?? null
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createReady = async (withCardPayments: boolean) => {
  const account = await stripe.accounts.create({
    type: 'custom',
    country: 'CA',
    business_type: 'individual',
    email: 'e2e-helper@example.com',
    capabilities: {
      transfers: { requested: true },
      ...(withCardPayments ? { card_payments: { requested: true } } : {})
    },
    business_profile: {
      mcc: '8351',
      product_description: 'Childcare booked through Poppynz (local e2e test account)',
      url: 'https://poppynz.com'
    },
    individual: {
      first_name: 'Test',
      last_name: 'Helper',
      email: 'e2e-helper@example.com',
      phone: '0000000000',
      dob: { day: 1, month: 1, year: 1901 },
      id_number: '000000000',
      relationship: { title: 'Helper' },
      address: {
        line1: 'address_full_match',
        city: 'Winnipeg',
        state: 'MB',
        postal_code: 'R3C 0A1',
        country: 'CA'
      }
    },
    external_account: {
      object: 'bank_account',
      country: 'CA',
      currency: 'cad',
      routing_number: '11000-000',
      account_number: '000123456789'
    },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
    metadata: { e2e: 'payouts-2b' }
  });

  // Test-mode verification settles asynchronously; poll for up to a minute.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await stripe.accounts.retrieve(account.id);
    if (
      current.details_submitted &&
      current.payouts_enabled &&
      current.capabilities?.transfers === 'active'
    ) {
      console.log(JSON.stringify(flags(current)));
      return;
    }
    await sleep(3000);
  }
  console.log(JSON.stringify(flags(await stripe.accounts.retrieve(account.id))));
  process.exitCode = 2;
};

const touch = async (accountId: string) => {
  const updated = await stripe.accounts.update(accountId, {
    metadata: { e2e_touched_at: new Date().toISOString() }
  });
  console.log(JSON.stringify(flags(updated)));
};

const [command, argument] = process.argv.slice(2);
try {
  if (command === 'create-ready') {
    await createReady(argument === '--with-card-payments');
  } else if (command === 'touch' && argument?.startsWith('acct_')) {
    await touch(argument);
  } else {
    console.error('Usage: create-ready [--with-card-payments] | touch <acct_id>');
    process.exitCode = 1;
  }
} catch (error) {
  // Stripe errors carry no secrets; print the message only.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
