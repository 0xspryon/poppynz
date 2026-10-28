/** Session money (Tier 3 step 2): what an action would do to a session's
 * money before confirming it, a family's refund receipts, and a helper's
 * transfers. Backed by /contracts/:id/sessions/:sessionId/preview,
 * /billing/refunds/:id/receipt and /payouts/transfers. */
import { apiClient, call, type ErrorsOf } from './client';
import type { SessionAction, SessionResponse } from './contracts';

const previewEndpoint = apiClient.contracts[':id'].sessions[':sessionId'].preview.$post;
const receiptEndpoint = apiClient.billing.refunds[':id'].receipt.$get;
const transfersEndpoint = apiClient.payouts.transfers.$get;

export type SessionMoneyPreviewInput = {
	action?: SessionAction;
	response?: SessionResponse;
	minutesWorked?: number | null;
};
export type SessionMoneyPreview = NonNullable<
	Extract<Awaited<ReturnType<typeof previewSessionMoney>>, { ok: true }>['data']['preview']
>;
export type SessionMoneyPreviewError = ErrorsOf<typeof previewEndpoint>;

export type RefundReceipt = Extract<
	Awaited<ReturnType<typeof getRefundReceipt>>,
	{ ok: true }
>['data']['receipt'];
export type RefundReceiptError = ErrorsOf<typeof receiptEndpoint>;

export type HelperTransfer = Extract<
	Awaited<ReturnType<typeof listHelperTransfers>>,
	{ ok: true }
>['data']['transfers'][number];
export type HelperTransfersError = ErrorsOf<typeof transfersEndpoint>;

/** What confirming an action (or an answer) now would do to the money;
 * `preview` is null when there is nothing to say. */
export async function previewSessionMoney(
	contractId: string,
	sessionId: string,
	input: SessionMoneyPreviewInput
) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id: contractId, sessionId }, json: input } as unknown as Parameters<
		typeof previewEndpoint
	>[0];
	return call(previewEndpoint(args));
}

/** A session refund's receipt (credit note), for the family who paid. */
export async function getRefundReceipt(id: string) {
	return call(receiptEndpoint({ param: { id } }));
}

/** The helper's per-cycle transfers, newest first. */
export async function listHelperTransfers() {
	return call(transfersEndpoint());
}
