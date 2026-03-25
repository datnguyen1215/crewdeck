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
	let pageTitle = $derived(project?.name ? `Captain Terminal - ${project.name} - CrewDeck` : 'Captain Terminal - CrewDeck');

	// Terminal entries: events, messages, tool calls
	interface TerminalEntry {
		id: string;
		type: 'system' | 'captain' | 'user' | 'tool_call' | 'tool_result';
		content: string;
		timestamp: Date;
		toolName?: string;
		toolInput?: unknown;
		success?: boolean;
	}

	// Pending image for attachment
	interface PendingImage {
		id: string;
		data: string; // base64 data URL
		mediaType: string;
	}

	let entries = $state<TerminalEntry[]>([]);
	let loading = $state(true);
	let sending = $state(false);
	let inputValue = $state('');
	let isThinking = $state(false);
	let messagesContainer: HTMLDivElement | undefined;
	let inputElement: HTMLTextAreaElement | undefined;
	let pendingImages = $state<PendingImage[]>([]);

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
					type: m.role === 'user' ? 'user' : 'captain',
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

	// WebSocket handlers for Captain terminal events
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

		// Captain is thinking
		const handleThinking = () => {
			isThinking = true;
		};

		// Captain message
		const handleMessage = (data: Record<string, unknown>) => {
			isThinking = false;
			const entry: TerminalEntry = {
				id: crypto.randomUUID(),
				type: 'captain',
				content: data.content as string,
				timestamp: new Date(),
			};
			entries = [...entries, entry];
			scrollToBottom();
		};

		// Captain tool call
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

		// Captain tool result
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

		// Captain complete
		const handleComplete = () => {
			isThinking = false;
			sending = false;
			inputElement?.focus();
		};

		const unsubs = [
			// Chat service events (interactive conversations)
			ws.on('captain.thinking', handleThinking),
			ws.on('captain.message', handleMessage),
			ws.on('captain.complete', handleComplete),
			ws.on('chat.complete', handleComplete),
			// Monitor service events (automated orchestration, read-only)
			ws.on('monitor.event_received', handleEventReceived),
			ws.on('monitor.thinking', handleThinking),
			ws.on('monitor.message', handleMessage),
			ws.on('monitor.tool_call', handleToolCall),
			ws.on('monitor.tool_result', handleToolResult),
			ws.on('monitor.complete', handleComplete),
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
		await sendMessage();
	}

	async function sendMessage() {
		const message = inputValue.trim();
		if (!message || sending) return;

		const imagesToSend = pendingImages.map(img => ({
			data: img.data.replace(/^data:image\/[^;]+;base64,/, ''),
			mediaType: img.mediaType
		}));

		inputValue = '';
		pendingImages = [];
		sending = true;

		// Add user message to terminal
		const userEntry: TerminalEntry = {
			id: crypto.randomUUID(),
			type: 'user',
			content: message + (imagesToSend.length ? ` [${imagesToSend.length} image(s) attached]` : ''),
			timestamp: new Date(),
		};
		entries = [...entries, userEntry];
		scrollToBottom();

		try {
			await sendChatMessage(projectId, message, imagesToSend.length ? imagesToSend : undefined);
			// Response will come via WebSocket
		} catch (err) {
			toastStore.add('Failed to send message', 'error');
			// Remove the user entry on failure
			entries = entries.filter((e) => e.id !== userEntry.id);
			sending = false;
			inputElement?.focus();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}

	function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;

		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (!file) continue;

				const reader = new FileReader();
				reader.onload = () => {
					const dataUrl = reader.result as string;
					const mediaType = item.type;
					pendingImages = [...pendingImages, {
						id: crypto.randomUUID(),
						data: dataUrl,
						mediaType
					}];
				};
				reader.readAsDataURL(file);
			}
		}
	}

	function removeImage(id: string) {
		pendingImages = pendingImages.filter(img => img.id !== id);
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

<div class="h-full flex flex-col pt-12 md:pt-0">
	<!-- Header -->
	<div class="p-3 md:p-4 border-b border-edge flex-shrink-0">
		<Breadcrumb segments={[
			{ label: 'Projects', href: '/' },
			{ label: project?.name ?? 'Project', href: `/projects/${projectId}` },
			{ label: 'Captain Terminal' }
		]} />
		<div class="mt-3 flex items-center gap-3">
			<div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center flex-shrink-0">
				<svg class="w-4 h-4 text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<rect x="3" y="3" width="18" height="18" rx="2"/>
					<path d="M7 8h4"/>
					<path d="M7 12h10"/>
					<path d="M7 16h6"/>
				</svg>
			</div>
			<div class="min-w-0">
				<h1 class="text-base md:text-lg font-bold text-primary truncate">Captain Terminal</h1>
				<p class="text-xs text-muted">Event-driven project orchestrator</p>
			</div>
		</div>
	</div>

	<!-- Terminal output -->
	<div
		bind:this={messagesContainer}
		class="flex-1 overflow-y-auto p-3 md:p-4 font-mono text-xs md:text-sm bg-black/20"
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
				<p class="mb-2">Captain Terminal ready.</p>
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
						{:else if entry.type === 'captain'}
							<span class="text-cyan flex-shrink-0">[captain]</span>
							<span class="text-primary prose prose-sm prose-invert max-w-none inline break-words min-w-0">
								{@html md(entry.content)}
							</span>
						{:else if entry.type === 'tool_call'}
							<span class="text-cyan flex-shrink-0">[captain]</span>
							<span class="text-purple break-words min-w-0">
								<span class="text-muted/50">-></span> {entry.toolName}({formatToolInput(entry.toolInput)})
							</span>
						{:else if entry.type === 'tool_result'}
							<span class="text-cyan flex-shrink-0">[captain]</span>
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

		<!-- Thinking indicator -->
		{#if isThinking}
			<div class="flex gap-2 mt-2">
				<span class="text-muted/50">[{formatTime(new Date())}]</span>
				<span class="text-cyan">[captain]</span>
				<span class="text-muted animate-pulse">thinking...</span>
			</div>
		{/if}

		<!-- Sending indicator -->
		{#if sending && !isThinking}
			<div class="flex gap-2 mt-2">
				<span class="text-muted/50">[{formatTime(new Date())}]</span>
				<span class="text-cyan">[captain]</span>
				<span class="text-muted animate-pulse">processing...</span>
			</div>
		{/if}
	</div>

	<!-- Input -->
	<div class="p-3 md:p-4 border-t border-edge flex-shrink-0 bg-surface/50">
		<!-- Image previews -->
		{#if pendingImages.length > 0}
			<div class="flex flex-wrap gap-2 mb-3">
				{#each pendingImages as img (img.id)}
					<div class="relative group">
						<img src={img.data} alt="Pending attachment" class="w-14 h-14 md:w-16 md:h-16 object-cover rounded border border-edge" />
						<button
							type="button"
							onclick={() => removeImage(img.id)}
							class="absolute -top-2 -right-2 w-6 h-6 md:w-5 md:h-5 bg-red text-white rounded-full flex items-center justify-center text-xs"
						>
							×
						</button>
					</div>
				{/each}
			</div>
		{/if}
		<form onsubmit={handleSubmit} class="flex gap-2 md:gap-3">
			<div class="flex-1 flex items-start gap-2 bg-black/30 border border-edge rounded-lg px-3 md:px-4 py-3">
				<span class="text-green font-mono mt-0.5 hidden sm:inline">$</span>
				<textarea
					bind:this={inputElement}
					bind:value={inputValue}
					onkeydown={handleKeydown}
					onpaste={handlePaste}
					placeholder="Message Captain..."
					disabled={sending}
					rows="1"
					class="flex-1 bg-transparent text-sm text-primary font-mono placeholder:text-muted outline-none disabled:opacity-50 resize-none min-h-[1.5rem] max-h-32 overflow-y-auto"
					style="field-sizing: content;"
				></textarea>
			</div>
			<button
				type="submit"
				disabled={sending || !inputValue.trim()}
				class="px-3 md:px-4 py-3 bg-cyan/10 border border-cyan text-cyan rounded-lg hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm self-end min-w-[44px] min-h-[44px] flex items-center justify-center"
			>
				{#if sending}
					<svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
					</svg>
				{:else}
					<span class="hidden sm:inline">Send</span>
					<svg class="w-5 h-5 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"/>
					</svg>
				{/if}
			</button>
		</form>
	</div>
</div>
