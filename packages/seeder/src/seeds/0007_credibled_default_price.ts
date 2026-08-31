import { kycDocumentType } from '@repo/db/schema';
import { and, isNotNull, isNull } from 'drizzle-orm';
import type { Seed } from '../types';

/**
 * Poppynz charges CAD 55 for a Credibled check.
 *
 * The 0005 figures were placeholders I invented while Credibled's real pricing
 * was unknown — their API publishes none. This replaces them with the agreed
 * price. Admins can still set a different price per document type in Document
 * types without a deploy; this only establishes the baseline.
 */
const DEFAULT_CHECK_PRICE_CENTS = 5500;

export const credibledDefaultPrice: Seed = {
  name: '0007_credibled_default_price',
  run: async (db) => {
    await db
      .update(kycDocumentType)
      .set({ credibledCostCents: DEFAULT_CHECK_PRICE_CENTS, updatedAt: new Date() })
      .where(
        and(
          // Every fetchable type, priced or not — upload-only types must stay
          // priceless or the API's pricing invariant rejects them.
          isNotNull(kycDocumentType.credibledCheckTypeValue),
          isNull(kycDocumentType.deletedAt)
        )
      );
  }
};
