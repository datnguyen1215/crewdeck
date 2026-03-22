<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open,
		onClose,
		label,
		maxWidth = 'max-w-lg',
		escapeClose = true,
		children
	}: {
		open: boolean;
		onClose: () => void;
		label: string;
		maxWidth?: string;
		escapeClose?: boolean;
		children: Snippet;
	} = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (open && escapeClose && e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => e.target === e.currentTarget && onClose()}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-label={label}
		tabindex="-1"
	>
		<div class="bg-surface border border-edge rounded w-full {maxWidth} mx-4 p-6 shadow-2xl">
			{@render children()}
		</div>
	</div>
{/if}
