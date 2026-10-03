/**
 * Sidebar "Payouts" badge: shown while the helper has no payout account or it
 * isn't payment-ready yet. A reminder only — nothing is blocked (piece 2b).
 * The layout refreshes it on navigation; the Payouts page sets it directly
 * after each status it loads.
 */
import { getPayouts } from './api/payouts';

class PayoutsBadgeStore {
	needsSetup = $state(false);

	async refresh(): Promise<void> {
		const result = await getPayouts();
		if (result.ok) this.needsSetup = !result.data.paymentReady;
	}
}

export const payoutsBadge = new PayoutsBadgeStore();
