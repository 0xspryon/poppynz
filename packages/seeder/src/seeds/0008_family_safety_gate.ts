import { kycDocumentType } from '@repo/db/schema';
import type { Seed } from '../types';

// Families are screened too. Their gate is the same document as the
// helpers' — a vulnerable-sector check from the local police service, upload
// only since Credibled does not sell one — as its own row, because document
// types are per role and a role has exactly one gate (migration 0020).
export const familySafetyGate: Seed = {
  name: '0008_family_safety_gate',
  run: async (db) => {
    await db.insert(kycDocumentType).values({
      name: 'Vulnerable Sector Check',
      appliesToRole: 'family',
      isOptional: false,
      requiresExpiryDate: true,
      isSafetyGate: true
    });
  }
};
