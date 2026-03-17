<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		startDeviceFlow,
		pollDeviceFlow,
		type GitHubAccount
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	const { onConnected, inline = false }: {
		onConnected: (account: GitHubAccount) => void;
		inline?: boolean;
	} = $props();

	let deviceCode = $state('');
	let userCode = $state('');
	let verificationUri = $state('');
	let polling = $state(false);
	let pollInterval = 5;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let deviceFlowError = $state('');
	let started = $state(false);

	async function startFlow() {
		deviceFlowError = '';
		try {
			const res = await startDeviceFlow();
			deviceCode = res.device_code;
			userCode = res.user_code;
			verificationUri = res.verification_uri;
			pollInterval = res.interval || 5;
			started = true;
			startPolling();
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to start device flow', 'error');
		}
	}

	function startPolling() {
		polling = true;
		schedulePoll();
	}

	function schedulePoll() {
		pollTimer = setTimeout(async () => {
			if (!polling) return;
			try {
				const res = await pollDeviceFlow(deviceCode);
				if (res.id) {
					stopPolling();
					started = false;
					const account: GitHubAccount = {
						id: res.id,
						account_name: res.account_name!,
						github_username: res.github_username!,
						scopes: res.scopes ?? null,
						created_at: res.created_at!
					};
					toastStore.add(`Connected GitHub account: ${account.github_username}`, 'success');
					onConnected(account);
				} else if (res.error === 'slow_down') {
					pollInterval += 5;
					schedulePoll();
				} else if (res.error === 'expired_token') {
					stopPolling();
					deviceFlowError = 'Code expired. Please try again.';
				} else if (res.error === 'access_denied') {
					stopPolling();
					deviceFlowError = 'Authorization was denied.';
				} else {
					schedulePoll();
				}
			} catch {
				stopPolling();
				deviceFlowError = 'Polling failed. Please try again.';
			}
		}, pollInterval * 1000);
	}

	function stopPolling() {
		polling = false;
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	function reset() {
		stopPolling();
		started = false;
		deviceCode = '';
		userCode = '';
		verificationUri = '';
		deviceFlowError = '';
	}

	onDestroy(() => {
		stopPolling();
	});

	// Auto-start when inline (used in wizard)
	$effect(() => {
		if (inline && !started) startFlow();
	});
</script>

{#if !started && !inline}
	<!-- Trigger button (used in settings page) -->
	<button
		onclick={startFlow}
		class="px-3 py-1.5 bg-cyan/10 border border-cyan text-cyan text-xs font-medium rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide flex-shrink-0"
	>
		+ Connect GitHub Account
	</button>
{:else if started}
	{#if inline}
		<!-- Inline device flow UI (for wizard) -->
		{#if deviceFlowError}
			<div class="text-center py-4">
				<p class="text-red text-sm mb-4">{deviceFlowError}</p>
				<button
					onclick={() => { reset(); startFlow(); }}
					class="px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide"
				>
					Try Again
				</button>
			</div>
		{:else}
			<div class="text-center py-4">
				<p class="text-muted text-xs uppercase tracking-widest mb-3">
					Enter this code on GitHub
				</p>
				<p
					class="text-3xl font-mono font-bold text-primary tracking-[0.3em] bg-base border border-edge rounded px-4 py-3 inline-block select-all"
				>
					{userCode}
				</p>

				<div class="mt-5">
					<a
						href={verificationUri}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-block px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide"
					>
						Open GitHub
					</a>
				</div>

				<p class="text-muted text-xs mt-5">
					Copy the code above, then click "Open GitHub" to authorize.
				</p>

				{#if polling}
					<div class="flex items-center justify-center gap-2 mt-4 text-muted text-xs">
						<span class="inline-block w-3 h-3 border-2 border-cyan border-t-transparent rounded-full animate-spin"></span>
						Waiting for authorization...
					</div>
				{/if}
			</div>
		{/if}
	{:else}
		<!-- Modal device flow UI (for settings page) -->
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onclick={(e: MouseEvent) => { if (e.target === e.currentTarget) reset(); }}
			role="dialog"
			aria-modal="true"
			aria-label="Connect GitHub Account"
		>
			<div class="bg-surface border border-edge rounded w-full max-w-md mx-4 p-6 shadow-2xl">
				<div class="flex items-center justify-between mb-5">
					<h2 class="text-primary font-bold uppercase tracking-wide text-sm">
						Connect GitHub Account
					</h2>
					<button
						onclick={reset}
						class="text-muted hover:text-primary transition-colors text-xl leading-none"
						aria-label="Close"
					>
						&times;
					</button>
				</div>

				{#if deviceFlowError}
					<div class="text-center py-4">
						<p class="text-red text-sm mb-4">{deviceFlowError}</p>
						<button
							onclick={() => { reset(); startFlow(); }}
							class="px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide"
						>
							Try Again
						</button>
					</div>
				{:else}
					<div class="text-center py-4">
						<p class="text-muted text-xs uppercase tracking-widest mb-3">
							Enter this code on GitHub
						</p>
						<p
							class="text-3xl font-mono font-bold text-primary tracking-[0.3em] bg-base border border-edge rounded px-4 py-3 inline-block select-all"
						>
							{userCode}
						</p>

						<div class="mt-5">
							<a
								href={verificationUri}
								target="_blank"
								rel="noopener noreferrer"
								class="inline-block px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide"
							>
								Open GitHub
							</a>
						</div>

						<p class="text-muted text-xs mt-5">
							Copy the code above, then click "Open GitHub" to authorize.
						</p>

						{#if polling}
							<div class="flex items-center justify-center gap-2 mt-4 text-muted text-xs">
								<span class="inline-block w-3 h-3 border-2 border-cyan border-t-transparent rounded-full animate-spin"></span>
								Waiting for authorization...
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
