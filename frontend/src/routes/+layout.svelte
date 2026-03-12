<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';

	let { children } = $props();
</script>

<div class="flex h-screen bg-base overflow-hidden">
	<Sidebar />
	<main class="flex-1 overflow-auto">
		{@render children()}
	</main>
</div>
