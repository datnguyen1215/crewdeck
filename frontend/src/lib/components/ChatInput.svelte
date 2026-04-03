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
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 4 * 24) + 'px';
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
  <div class="flex items-end gap-2">
    <textarea
      bind:this={textareaEl}
      bind:value={text}
      onkeydown={handleKeydown}
      oninput={autoResize}
      rows="1"
      placeholder="Type a message..."
      disabled={disabled}
      class="flex-1 resize-none bg-surface border border-edge rounded px-3 py-2 text-sm text-primary
        placeholder:text-muted font-mono focus:outline-none focus:border-edge-hi disabled:opacity-50
        disabled:cursor-not-allowed max-h-24 overflow-y-auto"
    ></textarea>
    <button
      onclick={submit}
      disabled={disabled || !text.trim()}
      class="flex-shrink-0 rounded px-3 py-2 text-sm font-medium transition-colors
        {disabled || !text.trim() ? 'bg-surface text-muted cursor-not-allowed' : 'bg-cyan text-base hover:bg-cyan/80'}"
    >
      Send
    </button>
  </div>
</div>
