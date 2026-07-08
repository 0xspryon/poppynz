import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		// Honor the port assigned by the host (e.g. preview tooling); vite
		// ignores PORT on its own and would silently pick another port.
		port: process.env.PORT ? Number(process.env.PORT) : undefined,
		// Same-origin API in dev: the RPC client fetches relative /api/* URLs,
		// which vite forwards to the local API container. Production does the
		// same routing with a reverse proxy (Traefik), so CORS is never needed.
		proxy: {
			'/api': {
				target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
				changeOrigin: true
			}
		}
	},
	resolve: {
		alias: {
			'@/web': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	plugins: [tailwindcss(), sveltekit()]
});
