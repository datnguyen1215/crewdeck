<script lang="ts">
	import {
		listAllAgents,
		listAgentConfig,
		setAgentModel,
		deleteAgentConfig,
		getGlobalConfig,
		setDefaultModel,
		getModelAvailability,
		type Agent,
		type AgentConfig
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let agents = $state<Agent[]>([]);
	let configs = $state<AgentConfig[]>([]);
	let defaultModel = $state('sonnet');
	let glmAvailable = $state(true);
	let loading = $state(true);
	let saving = $state<Record<string, boolean>>({});
	let defaultSaving = $state(false);

	const ALL_MODELS = [
		{ value: 'sonnet', label: 'Sonnet', provider: 'claude' },
		{ value: 'opus', label: 'Opus', provider: 'claude' },
		{ value: 'haiku', label: 'Haiku', provider: 'claude' },
		{ value: 'glm-5.1', label: 'GLM-5.1', provider: 'glm' },
		{ value: 'glm-5', label: 'GLM-5', provider: 'glm' },
		{ value: 'glm-5-turbo', label: 'GLM-5-Turbo', provider: 'glm' },
		{ value: 'glm-4.7', label: 'GLM-4.7', provider: 'glm' }
	];

	function modelLabel(value: string): string {
		return ALL_MODELS.find(m => m.value === value)?.label ?? value;
	}

	$effect(() => {
		let cancelled = false;
		loading = true;
		Promise.all([listAllAgents(), listAgentConfig(), getGlobalConfig(), getModelAvailability()])
			.then(([a, c, g, avail]) => {
				if (cancelled) return;
				agents = a;
				configs = c;
				defaultModel = g.default_model;
				glmAvailable = avail.glm_available;
			})
			.catch(() => { if (!cancelled) toastStore.add('Failed to load crew', 'error'); })
			.finally(() => { if (!cancelled) loading = false; });
		return () => { cancelled = true; };
	});

	function getAgentModel(agentId: string): string {
		return configs.find(c => c.agent_id === agentId)?.model ?? '';
	}

	async function onDefaultModelChange(value: string) {
		defaultSaving = true;
		try {
			const result = await setDefaultModel(value);
			defaultModel = result.default_model;
			toastStore.add(`Default model set to ${modelLabel(defaultModel)}`, 'success');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to save default model', 'error');
		} finally {
			defaultSaving = false;
		}
	}

	async function onModelChange(agentId: string, value: string) {
		saving = { ...saving, [agentId]: true };
		try {
			if (value === '') {
				await deleteAgentConfig(agentId);
				configs = configs.filter(c => c.agent_id !== agentId);
			} else {
				const updated = await setAgentModel(agentId, value);
				configs = configs.map(c => (c.agent_id === agentId) ? updated : c);
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

	<!-- Default Model -->
	<div class="mb-4 p-4 bg-surface border border-edge rounded max-w-md">
		<label for="default-model-select" class="block text-xs text-muted uppercase tracking-widest mb-2">Default Model</label>
		<select
			id="default-model-select"
			value={defaultModel}
			onchange={(e) => onDefaultModelChange((e.target as HTMLSelectElement).value)}
			disabled={loading || defaultSaving}
			class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors disabled:opacity-50"
		>
			{#each ALL_MODELS as model (model.value)}
				<option value={model.value} disabled={model.provider === 'glm' && !glmAvailable}>
					{model.label}{model.provider === 'glm' && !glmAvailable ? ' — unavailable' : ''}
				</option>
			{/each}
		</select>
		<p class="text-muted text-xs mt-1.5">All crew members use this unless overridden</p>
	</div>

	{#if !glmAvailable}
		<div class="mb-6 px-4 py-2.5 bg-surface border border-edge rounded max-w-md flex items-start gap-2">
			<span class="text-yellow-400 text-sm leading-5">⚠</span>
			<p class="text-muted text-xs leading-5">GLM models unavailable — ZAI_API_KEY not set</p>
		</div>
	{/if}

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
							<option value="">Default ({modelLabel(defaultModel)})</option>
							<optgroup label="Claude">
								{#each ALL_MODELS.filter(m => m.provider === 'claude') as model (model.value)}
									<option value={model.value}>{model.label}</option>
								{/each}
							</optgroup>
							<optgroup label="GLM">
								{#each ALL_MODELS.filter(m => m.provider === 'glm') as model (model.value)}
									<option value={model.value} disabled={!glmAvailable}>
										{model.label}{!glmAvailable ? ' — unavailable' : ''}
									</option>
								{/each}
							</optgroup>
						</select>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
