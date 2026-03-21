<script lang="ts">
	import {
		listGitHubAccounts,
		deleteGitHubAccount,
		type GitHubAccount
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import GitHubConnect from '$lib/components/GitHubConnect.svelte';

	let accounts = $state<GitHubAccount[]>([]);
	let loading = $state(true);

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

	function handleConnected(account: GitHubAccount) {
		accounts = [...accounts, account];
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
		if (e.key === 'Escape' && deletingId) deletingId = null;
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Settings - CrewDeck</title>
</svelte:head>

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

		<GitHubConnect onConnected={handleConnected} />
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
			<GitHubConnect onConnected={handleConnected} />
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
