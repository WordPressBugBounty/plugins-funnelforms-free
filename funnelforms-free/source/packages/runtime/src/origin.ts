import { allowed } from './consent';

/**
 * Where a visit to the website began, so that a form on another page than the one an ad, a
 * newsletter or a search led to still knows the source of its lead. Without it a visitor who
 * comes from an ad to the home page and sends the form on the contact page counts as "Your
 * website", and the lead has no UTM values.
 *
 * Kept only while the site remembers the origin (setting of Frontend\Origin) and the visitor
 * allowed statistics, in sessionStorage: it ends with the tab and is never sent anywhere but
 * with the form. Of the page address only the marketing parameters are kept, of the referrer
 * only scheme and host, as the plugin keeps nothing else of them (TrafficSources).
 */
export interface Origin {
	/** Scheme and host of the website the visitor came from, such as "https://www.google.com/"; '' for none. */
	referrer: string;
	/** The marketing parameters of the page address (utm_*, ad click ids), URL encoded, without "?". */
	query: string;
}

export const ORIGIN_KEY = 'ffx_origin';

/** Ad click ids the plugin keeps besides utm_* (EntryConverter::utm()). */
const CLICK_IDS = [ 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid' ];

/** Longest value kept of one parameter; as the plugin keeps at most 2000 characters of a query. */
const MAX_VALUE = 500;

const MAX_QUERY = 2000;

/** Only the marketing parameters of a query (with or without "?"), URL encoded. */
export function campaignQuery( search: string ): string {
	const out = new URLSearchParams();
	new URLSearchParams( search ).forEach( ( value, key ) => {
		if ( value !== '' && ( key.startsWith( 'utm_' ) || CLICK_IDS.includes( key ) ) ) {
			out.append( key, value.slice( 0, MAX_VALUE ) );
		}
	} );
	return out.toString().slice( 0, MAX_QUERY );
}

const bare = ( host: string ): string => host.toLowerCase().replace( /^www\./, '' );

/**
 * The origin a page view brings itself: the marketing parameters of its address, and the website
 * it came from unless that is this one. Null for a page reached from this website or directly.
 */
export function arrival( href: string, referrer: string ): Origin | null {
	let page: URL;
	try {
		page = new URL( href );
	} catch {
		return null;
	}
	let from = '';
	try {
		const ref = new URL( referrer );
		if ( /^https?:$/.test( ref.protocol ) && bare( ref.hostname ) !== bare( page.hostname ) ) {
			from = ref.origin + '/';
		}
	} catch {
		// No referrer, or none the browser tells.
	}
	const query = campaignQuery( page.search );
	return query || from ? { referrer: from, query } : null;
}

function read( storage: Storage ): Origin | null {
	try {
		const value = JSON.parse( storage.getItem( ORIGIN_KEY ) ?? 'null' ) as Partial<Origin> | null;
		if ( value && typeof value.referrer === 'string' && typeof value.query === 'string' && ( value.referrer || value.query ) ) {
			return { referrer: value.referrer.slice( 0, MAX_QUERY ), query: campaignQuery( value.query ) };
		}
	} catch {
		// Something else under the key.
	}
	return null;
}

function session(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		// Storage blocked by the browser.
		return null;
	}
}

/**
 * Remembers the origin of this page view for the visit while statistics are allowed: a new one
 * (marketing parameters, another website) replaces the one before, as in Google Analytics, a page
 * of this website or a direct visit keeps it. Returns the origin remembered from an earlier page
 * when this page view has none of its own; null otherwise. Without consent nothing is read or
 * written; forget is for a refusal in the cookie banner.
 */
export function rememberOrigin( href: string, referrer: string, storage: Storage | null = session() ): Origin | null {
	if ( ! storage || ! allowed( 'statistics' ) ) {
		return null;
	}
	const own = arrival( href, referrer );
	try {
		if ( own ) {
			storage.setItem( ORIGIN_KEY, JSON.stringify( own ) );
			return null;
		}
	} catch {
		// Storage full or blocked.
		return null;
	}
	return read( storage );
}

/** Deletes the remembered origin, as after a refusal in the cookie banner. */
export function forgetOrigin( storage: Storage | null = session() ): void {
	try {
		storage?.removeItem( ORIGIN_KEY );
	} catch {
		// Nothing stored where storage is blocked.
	}
}
