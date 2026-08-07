/**
 * Realtime notifications — one EventSource per signed-in session on
 * GET /api/v1/notifications/stream, authenticated by the session cookie.
 *
 * Domain-agnostic by design: features subscribe to the typed events they care
 * about (`notifications.on('conversation.message', …)`) and a future event
 * kind (contract updates, approval decisions, …) only needs a payload entry in
 * @repo/notify plus a subscriber here — the transport never changes.
 *
 * Events are an accelerator, not a source of truth: subscribers should refetch
 * REST state for anything critical; a missed event only costs freshness.
 */
import { browser } from '$app/environment';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { AppNotification, NotificationType } from '@repo/notify/events';

const STREAM_URL = '/api/v1/notifications/stream';
const INITIAL_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

type Handler<T extends NotificationType> = (notification: AppNotification<T>) => void;

class NotificationsClient {
	connected = $state(false);

	#source: EventSource | null = null;
	#handlers = new SvelteMap<NotificationType, SvelteSet<Handler<NotificationType>>>();
	#retryMs = INITIAL_RETRY_MS;
	#retryTimer: ReturnType<typeof setTimeout> | null = null;

	/** Idempotent — layouts call this once the session is confirmed. */
	connect(): void {
		if (!browser || this.#source) return;
		this.#open();
	}

	disconnect(): void {
		if (this.#retryTimer) {
			clearTimeout(this.#retryTimer);
			this.#retryTimer = null;
		}
		this.#source?.close();
		this.#source = null;
		this.connected = false;
	}

	/** Subscribe to one event type; returns the unsubscribe function. */
	on<T extends NotificationType>(type: T, handler: Handler<T>): () => void {
		let set = this.#handlers.get(type);
		if (!set) {
			set = new SvelteSet();
			this.#handlers.set(type, set);
			this.#listen(type);
		}
		set.add(handler as Handler<NotificationType>);
		return () => {
			set.delete(handler as Handler<NotificationType>);
		};
	}

	#open(): void {
		const source = new EventSource(STREAM_URL);
		this.#source = source;

		source.addEventListener('connected', () => {
			this.connected = true;
			this.#retryMs = INITIAL_RETRY_MS;
		});
		for (const type of this.#handlers.keys()) this.#listen(type);

		source.onerror = () => {
			this.connected = false;
			// EventSource retries transient drops itself; CLOSED means it gave up
			// (e.g. a 401 during a session refresh) — reopen with backoff.
			if (source.readyState === EventSource.CLOSED && this.#source === source) {
				this.#source = null;
				this.#retryTimer = setTimeout(() => this.#open(), this.#retryMs);
				this.#retryMs = Math.min(this.#retryMs * 2, MAX_RETRY_MS);
			}
		};
	}

	#listen(type: NotificationType): void {
		this.#source?.addEventListener(type, (event: MessageEvent<string>) => {
			let notification: AppNotification;
			try {
				notification = JSON.parse(event.data) as AppNotification;
			} catch {
				return;
			}
			const set = this.#handlers.get(type);
			if (!set) return;
			for (const handler of set) handler(notification);
		});
	}
}

export const notifications = new NotificationsClient();
