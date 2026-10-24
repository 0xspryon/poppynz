import {
  defaultTaxJurisdictions,
  defaultTaxRates,
  defaultTaxRegistrations,
  defaultTaxSupplyTypes,
  defaultTaxTreatments
} from '@repo/db/tax-defaults';
import {
  taxConfigAudit,
  taxJurisdiction,
  taxRate,
  taxRegistration,
  taxSupplyTreatment,
  taxSupplyType
} from '@repo/db/schema';
import type { Seed } from '../types';

// The default sales-tax configuration (see @repo/db/tax-defaults for what it
// contains and why). After this seed has run anywhere, corrections are made
// in the tax configuration — with its audit trail — never by editing seeds.

const reason = 'seed 0004_tax_config: default configuration';

export const taxConfig: Seed = {
  name: '0004_tax_config',
  run: async (db) => {
    await db.insert(taxJurisdiction).values([...defaultTaxJurisdictions]);
    await db.insert(taxSupplyType).values(defaultTaxSupplyTypes);
    const rates = await db.insert(taxRate).values(defaultTaxRates).returning();
    const treatments = await db.insert(taxSupplyTreatment).values(defaultTaxTreatments).returning();
    const registrations = await db
      .insert(taxRegistration)
      .values(defaultTaxRegistrations)
      .returning();
    // The configuration's history starts here, like every later change.
    const audit = [
      ...rates.map((row) => ({ entity: 'tax_rate', recordId: row.id, after: row })),
      ...treatments.map((row) => ({
        entity: 'tax_supply_treatment',
        recordId: row.id,
        after: row
      })),
      ...registrations.map((row) => ({ entity: 'tax_registration', recordId: row.id, after: row }))
    ];
    await db.insert(taxConfigAudit).values(
      audit.map((entry) => ({
        ...entry,
        action: 'create' as const,
        actorUserId: null,
        reason,
        before: null,
        after: JSON.parse(JSON.stringify(entry.after))
      }))
    );
  }
};
