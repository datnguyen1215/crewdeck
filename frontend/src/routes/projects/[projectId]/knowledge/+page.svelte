<script lang="ts">
	import { page } from '$app/stores';
	import {
		listKnowledge,
		createKnowledge,
		updateKnowledge,
		deleteKnowledge,
		listAgents,
		getProject,
		type ProjectKnowledge,
		type Agent,
		type Project
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import Modal from '$lib/components/Modal.svelte';

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Knowledge - ${project.name} - CrewDeck` : 'Knowledge - CrewDeck');
	let knowledge = $state<ProjectKnowledge[]>([]);
	let agents = $state<Agent[]>([]);
	let loading = $state(true);

	// Modal state
	let showModal = $state(false);
	let editingEntry = $state<ProjectKnowledge | null>(null);
	let formTitle = $state('');
	let formCategory = $state('');
	let formContent = $state('');
	let formAgents = $state<string[]>([]);
	let submitting = $state(false);
	let formError = $state('');

	// Delete confirmation
	let confirmingDeleteId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);

	$effect(() => {
		loading = true;
		let cancelled = false;

		Promise.all([listKnowledge(projectId), listAgents(), getProject(projectId)])
			.then(([k, a, p]) => {
				if (cancelled) return;
				knowledge = k;
				agents = a;
				project = p;
			})
			.catch(() => {
				if (!cancelled) toastStore.add('Failed to load knowledge', 'error');
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});

		return () => { cancelled = true; };
	});

	let agentMap = $derived(Object.fromEntries(agents.map((a) => [a.id, a.name])));

	function openCreate() {
		editingEntry = null;
		formTitle = '';
		formCategory = '';
		formContent = '';
		formAgents = [];
		formError = '';
		showModal = true;
	}

	function openEdit(entry: ProjectKnowledge) {
		editingEntry = entry;
		formTitle = entry.title;
		formCategory = entry.category;
		formContent = entry.content;
		formAgents = [...entry.agents];
		formError = '';
		showModal = true;
	}

	function closeModal() {
		if (!submitting) {
			showModal = false;
			editingEntry = null;
		}
	}

	function toggleAgent(agentId: string) {
		if (formAgents.includes(agentId)) {
			formAgents = formAgents.filter(id => id !== agentId);
		} else {
			formAgents = [...formAgents, agentId];
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!formTitle.trim() || !formContent.trim()) return;

		submitting = true;
		formError = '';

		try {
			if (editingEntry) {
				const updated = await updateKnowledge(projectId, editingEntry.id, {
					title: formTitle.trim(),
					category: formCategory.trim(),
					content: formContent,
					agents: formAgents
				});
				knowledge = knowledge.map(k => k.id === updated.id ? updated : k);
				toastStore.add('Knowledge entry updated', 'success');
			} else {
				const created = await createKnowledge(projectId, {
					title: formTitle.trim(),
					category: formCategory.trim(),
					content: formContent,
					agents: formAgents
				});
				knowledge = [...knowledge, created];
				toastStore.add('Knowledge entry created', 'success');
			}
			showModal = false;
			editingEntry = null;
		} catch (err) {
			formError = err instanceof Error ? err.message : 'Failed to save';
		} finally {
			submitting = false;
		}
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

	function truncate(text: string, maxLen: number): string {
		if (text.length <= maxLen) return text;
		return text.slice(0, maxLen) + '...';
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="p-6 h-full overflow-auto">
	<!-- Breadcrumb -->
	<div class="mb-5">
		<Breadcrumb segments={[
			{ label: 'Projects', href: '/' },
			{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
			{ label: 'Knowledge' }
		]} />
	</div>

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
		<button
			onclick={openCreate}
			class="px-3 py-1.5 bg-surface border border-edge text-primary text-xs font-medium rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide"
		>
			+ Add Entry
		</button>
	</div>

	<!-- Content -->
	{#if loading}
		<div class="flex flex-col gap-3 fade-up">
			{#each Array(4) as _, i}
				<div class="p-4 bg-base border border-edge rounded" style="animation-delay: {i * 40}ms">
					<div class="flex items-start gap-4">
						<div class="flex-1">
							<div class="skeleton h-4 w-48 rounded mb-2"></div>
							<div class="skeleton h-3 w-24 rounded mb-3"></div>
							<div class="skeleton h-3 w-full rounded mb-1"></div>
							<div class="skeleton h-3 w-3/4 rounded"></div>
						</div>
						<div class="skeleton h-5 w-16 rounded"></div>
					</div>
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
		<div class="flex flex-col gap-3">
			{#each knowledge as entry, i (entry.id)}
				<div
					class="p-4 bg-base border border-edge rounded hover:border-edge-hi transition-colors group"
					style="animation: fade-up 0.25s ease both; animation-delay: {i * 25}ms"
				>
					<div class="flex items-start gap-4">
						<div class="flex-1 min-w-0">
							<!-- Title + Category -->
							<div class="flex items-center gap-2 mb-1">
								<h3 class="text-primary text-sm font-medium truncate">{entry.title}</h3>
								{#if entry.category}
									<span class="text-xs text-muted bg-surface px-1.5 py-0.5 rounded shrink-0">{entry.category}</span>
								{/if}
							</div>

							<!-- Source badge -->
							<div class="flex items-center gap-2 mb-2">
								<span class="text-xs px-1.5 py-0.5 rounded {entry.source === 'librarian' ? 'bg-purple/10 text-purple border border-purple/30' : 'bg-cyan/10 text-cyan border border-cyan/30'}">
									{entry.source}
								</span>
							</div>

							<!-- Content preview -->
							<p class="text-secondary text-sm leading-relaxed">{truncate(entry.content, 150)}</p>

							<!-- Agent assignments -->
							{#if entry.agents.length > 0}
								<div class="flex flex-wrap gap-1 mt-3">
									{#each entry.agents as agentId (agentId)}
										<span class="text-xs px-2 py-0.5 bg-surface border border-edge rounded text-muted">
											{agentMap[agentId] ?? agentId}
										</span>
									{/each}
								</div>
							{:else}
								<div class="mt-3">
									<span class="text-xs text-muted italic">All agents</span>
								</div>
							{/if}
						</div>

						<!-- Actions -->
						<div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Create/Edit Modal -->
<Modal open={showModal} onClose={closeModal} label={editingEntry ? 'Edit Knowledge Entry' : 'New Knowledge Entry'}>
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
				bind:value={formTitle}
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
				bind:value={formCategory}
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
				bind:value={formContent}
				required
				rows="8"
				placeholder="Enter knowledge content... (Markdown supported)"
				class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors resize-y"
			></textarea>
		</div>

		<div>
			<span class="block text-xs text-muted uppercase tracking-widest mb-1.5">
				Assign to Agents
			</span>
			<p class="text-xs text-muted mb-2">Leave empty to make available to all agents</p>
			<div class="flex flex-wrap gap-2">
				{#each agents as agent (agent.id)}
					<button
						type="button"
						onclick={() => toggleAgent(agent.id)}
						class="px-2.5 py-1 text-xs rounded border transition-colors {formAgents.includes(agent.id)
							? 'bg-cyan/10 border-cyan text-cyan'
							: 'border-edge text-muted hover:border-edge-hi hover:text-secondary'}"
					>
						{agent.name}
					</button>
				{/each}
			</div>
		</div>

		{#if formError}
			<p class="text-red text-xs">{formError}</p>
		{/if}

		<div class="flex gap-3 pt-1">
			<button
				type="submit"
				disabled={submitting}
				class="flex-1 py-2 bg-cyan/10 border border-cyan text-cyan text-sm font-medium rounded hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
			>
				{submitting ? 'Saving...' : (editingEntry ? 'Update Entry' : 'Create Entry')}
			</button>
			<button
				type="button"
				onclick={closeModal}
				disabled={submitting}
				class="px-4 py-2 bg-surface border border-edge text-secondary text-sm rounded hover:border-edge-hi transition-colors disabled:opacity-50"
			>
				Cancel
			</button>
		</div>
	</form>
</Modal>
