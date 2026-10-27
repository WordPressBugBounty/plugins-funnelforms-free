import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAdsConversions, type AdsConversion } from '../src/ads';
import { setPrivacy } from '../src/consent';

const conversion = ( over: Partial<AdsConversion> = {} ): AdsConversion => ( { platform: 'googleAds', sendTo: 'AW-123456789/AbC', value: null, currency: null, requireConsent: true, enhanced: false, ...over } );

describe( 'Google Ads conversions', () => {
	afterEach( () => {
		delete window.gtag;
		setPrivacy();
	} );

	it( 'sends nothing without a Google tag on the page', () => {
		expect( sendAdsConversions( [ conversion() ], 'e1', {}, true ) ).toBe( 0 );
	} );

	it( 'sends with the value and the event ID as transaction ID, as far as the consent allows', () => {
		const gtag = vi.fn();
		window.gtag = gtag;
		const list = [ conversion( { value: 1234.5, currency: 'CHF' } ), conversion( { sendTo: 'AW-123456789/Def', requireConsent: false } ) ];
		expect( sendAdsConversions( list, 'ffx-1-9', {}, true ) ).toBe( 2 );
		expect( gtag.mock.calls ).toEqual( [
			[ 'event', 'conversion', { send_to: 'AW-123456789/AbC', transaction_id: 'ffx-1-9', value: 1234.5, currency: 'CHF' } ],
			[ 'event', 'conversion', { send_to: 'AW-123456789/Def', transaction_id: 'ffx-1-9' } ],
		] );
		// The EU privacy mode requires consent for every conversion: without a consent API or refused, nothing.
		gtag.mockClear();
		expect( sendAdsConversions( list, 'e', {}, null ) ).toBe( 0 );
		expect( sendAdsConversions( list, 'e', {}, false ) ).toBe( 0 );
		expect( gtag ).not.toHaveBeenCalled();
	} );

	it( 'sends without a consent API in the global privacy mode only where consent is not required, never against a refusal', () => {
		const gtag = vi.fn();
		window.gtag = gtag;
		setPrivacy( 'global' );
		const list = [ conversion(), conversion( { sendTo: 'AW-123456789/Def', requireConsent: false } ) ];
		expect( sendAdsConversions( list, 'e', {}, null ) ).toBe( 1 );
		expect( gtag.mock.calls.map( ( c ) => ( c[ 2 ] as { send_to: string } ).send_to ) ).toEqual( [ 'AW-123456789/Def' ] );
		expect( sendAdsConversions( list, 'e', {}, false ) ).toBe( 0 );
		expect( sendAdsConversions( list, 'e', {}, true ) ).toBe( 2 );
	} );

	it( 'gives the tag e-mail and phone number for enhanced conversions only with marketing consent', () => {
		const gtag = vi.fn();
		window.gtag = gtag;
		const contact = { email: 'erika@example.org', phone: '+49 (171) 123-4567' };
		sendAdsConversions( [ conversion( { enhanced: true, requireConsent: false } ) ], 'e', contact, null );
		expect( gtag ).not.toHaveBeenCalled();
		sendAdsConversions( [ conversion( { enhanced: true } ) ], 'e', contact, true );
		expect( gtag.mock.calls[ 0 ] ).toEqual( [ 'set', 'user_data', { email: 'erika@example.org', phone_number: '+491711234567' } ] );
		// A number without country code cannot be matched and stays out.
		gtag.mockClear();
		sendAdsConversions( [ conversion( { enhanced: true } ) ], 'e', { phone: '0171 1234567' }, true );
		expect( gtag.mock.calls.map( ( c ) => c[ 0 ] ) ).toEqual( [ 'event' ] );
	} );
} );
