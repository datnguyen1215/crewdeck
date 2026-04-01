<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'secondary',
		size = 'md',
		children,
		...restProps
	}: {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'xs' | 'sm' | 'md';
		children: Snippet;
		[key: string]: unknown;
	} = $props();

	const sizes: Record<string, string> = {
		xs: 'px-2 py-1 text-xs',
		sm: 'px-3 py-1 text-xs',
		md: 'px-4 py-2 text-sm'
	};

	const variants: Record<string, string> = {
		primary: 'border border-cyan text-cyan hover:bg-cyan/10 transition-colors',
		secondary: 'border border-edge text-secondary hover:text-primary hover:border-edge-hi transition-colors',
		danger: 'bg-red text-white hover:bg-red/80 transition-colors',
		ghost: 'text-secondary hover:text-primary transition-colors'
	};

	function cls(variant: string, size: string) {
		return ['rounded', sizes[size], variants[variant]].join(' ');
	}
</script>

<button class={cls(variant, size)} {...restProps}>
	{@render children()}
</button>
