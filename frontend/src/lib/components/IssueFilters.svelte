<script lang="ts">
	import QueueMonitor from '$lib/components/QueueMonitor.svelte';
	import ColumnSelector from '$lib/components/ColumnSelector.svelte';
	import { STATUS_CFG } from '$lib/config/status.js';

	const STATUS_KEYS = Object.keys(STATUS_CFG);

	let {
		searchQuery = $bindable(''),
		sortField = $bindable<'created_at' | 'updated_at'>('created_at'),
		sortDesc = $bindable(true),
		visibleColumns = $bindable<string[]>([]),
	}: {
		searchQuery: string;
		sortField: 'created_at' | 'updated_at';
		sortDesc: boolean;
		visibleColumns: string[];
	} = $props();

	let inputEl: HTMLInputElement | undefined = $state();
	let focused = $state(false);
	let activeIndex = $state(0);

	let suggestions = $derived(() => {
		if (!focused) return [];

		const val = searchQuery;
		const cursorPos = inputEl?.selectionStart ?? val.length;

		// Check if cursor is inside a `key:` prefix
		const beforeCursor = val.slice(0, cursorPos);
		const match = beforeCursor.match(/(\w+):([\w,]*)$/);

		if (match) {
			const [, key, partial] = match;
			if (key === 'status') {
				const prefix = match[0];
				const items = STATUS_KEYS
					.filter((s) => s.startsWith(partial))
					.map((s) => ({ label: s, value: `${prefix.slice(0, -partial.length)}${s}` }));
				return items.length > 0 ? items : [];
			}
			if (key === 'paused') {
				const prefix = match[0];
				const items = ['true', 'false']
					.filter((v) => v.startsWith(partial))
					.map((v) => ({ label: v, value: `${prefix.slice(0, -partial.length)}${v}` }));
				return items.length > 0 ? items : [];
			}
			return [];
		}

		// Empty or no active filter prefix — show hints
		if (val.trim() === '' && cursorPos === 0) {
			return [
				{ label: 'status:', value: 'status:' },
				{ label: 'paused:', value: 'paused:' },
			];
		}

		return [];
	});

	let showDropdown = $derived(focused && suggestions().length > 0);

	function selectSuggestion(item: { label: string; value: string }) {
		const val = searchQuery;
		const cursorPos = inputEl?.selectionStart ?? val.length;
		const beforeCursor = val.slice(0, cursorPos);
		const afterCursor = val.slice(cursorPos);

		// Remove the partial key:value prefix from beforeCursor
		const cleaned = beforeCursor.replace(/\w+:[\w,]*$/, '');
		const separator = cleaned.length > 0 && !cleaned.endsWith(' ') ? ' ' : '';
		searchQuery = cleaned + separator + item.value + (item.value.endsWith(':') ? '' : ' ') + afterCursor;

		// Move cursor after inserted text
		requestAnimationFrame(() => {
			const newPos = cleaned.length + separator.length + item.value.length + (item.value.endsWith(':') ? 0 : 1);
			inputEl?.setSelectionRange(newPos, newPos);
			inputEl?.focus();
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		const items = suggestions();
		if (!showDropdown || items.length === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = (activeIndex + 1) % items.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = (activeIndex - 1 + items.length) % items.length;
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			selectSuggestion(items[activeIndex]);
			activeIndex = 0;
		} else if (e.key === 'Escape') {
			activeIndex = 0;
			inputEl?.blur();
		}
	}
</script>

<div class="mb-5 space-y-3">
	<!-- Search input with autocomplete -->
	<div class="relative flex flex-col sm:flex-row sm:items-center gap-2">
		<span class="text-xs text-muted uppercase tracking-widest hidden sm:inline">Search:</span>
		<div class="relative flex-1 w-full sm:max-w-sm">
			<input
				type="text"
				bind:this={inputEl}
				bind:value={searchQuery}
				placeholder="Search or filter (status:open)…"
				onfocus={() => { focused = true; activeIndex = 0; }}
				onblur={() => { focused = false; activeIndex = 0; }}
				onkeydown={handleKeydown}
				class="w-full bg-surface border border-edge text-secondary text-xs rounded px-3 py-2.5 sm:py-1.5 hover:border-edge-hi focus:border-cyan transition-colors outline-none placeholder:text-muted"
			/>
			{#if showDropdown}
				<div class="absolute z-50 top-full left-0 mt-1 w-full min-w-[200px] bg-surface border border-edge rounded shadow-lg overflow-hidden">
					{#each suggestions() as item, i}
						<button
							type="button"
							class="w-full px-3 py-1.5 text-xs text-left transition-colors {i === activeIndex ? 'bg-cyan/10 text-cyan' : 'text-secondary hover:bg-surface-hi'}"
							onmousedown={(e) => { e.preventDefault(); selectSuggestion(item); }}
							onmouseenter={() => (activeIndex = i)}
						>
							{item.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		{#if searchQuery}
			<button
				onclick={() => (searchQuery = '')}
				class="px-3 py-1.5 text-xs text-muted hover:text-secondary border border-edge hover:border-edge-hi rounded transition-colors self-start"
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

		<ColumnSelector bind:visibleColumns />

		<div class="sm:ml-auto">
			<QueueMonitor />
		</div>
	</div>
</div>
