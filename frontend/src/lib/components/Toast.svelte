<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut, cubicIn } from 'svelte/easing';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	const STYLES = {
		info: { border: 'border-cyan', text: 'text-cyan', bg: 'bg-cyan/5', label: 'INFO' },
		success: { border: 'border-green', text: 'text-green', bg: 'bg-green/5', label: 'OK' },
		warning: { border: 'border-amber', text: 'text-amber', bg: 'bg-amber/5', label: 'WARN' },
		error: { border: 'border-red', text: 'text-red', bg: 'bg-red/5', label: 'ERR' }
	} as const;

	const MAX_VISIBLE = 3;

	let expanded = $state(false);

	// Reversed so newest is first (displayed on top)
	const reversedItems = $derived([...toastStore.items].reverse());
	const visibleItems = $derived(expanded ? reversedItems : reversedItems.slice(0, MAX_VISIBLE));
	const collapsedCount = $derived(Math.max(0, toastStore.items.length - MAX_VISIBLE));
	const showCollapsed = $derived(!expanded && collapsedCount > 0);

	function toggleExpand() {
		expanded = !expanded;
	}

	// Auto-collapse when items reduce to MAX_VISIBLE or fewer
	$effect(() => {
		if (toastStore.items.length <= MAX_VISIBLE) {
			expanded = false;
		}
	});
</script>

<div
	class="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none w-80 max-w-[calc(100vw-2rem)]"
>
	<!-- Collapsed stack indicator -->
	{#if showCollapsed}
		<button
			onclick={toggleExpand}
			in:fly={{ x: 24, duration: 250, easing: cubicOut }}
			out:fly={{ x: 24, duration: 180, easing: cubicIn }}
			class="pointer-events-auto relative h-10 w-full rounded border border-border bg-surface shadow-lg cursor-pointer hover:bg-surface-hover transition-colors"
		>
			<!-- Stacked card visual (peeking cards behind) -->
			<div class="absolute inset-0 rounded border border-border bg-surface -translate-y-1 scale-[0.97] opacity-60"></div>
			<div class="absolute inset-0 rounded border border-border bg-surface -translate-y-2 scale-[0.94] opacity-30"></div>
			<span class="relative z-10 flex items-center justify-center h-full text-sm text-muted font-mono">
				+{collapsedCount} more
			</span>
		</button>
	{/if}

	<!-- Visible toasts -->
	{#each visibleItems as toast (toast.id)}
		{@const s = STYLES[toast.type]}
		<div
			in:fly={{ x: 24, duration: 250, easing: cubicOut }}
			out:fly={{ x: 24, duration: 180, easing: cubicIn }}
			class="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded border {s.border} {s.bg} bg-surface shadow-lg"
			role="status"
		>
			<span class="text-xs font-bold font-mono {s.text} flex-shrink-0 mt-0.5 tracking-wider"
				>[{s.label}]</span
			>
			<span class="text-sm text-secondary flex-1 leading-snug">{toast.message}</span>
			<button
				onclick={(e) => { e.stopPropagation(); toastStore.remove(toast.id); }}
				class="text-muted hover:text-primary transition-colors flex-shrink-0 leading-none ml-1"
				aria-label="Dismiss notification"
			>✕</button>
		</div>
	{/each}

	<!-- Collapse button when expanded -->
	{#if expanded && toastStore.items.length > MAX_VISIBLE}
		<button
			onclick={toggleExpand}
			in:fly={{ y: -10, duration: 200, easing: cubicOut }}
			out:fly={{ y: -10, duration: 150, easing: cubicIn }}
			class="pointer-events-auto text-xs text-muted hover:text-primary font-mono transition-colors self-end"
		>
			collapse ↑
		</button>
	{/if}
</div>
