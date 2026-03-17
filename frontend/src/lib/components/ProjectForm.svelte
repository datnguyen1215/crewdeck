<script lang="ts">
	import { createProject, type Project, type GitHubAccount } from '$lib/api/http.js';

	const { githubAccounts = [], onCreated }: {
		githubAccounts?: GitHubAccount[];
		onCreated: (project: Project) => void;
	} = $props();

	let githubUrl = $state('');
	let selectedGitHubAccountId = $state('');
	let submitting = $state(false);
	let githubUrlError = $state('');
	let formError = $state('');

	async function submit() {
		githubUrlError = '';
		formError = '';

		if (!githubUrl.trim()) {
			githubUrlError = 'GitHub URL is required';
			return;
		}

		submitting = true;
		try {
			const project = await createProject({
				github_url: githubUrl.trim(),
				github_account_id: selectedGitHubAccountId || undefined
			});
			onCreated(project);
		} catch (err) {
			formError = err instanceof Error ? err.message : 'Failed to create project';
		} finally {
			submitting = false;
		}
	}
</script>

<form
	onsubmit={(e: SubmitEvent) => { e.preventDefault(); submit(); }}
	class="flex flex-col gap-4"
>
	<!-- GitHub URL -->
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
		{:else}
			<p class="text-muted text-xs mt-1">Name, description, and branch will be fetched automatically</p>
		{/if}
	</div>

	<!-- GitHub Account -->
	{#if githubAccounts.length > 0}
		<div>
			<label for="proj-gh-account" class="block text-xs text-muted uppercase tracking-widest mb-1.5">
				GitHub Account
			</label>
			<select
				id="proj-gh-account"
				bind:value={selectedGitHubAccountId}
				class="w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary
					focus:outline-none focus:border-cyan transition-colors"
			>
				<option value="">None (use host credentials)</option>
				{#each githubAccounts as account (account.id)}
					<option value={account.id}>{account.github_username} ({account.account_name})</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if formError}
		<p class="text-red text-sm">{formError}</p>
	{/if}

	<!-- Actions -->
	<div class="flex gap-3 mt-2">
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
