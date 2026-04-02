<script lang="ts">
	import '../../app.css';
	import Toast from '$lib/components/Toast.svelte';

	let { children } = $props();
</script>

<div class="flex items-center justify-center min-h-screen bg-base">
	{@render children()}
</div>

<Toast />
