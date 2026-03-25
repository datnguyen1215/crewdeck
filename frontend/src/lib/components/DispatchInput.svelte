<script lang="ts">
	import { getContext } from 'svelte';
	import type { Agent } from '$lib/api/http.js';

	let {
		onSubmit,
		posting = false
	}: {
		onSubmit: (text: string) => void;
		posting?: boolean;
	} = $props();

	const getAgents = getContext<() => Agent[]>('agents');
	let agents = $derived(getAgents());

	let text = $state('');
	let showMentions = $state(false);
	let mentionFilter = $state('');
	let mentionIdx = $state(0);
	let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);

	const DISPATCH_PREFIX = '/dispatch ';

	const filteredAgents = $derived(
		mentionFilter
			? agents.filter(a => a.name.toLowerCase().includes(mentionFilter.toLowerCase()))
			: agents
	);

	function handleInput(e: Event) {
		const ta = e.target as HTMLTextAreaElement;
		const val = ta.value;
		const pos = ta.selectionStart ?? 0;
		const before = val.slice(0, pos);
		const dispatchIdx = before.lastIndexOf(DISPATCH_PREFIX);
		if (dispatchIdx >= 0 && (dispatchIdx === 0 || /\s/.test(before[dispatchIdx - 1]))) {
			const typed = before.slice(dispatchIdx + DISPATCH_PREFIX.length);
			if (!/\s/.test(typed)) {
				mentionFilter = typed;
				showMentions = true;
				mentionIdx = 0;
				return;
			}
		}
		showMentions = false;
	}

	function selectMention(agent: Agent) {
		if (!textareaEl) return;
		const val = textareaEl.value;
		const pos = textareaEl.selectionStart ?? 0;
		const before = val.slice(0, pos);
		const dispatchIdx = before.lastIndexOf(DISPATCH_PREFIX);
		text = val.slice(0, dispatchIdx) + DISPATCH_PREFIX + agent.name + ' ' + val.slice(pos);
		showMentions = false;
		requestAnimationFrame(() => {
			const newPos = dispatchIdx + DISPATCH_PREFIX.length + agent.name.length + 1;
			textareaEl!.selectionStart = newPos;
			textareaEl!.selectionEnd = newPos;
			textareaEl!.focus();
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (showMentions && filteredAgents.length > 0) {
			if (e.key === 'ArrowDown') { e.preventDefault(); mentionIdx = (mentionIdx + 1) % filteredAgents.length; return; }
			if (e.key === 'ArrowUp') { e.preventDefault(); mentionIdx = (mentionIdx - 1 + filteredAgents.length) % filteredAgents.length; return; }
			if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(filteredAgents[mentionIdx]); return; }
			if (e.key === 'Escape') { e.preventDefault(); showMentions = false; return; }
		}
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			submit();
		}
	}

	function submit() {
		if (!text.trim()) return;
		onSubmit(text);
		text = '';
	}
</script>

<div class="border border-edge rounded p-3 sm:p-4 relative">
	<textarea
		bind:this={textareaEl}
		bind:value={text}
		oninput={handleInput}
		onkeydown={handleKeydown}
		rows={3}
		placeholder="Type /dispatch to spawn an agent..."
		class="w-full bg-transparent text-secondary text-sm resize-none focus:outline-none placeholder:text-muted"
	></textarea>

	{#if showMentions && filteredAgents.length > 0}
		<div class="absolute bottom-full left-0 mb-1 w-64 bg-surface border border-edge rounded shadow-lg max-h-48 overflow-auto z-10">
			{#each filteredAgents as agent, i (agent.id)}
				<button
					onclick={() => selectMention(agent)}
					class="w-full text-left px-3 py-3 sm:py-2 text-sm hover:bg-base transition-colors flex flex-col min-h-[44px] {i === mentionIdx ? 'bg-base' : ''}"
				>
					<span class="text-primary font-medium">{agent.name}</span>
					<span class="text-muted text-xs">{agent.title}</span>
				</button>
			{/each}
		</div>
	{/if}

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
