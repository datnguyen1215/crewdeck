<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import '@xterm/xterm/css/xterm.css';

	interface Props {
		projectId: string;
	}

	let { projectId }: Props = $props();

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let destroyed = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let term: any = null;
	let ro: ResizeObserver | null = null;
	let termWs: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectDelay = 1000;
	const MAX_RECONNECT_DELAY = 30000;
	let connected = $state(false);

	function connectTerminalWs() {
		if (destroyed || !term) return;

		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${protocol}//${location.host}/terminal-ws?projectId=${encodeURIComponent(projectId)}`;
		const ws = new WebSocket(url);

		ws.onopen = () => {
			connected = true;
			reconnectDelay = 1000;
			// Send initial resize
			ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
		};

		ws.onmessage = (event) => {
			if (term) term.write(event.data);
		};

		ws.onclose = () => {
			connected = false;
			termWs = null;
			if (!destroyed) {
				reconnectTimer = setTimeout(() => {
					connectTerminalWs();
					reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
				}, reconnectDelay);
			}
		};

		ws.onerror = () => {
			connected = false;
			// onclose fires after onerror
		};

		termWs = ws;
	}

	onDestroy(() => {
		destroyed = true;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		termWs?.close();
		ro?.disconnect();
		term?.dispose();
	});

	onMount(async () => {
		const { Terminal } = await import('@xterm/xterm');
		const { FitAddon } = await import('@xterm/addon-fit');
		const { WebLinksAddon } = await import('@xterm/addon-web-links');

		if (destroyed) return;

		const t = new Terminal({
			cursorBlink: true,
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

		// Send terminal input to PTY
		t.onData((data: string) => {
			if (termWs?.readyState === WebSocket.OPEN) {
				termWs.send(data);
			}
		});

		// Connect to terminal WebSocket for live PTY streaming
		connectTerminalWs();

		ro = new ResizeObserver(() => {
			fitAddon.fit();
			// Notify server of resize
			if (termWs?.readyState === WebSocket.OPEN && term) {
				termWs.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
			}
		});
		ro.observe(containerEl!);
	});

</script>

<div
	class="terminal-wrap flex flex-col rounded overflow-hidden border"
	class:border-cyan={connected}
	class:border-edge={!connected}
	style={connected ? 'box-shadow: var(--glow-cyan)' : ''}
>
	<!-- Header bar -->
	<div
		class="flex items-center gap-2 px-3 py-1.5 border-b text-xs font-mono bg-base-hi"
		class:border-cyan={connected}
		class:border-edge={!connected}
	>
		<span
			class="inline-block w-2 h-2 rounded-full"
			class:bg-green={connected}
			class:animate-pulse={connected}
			class:bg-muted={!connected}
		></span>
		<span class="text-secondary">Captain Terminal</span>
		<span class="ml-auto text-muted capitalize">{connected ? 'Connected' : 'Disconnected'}</span>
	</div>

	<!-- xterm container -->
	<div
		class="xterm-container"
		bind:this={containerEl}
	></div>
</div>

<style>
	.xterm-container {
		min-height: 300px;
		height: 600px;
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
