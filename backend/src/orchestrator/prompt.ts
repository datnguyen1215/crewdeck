import type { Project, Issue, Agent, CrewWithAgents } from "../types/entities.js";
import { escapeXml } from "../utils/xml.js";

export interface OrchestratorState {
  project: Project;
  crew: CrewWithAgents;
  openIssues: Issue[];
  inProgressIssues: Issue[];
  inReviewIssues: Issue[];
  feedbackIssues: Issue[];
  draftIssues: Issue[];
  activeReviewerAgentIds: Set<string>;
}

function idleAgents(agents: Agent[], active: Issue[], activeReviewerAgentIds: Set<string>): Agent[] {
  const busyIds = new Set(active.filter((i) => i.assigned_agent_id).map((i) => i.assigned_agent_id!));
  return agents.filter((a) => !busyIds.has(a.id) && !activeReviewerAgentIds.has(a.id));
}

function fmtIssue(i: Issue): string {
  const agent = i.assigned_agent_id ? `, agent: ${i.assigned_agent_id}` : "";
  return `  - [${i.id}] <issue_title>${escapeXml(i.title)}</issue_title> (priority: ${i.priority}${agent}, review_round: ${i.current_review_round})`;
}

function fmtAgent(a: Agent): string {
  const captainTag = a.is_captain ? " [CAPTAIN]" : "";
  return `  - [${a.id}] ${escapeXml(a.name)} | title: ${escapeXml(a.title)}${a.description ? ` | ${escapeXml(a.description)}` : ""}${captainTag}`;
}

export function buildOrchestratorPrompt(state: OrchestratorState, eventDescription: string): string {
  const { project, crew, openIssues, inProgressIssues, inReviewIssues, feedbackIssues, draftIssues } = state;
  const allActive = [...inProgressIssues, ...inReviewIssues, ...feedbackIssues];
  const idle = idleAgents(crew.agents, allActive, state.activeReviewerAgentIds);

  const sections: string[] = [];

  sections.push(`## Project State
Open issues:
${openIssues.length ? openIssues.map(fmtIssue).join("\n") : "  (none)"}
In-progress issues:
${inProgressIssues.length ? inProgressIssues.map(fmtIssue).join("\n") : "  (none)"}
In-review issues:
${inReviewIssues.length ? inReviewIssues.map(fmtIssue).join("\n") : "  (none)"}
Feedback issues (awaiting rework):
${feedbackIssues.length ? feedbackIssues.map(fmtIssue).join("\n") : "  (none)"}
Draft issues:
${draftIssues.length ? draftIssues.map(fmtIssue).join("\n") : "  (none)"}
Concurrency: ${allActive.length}/${project.max_concurrency} active
Max review rounds: ${project.max_review_rounds}`);

  sections.push(`## Crew: ${escapeXml(crew.name)}
All agents:
${crew.agents.map(fmtAgent).join("\n")}
Idle agents (available to assign):
${idle.length ? idle.map(fmtAgent).join("\n") : "  (none)"}`);

  sections.push(`## Event\n${eventDescription}`);

  sections.push(`## Instructions
Analyze the current state and the triggering event. Respond with exactly one JSON action object and nothing else.

Supported actions:
  assign            { "action": "assign", "params": { "issue_id": "<uuid>", "agent_id": "<uuid>" }, "reasoning": "..." }
  route_review      { "action": "route_review", "params": { "issue_id": "<uuid>", "reviewer_agent_id": "<uuid>", "review_order": 1 }, "reasoning": "..." }
  escalate          { "action": "escalate", "params": { "issue_id": "<uuid>", "reason": "..." }, "reasoning": "..." }
  create_draft_issue { "action": "create_draft_issue", "params": { "title": "...", "description": "...", "priority": 0 }, "reasoning": "..." }
  reorder           { "action": "reorder", "params": { "issue_priorities": [{ "issue_id": "<uuid>", "priority": 0 }] }, "reasoning": "..." }
  no_action         { "action": "no_action", "params": {}, "reasoning": "..." }

Rules:
- Only assign if concurrency allows (${allActive.length} / ${project.max_concurrency})
- Only assign idle agents (listed above under "Idle agents")
- Only assign issues with status "open" or "draft"
- For route_review: any agent can be assigned as a reviewer
- Use full UUIDs from the state above — not partial IDs
- Output ONLY the raw JSON object. No markdown, no explanation.`);

  return sections.join("\n\n");
}
