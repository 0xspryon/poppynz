import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { tcDocument, tcDocumentVersion } from '@repo/db/schema';
import type { Seed } from '../types';
import { SERVICE_AGREEMENT_SLUG } from './0007_service_agreement';

export const serviceAgreementV2Content = () =>
  readFile(new URL('./content/service_agreement_v2.md', import.meta.url), 'utf8');

/** The description the default v2 is published with. */
export const SERVICE_AGREEMENT_V2_DESCRIPTION =
  'Default template v2 — adds the extra-session consent clause; Draft, pending legal review';

/** The texts seed 0007 has ever published as v1 (sha-256): the first draft
 * and the "when cards are charged" fix (05c682e). */
export const SEEDED_V1_SHA256: ReadonlySet<string> = new Set([
  '9c087b0a037287342652971d66ed4b5d2790d15f63a7572f47f140874fb7f079',
  '423eb8cc36fa46aa9190d7ab0fd0588a439a7858966c14e24986b1a5851c4a02'
]);

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

type VersionRow = { locale: string; version: number; content: string; publishedAt: Date | null };

/**
 * Whether the default v2 may be published over what is on file: only when
 * the live agreement is still exactly the seeded default v1 — one published
 * English version 1 whose text is one 0007 published, and nothing else (no
 * later revision, no translation, no open draft). Anything an admin did
 * means the template is theirs: never overwritten.
 */
export const decideServiceAgreementV2 = (
  document: { id: string } | null,
  versions: ReadonlyArray<VersionRow>
): { publish: true } | { publish: false; reason: string } => {
  if (document === null) return { publish: false, reason: 'no live service agreement' };
  if (versions.length !== 1) {
    return {
      publish: false,
      reason: `the service agreement has ${versions.length} versions (an admin edited it)`
    };
  }
  const [only] = versions as [VersionRow];
  if (only.locale !== 'en' || only.version !== 1 || only.publishedAt === null) {
    return {
      publish: false,
      reason: 'the service agreement is not the seeded v1 (an admin edited it)'
    };
  }
  if (!SEEDED_V1_SHA256.has(sha256(only.content))) {
    return { publish: false, reason: 'the v1 text was edited by an admin' };
  }
  return { publish: true };
};

/**
 * Tier 3 step 3: version 2 of the default written service agreement, with
 * the extra-session consent clause (the family authorises charges for the
 * extra sessions it confirms, at the contract's rates). Published ONLY over
 * the untouched seeded default v1 — an admin-edited template is never
 * overwritten (logged and skipped). Existing contracts don't re-sign
 * (spec §12 decision 5): their signatures keep the text they signed, and
 * each extra session carries its own "I authorise this charge".
 */
export const serviceAgreementV2: Seed = {
  name: '0008_service_agreement_v2',
  run: async (db) => {
    const [document] = await db
      .select({ id: tcDocument.id })
      .from(tcDocument)
      .where(and(eq(tcDocument.slug, SERVICE_AGREEMENT_SLUG), isNull(tcDocument.deletedAt)))
      .limit(1);
    const versions = document
      ? await db
          .select({
            locale: tcDocumentVersion.locale,
            version: tcDocumentVersion.version,
            content: tcDocumentVersion.content,
            publishedAt: tcDocumentVersion.publishedAt
          })
          .from(tcDocumentVersion)
          .where(eq(tcDocumentVersion.documentId, document.id))
          .orderBy(asc(tcDocumentVersion.version))
      : [];
    const decision = decideServiceAgreementV2(document ?? null, versions);
    if (!decision.publish) {
      console.log(`[seed] 0008_service_agreement_v2 skipped: ${decision.reason}.`);
      return;
    }
    await db.insert(tcDocumentVersion).values({
      documentId: document!.id,
      locale: 'en',
      version: 2,
      description: SERVICE_AGREEMENT_V2_DESCRIPTION,
      content: await serviceAgreementV2Content(),
      checkboxLabel: 'I have read and agree to this Service Agreement.',
      publishedAt: new Date()
    });
    console.log('[seed] 0008_service_agreement_v2 published version 2 of the service agreement.');
  }
};
