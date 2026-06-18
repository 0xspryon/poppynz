import type { SqlError } from "@effect/sql/SqlError";
import { Approval, ApprovalRepo, KycDocumentRepo, UserRepo } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import {
  authenticate,
  isAuthError,
  UserAndSession,
  requirePermissions,
  authErrorToResponse,
} from "@/api/lib/effect-auth";
import {
  approvalJsonError,
  validateApprovalInput,
  type ApprovalInput,
} from "./approval.validator";
import {
  isRequestValidationError,
  parseJsonBody,
  requestValidationErrorToResponse,
} from "@/api/lib/schema-validator";

export class ApprovalUserLookupError extends Data.TaggedError("ApprovalUserLookupError")<{
  cause: SqlError;
}> {}

export class ApprovalRepoError extends Data.TaggedError("ApprovalRepoError")<{
  cause: SqlError;
}> {}

export class ApprovalKycDocumentRepoError extends Data.TaggedError("ApprovalKycDocumentRepoError")<{
  cause: SqlError;
}> {}

export class ApprovalTargetNotFoundError extends Data.TaggedError("ApprovalTargetNotFoundError")<{}> {}

export class ApprovalTypeMismatchError extends Data.TaggedError("ApprovalTypeMismatchError")<{}> {}

export type ApprovalError =
  | ApprovalUserLookupError
  | ApprovalRepoError
  | ApprovalKycDocumentRepoError
  | ApprovalTargetNotFoundError
  | ApprovalTypeMismatchError;

const toApprovalResponse = (approval: Approval) => ({
  id: approval.id,
  userId: approval.userId,
  type: approval.type,
  status: approval.status,
  approvedBy: approval.approvedBy,
  reason: approval.reason,
});

export const createApprovalProgram = (userAndSession: UserAndSession, input: ApprovalInput) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const approvalRepo = yield* ApprovalRepo;
    const kycDocumentRepo = yield* KycDocumentRepo;
    const targetUser = yield* userRepo
      .findById(input.userId)
      .pipe(
        Effect.catchTags({
          DBNotFoundError: () => Effect.fail(new ApprovalTargetNotFoundError()),
          SqlError: (cause) => Effect.fail(new ApprovalUserLookupError({ cause })),
        })
      );

    if (targetUser.role !== input.type) {
      return yield* Effect.fail(new ApprovalTypeMismatchError());
    }

    const approval = yield* approvalRepo
      .upsertDecision({
        userId: input.userId,
        type: input.type,
        status: input.status,
        approvedBy: userAndSession.user.id,
        reason: input.reason ?? null,
      })
      .pipe(Effect.mapError((cause) => new ApprovalRepoError({ cause })));

    if (input.status === "approved") {
      yield* kycDocumentRepo
        .approveSubmittedByUserId(input.userId)
        .pipe(Effect.mapError((cause) => new ApprovalKycDocumentRepoError({ cause })));
    }

    return toApprovalResponse(approval);
  });

const approvalErrorToResponse = (c: HonoContext<HonoEnv>, error: ApprovalError) => {
  switch (error._tag) {
    case "ApprovalUserLookupError":
      return c.json(
        {
          error: {
            code: "APPROVAL_USER_LOOKUP_FAILED" as const,
            message: "Unable to create approval.",
          },
        },
        500,
      );
    case "ApprovalRepoError":
    case "ApprovalKycDocumentRepoError":
      return c.json(
        {
          error: {
            code: "APPROVAL_FAILED" as const,
            message: "Unable to create approval.",
          },
        },
        500,
      );
    case "ApprovalTargetNotFoundError":
      return c.json(
        {
          error: {
            code: "APPROVAL_TARGET_NOT_FOUND" as const,
            message: "The user to approve was not found.",
          },
        },
        404,
      );
    case "ApprovalTypeMismatchError":
      return c.json(
        {
          error: {
            code: "APPROVAL_TYPE_MISMATCH" as const,
            message: "Approval type does not match the user's role.",
          },
        },
        400,
      );
  }
};

const unexpectedErrorResponse = (c: HonoContext<HonoEnv>) =>
  c.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR" as const,
        message: "Unexpected server error.",
      },
    },
    500,
  );

const isApprovalError = (error: unknown): error is ApprovalError =>
  error instanceof ApprovalUserLookupError ||
  error instanceof ApprovalRepoError ||
  error instanceof ApprovalKycDocumentRepoError ||
  error instanceof ApprovalTargetNotFoundError ||
  error instanceof ApprovalTypeMismatchError;

export async function createApprovalHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    Effect.gen(function* () {
      const rawBody = yield* parseJsonBody(c, approvalJsonError);
      const input = yield* validateApprovalInput(rawBody);
      const authenticated = yield* authenticate(headers);
      const userAndSession = yield* requirePermissions(headers, {
        approval: ["create"],
      })(authenticated);

      return yield* createApprovalProgram(userAndSession, input);
    }),
  );

  return Exit.match(exit, {
    onSuccess: (approval) => c.json(approval),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        if (isAuthError(failure.value)) {
          return authErrorToResponse(c, failure.value);
        }

        if (isRequestValidationError(failure.value)) {
          return requestValidationErrorToResponse(c, failure.value);
        }

        if (isApprovalError(failure.value)) {
          return approvalErrorToResponse(c, failure.value);
        }
      }

      return unexpectedErrorResponse(c);
    },
  });
}
