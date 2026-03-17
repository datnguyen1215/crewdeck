#!/usr/bin/env node
import { signalCommand } from "./commands/signal.js";
import { commentCommand } from "./commands/comment.js";
import { statusCommand } from "./commands/status.js";
import { filesCommand } from "./commands/files.js";
import { issuesCommand } from "./commands/issues.js";
import { agentsCommand } from "./commands/agents.js";
import { assignCommand } from "./commands/assign.js";
import { routeReviewCommand } from "./commands/route-review.js";
import { activityCommand } from "./commands/activity.js";
import { historyCommand } from "./commands/history.js";

const USAGE = `Usage: crewdeck <command> [options]

Commands:
  signal          Emit a signal event to the backend
  comment         Post a comment on the current issue
  status          Update the agent's status
  files           Report modified files
  issues          List or get project issues
  agents          List project agents
  assign          Assign an issue to an agent
  route-review    Route a review to an agent
  activity        Get activity for an issue
  history         Save or list agent history

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
    case "issues":
      await issuesCommand(args);
      break;
    case "agents":
      await agentsCommand(args);
      break;
    case "assign":
      await assignCommand(args);
      break;
    case "route-review":
      await routeReviewCommand(args);
      break;
    case "activity":
      await activityCommand(args);
      break;
    case "history":
      await historyCommand(args);
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
