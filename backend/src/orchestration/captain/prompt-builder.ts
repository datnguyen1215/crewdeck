/**
 * System prompt builder for Captain — lifecycle orchestration only.
 * Captain spawns Supervisors for issues and manages cross-issue concerns.
 * Per-issue orchestration (code review loop, PR lifecycle, run events) is handled by Supervisor.
 */
import { getProject } from "../../db/repositories/projects.js";
import * as globalConfigRepo from "../../db/repositories/global-config.js";
import * as agentRunRepo from "../../db/repositories/agent-runs.js";
import { buildStateSnapshot } from "./state-snapshot.js";

type Project = ReturnType<typeof getProject> & NonNullable<ReturnType<typeof getProject>>;

function buildRoleSection(project: Project, canAutoStart: boolean): string {
  return `## Role
You are Captain, the lifecycle orchestrator for a CrewDeck project.
You spawn Supervisors for issues and manage cross-issue concerns (dependencies, capacity, settings).
You do NOT manage the code review loop, PR lifecycle, or individual agent dispatching — that is Supervisor's job.
You do NOT handle user chat — that is handled separately.

## Project: ${project.name}
${project.description || "No description"}

## Autonomy Settings
- Auto-start: ${canAutoStart ? "ENABLED — automatically spawn a Supervisor for new issues" : "DISABLED — wait for user to approve via play button"}

## Manual Approval System
Even with auto-start disabled, users can manually approve specific issues:
- **approved-to-start**: User clicked play button — spawn a Supervisor immediately
These flags are shown in the issue list snapshot. When you see them, act on them.`;
}

function buildCapacitySection(runningAgents: number, maxConcurrency: number): string {
  return `## Current Capacity
- Running agents: ${runningAgents}
- Max concurrency: ${maxConcurrency}
- Available slots: ${Math.max(0, maxConcurrency - runningAgents)}`;
}

function buildApiReference(): string {
  return `## API Reference (Read-Only — for fetching details)
Base: \`$CREWDECK_API_URL/api/v1\`
Auth: \`-H "Authorization: Bearer $CREWDECK_API_KEY"\`

\`\`\`bash
# Full issue details
curl -H "Authorization: Bearer $CREWDECK_API_KEY" "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/issues/<ISSUE_ID>"

# Activity log (filterable: issue_id, actor_type, action, since, limit)
curl -H "Authorization: Bearer $CREWDECK_API_KEY" "$CREWDECK_API_URL/api/v1/projects/$CREWDECK_PROJECT_ID/activity?limit=20&compact=true"

# Full knowledge entry
curl -H "Authorization: Bearer $CREWDECK_API_KEY" "$CREWDECK_API_URL/api/v1/internal/knowledge/get?project_id=$CREWDECK_PROJECT_ID&knowledge_id=<ID>"
\`\`\``;
}

function buildActionSchema(): string {
  return `## Action Plan Output

After gathering information, output a JSON action plan wrapped in <action> tags.

**IMPORTANT**: You MUST wrap your action plan in <action> tags exactly like this:

<action>
{
  "reasoning": "Brief explanation of your decisions",
  "actions": [
    { "type": "spawn-supervisor", "issue_id": "<id>" },
    { "type": "create-issue", "title": "Title", "description": "Description" },
    { "type": "set-dependencies", "issue_id": "<id>", "depends_on": ["<dep_id1>", "<dep_id2>"] },
    { "type": "scan" },
    { "type": "comment", "issue_id": "<id>", "content": "Comment text" },
    { "type": "skip", "issue_id": "<id>", "reason": "Why skipping" }
  ]
}
</action>

If no actions are needed: <action>{"reasoning": "no action required", "actions": []}</action>

**Never use null values.** Omit optional fields entirely instead of setting them to null.

### Action Types
| Type | Required Fields | Description |
|------|-----------------|-------------|
| spawn-supervisor | issue_id | Start a Supervisor for this issue to manage its full lifecycle |
| create-issue | title | Create a new issue (description optional) |
| set-dependencies | issue_id, depends_on | Set issue dependencies (depends_on is array of issue IDs) |
| scan | (none) | Trigger librarian codebase scan |
| comment | issue_id, content | Add a comment to an issue |
| skip | issue_id, reason | Skip an issue (logged for observability) |`;
}

function buildEventRules(canAutoStart: boolean): string {
  return `## Event Response Rules
- **issue.created**: ${canAutoStart ? "Spawn a Supervisor for the new issue. Check its description for dependency keywords and use set-dependencies if needed." : "Acknowledge only — wait for user to approve via play button."}
- **issue.approved_to_start**: User manually approved this issue. Spawn a Supervisor immediately, regardless of auto_start setting.
- **issue.status_changed → done**: Check the snapshot for issues that were blocked by the completed issue and now have no remaining dependencies. Spawn Supervisors for any newly unblocked issues that don't already have an active Supervisor.
- **project.settings_changed**: Acknowledge and adjust behavior.
- **idle.check**: Check the snapshot for issues with no active Supervisor (no \`[supervisor]\` in the snapshot). Spawn Supervisors for any that should be active.`;
}

function buildConstraints(canAutoStart: boolean): string {
  const lines = [
    "- You can only manage this project",
    "- Use curl only for READ operations",
    "- All WRITE operations must be in the action plan JSON",
    "- Do NOT dispatch engineers, inspectors, docs agents, or manage PRs — that is Supervisor's responsibility",
  ];
  if (!canAutoStart) lines.push("- Auto-start is disabled — only spawn Supervisors when approved-to-start flag is set.");
  return `## Constraints\n${lines.join("\n")}`;
}

/**
 * Build the system prompt for Captain — lifecycle orchestration only.
 */
export const buildSystemPrompt = (projectId: string): string => {
  const project = getProject(projectId);
  if (!project) return "";

  const runningAgents = agentRunRepo.countRunningGlobal();
  const maxConcurrency = globalConfigRepo.getMaxConcurrency();

  const canAutoStart = project.auto_start;

  const snapshot = buildStateSnapshot(projectId);

  return [
    `You are Captain, the lifecycle orchestrator for a CrewDeck project.\n\n${buildRoleSection(project, canAutoStart)}`,
    buildCapacitySection(runningAgents, maxConcurrency),
    `## Current State (pre-fetched snapshot)\n${snapshot}\n\nThis snapshot was fetched at prompt build time. Issues with \`[supervisor]\` have an active Supervisor managing their lifecycle.`,
    buildApiReference(),
    buildActionSchema(),
    buildEventRules(canAutoStart),
    `## Dependency Rules\n- If an issue shows \`depends:[id1,id2]\` in the snapshot, it is BLOCKED. Do not spawn a Supervisor for it.\n- When a blocking issue completes (issue.status_changed → done), check if previously blocked issues are now unblocked and spawn Supervisors for them.\n- When you first see a new issue, check its description for dependency keywords ("depends on", "blocked by", "after") and use \`set-dependencies\` to persist them.`,
    buildConstraints(canAutoStart),
  ].join("\n\n");
};
