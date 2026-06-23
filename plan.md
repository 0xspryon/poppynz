# Service Provider Onboarding API Plan

## Scope

This plan covers only the API/backend work for completing service provider onboarding. UI work and marketplace search/indexing are intentionally deferred.

The onboarding flow is:

1. Service provider signs up.
2. Service provider completes profile.
3. Service provider uploads and submits KYC documents.
4. Service provider registers services offered and hourly rates.
5. Service provider submits an approval request for admin review.
6. Admin reviews the approval request.
7. Admin either rejects the approval request with a reason or creates an approval tied to the request.
8. Service provider sees current approval, latest approval request, KYC state, and services offered from their profile response.

## Core Rules

- All required KYC documents are currently for service providers.
- KYC document types are dynamic.
- KYC document types have an `isOptional` field so optional documents can be requested.
- KYC document types may require an expiry date.
- When a KYC document is submitted, its expiry date is stored when provided or required.
- Admin can update the expiry date of a submitted KYC document.
- Services offered are provider-defined free-form rows, not selected from service types.
- There is no service types table and no service keys.
- Hourly rate is stored per service offered.
- Services offered will later be manually indexed into Typesense; Typesense is not part of this onboarding API plan.
- Service providers may submit approval requests even if required KYC documents are missing.
- Service providers may submit approval requests even if no services are offered.
- Missing required KYC documents and missing services are warnings, not hard blockers.
- Non-admin users cannot create approvals.
- Admin creates approvals explicitly through the approval API.
- Approval `expiresAt` must be explicitly supplied in the approval creation request.
- Approval expiry must not be inferred from KYC document expiry or any other database state.
- A user can have multiple approvals of the same kind over time after expiry.
- Approval expiry is independent once set.
- Tests are required, including authorization tests for users trying to access routes they should not access.

## Soft Delete Rule

For any table that needs soft deletion, use `deletedAt`.

Do not use `isActive`.

A row is active when `deletedAt` is `null`.

This applies to:

- `kyc_document_types`
- `kyc_documents`, if soft deletion is needed
- `services_offered`
- any future soft-deletable configuration table

## Data Model

### KYC Document Types

Add a `kyc_document_types` table.

Fields:

- `id`
- `name`
- `appliesToRole`, defaulting to `service-provider` for now
- `isOptional`
- `requiresExpiryDate`
- `deletedAt`
- `createdAt`
- `updatedAt`

Rules:

- Do not add a `slug` field for now. A name is sufficient.
- `appliesToRole` defaults to `service-provider`.
- `isOptional = false` means required.
- `deletedAt !== null` means unavailable for new submissions.
- Existing records may remain referenced historically after deletion.

### KYC Documents

Revise `kyc_documents` to use dynamic document types instead of the current hard-coded enum.

Fields:

- `id`
- `userId`
- `documentTypeId`
- `filename`
- `fileKey`
- `expiryDate`
- `status`: `submitted`, `approved`, `rejected`
- `reason`
- `deletedAt`, if document soft deletion is needed
- `createdAt`
- `updatedAt`

Rules:

- `documentTypeId` references `kyc_document_types.id`.
- Only service providers can submit service-provider KYC documents.
- If the document type has `requiresExpiryDate = true`, `expiryDate` is required.
- Expiry dates must be valid future dates.
- File keys must belong to the authenticated user's storage namespace.
- Submitting a document should create or update the user's document for that document type.
- Admin can update a document expiry date independently of approval expiry.

### Services Offered

Add a `services_offered` table.

Fields:

- `id`
- `userId`
- `name`
- `description`
- `hourlyRateCents`
- `currency`
- `deletedAt`
- `createdAt`
- `updatedAt`

Rules:

- There is no `service_types` table.
- There are no service keys.
- The provider writes each service name directly.
- Authenticated service providers can manage only their own services offered.
- Families cannot create services offered.
- Multiple services per provider are allowed.
- Hourly rate is per service.
- `name` is required and should be trimmed.
- `hourlyRateCents` is required and must be positive.
- `currency` is required, likely defaulting to `CAD`.
- Delete means setting `deletedAt`, not physical deletion.
- Active services are rows where `deletedAt IS NULL`.
- Optional decision: reject duplicate active service names for the same provider.

### Approval Requests

