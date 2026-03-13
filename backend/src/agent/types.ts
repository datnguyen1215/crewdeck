export type Unsubscribe = () => void;

export interface SpawnOptions {
  sessionName: string;
  workdir: string;
  prompt: string;
  systemPrompt?: string;
  env?: Record<string, string>;
}

export interface SessionHandle {
  sessionName: string;
  paneId: string;
  pid: number;
}

export interface AgentAdapter {
  spawn(options: SpawnOptions): Promise<SessionHandle>;
  send(sessionName: string, message: string): Promise<void>;
  getOutput(sessionName: string): Promise<string>;
  streamOutput(sessionName: string, callback: (chunk: string) => void): Unsubscribe;
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
