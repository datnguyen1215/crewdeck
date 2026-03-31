<script lang="ts">
	import { untrack } from 'svelte';
	import {
		createVCSAccount,
		type VCSAccount
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	const { onConnected, inline = false }: {
		onConnected: (account: VCSAccount) => void;
		inline?: boolean;
	} = $props();

	let showForm = $state(untrack(() => inline));
	let submitting = $state(false);
	let githubUsername = $state('');
	let ghToken = $state('');
	let sshPrivateKey = $state('');

	function reset() {
		showForm = untrack(() => inline);
		githubUsername = '';
		ghToken = '';
		sshPrivateKey = '';
		submitting = false;
	}

	async function handleSubmit() {
		submitting = true;
		try {
			const account = await createVCSAccount({
				account_name: githubUsername,
				username: githubUsername,
				token: ghToken,
				ssh_private_key: sshPrivateKey,
			});
			toastStore.add(`Connected GitHub account: ${account.username}`, 'success');
			reset();
			onConnected(account);
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Failed to add account', 'error');
		} finally {
			submitting = false;
		}
	}

	const canSubmit = $derived(!!githubUsername && !!ghToken && !!sshPrivateKey && !submitting);
</script>

{#if !showForm && !inline}
	<button
		onclick={() => (showForm = true)}
		class="px-3 py-1.5 bg-cyan/10 border border-cyan text-cyan text-xs font-medium rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide flex-shrink-0"
	>
		+ Add GitHub Account
	</button>
{:else if showForm && !inline}
	<!-- Modal form (settings page) -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) reset(); }}
		onkeydown={(e) => e.key === 'Escape' && reset()}
		role="dialog"
		aria-modal="true"
		aria-label="Add GitHub Account"
		tabindex="-1"
	>
		<div class="bg-surface border border-edge rounded w-full max-w-md mx-4 p-6 shadow-2xl">
			<div class="flex items-center justify-between mb-5">
				<h2 class="text-primary font-bold uppercase tracking-wide text-sm">
					Add GitHub Account
				</h2>
				<button
					onclick={reset}
					class="text-muted hover:text-primary transition-colors text-xl leading-none"
					aria-label="Close"
				>
					&times;
				</button>
			</div>
			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-3">
				<div>
					<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="gh-username">GitHub Username</label>
					<input id="gh-username" type="text" bind:value={githubUsername} placeholder="octocat" required class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors" />
				</div>
				<div>
					<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="gh-token">Personal Access Token</label>
					<input id="gh-token" type="password" bind:value={ghToken} placeholder="ghp_..." required class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors font-mono" />
					<p class="text-muted text-xs mt-1">Needs <code class="text-secondary">repo</code> and <code class="text-secondary">workflow</code> scopes</p>
				</div>
				<div>
					<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="ssh-key">SSH Private Key</label>
					<textarea id="ssh-key" bind:value={sshPrivateKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" required rows="4" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors font-mono resize-none"></textarea>
				</div>
				<div class="flex gap-2 pt-2">
					<button type="submit" disabled={!canSubmit} class="flex-1 px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide disabled:opacity-50">
						{submitting ? 'Adding...' : 'Add Account'}
					</button>
					<button type="button" onclick={reset} class="px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors">
						Cancel
					</button>
				</div>
			</form>
		</div>
	</div>
{:else}
	<!-- Inline form (wizard) -->
	<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-3">
		<div>
			<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="gh-username-inline">GitHub Username</label>
			<input id="gh-username-inline" type="text" bind:value={githubUsername} placeholder="octocat" required class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors" />
		</div>
		<div>
			<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="gh-token-inline">Personal Access Token</label>
			<input id="gh-token-inline" type="password" bind:value={ghToken} placeholder="ghp_..." required class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors font-mono" />
			<p class="text-muted text-xs mt-1">Needs <code class="text-secondary">repo</code> and <code class="text-secondary">workflow</code> scopes</p>
		</div>
		<div>
			<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="ssh-key-inline">SSH Private Key</label>
			<textarea id="ssh-key-inline" bind:value={sshPrivateKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" required rows="4" class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors font-mono resize-none"></textarea>
		</div>
		<div class="pt-2">
			<button type="submit" disabled={!canSubmit} class="w-full px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide disabled:opacity-50">
				{submitting ? 'Adding...' : 'Add Account'}
			</button>
		</div>
	</form>
{/if}
