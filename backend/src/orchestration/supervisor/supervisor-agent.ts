/**
 * Supervisor LLM Agent
 *
 * Handles the `claude -p` invocation for Supervisor.
 * Processes per-issue events: run.completed, pr.status_changed, comment.added, etc.
 * Extracts action plans and executes them via the existing plan executor.
 */
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import { getProject } from "../../db/repositories/projects.js";
import { spawnClaudeStream } from "../process.js";
import { resolveModel } from "../../db/repositories/agent-config.js";
import { executePlan, formatResults } from "../captain/plan-executor.js";
import type { ActionPlan } from "../captain/action-schema.js";
import {
  extractActionPlanFromText,
  extractActionPlanFromEvents,
} from "../captain/action-plan-extractor.js";
import { formatEvents } from "../captain/event-formatter.js";
import * as monitorRepo from "../../db/repositories/monitor-messages.js";
import { getVCSAccount } from "../../db/repositories/vcs-accounts.js";
import { createGitSshEnv, cleanupSshKey } from "../../utils/git-auth.js";
import * as globalEnvVarRepo from "../../db/repositories/global-environment-variables.js";
import { getSystemApiKey } from "../../app.js";
import { buildSupervisorSystemPrompt } from "./supervisor-prompt.js";
import type { CaptainEvent } from "../captain/queue.js";
import { PROCESS_GRACE_PERIOD_MS } from "../../config/orchestration.js";

const MAX_CONTEXT_MESSAGES = 10;

/** Get Supervisor conversation history for an issue from DB. */
function getSupervisorHistory(issueId: string): string {
  // Re-use monitor_messages table scoped by issue_id stored in project_id field
  // We use a composite key convention: "supervisor:<issueId>" as the pseudo project_id
  const pseudoProjectId = `supervisor:${issueId}`;
  const messages = monitorRepo
    .getByProject(pseudoProjectId, MAX_CONTEXT_MESSAGES)
    .reverse();
  if (messages.length === 0) return "";

  return messages
    .map((m: { role: string; content: string }) => {
      if (m.role === "user") return `Event batch:\n${m.content}`;
      return `Supervisor response: ${m.content}`;
    })
    .join("\n\n");
}

