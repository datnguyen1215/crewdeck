/** CLI command for assigning an issue to an agent. */

import { getCaptainEnv } from "../env-captain.js";
import { post } from "../http.js";

const USAGE = `Usage: crewdeck assign <issue_id> <agent_id>

Examples:
  crewdeck assign issue-abc agent-xyz`;

export async function assignCommand(argv: string[]): Promise<void> {
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
  await post("/internal/assign", { project_id, issue_id: issueId, agent_id: agentId }, api_url);
  console.log(`Assigned issue ${issueId} to agent ${agentId}.`);
}
