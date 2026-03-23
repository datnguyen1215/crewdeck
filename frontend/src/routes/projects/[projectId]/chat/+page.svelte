<script lang="ts">
	import { page } from '$app/stores';
	import { getContext, tick } from 'svelte';
	import { getChatHistory, sendChatMessage, getProject, type ChatMessage, type Project } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import { md } from '$lib/utils/markdown.js';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Admiral Terminal - ${project.name} - CrewDeck` : 'Admiral Terminal - CrewDeck');

	// Terminal entries: events, messages, tool calls
	interface TerminalEntry {
		id: string;
		type: 'system' | 'admiral' | 'user' | 'tool_call' | 'tool_result';
		content: string;
		timestamp: Date;
		toolName?: string;
		toolInput?: unknown;
		success?: boolean;
	}

	let entries = $state<TerminalEntry[]>([]);
	let loading = $state(true);
	let sending = $state(false);
	let inputValue = $state('');
	let isThinking = $state(false);
	let messagesContainer: HTMLDivElement | undefined;
	let inputElement: HTMLInputElement | undefined;

	// Load initial chat history
	$effect(() => {
		loading = true;
		let cancelled = false;

		Promise.all([getChatHistory(projectId), getProject(projectId)])
			.then(([hist, proj]) => {
				if (cancelled) return;
				// Convert chat messages to terminal entries
				entries = hist.map((m: ChatMessage) => ({
					id: m.id,
					type: m.role === 'user' ? 'user' : 'admiral',
					content: m.content,
					timestamp: new Date(m.created_at),
				}));
				project = proj;
				loading = false;
				scrollToBottom();
			})
			.catch(() => {
				if (!cancelled) {
					loading = false;
					toastStore.add('Failed to load terminal history', 'error');
				}
			});

		return () => { cancelled = true; };
	});

	// WebSocket handlers for Admiral terminal events
	$effect(() => {
		const ws = getWs();
		if (!ws) return;

		// System event received
		const handleEventReceived = (data: Record<string, unknown>) => {
			const entry: TerminalEntry = {
				id: crypto.randomUUID(),
				type: 'system',
				content: `Event: ${data.event_type} - ${data.description}`,
				timestamp: new Date(),
			};
			entries = [...entries, entry];
			scrollToBottom();
		};

		// Admiral is thinking
		const handleThinking = () => {
			isThinking = true;
		};

		// Admiral message
		const handleMessage = (data: Record<string, unknown>) => {
			isThinking = false;
			const entry: TerminalEntry = {
				id: crypto.randomUUID(),
				type: 'admiral',
				content: data.content as string,
				timestamp: new Date(),
			};
			entries = [...entries, entry];
			scrollToBottom();
		};

		// Admiral tool call
		const handleToolCall = (data: Record<string, unknown>) => {
			const entry: TerminalEntry = {
				id: crypto.randomUUID(),
				type: 'tool_call',
				content: `${data.tool_name}`,
				toolName: data.tool_name as string,
				toolInput: data.tool_input,
				timestamp: new Date(),
			};
			entries = [...entries, entry];
			scrollToBottom();
		};

		// Admiral tool result
		const handleToolResult = (data: Record<string, unknown>) => {
			const result = data.result as { success: boolean; message: string; data?: unknown };
			const entry: TerminalEntry = {
				id: crypto.randomUUID(),
				type: 'tool_result',
				content: result.message,
				toolName: data.tool_name as string,
				success: result.success,
				timestamp: new Date(),
			};
			entries = [...entries, entry];
			scrollToBottom();
		};

		// Admiral complete
		const handleComplete = () => {
			isThinking = false;
			sending = false;
			inputElement?.focus();
		};

		const unsubs = [
			ws.on('admiral.event_received', handleEventReceived),
			ws.on('admiral.thinking', handleThinking),
			ws.on('admiral.message', handleMessage),
			ws.on('admiral.tool_call', handleToolCall),
			ws.on('admiral.tool_result', handleToolResult),
			ws.on('admiral.complete', handleComplete),
			// Legacy fallback for streaming
			ws.on('chat.complete', handleComplete),
		];

		return () => unsubs.forEach((fn) => fn());
	});

	async function scrollToBottom() {
		await tick();
		if (messagesContainer) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const message = inputValue.trim();
		if (!message || sending) return;

		inputValue = '';
		sending = true;

		// Add user message to terminal
		const userEntry: TerminalEntry = {
			id: crypto.randomUUID(),
			type: 'user',
			content: message,
			timestamp: new Date(),
		};
		entries = [...entries, userEntry];
		scrollToBottom();

		try {
			await sendChatMessage(projectId, message);
			// Response will come via WebSocket
		} catch (err) {
			toastStore.add('Failed to send message', 'error');
			// Remove the user entry on failure
			entries = entries.filter((e) => e.id !== userEntry.id);
			sending = false;
			inputElement?.focus();
		}
	}

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
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="h-full flex flex-col">
	<!-- Header -->
	<div class="p-4 border-b border-edge flex-shrink-0">
		<Breadcrumb segments={[
			{ label: 'Projects', href: '/' },
			{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
			{ label: 'Admiral Terminal' }
		]} />
		<div class="mt-3 flex items-center gap-3">
			<div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center">
				<svg class="w-4 h-4 text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="18" height="18" rx="2"/>
					<path d="M7 8h4"/>
					<path d="M7 12h10"/>
					<path d="M7 16h6"/>
				</svg>
			</div>
			<div>
				<h1 class="text-lg font-bold text-primary">Admiral Terminal</h1>
				<p class="text-xs text-muted">Event-driven project orchestrator</p>
			</div>
		</div>
	</div>

	<!-- Terminal output -->
	<div
		bind:this={messagesContainer}
		class="flex-1 overflow-y-auto p-4 font-mono text-sm bg-black/20"
	>
		{#if loading}
			<div class="flex justify-center py-8">
				<div class="flex items-center gap-2 text-muted">
					<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
					</svg>
					<span>Loading terminal history...</span>
				</div>
			</div>
		{:else if entries.length === 0}
			<div class="text-muted py-8 text-center">
				<p class="mb-2">Admiral Terminal ready.</p>
				<p class="text-xs">System events and your messages appear here.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each entries as entry (entry.id)}
					<div class="flex gap-2 min-w-0">
						<span class="text-muted/50 flex-shrink-0">[{formatTime(entry.timestamp)}]</span>
						{#if entry.type === 'system'}
							<span class="text-yellow/80 flex-shrink-0">[system]</span>
							<span class="text-muted break-words min-w-0">{entry.content}</span>
						{:else if entry.type === 'user'}
							<span class="text-green flex-shrink-0">[you]</span>
							<span class="text-primary break-words min-w-0">{entry.content}</span>
						{:else if entry.type === 'admiral'}
							<span class="text-cyan flex-shrink-0">[admiral]</span>
							<span class="text-primary prose prose-sm prose-invert max-w-none inline break-words min-w-0">
								{@html md(entry.content)}
							</span>
						{:else if entry.type === 'tool_call'}
							<span class="text-cyan flex-shrink-0">[admiral]</span>
							<span class="text-purple break-words min-w-0">
								<span class="text-muted/50">-></span> {entry.toolName}({formatToolInput(entry.toolInput)})
							</span>
						{:else if entry.type === 'tool_result'}
							<span class="text-cyan flex-shrink-0">[admiral]</span>
							<span class="text-muted/50 flex-shrink-0">-></span>
							<span class="{entry.success ? 'text-green' : 'text-red'} flex-shrink-0">
								{entry.success ? 'ok' : 'err'}:
							</span>
							<span class="text-muted break-words min-w-0">{entry.content}</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Thinking indicator -->
		{#if isThinking}
			<div class="flex gap-2 mt-2">
				<span class="text-muted/50">[{formatTime(new Date())}]</span>
				<span class="text-cyan">[admiral]</span>
				<span class="text-muted animate-pulse">thinking...</span>
			</div>
		{/if}

		<!-- Sending indicator -->
		{#if sending && !isThinking}
			<div class="flex gap-2 mt-2">
				<span class="text-muted/50">[{formatTime(new Date())}]</span>
				<span class="text-cyan">[admiral]</span>
				<span class="text-muted animate-pulse">processing...</span>
			</div>
		{/if}
	</div>

	<!-- Input -->
	<div class="p-4 border-t border-edge flex-shrink-0 bg-surface/50">
		<form onsubmit={handleSubmit} class="flex gap-3">
			<div class="flex-1 flex items-center gap-2 bg-black/30 border border-edge rounded-lg px-4 py-3">
				<span class="text-green font-mono">$</span>
				<input
					type="text"
					bind:this={inputElement}
					bind:value={inputValue}
					placeholder="Send a message to Admiral..."
					disabled={sending}
					class="flex-1 bg-transparent text-sm text-primary font-mono placeholder:text-muted outline-none disabled:opacity-50"
				/>
			</div>
			<button
				type="submit"
				disabled={sending || !inputValue.trim()}
				class="px-4 py-3 bg-cyan/10 border border-cyan text-cyan rounded-lg hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm"
			>
				{#if sending}
					<svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
					</svg>
				{:else}
					Send
				{/if}
			</button>
		</form>
	</div>
</div>