Add an `approval_requests` table.

Fields:

- `id`
- `userId`
- `status`: `submitted`, `approved`, `rejected`
- `reviewedBy`
- `reviewedAt`
- `reason`
- `createdAt`
- `updatedAt`

Rules:

- Service providers create approval requests when they are ready for review.
- Creating an approval request does not require all required KYC documents to be submitted.
- Creating an approval request does not require at least one service offered.
- Missing required KYC documents are returned as warnings.
- Missing services offered is returned as a warning.
- Admin reviews approval requests, not approvals directly.
- Rejection updates the approval request and stores a reason.
- Approval request approval happens when an admin creates an approval tied to the request.

### Approvals

Revise `approvals` to represent granted approvals only.

Fields:

- `id`
- `userId`
- `approvalRequestId`
- `approvedBy`
- `expiresAt`
- `createdAt`
- `updatedAt`

Rules:

- Approvals are created only by admins.
- `approvalRequestId` ties an approval back to the reviewed request.
- `expiresAt` is required in the create approval request body.
- The API must reject approval creation when `expiresAt` is missing, invalid, or in the past.
- The API must not default `expiresAt` from KYC document expiry.
- Multiple approvals for the same user over time are allowed.

## API Routes

### KYC Document Type Management

Routes:

```http
GET /app/api/v1/kyc-docs/types
POST /app/api/v1/kyc-docs/types
PATCH /app/api/v1/kyc-docs/types/:id
DELETE /app/api/v1/kyc-docs/types/:id
```

Create body:

```json
{
  "name": "Vulnerable Sector Check",
  "appliesToRole": "service-provider",
  "isOptional": false,
  "requiresExpiryDate": true
}
```

Rules:

- Admin-only for create, update, and delete.
- `appliesToRole` defaults to `service-provider`.
- Delete soft-deletes by setting `deletedAt`.
- Write operations must be admin-only.

### KYC Document Upload Presign

Existing route remains:

```http
POST /app/api/v1/uploads/presigned-url
```

Update behavior:

- Validate `documentTypeId` against `kyc_document_types` instead of hard-coded document type enums.
- Ensure the document type is not soft-deleted.
- Ensure the authenticated user role matches the document type role.
- Return a presigned upload URL and file key.

### KYC Document Submission

Add:

```http
POST /app/api/v1/kyc-docs
```

Body:

```json
{
  "documentTypeId": "doc-type-id",
  "filename": "vulnerable-sector-check.pdf",
  "fileKey": "users/user-1/kyc/doc-type-id/upload-id-file.pdf",
  "expiryDate": "2027-06-21"
}
```

Rules:

- Authenticated service-provider only for service-provider documents.
- Document type must exist and must not be soft-deleted.
- `expiryDate` is required when the document type requires expiry.
- `expiryDate` must be a valid future date when supplied.
- `fileKey` must belong to the authenticated user.
- Create or update the user's KYC document for that document type.

### Admin KYC Document Update

Add:

```http
PATCH /app/api/v1/admin/kyc-docs/:id
```

Body:

```json
{
  "expiryDate": "2027-06-21"
}
```

Rules:

- Admin-only.
- Requires KYC document write permission.
- Document must exist.
- Expiry date must be valid and in the future.
- If the document type requires expiry, expiry cannot be set to `null`.
- Admin may update a KYC document expiry independently of approval expiry.

### Services Offered

Add:

```http
GET /app/api/v1/me/services-offered
POST /app/api/v1/me/services-offered
PATCH /app/api/v1/me/services-offered/:id
DELETE /app/api/v1/me/services-offered/:id
```

Create body:

```json
{
  "name": "After school babysitting",
  "description": "Pickup and supervision after school.",
  "hourlyRateCents": 2800,
  "currency": "CAD"
}
```

Rules:

- Authenticated service-provider only.
- Provider can manage only their own services offered.
- Families cannot create services offered.
- `name` is required.
- `hourlyRateCents` is required and must be positive.
- `currency` is required.
- `DELETE` soft-deletes by setting `deletedAt`.
- Active list output excludes rows where `deletedAt` is not `null`.

### Approval Request Submission

Add:

```http
POST /app/api/v1/approval-requests
```

Rules:

