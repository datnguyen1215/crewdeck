<script lang="ts">
	import {
		listAllAgents,
		listAgentConfig,
		setAgentModel,
		deleteAgentConfig,
		type Agent,
		type AgentConfig
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let agents = $state<Agent[]>([]);
	let configs = $state<AgentConfig[]>([]);
	let loading = $state(true);
	let saving = $state<Record<string, boolean>>({});

	$effect(() => {
		let cancelled = false;
		loading = true;
		Promise.all([listAllAgents(), listAgentConfig()])
			.then(([a, c]) => {
				if (cancelled) return;
				agents = a;
				configs = c;
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
