<script lang="ts">
	import { goto } from '$app/navigation';
	import { updateIssue, deleteIssue, pauseIssue, resumeIssue, approveIssueMerge, type IssueWithDetails, type Project } from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { STATUS_CFG, PR_STATUS } from '$lib/config/status.js';
	import Modal from './Modal.svelte';
	import IssueMetadata from './IssueMetadata.svelte';
	import IssueActions from './IssueActions.svelte';

	let {
		issue,
		project,
		projectId,
		onStatusChange,
		onEdit
	}: {
		issue: IssueWithDetails;
		project: Project | null;
		projectId: string;
		onStatusChange: () => void;
		onEdit: () => void;
	} = $props();

	let working = $state(false);
	let copied = $state(false);
	let showDeleteModal = $state(false);
	let baseBranchEdit = $state('');
	let savingBaseBranch = $state(false);

	$effect(() => {
		baseBranchEdit = issue.base_branch ?? '';
	});

	const isBaseBranchLocked = $derived(issue.status !== 'open');

	async function saveBaseBranch() {
		if (savingBaseBranch || isBaseBranchLocked) return;
		const newVal = baseBranchEdit.trim() || (project?.default_base_branch ?? 'main');
		if (newVal === issue.base_branch) return;
		savingBaseBranch = true;
		try {
			await updateIssue(projectId, issue.id, { base_branch: newVal });
			onStatusChange();
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to update base branch', 'error');
			baseBranchEdit = issue.base_branch ?? '';
		} finally {
			savingBaseBranch = false;
		}
	}

	async function handleDeleteIssue() {
		working = true;
		try {
			await deleteIssue(projectId, issue.id);
			showDeleteModal = false;
			goto(`/projects/${projectId}`);
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to delete issue', 'error');
		} finally {
			working = false;
		}
	}

	async function handleMarkPrCreated() {
		working = true;
		try {
			await updateIssue(projectId, issue.id, { status: 'pr_created' });
			onStatusChange();
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to mark PR created', 'error');
		} finally {
			working = false;
		}
	}

	async function handleMarkDone() {
		working = true;
		try {
			await updateIssue(projectId, issue.id, { status: 'done' });
			onStatusChange();
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to mark as done', 'error');
		} finally {
			working = false;
		}
	}

	async function handleResetChainDepth() {
		working = true;
		try {
			await updateIssue(projectId, issue.id, { chain_depth: 0 });
			onStatusChange();
			toastStore.add('Chain depth reset', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to reset chain depth', 'error');
		} finally {
			working = false;
		}
	}

	async function copyBranch() {
		if (!issue?.branch_name) return;
		await navigator.clipboard.writeText(issue.branch_name);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function handlePauseResume() {
		working = true;
		try {
			if (issue.paused) {
				await resumeIssue(projectId, issue.id);
				toastStore.add('Issue resumed', 'success');
			} else {
				await pauseIssue(projectId, issue.id);
				toastStore.add('Issue paused', 'success');
			}
			onStatusChange();
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to pause/resume issue', 'error');
		} finally {
			working = false;
		}
	}

	async function handleMergePR() {
		working = true;
		try {
			await approveIssueMerge(projectId, issue.id);
			toastStore.add('PR approved for merge — Captain will merge it', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to approve merge', 'error');
		} finally {
			working = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Metadata -->
	<IssueMetadata
		{issue}
		{project}
		{copied}
		bind:baseBranchEdit
		{savingBaseBranch}
		{isBaseBranchLocked}
		onCopyBranch={copyBranch}
		onSaveBaseBranch={saveBaseBranch}
	/>

	<!-- Dependencies panel -->
	{#if issue.dependencies.length > 0 || issue.dependents.length > 0}
		<div class="bg-surface border border-edge rounded p-4">
			<div class="text-xs text-muted uppercase tracking-widest mb-3">Dependencies</div>
			<div class="flex flex-col gap-2 text-xs">
				{#if issue.dependencies.length > 0}
					<div>
						<p class="text-muted mb-1.5">Blocked by</p>
						{#each issue.dependencies as dep}
							{@const cfg = STATUS_CFG[dep.status] ?? STATUS_CFG.open}
							<div class="flex items-center gap-2 mb-1">
								<span class="leading-none {cfg.text}">{cfg.dot}</span>
								<a href="/projects/{projectId}/issues/{dep.id}" class="text-secondary hover:text-cyan hover:underline truncate transition-colors">{dep.title}</a>
							</div>
						{/each}
					</div>
				{/if}
				{#if issue.dependents.length > 0}
					<div>
						<p class="text-muted mb-1.5">Blocking</p>
						{#each issue.dependents as dep}
							{@const cfg = STATUS_CFG[dep.status] ?? STATUS_CFG.open}
							<div class="flex items-center gap-2 mb-1">
								<span class="leading-none {cfg.text}">{cfg.dot}</span>
								<a href="/projects/{projectId}/issues/{dep.id}" class="text-secondary hover:text-cyan hover:underline truncate transition-colors">{dep.title}</a>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Actions -->
	<IssueActions
		{issue}
		{working}
		onPauseResume={handlePauseResume}
		onMarkPrCreated={handleMarkPrCreated}
		onMarkDone={handleMarkDone}
		onResetChainDepth={handleResetChainDepth}
		onMergePR={handleMergePR}
		onEdit={onEdit}
		onDelete={() => showDeleteModal = true}
	/>

	<!-- Pull Requests panel -->
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

<Modal open={showDeleteModal} onClose={() => showDeleteModal = false} label="Delete issue" maxWidth="max-w-sm">
	<h2 class="text-lg font-semibold text-primary mb-2">Delete this issue?</h2>
	<p class="text-sm text-secondary mb-6">This action cannot be undone. The issue and all its data will be permanently deleted.</p>
	<div class="flex gap-3 justify-end">
		<button onclick={() => showDeleteModal = false} class="px-4 py-2 text-sm border border-edge text-secondary rounded hover:text-primary transition-colors">Cancel</button>
		<button onclick={handleDeleteIssue} disabled={working} class="px-4 py-2 text-sm bg-red text-white rounded hover:bg-red/80 transition-colors disabled:opacity-50">Delete</button>
	</div>
</Modal>
