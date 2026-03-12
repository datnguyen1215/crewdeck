<script lang="ts">
	import { page } from '$app/stores';
	import { listIssues } from '$lib/mock/api.js';

	type Issue = Awaited<ReturnType<typeof listIssues>>[number];

	const STATUS_COLS = [
		{ key: 'draft', label: 'Draft', textColor: 'text-muted', borderColor: 'border-edge' },
		{ key: 'open', label: 'Open', textColor: 'text-blue', borderColor: 'border-blue' },
		{ key: 'in_progress', label: 'In Progress', textColor: 'text-amber', borderColor: 'border-amber' },
		{ key: 'in_review', label: 'In Review', textColor: 'text-purple', borderColor: 'border-purple' },
		{ key: 'feedback', label: 'Feedback', textColor: 'text-red', borderColor: 'border-red' },
		{ key: 'ready', label: 'Ready', textColor: 'text-green', borderColor: 'border-green' },
		{ key: 'pr_created', label: 'PR Created', textColor: 'text-cyan', borderColor: 'border-cyan' },
		{ key: 'done', label: 'Done', textColor: 'text-secondary', borderColor: 'border-secondary' }
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
				<div class="flex items-center gap-2 mb-3 pb-2 border-b {col.borderColor}">
					<span class="text-xs font-semibold uppercase tracking-widest {col.textColor}">
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
