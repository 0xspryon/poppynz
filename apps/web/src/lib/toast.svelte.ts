/**
 * Global toast notifications — transient micro-feedback for user actions
 * (save succeeded, request failed, …). Pages call `toast.success(...)` /
 * `toast.error(...)` from event handlers; `ToastHost` (mounted once per
 * authenticated layout) renders the stack.
 *
 * Field-level validation messages stay inline next to their input — toasts
 * are for operation outcomes only.
 */

import { SvelteMap } from 'svelte/reactivity';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastOptions {
	/** Optional bold heading rendered above the message. */
	title?: string;
	/** Time-to-live in milliseconds before auto-dismiss. Defaults: 5s, 10s for errors. */
	ttl?: number;
}

export interface ToastItem {
	id: number;
	kind: ToastKind;
	title?: string;
	message: string;
}

const DEFAULT_TTL: Record<ToastKind, number> = {
	success: 5_000,
	info: 5_000,
	error: 10_000
};

/** Oldest toasts are dropped beyond this, so the stack never fills the screen. */
const MAX_VISIBLE = 4;

let nextId = 1;
const timers = new SvelteMap<number, ReturnType<typeof setTimeout>>();

class ToastStore {
	items = $state<ToastItem[]>([]);

	success(message: string, options: ToastOptions = {}): void {
		this.#push('success', message, options);
	}

	error(message: string, options: ToastOptions = {}): void {
		this.#push('error', message, options);
	}

	info(message: string, options: ToastOptions = {}): void {
		this.#push('info', message, options);
	}

	dismiss(id: number): void {
		const timer = timers.get(id);
		if (timer !== undefined) {
			clearTimeout(timer);
			timers.delete(id);
		}
		this.items = this.items.filter((item) => item.id !== id);
	}

	#push(kind: ToastKind, message: string, { title, ttl }: ToastOptions): void {
		const ttlMs = ttl ?? DEFAULT_TTL[kind];

		// A repeat of a visible toast (double-click, retry) restarts its
		// timer instead of stacking a duplicate.
		const existing = this.items.find(
			(item) => item.kind === kind && item.message === message && item.title === title
		);
		if (existing !== undefined) {
			clearTimeout(timers.get(existing.id));
			timers.set(
				existing.id,
				setTimeout(() => this.dismiss(existing.id), ttlMs)
			);
			return;
		}

		const id = nextId++;
		this.items = [...this.items, { id, kind, title, message }];
		for (const dropped of this.items.slice(0, -MAX_VISIBLE)) {
			this.dismiss(dropped.id);
		}
		timers.set(
			id,
			setTimeout(() => this.dismiss(id), ttlMs)
		);
	}
}

export const toast = new ToastStore();
