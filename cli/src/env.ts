const REQUIRED = [
  "CREWDECK_API_URL",
  "CREWDECK_SESSION_ID",
  "CREWDECK_ISSUE_ID",
  "CREWDECK_AGENT_ID",
  "CREWDECK_PROJECT_ID",
] as const;

export interface Env {
  apiUrl: string;
  sessionId: string;
  issueId: string;
  agentId: string;
  projectId: string;
}

export function getEnv(): Env {
  const missing = REQUIRED.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(
      `Error: missing required environment variables:\n${missing.map((v) => `  ${v}`).join("\n")}`
    );
    process.exit(1);
  }

  return {
    // No scheme validation — this env var is set by the backend when spawning agent sessions
    apiUrl: process.env.CREWDECK_API_URL!,
    sessionId: process.env.CREWDECK_SESSION_ID!,
    issueId: process.env.CREWDECK_ISSUE_ID!,
    agentId: process.env.CREWDECK_AGENT_ID!,
    projectId: process.env.CREWDECK_PROJECT_ID!,
  };
}
