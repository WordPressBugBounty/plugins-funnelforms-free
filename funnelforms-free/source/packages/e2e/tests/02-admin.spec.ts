import { expect, test } from '@playwright/test';
import { EDITION, signIn, watchErrors } from './site';

/** Every page of the plugin's menu opens without a PHP or browser error (tools/e2e.sh checks the log). */
const PAGES = [
	'funnelforms',
	'funnelforms-builder',
	'funnelforms-entries',
	'funnelforms-stats',
	'funnelforms-settings',
	'funnelforms-import',
	// Free leaves out integrations, appointments, the account, the app and support (editions/free/exclude.txt).
	...( 'pro' === EDITION ? [ 'funnelforms-integrations', 'funnelforms-appointments', 'funnelforms-account', 'funnelforms-app', 'funnelforms-support' ] : [] ),
];

for ( const slug of PAGES ) {
	test( `the page ${ slug } opens`, async ( { page } ) => {
		await signIn( page );
		const errors = watchErrors( page );
		const response = await page.goto( `/wp-admin/admin.php?page=${ slug }` );
		expect( response?.status() ).toBe( 200 );
		// After the setup assistant (01-setup) every page opens itself, not the assistant.
		expect( new URL( page.url() ).searchParams.get( 'page' ) ).toBe( slug );
		await expect( page.locator( '.ffx-app, #funnelforms-builder' ).first() ).toBeVisible();
		await page.waitForLoadState( 'networkidle' );
		const text = await page.locator( 'body' ).innerText();
		expect( text ).not.toMatch( /Fatal error|Parse error|critical error|Warning:|Notice:|Deprecated:/ );
		expect( errors ).toEqual( [] );
	} );
}
