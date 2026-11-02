/**
 * Second way to the plugin's REST routes, through admin-ajax.php (Http\RestBridge).
 *
 * The admin screens talk to /wp-json/ with the login cookie and the wp_rest nonce. On some sites
 * the cookie never arrives there, and WordPress answers every request with "Cookie check failed"
 * (rest_cookie_invalid_nonce):
 * - the site address and the WordPress address differ (www or not, a subfolder, another domain),
 *   so /wp-json/ lies on another origin than wp-admin and the browser sends no cookie;
 * - a server cache (Varnish, LiteSpeed, nginx) drops cookies on every address outside /wp-admin/.
 * Funnelforms 3.x only used admin-ajax.php and never met this; sites that worked with 3.x broke
 * with the update to 5.0. admin-ajax.php lies below /wp-admin/, where the cookie always arrives.
 *
 * restFetch() wraps fetch: a request whose answer says the login did not arrive is sent once
 * more through the bridge, and from then on every request of the page goes there. A REST root on
 * another origin goes to the bridge right away, since the browser never sends the cookie there.
 */

/** Action of the bridge in admin-ajax.php (Http\RestBridge::ACTION). */
export const BRIDGE_ACTION = 'funnelforms_rest';

/** Whether a request of this page already went through the bridge; then all of them do. */
let bridged = false;

/** For tests: forget that the page switched to the bridge. */
export function resetBridge(): void {
	bridged = false;
}

/** Whether the page switched to the bridge. */
export function usesBridge(): boolean {
	return bridged;
}

function here(): string | null {
	const location = ( globalThis as { location?: { href?: string } } ).location;
	return location?.href && /^https?:/.test( location.href ) ? location.href : null;
}

/**
 * Address of admin-ajax.php: WordPress prints it as ajaxurl on every admin page; otherwise next
 * to the current admin page. Null outside wp-admin.
 */
export function ajaxUrl(): string | null {
	const given = ( globalThis as { ajaxurl?: unknown } ).ajaxurl;
	if ( 'string' === typeof given && '' !== given ) {
		return given;
	}
	const page = here();
	if ( ! page ) {
		return null;
	}
	const url = new URL( page );
	const at = url.pathname.indexOf( '/wp-admin/' );
	return at < 0 ? null : url.pathname.slice( 0, at ) + '/wp-admin/admin-ajax.php';
}

/**
 * The address of a request through the bridge: route and query of the REST address, below
 * admin-ajax.php. Null when the address is not below the REST root.
 */
export function bridgeUrl( address: string, root: string, ajax: string, nonce?: string ): string | null {
	const base = here() ?? 'http://localhost/';
	const url = new URL( address, base );
	let route: string;
	if ( url.searchParams.has( 'rest_route' ) ) {
		route = url.searchParams.get( 'rest_route' ) ?? '/';
		url.searchParams.delete( 'rest_route' );
	} else {
		const prefix = new URL( root, base ).pathname.replace( /\/?$/, '/' );
		if ( ! url.pathname.startsWith( prefix ) ) {
			return null;
		}
		route = '/' + url.pathname.slice( prefix.length );
	}
	const target = new URL( ajax, base );
	target.searchParams.set( 'action', BRIDGE_ACTION );
	target.searchParams.set( 'rest_route', route );
	url.searchParams.forEach( ( value, key ) => target.searchParams.append( key, value ) );
	// Also in the address, for hosts that strip the header.
	if ( nonce ) {
		target.searchParams.set( '_wpnonce', nonce );
	}
	return /^https?:/.test( ajax ) ? target.toString() : target.pathname + target.search;
}

function sameOrigin( address: string ): boolean {
	const page = here();
	if ( ! page || ! /^https?:/.test( address ) ) {
		return true;
	}
	return new URL( address ).origin === new URL( page ).origin;
}

/** Whether WordPress answered that the login did not reach the REST API. */
async function loginMissing( response: Response ): Promise<boolean> {
	// 401 is what WordPress answers a visitor who is not logged in; a logged-in user without the right gets 403.
	if ( 401 !== response.status && 403 !== response.status ) {
		return false;
	}
	let code = '';
	try {
		const data = ( await response.clone().json() ) as { code?: unknown } | null;
		code = 'string' === typeof data?.code ? data.code : '';
	} catch {
		return false;
	}
	return 'rest_cookie_invalid_nonce' === code || ( 401 === response.status && '' !== code );
}

function nonceOf( init: RequestInit | undefined ): string | undefined {
	const headers = init?.headers;
	if ( headers instanceof Headers ) {
		return headers.get( 'X-WP-Nonce' ) ?? undefined;
	}
	if ( headers && ! Array.isArray( headers ) ) {
		return ( headers as Record<string, string> )[ 'X-WP-Nonce' ];
	}
	return undefined;
}

/**
 * fetch for the REST routes below `root`, with the bridge as second way. `ajax` is the address
 * of admin-ajax.php (ajaxUrl() when left out); without one it is plain fetch.
 */
export function restFetch( root: string, inner: typeof fetch = ( input, init ) => fetch( input, init ), ajax: string | null = ajaxUrl() ): typeof fetch {
	return async ( input, init ) => {
		const address = 'string' === typeof input ? input : input instanceof URL ? input.toString() : input.url;
		const bridge = ajax ? bridgeUrl( address, root, ajax, nonceOf( init ) ) : null;
		if ( ! bridge ) {
			return inner( input, init );
		}
		if ( bridged || ! sameOrigin( address ) ) {
			bridged = true;
			return inner( bridge, init );
		}
		const response = await inner( input, init );
		if ( ! ( await loginMissing( response ) ) ) {
			return response;
		}
		const second = await inner( bridge, init );
		// The bridge answers like the REST API; when it does not know the login either, the page stays on /wp-json/.
		if ( ! ( await loginMissing( second ) ) ) {
			bridged = true;
		}
		return second;
	};
}
