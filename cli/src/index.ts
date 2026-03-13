#!/usr/bin/env node
import { signalCommand } from "./commands/signal.js";
import { commentCommand } from "./commands/comment.js";
import { statusCommand } from "./commands/status.js";
import { filesCommand } from "./commands/files.js";

const USAGE = `Usage: crewdeck <command> [options]

Commands:
  signal    Emit a signal event to the backend
  comment   Post a comment on the current issue
  status    Update the agent's status
  files     Report modified files

Run "crewdeck <command> --help" for command-specific usage.`;

async function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "signal":
      await signalCommand(args);
      break;
    case "comment":
      await commentCommand(args);
      break;
    case "status":
      await statusCommand(args);
      break;
    case "files":
      await filesCommand(args);
      break;
    default:
      if (!command || command === "--help" || command === "-h") {
        console.log(USAGE);
      } else {
        console.error(`Error: unknown command "${command}"\n`);
        console.error(USAGE);
        process.exit(1);
      }
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
