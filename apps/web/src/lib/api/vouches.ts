/** Vouches — a helper asks approved members to vouch; members answer. */
import { apiClient, call, type ErrorsOf } from './client';

const mineEndpoint = apiClient.vouches.mine.$get;
const requestEndpoint = apiClient.vouches.$post;
const incomingEndpoint = apiClient.vouches.requests.$get;
const submitEndpoint = apiClient.vouches[':id'].submit.$post;
const declineEndpoint = apiClient.vouches[':id'].decline.$post;
const withdrawEndpoint = apiClient.vouches[':id'].withdraw.$post;

export type MyVouches = Extract<Awaited<ReturnType<typeof getMyVouches>>, { ok: true }>['data'];
export type MyVouch = MyVouches['vouches'][number];
export type VouchRequestList = Extract<
	Awaited<ReturnType<typeof listVouchRequests>>,
	{ ok: true }
>['data'];
export type VouchRequestEntry = VouchRequestList['requests'][number];
export type VouchRequestError = ErrorsOf<typeof requestEndpoint>;

export type VouchAnswersInput = {
	howKnow: string;
	howLong: string;
	wouldTrust: 'yes' | 'no' | 'unsure';
	hasConcerns: boolean;
	concernsDetail: string | null;
	wouldHire: 'yes' | 'no' | 'unsure';
	anythingElse: string | null;
	attested: true;
};

export async function getMyVouches() {
	return call(mineEndpoint());
}

export async function requestVouch(input: { email: string; relationship: string }) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { json: input } as unknown as Parameters<typeof requestEndpoint>[0];
	return call(requestEndpoint(args));
}

export async function listVouchRequests() {
	return call(incomingEndpoint());
}

export async function submitVouch(id: string, answers: VouchAnswersInput) {
	const args = { param: { id }, json: answers } as unknown as Parameters<typeof submitEndpoint>[0];
	return call(submitEndpoint(args));
}

export async function declineVouch(id: string) {
	return call(declineEndpoint({ param: { id } }));
}

export async function withdrawVouch(id: string) {
	return call(withdrawEndpoint({ param: { id } }));
}
