/**
 * Which of a helper's services families may see, book and reach out about.
 *
 * One rule, shared by the search index, the public profile, reach-outs and
 * contract terms, so no surface can list a service another one hides:
 *
 *   - a custom (free-text) service must have been approved by an admin
 *     (UAT #34) — pending and rejected ones stay private to the helper;
 *   - a catalogue service that names a required credential (Personal support
 *     needs an approved PSW credential, UAT #1/#18) is only publishable while
 *     the helper's document of that type is approved. A credential that is
 *     later rejected or re-uploaded hides the service again until reviewed.
 */

/** The floor for a custom service, and for any service whose catalogue item
 * is gone: the platform base rate families are told helpers start at. */
export const CUSTOM_SERVICE_BASE_RATE_CENTS = 2000;

export type PublishabilityInput = {
  catalogueServiceId: string | null;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  /** The linked catalogue item's credential requirement, if any. */
  requiredDocumentTypeId: string | null;
};

export const isServicePublishable = (
  service: PublishabilityInput,
  approvedDocumentTypeIds: ReadonlySet<string>
) =>
  service.reviewStatus === 'approved' &&
  (service.requiredDocumentTypeId === null ||
    approvedDocumentTypeIds.has(service.requiredDocumentTypeId));

/**
 * The lowest hourly rate a family may offer for a service (UAT #39): the
 * service's base rate — its catalogue item's, or the platform base rate for a
 * custom service — never more than what the helper lists it at.
 */
export const offerFloorCents = (service: {
  hourlyRateCents: number;
  catalogueBaseRateCents: number | null;
}) => Math.min(service.hourlyRateCents, service.catalogueBaseRateCents ?? CUSTOM_SERVICE_BASE_RATE_CENTS);
