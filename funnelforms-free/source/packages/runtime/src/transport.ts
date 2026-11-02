/**
 * Sends the requests of a form to the plugin: to the REST API, and through admin-ajax.php when the
 * site refuses the REST API to visitors (Http\FormBridge in the plugin).
 *
 * Security plugins ("REST API only for logged-in users"), firewall rules of the host or a REST API
 * switched off answer with a refusal that does not come from Funnelforms: an error of the REST API
 * itself (code rest_…, without `ok`), an HTML page, or no answer the browser can read. Funnelforms 3
 * sent everything to admin-ajax.php, so such sites lost every entry with the update to 5.0. Such a
 * request goes once more to the bridge, and every later request of the form on this page goes there
 * straight away. An answer of a Funnelforms route (always with `ok` when it fails) is never repeated.
 */

/** Statuses with which a site refuses the REST API. */
const REFUSED = [ 401, 403, 404, 405, 406, 415, 501 ];

/** Where the routes of a form are: REST base and bridge address (RuntimeConfig). */
export interface Target {
	endpoint: string;
	bridge?: string;
}

/**
 * REST bases whose requests go to the bridge on this page; shared by the runtime and its chunks,
 * which are scripts of their own.
 */
function bridged(): Set<string> {
	const global = globalThis as { ffxBridged?: Set<string> };
	global.ffxBridged ??= new Set<string>();
	return global.ffxBridged;
}

/** Whether the requests of a form go through the bridge now (tests, diagnostics). */
export function viaBridge( endpoint: string ): boolean {
	return bridged().has( endpoint );
}

/** Forgets which forms use the bridge (tests). */
export function resetBridges(): void {
	bridged().clear();
}

export interface SendInit {
	body: string | FormData;
	keepalive?: boolean;
	signal?: AbortSignal;
}

/**
 * POSTs to a route of a form (path below the REST base, e.g. "/entries") and answers the response.
 * Rejects only when neither way gives an answer.
 */
export async function send( target: Target, path: string, init: SendInit ): Promise<Response> {
	const { endpoint, bridge } = target;
	if ( bridge && bridged().has( endpoint ) ) {
		return toBridge( bridge, path, init );
	}
	let response: Response;
	try {
		response = await fetch( endpoint + path, request( init, false ) );
	} catch ( error ) {
		if ( ! bridge || init.signal?.aborted ) {
			throw error;
		}
		// No answer at all: a firewall that drops the connection, or one without CORS headers.
		bridged().add( endpoint );
		try {
			return await toBridge( bridge, path, init );
		} catch {
			bridged().delete( endpoint );
			throw error;
		}
	}
	if ( ! bridge || ! ( await refused( response ) ) ) {
		return response;
	}
	bridged().add( endpoint );
	try {
		return await toBridge( bridge, path, init );
	} catch {
		// The bridge is blocked too: the first answer explains more than a network error.
		bridged().delete( endpoint );
		return response;
	}
}

function toBridge( bridge: string, path: string, init: SendInit ): Promise<Response> {
	return fetch( bridge + encodeURIComponent( path ), request( init, true ) );
}

function request( init: SendInit, bridge: boolean ): RequestInit {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if ( typeof init.body === 'string' ) {
		// text/plain needs no preflight request; the bridge reads the body as JSON.
		headers[ 'Content-Type' ] = bridge ? 'text/plain;charset=UTF-8' : 'application/json';
	}
	return {
		method: 'POST',
		headers,
		body: init.body,
		credentials: 'omit',
		...( init.keepalive ? { keepalive: true } : {} ),
		...( init.signal ? { signal: init.signal } : {} ),
	};
}

/** Whether an answer is a refusal of the site, not of a Funnelforms route. */
export async function refused( response: Response ): Promise<boolean> {
	if ( response.ok && ! response.redirected ) {
		return false;
	}
	let data: unknown;
	try {
		data = await response.clone().json();
	} catch {
		// An HTML page of a firewall, a login page after a redirect, or a 404 page of the theme.
		return response.redirected || REFUSED.includes( response.status );
	}
	if ( response.ok || ! REFUSED.includes( response.status ) || typeof data !== 'object' || data === null ) {
		return false;
	}
	const body = data as { ok?: unknown; code?: unknown };
	return ! ( 'ok' in body ) && typeof body.code === 'string' && body.code.startsWith( 'rest_' );
}
