<script lang="ts">
	import { goto } from '$app/navigation';
	import { toastStore } from '$lib/stores/toasts.svelte';
	import { login } from '$lib/api/http.js';

	let username = $state('');
	let password = $state('');
	let loading = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!username || !password) return;

		loading = true;
		try {
			await login(username, password);
			goto('/');
		} catch (err) {
			toastStore.add(err instanceof Error ? err.message : 'Login failed', 'error');
		} finally {
			loading = false;
		}
	}
</script>

<div class="w-full max-w-sm px-4">
	<div class="text-center mb-8">
		<span class="text-cyan font-bold uppercase tracking-widest text-lg">CrewDeck</span>
		<p class="text-secondary text-sm mt-2">Sign in to continue</p>
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
				placeholder="Enter username"
			/>
		</div>

		<div>
			<label for="password" class="block text-sm text-secondary mb-1.5">Password</label>
			<input
				id="password"
				type="password"
				bind:value={password}
				autocomplete="current-password"
				required
				class="w-full bg-surface border border-edge rounded px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-cyan focus:outline-none transition-colors"
				placeholder="Enter password"
			/>
		</div>

		<button
			type="submit"
			disabled={loading || !username || !password}
			class="w-full bg-cyan text-base font-bold text-sm py-2.5 rounded hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
		>
			{loading ? 'Signing in...' : 'Sign in'}
		</button>
	</form>
</div>
