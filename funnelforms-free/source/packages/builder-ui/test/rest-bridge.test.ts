import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { AppointmentsClient } from '../src/appointments';
import { ajaxUrl, bridgeUrl, resetBridge, restFetch, usesBridge } from '../src/rest-bridge';
import { WpRestAdapter } from '../src/wp-rest';

function respond( status: number, body: unknown ): Response {
	return new Response( JSON.stringify( body ), { status, headers: { 'Content-Type': 'application/json' } } );
}

const cookieFailed = (): Response => respond( 403, { code: 'rest_cookie_invalid_nonce', message: 'Cookie check failed', data: { status: 403 } } );
const AJAX = '/wp-admin/admin-ajax.php';

afterEach( () => {
	resetBridge();
	delete ( globalThis as { ajaxurl?: string } ).ajaxurl;
} );

describe( 'REST bridge through admin-ajax.php', () => {
	it( 'builds the bridge address for pretty and plain permalinks, with query and nonce', () => {
		expect( bridgeUrl( '/wp-json/funnelforms/v1/admin/forms/7/draft?_method=PUT', '/wp-json/', AJAX, 'abc' ) ).toBe(
			'/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms%2F7%2Fdraft&_method=PUT&_wpnonce=abc'
		);
		expect( bridgeUrl( 'https://site.test/?rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms&page=2', 'https://site.test/?rest_route=/', AJAX ) ).toBe(
			'/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms&page=2'
		);
		// Site address with www, WordPress address without: the REST root is on another host.
		expect( bridgeUrl( 'https://www.site.test/wp-json/wp/v2/pages', 'https://www.site.test/wp-json/', 'https://site.test/wp-admin/admin-ajax.php' ) ).toBe(
			'https://site.test/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Fwp%2Fv2%2Fpages'
		);
		// Not below the REST root: no bridge.
		expect( bridgeUrl( 'https://elsewhere.test/feed', 'https://site.test/wp-json/', AJAX ) ).toBeNull();
	} );

	it( 'takes ajaxurl of the admin page', () => {
		( globalThis as { ajaxurl?: string } ).ajaxurl = '/blog/wp-admin/admin-ajax.php';
		expect( ajaxUrl() ).toBe( '/blog/wp-admin/admin-ajax.php' );
	} );

	it( 'sends a request again through the bridge after "Cookie check failed", and later ones right away', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce( cookieFailed() )
			.mockResolvedValueOnce( respond( 200, { id: 7 } ) )
			.mockResolvedValueOnce( respond( 200, { items: [] } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch, ajax: AJAX } );
		await expect( api.get( 7 ) ).resolves.toMatchObject( { id: 7 } );
		await api.list();
		const calls = fetch.mock.calls as unknown as Array<[ string, RequestInit ]>;
		expect( calls.map( ( [ url ] ) => url ) ).toEqual( [
			'/wp-json/funnelforms/v1/admin/forms/7',
			'/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms%2F7&_wpnonce=abc',
			'/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms&_wpnonce=abc',
		] );
		// Same method, headers and body as the first try.
		expect( calls[ 1 ]?.[ 1 ].headers ).toMatchObject( { 'X-WP-Nonce': 'abc' } );
		expect( usesBridge() ).toBe( true );
	} );

	it( 'keeps the body and the method override of a change', async () => {
		const fetch = vi.fn().mockResolvedValueOnce( cookieFailed() ).mockResolvedValueOnce( respond( 200, { problems: [], missingRights: [], form: {} } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch, ajax: AJAX } );
		await api.saveDraft( 7, { title: 'x' } as never );
		const [ url, init ] = fetch.mock.calls[ 1 ] as unknown as [ string, RequestInit ];
		expect( url ).toBe( '/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms%2F7%2Fdraft&_method=PUT&_wpnonce=abc' );
		expect( init.method ).toBe( 'POST' );
		expect( init.headers ).toMatchObject( { 'X-HTTP-Method-Override': 'PUT' } );
		expect( JSON.parse( String( init.body ) ) ).toEqual( { document: { title: 'x' } } );
	} );

	it( 'leaves other refusals alone', async () => {
		const fetch = vi.fn( async () => respond( 403, { code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.' } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch, ajax: AJAX } );
		const error = ( await api.get( 7 ).catch( ( e: unknown ) => e ) ) as ApiError;
		expect( error.code ).toBe( 'rest_forbidden' );
		expect( fetch ).toHaveBeenCalledTimes( 1 );
		expect( usesBridge() ).toBe( false );
	} );

	it( 'shows the answer of the bridge when the login is gone there too, and stays on /wp-json/', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce( cookieFailed() )
			.mockResolvedValueOnce( respond( 401, { code: 'rest_not_logged_in', message: 'Your WordPress login has ended. Please log in again.' } ) )
			.mockResolvedValueOnce( respond( 200, { id: 7 } ) );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch, ajax: AJAX } );
		const error = ( await api.get( 7 ).catch( ( e: unknown ) => e ) ) as ApiError;
		expect( error.message ).toBe( 'Your WordPress login has ended. Please log in again.' );
		expect( usesBridge() ).toBe( false );
		await api.get( 7 );
		expect( ( fetch.mock.calls[ 2 ] as unknown as [ string ] )[ 0 ] ).toBe( '/wp-json/funnelforms/v1/admin/forms/7' );
	} );

	it( 'is plain fetch without admin-ajax.php', async () => {
		const fetch = vi.fn( async () => cookieFailed() );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'abc', fetch, ajax: null } );
		expect( ( ( await api.get( 7 ).catch( ( e: unknown ) => e ) ) as ApiError ).message ).toBe( 'Cookie check failed' );
		expect( fetch ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'goes straight to the bridge when the REST root is on another origin', async () => {
		const inner = vi.fn( async () => respond( 200, [] ) );
		const wrapped = restFetch( 'https://www.elsewhere.test/wp-json/', inner, AJAX );
		await wrapped( 'https://www.elsewhere.test/wp-json/funnelforms/v1/admin/forms', { method: 'GET', headers: { 'X-WP-Nonce': 'abc' } } );
		expect( inner ).toHaveBeenCalledTimes( 1 );
		expect( ( inner.mock.calls[ 0 ] as unknown as [ string ] )[ 0 ] ).toBe( '/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms&_wpnonce=abc' );
	} );

	it( 'also helps the appointments page', async () => {
		const fetch = vi.fn().mockResolvedValueOnce( cookieFailed() ).mockResolvedValueOnce( respond( 200, [] ) );
		const client = new AppointmentsClient( '/wp-json/', 'abc', fetch, AJAX );
		await expect( client.list( '2026-11-01', '2026-11-30' ) ).resolves.toEqual( [] );
		expect( ( fetch.mock.calls[ 1 ] as unknown as [ string ] )[ 0 ] ).toContain( '/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fappointments' );
	} );
} );
