<script lang="ts">
	import { listApiKeys, createApiKey, deleteApiKey, type ApiKey } from '$lib/api/http.js';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	let keys = $state<ApiKey[]>([]);
	let loading = $state(true);

	// Create modal
	let showCreateModal = $state(false);
	let createName = $state('');
	let creating = $state(false);
	let newKey = $state<string | null>(null);
	let showKeyReveal = $state(false);

	// Delete confirmation
	let deletingId = $state<string | null>(null);

	const gridCols = '1fr auto auto auto auto';

	$effect(() => {
		loadKeys();
	});

	async function loadKeys() {
		try {
			keys = await listApiKeys();
		} catch {
			toastStore.add('Failed to load API keys', 'error');
		} finally {
			loading = false;
		}
	}

	function openCreateModal() {
		createName = '';
		newKey = null;
		showKeyReveal = false;
		showCreateModal = true;
	}

	async function handleCreate() {
		if (!createName.trim()) return;
		creating = true;
		try {
			const result = await createApiKey(createName.trim());
			newKey = result.key;
			showKeyReveal = true;
			keys = [result, ...keys];
			createName = '';
		} catch {
			toastStore.add('Failed to create API key', 'error');
		} finally {
			creating = false;
		}
	}

	async function copyKey() {
		if (!newKey) return;
		try {
			await navigator.clipboard.writeText(newKey);
			toastStore.add('Key copied to clipboard', 'success');
		} catch {
			toastStore.add('Failed to copy key', 'error');
		}
	}

	async function confirmDelete(id: string) {
		try {
			await deleteApiKey(id);
			keys = keys.filter((k) => k.id !== id);
			toastStore.add('API key revoked', 'success');
		} catch {
			toastStore.add('Failed to revoke API key', 'error');
		} finally {
			deletingId = null;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (deletingId) deletingId = null;
			if (showCreateModal && !newKey) showCreateModal = false;
			if (showKeyReveal) showKeyReveal = false;
		}
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
	<title>API Keys - CrewDeck</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="p-6 h-full overflow-auto">
	<!-- Header -->
	<div class="flex items-start justify-between mb-8">
		<div>
			<h1 class="text-xs text-muted uppercase tracking-widest mb-1">SETTINGS</h1>
			<p class="text-xl font-bold text-primary">API Keys</p>
			<p class="text-muted text-xs mt-1">
				{keys.length} key{keys.length !== 1 ? 's' : ''}
			</p>
		</div>
		<button
			onclick={openCreateModal}
			class="px-3 py-1.5 text-xs font-medium bg-cyan text-base rounded hover:bg-cyan/80 transition-colors"
		>
			Create API Key
		</button>
	</div>

	<!-- Key List -->
	{#if loading}
		<!-- Mobile skeleton cards -->
		<div class="flex flex-col gap-3 md:hidden fade-up">
			{#each Array(3) as _, i}
				<div class="bg-surface border border-edge rounded-lg p-4 fade-up" style="animation-delay: {i * 50}ms">
					<div class="skeleton h-4 w-3/5 rounded mb-2"></div>
					<div class="skeleton h-3 w-2/5 rounded mb-1"></div>
					<div class="skeleton h-3 w-4/5 rounded"></div>
				</div>
			{/each}
		</div>
		<!-- Desktop skeleton table -->
		<div class="overflow-x-auto hidden md:block fade-up">
			<div class="min-w-[560px] border border-edge rounded overflow-hidden">
				<div class="grid text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge" style="grid-template-columns: {gridCols}">
					<div class="px-3 py-2.5">Name</div>
					<div class="px-3 py-2.5">Key</div>
					<div class="px-3 py-2.5">Created</div>
					<div class="px-3 py-2.5">Last Used</div>
					<div class="px-3 py-2.5 text-right">Actions</div>
				</div>
				{#each Array(3) as _, i}
					{@const skeletonWidths = [75, 60, 90]}
					<div
						class="grid border-b border-edge last:border-0 fade-up {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'}"
						style="grid-template-columns: {gridCols}; animation-delay: {i * 50}ms"
					>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-4 rounded" style="width: {skeletonWidths[i]}%"></div>
						</div>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-3 w-20 rounded"></div>
						</div>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-3 w-16 rounded"></div>
						</div>
						<div class="px-3 py-3 flex items-center">
							<div class="skeleton h-3 w-14 rounded"></div>
						</div>
						<div class="px-3 py-3 flex items-center justify-end">
							<div class="skeleton h-7 w-20 rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else if keys.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<p class="text-primary text-lg font-semibold mb-1">No API keys</p>
			<p class="text-muted text-sm mb-6">Create an API key to enable programmatic access</p>
			<button
				onclick={openCreateModal}
				class="px-3 py-1.5 text-xs font-medium bg-cyan text-base rounded hover:bg-cyan/80 transition-colors"
			>
				Create API Key
			</button>
		</div>
	{:else}
		<!-- Mobile condensed card view -->
		<div class="flex flex-col gap-3 md:hidden">
			{#each keys as key, i (key.id)}
				<div
					class="bg-surface border border-edge rounded-lg p-4 fade-up"
					style="animation-delay: {i * 50}ms"
				>
					<h2 class="text-primary font-semibold truncate mb-1">{key.name}</h2>
					<div class="flex items-center gap-3 mb-2">
						<span class="text-xs text-muted font-mono">{key.key_prefix}...</span>
						{#if deletingId === key.id}
							<div class="flex gap-1.5 ml-auto">
								<button
									onclick={() => confirmDelete(key.id)}
									class="px-2 py-0.5 text-xs text-red bg-red/10 border border-red/50 rounded hover:bg-red/20 transition-colors uppercase tracking-wide"
								>
									Confirm
								</button>
								<button
									onclick={() => (deletingId = null)}
									class="px-2 py-0.5 text-xs text-secondary border border-edge rounded hover:border-edge-hi transition-colors"
								>
									Cancel
								</button>
							</div>
						{:else}
							<button
								onclick={() => (deletingId = key.id)}
								class="px-2 py-0.5 text-xs text-red/70 border border-edge rounded hover:border-red/50 hover:text-red transition-colors ml-auto"
							>
								Revoke
							</button>
						{/if}
					</div>
					<p class="text-muted text-xs">
						Created {formatDate(key.created_at)}
						{#if key.last_used_at}
							<span class="ml-1">· Used {formatDate(key.last_used_at)}</span>
						{/if}
					</p>
				</div>
			{/each}
		</div>

		<!-- Desktop table view -->
		<div class="overflow-x-auto hidden md:block">
			<div class="min-w-[560px] border border-edge rounded overflow-hidden">
				<!-- Table header -->
				<div class="grid text-xs text-muted uppercase tracking-widest bg-base-hi border-b border-edge" style="grid-template-columns: {gridCols}">
					<div class="px-3 py-2.5">Name</div>
					<div class="px-3 py-2.5">Key</div>
					<div class="px-3 py-2.5">Created</div>
					<div class="px-3 py-2.5">Last Used</div>
					<div class="px-3 py-2.5 text-right">Actions</div>
				</div>

				<!-- Rows -->
				{#each keys as key, i (key.id)}
					<div
						class="grid border-b border-edge last:border-0 hover:bg-surface-hi transition-colors fade-up {i % 2 === 1 ? 'bg-base-hi' : 'bg-base'}"
						style="grid-template-columns: {gridCols}; animation-delay: {i * 50}ms"
					>
						<div class="px-3 py-2.5 flex items-center">
							<span class="text-primary font-medium truncate">{key.name}</span>
						</div>
						<div class="px-3 py-2.5 flex items-center">
							<span class="text-muted font-mono text-xs">{key.key_prefix}...</span>
						</div>
						<div class="px-3 py-2.5 flex items-center">
							<span class="text-muted text-xs">{formatDate(key.created_at)}</span>
						</div>
						<div class="px-3 py-2.5 flex items-center">
							<span class="text-muted text-xs">{key.last_used_at ? formatDate(key.last_used_at) : 'Never'}</span>
						</div>
						<div class="px-3 py-2.5 flex items-center justify-end">
							{#if deletingId === key.id}
								<div class="flex gap-1.5">
									<button
										onclick={() => confirmDelete(key.id)}
										class="px-2 py-1 text-xs text-red bg-red/10 border border-red/50 rounded hover:bg-red/20 transition-colors uppercase tracking-wide"
									>
										Confirm
									</button>
									<button
										onclick={() => (deletingId = null)}
										class="px-2 py-1 text-xs text-secondary border border-edge rounded hover:border-edge-hi transition-colors"
									>
										Cancel
									</button>
								</div>
							{:else}
								<button
									onclick={() => (deletingId = key.id)}
									class="px-2 py-1 text-xs text-red/70 border border-edge rounded hover:border-red/50 hover:text-red transition-colors"
								>
									Revoke
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- Create Modal -->
{#if showCreateModal}
	{#if showKeyReveal && newKey}
		<!-- Key reveal modal -->
		<div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
			<button type="button" class="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default" onclick={() => { showKeyReveal = false; showCreateModal = false; }} aria-label="Close"></button>
			<div class="relative bg-surface border border-edge rounded-lg p-6 max-w-lg w-full fade-up">
				<h3 class="text-primary font-bold text-lg mb-1">API Key Created</h3>
				<p class="text-muted text-xs mb-4">
					Copy this key now. It won't be shown again.
				</p>
				<div class="bg-base border border-edge rounded p-3 mb-4">
					<code class="text-xs text-cyan break-all block select-all">{newKey}</code>
				</div>
				<div class="flex items-start gap-2 p-3 bg-amber/10 border border-amber/30 rounded mb-4">
					<span class="text-amber text-sm flex-shrink-0">⚠</span>
					<p class="text-amber text-xs">
						Make sure to save this key. You won't be able to see it again after closing this dialog.
					</p>
				</div>
				<div class="flex justify-end">
					<button
						onclick={copyKey}
						class="mr-2 px-3 py-1.5 text-xs font-medium bg-cyan text-base rounded hover:bg-cyan/80 transition-colors"
					>
						Copy Key
					</button>
					<button
						onclick={() => { showKeyReveal = false; showCreateModal = false; }}
						class="px-3 py-1.5 text-xs text-secondary border border-edge rounded hover:border-edge-hi transition-colors"
					>
						Done
					</button>
				</div>
			</div>
		</div>
	{:else}
		<!-- Create form modal -->
		<div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
			<button type="button" class="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default" onclick={() => (showCreateModal = false)} aria-label="Close"></button>
			<div class="relative bg-surface border border-edge rounded-lg p-6 max-w-md w-full fade-up">
				<h3 class="text-primary font-bold text-lg mb-1">Create API Key</h3>
				<p class="text-muted text-xs mb-4">Give your key a descriptive name</p>
				<input
					type="text"
					bind:value={createName}
					placeholder="e.g., Claude CI Process"
					disabled={creating}
					class="w-full px-3 py-2 text-sm bg-base border border-edge rounded focus:border-cyan focus:outline-none text-primary placeholder:text-muted mb-4"
				/>
				<div class="flex justify-end">
					<button
						onclick={() => (showCreateModal = false)}
						disabled={creating}
						class="mr-2 px-3 py-1.5 text-xs text-secondary border border-edge rounded hover:border-edge-hi transition-colors disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						onclick={handleCreate}
						disabled={creating || !createName.trim()}
						class="px-3 py-1.5 text-xs font-medium bg-cyan text-base rounded hover:bg-cyan/80 transition-colors disabled:opacity-50"
					>
						{creating ? 'Creating...' : 'Create'}
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
