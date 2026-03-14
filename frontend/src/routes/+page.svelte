<script lang="ts">
	import { listProjectsWithStats, createProject } from '$lib/mock/api.js';

	type ProjectWithStats = Awaited<ReturnType<typeof listProjectsWithStats>>[number];

	let projects = $state<ProjectWithStats[]>([]);
	let loading = $state(true);

	// Modal state
	let showModal = $state(false);
	let name = $state('');
	let description = $state('');
	let maxConcurrency = $state(1);
	let maxReviewRounds = $state(3);
	let githubUrl = $state('');
	let localPath = $state('');
	let defaultBranch = $state('main');
	let submitting = $state(false);
	let nameError = $state('');
	let githubUrlError = $state('');
	let localPathError = $state('');

	$effect(() => {
		listProjectsWithStats().then((data) => {
			projects = data;
			loading = false;
		});
	});

	async function submitProject() {
		nameError = '';
		githubUrlError = '';
		localPathError = '';

		let hasError = false;
		if (!name.trim()) {
			nameError = 'Name is required';
			hasError = true;
		}
		if (!githubUrl.trim()) {
			githubUrlError = 'GitHub URL is required';
			hasError = true;
		}
		if (!localPath.trim()) {
			localPathError = 'Local path is required';
			hasError = true;
		}
		if (hasError) return;

		if (maxConcurrency < 1) maxConcurrency = 1;
		if (maxReviewRounds < 1) maxReviewRounds = 1;

		submitting = true;
		try {
			const project = await createProject({
				name: name.trim(),
				description: description.trim() || null,
				max_concurrency: maxConcurrency,
				max_review_rounds: maxReviewRounds,
				github_url: githubUrl.trim(),
				local_path: localPath.trim(),
				default_branch: defaultBranch.trim() || 'main'
			});
			// Optimistic update: repo was created inline, so repo_count starts at 1.
			projects = [
				...projects,
				{
					...project,
					repo_count: 1,
					agent_count: 0,
					issues: { open: 0, in_progress: 0, in_review: 0, ready: 0, done: 0 },
					orchestrator_status: 'none'
				}
			];
			closeModal();
		} finally {
			submitting = false;
		}
	}

	function closeModal() {
		if (submitting) return;
		showModal = false;
		name = '';
		description = '';
		githubUrl = '';
		localPath = '';
		defaultBranch = 'main';
		maxConcurrency = 1;
		maxReviewRounds = 3;
		nameError = '';
		githubUrlError = '';
		localPathError = '';
	}

	function handleModalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') closeModal();
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
</script>

