<script lang="ts">
	import type { ProjectWithStats } from '$lib/api/http.js';
	import { icons } from './icons.js';

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
