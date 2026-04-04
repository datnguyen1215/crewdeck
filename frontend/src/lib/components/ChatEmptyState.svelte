<script lang="ts">
  let {
    onSend,
  }: {
    onSend: (text: string) => void;
  } = $props();

  const suggestions = [
    'What issues need attention?',
    'Summarize recent activity',
    'Review open pull requests',
    "What's the project status?",
  ];

  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }
</script>

<div class="flex flex-col items-center justify-center py-16 md:py-24 px-4">
  <h2 class="text-lg md:text-xl text-primary font-semibold mb-6">{getGreeting()}</h2>

  <div class="flex flex-wrap justify-center gap-2 max-w-lg">
    {#each suggestions as suggestion}
      <button
        onclick={() => onSend(suggestion)}
        class="text-xs text-secondary border border-edge rounded-lg px-3 py-1.5
          hover:border-cyan/50 hover:text-cyan hover:bg-cyan/5 transition-colors cursor-pointer"
      >
        {suggestion}
      </button>
    {/each}
  </div>
</div>
