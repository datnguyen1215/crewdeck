<script lang="ts">
	import {
		listGlobalEnvironmentVariables,
		createGlobalEnvironmentVariable,
		updateGlobalEnvironmentVariable,
		deleteGlobalEnvironmentVariable,
		type GlobalEnvironmentVariable
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { fetchEffect } from '$lib/utils/fetch-effect.svelte.js';

	// Environment variables state
	let envVars = $state<GlobalEnvironmentVariable[]>([]);
	let envLoading = $state(true);
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
		() => listGlobalEnvironmentVariables(),
		{
			onData: (vars) => { envVars = vars; },
			onError: 'Failed to load global environment variables',
			onLoading: (v) => { envLoading = v; },
		}
	);

	async function confirmDeleteEnvVar(envVarId: string) {
		deletingEnvId = envVarId;
		try {
			await deleteGlobalEnvironmentVariable(envVarId);
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
			const created = await createGlobalEnvironmentVariable({
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

	function startEditEnv(envVar: GlobalEnvironmentVariable) {
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
			const updated = await updateGlobalEnvironmentVariable(editingEnvId, data);
			envVars = envVars.map(v => v.id === updated.id ? updated : v);
			cancelEditEnv();
			toastStore.add('Environment variable updated', 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to update variable', 'error');
		} finally {
			savingEnv = false;
		}
	}
</script>

<svelte:head>
	<title>Settings - CrewDeck</title>
</svelte:head>

<div class="p-8 h-full overflow-auto">
	<div class="max-w-xl">
		<h1 class="text-sm font-bold tracking-[0.3em] uppercase mb-8 fade-up" style="color: var(--color-cyan); text-shadow: var(--glow-cyan)">Global Settings</h1>

		<!-- Global Environment Variables Section -->
		<div class="fade-up">
			<h2 class="text-sm font-bold tracking-[0.3em] uppercase mb-6" style="color: var(--color-cyan); text-shadow: var(--glow-cyan)">Environment Variables</h2>
			<p class="text-muted text-xs mb-4">Machine-wide variables available to all agents across all projects. Project-level variables override these if the same key exists. Secret values are masked.</p>

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
	</div>
</div>
