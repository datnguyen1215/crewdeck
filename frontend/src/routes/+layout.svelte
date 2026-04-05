<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { onNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { globalWs } from '$lib/api/global-ws.svelte.js';

	let { children } = $props();

	const isAuthPage = $derived(
		$page.url.pathname.startsWith('/login') ||
		$page.url.pathname.startsWith('/register') ||
		$page.url.pathname.startsWith('/setup/')
	);

	// Check if navigation stays within the same /projects/[id] prefix
	function isSameProject(
		from: { url: URL } | null,
		to: { url: URL } | null
	): boolean {
		if (!from || !to) return false;
		const fromMatch = from.url.pathname.match(/^\/projects\/([^/]+)/);
		const toMatch = to.url.pathname.match(/^\/projects\/([^/]+)/);
		return !!fromMatch && !!toMatch && fromMatch[1] === toMatch[1];
	}

	// Page transitions via View Transitions API
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (isSameProject(navigation.from, navigation.to)) return;

		return new Promise((resolve) => {
			const transition = document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});

			// Prevent broken state if transition fails (e.g., rapid navigation)
			transition.finished.catch(() => {});
		});
	});

	onMount(() => {
		if (!isAuthPage) globalWs.connect();
		return () => { globalWs.disconnect(); };
	});
</script>

{#if !isAuthPage && (globalWs.state === 'reconnecting' || globalWs.state === 'connecting')}
	<div class="fixed top-0 left-0 right-0 z-[300] flex items-center justify-center gap-2 py-1 bg-amber/10 border-b border-amber/30 text-amber text-xs" style="view-transition-name: none">
		<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber animate-pulse"></span>
		{globalWs.state === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
	</div>
{/if}

{#if isAuthPage}
	<div class="flex items-center justify-center min-h-screen bg-base">
		{@render children()}
	</div>
{:else}
	<div class="flex h-screen bg-base overflow-hidden">
		<Sidebar />
		<main class="flex-1 overflow-auto w-full md:w-auto">
			{@render children()}
		</main>
	</div>
{/if}

<div id="modal-portal" style="view-transition-name: none"></div>

<Toast />
