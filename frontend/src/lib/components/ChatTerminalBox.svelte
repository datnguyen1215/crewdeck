<script lang="ts">
  import { autoscroll } from '$lib/utils/autoscroll.js';
  import { extractToolDescription } from '$lib/utils/event.js';
  import type { ChatMessageEvent } from '$lib/api/types.js';

  let {
    events = [],
    streaming = false,
  }: {
    events: ChatMessageEvent[];
    streaming?: boolean;
  } = $props();

  let collapsed = $state<Record<string, boolean>>({});

  function toggle(id: string) {
    collapsed[id] = !collapsed[id];
  }

  function truncate(s: string, max = 300): string {
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  function formatResult(result: unknown): { text: string; isError: boolean } {
    if (typeof result === 'string') {
      return { text: truncate(result), isError: false };
    }
    const s = JSON.stringify(result);
    // Heuristic: detect tool errors
    const isError = result !== null && typeof result === 'object' && 'error' in (result as object);
    return { text: truncate(s, 300), isError };
  }

  function inputPreview(input: unknown): string {
    if (!input) return '';
    return extractToolDescription(input as Record<string, unknown>) ?? '';
  }
</script>

<div class="chat-terminal-box">
  <div class="scanlines">
    <div class="terminal-content" use:autoscroll>
      {#each events as event (event.id)}
        {@render eventRow(event)}
      {/each}
      {#if streaming && events.length === 0}
        <div class="event-row">
          <span class="event-timestamp">--:--</span>
          <span class="event-dot thinking-dot"></span>
          <span class="event-text thinking-text">Initializing...</span>
        </div>
      {/if}
    </div>
  </div>
</div>

{#snippet eventRow(event: ChatMessageEvent)}
  {@const isCollapsed = collapsed[event.id] ?? false}

  {#if event.type === 'thinking'}
    <button class="event-row thinking-row" onclick={() => toggle(event.id)} data-collapsed={isCollapsed || (!streaming)}>
      <span class="event-dot thinking-dot"></span>
      <span class="event-icon">💭</span>
      <span class="event-text thinking-text">
        {#if isCollapsed || !streaming}
          Thinking... <span class="text-muted">({typeof event.data.content === 'string' ? truncate(event.data.content, 60) : 'done'})</span>
        {:else}
          {typeof event.data.content === 'string' ? truncate(event.data.content, 200) : 'Thinking...'}
        {/if}
      </span>
    </button>
    {#if !isCollapsed && streaming && typeof event.data.content === 'string' && event.data.content}
      <div class="thinking-detail">
        <pre class="whitespace-pre-wrap break-words text-xs">{event.data.content}</pre>
      </div>
    {/if}

  {:else if event.type === 'tool_call'}
    {@const preview = inputPreview(event.data.tool_input)}
    <div class="event-row tool-call-row">
      <span class="event-dot tool-dot"></span>
      <span class="event-icon">⚡</span>
      <span class="event-text tool-name">{event.data.tool_name}</span>
      {#if preview}
        <span class="event-text text-muted ml-1">{preview}</span>
      {/if}
      <span class="spinner" class:invisible={!streaming}></span>
    </div>

  {:else if event.type === 'tool_result'}
    {@const res = formatResult(event.data.result)}
    <button class="event-row tool-result-row" onclick={() => toggle(event.id)} data-collapsed={isCollapsed}>
      <span class="event-dot" class:result-ok={!res.isError} class:result-err={res.isError}></span>
      <span class="event-text" class:text-green={!res.isError} class:text-red={res.isError}>
        {#if isCollapsed}
          {res.isError ? 'Error' : 'Done'}
        {:else}
          {truncate(res.text, 200)}
        {/if}
      </span>
    </button>

  {:else if event.type === 'text'}
    <!-- text events are shown in the main response bubble, skip here -->

  {:else if event.type === 'result'}
    <div class="event-row result-row">
      <span class="event-dot result-dot"></span>
      <span class="event-text text-muted">Complete</span>
    </div>

  {:else}
    <div class="event-row">
      <span class="event-dot"></span>
      <span class="event-text text-muted">{event.type}</span>
    </div>
  {/if}
{/snippet}

<style>
  .chat-terminal-box {
    border: 1px solid var(--color-edge);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 8px;
    position: relative;
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: 12px;
    background: rgba(0, 0, 0, 0.3);
  }

  .scanlines {
    position: relative;
  }

  .scanlines::before {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.02) 0px,
      rgba(255, 255, 255, 0.02) 1px,
      transparent 1px,
      transparent 2px
    );
    pointer-events: none;
    z-index: 1;
  }

  .terminal-content {
    max-height: 320px;
    min-height: 48px;
    overflow-y: auto;
    padding: 6px 8px;
    position: relative;
    z-index: 0;
  }

  .terminal-content::-webkit-scrollbar {
    width: 4px;
  }
  .terminal-content::-webkit-scrollbar-track {
    background: transparent;
  }
  .terminal-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
  }

  .event-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 2px 0;
    line-height: 1.4;
    background: none;
    border: none;
    cursor: default;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .event-row[onclick] {
    cursor: pointer;
  }
  .event-row[onclick]:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .event-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    margin-top: 4px;
    flex-shrink: 0;
  }

  .thinking-dot {
    background: #06b6d4;
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  .tool-dot {
    background: #a78bfa;
  }

  .result-dot {
    background: rgba(255, 255, 255, 0.3);
  }

  .result-ok {
    background: #22c55e;
  }

  .result-err {
    background: #ef4444;
  }

  .event-icon {
    flex-shrink: 0;
    width: 14px;
    text-align: center;
  }

  .event-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .thinking-text {
    color: #06b6d4;
    opacity: 0.7;
    font-style: italic;
  }

  .tool-name {
    color: #a78bfa;
    font-weight: 600;
  }

  .thinking-row {
    padding: 2px 4px;
    border-radius: 3px;
  }

  .thinking-detail {
    padding: 0 4px 4px 26px;
  }

  .thinking-detail pre {
    color: #06b6d4;
    opacity: 0.5;
    font-size: 11px;
  }

  .tool-call-row {
    padding: 2px 4px;
  }

  .tool-result-row {
    padding: 1px 4px 1px 26px;
    font-size: 11px;
    border-radius: 3px;
  }

  .result-row {
    padding: 2px 4px;
  }

  .spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid rgba(167, 139, 250, 0.3);
    border-top-color: #a78bfa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .spinner.invisible {
    visibility: hidden;
  }

  :global(.text-muted) {
    color: rgba(255, 255, 255, 0.4);
  }
  :global(.text-green) {
    color: #22c55e;
  }
  :global(.text-red) {
    color: #ef4444;
  }
  :global(.ml-1) {
    margin-left: 4px;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
