<script lang="ts">
	import { page } from '$app/stores';
	import { listIssues } from '$lib/mock/api.js';

	type Issue = Awaited<ReturnType<typeof listIssues>>[number];

	const STATUS_COLS = [
		{ key: 'draft', label: 'Draft', color: 'text-muted border-edge' },
		{ key: 'open', label: 'Open', color: 'text-blue border-blue' },
		{ key: 'in_progress', label: 'In Progress', color: 'text-amber border-amber' },
		{ key: 'in_review', label: 'In Review', color: 'text-purple border-purple' },
		{ key: 'feedback', label: 'Feedback', color: 'text-red border-red' },
		{ key: 'ready', label: 'Ready', color: 'text-green border-green' }
	] as const;

	let issues = $state<Issue[]>([]);
	let projectId = $derived($page.params.projectId);

	$effect(() => {
		listIssues(projectId).then((data) => (issues = data));
	});

	function issuesForStatus(status: string) {
		return issues.filter((i) => i.status === status);
	}
</script>

<div class="p-6 h-full overflow-auto">
	<div class="mb-6">
		<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Issue Board</h1>
		<p class="text-secondary text-sm mt-1">{issues.length} issues</p>
	</div>

	<div class="flex gap-4 min-w-max pb-4">
		{#each STATUS_COLS as col (col.key)}
			<div class="w-64 flex-shrink-0">
				<div class="flex items-center gap-2 mb-3 pb-2 border-b {col.color.split(' ')[1]}">
					<span class="text-xs font-semibold uppercase tracking-widest {col.color.split(' ')[0]}">
						{col.label}
					</span>
					<span class="text-xs text-muted">({issuesForStatus(col.key).length})</span>
				</div>
				<div class="flex flex-col gap-2">
					{#each issuesForStatus(col.key) as issue (issue.id)}
						<a
							href="/projects/{projectId}/issues/{issue.id}"
							class="block p-3 bg-surface border border-edge rounded hover:border-edge-hi hover:bg-surface-hi transition-colors"
						>
							<p class="text-primary text-sm leading-snug">{issue.title}</p>
							{#if issue.assigned_agent_id}
								<p class="text-muted text-xs mt-2">→ {issue.assigned_agent_id}</p>
							{/if}
						</a>
					{:else}
						<p class="text-muted text-xs py-2">—</p>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
