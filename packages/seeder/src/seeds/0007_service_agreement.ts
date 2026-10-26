import { readFile } from 'node:fs/promises';
import { tcDocument, tcDocumentVersion } from '@repo/db/schema';
import type { Seed } from '../types';

export const SERVICE_AGREEMENT_SLUG = 'service_agreement';

export const serviceAgreementContent = () =>
  readFile(new URL('./content/service_agreement.md', import.meta.url), 'utf8');

/**
 * The default written service agreement (UAT round 2, item 4), published as
 * version 1 in English. It is a structured draft pending legal review — the
 * title says so in the admin list and to the people signing — and admins
 * replace it through /admin/tcs. Skipped where a service agreement already
 * exists (an admin created one by hand).
 */
export const serviceAgreement: Seed = {
  name: '0007_service_agreement',
  run: async (db) => {
    const [document] = await db
      .insert(tcDocument)
      .values({
        slug: SERVICE_AGREEMENT_SLUG,
        title: 'Service Agreement (Draft — pending legal review)',
        appliesToRole: 'all',
        kind: 'service_agreement'
      })
      .onConflictDoNothing()
      .returning();
    if (!document) return;

    await db.insert(tcDocumentVersion).values({
      documentId: document.id,
      locale: 'en',
      version: 1,
      description: 'Default template — Draft, pending legal review',
      content: await serviceAgreementContent(),
      checkboxLabel: 'I have read and agree to this Service Agreement.',
      publishedAt: new Date()
    });
  }
};
