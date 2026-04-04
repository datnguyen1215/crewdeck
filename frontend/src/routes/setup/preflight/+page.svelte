<svelte:head>
	<title>Preflight Check - CrewDeck</title>
</svelte:head>

<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		getPreflightClaudeCli,
		getPreflightClaudeAuth,
		getPreflightZai,
		createGlobalEnvironmentVariable,
		completeSetup
	} from '$lib/api/http.js';

	type StepState = 'waiting' | 'checking' | 'passed' | 'failed' | 'skipped';

	interface Step {
		label: string;
		state: StepState;
		detail: string;
		error?: string;
	}

	let steps = $state<Step[]>([
		{ label: 'Claude CLI', state: 'waiting', detail: '' },
		{ label: 'Claude credentials', state: 'waiting', detail: '' },
		{ label: 'Z.AI API key', state: 'waiting', detail: '' }
	]);

	let zaiKey = $state('');
	let savingZai = $state(false);
	let navigating = $state(false);

	const allResolved = $derived(steps.every((s) => s.state !== 'waiting' && s.state !== 'checking'));
	const hasFailures = $derived(steps.some((s) => s.state === 'failed' || s.state === 'skipped'));

	function setStep(index: number, state: StepState, detail: string, error?: string) {
		steps[index] = { ...steps[index], state, detail, error };
	}

	async function runCliCheck() {
		setStep(0, 'checking', 'checking...');
		try {
			const res = await getPreflightClaudeCli();
			if (res.installed) {
				setStep(0, 'passed', `found (${res.version ?? 'unknown'})`);
			} else {
				setStep(0, 'failed', 'not found', 'Claude CLI not found on PATH');
			}
		} catch {
			setStep(0, 'failed', 'error', 'Failed to check Claude CLI');
		}
	}

	async function runAuthCheck() {
		setStep(1, 'checking', 'verifying...');
		try {
			const res = await getPreflightClaudeAuth();
			if (res.authenticated) {
				setStep(1, 'passed', 'authenticated');
			} else {
				setStep(1, 'failed', 'not authenticated', res.error ?? 'Authentication check failed');
			}
		} catch {
			setStep(1, 'failed', 'error', 'Failed to verify authentication');
		}
	}

	async function runZaiCheck() {
		setStep(2, 'checking', 'checking...');
		try {
			const res = await getPreflightZai();
			if (res.configured) {
				setStep(2, 'passed', `configured (${res.source ?? 'stored key'})`);
			} else {
				setStep(2, 'failed', 'not configured', 'GLM models will not be available');
			}
		} catch {
			setStep(2, 'failed', 'error', 'Failed to check Z.AI configuration');
		}
	}

	async function runChecks() {
		await runCliCheck();
		if (steps[0].state === 'passed') {
			await runAuthCheck();
		} else {
			setStep(1, 'skipped', 'skipped');
		}
		await runZaiCheck();
	}

	async function retryStep(index: number) {
		if (index === 0) {
			await runChecks();
		} else if (index === 1) {
			if (steps[0].state !== 'passed') await runCliCheck();
			if (steps[0].state === 'passed') await runAuthCheck();
			else setStep(1, 'skipped', 'skipped');
		} else if (index === 2) {
			await runZaiCheck();
		}
	}

	async function saveZaiKey() {
		if (!zaiKey.trim()) return;
		savingZai = true;
		try {
			await createGlobalEnvironmentVariable({
				key: 'ZAI_API_KEY',
				value: zaiKey.trim(),
				is_secret: true
			});
			zaiKey = '';
			await runZaiCheck();
		} catch {
			// On failure, re-check so the error state is shown
			await runZaiCheck();
		} finally {
			savingZai = false;
		}
	}

	function skipZai() {
		setStep(2, 'skipped', 'skipped');
	}

	async function handleContinue() {
		navigating = true;
		try {
			await completeSetup();
			goto('/dashboard');
		} catch {
			navigating = false;
		}
	}

	$effect(() => {
		// Run checks on mount (using onDestroy cleanup isn't needed for one-shot)
		runChecks();
	});
</script>

