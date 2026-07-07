import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	resolve: {
		alias: {
			'@/web': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	plugins: [tailwindcss(), sveltekit()]
});
