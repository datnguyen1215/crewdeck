import type { ActivityLog } from "$lib/api/http.js";

export interface ActorConfig {
  icon: string;
  color: string;
  border: string;
  glow: string;
}

export const ACTOR_CFG: Record<string, ActorConfig> = {
  user: {
    icon: "○",
    color: "text-primary",
    border: "border-edge-hi",
    glow: "",
  },
  agent: {
    icon: "⬡",
    color: "text-cyan",
    border: "border-cyan",
    glow: "var(--glow-cyan)",
  },
  system: { icon: "★", color: "text-muted", border: "border-edge", glow: "" },
};

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function humanExit(exitCode: unknown): string {
  const code = Number(exitCode);
  if (exitCode === null || exitCode === undefined) return "exit ?";
  if (code === 0) return "success";
  if (code === 1) return "error (exit 1)";
  if (code === 2) return "misuse (exit 2)";
  if (code === 130) return "interrupted (exit 130)";
  if (code === 143) return "terminated (exit 143)";
  return `exit ${code}`;
}

export const ACTION_LABELS: Record<
  string,
  (d: Record<string, unknown>) => string
> = {
  "issue.created": () => "Created issue",
  "issue.status_changed": (d) =>
    `Status: ${String(d.from).replace(/_/g, " ")} → ${String(d.to).replace(/_/g, " ")}`,
  "comment.added": (d) => {
    const name = d._actor_name || d.agent_id;
    return name ? `${cap(String(name))} posted a comment` : "Posted a comment";
  },
  "pr.created": (d) => `Created PR #${d.pr_number}`,
  "mention.spawned": (d) => {
    const name = d._actor_name || d.agent_id;
    return `${name ? cap(String(name)) : "Agent"} spawned`;
  },
  "mention.completed": (d) => {
    const name = d._actor_name || d.agent_id;
    return `${name ? cap(String(name)) : "Agent"} finished — ${humanExit(d.exit_code)}`;
  },
  "run.started": (d) => {
    const name = d._actor_name || d.agent_id;
    return `${name ? cap(String(name)) : "Agent"} run started`;
  },
};

export const ACTION_DISPLAY: Record<string, string> = {
  "issue.created": "Issue Created",
  "issue.status_changed": "Status Changed",
  "comment.added": "Comment Added",
  "pr.created": "PR Created",
  "mention.spawned": "Agent Spawned",
  "mention.completed": "Agent Completed",
};

export function actorName(entry: ActivityLog): string {
  if (entry.actor_type === "agent") {
    if (entry.actor_name) return entry.actor_name;
    return "Agent";
  }
  if (entry.actor_type === "system") return "System";
  return "User";
}

export function actionLabel(entry: ActivityLog): string {
  const fn = ACTION_LABELS[entry.action];
  if (!fn) return entry.action;
  // Inject actor_name as _actor_name so label functions can use it
  const details = (entry.details as Record<string, unknown>) ?? {};
  const enriched = entry.actor_name
    ? { ...details, _actor_name: entry.actor_name }
    : details;
  return fn(enriched);
}

export function hasExpandableDetails(entry: ActivityLog): boolean {
  const d = (entry.details as Record<string, unknown>) ?? {};
  return !!(
    d.text ||
    d.content_preview ||
    d.reason ||
    d.reasoning ||
    d.note ||
    d.branch ||
    d.message ||
    d.verdict
  );
}

export const HANDOFF_ACTIONS = new Set([
  "mention.spawned",
  "mention.completed",
]);
