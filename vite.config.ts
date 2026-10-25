import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['none'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'form-action': ['self'],
					'base-uri': ['none'],
					'frame-ancestors': ['none'],
					'manifest-src': ['self']
				}
			}
		})
	],
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib')
		}
	},
	test: {
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}', 'tests/unit/**/*.{test,spec}.{js,ts}'],
		exclude: ['tests/e2e/**']
	}
});
