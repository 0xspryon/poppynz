/** Card disputes (chargebacks, Tier 3 step 4), backed by /admin/card-disputes
 * (permission `cardDispute`: admins all of it; the accountant the list and
 * what Poppynz bears). */
import { apiClient, call, type ErrorsOf } from './client';

const routes = apiClient.admin['card-disputes'];
const listEndpoint = routes.$get;
const flagsEndpoint = routes.flags.$get;
const detailEndpoint = routes[':id'].$get;
const summaryEndpoint = routes[':id'].summary.$put;
const evidenceEndpoint = routes[':id'].evidence.$post;
const allocationsEndpoint = routes[':id'].allocations.$post;
const suspendEndpoint = routes.families[':userId'].suspend.$post;
const resumeEndpoint = routes.families[':userId'].resume.$post;

export type CardDisputeListItem = Extract<
	Awaited<ReturnType<typeof listCardDisputes>>,
	{ ok: true }
>['data']['disputes'][number];
export type CardDisputeTotals = Extract<
	Awaited<ReturnType<typeof listCardDisputes>>,
	{ ok: true }
>['data']['totals'];
export type CardDisputeDetail = Extract<
	Awaited<ReturnType<typeof getCardDispute>>,
	{ ok: true }
>['data']['dispute'];
export type CardDisputeSessionView = CardDisputeDetail['pack']['sessions'][number];
export type CardDisputeFlag = Extract<
	Awaited<ReturnType<typeof getCardDisputeFlags>>,
	{ ok: true }
>['data']['families'][number];
export type CardDisputeStatusFilter = 'open' | 'closed' | 'all';
export type CardDisputeDueFilter = 'overdue' | 'week' | '';
export type CardDisputeAllocation = 'poppynz_absorbs' | 'helper_not_provided';
export type SuspensionReason = 'unreliable_payment_method' | 'suspected_fraud';

export type CardDisputeError =
	| ErrorsOf<typeof listEndpoint>
	| ErrorsOf<typeof flagsEndpoint>
	| ErrorsOf<typeof detailEndpoint>
	| ErrorsOf<typeof summaryEndpoint>
	| ErrorsOf<typeof evidenceEndpoint>
	| ErrorsOf<typeof allocationsEndpoint>
	| ErrorsOf<typeof suspendEndpoint>
	| ErrorsOf<typeof resumeEndpoint>;

export async function listCardDisputes(filter: {
	status: CardDisputeStatusFilter;
	due: CardDisputeDueFilter;
}) {
	const query = { status: filter.status, ...(filter.due ? { due: filter.due } : {}) };
	const args = { query } as unknown as Parameters<typeof listEndpoint>[0];
	return call(listEndpoint(args));
}

export async function getCardDisputeFlags() {
	return call(flagsEndpoint());
}

export async function getCardDispute(id: string) {
	return call(detailEndpoint({ param: { id } }));
}

// The API reads bodies via parseJsonBody (no hono validator), so the RPC
// input types omit `json` — the client still serializes it at runtime.
export async function saveCardDisputeSummary(id: string, summary: string) {
	const args = { param: { id }, json: { summary } } as unknown as Parameters<
		typeof summaryEndpoint
	>[0];
	return call(summaryEndpoint(args));
}

export async function submitCardDisputeEvidence(id: string, summary: string) {
	const args = { param: { id }, json: { summary } } as unknown as Parameters<
		typeof evidenceEndpoint
	>[0];
	return call(evidenceEndpoint(args));
}

export async function allocateCardDispute(
	id: string,
	items: ReadonlyArray<{
		sessionId: string;
		allocation: CardDisputeAllocation;
		reason: string | null;
		helperForfeitCents?: number | null;
	}>
) {
	const args = { param: { id }, json: { items } } as unknown as Parameters<
		typeof allocationsEndpoint
	>[0];
	return call(allocationsEndpoint(args));
}

export async function suspendFamilyContracts(
	userId: string,
	input: { reason: SuspensionReason; note: string; disputeId: string | null }
) {
	const args = { param: { userId }, json: input } as unknown as Parameters<
		typeof suspendEndpoint
	>[0];
	return call(suspendEndpoint(args));
}

export async function resumeFamilyContracts(userId: string, note: string) {
	const args = { param: { userId }, json: { note } } as unknown as Parameters<
		typeof resumeEndpoint
	>[0];
	return call(resumeEndpoint(args));
}
