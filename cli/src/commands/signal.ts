import { getEnv } from "../env.js";
import { post } from "../http.js";

const VALID_EVENTS = ["work-complete", "review-complete", "error", "needs-help"] as const;
type SignalEvent = (typeof VALID_EVENTS)[number];

const USAGE = `Usage: crewdeck signal --event <event-name> [--data <json>]

Events: ${VALID_EVENTS.join(", ")}

Examples:
  crewdeck signal --event work-complete
  crewdeck signal --event review-complete --data '{"verdict":"approved"}'
  crewdeck signal --event error --data '{"message":"Something went wrong"}'
  crewdeck signal --event needs-help --data '{"message":"Need clarification"}'`;

export async function signalCommand(argv: string[]): Promise<void> {
  const eventIdx = argv.indexOf("--event");
  const dataIdx = argv.indexOf("--data");

  if (eventIdx === -1 || !argv[eventIdx + 1]) {
    console.error("Error: --event is required\n");
    console.error(USAGE);
    process.exit(1);
  }

  const event = argv[eventIdx + 1] as SignalEvent;
  if (!VALID_EVENTS.includes(event)) {
    console.error(`Error: unknown event "${event}". Must be one of: ${VALID_EVENTS.join(", ")}\n`);
    console.error(USAGE);
    process.exit(1);
  }

  let data: Record<string, unknown> | undefined;
  if (dataIdx !== -1 && argv[dataIdx + 1] && !argv[dataIdx + 1].startsWith("--")) {
    try {
      data = JSON.parse(argv[dataIdx + 1]) as Record<string, unknown>;
    } catch {
      console.error(`Error: --data must be valid JSON`);
      process.exit(1);
    }
  }

  const { api_url, ...ctx } = getEnv();
  await post("/internal/signal", { ...ctx, event, data }, api_url);
  console.log(`Signal "${event}" sent.`);
}
