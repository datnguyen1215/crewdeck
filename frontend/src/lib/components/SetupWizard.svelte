<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		listVCSAccounts,
		createEnvironmentVariable,
		type VCSAccount,
		type Project
	} from '$lib/api/http.js';
	import VCSConnect from './VCSConnect.svelte';
	import ProjectForm from './ProjectForm.svelte';
	import WizardStepIndicator from './WizardStepIndicator.svelte';
	import EnvVarsStep from './EnvVarsStep.svelte';

	let step = $state(1);
	let githubAccounts = $state<VCSAccount[]>([]);
	let loading = $state(true);
	let createdProject = $state<Project | null>(null);

	const totalSteps = 4;

	// --- Environment Variables (step 3) ---
	let envVars = $state<{ id: number; key: string; value: string; is_secret: boolean }[]>([]);
	let envIdCounter = $state(0);
	let savedEnvCount = $state(0);
	let envSaving = $state(false);
	let envError = $state('');

	// Runs once on mount — no reactive deps
	$effect(() => {
		listVCSAccounts()
			.then((data) => {
				githubAccounts = data;
				if (data.length > 0) step = 2;
			})
			.catch(() => {})
			.finally(() => { loading = false; });
	});

	function handleVCSConnected(account: VCSAccount) {
		githubAccounts = [...githubAccounts, account];
		step = 2;
	}

	function handleProjectCreated(project: Project) {
		createdProject = project;
		step = 3;
	}

	// --- Env var helpers ---

	function addEnvRow() {
		envVars = [...envVars, { id: ++envIdCounter, key: '', value: '', is_secret: false }];
	}

	function removeEnvRow(id: number) {
		envVars = envVars.filter((v) => v.id !== id);
	}

	async function saveEnvVars() {
		if (!createdProject) return;
		const valid = envVars.filter((v) => v.key.trim() && v.value.trim());
		if (valid.length === 0) {
			step = 4;
			return;
		}
		envSaving = true;
		envError = '';
		try {
			const results = await Promise.allSettled(
				valid.map((v) =>
					createEnvironmentVariable(createdProject!.id, {
						key: v.key.trim(),
						value: v.value.trim(),
						is_secret: v.is_secret
					})
				)
			);
			const succeededIds = new Set(
				valid.filter((_, i) => results[i].status === 'fulfilled').map((v) => v.id)
			);
			savedEnvCount += succeededIds.size;
			envVars = envVars.filter((v) => !succeededIds.has(v.id));
			const failed = results.filter((r) => r.status === 'rejected');
			if (failed.length > 0) {
				const reason = (failed[0] as PromiseRejectedResult).reason;
				envError = reason instanceof Error ? reason.message : 'Failed to save some environment variables';
			} else {
				step = 4;
			}
		} finally {
			envSaving = false;
		}
	}

	// --- Review & Launch ---

	function goToProject() {
		if (createdProject) goto(`/projects/${createdProject.id}`);
	}
</script>

<div class="flex flex-col items-center justify-center py-16 px-4" style="animation: fade-up 0.4s ease both">
	<!-- Step indicator -->
	<WizardStepIndicator {totalSteps} currentStep={step} />

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

				<VCSConnect onConnected={handleVCSConnected} inline />

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
					Point to a GitHub repository to create your first project.
				</p>

				<ProjectForm {githubAccounts} onCreated={handleProjectCreated} />
			</div>
		{:else if step === 3}
			<!-- Step 3: Environment Variables -->
			<EnvVarsStep
				bind:envVars
				{envSaving}
				{envError}
				onSave={saveEnvVars}
				onSkip={() => { step = 4; }}
				onAddRow={addEnvRow}
				onRemoveRow={removeEnvRow}
			/>
		{:else if step === 4}
			<!-- Step 4: Review & Launch -->
			<div style="animation: fade-up 0.25s ease both">
				<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
					Review & Launch
				</h2>
				<p class="text-muted text-xs mb-5">
					Your project is configured. Review the summary below.
				</p>

				<!-- Summary -->
				<div class="space-y-3 mb-6">
					<div class="flex justify-between text-sm">
						<span class="text-muted">Project</span>
						<span class="text-cyan">{createdProject?.name}</span>
					</div>
					<div class="flex justify-between text-sm">
						<span class="text-muted">Crew</span>
						<span class="text-primary">5 members</span>
					</div>
					<div class="flex justify-between text-sm">
						<span class="text-muted">Env Variables</span>
						<span class="text-primary">{savedEnvCount}</span>
					</div>
				</div>

				<!-- Actions -->
				<div class="space-y-3">
					<button
						onclick={goToProject}
						class="w-full px-4 py-2.5 bg-cyan/10 border border-cyan text-cyan rounded text-sm hover:bg-cyan/20 transition-colors uppercase tracking-wide"
						style="box-shadow: var(--glow-cyan)"
					>
						Go to Project
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
