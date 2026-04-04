import { addComment, editComment, deleteComment, type Comment } from '$lib/api/http.js';
import { toastStore } from '$lib/stores/toasts.svelte.js';

export interface CommentActionsCallbacks {
	onAdded: (comment: Comment) => void;
	onUpdated: (comment: Comment) => void;
	onDeleted: (commentId: string) => void;
}

export function createCommentActions(projectId: string, issueId: string, callbacks: CommentActionsCallbacks) {
	let editingCommentId = $state<string | null>(null);
	let editingCommentText = $state('');
	let deletingCommentId = $state<string | null>(null);
	let commentWorking = $state(false);
	let posting = $state(false);

	async function postComment(text: string) {
		if (!text.trim()) return;
		posting = true;
		try {
			const c = await addComment(projectId, issueId, { content: text });
			callbacks.onAdded(c);
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

	function cancelEditComment() {
		editingCommentId = null;
	}

	async function saveEditComment() {
		if (!editingCommentId || !editingCommentText.trim()) return;
		commentWorking = true;
		try {
			const updated = await editComment(projectId, issueId, editingCommentId, { content: editingCommentText });
			callbacks.onUpdated(updated);
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
			callbacks.onDeleted(deletingCommentId);
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to delete comment', 'error');
		} finally {
			deletingCommentId = null;
			commentWorking = false;
		}
	}

	function requestDelete(commentId: string) {
		deletingCommentId = commentId;
	}

	function cancelDelete() {
		deletingCommentId = null;
	}

	return {
		get editingCommentId() { return editingCommentId; },
		get editingCommentText() { return editingCommentText; },
		set editingCommentText(v: string) { editingCommentText = v; },
		get deletingCommentId() { return deletingCommentId; },
		get commentWorking() { return commentWorking; },
		get posting() { return posting; },
		get isDeleteModalOpen() { return deletingCommentId !== null; },
		postComment,
		startEditComment,
		cancelEditComment,
		saveEditComment,
		requestDelete,
		cancelDelete,
		confirmDeleteComment,
	};
}
