import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { WpRestAdapter } from '../src/wp-rest';

function respond( status: number, body: unknown ): Response {
	return new Response( JSON.stringify( body ), { status, headers: { 'Content-Type': 'application/json' } } );
}

describe( 'WpRestAdapter', () => {
	it( 'builds addresses for pretty and plain permalinks', () => {
		expect( new WpRestAdapter( { root: 'https://site.test/wp-json/', nonce: 'n' } ).url( '/7/draft' ) ).toBe( 'https://site.test/wp-json/funnelforms/v1/admin/forms/7/draft' );
		expect( new WpRestAdapter( { root: 'https://site.test/?rest_route=/', nonce: 'n' } ).url( '/7', { revision: 'current' } ) ).toBe( 'https://site.test/?rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms%2F7&revision=current' );
		expect( new WpRestAdapter( { root: '/wp-json/', nonce: 'n' } ).url( '', { search: '', page: 2 } ) ).toBe( '/wp-json/funnelforms/v1/admin/forms?page=2' );
	} );

	it( 'sends the nonce, JSON and the method override', async () => {
		const fetch = vi.fn( async () => respond( 200, { problems: [], missingRights: [], form: {} } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch } );
		await api.saveDraft( 7, { title: 'x' } as never );
		const [ url, init ] = fetch.mock.calls[ 0 ] as unknown as [ string, RequestInit ];
		// The method also in the address, for hosts that strip the header.
		expect( url ).toBe( '/wp-json/funnelforms/v1/admin/forms/7/draft?_method=PUT' );
		expect( init.method ).toBe( 'POST' );
		expect( init.headers ).toMatchObject( { 'X-WP-Nonce': 'abc', 'X-HTTP-Method-Override': 'PUT', 'Content-Type': 'application/json' } );
		expect( JSON.parse( String( init.body ) ) ).toEqual( { document: { title: 'x' } } );
	} );

	it( 'turns refusals into ApiError with their data', async () => {
		const fetch = vi.fn( async () => respond( 409, { code: 'locked', message: 'Someone else is editing this form.', lockedBy: { id: 2, name: 'Mia' } } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch } );
		const error = await api.lock( 7 ).catch( ( e: unknown ) => e );
		expect( error ).toBeInstanceOf( ApiError );
		expect( ( error as ApiError ).status ).toBe( 409 );
		expect( ( error as ApiError ).lockedBy ).toEqual( { id: 2, name: 'Mia' } );

		const offline = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch: vi.fn( async () => Promise.reject( new TypeError( 'Failed to fetch' ) ) ) } );
		expect( ( ( await offline.get( 7 ).catch( ( e: unknown ) => e ) ) as ApiError ).code ).toBe( 'offline' );
	} );

	it( 'creates, changes and deletes appointment types and keeps the problems of a refusal', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce( respond( 201, { ref: 'bt:2' } ) )
			.mockResolvedValueOnce( respond( 400, { code: 'invalid_booking_type', message: 'The appointment type is incomplete.', problems: [ 'no_hours' ] } ) )
			.mockResolvedValueOnce( new Response( null, { status: 204 } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch } );
		await api.saveBookingType( null, 'Beratung', {} as never );
		const error = await api.saveBookingType( 2, 'Beratung', {} as never ).catch( ( e: unknown ) => e );
		await api.deleteBookingType( 2 );
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls.map( ( [ url, init ] ) => [ url, ( init.headers as Record<string, string> )[ 'X-HTTP-Method-Override' ] ?? init.method ] ) ).toEqual( [
			[ '/wp-json/funnelforms/v1/admin/forms/booking-types', 'POST' ],
			[ '/wp-json/funnelforms/v1/admin/forms/booking-types/2?_method=PUT', 'PUT' ],
			[ '/wp-json/funnelforms/v1/admin/forms/booking-types/2?_method=DELETE', 'DELETE' ],
		] );
		expect( ( error as ApiError ).data.problems ).toEqual( [ 'no_hours' ] );
	} );

	it( "reads the site's own design without an address and knows its logo", async () => {
		const fetch = vi.fn( async () => respond( 200, { url: 'https://site.test/', colors: [], roles: {}, fonts: [], confidence: 'low', sources: [], logo: null } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch, logo: 'https://site.test/logo.png' } );
		expect( ( await api.siteDesign() ).confidence ).toBe( 'low' );
		expect( ( fetch.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ] ).toBe( '/wp-json/funnelforms/v1/admin/forms/site-design' );
		expect( api.siteLogo ).toBe( 'https://site.test/logo.png' );
		expect( new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch } ).siteLogo ).toBeNull();
	} );

	it( 'asks for templates, previews and new forms in a language', async () => {
		const fetch = vi.fn( async () => respond( 200, {} ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch } );
		await api.templates();
		await api.templates( 'fr_FR' );
		await api.templatePreview( 'solar', 'fr_FR' );
		await api.fromTemplate( 'solar', 'fr_FR' );
		await api.fromTemplate( 'solar' );
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls.map( ( [ url ] ) => url ) ).toEqual( [
			'/wp-json/funnelforms/v1/admin/forms/templates',
			'/wp-json/funnelforms/v1/admin/forms/templates?locale=fr_FR',
			'/wp-json/funnelforms/v1/admin/forms/templates/solar/preview?locale=fr_FR',
			'/wp-json/funnelforms/v1/admin/forms/templates/solar',
			'/wp-json/funnelforms/v1/admin/forms/templates/solar',
		] );
		expect( JSON.parse( String( calls[ 3 ]?.[ 1 ].body ) ) ).toEqual( { locale: 'fr_FR' } );
		expect( calls[ 4 ]?.[ 1 ].body ).toBeUndefined();
	} );

	it( 'sends descriptions and instructions to the AI form builder', async () => {
		const fetch = vi.fn( async () => respond( 200, { id: 9, summary: 'Done.' } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', fetch } );
		await api.aiCreate( 'A quote form' );
		await api.aiCreate( 'A quote form', 'en_US' );
		await api.aiEdit( 9, 'Shorter', { title: 'x', settings: {} } as never );
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls.map( ( [ url, init ] ) => [ init.method, url ] ) ).toEqual( [
			[ 'POST', '/wp-json/funnelforms/v1/admin/forms/ai' ],
			[ 'POST', '/wp-json/funnelforms/v1/admin/forms/ai' ],
			[ 'POST', '/wp-json/funnelforms/v1/admin/forms/9/ai' ],
		] );
		expect( JSON.parse( String( calls[ 0 ]?.[ 1 ].body ) ) ).toEqual( { prompt: 'A quote form' } );
		expect( JSON.parse( String( calls[ 1 ]?.[ 1 ].body ) ) ).toEqual( { prompt: 'A quote form', locale: 'en_US' } );
		// Empty objects stay objects on the way to the plugin.
		expect( String( calls[ 2 ]?.[ 1 ].body ) ).toBe( '{"prompt":"Shorter","document":{"title":"x","settings":{}}}' );
	} );

	it( 'asks for a prediction, reads the last one and the analyses left', async () => {
		const fetch = vi.fn( async () => respond( 200, { prediction: null } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', fetch } );
		const parameters = { industry: 'solar', industry_label: '', lead_value: 80, currency: 'EUR', audience: 'b2c', ages: [], intent: 'compare', traffic: 'social_ads', mobile_share: null, notes: '' } as const;
		await api.predict( 9, { title: 'x', settings: {} } as never, { ...parameters, ages: [] }, 10000 );
		expect( await api.lastPrediction( 9 ) ).toBeNull();
		fetch.mockImplementationOnce( async () => respond( 200, { quota: null } ) );
		expect( await api.predictionQuota() ).toBeNull();
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls.map( ( [ url, init ] ) => [ init.method, url ] ) ).toEqual( [
			[ 'POST', '/wp-json/funnelforms/v1/admin/forms/9/prediction' ],
			[ 'GET', '/wp-json/funnelforms/v1/admin/forms/9/prediction' ],
			[ 'GET', '/wp-json/funnelforms/v1/admin/forms/prediction-quota' ],
		] );
		expect( String( calls[ 0 ]?.[ 1 ].body ) ).toContain( '"document":{"title":"x","settings":{}},"parameters":{"industry":"solar"' );
		expect( JSON.parse( String( calls[ 0 ]?.[ 1 ].body ) ).visitors ).toBe( 10000 );
	} );

	it( 'collects a prediction the server works on in the background, through a hiccup of the web server', async () => {
		vi.useFakeTimers();
		try {
			const run = { prediction: { created: '2026-10-28T08:00:00+00:00' }, remainingToday: 8, remainingMonth: 2 };
			const fetch = vi
				.fn()
				.mockResolvedValueOnce( respond( 202, { pending: true } ) )
				.mockResolvedValueOnce( respond( 202, { pending: true } ) )
				.mockResolvedValueOnce( new Response( '<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' } ) )
				.mockResolvedValueOnce( respond( 200, run ) );
			const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', fetch } );
			const answer = api.predict( 9, { title: 'x', settings: {} } as never, {} as never, 10000 );
			await vi.advanceTimersByTimeAsync( 9000 );
			expect( await answer ).toEqual( run );
			const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
			expect( calls.map( ( [ url, init ] ) => [ init.method, url ] ) ).toEqual( [
				[ 'POST', '/wp-json/funnelforms/v1/admin/forms/9/prediction' ],
				[ 'GET', '/wp-json/funnelforms/v1/admin/forms/9/prediction/pending' ],
				[ 'GET', '/wp-json/funnelforms/v1/admin/forms/9/prediction/pending' ],
				[ 'GET', '/wp-json/funnelforms/v1/admin/forms/9/prediction/pending' ],
			] );

			// An error of the plugin ends it at once; a server that never finishes ends after 150 seconds.
			fetch.mockReset();
			fetch.mockResolvedValueOnce( respond( 202, { pending: true } ) ).mockResolvedValueOnce( respond( 502, { code: 'ai_failed', message: 'The AI could not finish the prediction.' } ) );
			const failed = expect( api.predict( 9, { title: 'x', settings: {} } as never, {} as never, 10000 ) ).rejects.toMatchObject( { code: 'ai_failed', message: 'The AI could not finish the prediction.' } );
			await vi.advanceTimersByTimeAsync( 3000 );
			await failed;
			fetch.mockReset();
			fetch.mockImplementation( async () => respond( 202, { pending: true } ) );
			const slow = expect( api.predict( 9, { title: 'x', settings: {} } as never, {} as never, 10000 ) ).rejects.toMatchObject( { code: 'ai_timeout' } );
			await vi.advanceTimersByTimeAsync( 151000 );
			await slow;
			expect( fetch ).toHaveBeenCalledTimes( 51 );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'says the web server stopped a request instead of showing its bare status', async () => {
		const fetch = vi.fn( async () => new Response( '<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', fetch } );
		await expect( api.lastPrediction( 9 ) ).rejects.toMatchObject( { code: 'http_502', message: 'The server of your website did not answer in time. Try again in a moment.' } );
	} );

	it( 'notes suggestions applied to the form', async () => {
		const fetch = vi.fn( async () => respond( 200, { prediction: { applied: [ { suggestion: 's1', summary: 'Done.', at: '2026-10-24T15:00:00+00:00' } ] } } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', fetch } );
		expect( ( await api.markApplied( 9, [ 's1' ], true, 'Done.' ) ).applied?.[ 0 ]?.suggestion ).toBe( 's1' );
		await api.markApplied( 9, [ 's1' ], false );
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls.map( ( [ url, init ] ) => [ init.method, url ] ) ).toEqual( [
			[ 'POST', '/wp-json/funnelforms/v1/admin/forms/9/prediction/applied' ],
			[ 'POST', '/wp-json/funnelforms/v1/admin/forms/9/prediction/applied' ],
		] );
		expect( JSON.parse( String( calls[ 0 ]?.[ 1 ].body ) ) ).toEqual( { suggestions: [ 's1' ], applied: true, summary: 'Done.' } );
		expect( JSON.parse( String( calls[ 1 ]?.[ 1 ].body ) ) ).toEqual( { suggestions: [ 's1' ], applied: false, summary: '' } );
	} );

	it( 'uses the fresh nonce WordPress sends back', async () => {
		const fetch = vi.fn( async () => new Response( '[]', { status: 200, headers: { 'X-WP-Nonce': 'fresh' } } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'old', fetch } );
		await api.revisions( 7 );
		await api.revisions( 7 );
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls[ 0 ]?.[ 1 ].headers ).toMatchObject( { 'X-WP-Nonce': 'old' } );
		expect( calls[ 1 ]?.[ 1 ].headers ).toMatchObject( { 'X-WP-Nonce': 'fresh' } );
	} );

	it( 'lists entries with the paging WordPress sends in headers', async () => {
		const fetch = vi.fn( async () => new Response( '[{"id":4}]', { status: 200, headers: { 'X-WP-Total': '51', 'X-WP-TotalPages': '3' } } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', fetch } );
		const list = await api.entries( { form: 3, archived: true, perPage: 25, page: 2 } );
		expect( list ).toEqual( { entries: [ { id: 4 } ], total: 51, pages: 3 } );
		const [ url ] = fetch.mock.calls[ 0 ] as unknown as [ string ];
		expect( url ).toBe( '/wp-json/funnelforms/v1/entries?form=3&archived=true&page=2&per_page=25' );

		await api.bulkEntries( [ 1, 2 ], { addTags: [ 'b2b' ] } );
		const [ bulkUrl, init ] = fetch.mock.calls[ 1 ] as unknown as [ string, RequestInit ];
		expect( bulkUrl ).toBe( '/wp-json/funnelforms/v1/entries/bulk' );
		expect( JSON.parse( String( init.body ) ) ).toEqual( { addTags: [ 'b2b' ], ids: [ 1, 2 ] } );
	} );

	it( 'asks for the key figures of the forms and of the entries', async () => {
		const fetch = vi.fn( async () => respond( 200, {} ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', fetch } );
		await api.formFigures();
		await api.entryFigures( { form: 3, today: '2026-10-18T22:00:00.000Z', week: '2026-10-12T22:00:00.000Z', previous: '2026-10-05T22:00:00.000Z' } );
		const urls = fetch.mock.calls.map( ( c ) => ( c as unknown as [ string ] )[ 0 ] );
		expect( urls[ 0 ] ).toBe( '/wp-json/funnelforms/v1/stats/forms' );
		expect( urls[ 1 ] ).toBe( '/wp-json/funnelforms/v1/stats/entries?form=3&today=2026-10-18T22%3A00%3A00.000Z&week=2026-10-12T22%3A00%3A00.000Z&previous=2026-10-05T22%3A00%3A00.000Z' );
	} );

	it( 'asks for the figures of a form, with the analytics on request', async () => {
		const fetch = vi.fn( async () => respond( 200, {} ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', fetch } );
		await api.formStats( 3, '2026-10-01', '2026-10-30' );
		await api.formStats( 3, '2026-10-01', '2026-10-30', 'full' );
		await api.formStats( 3, '2026-10-01', '2026-10-30', 'full', 'canvas' );
		const urls = fetch.mock.calls.map( ( c ) => ( c as unknown as [ string ] )[ 0 ] );
		expect( urls ).toEqual( [ '/wp-json/funnelforms/v1/stats/3?from=2026-10-01&to=2026-10-30', '/wp-json/funnelforms/v1/stats/3?from=2026-10-01&to=2026-10-30&detail=full', '/wp-json/funnelforms/v1/stats/3?from=2026-10-01&to=2026-10-30&detail=full&view=canvas' ] );
	} );

	it( 'loads the icon set once, and again after a failure', async () => {
		const library = { version: '1', icons: { house: [] }, tags: {} };
		const fetch = vi.fn().mockResolvedValueOnce( respond( 404, {} ) ).mockResolvedValueOnce( respond( 200, library ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'n', icons: '/wp-content/plugins/Funnelforms-pro/assets/icons/lucide.json?ver=5.0.0', fetch } );
		await expect( api.icons() ).rejects.toBeInstanceOf( ApiError );
		expect( await api.icons() ).toEqual( library );
		expect( await api.icons() ).toEqual( library );
		expect( fetch ).toHaveBeenCalledTimes( 2 );
		expect( fetch.mock.calls[ 0 ]?.[ 0 ] ).toBe( '/wp-content/plugins/Funnelforms-pro/assets/icons/lucide.json?ver=5.0.0' );
		await expect( new WpRestAdapter( { root: '/wp-json/', nonce: 'n' } ).icons() ).rejects.toBeInstanceOf( ApiError );
	} );

	it( 'lists the WhatsApp templates of a connection and submits new ones', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce( respond( 200, { templates: [ { name: 'anfrage', language: 'de' } ] } ) )
			.mockResolvedValueOnce( respond( 201, { name: 'neu', language: 'de', status: 'PENDING' } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch } );
		expect( await api.whatsAppTemplates( 'whatsapp:a1' ) ).toEqual( [ { name: 'anfrage', language: 'de' } ] );
		const template = { name: 'neu', language: 'de', category: 'UTILITY' as const, body: 'Hallo {{1}}!', examples: [ 'Ada' ] };
		expect( await api.createWhatsAppTemplate( 'whatsapp:a1', template ) ).toMatchObject( { status: 'PENDING' } );
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls.map( ( [ url, init ] ) => [ url, init.method ] ) ).toEqual( [
			[ '/wp-json/funnelforms/v1/admin/forms/connections/whatsapp:a1/whatsapp-templates', 'GET' ],
			[ '/wp-json/funnelforms/v1/connections/whatsapp:a1/whatsapp-templates', 'POST' ],
		] );
		expect( JSON.parse( String( calls[ 1 ]?.[ 1 ].body ) ) ).toEqual( template );
	} );

	it( 'tests and deletes connections and searches the pages of the site', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce( respond( 200, { sent: true } ) )
			.mockResolvedValueOnce( respond( 200, { deleted: true } ) )
			.mockResolvedValueOnce( respond( 200, [ { id: 4, title: { rendered: 'Danke &amp; Tsch&uuml;ss' }, link: 'https://site.test/danke/' } ] ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch } );
		await api.testConnection( 'twilio:a1', { to: '+491701234567' } );
		await api.deleteConnection( 'twilio:a1' );
		expect( await api.pages( ' danke ' ) ).toEqual( [ { id: 4, title: 'Danke & Tschüss', url: 'https://site.test/danke/' } ] );
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls.map( ( [ url, init ] ) => [ url, ( init.headers as Record<string, string> )[ 'X-HTTP-Method-Override' ] ?? init.method ] ) ).toEqual( [
			[ '/wp-json/funnelforms/v1/connections/twilio:a1/test', 'POST' ],
			[ '/wp-json/funnelforms/v1/connections/twilio:a1?_method=DELETE', 'DELETE' ],
			[ '/wp-json/wp/v2/pages?search=danke&per_page=20&status=publish&_fields=id%2Ctitle%2Clink&orderby=relevance&order=asc', 'GET' ],
		] );
		expect( JSON.parse( String( calls[ 0 ]?.[ 1 ].body ) ) ).toEqual( { to: '+491701234567' } );
		expect( new WpRestAdapter( { root: 'https://site.test/?rest_route=/', nonce: 'n' } ).url( '^wp/v2/pages', { search: 'a' } ) ).toBe( 'https://site.test/?rest_route=%2Fwp%2Fv2%2Fpages&search=a' );
	} );

	it( 'puts the method into the address also without pretty permalinks', async () => {
		const fetch = vi.fn( async () => respond( 200, { deleted: true } ) );
		await new WpRestAdapter( { root: 'https://site.test/?rest_route=/', nonce: 'n', fetch } ).deleteConnection( 'twilio:a1' );
		const [ url, init ] = fetch.mock.calls[ 0 ] as unknown as [ string, RequestInit ];
		expect( url ).toBe( 'https://site.test/?rest_route=%2Ffunnelforms%2Fv1%2Fconnections%2Ftwilio%3Aa1&_method=DELETE' );
		expect( init.method ).toBe( 'POST' );
	} );
} );