- Authenticated service-provider only.
- Creates a new `approval_requests` row with status `submitted`.
- Does not block if required documents are missing.
- Does not block if no services are offered.
- Returns missing required documents and missing services as warnings.

Response shape:

```json
{
  "id": "approval-request-id",
  "status": "submitted",
  "warnings": {
    "missingRequiredDocuments": [
      {
        "documentTypeId": "doc-type-id",
        "name": "First Aid Certification"
      }
    ],
    "missingServicesOffered": false
  }
}
```

### Admin Approval Request Review

Routes:

```http
GET /app/api/v1/admin/approval-requests
GET /app/api/v1/admin/approval-requests/:id
POST /app/api/v1/admin/approval-requests/:id/reject
```

List/detail rules:

- Admin-only.
- Detail response should include the approval request review packet.
- Review packet includes user, profile, submitted KYC documents, missing required documents, optional document types, services offered, and warnings.

Detail response shape:

```json
{
  "approvalRequest": {},
  "user": {},
  "profile": {},
  "kycDocuments": [],
  "missingRequiredDocuments": [],
  "optionalDocumentTypes": [],
  "servicesOffered": [],
  "warnings": {
    "missingRequiredDocuments": [],
    "missingServicesOffered": false
  }
}
```

Reject body:

```json
{
  "reason": "Hourly rate is unclear or required documents are missing."
}
```

Reject rules:

- Admin-only.
- Reason is required.
- Sets request status to `rejected`.
- Stores `reviewedBy`, `reviewedAt`, and `reason`.
- Does not create an approval.

### Approval Creation

Add or revise:

```http
POST /app/api/v1/approvals
```

Body:

```json
{
  "userId": "provider-user-id",
  "approvalRequestId": "approval-request-id",
  "expiresAt": "2027-03-01"
}
```

Rules:

- Admin-only.
- Requires `approval:write` permission.
- `expiresAt` is required.
- Missing `expiresAt` returns `400 APPROVAL_EXPIRY_REQUIRED`.
- Invalid or past `expiresAt` returns `400 INVALID_APPROVAL_INPUT`.
- Approval request must exist.
- Approval request must belong to `userId`.
- Creates an approval tied to the approval request.
- Marks approval request as `approved`.
- Stores `reviewedBy` and `reviewedAt` on the request.
- Does not infer expiry from KYC documents.

### Profile Response

No separate non-admin user approval route is needed.

Update:

```http
GET /app/api/v1/me/profile
```

For service providers, include:

- current active approval, if any
- latest approval request, if any
- KYC documents
- missing required documents
- optional document types
- services offered
- onboarding warnings

Example:

```json
{
  "userId": "user-1",
  "role": "service-provider",
  "approval": {
    "id": "approval-id",
    "expiresAt": "2027-03-01"
  },
  "latestApprovalRequest": {
    "id": "approval-request-id",
    "status": "submitted",
    "reason": null
  },
  "kycDocuments": [],
  "missingRequiredDocuments": [],
  "optionalDocumentTypes": [],
  "servicesOffered": [],
  "warnings": {
    "missingRequiredDocuments": [],
    "missingServicesOffered": false
  }
}
```

## Permissions

Extend the permission model to support route-specific authorization.

Suggested permissions:

- `profile:read`
- `profile:update`
- `kycDocument:read`
- `kycDocument:write`
- `kycDocumentType:read`
- `kycDocumentType:write`
- `serviceOffered:read`
- `serviceOffered:write`
- `approvalRequest:read`
- `approvalRequest:write`
- `approval:write`

Rules:

- Service providers can submit their own KYC documents.
- Service providers can manage only their own services offered.
- Service providers can submit only their own approval requests.
- Families cannot submit service-provider KYC documents.
- Families cannot create services offered.
- Families cannot create service-provider approval requests.
- Service providers cannot access admin review routes.
- Service providers cannot create approvals.
- Admins need the appropriate permission for each admin action.

## Testing Plan

Tests are required and should cover both behavior and authorization.

### KYC Document Type Tests

- Creates a document type with `name`, `isOptional`, `requiresExpiryDate`, and default `appliesToRole`.
- Rejects invalid or missing `name`.
- Updates `isOptional`.
- Updates `requiresExpiryDate`.
- Soft-deletes by setting `deletedAt`.
- Rejects create/update/delete from unauthenticated users.
- Rejects create/update/delete from non-admin users.
- Rejects admin users without the required write permission.

