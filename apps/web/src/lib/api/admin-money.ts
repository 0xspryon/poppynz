/** The admins' money queues (Tier 3 step 2), backed by /admin/money:
 * transfers waiting for a manual payout (permission `payoutQueue`) and
 * failed session refunds (permission `refundQueue`). */
import { apiClient, call, type ErrorsOf } from './client';

const payoutsEndpoint = apiClient.admin.money.payouts.$get;
const manualPayoutEndpoint = apiClient.admin.money.transfers[':id']['manual-payout'].$post;
const retryTransferEndpoint = apiClient.admin.money.transfers[':id'].retry.$post;
const decideEndpoint = apiClient.admin.money['manual-payouts'][':id'].decide.$post;
const refundsEndpoint = apiClient.admin.money.refunds.$get;
const retryRefundEndpoint = apiClient.admin.money.refunds[':id'].retry.$post;
const handledEndpoint = apiClient.admin.money.refunds[':id'].handled.$post;

export type PayoutQueueItem = Extract<
	Awaited<ReturnType<typeof listPayoutQueue>>,
	{ ok: true }
>['data']['transfers'][number];
export type ManualPayout = PayoutQueueItem['manualPayouts'][number];
export type ManualPayoutMethod = 'interac_etransfer' | 'bank_transfer' | 'cheque' | 'other';
export type FailedRefund = Extract<
	Awaited<ReturnType<typeof listFailedRefunds>>,
	{ ok: true }
>['data']['refunds'][number];

export type AdminMoneyError =
	| ErrorsOf<typeof payoutsEndpoint>
	| ErrorsOf<typeof manualPayoutEndpoint>
	| ErrorsOf<typeof retryTransferEndpoint>
	| ErrorsOf<typeof decideEndpoint>
	| ErrorsOf<typeof refundsEndpoint>
	| ErrorsOf<typeof retryRefundEndpoint>
	| ErrorsOf<typeof handledEndpoint>;

export async function listPayoutQueue() {
	return call(payoutsEndpoint());
}

/** Records a payout made outside Stripe; another admin approves it. */
export async function recordManualPayout(
	transferId: string,
	input: { method: ManualPayoutMethod; reference: string; amountCents: number; reason: string }
) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id: transferId }, json: input } as unknown as Parameters<
		typeof manualPayoutEndpoint
	>[0];
	return call(manualPayoutEndpoint(args));
}

export async function decideManualPayout(
	manualPayoutId: string,
	input: { decision: 'approved' | 'rejected'; note?: string | null }
) {
	const args = { param: { id: manualPayoutId }, json: input } as unknown as Parameters<
		typeof decideEndpoint
	>[0];
	return call(decideEndpoint(args));
}

export async function retryTransfer(transferId: string) {
	return call(retryTransferEndpoint({ param: { id: transferId } }));
}

export async function listFailedRefunds() {
	return call(refundsEndpoint());
}

export async function retryRefund(refundId: string) {
	return call(retryRefundEndpoint({ param: { id: refundId } }));
}

export async function markRefundHandled(refundId: string, note: string) {
	const args = { param: { id: refundId }, json: { note } } as unknown as Parameters<
		typeof handledEndpoint
	>[0];
	return call(handledEndpoint(args));
}
