<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		listGitHubAccounts,
		listAgents,
		createAgent,
		generateAgent,
		createEnvironmentVariable,
		type GitHubAccount,
		type Project,
		type Agent
	} from '$lib/api/http.js';
	import GitHubConnect from './GitHubConnect.svelte';
	import ProjectForm from './ProjectForm.svelte';

	let step = $state(1);
	let githubAccounts = $state<GitHubAccount[]>([]);
	let loading = $state(true);
	let createdProject = $state<Project | null>(null);

	const totalSteps = 5;

	// --- Agent Setup (step 3) ---
	let agents = $state<Agent[]>([]);
	let agentLoading = $state(false);
	let agentPrompt = $state('');
	let agentError = $state('');

	const TEMPLATES = [
		{ label: 'Developer', prompt: 'A senior full-stack developer who writes clean, well-tested code' },
		{ label: 'Reviewer', prompt: 'A meticulous code reviewer focused on quality, security, and best practices' }
	];

	// --- Environment Variables (step 4) ---
	let envVars = $state<{ id: number; key: string; value: string; is_secret: boolean }[]>([]);
	let envIdCounter = $state(0);
	let savedEnvCount = $state(0);
	let envSaving = $state(false);
	let envError = $state('');

	// Runs once on mount — no reactive deps
	$effect(() => {
		listGitHubAccounts()
			.then((data) => {
				githubAccounts = data;
				if (data.length > 0) step = 2;
			})
			.catch(() => {})
			.finally(() => { loading = false; });
	});

	function handleGitHubConnected(account: GitHubAccount) {
		githubAccounts = [...githubAccounts, account];
		step = 2;
	}

	function handleProjectCreated(project: Project) {
		createdProject = project;
		// Non-critical — agents are still accessible from the project dashboard if this fails
		listAgents(project.id)
			.then((a) => { agents = a; })
			.catch(() => {});
		step = 3;
	}

	// --- Agent helpers ---

	async function addAgent(prompt: string) {
		if (!createdProject || agentLoading) return;
		agentError = '';
		agentLoading = true;
		try {
			const generated = await generateAgent(createdProject.id, { prompt });
			const agent = await createAgent(createdProject.id, {
				name: generated.name,
				title: generated.title,
				description: generated.description,
				system_prompt: generated.system_prompt
			});
			agents = [...agents, agent];
		} catch (err) {
			agentError = err instanceof Error ? err.message : 'Failed to add agent';
		} finally {
			agentLoading = false;
		}
	}

	async function addFromPrompt() {
		if (!agentPrompt.trim()) return;
		await addAgent(agentPrompt.trim());
		if (!agentError) agentPrompt = '';
	}

	// --- Env var helpers ---

	function addEnvRow() {
		envVars = [...envVars, { id: ++envIdCounter, key: '', value: '', is_secret: false }];
	}

	function removeEnvRow(id: number) {
		envVars = envVars.filter((v) => v.id !== id);
	}

	async function saveEnvVars() {
		if (!createdProject) return;
		const valid = envVars.filter((v) => v.key.trim() && v.value.trim());
		if (valid.length === 0) {
			step = 5;
			return;
		}
		envSaving = true;
		envError = '';
		try {
			const results = await Promise.allSettled(
				valid.map((v) =>
					createEnvironmentVariable(createdProject!.id, {
						key: v.key.trim(),
						value: v.value.trim(),
						is_secret: v.is_secret
					})
				)
			);
			const succeededIds = new Set(
				valid.filter((_, i) => results[i].status === 'fulfilled').map((v) => v.id)
			);
			savedEnvCount += succeededIds.size;
			envVars = envVars.filter((v) => !succeededIds.has(v.id));
			const failed = results.filter((r) => r.status === 'rejected');
			if (failed.length > 0) {
				const reason = (failed[0] as PromiseRejectedResult).reason;
				envError = reason instanceof Error ? reason.message : 'Failed to save some environment variables';
			} else {
				step = 5;
			}
		} finally {
			envSaving = false;
		}
	}

	// --- Review & Launch ---

	let nonCaptainAgents = $derived(agents);

	function goToProject() {
		if (createdProject) goto(`/projects/${createdProject.id}`);
	}

	function goToProjectDashboard() {
		if (createdProject) goto(`/projects/${createdProject.id}`);
	}
</script>

