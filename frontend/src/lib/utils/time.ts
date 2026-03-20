/**
 * Time utilities for normalizing SQLite UTC timestamps
 * and computing relative time strings.
 */

/**
 * Normalizes a SQLite timestamp for correct UTC parsing.
 * SQLite's CURRENT_TIMESTAMP produces "YYYY-MM-DD HH:MM:SS" without timezone,
 * which JS Date() interprets as local time. Appending "Z" forces UTC.
 * @param {string | null | undefined} dateStr - raw timestamp from SQLite
 * @returns {Date} correctly parsed UTC date
 */
export const parseUTC = (dateStr: string | null | undefined): Date => {
	if (!dateStr) return new Date();
	const s = dateStr.trim();
	// Already has timezone info — parse as-is
	if (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s))
		return new Date(s);
	return new Date(s + 'Z');
};

/**
 * Static relative time string — no live timer, just a snapshot.
 * @param {string | null | undefined} dateStr - raw timestamp
 * @returns {string} e.g. "3d ago", "2h ago", "5m ago", "just now"
 */
export const relTime = (dateStr: string | null | undefined): string => {
	if (!dateStr) return '';
	const diff = Date.now() - parseUTC(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (mins > 0) return `${mins}m ago`;
	return 'just now';
};

/**
 * Compact relative time without "ago" suffix, includes weeks.
 * @param {string | null | undefined} dateStr - raw timestamp
 * @returns {string} e.g. "3w", "2d", "5h", "1m"
 */
export const relTimeDiff = (dateStr: string | null | undefined): string => {
	if (!dateStr) return '';
	const diff = Date.now() - parseUTC(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	const weeks = Math.floor(days / 7);
	if (weeks > 0) return `${weeks}w`;
	if (days > 0) return `${days}d`;
	if (hours > 0) return `${hours}h`;
	return `${mins}m`;
};
