/** CLI command for managing agent sessions. */

import { getCaptainEnv } from "../env-captain.js";
import { get, post } from "../http.js";

const USAGE = `Usage: crewdeck sessions <subcommand>

Subcommands:
  list                  List project sessions
  stop <session_id>     Stop a running session

Examples:
  crewdeck sessions list
  crewdeck sessions stop session-abc`;

export async function sessionsCommand(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(USAGE);
    return;
  }

  const { api_url, project_id } = getCaptainEnv();

  switch (subcommand) {
    case "list": {
      const data = await get(`/projects/${project_id}/sessions`, {}, api_url);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "stop": {
      const sessionId = rest[0];
      if (!sessionId) {
        console.error("Error: <session_id> is required\n");
        console.error(USAGE);
        process.exit(1);
      }
      const data = await post("/internal/sessions/stop", { project_id, session_id: sessionId }, api_url);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    default:
      console.error(`Error: unknown subcommand "${subcommand}"\n`);
      console.error(USAGE);
      process.exit(1);
  }
}
