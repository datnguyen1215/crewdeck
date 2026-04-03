<script lang="ts">
  import { page } from '$app/stores';
  import { getProject, type Project } from '$lib/api/http.js';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ChatThreadList from '$lib/components/ChatThreadList.svelte';

  let projectId = $derived($page.params.projectId!);
  let project = $state<Project | null>(null);
  let pageTitle = $derived(project?.name ? `Chat - ${project.name} - CrewDeck` : 'Chat - CrewDeck');
  let selectedThreadId = $state('');

  $effect(() => {
    let cancelled = false;
    getProject(projectId).then((p) => { if (!cancelled) project = p; }).catch(() => {});
    return () => { cancelled = true; };
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="h-full flex pt-12 md:pt-0">
  <!-- Thread list: visible on desktop (md+), hidden on mobile -->
  <div class="w-[280px] max-md:w-full flex-shrink-0 border-r border-edge flex flex-col md:border-r-edge">
    <ChatThreadList {projectId} bind:selectedThreadId />
  </div>

  <!-- Chat view area -->
  <div class="hidden md:flex flex-1 min-w-0 flex-col">
    <!-- Header (visible on desktop) -->
    <div class="p-3 md:p-4 border-b border-edge flex-shrink-0 hidden md:block">
      <Breadcrumb segments={[
        { label: 'Projects', href: '/' },
        { label: project?.name ?? 'Project', href: `/projects/${projectId}` },
        { label: 'Chat' }
      ]} />
      <div class="mt-3 flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-cyan/20 flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="min-w-0">
          <h1 class="text-base md:text-lg font-bold text-primary truncate">Chat</h1>
          <p class="text-xs text-muted">Thread-based conversations</p>
        </div>
      </div>
    </div>

    <!-- Content area -->
    <div class="flex-1 flex items-center justify-center">
      {#if selectedThreadId}
        <p class="text-muted text-sm">Thread view will be implemented separately</p>
      {:else}
        <div class="text-center">
          <div class="w-12 h-12 rounded-full bg-surface-hi flex items-center justify-center mx-auto mb-3">
            <svg class="w-6 h-6 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <p class="text-sm text-muted">Select or create a thread</p>
        </div>
      {/if}
    </div>
  </div>
</div>
