<script lang="ts">
	import { onMount } from 'svelte';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import type { WsEventMap } from '$lib/api/types.js';
	import { md } from '$lib/utils/markdown.js';
	import { getMonitorHistory, type ChatMessage } from '$lib/api/http.js';
	import { autoscroll } from '$lib/utils/autoscroll.js';

	interface MonitorEntry {
		id: string;
		type: 'event' | 'thinking' | 'message' | 'tool_call' | 'tool_result';
		content: string;
		timestamp: Date;
		toolName?: string;
		toolInput?: unknown;
		success?: boolean;
	}

	let { ws, projectId }: { ws: ProjectWebSocket | null; projectId: string } = $props();

	let entries = $state<MonitorEntry[]>([]);
	let loading = $state(true);

	// Convert stored ChatMessage to MonitorEntry
	function mapMessageToEntry(msg: ChatMessage): MonitorEntry {
		return {
			id: msg.id,
			type: msg.role === 'user' ? 'event' : 'message',
			content: msg.content,
			timestamp: new Date(msg.created_at),
		};
	}

	// Load history on mount
	onMount(async () => {
		try {
			const history = await getMonitorHistory(projectId);
			entries = history.map(mapMessageToEntry);
		} catch (err) {
			console.error('Failed to load monitor history:', err);
		} finally {
			loading = false;
		}
	});

	$effect(() => {
		// Don't subscribe to WebSocket until history is loaded to prevent duplicates
		if (!ws || loading) return;

		const handleEventReceived = (data: WsEventMap['monitor.event_received']) => {
			entries = [...entries, {
				id: crypto.randomUUID(),
				type: 'event',
				content: `${data.event_type} - ${data.description ?? ''}`,
				timestamp: new Date(),
			}];
		};

		const handleThinking = () => {
			entries = [...entries, {
				id: crypto.randomUUID(),
				type: 'thinking',
				content: 'Analyzing...',
				timestamp: new Date(),
			}];
		};

		const handleMessage = (data: WsEventMap['monitor.message']) => {
			entries = [...entries, {
				id: crypto.randomUUID(),
				type: 'message',
				content: data.content,
				timestamp: new Date(),
			}];
		};

		const handleToolCall = (data: WsEventMap['monitor.tool_call']) => {
			entries = [...entries, {
				id: crypto.randomUUID(),
				type: 'tool_call',
				content: `${data.tool_name}`,
				toolName: data.tool_name,
				toolInput: data.tool_input,
				timestamp: new Date(),
			}];
		};

		const handleToolResult = (data: WsEventMap['monitor.tool_result']) => {
			const result = data.result as { success: boolean; message: string } | undefined;
			entries = [...entries, {
				id: crypto.randomUUID(),
				type: 'tool_result',
				content: result?.message ?? '',
				toolName: data.tool_name,
				success: result?.success ?? true,
				timestamp: new Date(),
			}];
		};

		const handleComplete = () => {
			// Remove all thinking entries on completion
			entries = entries.filter(e => e.type !== 'thinking');
		};

		const unsubs = [
			ws.on('monitor.event_received', handleEventReceived),
			ws.on('monitor.thinking', handleThinking),
			ws.on('monitor.message', handleMessage),
			ws.on('monitor.tool_call', handleToolCall),
			ws.on('monitor.tool_result', handleToolResult),
			ws.on('monitor.complete', handleComplete),
		];

		return () => unsubs.forEach((fn) => fn());
	});

	function formatTime(date: Date): string {
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function formatToolInput(input: unknown): string {
		if (!input) return '';
		if (typeof input === 'object') {
			return Object.entries(input as Record<string, unknown>)
				.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
				.join(', ');
		}
		return String(input);
	}

	function typeLabel(type: MonitorEntry['type']): string {
		switch (type) {
			case 'event': return 'event';
			case 'thinking': return 'monitor';
			case 'message': return 'monitor';
			case 'tool_call': return 'tool';
			case 'tool_result': return 'tool';
		}
	}

	function typeColor(type: MonitorEntry['type']): string {
		switch (type) {
			case 'event': return 'text-yellow/80';
			case 'thinking': return 'text-cyan';
			case 'message': return 'text-cyan';
			case 'tool_call': return 'text-purple';
			case 'tool_result': return 'text-purple';
		}
	}
</script>

<div class="h-full flex flex-col">
	<!-- Feed -->
	<div
		use:autoscroll
		class="flex-1 overflow-y-auto p-3 md:p-4 font-mono text-xs md:text-sm bg-black/20"
	>
		{#if loading}
			<div class="text-muted py-8 text-center">
				<p class="animate-pulse">Loading monitor history...</p>
			</div>
		{:else if entries.length === 0}
			<div class="text-muted py-8 text-center">
				<p class="mb-2">Monitor feed empty.</p>
				<p class="text-xs">Automated orchestration events will appear here.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each entries as entry (entry.id)}
					<div class="flex gap-2 min-w-0">
						<span class="text-muted/50 flex-shrink-0">[{formatTime(entry.timestamp)}]</span>
						<span class="{typeColor(entry.type)} flex-shrink-0">[{typeLabel(entry.type)}]</span>
						{#if entry.type === 'event'}
							<span class="text-muted break-words min-w-0">{entry.content}</span>
						{:else if entry.type === 'thinking'}
							<span class="text-muted animate-pulse min-w-0">{entry.content}</span>
						{:else if entry.type === 'message'}
							<span class="text-primary prose prose-sm prose-invert max-w-none inline break-words min-w-0">
								{@html md(entry.content)}
							</span>
						{:else if entry.type === 'tool_call'}
							<span class="text-purple break-words min-w-0">
								<span class="text-muted/50">-></span> {entry.toolName}({formatToolInput(entry.toolInput)})
							</span>
						{:else if entry.type === 'tool_result'}
							<span class="text-muted/50 flex-shrink-0">-></span>
							<span class="{entry.success ? 'text-green' : 'text-red'} min-w-0">
								{entry.success ? 'ok' : 'err'}:
							</span>
							<span class="text-muted break-words min-w-0">{entry.content}</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Read-only indicator -->
	<div class="px-3 md:px-4 py-2 border-t border-edge flex-shrink-0 bg-surface/50">
		<span class="text-muted text-xs font-mono">Read-only feed</span>
	</div>
</div>
