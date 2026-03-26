<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { createTerminalSession, getTerminalSession, type Project, getProject } from '$lib/api/http.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import Terminal from '$lib/components/Terminal.svelte';

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let sessionReady = $state(false);

	onMount(async () => {
		try {
			// Load project info
			project = await getProject(projectId);

			// Check if terminal session exists
			const status = await getTerminalSession(projectId);

			if (!status.exists) {
				// Create new terminal session
				await createTerminalSession(projectId);
			}

			sessionReady = true;
		} catch (err) {
			console.error('Failed to initialize terminal:', err);
			error = err instanceof Error ? err.message : 'Failed to initialize terminal';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>{project?.name ? `Captain Terminal - ${project.name} - CrewDeck` : 'Captain Terminal - CrewDeck'}</title>
</svelte:head>

<div class="h-full flex flex-col pt-12 md:pt-0">
	<!-- Header -->
	<div class="p-3 md:p-4 border-b border-edge flex-shrink-0">
		<Breadcrumb segments={[
			{ label: 'Projects', href: '/' },
			{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
			{ label: 'Captain Terminal' }
		]} />
		<div class="mt-3 flex items-center gap-3">
			<div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center flex-shrink-0">
				<svg class="w-4 h-4 text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="2" y="3" width="20" height="14" rx="2"/>
					<path d="M6 7l4 4-4 4"/>
					<path d="M12 15h6"/>
				</svg>
			</div>
			<div class="min-w-0">
				<h1 class="text-base md:text-lg font-bold text-primary truncate">Captain Terminal</h1>
				<p class="text-xs text-muted">Direct terminal access to captain chat</p>
			</div>
		</div>
	</div>

	<!-- Terminal content -->
	<div class="flex-1 p-3 md:p-4 overflow-auto">
		{#if loading}
			<div class="flex items-center justify-center h-full">
				<div class="text-center">
					<div class="animate-spin w-8 h-8 border-2 border-cyan border-t-transparent rounded-full mx-auto mb-3"></div>
					<p class="text-muted text-sm">Initializing terminal session...</p>
				</div>
			</div>
		{:else if error}
			<div class="flex items-center justify-center h-full">
				<div class="text-center max-w-md">
					<div class="w-12 h-12 rounded-full bg-red/20 flex items-center justify-center mx-auto mb-3">
						<svg class="w-6 h-6 text-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10"/>
							<line x1="12" y1="8" x2="12" y2="12"/>
							<line x1="12" y1="16" x2="12.01" y2="16"/>
						</svg>
					</div>
					<h2 class="text-lg font-bold text-primary mb-2">Failed to Initialize</h2>
					<p class="text-sm text-muted mb-4">{error}</p>
					<button
						onclick={() => window.location.reload()}
						class="px-4 py-2 bg-cyan text-black rounded hover:bg-cyan/80 transition-colors text-sm font-medium"
					>
						Retry
					</button>
				</div>
			</div>
		{:else if sessionReady}
			<Terminal projectId={projectId} />
		{/if}
	</div>
</div>
