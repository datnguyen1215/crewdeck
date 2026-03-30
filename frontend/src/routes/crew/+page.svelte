<script lang="ts">
	import {
		listAllAgents,
		listAgentConfig,
		setAgentModel,
		deleteAgentConfig,
		getGlobalConfig,
		setProvider,
		isGlmAvailable,
		type Agent,
		type AgentConfig,
		type Provider
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let agents = $state<Agent[]>([]);
	let configs = $state<AgentConfig[]>([]);
	let currentProvider = $state<Provider>('claude');
	let glmAvailable = $state(false);
	let loading = $state(true);
	let saving = $state<Record<string, boolean>>({});
	let providerSaving = $state(false);
	let showConfirmDialog = $state(false);
	let pendingProvider = $state<Provider | null>(null);

	$effect(() => {
		let cancelled = false;
		loading = true;
		Promise.all([listAllAgents(), listAgentConfig(), getGlobalConfig(), isGlmAvailable()])
			.then(([a, c, g, glm]) => {
				if (cancelled) return;
				agents = a;
				configs = c;
				currentProvider = g.provider;
				glmAvailable = glm.available;
			})
			.catch(() => { if (!cancelled) toastStore.add('Failed to load crew', 'error'); })
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	function getAgentModel(agentId: string): string {
		return configs.find(c => c.agent_id === agentId)?.model ?? '';
	}

	async function onModelChange(agentId: string, value: string) {
		saving = { ...saving, [agentId]: true };
		try {
			if (value === '') {
				await deleteAgentConfig(agentId);
				configs = configs.filter(c => c.agent_id !== agentId);
			} else {
				const updated = await setAgentModel(agentId, value);
				const idx = configs.findIndex(c => c.agent_id === agentId);
				if (idx >= 0) {
					configs = configs.map(c => c.agent_id === agentId ? updated : c);
				} else {
					configs = [...configs, updated];
				}
			}
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to save model', 'error');
		} finally {
			saving = { ...saving, [agentId]: false };
		}
	}

	function onProviderSelect(e: Event) {
		const value = (e.target as HTMLSelectElement).value as Provider;
		if (value === currentProvider) return;
		pendingProvider = value;
		showConfirmDialog = true;
	}

	async function confirmProviderSwitch() {
		if (!pendingProvider) return;
		showConfirmDialog = false;
		providerSaving = true;
		try {
			const result = await setProvider(pendingProvider);
			currentProvider = result.provider;
			toastStore.add(`Switched to ${result.provider === 'glm' ? 'GLM (Z.AI)' : 'Claude (Pro Max)'}`, 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to switch provider', 'error');
		} finally {
			providerSaving = false;
			pendingProvider = null;
		}
	}

	function cancelProviderSwitch() {
		showConfirmDialog = false;
		pendingProvider = null;
	}
</script>

<svelte:head>
	<title>Crew - CrewDeck</title>
</svelte:head>

<div class="p-6 h-full overflow-auto">
	<div class="mb-8">
		<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Crew</h1>
		<p class="text-muted text-xs mt-1">
			{#if loading}Loading crew members…{:else}{agents.length} member{agents.length !== 1 ? 's' : ''}{/if}
		</p>
	</div>

	<!-- Provider Toggle -->
	<div class="mb-6 p-4 bg-surface border border-edge rounded max-w-md">
		<label for="provider-select" class="block text-xs text-muted uppercase tracking-widest mb-2">AI Provider</label>
		<select
			id="provider-select"
			value={currentProvider}
			onchange={onProviderSelect}
			disabled={loading || providerSaving}
			class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors disabled:opacity-50"
		>
			<option value="claude">Claude (Pro Max)</option>
			<option value="glm" disabled={!glmAvailable}>GLM (Z.AI){!glmAvailable ? ' — ZAI_API_KEY not set' : ''}</option>
		</select>
		{#if !glmAvailable}
			<p class="text-muted text-xs mt-1.5">Set ZAI_API_KEY environment variable to enable GLM</p>
		{/if}
	</div>

	{#if loading}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
			{#each Array(5) as _, i}
				<div class="flex flex-col p-4 bg-surface border border-edge rounded fade-up" style="animation-delay: {i * 50}ms">
					<div class="skeleton h-4 w-3/5 rounded mb-1.5"></div>
					<div class="skeleton h-3 w-2/5 rounded mb-3"></div>
					<div class="skeleton h-3 w-4/5 rounded mb-4"></div>
					<div class="skeleton h-8 w-full rounded mt-auto"></div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
			{#each agents as agent, i (agent.id)}
				{@const currentModel = getAgentModel(agent.id)}
				<div class="flex flex-col p-4 bg-surface border border-edge rounded hover:-translate-y-0.5 transition-all duration-200 fade-up" style="animation-delay: {i * 50}ms">
					<div class="mb-3">
						<h2 class="text-primary font-semibold truncate">{agent.name}</h2>
						<p class="text-cyan text-xs mt-0.5 truncate">{agent.title}</p>
					</div>
					{#if agent.description}
						<p class="text-muted text-xs line-clamp-2 mb-4" title={agent.description}>{agent.description}</p>
					{/if}
					<div class="mt-auto">
						<label for="model-{agent.id}" class="block text-xs text-muted uppercase tracking-widest mb-1.5">Model</label>
						<select
							id="model-{agent.id}"
							value={currentModel}
							onchange={(e) => onModelChange(agent.id, (e.target as HTMLSelectElement).value)}
							disabled={saving[agent.id]}
							class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors disabled:opacity-50"
						>
							<option value="">Default (Sonnet)</option>
							<option value="sonnet">Sonnet</option>
							<option value="opus">Opus</option>
						</select>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Confirmation Dialog -->
{#if showConfirmDialog}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
		<div class="bg-surface border border-edge rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
			<h2 class="text-primary font-semibold text-lg mb-3">Switch Provider?</h2>
			<p class="text-muted text-sm mb-6">
				This will restart all active Captain terminal sessions.
				Existing agent runs will continue with their original provider until completion.
			</p>
			<div class="flex justify-end gap-3">
				<button
					onclick={cancelProviderSwitch}
					class="px-4 py-2 text-sm text-muted hover:text-primary border border-edge rounded transition-colors"
				>
					Cancel
				</button>
				<button
					onclick={confirmProviderSwitch}
					class="px-4 py-2 text-sm bg-cyan text-base font-medium rounded hover:opacity-90 transition-opacity"
				>
					Switch Provider
				</button>
			</div>
		</div>
	</div>
{/if}
