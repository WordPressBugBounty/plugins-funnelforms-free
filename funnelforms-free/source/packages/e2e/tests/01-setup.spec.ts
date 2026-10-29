import { expect, test } from '@playwright/test';
import { fillIn, signIn, visitor, watchErrors } from './site';

/**
 * The first minutes of a new customer: every Funnelforms page leads to the setup assistant, which
 * ends with a published form on a new page; a visitor sends it and the overview counts it.
 */
test( 'a new site walks the setup assistant to a live form that takes an entry', async ( { page, browser } ) => {
	await signIn( page );
	const errors = watchErrors( page );
	await page.goto( '/wp-admin/admin.php?page=funnelforms-builder' );
	await expect( page ).toHaveURL( /page=funnelforms-setup/ );
	const seen: string[] = [];
	for ( let step = 0; step < 15 && ! seen.includes( 'Your form is live' ); step++ ) {
		const title = await page.locator( 'main h1' ).first().innerText();
		seen.push( title );
		// Questions without a preset answer (statistics, newsletter) get the cautious last answer.
		const groups = await page.locator( 'main input[type=radio]' ).evaluateAll( ( radios ) => [ ...new Set( radios.map( ( radio ) => ( radio as HTMLInputElement ).name ) ) ] );
		for ( const name of groups ) {
			if ( 0 === ( await page.locator( `main input[type=radio][name="${ name }"]:checked` ).count() ) ) {
				// The radios are drawn as cards; the label around the last one picks it.
				await page.locator( 'main label', { has: page.locator( `input[type=radio][name="${ name }"]` ) } ).last().click();
			}
		}
		const skip = page.getByRole( 'button', { name: 'Skip for now' } );
		if ( await skip.count() ) {
			// The account step: connecting needs the Funnelforms service.
			await skip.click();
		} else if ( 'Your form is live' !== title ) {
			await page.locator( 'main .ffx-btn--primary:visible, .ffx-setup .ffx-btn--primary:visible' ).last().click();
		}
		await page.waitForLoadState( 'domcontentloaded' );
	}
	expect( seen ).toContain( 'Your form is live' );
	expect( errors, 'browser errors in the assistant' ).toEqual( [] );

	const live = await page.getByRole( 'link', { name: 'View the page' } ).getAttribute( 'href' );
	expect( live ).toBeTruthy();
	const guest = await visitor( browser );
	const guestErrors = watchErrors( guest );
	await guest.goto( String( live ) );
	await fillIn( guest, 1 );
	expect( guestErrors, 'browser errors on the form page' ).toEqual( [] );
	await guest.context().close();

	await page.goto( '/wp-admin/admin.php?page=funnelforms' );
	await expect( page ).toHaveURL( /page=funnelforms$/ );
	await expect( page.locator( '.ffx-app' ) ).toContainText( 'Latest entries' );
	// The latest entries name who sent them.
	await expect( page.locator( 'section', { hasText: 'Latest entries' } ) ).toContainText( 'Erika' );
} );
