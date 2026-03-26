<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { getProject, type Project } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let projectId = $derived($page.params.projectId!);
	let ws = $derived(getWs());
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Captain - ${project.name} - CrewDeck` : 'Captain - CrewDeck');

	$effect(() => {
		let cancelled = false;
		getProject(projectId).then((p) => { if (!cancelled) project = p; }).catch(() => {});
		return () => { cancelled = true; };
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="h-full flex flex-col pt-12 md:pt-0">
	<!-- Header -->
	<div class="p-3 md:p-4 border-b border-edge flex-shrink-0">
		<Breadcrumb segments={[
			{ label: 'Projects', href: '/' },
			{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
			{ label: 'Captain' }
		]} />
		<div class="mt-3 flex items-center gap-3">
			<div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center flex-shrink-0">
				<svg class="w-4 h-4 text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="18" height="18" rx="2"/>
					<path d="M7 8h4"/>
					<path d="M7 12h10"/>
					<path d="M7 16h6"/>
				</svg>
			</div>
			<div class="min-w-0">
				<h1 class="text-base md:text-lg font-bold text-primary truncate">Captain</h1>
				<p class="text-xs text-muted">Project orchestration chat</p>
			</div>
		</div>
	</div>

	<!-- Chat panel (full width) -->
	<div class="flex-1 min-h-0">
		<ChatPanel {projectId} {ws} />
	</div>
</div>
