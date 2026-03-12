<script lang="ts">
	import { page } from '$app/stores';
	import { getCrew } from '$lib/mock/api.js';

	type Crew = Awaited<ReturnType<typeof getCrew>>;

	let crew = $state<Crew | null>(null);
	let projectId = $derived($page.params.projectId);

	$effect(() => {
		getCrew(projectId).then((data) => (crew = data));
	});
</script>

<div class="p-8">
	<div class="mb-8">
		<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Crew</h1>
		{#if crew}
			<p class="text-secondary text-sm mt-1">{crew.name} · {crew.agents.length} agents</p>
		{/if}
	</div>

	{#if crew}
		<div class="grid gap-3 max-w-2xl">
			{#each crew.agents as agent (agent.id)}
				<div class="p-4 bg-surface border border-edge rounded">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h2 class="text-primary font-semibold">{agent.name}</h2>
							<p class="text-cyan text-xs mt-0.5">{agent.role}</p>
							{#if agent.expertise.length > 0}
								<div class="flex flex-wrap gap-1.5 mt-2">
									{#each agent.expertise as tag (tag)}
										<span class="text-xs text-muted border border-edge px-1.5 py-0.5 rounded">
											{tag}
										</span>
									{/each}
								</div>
							{/if}
						</div>
						{#if agent.can_review}
							<span class="text-xs text-green flex-shrink-0">reviewer</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-muted text-sm">Loading...</p>
	{/if}
</div>
