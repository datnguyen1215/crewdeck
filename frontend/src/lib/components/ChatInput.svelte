<script lang="ts">
  let {
    disabled = false,
    onSend,
  }: {
    disabled?: boolean;
    onSend: (text: string) => void;
  } = $props();

  let text = $state('');
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    text = '';
    resetHeight();
  }

  function resetHeight() {
    if (textareaEl) {
      textareaEl.style.height = 'auto';
    }
  }

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 8 * 24) + 'px';
  }

  function handleKeydown(e: KeyboardEvent) {
    const isMobile = window.innerWidth < 768;
    if (e.key === 'Enter') {
      if (isMobile) {
        // Mobile: Enter = newline, use button to send
        return;
      }
      if (!e.shiftKey) {
        e.preventDefault();
        submit();
      }
    }
  }

  $effect(() => {
    if (textareaEl) autoResize();
  });
</script>

<div class="flex-shrink-0 border-t border-edge bg-base p-3">
  <div class="relative">
    <textarea
      bind:this={textareaEl}
      bind:value={text}
      onkeydown={handleKeydown}
      oninput={autoResize}
      rows="2"
      placeholder="Ask anything about this project..."
      disabled={disabled}
      class="w-full resize-none bg-surface border border-edge rounded-lg px-3 py-2 pr-10 text-sm text-primary
        placeholder:text-muted font-mono focus:outline-none focus:border-cyan/50 focus:ring-1 focus:ring-cyan/20
        disabled:opacity-50 disabled:cursor-not-allowed max-h-48 overflow-y-auto"
    ></textarea>
    <button
      onclick={submit}
      disabled={disabled || !text.trim()}
      aria-label="Send message"
      class="absolute bottom-2 right-2 w-7 h-7 flex items-center justify-center rounded-full transition-colors
        {disabled || !text.trim() ? 'bg-surface text-muted cursor-not-allowed' : 'bg-cyan text-base hover:bg-cyan/80'}"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  </div>
  <p class="text-[10px] text-muted mt-1 hidden md:block">Enter to send · Shift+Enter for newline</p>
</div>
