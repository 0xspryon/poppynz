import { describe, expect, it } from 'bun:test';
import {
  agreementTemplateSchema,
  renderTemplate,
  sampleAgreementValues,
  validateTemplate
} from '@repo/db/agreement-template';
import { serviceAgreementContent } from './0007_service_agreement';

describe('0007 seeded service agreement', () => {
  it('uses only known placeholders, so it renders at signing', async () => {
    expect(validateTemplate(await serviceAgreementContent(), agreementTemplateSchema)).toEqual([]);
  });

  it('is marked as a draft pending legal review and not legal advice', async () => {
    const content = await serviceAgreementContent();
    expect(content).toContain('Draft — pending legal review');
    expect(content).toContain('not legal advice');
  });

  it('covers parties, services, schedule, fees, cancellations, ending, platform role, signatures', async () => {
    const rendered = renderTemplate(
      await serviceAgreementContent(),
      agreementTemplateSchema,
      sampleAgreementValues('en')
    );
    for (const heading of [
      '## 1. The parties',
      '## 2. Services',
      '## 3. Schedule',
      '## 4. Payment and fees',
      '## 5. Cancellations',
      '## 6. Ending the contract',
      "## 7. Poppynz's role",
      '## 8. Signatures'
    ]) {
      expect(rendered).toContain(heading);
    }
    expect(rendered).toContain('**Childcare** at $26.00 per hour');
    expect(rendered).toContain('Tuesday, 3:30 p.m. to 5:30 p.m.');
    expect(rendered).toContain('version 1 (published October 1, 2026)');
    expect(rendered).not.toContain('{{');
  });
});
