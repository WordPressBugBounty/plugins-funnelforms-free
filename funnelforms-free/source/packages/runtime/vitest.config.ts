import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		environment: 'happy-dom',
		// Tests stand in for Google's scripts (reCAPTCHA, Maps); nothing is fetched.
		environmentOptions: { happyDOM: { settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true } } },
	},
} );
