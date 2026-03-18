<script lang="ts">
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
	import { ProjectWebSocket } from '$lib/api/ws.svelte.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import { setContext } from 'svelte';
	import type { WsEvent } from '$lib/api/ws.svelte.js';

	let { children } = $props();

	let projectId = $derived($page.params.projectId!);
	let ws = $state<ProjectWebSocket | null>(null);

	// Expose the WS instance to child pages via context
	setContext('projectWs', () => ws);

	// Toast messages for WS events
	const EVENT_TOASTS: Partial<Record<WsEvent, (data: Record<string, unknown>) => { msg: string; type: 'info' | 'success' | 'warning' | 'error' } | null>> = {
		'issue.created': (d) => ({ msg: `Issue created: ${d.title ?? 'New issue'}`, type: 'info' }),
		'issue.status_changed': (d) => ({ msg: `Issue status: ${String(d.from).replace(/_/g, ' ')} → ${String(d.to).replace(/_/g, ' ')}`, type: 'info' }),
		'issue.assigned': (d) => ({ msg: `${d.agent_name} assigned to issue`, type: 'info' }),
		'agent.error': (d) => ({ msg: `Agent error${d.message ? `: ${d.message}` : ''}`, type: 'error' }),
		'agent.needs_help': (d) => ({ msg: `Agent needs help${d.message ? `: ${d.message}` : ''}`, type: 'warning' }),
		'agent.created': (d) => ({ msg: `Agent created: ${d.name}`, type: 'success' }),
		'agent.status_changed': (d) => ({ msg: `Agent status: ${d.state}`, type: 'info' }),
		'review.completed': (d) => ({ msg: `Review ${d.verdict === 'approved' ? 'approved' : 'changes requested'}`, type: d.verdict === 'approved' ? 'success' : 'warning' }),
		'pr.created': () => ({ msg: 'Pull request created', type: 'success' }),
		'pr.status_changed': (d) => ({ msg: `PR status: ${d.from} → ${d.to}`, type: 'info' }),
		'orchestrator.draft_issue': (d) => ({ msg: `Orchestrator drafted issue: ${d.title ?? 'New draft'}`, type: 'info' }),
	};

	$effect(() => {
		// When projectId changes, disconnect old and connect new
		const conn = new ProjectWebSocket(projectId);

		// Wire up toast notifications for all configured events
		for (const [event, toastFn] of Object.entries(EVENT_TOASTS)) {
			conn.on(event as WsEvent, (data) => {
				const result = toastFn!(data);
				if (result) toastStore.add(result.msg, result.type);
			});
		}

		conn.connect();
		ws = conn;

		return () => {
			conn.disconnect();
			ws = null;
		};
	});

	onDestroy(() => {
		ws?.disconnect();
	});
</script>

<!-- Reconnect bar -->
{#if ws && (ws.state === 'reconnecting' || ws.state === 'connecting')}
	<div class="fixed top-0 left-0 right-0 z-[300] flex items-center justify-center gap-2 py-1 bg-amber/10 border-b border-amber/30 text-amber text-xs">
		<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber animate-pulse"></span>
		{ws.state === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
	</div>
{/if}

{@render children()}
