import { kycDocumentType } from '@repo/db/schema';
import { eq } from 'drizzle-orm';
import type { Seed } from '../types';

// The vulnerable-sector check is the applicant's safety-verification evidence,
// so it is supplied on the Documents page like every other document — and the
// upload there writes the safety_verification record instead of a parallel KYC
// document row. Before this, the same file could be submitted in two places
// and only one of them moved the safety gate.
export const vscBacksSafetyVerification: Seed = {
  name: '0006_vsc_backs_safety_verification',
  run: async (db) => {
    await db
      .update(kycDocumentType)
      .set({ backsSafetyVerification: true, updatedAt: new Date() })
      .where(eq(kycDocumentType.name, 'Vulnerable Sector Check'));
  }
};
