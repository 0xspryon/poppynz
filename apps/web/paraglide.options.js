// Shared Paraglide compiler options: the vite plugin (dev, build, vitest) and
// `bun run i18n:compile` (type checks run before any vite build) must agree.
/** @type {import('@inlang/paraglide-js').CompilerOptions} */
export const paraglideOptions = {
	project: './project.inlang',
	outdir: './src/lib/paraglide',
	// The EN/FR toggle writes the cookie; a first visit follows the browser's
	// Accept-Language (navigator.languages on the client), then English.
	strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
	cookieName: 'PARAGLIDE_LOCALE',
	isServer: 'import.meta.env.SSR',
	emitTsDeclarations: true
};
