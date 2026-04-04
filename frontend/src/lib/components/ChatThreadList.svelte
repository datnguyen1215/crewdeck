<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useWsSubscriptions } from '$lib/utils/ws-subscriptions.js';
  import {
    listChatThreads,
    createChatThread,
    type ChatThreadListItem,
  } from '$lib/api/http.js';
  import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';

  let {
    projectId,
    selectedThreadId = $bindable(''),
  }: {
    projectId: string;
    selectedThreadId?: string;
  } = $props();

  const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

  let threads = $state<ChatThreadListItem[]>([]);
  let loading = $state(true);
  let creating = $state(false);
  let activeThreadIds = $state(new Set<string>());

  async function handleNewThread() {
    if (creating) return;
    creating = true;
    try {
      const thread = await createChatThread(projectId);
      threads = [{ ...thread, last_message: null, message_count: 0 } as ChatThreadListItem, ...threads];
      selectThread(thread.id);
    } catch {
      // silent
    } finally {
      creating = false;
    }
  }

  function selectThread(id: string) {
    selectedThreadId = id;
    // On mobile, navigate to the thread detail route
    if (window.innerWidth < 768) {
      goto(`/projects/${projectId}/chat/${id}`);
    }
  }

  function formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d`;
  }

  function truncate(str: string | null, max: number): string {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  $effect(() => {
    const pid = projectId;
    let cancelled = false;
    loading = true;
    listChatThreads(pid)
      .then((t) => { if (!cancelled) threads = t; })
      .catch(() => {})
      .finally(() => { if (!cancelled) loading = false; });
    return () => { cancelled = true; };
  });

  // Reload thread list when a chat exchange completes
  $effect(() => {
    const ws = getWs();
    if (!ws) return;
    return useWsSubscriptions(ws, {
      'chat.message': (data) => {
        activeThreadIds = new Set([...activeThreadIds, data.thread_id]);
      },
      'chat.thinking': (data) => {
        activeThreadIds = new Set([...activeThreadIds, data.thread_id]);
      },
      'chat.complete': (data) => {
        activeThreadIds = new Set([...activeThreadIds].filter(id => id !== data.thread_id));
        listChatThreads(projectId)
          .then((t) => { threads = t; })
          .catch(() => {});
      },
      'chat.error': (data) => {
        activeThreadIds = new Set([...activeThreadIds].filter(id => id !== data.thread_id));
      },
      'chat.session_expired': (data) => {
        activeThreadIds = new Set([...activeThreadIds].filter(id => id !== data.thread_id));
      },
      'chat.thread_updated': (data) => {
        threads = threads.map(t =>
          t.id === data.thread_id ? { ...t, title: data.title } : t
        );
      },
    });
  });
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="p-3 border-b border-edge flex-shrink-0">
    <button
      onclick={handleNewThread}
      disabled={creating}
      class="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-cyan border border-cyan/30 rounded hover:bg-cyan/10 transition-colors disabled:opacity-50"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14"/>
        <path d="M5 12h14"/>
      </svg>
      {creating ? 'Creating...' : 'New Thread'}
    </button>
  </div>

  <!-- Thread list -->
  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <div class="p-4 text-xs text-muted text-center">Loading threads...</div>
    {:else if threads.length === 0}
      <div class="p-4 text-xs text-muted text-center">No threads yet</div>
    {:else}
      {#each threads as thread (thread.id)}
        {@render threadItem(thread)}
      {/each}
    {/if}
  </div>
</div>

{#snippet threadItem(thread: ChatThreadListItem)}
  <button
    onclick={() => selectThread(thread.id)}
    class="w-full text-left px-3 py-2.5 border-l-[3px] border-l-edge transition-colors hover:bg-surface-hi
      {selectedThreadId === thread.id ? 'bg-surface-hi' : ''}"
  >
    <div class="flex items-center gap-2 min-w-0">
      {#if activeThreadIds.has(thread.id)}
        <span class="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse flex-shrink-0"></span>
      {/if}
      <span class="text-xs truncate flex-1 text-primary">
        {thread.title || 'Untitled'}
      </span>
      <span class="text-[10px] text-muted flex-shrink-0">{formatTime(thread.updated_at)}</span>
    </div>
    {#if thread.last_message}
      <p class="text-[11px] text-muted truncate mt-0.5">{truncate(thread.last_message, 60)}</p>
    {/if}
    <p class="text-[10px] text-muted mt-0.5">{thread.message_count} {thread.message_count === 1 ? 'message' : 'messages'}</p>
  </button>
{/snippet}
