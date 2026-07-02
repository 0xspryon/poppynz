import { ProviderSearchQueue } from "@repo/queue";
import { Cause, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions } from "@/api/lib/effect-auth";

export const scheduleProviderSearchReindexRouteProgram = (headers: Headers) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { providerSearch: ["reindex"] })(authenticated);
    const queue = yield* ProviderSearchQueue;
    const job = yield* queue.enqueueReindex();
    return { jobId: job.id, status: "scheduled" as const };
  });

type AdminProviderSearchRouteError = Effect.Effect.Error<ReturnType<typeof scheduleProviderSearchReindexRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: AdminProviderSearchRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "ProviderSearchQueueError":
      return c.json({ error: { code: "PROVIDER_SEARCH_REINDEX_SCHEDULE_FAILED" as const, message: "Unable to schedule provider search reindex." } }, 502);
    default:
      return handleNever(c, error);
  }
};

export async function scheduleProviderSearchReindexHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(scheduleProviderSearchReindexRouteProgram(c.req.raw.headers));

  return Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return errorToResponse(c, failure.value);
      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);
    },
  });
}
