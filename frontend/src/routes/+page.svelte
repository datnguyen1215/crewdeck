<script lang="ts">
	import { listProjects } from '$lib/mock/api.js';

	let projects = $state<Awaited<ReturnType<typeof listProjects>>>([]);

	$effect(() => {
		listProjects().then((data) => (projects = data));
	});
</script>

<div class="p-8">
	<div class="mb-8">
		<h1 class="text-2xl font-bold text-primary tracking-wide uppercase">Projects</h1>
		<p class="text-secondary text-sm mt-1">Select a project to view its issue board.</p>
	</div>

	<div class="grid gap-3 max-w-2xl">
		{#each projects as project (project.id)}
			<a
				href="/projects/{project.id}"
				class="block p-4 bg-surface border border-edge rounded hover:border-edge-hi hover:bg-surface-hi transition-colors group"
			>
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="text-primary font-semibold group-hover:text-cyan transition-colors">
							{project.name}
						</h2>
						{#if project.description}
							<p class="text-secondary text-sm mt-1">{project.description}</p>
						{/if}
					</div>
					<span class="text-muted text-xs flex-shrink-0 mt-1">#{project.id}</span>
				</div>
			</a>
		{:else}
			<p class="text-muted text-sm">No projects yet.</p>
		{/each}
	</div>
</div>
