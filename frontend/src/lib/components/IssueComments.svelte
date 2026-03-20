<script lang="ts">
	import { addComment, editComment, deleteComment, listAgents, type Comment, type Agent } from '$lib/api/http.js';
	import { relTime } from '$lib/utils/time.js';
	import { md } from '$lib/utils/markdown.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let {
		comments,
		projectId,
		issueId,
		onCommentAdded,
		onCommentUpdated,
		onCommentDeleted
	}: {
		comments: Comment[];
		projectId: string;
		issueId: string;
		onCommentAdded: (comment: Comment) => void;
		onCommentUpdated: (comment: Comment) => void;
		onCommentDeleted: (commentId: string) => void;
	} = $props();

	let commentText = $state('');
	let posting = $state(false);
	let editingCommentId = $state<string | null>(null);
	let editingCommentText = $state('');
	let deletingCommentId = $state<string | null>(null);
	let commentWorking = $state(false);

	// /dispatch autocomplete
	let agents = $state<Agent[]>([]);
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

	// Load agents for autocomplete
	$effect(() => {
		listAgents().then(a => { agents = a; }).catch(() => {});
	});

	function commentStyle(authorType: string, content: string): { border: string; textColor: string } {
		if (authorType === 'system') return { border: 'var(--color-muted)', textColor: 'text-muted' };
		if (authorType === 'agent') return { border: 'var(--color-cyan)', textColor: 'text-cyan' };
		return { border: 'var(--color-edge-hi)', textColor: 'text-secondary' };
	}

	function commentAuthorLabel(comment: Comment): string {
		if (comment.author_type === 'system') return 'System';
		if (comment.author_type === 'user') return 'User';
		if (comment.author_type === 'agent') {
			const agent = agents.find(a => a.id === comment.author_id);
			return agent ? agent.name : 'Agent';
		}
		return comment.author_type;
	}

	async function postComment() {
		if (!commentText.trim()) return;
		posting = true;
		try {
			const c = await addComment(projectId, issueId, { content: commentText });
			onCommentAdded(c);
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
			onCommentUpdated(updated);
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
			onCommentDeleted(deletingCommentId);
			deletingCommentId = null;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to delete comment', 'error');
		} finally {
			commentWorking = false;
		}
	}

	function handleInput(e: Event) {
		const ta = e.target as HTMLTextAreaElement;
		const val = ta.value;
		const pos = ta.selectionStart ?? 0;

		// Find /dispatch before cursor
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

		// Move cursor after inserted text
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

{#if comments.length > 0}
	<div class="flex flex-col gap-3 mb-6">
		{#each comments as comment (comment.id)}
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
						{relTime(comment.created_at)}
					</span>
					{#if comment.author_type === 'user'}
						<div class="ml-auto flex gap-1">
							<button
								onclick={() => startEditComment(comment)}
								class="text-xs text-muted hover:text-secondary transition-colors px-1"
								title="Edit comment"
							>edit</button>
							{#if deletingCommentId === comment.id}
								<span class="text-xs text-red">Delete?
									<button onclick={confirmDeleteComment} disabled={commentWorking} class="hover:underline">yes</button>
									/
									<button onclick={() => deletingCommentId = null} class="hover:underline text-muted">no</button>
								</span>
							{:else}
								<button
									onclick={() => deletingCommentId = comment.id}
									class="text-xs text-muted hover:text-red transition-colors px-1"
									title="Delete comment"
								>delete</button>
							{/if}
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
		{/each}
	</div>
{:else}
	<p class="text-muted text-sm mb-6">No comments yet.</p>
{/if}

<!-- Add comment form with /dispatch autocomplete -->
<div class="border border-edge rounded p-4 relative">
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
					class="w-full text-left px-3 py-2 text-sm hover:bg-base transition-colors flex flex-col {i === mentionIdx ? 'bg-base' : ''}"
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
			class="px-4 py-1.5 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
		>
			{posting ? 'Posting...' : 'Post Comment'}
		</button>
	</div>
</div>
