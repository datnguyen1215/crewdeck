import { getEnv } from "../env.js";
import { post } from "../http.js";

const USAGE = `Usage: crewdeck files --modified <file1> [<file2> ...]

Example:
  crewdeck files --modified src/auth/middleware.ts src/auth/session.ts tests/auth.test.ts`;

export async function filesCommand(argv: string[]): Promise<void> {
  const modifiedIdx = argv.indexOf("--modified");

  if (modifiedIdx === -1) {
    console.error("Error: --modified is required\n");
    console.error(USAGE);
    process.exit(1);
  }

  // Collect all args after --modified that don't start with --
  const modified: string[] = [];
  for (let i = modifiedIdx + 1; i < argv.length; i++) {
    if (argv[i].startsWith("--")) break;
    modified.push(argv[i]);
  }

  if (modified.length === 0) {
    console.error("Error: --modified requires at least one file\n");
    console.error(USAGE);
    process.exit(1);
  }

  const { api_url, session_id } = getEnv();
  await post("/internal/files", { session_id, modified }, api_url);
  console.log(`Reported ${modified.length} modified file(s).`);
}
