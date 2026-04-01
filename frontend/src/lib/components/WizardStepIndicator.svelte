<script lang="ts">
	let {
		totalSteps,
		currentStep
	}: {
		totalSteps: number;
		currentStep: number;
	} = $props();
</script>

<div class="flex items-center gap-2 mb-10">
	{#each Array(totalSteps) as _, i (i)}
		{@const stepNum = i + 1}
		<div class="flex items-center gap-2">
			<div
				class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors"
				class:bg-cyan={stepNum <= currentStep}
				class:text-base={stepNum <= currentStep}
				class:border-cyan={stepNum <= currentStep}
				class:border-edge={stepNum > currentStep}
				class:text-muted={stepNum > currentStep}
			>
				{#if stepNum < currentStep}
					&#10003;
				{:else}
					{stepNum}
				{/if}
			</div>
			{#if i < totalSteps - 1}
				<div
					class="w-8 h-px transition-colors"
					class:bg-cyan={stepNum < currentStep}
					class:bg-edge={stepNum >= currentStep}
				></div>
			{/if}
		</div>
	{/each}
</div>
