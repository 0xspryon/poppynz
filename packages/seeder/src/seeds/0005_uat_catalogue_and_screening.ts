import { kycDocumentType, serviceCatalogueItem } from '@repo/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { Seed } from '../types';

// Corrections from the staging UAT of 2026-10-12. Seeds never re-run, so the
// earlier catalogue and document-type seeds stay as they were; this one moves
// every environment — fresh or already seeded — to the agreed state.
//
//   - #1/#18: a "Personal support (PSW)" service a helper can only offer once
//     an admin has approved their PSW credential (the catalogue item names the
//     required document type). Elderly Check-in stays as the companionship
//     service with no credential.
//   - #8: the two placeholder-sounding chores get plain names. Renaming keeps
//     existing helper listings and family needs linked (they keep their own
//     name snapshot until edited).
//   - #17: the helper criminal record check is required — the agreed rule,
//     already switched by hand on staging and still owed by production.
//
// Every step is guarded so it is a no-op where an admin already made the
// change by hand.

const PSW_SERVICE = 'Personal support (PSW)';
const PSW_DOCUMENT = 'Personal Support Worker (PSW)';

export const uatCatalogueAndScreening: Seed = {
  name: '0005_uat_catalogue_and_screening',
  run: async (db) => {
    const [pswType] = await db
      .select({ id: kycDocumentType.id })
      .from(kycDocumentType)
      .where(
        and(
          eq(kycDocumentType.name, PSW_DOCUMENT),
          eq(kycDocumentType.appliesToRole, 'service-provider'),
          isNull(kycDocumentType.deletedAt)
        )
      )
      .limit(1);
    if (!pswType) {
      throw new Error(`Document type "${PSW_DOCUMENT}" for helpers is missing — run 0001 first.`);
    }

    const existing = await db
      .select({ id: serviceCatalogueItem.id })
      .from(serviceCatalogueItem)
      .where(and(eq(serviceCatalogueItem.name, PSW_SERVICE), isNull(serviceCatalogueItem.deletedAt)));
    if (existing.length === 0) {
      await db.insert(serviceCatalogueItem).values({
        name: PSW_SERVICE,
        category: 'Elderly Care',
        // Launch placeholder above Elderly Check-in; admins adjust it in the
        // service catalogue without a deploy.
        baseHourlyRateCents: 2500,
        isLive: true,
        requiredDocumentTypeId: pswType.id
      });
    }

    for (const [from, to] of [
      ['Taking out the rubbish/trash', 'Garbage & recycling'],
      ['Bringing in your Amazon packages', 'Parcel & mail pickup']
    ] as const) {
      await db
        .update(serviceCatalogueItem)
        .set({ name: to, updatedAt: new Date() })
        .where(and(eq(serviceCatalogueItem.name, from), isNull(serviceCatalogueItem.deletedAt)));
    }

    await db
      .update(kycDocumentType)
      .set({ isOptional: false, updatedAt: new Date() })
      .where(
        and(
          eq(kycDocumentType.appliesToRole, 'service-provider'),
          eq(kycDocumentType.credibledCheckTypeValue, 'request_enhanced_criminal_record_check'),
          isNull(kycDocumentType.deletedAt)
        )
      );
  }
};
