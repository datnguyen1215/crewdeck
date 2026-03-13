const TIMEOUT_MS = 10_000;

export async function post(path: string, body: Record<string, unknown>, apiUrl: string): Promise<void> {
  const url = `${apiUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await res.json().catch((err: unknown) => {
      // Re-throw AbortError so the outer catch handles timeouts during body read
      if (err instanceof Error && err.name === "AbortError") throw err;
      return null;
    });

    if (!res.ok) {
      const message = (data != null && typeof data === "object" && "message" in data && typeof data.message === "string")
        ? data.message
        : `HTTP ${res.status}`;
      throw new Error(message);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Cannot connect to CrewDeck backend at ${url}: request timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
