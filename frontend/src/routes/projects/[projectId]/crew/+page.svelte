<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { getCrew, updateCrew, createAgent, updateAgent, deleteAgent, generateAgent, listSessions, type CrewWithAgents, type Session } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import Terminal from '$lib/components/Terminal.svelte';
	import Modal from '$lib/components/Modal.svelte';

	type CrewData = CrewWithAgents;
	type AgentData = CrewData['agents'][number];

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	const STATUS_CFG: Record<string, { dot: string; text: string; label: string; cardBorder: string; cardGlow: string; pulse: boolean }> = {
		idle: {
			dot: '◎',
			text: 'text-muted',
			label: 'Idle',
			cardBorder: 'border-edge',
			cardGlow: '',
			pulse: false
		},
		active: {
			dot: '◉',
			text: 'text-green',
			label: 'Active',
			cardBorder: 'border-green',
			cardGlow: 'var(--glow-green)',
			pulse: true
		}
	};

	let crew = $state<CrewData | null>(null);
	let loading = $state(true);
	let projectId = $derived($page.params.projectId!);

	// Inline crew name editing
	let editingName = $state(false);
	let nameInput = $state('');
	let savingName = $state(false);

	// Agent modal (create / edit)
	let showModal = $state(false);
	let editTarget = $state<AgentData | null>(null);
	let fname = $state('');
	let ftitle = $state('');
	let fdescription = $state('');
	let fprompt = $state('');
	let submitting = $state(false);
	let formErrors = $state<Record<string, string>>({});

	// Captain toggle
	let fisCaptain = $state(false);

	// Generate flow
	let generateInput = $state('');
	let generating = $state(false);
	let generated = $state(false);

	// Delete confirmation
	let deleteTarget = $state<AgentData | null>(null);
	let deleting = $state(false);

	// Terminal state
	let sessions = $state<Session[]>([]);
	let terminalAgentId = $state<string | null>(null);

	const sessionByAgent = $derived(
		new Map(sessions.filter(s => s.agent_id).map(s => [s.agent_id!, s]))
	);

	$effect(() => {
		let cancelled = false;
		loading = true;
		getCrew(projectId)
			.then((data) => { if (!cancelled) { crew = data; } })
			.catch(() => { if (!cancelled) toastStore.add('Failed to load crew', 'error'); })
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	// Fetch running sessions
	$effect(() => {
		let cancelled = false;
		listSessions(projectId, { status: 'running' })
			.then((data) => { if (!cancelled) sessions = data; })
			.catch(() => {});
		return () => { cancelled = true; };
	});

	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reload = () => {
			getCrew(projectId).then((data) => { crew = data; }).catch(() => {});
		};
		const reloadSessions = () => {
			listSessions(projectId, { status: 'running' })
				.then((data) => { sessions = data; })
				.catch(() => {});
		};
		const unsubs = [
			ws.on('agent.status_changed', reload),
			ws.on('agent.finished', reload),
			ws.on('agent.error', reload),
			ws.on('issue.assigned', reload),
			ws.on('session.started', reloadSessions),
			ws.on('session.ended', reloadSessions),
		];
		return () => unsubs.forEach(fn => fn());
	});

	// --- Crew name ---

	function startEditName() {
		if (!crew) return;
		nameInput = crew.name;
		editingName = true;
	}

	async function saveName() {
		if (!crew || !nameInput.trim() || savingName) return;
		savingName = true;
		try {
			const updated = await updateCrew(projectId, { name: nameInput.trim() });
			crew = { ...crew, name: updated.name };
			editingName = false;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to save crew name', 'error');
		} finally {
			savingName = false;
		}
	}

	function onNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') saveName();
		if (e.key === 'Escape') {
			nameInput = crew!.name;
			editingName = false;
		}
	}

	// --- Modal ---

	function openCreate() {
		editTarget = null;
		fname = '';
		ftitle = '';
		fdescription = '';
		fprompt = '';
		fisCaptain = false;
		generateInput = '';
		generating = false;
		generated = false;
		formErrors = {};
		showModal = true;
	}

	function openEdit(agent: AgentData) {
		editTarget = agent;
		fname = agent.name;
		ftitle = agent.title;
		fdescription = agent.description ?? '';
		fprompt = agent.system_prompt;
		fisCaptain = !!agent.is_captain;
		generateInput = '';
		generating = false;
		generated = true;
		formErrors = {};
		showModal = true;
	}

	function closeModal() {
		if (!submitting && !generating) showModal = false;
	}

	// --- Generate ---

	async function handleGenerate() {
		if (!generateInput.trim() || generating) return;
		generating = true;
		try {
			const result = await generateAgent(projectId, { prompt: generateInput.trim() });
			fname = result.name;
			ftitle = result.title;
			fdescription = result.description;
			fprompt = result.system_prompt;
			generated = true;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to generate agent', 'error');
		} finally {
			generating = false;
		}
	}

	// --- Form submit ---

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
				name: fname.trim(),
				title: ftitle.trim(),
				description: fdescription.trim() || undefined,
				system_prompt: fprompt.trim(),
				is_captain: fisCaptain
			};
			if (editTarget) {
				const updated = await updateAgent(projectId, editTarget.id, data);
				if (crew) {
					crew = {
						...crew,
						agents: crew.agents.map((a) =>
							a.id === updated.id ? { ...a, ...updated } : a
						)
					};
				}
			} else {
				const agent = await createAgent(projectId, data);
				if (crew) {
					crew = {
						...crew,
						agents: [...crew.agents, { ...agent, status: 'idle' as const, current_issue: null }]
					};
				}
			}
			showModal = false;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to save agent', 'error');
		} finally {
			submitting = false;
		}
	}

	// --- Delete ---

	function confirmDelete(agent: AgentData) {
		deleteTarget = agent;
	}

	async function handleDelete() {
		if (!deleteTarget || deleting) return;
		deleting = true;
		try {
			await deleteAgent(projectId, deleteTarget.id);
			if (crew) crew = { ...crew, agents: crew.agents.filter((a) => a.id !== deleteTarget!.id) };
			deleteTarget = null;
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to delete agent', 'error');
		} finally {
			deleting = false;
		}
	}

	// --- Global keyboard ---

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (terminalAgentId) terminalAgentId = null;
			else if (deleteTarget) deleteTarget = null;
			else closeModal();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="p-6 h-full overflow-auto">
	<!-- Header -->
	<div class="flex items-start justify-between mb-8">
		<div>
			<h1 class="text-xs text-muted uppercase tracking-widest mb-1">Crew</h1>
			{#if crew}
				{#if editingName}
					<input
						bind:value={nameInput}
						onkeydown={onNameKeydown}
						onblur={saveName}
						autofocus
						class="text-xl font-bold text-primary bg-transparent border-b border-cyan outline-none pb-0.5 w-64"
					/>
				{:else}
					<button
						onclick={startEditName}
						class="text-xl font-bold text-primary hover:text-cyan transition-colors group flex items-center gap-2"
						title="Click to rename"
					>
						{crew.name}
						<span class="text-xs text-muted opacity-0 group-hover:opacity-100 transition-opacity font-normal normal-case tracking-normal">edit</span>
					</button>
				{/if}
				<p class="text-muted text-xs mt-1">{crew.agents.length} agent{crew.agents.length !== 1 ? 's' : ''}</p>
			{:else if loading}
				<p class="text-muted text-sm">Loading…</p>
			{/if}
		</div>

		<button
			onclick={openCreate}
			class="px-3 py-1.5 bg-surface border border-edge text-primary text-xs font-medium rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide flex-shrink-0"
		>
			+ Add Agent
		</button>
	</div>

	<!-- Agent Grid -->
	{#if loading}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
			{#each Array(6) as _, i}
				<div
					class="flex flex-col p-4 bg-surface border border-edge rounded fade-up"
					style="animation-delay: {i * 50}ms"
				>
					<div class="flex items-start justify-between gap-2 mb-3">
						<div class="flex-1">
							<div class="skeleton h-4 w-3/5 rounded mb-1.5"></div>
							<div class="skeleton h-3 w-2/5 rounded"></div>
						</div>
					</div>
					<div class="skeleton h-3 w-4/5 rounded mb-3"></div>
					<div class="mt-auto pt-3 border-t border-edge">
						<div class="skeleton h-4 w-20 rounded mb-2"></div>
					</div>
					<div class="flex gap-2 mt-3 pt-3 border-t border-edge">
						<div class="skeleton flex-1 h-7 rounded"></div>
						<div class="skeleton flex-1 h-7 rounded"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if crew}
		{#if crew.agents.length === 0}
			<div class="flex flex-col items-center justify-center py-24 text-center">
				<p class="text-primary text-lg font-semibold mb-1">No agents yet</p>
				<p class="text-muted text-sm mb-6">Add an agent to start building your crew</p>
				<button
					onclick={openCreate}
					class="px-4 py-2 bg-surface border border-edge text-primary text-sm rounded hover:border-edge-hi hover:bg-surface-hi transition-colors uppercase tracking-wide"
				>
					+ Add Agent
				</button>
			</div>
		{:else}
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
				{#each crew.agents as agent, i (agent.id)}
					{@const cfg = STATUS_CFG[agent.status] ?? STATUS_CFG.idle}
					<div
						class="agent-card flex flex-col p-4 bg-surface border rounded hover:-translate-y-0.5 transition-all duration-200 fade-up {cfg.cardBorder}"
						style="{cfg.cardGlow ? `box-shadow: ${cfg.cardGlow};` : ''}animation-delay: {i * 50}ms"
					>
						<!-- Name + title -->
						<div class="mb-3">
							<div class="flex items-center gap-2">
								<h2 class="text-primary font-semibold truncate">{agent.name}</h2>
								{#if agent.is_captain}
									<span class="text-[10px] font-bold uppercase tracking-wider text-amber bg-amber/10 border border-amber/30 px-1.5 py-0.5 rounded leading-none flex-shrink-0">Captain</span>
								{/if}
							</div>
							<p class="text-cyan text-xs mt-0.5 truncate">{agent.title}</p>
						</div>

						<!-- Description -->
						{#if agent.description}
							<p class="text-muted text-xs mb-3 line-clamp-2">{agent.description}</p>
						{/if}

						<!-- Status -->
						<div class="mt-auto pt-3 border-t border-edge">
							<div class="flex items-center gap-1.5 mb-1">
								<span
									class="status-dot text-sm leading-none {cfg.text} {cfg.pulse ? 'pulse' : ''}"
								>
									{cfg.dot}
								</span>
								<span class="text-xs {cfg.text}">{cfg.label}</span>
							</div>
							{#if agent.current_issue}
								<a
									href="/projects/{projectId}/issues/{agent.current_issue.id}"
									class="text-xs text-muted hover:text-secondary transition-colors truncate block pl-5"
									title={agent.current_issue.title}
								>
									→ {agent.current_issue.title}
								</a>
							{/if}
						</div>

						<!-- Actions -->
						<div class="flex gap-2 mt-3 pt-3 border-t border-edge">
							{#if sessionByAgent.has(agent.id)}
								<button
									onclick={() => terminalAgentId = terminalAgentId === agent.id ? null : agent.id}
									class="flex-1 py-1 text-xs border rounded transition-colors flex items-center justify-center gap-1.5 {terminalAgentId === agent.id ? 'border-cyan text-cyan bg-cyan/10' : 'border-edge text-secondary hover:border-edge-hi hover:text-primary'}"
								>
									<span class="inline-block w-1.5 h-1.5 rounded-full bg-green animate-pulse"></span>
									Terminal
								</button>
							{/if}
							<button
								onclick={() => openEdit(agent)}
								class="flex-1 py-1 text-xs text-secondary border border-edge rounded hover:border-edge-hi hover:text-primary transition-colors"
							>
								Edit
							</button>
							<button
								onclick={() => confirmDelete(agent)}
								class="flex-1 py-1 text-xs text-red/70 border border-edge rounded hover:border-red/50 hover:text-red transition-colors"
							>
								Delete
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Terminal panel -->
		{#if terminalAgentId && sessionByAgent.has(terminalAgentId)}
			{@const session = sessionByAgent.get(terminalAgentId)!}
			{@const agent = crew?.agents.find(a => a.id === terminalAgentId)}
			<div class="mt-6 max-w-5xl fade-up">
				<div class="flex items-center justify-between mb-2">
					<span class="text-xs text-muted uppercase tracking-widest">
						Terminal — <span class="text-cyan normal-case tracking-normal">{agent?.name ?? 'Agent'}</span>
					</span>
					<button
						onclick={() => terminalAgentId = null}
						class="text-xs text-muted hover:text-secondary transition-colors"
					>Close</button>
				</div>
				<Terminal sessionId={session.id} agentName={agent?.name ?? 'Agent'} status="running" />
			</div>
		{/if}
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

		<!-- Generate step (only for create, before fields are generated) -->
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
					<p class="text-muted text-xs mt-1">Claude will generate the agent's name, title, description, and system prompt</p>
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
			<!-- Editable fields -->
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

				<!-- Name -->
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

				<!-- Title -->
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

				<!-- Description -->
				<div>
					<label for="agent-description" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Description
					</label>
					<input
						id="agent-description"
						bind:value={fdescription}
						placeholder="A brief summary of the agent's purpose"
						class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none transition-colors focus:border-cyan"
					/>
				</div>

				<!-- System Prompt -->
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

				<!-- Captain toggle -->
				<label class="flex items-center gap-3 cursor-pointer group">
					<input
						type="checkbox"
						bind:checked={fisCaptain}
						class="w-4 h-4 rounded border border-edge bg-base accent-amber cursor-pointer"
					/>
					<div>
						<span class="text-sm text-primary group-hover:text-amber transition-colors">Designate as Captain</span>
						<p class="text-muted text-xs mt-0.5">The captain coordinates the crew — routes issues, assigns reviewers, and makes decisions</p>
					</div>
				</label>

				<!-- Submit -->
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

		{#if deleteTarget.current_issue}
			<!-- Blocked: agent is active -->
			<div class="mb-5">
				<p class="text-amber text-sm mb-2">
					Cannot delete <span class="text-primary font-semibold">{deleteTarget.name}</span> while they're assigned to an active issue.
				</p>
				<p class="text-muted text-xs">
					Currently {deleteTarget.status} on: <span class="text-secondary">"{deleteTarget.current_issue.title}"</span>
				</p>
			</div>
			<button
				onclick={() => (deleteTarget = null)}
				class="w-full py-2 bg-surface border border-edge text-secondary text-sm rounded hover:border-edge-hi transition-colors"
			>
				Close
			</button>
		{:else}
			<!-- Confirmation -->
			<p class="text-secondary text-sm mb-5">
				Delete agent <span class="text-primary font-semibold">{deleteTarget.name}</span>? This action cannot be undone.
			</p>
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
