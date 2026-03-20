<script lang="ts">
	let { details }: { details: Record<string, unknown> } = $props();
</script>

{#if details.text}
	<p class="text-primary">"{details.text}"</p>
{/if}
{#if details.content_preview}
	<p class="text-primary">"{details.content_preview}"</p>
{/if}
{#if details.reasoning}
	<p class="whitespace-pre-wrap">{details.reasoning}</p>
{/if}
{#if details.verdict}
	<p class="mt-1 {details.verdict === 'approved' ? 'text-green' : 'text-amber'}">Verdict: {details.verdict}</p>
{/if}
{#if details.message}
	<p class="mt-1">{details.message}</p>
{/if}
{#if details.reason}
	<p class="text-muted mt-1">Reason: {details.reason}</p>
{/if}
{#if details.branch}
	<p class="text-muted mt-1">Branch: {details.branch}</p>
{/if}
{#if details.note}
	<p class="text-muted mt-1">{details.note}</p>
{/if}
