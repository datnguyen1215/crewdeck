<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'secondary',
		size = 'md',
		class: extraClass = '',
		children,
		...restProps
	}: {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'xs' | 'sm' | 'md';
		class?: string;
		children: Snippet;
		[key: string]: unknown;
	} = $props();

	const sizes: Record<string, string> = {
		xs: 'px-2 py-1 text-xs',
		sm: 'px-3 py-1 text-xs',
		md: 'px-4 py-2 text-sm'
	};

	const variants: Record<string, string> = {
		primary: 'border border-cyan text-cyan disabled:opacity-50 transition-colors',
		secondary: 'border border-edge text-secondary hover:text-primary hover:border-edge-hi disabled:opacity-50 transition-colors',
		danger: 'bg-red text-white hover:bg-red/80 disabled:opacity-50 transition-colors',
		ghost: 'text-secondary hover:text-primary disabled:opacity-50 transition-colors'
	};

	function cls(v: string, s: string, extra: string) {
		return ['rounded', sizes[s], variants[v], extra].filter(Boolean).join(' ');
	}
</script>

<button class={cls(variant, size, extraClass)} {...restProps}>
	{@render children()}
</button>
