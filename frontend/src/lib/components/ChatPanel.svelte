<script lang="ts">
	import { tick } from 'svelte';
	import { getChatHistory, sendChatMessage, type ChatMessage } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { md } from '$lib/utils/markdown.js';

	interface TerminalEntry {
		id: string;
		type: 'system' | 'captain' | 'user' | 'tool_call' | 'tool_result';
		content: string;
		timestamp: Date;
		toolName?: string;
		toolInput?: unknown;
		success?: boolean;
	}

	interface PendingImage {
		id: string;
		data: string;
		mediaType: string;
	}

	let { projectId, ws }: { projectId: string; ws: ProjectWebSocket | null } = $props();

	let entries = $state<TerminalEntry[]>([]);
	let loading = $state(true);
	let sending = $state(false);
	let inputValue = $state('');
	let isThinking = $state(false);
	let streamingEntryId = $state<string | null>(null);
	let messagesContainer: HTMLDivElement | undefined;
	let inputElement: HTMLTextAreaElement | undefined;
	let pendingImages = $state<PendingImage[]>([]);
	let sendingTimeout: ReturnType<typeof setTimeout> | null = null;

	// Load chat history
	$effect(() => {
		const pid = projectId;
		let cancelled = false;
		loading = true;
		streamingEntryId = null;

		getChatHistory(pid)
			.then((hist: ChatMessage[]) => {
				if (cancelled) return;
				entries = hist.map((m) => ({
					id: m.id,
					type: m.role === 'user' ? 'user' : 'captain',
					content: m.content,
					timestamp: new Date(m.created_at),
				}));
				loading = false;
				scrollToBottom();
			})
			.catch(() => {
				if (!cancelled) {
					loading = false;
					toastStore.add('Failed to load chat history', 'error');
				}
			});

		return () => { cancelled = true; };
	});

	// WebSocket: captain.chat.* events
	$effect(() => {
		if (!ws) return;

		const handleThinking = () => {
			isThinking = true;
			streamingEntryId = null;
		};

		// Streaming: build up assistant message token-by-token
		const handleChunk = (data: Record<string, unknown>) => {
			isThinking = false;
			const text = (data.text ?? data.content ?? '') as string;
			if (streamingEntryId) {
				entries = entries.map(e =>
					e.id === streamingEntryId
						? { ...e, content: e.content + text }
						: e
				);
			} else {
				const id = crypto.randomUUID();
				streamingEntryId = id;
				entries = [...entries, {
					id,
					type: 'captain',
					content: text,
					timestamp: new Date(),
				}];
			}
			scrollToBottom();
		};

		// Full message (non-streaming fallback)
		const handleMessage = (data: Record<string, unknown>) => {
			isThinking = false;
			// If we already have a streaming entry, finalize it with full content
			if (streamingEntryId) {
				entries = entries.map(e =>
					e.id === streamingEntryId
						? { ...e, content: data.content as string }
						: e
				);
				streamingEntryId = null;
			} else {
				entries = [...entries, {
					id: crypto.randomUUID(),
					type: 'captain',
					content: data.content as string,
					timestamp: new Date(),
				}];
			}
			scrollToBottom();
		};

		const handleToolCall = (data: Record<string, unknown>) => {
			// Finalize any in-progress streaming entry
			streamingEntryId = null;
			entries = [...entries, {
				id: crypto.randomUUID(),
				type: 'tool_call',
				content: `${data.tool_name}`,
				toolName: data.tool_name as string,
				toolInput: data.tool_input,
				timestamp: new Date(),
			}];
			scrollToBottom();
		};

		const handleToolResult = (data: Record<string, unknown>) => {
			const result = data.result as { success: boolean; message: string } | undefined;
			entries = [...entries, {
				id: crypto.randomUUID(),
				type: 'tool_result',
				content: result?.message ?? String(data.message ?? ''),
				toolName: data.tool_name as string,
				success: result?.success ?? true,
				timestamp: new Date(),
			}];
			scrollToBottom();
		};

		const handleComplete = () => {
			isThinking = false;
			sending = false;
			streamingEntryId = null;
			if (sendingTimeout) { clearTimeout(sendingTimeout); sendingTimeout = null; }
			inputElement?.focus();
		};

		const unsubs = [
			ws.on('captain.thinking', handleThinking),
			ws.on('captain.chat.chunk', handleChunk),
			ws.on('captain.message', handleMessage),
			ws.on('captain.chat.tool_call', handleToolCall),
			ws.on('captain.chat.tool_result', handleToolResult),
			ws.on('captain.complete', handleComplete),
			ws.on('captain.chat.complete', handleComplete),
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

		// Safety timeout: reset sending if no completion event arrives within 60s
		if (sendingTimeout) clearTimeout(sendingTimeout);
		sendingTimeout = setTimeout(() => {
			if (sending) {
				sending = false;
				isThinking = false;
				streamingEntryId = null;
				toastStore.add('Response timed out — you can try again', 'warning');
				inputElement?.focus();
			}
			sendingTimeout = null;
		}, 60_000);

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
		} catch {
			toastStore.add('Failed to send message', 'error');
			entries = entries.filter((e) => e.id !== userEntry.id);
			sending = false;
			if (sendingTimeout) { clearTimeout(sendingTimeout); sendingTimeout = null; }
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
					pendingImages = [...pendingImages, {
						id: crypto.randomUUID(),
						data: reader.result as string,
						mediaType: item.type
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

<div class="h-full flex flex-col">
	<!-- Messages -->
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
					<span>Loading chat history...</span>
				</div>
			</div>
		{:else if entries.length === 0}
			<div class="text-muted py-8 text-center">
				<p class="mb-2">Chat ready.</p>
				<p class="text-xs">Send a message to start a conversation with Captain.</p>
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

		{#if isThinking}
			<div class="flex gap-2 mt-2">
				<span class="text-muted/50">[{formatTime(new Date())}]</span>
				<span class="text-cyan">[captain]</span>
				<span class="text-muted animate-pulse">thinking...</span>
			</div>
		{/if}

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
		<form onsubmit={(e) => { e.preventDefault(); sendMessage(); }} class="flex gap-2 md:gap-3">
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
