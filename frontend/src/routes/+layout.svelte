<script lang="ts">
	import '../app.css';
	import { onNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { toastStore, type ToastType } from '$lib/stores/toasts.svelte.js';

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

	// Simulate mocked WebSocket events to demo the toast system
	onMount(() => {
		const events: Array<{ delay: number; type: ToastType; msg: string }> = [
			{ delay: 3000, type: 'info', msg: 'Agent Alice assigned to issue #42' },
			{ delay: 9000, type: 'success', msg: 'Issue status changed: In Progress → In Review' },
			{ delay: 16000, type: 'warning', msg: 'Review cycle 2 of 3 started for #38' },
			{ delay: 24000, type: 'success', msg: 'PR #17 created successfully' }
		];
		const timers = events.map(({ delay, type, msg }) =>
			setTimeout(() => toastStore.add(msg, type), delay)
		);
		return () => timers.forEach(clearTimeout);
	});
</script>

<div class="flex h-screen bg-base overflow-hidden">
	<Sidebar />
	<main class="flex-1 overflow-auto">
		{@render children()}
	</main>
</div>

<Toast />
