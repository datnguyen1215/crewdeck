<script lang="ts">
	type Segment = { label: string; href?: string };

	let { segments }: { segments: Segment[] } = $props();
</script>

<nav class="flex items-center gap-1.5 text-xs" aria-label="Breadcrumb">
	{#each segments as segment, i}
		{#if i > 0}
			<span class="text-muted">/</span>
		{/if}
		{#if segment.href && i < segments.length - 1}
			<a href={segment.href} class="text-muted hover:text-cyan transition-colors">{segment.label}</a>
		{:else}
			<span class="text-secondary">{segment.label}</span>
		{/if}
	{/each}
</nav>
