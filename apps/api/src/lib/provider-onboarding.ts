import {
  KycDocumentRepo,
  KycDocumentTypeRepo,
  ServiceOfferedRepo,
  type KycDocument,
  type KycDocumentType
} from '@repo/db';
import { Effect } from 'effect';

// Shared assembly of the provider's document checklist (active types merged
// with submitted documents) and the advisory warnings derived from it. Used by
// the provider onboarding endpoint and both admin approval-request views so
// the three surfaces can't drift apart.

export const buildDocumentChecklist = (types: Array<KycDocumentType>, docs: Array<KycDocument>) => {
  const docsByTypeId = new Map(docs.map((doc) => [doc.documentTypeId, doc]));

  return types
    .filter((type) => type.appliesToRole === 'service-provider')
    .map((type) => {
      const document = docsByTypeId.get(type.id) ?? null;

      return {
        documentTypeId: type.id,
        name: type.name,
        isOptional: type.isOptional,
        requiresExpiryDate: type.requiresExpiryDate,
        isFetchable: type.isFetchable,
        status: document ? document.status : ('missing' as const),
        document: document
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

export const checklistWarnings = (
  checklist: Array<DocumentChecklistEntry>,
  servicesCount: number
) => ({
  missingRequiredDocuments: checklist
    .filter((entry) => !entry.isOptional && entry.status === 'missing')
    .map((entry) => ({ documentTypeId: entry.documentTypeId, name: entry.name })),
  missingServicesOffered: servicesCount === 0
});

export const loadProviderChecklist = (userId: string) =>
  Effect.gen(function* () {
    const typeRepo = yield* KycDocumentTypeRepo;
    const types = yield* typeRepo.listActive();

    return yield* loadProviderChecklistWithTypes(types)(userId);
  });

// Variant for callers that iterate many providers: fetch the type list once
// and reuse it per user.
export const loadProviderChecklistWithTypes = (types: Array<KycDocumentType>) => (userId: string) =>
  Effect.gen(function* () {
    const docRepo = yield* KycDocumentRepo;
    const serviceRepo = yield* ServiceOfferedRepo;
    const [docs, services] = yield* Effect.all(
      [docRepo.findByUserId(userId), serviceRepo.listByUserId(userId)],
      { concurrency: 'unbounded' }
    );
    const checklist = buildDocumentChecklist(types, docs);

    return {
      checklist,
      services,
      warnings: checklistWarnings(checklist, services.length)
    };
  });
