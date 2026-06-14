import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	resolve: {
		alias: {
			'@/docs': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	plugins: [sveltekit()]
});
