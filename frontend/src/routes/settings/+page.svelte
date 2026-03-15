<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		listGitHubAccounts,
		startDeviceFlow,
		pollDeviceFlow,
		deleteGitHubAccount,
		type GitHubAccount
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let accounts = $state<GitHubAccount[]>([]);
	let loading = $state(true);

	// Device Flow modal state
	let showDeviceFlow = $state(false);
	let deviceCode = $state('');
	let userCode = $state('');
	let verificationUri = $state('');
	let polling = $state(false);
	let pollInterval = $state(5);
	let pollTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let deviceFlowError = $state('');

	// Delete confirmation
	let deletingId = $state<string | null>(null);

	$effect(() => {
		loadAccounts();
	});

	async function loadAccounts() {
		try {
			accounts = await listGitHubAccounts();
		} catch {
			toastStore.add('Failed to load GitHub accounts', 'error');
		} finally {
			loading = false;
		}
	}

	async function startFlow() {
		deviceFlowError = '';
		try {
			const res = await startDeviceFlow();
			deviceCode = res.device_code;
			userCode = res.user_code;
			verificationUri = res.verification_uri;
			pollInterval = res.interval || 5;
			showDeviceFlow = true;
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
					showDeviceFlow = false;
					toastStore.add(`Connected GitHub account: ${res.github_username}`, 'success');
					await loadAccounts();
				} else if (res.error === 'slow_down') {
					// RFC 8628: increase interval by 5 seconds
					pollInterval += 5;
					schedulePoll();
				} else if (res.error === 'expired_token') {
					stopPolling();
					deviceFlowError = 'Code expired. Please try again.';
				} else if (res.error === 'access_denied') {
					stopPolling();
					deviceFlowError = 'Authorization was denied.';
				} else {
					// 'authorization_pending' — keep polling at current interval
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

	function closeDeviceFlow() {
		stopPolling();
		showDeviceFlow = false;
		deviceCode = '';
		userCode = '';
		verificationUri = '';
		deviceFlowError = '';
	}

	async function confirmDelete(id: string) {
		try {
			await deleteGitHubAccount(id);
			accounts = accounts.filter((a) => a.id !== id);
			toastStore.add('GitHub account disconnected', 'success');
		} catch {
			toastStore.add('Failed to disconnect account', 'error');
		} finally {
			deletingId = null;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (showDeviceFlow) closeDeviceFlow();
			if (deletingId) deletingId = null;
		}
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	onDestroy(() => {
		stopPolling();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="p-6 h-full overflow-auto">
	<!-- Header -->
	<div class="flex items-start justify-between mb-8">
		<div>
			<h1 class="text-xs text-muted uppercase tracking-widest mb-1">Settings</h1>
			<p class="text-xl font-bold text-primary">GitHub Accounts</p>
			<p class="text-muted text-xs mt-1">
				{accounts.length} account{accounts.length !== 1 ? 's' : ''} connected
			</p>
		</div>

		<button
			onclick={startFlow}
			class="px-3 py-1.5 bg-cyan/10 border border-cyan text-cyan text-xs font-medium rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide flex-shrink-0"
		>
			+ Connect GitHub Account
		</button>
	</div>

	<!-- Account List -->
	{#if loading}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
			{#each Array(3) as _, i}
				<div
					class="flex flex-col p-4 bg-surface border border-edge rounded fade-up"
					style="animation-delay: {i * 50}ms"
				>
					<div class="skeleton h-4 w-3/5 rounded mb-2"></div>
					<div class="skeleton h-3 w-2/5 rounded mb-3"></div>
					<div class="skeleton h-3 w-4/5 rounded mb-3"></div>
					<div class="skeleton h-7 w-24 rounded mt-auto"></div>
				</div>
			{/each}
		</div>
	{:else if accounts.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<p class="text-primary text-lg font-semibold mb-1">No GitHub accounts connected</p>
			<p class="text-muted text-sm mb-6">Connect a GitHub account to enable repository access</p>
			<button
				onclick={startFlow}
				class="px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide"
			>
				+ Connect GitHub Account
			</button>
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
			{#each accounts as account, i (account.id)}
				<div
					class="flex flex-col p-4 bg-surface border border-edge rounded hover:-translate-y-0.5 transition-all duration-200 fade-up"
					style="animation-delay: {i * 50}ms"
				>
					<!-- Username -->
					<div class="mb-3">
						<h2 class="text-primary font-semibold truncate">{account.github_username}</h2>
						{#if account.account_name !== account.github_username}
							<p class="text-cyan text-xs mt-0.5 truncate">{account.account_name}</p>
						{/if}
					</div>

					<!-- Scopes -->
					{#if account.scopes}
						<div class="flex flex-wrap gap-1 mb-3">
							{#each account.scopes.split(',') as scope (scope)}
								<span
									class="text-xs px-1.5 py-0.5 rounded border border-edge text-muted"
								>
									{scope.trim()}
								</span>
							{/each}
						</div>
					{/if}

					<!-- Connected date -->
					<p class="text-muted text-xs mt-auto pt-3 border-t border-edge">
						Connected {formatDate(account.created_at)}
					</p>

					<!-- Actions -->
					<div class="mt-3 pt-3 border-t border-edge">
						{#if deletingId === account.id}
							<div class="flex gap-2">
								<button
									onclick={() => confirmDelete(account.id)}
									class="flex-1 py-1 text-xs text-red bg-red/10 border border-red/50 rounded hover:bg-red/20 transition-colors uppercase tracking-wide"
								>
									Confirm
								</button>
								<button
									onclick={() => (deletingId = null)}
									class="flex-1 py-1 text-xs text-secondary border border-edge rounded hover:border-edge-hi transition-colors"
								>
									Cancel
								</button>
							</div>
						{:else}
							<button
								onclick={() => (deletingId = account.id)}
								class="w-full py-1 text-xs text-red/70 border border-edge rounded hover:border-red/50 hover:text-red transition-colors"
							>
								Disconnect
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Device Flow Modal -->
{#if showDeviceFlow}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => e.target === e.currentTarget && closeDeviceFlow()}
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
					onclick={closeDeviceFlow}
					class="text-muted hover:text-primary transition-colors text-xl leading-none"
					aria-label="Close"
				>
					&times;
				</button>
			</div>

			{#if deviceFlowError}
				<!-- Error state -->
				<div class="text-center py-4">
					<p class="text-red text-sm mb-4">{deviceFlowError}</p>
					<button
						onclick={() => { closeDeviceFlow(); startFlow(); }}
						class="px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide"
					>
						Try Again
					</button>
				</div>
			{:else}
				<!-- Device code display -->
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
