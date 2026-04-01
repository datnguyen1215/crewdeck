export type ColumnConfig = {
	key: string;
	label: string;
	width: string;
	defaultVisible: boolean;
	locked: boolean;
};

export const COLUMN_CONFIG: ColumnConfig[] = [
	{ key: 'title', label: 'Title', width: '1fr', defaultVisible: true, locked: true },
	{ key: 'status', label: 'Status', width: '148px', defaultVisible: true, locked: false },
	{ key: 'agent', label: 'Agent', width: '96px', defaultVisible: true, locked: false },
	{ key: 'baseBranch', label: 'Base Branch', width: '100px', defaultVisible: false, locked: false },
	{ key: 'age', label: 'Age', width: '60px', defaultVisible: true, locked: false },
	{ key: 'updated', label: 'Updated', width: '70px', defaultVisible: false, locked: false },
	{ key: 'dispatch', label: '', width: '44px', defaultVisible: true, locked: true },
];

export const STORAGE_KEY = 'crewdeck:visibleColumns';
export const LEGACY_STORAGE_KEY = 'crewdeck:showBaseBranch';

/** Get default visible column keys */
export function getDefaultVisibleColumns(): string[] {
	return COLUMN_CONFIG.filter((c) => c.defaultVisible).map((c) => c.key);
}

/** Load visible columns from localStorage, migrating from legacy format if needed */
export function loadVisibleColumns(): string[] {
	if (typeof localStorage === 'undefined') return getDefaultVisibleColumns();

	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored) {
		try {
			const parsed = JSON.parse(stored) as string[];
			// Ensure locked columns are always included
			const lockedKeys = COLUMN_CONFIG.filter((c) => c.locked).map((c) => c.key);
			const validKeys = COLUMN_CONFIG.map((c) => c.key);
			const filtered = parsed.filter((k) => validKeys.includes(k));
			return [...new Set([...lockedKeys, ...filtered])];
		} catch {
			return getDefaultVisibleColumns();
		}
	}

	// Migrate from legacy showBaseBranch format
	const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);
	if (legacyValue !== null) {
		const defaults = getDefaultVisibleColumns();
		if (legacyValue === 'true' && !defaults.includes('baseBranch')) {
			defaults.push('baseBranch');
		}
		// Save migrated value and clean up legacy key
		localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
		localStorage.removeItem(LEGACY_STORAGE_KEY);
		return defaults;
	}

	return getDefaultVisibleColumns();
}

/** Save visible columns to localStorage */
export function saveVisibleColumns(columns: string[]): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
}

/** Compute grid-template-columns style from visible columns */
export function computeGridCols(visibleColumns: string[]): string {
	const widths = COLUMN_CONFIG.filter((c) => visibleColumns.includes(c.key)).map((c) => c.width);
	return widths.join(' ');
}
