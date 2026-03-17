<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { listGitHubAccounts, type GitHubAccount, type Project } from '$lib/api/http.js';
	import GitHubConnect from './GitHubConnect.svelte';
	import ProjectForm from './ProjectForm.svelte';

	let step = $state(1);
	let githubAccounts = $state<GitHubAccount[]>([]);
	let loading = $state(true);
	let createdProject = $state<Project | null>(null);

	const totalSteps = 3;

	onMount(() => {
		listGitHubAccounts()
			.then((data) => {
				githubAccounts = data;
				// Skip GitHub connect step if accounts already exist
				if (data.length > 0) step = 2;
			})
			.catch(() => { /* dropdown will be empty */ })
			.finally(() => { loading = false; });
	});

	function handleGitHubConnected(account: GitHubAccount) {
		githubAccounts = [...githubAccounts, account];
		step = 2;
	}

	function handleProjectCreated(project: Project) {
		createdProject = project;
		step = 3;
	}

	function goToProject() {
		if (createdProject) goto(`/projects/${createdProject.id}`);
	}
</script>

<div class="flex flex-col items-center justify-center py-16 px-4" style="animation: fade-up 0.4s ease both">
	<!-- Step indicator -->
	<div class="flex items-center gap-2 mb-10">
		{#each Array(totalSteps) as _, i (i)}
			{@const stepNum = i + 1}
			<div class="flex items-center gap-2">
				<div
					class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors"
					class:bg-cyan={stepNum <= step}
					class:text-base={stepNum <= step}
					class:border-cyan={stepNum <= step}
					class:border-edge={stepNum > step}
					class:text-muted={stepNum > step}
				>
					{#if stepNum < step}
						&#10003;
					{:else}
						{stepNum}
					{/if}
				</div>
				{#if i < totalSteps - 1}
					<div
						class="w-12 h-px transition-colors"
						class:bg-cyan={stepNum < step}
						class:bg-edge={stepNum >= step}
					></div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Wizard card -->
	<div
		class="w-full max-w-md bg-surface border border-edge rounded-lg p-6"
		style="box-shadow: 0 0 40px rgba(0,0,0,0.4)"
	>
		{#if loading}
			<div class="flex flex-col items-center py-8">
				<span class="inline-block w-5 h-5 border-2 border-cyan border-t-transparent rounded-full animate-spin"></span>
			</div>
		{:else if step === 1}
			<!-- Step 1: Connect GitHub -->
			<div style="animation: fade-up 0.25s ease both">
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
					Connect GitHub
				</h2>
				<p class="text-muted text-xs mb-6">
					Link a GitHub account to access private repositories. You can skip this step and use host credentials instead.
				</p>

				<GitHubConnect onConnected={handleGitHubConnected} inline />

				<div class="mt-6 pt-4 border-t border-edge">
					<button
						onclick={() => { step = 2; }}
						class="w-full px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors"
					>
						Skip for now
					</button>
				</div>
			</div>
		{:else if step === 2}
			<!-- Step 2: Create Project -->
			<div style="animation: fade-up 0.25s ease both">
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
					Create Project
				</h2>
				<p class="text-muted text-xs mb-6">
					Point to a GitHub repository to create your first project. A captain agent will be auto-assigned.
				</p>

				<ProjectForm {githubAccounts} onCreated={handleProjectCreated} />
			</div>
		{:else if step === 3}
			<!-- Step 3: Done -->
			<div class="text-center py-4" style="animation: fade-up 0.25s ease both">
				<div class="text-3xl mb-4">&#10003;</div>
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-2">
					You're all set
				</h2>
				<p class="text-muted text-xs mb-6">
					Your project <span class="text-cyan">{createdProject?.name}</span> is ready with a captain agent assigned.
				</p>

				<button
					onclick={goToProject}
					class="w-full px-4 py-2.5 bg-cyan/10 border border-cyan text-cyan rounded text-sm hover:bg-cyan/20 transition-colors uppercase tracking-wide"
					style="box-shadow: var(--glow-cyan)"
				>
					Go to Project
				</button>

				<div class="mt-6 text-muted text-xs space-y-1">
					<p>Next steps: add agents, create issues, start the orchestrator</p>
				</div>
			</div>
		{/if}
	</div>
</div>
