<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getContext } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import type { ProjectWebSocket } from '$lib/api/ws.js';

	interface Props {
		projectId: string;
		sessionId: string;
		agentName: string;
		status: 'running' | 'completed' | 'idle';
	}

	let { projectId, sessionId, agentName, status }: Props = $props();

	const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let destroyed = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let term: any = null;
	let ro: ResizeObserver | null = null;
	let unsubOutput: (() => void) | null = null;

	const isRunning = $derived(status === 'running');

	onDestroy(() => {
		destroyed = true;
		unsubOutput?.();
		ro?.disconnect();
		term?.dispose();
	});

	onMount(async () => {
		const { Terminal } = await import('@xterm/xterm');
		const { FitAddon } = await import('@xterm/addon-fit');
		const { WebLinksAddon } = await import('@xterm/addon-web-links');

		if (destroyed) return;

		const t = new Terminal({
			cursorBlink: status === 'running',
			fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, ui-monospace, monospace',
			fontSize: 12,
			lineHeight: 1.4,
			theme: {
				background: '#0a0a0f',
				foreground: '#a1a1aa',
				cursor: '#22d3ee',
				cursorAccent: '#0a0a0f',
				black: '#0a0a0f',
				brightBlack: '#3a3a4a',
				red: '#f87171',
				brightRed: '#f87171',
				green: '#4ade80',
				brightGreen: '#4ade80',
				yellow: '#fbbf24',
				brightYellow: '#fbbf24',
				blue: '#60a5fa',
				brightBlue: '#60a5fa',
				magenta: '#a78bfa',
				brightMagenta: '#a78bfa',
				cyan: '#22d3ee',
				brightCyan: '#22d3ee',
				white: '#e4e4e7',
				brightWhite: '#e4e4e7',
				selectionBackground: '#3a3a4a',
			},
			scrollback: 5000,
		});

		const fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();
		t.loadAddon(fitAddon);
		t.loadAddon(webLinksAddon);

		t.open(containerEl!);
		fitAddon.fit();
		term = t;

		// Subscribe to WS session.output events
		const ws = getWs();
		if (ws) {
			unsubOutput = ws.on('session.output', (data) => {
				if (data.session_id === sessionId && term) {
					term.write(data.output as string);
				}
			});
		}

		ro = new ResizeObserver(() => fitAddon.fit());
		ro.observe(containerEl!);
	});

	// Write new output when session.output changes
	$effect(() => {
		if (term && session.output) {
			term.clear();
			for (const line of session.output.split('\n')) {
				term.writeln(line);
			}
		}
	});
</script>

<div
	class="terminal-wrap flex flex-col rounded overflow-hidden border"
	class:border-cyan={isRunning}
	class:border-edge={!isRunning}
	style={isRunning ? 'box-shadow: var(--glow-cyan)' : ''}
>
	<!-- Header bar -->
	<div
		class="flex items-center gap-2 px-3 py-1.5 border-b text-xs font-mono bg-base-hi"
		class:border-cyan={isRunning}
		class:border-edge={!isRunning}
	>
		<span
			class="inline-block w-2 h-2 rounded-full"
			class:bg-green={isRunning}
			class:animate-pulse={isRunning}
			class:bg-muted={!isRunning}
		></span>
		<span class="text-secondary">Agent: <span class="text-cyan">{agentName}</span></span>
		<span class="ml-auto text-muted capitalize">{isRunning ? 'Running' : status}</span>
	</div>

	<!-- xterm container -->
	<div
		class="xterm-container"
		class:opacity-60={status === 'completed'}
		bind:this={containerEl}
	></div>
</div>

<style>
	.xterm-container {
		min-height: 300px;
		height: 360px;
		background: var(--color-base);
		padding: 8px 4px;
	}

	/* xterm global overrides to match theme */
	:global(.xterm) {
		height: 100%;
	}

	:global(.xterm-viewport) {
		background-color: var(--color-base) !important;
	}

	/* Custom scrollbar */
	:global(.xterm-viewport::-webkit-scrollbar) {
		width: 6px;
	}

	:global(.xterm-viewport::-webkit-scrollbar-track) {
		background: var(--color-base);
	}

	:global(.xterm-viewport::-webkit-scrollbar-thumb) {
		background: var(--color-edge-hi);
		border-radius: 3px;
	}

	:global(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
		background: var(--color-muted);
	}
</style>
