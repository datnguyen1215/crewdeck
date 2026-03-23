<script lang="ts">
	import { page } from '$app/stores';
	import { getContext, tick } from 'svelte';
	import { getChatHistory, sendChatMessage, getProject, type ChatMessage, type Project } from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let projectId = $derived($page.params.projectId!);
	let project = $state<Project | null>(null);
	let pageTitle = $derived(project?.name ? `Chat - ${project.name} - CrewDeck` : 'Chat - CrewDeck');

	let messages = $state<ChatMessage[]>([]);
	let loading = $state(true);
	let sending = $state(false);
	let inputValue = $state('');
	let streamingContent = $state('');
	let messagesContainer: HTMLDivElement | undefined;

	// Load initial data
	$effect(() => {
		loading = true;
		let cancelled = false;

		Promise.all([getChatHistory(projectId), getProject(projectId)])
			.then(([hist, proj]) => {
				if (cancelled) return;
				messages = hist;
				project = proj;
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

	// WebSocket handlers for streaming
	$effect(() => {
		const ws = getWs();
		if (!ws) return;

		const handleStream = (data: Record<string, unknown>) => {
			const token = data.token as string;
			if (token) {
				streamingContent += token;
				scrollToBottom();
			}
		};

		const handleComplete = (data: Record<string, unknown>) => {
			// Refetch to get the saved message
			getChatHistory(projectId).then((hist) => {
				messages = hist;
				streamingContent = '';
				sending = false;
				scrollToBottom();
			});
		};

		const unsubs = [
			ws.on('chat.stream', handleStream),
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
		streamingContent = '';

		// Optimistically add user message
		const tempMessage: ChatMessage = {
			id: crypto.randomUUID(),
			project_id: projectId,
			role: 'user',
			content: message,
			created_at: new Date().toISOString(),
		};
		messages = [...messages, tempMessage];
		scrollToBottom();

		try {
			const result = await sendChatMessage(projectId, message);
			// Update with real message ID
			messages = messages.map((m) =>
				m.id === tempMessage.id ? result.user_message : m
			);
		} catch (err) {
			toastStore.add('Failed to send message', 'error');
			// Remove optimistic message
			messages = messages.filter((m) => m.id !== tempMessage.id);
			sending = false;
		}
	}

	function formatTime(iso: string): string {
		const date = new Date(iso);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function renderMarkdown(content: string): string {
		// Simple markdown rendering for code blocks and basic formatting
		return content
			// Code blocks
			.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="bg-base border border-edge rounded p-3 my-2 overflow-x-auto text-xs"><code>$2</code></pre>')
			// Inline code
			.replace(/`([^`]+)`/g, '<code class="bg-base px-1 rounded text-cyan">$1</code>')
			// Bold
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			// Bullet points
			.replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>')
			// Headers
			.replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold text-primary mt-3 mb-1">$1</h3>')
			.replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-primary mt-4 mb-2">$1</h2>')
			// Line breaks
			.replace(/\n/g, '<br>');
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
			{ label: 'Chat' }
		]} />
		<div class="mt-3 flex items-center gap-3">
			<div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center">
				<svg class="w-4 h-4 text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
				</svg>
			</div>
			<div>
				<h1 class="text-lg font-bold text-primary">Admiral Chat</h1>
				<p class="text-xs text-muted">Project management assistant</p>
			</div>
		</div>
	</div>

	<!-- Messages -->
	<div
		bind:this={messagesContainer}
		class="flex-1 overflow-y-auto p-4 space-y-4"
	>
		{#if loading}
			<div class="flex justify-center py-8">
				<div class="flex items-center gap-2 text-muted">
					<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
					</svg>
					<span class="text-sm">Loading chat history...</span>
				</div>
			</div>
		{:else if messages.length === 0 && !streamingContent}
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<div class="w-16 h-16 rounded-full bg-surface border border-edge flex items-center justify-center mb-4">
					<svg class="w-8 h-8 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
					</svg>
				</div>
				<p class="text-primary font-medium mb-1">Start a conversation</p>
				<p class="text-muted text-sm max-w-sm">
					Ask Admiral to create issues, check project status, manage knowledge entries, or help with project organization.
				</p>
			</div>
		{:else}
			{#each messages as message (message.id)}
				<div class="flex gap-3 {message.role === 'user' ? 'flex-row-reverse' : ''}">
					<!-- Avatar -->
					<div class="flex-shrink-0">
						{#if message.role === 'user'}
							<div class="w-8 h-8 rounded-full bg-surface border border-edge flex items-center justify-center">
								<svg class="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
									<circle cx="12" cy="7" r="4"/>
								</svg>
							</div>
						{:else}
							<div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center">
								<svg class="w-4 h-4 text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M12 2L2 7l10 5 10-5-10-5z"/>
									<path d="M2 17l10 5 10-5"/>
									<path d="M2 12l10 5 10-5"/>
								</svg>
							</div>
						{/if}
					</div>

					<!-- Message content -->
					<div class="max-w-[80%] {message.role === 'user' ? 'text-right' : ''}">
						<div class="flex items-center gap-2 mb-1 {message.role === 'user' ? 'flex-row-reverse' : ''}">
							<span class="text-xs font-medium {message.role === 'user' ? 'text-secondary' : 'text-cyan'}">
								{message.role === 'user' ? 'You' : 'Admiral'}
							</span>
							<span class="text-xs text-muted">{formatTime(message.created_at)}</span>
						</div>
						<div class="rounded-lg px-4 py-3 {message.role === 'user'
							? 'bg-surface border border-edge text-primary'
							: 'bg-cyan/10 border border-cyan/20 text-primary'}"
						>
							{#if message.role === 'assistant'}
								<div class="text-sm prose prose-sm prose-invert max-w-none">
									{@html renderMarkdown(message.content)}
								</div>
							{:else}
								<p class="text-sm whitespace-pre-wrap">{message.content}</p>
							{/if}
						</div>
					</div>
				</div>
			{/each}

			<!-- Streaming message -->
			{#if streamingContent}
				<div class="flex gap-3">
					<div class="flex-shrink-0">
						<div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center">
							<svg class="w-4 h-4 text-cyan animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12 2L2 7l10 5 10-5-10-5z"/>
								<path d="M2 17l10 5 10-5"/>
								<path d="M2 12l10 5 10-5"/>
							</svg>
						</div>
					</div>
					<div class="max-w-[80%]">
						<div class="flex items-center gap-2 mb-1">
							<span class="text-xs font-medium text-cyan">Admiral</span>
							<span class="text-xs text-muted">typing...</span>
						</div>
						<div class="rounded-lg px-4 py-3 bg-cyan/10 border border-cyan/20">
							<div class="text-sm prose prose-sm prose-invert max-w-none">
								{@html renderMarkdown(streamingContent)}
							</div>
						</div>
					</div>
				</div>
			{/if}

			<!-- Typing indicator when waiting for stream to start -->
			{#if sending && !streamingContent}
				<div class="flex gap-3">
					<div class="flex-shrink-0">
						<div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center">
							<svg class="w-4 h-4 text-cyan animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12 2L2 7l10 5 10-5-10-5z"/>
								<path d="M2 17l10 5 10-5"/>
								<path d="M2 12l10 5 10-5"/>
							</svg>
						</div>
					</div>
					<div class="rounded-lg px-4 py-3 bg-cyan/10 border border-cyan/20">
						<div class="flex items-center gap-1">
							<span class="w-2 h-2 bg-cyan/60 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
							<span class="w-2 h-2 bg-cyan/60 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
							<span class="w-2 h-2 bg-cyan/60 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Input -->
	<div class="p-4 border-t border-edge flex-shrink-0">
		<form onsubmit={handleSubmit} class="flex gap-3">
			<input
				type="text"
				bind:value={inputValue}
				placeholder="Ask Admiral anything about your project..."
				disabled={sending}
				class="flex-1 bg-surface border border-edge rounded-lg px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-cyan transition-colors disabled:opacity-50"
			/>
			<button
				type="submit"
				disabled={sending || !inputValue.trim()}
				class="px-4 py-3 bg-cyan/10 border border-cyan text-cyan rounded-lg hover:bg-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{#if sending}
					<svg class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="32" stroke-dashoffset="12" />
					</svg>
				{:else}
					<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="22" y1="2" x2="11" y2="13"/>
						<polygon points="22 2 15 22 11 13 2 9 22 2"/>
					</svg>
				{/if}
			</button>
		</form>
	</div>
</div>
