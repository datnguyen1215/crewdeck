<script lang="ts">
	import { page } from '$app/stores';
	import { getIssue } from '$lib/mock/api.js';

	type Issue = Awaited<ReturnType<typeof getIssue>>;

	let issue = $state<Issue | null>(null);
	let projectId = $derived($page.params.projectId);
	let issueId = $derived($page.params.issueId);

	$effect(() => {
		getIssue(projectId, issueId).then((data) => (issue = data));
	});
</script>

<div class="p-8 max-w-3xl">
	{#if issue}
		<div class="mb-2">
			<a href="/projects/{projectId}" class="text-muted text-xs hover:text-secondary transition-colors">
				← Board
			</a>
		</div>

		<h1 class="text-xl font-bold text-primary mt-4 mb-2">{issue.title}</h1>

		<div class="flex items-center gap-3 mb-6">
			<span class="text-xs text-muted uppercase tracking-widest border border-edge px-2 py-0.5 rounded">
				{issue.status}
			</span>
			{#if issue.assigned_agent}
				<span class="text-xs text-secondary">→ {issue.assigned_agent.name}</span>
			{/if}
		</div>

		<p class="text-secondary text-sm leading-relaxed mb-8">{issue.description}</p>

		{#if issue.comments.length > 0}
			<div class="border-t border-edge pt-6">
				<h2 class="text-sm font-semibold text-muted uppercase tracking-widest mb-4">Comments</h2>
				<div class="flex flex-col gap-4">
					{#each issue.comments as comment (comment.id)}
						<div class="bg-surface border border-edge rounded p-4">
							<div class="flex items-center gap-2 mb-2">
								<span class="text-xs text-cyan">{comment.author_type}</span>
								{#if comment.author_id}
									<span class="text-xs text-muted">/ {comment.author_id}</span>
								{/if}
								<span class="text-xs text-muted ml-auto">{comment.created_at.slice(0, 16).replace('T', ' ')}</span>
							</div>
							<p class="text-secondary text-sm whitespace-pre-wrap">{comment.content}</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{:else}
		<p class="text-muted text-sm">Loading...</p>
	{/if}
</div>
