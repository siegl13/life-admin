<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { t, setLocaleProvider, type Locale } from '$lib/i18n';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// The server resolves the effective locale per request (setting +
	// Accept-Language) and hands it down as page data. The client mirrors
	// it into its own reactive provider once, at hydration, so `t()`
	// renders the same language after client-side navigation as the server
	// used for the initial render — no separate client-side detection.
	let clientLocale: Locale = $derived(data.language);
	if (browser) {
		setLocaleProvider(() => clientLocale);
	}

	function isActive(path: string): boolean {
		return path === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(path);
	}
</script>

<a class="skip-link" href="#main">{t('nav.skipToContent')}</a>

{#if data.isAuthenticated}
	<header class="app-topbar">
		<div class="app-topbar__inner">
			<a class="app-brand" href={resolve('/')}>Life Admin</a>
			<nav class="app-nav" aria-label={t('nav.label')}>
				<a href={resolve('/')} aria-current={isActive('/') ? 'page' : undefined}>
					{t('nav.whatsNext')}
				</a>
				<a href={resolve('/upcoming')} aria-current={isActive('/upcoming') ? 'page' : undefined}>
					{t('nav.upcoming')}
				</a>
				<a href={resolve('/items')} aria-current={isActive('/items') ? 'page' : undefined}>
					{t('nav.items')}
				</a>
				<a href={resolve('/inbox')} aria-current={isActive('/inbox') ? 'page' : undefined}>
					{t('nav.inbox')}
				</a>
				<a href={resolve('/settings')} aria-current={isActive('/settings') ? 'page' : undefined}>
					{t('nav.settings')}
				</a>
			</nav>
			<a
				class="topbar-search-link"
				href={resolve('/suche')}
				aria-label={t('search.headerLinkLabel')}
			>
				<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
					<circle cx="11" cy="11" r="6.5"></circle>
					<path d="m16 16 4 4"></path>
				</svg>
			</a>
			<a class="button" href={resolve('/items/new')}>{t('items.new')}</a>
			<form method="POST" action="/logout" class="topbar-logout">
				<button type="submit">{t('auth.logout')}</button>
			</form>
		</div>
	</header>
{/if}

<main class="app-shell" id="main">
	{@render children()}
</main>

{#if data.isAuthenticated}
	<!-- Same destinations as the top bar, within thumb reach on phones. -->
	<nav class="app-tabbar" aria-label={t('nav.labelMobile')}>
		<a href={resolve('/')} aria-current={isActive('/') ? 'page' : undefined}>{t('nav.whatsNext')}</a
		>
		<a href={resolve('/upcoming')} aria-current={isActive('/upcoming') ? 'page' : undefined}>
			{t('nav.upcoming')}
		</a>
		<a href={resolve('/items')} aria-current={isActive('/items') ? 'page' : undefined}>
			{t('nav.items')}
		</a>
		<a href={resolve('/inbox')} aria-current={isActive('/inbox') ? 'page' : undefined}
			>{t('nav.inbox')}</a
		>
		<a href={resolve('/settings')} aria-current={isActive('/settings') ? 'page' : undefined}>
			{t('nav.settings')}
		</a>
	</nav>
{/if}
