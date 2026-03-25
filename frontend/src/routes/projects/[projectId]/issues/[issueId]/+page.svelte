<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { getIssue, updateIssue, listActivity, getProject, listIssueRuns, getRun, type IssueWithDetails, type ActivityLog, type Project, type Comment, type AgentRun, type AgentRunEvent, type AgentRunWithEvents } from '$lib/api/http.js';
	import { relTime, parseUTC } from '$lib/utils/time.js';
	import { md } from '$lib/utils/markdown.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import type { WsEventMap } from '$lib/api/types.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { createFormState } from '$lib/utils/form.svelte.js';
	import { ACTOR_CFG, actorName, actionLabel, hasExpandableDetails } from '$lib/activity.js';
	import ActivityDetails from '$lib/components/ActivityDetails.svelte';
	import IssueSidebar from '$lib/components/IssueSidebar.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { RUN_STATUS_DOT, RUN_STATUS_CFG } from '$lib/config/status.js';
	import { addComment, editComment, deleteComment, type Agent } from '$lib/api/http.js';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');
	const getAgents = getContext<() => Agent[]>('agents');

	let issue = $state<IssueWithDetails | null>(null);
	let project = $state<Project | null>(null);
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
	let activityExpanded = $state<Set<string>>(new Set());

	// Agent runs for timeline
	let runs = $state<AgentRun[]>([]);
	let runsLoading = $state(true);
	let expandedRun = $state<string | null>(null);
	let expandedEvents = $state<AgentRunEvent[]>([]);
	let loadingEvents = $state(false);
	let liveEvents = $state<Map<string, AgentRunEvent[]>>(new Map());

	// Comment form state
	let commentText = $state('');
	let posting = $state(false);
	let editingCommentId = $state<string | null>(null);
	let editingCommentText = $state('');
	let deletingCommentId = $state<string | null>(null);
	let commentWorking = $state(false);

	// /dispatch autocomplete
	let agents = $derived(getAgents());
	let showMentions = $state(false);
	let mentionFilter = $state('');
	let mentionIdx = $state(0);
	let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);
	const DISPATCH_PREFIX = '/dispatch ';

	const filteredAgents = $derived(
		mentionFilter
			? agents.filter(a => a.name.toLowerCase().includes(mentionFilter.toLowerCase()))
			: agents
	);

	// Timeline types
	type TimelineComment = { type: 'comment'; created_at: string; data: Comment };
	type TimelineActivity = { type: 'activity'; created_at: string; data: ActivityLog };
	type TimelineItem = TimelineComment | TimelineActivity;

	// Build unified timeline
	const timeline = $derived.by(() => {
		const comments = issue?.comments ?? [];
		const items: TimelineItem[] = [
			...comments.map(c => ({ type: 'comment' as const, created_at: c.created_at, data: c })),
			...activityEntries
				.filter(a => a.action !== 'comment.added') // Deduplicate
				.map(a => ({ type: 'activity' as const, created_at: a.created_at, data: a }))
		];
		return items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
	});

	// Match runs to mention.completed activity by agent_id and close timestamps
	function findRunForActivity(activity: ActivityLog): AgentRun | undefined {
		if (activity.action !== 'mention.completed') return undefined;
		const details = activity.details as Record<string, unknown>;
		const agentId = details.agent_id as string | undefined;
		if (!agentId) return undefined;

		const activityTime = parseUTC(activity.created_at).getTime();
		// Find run with matching agent_id and close timestamp (within 60 seconds)
		return runs.find(r => {
			if (r.agent_id !== agentId) return false;
			if (!r.completed_at) return false;
			const runTime = parseUTC(r.completed_at).getTime();
			return Math.abs(runTime - activityTime) < 60000;
		});
	}

	// Match runs to mention.spawned activity by agent_id and started_at timestamp
	function findRunForSpawnedActivity(activity: ActivityLog): AgentRun | undefined {
		if (activity.action !== 'mention.spawned') return undefined;
		const details = activity.details as Record<string, unknown>;
		const agentId = details.agent_id as string | undefined;
		if (!agentId) return undefined;

		const activityTime = parseUTC(activity.created_at).getTime();
		return runs.find(r => {
			if (r.agent_id !== agentId) return false;
			if (!r.started_at) return false;
			const runTime = parseUTC(r.started_at).getTime();
			return Math.abs(runTime - activityTime) < 60000;
		});
	}

	// Run detail modal state
	let viewRunModalOpen = $state(false);
	let viewRunModalRun = $state<AgentRun | null>(null);
	let viewRunModalEvents = $state<AgentRunEvent[]>([]);
	let viewRunModalLoading = $state(false);

	async function openRunModal(run: AgentRun) {
		viewRunModalRun = run;
		viewRunModalOpen = true;
		viewRunModalLoading = true;
		try {
			const full = await getRun(projectId, run.id);
			const apiEvents = full.events;
			const live = liveEvents.get(run.id) ?? [];
			const apiEventIds = new Set(apiEvents.map(e => e.id));
			const newLiveEvents = live.filter(e => !apiEventIds.has(e.id));
			viewRunModalEvents = [...apiEvents, ...newLiveEvents];
		} catch {
			viewRunModalEvents = liveEvents.get(run.id) ?? [];
		} finally {
			viewRunModalLoading = false;
		}
	}

	// Live-update modal events when new run events stream in
	$effect(() => {
		if (!viewRunModalOpen || !viewRunModalRun) return;
		const live = liveEvents.get(viewRunModalRun.id) ?? [];
		if (live.length === 0) return;
		const existingIds = new Set(viewRunModalEvents.map(e => e.id));
		const newEvents = live.filter(e => !existingIds.has(e.id));
		if (newEvents.length > 0) {
			viewRunModalEvents = [...viewRunModalEvents, ...newEvents];
		}
	});

	// Keep modal run status in sync
	$effect(() => {
		if (!viewRunModalOpen || !viewRunModalRun) return;
		const updated = runs.find(r => r.id === viewRunModalRun!.id);
		if (updated && updated.status !== viewRunModalRun!.status) {
			viewRunModalRun = updated;
		}
	});

	$effect(() => {
		let cancelled = false;
		loading = true;
		Promise.all([getIssue(projectId, issueId), getProject(projectId)])
			.then(([d, p]) => { if (!cancelled) { issue = d; project = p; } })
			.catch(() => { if (!cancelled) issue = null; })
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	$effect(() => {
		activityLoading = true;
		let cancelled = false;
		listActivity(projectId, { issue_id: issueId, limit: 200 })
			.then((entries) => { if (!cancelled) activityEntries = entries; })
			.catch(() => {})
			.finally(() => { if (!cancelled) activityLoading = false; });
		return () => { cancelled = true; };
	});

	$effect(() => {
		runsLoading = true;
		let cancelled = false;
		listIssueRuns(projectId, issueId)
			.then((r) => { if (!cancelled) runs = r; })
			.catch(() => {})
			.finally(() => { if (!cancelled) runsLoading = false; });
		return () => { cancelled = true; };
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

		const handleRunStarted = (data: WsEventMap['run.started']) => {
			if (data.issue_id !== issueId) return;
			const newRun: AgentRun = {
				id: data.agent_run_id,
				project_id: projectId,
				issue_id: issueId,
				agent_id: data.agent_id,
				pid: null,
				status: data.status,
				exit_code: null,
				cost_usd: null,
				duration_ms: null,
				started_at: data.started_at,
				completed_at: null,
				created_at: new Date().toISOString()
			};
			runs = [newRun, ...runs];
			liveEvents.set(newRun.id, []);
		};

		const handleRunEvent = (data: WsEventMap['run.event']) => {
			const runId = data.agent_run_id;
			const run = runs.find(r => r.id === runId);
			if (!run || run.issue_id !== issueId) return;

			const event: AgentRunEvent = {
				id: data.event_id,
				agent_run_id: runId,
				type: data.type,
				data: data.data,
				created_at: data.created_at
			};

			const existing = liveEvents.get(runId) ?? [];
			liveEvents.set(runId, [...existing, event]);
			liveEvents = new Map(liveEvents);

			if (expandedRun === runId && !expandedEvents.some(e => e.id === event.id)) {
				expandedEvents = [...expandedEvents, event];
			}
		};

		const handleRunCompleted = (data: WsEventMap['run.completed']) => {
			const runId = data.agent_run_id;
			runs = runs.map(r => {
				if (r.id !== runId) return r;
				return {
					...r,
					status: data.status,
					exit_code: data.exit_code,
					cost_usd: data.cost_usd,
					duration_ms: data.duration_ms,
					completed_at: data.completed_at
				};
			});
		};

		const unsubs = [
			ws.on('issue.updated', reloadIssue),
			ws.on('issue.status_changed', reloadIssue),
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

	function toggleActivityExpand(id: string) {
		const next = new Set(activityExpanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		activityExpanded = next;
	}

	async function toggleRunExpand(runId: string) {
		if (expandedRun === runId) {
			expandedRun = null;
			expandedEvents = [];
			return;
		}

		expandedRun = runId;
		loadingEvents = true;
		try {
			const full = await getRun(projectId, runId);
			const apiEvents = full.events;
			const live = liveEvents.get(runId) ?? [];
			const apiEventIds = new Set(apiEvents.map(e => e.id));
			const newLiveEvents = live.filter(e => !apiEventIds.has(e.id));
			expandedEvents = [...apiEvents, ...newLiveEvents];
		} catch {
			expandedEvents = liveEvents.get(runId) ?? [];
			toastStore.add('Failed to load run events', 'error');
		} finally {
			loadingEvents = false;
		}
	}

	function formatDuration(ms: number | null): string {
		if (ms === null) return '-';
		const secs = Math.round(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remSecs = secs % 60;
		return `${mins}m ${remSecs}s`;
	}

	function formatCost(cost: number | null): string {
		if (cost === null) return '-';
		return `$${cost.toFixed(4)}`;
	}

	function renderEventContent(event: AgentRunEvent): string {
		const data = event.data as Record<string, unknown>;
		switch (event.type) {
			case 'assistant':
				return extractAssistantText(data);
			case 'tool_use':
				return extractToolUse(data);
			case 'tool_result':
				return extractToolResult(data);
			case 'result':
				return (data.result as string)?.slice(0, 100) ?? 'Finished';
			case 'system':
				return extractSystemInfo(data);
			case 'user':
				return extractUserContent(data);
			default:
				return event.type;
		}
	}

	function extractAssistantText(data: Record<string, unknown>): string {
		if (typeof data.text === 'string') return data.text.slice(0, 200);
		if (typeof data.content === 'string') return data.content.slice(0, 200);
		if (Array.isArray(data.content)) {
			const textBlock = data.content.find((c: any) => c.type === 'text');
			if (textBlock?.text) return textBlock.text.slice(0, 200);
			const toolBlock = data.content.find((c: any) => c.type === 'tool_use');
			if (toolBlock?.name) return `Using ${toolBlock.name}`;
		}
		const message = data.message as Record<string, unknown> | undefined;
		if (message && Array.isArray(message.content)) {
			const textBlock = message.content.find((c: any) => c.type === 'text');
			if (textBlock?.text) return (textBlock.text as string).slice(0, 200);
			const toolBlock = message.content.find((c: any) => c.type === 'tool_use');
			if (toolBlock?.name) return `Using ${toolBlock.name}`;
		}
		return 'Text output';
	}

	function extractToolUse(data: Record<string, unknown>): string {
		if (typeof data.name === 'string') {
			const desc = extractToolDescription(data);
			return desc ? `${data.name}: ${desc}` : data.name;
		}
		const message = data.message as Record<string, unknown> | undefined;
		if (message && Array.isArray(message.content)) {
			const toolBlock = message.content.find((c: any) => c.type === 'tool_use');
			if (toolBlock?.name) {
				const desc = extractToolDescription(toolBlock);
				return desc ? `${toolBlock.name}: ${desc}` : toolBlock.name;
			}
		}
		return 'Tool';
	}

	function extractToolDescription(data: Record<string, unknown>): string | null {
		const input = data.input as Record<string, unknown> | undefined;
		if (!input) return null;
		if (typeof input.description === 'string') return input.description.slice(0, 100);
		if (typeof input.command === 'string') return input.command.slice(0, 100);
		if (typeof input.file_path === 'string') return input.file_path;
		if (typeof input.pattern === 'string') return input.pattern;
		if (typeof input.query === 'string') return input.query.slice(0, 100);
		return null;
	}

	function extractToolResult(data: Record<string, unknown>): string {
		let output: string | null = null;
		if (typeof data.content === 'string' && data.content.length > 0) {
			output = data.content;
		}
		if (!output && Array.isArray(data.content)) {
			const textBlock = data.content.find((c: any) => c.type === 'text');
			if (textBlock?.text) output = textBlock.text as string;
		}
		if (output) {
			const sanitized = output.replace(/\n+/g, ' ').trim();
			return `Output: ${sanitized.slice(0, 100)}`;
		}
		return 'Tool completed';
	}

	function extractSystemInfo(data: Record<string, unknown>): string {
		if (typeof data.model === 'string') {
			return `Session started (${data.model})`;
		}
		if (typeof data.subtype === 'string') {
			return data.subtype;
		}
		if (typeof data.message === 'string') {
			return data.message.slice(0, 100);
		}
		const message = data.message as Record<string, unknown> | undefined;
		if (message && Array.isArray(message.content)) {
			const textBlock = message.content.find((c: any) => c.type === 'text');
			if (textBlock?.text) return (textBlock.text as string).slice(0, 100);
		}
		return 'System';
	}

	function extractUserContent(data: Record<string, unknown>): string {
		const message = data.message as Record<string, unknown> | undefined;
		if (message && Array.isArray(message.content)) {
			const toolResult = message.content.find((c: any) => c.type === 'tool_result');
			if (toolResult) {
				const content = toolResult.content;
				if (typeof content === 'string' && content.length > 0) {
					return `Tool result: ${content.slice(0, 100)}`;
				}
				if (Array.isArray(content)) {
					const textBlock = content.find((c: any) => c.type === 'text');
					if (textBlock?.text) return `Tool result: ${(textBlock.text as string).slice(0, 100)}`;
				}
				return 'Tool result';
			}
		}
		if (Array.isArray(data.content)) {
			const toolResult = data.content.find((c: any) => c.type === 'tool_result');
			if (toolResult) {
				const content = toolResult.content;
				if (typeof content === 'string') return `Tool result: ${content.slice(0, 100)}`;
				return 'Tool result';
			}
		}
		return 'User input';
	}

	// Comment functions
	function commentStyle(authorType: string): { border: string; textColor: string } {
		if (authorType === 'system') return { border: 'var(--color-muted)', textColor: 'text-muted' };
		if (authorType === 'user') return { border: 'var(--color-edge-hi)', textColor: 'text-secondary' };
		// Agent types (captain, engineer, lead, etc.) use cyan
		return { border: 'var(--color-cyan)', textColor: 'text-cyan' };
	}

	function commentAuthorLabel(comment: Comment): string {
		if (comment.author_type === 'system') return 'System';
		if (comment.author_type === 'user') return 'User';
		// For agent types, capitalize first letter (captain → Captain)
		return comment.author_type.charAt(0).toUpperCase() + comment.author_type.slice(1);
	}

	async function postComment() {
		if (!commentText.trim()) return;
		posting = true;
		try {
			const c = await addComment(projectId, issueId, { content: commentText });
			issue = { ...issue!, comments: [...issue!.comments, c] };
			commentText = '';
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

	function handleInput(e: Event) {
		const ta = e.target as HTMLTextAreaElement;
		const val = ta.value;
		const pos = ta.selectionStart ?? 0;
		const before = val.slice(0, pos);
		const dispatchIdx = before.lastIndexOf(DISPATCH_PREFIX);
		if (dispatchIdx >= 0 && (dispatchIdx === 0 || /\s/.test(before[dispatchIdx - 1]))) {
			const typed = before.slice(dispatchIdx + DISPATCH_PREFIX.length);
			if (!/\s/.test(typed)) {
				mentionFilter = typed;
				showMentions = true;
				mentionIdx = 0;
				return;
			}
		}
		showMentions = false;
	}

	function selectMention(agent: Agent) {
		if (!textareaEl) return;
		const val = textareaEl.value;
		const pos = textareaEl.selectionStart ?? 0;
		const before = val.slice(0, pos);
		const dispatchIdx = before.lastIndexOf(DISPATCH_PREFIX);
		commentText = val.slice(0, dispatchIdx) + DISPATCH_PREFIX + agent.name + ' ' + val.slice(pos);
		showMentions = false;
		requestAnimationFrame(() => {
			const newPos = dispatchIdx + DISPATCH_PREFIX.length + agent.name.length + 1;
			textareaEl!.selectionStart = newPos;
			textareaEl!.selectionEnd = newPos;
			textareaEl!.focus();
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (showMentions && filteredAgents.length > 0) {
			if (e.key === 'ArrowDown') { e.preventDefault(); mentionIdx = (mentionIdx + 1) % filteredAgents.length; return; }
			if (e.key === 'ArrowUp') { e.preventDefault(); mentionIdx = (mentionIdx - 1 + filteredAgents.length) % filteredAgents.length; return; }
			if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(filteredAgents[mentionIdx]); return; }
			if (e.key === 'Escape') { e.preventDefault(); showMentions = false; return; }
		}
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			postComment();
		}
	}
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
					<button onclick={() => activeTab = 'timeline'} class="flex-1 sm:flex-initial px-4 py-3 sm:py-2.5 border-b-2 transition-colors min-h-[44px] sm:min-h-0 {activeTab === 'timeline' ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-secondary'}">Timeline ({timeline.length})</button>
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
						{#if activityLoading && runsLoading}
							<div class="flex flex-col gap-3">
								{#each Array(5) as _, i}
									<div class="flex gap-3 animate-pulse" style="animation-delay: {i * 50}ms">
										<div class="skeleton w-5 h-5 rounded-full shrink-0"></div>
										<div class="flex-1"><div class="skeleton h-3 w-24 rounded mb-1"></div><div class="skeleton h-4 w-3/4 rounded"></div></div>
									</div>
								{/each}
							</div>
						{:else if timeline.length === 0}
							<p class="text-muted text-sm py-8 text-center">No activity yet.</p>
						{:else}
							<!-- Unified Timeline -->
							<div class="relative mb-6">
								<div class="absolute left-[9px] top-2 bottom-0 w-px bg-edge pointer-events-none"></div>
								<div class="flex flex-col">
									{#each timeline as item, i (item.type === 'comment' ? `c-${item.data.id}` : `a-${item.data.id}`)}
										{#if item.type === 'comment'}
											{@const comment = item.data}
											{@const cs = commentStyle(comment.author_type)}
											<div
												class="flex gap-3 pb-4 relative"
												style="animation: fade-up 0.2s ease both; animation-delay: {Math.min(i * 25, 200)}ms"
											>
												<!-- Comment dot -->
												<div class="flex-shrink-0 w-5 flex justify-center pt-0.5 relative z-10">
													<div
														class="w-5 h-5 rounded-full bg-base border flex items-center justify-center"
														style="border-color: {cs.border}"
													>
														<span class="text-[9px] leading-none {cs.textColor}">
															{#if comment.author_type === 'system'}⚙{:else if comment.author_type === 'user'}○{:else}⬡{/if}
														</span>
													</div>
												</div>

												<!-- Comment content -->
												<div class="flex-1 min-w-0">
													<div
														class="border border-edge rounded-r rounded-tl rounded-bl bg-base p-3"
														style="border-left: 3px solid {cs.border}"
													>
														<div class="flex items-center gap-2 mb-2 flex-wrap">
															<span class="text-xs font-semibold {cs.textColor}">
																{commentAuthorLabel(comment)}
															</span>
															<span class="text-xs text-muted" title={parseUTC(comment.created_at).toLocaleString()}>
																{relTime(comment.created_at)}
															</span>
															{#if comment.author_type === 'user'}
																<div class="ml-auto flex gap-1">
																	<button
																		onclick={() => startEditComment(comment)}
																		class="text-xs text-muted hover:text-secondary transition-colors px-1"
																		title="Edit comment"
																	>edit</button>
																	<button
																		onclick={() => deletingCommentId = comment.id}
																		class="text-xs text-muted hover:text-red transition-colors px-1"
																		title="Delete comment"
																	>delete</button>
																</div>
															{/if}
														</div>
														{#if editingCommentId === comment.id}
															<div class="flex flex-col gap-2">
																<textarea
																	bind:value={editingCommentText}
																	rows={3}
																	class="w-full bg-base border border-edge rounded px-3 py-2 text-secondary text-sm resize-none focus:border-cyan focus:outline-none"
																></textarea>
																<div class="flex gap-2">
																	<button onclick={saveEditComment} disabled={commentWorking || !editingCommentText.trim()} class="px-3 py-1 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 transition-colors">Save</button>
																	<button onclick={() => editingCommentId = null} class="px-3 py-1 text-xs border border-edge text-muted rounded hover:text-secondary transition-colors">Cancel</button>
																</div>
															</div>
														{:else}
															<div class="issue-prose text-secondary text-sm leading-relaxed">
																{@html md(comment.content)}
															</div>
														{/if}
													</div>
												</div>
											</div>
										{:else}
											{@const entry = item.data}
											{@const cfg = ACTOR_CFG[entry.actor_type] ?? ACTOR_CFG.system}
											{@const details = (entry.details as Record<string, unknown>) ?? {}}
											{@const expandable = hasExpandableDetails(entry)}
											{@const isExp = activityExpanded.has(entry.id)}
											{@const matchedRun = findRunForActivity(entry)}
											{@const spawnedRun = findRunForSpawnedActivity(entry)}
											<div
												class="flex gap-3 pb-4 relative"
												style="animation: fade-up 0.2s ease both; animation-delay: {Math.min(i * 25, 200)}ms"
											>
												<!-- Actor dot -->
												<div class="flex-shrink-0 w-5 flex justify-center pt-0.5 relative z-10">
													<div class="w-5 h-5 rounded-full bg-base border border-edge flex items-center justify-center">
														<span class="text-[9px] leading-none {cfg.color}">{cfg.icon}</span>
													</div>
												</div>

												<!-- Activity content -->
												<div class="flex-1 min-w-0 pt-0.5">
													<div class="flex items-center gap-2 mb-0.5 flex-wrap">
														<span class="text-xs font-semibold {cfg.color}">{actorName(entry)}</span>
														{#if spawnedRun}
															{@const dotCfg = RUN_STATUS_DOT[spawnedRun.status] ?? RUN_STATUS_DOT.queued}
															<span class="text-[10px] {dotCfg.class}" class:animate-pulse={dotCfg.pulse} title={spawnedRun.status}>{dotCfg.dot}</span>
														{/if}
														<span class="text-muted text-xs font-mono" title={parseUTC(entry.created_at).toLocaleString()}>
															{relTime(entry.created_at)}
														</span>
													</div>

													<p class="text-secondary text-sm">{actionLabel(entry)}</p>


													<!-- View Run link for mention.spawned -->
													{#if spawnedRun}
														<button
															onclick={() => openRunModal(spawnedRun)}
															class="mt-1 text-xs text-muted hover:text-cyan transition-colors flex items-center gap-1"
														>
															<span class="font-mono text-[10px]">▸</span>
															<span>View</span>
														</button>
													{/if}
													<!-- Agent run summary for mention.completed -->
													{#if matchedRun}
														{@const runCfg = RUN_STATUS_CFG[matchedRun.status] ?? RUN_STATUS_CFG.queued}
														<div class="mt-1.5 flex items-center gap-2 text-xs">
															<span class="px-1.5 py-0.5 rounded border {runCfg.class}">{runCfg.label}</span>
															<span class="text-muted">{formatDuration(matchedRun.duration_ms)} | {formatCost(matchedRun.cost_usd)}</span>
															<button
																onclick={() => toggleRunExpand(matchedRun.id)}
																class="text-muted hover:text-secondary transition-colors flex items-center gap-1"
															>
																<span class="font-mono text-[10px]">{expandedRun === matchedRun.id ? '▾' : '▸'}</span>
																<span>{expandedRun === matchedRun.id ? 'Hide' : 'Details'}</span>
															</button>
														</div>
														{#if expandedRun === matchedRun.id}
															<div class="mt-1.5 p-2 bg-base-hi border border-edge rounded text-xs max-h-60 overflow-y-auto">
																{#if loadingEvents}
																	<div class="animate-pulse text-muted">Loading events...</div>
																{:else if expandedEvents.length === 0}
																	<p class="text-muted">No events recorded.</p>
																{:else}
																	<div class="flex flex-col gap-2">
																		{#each expandedEvents as event (event.id)}
																			<div class="flex gap-2">
																				<span class="shrink-0 w-20 text-muted font-mono">{event.type}</span>
																				<span class="text-secondary break-all">{renderEventContent(event)}</span>
																			</div>
																		{/each}
																		{#if matchedRun.status === 'running'}
																			<div class="flex gap-2 animate-pulse">
																				<span class="shrink-0 w-20 text-green font-mono">...</span>
																				<span class="text-green">Processing</span>
																			</div>
																		{/if}
																	</div>
																{/if}
															</div>
														{/if}
													{/if}

													<!-- Expandable activity details -->
													{#if expandable}
														<button
															onclick={() => toggleActivityExpand(entry.id)}
															class="mt-1 text-xs text-muted hover:text-secondary transition-colors flex items-center gap-1"
														>
															<span class="font-mono text-[10px]">{isExp ? '▾' : '▸'}</span>
															<span>{isExp ? 'Hide' : 'Details'}</span>
														</button>
														{#if isExp}
															<div class="mt-1.5 p-2 bg-base-hi border border-edge rounded text-xs text-secondary font-mono leading-relaxed">
																<ActivityDetails {details} />
															</div>
														{/if}
													{/if}
												</div>
											</div>
										{/if}
									{/each}
								</div>
							</div>
						{/if}

						<!-- Add comment form -->
						<div class="border border-edge rounded p-3 sm:p-4 relative">
							<textarea
								bind:this={textareaEl}
								bind:value={commentText}
								oninput={handleInput}
								onkeydown={handleKeydown}
								rows={3}
								placeholder="Type /dispatch to spawn an agent..."
								class="w-full bg-transparent text-secondary text-sm resize-none focus:outline-none placeholder:text-muted"
							></textarea>

							{#if showMentions && filteredAgents.length > 0}
								<div class="absolute bottom-full left-0 mb-1 w-64 bg-surface border border-edge rounded shadow-lg max-h-48 overflow-auto z-10">
									{#each filteredAgents as agent, i (agent.id)}
										<button
											onclick={() => selectMention(agent)}
											class="w-full text-left px-3 py-3 sm:py-2 text-sm hover:bg-base transition-colors flex flex-col min-h-[44px] {i === mentionIdx ? 'bg-base' : ''}"
										>
											<span class="text-primary font-medium">{agent.name}</span>
											<span class="text-muted text-xs">{agent.title}</span>
										</button>
									{/each}
								</div>
							{/if}

							<div class="flex justify-end mt-3 pt-3 border-t border-edge">
								<button
									onclick={postComment}
									disabled={posting || !commentText.trim()}
									class="px-4 py-2.5 sm:py-1.5 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px] sm:min-h-0"
								>
									{posting ? 'Posting...' : 'Post Comment'}
								</button>
							</div>
						</div>
					{/if}
				</div>
			</div>

			<div class="order-first lg:order-none">
			<IssueSidebar
				{issue}
				{project}
				{projectId}
				onStatusChange={() => { getIssue(projectId, issueId).then(d => { issue = d; }).catch(() => {}); }}
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

<Modal open={viewRunModalOpen} onClose={() => { viewRunModalOpen = false; viewRunModalRun = null; viewRunModalEvents = []; }} label="View Run" maxWidth="max-w-2xl">
	{#if viewRunModalRun}
		{@const runCfg = RUN_STATUS_CFG[viewRunModalRun.status] ?? RUN_STATUS_CFG.queued}
		<div class="flex items-center gap-3 mb-4">
			<h2 class="text-lg font-semibold text-primary">Run Details</h2>
			<span class="text-xs px-1.5 py-0.5 rounded border {runCfg.class}" class:animate-pulse={runCfg.pulse}>{runCfg.label}</span>
			<span class="text-xs text-muted ml-auto">{formatDuration(viewRunModalRun.duration_ms)} | {formatCost(viewRunModalRun.cost_usd)}</span>
		</div>
		<div class="max-h-96 overflow-y-auto border border-edge rounded p-3 bg-base">
			{#if viewRunModalLoading}
				<div class="animate-pulse text-xs text-muted">Loading events...</div>
			{:else if viewRunModalEvents.length === 0}
				<p class="text-xs text-muted">No events recorded.</p>
			{:else}
				<div class="flex flex-col gap-2 text-xs">
					{#each viewRunModalEvents as event (event.id)}
						<div class="flex gap-2">
							<span class="shrink-0 w-20 text-muted font-mono">{event.type}</span>
							<span class="text-secondary break-all">{renderEventContent(event)}</span>
						</div>
					{/each}
					{#if viewRunModalRun.status === 'running'}
						<div class="flex gap-2 animate-pulse">
							<span class="shrink-0 w-20 text-green font-mono">...</span>
							<span class="text-green">Processing</span>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</Modal>

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
