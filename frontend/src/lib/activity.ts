import type { ActivityLog } from '$lib/api/http.js';

export interface ActorConfig {
	icon: string;
	color: string;
	border: string;
	glow: string;
}

export const ACTOR_CFG: Record<string, ActorConfig> = {
	user: { icon: '○', color: 'text-primary', border: 'border-edge-hi', glow: '' },
	agent: { icon: '⬡', color: 'text-cyan', border: 'border-cyan', glow: 'var(--glow-cyan)' },
	orchestrator: { icon: '◈', color: 'text-purple', border: 'border-purple', glow: 'var(--glow-purple)' },
	captain: { icon: '★', color: 'text-amber', border: 'border-amber', glow: 'var(--glow-amber)' },
	system: { icon: '⚙', color: 'text-muted', border: 'border-edge', glow: '' }
};

export const ACTION_LABELS: Record<string, (d: Record<string, unknown>) => string> = {
	'issue.created': () => 'Created issue',
	'issue.status_changed': (d) =>
		`Status: ${String(d.from).replace(/_/g, ' ')} → ${String(d.to).replace(/_/g, ' ')}`,
	'issue.priority_set': (d) => `Set priority to ${d.priority}`,
	'agent.assigned': (d) => `Assigned ${d.agent_name}`,
	'session.started': (d) => `Started work session${d.agent_name ? ` for ${d.agent_name}` : ''}`,
	'session.ended': (d) => `Session ended (${d.status})`,
	'comment.added': () => 'Posted a comment',
	'review.requested': (d) => `Requested review from ${d.reviewer_name}`,
	'review.comment': () => 'Left a review comment',
	'review.approved': () => 'Approved the changes',
	'pr.created': (d) => `Created PR #${d.pr_number}`,
	'pr.merged': (d) => `Merged PR #${d.pr_number}`,
	'captain.decision': (d) => `Decision: ${String(d.action).replace(/_/g, ' ')}`,
	'review.completed': (d) => `Review ${d.verdict === 'approved' ? 'approved' : 'requested changes'}`,
	'agent.finished': (d) => `Finished (${d.role ?? 'worker'})`,
	'agent.error': (d) => `Error${d.message ? `: ${String(d.message).slice(0, 100)}` : ''}`,
	'agent.needs_help': (d) => `Needs help${d.message ? `: ${String(d.message).slice(0, 100)}` : ''}`
};

export const ACTION_DISPLAY: Record<string, string> = {
	'issue.created': 'Issue Created',
	'issue.status_changed': 'Status Changed',
	'issue.priority_set': 'Priority Set',
	'agent.assigned': 'Agent Assigned',
	'session.started': 'Session Started',
	'session.ended': 'Session Ended',
	'comment.added': 'Comment Added',
	'review.requested': 'Review Requested',
	'review.comment': 'Review Comment',
	'review.approved': 'Review Approved',
	'pr.created': 'PR Created',
	'pr.merged': 'PR Merged',
	'captain.decision': 'Captain Decision',
	'review.completed': 'Review Completed',
	'agent.finished': 'Agent Finished',
	'agent.error': 'Agent Error',
	'agent.needs_help': 'Agent Needs Help'
};

export function actorName(entry: ActivityLog): string {
	if (entry.actor_type === 'agent') {
		if (entry.actor_name) return entry.actor_name;
		return 'Agent';
	}
	if (entry.actor_type === 'captain') return 'Captain';
	if (entry.actor_type === 'orchestrator') return 'Orchestrator';
	if (entry.actor_type === 'system') return 'System';
	return 'User';
}

export function actionLabel(entry: ActivityLog): string {
	const fn = ACTION_LABELS[entry.action];
	return fn ? fn((entry.details as Record<string, unknown>) ?? {}) : entry.action;
}

export function hasExpandableDetails(entry: ActivityLog): boolean {
	const d = (entry.details as Record<string, unknown>) ?? {};
	return !!(d.text || d.content_preview || d.reason || d.reasoning || d.note || d.branch || d.message || d.verdict);
}

export const HANDOFF_ACTIONS = new Set([
	'captain.decision', 'agent.assigned', 'session.started', 'agent.finished', 'review.completed'
]);
