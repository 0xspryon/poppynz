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

export type { ApiResult };
