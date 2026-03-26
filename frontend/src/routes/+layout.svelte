<script lang="ts">
	import '../app.css';
	import { onNavigate } from '$app/navigation';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';

	let { children } = $props();

	// Page transitions via View Transitions API
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<div class="flex h-screen bg-base overflow-hidden">
	<Sidebar />
	<main class="flex-1 overflow-auto w-full md:w-auto">
		{@render children()}
	</main>
</div>

<div id="modal-portal"></div>

<Toast />
