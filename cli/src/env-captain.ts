/**
 * Environment loader for captain commands that don't run inside an agent session.
 * Only requires CREWDECK_API_URL and CREWDECK_PROJECT_ID.
 */

const REQUIRED = ["CREWDECK_API_URL", "CREWDECK_PROJECT_ID"] as const;

export interface CaptainEnv {
  api_url: string;
  project_id: string;
  agent_id?: string;
}

export function getCaptainEnv(): CaptainEnv {
  const missing = REQUIRED.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(
      `Error: missing required environment variables:\n${missing.map((v) => `  ${v}`).join("\n")}`
    );
    process.exit(1);
  }

  return {
    api_url: process.env.CREWDECK_API_URL!,
    project_id: process.env.CREWDECK_PROJECT_ID!,
    agent_id: process.env.CREWDECK_AGENT_ID || undefined,
  };
}
