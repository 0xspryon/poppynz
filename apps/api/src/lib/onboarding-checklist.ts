import {
  KycDocumentRepo,
  KycDocumentTypeRepo,
  SafetyVerificationRepo,
  ServiceOfferedRepo,
  type KycDocument,
  type KycDocumentType,
  type SafetyVerification,
  type SafetyVerificationRole
} from '@repo/db';
import { presentedStatus, toDateOnly } from './safety-verification';
import { Effect } from 'effect';

// Shared assembly of an applicant's document checklist (active types for their
// role merged with submitted documents) and the advisory warnings derived from
// it. Used by both onboarding endpoints, both admin approval-request views and
// the safety-verification endpoint, so the surfaces can't drift apart.
//
// The role is a parameter rather than a constant: document types have always
// carried `appliesToRole`, but the checklist used to hard-filter to
// service-provider, which made families impossible to screen.

/**
 * A type that BACKS safety verification reads its status from the verification
 * record, not from kyc_documents — that record is the single source of truth
 * for whether the applicant is cleared, so the checklist must not show a
 * second, independent answer beside it.
 */
const safetyVerificationChecklistStatus = (
  verification: SafetyVerification | null,
  today: string
) => {
  if (!verification) {
    return 'missing' as const;
  }
  switch (presentedStatus(verification, today)) {
    case 'review_required':
      return 'submitted' as const;
    case 'verified':
      return 'approved' as const;
    case 'rejected':
      return 'rejected' as const;
    // not_started, payment_pending, invited, in_progress and expired all mean
    // there is nothing decided to show — the applicant still owes us evidence.
    default:
      return 'missing' as const;
  }
};

export const buildDocumentChecklist = (
  types: Array<KycDocumentType>,
  docs: Array<KycDocument>,
  role: SafetyVerificationRole,
  verification: SafetyVerification | null = null
) => {
  const docsByTypeId = new Map(docs.map((doc) => [doc.documentTypeId, doc]));
  const today = toDateOnly(new Date());

  return types
    .filter((type) => type.appliesToRole === role)
    .map((type) => {
      const backsSafetyVerification = type.backsSafetyVerification;
      // For a backing type the "document" is the one attached to the
      // verification record, so both the status and the file come from there.
      const uploaded =
        backsSafetyVerification && verification?.route === 'uploaded_document'
          ? verification
          : null;
      const document = backsSafetyVerification
        ? null
        : (docsByTypeId.get(type.id) ?? null);

      return {
        documentTypeId: type.id,
        name: type.name,
        isOptional: type.isOptional,
        requiresExpiryDate: type.requiresExpiryDate,
        credibledCheckTypeValue: type.credibledCheckTypeValue,
        // Derived, never stored: a type is fetchable exactly when it carries a
        // Credibled check type, so the flag can't drift from the mapping.
        isFetchable: type.credibledCheckTypeValue !== null,
        backsSafetyVerification,
        status: backsSafetyVerification
          ? safetyVerificationChecklistStatus(verification, today)
          : document
            ? document.status
            : ('missing' as const),
        document: uploaded
          ? {
              id: uploaded.id,
              filename: uploaded.filename,
              expiryDate: uploaded.expiresOn,
              reason: uploaded.decisionReason,
              submittedAt: uploaded.createdAt.toISOString()
            }
          : document
            ? {
                id: document.id,
                filename: document.filename,
                expiryDate: document.expiryDate?.toISOString() ?? null,
                reason: document.reason,
                submittedAt: document.createdAt.toISOString()
              }
            : null
      };
    });
};

export type DocumentChecklistEntry = ReturnType<typeof buildDocumentChecklist>[number];

// `missingServicesOffered` only means anything for helpers — families list
// services *needed*, which is a different table and not part of approval.
export const checklistWarnings = (
  checklist: Array<DocumentChecklistEntry>,
  servicesCount: number,
  role: SafetyVerificationRole = 'service-provider'
) => ({
  missingRequiredDocuments: checklist
    .filter((entry) => !entry.isOptional && entry.status === 'missing')
    .map((entry) => ({ documentTypeId: entry.documentTypeId, name: entry.name })),
  missingServicesOffered: role === 'service-provider' && servicesCount === 0
});

export const loadChecklist = (userId: string, role: SafetyVerificationRole) =>
  Effect.gen(function* () {
    const typeRepo = yield* KycDocumentTypeRepo;
    const types = yield* typeRepo.listActive();

    return yield* loadChecklistWithTypes(types, role)(userId);
  });

// Variant for callers that iterate many applicants: fetch the type list once
// and reuse it per user.
export const loadChecklistWithTypes =
  (types: Array<KycDocumentType>, role: SafetyVerificationRole) => (userId: string) =>
    Effect.gen(function* () {
      const docRepo = yield* KycDocumentRepo;
      const serviceRepo = yield* ServiceOfferedRepo;
      const safetyRepo = yield* SafetyVerificationRepo;
      const [docs, services, verification] = yield* Effect.all(
        [
          docRepo.findByUserId(userId),
          serviceRepo.listByUserId(userId),
          safetyRepo.findLive(userId, role)
        ],
        { concurrency: 'unbounded' }
      );
      const checklist = buildDocumentChecklist(types, docs, role, verification);

      return {
        checklist,
        services,
        warnings: checklistWarnings(checklist, services.length, role)
      };
    });
