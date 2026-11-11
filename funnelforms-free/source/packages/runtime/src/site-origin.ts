import { allowed, BORLABS_SAVED, setPrivacy } from './consent';
import { forgetOrigin, rememberOrigin } from './origin';

/**
 * The small script on every page of the website while it remembers the origin of visits
 * (Frontend\Origin → origin.js): notes where the visit began, so that a form on a later page
 * knows the source (origin.ts). Pages with a form do the same in the runtime.
 */
declare global {
	interface Window {
		/** From the plugin (Frontend\Origin): the privacy mode of the site, as config.privacy of the forms. */
		funnelformsOrigin?: { privacy?: string };
	}
}

if ( typeof window !== 'undefined' ) {
	setPrivacy( window.funnelformsOrigin?.privacy );
	const note = (): void => void rememberOrigin( window.location.href, document.referrer );
	note();
	// A choice in the cookie banner on this page: remember this page's origin after a yes, forget after a no.
	const changed = (): void => ( allowed( 'statistics' ) ? note() : forgetOrigin() );
	window.addEventListener( BORLABS_SAVED, changed );
	// The WP Consent API (Complianz, CookieYes, Real Cookie Banner …).
	document.addEventListener( 'wp_listen_for_consent_change', changed );
}
