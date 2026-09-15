import type { KycDocument, KycDocumentType, SafetyVerification } from '@repo/db';
import { describe, expect, it } from 'vitest';
import { buildDocumentChecklist, checklistWarnings } from './onboarding-checklist';

// The checklist is the one place three kinds of evidence meet: uploaded
// documents, documents Credibled fetched, and the safety verdict behind the
// gate type. Each has to read from its own source of truth.

const type = (overrides: Partial<KycDocumentType> = {}): KycDocumentType =>
  ({
    id: 'type-1',
    name: 'First Aid Certification',
    appliesToRole: 'service-provider',
    isOptional: false,
    requiresExpiryDate: false,
    credibledCheckTypeValue: 'request_canadian_credential_verification',
    credibledCostCents: 2500,
    isSafetyGate: false,
    deletedAt: null,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    ...overrides
  }) as KycDocumentType;

const gate = type({
  id: 'gate-1',
  name: 'Vulnerable Sector Check',
  isSafetyGate: true,
  credibledCheckTypeValue: null,
  credibledCostCents: null
});

const document = (overrides: Partial<KycDocument> = {}): KycDocument =>
  ({
    id: 'doc-1',
    userId: 'provider-1',
    documentTypeId: 'type-1',
    filename: 'first-aid.pdf',
    fileKey: 'users/provider-1/first-aid.pdf',
    expiryDate: null,
    status: 'submitted',
    source: 'upload',
    reason: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as KycDocument;

const verification = (overrides: Partial<SafetyVerification> = {}): SafetyVerification =>
  ({
    id: 'sv-1',
    userId: 'provider-1',
    role: 'service-provider',
    status: 'review_required',
    route: 'uploaded_document',
    checkOrderId: null,
    consentAt: null,
    consentPolicyVersion: null,
    issuingAuthority: 'Toronto Police Service',
    documentNumber: 'VSC-1',
    filename: 'vsc.pdf',
    fileKey: 'users/provider-1/vsc.pdf',
    issuedOn: '2026-01-01',
    expiresOn: '2099-01-01',
    reviewedBy: null,
    reviewedAt: null,
    decisionReason: null,
    expiryNotifiedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerification;

const entry = (list: ReturnType<typeof buildDocumentChecklist>, id: string) =>
  list.find((item) => item.documentTypeId === id)!;

describe('the document checklist', () => {
  it('reads an uploaded document from kyc_documents', () => {
    const list = buildDocumentChecklist([type()], [document()], 'service-provider');
    expect(entry(list, 'type-1').status).toBe('submitted');
    expect(entry(list, 'type-1').document).toMatchObject({
      filename: 'first-aid.pdf',
      source: 'upload'
    });
  });

  it('reads a document Credibled fetched the same way, labelled by source', () => {
    // Before fetched checks were recorded, this entry read "missing" for
    // evidence the helper had paid for.
    const fetched = document({ filename: null, fileKey: null, source: 'credibled' });
    const list = buildDocumentChecklist([type()], [fetched], 'service-provider');
    expect(entry(list, 'type-1').status).toBe('submitted');
    expect(entry(list, 'type-1').document).toMatchObject({ filename: null, source: 'credibled' });
  });

  it('reads the gate type from the safety verdict, never from kyc_documents', () => {
    // A stray kyc_documents row for the gate type must not produce a second,
    // independent answer beside the verdict.
    const stray = document({ id: 'doc-9', documentTypeId: 'gate-1', status: 'approved' });
    const awaiting = buildDocumentChecklist([gate], [stray], 'service-provider', verification());
    expect(entry(awaiting, 'gate-1').status).toBe('submitted');
    expect(entry(awaiting, 'gate-1').document?.filename).toBe('vsc.pdf');

    const verified = buildDocumentChecklist(
      [gate],
      [stray],
      'service-provider',
      verification({ status: 'verified' })
    );
    expect(entry(verified, 'gate-1').status).toBe('approved');

    const none = buildDocumentChecklist([gate], [stray], 'service-provider', null);
    expect(entry(none, 'gate-1').status).toBe('missing');
  });

  it('shows no file for a gate verdict that came from Credibled', () => {
    // The verdict's evidence is the vendor report, opened elsewhere by an
    // administrator — there is nothing of ours to attach.
    const list = buildDocumentChecklist(
      [gate],
      [],
      'service-provider',
      verification({ route: 'credibled', filename: null, fileKey: null, checkOrderId: 'order-1' })
    );
    expect(entry(list, 'gate-1').status).toBe('submitted');
    expect(entry(list, 'gate-1').document).toBeNull();
  });

  it('only lists the types for the role being screened', () => {
    const family = type({ id: 'family-1', appliesToRole: 'family' });
    const list = buildDocumentChecklist([type(), family], [], 'family');
    expect(list.map((item) => item.documentTypeId)).toEqual(['family-1']);
  });

  it('warns about required types that are still missing', () => {
    const list = buildDocumentChecklist(
      [type(), type({ id: 'opt-1', name: 'Optional thing', isOptional: true })],
      [],
      'service-provider'
    );
    expect(checklistWarnings(list, 1).missingRequiredDocuments).toEqual([
      { documentTypeId: 'type-1', name: 'First Aid Certification' }
    ]);
  });
});
