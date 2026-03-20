export type StatusConfig = {
	label: string;
	dot: string;
	text: string;
	border: string;
	glow?: string;
	pulse?: boolean;
};

export const STATUS_CFG: Record<string, StatusConfig> = {
	open: { label: 'Open', dot: '○', text: 'text-blue', border: 'border-blue', glow: 'var(--glow-blue)' },
	in_progress: {
		label: 'In Progress',
		dot: '◉',
		text: 'text-green',
		border: 'border-green',
		glow: 'var(--glow-green)',
		pulse: true
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
