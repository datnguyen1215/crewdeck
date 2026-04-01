<script lang="ts">
	let {
		collapsed,
		filterAgents,
		filterErrors,
		onToggleCollapse,
		onToggleFilterAgents,
		onToggleFilterErrors
	}: {
		collapsed: boolean;
		filterAgents: boolean;
		filterErrors: boolean;
		onToggleCollapse: () => void;
		onToggleFilterAgents: () => void;
		onToggleFilterErrors: () => void;
	} = $props();
</script>

<div
	class="flex items-center justify-between px-4 py-2 bg-surface border-b border-edge cursor-pointer"
	onclick={onToggleCollapse}
	role="button"
	tabindex="0"
	onkeydown={(e) => e.key === 'Enter' && onToggleCollapse()}
	aria-label={collapsed ? 'Expand terminal' : 'Collapse terminal'}
>
	<div class="flex items-center gap-2">
		<span class="text-cyan text-sm font-semibold">▸ Mission Control</span>
	</div>
	<div class="flex items-center gap-2">
		{#if !collapsed}
			<button
				class="px-2 py-0.5 text-xs border border-edge rounded hover:bg-surface-hi transition-colors {filterAgents ? 'bg-cyan/10 border-cyan text-cyan' : 'text-muted'}"
				onclick={(e) => {
					e.stopPropagation();
					onToggleFilterAgents();
				}}
				aria-label="Filter agents only"
			>
				agents
			</button>
			<button
				class="px-2 py-0.5 text-xs border border-edge rounded hover:bg-surface-hi transition-colors {filterErrors ? 'bg-red/10 border-red text-red' : 'text-muted'}"
				onclick={(e) => {
					e.stopPropagation();
					onToggleFilterErrors();
				}}
				aria-label="Filter errors only"
			>
				errors
			</button>
		{/if}
		<span class="text-muted text-xs">{collapsed ? '▸' : '▾'}</span>
	</div>
</div>
