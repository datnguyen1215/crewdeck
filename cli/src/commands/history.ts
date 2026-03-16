/** CLI command for saving and listing agent history. */

import { getCaptainEnv } from "../env-captain.js";
import { get, post } from "../http.js";

const USAGE = `Usage: crewdeck history <subcommand>

Subcommands:
  save --summary <text>    Save a history entry
  list                     List history entries

Examples:
  crewdeck history save --summary "Implemented auth module"
  crewdeck history list`;

export async function historyCommand(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(USAGE);
    return;
  }

  const { api_url, project_id, agent_id } = getCaptainEnv();

  switch (subcommand) {
    case "list": {
      const data = await get("/internal/history", { project_id }, api_url);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "save": {
      const summaryIdx = rest.indexOf("--summary");
      if (summaryIdx === -1 || !rest[summaryIdx + 1] || rest[summaryIdx + 1].startsWith("--")) {
        console.error("Error: --summary is required\n");
        console.error(USAGE);
        process.exit(1);
      }

      if (!agent_id) {
        console.error("Error: CREWDECK_AGENT_ID is required for history save");
        process.exit(1);
      }

      const summary = rest[summaryIdx + 1];
      await post("/internal/history", { project_id, agent_id, summary }, api_url);
      console.log("History entry saved.");
      break;
    }
    default:
      console.error(`Error: unknown subcommand "${subcommand}"\n`);
      console.error(USAGE);
      process.exit(1);
  }
}
