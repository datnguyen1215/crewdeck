/** CLI command for listing and fetching issues. */

import { getCaptainEnv } from "../env-captain.js";
import { get } from "../http.js";

const USAGE = `Usage: crewdeck issues <subcommand>

Subcommands:
  list              List all issues for the project
  get <issue_id>    Get details for a specific issue

Examples:
  crewdeck issues list
  crewdeck issues get abc123`;

export async function issuesCommand(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(USAGE);
    return;
  }

  const { api_url, project_id } = getCaptainEnv();

  switch (subcommand) {
    case "list": {
      const data = await get(`/projects/${project_id}/issues`, {}, api_url);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "get": {
      const issueId = rest[0];
      if (!issueId) {
        console.error("Error: <issue_id> is required\n");
        console.error(USAGE);
        process.exit(1);
      }
      const data = await get(`/projects/${project_id}/issues/${issueId}`, {}, api_url);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    default:
      console.error(`Error: unknown subcommand "${subcommand}"\n`);
      console.error(USAGE);
      process.exit(1);
  }
}
