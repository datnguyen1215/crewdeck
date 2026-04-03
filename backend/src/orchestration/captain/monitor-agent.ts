/**
 * Monitor LLM Agent
 *
 * Uses `claude -p` CLI to make automated orchestration decisions.
 * Handles events like issue creation, run completion, PR status changes.
 * User chat goes through the PTY terminal.
 *
 * Outputs structured action plans that the backend executes deterministically.
 */
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import {
  getProject,
  updateCaptainStatus,
} from "../../db/repositories/projects.js";
import { spawnClaudeStream } from "../process.js";
import { resolveModel } from "../../db/repositories/agent-config.js";
import { executePlan, formatResults } from "./plan-executor.js";
import type { ActionPlan } from "./action-schema.js";
import type { EventMap } from "../../events/types.js";

import * as monitorRepo from "../../db/repositories/monitor-messages.js";
import * as chatThreadRepo from "../../db/repositories/chat-threads.js";
import * as chatMessageRepo from "../../db/repositories/chat-messages.js";
import { getVCSAccount } from "../../db/repositories/vcs-accounts.js";
import { createGitSshEnv, cleanupSshKey } from "../../utils/git-auth.js";
import type { CaptainEvent } from "./queue.js";

import { buildSystemPrompt } from "./prompt-builder.js";
import { formatEvents } from "./event-formatter.js";
import { getMonitorHistory } from "./monitor-history.js";
import {
  extractActionPlanFromEvents,
  extractActionPlanFromText,
} from "./action-plan-extractor.js";
import { PROCESS_GRACE_PERIOD_MS } from "../../config/orchestration.js";
import * as globalEnvVarRepo from "../../db/repositories/global-environment-variables.js";
import { getSystemApiKey } from "../../app.js";

// --- Helpers ---

type DualEventSuffix =
  | "event_received"
  | "thinking"
  | "message"
  | "tool_call"
  | "tool_result"
  | "complete";

type MonitorKey<K extends DualEventSuffix> = `monitor.${K}`;
type ChatKey<K extends DualEventSuffix> = `chat.${K}`;

/**
 * Emit to both `monitor.{suffix}` and `chat.{suffix}` in one call.
 * The chat payload is the monitor payload plus `thread_id`.
 */
function emitDual<K extends DualEventSuffix>(
  suffix: K,
  projectId: string,
  monitorPayload: Omit<EventMap[MonitorKey<K>], "project_id">,
  threadId: string,
) {
  eventBus.emit(
    `monitor.${suffix}` as MonitorKey<K>,
    { project_id: projectId, ...monitorPayload } as EventMap[MonitorKey<K>],
  );
  eventBus.emit(
    `chat.${suffix}` as ChatKey<K>,
    {
      project_id: projectId,
      thread_id: threadId,
      ...monitorPayload,
    } as unknown as EventMap[ChatKey<K>],
  );
}

/** Save events to DB and broadcast each one via event bus. */
function persistAndBroadcastEvents(
  projectId: string,
  events: CaptainEvent[],
  monitorThread: { id: string },
  eventSection: string,
) {
  monitorRepo.create(projectId, "user", eventSection);
  chatMessageRepo.createMessage(monitorThread.id, "event", eventSection);

  for (const event of events) {
    const description = formatEvents([event]).replace(
      /^\[\d{2}:\d{2}:\d{2}\]\s*/,
      "",
    );
    emitDual("event_received", projectId, { event_type: event.type, description }, monitorThread.id);
  }
}

