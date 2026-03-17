/** CLI command for creating a PR for an approved issue. */

import { getCaptainEnv } from "../env-captain.js";
import { post } from "../http.js";

const USAGE = `Usage: crewdeck create-pr <issue_id>

Push the issue branch and create a GitHub pull request.

Examples:
  crewdeck create-pr issue-abc`;

export async function createPRCommand(argv: string[]): Promise<void> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return;
  }

  const [issueId] = argv;

  if (!issueId) {
    console.error("Error: <issue_id> is required\n");
    console.error(USAGE);
    process.exit(1);
  }

  const { api_url, project_id } = getCaptainEnv();
  await post("/internal/create-pr", { project_id, issue_id: issueId }, api_url);
  console.log(`PR creation requested for issue ${issueId}.`);
}
