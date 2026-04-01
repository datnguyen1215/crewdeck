<script lang="ts">
	import type { Comment } from '$lib/api/http.js';
	import { smartTime, fullTime } from '$lib/utils/time.js';
	import { md } from '$lib/utils/markdown.js';
	import { commentStyle, commentAuthorLabel } from '$lib/utils/comments.js';

	let {
		comment,
		index,
		editingCommentId,
		editingCommentText = $bindable(''),
		commentWorking,
		onStartEdit,
		onSaveEdit,
		onCancelEdit,
		onDelete
	}: {
		comment: Comment;
		index: number;
		editingCommentId: string | null;
		editingCommentText: string;
		commentWorking: boolean;
		onStartEdit: (comment: Comment) => void;
		onSaveEdit: () => void;
		onCancelEdit: () => void;
		onDelete: (id: string) => void;
	} = $props();

	const cs = $derived(commentStyle(comment.author_type));
</script>

<div
	class="flex gap-3 pb-4 relative"
	style="animation: fade-up 0.2s ease both; animation-delay: {Math.min(index * 25, 200)}ms"
>
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

	<div class="flex-1 min-w-0">
		<div
			class="border border-edge rounded-r rounded-tl rounded-bl bg-base p-3"
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
							onclick={() => onStartEdit(comment)}
							class="text-xs text-muted hover:text-secondary transition-colors px-1"
							title="Edit comment"
						>edit</button>
						<button
							onclick={() => onDelete(comment.id)}
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
						<button onclick={onSaveEdit} disabled={commentWorking || !editingCommentText.trim()} class="px-3 py-1 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 transition-colors">Save</button>
						<button onclick={onCancelEdit} class="px-3 py-1 text-xs border border-edge text-muted rounded hover:text-secondary transition-colors">Cancel</button>
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
