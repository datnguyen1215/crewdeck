<script lang="ts">
  import { getContext } from 'svelte';
  import { useWsSubscriptions } from '$lib/utils/ws-subscriptions.js';
  import { autoscroll } from '$lib/utils/autoscroll.js';
  import { md } from '$lib/utils/markdown.js';
  import { formatTimestamp } from '$lib/utils/time.js';
  import { sendChatMessage, getChatThread } from '$lib/api/http.js';
  import ChatInput from './ChatInput.svelte';
  import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
  import type { ChatThreadDetail, ChatMessage } from '$lib/api/types.js';

  let {
    thread,
    projectId,
  }: {
    thread: ChatThreadDetail;
    projectId: string;
  } = $props();

  const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

  let messages = $state<ChatMessage[]>(thread.messages);
  let streamingText = $state('');
  let streamingToolCalls = $state<Array<{ tool_name: string; tool_input: unknown; result?: unknown; success?: boolean }>>([]);
  let isStreaming = $state(false);

  // Keep messages in sync when thread prop changes (e.g. reload after complete)
  $effect(() => {
    messages = thread.messages;
  });

  // WebSocket subscriptions for streaming
  $effect(() => {
    const ws = getWs();
    if (!ws) return;

    return useWsSubscriptions(ws, {
      'chat.message': (data) => {
        if (data.thread_id !== thread.id) return;
        isStreaming = true;
        streamingText += data.content;
      },
      'chat.tool_call': (data) => {
        if (data.thread_id !== thread.id) return;
        isStreaming = true;
        streamingToolCalls = [...streamingToolCalls, {
          tool_name: data.tool_name,
          tool_input: data.tool_input,
        }];
      },
      'chat.tool_result': (data) => {
        if (data.thread_id !== thread.id) return;
        streamingToolCalls = streamingToolCalls.map(tc =>
          tc.tool_name === data.tool_name
            ? { ...tc, result: data.result, success: true }
            : tc
        );
      },
      'chat.complete': (data) => {
        if (data.thread_id !== thread.id) return;
        isStreaming = false;
        streamingText = '';
        streamingToolCalls = [];
        // Reload thread to get canonical stored messages
        getChatThread(thread.id, projectId).then((t) => {
          messages = t.messages;
        }).catch(() => {});
      },
      'chat.session_expired': (data) => {
        if (data.thread_id !== thread.id) return;
        isStreaming = false;
        streamingText = '';
        streamingToolCalls = [];
      },
    });
  });

  async function handleSend(text: string) {
    try {
      const res = await sendChatMessage(thread.id, projectId, text);
      // Add optimistic user message
      const userMsg: ChatMessage = {
        id: res.message_id,
        thread_id: thread.id,
        role: 'user',
        content: text,
        metadata: null,
        created_at: new Date().toISOString(),
      };
      messages = [...messages, userMsg];
    } catch {
      // silent — error will surface through the next thread reload
    }
  }

  function parseToolMeta(metadata: string | null): { tool_name?: string; tool_input?: unknown; success?: boolean; result?: string } | null {
    if (!metadata) return null;
    try {
      return JSON.parse(metadata);
    } catch {
      return null;
    }
  }

  function formatToolInput(input: unknown): string {
    if (input === undefined || input === null) return '';
    if (typeof input === 'string') return input.length > 80 ? input.slice(0, 80) + '...' : input;
    return JSON.stringify(input).length > 80 ? JSON.stringify(input).slice(0, 80) + '...' : JSON.stringify(input);
  }
</script>

