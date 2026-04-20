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
import { CAVEMAN_TONE } from "../caveman-tone.js";
import {
  extractActionPlanFromEvents,
  extractActionPlanFromText,
} from "./action-plan-extractor.js";
import { PROCESS_GRACE_PERIOD_MS } from "../../config/orchestration.js";
import * as globalEnvVarRepo from "../../db/repositories/global-environment-variables.js";
import { getSystemApiKey } from "../../app.js";

// --- Helpers ---

// Event suffixes where monitor and chat payloads have identical shape
// (chat just adds thread_id). Only event_received still shares shape.
type SharedSuffix = "event_received";

type MonitorKey<K extends SharedSuffix> = `monitor.${K}`;
type ChatKey<K extends SharedSuffix> = `chat.${K}`;

/**
 * Emit to both `monitor.{suffix}` and `chat.{suffix}` in one call.
 * The chat payload is the monitor payload plus `thread_id`.
 * Only for events where monitor/chat share the same shape.
 */
function emitDual<K extends SharedSuffix>(
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
    } as EventMap[ChatKey<K>],
  );
}

/** Emit monitor and chat thinking events (different shapes since chat needs message_id). */
function emitThinking(projectId: string, threadId: string) {
  eventBus.emit("monitor.thinking", { project_id: projectId });
  eventBus.emit("chat.thinking", { project_id: projectId, thread_id: threadId, message_id: "" });
}

/** Emit monitor and chat message events (different shapes). */
function emitMonitorMessage(projectId: string, threadId: string, content: string) {
  eventBus.emit("monitor.message", { project_id: projectId, content });
  eventBus.emit("chat.message", { project_id: projectId, thread_id: threadId, message_id: "", content });
}

/** Emit monitor and chat tool_call events (different shapes). */
function emitMonitorToolCall(projectId: string, threadId: string, toolName: string, toolInput: unknown) {
  eventBus.emit("monitor.tool_call", { project_id: projectId, tool_name: toolName, tool_input: toolInput });
  eventBus.emit("chat.tool_call", { project_id: projectId, thread_id: threadId, message_id: "", tool_call_id: "", tool_name: toolName, tool_input: toolInput });
}

/** Emit monitor and chat tool_result events (different shapes). */
function emitMonitorToolResult(projectId: string, threadId: string, toolName: string, result: unknown) {
  eventBus.emit("monitor.tool_result", { project_id: projectId, tool_name: toolName, result });
  eventBus.emit("chat.tool_result", { project_id: projectId, thread_id: threadId, message_id: "", tool_call_id: "", tool_name: toolName, result });
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
    emitMonitorMessage(projectId, monitorThread.id, finalResponse);
    monitorRepo.create(projectId, "assistant", finalResponse);
    chatMessageRepo.createMessage(monitorThread.id, "assistant", finalResponse);
  }

  // complete events have different shapes (monitor has response, chat does not),
  // so they can't go through emitDual.
  eventBus.emit("monitor.complete", { project_id: projectId, response: finalResponse });
  eventBus.emit("chat.complete", { project_id: projectId, thread_id: monitorThread.id, message_id: "" });
}

/** Build the user prompt from events and monitor history. Returns both the full prompt and the events-only section. */
function buildUserPrompt(events: CaptainEvent[], projectId: string): { userPrompt: string; eventSection: string } {
  const eventText = formatEvents(events);
  const eventSection = eventText
    ? `## Events\n${eventText}\n\nProcess these events and output a JSON action plan.`
    : "Check current project state and output a JSON action plan with any needed actions.";

  const history = getMonitorHistory(projectId);
  const sections: string[] = [CAVEMAN_TONE];
  if (history) sections.push(`## Recent Monitor History\n${history}`);
  sections.push(eventSection);
  return { userPrompt: sections.join("\n\n"), eventSection };
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

  const { userPrompt, eventSection } = buildUserPrompt(events, projectId);
  const monitorThread = chatThreadRepo.getOrCreateMonitorThread(projectId);
  persistAndBroadcastEvents(projectId, events, monitorThread, eventSection);
  emitThinking(projectId, monitorThread.id);

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

    // Emit streaming events for frontend visibility.
    // Handles all Claude CLI stream-json event types so the terminal shows
    // the full working process (text, thinking, tools, rate limits, result).
    const onEvent = (event: { type: string; [key: string]: unknown }) => {
      try {
        if (event.type === "assistant") {
          const content = event.message as
            | { content?: Array<{ type?: string; text?: string; thinking?: string }> }
            | undefined;
          for (const block of content?.content ?? []) {
            if (block.type === "thinking" && block.thinking) {
              eventBus.emit("monitor.thinking", {
                project_id: projectId,
                content: block.thinking,
              });
            } else if (block.type === "text" && block.text) {
              emitMonitorMessage(projectId, monitorThread.id, block.text);
            } else if (block.type === "tool_use") {
              emitMonitorToolCall(projectId, monitorThread.id,
                (block as Record<string, unknown>).name as string ?? "unknown",
                (block as Record<string, unknown>).input,
              );
            }
          }
          // Also handle flat tool_use events (no message.content wrapper)
          if (!content?.content?.length && event.name) {
            emitMonitorToolCall(projectId, monitorThread.id,
              (event.name as string) ?? "unknown",
              event.input,
            );
          }
        } else if (event.type === "tool_use") {
          emitMonitorToolCall(projectId, monitorThread.id,
            (event.name as string) ?? "unknown",
            event.input,
          );
        } else if (event.type === "tool_result") {
          emitMonitorToolResult(projectId, monitorThread.id, "bash", event.content);
        } else if (event.type === "rate_limit_event") {
          eventBus.emit("monitor.rate_limit", {
            project_id: projectId,
            message: (event.message as string) ?? "Rate limited",
          });
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
          "Monitor: Failed to process stream event",
        );
      }
    };

    const {
      events: collectedEvents,
      resultText,
      exitCode,
    } = await runClaudeWithTimeout({
      prompt: userPrompt,
      systemPrompt,
      env,
      model,
      timeoutMs: 2 * 60 * 1000,
      projectId,
      onEvent,
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
