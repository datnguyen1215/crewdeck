/**
 * Event formatter for the Monitor agent.
 * Formats captain events for LLM consumption with enriched DB context.
 */
import { getIssue } from "../../db/repositories/issues.js";
import { listComments } from "../../db/repositories/comments.js";
import { getIssuePR, listIssuePRs } from "../../db/repositories/issue-prs.js";
import { getCrewMember } from "../crew.js";
import type { Issue } from "../../types/entities.js";
import type { CaptainEvent } from "./queue.js";

/**
 * Get PR info for an issue (latest open PR).
 */
export function getPRInfo(issueId: string): string {
  const prs = listIssuePRs(issueId);
  if (prs.length === 0) return "";
  const pr = prs[prs.length - 1]; // most recent
  return `\n  PR: #${pr.pr_number} (${pr.status})${pr.pr_url ? ` — ${pr.pr_url}` : ""}`;
}

/**
 * Get the latest agent comment on an issue (the agent's report).
 */
export function getLatestAgentComment(issueId: string): string {
  const comments = listComments(issueId);
  // Walk backwards to find the last non-user comment
  for (let i = comments.length - 1; i >= 0; i--) {
    if (comments[i].author_type !== "user") {
      return `\n  Report (${comments[i].author_type}):\n${comments[i].content}`;
    }
  }
  return "";
}

/**
 * Format issue context line: id, title, status.
 */
export function formatIssueContext(issue: Issue): string {
  return `\n  Issue: ${issue.id} | "${issue.title}" | status: ${issue.status}`;
}

/**
 * Format events for the LLM with enriched context from DB lookups.
 * Each event includes enough information for the captain to act immediately.
 */
export const formatEvents = (events: CaptainEvent[]): string => {
  if (events.length === 0) return "";

  return events
    .map((e) => {
      const ts = e.timestamp.toISOString().slice(11, 19);
      switch (e.type) {
        case "issue.created": {
          const data = e.data as { issue: Issue };
          const desc = data.issue.description
            ? `\n  Description: ${data.issue.description}`
            : "";
          return `[${ts}] Issue created: "${data.issue.title}" (${data.issue.id})${desc}`;
        }
        case "issue.status_changed": {
          const data = e.data as { issue_id: string; from: string; to: string };
          const issue = getIssue(data.issue_id);
          const title = issue ? ` "${issue.title}"` : "";
          const prInfo = issue ? getPRInfo(data.issue_id) : "";
          return `[${ts}] Issue ${data.issue_id}${title} status: ${data.from} → ${data.to}${prInfo}`;
        }
        case "run.completed": {
          const data = e.data as {
            agent_id: string;
            issue_id: string | null;
            status: string;
          };
          const agentName = getCrewMember(data.agent_id)?.name ?? data.agent_id;
          let context = "";
          if (data.issue_id) {
            const issue = getIssue(data.issue_id);
            if (issue) context += formatIssueContext(issue);
            context += getPRInfo(data.issue_id);
            context += getLatestAgentComment(data.issue_id);
          }
          return `[${ts}] Agent ${agentName} (${data.agent_id}) completed (${data.status})${data.issue_id ? ` on issue ${data.issue_id}` : ""}${context}`;
        }
        case "pr.status_changed": {
          const data = e.data as { pr_id: string; from: string; to: string };
          const pr = getIssuePR(data.pr_id);
          let context = "";
          if (pr) {
            const issue = getIssue(pr.issue_id);
            context += `\n  Issue: ${pr.issue_id}${issue ? ` | "${issue.title}"` : ""}`;
            context += `\n  PR: #${pr.pr_number}${pr.pr_url ? ` — ${pr.pr_url}` : ""}`;
          }
          return `[${ts}] PR status: ${data.from} → ${data.to}${context}`;
        }
        case "issue.updated": {
          const data = e.data as {
            issue_id: string;
            changes: Record<string, unknown>;
          };
          const issue = getIssue(data.issue_id);
          const title = issue ? ` "${issue.title}"` : "";
          const changedFields = Object.keys(data.changes || {}).join(", ");
          return `[${ts}] Issue ${data.issue_id}${title} updated: ${changedFields || "unknown fields"}`;
        }
        case "comment.added": {
          const data = e.data as {
            comment: {
              id: string;
              issue_id: string;
              author_type: string;
              content: string;
            };
            project_id: string;
          };
          const issue = getIssue(data.comment.issue_id);
          const title = issue ? ` "${issue.title}"` : "";
          return `[${ts}] Comment on issue ${data.comment.issue_id}${title} by ${data.comment.author_type}:\n${data.comment.content}`;
        }
        case "startup.scan":
          return `[${ts}] Startup scan: analyze current project state and take any needed actions`;
        case "idle.check":
          return `[${ts}] Idle check: checking for stuck issues`;
        case "project.settings_changed": {
          const data = e.data as { changes: Record<string, unknown> };
          const formatted = Object.entries(data.changes || {})
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          return `[${ts}] Project settings changed: ${formatted || "unknown changes"}`;
        }
        case "issue.approved_to_start": {
          const data = e.data as { issue_id: string };
          const issue = getIssue(data.issue_id);
          const title = issue ? ` "${issue.title}"` : "";
          return `[${ts}] Issue ${data.issue_id}${title} APPROVED TO START by user — spawn a Supervisor now`;
        }
        case "issue.approved_to_merge": {
          const data = e.data as { issue_id: string };
          const issue = getIssue(data.issue_id);
          const title = issue ? ` "${issue.title}"` : "";
          const prInfo = issue ? getPRInfo(data.issue_id) : "";
          return `[${ts}] Issue ${data.issue_id}${title} APPROVED TO MERGE by user — merge PR now${prInfo}`;
        }
        default:
          return `[${ts}] Event: ${e.type}`;
      }
    })
    .join("\n\n");
};
