import { describe, expect, it } from 'bun:test';
import {
  CUSTOM_SERVICE_BASE_RATE_CENTS,
  isKycDocumentApproved,
  isKycDocumentExpired,
  isServicePublishable,
  offerFloorCents
} from './service-publishability';

describe('isServicePublishable', () => {
  const none = new Set<string>();

  it('publishes an approved catalogue service without a credential requirement', () => {
    expect(
      isServicePublishable(
        { catalogueServiceId: 'c1', reviewStatus: 'approved', requiredDocumentTypeId: null },
        none
      )
    ).toBe(true);
  });

  it('hides custom services until an admin approves them', () => {
    for (const reviewStatus of ['pending', 'rejected'] as const) {
      expect(
        isServicePublishable(
          { catalogueServiceId: null, reviewStatus, requiredDocumentTypeId: null },
          none
        )
      ).toBe(false);
    }
  });

  it('hides a credential-gated service until the credential is approved', () => {
    const service = {
      catalogueServiceId: 'psw',
      reviewStatus: 'approved' as const,
      requiredDocumentTypeId: 'psw-doc'
    };
    expect(isServicePublishable(service, none)).toBe(false);
    expect(isServicePublishable(service, new Set(['psw-doc']))).toBe(true);
  });
});

describe('offerFloorCents', () => {
  it('is the catalogue base rate', () => {
    expect(offerFloorCents({ hourlyRateCents: 2500, catalogueBaseRateCents: 2000 })).toBe(2000);
  });

  it('is the platform base rate for a custom service', () => {
    expect(offerFloorCents({ hourlyRateCents: 4000, catalogueBaseRateCents: null })).toBe(
      CUSTOM_SERVICE_BASE_RATE_CENTS
    );
  });

  it('never exceeds the listed rate', () => {
    expect(offerFloorCents({ hourlyRateCents: 1500, catalogueBaseRateCents: 2000 })).toBe(1500);
  });
});

describe('document expiry at read time (R9)', () => {
  const now = new Date('2026-10-24T15:00:00.000Z');

  it('counts a document as valid through its expiry day', () => {
    expect(isKycDocumentExpired({ expiryDate: null }, now)).toBe(false);
    expect(isKycDocumentExpired({ expiryDate: new Date('2026-10-24T00:00:00.000Z') }, now)).toBe(
      false
    );
    expect(isKycDocumentExpired({ expiryDate: new Date('2026-10-23T00:00:00.000Z') }, now)).toBe(
      true
    );
  });

  it('treats an approved but expired document as not approved', () => {
    const expiryDate = new Date('2026-10-01T00:00:00.000Z');
    expect(isKycDocumentApproved({ status: 'approved', expiryDate }, now)).toBe(false);
    expect(isKycDocumentApproved({ status: 'approved', expiryDate: null }, now)).toBe(true);
    expect(isKycDocumentApproved({ status: 'submitted', expiryDate: null }, now)).toBe(false);
  });
});
