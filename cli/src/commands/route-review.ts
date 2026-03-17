/** CLI command for routing a review to an agent. */

import { getCaptainEnv } from "../env-captain.js";
import { post } from "../http.js";

const USAGE = `Usage: crewdeck route-review <issue_id> <agent_id>

Examples:
  crewdeck route-review issue-abc agent-reviewer`;

export async function routeReviewCommand(argv: string[]): Promise<void> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return;
  }

  const [issueId, agentId] = argv;

  if (!issueId || !agentId) {
    console.error("Error: <issue_id> and <agent_id> are required\n");
    console.error(USAGE);
    process.exit(1);
  }

  const { api_url, project_id } = getCaptainEnv();
  await post("/internal/route-review", { project_id, issue_id: issueId, reviewer_agent_id: agentId }, api_url);
  console.log(`Routed review for issue ${issueId} to agent ${agentId}.`);
}
