/** Contracts: family-initiated proposals that grow out of an unlocked
 * conversation (the only entry point), backed by /contracts. Terms live in
 * versions — the initial proposal and re-sends after decline/changes are all
 * "the next version". Signed contracts are never amended: they run out or are
 * ended with notice, and a new contract is created. */
import type { AgreementAssent } from './agreements';
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient.contracts.$get;
const createEndpoint = apiClient.contracts.$post;
const badgeCountEndpoint = apiClient.contracts.me['badge-count'].$get;
const detailEndpoint = apiClient.contracts[':id'].$get;
const termsEndpoint = apiClient.contracts[':id'].terms.$put;
const sendEndpoint = apiClient.contracts[':id'].send.$post;
const quoteEndpoint = apiClient.contracts[':id'].quote.$post;
const withdrawEndpoint = apiClient.contracts[':id'].withdraw.$post;
const acceptEndpoint = apiClient.contracts[':id'].accept.$post;
const declineEndpoint = apiClient.contracts[':id'].decline.$post;
const requestChangesEndpoint = apiClient.contracts[':id']['request-changes'].$post;
const endEndpoint = apiClient.contracts[':id'].end.$post;
const seenEndpoint = apiClient.contracts[':id'].seen.$post;
const renewEndpoint = apiClient.contracts[':id'].renew.$post;
const retryPaymentEndpoint = apiClient.contracts[':id'].billing.retry.$post;
const cycleEndpoint = apiClient.contracts[':id'].cycles[':cycleId'].$get;
const landingEndpoint = apiClient.contracts.me.landing.$get;
const sessionActionEndpoint = apiClient.contracts[':id'].sessions[':sessionId'].actions.$post;
const sessionRespondEndpoint = apiClient.contracts[':id'].sessions[':sessionId'].respond.$post;
const pendingSessionsEndpoint = apiClient.contracts[':id'].sessions.pending.$get;
const replacementContextEndpoint = apiClient.contracts[':id'].replacement.$get;
const startReplacementEndpoint = apiClient.contracts[':id'].replacement.$post;

export type ContractListData = Extract<
	Awaited<ReturnType<typeof listContracts>>,
	{ ok: true }
>['data'];
export type ContractSummary = ContractListData['contracts'][number];
export type ContractDetailData = Extract<
	Awaited<ReturnType<typeof getContract>>,
	{ ok: true }
>['data'];
export type ContractDetail = ContractDetailData['contract'];
export type ContractTerms = NonNullable<ContractDetail['pendingVersion']>;
export type ContractServiceItem = ContractTerms['services'][number];
/** The weekly price for the viewer's side (piece 3), or why there is none. */
export type ContractPricing = NonNullable<ContractTerms['pricing']>;
export type ContractBilling = NonNullable<ContractDetail['billing']>;
export type ContractBillingCycle = ContractBilling['cycles'][number];
export type ContractStatus = ContractDetail['status'];
export type ContractCycleData = Extract<
	Awaited<ReturnType<typeof getContractCycle>>,
	{ ok: true }
>['data'];
/** One billing cycle (UAT round 2 #11a): the viewer's amounts and its sessions. */
export type ContractCycleDetail = ContractCycleData['cycle'];
export type ContractCycleSession = ContractCycleDetail['sessions'][number];
export type RetryPaymentError = ErrorsOf<typeof retryPaymentEndpoint>;
/** Tier 3: what happened to a session, as the viewer sees it. */
export type SessionResolution = NonNullable<ContractCycleSession['resolution']>;
export type SessionAction = ContractCycleSession['actions'][number];
export type SessionResponse = ContractCycleSession['responses'][number];
export type SessionWindow = ContractCycleDetail['sessionWindow'];
export type SessionActionInput = {
	action: SessionAction;
	reason?: SessionReasonCode | null;
	note?: string | null;
	minutesWorked?: number | null;
};
export type SessionReasonCode = NonNullable<SessionResolution['reason']>;
export type SessionActionError =
	| ErrorsOf<typeof sessionActionEndpoint>
	| ErrorsOf<typeof sessionRespondEndpoint>;
export type PendingSessionResponse = Extract<
	Awaited<ReturnType<typeof listPendingSessionResponses>>,
	{ ok: true }
>['data']['items'][number];
export type ContractTermsInput = {
	services: Array<{
		serviceId: string;
		rateCents: number;
		sessions: Array<{ weekday: number; startMinutes: number; endMinutes: number }>;
		expectations: string;
	}>;
	startsOn?: string | null;
	endsOn?: string | null;
	endsAtMinutes?: number | null;
};
/** Tier 3 step 1b: what a "Find a replacement" is replacing. */
export type ReplacementContext = Extract<
	Awaited<ReturnType<typeof getReplacementContext>>,
	{ ok: true }
