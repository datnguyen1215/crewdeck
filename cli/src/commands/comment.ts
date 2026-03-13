import { getEnv } from "../env.js";
import { post } from "../http.js";

const USAGE = `Usage: crewdeck comment --message <text>

Example:
  crewdeck comment --message "Fixed the bug and added test coverage."`;

export async function commentCommand(argv: string[]): Promise<void> {
  const msgIdx = argv.indexOf("--message");

  if (msgIdx === -1 || !argv[msgIdx + 1] || argv[msgIdx + 1].startsWith("--")) {
    console.error("Error: --message is required\n");
    console.error(USAGE);
    process.exit(1);
  }

  const message = argv[msgIdx + 1];

  const { api_url, agent_id, issue_id, project_id } = getEnv();
  await post("/internal/comment", { agent_id, issue_id, project_id, content: message }, api_url);

  console.log("Comment posted.");
}
