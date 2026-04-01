<script lang="ts">
	let {
		envVars = $bindable(),
		envSaving,
		envError,
		onSave,
		onSkip,
		onAddRow,
		onRemoveRow
	}: {
		envVars: { id: number; key: string; value: string; is_secret: boolean }[];
		envSaving: boolean;
		envError: string;
		onSave: () => void;
		onSkip: () => void;
		onAddRow: () => void;
		onRemoveRow: (id: number) => void;
	} = $props();
</script>

<div style="animation: fade-up 0.25s ease both">
	<h2 class="text-primary font-bold tracking-wide uppercase text-sm mb-1">
		Environment Variables
	</h2>
	<p class="text-muted text-xs mb-5">
		Add secrets or config values that agents can access during execution.
	</p>

	{#if envVars.length > 0}
		<div class="space-y-2 mb-4">
			{#each envVars as envVar (envVar.id)}
				<div class="flex gap-2 items-start">
					<input
						type="text"
						bind:value={envVar.key}
						placeholder="KEY"
						class="w-1/3 bg-base border border-edge rounded px-2 py-1.5 text-xs text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors font-mono"
					/>
					<input
						type={envVar.is_secret ? 'password' : 'text'}
						bind:value={envVar.value}
						placeholder="value"
						class="flex-1 bg-base border border-edge rounded px-2 py-1.5 text-xs text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors font-mono"
					/>
					<label class="flex items-center gap-1 text-xs text-muted flex-shrink-0 pt-1.5" title="Mark as secret">
						<input
							type="checkbox"
							bind:checked={envVar.is_secret}
							class="w-3 h-3 rounded border border-edge bg-base accent-amber cursor-pointer"
						/>
						<span class="sr-only">Secret</span>
						&#128274;
					</label>
					<button
						onclick={() => onRemoveRow(envVar.id)}
						class="text-muted hover:text-red text-xs pt-1.5 transition-colors"
						aria-label="Remove"
					>
						&#10005;
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<button
		onclick={onAddRow}
		class="w-full px-3 py-1.5 border border-dashed border-edge rounded text-xs text-muted hover:text-secondary hover:border-edge-hi transition-colors mb-4"
	>
		+ Add Variable
	</button>

	{#if envError}
		<p class="text-red text-xs mb-3">{envError}</p>
	{/if}

	<!-- Navigation -->
	<div class="flex gap-3 pt-4 border-t border-edge">
		<button
			onclick={onSave}
			disabled={envSaving}
			class="flex-1 px-4 py-2 bg-cyan/10 border border-cyan text-cyan rounded text-sm hover:bg-cyan/20 transition-colors uppercase tracking-wide disabled:opacity-50"
		>
			{envSaving ? 'Saving...' : 'Continue'}
		</button>
		<button
			onclick={onSkip}
			disabled={envSaving}
			class="px-4 py-2 border border-edge rounded text-sm text-secondary hover:text-primary hover:border-edge-hi transition-colors disabled:opacity-50"
		>
			Skip
		</button>
	</div>
</div>
