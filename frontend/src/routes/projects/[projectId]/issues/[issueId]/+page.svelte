<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { getIssue, updateIssue, listActivity, getProject, listIssueRuns, addComment, editComment, deleteComment, getGlobalConfig, type IssueWithDetails, type ActivityLog, type Project, type Comment, type AgentRun, type AgentRunEvent } from '$lib/api/http.js';
	import { createFormState } from '$lib/utils/form.svelte.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';
	import { md } from '$lib/utils/markdown.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { createRunEventHandlers } from '$lib/utils/run-events.svelte.js';
	import IssueSidebar from '$lib/components/IssueSidebar.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import IssueTimeline from '$lib/components/IssueTimeline.svelte';
	import RunDetailModal from '$lib/components/RunDetailModal.svelte';
	import DispatchInput from '$lib/components/DispatchInput.svelte';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let issue = $state<IssueWithDetails | null>(null);
	let project = $state<Project | null>(null);
	let globalConfig = $state<{ maxChainDepth: number } | undefined>();
	let loading = $state(true);
	let projectId = $derived($page.params.projectId!);
	let issueId = $derived($page.params.issueId!);
	let pageTitle = $derived.by(() => {
		if (issue?.title && project?.name) return `${issue.title} - ${project.name} - CrewDeck`;
		if (issue?.title) return `${issue.title} - CrewDeck`;
		return 'CrewDeck';
	});

	const editForm = createFormState({ title: '', description: '' });
	let activeTab = $state<'description' | 'timeline'>('description');

	let activityEntries = $state<ActivityLog[]>([]);
	let activityLoading = $state(true);

	let runs = $state<AgentRun[]>([]);
	let runsLoading = $state(true);
	let liveEvents = $state<Map<string, AgentRunEvent[]>>(new Map());

	// Comment edit/delete state
	let editingCommentId = $state<string | null>(null);
	let editingCommentText = $state('');
	let deletingCommentId = $state<string | null>(null);
	let commentWorking = $state(false);
	let posting = $state(false);

	// Run detail modal
	let modalRun = $state<AgentRun | null>(null);

	fetchEffect(
		() => Promise.all([getIssue(projectId, issueId), getProject(projectId)]),
		{
			onData: ([d, p]) => { issue = d; project = p; },
			onError: () => { issue = null; },
			onLoading: (v) => { loading = v; },
		}
	);

	fetchEffect(
		() => listActivity(projectId, { issue_id: issueId, limit: 200 }),
		{
			onData: (entries) => { activityEntries = entries; },
			onLoading: (v) => { activityLoading = v; },
		}
	);

	fetchEffect(
		() => listIssueRuns(projectId, issueId),
		{
			onData: (r) => { runs = r; },
			onLoading: (v) => { runsLoading = v; },
		}
	);

	fetchEffect(
		() => getGlobalConfig(),
		{
			onData: (cfg) => { globalConfig = cfg; },
			onError: () => {},
			onLoading: () => {},
		}
	);

	// Keep modal run status in sync with updated runs
	$effect(() => {
		if (!modalRun) return;
		const updated = runs.find(r => r.id === modalRun!.id);
		if (updated && updated.status !== modalRun!.status) {
			modalRun = updated;
		}
	});

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
		const reloadRuns = () => {
			listIssueRuns(projectId, issueId).then((r) => { runs = r; }).catch(() => {});
		};

		const { handleRunStarted, handleRunEvent, handleRunCompleted } = createRunEventHandlers(
			issueId, projectId,
			() => runs, (r) => { runs = r; },
			() => liveEvents, (m) => { liveEvents = m; }
		);

		const handlePausedResumed = (data: { issue_id: string }) => {
			if (data.issue_id === issueId) reloadIssue();
		};

		const unsubs = [
			ws.on('issue.updated', reloadIssue),
			ws.on('issue.status_changed', reloadIssue),
			ws.on('issue.paused', handlePausedResumed),
			ws.on('issue.resumed', handlePausedResumed),
			ws.on('comment.added', reloadIssue),
			ws.on('comment.updated', reloadIssue),
			ws.on('comment.deleted', reloadIssue),
			ws.on('pr.created', reloadIssue),
			ws.on('pr.status_changed', reloadIssue),
			ws.on('mention.spawned', () => { reloadActivity(); reloadRuns(); }),
			ws.on('mention.completed', () => { reloadIssue(); reloadActivity(); reloadRuns(); }),
			ws.on('issue.status_changed', reloadActivity),
			ws.on('comment.added', reloadActivity),
			ws.on('pr.created', reloadActivity),
			ws.on('run.started', handleRunStarted),
			ws.on('run.event', handleRunEvent),
			ws.on('run.completed', handleRunCompleted)
		];
		return () => unsubs.forEach(fn => fn());
	});

	async function handleEditSave() {
		if (!issue) return;
		await editForm.submit(async (f) => {
			await updateIssue(projectId, issueId, { title: f.title, description: f.description });
			issue = { ...issue!, title: f.title, description: f.description };
		});
	}

	function openEdit() {
		if (!issue) return;
		editForm.show({ title: issue.title, description: issue.description ?? '' });
	}

	async function postComment(text: string) {
		posting = true;
		try {
			const c = await addComment(projectId, issueId, { content: text });
			issue = { ...issue!, comments: [...issue!.comments, c] };
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to post comment', 'error');
		} finally {
			posting = false;
		}
	}

	function startEditComment(comment: Comment) {
		editingCommentId = comment.id;
		editingCommentText = comment.content;
	}

	async function saveEditComment() {
		if (!editingCommentId || !editingCommentText.trim()) return;
		commentWorking = true;
		try {
			const updated = await editComment(projectId, issueId, editingCommentId, { content: editingCommentText });
			issue = { ...issue!, comments: issue!.comments.map(x => x.id === updated.id ? updated : x) };
			editingCommentId = null;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to edit comment', 'error');
		} finally {
			commentWorking = false;
		}
	}

	async function confirmDeleteComment() {
		if (!deletingCommentId) return;
		commentWorking = true;
		try {
			await deleteComment(projectId, issueId, deletingCommentId);
			issue = { ...issue!, comments: issue!.comments.filter(x => x.id !== deletingCommentId) };
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to delete comment', 'error');
		} finally {
			deletingCommentId = null;
			commentWorking = false;
		}
	}

	const timelineCount = $derived(
		(issue?.comments?.length ?? 0) +
		activityEntries.filter(a => a.action !== 'comment.added').length
	);
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

