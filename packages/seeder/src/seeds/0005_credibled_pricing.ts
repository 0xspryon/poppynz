import { credibledCheckTypes } from '@repo/credibled';
import { kycDocumentType } from '@repo/db/schema';
import { eq } from 'drizzle-orm';
import type { Seed } from '../types';

// Corrects the catalogue 0004 set up, and prices what is left fetchable.
//
// Three decisions are baked in here:
//
//   1. **Government ID drops back to upload-only.** Credibled automatically
//      enables Enhanced Identity Verification alongside any Canadian criminal
//      check, so selling identity verification as a separate line item bills
//      the applicant twice for one thing.
//   2. **First Aid Certification becomes fetchable.** Confirmed with Credibled
//      that Canadian Credential Verification covers it. ECE and PSW stay
//      upload-only — they were never confirmed, and guessing puts a Fetch
//      button in front of a helper that fails at order time.
//   3. **Every fetchable type gets a price.** Credibled's API exposes no
//      pricing, so these are configured, not quoted. They are placeholders
//      until real vendor pricing is confirmed — an admin can edit them in
//      Document types without a deploy.

const label = (value: string) =>
  credibledCheckTypes.find((type) => type.value === value)?.label ?? value;

/** Pre-tax, in cents. Placeholder pricing — see note 3 above. */
const pricing: ReadonlyArray<{
  name: string;
  credibledCheckTypeValue: string | null;
  credibledCostCents: number | null;
}> = [
  {
    name: label('request_enhanced_criminal_record_check'),
    credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
    credibledCostCents: 4500
  },
  {
    name: "Driver's Abstract",
    credibledCheckTypeValue: 'request_motor_vehicle_records',
    credibledCostCents: 2500
  },
  {
    name: 'First Aid Certification',
    credibledCheckTypeValue: 'request_credential_verification',
    credibledCostCents: 3000
  },
  // Bundled free with any Canadian criminal check — never sold separately.
  {
    name: "Government ID (Driver's Licence or Passport)",
    credibledCheckTypeValue: null,
    credibledCostCents: null
  }
];

export const credibledPricing: Seed = {
  name: '0005_credibled_pricing',
  run: async (db) => {
    for (const entry of pricing) {
      await db
        .update(kycDocumentType)
        .set({
          credibledCheckTypeValue: entry.credibledCheckTypeValue,
          credibledCostCents: entry.credibledCostCents,
          updatedAt: new Date()
        })
        .where(eq(kycDocumentType.name, entry.name));
    }
  }
};
