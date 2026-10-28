/** Extra sessions (Tier 3 step 3), backed by /contracts/:id/extra-sessions:
 * the contract's (or one cycle's) extra sessions and the propose dialog's
 * facts, a slot's price, proposing, answering (the family with its
 * authorisation of the charge), withdrawing and cancelling during the
 * charge delay. The admins' unpaid list is /admin/money/extra-sessions. */
import { apiClient, call, type ErrorsOf } from './client';

const listEndpoint = apiClient.contracts[':id']['extra-sessions'].$get;
const quoteEndpoint = apiClient.contracts[':id']['extra-sessions'].quote.$post;
const proposeEndpoint = apiClient.contracts[':id']['extra-sessions'].$post;
const respondEndpoint = apiClient.contracts[':id']['extra-sessions'][':extraId'].respond.$post;
const withdrawEndpoint = apiClient.contracts[':id']['extra-sessions'][':extraId'].withdraw.$post;
const cancelEndpoint = apiClient.contracts[':id']['extra-sessions'][':extraId'].cancel.$post;
const unpaidEndpoint = apiClient.admin.money['extra-sessions'].$get;

export type ExtraSessionsData = Extract<
	Awaited<ReturnType<typeof listExtraSessions>>,
	{ ok: true }
>['data'];
export type ExtraSession = ExtraSessionsData['extraSessions'][number];
export type ExtraSessionAction = ExtraSession['actions'][number];
export type ExtraSessionProposeFacts = NonNullable<ExtraSessionsData['propose']>;
export type ExtraSessionPolicy = ExtraSessionsData['policy'];
export type ExtraSessionQuote = Extract<
	Awaited<ReturnType<typeof quoteExtraSession>>,
	{ ok: true }
>['data']['quote'];
export type UnpaidExtraSession = Extract<
	Awaited<ReturnType<typeof listUnpaidExtraSessions>>,
	{ ok: true }
>['data']['extraSessions'][number];

export type ExtraSessionError =
	| ErrorsOf<typeof listEndpoint>
	| ErrorsOf<typeof quoteEndpoint>
	| ErrorsOf<typeof proposeEndpoint>
	| ErrorsOf<typeof respondEndpoint>
	| ErrorsOf<typeof withdrawEndpoint>
	| ErrorsOf<typeof cancelEndpoint>;

export type ExtraSessionSlotInput = {
	date: string;
	startMinutes: number;
	endMinutes: number;
	serviceId: string;
};

// The API reads bodies via parseJsonBody (no hono validator), so the RPC
// input types omit `json` — the client still serializes it at runtime.
const withJson = <T>(param: Record<string, string>, json: unknown) =>
	({ param, json }) as unknown as T;

/** The contract's extra sessions (one cycle's with `cycleId`). */
export async function listExtraSessions(contractId: string, cycleId?: string) {
	return call(
		listEndpoint({
			param: { id: contractId },
			query: cycleId ? { cycleId } : {}
		} as unknown as Parameters<typeof listEndpoint>[0])
	);
}

/** What a slot would cost (the family) or pay (the helper). */
export async function quoteExtraSession(contractId: string, slot: ExtraSessionSlotInput) {
	return call(
		quoteEndpoint(withJson<Parameters<typeof quoteEndpoint>[0]>({ id: contractId }, slot))
	);
}

export async function proposeExtraSession(
	contractId: string,
	input: ExtraSessionSlotInput & { note?: string | null; authorisedCents?: number | null }
) {
	return call(
		proposeEndpoint(withJson<Parameters<typeof proposeEndpoint>[0]>({ id: contractId }, input))
	);
}

export async function respondToExtraSession(
	contractId: string,
	extraId: string,
	input: { response: 'accept' | 'decline'; note?: string | null; authorisedCents?: number | null }
) {
	return call(
		respondEndpoint(
			withJson<Parameters<typeof respondEndpoint>[0]>({ id: contractId, extraId }, input)
		)
	);
}

export async function withdrawExtraSession(contractId: string, extraId: string) {
	return call(
		withdrawEndpoint(
			withJson<Parameters<typeof withdrawEndpoint>[0]>({ id: contractId, extraId }, {})
		)
	);
}

export async function cancelExtraSession(contractId: string, extraId: string) {
	return call(
		cancelEndpoint(withJson<Parameters<typeof cancelEndpoint>[0]>({ id: contractId, extraId }, {}))
	);
}

/** Admins: extra sessions whose own charge is unpaid. */
export async function listUnpaidExtraSessions() {
	return call(unpaidEndpoint());
}
