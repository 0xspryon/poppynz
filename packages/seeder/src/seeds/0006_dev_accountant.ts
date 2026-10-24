import { user } from '@repo/db/schema';
import { environmentConfig } from '@repo/env';
import { Effect } from 'effect';
import type { Seed } from '../types';

/** The local accountant (tax portal), like the admin seed users: signs in
 * with the regular magic-link flow (the link is printed in the api logs). */
export const DEV_ACCOUNTANT_EMAIL = 'accountant@example.test';

/** Dev only: never on a production image (NODE_ENV=production) nor on a
 * staging or production ENVIRONMENT. */
export const seedsDevAccountant = (environment: string, nodeEnv: string | undefined) =>
  environment === 'dev' && nodeEnv !== 'production';

export const devAccountant: Seed = {
  name: '0006_dev_accountant',
  run: async (db) => {
    const environment = Effect.runSync(environmentConfig);
    if (!seedsDevAccountant(environment, process.env.NODE_ENV)) return;
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: 'accountant',
        email: DEV_ACCOUNTANT_EMAIL,
        emailVerified: true,
        role: 'accountant'
      })
      .onConflictDoUpdate({ target: user.email, set: { role: 'accountant' } });
  }
};
