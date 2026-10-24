import type { SessionRole } from '$lib/api/profile';

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
