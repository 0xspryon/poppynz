import { describe, expect, it } from 'bun:test';
import {
  CUSTOM_SERVICE_BASE_RATE_CENTS,
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
