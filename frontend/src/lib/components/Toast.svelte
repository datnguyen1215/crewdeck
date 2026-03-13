<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut, cubicIn } from 'svelte/easing';
	import { toastStore } from '$lib/stores/toasts.svelte.js';

	const STYLES = {
		info: { border: 'border-cyan', text: 'text-cyan', bg: 'bg-cyan/5', label: 'INFO' },
		success: { border: 'border-green', text: 'text-green', bg: 'bg-green/5', label: 'OK' },
		warning: { border: 'border-amber', text: 'text-amber', bg: 'bg-amber/5', label: 'WARN' },
		error: { border: 'border-red', text: 'text-red', bg: 'bg-red/5', label: 'ERR' }
	} as const;
</script>

<div
	class="fixed bottom-4 right-4 z-[200] flex flex-col-reverse gap-2 pointer-events-none w-80 max-w-[calc(100vw-2rem)]"
	aria-live="polite"
	aria-label="Notifications"
>
	{#each toastStore.items as toast (toast.id)}
		{@const s = STYLES[toast.type]}
		<div
			in:fly={{ x: 24, duration: 250, easing: cubicOut }}
			out:fly={{ x: 24, duration: 180, easing: cubicIn }}
			class="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded border {s.border} {s.bg} bg-surface shadow-lg"
			role="status"
		>
			<span class="text-xs font-bold font-mono {s.text} flex-shrink-0 mt-0.5 tracking-wider"
				>[{s.label}]</span
			>
			<span class="text-sm text-secondary flex-1 leading-snug">{toast.message}</span>
			<button
				onclick={() => toastStore.remove(toast.id)}
				class="text-muted hover:text-primary transition-colors flex-shrink-0 leading-none ml-1"
				aria-label="Dismiss notification"
			>✕</button>
		</div>
	{/each}
</div>
