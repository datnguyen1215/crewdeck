import { post, sessionContext } from "../http.js";

const USAGE = `Usage: crewdeck comment --message <text>

Example:
  crewdeck comment --message "Fixed the bug and added test coverage."`;

export async function commentCommand(argv: string[]): Promise<void> {
  const msgIdx = argv.indexOf("--message");

  if (msgIdx === -1 || !argv[msgIdx + 1]) {
    console.error("Error: --message is required\n");
    console.error(USAGE);
    process.exit(1);
  }

  const message = argv[msgIdx + 1];

  const { apiUrl, ...ctx } = sessionContext();
  await post("/internal/comment", { ...ctx, content: message }, apiUrl);

  console.log("Comment posted.");
}
