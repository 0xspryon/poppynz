import { Data, Effect, ParseResult, Schema } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";

export type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

export type ValidationErrorConfig = {
  code: string;
  message: string;
};

export class RequestValidationError extends Data.TaggedError("RequestValidationError")<{
  code: string;
  message: string;
  issues: Array<ValidationIssue>;
}> { }

const toPath = (path: ReadonlyArray<PropertyKey>) =>
  path.flatMap((key) => (typeof key === "string" || typeof key === "number" ? [key] : []));

const formatParseIssues = (error: ParseResult.ParseError): Array<ValidationIssue> =>
  ParseResult.ArrayFormatter.formatErrorSync(error)
    .map((formatted) => ({
      path: toPath(formatted.path),
      message: formatted.message,
    }));

export const parseJsonBody = (c: HonoContext<HonoEnv>, config: ValidationErrorConfig) =>
  Effect.tryPromise({
    try: () => c.req.json() as Promise<unknown>,
    catch: () =>
      new RequestValidationError({
        code: config.code,
        message: "Request body must be valid JSON.",
        issues: [{ path: [], message: "Request body must be valid JSON." }],
      }),
  });

/**
 * Validates the input per the provided schema and if there's validation error,
 * it yields a RequestValidationError type response
 */
export const validateInput =
  <A, I, R>(schema: Schema.Schema<A, I, R>, config: ValidationErrorConfig) =>
    (input: unknown) =>
      Schema.decodeUnknown(schema, {
        errors: "all",
        onExcessProperty: "ignore",
      })(input).pipe(
        Effect.mapError(
          (error) =>
            new RequestValidationError({
              code: config.code,
              message: config.message,
              issues: formatParseIssues(error),
            }),
        ),
      );

export const isRequestValidationError = (error: unknown): error is RequestValidationError =>
  error instanceof RequestValidationError;

export const requestValidationErrorToResponse = (
  c: HonoContext<HonoEnv>,
  error: RequestValidationError,
) =>
  c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        issues: error.issues,
      },
    },
    400,
  );
