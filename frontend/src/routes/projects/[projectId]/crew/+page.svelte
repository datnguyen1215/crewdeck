<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { getCrew, updateCrew, createAgent, updateAgent, deleteAgent, type CrewWithAgents } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	type CrewData = CrewWithAgents;
	type AgentData = CrewData['agents'][number];

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	const STATUS_CFG = {
		idle: {
			dot: '◎',
			text: 'text-muted',
			label: 'Idle',
			cardBorder: 'border-edge',
			cardGlow: '',
			pulse: false
		},
		working: {
			dot: '◉',
			text: 'text-green',
			label: 'Working',
			cardBorder: 'border-green',
			cardGlow: 'var(--glow-green)',
			pulse: true
		},
		reviewing: {
			dot: '◉',
			text: 'text-cyan',
			label: 'Reviewing',
			cardBorder: 'border-cyan',
			cardGlow: 'var(--glow-cyan)',
			pulse: true
		}
	} as const;

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
	// f-prefix distinguishes form state from data model fields (e.g. fname vs agent.name)
	let fname = $state('');
	let frole = $state('');
	let fexpertise = $state<string[]>([]);
	let fprompt = $state('');
	let fcanReview = $state(true);
	let tagInput = $state('');
	let submitting = $state(false);
	let formErrors = $state<Record<string, string>>({});

	// Delete confirmation
	let deleteTarget = $state<AgentData | null>(null);
	let deleting = $state(false);

	$effect(() => {
		let cancelled = false;
		loading = true;
		getCrew(projectId)
			.then((data) => { if (!cancelled) { crew = data; } })
			.catch(() => { if (!cancelled) toastStore.add('Failed to load crew', 'error'); })
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const reload = () => {
			getCrew(projectId).then((data) => { crew = data; }).catch(() => {});
		};
		const unsubs = [
			ws.on('agent.status_changed', reload),
			ws.on('agent.finished', reload),
			ws.on('agent.error', reload),
			ws.on('issue.assigned', reload),
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
			nameInput = crew!.name; // restore original before blur fires
			editingName = false;
		}
	}

	// --- Modal ---

	function openCreate() {
		editTarget = null;
		fname = '';
		frole = '';
		fexpertise = [];
		fprompt = '';
		fcanReview = true;
		tagInput = '';
		formErrors = {};
		showModal = true;
	}

	function openEdit(agent: AgentData) {
		editTarget = agent;
		fname = agent.name;
		frole = agent.role;
		fexpertise = [...agent.expertise];
		fprompt = agent.system_prompt;
		fcanReview = agent.can_review;
		tagInput = '';
		formErrors = {};
		showModal = true;
	}

	function closeModal() {
		if (!submitting) showModal = false;
	}

	// --- Tag input ---

	function addTag() {
		const tag = tagInput.trim().replace(/,$/, '');
		if (tag && !fexpertise.includes(tag)) fexpertise = [...fexpertise, tag];
		tagInput = '';
	}

	function removeTag(tag: string) {
		fexpertise = fexpertise.filter((t) => t !== tag);
	}

	function onTagKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addTag();
		} else if (e.key === 'Backspace' && !tagInput && fexpertise.length > 0) {
			fexpertise = fexpertise.slice(0, -1);
		}
	}

	// --- Form submit ---

	function validate(): boolean {
		const errs: Record<string, string> = {};
		if (!fname.trim()) errs.name = 'Name is required';
		if (!frole.trim()) errs.role = 'Role is required';
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
				role: frole.trim(),
				expertise: fexpertise,
				system_prompt: fprompt.trim(),
				can_review: fcanReview
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
			if (deleteTarget) deleteTarget = null;
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
						<div class="skeleton h-3 w-16 rounded"></div>
					</div>
					<div class="flex gap-1 mb-3">
						{#each Array(3) as _}
							<div class="skeleton h-5 w-14 rounded"></div>
						{/each}
					</div>
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
					<!-- Defensive fallback — status is always one of idle/working/reviewing from getCrew() -->
				{@const cfg = STATUS_CFG[agent.status as keyof typeof STATUS_CFG] ?? STATUS_CFG.idle}
					<div
						class="agent-card flex flex-col p-4 bg-surface border rounded hover:-translate-y-0.5 transition-all duration-200 fade-up {cfg.cardBorder}"
						style="{cfg.cardGlow ? `box-shadow: ${cfg.cardGlow};` : ''}animation-delay: {i * 50}ms"
					>
						<!-- Name + role -->
						<div class="flex items-start justify-between gap-2 mb-3">
							<div class="min-w-0">
								<h2 class="text-primary font-semibold truncate">{agent.name}</h2>
								<p class="text-cyan text-xs mt-0.5 truncate">{agent.role}</p>
							</div>
							{#if agent.can_review}
								<span class="text-xs text-green flex-shrink-0 mt-0.5">✓ reviewer</span>
							{:else}
								<span class="text-xs text-muted flex-shrink-0 mt-0.5">✗ no review</span>
							{/if}
						</div>

						<!-- Expertise tags -->
						{#if agent.expertise.length > 0}
							<div class="flex flex-wrap gap-1 mb-3">
								{#each agent.expertise as tag (tag)}
									<span
										class="text-xs px-1.5 py-0.5 rounded border border-edge text-muted"
										style="text-shadow: 0 0 6px rgba(161,161,170,0.2)"
									>
										{tag}
									</span>
								{/each}
							</div>
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
	{/if}
</div>

<!-- Create / Edit Modal -->
{#if showModal}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => e.target === e.currentTarget && closeModal()}
		role="dialog"
		aria-modal="true"
		aria-label={editTarget ? 'Edit Agent' : 'Add Agent'}
	>
		<div class="bg-surface border border-edge rounded w-full max-w-lg mx-4 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
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

			<form onsubmit={handleSubmit} class="space-y-4">
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

				<!-- Role -->
				<div>
					<label for="agent-role" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Role <span class="text-red">*</span>
					</label>
					<input
						id="agent-role"
						bind:value={frole}
						placeholder="e.g. Senior Software Engineer"
						class="w-full bg-base border rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none transition-colors {formErrors.role ? 'border-red' : 'border-edge focus:border-cyan'}"
					/>
					{#if formErrors.role}
						<p class="text-red text-xs mt-1">{formErrors.role}</p>
					{/if}
				</div>

				<!-- Expertise tags -->
				<div>
					<label class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Expertise
					</label>
					<div
						class="w-full bg-base border border-edge rounded px-3 py-2 flex flex-wrap gap-1.5 min-h-[40px] focus-within:border-cyan transition-colors"
					>
						{#each fexpertise as tag (tag)}
							<span class="inline-flex items-center gap-1 text-xs bg-surface-hi border border-edge px-1.5 py-0.5 rounded text-secondary">
								{tag}
								<button
									type="button"
									onclick={() => removeTag(tag)}
									class="text-muted hover:text-red transition-colors leading-none"
									aria-label="Remove {tag}"
								>
									×
								</button>
							</span>
						{/each}
						<input
							bind:value={tagInput}
							onkeydown={onTagKeydown}
							placeholder={fexpertise.length === 0 ? 'Type and press Enter…' : ''}
							class="flex-1 min-w-[120px] bg-transparent text-sm text-primary placeholder:text-muted outline-none"
						/>
					</div>
					<p class="text-muted text-xs mt-1">Press Enter or comma to add a tag</p>
				</div>

				<!-- System Prompt -->
				<div>
					<label for="agent-prompt" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						System Prompt <span class="text-red">*</span>
					</label>
					<textarea
						id="agent-prompt"
						bind:value={fprompt}
						rows="5"
						placeholder="You are {fname || 'an AI agent'}…"
						class="w-full bg-base border rounded px-3 py-2 text-sm text-primary placeholder:text-muted outline-none transition-colors resize-y {formErrors.prompt ? 'border-red' : 'border-edge focus:border-cyan'}"
					></textarea>
					{#if formErrors.prompt}
						<p class="text-red text-xs mt-1">{formErrors.prompt}</p>
					{/if}
				</div>

				<!-- Can Review toggle -->
				<div class="flex items-center justify-between py-1">
					<span class="text-xs text-muted uppercase tracking-widest">Can Review</span>
					<button
						type="button"
						onclick={() => (fcanReview = !fcanReview)}
						class="relative w-10 h-5 rounded-full transition-colors duration-200 {fcanReview ? 'bg-green/30 border border-green/50' : 'bg-surface-hi border border-edge'}"
						aria-label="Toggle can review"
						role="switch"
						aria-checked={fcanReview}
					>
						<span
							class="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 {fcanReview ? 'left-5 bg-green' : 'left-0.5 bg-muted'}"
						></span>
					</button>
				</div>

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
		</div>
	</div>
{/if}

<!-- Delete Confirmation Dialog -->
{#if deleteTarget}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => e.target === e.currentTarget && (deleteTarget = null)}
		role="dialog"
		aria-modal="true"
		aria-label="Delete Agent"
	>
		<div class="bg-surface border border-edge rounded w-full max-w-sm mx-4 p-6 shadow-2xl">
			<h2 class="text-primary font-bold uppercase tracking-wide text-sm mb-4">Delete Agent</h2>

			{#if deleteTarget.current_issue}
				<!-- Blocked: agent is active -->
				<div class="mb-5">
					<p class="text-amber text-sm mb-2">
						⚠ Cannot delete <span class="text-primary font-semibold">{deleteTarget.name}</span> while they're assigned to an active issue.
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
		</div>
	</div>
{/if}

<style>
	/* Pulse animation for working/reviewing status dots */
	.status-dot.pulse {
		animation: status-pulse 2s ease-in-out infinite;
	}

	@keyframes status-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	/* Subtle hover lift for agent cards */
	.agent-card {
		cursor: default;
	}
</style>
