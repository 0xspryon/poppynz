import { credibledCheckTypes } from '@repo/credibled';
import { kycDocumentType } from '@repo/db/schema';
import { eq, inArray, isNull, and } from 'drizzle-orm';
import type { Seed } from '../types';

// Maps the seeded document types onto Credibled's catalogue, read live from
// the helper account on 2026-08-22 via GET /check-types/.
//
// The headline finding: Credibled offers NO vulnerable-sector check, on any
// tier. That screen comes from the applicant's local police service and
// Credibled does not resell it, so "Vulnerable Sector Check" is upload-only
// permanently, not pending-confirmation.
//
// This seed is corrective as well as additive. The replaced `is_fetchable`
// flag was admin-toggleable, so any environment where somebody switched it on
// for a type Credibled can't actually supply has been showing a "Fetch via
// Credibled" button for a product that does not exist. Rather than trust that
// nobody did, every type not named here is explicitly cleared.

const label = (value: string) =>
  credibledCheckTypes.find((type) => type.value === value)?.label ?? value;

/** Existing seeded types that Credibled *can* supply. */
const confirmedMappings = [
  {
    name: "Government ID (Driver's Licence or Passport)",
    credibledCheckTypeValue: 'request_enhanced_identity_verification'
  }
] as const;

// Deliberately left upload-only:
//
//   Vulnerable Sector Check  — no Credibled equivalent exists.
//   First Aid Certification  ┐ these map *plausibly* onto Canadian Credential
//   Early Childhood Educator ├ Verification, but whether that product covers
//   Personal Support Worker  ┘ the specific registries is unconfirmed. Putting
//                              a Fetch button in front of a helper and failing
//                              at order time is worse than offering upload
//                              only, so they wait for an answer. Flipping one
//                              on later is a one-line seed — which is why the
//                              mapping lives in data, not in code.
const stayUploadOnly = [
  'Vulnerable Sector Check',
  'First Aid Certification',
  'Early Childhood Educator (ECE)',
  'Personal Support Worker (PSW)'
];

// New types Credibled can fetch and Poppynz has a use for. Both optional so
// existing providers aren't retroactively blocked, and neither requires an
// expiry date: a criminal record check and a driver abstract are point-in-time
// results with no expiry printed on them (how long one stays valid is Poppynz
// policy, tracked on the screening record rather than typed in by the helper).
//
// Only the enhanced criminal tier is seeded. The basic tier shares its
// Credibled "club", so ordering both yields only the enhanced one — carrying
// both as separate rows would put two near-identical entries on every
// checklist for no gain.
const newFetchableTypes = [
  {
    name: label('request_enhanced_criminal_record_check'),
    credibledCheckTypeValue: 'request_enhanced_criminal_record_check'
  },
  {
    name: "Driver's Abstract",
    credibledCheckTypeValue: 'request_motor_vehicle_records'
  }
] as const;

export const credibledCheckTypesSeed: Seed = {
  name: '0004_credibled_check_types',
  run: async (db) => {
    for (const mapping of confirmedMappings) {
      await db
        .update(kycDocumentType)
        .set({ credibledCheckTypeValue: mapping.credibledCheckTypeValue, updatedAt: new Date() })
        .where(eq(kycDocumentType.name, mapping.name));
    }

    await db
      .update(kycDocumentType)
      .set({ credibledCheckTypeValue: null, updatedAt: new Date() })
      .where(inArray(kycDocumentType.name, stayUploadOnly));

    const existing = await db
      .select({ name: kycDocumentType.name })
      .from(kycDocumentType)
      .where(
        and(
          isNull(kycDocumentType.deletedAt),
          inArray(
            kycDocumentType.name,
            newFetchableTypes.map((type) => type.name)
          )
        )
      );
    const existingNames = new Set(existing.map((row) => row.name));
    const toInsert = newFetchableTypes.filter((type) => !existingNames.has(type.name));

    if (toInsert.length > 0) {
      await db.insert(kycDocumentType).values(
        toInsert.map((type) => ({
          name: type.name,
          appliesToRole: 'service-provider' as const,
          isOptional: true,
          requiresExpiryDate: false,
          credibledCheckTypeValue: type.credibledCheckTypeValue
        }))
      );
    }
  }
};