<div class="flex flex-col items-center justify-center py-16 px-4" style="animation: fade-up 0.4s ease both">
	<!-- Step indicator -->
	<div class="flex items-center gap-2 mb-10">
		{#each Array(totalSteps) as _, i (i)}
			{@const stepNum = i + 1}
			<div class="flex items-center gap-2">
				<div
					class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors"
					class:bg-cyan={stepNum <= step}
					class:text-base={stepNum <= step}
					class:border-cyan={stepNum <= step}
					class:border-edge={stepNum > step}
					class:text-muted={stepNum > step}
				>
					{#if stepNum < step}
						&#10003;
					{:else}
						{stepNum}
					{/if}
				</div>
				{#if i < totalSteps - 1}
					<div
						class="w-8 h-px transition-colors"
						class:bg-cyan={stepNum < step}
						class:bg-edge={stepNum >= step}
					></div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Wizard card -->
	<div
		class="w-full max-w-md bg-surface border border-edge rounded-lg p-6"
		style="box-shadow: 0 0 40px rgba(0,0,0,0.4)"
	>
		{#if loading}
			<div class="flex flex-col items-center py-8">
				<span class="inline-block w-5 h-5 border-2 border-cyan border-t-transparent rounded-full animate-spin"></span>
			</div>
		{:else if step === 1}
			<!-- Step 1: Connect GitHub -->
			<div style="animation: fade-up 0.25s ease both">
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
					Connect GitHub
				</h2>
				<p class="text-muted text-xs mb-6">
					Link a GitHub account to access private repositories. You can skip this step and use host credentials instead.
				</p>

				<GitHubConnect onConnected={handleGitHubConnected} inline />

				<div class="mt-6 pt-4 border-t border-edge">
					<button
						onclick={() => { step = 2; }}
						class="w-full px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors"
					>
						Skip for now
					</button>
				</div>
			</div>
		{:else if step === 2}
			<!-- Step 2: Create Project -->
			<div style="animation: fade-up 0.25s ease both">
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
					Create Project
				</h2>
				<p class="text-muted text-xs mb-6">
					Point to a GitHub repository to create your first project. A captain agent will be auto-assigned.
				</p>

				<ProjectForm {githubAccounts} onCreated={handleProjectCreated} />
			</div>
		{:else if step === 3}
			<!-- Step 3: Agent Setup -->
			<div style="animation: fade-up 0.25s ease both">
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
					Add Agents
				</h2>
				<p class="text-muted text-xs mb-5">
					Add crew members to your project. Use a template or describe your own agent.
				</p>

				<!-- Recommended templates -->
				<div class="mb-4">
					<p class="text-xs text-muted uppercase tracking-widest mb-2">Quick Add</p>
					<div class="flex gap-2">
						{#each TEMPLATES as template (template.label)}
							<button
								onclick={() => addAgent(template.prompt)}
								disabled={agentLoading}
								class="flex-1 px-3 py-2 bg-base border border-edge rounded text-xs text-secondary hover:text-cyan hover:border-cyan transition-colors disabled:opacity-50"
							>
								+ {template.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Custom prompt -->
				<div class="mb-4">
					<p class="text-xs text-muted uppercase tracking-widest mb-2">Or Describe</p>
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={agentPrompt}
							placeholder="e.g. DevOps specialist for CI/CD"
							disabled={agentLoading}
							class="flex-1 bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors disabled:opacity-50"
							onkeydown={(e) => { if (e.key === 'Enter') addFromPrompt(); }}
						/>
						<button
							onclick={addFromPrompt}
							disabled={!agentPrompt.trim() || agentLoading}
							class="px-3 py-2 bg-cyan/10 border border-cyan text-cyan text-xs rounded hover:bg-cyan/20 transition-colors disabled:opacity-50"
						>
							{agentLoading ? '...' : 'Add'}
						</button>
					</div>
				</div>

				{#if agentLoading}
					<div class="flex items-center gap-2 text-muted text-xs mb-3">
						<span class="inline-block w-3 h-3 border-2 border-cyan border-t-transparent rounded-full animate-spin"></span>
						Generating agent...
					</div>
				{/if}

				{#if agentError}
					<p class="text-red text-xs mb-3">{agentError}</p>
				{/if}

				<!-- Added agents list -->
				{#if agents.length > 0}
					<div class="border-t border-edge pt-3 mb-4">
						<p class="text-xs text-muted uppercase tracking-widest mb-2">
							Agents ({agents.length})
						</p>
						<div class="space-y-1.5">
							{#each agents as agent (agent.id)}
								<div class="flex items-center gap-2 text-xs">
									<span class="text-cyan">&#10003;</span>
									<span class="text-primary">{agent.name}</span>
									<span class="text-muted">- {agent.title}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Both advance to step 4 — agents are already saved server-side as they're added -->
				<div class="flex gap-3 mt-4 pt-4 border-t border-edge">
					<button
						onclick={() => { step = 4; }}
						class="flex-1 px-4 py-2 bg-cyan/10 border border-cyan text-cyan rounded text-sm hover:bg-cyan/20 transition-colors uppercase tracking-wide"
					>
						Continue
					</button>
					<button
						onclick={() => { step = 4; }}
						class="px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors"
					>
						Skip
					</button>
				</div>
			</div>
		{:else if step === 4}
			<!-- Step 4: Environment Variables -->
			<div style="animation: fade-up 0.25s ease both">
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
					Environment Variables
				</h2>
				<p class="text-muted text-xs mb-5">
					Add secrets or config values that agents can access during execution.
				</p>

				{#if envVars.length > 0}
					<div class="space-y-2 mb-4">
						{#each envVars as envVar (envVar.id)}
							<div class="flex gap-2 items-start">
								<input
									type="text"
									bind:value={envVar.key}
									placeholder="KEY"
									class="w-1/3 bg-base border border-edge rounded px-2 py-1.5 text-xs text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors font-mono"
								/>
								<input
									type={envVar.is_secret ? 'password' : 'text'}
									bind:value={envVar.value}
									placeholder="value"
									class="flex-1 bg-base border border-edge rounded px-2 py-1.5 text-xs text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors font-mono"
								/>
								<label class="flex items-center gap-1 text-xs text-muted flex-shrink-0 pt-1.5" title="Mark as secret">
									<input
										type="checkbox"
										bind:checked={envVar.is_secret}
										class="w-3 h-3 rounded border border-edge bg-base accent-amber cursor-pointer"
									/>
									<span class="sr-only">Secret</span>
									&#128274;
								</label>
								<button
									onclick={() => removeEnvRow(envVar.id)}
									class="text-muted hover:text-red text-xs pt-1.5 transition-colors"
									aria-label="Remove"
								>
									&#10005;
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<button
					onclick={addEnvRow}
					class="w-full px-3 py-1.5 border border-dashed border-edge rounded text-xs text-muted hover:text-secondary hover:border-edge-hi transition-colors mb-4"
				>
					+ Add Variable
				</button>

				{#if envError}
					<p class="text-red text-xs mb-3">{envError}</p>
				{/if}

				<!-- Navigation -->
				<div class="flex gap-3 pt-4 border-t border-edge">
					<button
						onclick={saveEnvVars}
						disabled={envSaving}
						class="flex-1 px-4 py-2 bg-cyan/10 border border-cyan text-cyan rounded text-sm hover:bg-cyan/20 transition-colors uppercase tracking-wide disabled:opacity-50"
					>
						{envSaving ? 'Saving...' : 'Continue'}
					</button>
					<button
						onclick={() => { step = 5; }}
						disabled={envSaving}
						class="px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors disabled:opacity-50"
					>
						Skip
					</button>
				</div>
			</div>
		{:else if step === 5}
			<!-- Step 5: Review & Launch -->
			<div style="animation: fade-up 0.25s ease both">
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
					Review & Launch
				</h2>
				<p class="text-muted text-xs mb-5">
					Your project is configured. Review the summary below.
				</p>

				<!-- Summary -->
				<div class="space-y-3 mb-6">
					<div class="flex justify-between text-sm">
						<span class="text-muted">Project</span>
						<span class="text-cyan">{createdProject?.name}</span>
					</div>
					<div class="flex justify-between text-sm">
						<span class="text-muted">Agents</span>
						<span class="text-primary">{agents.length}</span>
					</div>
					<div class="flex justify-between text-sm">
						<span class="text-muted">Env Variables</span>
						<span class="text-primary">{savedEnvCount}</span>
					</div>
				</div>

				<!-- Actions -->
				<div class="space-y-3">
					<button
						onclick={goToProjectDashboard}
						class="w-full px-4 py-2.5 bg-cyan/10 border border-cyan text-cyan rounded text-sm hover:bg-cyan/20 transition-colors uppercase tracking-wide"
						style="box-shadow: var(--glow-cyan)"
					>
						Go to Dashboard
					</button>

					<button
						onclick={goToProject}
						class="w-full px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors"
					>
						Go to Project Dashboard
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
