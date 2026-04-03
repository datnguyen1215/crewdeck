<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getProject, getChatThread, type Project, type ChatThreadDetail } from '$lib/api/http.js';

  let projectId = $derived($page.params.projectId!);
  let threadId = $derived($page.params.threadId!);
  let project = $state<Project | null>(null);
  let thread = $state<ChatThreadDetail | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let pageTitle = $derived(project?.name ? `Chat - ${project.name} - CrewDeck` : 'Chat - CrewDeck');

  $effect(() => {
    let cancelled = false;
    getProject(projectId).then((p) => { if (!cancelled) project = p; }).catch(() => {});
    return () => { cancelled = true; };
  });

  onMount(async () => {
    try {
      thread = await getChatThread(threadId, projectId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load thread';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="h-full flex flex-col pt-12 md:pt-0">
  <!-- Header with back button -->
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
      <h1 class="text-sm font-bold text-primary truncate">
        {thread?.title || (loading ? 'Loading...' : 'Untitled')}
      </h1>
    </div>
  </div>

  <!-- Thread content -->
  <div class="flex-1 min-h-0 overflow-y-auto">
    {#if loading}
      <div class="flex items-center justify-center h-full">
        <div class="text-muted text-sm">Loading thread...</div>
      </div>
    {:else if error}
      <div class="flex items-center justify-center h-full">
        <div class="text-red text-sm">{error}</div>
      </div>
    {:else if thread}
      <div class="p-4">
        {#if thread.messages.length === 0}
          <div class="text-muted text-sm text-center mt-8">No messages yet</div>
        {:else}
          {#each thread.messages as message (message.id)}
            <div class="mb-3 text-sm">
              <span class="text-xs text-muted">{message.role}</span>
              <p class="text-primary mt-0.5 whitespace-pre-wrap break-words">{message.content}</p>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>
