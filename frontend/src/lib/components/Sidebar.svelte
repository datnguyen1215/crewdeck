<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { listProjects, type Project } from '$lib/api/http.js';
	import { onMount } from 'svelte';

	const icons = {
		home: `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
		issues: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
		crew: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
		activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
		knowledge: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
		terminal: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h4"/><path d="M7 12h10"/><path d="M7 16h6"/>`,
		settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
		chevronRight: `<polyline points="9 18 15 12 9 6"/>`,
		chevronDown: `<polyline points="6 9 12 15 18 9"/>`,
		folder: `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`
	};

	let projects = $state<Project[]>([]);
	let expandedProjects = $state<Set<string>>(new Set());
	let projectId = $derived($page.params.projectId);
	let pathname = $derived($page.url.pathname);

	// Auto-expand current project when route changes
	$effect(() => {
		if (projectId && !expandedProjects.has(projectId)) {
			expandedProjects = new Set([...expandedProjects, projectId]);
		}
	});

	onMount(async () => {
		try {
			projects = await listProjects();
		} catch (e) {
			console.error('Failed to load projects:', e);
		}
	});

	function isActive(href: string) {
		return pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
	}

	function isProjectActive(pid: string) {
		return projectId === pid;
	}

	function toggleProject(pid: string) {
		if (expandedProjects.has(pid)) {
			const next = new Set(expandedProjects);
			next.delete(pid);
			expandedProjects = next;
		} else {
			expandedProjects = new Set([...expandedProjects, pid]);
			// Navigate to project issues if clicking a collapsed project
			if (projectId !== pid) {
				goto(`/projects/${pid}`);
			}
		}
	}
</script>

<nav
	class="group/sidebar flex flex-col w-14 hover:w-52 overflow-hidden transition-[width] duration-200 ease-in-out bg-base-hi border-r border-edge flex-shrink-0 h-full"
>
	<a
		href="/"
		class="flex items-center gap-3 px-4 py-5 border-b border-edge hover:bg-surface transition-colors flex-shrink-0"
	>
		<span class="text-cyan font-bold text-sm tracking-wider flex-shrink-0 w-6 text-center">CD</span>
		<span
			class="text-cyan font-bold uppercase tracking-widest text-xs whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75"
		>
			CREWDECK
		</span>
	</a>

	<div class="flex flex-col gap-1 p-2 flex-1 overflow-y-auto overflow-x-hidden">
		<!-- Projects list -->
		{#each projects as project (project.id)}
			{@const isExpanded = expandedProjects.has(project.id)}
			{@const isCurrent = isProjectActive(project.id)}
			<div>
				<!-- Project header -->
				<button
					onclick={() => toggleProject(project.id)}
					class="w-full flex items-center gap-2 px-3 py-2 rounded text-secondary hover:text-primary hover:bg-surface transition-colors whitespace-nowrap
					{isCurrent ? 'text-cyan' : ''}"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="flex-shrink-0 transition-transform duration-150 {isExpanded ? '' : '-rotate-90'}"
					>
						{@html icons.chevronDown}
					</svg>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="flex-shrink-0"
					>
						{@html icons.folder}
					</svg>
					<span
						class="text-sm opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 overflow-hidden text-ellipsis"
					>
						{project.name}
					</span>
				</button>

				<!-- Project sub-pages -->
				{#if isExpanded}
					<div class="ml-5 flex flex-col gap-0.5">
						{@render projectNavItem(`/projects/${project.id}`, 'Issues', 'issues', isActive(`/projects/${project.id}`) && !pathname.includes('/chat') && !pathname.includes('/activity') && !pathname.includes('/knowledge') && !pathname.includes('/settings'))}
						{@render projectNavItem(`/projects/${project.id}/chat`, 'Chat', 'terminal', isActive(`/projects/${project.id}/chat`))}
						{@render projectNavItem(`/projects/${project.id}/knowledge`, 'Knowledge', 'knowledge', isActive(`/projects/${project.id}/knowledge`))}
						{@render projectNavItem(`/projects/${project.id}/activity`, 'Activity', 'activity', isActive(`/projects/${project.id}/activity`))}
						{@render projectNavItem(`/projects/${project.id}/settings`, 'Settings', 'settings', isActive(`/projects/${project.id}/settings`))}
					</div>
				{/if}
			</div>
		{/each}

		<!-- Global Agents link -->
		<div class="border-t border-edge my-1"></div>
		{@render navItem('/crew', 'Agents', 'crew', isActive('/crew'))}

		<div class="mt-auto">
			<div class="border-t border-edge my-1"></div>
			{@render navItem('/settings', 'Settings', 'settings', isActive('/settings'))}
		</div>
	</div>
</nav>

{#snippet navItem(href: string, label: string, icon: keyof typeof icons, active: boolean)}
	<a
		{href}
		class="flex items-center gap-3 px-3 py-2.5 rounded text-secondary hover:text-primary hover:bg-surface transition-colors whitespace-nowrap
		{active ? 'text-cyan bg-surface' : ''}"
		style={active ? 'box-shadow: inset 2px 0 0 var(--color-cyan)' : ''}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="flex-shrink-0"
		>
			{@html icons[icon]}
		</svg>
		<span
			class="text-sm opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 overflow-hidden"
		>
			{label}
		</span>
	</a>
{/snippet}

{#snippet projectNavItem(href: string, label: string, icon: keyof typeof icons, active: boolean)}
	<a
		{href}
		class="flex items-center gap-2 px-2 py-1.5 rounded text-secondary hover:text-primary hover:bg-surface transition-colors whitespace-nowrap text-xs
		{active ? 'text-cyan bg-surface' : ''}"
		style={active ? 'box-shadow: inset 2px 0 0 var(--color-cyan)' : ''}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="flex-shrink-0"
		>
			{@html icons[icon]}
		</svg>
		<span
			class="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 overflow-hidden"
		>
			{label}
		</span>
	</a>
{/snippet}
