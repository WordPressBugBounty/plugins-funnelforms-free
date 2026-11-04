import config from './playwright.config';
import { defineConfig } from '@playwright/test';

/** The compatibility runs of tools/compat/compat.sh (compat/compat.spec.ts), one profile per run. */
export default defineConfig( {
	...config,
	testDir: './compat',
	retries: 0,
	timeout: 90_000,
	reporter: [ [ 'list' ], [ 'json', { outputFile: process.env.FFX_COMPAT_REPORT ?? 'results/compat/report.json' } ] ],
	outputDir: process.env.FFX_COMPAT_OUT ? process.env.FFX_COMPAT_OUT + '/playwright' : 'results/compat/playwright',
} );
