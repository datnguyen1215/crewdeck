<script lang="ts">
	import { page } from '$app/stores';
	import { getContext, tick } from 'svelte';
	import {
		listCaptainMessages,
		sendCaptainMessage,
		listSessions,
		type CaptainMessage,
		type Session
	} from '$lib/api/http.js';
	import type { ProjectWebSocket } from '$lib/api/ws.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { relTime } from '$lib/utils/time.js';
	import Terminal from '$lib/components/Terminal.svelte';

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let projectId = $derived($page.params.projectId!);
	let messages = $state<CaptainMessage[]>([]);
	let loading = $state(true);
	let sending = $state(false);
	let inputText = $state('');
	let scrollContainer: HTMLDivElement | undefined = $state();

	// Terminal state
	let orchestratorSession = $state<Session | null>(null);
	let terminalStatus = $state<'running' | 'completed' | 'idle'>('idle');

	async function scrollToBottom() {
		await tick();
		if (scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight;
		}
	}

	// Load messages
	$effect(() => {
		loading = true;
		let cancelled = false;
		listCaptainMessages(projectId)
			.then((msgs) => {
				if (cancelled) return;
				messages = msgs;
				scrollToBottom();
			})
			.catch(() => {
				if (!cancelled) toastStore.add('Failed to load captain messages', 'error');
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	// Load captain session (persistent tmux session)
	$effect(() => {
		let cancelled = false;
		listSessions(projectId, { type: 'captain' })
			.then((sessions) => {
				if (cancelled) return;
				if (sessions.length > 0) {
					orchestratorSession = sessions[0];
					terminalStatus = sessions[0].status === 'running' ? 'running' : 'completed';
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	// WebSocket: captain messages
	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const unsub = ws.on('captain.message', (data) => {
			const msg = data as unknown as CaptainMessage;
			if (!messages.some((m) => m.id === msg.id)) {
				messages = [...messages, msg];
				scrollToBottom();
			}
		});
		return () => unsub();
	});

	// WebSocket: session lifecycle
	$effect(() => {
		const ws = getWs();
		if (!ws) return;
		const unsubs = [
			ws.on('session.started', () => {
				// Re-fetch captain session on any session start
				listSessions(projectId, { type: 'captain' })
					.then((sessions) => {
						if (sessions.length > 0) {
							orchestratorSession = sessions[0];
							terminalStatus = sessions[0].status === 'running' ? 'running' : 'completed';
						}
					})
					.catch(() => {});
			}),
			ws.on('session.ended', (data) => {
				if (orchestratorSession && data.session_id === orchestratorSession.id) {
					terminalStatus = 'completed';
				}
			})
		];
		return () => unsubs.forEach((u) => u());
	});

	async function handleSend() {
		const content = inputText.trim();
		if (!content || sending) return;
		sending = true;
		try {
			const msg = await sendCaptainMessage(projectId, { content });
			inputText = '';
			if (!messages.some((m) => m.id === msg.id)) {
				messages = [...messages, msg];
				scrollToBottom();
			}
		} catch {
			toastStore.add('Failed to send message', 'error');
		} finally {
			sending = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}
</script>

<div class="flex h-full">
	<!-- Chat panel -->
	<div class="flex flex-col flex-1 min-w-0">
		<!-- Header -->
		<div class="p-6 pb-3 flex-shrink-0">
			<h1 class="text-xl font-bold text-primary uppercase tracking-wide">Captain</h1>
			<p class="text-muted text-xs mt-0.5">Project coordination and directives</p>
		</div>

		<!-- Messages -->
		<div class="flex-1 overflow-auto px-6 pb-3" bind:this={scrollContainer}>
			{#if loading}
				{@const skeletonWidths = [60, 80, 45, 70, 55]}
				<div class="flex flex-col gap-4 max-w-2xl fade-up">
					{#each Array(5) as _, i}
						<div
							class="flex gap-3 fade-up {i % 2 === 0 ? '' : 'flex-row-reverse'}"
							style="animation-delay: {i * 40}ms"
						>
							<div class="skeleton w-8 h-8 rounded-full flex-shrink-0"></div>
							<div class="flex-1 {i % 2 === 0 ? 'max-w-[75%]' : 'max-w-[60%]'}">
								<div class="skeleton h-3 w-16 rounded mb-1.5"></div>
								<div class="skeleton h-16 rounded" style="width: {skeletonWidths[i]}%"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if messages.length === 0}
				<div class="flex items-center justify-center h-full">
					<div class="text-center">
						<p class="text-muted text-sm">No messages yet.</p>
						<p class="text-muted text-xs mt-1">
							Send a message to direct the captain's behavior.
						</p>
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-4 max-w-2xl">
					{#each messages as msg (msg.id)}
						{@const isCaptain = msg.author_type === 'captain'}
						{@const context = msg.context as Record<string, unknown> | null}
						<div class="flex gap-3 {isCaptain ? '' : 'flex-row-reverse'}">
							<!-- Avatar -->
							<div
								class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border
									{isCaptain
									? 'bg-purple/10 border-purple text-purple'
									: 'bg-cyan/10 border-cyan text-cyan'}"
							>
								<span class="text-xs font-bold">{isCaptain ? 'C' : 'U'}</span>
							</div>

							<!-- Bubble -->
							<div class="max-w-[75%] min-w-0">
								<div class="flex items-center gap-2 mb-0.5 {isCaptain ? '' : 'flex-row-reverse'}">
									<span class="text-xs font-semibold {isCaptain ? 'text-purple' : 'text-cyan'}">
										{isCaptain ? 'Captain' : 'You'}
									</span>
									<span
										class="text-muted text-xs font-mono"
										title={new Date(msg.created_at).toLocaleString()}
									>
										{relTime(msg.created_at)}
									</span>
								</div>
								<div
									class="p-3 rounded-lg text-sm leading-relaxed
										{isCaptain
										? 'bg-surface border border-edge text-secondary'
										: 'bg-cyan/10 border border-cyan/20 text-primary'}"
								>
									<p class="whitespace-pre-wrap break-words">{msg.content}</p>

									{#if isCaptain && context?.action}
										<div
											class="mt-2 pt-2 border-t border-edge text-xs text-muted flex items-center gap-1.5"
										>
											<span class="font-mono px-1.5 py-0.5 bg-base rounded text-purple">
												{context.action}
											</span>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Input -->
		<div class="p-4 border-t border-edge flex-shrink-0">
			<div class="max-w-2xl flex gap-2">
				<textarea
					bind:value={inputText}
					onkeydown={handleKeydown}
					placeholder="Send a directive to the captain…"
					rows="1"
					disabled={sending}
					class="flex-1 bg-surface border border-edge rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted
						focus:outline-none focus:border-cyan transition-colors resize-none
						disabled:opacity-50"
				></textarea>
				<button
					onclick={handleSend}
					disabled={!inputText.trim() || sending}
					class="px-4 py-2 bg-cyan/10 border border-cyan/30 text-cyan text-sm rounded-lg
						hover:bg-cyan/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
				>
					Send
				</button>
			</div>
		</div>
	</div>

	<!-- Terminal panel -->
	<div class="w-[500px] flex-shrink-0 border-l border-edge flex flex-col">
		{#if orchestratorSession}
			<Terminal
				{projectId}
				sessionId={orchestratorSession.id}
				agentName="Captain"
				status={terminalStatus}
			/>
		{:else}
			<div class="flex items-center justify-center h-full text-muted text-sm">
				<div class="text-center">
					<p>No terminal session</p>
					<p class="text-xs mt-1">Terminal will appear when the captain processes a request</p>
				</div>
			</div>
		{/if}
	</div>
</div>
