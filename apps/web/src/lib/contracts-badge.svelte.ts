/**
 * Shared counter behind the sidebar "Contracts" badge: contracts with news
 * for the viewer (a proposal awaiting them, an outcome they haven't seen, an
 * end notice). Layouts render `contractsBadge.count`; opening a contract
 * detail (which marks it seen) and contract realtime events call `refresh()`.
 */
import { getContractsBadgeCount } from './api/contracts';

class ContractsBadgeStore {
	count = $state(0);

	async refresh(): Promise<void> {
		const result = await getContractsBadgeCount();
		if (result.ok) this.count = result.data.total;
	}
}

export const contractsBadge = new ContractsBadgeStore();