<svelte:window onkeydown={handleModalKeydown} />

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
		<button
			onclick={() => (showModal = true)}
			class="flex items-center gap-2 px-4 py-2 bg-surface border border-edge rounded text-sm text-secondary hover:text-cyan hover:border-cyan transition-colors"
			style="hover:box-shadow: var(--glow-cyan)"
		>
			<span class="text-cyan font-bold">+</span>
			New Project
		</button>
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
		<!-- Empty state -->
		<div
			class="flex flex-col items-center justify-center py-24 text-center"
			style="animation: fade-up 0.4s ease both"
		>
			<div
				class="text-muted text-xs tracking-[0.4em] uppercase mb-6 border border-edge rounded px-4 py-2"
			>
				~/projects $<span class="animate-pulse">_</span>
			</div>
			<p class="text-primary text-lg font-semibold mb-2">No projects yet</p>
			<p class="text-secondary text-sm mb-8 max-w-sm">
				Create your first project to start managing AI agent crews
			</p>
			<button
				onclick={() => (showModal = true)}
				class="px-6 py-2.5 bg-surface border border-cyan text-cyan rounded text-sm hover:bg-surface-hi transition-colors"
				style="box-shadow: var(--glow-cyan)"
			>
				+ Create Project
			</button>
		</div>
	{:else}
		<!-- Project grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each projects as project, i (project.id)}
				{@const total = totalIssues(project.issues)}
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
{#if showModal}
	<!-- Backdrop -->
	<!-- Decision: clicking backdrop closes modal for standard UX -->
	<!-- eslint-disable-next-line svelte/valid-compile -->
	<div
		class="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Create new project"
	>
		<!-- Click outside to close -->
		<button
			class="absolute inset-0 w-full h-full cursor-default"
			aria-label="Close modal"
			onclick={closeModal}
		></button>

		<div
			class="relative z-50 w-full max-w-md bg-surface border border-edge rounded-lg p-6"
			style="animation: fade-up 0.2s ease both; box-shadow: 0 0 40px rgba(0,0,0,0.6)"
		>
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

			<form
				onsubmit={(e) => {
					e.preventDefault();
					submitProject();
				}}
				class="flex flex-col gap-4"
			>
				<!-- Name -->
				<div>
					<label for="proj-name" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Name <span class="text-red">*</span>
					</label>
					<input
						id="proj-name"
						type="text"
						bind:value={name}
						placeholder="My Project"
						class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted
							focus:outline-none focus:border-cyan transition-colors"
						class:border-red={nameError}
					/>
					{#if nameError}
						<p class="text-red text-xs mt-1">{nameError}</p>
					{/if}
				</div>

				<!-- Description -->
				<div>
					<label for="proj-desc" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						Description
					</label>
					<textarea
						id="proj-desc"
						bind:value={description}
						placeholder="Optional description..."
						rows="3"
						class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted
							focus:outline-none focus:border-cyan transition-colors resize-none"
					></textarea>
				</div>

				<!-- Repository -->
				<div>
					<label for="proj-github-url" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
						GitHub URL <span class="text-red">*</span>
					</label>
					<input
						id="proj-github-url"
						type="text"
						bind:value={githubUrl}
						placeholder="https://github.com/owner/repo"
						class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted
							focus:outline-none focus:border-cyan transition-colors"
						class:border-red={githubUrlError}
					/>
					{#if githubUrlError}
						<p class="text-red text-xs mt-1">{githubUrlError}</p>
					{/if}
				</div>

				<div class="flex gap-4">
					<div class="flex-1">
						<label for="proj-local-path" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
							Local Path <span class="text-red">*</span>
						</label>
						<input
							id="proj-local-path"
							type="text"
							bind:value={localPath}
							placeholder="/home/user/projects/repo"
							class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted
								focus:outline-none focus:border-cyan transition-colors"
							class:border-red={localPathError}
						/>
						{#if localPathError}
							<p class="text-red text-xs mt-1">{localPathError}</p>
						{/if}
					</div>
					<div class="w-32">
						<label for="proj-default-branch" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
							Branch
						</label>
						<input
							id="proj-default-branch"
							type="text"
							bind:value={defaultBranch}
							placeholder="main"
							class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted
								focus:outline-none focus:border-cyan transition-colors"
						/>
					</div>
				</div>

				<!-- Max Concurrency + Max Review Rounds -->
				<div class="flex gap-4">
					<div class="flex-1">
						<label
							for="proj-concurrency"
							class="block text-xs text-muted uppercase tracking-widest mb-1.5"
						>
							Max Concurrency
						</label>
						<input
							id="proj-concurrency"
							type="number"
							bind:value={maxConcurrency}
							min="1"
							class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary
								focus:outline-none focus:border-cyan transition-colors"
						/>
					</div>
					<div class="flex-1">
						<label
							for="proj-review-rounds"
							class="block text-xs text-muted uppercase tracking-widest mb-1.5"
						>
							Max Review Rounds
						</label>
						<input
							id="proj-review-rounds"
							type="number"
							bind:value={maxReviewRounds}
							min="1"
							class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary
								focus:outline-none focus:border-cyan transition-colors"
						/>
					</div>
				</div>

				<!-- Actions -->
				<div class="flex gap-3 mt-2">
					<button
						type="button"
						onclick={closeModal}
						disabled={submitting}
						class="flex-1 px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={submitting}
						class="flex-1 px-4 py-2 bg-cyan/10 border border-cyan rounded text-sm text-cyan
							hover:bg-cyan/20 transition-colors disabled:opacity-50"
					>
						{submitting ? 'Creating...' : 'Create Project'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

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
