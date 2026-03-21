<script lang="ts">
	import { page } from '$app/stores';
	import { getProject, updateProject, type Project } from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Settings - ${project.name} - CrewDeck` : 'Settings - CrewDeck');
	let loading = $state(true);
	let saving = $state(false);

	let name = $state('');
	let description = $state('');
	let maxConcurrency = $state(1);

	$effect(() => {
		loading = true;
		getProject(projectId)
			.then((p) => {
				project = p;
				name = p.name;
				description = p.description ?? '';
				maxConcurrency = p.max_concurrency;
			})
			.catch(() => { toastStore.add('Failed to load project', 'error'); })
			.finally(() => { loading = false; });
	});

	let hasChanges = $derived(
		project != null && (
			name !== project.name ||
			description !== (project.description ?? '') ||
			maxConcurrency !== project.max_concurrency
		)
	);

	async function save() {
		if (!hasChanges || !project) return;
		saving = true;
		try {
			const updated = await updateProject(project.id, {
				name: name.trim(),
				description: description.trim() || null,
				max_concurrency: Number(maxConcurrency),
			});
			project = updated;
			name = updated.name;
			description = updated.description ?? '';
			maxConcurrency = updated.max_concurrency;
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
		maxConcurrency = project.max_concurrency;
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="p-8 h-full overflow-auto">
	<div class="max-w-xl">
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
					<label for="settings-concurrency" class="block text-xs text-muted uppercase tracking-widest mb-1.5">Max Concurrency</label>
					<input id="settings-concurrency" type="number" bind:value={maxConcurrency} min="1" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors" />
					<p class="text-muted text-xs mt-1">Maximum concurrent agent processes per project</p>
				</div>

				<div class="flex gap-3 mt-2">
					<button type="button" onclick={reset} disabled={!hasChanges || saving} class="px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors disabled:opacity-50">Reset</button>
					<button type="submit" disabled={!hasChanges || saving} class="px-4 py-2 bg-cyan/10 border border-cyan rounded text-sm text-cyan hover:bg-cyan/20 transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Save Changes'}</button>
				</div>
			</form>
		{/if}
	</div>
</div>
