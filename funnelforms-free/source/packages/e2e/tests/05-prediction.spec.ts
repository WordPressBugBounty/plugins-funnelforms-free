import { expect, test } from '@playwright/test';
import { Api, EDITION, signIn, watchErrors } from './site';

/** The route of the last prediction of a form, not the analyses left. */
const lastPrediction = ( url: URL ): boolean => /\d+(\/|%2F)prediction/.test( url.href ) && ! url.href.includes( 'prediction-quota' );

/** The last prediction, as the plugin keeps it: every step and contact step finishes for 70 %. */
function keptPrediction( documentNodes: Array<{ id: string; type: string }> ) {
	const nodes = documentNodes.filter( ( n ) => 'end' !== n.type );
	const contact = nodes.find( ( n ) => 'contact' === n.type )?.id ?? '';
	return {
		model: {
			benchmark: '2026-10',
			personas: [ { id: 'p1', name: 'Rückrufwillige', share: 1, description: 'Wollen schnell sprechen.' } ],
			steps: nodes.map( ( n ) => ( { node: n.id, prior: 0.7, estimated: false, uncertainty: 0.05, continue: { p1: 0.7 }, reasons: contact === n.id ? [ 'Einige zögern bei der Telefonnummer.' ] : [], fields: [] } ) ),
			insights: [],
			suggestions: [ { id: 's1', kind: 'trust', node: contact, field: null, title: 'Vertrauen vor dem Absenden', reason: 'Ein Hinweis nimmt Sorgen.', instruction: 'Schreib über den Button: Kostenlos und unverbindlich', effect: [ { node: contact, delta: 0.1 } ] } ],
			summary: 'Ein kurzer Rückruf-Funnel.',
		},
		parameters: { industry: 'solar', industry_label: '', lead_value: 80, currency: 'EUR', audience: 'b2c', ages: [], intent: 'compare', traffic: 'mixed', mobile_share: null, notes: '' },
		visitors: 1000,
		created: '2026-10-23T08:00:00+00:00',
	};
}

/**
 * The Predictive AI. The site has no Funnelforms service (WP_HTTP_BLOCK_EXTERNAL) and no license,
 * so a new prediction is refused with not_connected; the last one is answered by the test in the
 * browser, so the builder and the page of the Predictive AI can draw it as they would after a real one.
 */
test( 'the builder shows a prediction on the canvas', async ( { page } ) => {
	await signIn( page );
	const api = await Api.of( page );
	const made = await api.call( 'POST', 'admin/forms/templates/callback', { locale: 'de_DE' } );
	expect( made.status, JSON.stringify( made.body ) ).toBe( 201 );
	const id = Number( made.body.id );

	const last = await api.call( 'GET', `admin/forms/${ id }/prediction` );
	if ( 'free' === EDITION ) {
		// Funnelforms Free has neither the route nor the mode.
		expect( last.status ).toBe( 404 );
		await page.goto( `/wp-admin/admin.php?page=funnelforms-builder&form=${ id }` );
		await expect( page.locator( '.ffxb-canvas, .react-flow' ).first() ).toBeVisible();
		await expect( page.getByRole( 'button', { name: 'Prediction' } ) ).toHaveCount( 0 );
		return;
	}
	expect( last.status ).toBe( 200 );
	expect( last.body.prediction ).toBeNull();
	const refused = await api.call( 'POST', `admin/forms/${ id }/prediction`, {
		document: made.body.document,
		parameters: { industry: 'solar', industry_label: '', lead_value: 80, currency: 'EUR', audience: 'b2c', ages: [], intent: 'compare', traffic: 'mixed', mobile_share: null, notes: '' },
		visitors: 1000,
	} );
	expect( refused.status ).toBe( 403 );
	expect( refused.body.code ).toBe( 'not_connected' );

	const prediction = keptPrediction( made.body.document.nodes );
	await page.route( lastPrediction, ( route ) => ( 'GET' === route.request().method() ? route.fulfill( { json: { prediction } } ) : route.continue() ) );
	await page.addInitScript( () => window.localStorage.setItem( 'ffxb-tour-seen', '1' ) );
	const errors = watchErrors( page );
	await page.goto( `/wp-admin/admin.php?page=funnelforms-builder&form=${ id }` );
	await page.getByRole( 'button', { name: 'Prediction' } ).click();

	await expect( page.locator( '.ffxb-prediction__rate' ) ).toContainText( 'sent' );
	await expect( page.locator( '.ffxb-node.has-analytics' ).first() ).toBeVisible();
	await expect( page.locator( '.ffxb-node__analytics' ).first() ).toContainText( '1000 reached' );
	const overview = page.locator( '.ffxb-prediction-section' );
	await expect( overview ).toContainText( 'Ein kurzer Rückruf-Funnel.' );
	await expect( overview ).toContainText( 'Vertrauen vor dem Absenden' );
	// Without a license the dialog asks to connect it first.
	await page.getByRole( 'button', { name: 'Predict again' } ).click();
	await expect( page.locator( '.ffxb-dialog' ) ).toContainText( 'Connect your license' );
	expect( errors, 'browser errors in the builder' ).toEqual( [] );
} );

