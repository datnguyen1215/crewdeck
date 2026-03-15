<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import { getIssue, addComment, approveIssue, discardIssue, updateIssue, listSessions, type IssueWithDetails } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import Terminal from '$lib/components/Terminal.svelte';

	type Issue = IssueWithDetails;

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let issue = $state<Issue | null>(null);
	let loading = $state(true);
	let projectId = $derived($page.params.projectId);
	let issueId = $derived($page.params.issueId);

	// Comment form
	let commentText = $state('');
	let posting = $state(false);

	// Action states
	let showApproveConfirm = $state(false);
	let showDiscardConfirm = $state(false);
	let showEditForm = $state(false);
	let working = $state(false);

	// Edit form
	let editTitle = $state('');
	let editDescription = $state('');

	// Copy state for branch name
	let copied = $state(false);

	// Tab navigation
	let activeTab = $state<'description' | 'comments' | 'terminal'>('description');

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
					});
			})
			.catch(() => { if (!cancelled) issue = null; })
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	// WebSocket real-time updates
	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reloadIssue = () => {
			getIssue(projectId, issueId).then((d) => { issue = d; }).catch(() => {});
		};
		const unsubs = [
			ws.on('issue.updated', reloadIssue),
			ws.on('issue.status_changed', reloadIssue),
			ws.on('issue.approved', reloadIssue),
			ws.on('comment.added', reloadIssue),
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
		];
		return () => unsubs.forEach(fn => fn());
	});

	function rel(iso: string) {
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		return d < 7 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
	}

	function esc(s: string) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	// Minimal markdown renderer — handles the common subset
	function md(text: string): string {
		if (!text) return '';

		// Apply inline transforms to a single line (HTML already escaped via esc)
		function inline(s: string): string {
			return esc(s)
				.replace(/`([^`]+)`/g, '<code>$1</code>')
				.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
				.replace(/\*([^*]+)\*/g, '<em>$1</em>');
		}

		// Process line by line so fenced code blocks are never torn apart
		const lines = text.split('\n');
		const result: string[] = [];
		let inList: 'ul' | 'ol' | false = false;
		let inCodeBlock = false;
		const codeLines: string[] = [];

		for (const line of lines) {
			if (/^```/.test(line)) {
				if (inCodeBlock) {
					if (inList) { result.push(`</${inList}>`); inList = false; }
					result.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
					codeLines.length = 0;
					inCodeBlock = false;
				} else {
					inCodeBlock = true;
				}
				continue;
			}
			if (inCodeBlock) {
				codeLines.push(esc(line));
				continue;
			}
			if (/^### /.test(line)) {
				if (inList) { result.push(`</${inList}>`); inList = false; }
				result.push(`<h3>${inline(line.slice(4))}</h3>`);
			} else if (/^## /.test(line)) {
				if (inList) { result.push(`</${inList}>`); inList = false; }
				result.push(`<h2>${inline(line.slice(3))}</h2>`);
			} else if (/^# /.test(line)) {
				if (inList) { result.push(`</${inList}>`); inList = false; }
				result.push(`<h1>${inline(line.slice(2))}</h1>`);
			} else if (/^\d+\. /.test(line)) {
				if (!inList) { result.push('<ol>'); inList = 'ol'; }
				result.push(`<li>${inline(line.replace(/^\d+\. /, ''))}</li>`);
			} else if (/^- /.test(line)) {
				if (!inList) { result.push('<ul>'); inList = 'ul'; }
				result.push(`<li>${inline(line.slice(2))}</li>`);
			} else {
				if (inList) { result.push(`</${inList}>`); inList = false; }
				if (line.trim() === '') {
					result.push('<br>');
				} else {
					result.push(`<p>${inline(line)}</p>`);
				}
			}
		}
		if (inCodeBlock) result.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
		if (inList) result.push(`</${inList}>`);
		return result.join('');
	}

	async function postComment() {
		if (!commentText.trim() || !issue) return;
		posting = true;
		try {
			const c = await addComment(projectId, issueId, { content: commentText });
			issue = { ...issue, comments: [...issue.comments, c] };
			commentText = '';
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to post comment', 'error');
		} finally {
			posting = false;
		}
	}

	async function handleApprove() {
		working = true;
		try {
			await approveIssue(projectId, issueId);
			issue = { ...issue!, status: 'open' };
			showApproveConfirm = false;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to approve issue', 'error');
		} finally {
			working = false;
		}
	}

	async function handleDiscard() {
		working = true;
		try {
			await discardIssue(projectId, issueId);
			goto(`/projects/${projectId}`);
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to discard issue', 'error');
		} finally {
			working = false;
		}
	}

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

	async function copyBranch() {
		if (!issue?.branch_name) return;
		await navigator.clipboard.writeText(issue.branch_name);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const STATUS_CFG: Record<
		string,
		{ label: string; dot: string; text: string; border: string; glow?: string; pulse?: boolean; dashed?: boolean }
	> = {
		draft: { label: 'Draft', dot: '◌', text: 'text-muted', border: 'border-muted', dashed: true },
		open: { label: 'Open', dot: '○', text: 'text-blue', border: 'border-blue', glow: 'var(--glow-blue)' },
		in_progress: { label: 'In Progress', dot: '◉', text: 'text-green', border: 'border-green', glow: 'var(--glow-green)', pulse: true },
		in_review: { label: 'In Review', dot: '◉', text: 'text-amber', border: 'border-amber', glow: 'var(--glow-amber)' },
		feedback: { label: 'Feedback', dot: '◉', text: 'text-red', border: 'border-red', glow: 'var(--glow-red)' },
		ready: { label: 'Ready', dot: '●', text: 'text-green', border: 'border-green', glow: 'var(--glow-green)' },
		pr_created: { label: 'PR Created', dot: '◉', text: 'text-purple', border: 'border-purple', glow: 'var(--glow-purple)' },
		done: { label: 'Done', dot: '✓', text: 'text-secondary', border: 'border-secondary' }
	};

	function commentStyle(authorType: string, content: string): { border: string; textColor: string } {
		if (/requesting changes|changes requested/i.test(content)) return { border: 'var(--color-amber)', textColor: 'text-amber' };
		if (authorType === 'orchestrator') return { border: 'var(--color-purple)', textColor: 'text-purple' };
		if (authorType === 'agent') return { border: 'var(--color-cyan)', textColor: 'text-cyan' };
		return { border: 'var(--color-edge-hi)', textColor: 'text-secondary' };
	}

	function commentAuthorLabel(comment: any): string {
		if (comment.author_type === 'orchestrator') return 'Orchestrator';
		if (comment.author_type === 'user') return 'User';
		if (comment.author_type === 'agent' && comment.author_id) {
			const ia = issue?.issue_agents?.find((ia: any) => ia.agent_id === comment.author_id);
			if (ia?.agent) return `${ia.agent.name} · ${ia.role}`;
			return comment.author_id;
		}
		return comment.author_type;
	}

	function agentStatusIcon(status: string, role: string) {
		if (status === 'active') return { icon: '◉', cls: role === 'worker' ? 'text-green' : 'text-cyan', pulse: true };
		if (status === 'done') return { icon: '◉', cls: 'text-green', pulse: false };
		if (status === 'approved') return { icon: '✓', cls: 'text-green', pulse: false };
		if (status === 'changes_requested') return { icon: '⚠', cls: 'text-amber', pulse: false };
		return { icon: '◌', cls: 'text-muted', pulse: false };
	}

	const PR_STATUS: Record<string, string> = {
		open: 'text-green border-green',
		merged: 'text-purple border-purple',
		closed: 'text-red border-red'
	};

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
		<a href="/projects/{projectId}" class="text-cyan text-xs mt-2 inline-block hover:underline">← Back to Board</a>
	</div>
{:else}
	<div class="p-6 max-w-6xl fade-up">
		<!-- Back link -->
		<div class="mb-6">
			<a href="/projects/{projectId}" class="text-muted text-xs hover:text-secondary transition-colors">← Back to Board</a>
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
						{#if issue.comments.length > 0}
							<div class="flex flex-col gap-3 mb-6">
								{#each issue.comments as comment (comment.id)}
									{@const cs = commentStyle(comment.author_type, comment.content)}
									<div
										class="border border-edge rounded-r rounded-tl rounded-bl bg-base p-4"
										style="border-left: 3px solid {cs.border}"
									>
										<div class="flex items-center gap-2 mb-2 flex-wrap">
											<span class="text-xs font-semibold {cs.textColor}">
												{commentAuthorLabel(comment)}
											</span>
											<span class="text-xs text-muted" title={new Date(comment.created_at).toLocaleString()}>
												{rel(comment.created_at)}
											</span>
										</div>
										<div class="issue-prose text-secondary text-sm leading-relaxed">
											{@html md(comment.content)}
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-muted text-sm mb-6">No comments yet.</p>
						{/if}

						<!-- Add comment form -->
						<div class="border border-edge rounded p-4">
							<textarea
								bind:value={commentText}
								rows={3}
								placeholder="Type your comment here..."
								class="w-full bg-transparent text-secondary text-sm resize-none focus:outline-none placeholder:text-muted"
							></textarea>
							<div class="flex justify-end mt-3 pt-3 border-t border-edge">
								<button
									onclick={postComment}
									disabled={posting || !commentText.trim()}
									class="px-4 py-1.5 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
								>
									{posting ? 'Posting...' : 'Post Comment'}
								</button>
							</div>
						</div>

					{:else if activeTab === 'terminal'}
						{#if activeSessionId}
							<Terminal {projectId} sessionId={activeSessionId} agentName={sessionAgentName} status={sessionStatus} />
						{:else}
							<div class="flex flex-col items-center justify-center py-16 gap-3 text-center">
								<span class="text-3xl text-muted opacity-40">⬛</span>
								<p class="text-muted text-sm">No active session</p>
								<p class="text-muted text-xs">An agent terminal will appear here once a session starts.</p>
							</div>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Right: sidebar -->
			<div class="flex flex-col gap-4">
				<!-- Metadata -->
				<div class="bg-surface border border-edge rounded p-4 flex flex-col gap-2.5 text-xs">
					<!-- Status -->
					{#if STATUS_CFG[issue.status]}
						{@const cfg = STATUS_CFG[issue.status]}
						<div class="flex items-center gap-2">
							<span class="text-muted w-20 shrink-0">Status</span>
							<span
								class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border {cfg.text} {cfg.border} {cfg.dashed ? 'border-dashed' : ''}"
								style={cfg.glow ? `box-shadow: ${cfg.glow}` : ''}
							>
								<span class={cfg.pulse ? 'animate-pulse' : ''}>{cfg.dot}</span>
								{cfg.label}
							</span>
						</div>
					{/if}

					<!-- Priority -->
					<div class="flex items-center gap-2">
						<span class="text-muted w-20 shrink-0">Priority</span>
						<span class="font-bold {issue.priority >= 8 ? 'text-amber' : issue.priority >= 5 ? 'text-blue' : 'text-secondary'}">
							{issue.priority}
						</span>
					</div>

					<!-- Agent -->
					<div class="flex items-center gap-2">
						<span class="text-muted w-20 shrink-0">Agent</span>
						{#if issue.assigned_agent}
							<a href="/projects/{projectId}/crew" class="text-cyan hover:underline">{issue.assigned_agent.name}</a>
						{:else}
							<span class="text-muted">—</span>
						{/if}
					</div>

					<!-- Branch -->
					{#if issue.branch_name}
						<div class="flex items-start gap-2">
							<span class="text-muted w-20 shrink-0 pt-px">Branch</span>
							<button
								onclick={copyBranch}
								class="font-mono text-secondary hover:text-primary transition-colors text-left leading-tight break-all"
								title="Click to copy"
							>
								{issue.branch_name}
								<span class="ml-1 text-muted">{copied ? '✓' : '⎘'}</span>
							</button>
						</div>
					{/if}

					<!-- Base branch -->
					{#if issue.base_branch}
						<div class="flex items-center gap-2">
							<span class="text-muted w-20 shrink-0">Base</span>
							<span class="font-mono text-secondary">{issue.base_branch}</span>
						</div>
					{/if}

					<!-- Worktree (collapsed) -->
					{#if issue.worktree_path}
						<details>
							<summary class="text-muted cursor-pointer hover:text-secondary flex items-center gap-2 list-none">
								<span class="w-20 shrink-0">Worktree</span>
								<span class="font-mono text-muted truncate">…/{issue.worktree_path.split('/').pop()}</span>
							</summary>
							<div class="mt-1 ml-[5.5rem] font-mono text-muted break-all text-xs">{issue.worktree_path}</div>
						</details>
					{/if}

					<!-- Review round -->
					{#if issue.max_review_rounds}
						<div class="flex items-center gap-2">
							<span class="text-muted w-20 shrink-0">Review</span>
							<span class="text-secondary">Round {issue.current_review_round} of {issue.max_review_rounds}</span>
						</div>
					{/if}

					<!-- Timestamps -->
					<div class="flex items-center gap-2">
						<span class="text-muted w-20 shrink-0">Created</span>
						<span class="text-secondary" title={new Date(issue.created_at).toLocaleString()}>{rel(issue.created_at)}</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-muted w-20 shrink-0">Updated</span>
						<span class="text-secondary" title={new Date(issue.updated_at).toLocaleString()}>{rel(issue.updated_at)}</span>
					</div>

					<!-- Created by -->
					<div class="flex items-center gap-2">
						<span class="text-muted w-20 shrink-0">By</span>
						<span class="{issue.created_by === 'orchestrator' ? 'text-purple' : 'text-secondary'}">{issue.created_by}</span>
					</div>
				</div>

				<!-- Actions -->
				<div class="bg-surface border border-edge rounded p-4">
					<div class="text-xs text-muted uppercase tracking-widest mb-3">Actions</div>
					<div class="flex flex-col gap-2 text-xs">
						{#if issue.status === 'draft'}
							{#if showApproveConfirm}
								<div class="bg-base border border-green/30 rounded p-3 text-secondary">
									Approve this draft and open it as an active issue?
									<div class="flex gap-2 mt-2">
										<button onclick={handleApprove} disabled={working} class="px-2 py-1 border border-green text-green rounded hover:bg-green/10 disabled:opacity-50 transition-colors">Confirm</button>
										<button onclick={() => showApproveConfirm = false} class="px-2 py-1 border border-edge text-muted rounded hover:text-secondary transition-colors">Cancel</button>
									</div>
								</div>
							{:else}
								<button onclick={() => showApproveConfirm = true} class="w-full py-1.5 border border-green text-green rounded hover:bg-green/10 transition-colors text-left px-3">Approve Draft</button>
							{/if}

							{#if showDiscardConfirm}
								<div class="bg-base border border-red/30 rounded p-3 text-secondary">
									Discard this draft permanently? This cannot be undone.
									<div class="flex gap-2 mt-2">
										<button onclick={handleDiscard} disabled={working} class="px-2 py-1 border border-red text-red rounded hover:bg-red/10 disabled:opacity-50 transition-colors">Discard</button>
										<button onclick={() => showDiscardConfirm = false} class="px-2 py-1 border border-edge text-muted rounded hover:text-secondary transition-colors">Cancel</button>
									</div>
								</div>
							{:else}
								<button onclick={() => showDiscardConfirm = true} class="w-full py-1.5 border border-red/40 text-red/60 rounded hover:bg-red/10 hover:border-red hover:text-red transition-colors text-left px-3">Discard Draft</button>
							{/if}
						{/if}

						{#if issue.status === 'ready'}
							<button disabled class="w-full py-1.5 border border-cyan/40 text-cyan/40 rounded text-left px-3 cursor-not-allowed">Create PR</button>
						{/if}

						<!-- Decision: pr_url is not scheme-validated (e.g. startsWith('https://'))
							 because it comes from our own backend which only stores GitHub URLs.
							 Adding a guard would be over-engineering for an internal tool with trusted data. -->
						{#if issue.status === 'pr_created' && issue.issue_prs?.length}
							{@const pr = issue.issue_prs[0]}
							<a href={pr.pr_url} target="_blank" rel="noopener" class="w-full py-1.5 border border-purple text-purple rounded hover:bg-purple/10 transition-colors text-left px-3 block">View PR #{pr.pr_number}</a>
						{/if}

						<button onclick={openEdit} class="w-full py-1.5 border border-edge text-secondary rounded hover:border-edge-hi hover:text-primary transition-colors text-left px-3">Edit Issue</button>
					</div>
				</div>

				<!-- Agents panel -->
				{#if issue.issue_agents?.length}
					<div class="bg-surface border border-edge rounded p-4">
						<div class="text-xs text-muted uppercase tracking-widest mb-3">Agents</div>
						<div class="flex flex-col gap-2 text-xs">
							{#each [...issue.issue_agents].sort((a, b) => a.role === 'worker' ? -1 : b.role === 'worker' ? 1 : (a.review_order ?? 0) - (b.review_order ?? 0)) as ia}
								{@const s = agentStatusIcon(ia.status, ia.role)}
								<div class="flex items-center gap-2">
									<span class="text-muted w-16 shrink-0">
										{ia.role === 'worker' ? 'Worker' : `Rev ${ia.review_order}`}
									</span>
									{#if ia.agent}
										<span class="text-secondary">{ia.agent.name}</span>
									{:else}
										<span class="text-muted">—</span>
									{/if}
									<span class="ml-auto {s.cls} {s.pulse ? 'animate-pulse' : ''}">{s.icon}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Pull Requests panel -->
				<!-- See decision comment above re: pr_url scheme validation -->
				<div class="bg-surface border border-edge rounded p-4">
					<div class="text-xs text-muted uppercase tracking-widest mb-3">Pull Requests</div>
					{#if issue.issue_prs?.length}
						<div class="flex flex-col gap-2 text-xs">
							{#each issue.issue_prs as pr}
								<div class="flex items-center gap-2">
									<a href={pr.pr_url} target="_blank" rel="noopener" class="text-cyan hover:underline">PR #{pr.pr_number}</a>
									<span class="px-1.5 py-0.5 rounded border {PR_STATUS[pr.status] ?? 'text-secondary border-edge'}">{pr.status}</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-muted">No pull requests yet.</p>
					{/if}
				</div>
			</div>
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
