import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowed, BORLABS_SAVED, loadWithConsent, setPrivacy, trackingInfo } from '../src/consent';

afterEach( () => {
	delete window.wp_has_consent;
	delete window.BorlabsCookie;
	setPrivacy();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
} );

const gpc = (): void => {
	vi.stubGlobal( 'navigator', { ...navigator, globalPrivacyControl: true } );
};

describe( 'tracking for server-side conversions', () => {

	const cookies = '_fbp=fb.1.1700000000000.123456789; _ga=GA1.1.987654321.1700000000; _ttp=abc_DEF-1; other=x';

	it( 'reads no identifiers without a consent API', () => {
		expect( trackingInfo( '?fbclid=IwAR0x&ttclid=E.C.P', cookies, 1700000000123 ) ).toEqual( { consent: { marketing: null, statistics: null } } );
	} );

	it( 'reads the identifiers of the categories the visitor allowed', () => {
		window.wp_has_consent = () => true;
		expect( trackingInfo( '?fbclid=IwAR0x&ttclid=E.C.P', cookies, 1700000000123 ) ).toEqual( {
			consent: { marketing: true, statistics: true },
			fbp: 'fb.1.1700000000000.123456789',
			fbc: 'fb.1.1700000000123.IwAR0x',
			ttp: 'abc_DEF-1',
			ttclid: 'E.C.P',
			gaClientId: '987654321.1700000000',
		} );
	} );

	it( 'reads the GA4 session of each stream in the old and the new cookie format', () => {
		window.wp_has_consent = ( category ) => category === 'statistics';
		const ga = '_ga=GA1.1.987654321.1700000000; _ga_ABC123XYZ=GS1.1.1700000100.3.1.1700000200.0.0.0; _ga_NEW9=GS2.1.s1746000000$o3$g1$t1746000100$j60$l0$h0; _ga_BAD=GS1.1.x.1';
		expect( trackingInfo( '', ga ) ).toEqual( {
			consent: { marketing: false, statistics: true },
			gaClientId: '987654321.1700000000',
			gaSessions: { ABC123XYZ: '1700000100', NEW9: '1746000000' },
		} );
		window.wp_has_consent = () => false;
		expect( trackingInfo( '', ga ) ).toEqual( { consent: { marketing: false, statistics: false } } );
	} );

	it( 'leaves out what the visitor refused', () => {
		window.wp_has_consent = ( category ) => category === 'statistics';
		expect( trackingInfo( '?fbclid=IwAR0x', cookies ) ).toEqual( {
			consent: { marketing: false, statistics: true },
			gaClientId: '987654321.1700000000',
		} );
		window.wp_has_consent = () => false;
		expect( trackingInfo( '', cookies ) ).toEqual( { consent: { marketing: false, statistics: false } } );
	} );
} );

describe( 'privacy modes', () => {
	const cookies = '_fbp=fb.1.1700000000000.123456789; _ga=GA1.1.987654321.1700000000';

	it( 'needs a yes of the consent tool in the EU mode, also when the mode is missing or unknown', () => {
		for ( const mode of [ undefined, 'eu', 'other' ] ) {
			setPrivacy( mode );
			expect( allowed( 'marketing' ) ).toBe( false );
			window.wp_has_consent = () => true;
			expect( allowed( 'marketing' ) ).toBe( true );
			delete window.wp_has_consent;
		}
		// Global Privacy Control does not change the EU mode: a yes stays a yes.
		gpc();
		window.wp_has_consent = () => true;
		expect( allowed( 'marketing' ) ).toBe( true );
	} );

	it( 'counts no consent tool as a yes in the global mode, but a no of the tool as a no', () => {
		setPrivacy( 'global' );
		expect( allowed( 'marketing' ) ).toBe( true );
		expect( trackingInfo( '', cookies ) ).toEqual( {
			consent: { marketing: null, statistics: null },
			fbp: 'fb.1.1700000000000.123456789',
			gaClientId: '987654321.1700000000',
		} );
		window.wp_has_consent = ( category ) => category === 'statistics';
		expect( allowed( 'marketing' ) ).toBe( false );
		expect( trackingInfo( '', cookies ) ).toEqual( { consent: { marketing: false, statistics: true }, gaClientId: '987654321.1700000000' } );
	} );

	it( 'reports Global Privacy Control as a no for marketing and statistics in the global mode', () => {
		setPrivacy( 'global' );
		gpc();
		expect( allowed( 'marketing' ) ).toBe( false );
		expect( trackingInfo( '', cookies ) ).toEqual( { consent: { marketing: false, statistics: false } } );
		window.wp_has_consent = () => true;
		expect( allowed( 'statistics' ) ).toBe( false );
	} );

	it( 'allows everything in the unrestricted mode, whatever the consent tool and Global Privacy Control say', () => {
		setPrivacy( 'open' );
		const all = {
			consent: { marketing: true, statistics: true },
			fbp: 'fb.1.1700000000000.123456789',
			gaClientId: '987654321.1700000000',
		};
		expect( [ allowed( 'marketing' ), allowed( 'statistics' ) ] ).toEqual( [ true, true ] );
		expect( trackingInfo( '', cookies ) ).toEqual( all );
		window.wp_has_consent = () => false;
		gpc();
		expect( [ allowed( 'marketing' ), allowed( 'statistics' ) ] ).toEqual( [ true, true ] );
		expect( trackingInfo( '', cookies ) ).toEqual( all );
	} );

	it( 'decides the extended statistics by the category statistics alone', () => {
		// EU mode: only a yes of the consent tool, whatever marketing says.
		expect( allowed( 'statistics' ) ).toBe( false );
		window.wp_has_consent = ( category ) => category === 'statistics';
		expect( [ allowed( 'statistics' ), allowed( 'marketing' ) ] ).toEqual( [ true, false ] );
		window.wp_has_consent = ( category ) => category === 'marketing';
		expect( allowed( 'statistics' ) ).toBe( false );
		// Global mode: unless the tool says no or the browser sends Global Privacy Control.
		delete window.wp_has_consent;
		setPrivacy( 'global' );
		expect( allowed( 'statistics' ) ).toBe( true );
		window.wp_has_consent = () => false;
		expect( allowed( 'statistics' ) ).toBe( false );
		delete window.wp_has_consent;
		gpc();
		expect( allowed( 'statistics' ) ).toBe( false );
	} );

	it( 'loads other services at once only where marketing is allowed', () => {
		const target = document.createElement( 'div' );
		const load = vi.fn();
		const button = loadWithConsent( 'Load', load, target );
		expect( button?.textContent ).toBe( 'Load' );
		expect( load ).not.toHaveBeenCalled();
		document.body.append( button as HTMLElement );
		button?.click();
		expect( document.body.contains( target ) ).toBe( true );
		expect( load ).toHaveBeenCalledTimes( 1 );

		setPrivacy( 'global' );
		expect( loadWithConsent( 'Load', load, target ) ).toBeNull();
		expect( load ).toHaveBeenCalledTimes( 2 );
		gpc();
		expect( loadWithConsent( 'Load', load, target ) ).not.toBeNull();
		expect( load ).toHaveBeenCalledTimes( 2 );
	} );
} );

