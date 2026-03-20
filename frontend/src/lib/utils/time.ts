/**
 * Parse a date string as UTC. SQLite CURRENT_TIMESTAMP produces "YYYY-MM-DD HH:MM:SS"
 * without a timezone indicator, which JS parses as local time. This normalizes it.
 */
export function parseUTC(dateStr: string): Date {
	if (dateStr.includes('Z') || dateStr.includes('+')) return new Date(dateStr);
	return new Date(dateStr.replace(' ', 'T') + 'Z');
}

/** Static relative time string — no live timer, just a snapshot. */
export function relTime(dateStr: string): string {
	const diff = Date.now() - parseUTC(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (mins > 0) return `${mins}m ago`;
	return 'just now';
}
