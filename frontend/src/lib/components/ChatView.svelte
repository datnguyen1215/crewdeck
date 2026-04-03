<script lang="ts">
  import { getContext } from 'svelte';
  import { useWsSubscriptions } from '$lib/utils/ws-subscriptions.js';
  import { autoscroll } from '$lib/utils/autoscroll.js';
  import { md, esc } from '$lib/utils/markdown.js';
  import { formatTimestamp } from '$lib/utils/time.js';
  import { sendChatMessage, getChatThread, getChatThreadStatus, getChatMessageEvents } from '$lib/api/http.js';
  import ChatInput from './ChatInput.svelte';
  import ChatTerminalBox from './ChatTerminalBox.svelte';
  import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';
  import type { ChatThreadDetail, ChatMessage, ChatMessageEvent } from '$lib/api/types.js';

  let {
    thread,
    projectId,
  }: {
    thread: ChatThreadDetail;
    projectId: string;
  } = $props();

  const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

  let messages = $state<ChatMessage[]>([]);
  let streamingText = $state('');
  let streamingEvents = $state<ChatMessageEvent[]>([]);
  let streamingMessageId = $state<string | null>(null);
  let isStreaming = $state(false);
  let isProcessing = $state(false);
  let chatError = $state<string | null>(null);
  let lastUserText = $state('');

  // Events loaded from API for past assistant messages (history replay)
  let historyEvents = $state<Record<string, ChatMessageEvent[]>>({});
  let loadedEventIds = new Set<string>();

  async function loadEventsForMessage(messageId: string, threadId: string) {
    if (loadedEventIds.has(messageId)) return;
    loadedEventIds.add(messageId);
    try {
      const { events } = await getChatMessageEvents(threadId, messageId, projectId);
      if (events.length > 0 && thread.id === threadId) {
        historyEvents[messageId] = events;
      }
    } catch {
      // ignore — events are optional
    }
  }

  function getEventsForMessage(messageId: string): ChatMessageEvent[] {
    if (messageId === streamingMessageId) return streamingEvents;
    return historyEvents[messageId] ?? [];
  }

  // Sync messages and reset streaming state when thread prop changes
  $effect(() => {
    const id = thread.id;
    const pid = projectId;
    messages = thread.messages;
    streamingText = '';
    streamingEvents = [];
    streamingMessageId = null;
    isStreaming = false;
    isProcessing = false;
    chatError = null;
    historyEvents = {};
    loadedEventIds = new Set();
    // Determine last user message for retry
    const lastUser = [...thread.messages].reverse().find(m => m.role === 'user');
    lastUserText = lastUser?.content ?? '';
    // Check if captain is still processing this thread
    getChatThreadStatus(id, pid).then(({ active }) => {
      if (active && thread.id === id) isProcessing = true;
    }).catch(() => {});
    // Lazy-load events for past assistant messages
    for (const msg of thread.messages) {
      if (msg.role === 'assistant') {
        loadEventsForMessage(msg.id, id);
      }
    }
  });

  // WebSocket subscriptions for streaming
  $effect(() => {
    const ws = getWs();
    if (!ws) return;

    return useWsSubscriptions(ws, {
      'chat.message': (data) => {
        if (data.thread_id !== thread.id) return;
        isProcessing = false;
        isStreaming = true;
        streamingMessageId = data.message_id;
        streamingText += data.content;
        streamingEvents = [...streamingEvents, {
          id: crypto.randomUUID(),
          message_id: data.message_id,
          type: 'text',
          data: { content: data.content },
          created_at: new Date().toISOString(),
        }];
      },
      'chat.tool_call': (data) => {
        if (data.thread_id !== thread.id) return;
        isProcessing = false;
        isStreaming = true;
        streamingMessageId = data.message_id;
        streamingEvents = [...streamingEvents, {
          id: crypto.randomUUID(),
          message_id: data.message_id,
          type: 'tool_call',
          data: { tool_call_id: data.tool_call_id, tool_name: data.tool_name, tool_input: data.tool_input },
          created_at: new Date().toISOString(),
        }];
      },
      'chat.tool_result': (data) => {
        if (data.thread_id !== thread.id) return;
        streamingEvents = [...streamingEvents, {
          id: crypto.randomUUID(),
          message_id: data.message_id,
          type: 'tool_result',
          data: { tool_call_id: data.tool_call_id, tool_name: data.tool_name, result: data.result },
          created_at: new Date().toISOString(),
        }];
      },
      'chat.thinking': (data) => {
        if (data.thread_id !== thread.id) return;
        isProcessing = false;
        isStreaming = true;
        streamingMessageId = data.message_id;
        streamingEvents = [...streamingEvents, {
          id: crypto.randomUUID(),
          message_id: data.message_id,
          type: 'thinking',
          data: { content: data.content },
          created_at: new Date().toISOString(),
        }];
      },
      'chat.complete': (data) => {
        if (data.thread_id !== thread.id) return;
        isProcessing = false;
        isStreaming = false;
        const completedMsgId = data.message_id;
        streamingText = '';
        const completedEvents = [...streamingEvents];
        streamingEvents = [];
        streamingMessageId = null;
        getChatThread(thread.id, projectId).then((t) => {
          messages = t.messages;
          // Move streaming events into history
          if (completedMsgId && completedEvents.length > 0) {
            historyEvents[completedMsgId] = completedEvents;
            loadedEventIds.add(completedMsgId);
          }
        }).catch(() => {});
      },
      'chat.session_expired': (data) => {
        if (data.thread_id !== thread.id) return;
        isProcessing = false;
        isStreaming = false;
        streamingText = '';
        streamingEvents = [];
        streamingMessageId = null;
      },
      'chat.error': (data) => {
        if (data.thread_id !== thread.id) return;
        isProcessing = false;
        isStreaming = false;
        streamingText = '';
        streamingEvents = [];
        streamingMessageId = null;
        chatError = data.error;
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
      isProcessing = true;
      chatError = null;
      lastUserText = text;
    } catch {
      isProcessing = false;
    }
  }

  async function handleRetry() {
    if (!lastUserText) return;
    chatError = null;
    const lastIdx = [...messages].reverse().findIndex(m => m.role === 'user');
    if (lastIdx >= 0) {
      messages = [...messages.slice(0, messages.length - 1 - lastIdx), ...messages.slice(messages.length - lastIdx)];
    }
    await handleSend(lastUserText);
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

        <!-- Streaming terminal box -->
        {#if streamingMessageId && streamingEvents.length > 0}
          <div class="mb-3">
            <ChatTerminalBox events={streamingEvents} streaming={true} />
            {#if streamingText}
              <div class="border-l-[3px] border-l-cyan pl-3 py-0.5 mt-1">
                <div class="text-primary prose prose-sm prose-invert max-w-none text-sm break-words min-w-0">
                  {@html md(streamingText)}<span class="animate-pulse">_</span>
                </div>
              </div>
            {/if}
          </div>
        {:else if isProcessing}
          <div class="mb-3">
            <div class="border border-dashed border-cyan/40 rounded px-3 py-2 text-sm">
              <span class="text-cyan/70 animate-pulse">Analyzing_</span>
            </div>
          </div>
        {/if}
      {/if}

      <!-- Error message -->
      {#if chatError}
        <div class="mb-3 border-l-[3px] border-l-red pl-3 py-0.5">
          <div class="text-[10px] text-red">error</div>
          <p class="text-xs text-red/80 mt-0.5">{chatError}</p>
          {#if lastUserText}
            <button
              onclick={handleRetry}
              class="mt-1.5 px-2 py-0.5 text-[10px] text-red border border-red/30 rounded hover:bg-red/10 transition-colors"
            >
              Retry
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Input bar -->
  <ChatInput disabled={isStreaming || isProcessing} onSend={handleSend} />
</div>

{#snippet messageBubble(message: ChatMessage)}
  {@const ts = formatTimestamp(message.created_at)}

  {#if message.role === 'system'}
    <div class="mb-2">
      <div class="bg-surface border border-edge rounded px-3 py-1.5 text-xs text-muted inline-block">
        {message.content}
      </div>
    </div>

  {:else if message.role === 'event'}
    <div class="mb-2 border-l-[3px] border-l-amber pl-3 py-0.5">
      <span class="text-[10px] text-muted">{ts}</span>
      <span class="text-[10px] text-amber ml-1">event</span>
      <p class="text-xs text-secondary mt-0.5">{message.content}</p>
    </div>

  {:else if message.role === 'assistant'}
    {@const events = getEventsForMessage(message.id)}
    <div class="mb-3">
      <!-- Terminal box with events for this message -->
      {#if events.length > 0}
        <ChatTerminalBox events={events} streaming={false} />
      {/if}
      <!-- Final response bubble -->
      {#if message.content}
        <div class="border-l-[3px] border-l-cyan pl-3 py-0.5">
          <div class="flex items-baseline gap-2">
            <span class="text-[10px] text-muted">{ts}</span>
            <span class="text-[10px] text-cyan">captain</span>
          </div>
          <div class="text-primary prose prose-sm prose-invert max-w-none mt-1 text-sm break-words min-w-0">
            {@html md(message.content)}
          </div>
        </div>
      {/if}
    </div>

  {:else if message.role === 'tool'}
    <div class="mb-2 border-l-[3px] border-l-purple pl-3 py-0.5">
      <div class="flex items-baseline gap-2">
        <span class="text-[10px] text-muted">{ts}</span>
        <span class="text-[10px] text-purple">tool</span>
      </div>
      <p class="text-xs text-secondary mt-0.5 font-mono">{message.content}</p>
    </div>

  {:else if message.role === 'user'}
    <div class="mb-3 flex justify-end">
      <div class="max-w-[80%] md:max-w-[60%] bg-surface-hi border-r-[3px] border-r-green rounded-l px-3 py-2">
        <div class="text-xs text-primary whitespace-pre-wrap break-words">{message.content}</div>
        <div class="text-[10px] text-muted text-right mt-1">{ts}</div>
      </div>
    </div>

  {/if}
{/snippet}
