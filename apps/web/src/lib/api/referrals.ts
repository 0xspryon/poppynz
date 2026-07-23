/** Referrals screen (12a) — invite by email + status tracking, backed by /referrals. */
import { apiClient, call, type ErrorsOf } from './client';
import type { Role } from './auth';

const listEndpoint = apiClient.referrals.$get;
const createEndpoint = apiClient.referrals.$post;

export type ReferralList = Extract<Awaited<ReturnType<typeof listReferrals>>, { ok: true }>['data'];
export type ReferralEntry = ReferralList['referrals'][number];
export type ReferralStats = ReferralList['stats'];

export type ReferralListError = ErrorsOf<typeof listEndpoint>;
export type ReferralCreateError = ErrorsOf<typeof createEndpoint>;

export async function listReferrals() {
	return call(listEndpoint());
}

export async function sendReferralInvite(input: { email: string; role: Role }) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { json: input } as unknown as Parameters<typeof createEndpoint>[0];
	return call(createEndpoint(args));
}
