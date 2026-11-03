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

/**
 * A fake WordPress: `valid` is the nonce of the current login; `cookieOnRest` whether the login
 * cookie reaches /wp-json/ (a server cache drops it otherwise); `loggedIn` whether there is a
 * login at all. Answers like WordPress and Http\RestBridge.
 */
function site( { valid = 'f1e2d3c4b5', cookieOnRest = true, loggedIn = true, staleOnce = '' }: { valid?: string; cookieOnRest?: boolean; loggedIn?: boolean; staleOnce?: string } = {} ) {
	let stale = staleOnce;
	const fetch = vi.fn( async ( input: RequestInfo | URL, init?: RequestInit ): Promise<Response> => {
		const url = String( input );
		const nonce = ( init?.headers as Record<string, string> | undefined )?.[ 'X-WP-Nonce' ];
		if ( url.includes( 'action=rest-nonce' ) ) {
			return loggedIn ? new Response( valid ) : new Response( '0', { status: 400 } );
		}
		const bridge = url.includes( 'admin-ajax.php' );
		if ( bridge && ! loggedIn ) {
			return respond( 401, { code: 'rest_not_logged_in', message: 'Your WordPress login has ended. Please log in again and reopen this page.' } );
		}
		if ( ( ! bridge && ! cookieOnRest ) || ! loggedIn || nonce !== valid ) {
			return bridge ? respond( 403, { code: 'rest_cookie_invalid_nonce', message: 'Your WordPress login could not be confirmed.' } ) : cookieFailed();
		}
		// A cache that hands out an old answer, with the X-WP-Nonce of an old login.
		const header = stale || valid;
		stale = '';
		return new Response( JSON.stringify( { id: 7, items: [], problems: [], missingRights: [], form: {} } ), { status: 200, headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': header } } );
	} );
	const urls = (): string[] => ( fetch.mock.calls as unknown as Array<[ string ]> ).map( ( [ url ] ) => url.replace( /&_=\d+/, '' ) );
	return { fetch, urls };
}


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
		const wp = site( { cookieOnRest: false } );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'f1e2d3c4b5', fetch: wp.fetch, ajax: AJAX } );
		await expect( api.get( 7 ) ).resolves.toMatchObject( { id: 7 } );
		await api.list();
		expect( wp.urls() ).toEqual( [
			'/wp-json/funnelforms/v1/admin/forms/7',
			// The nonce is right: no second try with it.
			'/wp-admin/admin-ajax.php?action=rest-nonce',
			'/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms%2F7&_wpnonce=f1e2d3c4b5',
			'/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms&_wpnonce=f1e2d3c4b5',
		] );
		expect( usesBridge() ).toBe( true );
	} );

	it( 'keeps the body and the method override of a change', async () => {
		const wp = site( { cookieOnRest: false } );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'f1e2d3c4b5', fetch: wp.fetch, ajax: AJAX } );
		await api.saveDraft( 7, { title: 'x' } as never );
		const [ url, init ] = wp.fetch.mock.calls[ 2 ] as unknown as [ string, RequestInit ];
		expect( url ).toBe( '/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms%2F7%2Fdraft&_method=PUT&_wpnonce=f1e2d3c4b5' );
		expect( init.method ).toBe( 'POST' );
		expect( init.headers ).toMatchObject( { 'X-HTTP-Method-Override': 'PUT', 'X-WP-Nonce': 'f1e2d3c4b5' } );
		expect( JSON.parse( String( init.body ) ) ).toEqual( { document: { title: 'x' } } );
	} );

	it( 'replaces a stale nonce once and stays on /wp-json/ where the cookie arrives', async () => {
		const wp = site();
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'a0a0a0a0a0', fetch: wp.fetch, ajax: AJAX } );
		await expect( api.get( 7 ) ).resolves.toMatchObject( { id: 7 } );
		await api.list();
		expect( wp.urls() ).toEqual( [
			'/wp-json/funnelforms/v1/admin/forms/7',
			'/wp-admin/admin-ajax.php?action=rest-nonce',
			'/wp-json/funnelforms/v1/admin/forms/7',
			// The adapter took the fresh nonce of the answer.
			'/wp-json/funnelforms/v1/admin/forms',
		] );
		expect( ( wp.fetch.mock.calls[ 3 ] as unknown as [ string, RequestInit ] )[ 1 ].headers ).toMatchObject( { 'X-WP-Nonce': 'f1e2d3c4b5' } );
		expect( usesBridge() ).toBe( false );
	} );

	it( 'gets past a stale nonce on the bridge: the report of 3 November ("login could not be verified" in the preview)', async () => {
		// The cookie does not reach /wp-json/, and a cached answer hands the editor an old nonce.
		const wp = site( { cookieOnRest: false, staleOnce: 'a0a0a0a0a0' } );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'f1e2d3c4b5', fetch: wp.fetch, ajax: AJAX } );
		await api.get( 7 );
		// The form opens; the preview then carries the old nonce.
		await expect( api.preview( 7 ) ).resolves.toBeDefined();
		expect( wp.urls().slice( 3 ) ).toEqual( [
			'/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms%2F7%2Fpreview&_wpnonce=a0a0a0a0a0',
			'/wp-admin/admin-ajax.php?action=rest-nonce',
			'/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fadmin%2Fforms%2F7%2Fpreview&_wpnonce=f1e2d3c4b5',
		] );
	} );

	it( 'asks for one fresh nonce for requests that need it at the same time', async () => {
		const wp = site();
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'a0a0a0a0a0', fetch: wp.fetch, ajax: AJAX } );
		await Promise.all( [ api.get( 7 ), api.list(), api.lock( 7 ) ] );
		expect( wp.urls().filter( ( url ) => url.includes( 'rest-nonce' ) ) ).toHaveLength( 1 );
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
		const wp = site( { loggedIn: false } );
		const api = new WpRestAdapter( { root: '/wp-json/', nonce: 'f1e2d3c4b5', fetch: wp.fetch, ajax: AJAX } );
		const error = ( await api.get( 7 ).catch( ( e: unknown ) => e ) ) as ApiError;
		expect( error.message ).toBe( 'Your WordPress login has ended. Please log in again and reopen this page.' );
		expect( usesBridge() ).toBe( false );
		await api.get( 7 ).catch( () => null );
		expect( wp.urls()[ 3 ] ).toBe( '/wp-json/funnelforms/v1/admin/forms/7' );
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
		const wp = site( { cookieOnRest: false } );
		const client = new AppointmentsClient( '/wp-json/', 'f1e2d3c4b5', wp.fetch, AJAX );
		await expect( client.list( '2026-11-01', '2026-11-30' ) ).resolves.toMatchObject( { id: 7 } );
		expect( wp.urls()[ 2 ] ).toContain( '/wp-admin/admin-ajax.php?action=funnelforms_rest&rest_route=%2Ffunnelforms%2Fv1%2Fappointments' );
	} );
} );
