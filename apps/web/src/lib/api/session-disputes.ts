/** The admin dispute queue (Tier 3), backed by /admin/session-disputes.
 * Access follows the `sessionDispute` permission, never the role. */
import { apiClient, call, type ErrorsOf } from './client';

const listEndpoint = apiClient.admin['session-disputes'].$get;
const detailEndpoint = apiClient.admin['session-disputes'][':id'].$get;
const decideEndpoint = apiClient.admin['session-disputes'][':id'].decide.$post;

export type SessionDisputeSummary = Extract<
	Awaited<ReturnType<typeof listSessionDisputes>>,
	{ ok: true }
>['data']['disputes'][number];
export type SessionDisputeDetail = Extract<
	Awaited<ReturnType<typeof getSessionDispute>>,
	{ ok: true }
>['data']['dispute'];
export type SessionDisputeDecision = NonNullable<SessionDisputeDetail['decision']>;
export type DecideSessionDisputeError = ErrorsOf<typeof decideEndpoint>;

export async function listSessionDisputes(status: 'contested' | 'decided' = 'contested') {
	return call(listEndpoint({ query: { status } }));
}

export async function getSessionDispute(id: string) {
	return call(detailEndpoint({ param: { id } }));
}

export async function decideSessionDispute(
	id: string,
	input: { decision: SessionDisputeDecision; reason: string; minutesWorked?: number | null }
) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: input } as unknown as Parameters<typeof decideEndpoint>[0];
	return call(decideEndpoint(args));
}
