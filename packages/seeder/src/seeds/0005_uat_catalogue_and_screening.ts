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

type DocumentTypeCandidate = { id: string; name: string };

/**
 * Document types have no stable key, and an admin may have renamed the PSW
 * type by hand ("PSW Certificate", "Personal support worker"). Prefer the
 * seeded name exactly, then a case-insensitive exact match, then a single
 * type whose name mentions PSW / personal support worker. Ambiguity or no
 * match returns null: the caller logs and skips rather than guessing.
 */
export const pickPswDocumentType = (
  types: ReadonlyArray<DocumentTypeCandidate>
): DocumentTypeCandidate | null => {
  const exact = types.find((type) => type.name === PSW_DOCUMENT);
  if (exact) return exact;
  const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const insensitive = types.filter(
    (type) => normalized(type.name) === normalized(PSW_DOCUMENT)
  );
  if (insensitive.length === 1) return insensitive[0] ?? null;
  const mentions = types.filter((type) =>
    /\bpsw\b|personal support worker/.test(normalized(type.name))
  );
  return mentions.length === 1 ? (mentions[0] ?? null) : null;
};

export const uatCatalogueAndScreening: Seed = {
  name: '0005_uat_catalogue_and_screening',
  run: async (db) => {
    const helperTypes = await db
      .select({ id: kycDocumentType.id, name: kycDocumentType.name })
      .from(kycDocumentType)
      .where(
        and(
          eq(kycDocumentType.appliesToRole, 'service-provider'),
          isNull(kycDocumentType.deletedAt)
        )
      );
    const pswType = pickPswDocumentType(helperTypes);

    const existing = await db
      .select({ id: serviceCatalogueItem.id })
      .from(serviceCatalogueItem)
      .where(and(eq(serviceCatalogueItem.name, PSW_SERVICE), isNull(serviceCatalogueItem.deletedAt)));
    if (!pswType) {
      // Never offer the PSW item without its credential gate: skip it and
      // let an admin create it (with the required document) by hand.
      console.warn(
        `[seed 0005] No single helper document type matches "${PSW_DOCUMENT}" — ` +
          `skipping the "${PSW_SERVICE}" catalogue item. Add it in the admin catalogue ` +
          'with its required credential.'
      );
    } else if (existing.length === 0) {
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
