import { getEnv } from "./env.js";

const TIMEOUT_MS = 10_000;

export async function post(path: string, body: Record<string, unknown>, apiUrl: string): Promise<unknown> {
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

    const data = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (!res.ok) {
      const message = (data.message as string) ?? `HTTP ${res.status}`;
      throw new Error(message);
    }

    return data;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Cannot connect to CrewDeck backend at ${url}: request timed out`);
    }
    if (err instanceof TypeError && (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED"))) {
      throw new Error(`Cannot connect to CrewDeck backend at ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function sessionContext(): { apiUrl: string; session_id: string; agent_id: string; issue_id: string; project_id: string } {
  const env = getEnv();
  return {
    apiUrl: env.apiUrl,
    session_id: env.sessionId,
    agent_id: env.agentId,
    issue_id: env.issueId,
    project_id: env.projectId,
  };
}
