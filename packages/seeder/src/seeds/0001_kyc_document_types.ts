import { kycDocumentType } from '@repo/db/schema';
import type { Seed } from '../types';

// UAT round 1: the only acceptable proof of identity is a driver's licence or
// passport, collected through a single required document slot; every other
// document (checks, certifications, credentials) is optional.
export const kycDocumentTypes: Seed = {
  name: '0001_kyc_document_types',
  run: async (db) => {
    await db.insert(kycDocumentType).values([
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
        requiresExpiryDate: true
      },
      {
        name: 'First Aid Certification',
        appliesToRole: 'service-provider',
        isOptional: true,
        requiresExpiryDate: true
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
      }
    ]);
  }
};
