<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { onNavigate } from '$app/navigation';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';

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
		return fromMatch?.[1] === toMatch?.[1];
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
</script>

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
