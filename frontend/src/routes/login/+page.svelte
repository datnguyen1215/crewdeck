<script lang="ts">
	import { page } from '$app/stores';

	const errorMessages: Record<string, string> = {
		oauth_denied: 'Authentication was cancelled',
		missing_code: 'Invalid authentication response',
		token_exchange_failed: 'Failed to complete authentication',
		userinfo_failed: 'Failed to retrieve user information',
		no_email: 'No email address found in your account',
		not_allowed: 'Your email is not authorized to access this application',
		invalid_state: 'Authentication verification failed'
	};

	let error = $derived($page.url.searchParams.get('error'));
	let errorMessage = $derived(error ? errorMessages[error] || 'An error occurred' : null);
</script>

<div class="min-h-screen flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<div class="text-center mb-8">
			<div class="text-cyan font-bold text-2xl tracking-wider mb-2">CD</div>
			<h1 class="text-cyan font-bold uppercase tracking-widest text-sm">CREWDECK</h1>
		</div>

		<div class="bg-surface border border-edge rounded-lg p-6">
			<h2 class="text-primary text-lg font-medium mb-6 text-center">Sign in</h2>

			{#if errorMessage}
				<div class="bg-red/10 border border-red/30 text-red px-4 py-3 rounded mb-6 text-sm">
					{errorMessage}
				</div>
			{/if}

			<a
				href="/auth/google"
				class="flex items-center justify-center gap-3 w-full bg-base-hi hover:bg-surface-hi border border-edge hover:border-edge-hi text-primary px-4 py-3 rounded transition-colors"
			>
				<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
					<path
						d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
						fill="#4285F4"
					/>
					<path
						d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
						fill="#34A853"
					/>
					<path
						d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
						fill="#FBBC05"
					/>
					<path
						d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
						fill="#EA4335"
					/>
				</svg>
				<span>Sign in with Google</span>
			</a>
		</div>
	</div>
</div>
