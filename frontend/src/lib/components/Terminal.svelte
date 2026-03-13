<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import '@xterm/xterm/css/xterm.css';
	import { streamOutput } from '$lib/mock/terminal.js';

	interface OutputLine { text: string; delayMs: number; }
	interface Session {
		agentName: string;
		status: 'running' | 'completed' | 'idle';
		outputLines: OutputLine[];
	}

	interface Props {
		session: Session;
	}

	let { session }: Props = $props();

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let cancelStream: (() => void) | null = null;
	let streamDone = $state(false);
	let destroyed = false;

	const isRunning = $derived(session.status === 'running' && !streamDone);

	onDestroy(() => {
		destroyed = true;
		cancelStream?.();
	});

	onMount(async () => {
		// Dynamic import — xterm is client-only (no SSR)
		const { Terminal } = await import('@xterm/xterm');
		const { FitAddon } = await import('@xterm/addon-fit');
		const { WebLinksAddon } = await import('@xterm/addon-web-links');

		if (destroyed) return;

		const t = new Terminal({
			cursorBlink: session.status === 'running',
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
			scrollback: 1000,
			allowProposedApi: false,
		});

		const fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();
		t.loadAddon(fitAddon);
		t.loadAddon(webLinksAddon);

		t.open(containerEl!);
		fitAddon.fit();

		// Start streaming mock output
		cancelStream = streamOutput(t, session.outputLines, () => {
			streamDone = true;
		});

		// Resize observer keeps terminal fitted to container
		const ro = new ResizeObserver(() => fitAddon.fit());
		ro.observe(containerEl!);

		return () => {
			ro.disconnect();
			cancelStream?.();
			t.dispose();
		};
	});
</script>

<div
	class="terminal-wrap flex flex-col gap-0 rounded overflow-hidden border"
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
		<span class="text-secondary">Agent: <span class="text-cyan">{session.agentName}</span></span>
		<span class="ml-auto text-muted capitalize">{isRunning ? 'Running' : session.status}</span>
	</div>

	<!-- xterm container -->
	<div
		class="xterm-container"
		class:opacity-60={session.status === 'completed'}
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
