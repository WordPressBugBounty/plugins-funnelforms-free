import { expect, test } from '@playwright/test';
import { EDITION, signIn, watchErrors } from './site';

/**
 * Without an active license Funnelforms Pro is locked (License\LicenseLock): every page shows why
 * and leads to the account page, which stays open, and so does the support page; the setup assistant
 * waits until the website is connected. tools/e2e.sh unlocks Pro for the other tests, as the site
 * cannot reach Funnelforms; the cookie ffx_e2e_locked keeps the real answer: not connected.
 */
test( 'a website without a license sees the lock screen and the way to the account page', async ( { page, context, baseURL } ) => {
	test.skip( 'pro' !== EDITION, 'Free has no license.' );
	await context.addCookies( [ { name: 'ffx_e2e_locked', value: '1', url: baseURL ?? 'http://127.0.0.1:8089' } ] );
	await signIn( page );
	const errors = watchErrors( page );
	for ( const slug of [ 'funnelforms-builder', 'funnelforms-entries', 'funnelforms-setup' ] ) {
		const response = await page.goto( `/wp-admin/admin.php?page=${ slug }` );
		expect( response?.status(), slug ).toBe( 200 );
		// No detour to the setup assistant: the page itself shows the lock.
		expect( new URL( page.url() ).searchParams.get( 'page' ), slug ).toBe( slug );
		await expect( page.getByRole( 'heading', { name: 'Funnelforms Pro is not active' } ), slug ).toBeVisible();
		await expect( page.getByText( 'not connected with a Funnelforms account yet' ), slug ).toBeVisible();
	}
	await page.getByRole( 'link', { name: 'Open the account page' } ).first().click();
	await expect( page ).toHaveURL( /page=funnelforms-account/ );
	await expect( page.getByRole( 'heading', { name: 'Funnelforms Pro is not active' } ) ).toHaveCount( 0 );
	const support = await page.goto( '/wp-admin/admin.php?page=funnelforms-support' );
	expect( support?.status() ).toBe( 200 );
	await expect( page.getByRole( 'heading', { name: 'Funnelforms Pro is not active' } ) ).toHaveCount( 0 );
	// The admin API answers 403 while the forms on the website keep running (03-lead, unlocked).
	const nonce = await ( await page.request.get( '/wp-admin/admin-ajax.php?action=rest-nonce' ) ).text();
	const forms = await page.request.get( '/?rest_route=/funnelforms/v1/admin/forms', { headers: { 'X-WP-Nonce': nonce } } );
	expect( forms.status() ).toBe( 403 );
	expect( ( await forms.json() ).code ).toBe( 'funnelforms_license_locked' );
	expect( errors ).toEqual( [] );
} );
