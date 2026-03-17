export interface SpawnOptions {
  sessionName: string;
  workdir: string;
  prompt: string;
  systemPrompt?: string;
  env?: Record<string, string>;
  /** Run claude with --print flag (non-interactive, stdout-only). Session exits when done. */
  print?: boolean;
  /** Fixed session ID for Claude Code — controls the JSONL file path. */
  claudeSessionId?: string;
}

export interface SessionHandle {
  sessionName: string;
}

export interface AgentAdapter {
  spawn(options: SpawnOptions): Promise<SessionHandle>;
  send(sessionName: string, message: string): Promise<void>;
  getOutput(sessionName: string): Promise<string>;
  isAlive(sessionName: string): Promise<boolean>;
  kill(sessionName: string): Promise<void>;
}

export function mergeContext(existing: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof existing === "object" && existing !== null ? (existing as Record<string, unknown>) : {}),
    ...extra,
  };
}

export const CREWDECK_SESSION_PREFIX = "crewdeck-";

export function agentSessionName(issueId: string, agentId: string, role: string): string {
  return `${CREWDECK_SESSION_PREFIX}${issueId.slice(0, 8)}-${agentId.slice(0, 8)}-${role}`;
}

export function orchestratorSessionName(projectId: string): string {
  return `${CREWDECK_SESSION_PREFIX}orchestrator-${projectId.slice(0, 8)}`;
}

export function captainSessionName(projectId: string): string {
  return `${CREWDECK_SESSION_PREFIX}captain-${projectId.slice(0, 8)}`;
}
