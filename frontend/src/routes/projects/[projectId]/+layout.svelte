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

	setContext('projectWs', () => ws);

	const EVENT_TOASTS: Partial<Record<WsEvent, (data: Record<string, unknown>) => { msg: string; type: 'info' | 'success' | 'warning' | 'error' } | null>> = {
		'issue.created': (d) => ({ msg: `Issue created: ${d.title ?? 'New issue'}`, type: 'info' }),
		'issue.status_changed': (d) => ({ msg: `Issue status: ${String(d.from).replace(/_/g, ' ')} → ${String(d.to).replace(/_/g, ' ')}`, type: 'info' }),
		'mention.spawned': (d) => {
			const agent = d.agent_name ?? 'Agent';
			const issue = d.issue_title ? ` on: ${d.issue_title}` : '';
			return { msg: `${agent} spawned${issue}`, type: 'info' };
		},
		'mention.completed': (d) => {
			const agent = d.agent_name ?? 'Agent';
			const issue = d.issue_title ? ` on: ${d.issue_title}` : '';
			const status = d.exit_code === 0 ? 'finished' : 'crashed';
			return { msg: `${agent} ${status}${issue}`, type: d.exit_code === 0 ? 'success' : 'error' };
		},
		'mention.error': (d) => {
			const agent = d.agent_name ?? 'Agent';
			const issue = d.issue_title ? ` on: ${d.issue_title}` : '';
			return { msg: `${agent} crashed${issue}`, type: 'error' };
		},
		'mention.chain_depth_reached': (d) => {
			const issue = d.issue_title ? ` on: ${d.issue_title}` : '';
			return { msg: `Chain depth limit reached${issue}`, type: 'warning' };
		},
		'pr.created': (d) => {
			const prNum = d.pr_number ? `#${d.pr_number} ` : '';
			const issue = d.issue_title ? ` on: ${d.issue_title}` : '';
			return { msg: `PR ${prNum}created${issue}`, type: 'success' };
		},
		'pr.status_changed': (d) => ({ msg: `PR status: ${d.from} → ${d.to}`, type: 'info' }),
	};

	$effect(() => {
		const conn = new ProjectWebSocket(projectId);
		for (const [event, toastFn] of Object.entries(EVENT_TOASTS)) {
			conn.on(event as WsEvent, (data) => {
				const result = toastFn!(data);
				if (result) toastStore.add(result.msg, result.type);
			});
		}
		conn.connect();
		ws = conn;
		return () => { conn.disconnect(); ws = null; };
	});

	onDestroy(() => { ws?.disconnect(); });
</script>

{#if ws && (ws.state === 'reconnecting' || ws.state === 'connecting')}
	<div class="fixed top-0 left-0 right-0 z-[300] flex items-center justify-center gap-2 py-1 bg-amber/10 border-b border-amber/30 text-amber text-xs">
		<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber animate-pulse"></span>
		{ws.state === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
	</div>
{/if}

{@render children()}
