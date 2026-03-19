<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { getIssue, updateIssue, listSessions, listActivity, type IssueWithDetails, type ActivityLog } from '$lib/api/http.js';
	import { relTime } from '$lib/utils/time.js';
	import { md } from '$lib/utils/markdown.js';
	import { ACTOR_CFG, actorName, actionLabel, hasExpandableDetails } from '$lib/activity.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import Terminal from '$lib/components/Terminal.svelte';
	import IssueComments from '$lib/components/IssueComments.svelte';
	import IssueSidebar from '$lib/components/IssueSidebar.svelte';

	type Issue = IssueWithDetails;

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let issue = $state<Issue | null>(null);
	let loading = $state(true);
	let projectId = $derived($page.params.projectId!);
	let issueId = $derived($page.params.issueId!);

	// Action states
	let showEditForm = $state(false);
	let working = $state(false);

	// Edit form
	let editTitle = $state('');
	let editDescription = $state('');

	// Tab navigation
	let activeTab = $state<'description' | 'comments' | 'activity' | 'terminal'>('description');

	// Activity timeline
	let activityEntries = $state<ActivityLog[]>([]);
	let activityLoading = $state(true);
	let activityExpanded = $state<Set<string>>(new Set());

	// Terminal session state
	let activeSessionId = $state<string | null>(null);
	let sessionAgentName = $state('Agent');
	let sessionStatus = $state<'running' | 'completed' | 'idle'>('idle');

	$effect(() => {
		let cancelled = false;
		loading = true;
		getIssue(projectId, issueId)
			.then((d) => {
				if (cancelled) return;
				issue = d;

				// After setting issue, load active session
				listSessions(projectId, { issue_id: issueId, status: 'running' })
					.then((sessions) => {
						if (cancelled) return;
						if (sessions.length > 0) {
							activeSessionId = sessions[0].id;
							sessionStatus = 'running';
							// Try to find agent name from issue_agents
							const agentId = sessions[0].agent_id;
							const ia = d.issue_agents?.find((a: any) => a.agent_id === agentId);
							sessionAgentName = ia?.agent?.name ?? 'Agent';
						} else {
							activeSessionId = null;
							sessionStatus = 'idle';
						}
					})
					.catch(() => {});
			})
			.catch(() => { if (!cancelled) issue = null; })
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	// Fetch activity for this issue
	$effect(() => {
		activityLoading = true;
		let cancelled = false;
		listActivity(projectId, { issue_id: issueId, limit: 200 })
			.then((entries) => { if (!cancelled) activityEntries = entries; })
			.catch(() => {})
			.finally(() => { if (!cancelled) activityLoading = false; });
		return () => { cancelled = true; };
	});

	// WebSocket real-time updates
	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reloadIssue = () => {
			getIssue(projectId, issueId).then((d) => { issue = d; }).catch(() => {});
		};
		const reloadActivity = () => {
			listActivity(projectId, { issue_id: issueId, limit: 200 })
				.then((entries) => { activityEntries = entries; })
				.catch(() => {});
		};
		const unsubs = [
			ws.on('issue.updated', reloadIssue),
			ws.on('issue.status_changed', reloadIssue),
			ws.on('issue.approved', reloadIssue),
			ws.on('comment.added', reloadIssue),
			ws.on('comment.updated', reloadIssue),
			ws.on('comment.deleted', reloadIssue),
			ws.on('review.completed', reloadIssue),
			ws.on('pr.created', reloadIssue),
			ws.on('pr.status_changed', reloadIssue),
			ws.on('session.started', (data) => {
				if (data.issue_id === issueId) {
					activeSessionId = data.session_id as string;
					sessionStatus = 'running';
					const ia = issue?.issue_agents?.find((a: any) => a.agent_id === data.agent_id);
					sessionAgentName = ia?.agent?.name ?? 'Agent';
				}
			}),
			ws.on('session.ended', (data) => {
				if (data.session_id === activeSessionId) {
					sessionStatus = 'completed';
				}
			}),
			ws.on('issue.status_changed', reloadActivity),
			ws.on('issue.assigned', reloadActivity),
			ws.on('comment.added', reloadActivity),
			ws.on('session.started', reloadActivity),
			ws.on('session.ended', reloadActivity),
			ws.on('orchestrator.decision', reloadActivity),
			ws.on('review.completed', reloadActivity),
			ws.on('agent.finished', reloadActivity),
			ws.on('agent.error', reloadActivity),
			ws.on('agent.needs_help', reloadActivity),
			ws.on('pr.created', reloadActivity),
		];
		return () => unsubs.forEach(fn => fn());
	});

	async function handleEditSave() {
		if (!issue) return;
		working = true;
		try {
			await updateIssue(projectId, issueId, { title: editTitle, description: editDescription });
			issue = { ...issue, title: editTitle, description: editDescription };
			showEditForm = false;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to save changes', 'error');
		} finally {
			working = false;
		}
	}

	function openEdit() {
		if (!issue) return;
		editTitle = issue.title;
		editDescription = issue.description ?? '';
		showEditForm = true;
	}

	function toggleActivityExpand(id: string) {
		const next = new Set(activityExpanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		activityExpanded = next;
	}

</script>

{#if loading}
	<!-- Skeleton issue detail while data loads -->
	<div class="p-6 max-w-6xl fade-up">
		<!-- Back link skeleton -->
		<div class="mb-6">
			<div class="skeleton h-3 w-24 rounded"></div>
		</div>
		<div class="grid lg:grid-cols-[1fr_288px] gap-5">
			<!-- Left: content skeleton -->
			<div class="bg-surface border border-edge rounded overflow-hidden">
				<!-- Tabs skeleton -->
				<div class="flex border-b border-edge gap-1 px-1 pt-1">
					{#each [80, 100, 70] as w}
						<div class="skeleton h-8 rounded-t" style="width: {w}px"></div>
					{/each}
				</div>
				<div class="p-6 flex flex-col gap-4">
					<div class="skeleton h-6 w-3/4 rounded"></div>
					<div class="flex flex-col gap-2">
						{#each [100, 90, 95, 70, 85] as pct}
							<div class="skeleton h-4 rounded" style="width: {pct}%"></div>
						{/each}
					</div>
					<div class="mt-4 flex flex-col gap-2">
						{#each [60, 80, 55] as pct}
							<div class="skeleton h-4 rounded" style="width: {pct}%"></div>
						{/each}
					</div>
				</div>
			</div>
			<!-- Right: sidebar skeleton -->
			<div class="flex flex-col gap-4">
				<div class="bg-surface border border-edge rounded p-4 flex flex-col gap-3">
					{#each Array(6) as _}
						<div class="flex items-center gap-2">
							<div class="skeleton h-3 w-20 rounded"></div>
							<div class="skeleton h-4 w-24 rounded"></div>
						</div>
					{/each}
				</div>
				<div class="bg-surface border border-edge rounded p-4">
					<div class="skeleton h-3 w-16 rounded mb-3"></div>
					<div class="flex flex-col gap-2">
						{#each Array(2) as _}
							<div class="skeleton h-8 w-full rounded"></div>
						{/each}
					</div>
				</div>
			</div>
		</div>
	</div>
{:else if !issue}
	<div class="p-8">
		<p class="text-muted text-sm">Issue not found.</p>
		<a href="/projects/{projectId}" class="text-cyan text-xs mt-2 inline-block hover:underline">&larr; Back to Board</a>
	</div>
{:else}
	<div class="p-6 max-w-6xl fade-up">
		<!-- Back link -->
		<div class="mb-6">
			<a href="/projects/{projectId}" class="text-muted text-xs hover:text-secondary transition-colors">&larr; Back to Board</a>
		</div>

		<!-- Main grid: content + sidebar -->
		<div class="grid lg:grid-cols-[1fr_288px] gap-5">
			<!-- Left: tabbed content -->
			<div class="bg-surface border border-edge rounded overflow-hidden">
				<!-- Tab nav -->
				<div class="flex border-b border-edge text-xs">
					<button
						onclick={() => activeTab = 'description'}
						class="px-4 py-2.5 border-b-2 transition-colors {activeTab === 'description' ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-secondary'}"
					>Description</button>
					<button
						onclick={() => activeTab = 'comments'}
						class="px-4 py-2.5 border-b-2 transition-colors {activeTab === 'comments' ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-secondary'}"
					>Comments ({issue.comments.length})</button>
					<button
						onclick={() => activeTab = 'activity'}
						class="px-4 py-2.5 border-b-2 transition-colors {activeTab === 'activity' ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-secondary'}"
					>Activity ({activityEntries.length})</button>
					<button
						onclick={() => activeTab = 'terminal'}
						class="px-4 py-2.5 border-b-2 transition-colors flex items-center gap-1.5 {activeTab === 'terminal' ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-secondary'}"
					>
						Terminal
						{#if sessionStatus === 'running'}
							<span class="inline-block w-1.5 h-1.5 rounded-full bg-green animate-pulse"></span>
						{/if}
					</button>
				</div>

				<!-- Tab content -->
				<div class="p-6">
					{#if activeTab === 'description'}
						{#if showEditForm}
							<div class="flex flex-col gap-3">
								<input
									bind:value={editTitle}
									class="bg-base border border-edge rounded px-3 py-2 text-primary text-sm w-full focus:border-cyan focus:outline-none"
									placeholder="Title"
								/>
								<textarea
									bind:value={editDescription}
									rows={10}
									class="bg-base border border-edge rounded px-3 py-2 text-secondary text-xs w-full focus:border-cyan focus:outline-none resize-none"
									placeholder="Description (Markdown supported)"
								></textarea>
								<div class="flex gap-2">
									<button
										onclick={handleEditSave}
										disabled={working}
										class="px-3 py-1.5 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 transition-colors"
									>Save</button>
									<button
										onclick={() => showEditForm = false}
										class="px-3 py-1.5 text-xs border border-edge text-muted rounded hover:text-secondary transition-colors"
									>Cancel</button>
								</div>
							</div>
						{:else}
							<h1 class="text-lg font-bold text-primary mb-5">{issue.title}</h1>
							{#if issue.description}
								<div class="issue-prose text-secondary text-sm leading-relaxed">
									{@html md(issue.description)}
								</div>
							{:else}
								<p class="text-muted text-sm italic">No description.</p>
							{/if}
						{/if}

					{:else if activeTab === 'comments'}
						<IssueComments
							comments={issue.comments}
							issueAgents={issue.issue_agents}
							{projectId}
							{issueId}
							onCommentAdded={(c) => { issue = { ...issue!, comments: [...issue!.comments, c] }; }}
							onCommentUpdated={(c) => { issue = { ...issue!, comments: issue!.comments.map(x => x.id === c.id ? c : x) }; }}
							onCommentDeleted={(id) => { issue = { ...issue!, comments: issue!.comments.filter(x => x.id !== id) }; }}
						/>

					{:else if activeTab === 'activity'}
						{#if activityLoading}
							<div class="flex flex-col gap-3">
								{#each Array(5) as _, i}
									<div class="flex gap-3 animate-pulse" style="animation-delay: {i * 50}ms">
										<div class="skeleton w-5 h-5 rounded-full shrink-0"></div>
										<div class="flex-1">
											<div class="skeleton h-3 w-24 rounded mb-1"></div>
											<div class="skeleton h-4 w-3/4 rounded"></div>
										</div>
									</div>
								{/each}
							</div>
						{:else if activityEntries.length === 0}
							<p class="text-muted text-sm py-8 text-center">No activity yet.</p>
						{:else}
							<div class="relative">
								<div class="absolute left-[9px] top-2 bottom-0 w-px bg-edge pointer-events-none"></div>
								<div class="flex flex-col">
									{#each activityEntries as entry, i (entry.id)}
										{@const acfg = ACTOR_CFG[entry.actor_type] ?? ACTOR_CFG.system}
										{@const details = (entry.details as Record<string, unknown>) ?? {}}
										{@const expandable = hasExpandableDetails(entry)}
										{@const isExp = activityExpanded.has(entry.id)}
										<div class="flex gap-3 pb-4 relative" style="animation: fade-up 0.2s ease both; animation-delay: {Math.min(i * 25, 200)}ms">
											<div class="flex-shrink-0 w-5 flex justify-center pt-0.5 relative z-10">
												<div class="w-5 h-5 rounded-full bg-base border border-edge flex items-center justify-center">
													<span class="text-[9px] leading-none {acfg.color}">{acfg.icon}</span>
												</div>
											</div>
											<div class="flex-1 min-w-0 pt-0.5">
												<div class="flex items-center gap-2 mb-0.5 flex-wrap">
													<span class="text-xs font-semibold {acfg.color}">{actorName(entry)}</span>
													<span class="text-muted text-xs font-mono" title={new Date(entry.created_at).toLocaleString()}>
														{relTime(entry.created_at)}
													</span>
												</div>
												<p class="text-secondary text-sm">{actionLabel(entry)}</p>
												{#if expandable}
													<button
														onclick={() => toggleActivityExpand(entry.id)}
														class="mt-1 text-xs text-muted hover:text-secondary transition-colors flex items-center gap-1"
													>
														<span class="font-mono text-[10px]">{isExp ? '\u25BE' : '\u25B8'}</span>
														<span>{isExp ? 'Hide' : 'Details'}</span>
													</button>
													{#if isExp}
														<div class="mt-1.5 p-2 bg-base-hi border border-edge rounded text-xs text-secondary font-mono leading-relaxed">
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
														</div>
													{/if}
												{/if}
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}

					{:else if activeTab === 'terminal'}
						{#if activeSessionId}
							<Terminal sessionId={activeSessionId} agentName={sessionAgentName} status={sessionStatus} />
						{:else}
							<div class="flex flex-col items-center justify-center py-16 gap-3 text-center">
								<span class="text-3xl text-muted opacity-40">{'\u2B1B'}</span>
								<p class="text-muted text-sm">No active session</p>
								<p class="text-muted text-xs">An agent terminal will appear here once a session starts.</p>
							</div>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Right: sidebar -->
			<IssueSidebar
				{issue}
				{projectId}
				onApprove={() => { issue = { ...issue!, status: 'open' }; }}
				onEdit={openEdit}
			/>
		</div>

	</div>
{/if}

<style>
	:global(.issue-prose h1) { font-size: 1.05em; font-weight: 700; color: var(--color-primary); margin: 0.6em 0 0.3em; }
	:global(.issue-prose h2) { font-size: 0.95em; font-weight: 700; color: var(--color-primary); margin: 0.6em 0 0.3em; }
	:global(.issue-prose h3) { font-size: 0.9em; font-weight: 600; color: var(--color-primary); margin: 0.4em 0 0.2em; }
	:global(.issue-prose p) { margin: 0.2em 0; }
	:global(.issue-prose br) { display: block; content: ''; margin: 0.3em 0; }
	:global(.issue-prose code) { font-family: var(--font-mono); background: var(--color-surface-hi); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.82em; color: var(--color-cyan); }
	:global(.issue-prose pre) { background: var(--color-surface-hi); border: 1px solid var(--color-edge); border-radius: 4px; padding: 0.75em 1em; margin: 0.5em 0; overflow-x: auto; }
	:global(.issue-prose pre code) { background: none; padding: 0; color: var(--color-secondary); }
	:global(.issue-prose ul) { padding-left: 1.25em; list-style-type: disc; margin: 0.25em 0; }
	:global(.issue-prose ol) { padding-left: 1.25em; list-style-type: decimal; margin: 0.25em 0; }
	:global(.issue-prose li) { margin: 0.15em 0; }
	:global(.issue-prose strong) { color: var(--color-primary); font-weight: 600; }
	:global(.issue-prose em) { font-style: italic; }
	:global(.issue-prose a) { color: var(--color-cyan); text-decoration: underline; }
</style>
