<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { listAgents, createAgent, updateAgent, deleteAgent, generateAgent, type Agent } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import Modal from '$lib/components/Modal.svelte';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let agents = $state<Agent[]>([]);
	let loading = $state(true);
	let projectId = $derived($page.params.projectId!);

	// Agent modal (create / edit)
	let showModal = $state(false);
	let editTarget = $state<Agent | null>(null);
	let fname = $state('');
	let ftitle = $state('');
	let fdescription = $state('');
	let fprompt = $state('');
	let submitting = $state(false);
	let formErrors = $state<Record<string, string>>({});

	// Generate flow
	let generateInput = $state('');
	let generating = $state(false);
	let generated = $state(false);

	// Delete confirmation
	let deleteTarget = $state<Agent | null>(null);
	let deleting = $state(false);

	$effect(() => {
		let cancelled = false;
		loading = true;
		listAgents(projectId)
			.then((data) => { if (!cancelled) agents = data; })
			.catch(() => { if (!cancelled) toastStore.add('Failed to load agents', 'error'); })
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reload = () => { listAgents(projectId).then(d => { agents = d; }).catch(() => {}); };
		const unsubs = [ws.on('agent.created', reload)];
		return () => unsubs.forEach(fn => fn());
	});

	function openCreate() {
		editTarget = null;
		fname = ''; ftitle = ''; fdescription = ''; fprompt = '';
		generateInput = ''; generating = false; generated = false;
		formErrors = {};
		showModal = true;
	}

	function openEdit(agent: Agent) {
		editTarget = agent;
		fname = agent.name; ftitle = agent.title;
		fdescription = agent.description ?? ''; fprompt = agent.system_prompt;
		generated = true; formErrors = {};
		showModal = true;
	}

	function closeModal() { if (!submitting && !generating) showModal = false; }

	async function handleGenerate() {
		if (!generateInput.trim() || generating) return;
		generating = true;
		try {
			const result = await generateAgent(projectId, { prompt: generateInput.trim() });
			fname = result.name; ftitle = result.title;
			fdescription = result.description; fprompt = result.system_prompt;
			generated = true;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to generate agent', 'error');
		} finally { generating = false; }
	}

	function validate(): boolean {
		const errs: Record<string, string> = {};
		if (!fname.trim()) errs.name = 'Name is required';
		if (!ftitle.trim()) errs.title = 'Title is required';
		if (!fprompt.trim()) errs.prompt = 'System prompt is required';
		formErrors = errs;
		return Object.keys(errs).length === 0;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!validate() || submitting) return;
		submitting = true;
		try {
			const data = {
				name: fname.trim(), title: ftitle.trim(),
				description: fdescription.trim() || undefined,
				system_prompt: fprompt.trim()
			};
			if (editTarget) {
				const updated = await updateAgent(projectId, editTarget.id, data);
				agents = agents.map(a => a.id === updated.id ? updated : a);
			} else {
				const agent = await createAgent(projectId, data);
				agents = [...agents, agent];
			}
			showModal = false;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to save agent', 'error');
		} finally { submitting = false; }
	}

	function confirmDelete(agent: Agent) { deleteTarget = agent; }

	async function handleDelete() {
		if (!deleteTarget || deleting) return;
		deleting = true;
		try {
			await deleteAgent(projectId, deleteTarget.id);
			agents = agents.filter(a => a.id !== deleteTarget!.id);
			deleteTarget = null;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to delete agent', 'error');
		} finally { deleting = false; }
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (deleteTarget) deleteTarget = null;
			else closeModal();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="p-6 h-full overflow-auto">
	<div class="flex items-start justify-between mb-8">
		<div>
			<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Agents</h1>
			<p class="text-muted text-xs mt-1">{agents.length} agent{agents.length !== 1 ? 's' : ''}</p>
		</div>
		<button onclick={openCreate} class="px-3 py-1.5 bg-surface border border-edge text-primary text-xs font-medium rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide flex-shrink-0">+ Add Agent</button>
	</div>

	{#if loading}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
			{#each Array(6) as _, i}
				<div class="flex flex-col p-4 bg-surface border border-edge rounded fade-up" style="animation-delay: {i * 50}ms">
					<div class="skeleton h-4 w-3/5 rounded mb-1.5"></div>
					<div class="skeleton h-3 w-2/5 rounded mb-3"></div>
					<div class="skeleton h-3 w-4/5 rounded mb-3"></div>
					<div class="flex gap-2 mt-auto pt-3 border-t border-edge">
						<div class="skeleton flex-1 h-7 rounded"></div>
						<div class="skeleton flex-1 h-7 rounded"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if agents.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<p class="text-primary text-lg font-semibold mb-1">No agents yet</p>
			<p class="text-muted text-sm mb-6">Add an agent to get started</p>
			<button onclick={openCreate} class="px-4 py-2 bg-surface border border-edge text-primary text-sm rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide">+ Add Agent</button>
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
			{#each agents as agent, i (agent.id)}
				<div class="flex flex-col p-4 bg-surface border border-edge rounded hover:-translate-y-0.5 transition-all duration-200 fade-up" style="animation-delay: {i * 50}ms">
					<div class="mb-3">
						<h2 class="text-primary font-semibold truncate">{agent.name}</h2>
						<p class="text-cyan text-xs mt-0.5 truncate">{agent.title}</p>
					</div>
					{#if agent.description}
						<p class="text-muted text-xs mb-3 line-clamp-2">{agent.description}</p>
					{/if}
					<div class="flex gap-2 mt-auto pt-3 border-t border-edge">
						<button onclick={() => openEdit(agent)} class="flex-1 py-1 text-xs text-secondary border border-edge rounded hover:border-edge-hi hover:text-primary transition-colors">Edit</button>
						<button onclick={() => confirmDelete(agent)} class="flex-1 py-1 text-xs text-red/70 border border-edge rounded hover:border-red/50 hover:text-red transition-colors">Delete</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Create / Edit Modal -->
<Modal open={showModal} onClose={closeModal} label={editTarget ? 'Edit Agent' : 'Add Agent'} escapeClose={false} cardClass="max-h-[90vh] overflow-y-auto">
	<div>
		<div class="flex items-center justify-between mb-5">
			<h2 class="text-primary font-bold uppercase tracking-wide text-sm">
				{editTarget ? 'Edit Agent' : 'Add Agent'}
			</h2>
			<button
				onclick={closeModal}
				class="text-muted hover:text-primary transition-colors text-xl leading-none"
				aria-label="Close"
			>
				×
			</button>
		</div>

		{#if !editTarget && !generated}
			<div class="space-y-4">
				<div>
					<label for="agent-generate" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Describe your agent
					</label>
					<textarea
						id="agent-generate"
						bind:value={generateInput}
						rows="3"
						placeholder="e.g. frontend dev who's good at React and accessibility"
						class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none transition-colors focus:border-cyan resize-y"
						onkeydown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								handleGenerate();
							}
						}}
					></textarea>
				</div>

				<div class="flex gap-3">
					<button
						onclick={handleGenerate}
						disabled={generating || !generateInput.trim()}
						class="flex-1 py-2 bg-cyan/10 border border-cyan text-cyan text-sm font-medium rounded hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
					>
						{generating ? 'Generating…' : 'Generate'}
					</button>
					<button
						type="button"
						onclick={() => { generated = true; }}
						class="px-4 py-2 bg-surface border border-edge text-secondary text-sm rounded hover:border-edge-hi transition-colors"
					>
						Skip
					</button>
				</div>
			</div>
		{:else}
			<form onsubmit={handleSubmit} class="space-y-4">
				{#if !editTarget}
					<button
						type="button"
						onclick={() => { generated = false; }}
						class="text-xs text-muted hover:text-cyan transition-colors mb-2"
					>
						← Back to generate
					</button>
				{/if}

				<div>
					<label for="agent-name" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Name <span class="text-red">*</span>
					</label>
					<input
						id="agent-name"
						bind:value={fname}
						placeholder="e.g. Alice"
						class="w-full bg-base border rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none transition-colors {formErrors.name ? 'border-red' : 'border-edge focus:border-cyan'}"
					/>
					{#if formErrors.name}
						<p class="text-red text-xs mt-1">{formErrors.name}</p>
					{/if}
				</div>

				<div>
					<label for="agent-title" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Title <span class="text-red">*</span>
					</label>
					<input
						id="agent-title"
						bind:value={ftitle}
						placeholder="e.g. Senior Frontend Engineer"
						class="w-full bg-base border rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none transition-colors {formErrors.title ? 'border-red' : 'border-edge focus:border-cyan'}"
					/>
					{#if formErrors.title}
						<p class="text-red text-xs mt-1">{formErrors.title}</p>
					{/if}
				</div>

				<div>
					<label for="agent-description" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Description
					</label>
					<input
						id="agent-description"
						bind:value={fdescription}
						placeholder="A brief summary"
						class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none transition-colors focus:border-cyan"
					/>
				</div>

				<div>
					<label for="agent-prompt" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						System Prompt <span class="text-red">*</span>
					</label>
					<textarea
						id="agent-prompt"
						bind:value={fprompt}
						rows="6"
						placeholder="You are {fname || 'an AI agent'}…"
						class="w-full bg-base border rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none transition-colors resize-y {formErrors.prompt ? 'border-red' : 'border-edge focus:border-cyan'}"
					></textarea>
					{#if formErrors.prompt}
						<p class="text-red text-xs mt-1">{formErrors.prompt}</p>
					{/if}
				</div>

				<div class="flex gap-3 pt-1">
					<button
						type="submit"
						disabled={submitting}
						class="flex-1 py-2 bg-cyan/10 border border-cyan text-cyan text-sm font-medium rounded hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
					>
						{submitting ? (editTarget ? 'Saving…' : 'Adding…') : (editTarget ? 'Save Changes' : 'Add Agent')}
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
		{/if}
	</div>
</Modal>

<!-- Delete Confirmation Dialog -->
<Modal open={!!deleteTarget} onClose={() => deleteTarget = null} label="Delete Agent" maxWidth="max-w-sm" escapeClose={false}>
	{#if deleteTarget}
		<h2 class="text-primary font-bold uppercase tracking-wide text-sm mb-4">Delete Agent</h2>
		<p class="text-secondary text-sm mb-5">Delete agent <span class="text-primary font-semibold">{deleteTarget.name}</span>? This cannot be undone.</p>
		<div class="flex gap-3">
			<button
				onclick={handleDelete}
				disabled={deleting}
				class="flex-1 py-2 bg-red/10 border border-red/50 text-red text-sm font-medium rounded hover:bg-red/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
			>
				{deleting ? 'Deleting…' : 'Delete'}
			</button>
			<button
				onclick={() => (deleteTarget = null)}
				disabled={deleting}
				class="px-4 py-2 bg-surface border border-edge text-secondary text-sm rounded hover:border-edge-hi transition-colors disabled:opacity-50"
			>
				Cancel
			</button>
		</div>
	{/if}
</Modal>

<style>
	.status-dot.pulse {
		animation: status-pulse 2s ease-in-out infinite;
	}

	@keyframes status-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.agent-card {
		cursor: default;
	}
</style>