/** Build the full environment object for Captain's claude -p invocation. */
async function buildAgentEnv(projectId: string): Promise<{ env: Record<string, string>; sshKeyPath: string | undefined }> {
  const apiKey = getSystemApiKey();
  const env: Record<string, string> = {
    ...globalEnvVarRepo.getMap(),
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: "captain",
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

/** Create the onEvent callback that relays stream events to the frontend. */
function createStreamHandler(
  projectId: string,
  monitorThread: { id: string },
): (event: { type: string; [key: string]: unknown }) => void {
  return (event) => {
    try {
      if (event.type === "assistant") {
        const content = event.message as
          | { content?: Array<{ text?: string }> }
          | undefined;
        const text = content?.content?.[0]?.text;
        if (text) {
          emitDual("message", projectId, { content: text }, monitorThread.id);
        }
      } else if (event.type === "tool_use") {
        emitDual("tool_call", projectId, {
          tool_name: (event.name as string) ?? "unknown",
          tool_input: event.input,
        }, monitorThread.id);
      } else if (event.type === "tool_result") {
        emitDual("tool_result", projectId, {
          tool_name: "bash",
          result: event.content,
        }, monitorThread.id);
      }
    } catch (eventErr) {
      logger.warn(
        { eventErr, eventType: event.type },
        "Monitor: Failed to process stream event",
      );
    }
  };
}

/** Retry action plan extraction with a minimal prompt. */
async function retryActionExtraction(
  resultText: string,
  env: Record<string, string>,
  model: string,
  projectId: string,
): Promise<{ actionPlan: ActionPlan | null; response: string }> {
  try {
    const { resultText: retryText } = await runClaudeWithTimeout({
      prompt:
        "Extract the actions from the following text and output them as JSON wrapped in <action> tags.\n\n" +
        "Available action types: dispatch (issue_id, agent_id, instructions?), merge (issue_id), " +
        "create-pr (issue_id), comment (issue_id, content), create-issue (title, description?), " +
        "update-issue (issue_id, status?, title?), scan, skip (issue_id, reason).\n\n" +
        'If no actions are described, output: <action>{"reasoning": "no actions", "actions": []}</action>\n\n' +
        "Text to extract from:\n---\n" +
        (resultText || "No response") +
        "\n---",
      systemPrompt:
        "You extract structured actions from text. Output ONLY <action>{JSON}</action> tags. No other text.",
      env,
      model,
      timeoutMs: 30 * 1000,
      projectId,
    });

    if (retryText) {
      const actionPlan = extractActionPlanFromText(retryText);
      if (actionPlan) {
        logger.info({ projectId, actionCount: actionPlan.actions.length }, "Monitor: Retry extraction succeeded");
        return { actionPlan, response: await executeAndFormat(projectId, actionPlan) };
      }
    }

    logger.warn({ projectId }, "Monitor: Retry extraction also failed");
    return { actionPlan: null, response: resultText || "No action plan generated" };
  } catch (retryErr) {
    logger.error({ retryErr, projectId }, "Monitor: Retry extraction failed");
    return { actionPlan: null, response: resultText || "No action plan generated" };
  }
}

/** Persist final response and emit completion events. */
function persistAndBroadcastResponse(
  projectId: string,
  monitorThread: { id: string },
  finalResponse: string,
) {
  if (finalResponse) {
    emitDual("message", projectId, { content: finalResponse }, monitorThread.id);
    monitorRepo.create(projectId, "assistant", finalResponse);
    chatMessageRepo.createMessage(monitorThread.id, "assistant", finalResponse);
  }

  emitDual("complete", projectId, { response: finalResponse }, monitorThread.id);
}

/** Build the user prompt from events and monitor history. */
function buildUserPrompt(events: CaptainEvent[], projectId: string): string {
  const eventText = formatEvents(events);
  const eventSection = eventText
    ? `## Events\n${eventText}\n\nProcess these events and output a JSON action plan.`
    : "Check current project state and output a JSON action plan with any needed actions.";

  const history = getMonitorHistory(projectId);
  const sections: string[] = [];
  if (history) sections.push(`## Recent Monitor History\n${history}`);
  sections.push(eventSection);
  return sections.join("\n\n");
}

/** Execute a valid action plan, updating captain status. */
async function executeActionPlan(projectId: string, actionPlan: ActionPlan): Promise<string> {
  logger.info({
    projectId,
    reasoning: actionPlan.reasoning,
    actionCount: actionPlan.actions.length,
  }, "Monitor: Executing action plan");

  try {
    updateCaptainStatus(
      projectId,
      "executing",
      actionPlan.reasoning
        ? actionPlan.reasoning.slice(0, 120)
        : `Executing ${actionPlan.actions.length} action${actionPlan.actions.length !== 1 ? "s" : ""}`,
    );
  } catch (err) {
    logger.warn({ err, projectId }, "Monitor: Failed to update captain status to executing");
  }

  return executeAndFormat(projectId, actionPlan);
}

// --- Core infrastructure ---

/**
 * Spawn claude -p with a 2-minute timeout. Returns collected events and result text.
 */
async function runClaudeWithTimeout(opts: {
  prompt: string;
  systemPrompt: string;
  env: Record<string, string>;
  model: string;
  timeoutMs: number;
  projectId: string;
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
      { projectId: opts.projectId, pid: result.pid },
      `Monitor: claude -p timed out after ${opts.timeoutMs / 1000}s, sending SIGTERM`,
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

/**
 * Execute an action plan and format the response string.
 */
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

/**
 * Process monitor events with the LLM via claude -p with streaming.
 * Returns the action plan execution results.
 */
export const processWithLLM = async (
  projectId: string,
  events: CaptainEvent[],
): Promise<string> => {
  const systemPrompt = buildSystemPrompt(projectId);
  if (!systemPrompt) return "Error: Project not found";

  const userPrompt = buildUserPrompt(events, projectId);
  const monitorThread = chatThreadRepo.getOrCreateMonitorThread(projectId);
  persistAndBroadcastEvents(projectId, events, monitorThread, userPrompt);
  emitDual("thinking", projectId, {}, monitorThread.id);

  try {
    updateCaptainStatus(projectId, "thinking",
      `Analyzing ${events.length} event${events.length !== 1 ? "s" : ""}`);
  } catch (err) {
    logger.warn({ err, projectId }, "Monitor: Failed to update captain status to thinking");
  }

  const { env, sshKeyPath } = await buildAgentEnv(projectId);
  let finalResponse = "";

  try {
    const model = resolveModel("captain");
    const { events: collectedEvents, resultText, exitCode } =
      await runClaudeWithTimeout({
        prompt: userPrompt, systemPrompt, env, model,
        timeoutMs: 2 * 60 * 1000, projectId,
        onEvent: createStreamHandler(projectId, monitorThread),
      });

    if (exitCode !== 0) {
      logger.warn({ projectId, code: exitCode }, "Monitor claude -p exited non-zero");
    }

    const actionPlan =
      extractActionPlanFromText(resultText) ??
      extractActionPlanFromEvents(collectedEvents);

    if (actionPlan) {
      finalResponse = await executeActionPlan(projectId, actionPlan);
    } else {
      logger.warn(
        { projectId, responsePreview: (resultText || "").slice(0, 200) },
        "Monitor: Could not parse action plan, retrying extraction",
      );
      const retry = await retryActionExtraction(resultText, env, model, projectId);
      finalResponse = retry.response;
    }
  } catch (err) {
    logger.error({ err }, "Monitor claude -p call failed");
    finalResponse = "Error: Failed to process events";
  } finally {
    if (sshKeyPath) cleanupSshKey(sshKeyPath);
  }

  persistAndBroadcastResponse(projectId, monitorThread, finalResponse);
  return finalResponse;
};
