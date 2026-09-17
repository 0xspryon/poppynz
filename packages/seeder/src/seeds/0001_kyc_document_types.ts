import { credibledCheckTypes } from '@repo/credibled';
import { kycDocumentType } from '@repo/db/schema';
import type { Seed } from '../types';

// The complete document-type catalogue, per role. Nothing is in production
// yet, so the earlier corrective seeds (Credibled mapping, pricing, safety
// gates) are folded in here rather than replayed as a history.
//
// Decisions baked in:
//
//   - **Identity is upload-only.** A driver's licence or passport is the only
//     acceptable proof, collected through one required slot. Credibled bundles
//     Enhanced Identity Verification free with any Canadian criminal check, so
//     selling it as its own line would bill the applicant twice.
//   - **Credibled sells no vulnerable-sector check**, on any tier (confirmed
//     against GET /check-types/ on 2026-08-22). It comes from the applicant's
//     local police service, so it is upload-only for both roles — and it is the
//     safety gate for each role: uploading it writes the safety_verification
//     record instead of an ordinary KYC document. One gate per role; the
//     partial unique index on the table enforces it.
//   - **First Aid is fetchable** via Canadian Credential Verification, which
//     Credibled confirmed covers it. ECE and PSW plausibly map to the same
//     product but were never confirmed, so they stay upload-only: a Fetch
//     button that fails at order time is worse than none.
//   - **Only the enhanced criminal tier is offered.** The basic tier shares its
//     Credibled club, so ordering both yields only the enhanced one.
//   - **Fetched checks carry no expiry date.** A criminal record check and a
//     driver abstract are point-in-time results; how long one stays valid is
//     Poppynz policy on the screening record, not something the helper types.
//   - **Every fetchable type costs CAD 55 pre-tax.** Credibled's API publishes
//     no pricing, so this is configured, not quoted. Admins can change it per
//     type under Document types without a deploy.

const CHECK_PRICE_CENTS = 5500;

const label = (value: string) =>
  credibledCheckTypes.find((type) => type.value === value)?.label ?? value;

export const kycDocumentTypes: Seed = {
  name: '0001_kyc_document_types',
  run: async (db) => {
    await db.insert(kycDocumentType).values([
      // Helpers
      {
        name: "Government ID (Driver's Licence or Passport)",
        appliesToRole: 'service-provider',
        isOptional: false,
        requiresExpiryDate: true
      },
      {
        name: 'Vulnerable Sector Check',
        appliesToRole: 'service-provider',
        isOptional: true,
        requiresExpiryDate: true,
        isSafetyGate: true
      },
      {
        name: 'First Aid Certification',
        appliesToRole: 'service-provider',
        isOptional: true,
        requiresExpiryDate: true,
        credibledCheckTypeValue: 'request_credential_verification',
        credibledCostCents: CHECK_PRICE_CENTS
      },
      {
        name: 'Early Childhood Educator (ECE)',
        appliesToRole: 'service-provider',
        isOptional: true,
        requiresExpiryDate: false
      },
      {
        name: 'Personal Support Worker (PSW)',
        appliesToRole: 'service-provider',
        isOptional: true,
        requiresExpiryDate: false
      },
      {
        name: label('request_enhanced_criminal_record_check'),
        appliesToRole: 'service-provider',
        isOptional: true,
        requiresExpiryDate: false,
        credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
        credibledCostCents: CHECK_PRICE_CENTS
      },
      {
        name: "Driver's Abstract",
        appliesToRole: 'service-provider',
        isOptional: true,
        requiresExpiryDate: false,
        credibledCheckTypeValue: 'request_motor_vehicle_records',
        credibledCostCents: CHECK_PRICE_CENTS
      },
      // Families are screened too: the same police check, as its own row,
      // because types are per role and each role has exactly one gate.
      {
        name: 'Vulnerable Sector Check',
        appliesToRole: 'family',
        isOptional: true,
        requiresExpiryDate: true,
        isSafetyGate: true
      },
      {
        name: label('request_enhanced_criminal_record_check'),
        appliesToRole: 'family',
        isOptional: false,
        requiresExpiryDate: false,
        credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
        credibledCostCents: CHECK_PRICE_CENTS
      }
    ]);
  }
};
