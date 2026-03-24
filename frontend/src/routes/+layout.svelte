<script lang="ts">
	import '../app.css';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { getAuthStatus, type AuthUser } from '$lib/api/http.js';

	let { children } = $props();
	let loading = $state(true);
	let user = $state<AuthUser | null>(null);
	let isLoginPage = $derived($page.url.pathname === '/login');

	onMount(async () => {
		// Skip auth check on login page
		if (isLoginPage) {
			loading = false;
			return;
		}

		try {
			const status = await getAuthStatus();
			if (!status.authenticated) {
				goto('/login');
				return;
			}
			user = status.user ?? null;
		} catch {
			goto('/login');
			return;
		}
		loading = false;
	});

	// Page transitions via View Transitions API
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

{#if isLoginPage}
	{@render children()}
{:else if loading}
	<div class="flex h-screen items-center justify-center bg-base">
		<div class="text-secondary">Loading...</div>
	</div>
{:else}
	<div class="flex h-screen bg-base overflow-hidden">
		<Sidebar {user} />
		<main class="flex-1 overflow-auto">
			{@render children()}
		</main>
	</div>
{/if}

<Toast />
