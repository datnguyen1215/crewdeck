/**
 * Creates reactive modal/form state with open/close, submit loading, and error handling.
 * Eliminates duplicated boilerplate across pages that use modal forms.
 */
export function createFormState<T extends Record<string, unknown>>(
  defaults: T,
) {
  let open = $state(false);
  let submitting = $state(false);
  let error = $state("");
  let fields = $state({ ...defaults });

  function show(initial?: Partial<T>) {
    fields = { ...defaults, ...initial };
    error = "";
    open = true;
  }

  function close() {
    if (!submitting) {
      open = false;
      fields = { ...defaults };
      error = "";
    }
  }

  async function submit(fn: (fields: T) => Promise<void>) {
    submitting = true;
    error = "";
    try {
      await fn(fields as T);
      open = false;
      fields = { ...defaults };
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong";
    } finally {
      submitting = false;
    }
  }

  return {
    get open() {
      return open;
    },
    set open(v: boolean) {
      open = v;
    },
    get submitting() {
      return submitting;
    },
    get error() {
      return error;
    },
    set error(v: string) {
      error = v;
    },
    get fields() {
      return fields;
    },
    set fields(v: T) {
      fields = v;
    },
    show,
    close,
    submit,
  };
}
