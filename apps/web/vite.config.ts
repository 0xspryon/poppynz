import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		// Honor the port assigned by the host (e.g. preview tooling); vite
		// ignores PORT on its own and would silently pick another port.
		port: process.env.PORT ? Number(process.env.PORT) : undefined
	},
	resolve: {
		alias: {
			'@/web': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	plugins: [tailwindcss(), sveltekit()]
});
