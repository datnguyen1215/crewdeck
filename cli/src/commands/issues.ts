/** CLI command for listing and fetching issues. */

import { getCaptainEnv } from "../env-captain.js";
import { get, post } from "../http.js";

const USAGE = `Usage: crewdeck issues <subcommand>

Subcommands:
  list                              List all issues for the project
  get <issue_id>                    Get details for a specific issue
  update <issue_id> --priority <n>  Update issue priority
  close <issue_id>                  Close/cancel an issue

Examples:
  crewdeck issues list
  crewdeck issues get abc123
  crewdeck issues update abc123 --priority 2
  crewdeck issues close abc123`;

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
    case "update": {
      const issueId = rest[0];
      if (!issueId) {
        console.error("Error: <issue_id> is required\n");
        console.error(USAGE);
        process.exit(1);
      }
      const priorityIdx = rest.indexOf("--priority");
      if (priorityIdx === -1 || !rest[priorityIdx + 1]) {
        console.error("Error: --priority <n> is required\n");
        console.error(USAGE);
        process.exit(1);
      }
      const priority = Number(rest[priorityIdx + 1]);
      if (!Number.isInteger(priority)) {
        console.error("Error: priority must be an integer\n");
        process.exit(1);
      }
      await post("/internal/issues/update", { project_id, issue_id: issueId, priority }, api_url);
      console.log(`Updated issue ${issueId} priority to ${priority}`);
      break;
    }
    case "close": {
      const issueId = rest[0];
      if (!issueId) {
        console.error("Error: <issue_id> is required\n");
        console.error(USAGE);
        process.exit(1);
      }
      await post("/internal/issues/close", { project_id, issue_id: issueId }, api_url);
      console.log(`Issue ${issueId} closed.`);
      break;
    }
    default:
      console.error(`Error: unknown subcommand "${subcommand}"\n`);
      console.error(USAGE);
      process.exit(1);
  }
}
