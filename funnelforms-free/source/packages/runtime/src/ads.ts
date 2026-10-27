import { granted } from './consent';

/**
 * Google Ads conversions through the site's Google tag (gtag.js), once the plugin stored the entry:
 * with the value it computed, the entry's event ID as transaction ID (Google drops repeats) and,
 * for enhanced conversions, the e-mail address and phone number of the contact step, which the tag
 * hashes before sending. Nothing is loaded: without a Google tag on the page nothing is sent.
 */
export interface AdsConversion {
	platform: 'googleAds';
	sendTo: string;
	value: number | null;
	currency: string | null;
	requireConsent: boolean;
	enhanced: boolean;
}

declare global {
	interface Window {
		gtag?: ( ...args: unknown[] ) => void;
	}
}

/** Sends the conversions the consent allows; returns how many were sent. */
export function sendAdsConversions( conversions: AdsConversion[] | undefined, eventId: string, contact: { email?: string; phone?: string }, marketing: boolean | null ): number {
	const gtag = window.gtag;
	if ( typeof gtag !== 'function' ) {
		return 0;
	}
	// A conversion that requires consent needs a yes (the EU privacy mode requires it for all). One
	// that does not goes out in the global mode unless the visitor refused (or Global Privacy Control).
	let sent = 0;
	for ( const c of conversions ?? [] ) {
		if ( c.platform !== 'googleAds' || ! ( c.requireConsent ? marketing === true : granted( marketing ) ) ) {
			continue;
		}
		if ( c.enhanced ) {
			const userData: Record<string, string> = {};
			if ( contact.email ) {
				userData.email = contact.email;
			}
			// Google matches phone numbers in E.164 only.
			if ( contact.phone && /^\+[1-9][0-9]{6,14}$/.test( contact.phone.replace( /[\s()/-]/g, '' ) ) ) {
				userData.phone_number = contact.phone.replace( /[\s()/-]/g, '' );
			}
			if ( Object.keys( userData ).length > 0 ) {
				gtag( 'set', 'user_data', userData );
			}
		}
		gtag( 'event', 'conversion', { send_to: c.sendTo, transaction_id: eventId, ...( c.value !== null ? { value: c.value, currency: c.currency ?? 'EUR' } : {} ) } );
		sent++;
	}
	return sent;
}
