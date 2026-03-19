<script lang="ts">
	import { listProjectsWithStats, listGitHubAccounts, type ProjectWithStats, type GitHubAccount, type Project } from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import SetupWizard from '$lib/components/SetupWizard.svelte';
	import ProjectForm from '$lib/components/ProjectForm.svelte';
	import Modal from '$lib/components/Modal.svelte';

	let projects = $state<ProjectWithStats[]>([]);
	let loading = $state(true);
	let githubAccounts = $state<GitHubAccount[]>([]);

	// Modal state
	let showModal = $state(false);

	$effect(() => {
		listProjectsWithStats()
			.then((data) => { projects = data; })
			.catch(() => { toastStore.add('Failed to load projects', 'error'); })
			.finally(() => { loading = false; });
	});

	// Only fetch accounts when projects exist (for the modal form).
	// When projects.length === 0 the wizard manages its own account list.
	$effect(() => {
		if (projects.length > 0) {
			listGitHubAccounts()
				.then((data) => { githubAccounts = data; })
				.catch(() => { /* silently fail — dropdown will just be empty */ });
		}
	});

	function handleProjectCreated(project: Project) {
		projects = [
			...projects,
			{
				...project,
				repo_count: 1,
				agent_count: 1,
				issues: { open: 0, in_progress: 0, in_review: 0, ready: 0, done: 0 },
				orchestrator_status: 'none'
			}
		];
		closeModal();
	}

	function closeModal() {
		showModal = false;
	}

	const ISSUE_STATUSES = [
		{ key: 'open', label: 'Op', color: 'bg-blue' },
		{ key: 'in_progress', label: 'IP', color: 'bg-amber' },
		{ key: 'in_review', label: 'IR', color: 'bg-purple' },
		{ key: 'ready', label: 'Rd', color: 'bg-green' },
		{ key: 'done', label: 'Dn', color: 'bg-secondary' }
	] as const;

	// Decision: only the 5 tracked statuses (open, in_progress, in_review, ready, done) are
	// counted here. Other statuses (e.g. draft, feedback, pr_created) are not included in
	// issueBreakdown by listProjectsWithStats(), so they don't appear in this total either.
	// This is intentional — the dashboard only surfaces the operational pipeline view.
	function totalIssues(issues: ProjectWithStats['issues']) {
		return Object.values(issues).reduce((a, b) => a + b, 0);
	}

	/** Setup completeness: count how many key milestones are done. */
	function setupProgress(project: ProjectWithStats): { done: number; total: number; label: string } {
		const checks = [
			project.repo_count > 0,       // has a repo
			project.agent_count > 1,       // has agents beyond captain
			project.orchestrator_status === 'active' || project.orchestrator_status === 'idle',
		];
		const done = checks.filter(Boolean).length;
		const total = checks.length;
		if (done === total) return { done, total, label: 'Ready' };
		return { done, total, label: `${done}/${total} setup` };
	}
</script>

