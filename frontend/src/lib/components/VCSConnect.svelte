<script lang="ts">
	import { untrack } from 'svelte';
	import {
		createVCSAccount,
		type VCSAccount
	} from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';
	import Modal from '$lib/components/Modal.svelte';
	import TextInput from '$lib/components/ui/TextInput.svelte';
	import Button from '$lib/components/ui/Button.svelte';

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
	<Button variant="primary" size="sm" onclick={() => (showForm = true)}>
		+ Add GitHub Account
	</Button>
{:else if showForm && !inline}
	<Modal open={showForm} onClose={reset} label="Add GitHub Account" maxWidth="max-w-md">
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
				<TextInput id="gh-username" bind:value={githubUsername} placeholder="octocat" required />
			</div>
			<div>
				<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="gh-token">Personal Access Token</label>
				<TextInput id="gh-token" type="password" mono bind:value={ghToken} placeholder="ghp_..." required />
				<p class="text-muted text-xs mt-1">Needs <code class="text-secondary">repo</code> and <code class="text-secondary">workflow</code> scopes</p>
			</div>
			<div>
				<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="ssh-key">SSH Private Key</label>
				<TextInput id="ssh-key" multiline mono bind:value={sshPrivateKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" required rows={4} style="resize: none;" />
			</div>
			<div class="flex gap-2 pt-2">
				<button type="submit" disabled={!canSubmit} class="flex-1 px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide disabled:opacity-50">
					{submitting ? 'Adding...' : 'Add Account'}
				</button>
				<Button type="button" onclick={reset}>Cancel</Button>
			</div>
		</form>
	</Modal>
{:else}
	<!-- Inline form (wizard) -->
	<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-3">
		<div>
			<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="gh-username-inline">GitHub Username</label>
			<TextInput id="gh-username-inline" bind:value={githubUsername} placeholder="octocat" required />
		</div>
		<div>
			<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="gh-token-inline">Personal Access Token</label>
			<TextInput id="gh-token-inline" type="password" mono bind:value={ghToken} placeholder="ghp_..." required />
			<p class="text-muted text-xs mt-1">Needs <code class="text-secondary">repo</code> and <code class="text-secondary">workflow</code> scopes</p>
		</div>
		<div>
			<label class="block text-muted text-xs uppercase tracking-wide mb-1" for="ssh-key-inline">SSH Private Key</label>
			<TextInput id="ssh-key-inline" multiline mono bind:value={sshPrivateKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" required rows={4} style="resize: none;" />
		</div>
		<div class="pt-2">
			<button type="submit" disabled={!canSubmit} class="w-full px-4 py-2 bg-cyan/10 border border-cyan text-cyan text-sm rounded hover:bg-cyan/20 transition-colors uppercase tracking-wide disabled:opacity-50">
				{submitting ? 'Adding...' : 'Add Account'}
			</button>
		</div>
	</form>
{/if}
