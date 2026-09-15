import { kycDocumentType } from '@repo/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Seed } from '../types';

// The vulnerable-sector check is the helper's safety gate, so it is supplied
// on the Documents page like every other document — and the upload there
// writes the safety_verification record instead of a parallel KYC document
// row. Before this, the same file could be submitted in two places and only
// one of them moved the safety gate.
//
// Scoped to the helper role: the gate is one type PER ROLE (migration 0020),
// so a family type of the same name must not be swept up here.
export const vscBacksSafetyVerification: Seed = {
  name: '0006_vsc_backs_safety_verification',
  run: async (db) => {
    await db
      .update(kycDocumentType)
      .set({ isSafetyGate: true, updatedAt: new Date() })
      .where(
        and(
          eq(kycDocumentType.name, 'Vulnerable Sector Check'),
          eq(kycDocumentType.appliesToRole, 'service-provider')
        )
      );
  }
};
