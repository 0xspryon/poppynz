import { user } from '@repo/db/schema';
import { adminAccountConfig } from '@repo/env';
import { Effect } from 'effect';
import type { Seed } from '../types';

// `adminAccounts` is a semicolon-separated email list (see @repo/env for the
// dev defaults). Admins sign in with the regular magic-link flow afterwards.
// NOTE: this seed runs once and is then tracked — adding an email to the env
// var later needs a new `NNNN_...` seed file to take effect.
export const adminUsers: Seed = {
  name: '0000_admin_users',
  run: async (db) => {
    const { adminAccounts } = Effect.runSync(adminAccountConfig);

    for (const email of adminAccounts) {
      await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: email.split('@')[0],
          email,
          emailVerified: true,
          role: 'admin'
        })
        .onConflictDoUpdate({
          target: user.email,
          set: { role: 'admin' }
        });
    }
  }
};
