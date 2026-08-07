/**
 * Shared unread-messages counter behind the sidebar "Messages" badge.
 * Layouts render `unread.count`; anything that changes read state (opening a
 * thread, a realtime event, navigation) calls `unread.refresh()`.
 */
import { getUnreadCount } from './api/conversations';

class UnreadStore {
	count = $state(0);

	async refresh(): Promise<void> {
		const result = await getUnreadCount();
		if (result.ok) this.count = result.data.total;
	}
}

export const unread = new UnreadStore();
