/**
 * Find a replacement (Tier 3, step 1b): when a helper cancels, the family
 * looks for another helper and starts a short contract from the current one.
 * The context — which contract and which cancelled sessions — travels in the
 * URL (`?replace=<contract>&sessions=<id,id>`) from the cancelled session or
 * the email, through Find help and a helper's profile. When the family has
 * to reach out first, it is also remembered in this browser for that helper,
 * so the conversation can offer the template once the helper accepts (a
 * convenience only: the cancelled session's "Find a replacement" always
 * works again).
 */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import {
	startReplacement,
	type ReplacementContextError,
	type StartReplacementError
} from '$lib/api/contracts';
import { formatSessionRange } from '$lib/contract-sessions';
import { formatDateWithWeekday } from '$lib/date';
import { withQuery } from '$lib/nav';
import { m } from '$lib/paraglide/messages';
import { toast } from '$lib/toast.svelte';

export type ReplacementParams = { contractId: string; sessionIds: Array<string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The replacement context in a URL's search params, or null. */
export const readReplacementParams = (params: URLSearchParams): ReplacementParams | null => {
	const contractId = params.get('replace') ?? '';
	const sessionIds = (params.get('sessions') ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
	if (!UUID.test(contractId) || sessionIds.length === 0) return null;
	if (!sessionIds.every((id) => UUID.test(id))) return null;
	return { contractId, sessionIds };
};

/** Writes the context into search params (nothing without one). */
export const writeReplacementParams = (
	params: URLSearchParams,
	replacement: ReplacementParams | null
) => {
	if (!replacement) return;
	params.set('replace', replacement.contractId);
	params.set('sessions', replacement.sessionIds.join(','));
};

/** Find help in "Find a replacement" mode for these sessions. */
export const findReplacementHref = (serviceName: string | null, replacement: ReplacementParams) => {
	const params = new URLSearchParams();
	if (serviceName) params.set('service', serviceName);
	writeReplacementParams(params, replacement);
	return withQuery(resolve('/family/find'), params.toString());
};

/** "Tue, Nov 3 · 3:30 – 5:30 p.m." for one cancelled session. */
export const replacementSessionLabel = (session: {
	date: string;
	startMinutes: number;
	endMinutes: number;
}) =>
	`${formatDateWithWeekday(session.date)} · ${formatSessionRange({
		weekday: 0,
		startMinutes: session.startMinutes,
		endMinutes: session.endMinutes
	})}`;

// --- remembered across the reach-out (per helper, this browser only) ---

const STORAGE_PREFIX = 'poppynz-replacement:';
/** A remembered context older than this is stale (its sessions have passed). */
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

export const rememberReplacement = (helperUserId: string, replacement: ReplacementParams) => {
	try {
		localStorage.setItem(
			STORAGE_PREFIX + helperUserId,
			JSON.stringify({ ...replacement, savedAt: Date.now() })
		);
	} catch {
		// Storage unavailable (private mode): the URL still carries it.
	}
};

export const recallReplacement = (helperUserId: string): ReplacementParams | null => {
	try {
		const raw = localStorage.getItem(STORAGE_PREFIX + helperUserId);
		if (!raw) return null;
		const saved = JSON.parse(raw) as Partial<ReplacementParams> & { savedAt?: number };
		if (typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > REMEMBER_MS) {
			forgetReplacement(helperUserId);
			return null;
		}
		const params = new URLSearchParams();
		params.set('replace', String(saved.contractId ?? ''));
		params.set('sessions', Array.isArray(saved.sessionIds) ? saved.sessionIds.join(',') : '');
		return readReplacementParams(params);
	} catch {
		return null;
	}
};

export const forgetReplacement = (helperUserId: string) => {
	try {
		localStorage.removeItem(STORAGE_PREFIX + helperUserId);
	} catch {
		// Nothing to forget.
	}
};

// --- starting it ---

/** The toast for a refused replacement. `name`: the chosen helper. */
export const replacementErrorMessage = (
	error: StartReplacementError | ReplacementContextError,
	name: string
): string => {
	switch (error.code) {
		case 'REPLACEMENT_SESSIONS_INVALID':
			return error.reason === 'already_started'
				? m.replacement_error_started()
				: m.replacement_error_sessions();
		case 'REPLACEMENT_SAME_HELPER':
			return m.replacement_error_same_helper();
		case 'REPLACEMENT_SERVICE_NOT_OFFERED':
			return m.replacement_error_not_offered({ name });
		case 'REPLACEMENT_SERVICE_NOT_AVAILABLE':
			return m.replacement_error_not_available({ name });
		case 'REPLACEMENT_REACH_OUT_REQUIRED':
			return error.status === 'pending'
				? m.replacement_error_pending({ name })
				: error.status === 'ignored'
					? m.replacement_error_ignored({ name })
					: m.replacement_error_reach_out({ name });
		case 'CONTRACT_NOT_FOUND':
			return m.replacement_error_not_found();
		default:
			return m.replacement_error_generic();
	}
};

/**
 * "Use this contract as a template" with `helper`: opens the new draft (or
 * the one already started), or toasts why not. `onReachOut` runs when there
 * is no conversation yet, to open the reach-out composer instead.
 */
export async function startReplacementWithToast(
	replacement: ReplacementParams,
	helper: { userId: string; name: string },
	onReachOut?: () => void
): Promise<void> {
	const result = await startReplacement(replacement.contractId, {
		providerUserId: helper.userId,
		sessionIds: replacement.sessionIds
	});
	if (result.ok) {
		forgetReplacement(helper.userId);
		if (result.data.reused) {
			toast.info(m.replacement_toast_reused());
		} else {
			toast.success(m.replacement_toast_created({ name: helper.name }), {
				title: m.replacement_toast_created_title()
			});
		}
		void goto(resolve('/family/contracts/[id]', { id: result.data.id }));
		return;
	}
	const error = result.error;
	if (error.code === 'CONTRACT_EXISTS') {
		toast.info(m.replacement_toast_exists({ name: helper.name }));
		void goto(resolve('/family/contracts/[id]', { id: error.contractId }));
		return;
	}
	if (error.code === 'REPLACEMENT_REACH_OUT_REQUIRED' && error.status === 'none' && onReachOut) {
		onReachOut();
		return;
	}
	toast.error(replacementErrorMessage(error, helper.name));
}
