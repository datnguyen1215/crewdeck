/**
 * Admiral LLM Agent
 *
 * Uses Claude API with tool calling to make intelligent project management decisions.
 * Maintains a persistent conversation per project.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../logger.js";
import { eventBus } from "../../events/bus.js";
import { getProject } from "../../db/repositories/projects.js";
import { listIssues } from "../../db/repositories/issues.js";
import { listByProject as listKnowledge } from "../../db/repositories/knowledge.js";
import { getActiveProcessCount } from "../processes.js";
import { ADMIRAL_TOOLS } from "./tools.js";
import { executeTool } from "./tool-handlers.js";
import * as chatRepo from "../../db/repositories/chat-messages.js";
import type { AdmiralEvent } from "./queue.js";

const MODEL = "claude-sonnet-4-20250514";
const MAX_CONTEXT_MESSAGES = 100;
const MAX_TOOL_ITERATIONS = 10;

/**
 * Build the system prompt for Admiral.
 */
function buildSystemPrompt(projectId: string): string {
  const project = getProject(projectId);
  if (!project) return "";

  // Get current project state
  const issues = listIssues(projectId);
  const openIssues = issues.filter((i) => i.status === "open");
  const inProgressIssues = issues.filter((i) => i.status === "in_progress");
  const prIssues = issues.filter((i) => i.status.startsWith("pr_"));
  const doneIssues = issues.filter((i) => i.status === "done").slice(0, 20);
  const runningAgents = getActiveProcessCount(projectId);

  // Get knowledge entries
  const knowledge = listKnowledge(projectId);
  const knowledgeSummary = knowledge
    .slice(0, 10)
    .map((k) => `- ${k.title} (${k.category})`)
    .join("\n");

  return `You are Admiral, the autonomous project orchestrator for CrewDeck.

## Role
You manage a software development project by reacting to events and making decisions.
You can merge PRs, dispatch agents to work on issues, create new issues, and manage project knowledge.

## Project: ${project.name}
${project.description || "No description"}

## Current State
- Open issues: ${openIssues.length}
- In progress: ${inProgressIssues.length}
- PRs pending: ${prIssues.length}
- Done (recent): ${doneIssues.length}
- Running agents: ${runningAgents}
- Max concurrency: ${project.max_concurrency}

## Open Issues
${openIssues.map((i) => `- [${i.id.slice(0, 8)}] ${i.title}`).join("\n") || "None"}

## In Progress Issues
${inProgressIssues.map((i) => `- [${i.id.slice(0, 8)}] ${i.title} (agent: ${i.running_agent_id || "none"})`).join("\n") || "None"}

## PR Issues
${prIssues.map((i) => `- [${i.id.slice(0, 8)}] ${i.title} (${i.status})`).join("\n") || "None"}

## Knowledge Entries
${knowledgeSummary || "None"}

## Decision Guidelines

### Priority Order
1. **Merge ready PRs** - If a PR is in pr_ready_to_merge status, merge it immediately
2. **Fix broken PRs** - If a PR has conflicts or failed CI, dispatch Captain to fix
3. **Start new work** - If capacity allows, dispatch Captain on open issues

### When to Dispatch
- Only dispatch if running agents < max_concurrency
- Don't dispatch if Captain is already running on that issue
- For conflicts/failures, include instructions about what to fix

### When to Wait
- If all agents are busy, wait for capacity
- If waiting for CI to run, don't take action yet
- If waiting for review, let the process complete

### Auto-Dispatch Rules
- New issues: Evaluate priority and start work if capacity allows
- Completed work: Check if next steps are needed

## Response Style
- Be concise and action-oriented
- When you take actions, briefly explain why
- Use markdown for formatting
- Show tool results clearly

## Constraints
- You can only manage this project
- Use the provided tools for all actions
- Don't make assumptions about external systems`;
}

/**
 * Format events for the LLM.
 */
