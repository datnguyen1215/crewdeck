<script lang="ts">
	import type { ActivityLog, Issue } from '$lib/api/http.js';
	import type { ProjectWebSocket, WsEvent } from '$lib/api/ws.svelte.js';
	import { listActivity } from '$lib/api/http.js';
	import { formatActivityEntry, type TerminalLine } from '$lib/config/terminal.js';
	import { autoscroll } from '$lib/utils/autoscroll.js';
	import { getContext } from 'svelte';
	import { useWsSubscriptions } from '$lib/utils/ws-subscriptions.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import TerminalHeader from './TerminalHeader.svelte';
	import TerminalLineItem from './TerminalLine.svelte';

	let { issues = [] }: { issues?: Issue[] } = $props();

	const getProjectId = getContext<() => string>('projectId');
	const projectId = $derived(getProjectId());

	// Build a lookup map for issue titles
	let issueTitleMap = $derived(
		new Map(issues.map((issue) => [issue.id, issue.title]))
	);

	const getProjectWs = getContext<() => ProjectWebSocket | null>('projectWs');
	let ws: ProjectWebSocket | null = null;

	let entries = $state<ActivityLog[]>([]);
	let loading = $state(true);
	let collapsed = $state(false);
	let height = $state(300);
	let filterAgents = $state(false);
	let filterErrors = $state(false);

	const MAX_ENTRIES = 200;
	const DEFAULT_HEIGHT = 300;
	const MIN_HEIGHT = 150;
	const MAX_HEIGHT = 600;

	let newEntryIds = $state<Set<string>>(new Set());
	let isInitialized = $state(false);

	// Load state from localStorage on mount, then save on subsequent changes
	$effect(() => {
		if (!isInitialized) {
			// Load from localStorage
			const storedCollapsed = localStorage.getItem('crewdeck:terminal:collapsed');
			if (storedCollapsed !== null) {
				collapsed = storedCollapsed === 'true';
			}

			const storedHeight = localStorage.getItem('crewdeck:terminal:height');
			if (storedHeight !== null) {
				const parsed = parseInt(storedHeight, 10);
				if (!isNaN(parsed) && parsed >= MIN_HEIGHT && parsed <= MAX_HEIGHT) {
					height = parsed;
				}
			}

			isInitialized = true;
		} else {
			// Save to localStorage on subsequent changes
			localStorage.setItem('crewdeck:terminal:collapsed', String(collapsed));
			localStorage.setItem('crewdeck:terminal:height', String(height));
		}
	});

	// Fetch initial activity
	$effect(() => {
		let cancelled = false;
		loading = true;

		listActivity(projectId, { limit: 50 })
			.then((data) => {
				if (cancelled) return;
				entries = data.reverse();
				loading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				loading = false;
				toastStore.add(err instanceof Error ? err.message : 'Failed to load activity', 'error');
			});

		return () => {
			cancelled = true;
		};
	});

	// Subscribe to WebSocket events
	$effect(() => {
		ws = getProjectWs?.();
		if (!ws) return;

		const refetch = () => {
			// Refetch activity when relevant events arrive
			listActivity(projectId, { limit: 50 })
				.then((data) => {
					const reversed = data.reverse();
					const oldIds = new Set(entries.map((e) => e.id));
					const newIds = reversed.filter((e) => !oldIds.has(e.id)).map((e) => e.id);

					entries = reversed;

					// Track new entries for highlight animation
					newEntryIds = new Set([...newEntryIds, ...newIds]);

					// Autoscroll action handles scroll (via MutationObserver)

					// Remove highlight after animation duration
					setTimeout(() => {
						newEntryIds = new Set([...newEntryIds].filter((id) => !newIds.includes(id)));
					}, 1000);

					// Cap entries at MAX_ENTRIES
					if (entries.length > MAX_ENTRIES) {
						entries = entries.slice(-MAX_ENTRIES);
					}
				})
				// Silent catch: WS-triggered background refresh; toasting here would flood the user on network issues
				.catch(() => {});
		};

		return useWsSubscriptions(ws, {
			'mention.spawned': refetch,
			'mention.completed': refetch,
			'mention.error': refetch,
			'run.started': refetch,
			'run.completed': refetch,
			'issue.status_changed': refetch,
			'comment.added': refetch,
			'pr.created': refetch,
			'pr.status_changed': refetch,
		});
	});

	// Toggle collapse
	function toggleCollapse() {
		collapsed = !collapsed;
	}

	// Drag resize handler
	let dragging = $state(false);
	let dragStartY = $state(0);
	let dragStartHeight = $state(0);

	function startDrag(e: MouseEvent) {
		dragging = true;
		dragStartY = e.clientY;
		dragStartHeight = height;
		e.preventDefault();
	}

	$effect(() => {
		if (!dragging) return;

		function handleMouseMove(e: MouseEvent) {
			const delta = dragStartY - e.clientY;
			const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dragStartHeight + delta));
			height = newHeight;
		}

		function handleMouseUp() {
			dragging = false;
		}

		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);

		return () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		};
	});

	// Format entries using terminal formatter
	let formattedEntries = $derived.by(() => {
		return entries.map(formatActivityEntry);
	});

	// Filter entries
	let filteredEntries = $derived.by(() => {
		let result = formattedEntries;
		if (filterAgents) {
			result = result.filter((e) => e.actorType === 'agent');
		}
		if (filterErrors) {
			result = result.filter((e) => e.severity === 'error');
		}
		return result;
	});

	// Resolve issue title using 3-tier fallback
	function resolveIssueTitle(line: TerminalLine): string | undefined {
		// 1. From API enrichment
		if (line.issueTitle) return line.issueTitle;

		// 2. From WebSocket event payload (already extracted by formatter)
		// (already checked above, issueTitle includes this)

		// 3. From issues prop lookup
		if (line.issueId && issueTitleMap.has(line.issueId)) {
			return issueTitleMap.get(line.issueId);
		}

		return undefined;
	}

	// Truncate title to max length
	function truncateTitle(title: string, maxLength: number = 25): string {
		if (title.length <= maxLength) return title;
		return title.slice(0, maxLength) + '…';
	}

