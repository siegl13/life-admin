<script lang="ts">
	import '@fontsource-variable/geist';
	import '@fontsource-variable/geist-mono';
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

	// The floating create button would sit on top of the submit button on the
	// create-item form itself, so it is hidden there. It also collides with
	// the item-detail page's own sticky mobile action bar, so it is hidden
	// there too — but only on the detail route itself, not nested routes
	// like suggestions review.
	let hideFab = $derived(
		page.url.pathname === resolve('/items/new') || page.route.id === '/items/[id]'
	);
</script>

{#snippet primaryDestinations()}
	<a href={resolve('/')} aria-current={isActive('/') ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<circle cx="12" cy="12" r="8.5"></circle>
			<path d="M12 7.5V12l3 2"></path>
		</svg>
		<span>{t('nav.whatsNext')}</span>
	</a>
	<a href={resolve('/upcoming')} aria-current={isActive('/upcoming') ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<rect x="3.5" y="5" width="17" height="15" rx="3"></rect>
			<path d="M3.5 10h17M8 3v4M16 3v4"></path>
		</svg>
		<span>{t('nav.upcoming')}</span>
	</a>
	<a href={resolve('/items')} aria-current={isActive('/items') ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<rect x="4" y="4" width="7" height="7" rx="2"></rect>
			<rect x="13" y="4" width="7" height="7" rx="2"></rect>
			<rect x="4" y="13" width="7" height="7" rx="2"></rect>
			<rect x="13" y="13" width="7" height="7" rx="2"></rect>
		</svg>
		<span>{t('nav.items')}</span>
	</a>
	<a href={resolve('/inbox')} aria-current={isActive('/inbox') ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5"></path>
			<path d="M4 13.5l2.5-8h11l2.5 8h-5a3 3 0 0 1-6 0z"></path>
		</svg>
		<span>{t('nav.inbox')}</span>
	</a>
{/snippet}

{#snippet accountEntries()}
	<a href={resolve('/settings')} aria-current={isActive('/settings') ? 'page' : undefined}>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<circle cx="12" cy="12" r="3"></circle>
			<path
				d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"
			></path>
		</svg>
		{t('nav.settings')}
	</a>
	<form method="POST" action="/logout">
		<button type="submit">
			<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
				<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"></path>
			</svg>
			{t('auth.logout')}
		</button>
	</form>
{/snippet}

<a class="skip-link" href="#main">{t('nav.skipToContent')}</a>

{#if data.isAuthenticated}
	<div class="app-shell-root">
		<aside class="app-sidebar">
			<a class="app-brand" href={resolve('/')}>{t('nav.brand')}</a>
			<a class="app-sidebar-search" href={resolve('/suche')}>
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<circle cx="11" cy="11" r="6.5"></circle>
					<path d="m16 16 4 4"></path>
				</svg>
				{t('search.headerLinkLabel')}
			</a>
			<nav class="app-nav" aria-label={t('nav.label')}>
				{@render primaryDestinations()}
			</nav>
			<a class="button app-sidebar-primary" href={resolve('/items/new')}>{t('items.new')}</a>
			<div class="app-sidebar-footer">
				{@render accountEntries()}
			</div>
		</aside>

		<header class="app-mobile-header">
			<a class="app-brand" href={resolve('/')}>{t('nav.brand')}</a>
			<div class="app-mobile-header__actions">
				<a
					class="app-icon-button"
					href={resolve('/suche')}
					aria-label={t('search.headerLinkLabel')}
				>
					<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
						<circle cx="11" cy="11" r="6.5"></circle>
						<path d="m16 16 4 4"></path>
					</svg>
				</a>
				<a class="app-icon-button" href={resolve('/settings')} aria-label={t('nav.settings')}>
					<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
						<circle cx="12" cy="12" r="3"></circle>
						<path
							d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"
						></path>
					</svg>
				</a>
				<details class="app-account-menu">
					<summary class="app-icon-button" aria-label={t('nav.account')}>
						<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
							<circle cx="12" cy="8" r="3.5"></circle>
							<path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5"></path>
						</svg>
					</summary>
					<div class="app-account-menu__panel">
						{@render accountEntries()}
					</div>
				</details>
			</div>
		</header>

		<main class="app-shell" id="main" tabindex="-1">
			{@render children()}
		</main>

		{#if !hideFab}
			<a class="app-fab" href={resolve('/items/new')} aria-label={t('items.new')}>
				<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
					<path d="M12 5v14M5 12h14"></path>
				</svg>
			</a>
		{/if}

		<!-- Same four destinations as the sidebar, within thumb reach on phones. -->
		<nav class="app-tabbar" aria-label={t('nav.labelMobile')}>
			{@render primaryDestinations()}
		</nav>
	</div>
{:else}
	<main class="app-shell" id="main" tabindex="-1">
		{@render children()}
	</main>
{/if}