### KYC Document Submission Tests

- Submits a required document with expiry.
- Submits an optional document.
- Rejects submission when required expiry is missing.
- Rejects invalid expiry date.
- Rejects past expiry date.
- Rejects soft-deleted document type.
- Rejects unknown document type.
- Upserts an existing user document for the same document type.
- Rejects file keys outside the authenticated user's namespace.
- Rejects unauthenticated users.
- Rejects family users submitting service-provider KYC docs.
- Rejects service providers trying to submit documents for another user.

### Admin KYC Document Update Tests

- Admin updates expiry date successfully.
- Rejects invalid expiry date.
- Rejects past expiry date.
- Rejects null expiry for document types requiring expiry.
- Returns 404 for missing document.
- Rejects unauthenticated users.
- Rejects service providers.
- Rejects admins without KYC document write permission.

### Services Offered Tests

- Service provider creates service offered.
- Service provider lists own active services.
- Service provider updates own service.
- Service provider soft-deletes own service by setting `deletedAt`.
- Deleted services are excluded from active list output.
- Rejects missing service name.
- Rejects invalid or empty service name.
- Rejects missing hourly rate.
- Rejects zero or negative hourly rate.
- Rejects invalid currency.
- Rejects unauthenticated user.
- Rejects family creating services offered.
- Rejects provider updating another provider's service.
- Optional: rejects duplicate active service name for same provider.

### Approval Request Tests

- Service provider creates an approval request.
- Approval request is created even with missing required documents.
- Approval request is created even with no services offered.
- Response includes missing required document warnings.
- Response includes missing services warning.
- Response distinguishes optional document types.
- Rejects unauthenticated users.
- Rejects family users.
- Rejects users with unsupported roles.
- Rejects users trying to create an approval request for another user, if route ever accepts user id.

### Admin Approval Request Review Tests

- Admin lists approval requests.
- Admin fetches approval request detail.
- Detail includes profile.
- Detail includes KYC documents.
- Detail includes missing required documents.
- Detail includes optional document types.
- Detail includes services offered.
- Detail includes missing services warning.
- Admin rejects approval request with reason.
- Reject route requires reason.
- Reject route does not create approval.
- Rejects unauthenticated users.
- Rejects service providers.
- Rejects admins without approval request permissions.

### Approval Creation Tests

- Admin creates approval with explicit `expiresAt`.
- Created approval is tied to the approval request.
- Approval request is marked `approved`.
- Rejects missing `expiresAt` with `APPROVAL_EXPIRY_REQUIRED`.
- Rejects invalid `expiresAt`.
- Rejects past `expiresAt`.
- Rejects missing approval request.
- Rejects mismatched `userId` and `approvalRequestId`.
- Allows multiple approvals for the same user over time.
- Does not infer approval expiry from KYC documents.
- Rejects unauthenticated users.
- Rejects service providers.
- Rejects family users.
- Rejects admins without `approval:write` permission.

### Profile Tests

- Service provider profile includes current approval.
- Service provider profile includes latest approval request.
- Service provider profile includes KYC documents.
- Service provider profile includes missing required documents.
- Service provider profile includes optional document types.
- Service provider profile includes services offered.
- Service provider profile includes missing services warning.
- Family profile does not expose service-provider onboarding-only state unless explicitly desired.
- Unauthenticated users receive `401`.
- Users without profile read permission receive `403`.

## Implementation Order

1. Add schema changes and migrations for `kyc_document_types`, revised `kyc_documents`, `services_offered`, `approval_requests`, and revised `approvals`.
2. Update auth permissions and roles.
3. Add repository methods for KYC document types, KYC documents, services offered, approval requests, and approvals.
4. Add KYC document type APIs and tests.
5. Update upload presign API to use dynamic KYC document types and tests.
6. Add KYC document submission API and tests.
7. Add admin KYC document expiry update API and tests.
8. Add services offered APIs and tests.
9. Add approval request submission API and tests.
10. Add admin approval request list/detail/reject APIs and tests.
11. Add approval creation API with explicit expiry requirement and tests.
12. Update profile response with approval request, approval, KYC, and services state and tests.
13. Add end-to-end authorization coverage for every protected route.
