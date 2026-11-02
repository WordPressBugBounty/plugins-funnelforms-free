import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../src/api';
import { refused, resetBridges, send, viaBridge } from '../src/transport';

const endpoint = 'https://example.org/wp-json/funnelforms/v1/forms/f1';
const bridge = 'https://example.org/wp-admin/admin-ajax.php?action=funnelforms_form_api&rest_route=%2Ffunnelforms%2Fv1%2Fforms%2Ff1';

const json = ( body: unknown, status = 200 ): Response => new Response( JSON.stringify( body ), { status, headers: { 'Content-Type': 'application/json' } } );
const html = ( status: number ): Response => new Response( '<html><body>Forbidden</body></html>', { status, headers: { 'Content-Type': 'text/html' } } );

type Call = [ string, RequestInit ];
const calls = (): Call[] => ( fetch as unknown as { mock: { calls: Call[] } } ).mock.calls;
const call = ( index: number ): Call => calls()[ index ] as Call;

describe( 'transport', () => {
	beforeEach( () => resetBridges() );
	afterEach( () => vi.unstubAllGlobals() );

	it( 'keeps to the REST API when it answers', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async () => json( { ok: true, entry: 5 }, 201 ) ) );
		const response = await send( { endpoint, bridge }, '/entries', { body: '{}' } );
		expect( response.status ).toBe( 201 );
		expect( calls() ).toHaveLength( 1 );
		expect( call( 0 )[ 0 ] ).toBe( endpoint + '/entries' );
		expect( viaBridge( endpoint ) ).toBe( false );
	} );

	it( 'never repeats an answer of a Funnelforms route', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async () => json( { ok: false, code: 'token_used' }, 403 ) ) );
		const response = await send( { endpoint, bridge }, '/entries', { body: '{}' } );
		expect( response.status ).toBe( 403 );
		expect( calls() ).toHaveLength( 1 );
	} );

	it( 'sends a request the site refused through the bridge, and the later ones straight there', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async ( url: string ) => url.startsWith( endpoint )
			? json( { code: 'rest_cannot_access', message: 'Only authenticated users can access the REST API.', data: { status: 401 } }, 401 )
			: json( { ok: true, token: 't' } ) ) );
		const first = await send( { endpoint, bridge }, '/token', { body: '{"a":1}' } );
		expect( await first.json() ).toEqual( { ok: true, token: 't' } );
		expect( call( 1 )[ 0 ] ).toBe( bridge + '%2Ftoken' );
		// JSON as text/plain: no preflight request; no cookies, as to the REST API.
		expect( ( call( 1 )[ 1 ].headers as Record<string, string> )[ 'Content-Type' ] ).toBe( 'text/plain;charset=UTF-8' );
		expect( call( 1 )[ 1 ].credentials ).toBe( 'omit' );
		expect( call( 1 )[ 1 ].body ).toBe( '{"a":1}' );
		expect( viaBridge( endpoint ) ).toBe( true );

		await send( { endpoint, bridge }, '/entries', { body: '{}' } );
		expect( calls() ).toHaveLength( 3 );
		expect( call( 2 )[ 0 ] ).toBe( bridge + '%2Fentries' );
	} );

	it( 'uses the bridge when a firewall answers with an HTML page or drops the request', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async ( url: string ) => url.startsWith( endpoint ) ? html( 403 ) : json( { ok: true } ) ) );
		expect( ( await send( { endpoint, bridge }, '/entries', { body: '{}' } ) ).status ).toBe( 200 );
		expect( call( 1 )[ 0 ] ).toBe( bridge + '%2Fentries' );

		resetBridges();
		vi.stubGlobal( 'fetch', vi.fn( async ( url: string ) => {
			if ( url.startsWith( endpoint ) ) {
				throw new TypeError( 'Failed to fetch' );
			}
			return json( { ok: true } );
		} ) );
		expect( ( await send( { endpoint, bridge }, '/entries', { body: '{}' } ) ).status ).toBe( 200 );
	} );

	it( 'gives the first answer when the bridge is blocked as well, and tries the REST API again next time', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async ( url: string ) => {
			if ( url.startsWith( bridge ) ) {
				throw new TypeError( 'Failed to fetch' );
			}
			return html( 403 );
		} ) );
		expect( ( await send( { endpoint, bridge }, '/entries', { body: '{}' } ) ).status ).toBe( 403 );
		expect( viaBridge( endpoint ) ).toBe( false );
	} );

	it( 'without a bridge only the REST API is asked', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async () => html( 403 ) ) );
		expect( ( await send( { endpoint }, '/entries', { body: '{}' } ) ).status ).toBe( 403 );
		expect( calls() ).toHaveLength( 1 );
	} );

	it( 'tells a refusal of the site from an answer of the plugin', async () => {
		expect( await refused( json( { ok: true }, 201 ) ) ).toBe( false );
		expect( await refused( json( { ok: false, code: 'invalid_answers' }, 422 ) ) ).toBe( false );
		expect( await refused( json( { ok: false, code: 'form_unavailable' }, 404 ) ) ).toBe( false );
		// Argument checks of the REST API run on the bridge just the same.
		expect( await refused( json( { code: 'rest_invalid_param' }, 400 ) ) ).toBe( false );
		// A crash or an overloaded server: not repeated, the entry may have been stored.
		expect( await refused( html( 500 ) ) ).toBe( false );
		expect( await refused( html( 503 ) ) ).toBe( false );
		expect( await refused( json( { code: 'rest_not_logged_in' }, 401 ) ) ).toBe( true );
		expect( await refused( json( { code: 'rest_no_route' }, 404 ) ) ).toBe( true );
		expect( await refused( json( { code: 'rest_disabled' }, 403 ) ) ).toBe( true );
		expect( await refused( html( 406 ) ) ).toBe( true );
	} );

	it( 'lets a form submit on a site that refuses the REST API to visitors', async () => {
		vi.stubGlobal( 'fetch', vi.fn( async ( url: string ) => {
			if ( url.startsWith( endpoint ) ) {
				return json( { code: 'rest_cannot_access', data: { status: 401 } }, 401 );
			}
			return url.endsWith( '%2Ftoken' ) ? json( { token: 'tok' } ) : json( { ok: true, entry: 9 }, 201 );
		} ) );
		vi.useFakeTimers();
		const api = new Api( endpoint, '', bridge );
		const pending = api.submit<{ ok: true; entry: number }>( { answers: {} } );
		await vi.runAllTimersAsync();
		const result = await pending;
		vi.useRealTimers();
		expect( result.status ).toBe( 201 );
		expect( result.data ).toEqual( { ok: true, entry: 9 } );
		expect( JSON.parse( calls().at( -1 )?.[ 1 ].body as string ).token ).toBe( 'tok' );
		// The REST API was asked once; everything after that went to the bridge.
		expect( calls().filter( ( c ) => c[ 0 ].startsWith( endpoint ) ) ).toHaveLength( 1 );
	} );
} );
