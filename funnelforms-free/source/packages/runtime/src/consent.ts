import { h } from './dom';

/**
 * Consent and pixel identifiers for the plugin's server-side conversions (Meta, GA4, TikTok).
 * Consent comes from the WP Consent API, which cookie banners such as Complianz, CookieYes or Real
 * Cookie Banner fill. Identifiers of a category are read only when the visitor allowed that
 * category. Without a consent tool the site's privacy mode decides: in the EU mode (default) no
 * answer counts as no, in the global mode as yes. The unrestricted mode, which the site owner
 * chooses at their own risk, counts every category as allowed and ignores the consent tool and
 * Global Privacy Control.
 */
export interface TrackingInfo {
	consent: { marketing: boolean | null; statistics: boolean | null };
	fbp?: string;
	fbc?: string;
	gaClientId?: string;
	/** Session ID per GA4 stream, keyed by the measurement ID without "G-" (cookie _ga_<ID>). */
	gaSessions?: Record<string, string>;
	ttp?: string;
	ttclid?: string;
}

declare global {
	interface Window {
		wp_has_consent?: ( category: string ) => boolean;
	}
	interface Navigator {
		globalPrivacyControl?: boolean;
	}
}

let optOut = false;
let unrestricted = false;

/** Sets the site's privacy mode (config.privacy): 'global' is opt-out, 'open' unrestricted, anything else the EU mode. */
export function setPrivacy( mode?: string ): void {
	unrestricted = mode === 'open';
	optOut = mode === 'global' || unrestricted;
}

/**
 * The consent tool's answer for a category, or null without a tool. In the global mode Global
 * Privacy Control is a no for marketing and statistics, whatever the tool says (CPRA).
 */
function answer( category: string ): boolean | null {
	if ( unrestricted ) {
		return true;
	}
	const has = window.wp_has_consent;
	return optOut && navigator.globalPrivacyControl === true ? false : typeof has === 'function' ? Boolean( has( category ) ) : null;
}

/** Whether an answer allows: yes or no as given; no answer is a no in the EU mode, a yes in the global mode. */
export function granted( given: boolean | null ): boolean {
	return given ?? optOut;
}

function cookie( cookies: string, name: string ): string | undefined {
	for ( const part of cookies.split( ';' ) ) {
		const [ key, ...value ] = part.trim().split( '=' );
		if ( key === name ) {
			return decodeURIComponent( value.join( '=' ) );
		}
	}
	return undefined;
}

/**
 * The current GA4 session of each stream on the page, so that a lead sent by the plugin's server
 * counts in the visitor's session and keeps its traffic source (without it GA4 reports it as
 * Unassigned). _ga_<ID> is GS1.1.<session>.<count>.… or, since 2025, GS2.1.s<session>$o<count>$….
 */
function gaSessions( cookies: string ): Record<string, string> {
	const out: Record<string, string> = {};
	for ( const part of cookies.split( ';' ) ) {
		const [ key, ...value ] = part.trim().split( '=' );
		const stream = /^_ga_([A-Z0-9]{4,20})$/.exec( key ?? '' )?.[ 1 ];
		if ( ! stream || Object.keys( out ).length >= 5 ) {
			continue;
		}
		const raw = decodeURIComponent( value.join( '=' ) );
		const session = raw.startsWith( 'GS1.' ) ? raw.split( '.' )[ 2 ] : /^GS2\.[0-9]+\.s([0-9]+)/.exec( raw )?.[ 1 ];
		if ( session && /^[0-9]{6,20}$/.test( session ) ) {
			out[ stream ] = session;
		}
	}
	return out;
}

export function trackingInfo( search: string, cookies: string, now: number = Date.now() ): TrackingInfo {
	const consent = { marketing: answer( 'marketing' ), statistics: answer( 'statistics' ) };
	const params = new URLSearchParams( search );
	const ids: Omit<TrackingInfo, 'consent'> = {};
	if ( granted( consent.marketing ) ) {
		ids.fbp = cookie( cookies, '_fbp' );
		const fbclid = params.get( 'fbclid' );
		ids.fbc = cookie( cookies, '_fbc' ) ?? ( fbclid ? `fb.1.${ now }.${ fbclid }` : undefined );
		ids.ttp = cookie( cookies, '_ttp' );
		ids.ttclid = params.get( 'ttclid' ) ?? undefined;
	}
	if ( granted( consent.statistics ) ) {
		// _ga is GA1.1.<random>.<time>; the client ID is the last two parts.
		const ga = cookie( cookies, '_ga' )?.split( '.' );
		ids.gaClientId = ga && ga.length >= 4 ? ga.slice( -2 ).join( '.' ) : undefined;
		const sessions = gaSessions( cookies );
		ids.gaSessions = Object.keys( sessions ).length > 0 ? sessions : undefined;
	}
	// Identifiers that are undefined are left out of the JSON.
	return { consent, ...ids };
}

/** Whether a category is allowed (WP Consent API, Global Privacy Control and the privacy mode). */
export function allowed( category: string ): boolean {
	return granted( answer( category ) );
}

/**
 * Scripts of other services (Google Maps, captchas) load at once only where marketing is allowed
 * (allowed()); otherwise after a click on a button that says what loads from where. Returns
 * that button, or null when loading started. After the click the focus goes to target.
 */
export function loadWithConsent( label: string, load: () => void, target: HTMLElement ): HTMLElement | null {
	if ( allowed( 'marketing' ) ) {
		load();
		return null;
	}
	const button = h( 'button', { type: 'button', class: 'ffx-button ffx-consent-load' }, label );
	button.addEventListener( 'click', () => {
		target.tabIndex = -1;
		button.replaceWith( target );
		load();
		target.focus();
	} );
	return button;
}