describe( 'Borlabs Cookie', () => {
	const cookies = '_fbp=fb.1.1700000000000.123456789; _ga=GA1.1.987654321.1700000000';
	const borlabs = ( groups: string[] ): void => {
		window.BorlabsCookie = { Consents: { hasConsentForServiceGroup: ( group: string ) => groups.includes( group ) } };
	};

	it( 'reads the service groups marketing and statistics of Borlabs Cookie 3', () => {
		borlabs( [ 'essential', 'statistics' ] );
		expect( [ allowed( 'marketing' ), allowed( 'statistics' ) ] ).toEqual( [ false, true ] );
		expect( trackingInfo( '', cookies ) ).toEqual( { consent: { marketing: false, statistics: true }, gaClientId: '987654321.1700000000' } );
		borlabs( [ 'marketing', 'statistics' ] );
		expect( trackingInfo( '', cookies ).consent ).toEqual( { marketing: true, statistics: true } );
	} );

	it( 'goes before the WP Consent API, which answers only without Borlabs Cookie 3', () => {
		window.wp_has_consent = () => false;
		borlabs( [ 'marketing' ] );
		expect( allowed( 'marketing' ) ).toBe( true );
		// Borlabs Cookie 2 has no Consents: the WP Consent API answers.
		window.BorlabsCookie = {};
		expect( allowed( 'marketing' ) ).toBe( false );
	} );

	it( 'counts a failing Borlabs API as no answer', () => {
		window.BorlabsCookie = { Consents: { hasConsentForServiceGroup: () => {
			throw new Error( 'not ready' );
		} } };
		expect( trackingInfo( '', cookies ).consent ).toEqual( { marketing: null, statistics: null } );
		window.wp_has_consent = () => true;
		expect( allowed( 'marketing' ) ).toBe( true );
	} );

	it( 'keeps the privacy modes: Global Privacy Control in the global mode, everything in the unrestricted mode', () => {
		borlabs( [ 'marketing', 'statistics' ] );
		setPrivacy( 'global' );
		gpc();
		expect( allowed( 'marketing' ) ).toBe( false );
		borlabs( [] );
		setPrivacy( 'open' );
		expect( allowed( 'marketing' ) ).toBe( true );
	} );

	it( 'loads other services once the visitor allows marketing in the banner', () => {
		borlabs( [] );
		const target = document.createElement( 'div' );
		const load = vi.fn();
		const button = loadWithConsent( 'Load', load, target ) as HTMLElement;
		document.body.append( button );
		window.dispatchEvent( new Event( BORLABS_SAVED ) );
		expect( load ).not.toHaveBeenCalled();
		borlabs( [ 'marketing' ] );
		window.dispatchEvent( new Event( BORLABS_SAVED ) );
		expect( load ).toHaveBeenCalledTimes( 1 );
		expect( document.body.contains( target ) ).toBe( true );
		expect( document.body.contains( button ) ).toBe( false );
		window.dispatchEvent( new Event( BORLABS_SAVED ) );
		expect( load ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'leaves a button alone that is no longer on the page', () => {
		borlabs( [] );
		const load = vi.fn();
		loadWithConsent( 'Load', load, document.createElement( 'div' ) );
		borlabs( [ 'marketing' ] );
		window.dispatchEvent( new Event( BORLABS_SAVED ) );
		expect( load ).not.toHaveBeenCalled();
	} );
} );
