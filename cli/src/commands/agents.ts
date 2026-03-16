/** CLI command for listing agents. */

import { getCaptainEnv } from "../env-captain.js";
import { get } from "../http.js";

const USAGE = `Usage: crewdeck agents <subcommand>

Subcommands:
  list    List all agents for the project crew

Examples:
  crewdeck agents list`;

export async function agentsCommand(argv: string[]): Promise<void> {
  const [subcommand] = argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(USAGE);
    return;
  }

  if (subcommand !== "list") {
    console.error(`Error: unknown subcommand "${subcommand}"\n`);
    console.error(USAGE);
    process.exit(1);
  }

  const { api_url, project_id } = getCaptainEnv();
  const data = await get(`/projects/${project_id}/crew`, {}, api_url);
  console.log(JSON.stringify(data, null, 2));
}
