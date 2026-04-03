<script lang="ts">
	import type { Comment } from '$lib/api/http.js';
	import { smartTime, fullTime } from '$lib/utils/time.js';
	import { md } from '$lib/utils/markdown.js';
	import Modal from './Modal.svelte';
	import { commentStyle, commentAuthorLabel } from '$lib/utils/comments.js';
	import { createCommentActions } from '$lib/utils/comments.svelte.js';
	import DispatchAutocomplete from './DispatchAutocomplete.svelte';

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
	const actions = createCommentActions(projectId, issueId, {
		get onAdded() { return (c: Comment) => { onCommentAdded(c); commentText = ''; }; },
		get onUpdated() { return onCommentUpdated; },
		get onDeleted() { return onCommentDeleted; },
	});

	function postComment() {
		const text = commentText;
		actions.postComment(text);
	}

</script>

{#if comments.length > 0}
	<div class="flex flex-col gap-3 mb-6">
		{#each comments as comment (comment.id)}
			{@const cs = commentStyle(comment.author_type)}
			<div
				class="border border-edge rounded-r rounded-tl rounded-bl bg-base p-4"
				style="border-left: 3px solid {cs.border}"
			>
				<div class="flex items-center gap-2 mb-2 flex-wrap">
					<span class="text-xs font-semibold {cs.textColor}">
						{commentAuthorLabel(comment)}
					</span>
					<span class="text-xs text-muted" title={fullTime(comment.created_at)}>
						{smartTime(comment.created_at)}
					</span>
					{#if comment.author_type === 'user'}
						<div class="ml-auto flex gap-1">
							<button
								onclick={() => actions.startEditComment(comment)}
								class="text-xs text-muted hover:text-secondary transition-colors px-1"
								title="Edit comment"
							>edit</button>
							<button
								onclick={() => actions.requestDelete(comment.id)}
								class="text-xs text-muted hover:text-red transition-colors px-1"
								title="Delete comment"
							>delete</button>
						</div>
					{/if}
				</div>
				{#if actions.editingCommentId === comment.id}
					<div class="flex flex-col gap-2">
						<textarea
							bind:value={actions.editingCommentText}
							rows={3}
							class="w-full bg-base border border-edge rounded px-3 py-2 text-secondary text-sm resize-none focus:border-cyan focus:outline-none"
						></textarea>
						<div class="flex gap-2">
							<button onclick={actions.saveEditComment} disabled={actions.commentWorking || !actions.editingCommentText.trim()} class="px-3 py-1 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 transition-colors">Save</button>
							<button onclick={() => actions.cancelEditComment()} class="px-3 py-1 text-xs border border-edge text-muted rounded hover:text-secondary transition-colors">Cancel</button>
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
<div class="border border-edge rounded p-4">
	<DispatchAutocomplete bind:value={commentText} onSubmit={postComment} />

	<div class="flex justify-end mt-3 pt-3 border-t border-edge">
		<button
			onclick={postComment}
			disabled={actions.posting || !commentText.trim()}
			class="px-4 py-1.5 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
		>
			{actions.posting ? 'Posting...' : 'Post Comment'}
		</button>
	</div>
</div>

<Modal open={actions.isDeleteModalOpen} onClose={() => actions.cancelDelete()} label="Delete comment" maxWidth="max-w-sm">
	<h2 class="text-lg font-semibold text-primary mb-2">Delete this comment?</h2>
	<p class="text-sm text-secondary mb-6">This action cannot be undone.</p>
	<div class="flex gap-3 justify-end">
		<button onclick={() => actions.cancelDelete()} class="px-4 py-2 text-sm border border-edge text-secondary rounded hover:text-primary transition-colors">Cancel</button>
		<button onclick={actions.confirmDeleteComment} disabled={actions.commentWorking} class="px-4 py-2 text-sm bg-red text-white rounded hover:bg-red/80 transition-colors disabled:opacity-50">Delete</button>
	</div>
</Modal>
