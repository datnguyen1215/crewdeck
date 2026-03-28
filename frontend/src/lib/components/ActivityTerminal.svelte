<script lang="ts">
	import type { ActivityLog } from '$lib/api/http.js';
	import type { ProjectWebSocket, WsEvent } from '$lib/api/ws.svelte.js';
	import { listActivity } from '$lib/api/http.js';
	import { parseUTC } from '$lib/utils/time.js';
	import { getContext } from 'svelte';

	let { projectId }: { projectId: string } = $props();

	const getProjectWs = getContext<() => ProjectWebSocket | null>('projectWs');
	let ws: ProjectWebSocket | null = null;

	let entries = $state<ActivityLog[]>([]);
	let loading = $state(true);
	let collapsed = $state(false);
	let height = $state(300);
	let userScrolled = $state(false);
	let filterAgents = $state(false);
	let filterErrors = $state(false);

	const MAX_ENTRIES = 200;
	const DEFAULT_HEIGHT = 300;
	const MIN_HEIGHT = 150;
	const MAX_HEIGHT = 600;

	let scrollContainer: HTMLDivElement | undefined = $state();
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
				scrollToBottom();
			})
			.catch(() => {
				if (cancelled) return;
				loading = false;
			});

		return () => {
			cancelled = true;
		};
	});

	// Subscribe to WebSocket events
	$effect(() => {
		ws = getProjectWs?.();
		if (!ws) return;

		const relevantEvents: WsEvent[] = [
			'mention.spawned',
			'mention.completed',
			'mention.error',
			'run.started',
			'run.completed',
			'issue.status_changed',
			'comment.added',
			'pr.created',
			'pr.status_changed'
		];

		const unsubscribers = relevantEvents.map((event) =>
			ws!.on(event, () => {
				// Refetch activity when relevant events arrive
				listActivity(projectId, { limit: 50 })
					.then((data) => {
						const reversed = data.reverse();
						const oldIds = new Set(entries.map((e) => e.id));
						const newIds = reversed.filter((e) => !oldIds.has(e.id)).map((e) => e.id);

						entries = reversed;

						// Track new entries for highlight animation
						newEntryIds = new Set([...newEntryIds, ...newIds]);

						// Scroll to bottom if not manually scrolled up
						if (!userScrolled) {
							scrollToBottom();
						}

						// Remove highlight after animation duration
						setTimeout(() => {
							newEntryIds = new Set([...newEntryIds].filter((id) => !newIds.includes(id)));
						}, 1000);

						// Cap entries at MAX_ENTRIES
						if (entries.length > MAX_ENTRIES) {
							entries = entries.slice(-MAX_ENTRIES);
						}
					})
					.catch((err) => {
						console.error('Failed to fetch activity:', err);
					});
			})
		);

		return () => {
			unsubscribers.forEach((unsub) => unsub());
		};
	});

	// Detect user scroll
	function handleScroll() {
		if (!scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		const atBottom = scrollTop + clientHeight >= scrollHeight - 10;
		userScrolled = !atBottom;
	}

	// Auto-scroll to bottom
	function scrollToBottom() {
		if (!scrollContainer) return;
		scrollContainer.scrollTop = scrollContainer.scrollHeight;
		userScrolled = false;
	}

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

	// Terminal formatter
	function formatEntry(entry: ActivityLog): string {
		const timestamp = parseUTC(entry.created_at);
		const time = timestamp
			.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
			.replace(/:/g, ':');

		const actorName = entry.actor_type === 'agent' ? entry.actor_name ?? 'agent' : entry.actor_type;
		const details = (entry.details as Record<string, unknown>) ?? {};

		let message = '';
		switch (entry.action) {
			case 'mention.spawned':
				message = `${actorName} spawned (pid ${details.pid})`;
				break;
			case 'mention.completed':
				message = `${actorName} completed (exit ${details.exit_code})`;
				break;
			case 'mention.error':
				message = `${actorName} error: ${details.message}`;
				break;
			case 'run.started':
				message = `${actorName} run started`;
				break;
			case 'run.completed':
				message = `${actorName} run completed (status: ${details.status})`;
				break;
			case 'issue.status_changed':
				message = `issue status: ${details.from} → ${details.to}`;
				break;
			case 'comment.added':
				message = `${actorName} commented`;
				break;
			case 'pr.created':
				message = `PR #${details.pr_number} created`;
				break;
			case 'pr.status_changed':
				message = `PR status: ${details.from} → ${details.to}`;
				break;
			default:
				message = entry.action;
		}

		return `[${time}] ${message}`;
	}

	// Determine entry color
	function entryColor(entry: ActivityLog): string {
		switch (entry.action) {
			case 'mention.spawned':
			case 'run.started':
			case 'pr.created':
				return 'text-cyan border-cyan/30';
			case 'mention.completed':
			case 'run.completed':
				return 'text-green border-green/30';
			case 'mention.error':
				return 'text-red border-red/30';
			case 'issue.status_changed': {
				const details = (entry.details as Record<string, unknown>) ?? {};
				if (details.to === 'done') return 'text-green border-green/30';
				if (details.to === 'discarded') return 'text-red border-red/30';
				return 'text-amber border-amber/30';
			}
			default:
				return 'text-secondary border-edge';
		}
	}

	// Filter entries
	let filteredEntries = $derived.by(() => {
		let result = entries;
		if (filterAgents) {
			result = result.filter((e) => e.actor_type === 'agent');
		}
		if (filterErrors) {
			result = result.filter((e) => e.action.includes('error'));
		}
		return result;
	});

	// Handle entry click for navigation
	function handleEntryClick(entry: ActivityLog) {
		if (entry.issue_id) {
			window.location.href = `/projects/${projectId}/issues/${entry.issue_id}`;
		}
	}
</script>

<div class="activity-terminal bg-base border border-edge rounded overflow-hidden flex flex-col">
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
	<div
		class="flex items-center justify-between px-4 py-2 bg-surface border-b border-edge cursor-pointer"
		onclick={toggleCollapse}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Enter' && toggleCollapse()}
		aria-label={collapsed ? 'Expand terminal' : 'Collapse terminal'}
	>
		<div class="flex items-center gap-2">
			<span class="text-cyan text-sm font-semibold">▸ Mission Control</span>
		</div>
		<div class="flex items-center gap-2">
			{#if !collapsed}
				<button
					class="px-2 py-0.5 text-xs border border-edge rounded hover:bg-surface-hi transition-colors {filterAgents ? 'bg-cyan/10 border-cyan text-cyan' : 'text-muted'}"
					onclick={(e) => {
						e.stopPropagation();
						filterAgents = !filterAgents;
					}}
					aria-label="Filter agents only"
				>
					agents
				</button>
				<button
					class="px-2 py-0.5 text-xs border border-edge rounded hover:bg-surface-hi transition-colors {filterErrors ? 'bg-red/10 border-red text-red' : 'text-muted'}"
					onclick={(e) => {
						e.stopPropagation();
						filterErrors = !filterErrors;
					}}
					aria-label="Filter errors only"
				>
					errors
				</button>
			{/if}
			<span class="text-muted text-xs">{collapsed ? '▸' : '▾'}</span>
		</div>
	</div>

	<!-- Terminal body -->
	{#if !collapsed}
		<div
			bind:this={scrollContainer}
			onscroll={handleScroll}
			class="overflow-y-auto overflow-x-hidden relative scanlines"
			style="height: {height}px;"
		>
			{#if loading}
				<div class="flex items-center justify-center h-full text-muted text-sm">Loading...</div>
			{:else if filteredEntries.length === 0}
				<div class="flex items-center justify-center h-full text-muted text-sm">No activity</div>
			{:else}
				<div class="p-4 space-y-0.5">
					{#each filteredEntries as entry (entry.id)}
						{@const isNew = newEntryIds.has(entry.id)}
						{@const colors = entryColor(entry)}
						<div
							class="text-xs font-mono leading-relaxed border-l-2 pl-2 py-0.5 transition-all cursor-pointer hover:bg-surface/50 {colors}"
							class:new-entry={isNew}
							onclick={() => handleEntryClick(entry)}
							role="button"
							tabindex="0"
							onkeydown={(e) => e.key === 'Enter' && handleEntryClick(entry)}
							style={isNew ? 'animation: entry-slide-in 150ms ease-out, entry-glow 1s ease-out' : ''}
						>
							{formatEntry(entry)}
						</div>
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
