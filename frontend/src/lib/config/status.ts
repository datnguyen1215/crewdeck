export type StatusConfig = {
	label: string;
	dot: string;
	text: string;
	border: string;
	glow?: string;
	pulse?: boolean;
	dashed?: boolean;
};

export const STATUS_CFG: Record<string, StatusConfig> = {
	draft: { label: 'Draft', dot: '◌', text: 'text-muted', border: 'border-muted', dashed: true },
	open: { label: 'Open', dot: '○', text: 'text-blue', border: 'border-blue', glow: 'var(--glow-blue)' },
	in_progress: {
		label: 'In Progress',
		dot: '◉',
		text: 'text-green',
		border: 'border-green',
		glow: 'var(--glow-green)',
		pulse: true
	},
	in_review: {
		label: 'In Review',
		dot: '◉',
		text: 'text-amber',
		border: 'border-amber',
		glow: 'var(--glow-amber)'
	},
	feedback: {
		label: 'Feedback',
		dot: '◉',
		text: 'text-red',
		border: 'border-red',
		glow: 'var(--glow-red)'
	},
	ready: {
		label: 'Ready',
		dot: '●',
		text: 'text-green',
		border: 'border-green',
		glow: 'var(--glow-green)'
	},
	pr_created: {
		label: 'PR Created',
		dot: '◉',
		text: 'text-purple',
		border: 'border-purple',
		glow: 'var(--glow-purple)'
	},
	done: { label: 'Done', dot: '✓', text: 'text-secondary', border: 'border-secondary' }
};

export const PR_STATUS: Record<string, string> = {
	open: 'text-green border-green',
	merged: 'text-purple border-purple',
	closed: 'text-red border-red'
};
