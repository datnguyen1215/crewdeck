<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getContext } from 'svelte';
  import { getProject, getChatThread, updateChatThread, deleteChatThread, type Project, type ChatThreadDetail } from '$lib/api/http.js';
  import { useWsSubscriptions } from '$lib/utils/ws-subscriptions.js';
  import { toastStore } from '$lib/stores/toasts.svelte.js';
  import ChatView from '$lib/components/ChatView.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import type { ProjectWebSocket } from '$lib/api/ws.svelte.js';

  const getWs = getContext<() => ProjectWebSocket | null>('projectWs');

  let projectId = $derived($page.params.projectId!);
  let threadId = $derived($page.params.threadId!);
  let project = $state<Project | null>(null);
  let thread = $state<ChatThreadDetail | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let pageTitle = $derived(project?.name ? `Chat - ${project.name} - CrewDeck` : 'Chat - CrewDeck');

  // Overflow menu
  let menuOpen = $state(false);

  // Rename
  let renaming = $state(false);
  let renameTitle = $state('');

  // Delete
  let deleting = $state(false);

  // New session
  let newSessionConfirm = $state(false);

  $effect(() => {
    let cancelled = false;
    getProject(projectId).then((p) => { if (!cancelled) project = p; }).catch(() => {});
    return () => { cancelled = true; };
  });

  $effect(() => {
    const id = threadId;
    const pid = projectId;
    let cancelled = false;
    loading = true;
    error = null;
    getChatThread(id, pid)
      .then((t) => { if (!cancelled) thread = t; })
      .catch((err) => { if (!cancelled) error = err instanceof Error ? err.message : 'Failed to load thread'; })
      .finally(() => { if (!cancelled) loading = false; });
    return () => { cancelled = true; };
  });

  // Listen for session_expired to reload thread
  $effect(() => {
    const ws = getWs();
    if (!ws) return;
    return useWsSubscriptions(ws, {
      'chat.session_expired': (data) => {
        if (data.thread_id !== threadId) return;
        getChatThread(threadId, projectId).then((t) => { thread = t; }).catch(() => {});
      },
    });
  });

  // Close menu on outside click
  function closeMenu() { menuOpen = false; }

  function startRename() {
    renaming = true;
    renameTitle = thread?.title ?? '';
    menuOpen = false;
  }

  function confirmRename() {
    if (!thread) return;
    const title = renameTitle.trim() || undefined;
    updateChatThread(thread.id, projectId, { title }).then((t) => {
      if (thread) thread = { ...thread, title: t.title };
    }).catch(() => {});
    renaming = false;
  }

  function cancelRename() { renaming = false; }

  function startDelete() {
    deleting = true;
    menuOpen = false;
  }

  function confirmDelete() {
    if (!thread) return;
    deleteChatThread(thread.id, projectId).then(() => {
      goto(`/projects/${projectId}/chat`);
    }).catch(() => {});
    deleting = false;
  }

  function startNewSession() {
    newSessionConfirm = true;
    menuOpen = false;
  }

  function confirmNewSession() {
    if (!thread) return;
    updateChatThread(thread.id, projectId, { session_id: null }).then(() => {
      getChatThread(threadId, projectId).then((t) => { thread = t; }).catch(() => {});
    }).catch(() => {});
    newSessionConfirm = false;
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="h-full flex flex-col pt-12 md:pt-0">
  <!-- Header -->
  <div class="p-3 border-b border-edge flex-shrink-0 flex items-center gap-3">
    <button
      onclick={() => goto(`/projects/${projectId}/chat`)}
      class="p-1.5 rounded hover:bg-surface-hi transition-colors text-secondary hover:text-primary"
      aria-label="Back to threads"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>

    <div class="min-w-0 flex-1">
      {#if renaming}
        <input
          type="text"
          bind:value={renameTitle}
          onkeydown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') cancelRename(); }}
          onblur={confirmRename}
          class="w-full bg-surface border border-edge rounded px-2 py-1 text-sm text-primary focus:outline-none focus:border-edge-hi"
        >
      {:else}
        <h1 class="text-sm font-bold text-primary truncate">
          {thread?.title || (loading ? 'Loading...' : 'Untitled')}
        </h1>
      {/if}
    </div>

    <!-- Overflow menu -->
    <div class="relative">
      <button
        onclick={() => menuOpen = !menuOpen}
        class="p-1.5 rounded hover:bg-surface-hi transition-colors text-secondary hover:text-primary"
        aria-label="Thread options"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5"/>
          <circle cx="12" cy="12" r="1.5"/>
          <circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>

      {#if menuOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <div class="fixed inset-0 z-10" role="presentation" onclick={closeMenu}></div>
        <div class="absolute right-0 top-full mt-1 z-20 bg-surface border border-edge rounded shadow-xl py-1 min-w-[160px]">
          <button
            onclick={startRename}
            class="w-full text-left px-3 py-1.5 text-xs text-secondary hover:text-primary hover:bg-surface-hi transition-colors"
          >
            Rename
          </button>
          {#if thread?.type !== 'monitor'}
            <button
              onclick={startDelete}
              class="w-full text-left px-3 py-1.5 text-xs text-red hover:bg-surface-hi transition-colors"
            >
              Delete
            </button>
          {/if}
          <button
            onclick={startNewSession}
            class="w-full text-left px-3 py-1.5 text-xs text-secondary hover:text-primary hover:bg-surface-hi transition-colors"
          >
            New Session
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Content -->
  {#if loading}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-muted text-sm">Loading thread...</div>
    </div>
  {:else if error}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-red text-sm">{error}</div>
    </div>
  {:else if thread}
    <ChatView {thread} {projectId} />
  {/if}
</div>

<!-- Delete confirmation modal -->
<Modal open={deleting} onClose={() => deleting = false} label="Delete thread">
  <h2 class="text-base font-bold text-primary mb-2">Delete thread?</h2>
  <p class="text-sm text-secondary mb-4">This action cannot be undone. All messages will be permanently deleted.</p>
  <div class="flex gap-3 justify-end">
    <button onclick={() => deleting = false} class="px-3 py-1.5 text-xs border border-edge text-secondary hover:text-primary rounded transition-colors">Cancel</button>
    <button onclick={confirmDelete} class="px-3 py-1.5 text-xs bg-red text-white hover:bg-red/80 rounded transition-colors">Delete</button>
  </div>
</Modal>

<!-- New session confirmation modal -->
<Modal open={newSessionConfirm} onClose={() => newSessionConfirm = false} label="New session">
  <h2 class="text-base font-bold text-primary mb-2">Start new session?</h2>
  <p class="text-sm text-secondary mb-4">This will start a fresh Claude session. Chat history is preserved.</p>
  <div class="flex gap-3 justify-end">
    <button onclick={() => newSessionConfirm = false} class="px-3 py-1.5 text-xs border border-edge text-secondary hover:text-primary rounded transition-colors">Cancel</button>
    <button onclick={confirmNewSession} class="px-3 py-1.5 text-xs bg-cyan text-base hover:bg-cyan/80 rounded transition-colors">New Session</button>
  </div>
</Modal>
