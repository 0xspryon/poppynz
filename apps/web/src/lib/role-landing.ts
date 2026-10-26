import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { SessionRole } from '$lib/api/profile';
import { withQuery } from '$lib/nav';

/**
 * Where each signed-in role lands: after the magic link, at the root, and
 * when a guard turns away a role that doesn't belong in an area (U1). Every
 * role-based redirect goes through this, so a role (the accountant) can't be
 * known to one guard and sent to sign-in by another.
 */
export const landingPathFor = (role: SessionRole | null | undefined) => {
	switch (role) {
		case 'admin':
			return '/admin' as const;
		case 'accountant':
			return '/accountant' as const;
		case 'service-provider':
			return '/service-provider/dashboard' as const;
		case 'family':
			return '/family/profile' as const;
		default:
			return null;
	}
};

/**
 * UAT round 2 #5: a family or helper with a running contract (active or
 * under notice — billing suspended or awaiting payment readiness included)
 * lands on the contract view instead: the contract itself when there is
 * one, the contracts list filtered to active when there are several. Null
 * keeps the usual landing (no running contract; admin and accountant).
 */
export const contractLandingPath = (
	role: SessionRole | null | undefined,
	activeContractIds: ReadonlyArray<string>
): ResolvedPathname | null => {
	if (role !== 'family' && role !== 'service-provider') return null;
	const [only, ...more] = activeContractIds;
	if (only === undefined) return null;
	if (more.length === 0) {
		return role === 'family'
			? resolve('/family/contracts/[id]', { id: only })
			: resolve('/service-provider/contracts/[id]', { id: only });
	}
	return withQuery(
		role === 'family' ? resolve('/family/contracts') : resolve('/service-provider/contracts'),
		'filter=active'
	);
};

/**
 * The landing after sign-in (and at the root / role home): the contract
 * view when the member has a running contract, else `fallback` — the role's
 * usual landing. A failed lookup never blocks signing in: it falls back.
 */
export async function resolveLanding(
	role: SessionRole | null | undefined,
	fallback: ResolvedPathname | null = null
): Promise<ResolvedPathname | null> {
	const usual = fallback ?? (landingPathFor(role) ? resolve(landingPathFor(role)!) : null);
	if (role !== 'family' && role !== 'service-provider') return usual;
	const { getContractLanding } = await import('$lib/api/contracts');
	const result = await getContractLanding();
	if (!result.ok) return usual;
	return contractLandingPath(role, result.data.activeContractIds) ?? usual;
}
