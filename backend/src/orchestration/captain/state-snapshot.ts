/**
 * State snapshot builder for Captain.
 * Shows issue list with statuses, dependencies, approval flags, and active Supervisors.
 * PR details and active runs are omitted — Supervisor tracks those per-issue.
 */
import { listIssues } from "../../db/repositories/issues.js";
import { listDependenciesBatch } from "../../db/repositories/issue-dependencies.js";
import { listByProject as listKnowledge } from "../../db/repositories/knowledge.js";
import { isApprovedToStart } from "../approval-store.js";
import { isSupervisorActive } from "../supervisor/supervisor-service.js";

/**
 * Build a compact snapshot of current project state to inject into Captain's prompt.
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
      const paused = i.paused ? " (paused)" : "";
      const deps = dependenciesMap.get(i.id) || [];
      const depsInfo = deps.length > 0 ? ` | depends:[${deps.join(",")}]` : "";
      const approvedStart = isApprovedToStart(i.id) ? " (approved-to-start)" : "";
      const supervisor = isSupervisorActive(i.id) ? " [supervisor]" : "";
      const summary = i.summary ? ` | "${i.summary}"` : "";
      return `- ${i.id} | ${i.status}${paused}${approvedStart}${supervisor}${depsInfo} | ${i.title}${summary}`;
    });
    parts.push(`### Issues (non-closed)\n${rows.join("\n")}`);
  } else {
    parts.push("### Issues (non-closed)\nNone");
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
