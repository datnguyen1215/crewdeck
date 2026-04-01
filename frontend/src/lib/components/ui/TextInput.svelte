<script lang="ts">
	let {
		type = 'text',
		mono = false,
		compact = false,
		multiline = false,
		value = $bindable(''),
		...restProps
	}: {
		type?: 'text' | 'password' | 'number';
		mono?: boolean;
		compact?: boolean;
		multiline?: boolean;
		value?: string | number;
		[key: string]: unknown;
	} = $props();

	const base = 'w-full bg-base border border-edge rounded text-sm text-primary placeholder-muted focus:outline-none focus:border-cyan transition-colors';

	function cls(compact: boolean, mono: boolean) {
		const padding = compact ? 'px-2 py-1.5' : 'px-3 py-2';
		return [base, padding, mono ? 'font-mono' : ''].filter(Boolean).join(' ');
	}
</script>

{#if multiline}
	<textarea class={cls(compact, mono)} bind:value {...restProps}></textarea>
{:else}
	<input {type} class={cls(compact, mono)} bind:value {...restProps} />
{/if}
