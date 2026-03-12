<script lang="ts">
	import { page } from '$app/stores';
	import { listActivity } from '$lib/mock/api.js';

	type Activity = Awaited<ReturnType<typeof listActivity>>;

	const ACTION_COLORS: Record<string, string> = {
		'issue.created': 'text-blue',
		'issue.status_changed': 'text-amber',
		'agent.assigned': 'text-purple',
		'session.started': 'text-cyan',
		'comment.added': 'text-secondary',
		'pr.created': 'text-green'
	};

	let entries = $state<Activity>([]);
	let projectId = $derived($page.params.projectId);

	// Decision: no AbortController — same trade-off as other route pages. Mock delay is short.
	$effect(() => {
		listActivity(projectId).then((data) => (entries = data));
	});
</script>

<div class="p-8">
	<div class="mb-8">
		<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Activity</h1>
		<p class="text-secondary text-sm mt-1">Audit trail — most recent first.</p>
	</div>

	<div class="flex flex-col max-w-2xl">
		{#each entries as entry (entry.id)}
			<div class="flex gap-4 py-3 border-b border-edge last:border-0">
				<span class="text-xs {ACTION_COLORS[entry.action] ?? 'text-muted'} w-40 flex-shrink-0 pt-0.5">
					{entry.action}
				</span>
				<div class="flex-1 min-w-0">
					<span class="text-secondary text-xs">{entry.actor_type}</span>
					{#if entry.actor_id}
						<span class="text-muted text-xs"> / {entry.actor_id}</span>
					{/if}
					{#if entry.issue_id}
						<span class="text-muted text-xs"> on {entry.issue_id}</span>
					{/if}
				</div>
				<span class="text-muted text-xs flex-shrink-0">
					{entry.created_at.slice(0, 16).replace('T', ' ')}
				</span>
			</div>
		{:else}
			<p class="text-muted text-sm">No activity yet.</p>
		{/each}
	</div>
</div>
