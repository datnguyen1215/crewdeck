<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'form',
		children,
		class: extraClass = '',
		...restProps
	}: {
		variant?: 'form' | 'filter';
		children: Snippet;
		class?: string;
		[key: string]: unknown;
	} = $props();

	const formCls = 'w-full bg-base border border-edge rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-cyan transition-colors';
	const filterCls = 'bg-surface border border-edge text-secondary text-xs rounded px-2 py-2 sm:py-1 hover:border-edge-hi transition-colors cursor-pointer outline-none min-h-[36px] sm:min-h-0';

	function cls(variant: string, extra: string) {
		return [variant === 'filter' ? filterCls : formCls, extra].filter(Boolean).join(' ');
	}
</script>

<select class={cls(variant, extraClass)} {...restProps}>
	{@render children()}
</select>
