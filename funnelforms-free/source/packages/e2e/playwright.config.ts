import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of a built plugin in a real WordPress. tools/e2e.sh sets up the site, installs the
 * ZIP and starts the server; FFX_E2E_URL is its address, FFX_E2E_EDITION `pro` or `free`.
 */
export default defineConfig( {
	testDir: './tests',
	// One site for all tests: they run one after the other.
	workers: 1,
	fullyParallel: false,
	retries: process.env.CI ? 1 : 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: process.env.CI ? [ [ 'list' ], [ 'html', { open: 'never', outputFolder: 'report' } ] ] : 'list',
	outputDir: 'results',
	use: {
		baseURL: process.env.FFX_E2E_URL ?? 'http://localhost:8080',
		locale: 'de-DE',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		launchOptions: process.env.FFX_E2E_CHROMIUM ? { executablePath: process.env.FFX_E2E_CHROMIUM } : {},
	},
	projects: [ { name: 'chromium', use: { ...devices[ 'Desktop Chrome' ] } } ],
} );