test( 'the page of the Predictive AI shows the report of a form, the overview the analyses left', async ( { page } ) => {
	await signIn( page );
	const api = await Api.of( page );
	const quota = await api.call( 'GET', 'admin/forms/prediction-quota' );
	if ( 'free' === EDITION ) {
		// Funnelforms Free has neither the page nor the route.
		expect( quota.status ).toBe( 404 );
		await page.goto( '/wp-admin/admin.php?page=funnelforms' );
		await expect( page.locator( '.ffx-predict-card' ) ).toHaveCount( 0 );
		return;
	}
	// Without a license the Funnelforms service is not asked.
	expect( quota.status ).toBe( 200 );
	expect( quota.body.quota ).toMatchObject( { connected: false, included: false } );
	const made = await api.call( 'POST', 'admin/forms/templates/callback', { locale: 'de_DE' } );
	expect( made.status, JSON.stringify( made.body ) ).toBe( 201 );
	const id = Number( made.body.id );
	const prediction = keptPrediction( made.body.document.nodes );
	await page.route( lastPrediction, ( route ) => ( 'GET' === route.request().method() ? route.fulfill( { json: { prediction } } ) : route.continue() ) );
	const errors = watchErrors( page );

	await page.goto( '/wp-admin/admin.php?page=funnelforms' );
	const card = page.locator( '.ffx-predict-card' );
	await expect( card ).toContainText( 'Connect your Funnelforms Pro license' );
	await card.getByRole( 'link', { name: 'Open Predictive AI' } ).click();
	await expect( page ).toHaveURL( /page=funnelforms-prediction/ );
	// The overview: every form with its last prediction; without a license nothing new can be asked for.
	await expect( page.getByRole( 'heading', { name: 'Which form loses the most leads?' } ) ).toBeVisible();
	await expect( page.getByText( 'Connect your license' ) ).toBeVisible();
	const open = page.locator( `.ffxb-pai-overview__card a[href*="form=${ id }&view=predict"]` );
	await expect( open ).toHaveCount( 1 );
	// Simulating and applying happen in the editor, in the tab Predictive AI, which draws the last prediction.
	await page.addInitScript( () => window.localStorage.setItem( 'ffxb-tour-seen', '1' ) );
	await open.click();
	await expect( page ).toHaveURL( new RegExp( `page=funnelforms-builder.*form=${ id }` ) );
	await expect( page.getByText( 'Funnel score', { exact: true } ) ).toBeVisible();
	await expect( page.getByText( '1.000 virtual visitors' ) ).toBeVisible();
	await expect( page.getByText( 'Connect your license' ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: 'Simulate again' } ) ).toBeDisabled();
	expect( errors, 'browser errors on the page' ).toEqual( [] );
} );
