/**
 * Parse a date string as UTC. SQLite CURRENT_TIMESTAMP produces "YYYY-MM-DD HH:MM:SS"
 * without a timezone indicator, which JS parses as local time. This normalizes it.
 */
export function parseUTC(dateStr: string | null | undefined): Date {
	if (!dateStr) return new Date(NaN);
	if (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr)) return new Date(dateStr);
	return new Date(dateStr.replace(' ', 'T') + 'Z');
}

/** Relative time diff without "ago" suffix — for compact displays. */
export function relTimeDiff(dateStr: string | null | undefined): string {
	const diff = Date.now() - parseUTC(dateStr).getTime();
	if (isNaN(diff)) return '—';
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	const weeks = Math.floor(days / 7);
	if (weeks > 0) return `${weeks}w`;
	if (days > 0) return `${days}d`;
	if (hours > 0) return `${hours}h`;
	return `${mins}m`;
}

/** Static relative time string — no live timer, just a snapshot. */
export function relTime(dateStr: string | null | undefined): string {
	const diff = Date.now() - parseUTC(dateStr).getTime();
	if (isNaN(diff)) return '—';
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (mins > 0) return `${mins}m ago`;
	return 'just now';
}

/**
 * Smart timestamp display with threshold-based formatting:
 * - < 24 hours: "5m ago" / "3h ago" (relative)
 * - < 7 days: "Mon 2:45 PM" (day + time)
 * - < 1 year: "Mar 28" (month + day)
 * - >= 1 year: "Mar 28, 2025" (include year)
 */
export function smartTime(dateStr: string | null | undefined): string {
	const date = parseUTC(dateStr);
	const diff = Date.now() - date.getTime();
	if (isNaN(diff)) return '—';

	const HOUR = 3_600_000;
	const DAY = 86_400_000;
	const YEAR = 365 * DAY;

	// < 24 hours: relative time
	if (diff < DAY) {
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / HOUR);
		if (hours > 0) return `${hours}h ago`;
		if (mins > 0) return `${mins}m ago`;
		return 'just now';
	}

	// < 7 days: weekday + time (e.g., "Mon 2:45 PM")
	if (diff < 7 * DAY) {
		return date.toLocaleString('en-US', {
			weekday: 'short',
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	// < 1 year: month + day (e.g., "Mar 28")
	if (diff < YEAR) {
		return date.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric'
		});
	}

	// >= 1 year: month + day + year (e.g., "Mar 28, 2025")
	return date.toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
}

/** Full datetime string for tooltip display */
export function fullTime(dateStr: string | null | undefined): string {
	const date = parseUTC(dateStr);
	if (isNaN(date.getTime())) return '';
	return date.toLocaleString();
}

/** Format as HH:MM:SS (24-hour) for chat message timestamps. */
export function formatTimestamp(dateStr: string | null | undefined): string {
	const date = parseUTC(dateStr);
	if (isNaN(date.getTime())) return '--:--:--';
	return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Format as HH:MM (24-hour) for terminal log entries. */
export function formatTime(dateStr: string | null | undefined): string {
	const date = parseUTC(dateStr);
	if (isNaN(date.getTime())) return '--:--';
	return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Compact smart timestamp without "ago" suffix for space-constrained UIs.
 * Same thresholds as smartTime but more compact format.
 */
export function smartTimeDiff(dateStr: string | null | undefined): string {
	const date = parseUTC(dateStr);
	const diff = Date.now() - date.getTime();
	if (isNaN(diff)) return '—';

	const HOUR = 3_600_000;
	const DAY = 86_400_000;
	const YEAR = 365 * DAY;

	// < 24 hours: compact relative time (e.g., "5m", "3h")
	if (diff < DAY) {
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / HOUR);
		if (hours > 0) return `${hours}h`;
		return `${mins}m`;
	}

	// < 7 days: weekday abbreviation (e.g., "Mon")
	if (diff < 7 * DAY) {
		return date.toLocaleString('en-US', { weekday: 'short' });
	}

	// < 1 year: month + day (e.g., "Mar 28")
	if (diff < YEAR) {
		return date.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric'
		});
	}

	// >= 1 year: month + day + year (e.g., "Mar 28, 2025")
	return date.toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
}
