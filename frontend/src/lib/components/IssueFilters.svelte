<script lang="ts">
	import QueueMonitor from '$lib/components/QueueMonitor.svelte';
	import ColumnSelector from '$lib/components/ColumnSelector.svelte';
	import { STATUS_CFG } from '$lib/config/status.js';

	let {
		searchQuery = $bindable(''),
		filterStatuses = $bindable<string[]>([]),
		sortField = $bindable<'created_at' | 'updated_at'>('created_at'),
		sortDesc = $bindable(true),
		showCompleted = $bindable(false),
		visibleColumns = $bindable<string[]>([]),
	}: {
		searchQuery: string;
		filterStatuses: string[];
		sortField: 'created_at' | 'updated_at';
		sortDesc: boolean;
		showCompleted: boolean;
		visibleColumns: string[];
	} = $props();

	function toggleStatus(status: string) {
		filterStatuses = filterStatuses.includes(status)
			? filterStatuses.filter((s) => s !== status)
			: [...filterStatuses, status];
	}
</script>

<div class="mb-5 space-y-3">
	<!-- Search input -->
	<div class="flex flex-col sm:flex-row sm:items-center gap-2">
		<span class="text-xs text-muted uppercase tracking-widest hidden sm:inline">Search:</span>
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Filter by title or description…"
			class="flex-1 w-full sm:max-w-sm bg-surface border border-edge text-secondary text-xs rounded px-3 py-2.5 sm:py-1.5 hover:border-edge-hi focus:border-cyan transition-colors outline-none placeholder:text-muted"
		/>
		{#if searchQuery}
			<button
				onclick={() => (searchQuery = '')}
				class="px-3 py-1.5 text-xs text-muted hover:text-secondary border border-edge hover:border-edge-hi rounded transition-colors self-start"
			>
				Clear ×
			</button>
		{/if}
	</div>

	<!-- Status toggle pills -->
	<div class="flex flex-wrap items-center gap-1.5">
		<span class="text-xs text-muted uppercase tracking-widest mr-1 w-full sm:w-auto mb-1 sm:mb-0">Status:</span>
		{#each Object.entries(STATUS_CFG) as [key, cfg] (key)}
			<button
				onclick={() => toggleStatus(key)}
				class="px-2.5 py-1.5 sm:py-0.5 text-xs rounded border transition-colors min-h-[36px] sm:min-h-0 {filterStatuses.includes(key)
					? `${cfg.text} ${cfg.border} bg-surface-hi`
					: 'text-muted border-edge hover:border-edge-hi hover:text-secondary'}"
			>
				{cfg.label}
			</button>
		{/each}
		{#if filterStatuses.length > 0}
			<button
				onclick={() => (filterStatuses = [])}
				class="px-2.5 py-1.5 sm:py-0.5 text-xs text-muted hover:text-secondary border border-transparent hover:border-edge rounded transition-colors"
			>
				Clear ×
			</button>
		{/if}
	</div>

	<!-- Sort controls -->
	<div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-wrap">
		<div class="flex items-center gap-2">
			<span class="text-xs text-muted uppercase tracking-widest">Sort:</span>
			<select
				bind:value={sortField}
				class="bg-surface border border-edge text-secondary text-xs rounded px-2 py-2 sm:py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none min-h-[36px] sm:min-h-0"
			>
				<option value="created_at">Created</option>
				<option value="updated_at">Updated</option>
			</select>
			<button
				onclick={() => (sortDesc = !sortDesc)}
				class="px-3 py-2 sm:py-1 bg-surface border border-edge text-secondary text-xs rounded hover:border-edge-hi hover:text-primary transition-colors min-h-[36px] sm:min-h-0"
				title={sortDesc ? 'Descending' : 'Ascending'}
			>
				{sortDesc ? '↓ Desc' : '↑ Asc'}
			</button>
		</div>

		<label class="flex items-center gap-2 cursor-pointer min-h-[36px] sm:min-h-0">
			<input
				type="checkbox"
				bind:checked={showCompleted}
				class="accent-cyan w-4 h-4"
			/>
			<span class="text-xs text-muted">Show completed</span>
		</label>

		<ColumnSelector bind:visibleColumns />

		<div class="sm:ml-auto">
			<QueueMonitor />
		</div>
	</div>
</div>
