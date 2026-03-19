<script lang="ts">
	import { page } from '$app/stores';

	const icons = {
		home: `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
		issues: `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
		crew: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
		activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
		settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>`
	};

	let projectId = $derived($page.params.projectId);
	let pathname = $derived($page.url.pathname);

	function isActive(href: string) {
		return pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
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

	<div class="flex flex-col gap-1 p-2 flex-1 overflow-hidden">
		{#if projectId}
			{@render navItem(`/projects/${projectId}`, 'Issues', 'issues', isActive(`/projects/${projectId}`))}
			{@render navItem(`/projects/${projectId}/crew`, 'Agents', 'crew', isActive(`/projects/${projectId}/crew`))}
			{@render navItem(`/projects/${projectId}/activity`, 'Activity', 'activity', isActive(`/projects/${projectId}/activity`))}
			{@render navItem(`/projects/${projectId}/settings`, 'Settings', 'settings', isActive(`/projects/${projectId}/settings`))}

			<div class="border-t border-edge my-1"></div>
			{@render navItem('/', 'All Projects', 'home', isActive('/'))}
		{:else}
			{@render navItem('/', 'Projects', 'home', isActive('/'))}
		{/if}

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
