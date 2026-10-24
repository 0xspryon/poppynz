import { makeSeededTaxConfigRepo, type TaxLiveConfig } from '@repo/db';
import { toTaxSnapshot } from '../tax';
import type { TaxSnapshot } from './tax';

/** TEST ONLY: the seeded default configuration (seed 0004_tax_config) as a
 * resolver snapshot. Runtime code always reads the database. */
export const seededSnapshot = (options: { qstRegistered?: boolean } = {}): TaxSnapshot => {
  const { state } = makeSeededTaxConfigRepo((config: TaxLiveConfig) => ({
    ...config,
    registrations: config.registrations.map((row) =>
      row.program === 'qst' ? { ...row, registered: options.qstRegistered ?? true } : row
    )
  }));
  return toTaxSnapshot(state);
};
