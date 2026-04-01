<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { listProjectsWithStats, type ProjectWithStats } from '$lib/api/http.js';
	import { onMount } from 'svelte';
	import ProjectNavItem from './ProjectNavItem.svelte';

	const STORAGE_KEY = 'sidebar-collapsed';
	const MOBILE_BREAKPOINT = 768;

	const icons = {
		menu: `<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>`,
		close: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
		home: `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
		issues: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
		crew: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
		activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
		knowledge: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
		terminals: `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
		terminal: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h4"/><path d="M7 12h10"/><path d="M7 16h6"/>`,
		chat: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
		settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
		chevronRight: `<polyline points="9 18 15 12 9 6"/>`,
		chevronDown: `<polyline points="6 9 12 15 18 9"/>`,
		chevronLeft: `<polyline points="15 18 9 12 15 6"/>`,
		folder: `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`
	};

	let projects = $state<ProjectWithStats[]>([]);
	let expandedProjects = $state<Set<string>>(new Set());
	let collapsed = $state(false);
	let mobileOpen = $state(false);
	let isMobile = $state(false);
	let projectId = $derived($page.params.projectId);
	let pathname = $derived($page.url.pathname);

	// Auto-expand current project when route changes
	$effect(() => {
		if (projectId && !expandedProjects.has(projectId)) {
			expandedProjects = new Set([projectId]);
		}
	});

	// Close mobile sidebar on navigation
	$effect(() => {
		pathname; // subscribe to pathname changes
		if (isMobile && mobileOpen) {
			mobileOpen = false;
		}
	});

	onMount(() => {
		// Check for mobile on mount and window resize
		const checkMobile = () => {
			isMobile = window.innerWidth < MOBILE_BREAKPOINT;
			if (!isMobile) mobileOpen = false;
		};
		checkMobile();
		window.addEventListener('resize', checkMobile);

		// Load collapsed state from localStorage (desktop only)
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored !== null) {
			collapsed = stored === 'true';
		}

		// Load projects (async, but don't block)
		const fetchProjects = () => {
			listProjectsWithStats()
				.then((data) => { projects = data; })
				// Silent catch: 30s polling failure; toasting would be noisy on transient network issues
				.catch(() => {});
		};
		fetchProjects();

		// Poll for updates every 30 seconds
		const interval = setInterval(fetchProjects, 30_000);

		return () => {
			window.removeEventListener('resize', checkMobile);
			clearInterval(interval);
		};
	});

	function toggleSidebar() {
		if (isMobile) {
			mobileOpen = !mobileOpen;
		} else {
			collapsed = !collapsed;
			localStorage.setItem(STORAGE_KEY, String(collapsed));
		}
	}

	function closeMobileSidebar() {
		if (isMobile) mobileOpen = false;
	}

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
			expandedProjects = new Set([pid]);
			// Navigate to project issues if clicking a collapsed project
			if (projectId !== pid) {
				goto(`/projects/${pid}`);
			}
		}
	}

	function getActiveIssueCount(project: ProjectWithStats): number {
		const { issues } = project;
		return issues.open + issues.in_progress + issues.pr_created + issues.pr_conflict + issues.pr_failed_actions + issues.pr_ready_to_merge;
	}
</script>

<!-- Mobile hamburger button (fixed position) -->
{#if isMobile}
	<button
		onclick={toggleSidebar}
		class="fixed top-3 left-3 z-[60] p-2 bg-surface border border-edge rounded-lg text-secondary hover:text-primary hover:bg-surface-hi transition-colors md:hidden"
		aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			{@html mobileOpen ? icons.close : icons.menu}
		</svg>
	</button>
{/if}

<!-- Mobile overlay backdrop -->
{#if isMobile && mobileOpen}
	<button
		class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
		onclick={closeMobileSidebar}
		aria-label="Close menu"
	></button>
{/if}

<nav
	class="flex flex-col overflow-hidden transition-all duration-200 ease-in-out bg-base-hi border-r border-edge flex-shrink-0 h-full
		{isMobile ? 'fixed z-50 top-0 left-0' : ''}
		{isMobile && !mobileOpen ? '-translate-x-full' : 'translate-x-0'}
		{isMobile ? 'w-64' : collapsed ? 'w-14' : 'w-52'}"
>
	<div class="flex items-center border-b border-edge flex-shrink-0">
		<a
			href="/"
			onclick={closeMobileSidebar}
			class="flex items-center gap-3 px-4 py-5 hover:bg-surface transition-colors flex-1 min-w-0 {isMobile ? 'pl-14' : ''}"
			title={collapsed && !isMobile ? 'CrewDeck' : undefined}
		>
			<span class="text-cyan font-bold text-sm tracking-wider flex-shrink-0 w-6 text-center">CD</span>
			{#if !collapsed || isMobile}
				<span class="text-cyan font-bold uppercase tracking-widest text-xs whitespace-nowrap">
					CREWDECK
				</span>
			{/if}
		</a>
		{#if !isMobile}
			<button
				onclick={toggleSidebar}
				class="p-2 mr-2 text-secondary hover:text-primary hover:bg-surface rounded transition-colors"
				title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			>
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
					class="transition-transform duration-200 {collapsed ? 'rotate-180' : ''}"
				>
					{@html icons.chevronLeft}
				</svg>
			</button>
		{/if}
	</div>

	<div class="flex flex-col gap-1 p-2 flex-1 overflow-y-auto overflow-x-hidden">
		<!-- Projects list -->
		{#each projects as project (project.id)}
			<ProjectNavItem
				{project}
				{collapsed}
				{isMobile}
				isExpanded={expandedProjects.has(project.id)}
				isCurrent={isProjectActive(project.id)}
				{pathname}
				{isActive}
				{getActiveIssueCount}
				onToggleProject={toggleProject}
				onCloseMobileSidebar={closeMobileSidebar}
			/>
		{/each}

		<!-- Global Crew link -->
		<div class="border-t border-edge my-1"></div>
		{@render navItem('/crew', 'Crew', 'crew', isActive('/crew'))}

		<div class="mt-auto">
			<div class="border-t border-edge my-1"></div>
			{@render navItem('/settings', 'Settings', 'settings', isActive('/settings'))}
		</div>
	</div>
</nav>

{#snippet navItem(href: string, label: string, icon: keyof typeof icons, active: boolean)}
	<a
		{href}
		onclick={closeMobileSidebar}
		class="flex items-center gap-3 px-3 py-2.5 rounded text-secondary hover:text-primary hover:bg-surface transition-colors whitespace-nowrap min-h-[44px]
		{active ? 'text-cyan bg-surface' : ''} {collapsed && !isMobile ? 'justify-center' : ''}"
		style={active ? 'box-shadow: inset 2px 0 0 var(--color-cyan)' : ''}
		title={collapsed && !isMobile ? label : undefined}
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
		{#if !collapsed || isMobile}
			<span class="text-sm overflow-hidden">
				{label}
			</span>
		{/if}
	</a>
{/snippet}
