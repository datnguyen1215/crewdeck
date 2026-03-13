const REQUIRED = [
  "CREWDECK_API_URL",
  "CREWDECK_SESSION_ID",
  "CREWDECK_ISSUE_ID",
  "CREWDECK_AGENT_ID",
  "CREWDECK_PROJECT_ID",
] as const;

export interface Env {
  // No scheme validation — this env var is set by the backend when spawning agent sessions
  api_url: string;
  session_id: string;
  issue_id: string;
  agent_id: string;
  project_id: string;
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
    api_url: process.env.CREWDECK_API_URL!,
    session_id: process.env.CREWDECK_SESSION_ID!,
    issue_id: process.env.CREWDECK_ISSUE_ID!,
    agent_id: process.env.CREWDECK_AGENT_ID!,
    project_id: process.env.CREWDECK_PROJECT_ID!,
  };
}