{#if loading}
	<div class="p-4 md:p-6 max-w-6xl fade-up pt-14 md:pt-6">
		<div class="mb-6"><div class="skeleton h-3 w-24 rounded"></div></div>
		<div class="flex flex-col lg:grid lg:grid-cols-[1fr_288px] gap-5">
			<div class="bg-surface border border-edge rounded overflow-hidden">
				<div class="flex border-b border-edge gap-1 px-1 pt-1">
					{#each [80, 100] as w}<div class="skeleton h-8 rounded-t" style="width: {w}px"></div>{/each}
				</div>
				<div class="p-4 md:p-6 flex flex-col gap-4">
					<div class="skeleton h-6 w-3/4 rounded"></div>
					{#each [100, 90, 95, 70, 85] as pct}<div class="skeleton h-4 rounded" style="width: {pct}%"></div>{/each}
				</div>
			</div>
			<div class="flex flex-col gap-4">
				<div class="bg-surface border border-edge rounded p-4 flex flex-col gap-3">
					{#each Array(6) as _}<div class="flex items-center gap-2"><div class="skeleton h-3 w-20 rounded"></div><div class="skeleton h-4 w-24 rounded"></div></div>{/each}
				</div>
			</div>
		</div>
	</div>
{:else if !issue}
	<div class="p-4 md:p-8 pt-14 md:pt-8">
		<p class="text-muted text-sm">Issue not found.</p>
		<a href="/projects/{projectId}" class="text-cyan text-xs mt-2 inline-block hover:underline">&larr; Back to Board</a>
	</div>
{:else}
	<div class="p-4 md:p-6 max-w-6xl fade-up pt-14 md:pt-6">
		<div class="mb-4 md:mb-6">
			<Breadcrumb segments={[
				{ label: 'Projects', href: '/' },
				{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
				{ label: 'Issues', href: `/projects/${projectId}` },
				{ label: issue.title }
			]} />
		</div>

		<div class="flex flex-col lg:grid lg:grid-cols-[1fr_288px] gap-5">
			<div class="bg-surface border border-edge rounded overflow-hidden order-1 lg:order-none">
				<div class="flex border-b border-edge text-xs">
					<button onclick={() => activeTab = 'description'} class="flex-1 sm:flex-initial px-4 py-3 sm:py-2.5 border-b-2 transition-colors min-h-[44px] sm:min-h-0 {activeTab === 'description' ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-secondary'}">Description</button>
					<button onclick={() => activeTab = 'timeline'} class="flex-1 sm:flex-initial px-4 py-3 sm:py-2.5 border-b-2 transition-colors min-h-[44px] sm:min-h-0 {activeTab === 'timeline' ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-secondary'}">Timeline ({timelineCount})</button>
				</div>

				<div class="p-4 md:p-6">
					{#if activeTab === 'description'}
						{#if editForm.open}
							<div class="flex flex-col gap-3">
								<input bind:value={editForm.fields.title} class="bg-base border border-edge rounded px-3 py-3 sm:py-2 text-primary text-sm w-full focus:border-cyan focus:outline-none" placeholder="Title" />
								<textarea bind:value={editForm.fields.description} rows={10} class="bg-base border border-edge rounded px-3 py-3 sm:py-2 text-secondary text-sm sm:text-xs w-full focus:border-cyan focus:outline-none resize-y" placeholder="Description (Markdown supported)"></textarea>
								{#if editForm.error}
									<p class="text-red text-xs">{editForm.error}</p>
								{/if}
								<div class="flex gap-2">
									<button onclick={handleEditSave} disabled={editForm.submitting} class="px-4 py-2.5 sm:py-1.5 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0">Save</button>
									<button onclick={() => editForm.close()} class="px-4 py-2.5 sm:py-1.5 text-xs border border-edge text-muted rounded hover:text-secondary transition-colors min-h-[44px] sm:min-h-0">Cancel</button>
								</div>
							</div>
						{:else}
							<h1 class="text-lg font-bold text-primary mb-5">{issue.title}</h1>
							{#if issue.description}
								<div class="issue-prose text-secondary text-sm leading-relaxed">{@html md(issue.description)}</div>
							{:else}
								<p class="text-muted text-sm italic">No description.</p>
							{/if}
						{/if}

					{:else if activeTab === 'timeline'}
						<IssueTimeline
							comments={issue.comments}
							{activityEntries}
							{runs}
							{liveEvents}
							{projectId}
							{issueId}
							loading={activityLoading && runsLoading}
							{editingCommentId}
							bind:editingCommentText
							{commentWorking}
							onStartEditComment={startEditComment}
							onSaveEditComment={saveEditComment}
							onCancelEditComment={() => { editingCommentId = null; }}
							onDeleteComment={(id) => { deletingCommentId = id; }}
							onOpenRunModal={(run) => { modalRun = run; }}
						/>

						<DispatchInput {posting} onSubmit={postComment} />
					{/if}
				</div>
			</div>

			<div class="order-first lg:order-none">
				<IssueSidebar
					{issue}
					{project}
					{projectId}
					{globalConfig}
					onStatusChange={() => { getIssue(projectId, issueId).then(d => { issue = d; }).catch((err) => { toastStore.add(err instanceof Error ? err.message : 'Failed to refresh issue', 'error'); }); }}
					onEdit={openEdit}
				/>
			</div>
		</div>
	</div>
{/if}

<Modal open={deletingCommentId !== null} onClose={() => deletingCommentId = null} label="Delete comment" maxWidth="max-w-sm">
	<h2 class="text-lg font-semibold text-primary mb-2">Delete this comment?</h2>
	<p class="text-sm text-secondary mb-6">This action cannot be undone.</p>
	<div class="flex gap-3 justify-end">
		<button onclick={() => deletingCommentId = null} class="px-4 py-2 text-sm border border-edge text-secondary rounded hover:text-primary transition-colors">Cancel</button>
		<button onclick={confirmDeleteComment} disabled={commentWorking} class="px-4 py-2 text-sm bg-red text-white rounded hover:bg-red/80 transition-colors disabled:opacity-50">Delete</button>
	</div>
</Modal>

<RunDetailModal
	run={modalRun}
	{liveEvents}
	onClose={() => { modalRun = null; }}
/>

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
