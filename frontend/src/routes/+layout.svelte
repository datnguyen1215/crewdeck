<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { globalWs } from '$lib/api/global-ws.svelte.js';
	import { projectsStore } from '$lib/stores/projects.svelte.js';

	let { children } = $props();

	const isAuthPage = $derived(
		$page.url.pathname.startsWith('/login') ||
		$page.url.pathname.startsWith('/register') ||
		$page.url.pathname.startsWith('/setup/')
	);

	// Connect/disconnect WebSocket reactively based on auth page state
	$effect(() => {
		if (!isAuthPage) {
			globalWs.connect();
			projectsStore.init();
		} else {
			globalWs.disconnect();
			projectsStore.destroy();
		}
	});

	onDestroy(() => {
		globalWs.disconnect();
		projectsStore.destroy();
	});
</script>

{#if !isAuthPage && (globalWs.state === 'reconnecting' || globalWs.state === 'connecting')}
	<div class="fixed top-0 left-0 right-0 z-[300] flex items-center justify-center gap-2 py-1 bg-amber/10 border-b border-amber/30 text-amber text-xs">
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

<div id="modal-portal"></div>

<Toast />
