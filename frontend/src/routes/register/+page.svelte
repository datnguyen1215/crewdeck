<script lang="ts">
	import { goto } from '$app/navigation';
	import { toastStore } from '$lib/stores/toasts.svelte';
	import { checkSetupStatus, setupAccount } from '$lib/api/http.js';

	let username = $state('');
	let password = $state('');
	let confirm = $state('');
	let loading = $state(false);

	// Redirect to /login if setup already completed
	async function checkSetup() {
		try {
			const data = await checkSetupStatus();
			if (!data.needsSetup) {
				goto('/login');
			}
		} catch {
			// If check fails, let user try anyway
		}
	}
	checkSetup();

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!username || !password || password !== confirm) return;

		loading = true;
		try {
			await setupAccount(username, password);
			goto('/login');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Setup failed', 'error');
		} finally {
			loading = false;
		}
	}
</script>

<div class="w-full max-w-sm px-4">
	<div class="text-center mb-8">
		<span class="text-cyan font-bold uppercase tracking-widest text-lg">CrewDeck</span>
		<p class="text-secondary text-sm mt-2">Create admin account</p>
	</div>

	<form onsubmit={handleSubmit} class="space-y-4">
		<div>
			<label for="username" class="block text-sm text-secondary mb-1.5">Username</label>
			<input
				id="username"
				type="text"
				bind:value={username}
				autocomplete="username"
				required
				class="w-full bg-surface border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-cyan focus:outline-none transition-colors"
				placeholder="Choose username"
			/>
		</div>

		<div>
			<label for="password" class="block text-sm text-secondary mb-1.5">Password</label>
			<input
				id="password"
				type="password"
				bind:value={password}
				autocomplete="new-password"
				required
				class="w-full bg-surface border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-cyan focus:outline-none transition-colors"
				placeholder="Choose password"
			/>
		</div>

		<div>
			<label for="confirm" class="block text-sm text-secondary mb-1.5">Confirm Password</label>
			<input
				id="confirm"
				type="password"
				bind:value={confirm}
				autocomplete="new-password"
				required
				class="w-full bg-surface border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-cyan focus:outline-none transition-colors {password && confirm && password !== confirm ? 'border-red' : ''}"
				placeholder="Confirm password"
			/>
			{#if password && confirm && password !== confirm}
				<p class="text-red text-xs mt-1">Passwords do not match</p>
			{/if}
		</div>

		<button
			type="submit"
			disabled={loading || !username || !password || password !== confirm}
			class="w-full bg-cyan text-base font-bold text-sm py-2.5 rounded hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
		>
			{loading ? 'Creating account...' : 'Create account'}
		</button>
	</form>
</div>
