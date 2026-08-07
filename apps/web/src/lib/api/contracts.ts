/** Contracts: family-initiated proposals that grow out of an unlocked
 * conversation (the only entry point), backed by /contracts. Terms live in
 * versions — the initial proposal, re-sends after decline/changes and
 * amendments on an active contract are all "the next version". */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient.contracts.$get;
const createEndpoint = apiClient.contracts.$post;
const badgeCountEndpoint = apiClient.contracts.me['badge-count'].$get;
const detailEndpoint = apiClient.contracts[':id'].$get;
const termsEndpoint = apiClient.contracts[':id'].terms.$put;
const sendEndpoint = apiClient.contracts[':id'].send.$post;
const withdrawEndpoint = apiClient.contracts[':id'].withdraw.$post;
const acceptEndpoint = apiClient.contracts[':id'].accept.$post;
const declineEndpoint = apiClient.contracts[':id'].decline.$post;
const requestChangesEndpoint = apiClient.contracts[':id']['request-changes'].$post;
const amendEndpoint = apiClient.contracts[':id'].amendments.$post;
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
export type ContractStatus = ContractDetail['status'];
export type ContractTermsInput = {
	services: Array<{
		serviceId: string;
		rateCents: number;
		hoursPerWeek: number;
		expectations: string;
	}>;
	schedule?: string | null;
	startsOn?: string | null;
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

export async function sendContract(id: string) {
	return call(sendEndpoint({ param: { id } }));
}

export async function withdrawContract(id: string) {
	return call(withdrawEndpoint({ param: { id } }));
}

export async function acceptContract(id: string) {
	return call(acceptEndpoint({ param: { id } }));
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

export async function amendContract(id: string, terms: ContractTermsInput) {
	const args = { param: { id }, json: terms } as unknown as Parameters<typeof amendEndpoint>[0];
	return call(amendEndpoint(args));
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
