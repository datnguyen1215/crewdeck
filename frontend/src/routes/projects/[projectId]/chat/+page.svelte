<script lang="ts">
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import { getProject, type Project } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import MonitorPanel from '$lib/components/MonitorPanel.svelte';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let projectId = $derived($page.params.projectId!);
	let ws = $derived(getWs());
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Captain - ${project.name} - CrewDeck` : 'Captain - CrewDeck');

	// Mobile tab state: default from URL search param
	let activeTab = $state<'chat' | 'monitor'>(
		$page.url.searchParams.get('panel') === 'monitor' ? 'monitor' : 'chat'
	);

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
				<p class="text-xs text-muted">Chat & Monitor</p>
			</div>
		</div>
	</div>

	<!-- Mobile tabs -->
	<div class="flex md:hidden border-b border-edge flex-shrink-0">
		<button
			onclick={() => activeTab = 'chat'}
			class="flex-1 py-3 text-sm font-mono text-center transition-colors
				{activeTab === 'chat' ? 'text-cyan border-b-2 border-cyan bg-cyan/5' : 'text-muted hover:text-secondary'}"
		>
			Chat
		</button>
		<button
			onclick={() => activeTab = 'monitor'}
			class="flex-1 py-3 text-sm font-mono text-center transition-colors
				{activeTab === 'monitor' ? 'text-cyan border-b-2 border-cyan bg-cyan/5' : 'text-muted hover:text-secondary'}"
		>
			Monitor
		</button>
	</div>

	<!-- Panels -->
	<div class="flex-1 flex min-h-0">
		<!-- Chat panel -->
		<div class="flex-1 min-w-0 border-r border-edge
			{activeTab === 'chat' ? 'flex' : 'hidden'} md:flex flex-col">
			<div class="px-3 md:px-4 py-2 border-b border-edge flex-shrink-0 bg-surface/30">
				<span class="text-xs font-mono text-cyan">Chat</span>
			</div>
			<div class="flex-1 min-h-0">
				<ChatPanel {projectId} {ws} />
			</div>
		</div>

		<!-- Monitor panel -->
		<div class="flex-1 min-w-0
			{activeTab === 'monitor' ? 'flex' : 'hidden'} md:flex flex-col">
			<div class="px-3 md:px-4 py-2 border-b border-edge flex-shrink-0 bg-surface/30">
				<span class="text-xs font-mono text-purple">Monitor</span>
			</div>
			<div class="flex-1 min-h-0">
				<MonitorPanel {ws} />
			</div>
		</div>
	</div>
</div>
