<script lang="ts">
	import { page } from '$app/stores';

	// Icons as inline SVG strings — feather/lucide style, 18x18 viewport
	const icons = {
		home: `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
		issues: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
		crew: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
		activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`
	};

	let projectId = $derived($page.params.projectId);
	let pathname = $derived($page.url.pathname);

	function isActive(href: string) {
		return pathname === href || (href !== '/' && pathname.startsWith(href));
	}
</script>

<nav
	class="group/sidebar flex flex-col w-14 hover:w-52 overflow-hidden transition-[width] duration-200 ease-in-out bg-base-hi border-r border-edge flex-shrink-0 h-full"
>
	<!-- Brand -->
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

	<!-- Navigation items -->
	<div class="flex flex-col gap-1 p-2 flex-1 overflow-hidden">
		{#if projectId}
			<!-- Project-level nav -->
			{@render navItem(`/projects/${projectId}`, 'Issues', 'issues', isActive(`/projects/${projectId}`))}
			{@render navItem(`/projects/${projectId}/crew`, 'Crew', 'crew', isActive(`/projects/${projectId}/crew`))}
			{@render navItem(`/projects/${projectId}/activity`, 'Activity', 'activity', isActive(`/projects/${projectId}/activity`))}

			<!-- Divider -->
			<div class="border-t border-edge my-1"></div>

			<!-- Back to all projects -->
			{@render navItem('/', 'All Projects', 'home', isActive('/') && !projectId)}
		{:else}
			<!-- Root nav -->
			{@render navItem('/', 'Projects', 'home', isActive('/'))}
		{/if}
	</div>
</nav>

{#snippet navItem(href: string, label: string, icon: string, active: boolean)}
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
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html icons[icon]}
		</svg>
		<span
			class="text-sm opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-150 delay-75 overflow-hidden"
		>
			{label}
		</span>
	</a>
{/snippet}
