import { expect, test } from '@playwright/test';
import { Api, EDITION, fillIn, publishTemplate, signIn, visitor, watchErrors, type Published } from './site';

/**
 * The path of a lead: a form from a template is published, a visitor from an ad sends it, a second
 * one leaves, and the lead list and the statistics show both.
 */
test.describe.serial( 'A lead from a published form', () => {
	let form: Published;
	let api: Api;

	test( 'a template is published on a page', async ( { page } ) => {
		await signIn( page );
		api = await Api.of( page );
		form = await publishTemplate( api, 'callback', 'E2E Rückruf' );
	} );

	test( 'a visitor from an ad sends the form on a phone', async ( { browser } ) => {
		const page = await visitor( browser );
		const errors = watchErrors( page );
		await page.goto( `/?page_id=${ form.pageId }&utm_source=google&utm_medium=cpc&utm_campaign=e2e` );
		await expect( page.locator( '.ffx-question' ).first() ).toBeVisible();
		await fillIn( page );
		await expect( page.locator( '.ffx-success' ) ).toContainText( 'Erika' );
		expect( errors, 'browser errors on the form page' ).toEqual( [] );
		await page.context().close();
	} );

	test( 'a second visitor starts and leaves', async ( { browser } ) => {
		const page = await visitor( browser );
		await page.goto( `/?page_id=${ form.pageId }` );
		await page.locator( '[data-option]' ).first().click();
		await expect( page.locator( '.ffx-button-back:visible' ) ).toBeVisible();
		// The runtime sends its events in batches, the last one when the page is hidden.
		await page.close( { runBeforeUnload: true } );
		await page.context().close();
	} );

	test( 'the entry arrives with its contact data and source', async ( { page } ) => {
		await signIn( page );
		api = await Api.of( page );
		const list = await api.call( 'GET', `entries?form=${ form.id }` );
		expect( list.status ).toBe( 200 );
		expect( list.body ).toHaveLength( 1 );
		const entry = await api.call( 'GET', `entries/${ list.body[ 0 ].id }` );
		expect( entry.status ).toBe( 200 );
		expect( JSON.stringify( entry.body.contact ) ).toContain( 'Erika' );
		expect( entry.body.utm ).toMatchObject( { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'e2e' } );
		expect( entry.body.leadStatus ).toBe( 'new' );
	} );

	test( 'the statistics count views, starts and the entry', async ( { page } ) => {
		await signIn( page );
		api = await Api.of( page );
		await expect.poll( async () => ( await api.call( 'GET', `stats/${ form.id }` ) ).body.totals?.views, { message: 'views of both visitors' } ).toBe( 2 );
		const stats = await api.call( 'GET', `stats/${ form.id }` );
		expect( stats.body.totals ).toMatchObject( { views: 2, starts: 2, completions: 1, conversionRate: 0.5 } );
		expect( stats.body.steps[ 0 ].reached ).toBe( 2 );

		const today = new Date().toISOString().slice( 0, 10 );
		const full = await api.call( 'GET', `stats/${ form.id }?detail=full&from=${ today }&to=${ today }` );
		if ( 'free' === EDITION ) {
			expect( full.status ).toBe( 403 );
			expect( full.body.code ).toBe( 'pro_feature' );
		} else {
			expect( full.status ).toBe( 200 );
			expect( full.body.sources ).toContainEqual( expect.objectContaining( { source: 'google', medium: 'cpc', views: 1, completions: 1 } ) );
		}
	} );

	test( 'the lead list and the statistics page show them', async ( { page } ) => {
		await signIn( page );
		const errors = watchErrors( page );
		await page.goto( '/wp-admin/admin.php?page=funnelforms-entries' );
		await expect( page.locator( '#funnelforms-builder' ) ).toContainText( 'Erika' );
		await page.goto( '/wp-admin/admin.php?page=funnelforms-stats' );
		await expect( page.locator( `.ffx-app a[href*="form=${ form.id }"]` ).first() ).toBeVisible();
		await expect( page.locator( '.ffx-app' ) ).toContainText( '50.0' );
		expect( errors, 'browser errors in the admin' ).toEqual( [] );
	} );

	test( 'a won lead counts for its source', async ( { page } ) => {
		await signIn( page );
		api = await Api.of( page );
		const list = await api.call( 'GET', `entries?form=${ form.id }` );
		const won = await api.call( 'PATCH', `entries/${ list.body[ 0 ].id }`, { leadStatus: 'won' } );
		// The pipeline of the leads is Pro.
		expect( won.status, JSON.stringify( won.body ) ).toBe( 'free' === EDITION ? 403 : 200 );
		const errors = watchErrors( page );
		await page.goto( '/wp-admin/admin.php?page=funnelforms' );
		await expect( page.locator( 'section', { hasText: 'Latest entries' } ) ).toContainText( 'Erika' );
		await page.goto( `/wp-admin/admin.php?page=funnelforms-stats` );
		const leads = page.locator( '.ffx-app' );
		await expect( leads ).toContainText( 'Leads and deals' );
		if ( 'free' === EDITION ) {
			await expect( page.locator( '#leads' ) ).toHaveCount( 0 );
		} else {
			const section = page.locator( '#leads' );
			await expect( section.locator( '.ffx-kpi' ).nth( 1 ) ).toContainText( '1' );
			await expect( section.locator( '.ffx-sources tr', { hasText: 'google / cpc' } ) ).toContainText( '100.0' );
			await expect( section ).toContainText( 'e2e' );
			await page.goto( `/wp-admin/admin.php?page=funnelforms-stats&form=${ form.id }` );
			await expect( page.locator( '#leads .ffx-sources tr', { hasText: 'google / cpc' } ) ).toContainText( '100.0' );
		}
		expect( errors, 'browser errors in the admin' ).toEqual( [] );
	} );
} );
