/**
 * Svelte action that auto-scrolls a container when new content is added,
 * but only if the user is already at the bottom. Preserves scroll position
 * when the user has scrolled up. Also scrolls to bottom on initial attach.
 */
export function autoscroll(node: HTMLElement) {
  let isAtBottom = true;
  const threshold = 30;

  function scrollToBottom() {
    node.scrollTop = node.scrollHeight;
    isAtBottom = true;
  }

  function onScroll() {
    isAtBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight < threshold;
  }

  function onMutation() {
    if (isAtBottom) {
      scrollToBottom();
    }
  }

  node.addEventListener("scroll", onScroll);

  const observer = new MutationObserver(onMutation);
  observer.observe(node, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Scroll to bottom on initial attachment
  requestAnimationFrame(scrollToBottom);

  return {
    destroy() {
      node.removeEventListener("scroll", onScroll);
      observer.disconnect();
    },
  };
}
