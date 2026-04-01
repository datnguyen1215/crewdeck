<script lang="ts">
	import DispatchAutocomplete from './DispatchAutocomplete.svelte';

	let {
		onSubmit,
		posting = false
	}: {
		onSubmit: (text: string) => void;
		posting?: boolean;
	} = $props();

	let text = $state('');

	function submit() {
		if (!text.trim()) return;
		onSubmit(text);
		text = '';
	}
</script>

<div class="border border-edge rounded p-3 sm:p-4 relative">
	<DispatchAutocomplete bind:value={text} onSubmit={submit} />

	<div class="flex justify-end mt-3 pt-3 border-t border-edge">
		<button
			onclick={submit}
			disabled={posting || !text.trim()}
			class="px-4 py-2.5 sm:py-1.5 text-xs border border-cyan text-cyan rounded hover:bg-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px] sm:min-h-0"
		>
			{posting ? 'Posting...' : 'Post Comment'}
		</button>
	</div>
</div>
