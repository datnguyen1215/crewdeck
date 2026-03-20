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
	system: { icon: '⚙', color: 'text-muted', border: 'border-edge', glow: '' }
};

export const ACTION_LABELS: Record<string, (d: Record<string, unknown>) => string> = {
	'issue.created': () => 'Created issue',
	'issue.status_changed': (d) =>
		`Status: ${String(d.from).replace(/_/g, ' ')} → ${String(d.to).replace(/_/g, ' ')}`,
	'comment.added': () => 'Posted a comment',
	'pr.created': (d) => `Created PR #${d.pr_number}`,
	'mention.spawned': (d) => `Agent spawned (pid ${d.pid})`,
	'mention.completed': (d) => `Agent finished (exit ${d.exit_code})`
};

export const ACTION_DISPLAY: Record<string, string> = {
	'issue.created': 'Issue Created',
	'issue.status_changed': 'Status Changed',
	'comment.added': 'Comment Added',
	'pr.created': 'PR Created',
	'mention.spawned': 'Agent Spawned',
	'mention.completed': 'Agent Completed'
};

export function actorName(entry: ActivityLog): string {
	if (entry.actor_type === 'agent') {
		if (entry.actor_name) return entry.actor_name;
		return 'Agent';
	}
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
	'mention.spawned', 'mention.completed'
]);
