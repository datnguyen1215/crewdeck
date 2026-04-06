<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { listProjectsWithStats, logout, type ProjectWithStats } from '$lib/api/http.js';
	import { onMount } from 'svelte';
	import { globalWs } from '$lib/api/global-ws.svelte.js';
	import ProjectNavItem from './ProjectNavItem.svelte';
	import { icons } from './icons.js';


	const STORAGE_KEY = 'crewdeck:sidebar:collapsed';
	const LEGACY_STORAGE_KEY = 'sidebar-collapsed';
	const SYSTEM_STORAGE_KEY = 'crewdeck:sidebar:systemCollapsed';
	const LEGACY_SYSTEM_STORAGE_KEY = 'sidebar-system-collapsed';
	const PROJECTS_COLLAPSED_KEY = 'crewdeck:sidebar:projectsCollapsed';
	const LEGACY_PROJECTS_COLLAPSED_KEY = 'sidebar-projects-collapsed';
	const MOBILE_BREAKPOINT = 768;

	let projects = $state<ProjectWithStats[]>([]);
	let expandedProjects = $state<Set<string>>(new Set());
	let collapsed = $state(false);
	let mobileOpen = $state(false);
	let isMobile = $state(false);
	let systemSectionCollapsed = $state(false);
	let projectsSectionCollapsed = $state(false);
	let projectId = $derived($page.params.projectId);
	let pathname = $derived($page.url.pathname);

	// Auto-expand current project when route changes
	$effect(() => {
		if (projectId) {
			if (!expandedProjects.has(projectId)) {
				expandedProjects = new Set([projectId]);
			}
			// Auto-expand projects section if navigating to a project
			if (projectsSectionCollapsed) {
				projectsSectionCollapsed = false;
				localStorage.setItem(PROJECTS_COLLAPSED_KEY, 'false');
			}
		}
	});

	// Close mobile sidebar on navigation
	$effect(() => {
		pathname; // subscribe to pathname changes
		if (isMobile && mobileOpen) {
			mobileOpen = false;
		}
	});

	const fetchProjects = () => {
		listProjectsWithStats()
			.then((data) => { projects = data; })
			.catch(() => {});
	};

	onMount(() => {
		// Check for mobile on mount and window resize
		const checkMobile = () => {
			isMobile = window.innerWidth < MOBILE_BREAKPOINT;
			if (!isMobile) mobileOpen = false;
		};
		checkMobile();
		window.addEventListener('resize', checkMobile);

		// Load collapsed state from localStorage (desktop only), migrating from legacy keys
		function migrateKey(newKey: string, legacyKey: string): string | null {
			const value = localStorage.getItem(newKey);
			if (value !== null) return value;
			const legacy = localStorage.getItem(legacyKey);
			if (legacy !== null) {
				localStorage.setItem(newKey, legacy);
				localStorage.removeItem(legacyKey);
			}
			return legacy;
		}

		const stored = migrateKey(STORAGE_KEY, LEGACY_STORAGE_KEY);
		if (stored !== null) collapsed = stored === 'true';

		const systemStored = migrateKey(SYSTEM_STORAGE_KEY, LEGACY_SYSTEM_STORAGE_KEY);
		if (systemStored !== null) systemSectionCollapsed = systemStored === 'true';

		const projectsStored = migrateKey(PROJECTS_COLLAPSED_KEY, LEGACY_PROJECTS_COLLAPSED_KEY);
		if (projectsStored !== null) projectsSectionCollapsed = projectsStored === 'true';

		fetchProjects();

		// Subscribe to WebSocket events for real-time project count updates
		const STATS_EVENTS = [
			'issue.status_changed', 'issue.created', 'run.started', 'run.completed',
			'dispatch.queued', 'dispatch.dequeued', 'issue.paused', 'issue.resumed',
			'project.created', 'project.deleted',
		] as const;
		const unsubs = STATS_EVENTS.map((e) => globalWs.on(e, fetchProjects));

		return () => {
			window.removeEventListener('resize', checkMobile);
			unsubs.forEach((fn) => fn());
		};
	});

	// Refresh projects on reconnect to catch missed events
	$effect(() => {
		if (globalWs.state === 'connected') fetchProjects();
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

	function toggleSystemSection() {
		systemSectionCollapsed = !systemSectionCollapsed;
		localStorage.setItem(SYSTEM_STORAGE_KEY, String(systemSectionCollapsed));
	}

	function toggleProjectsSection() {
		projectsSectionCollapsed = !projectsSectionCollapsed;
		localStorage.setItem(PROJECTS_COLLAPSED_KEY, String(projectsSectionCollapsed));
	}

	async function handleLogout() {
		try {
			await logout();
		} catch {
			// Proceed to login regardless
		}
		goto('/login');
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

<!-- Mobile overlay backdrop (rendered before hamburger so z-index stacking is correct) -->
{#if isMobile && mobileOpen}
	<button
		class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
		onclick={closeMobileSidebar}
		aria-label="Close menu"
	></button>
{/if}

<!-- Mobile hamburger button (fixed position, z-[60] above backdrop z-[40]) -->
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

<nav
	class="flex flex-col overflow-hidden transition-all duration-200 ease-in-out bg-base-hi border-r border-edge flex-shrink-0 h-full
		{isMobile ? 'fixed z-50 top-0 left-0' : ''}
		{isMobile && !mobileOpen ? '-translate-x-full' : 'translate-x-0'}
		{isMobile ? 'w-64' : collapsed ? 'w-14' : 'w-52'}"
>
	<div class="flex items-center border-b border-edge flex-shrink-0">
		<a
			href="/dashboard"
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
		<!-- Dashboard link -->
		{@render navItem('/dashboard', 'Dashboard', 'dashboard', isActive('/dashboard'))}
		<div class="border-t border-edge my-1"></div>

		<!-- Projects section header (hidden when sidebar is collapsed/narrow) -->
		{#if !collapsed || isMobile}
			<button
				onclick={toggleProjectsSection}
				class="flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase tracking-widest text-secondary hover:text-primary transition-colors cursor-pointer"
			>
				<span class="flex-1 text-left">Projects ({projects.length})</span>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="transition-transform duration-150 {projectsSectionCollapsed ? '-rotate-90' : ''}"
				>
					{@html icons.chevronDown}
				</svg>
			</button>
		{/if}

		<!-- Projects list (hidden when section is collapsed, unless sidebar itself is collapsed/narrow) -->
		{#if !projectsSectionCollapsed || (collapsed && !isMobile)}
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
		{/if}

		<!-- Global Crew link -->
		<div class="border-t border-edge my-1"></div>
		{@render navItem('/crew', 'Crew', 'crew', isActive('/crew'))}

		<div class="mt-auto">
			<div class="border-t border-edge my-1"></div>
			{#if collapsed && !isMobile}
				{@render navItem('/accounts', 'Accounts', 'accounts', isActive('/accounts'))}
				{@render navItem('/api-keys', 'API Keys', 'key', isActive('/api-keys'))}
				{@render navItem('/settings', 'Settings', 'settings', isActive('/settings'))}
			{:else}
				<button
					onclick={toggleSystemSection}
					class="flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest text-tertiary hover:text-secondary transition-colors w-full"
				>
					<span class="flex-1 text-left">System</span>
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
						class="transition-transform duration-200 {systemSectionCollapsed ? '' : 'rotate-180'}"
					>
						{@html icons.chevronDown}
					</svg>
				</button>
				{#if !systemSectionCollapsed}
					{@render navItem('/accounts', 'Accounts', 'accounts', isActive('/accounts'))}
					{@render navItem('/api-keys', 'API Keys', 'key', isActive('/api-keys'))}
					{@render navItem('/settings', 'Settings', 'settings', isActive('/settings'))}
				{/if}
			{/if}
			<button
				onclick={handleLogout}
				class="flex items-center gap-3 px-3 py-2.5 rounded text-secondary hover:text-red hover:bg-surface transition-colors whitespace-nowrap min-h-[44px] w-full {collapsed && !isMobile ? 'justify-center' : ''}"
				title={collapsed && !isMobile ? 'Log out' : undefined}
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
					{@html icons.logout}
				</svg>
				{#if !collapsed || isMobile}
					<span class="text-sm">Log out</span>
				{/if}
			</button>
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
