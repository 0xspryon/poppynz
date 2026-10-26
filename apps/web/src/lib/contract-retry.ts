import { retryContractPayment } from '$lib/api/contracts';
import { m } from '$lib/paraglide/messages';
import { toast } from '$lib/toast.svelte';

/**
 * The family's "Retry payment" (UAT round 2 #13), shared by the contract's
 * Billing panel and the cycle page: retries through the permission-checked
 * route and toasts what came of it. Resolves once the outcome is known, so
 * the caller can refetch.
 */
export async function retryPaymentWithToast(contractId: string): Promise<void> {
	const result = await retryContractPayment(contractId);
	if (result.ok) {
		switch (result.data.outcome) {
			case 'charged':
				toast.success(m.contracts_toast_retry_charged());
				return;
			case 'declined':
				toast.error(m.contracts_toast_retry_declined());
				return;
			case 'in_progress':
				toast.info(m.contracts_toast_retry_in_progress());
				return;
		}
	}
	if (result.ok) return;
	switch (result.error.code) {
		case 'PAYMENT_RETRY_RATE_LIMITED':
			toast.info(m.contracts_toast_retry_rate_limited());
			return;
		case 'PAYMENT_RETRY_NOT_NEEDED':
			toast.info(m.contracts_toast_retry_not_needed());
			return;
		case 'PAYMENTS_UNAVAILABLE':
			toast.error(m.contracts_toast_retry_unavailable());
			return;
		default:
			toast.error(m.contracts_error_retry_failed());
	}
}
