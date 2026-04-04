<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import {
		listKnowledge,
		createKnowledge,
		updateKnowledge,
		deleteKnowledge,
		getProject,
		triggerKnowledgeScan,
		getLibrarianStatus,
		type ProjectKnowledge,
		type Project,
		type LibrarianStatus
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { smartTimeDiff, smartTime, fullTime } from '$lib/utils/time.js';
	import { stripMarkdown } from '$lib/utils/markdown.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { createFormState } from '$lib/utils/form.svelte.js';

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Knowledge - ${project.name} - CrewDeck` : 'Knowledge - CrewDeck');
	let knowledge = $state<ProjectKnowledge[]>([]);
	let loading = $state(true);

	// Modal state
	let editingEntry = $state<ProjectKnowledge | null>(null);
	const form = createFormState({ title: '', category: '', content: '' });

	// Delete confirmation
	let confirmingDeleteId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);

	// Scan state
	let scanning = $state(false);
	let librarianStatus = $state<LibrarianStatus | null>(null);

	// Category filter
	let activeCategory = $state<string | null>(null);

	// WebSocket for auto-refresh
	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	// Computed: is a scan currently running?
	let scanRunning = $derived(librarianStatus?.status === 'running' || librarianStatus?.status === 'queued');

	// Computed: unique categories
	let categories = $derived.by(() => {
		const seen = new Set<string>();
		for (const k of knowledge) {
			if (k.category) seen.add(k.category);
		}
		return [...seen].sort();
	});

	// Computed: filtered entries
	let filteredKnowledge = $derived(
		activeCategory ? knowledge.filter(k => k.category === activeCategory) : knowledge
	);

	async function refreshData() {
		const [k, status] = await Promise.all([
			listKnowledge(projectId),
			getLibrarianStatus(projectId)
		]);
		knowledge = k;
		librarianStatus = status;
	}

	fetchEffect(
		() => Promise.all([listKnowledge(projectId), getProject(projectId), getLibrarianStatus(projectId)]),
		{
			onData: ([k, p, status]) => { knowledge = k; project = p; librarianStatus = status; },
			onError: 'Failed to load knowledge',
			onLoading: (v) => { loading = v; },
		}
	);

	// Subscribe to WebSocket for run completion events
	$effect(() => {
		const ws = getWs?.();
		if (!ws) return;

		const unsub = ws.on('run.completed', (data) => {
			if (data.agent_id === 'librarian') {
				refreshData().catch(() => {
					toastStore.add('Failed to refresh data', 'error');
				});
			}
		});

		return unsub;
	});

	function openCreate() {
		editingEntry = null;
		form.show();
	}

	function openEdit(entry: ProjectKnowledge) {
		editingEntry = entry;
		form.show({
			title: entry.title,
			category: entry.category,
			content: entry.content
		});
	}

	function closeModal() {
		form.close();
		if (!form.open) editingEntry = null;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!form.fields.title.trim() || !form.fields.content.trim()) return;

		await form.submit(async (f) => {
			if (editingEntry) {
				const updated = await updateKnowledge(projectId, editingEntry.id, {
					title: f.title.trim(),
					category: f.category.trim(),
					content: f.content
				});
				knowledge = knowledge.map(k => k.id === updated.id ? updated : k);
				toastStore.add('Knowledge entry updated', 'success');
			} else {
				const created = await createKnowledge(projectId, {
					title: f.title.trim(),
					category: f.category.trim(),
					content: f.content
				});
				knowledge = [...knowledge, created];
				toastStore.add('Knowledge entry created', 'success');
			}
			editingEntry = null;
		});
	}

	async function handleDelete(id: string) {
		deletingId = id;
		try {
			await deleteKnowledge(projectId, id);
			knowledge = knowledge.filter(k => k.id !== id);
			toastStore.add('Knowledge entry deleted', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to delete', 'error');
		} finally {
			deletingId = null;
			confirmingDeleteId = null;
		}
	}

	async function handleScan() {
		scanning = true;
		try {
			await triggerKnowledgeScan(projectId);
			librarianStatus = await getLibrarianStatus(projectId);
			toastStore.add('Scan triggered — librarian agent dispatched', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to trigger scan', 'error');
		} finally {
			scanning = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="p-6 h-full overflow-auto pt-14 md:pt-6">
	<!-- Breadcrumb -->
	<div class="mb-5">
		<Breadcrumb segments={[
			{ label: 'Projects', href: '/' },
			{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
			{ label: 'Knowledge' }
		]} />
	</div>

	<!-- Scan Status Banner -->
	{#if librarianStatus?.status}
		<div class="mb-4 px-4 py-2.5 rounded border {scanRunning ? 'bg-purple/10 border-purple/30' : librarianStatus.status === 'completed' ? 'bg-green/10 border-green/30' : 'bg-red/10 border-red/30'}">
			<div class="flex items-center gap-2 text-sm">
				{#if scanRunning}
					<span class="inline-block w-2 h-2 rounded-full bg-purple animate-pulse"></span>
					<span class="text-purple">
						Scanning... started <span title={fullTime(librarianStatus.started_at)}>{librarianStatus.started_at ? smartTime(librarianStatus.started_at) : ''}</span>
					</span>
				{:else if librarianStatus.status === 'completed'}
					<span class="inline-block w-2 h-2 rounded-full bg-green"></span>
					<span class="text-green">
						Last scan completed <span title={fullTime(librarianStatus.completed_at)}>{librarianStatus.completed_at ? smartTime(librarianStatus.completed_at) : ''}</span>
					</span>
				{:else}
					<span class="inline-block w-2 h-2 rounded-full bg-red"></span>
					<span class="text-red">
						Last scan {librarianStatus.status} <span title={fullTime(librarianStatus.completed_at)}>{librarianStatus.completed_at ? smartTime(librarianStatus.completed_at) : ''}</span>
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Header -->
	<div class="flex items-center justify-between mb-5">
		<div>
			<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Knowledge</h1>
			<p class="text-muted text-xs mt-0.5">
				{#if !loading}
					{knowledge.length} entr{knowledge.length === 1 ? 'y' : 'ies'}
				{:else}
					Loading...
				{/if}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<button
				onclick={handleScan}
				disabled={scanning || scanRunning}
				class="px-3 py-1.5 bg-purple/10 border border-purple text-purple text-xs font-medium rounded hover:bg-purple/20 transition-colors uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{#if scanning || scanRunning}
					Scanning...
				{:else}
					Scan Codebase
				{/if}
			</button>
			<button
				onclick={openCreate}
				class="px-3 py-1.5 bg-surface border border-edge text-primary text-xs font-medium rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide"
			>
				+ Add Entry
			</button>
		</div>
	</div>

	<!-- Content -->
	{#if loading}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each Array(6) as _, i}
				<div class="flex flex-col p-4 bg-surface border border-edge rounded fade-up" style="animation-delay: {i * 40}ms">
					<div class="skeleton h-4 w-3/4 rounded mb-2"></div>
					<div class="skeleton h-3 w-20 rounded mb-3"></div>
					<div class="skeleton h-3 w-full rounded mb-1.5"></div>
					<div class="skeleton h-3 w-full rounded mb-1.5"></div>
					<div class="skeleton h-3 w-2/3 rounded mt-auto"></div>
				</div>
			{/each}
		</div>
	{:else if knowledge.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<p class="text-primary text-lg font-semibold mb-1">No knowledge entries yet</p>
			<p class="text-muted text-sm mb-6">Add knowledge to help your agents understand your project</p>
			<button
				onclick={openCreate}
				class="px-4 py-2 bg-surface border border-edge text-primary text-sm rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide"
			>
				+ Add Entry
			</button>
		</div>
	{:else}
		<!-- Category filter chips -->
		{#if categories.length > 0}
			<div class="flex flex-wrap gap-2 mb-5">
				<button
					onclick={() => activeCategory = null}
					class="px-2.5 py-1 text-xs font-medium rounded-full transition-colors {activeCategory === null
						? 'bg-cyan/15 text-cyan border border-cyan/30'
						: 'bg-surface text-muted border border-edge hover:border-edge-hi hover:text-secondary'
					}"
				>
					All
				</button>
				{#each categories as cat}
					<button
						onclick={() => activeCategory = activeCategory === cat ? null : cat}
						class="px-2.5 py-1 text-xs font-medium rounded-full transition-colors {activeCategory === cat
							? 'bg-cyan/15 text-cyan border border-cyan/30'
							: 'bg-surface text-muted border border-edge hover:border-edge-hi hover:text-secondary'
						}"
					>
						{cat}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Card grid -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each filteredKnowledge as entry, i (entry.id)}
				<div
					class="group flex flex-col p-4 bg-surface border border-edge rounded hover:-translate-y-0.5 hover:border-edge-hi transition-all duration-200 cursor-pointer fade-up"
					style="animation-delay: {i * 30}ms"
					onclick={() => openEdit(entry)}
					onkeydown={(e) => e.key === 'Enter' && openEdit(entry)}
					tabindex="0"
					role="button"
				>
					<!-- Header: category + source -->
					<div class="flex items-center gap-2 mb-2">
						{#if entry.category}
							<span class="text-xs text-muted bg-base px-1.5 py-0.5 rounded">{entry.category}</span>
						{/if}
						{#if entry.source && entry.source !== 'librarian'}
							<span class="text-xs px-1.5 py-0.5 rounded bg-cyan/10 text-cyan border border-cyan/30">{entry.source}</span>
						{/if}
						<span class="text-xs text-muted font-mono ml-auto" title={fullTime(entry.updated_at)}>{smartTimeDiff(entry.updated_at)}</span>
					</div>

					<!-- Title -->
					<h3 class="text-primary text-sm font-medium mb-2 line-clamp-1">{entry.title}</h3>

					<!-- Plain-text preview -->
					<p class="text-secondary text-xs leading-relaxed line-clamp-3 mb-3" title={stripMarkdown(entry.content)}>{stripMarkdown(entry.content)}</p>

					<!-- Actions (shown on hover) -->
					<div class="mt-auto flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" role="presentation" onclick={(e) => e.stopPropagation()}>
						<button
							onclick={() => openEdit(entry)}
							class="px-2 py-1 text-xs text-secondary hover:text-primary border border-edge hover:border-edge-hi rounded transition-colors"
						>
							Edit
						</button>
						{#if confirmingDeleteId === entry.id}
							<button
								onclick={() => handleDelete(entry.id)}
								disabled={deletingId === entry.id}
								class="px-2 py-1 text-xs text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/50 rounded transition-colors disabled:opacity-50"
							>
								{deletingId === entry.id ? '...' : 'Confirm'}
							</button>
							<button
								onclick={() => confirmingDeleteId = null}
								class="px-2 py-1 text-xs text-muted hover:text-secondary transition-colors"
							>
								Cancel
							</button>
						{:else}
							<button
								onclick={() => confirmingDeleteId = entry.id}
								class="px-2 py-1 text-xs text-red-400 hover:text-red-300 transition-colors"
							>
								Delete
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		{#if filteredKnowledge.length === 0}
			<p class="text-muted text-sm text-center py-12">No entries match the selected category.</p>
		{/if}
	{/if}
</div>

<!-- Create/Edit Modal -->
<Modal open={form.open} onClose={closeModal} label={editingEntry ? 'Edit Knowledge Entry' : 'New Knowledge Entry'}>
	<div class="flex items-center justify-between mb-5">
		<h2 class="text-primary font-bold uppercase tracking-wide text-sm">
			{editingEntry ? 'Edit Entry' : 'New Entry'}
		</h2>
		<button
			onclick={closeModal}
			class="text-muted hover:text-primary transition-colors text-xl leading-none"
			aria-label="Close modal"
		>
			&times;
		</button>
	</div>

	<form onsubmit={handleSubmit} class="space-y-4">
		<div>
			<label for="knowledge-title" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
				Title <span class="text-red">*</span>
			</label>
			<input
				id="knowledge-title"
				bind:value={form.fields.title}
				required
				placeholder="e.g. API Authentication Guide"
				class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors"
			/>
		</div>

		<div>
			<label for="knowledge-category" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
				Category
			</label>
			<input
				id="knowledge-category"
				bind:value={form.fields.category}
				placeholder="e.g. architecture, conventions, api"
				class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors"
			/>
		</div>

		<div>
			<label for="knowledge-content" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
				Content <span class="text-red">*</span>
			</label>
			<textarea
				id="knowledge-content"
				bind:value={form.fields.content}
				required
				rows="8"
				placeholder="Enter knowledge content... (Markdown supported)"
				class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors resize-y"
			></textarea>
		</div>

		{#if form.error}
			<p class="text-red text-xs">{form.error}</p>
		{/if}

		<div class="flex gap-3 pt-1">
			<button
				type="submit"
				disabled={form.submitting}
				class="flex-1 py-2 bg-cyan/10 border border-cyan text-cyan text-sm font-medium rounded hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
			>
				{form.submitting ? 'Saving...' : (editingEntry ? 'Update Entry' : 'Create Entry')}
			</button>
			<button
				type="button"
				onclick={closeModal}
				disabled={form.submitting}
				class="px-4 py-2 bg-surface border border-edge text-secondary text-sm rounded hover:border-edge-hi transition-colors disabled:opacity-50"
			>
				Cancel
			</button>
		</div>
	</form>
</Modal>