<div class="p-8 h-full overflow-auto">
	<!-- Header -->
	<div class="flex items-center justify-between mb-10 fade-up">
		<div>
			<h1
				class="text-2xl font-bold tracking-[0.3em] uppercase"
				style="color: var(--color-cyan); text-shadow: var(--glow-cyan)"
			>
				CREWDECK
			</h1>
			<p class="text-muted text-xs mt-1 tracking-widest uppercase">AI Agent Crew Management</p>
		</div>
		{#if projects.length > 0}
			<button
				onclick={() => (showModal = true)}
				class="flex items-center gap-2 px-4 py-2 bg-surface border border-edge rounded text-sm text-secondary hover:text-cyan hover:border-cyan transition-colors"
				style="hover:box-shadow: var(--glow-cyan)"
			>
				<span class="text-cyan font-bold">+</span>
				New Project
			</button>
		{/if}
	</div>

	{#if loading}
		<!-- Skeleton grid while projects load -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each Array(6) as _, i}
				<div
					class="bg-surface border border-edge rounded-lg p-5 flex flex-col gap-4 fade-up"
					style="animation-delay: {i * 40}ms"
				>
					<div>
						<div class="skeleton h-4 w-3/5 rounded mb-2"></div>
						<div class="skeleton h-3 w-2/5 rounded"></div>
					</div>
					<div class="flex gap-4">
						<div class="skeleton h-3 w-16 rounded"></div>
						<div class="skeleton h-3 w-16 rounded"></div>
					</div>
					<div>
						<div class="skeleton h-1.5 w-full rounded-full mb-2"></div>
						<div class="flex gap-2">
							{#each Array(5) as _}
								<div class="skeleton h-3 w-8 rounded"></div>
							{/each}
						</div>
					</div>
					<div class="skeleton h-8 w-full rounded mt-auto"></div>
				</div>
			{/each}
		</div>
	{:else if projects.length === 0}
		<!-- Setup wizard for first-time users -->
		<SetupWizard />
	{:else}
		<!-- Project grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each projects as project, i (project.id)}
				{@const total = totalIssues(project.issues)}
				{@const setup = setupProgress(project)}
				<div
					class="project-card group relative bg-surface border border-edge rounded-lg p-5 flex flex-col gap-4
						hover:border-edge-hi hover:-translate-y-0.5 transition-all duration-200"
					style="animation: fade-up 0.35s ease both; animation-delay: {i * 60}ms"
				>
					<!-- Card header -->
					<div>
						<h2 class="text-primary font-bold text-base group-hover:text-cyan transition-colors">
							{project.name}
						</h2>
						{#if project.description}
							<p class="text-secondary text-xs mt-1 line-clamp-1">{project.description}</p>
						{:else}
							<p class="text-muted text-xs mt-1 italic">No description</p>
						{/if}
					</div>

					<!-- Stats row -->
					<div class="flex gap-4 text-xs text-secondary">
						<span>
							<span class="text-muted">repos</span>
							<span class="text-primary ml-1">{project.repo_count}</span>
						</span>
						<span>
							<span class="text-muted">agents</span>
							<span class="text-primary ml-1">{project.agent_count}</span>
						</span>
						{#if setup.done < setup.total}
							<span class="ml-auto">
								<span class="text-amber text-xs">{setup.label}</span>
							</span>
						{/if}
					</div>

					<!-- Issue breakdown -->
					<div>
						<p class="text-muted text-xs uppercase tracking-widest mb-2">Issues</p>
						{#if total === 0}
							<p class="text-muted text-xs">—</p>
						{:else}
							<!-- Mini bar chart -->
							<div class="flex h-1.5 rounded-full overflow-hidden gap-px mb-2">
								{#each ISSUE_STATUSES as s}
									{@const count = project.issues[s.key]}
									{#if count > 0}
										<div
											class="{s.color} rounded-full"
											style="flex: {count}"
											title="{s.label}: {count}"
										></div>
									{/if}
								{/each}
							</div>
							<!-- Count labels -->
							<div class="flex gap-2">
								{#each ISSUE_STATUSES as s}
									{@const count = project.issues[s.key]}
									<span class="text-xs text-muted">
										<span class={count > 0 ? 'text-primary' : ''}>{count}</span>
										<span class="text-muted">{s.label}</span>
									</span>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Orchestrator + concurrency -->
					<div class="flex items-center justify-between text-xs border-t border-edge pt-3">
						<div class="flex items-center gap-2">
							{#if project.orchestrator_status === 'active'}
								<span class="relative flex h-2 w-2 flex-shrink-0">
									<span
										class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75"
									></span>
									<span class="relative inline-flex h-2 w-2 rounded-full bg-green"></span>
								</span>
								<span class="text-green">Orchestrator Active</span>
							{:else if project.orchestrator_status === 'error'}
								<span class="h-2 w-2 rounded-full bg-red flex-shrink-0"></span>
								<span class="text-red">Orchestrator Error</span>
							{:else if project.orchestrator_status === 'idle'}
								<span class="h-2 w-2 rounded-full bg-muted flex-shrink-0"></span>
								<span class="text-muted">Orchestrator Idle</span>
							{:else}
								<span class="h-2 w-2 rounded-full bg-edge flex-shrink-0"></span>
								<span class="text-muted">No Orchestrator</span>
							{/if}
						</div>
						<span class="text-muted">
							<span class="text-secondary">{project.issues.in_progress}</span>/{project.max_concurrency}
							<span class="text-muted ml-1">conc</span>
						</span>
					</div>

					<!-- Enter project link -->
					<a
						href="/projects/{project.id}"
						class="mt-auto flex items-center justify-between px-3 py-2 bg-base-hi border border-edge rounded text-xs text-secondary
							hover:border-cyan hover:text-cyan transition-colors group/btn"
					>
						<span>Enter Project</span>
						<span class="group-hover/btn:translate-x-0.5 transition-transform">→</span>
					</a>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- New Project Modal -->
<Modal open={showModal} onClose={closeModal} label="Create new project" maxWidth="max-w-md">
	<div class="flex items-center justify-between mb-6">
		<h2 class="text-primary font-bold tracking-wide uppercase text-sm">New Project</h2>
		<button
			onclick={closeModal}
			class="text-muted hover:text-primary transition-colors text-lg leading-none"
			aria-label="Close"
		>
			✕
		</button>
	</div>

	<ProjectForm {githubAccounts} onCreated={handleProjectCreated} onCancel={closeModal} />
</Modal>

<style>
	.project-card {
		transition:
			transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
			border-color 150ms ease,
			box-shadow 200ms ease;
	}

	.project-card:hover {
		box-shadow:
			0 4px 24px rgba(34, 211, 238, 0.08),
			0 0 0 1px rgba(34, 211, 238, 0.1);
	}
</style>
