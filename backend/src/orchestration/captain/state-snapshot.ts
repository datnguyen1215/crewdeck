/**
 * State snapshot builder for the Monitor agent.
 * Queries DB for current project state and returns a formatted markdown string.
 */
import { listIssues } from "../../db/repositories/issues.js";
import { listDependenciesBatch } from "../../db/repositories/issue-dependencies.js";
import { listActiveRunsForProject } from "../../db/repositories/agent-runs.js";
import { listByProject as listKnowledge } from "../../db/repositories/knowledge.js";
import { listIssuePRs } from "../../db/repositories/issue-prs.js";
import { getCrewMember } from "../crew.js";
import { isApprovedToStart, isApprovedToMerge } from "../approval-store.js";

/** PR-related issue statuses that should show PR info */
const PR_STATUSES = [
  "pr_created",
  "pr_conflict",
  "pr_failed_actions",
  "pr_ready_to_merge",
];

/**
 * Build a compact snapshot of current project state to inject into the prompt,
 * eliminating the need for initial curl calls.
 */
export function buildStateSnapshot(projectId: string): string {
  const parts: string[] = [];

  // Compact issues (non-closed, no descriptions)
  const issues = listIssues(projectId, {
    status: [
      "open",
      "in_progress",
      "pr_created",
      "pr_ready_to_merge",
      "pr_conflict",
      "pr_failed_actions",
    ],
  });

  // Fetch dependencies for all issues in one batch query
  const issueIds = issues.map((i) => i.id);
  const dependenciesMap = listDependenciesBatch(issueIds);

  if (issues.length > 0) {
    const rows = issues.map((i) => {
      const agent = i.running_agent_id ? ` [agent: ${i.running_agent_id}]` : "";
      const paused = i.paused ? " (paused)" : "";

      // Dependencies
      const deps = dependenciesMap.get(i.id) || [];
      const depsInfo = deps.length > 0 ? ` | depends:[${deps.join(",")}]` : "";

      // PR info: show latest PR for PR-related statuses
      const prs = listIssuePRs(i.id);
      let prInfo = "";
      if (PR_STATUSES.includes(i.status)) {
        const latestPR = prs.at(-1); // most recent PR
        if (latestPR) {
          prInfo = ` | [PR: #${latestPR.pr_number} (${latestPR.status}) ${latestPR.pr_url || ""}]`;
        } else {
          // Orphan detection: PR status but no PR record
          prInfo = " | [NO PR]";
        }
      } else if (prs.length > 0) {
        // For non-PR statuses, show open PR if any
        const openPR = prs.filter((p) => p.status === "open").at(-1);
        if (openPR) {
          prInfo = ` | [PR: #${openPR.pr_number} ${openPR.pr_url || ""}]`;
        }
      }

      // Include manual approval flags
      const approvedStart = isApprovedToStart(i.id)
        ? " (approved-to-start)"
        : "";
      const approvedMerge = isApprovedToMerge(i.id)
        ? " (approved-to-merge)"
        : "";
      const summary = i.summary ? ` | "${i.summary.slice(0, 300)}"` : "";
      return `- ${i.id} | ${i.status}${paused}${approvedStart}${approvedMerge}${agent}${depsInfo}${prInfo} | ${i.title}${summary}`;
    });
    parts.push(`### Issues (non-closed)\n${rows.join("\n")}`);
  } else {
    parts.push("### Issues (non-closed)\nNone");
  }

  // Active runs
  const runs = listActiveRunsForProject(projectId);
  if (runs.length > 0) {
    const rows = runs.map((r) => {
      const agent = getCrewMember(r.agent_id);
      const name = agent?.name ?? r.agent_id;
      const issue = r.issue_id ? ` on issue ${r.issue_id}` : "";
      return `- ${r.id} | ${name} (${r.status})${issue}`;
    });
    parts.push(`### Active Runs\n${rows.join("\n")}`);
  } else {
    parts.push("### Active Runs\nNone");
  }

  // Knowledge titles
  const knowledge = listKnowledge(projectId);
  if (knowledge.length > 0) {
    const rows = knowledge.map((k) => `- ${k.id} | [${k.category}] ${k.title}`);
    parts.push(`### Knowledge Entries\n${rows.join("\n")}`);
  } else {
    parts.push("### Knowledge Entries\nNone");
  }

  return parts.join("\n\n");
}
