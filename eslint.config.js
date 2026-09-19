import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const domainForbidden = [
	{
		group: ['svelte', 'svelte/*', '@sveltejs/*', '$app/*', '$env/*'],
		message: 'domain/ must not depend on Svelte or SvelteKit.'
	},
	{
		group: ['$lib/server/*', '$lib/server'],
		message: 'domain/ must not depend on server/ (infrastructure).'
	},
	{
		group: ['$lib/application/*', '$lib/application'],
		message: 'domain/ must not depend on application/ (wrong direction).'
	},
	{
		group: ['better-sqlite3', 'yaml', 'node:fs', 'fs', 'node:fs/promises', 'fs/promises'],
		message: 'domain/ must be pure: no SQLite, no YAML parsing, no filesystem access.'
	}
];

const applicationForbidden = [
	{
		group: ['$lib/server/*', '$lib/server'],
		message:
			'application/ must depend on repository ports (ports.ts), not on server/ implementations directly.'
	},
	{
		group: ['svelte', 'svelte/*', '@sveltejs/*', '$app/*', '$env/*'],
		message: 'application/ must not depend on Svelte or SvelteKit.'
	}
];

export default tseslint.config(
	{
		ignores: [
			'.agent/',
			'build/',
			'.svelte-kit/',
			'node_modules/',
			'playbooks/',
			'docs/',
			'playwright-report/',
			'test-results/'
		]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: {
				process: 'readonly'
			}
		}
	},
	{
		files: ['src/lib/domain/**/*.{ts,js}'],
		rules: {
			'no-restricted-imports': ['error', { patterns: domainForbidden }]
		}
	},
	{
		files: ['src/lib/application/**/*.{ts,js}'],
		rules: {
			'no-restricted-imports': ['error', { patterns: applicationForbidden }]
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		}
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
		}
	}
);