>['data']['replacement'];
export type ReplacementContextError = ErrorsOf<typeof replacementContextEndpoint>;
export type StartReplacementError = ErrorsOf<typeof startReplacementEndpoint>;
export type SaveTermsError = ErrorsOf<typeof termsEndpoint>;
export type SendContractError = ErrorsOf<typeof sendEndpoint>;
export type CreateContractError = ErrorsOf<typeof createEndpoint>;

export async function listContracts() {
	return call(listEndpoint());
}

export async function getContractsBadgeCount() {
	return call(badgeCountEndpoint());
}

export async function getContract(id: string) {
	return call(detailEndpoint({ param: { id } }));
}

export async function createContract(conversationId: string) {
	const args = { param: {}, json: { conversationId } } as unknown as Parameters<
		typeof createEndpoint
	>[0];
	return call(createEndpoint(args));
}

export async function saveContractTerms(id: string, terms: ContractTermsInput) {
	const args = { param: { id }, json: terms } as unknown as Parameters<typeof termsEndpoint>[0];
	return call(termsEndpoint(args));
}

/** B6: prices unsaved draft terms, exactly as saving them would. */
export async function quoteContractTerms(id: string, terms: ContractTermsInput) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: terms } as unknown as Parameters<typeof quoteEndpoint>[0];
	return call(quoteEndpoint(args));
}

/** Sending is the family's signature (UAT #41): the API only accepts it
 * with the explicit "Sign & send" confirmation. */
export async function sendContract(id: string, agreement: AgreementAssent) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: { signed: true, agreement } } as unknown as Parameters<
		typeof sendEndpoint
	>[0];
	return call(sendEndpoint(args));
}

export async function withdrawContract(id: string) {
	return call(withdrawEndpoint({ param: { id } }));
}

/** Accepting is the helper's signature on the written agreement they read. */
export async function acceptContract(id: string, agreement: AgreementAssent) {
	const args = { param: { id }, json: { signed: true, agreement } } as unknown as Parameters<
		typeof acceptEndpoint
	>[0];
	return call(acceptEndpoint(args));
}

export async function declineContract(id: string, reason?: string) {
	const args = { param: { id }, json: { reason: reason ?? null } } as unknown as Parameters<
		typeof declineEndpoint
	>[0];
	return call(declineEndpoint(args));
}

export async function requestContractChanges(id: string) {
	return call(requestChangesEndpoint({ param: { id } }));
}

export async function endContract(id: string, note?: string) {
	const args = { param: { id }, json: { note: note ?? null } } as unknown as Parameters<
		typeof endEndpoint
	>[0];
	return call(endEndpoint(args));
}

export async function markContractSeen(id: string) {
	return call(seenEndpoint({ param: { id } }));
}

/** UAT round 2 #7b: a new draft pre-filled from a signed contract. */
export async function renewContract(id: string) {
	return call(renewEndpoint({ param: { id } }));
}

/** UAT round 2 #13: the family's "Retry payment" on a declined cycle. */
export async function retryContractPayment(id: string) {
	return call(retryPaymentEndpoint({ param: { id } }));
}

export async function getContractCycle(id: string, cycleId: string) {
	return call(cycleEndpoint({ param: { id, cycleId } }));
}

/** Tier 3: cancel a session, propose a day off, report or dispute. */
export async function recordSessionAction(
	id: string,
	sessionId: string,
	input: SessionActionInput
) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id, sessionId }, json: input } as unknown as Parameters<
		typeof sessionActionEndpoint
	>[0];
	return call(sessionActionEndpoint(args));
}

/** Tier 3: accept, contest (a report) or decline (a day off). */
export async function respondToSession(
	id: string,
	sessionId: string,
	input: { response: SessionResponse; note?: string | null }
) {
	const args = { param: { id, sessionId }, json: input } as unknown as Parameters<
		typeof sessionRespondEndpoint
	>[0];
	return call(sessionRespondEndpoint(args));
}

/** Tier 3: what on this contract waits for the viewer's answer. */
export async function listPendingSessionResponses(id: string) {
	return call(pendingSessionsEndpoint({ param: { id } }));
}

/** Tier 3 step 1b: the sessions the helper cancelled that the family can
 * still replace (the named ones, or all of them) and the helper to leave
 * out of the search. */
export async function getReplacementContext(id: string, sessionIds?: ReadonlyArray<string>) {
	const query: Record<string, string> = {};
	if (sessionIds && sessionIds.length > 0) query.sessions = sessionIds.join(',');
	const args = { param: { id }, query } as unknown as Parameters<
		typeof replacementContextEndpoint
	>[0];
	return call(replacementContextEndpoint(args));
}

/** Tier 3 step 1b: "Use this contract as a template" with another helper. */
export async function startReplacement(
	id: string,
	input: { providerUserId: string; sessionIds: ReadonlyArray<string> }
) {
	const args = { param: { id }, json: input } as unknown as Parameters<
		typeof startReplacementEndpoint
	>[0];
	return call(startReplacementEndpoint(args));
}

/** UAT round 2 #5: the viewer's running contracts, for the landing. */
export async function getContractLanding() {
	return call(landingEndpoint());
}

export type { ApiResult };
