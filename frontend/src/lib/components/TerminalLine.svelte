<script lang="ts">
	import type { TerminalLine } from '$lib/config/terminal.js';

	let {
		line,
		isNew,
		issueTitle,
		projectId,
		truncateTitle
	}: {
		line: TerminalLine;
		isNew: boolean;
		issueTitle: string | undefined;
		projectId: string;
		truncateTitle: (title: string, maxLength?: number) => string;
	} = $props();

	const severityColors = {
		info: 'text-secondary border-edge',
		success: 'text-green border-green/30',
		error: 'text-red border-red/30',
		warning: 'text-amber border-amber/30',
		started: 'text-cyan border-cyan/30'
	} as const;

	const colors = $derived(severityColors[line.severity]);
</script>

<div
	class="text-xs font-mono leading-relaxed border-l-2 pl-2 py-0.5 transition-all {colors}"
	class:new-entry={isNew}
	style={isNew ? 'animation: entry-slide-in 150ms ease-out, entry-glow 1s ease-out' : ''}
>
	<span class="text-muted">[{line.timestamp}]</span>
	{#if issueTitle && line.issueId}
		<a
			href="/projects/{projectId}/issues/{line.issueId}"
			class="text-secondary/80 hover:text-cyan hover:underline transition-colors"
			title={issueTitle}
			data-sveltekit-preload-data
		>
			{truncateTitle(issueTitle)}
		</a>
		<span class="text-muted"> › </span>
	{/if}
	<span>{line.message}</span>
</div>
