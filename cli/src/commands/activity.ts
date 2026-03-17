/** CLI command for fetching issue activity (comments and activity log). */

import { getCaptainEnv } from "../env-captain.js";
import { get } from "../http.js";

const USAGE = `Usage: crewdeck activity <issue_id>

Examples:
  crewdeck activity issue-abc`;

export async function activityCommand(argv: string[]): Promise<void> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return;
  }

  const issueId = argv[0];

  if (!issueId) {
    console.error("Error: <issue_id> is required\n");
    console.error(USAGE);
    process.exit(1);
  }

  const { api_url, project_id } = getCaptainEnv();

  const [comments, activity] = await Promise.all([
    get(`/projects/${project_id}/issues/${issueId}/comments`, {}, api_url),
    get(`/projects/${project_id}/activity`, { issue_id: issueId }, api_url),
  ]);

  console.log(JSON.stringify({ comments, activity }, null, 2));
}
