/** CLI command for listing and creating agents. */

import { getCaptainEnv } from "../env-captain.js";
import { get, post } from "../http.js";

const USAGE = `Usage: crewdeck agents <subcommand>

Subcommands:
  list    List all agents for the project crew
  create  Create a new worker agent

Options for create:
  --name <name>                 Agent name (required)
  --title <title>               Agent title (required)
  --system-prompt <prompt>      System prompt (required)
  --description <description>   Agent description (optional)

Examples:
  crewdeck agents list
  crewdeck agents create --name "Alice" --title "Frontend Engineer" --system-prompt "You are a frontend specialist..."`;

const parseFlag = (args: string[], flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
};

export async function agentsCommand(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(USAGE);
    return;
  }

  const { api_url, project_id } = getCaptainEnv();

  switch (subcommand) {
    case "list": {
      const data = await get(`/projects/${project_id}/crew`, {}, api_url);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "create": {
      const name = parseFlag(rest, "--name");
      const title = parseFlag(rest, "--title");
      const system_prompt = parseFlag(rest, "--system-prompt");
      const description = parseFlag(rest, "--description");

      if (!name || !title || !system_prompt) {
        console.error("Error: --name, --title, and --system-prompt are required\n");
        console.error(USAGE);
        process.exit(1);
      }

      const body: Record<string, unknown> = { name, title, system_prompt };
      if (description) body.description = description;

      const data = await post(`/projects/${project_id}/crew/agents`, body, api_url);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    default:
      console.error(`Error: unknown subcommand "${subcommand}"\n`);
      console.error(USAGE);
      process.exit(1);
  }
}