/** Build environment variables for Supervisor's claude -p invocation. */
async function buildSupervisorEnv(
  projectId: string,
  issueId: string,
): Promise<{ env: Record<string, string>; sshKeyPath: string | undefined }> {
  const apiKey = getSystemApiKey();
  const env: Record<string, string> = {
    ...globalEnvVarRepo.getMap(),
    CREWDECK_API_URL: `http://localhost:${process.env.PORT ?? "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_ISSUE_ID: issueId,
    CREWDECK_AGENT_ID: "supervisor",
    ...(apiKey ? { CREWDECK_API_KEY: apiKey } : {}),
  };

  const project = getProject(projectId);
  let sshKeyPath: string | undefined;
  if (project?.vcs_account_id) {
    const account = getVCSAccount(project.vcs_account_id);
    if (account) {
      env.GH_TOKEN = account.token;
      const ssh = createGitSshEnv(account.ssh_private_key);
      Object.assign(env, ssh.env);
      sshKeyPath = ssh.keyPath;
    }
  }

  return { env, sshKeyPath };
}

/** Build the user prompt from events and Supervisor history. */
function buildUserPrompt(
  events: CaptainEvent[],
  issueId: string,
): { userPrompt: string; eventSection: string } {
  const eventText = formatEvents(events);
  const eventSection = eventText
    ? `## Events\n${eventText}\n\nProcess these events and output a JSON action plan.`
    : "Check the current issue state and output a JSON action plan with any needed actions.";

  const history = getSupervisorHistory(issueId);
  const sections: string[] = [];
  if (history) sections.push(`## Recent Supervisor History\n${history}`);
  sections.push(eventSection);
  return { userPrompt: sections.join("\n\n"), eventSection };
}

/** Spawn claude -p with a timeout. Returns collected events and result text. */
async function runClaudeWithTimeout(opts: {
  prompt: string;
  systemPrompt: string;
  env: Record<string, string>;
  model: string;
  timeoutMs: number;
  issueId: string;
  onEvent?: (event: { type: string; [key: string]: unknown }) => void;
}): Promise<{
  events: Array<{ type: string; [key: string]: unknown }>;
  resultText: string;
  exitCode: number | null;
}> {
  const result = await spawnClaudeStream({
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    workdir: ".",
    env: opts.env,
    model: opts.model,
  });

  const timer = setTimeout(() => {
    logger.warn(
      { issueId: opts.issueId, pid: result.pid },
      `Supervisor: claude -p timed out after ${opts.timeoutMs / 1000}s, sending SIGTERM`,
    );
    result.process.kill("SIGTERM");
    setTimeout(() => {
      if (!result.process.killed) result.process.kill("SIGKILL");
    }, PROCESS_GRACE_PERIOD_MS);
  }, opts.timeoutMs);

  const collectedEvents: Array<{ type: string; [key: string]: unknown }> = [];
  let resultText = "";

  for await (const event of result.events) {
    collectedEvents.push(event);
    if (event.type === "result") {
      resultText = typeof event.result === "string" ? event.result : "";
    }
    opts.onEvent?.(event);
  }

  const exitResult = await result.exitPromise;
  clearTimeout(timer);

  return { events: collectedEvents, resultText, exitCode: exitResult.code };
}

/** Execute an action plan and format the response. */
async function executeAndFormat(
  projectId: string,
  actionPlan: ActionPlan,
): Promise<string> {
  const results = await executePlan(projectId, actionPlan);
  let response = formatResults(results);
  if (actionPlan.reasoning) {
    response = `${actionPlan.reasoning}\n\n${response}`;
  }
  return response;
}

/** Persist event batch and response to DB (using monitor_messages scoped to issue). */
function persistMessages(
  issueId: string,
  eventSection: string,
  response: string,
): void {
  const pseudoProjectId = `supervisor:${issueId}`;
  monitorRepo.create(pseudoProjectId, "user", eventSection);
  if (response) {
    monitorRepo.create(pseudoProjectId, "assistant", response);
  }
}

/**
 * Process Supervisor events for an issue with the LLM.
 * Returns the action plan execution results.
 */
export async function processSupervisorWithLLM(
  issueId: string,
  projectId: string,
  events: CaptainEvent[],
): Promise<string> {
  const systemPrompt = buildSupervisorSystemPrompt(issueId, projectId);
  if (!systemPrompt) return "Error: Project not found";

  const { userPrompt, eventSection } = buildUserPrompt(events, issueId);
  const { env, sshKeyPath } = await buildSupervisorEnv(projectId, issueId);

  // Emit event_received for each event
  for (const event of events) {
    const description = formatEvents([event]).replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
    eventBus.emit("monitor.event_received", {
      project_id: projectId,
      event_type: event.type,
      description,
    });
  }

  let finalResponse = "";

  try {
    const model = resolveModel("supervisor");

    const onEvent = (event: { type: string; [key: string]: unknown }) => {
      try {
        if (event.type === "assistant") {
          const content = event.message as
            | { content?: Array<{ type?: string; text?: string; thinking?: string }> }
            | undefined;
          for (const block of content?.content ?? []) {
            if (block.type === "text" && block.text) {
              eventBus.emit("monitor.message", {
                project_id: projectId,
                content: block.text,
              });
            }
          }
        } else if (event.type === "result") {
          eventBus.emit("monitor.result", {
            project_id: projectId,
            cost_usd: (event.cost_usd ?? event.total_cost_usd) as number | undefined,
            duration_ms: event.duration_ms as number | undefined,
            stop_reason: event.stop_reason as string | undefined,
          });
        }
      } catch (eventErr) {
        logger.warn(
          { eventErr, eventType: event.type },
          "Supervisor: Failed to process stream event",
        );
      }
    };

    const { events: collectedEvents, resultText, exitCode } =
      await runClaudeWithTimeout({
        prompt: userPrompt,
        systemPrompt,
        env,
        model,
        timeoutMs: 2 * 60 * 1000,
        issueId,
        onEvent,
      });

    if (exitCode !== 0) {
      logger.warn({ issueId, code: exitCode }, "Supervisor claude -p exited non-zero");
    }

    const actionPlan =
      extractActionPlanFromText(resultText) ??
      extractActionPlanFromEvents(collectedEvents);

    if (actionPlan) {
      logger.info(
        { issueId, reasoning: actionPlan.reasoning, actionCount: actionPlan.actions.length },
        "Supervisor: Executing action plan",
      );
      finalResponse = await executeAndFormat(projectId, actionPlan);
    } else {
      logger.warn(
        { issueId, responsePreview: (resultText || "").slice(0, 200) },
        "Supervisor: Could not parse action plan",
      );
      finalResponse = resultText || "No action plan generated";
    }
  } catch (err) {
    logger.error({ err, issueId }, "Supervisor claude -p call failed");
    finalResponse = "Error: Failed to process events";
  } finally {
    if (sshKeyPath) cleanupSshKey(sshKeyPath);
  }

  persistMessages(issueId, eventSection, finalResponse);

  if (finalResponse) {
    eventBus.emit("monitor.message", { project_id: projectId, content: finalResponse });
    eventBus.emit("monitor.complete", { project_id: projectId, response: finalResponse });
  }

  return finalResponse;
};
