<script lang="ts">
	import type { ProjectWithStats } from '$lib/api/http.js';

	const icons = {
		issues: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
		crew: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
		activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
		knowledge: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
		terminals: `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
		terminal: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h4"/><path d="M7 12h10"/><path d="M7 16h6"/>`,
		chat: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
		settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
		chevronDown: `<polyline points="6 9 12 15 18 9"/>`,
		folder: `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`
	};

	type IconKey = keyof typeof icons;

	let {
		project,
		collapsed,
		isMobile,
		isExpanded,
		isCurrent,
		pathname,
		isActive,
		getActiveIssueCount,
		onToggleProject,
		onCloseMobileSidebar
	}: {
		project: ProjectWithStats;
		collapsed: boolean;
		isMobile: boolean;
		isExpanded: boolean;
		isCurrent: boolean;
		pathname: string;
		isActive: (href: string) => boolean;
		getActiveIssueCount: (project: ProjectWithStats) => number;
		onToggleProject: (id: string) => void;
		onCloseMobileSidebar: () => void;
	} = $props();
</script>

<div>
	{#if collapsed && !isMobile}
		<!-- Collapsed: just show folder icon as link -->
		<a
			href={`/projects/${project.id}`}
			onclick={onCloseMobileSidebar}
			class="flex items-center justify-center px-3 py-2 rounded text-secondary hover:text-primary hover:bg-surface transition-colors min-h-[44px]
			{isCurrent ? 'text-cyan bg-surface' : ''}"
			title={project.name}
			style={isCurrent ? 'box-shadow: inset 2px 0 0 var(--color-cyan)' : ''}
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
				{@html icons.folder}
			</svg>
		</a>
	{:else}
		<!-- Expanded: show toggle button with folder and name -->
		<button
			onclick={() => onToggleProject(project.id)}
			class="w-full flex items-center gap-2 px-3 py-2 rounded text-secondary hover:text-primary hover:bg-surface transition-colors whitespace-nowrap min-h-[44px]
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
			<span class="text-sm overflow-hidden text-ellipsis">
				{project.name}
			</span>
		</button>

		<!-- Project sub-pages (only when expanded and sidebar not collapsed) -->
		{#if isExpanded}
			<div class="ml-5 flex flex-col gap-0.5">
				{@render subNavItem(`/projects/${project.id}`, 'Issues', 'issues', pathname === `/projects/${project.id}` || pathname.startsWith(`/projects/${project.id}/issues`), getActiveIssueCount(project))}
				{@render subNavItem(`/projects/${project.id}/terminals`, 'Terminals', 'terminals', isActive(`/projects/${project.id}/terminals`), project.active_runs)}
				{@render subNavItem(`/projects/${project.id}/chat`, 'Captain', 'chat', isActive(`/projects/${project.id}/chat`))}
				{@render subNavItem(`/projects/${project.id}/knowledge`, 'Knowledge', 'knowledge', isActive(`/projects/${project.id}/knowledge`))}
				{@render subNavItem(`/projects/${project.id}/activity`, 'Activity', 'activity', isActive(`/projects/${project.id}/activity`))}
				{@render subNavItem(`/projects/${project.id}/settings`, 'Settings', 'settings', isActive(`/projects/${project.id}/settings`))}
			</div>
		{/if}
	{/if}
</div>

{#snippet subNavItem(href: string, label: string, icon: IconKey, active: boolean, count?: number)}
	<a
		{href}
		onclick={onCloseMobileSidebar}
		class="flex items-center gap-2 px-2 py-2 rounded text-secondary hover:text-primary hover:bg-surface transition-colors whitespace-nowrap text-xs min-h-[40px]
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
		<span class="overflow-hidden flex-1">
			{label}
		</span>
		{#if count && count > 0}
			<span class="text-[10px] bg-surface-hi text-secondary px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
				{count}
			</span>
		{/if}
	</a>
{/snippet}
