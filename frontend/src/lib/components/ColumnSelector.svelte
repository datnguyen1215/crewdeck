<script lang="ts">
	import { COLUMN_CONFIG } from '$lib/config/columns.js';

	let {
		visibleColumns = $bindable<string[]>([]),
	}: {
		visibleColumns: string[];
	} = $props();

	let open = $state(false);
	let buttonRef = $state<HTMLButtonElement | null>(null);
	let panelRef = $state<HTMLDivElement | null>(null);

	// Filter out the dispatch column from the UI since it has no label
	const selectableColumns = $derived(COLUMN_CONFIG.filter((c) => c.label !== ''));

	function toggle(key: string) {
		const col = COLUMN_CONFIG.find((c) => c.key === key);
		if (col?.locked) return;

		if (visibleColumns.includes(key)) {
			visibleColumns = visibleColumns.filter((k) => k !== key);
		} else {
			// Maintain order based on COLUMN_CONFIG
			const order = COLUMN_CONFIG.map((c) => c.key);
			visibleColumns = [...visibleColumns, key].sort((a, b) => order.indexOf(a) - order.indexOf(b));
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (buttonRef?.contains(target) || panelRef?.contains(target)) return;
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			open = false;
			buttonRef?.focus();
		}
	}

	$effect(() => {
		if (open) {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleKeydown);
		}
		return () => {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleKeydown);
		};
	});
</script>

<div class="relative">
	<button
		bind:this={buttonRef}
		onclick={() => (open = !open)}
		class="flex items-center gap-1.5 px-3 py-2 sm:py-1 bg-surface border border-edge text-secondary text-xs rounded hover:border-edge-hi transition-colors min-h-[36px] sm:min-h-0"
		aria-haspopup="true"
		aria-expanded={open}
	>
		<span>Columns</span>
		<svg class="w-3 h-3 transition-transform {open ? 'rotate-180' : ''}" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
		</svg>
	</button>

	{#if open}
		<div
			bind:this={panelRef}
			class="absolute right-0 top-full mt-1 z-50 bg-surface border border-edge rounded shadow-lg min-w-[160px] py-1"
			role="menu"
		>
			{#each selectableColumns as col (col.key)}
				<label
					class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-hi transition-colors {col.locked ? 'opacity-50 cursor-not-allowed' : ''}"
				>
					<input
						type="checkbox"
						checked={visibleColumns.includes(col.key)}
						disabled={col.locked}
						onchange={() => toggle(col.key)}
						class="accent-cyan w-4 h-4"
					/>
					<span class="text-xs text-secondary">{col.label}</span>
					{#if col.locked}
						<span class="text-xs text-muted ml-auto">(required)</span>
					{/if}
				</label>
			{/each}
		</div>
	{/if}
</div>
