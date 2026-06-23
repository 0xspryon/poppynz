# Agent Instructions

These project-specific rules exist to prevent repeat mistakes from prior implementation rounds.

## Handler Error Exhaustiveness

- Route handlers must not type `exitToResponse` as `unknown` when the route program has a derivable error type.
- Prefer a full route program that includes parsing, validation, authentication, authorization, and domain logic.
- Derive handler error types from route programs with `Effect.Effect.Error<ReturnType<typeof program>>`.
- Response mappers should handle errors by `_tag` and end with `handleNever(c, error)` so TypeScript enforces exhaustive handling.
- If repo or infrastructure errors can escape a route program, either normalize them into route-specific errors or handle their tags explicitly. Do not let known typed failures fall through to a generic 500 branch by accident.

## Unit Test Coverage

- New route/domain programs need focused unit tests, not only e2e tests.
- Unit tests should cover the main success path, important validation failures, authorization failures, and error translation for repo/storage/config failures where applicable.
- When a handler delegates to an exported route/domain program, test that program directly with test layers.
- Keep e2e tests for routing and integration behavior, but do not rely on them as the only coverage for business logic.

## Soft Delete Semantics

- Use `deletedAt` for soft deletion.
- Do not introduce `isActive` or similar boolean active flags unless explicitly requested.
- List/read queries for active records should filter `deletedAt IS NULL` where relevant.
- Delete handlers/repos should set `deletedAt` and preserve data instead of hard-deleting rows unless explicitly requested.

## Authorization Model

- App routes should be governed by permissions, not ad hoc role checks, unless the user explicitly requests role-specific behavior.
- Prefer `requirePermissions(...)` for access control decisions.
- Do not add extra checks like `requireServiceProvider` just because a feature is normally used by a role. If the role should not access a capability, model that through permissions.
- Tests for access denial should usually deny permissions rather than asserting on a user role, unless the feature explicitly requires role-based logic.
