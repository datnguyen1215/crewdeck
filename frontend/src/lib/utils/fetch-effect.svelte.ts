import { toastStore } from "$lib/stores/toasts.svelte.js";

/**
 * Wraps $effect with cancellation, loading state, and error handling for data fetching.
 * Re-runs automatically when reactive dependencies inside `fn` change.
 *
 * Must be called during component initialization (uses $effect internally).
 */
export function fetchEffect<T>(
  fn: () => Promise<T>,
  opts: {
    onData: (result: T) => void;
    onError?: string | (() => void);
    onLoading?: (loading: boolean) => void;
  },
) {
  $effect(() => {
    let cancelled = false;
    opts.onLoading?.(true);

    let promise: Promise<T>;
    try {
      promise = fn();
    } catch {
      opts.onLoading?.(false);
      return () => {
        cancelled = true;
      };
    }

    promise
      .then((result) => {
        if (cancelled) return;
        opts.onData(result);
      })
      .catch(() => {
        if (cancelled) return;
        if (typeof opts.onError === "string") {
          toastStore.add(opts.onError, "error");
        } else if (opts.onError) {
          opts.onError();
        }
      })
      .finally(() => {
        if (!cancelled) opts.onLoading?.(false);
      });

    return () => {
      cancelled = true;
    };
  });
}
