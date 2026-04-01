<script lang="ts">
	import { page } from '$app/stores';
	import {
		getProject,
		updateProject,
		listEnvironmentVariables,
		createEnvironmentVariable,
		updateEnvironmentVariable,
		deleteEnvironmentVariable,
		type Project,
		type EnvironmentVariable
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Settings - ${project.name} - CrewDeck` : 'Settings - CrewDeck');
	let loading = $state(true);
	let saving = $state(false);

	let name = $state('');
	let description = $state('');
	let defaultBaseBranch = $state('main');
	let maxConcurrency = $state(1);
	let maxChainDepth = $state(20);
	let agentTimeoutMinutes = $state(10);

	// Environment variables state
	let envVars = $state<EnvironmentVariable[]>([]);
	let envLoading = $state(false);
	let newEnvKey = $state('');
	let newEnvValue = $state('');
	let newEnvIsSecret = $state(false);
	let addingEnv = $state(false);
	let editingEnvId = $state<string | null>(null);
	let editEnvKey = $state('');
	let editEnvValue = $state('');
	let editEnvIsSecret = $state(false);
	let savingEnv = $state(false);
	let deletingEnvId = $state<string | null>(null);
	let confirmingDeleteEnvId = $state<string | null>(null);

	fetchEffect(
		() => getProject(projectId),
		{
			onData: (p) => {
				project = p;
				name = p.name;
				description = p.description ?? '';
				defaultBaseBranch = p.default_base_branch ?? 'main';
				maxConcurrency = p.max_concurrency;
				maxChainDepth = p.max_chain_depth;
				agentTimeoutMinutes = p.agent_timeout_minutes;
			},
			onError: 'Failed to load project',
			onLoading: (v) => { loading = v; },
		}
	);

	fetchEffect(
		() => listEnvironmentVariables(projectId),
		{
			onData: (vars) => { envVars = vars; },
			onError: 'Failed to load environment variables',
			onLoading: (v) => { envLoading = v; },
		}
	);

	async function confirmDeleteEnvVar(envVarId: string) {
		deletingEnvId = envVarId;
		try {
			await deleteEnvironmentVariable(projectId, envVarId);
			envVars = envVars.filter(v => v.id !== envVarId);
			toastStore.add('Environment variable deleted', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to delete variable', 'error');
		} finally {
			deletingEnvId = null;
			confirmingDeleteEnvId = null;
		}
	}

	async function addEnvVar() {
		if (!newEnvKey.trim()) return;
		addingEnv = true;
		try {
			const created = await createEnvironmentVariable(projectId, {
				key: newEnvKey.trim(),
				value: newEnvValue,
				is_secret: newEnvIsSecret
			});
			envVars = [...envVars, created];
			newEnvKey = '';
			newEnvValue = '';
			newEnvIsSecret = false;
			toastStore.add('Environment variable added', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to add variable', 'error');
		} finally {
			addingEnv = false;
		}
	}

	function startEditEnv(envVar: EnvironmentVariable) {
		editingEnvId = envVar.id;
		editEnvKey = envVar.key;
		editEnvValue = envVar.is_secret ? '' : envVar.value;
		editEnvIsSecret = envVar.is_secret;
	}

	function cancelEditEnv() {
		editingEnvId = null;
		editEnvKey = '';
		editEnvValue = '';
		editEnvIsSecret = false;
	}

	async function saveEnvEdit() {
		if (!editingEnvId || !editEnvKey.trim()) return;
		savingEnv = true;
		try {
			const data: { key?: string; value?: string; is_secret?: boolean } = {
				key: editEnvKey.trim(),
				is_secret: editEnvIsSecret
			};
			// Only send value if it was changed (not empty for secrets)
			if (editEnvValue) {
				data.value = editEnvValue;
			}
			const updated = await updateEnvironmentVariable(projectId, editingEnvId, data);
			envVars = envVars.map(v => v.id === updated.id ? updated : v);
			cancelEditEnv();
			toastStore.add('Environment variable updated', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to update variable', 'error');
		} finally {
			savingEnv = false;
		}
	}


	let hasChanges = $derived(
		project != null && (
			name !== project.name ||
			description !== (project.description ?? '') ||
			defaultBaseBranch !== (project.default_base_branch ?? 'main') ||
			maxConcurrency !== project.max_concurrency ||
			maxChainDepth !== project.max_chain_depth ||
			agentTimeoutMinutes !== project.agent_timeout_minutes
		)
	);

	async function save() {
		if (!hasChanges || !project) return;
		saving = true;
		try {
			const updated = await updateProject(project.id, {
				name: name.trim(),
				description: description.trim() || null,
				default_base_branch: defaultBaseBranch.trim() || 'main',
				max_concurrency: Number(maxConcurrency),
				max_chain_depth: Number(maxChainDepth),
				agent_timeout_minutes: Number(agentTimeoutMinutes),
			});
			project = updated;
			name = updated.name;
			description = updated.description ?? '';
			defaultBaseBranch = updated.default_base_branch ?? 'main';
			maxConcurrency = updated.max_concurrency;
			maxChainDepth = updated.max_chain_depth;
			agentTimeoutMinutes = updated.agent_timeout_minutes;
			toastStore.add('Settings saved', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to save', 'error');
		} finally {
			saving = false;
		}
	}

	function reset() {
		if (!project) return;
		name = project.name;
		description = project.description ?? '';
		defaultBaseBranch = project.default_base_branch ?? 'main';
		maxConcurrency = project.max_concurrency;
		maxChainDepth = project.max_chain_depth;
		agentTimeoutMinutes = project.agent_timeout_minutes;
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="p-8 h-full overflow-auto">
	<div class="max-w-xl">
		<!-- Breadcrumb -->
		<div class="mb-5">
			<Breadcrumb segments={[
				{ label: 'Projects', href: '/' },
				{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
				{ label: 'Settings' }
			]} />
		</div>

		<h1 class="text-sm font-bold tracking-[0.3em] uppercase mb-8 fade-up" style="color: var(--color-cyan); text-shadow: var(--glow-cyan)">Project Settings</h1>

		{#if loading}
			<div class="flex flex-col gap-4">
				{#each Array(3) as _}<div class="skeleton h-10 w-full rounded"></div>{/each}
			</div>
		{:else if project}
			<form onsubmit={(e) => { e.preventDefault(); save(); }} class="flex flex-col gap-5 fade-up">
				<div>
					<label for="settings-name" class="block text-xs text-muted uppercase tracking-widest mb-1.5">Name</label>
					<input id="settings-name" type="text" bind:value={name} class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors" />
				</div>

				<div>
					<label for="settings-desc" class="block text-xs text-muted uppercase tracking-widest mb-1.5">Description</label>
					<textarea id="settings-desc" bind:value={description} placeholder="Optional description..." rows="3" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors resize-none"></textarea>
				</div>

				<div>
					<label for="settings-base-branch" class="block text-xs text-muted uppercase tracking-widest mb-1.5">Default Base Branch</label>
					<input id="settings-base-branch" type="text" bind:value={defaultBaseBranch} placeholder="main" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary font-mono placeholder-muted focus:outline-none focus:border-cyan transition-colors" />
					<p class="text-muted text-xs mt-1">Branch that new issues will target by default (e.g. main, develop)</p>
				</div>

				<div>
					<label for="settings-concurrency" class="block text-xs text-muted uppercase tracking-widest mb-1.5">Max Concurrency</label>
					<input id="settings-concurrency" type="number" bind:value={maxConcurrency} min="1" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors" />
					<p class="text-muted text-xs mt-1">Maximum concurrent agent processes per project</p>
				</div>

				<div>
					<label for="settings-chain-depth" class="block text-xs text-muted uppercase tracking-widest mb-1.5">Max Chain Depth</label>
					<input id="settings-chain-depth" type="number" bind:value={maxChainDepth} min="1" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors" />
					<p class="text-muted text-xs mt-1">Maximum agent dispatches per issue before requiring manual reset</p>
				</div>

				<div>
					<label for="settings-agent-timeout" class="block text-xs text-muted uppercase tracking-widest mb-1.5">Agent Timeout (minutes)</label>
					<input id="settings-agent-timeout" type="number" bind:value={agentTimeoutMinutes} min="1" max="60" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors" />
					<p class="text-muted text-xs mt-1">Maximum time an agent can run before being terminated (1-60 minutes)</p>
				</div>

				<div class="flex gap-3 mt-2">
					<button type="button" onclick={reset} disabled={!hasChanges || saving} class="px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors disabled:opacity-50">Reset</button>
					<button type="submit" disabled={!hasChanges || saving} class="px-4 py-2 bg-cyan/10 border border-cyan rounded text-sm text-cyan hover:bg-cyan/20 transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Save Changes'}</button>
				</div>
			</form>

			<!-- Environment Variables Section -->
			<div class="mt-12 fade-up">
				<h2 class="text-sm font-bold tracking-[0.3em] uppercase mb-6" style="color: var(--color-cyan); text-shadow: var(--glow-cyan)">Environment Variables</h2>
				<p class="text-muted text-xs mb-4">Variables available to agents during execution. Secret values are masked.</p>

				{#if envLoading}
					<div class="flex flex-col gap-2">
						{#each Array(2) as _}<div class="skeleton h-10 w-full rounded"></div>{/each}
					</div>
				{:else}
					<!-- Existing variables -->
					{#if envVars.length > 0}
						<div class="flex flex-col gap-2 mb-4">
							{#each envVars as envVar (envVar.id)}
								{#if editingEnvId === envVar.id}
									<div class="flex gap-2 items-start p-3 bg-base border border-edge rounded">
										<input type="text" bind:value={editEnvKey} placeholder="KEY" class="flex-1 bg-elevated border border-edge rounded px-2 py-1.5 text-sm text-primary font-mono focus:outline-none focus:border-cyan transition-colors" />
										<input type="text" bind:value={editEnvValue} placeholder={envVar.is_secret ? 'Enter new value...' : 'Value'} class="flex-1 bg-elevated border border-edge rounded px-2 py-1.5 text-sm text-primary font-mono focus:outline-none focus:border-cyan transition-colors" />
										<label class="flex items-center gap-1 text-xs text-muted whitespace-nowrap">
											<input type="checkbox" bind:checked={editEnvIsSecret} class="accent-cyan" />
											Secret
										</label>
										<button onclick={saveEnvEdit} disabled={savingEnv || !editEnvKey.trim()} class="px-2 py-1.5 bg-cyan/10 border border-cyan rounded text-xs text-cyan hover:bg-cyan/20 transition-colors disabled:opacity-50">
											{savingEnv ? '...' : 'Save'}
										</button>
										<button onclick={cancelEditEnv} class="px-2 py-1.5 border border-edge rounded text-xs text-secondary hover:text-primary transition-colors">
											Cancel
										</button>
									</div>
								{:else}
									<div class="flex gap-2 items-center p-3 bg-base border border-edge rounded group">
										<span class="font-mono text-sm text-primary">{envVar.key}</span>
										<span class="text-muted">=</span>
										<span class="font-mono text-sm text-secondary flex-1 truncate">{envVar.value}</span>
										{#if envVar.is_secret}
											<span class="text-xs text-muted bg-elevated px-1.5 py-0.5 rounded">secret</span>
										{/if}
										<button onclick={() => startEditEnv(envVar)} class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-secondary hover:text-primary transition-all">
											Edit
										</button>
										{#if confirmingDeleteEnvId === envVar.id}
											<button onclick={() => confirmDeleteEnvVar(envVar.id)} disabled={deletingEnvId === envVar.id} class="px-2 py-1 text-xs text-red-400 hover:text-red-300 transition-all disabled:opacity-50">
												{deletingEnvId === envVar.id ? '...' : 'Confirm'}
											</button>
											<button onclick={() => confirmingDeleteEnvId = null} class="px-2 py-1 text-xs text-muted hover:text-secondary transition-all">
												Cancel
											</button>
										{:else}
											<button onclick={() => confirmingDeleteEnvId = envVar.id} class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-red-400 hover:text-red-300 transition-all">
												Delete
											</button>
										{/if}
									</div>
								{/if}
							{/each}
						</div>
					{/if}

					<!-- Add new variable -->
					<form onsubmit={(e) => { e.preventDefault(); addEnvVar(); }} class="flex gap-2 items-start">
						<input type="text" bind:value={newEnvKey} placeholder="KEY" class="flex-1 bg-base border border-edge rounded px-3 py-2 text-sm text-primary font-mono placeholder-muted focus:outline-none focus:border-cyan transition-colors" />
						<input type="text" bind:value={newEnvValue} placeholder="Value" class="flex-1 bg-base border border-edge rounded px-3 py-2 text-sm text-primary font-mono placeholder-muted focus:outline-none focus:border-cyan transition-colors" />
						<label class="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap py-2">
							<input type="checkbox" bind:checked={newEnvIsSecret} class="accent-cyan" />
							Secret
						</label>
						<button type="submit" disabled={addingEnv || !newEnvKey.trim()} class="px-4 py-2 bg-cyan/10 border border-cyan rounded text-sm text-cyan hover:bg-cyan/20 transition-colors disabled:opacity-50">
							{addingEnv ? 'Adding...' : 'Add'}
						</button>
					</form>
				{/if}
			</div>
		{/if}
	</div>
</div>
