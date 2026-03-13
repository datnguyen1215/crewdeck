import { getEnv } from "../env.js";
import { post } from "../http.js";

const VALID_STATES = ["active", "done", "error"] as const;
type StatusState = (typeof VALID_STATES)[number];

const USAGE = `Usage: crewdeck status --state <state>

States: ${VALID_STATES.join(", ")}

Examples:
  crewdeck status --state active
  crewdeck status --state done
  crewdeck status --state error`;

export async function statusCommand(argv: string[]): Promise<void> {
  const stateIdx = argv.indexOf("--state");

  if (stateIdx === -1 || !argv[stateIdx + 1]) {
    console.error("Error: --state is required\n");
    console.error(USAGE);
    process.exit(1);
  }

  const state = argv[stateIdx + 1] as StatusState;
  if (!VALID_STATES.includes(state)) {
    console.error(`Error: unknown state "${state}". Must be one of: ${VALID_STATES.join(", ")}\n`);
    console.error(USAGE);
    process.exit(1);
  }

  const { api_url, agent_id, issue_id, project_id } = getEnv();
  await post("/internal/status", { agent_id, issue_id, project_id, state }, api_url);
  console.log(`Status set to "${state}".`);
}