<div class="w-full max-w-md px-4">
	<div class="text-center mb-8">
		<span class="text-cyan font-bold uppercase tracking-widest text-lg">CrewDeck</span>
		<p class="text-secondary text-sm mt-2">Preflight Check</p>
	</div>

	<div class="border border-edge rounded bg-surface p-4">
		{#each steps as step, i}
			<div class="py-2">
				<!-- Step row -->
				<div class="flex items-center gap-2 text-sm">
					<!-- Icon -->
					{#if step.state === 'passed'}
						<span class="text-green w-4 text-center">✓</span>
					{:else if step.state === 'checking'}
						<span class="text-cyan w-4 text-center animate-spin">⟳</span>
					{:else if step.state === 'failed'}
						<span class="text-red w-4 text-center">✗</span>
					{:else if step.state === 'skipped'}
						<span class="text-muted w-4 text-center">—</span>
					{:else}
						<span class="text-muted w-4 text-center">○</span>
					{/if}

					<!-- Label -->
					<span class="text-primary whitespace-nowrap">{step.label}</span>

					<!-- Dotted leader -->
					<span class="flex-1 border-b border-dotted border-edge mx-1"></span>

					<!-- Status -->
					<span
						class="text-xs whitespace-nowrap {step.state === 'passed'
							? 'text-green'
							: step.state === 'checking'
								? 'text-cyan'
								: step.state === 'failed'
									? 'text-red'
									: step.state === 'skipped'
										? 'text-muted'
										: 'text-muted'}"
					>
						{#if step.state === 'waiting'}
							waiting
						{:else if step.state === 'checking'}
							{step.detail}
						{:else}
							{step.detail}
						{/if}
					</span>
				</div>

				<!-- Failure details -->
				{#if step.state === 'failed'}
					<div class="ml-6 mt-1.5 space-y-1.5">
						<p class="text-red text-xs">{step.error}</p>

						{#if i === 0}
							<p class="text-muted text-xs">
								Install Claude Code:
								<code class="text-secondary bg-base-hi px-1 rounded text-xs"
									>npm install -g @anthropic-ai/claude-code</code
								>
							</p>
							<button
								onclick={() => retryStep(0)}
								class="text-xs text-cyan hover:brightness-125 transition-colors"
							>
								Retry
							</button>
						{:else if i === 1}
							<p class="text-muted text-xs">
								Run
								<code class="text-secondary bg-base-hi px-1 rounded text-xs">claude login</code>
								in your terminal to authenticate
							</p>
							<button
								onclick={() => retryStep(1)}
								class="text-xs text-cyan hover:brightness-125 transition-colors"
							>
								Retry
							</button>
						{:else if i === 2}
							{#if step.state === 'failed'}
								<div class="flex gap-2 items-center mt-2">
									<input
										type="password"
										bind:value={zaiKey}
										placeholder="Z.AI API key"
										disabled={savingZai}
										class="flex-1 bg-base border border-edge rounded px-2 py-1 text-xs text-primary placeholder:text-muted focus:border-cyan focus:outline-none transition-colors"
									/>
									<button
										onclick={saveZaiKey}
										disabled={savingZai || !zaiKey.trim()}
										class="text-xs bg-cyan text-base font-bold px-2.5 py-1 rounded hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
									>
										{savingZai ? '...' : 'Save'}
									</button>
								</div>
								<button
									onclick={skipZai}
									class="text-xs text-muted hover:text-secondary transition-colors"
								>
									Skip
								</button>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			{#if i < steps.length - 1}
				<hr class="border-edge border-t" />
			{/if}
		{/each}

		<!-- Summary and continue -->
		{#if allResolved}
			<hr class="border-edge border-t my-2" />
			<div class="flex items-center justify-between mt-2">
				<p class="text-sm {hasFailures ? 'text-amber' : 'text-green'}">
					{hasFailures ? 'Ready with warnings.' : 'Ready to go.'}
				</p>
				<button
					onclick={handleContinue}
					disabled={navigating}
					class="text-sm bg-cyan text-base font-bold px-4 py-1.5 rounded hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
				>
					{#if navigating}
						...
					{:else}
						Continue →
					{/if}
				</button>
			</div>
		{/if}
	</div>
</div>
