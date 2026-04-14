<script lang="ts">
	import { fly, scale } from 'svelte/transition';
	import { cubicOut, cubicIn } from 'svelte/easing';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	const STYLES = {
		info: { border: 'border-cyan', text: 'text-cyan', bg: 'bg-cyan/5', label: 'INFO' },
		success: { border: 'border-green', text: 'text-green', bg: 'bg-green/5', label: 'OK' },
		warning: { border: 'border-amber', text: 'text-amber', bg: 'bg-amber/5', label: 'WARN' },
		error: { border: 'border-red', text: 'text-red', bg: 'bg-red/5', label: 'ERR' }
	} as const;

	const MAX_STACK_LAYERS = 3;

	// Reversed so newest is first (displayed on top)
	const reversedItems = $derived([...toastStore.items].reverse());
	const totalCount = $derived(toastStore.items.length);
</script>

<div
	class="fixed bottom-4 right-4 z-[200] pointer-events-none w-80 max-w-[calc(100vw-2rem)]"
>
	{#if reversedItems.length > 0}
		{@const frontToast = reversedItems[0]}
		{@const s = STYLES[frontToast.type]}

		<!-- Stack container with relative positioning -->
		<div class="relative">
			<!-- Stacked card edges behind the front toast (oldest to newest, bottom to top) -->
			{#each reversedItems.slice(1, MAX_STACK_LAYERS + 1).reverse() as stackedToast, reverseIndex (stackedToast.id)}
				{@const stackIndex = Math.min(reversedItems.length - 1, MAX_STACK_LAYERS) - reverseIndex}
				{@const stackStyle = STYLES[stackedToast.type]}
				<div
					class="absolute inset-x-0 top-0 h-14 rounded border {stackStyle.border} bg-surface shadow-md pointer-events-none"
					style="
						transform: translateY({stackIndex * 8}px) scale({1 - stackIndex * 0.03});
						opacity: {1 - stackIndex * 0.2};
						z-index: {-stackIndex};
					"
				></div>
			{/each}

			<!-- Front toast (newest) - fully visible with content -->
			<div
				in:fly={{ x: 24, duration: 250, easing: cubicOut }}
				out:scale={{ duration: 150, start: 0.95, easing: cubicIn }}
				class="pointer-events-auto relative z-10 flex items-start gap-3 px-4 py-3 rounded border {s.border} {s.bg} bg-surface shadow-lg"
				role="status"
			>
				<span class="text-xs font-bold font-mono {s.text} flex-shrink-0 mt-0.5 tracking-wider"
					>[{s.label}]</span
				>
				<div class="flex-1">
					{#if frontToast.project}
						<div class="text-xs text-muted mb-1">{frontToast.project}</div>
					{/if}
					<span class="text-sm text-secondary leading-snug">{frontToast.message}</span>
				</div>

				<!-- Position counter -->
				{#if totalCount > 1}
					<span class="text-xs text-muted font-mono flex-shrink-0 mt-0.5">
						1 of {totalCount}
					</span>
				{/if}

				<button
					onclick={(e) => { e.stopPropagation(); toastStore.remove(frontToast.id); }}
					class="text-muted hover:text-primary transition-colors flex-shrink-0 leading-none ml-1"
					aria-label="Dismiss notification"
				>✕</button>
			</div>
		</div>
	{/if}
</div>
