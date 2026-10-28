import { describe, expect, it } from 'bun:test';
import {
  agreementTemplateSchema,
  renderTemplate,
  sampleAgreementValues,
  validateTemplate
} from '@repo/db/agreement-template';
import { serviceAgreementContent } from './0007_service_agreement';
import {
  decideServiceAgreementV2,
  serviceAgreementV2Content,
  sha256,
  SEEDED_V1_SHA256
} from './0008_service_agreement_v2';

const published = new Date('2026-10-01T12:00:00.000Z');

describe('0008 service agreement v2 — the guard', () => {
  it('publishes over the untouched seeded default v1 (either text 0007 ever published)', async () => {
    const v1 = await serviceAgreementContent();
    expect(SEEDED_V1_SHA256.has(sha256(v1))).toBe(true);
    expect(
      decideServiceAgreementV2({ id: 'doc' }, [
        { locale: 'en', version: 1, content: v1, publishedAt: published }
      ])
    ).toEqual({ publish: true });
  });

  it('never overwrites an admin-edited template', async () => {
    const v1 = await serviceAgreementContent();
    const cases = [
      // The v1 text was edited.
      [{ locale: 'en', version: 1, content: `${v1}\nA clause.`, publishedAt: published }],
      // A later revision was published.
      [
        { locale: 'en', version: 1, content: v1, publishedAt: published },
        { locale: 'en', version: 2, content: 'Ours', publishedAt: published }
      ],
      // A French translation was added.
      [
        { locale: 'en', version: 1, content: v1, publishedAt: published },
        { locale: 'fr', version: 1, content: 'Contrat', publishedAt: published }
      ],
      // A draft is open.
      [
        { locale: 'en', version: 1, content: v1, publishedAt: published },
        { locale: 'en', version: 2, content: 'Draft', publishedAt: null }
      ]
    ];
    for (const versions of cases) {
      expect(decideServiceAgreementV2({ id: 'doc' }, versions).publish).toBe(false);
    }
    expect(decideServiceAgreementV2(null, []).publish).toBe(false);
  });
});

describe('0008 service agreement v2 — the text', () => {
  it('uses only known placeholders, so it renders at signing', async () => {
    expect(validateTemplate(await serviceAgreementV2Content(), agreementTemplateSchema)).toEqual(
      []
    );
  });

  it('adds the extra-session consent clause with the configured delay, lookback and response window', async () => {
    const rendered = renderTemplate(
      await serviceAgreementV2Content(),
      agreementTemplateSchema,
      sampleAgreementValues('en')
    );
    expect(rendered).toContain('## 5. Extra sessions');
    expect(rendered).toContain(
      "**The Family authorises Poppynz to charge the Family's card on file for each extra session the Family confirms or proposes, at the hourly rates in section 2"
    );
    expect(rendered).toContain('The charge is made 60 minutes after both Parties have confirmed');
    expect(rendered).toContain('up to 14 days in the past');
    expect(rendered).toContain('not confirmed within 48 hours lapses');
    expect(rendered).toContain('Silence is never a confirmation');
    for (const heading of [
      '## 6. Cancellations',
      '## 7. Ending the contract',
      "## 8. Poppynz's role",
      '## 9. Signatures'
    ]) {
      expect(rendered).toContain(heading);
    }
    // The no-end-date sentence points at the renumbered "Ending" section.
    expect(await serviceAgreementV2Content()).toContain('until either Party ends it (section 7)');
    expect(rendered).toContain('Draft — pending legal review');
    expect(rendered).not.toContain('{{');
  });
});
