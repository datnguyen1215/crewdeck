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

import * as chatRepo from "../../db/repositories/chat-messages.js";
import type { CaptainEvent } from "./queue.js";

import { buildSystemPrompt } from "./prompt-builder.js";
import { formatEvents } from "./event-formatter.js";
import { getMonitorHistory } from "./monitor-history.js";
import {
  extractActionPlanFromEvents,
  extractActionPlanFromText,
} from "./action-plan-extractor.js";
import { PROCESS_GRACE_PERIOD_MS } from "../../config/orchestration.js";

/**
 * Set up GitHub auth environment variables for Captain.
 */
const setupGitHubAuth = async (
  projectId: string,
  env: Record<string, string>,
): Promise<string | undefined> => {
  const project = getProject(projectId);
  if (!project?.vcs_account_id) return undefined;

  const { getVCSAccount } =
    await import("../../db/repositories/vcs-accounts.js");
  const account = getVCSAccount(project.vcs_account_id);
  if (!account) return undefined;

  env.GH_TOKEN = account.token;
  const { createGitSshEnv } = await import("../../utils/git-auth.js");
  const ssh = createGitSshEnv(account.ssh_private_key);
  Object.assign(env, ssh.env);
  return ssh.keyPath;
};

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

  const eventText = formatEvents(events);
  const eventSection = eventText
    ? `## Events\n${eventText}\n\nProcess these events and output a JSON action plan.`
    : "Check current project state and output a JSON action plan with any needed actions.";

  const history = getMonitorHistory(projectId);
  const sections = [];
  if (history) sections.push(`## Recent Monitor History\n${history}`);
  sections.push(eventSection);
  const userPrompt = sections.join("\n\n");

  // Save event message to DB (no session — monitor messages are sessionless)
  chatRepo.create(projectId, "user", eventSection);

  // Emit captain.event_received for each event so frontend can show them
  for (const event of events) {
    const description = formatEvents([event]).replace(
      /^\[\d{2}:\d{2}:\d{2}\]\s*/,
      "",
    );
    eventBus.emit("monitor.event_received", {
      project_id: projectId,
      event_type: event.type,
      description,
    });
  }

  eventBus.emit("monitor.thinking", { project_id: projectId });

  try {
    updateCaptainStatus(
      projectId,
      "thinking",
      `Analyzing ${events.length} event${events.length !== 1 ? "s" : ""}`,
    );
  } catch (err) {
    logger.warn(
      { err, projectId },
      "Monitor: Failed to update captain status to thinking",
    );
  }

  const env: Record<string, string> = {
    CREWDECK_API_URL: `http://localhost:${process.env.PORT || "9381"}`,
    CREWDECK_PROJECT_ID: projectId,
    CREWDECK_AGENT_ID: "captain",
  };

  const sshKeyPath = await setupGitHubAuth(projectId, env);
  let finalResponse = "";
  let actionPlan: ActionPlan | null = null;

  try {
    const model = resolveModel("captain");

    // Emit streaming events for frontend visibility
    const onEvent = (event: { type: string; [key: string]: unknown }) => {
      try {
        if (event.type === "assistant") {
          const content = event.message as
            | { content?: Array<{ text?: string }> }
            | undefined;
          const text = content?.content?.[0]?.text;
          if (text) {
            eventBus.emit("monitor.message", {
              project_id: projectId,
              content: text,
            });
          }
        } else if (event.type === "tool_use") {
          eventBus.emit("monitor.tool_call", {
            project_id: projectId,
            tool_name: (event.name as string) ?? "unknown",
            tool_input: event.input,
          });
        } else if (event.type === "tool_result") {
          eventBus.emit("monitor.tool_result", {
            project_id: projectId,
            tool_name: "bash",
            result: event.content,
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
      logger.warn(
        { projectId, code: exitCode },
        "Monitor claude -p exited non-zero",
      );
    }

    // Try to extract action plan from result text, then fall back to events
    actionPlan =
      extractActionPlanFromText(resultText) ??
      extractActionPlanFromEvents(collectedEvents);

    if (actionPlan) {
      logger.info(
        {
          projectId,
          reasoning: actionPlan.reasoning,
          actionCount: actionPlan.actions.length,
        },
        "Monitor: Executing action plan",
      );

      try {
        updateCaptainStatus(
          projectId,
          "executing",
          actionPlan.reasoning
            ? actionPlan.reasoning.slice(0, 120)
            : `Executing ${actionPlan.actions.length} action${actionPlan.actions.length !== 1 ? "s" : ""}`,
        );
      } catch (err) {
        logger.warn(
          { err, projectId },
          "Monitor: Failed to update captain status to executing",
        );
      }

      finalResponse = await executeAndFormat(projectId, actionPlan);
    } else {
      // No valid action plan — retry with a minimal extraction prompt
      logger.warn(
        { projectId, responsePreview: (resultText || "").slice(0, 200) },
        "Monitor: Could not parse action plan, retrying extraction",
      );

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
          actionPlan = extractActionPlanFromText(retryText);
        }

        if (actionPlan) {
          logger.info(
            { projectId, actionCount: actionPlan.actions.length },
            "Monitor: Retry extraction succeeded",
          );
          finalResponse = await executeAndFormat(projectId, actionPlan);
        } else {
          finalResponse = resultText || "No action plan generated";
          logger.warn({ projectId }, "Monitor: Retry extraction also failed");
        }
      } catch (retryErr) {
        logger.error(
          { retryErr, projectId },
          "Monitor: Retry extraction failed",
        );
        finalResponse = resultText || "No action plan generated";
      }
    }
  } catch (err) {
    logger.error({ err }, "Monitor claude -p call failed");
    finalResponse = "Error: Failed to process events";
  } finally {
    if (sshKeyPath) {
      const { cleanupSshKey } = await import("../../utils/git-auth.js");
      cleanupSshKey(sshKeyPath);
    }
  }

  if (finalResponse) {
    eventBus.emit("monitor.message", {
      project_id: projectId,
      content: finalResponse,
    });
    chatRepo.create(projectId, "assistant", finalResponse);
  }

  eventBus.emit("monitor.complete", {
    project_id: projectId,
    response: finalResponse,
  });

  return finalResponse;
};
