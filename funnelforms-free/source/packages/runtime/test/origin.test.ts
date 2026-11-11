import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/api';
import { setPrivacy } from '../src/consent';
import { arrival, campaignQuery, forgetOrigin, ORIGIN_KEY, rememberOrigin } from '../src/origin';
import { Stats } from '../src/stats';

const site = 'https://www.shop.example';

beforeEach( () => {
	sessionStorage.clear();
	window.wp_has_consent = ( category ) => category === 'statistics';
} );

afterEach( () => {
	delete window.wp_has_consent;
	setPrivacy();
} );

describe( 'what a page view brings itself', () => {
	it( 'keeps only the marketing parameters of the address', () => {
		expect( campaignQuery( '?utm_source=facebook&utm_medium=paid_social&email=erika%40example.org&id=7&fbclid=abc' ) ).toBe( 'utm_source=facebook&utm_medium=paid_social&fbclid=abc' );
		expect( campaignQuery( 'gclid=xyz&utm_campaign=' ) ).toBe( 'gclid=xyz' );
		expect( campaignQuery( '' ) ).toBe( '' );
	} );

	it( 'counts another website by its host, this one and a direct visit not', () => {
		expect( arrival( site + '/landing/?utm_source=google&utm_medium=cpc', '' ) ).toEqual( { referrer: '', query: 'utm_source=google&utm_medium=cpc' } );
		expect( arrival( site + '/', 'https://www.google.de/search?q=matratze' ) ).toEqual( { referrer: 'https://www.google.de/', query: '' } );
		expect( arrival( site + '/kontakt/', site + '/' ) ).toBeNull();
		// With or without www is the same website.
		expect( arrival( site + '/kontakt/', 'https://shop.example/' ) ).toBeNull();
		expect( arrival( site + '/kontakt/', '' ) ).toBeNull();
		expect( arrival( site + '/kontakt/', 'android-app://com.slack/' ) ).toBeNull();
	} );
} );

describe( 'remembering the origin of a visit', () => {
	it( 'gives a later page of the visit the origin of the page the visit began on', () => {
		// The ad leads to the home page; it has a source of its own.
		expect( rememberOrigin( site + '/?utm_source=facebook&utm_medium=paid_social&fbclid=abc', 'https://l.facebook.com/' ) ).toBeNull();
		expect( JSON.parse( sessionStorage.getItem( ORIGIN_KEY ) ?? '' ) ).toEqual( { referrer: 'https://l.facebook.com/', query: 'utm_source=facebook&utm_medium=paid_social&fbclid=abc' } );
		// The form on the contact page, reached from the home page.
		const earlier = { referrer: 'https://l.facebook.com/', query: 'utm_source=facebook&utm_medium=paid_social&fbclid=abc' };
		expect( rememberOrigin( site + '/kontakt/', site + '/' ) ).toEqual( earlier );
		expect( rememberOrigin( site + '/kontakt/', '' ) ).toEqual( earlier );
	} );

	it( 'replaces the origin when the visitor comes again from another website or campaign', () => {
		rememberOrigin( site + '/?gclid=abc', 'https://www.google.com/' );
		rememberOrigin( site + '/ratgeber/', 'https://www.bing.com/' );
		expect( rememberOrigin( site + '/kontakt/', site + '/ratgeber/' ) ).toEqual( { referrer: 'https://www.bing.com/', query: '' } );
	} );

	it( 'reads and writes nothing without consent to statistics, and forgets after a refusal', () => {
		window.wp_has_consent = () => false;
		expect( rememberOrigin( site + '/?utm_source=google', '' ) ).toBeNull();
		expect( sessionStorage.getItem( ORIGIN_KEY ) ).toBeNull();

		window.wp_has_consent = () => true;
		rememberOrigin( site + '/?utm_source=google', '' );
		window.wp_has_consent = () => false;
		expect( rememberOrigin( site + '/kontakt/', site + '/' ) ).toBeNull();
		expect( sessionStorage.getItem( ORIGIN_KEY ) ).not.toBeNull();
		forgetOrigin();
		expect( sessionStorage.getItem( ORIGIN_KEY ) ).toBeNull();
	} );

	it( 'follows the privacy mode without a consent tool', () => {
		delete window.wp_has_consent;
		expect( rememberOrigin( site + '/?utm_source=google', '' ) ).toBeNull();
		expect( sessionStorage.getItem( ORIGIN_KEY ) ).toBeNull();
		setPrivacy( 'global' );
		rememberOrigin( site + '/?utm_source=google', '' );
		expect( rememberOrigin( site + '/kontakt/', '' ) ).toEqual( { referrer: '', query: 'utm_source=google' } );
	} );

	it( 'ignores something else under the key, and storage the browser blocks', () => {
		sessionStorage.setItem( ORIGIN_KEY, '{"referrer":1}' );
		expect( rememberOrigin( site + '/kontakt/', '' ) ).toBeNull();
		sessionStorage.setItem( ORIGIN_KEY, 'kein JSON' );
		expect( rememberOrigin( site + '/kontakt/', '' ) ).toBeNull();
		// Only the marketing parameters come back, whatever was stored.
		sessionStorage.setItem( ORIGIN_KEY, JSON.stringify( { referrer: '', query: 'utm_source=x&email=a%40b.de' } ) );
		expect( rememberOrigin( site + '/kontakt/', '' ) ).toEqual( { referrer: '', query: 'utm_source=x' } );
		expect( rememberOrigin( site + '/?utm_source=google', '', null ) ).toBeNull();
		const full = { getItem: () => null, setItem: vi.fn( () => {
			throw new Error( 'QuotaExceededError' );
		} ), removeItem: vi.fn() } as unknown as Storage;
		expect( rememberOrigin( site + '/?utm_source=google', '', full ) ).toBeNull();
	} );
} );

describe( 'the statistics of a page without a source of its own', () => {
	it( 'report the source the visit began with', () => {
		const events = vi.fn( async () => undefined );
		const stats = new Stats( { events } as unknown as Api, true, { referrer: 'https://www.google.com/', search: '?gclid=abc' } );
		stats.record( 'view' );
		stats.flush();
		expect( ( events.mock.calls as unknown as Array<[ string, unknown[] ]> )[ 0 ]?.[ 1 ] ).toEqual( [
			{ event: 'source', step: 'https://www.google.com/', variant: '?gclid=abc' },
			{ event: 'view', step: '' },
		] );
	} );
} );