<div class="flex flex-col h-full">
  <!-- Messages area -->
  <div class="flex-1 min-h-0 overflow-y-auto" use:autoscroll>
    <div class="p-3 md:p-4">
      {#if messages.length === 0 && !isStreaming}
        <div class="text-muted text-sm text-center mt-8">No messages yet</div>
      {:else}
        {#each messages as message (message.id)}
          {@render messageBubble(message)}
        {/each}

        <!-- Streaming tool calls -->
        {#each streamingToolCalls as tc, i (i)}
          {@render streamingToolBubble(tc, i)}
        {/each}

        <!-- Streaming assistant message -->
        {#if streamingText}
          {@render streamingBubble()}
        {/if}

        <!-- Analyzing indicator (no text yet but streaming started) -->
        {#if isStreaming && !streamingText && streamingToolCalls.length === 0}
          <div class="mb-3">
            <div class="text-xs text-muted mb-1">captain</div>
            <div class="border border-dashed border-cyan/40 rounded px-3 py-2 text-sm">
              <span class="text-cyan/70 animate-pulse">Analyzing_</span>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>

  <!-- Input bar -->
  <ChatInput disabled={isStreaming || thread.type === 'monitor'} onSend={handleSend} />
</div>

{#snippet messageBubble(message: ChatMessage)}
  {@const ts = formatTimestamp(message.created_at)}

  {#if message.role === 'system'}
    <!-- System message -->
    <div class="mb-2">
      <div class="bg-surface border border-edge rounded px-3 py-1.5 text-xs text-muted inline-block">
        {message.content}
      </div>
    </div>

  {:else if message.role === 'event'}
    <!-- Event message -->
    <div class="mb-2 border-l-[3px] border-l-amber pl-3 py-0.5">
      <span class="text-[10px] text-muted">{ts}</span>
      <span class="text-[10px] text-amber ml-1">event</span>
      <p class="text-xs text-secondary mt-0.5">{message.content}</p>
    </div>

  {:else if message.role === 'assistant'}
    <!-- Assistant message -->
    <div class="mb-3 border-l-[3px] border-l-cyan pl-3 py-0.5">
      <div class="flex items-baseline gap-2">
        <span class="text-[10px] text-muted">{ts}</span>
        <span class="text-[10px] text-cyan">captain</span>
      </div>
      <div class="text-primary prose prose-sm prose-invert max-w-none mt-1 text-sm break-words min-w-0">
        {@html md(message.content)}
      </div>
    </div>

  {:else if message.role === 'tool'}
    {@const meta = parseToolMeta(message.metadata)}
    <div class="mb-2 border-l-[3px] border-l-purple pl-3 py-0.5">
      <div class="flex items-baseline gap-2">
        <span class="text-[10px] text-muted">{ts}</span>
        <span class="text-[10px] text-purple">tool</span>
      </div>
      {#if meta?.tool_name}
        <p class="text-xs font-mono text-secondary mt-0.5">
          {@html `&rarr; ${meta.tool_name}(${formatToolInput(meta.tool_input)})`}
        </p>
        {#if meta.success === true}
          <p class="text-xs font-mono text-green mt-0.5">
            {@html `&rarr; ok: ${meta.result ?? ''}`}
          </p>
        {:else if meta.success === false}
          <p class="text-xs font-mono text-red mt-0.5">
            {@html `&rarr; err: ${meta.result ?? 'unknown error'}`}
          </p>
        {/if}
      {:else}
        <p class="text-xs text-secondary mt-0.5 font-mono">{message.content}</p>
      {/if}
    </div>

  {:else if message.role === 'user'}
    <!-- User message — right aligned -->
    <div class="mb-3 flex justify-end">
      <div class="max-w-[80%] md:max-w-[60%] bg-surface-hi border-r-[3px] border-r-green rounded-l px-3 py-2">
        <div class="text-xs text-primary whitespace-pre-wrap break-words">{message.content}</div>
        <div class="text-[10px] text-muted text-right mt-1">{ts}</div>
      </div>
    </div>

  {/if}
{/snippet}

{#snippet streamingToolBubble(tc: typeof streamingToolCalls[number], index: number)}
  <div class="mb-2 border-l-[3px] border-l-purple pl-3 py-0.5">
    <div class="flex items-baseline gap-2">
      <span class="text-[10px] text-muted">--:--:--</span>
      <span class="text-[10px] text-purple">tool</span>
    </div>
    <p class="text-xs font-mono text-secondary mt-0.5">
      {@html `&rarr; ${tc.tool_name}(${formatToolInput(tc.tool_input)})`}
    </p>
    {#if tc.result !== undefined}
      {#if tc.success}
        <p class="text-xs font-mono text-green mt-0.5">
          {@html `&rarr; ok: ${tc.result}`}
        </p>
      {:else}
        <p class="text-xs font-mono text-red mt-0.5">
          {@html `&rarr; err: ${tc.result}`}
        </p>
      {/if}
    {/if}
  </div>
{/snippet}

{#snippet streamingBubble()}
  <div class="mb-3 border-l-[3px] border-l-cyan pl-3 py-0.5">
    <div class="flex items-baseline gap-2">
      <span class="text-[10px] text-muted">--:--:--</span>
      <span class="text-[10px] text-cyan">captain</span>
    </div>
    <div class="text-primary prose prose-sm prose-invert max-w-none mt-1 text-sm break-words min-w-0">
      {@html md(streamingText)}<span class="animate-pulse">_</span>
    </div>
  </div>
{/snippet}