</script>

<div class="activity-terminal bg-base border border-edge rounded overflow-hidden flex flex-col" style="view-transition-name: none">
	<!-- Drag handle -->
	{#if !collapsed}
		<div
			class="h-1 cursor-ns-resize hover:bg-cyan/20 transition-colors"
			onmousedown={startDrag}
			role="button"
			tabindex="-1"
			aria-label="Resize terminal"
		></div>
	{/if}

	<!-- Header -->
	<TerminalHeader
		{collapsed}
		{filterAgents}
		{filterErrors}
		onToggleCollapse={toggleCollapse}
		onToggleFilterAgents={() => { filterAgents = !filterAgents; }}
		onToggleFilterErrors={() => { filterErrors = !filterErrors; }}
	/>

	<!-- Terminal body -->
	{#if !collapsed}
		<div
			use:autoscroll
			class="overflow-y-auto overflow-x-hidden relative scanlines"
			style="height: {height}px;"
		>
			{#if loading}
				<div class="flex items-center justify-center h-full text-muted text-sm">Loading...</div>
			{:else if filteredEntries.length === 0}
				<div class="flex items-center justify-center h-full text-muted text-sm">No activity</div>
			{:else}
				<div class="p-4 space-y-0.5">
					{#each filteredEntries as line (line.id)}
						<TerminalLineItem
							{line}
							isNew={newEntryIds.has(line.id)}
							issueTitle={resolveIssueTitle(line)}
							{truncateTitle}
						/>
					{/each}
					<!-- Blinking cursor -->
					<div class="flex items-center gap-1 mt-2">
						<div class="w-2 h-3 bg-cyan cursor-blink"></div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.scanlines {
		position: relative;
	}

	.scanlines::before {
		content: '';
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			0deg,
			rgba(255, 255, 255, 0.03) 0px,
			rgba(255, 255, 255, 0.03) 1px,
			transparent 1px,
			transparent 2px
		);
		pointer-events: none;
		z-index: 1;
	}

	.cursor-blink {
		animation: blink 1s step-end infinite;
	}

	@keyframes blink {
		0%,
		50% {
			opacity: 1;
		}
		50.01%,
		100% {
			opacity: 0;
		}
	}

	@keyframes entry-slide-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes entry-glow {
		0% {
			background-color: rgba(34, 211, 238, 0.15);
		}
		100% {
			background-color: transparent;
		}
	}
</style>
