import { listProjectsWithStats, type ProjectWithStats } from '$lib/api/http.js';
import { globalWs } from '$lib/api/global-ws.svelte.js';

const STATS_EVENTS = [
	'run.started', 'run.completed', 'issue.status_changed', 'issue.paused',
	'issue.resumed', 'issue.created', 'dispatch.queued', 'dispatch.dequeued',
	'project.created', 'project.deleted',
] as const;

class ProjectsStore {
	items = $state<ProjectWithStats[]>([]);
	loading = $state(true);
	#initialized = false;
	#unsubs: (() => void)[] = [];

	/** Call once from root layout to start fetching + subscribing to WS events. */
	init() {
		if (this.#initialized) return;
		this.#initialized = true;

		this.refresh();

		this.#unsubs = STATS_EVENTS.map((e) => globalWs.on(e, () => this.refresh()));

		// Re-fetch on WS reconnect to catch missed events
		$effect(() => {
			if (globalWs.state === 'connected') this.refresh();
		});
	}

	async refresh() {
		try {
			this.items = await listProjectsWithStats();
		} catch {
			// Silently fail — existing data stays
		} finally {
			this.loading = false;
		}
	}

	destroy() {
		this.#unsubs.forEach((fn) => fn());
		this.#unsubs = [];
		this.#initialized = false;
	}
}

export const projectsStore = new ProjectsStore();