function formatEvents(events: AdmiralEvent[]): string {
  if (events.length === 0) return "";

  return events
    .map((e) => {
      const ts = e.timestamp.toISOString().slice(11, 19);
      switch (e.type) {
        case "issue.created": {
          const data = e.data as { issue: { title: string; id: string } };
          return `[${ts}] Issue created: "${data.issue.title}" (${data.issue.id.slice(0, 8)})`;
        }
        case "issue.status_changed": {
          const data = e.data as { issue_id: string; from: string; to: string };
          return `[${ts}] Issue ${data.issue_id.slice(0, 8)} status: ${data.from} → ${data.to}`;
        }
        case "run.completed": {
          const data = e.data as { agent_id: string; issue_id: string | null; status: string };
          return `[${ts}] Agent ${data.agent_id} completed (${data.status})${data.issue_id ? ` on issue ${data.issue_id.slice(0, 8)}` : ""}`;
        }
        case "pr.status_changed": {
          const data = e.data as { pr_id: string; from: string; to: string };
          return `[${ts}] PR status: ${data.from} → ${data.to}`;
        }
        case "chat.message": {
          const data = e.data as { content: string };
          return `[${ts}] User message: ${data.content}`;
        }
        case "idle.check": {
          return `[${ts}] Idle check: checking for stuck issues`;
        }
        default:
          return `[${ts}] Event: ${e.type}`;
      }
    })
    .join("\n");
}

/**
 * Get conversation history from DB.
 * Only loads chat messages, not event-batch messages.
 */
function getConversationHistory(projectId: string): Anthropic.MessageParam[] {
  const messages = chatRepo.getChatOnly(projectId, MAX_CONTEXT_MESSAGES).reverse();

  return messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}

/**
 * Process events with the Admiral LLM.
 * Returns the assistant's final text response.
 */
export async function processWithLLM(
  projectId: string,
  events: AdmiralEvent[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.error("ANTHROPIC_API_KEY not set");
    return "Error: ANTHROPIC_API_KEY not configured";
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt(projectId);

  // Build the user message from events
  const eventText = formatEvents(events);
  const userContent = eventText
    ? `## Events\n${eventText}\n\nProcess these events and take appropriate actions.`
    : "Check current project state and take any needed actions.";

  // Get conversation history
  const history = getConversationHistory(projectId);

  // Add the new user message
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: userContent },
  ];

  // Save event message to DB (as 'event' type so it's not loaded in history)
  chatRepo.create(projectId, "user", userContent, "event");

  // Emit admiral.event_received for each event so frontend can show them
  for (const event of events) {
    const description = formatEvents([event]).replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
    eventBus.emit("admiral.event_received", {
      project_id: projectId,
      event_type: event.type,
      description,
    });
  }

  // Emit that Admiral is thinking
  eventBus.emit("admiral.thinking", { project_id: projectId });

  let iterations = 0;
  let finalResponse = "";

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: ADMIRAL_TOOLS,
        messages,
      });

      // Extract text content
      let textContent = "";
      const toolUses: Anthropic.ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "tool_use") {
          toolUses.push(block);
        }
      }

      // Accumulate text but don't emit yet (emit once at the end)
      if (textContent) {
        finalResponse += textContent;
      }

      // If no tool calls, we're done
      if (toolUses.length === 0) {
        break;
      }

      // Add assistant response to messages
      messages.push({
        role: "assistant",
        content: response.content,
      });

      // Execute tools and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        // Emit tool call event
        eventBus.emit("admiral.tool_call", {
          project_id: projectId,
          tool_name: toolUse.name,
          tool_input: toolUse.input,
        });

        logger.info({ tool: toolUse.name, input: toolUse.input }, "Admiral executing tool");

        const result = await executeTool(
          toolUse.name,
          projectId,
          toolUse.input as Record<string, unknown>
        );

        // Emit tool result
        eventBus.emit("admiral.tool_result", {
          project_id: projectId,
          tool_name: toolUse.name,
          result,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Add tool results to messages
      messages.push({
        role: "user",
        content: toolResults,
      });

      // Continue loop to let LLM process tool results
    } catch (err) {
      logger.error({ err }, "Admiral LLM call failed");
      finalResponse += finalResponse ? "\n\nError: Failed to process events" : "Error: Failed to process events";
      break;
    }
  }

  // Warn if we hit the iteration limit
  if (iterations >= MAX_TOOL_ITERATIONS) {
    logger.warn({ projectId, iterations: MAX_TOOL_ITERATIONS }, "Admiral hit max tool iterations");
  }

  // Emit final message once (not per iteration)
  if (finalResponse) {
    eventBus.emit("admiral.message", {
      project_id: projectId,
      content: finalResponse,
    });
    // Save final response to DB as chat message
    chatRepo.create(projectId, "assistant", finalResponse, "chat");
  }

  // Emit completion
  eventBus.emit("admiral.complete", {
    project_id: projectId,
    response: finalResponse,
  });

  return finalResponse;
}
