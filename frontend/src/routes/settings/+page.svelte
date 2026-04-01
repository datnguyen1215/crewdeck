<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	// Redirect to /accounts - this page will be repurposed for global env vars
	onMount(() => {
		goto('/accounts', { replaceState: true });
	});
</script>

<svelte:head>
	<title>Settings - CrewDeck</title>
</svelte:head>

<div class="p-6 h-full overflow-auto flex items-center justify-center">
	<p class="text-muted">Redirecting...</p>
</div>
