import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactField, Field } from '@funnelforms/form-schema';
import { FormApp } from '../src/app';
import { checkPhone, e164, flag, formatInternational, formatTyped, parsePhone, startCountry } from '../src/phone';
import type { RuntimeConfig } from '../src/types';
import { checkContactField, checkStepField } from '../src/validate';
// The chunk takes over phone inputs from here on (window.ffxChunk).
import { check } from '../src/chunks/phone';

const de = ( text: string ): Record<string, string> => ( { de_DE: text } );

describe( 'phone numbers', () => {
	it( 'reads national, international and pasted numbers', () => {
		expect( parsePhone( '0151 12345678', 'DE' ) ).toEqual( { country: 'DE', national: '15112345678' } );
		expect( parsePhone( '+49 151 12345678', 'AT' ) ).toEqual( { country: 'DE', national: '15112345678' } );
		expect( parsePhone( '0049 (0)151-12345678', 'US' ) ).toEqual( { country: 'DE', national: '15112345678' } );
		expect( parsePhone( '+43 664 1234567', 'DE' ) ).toEqual( { country: 'AT', national: '6641234567' } );
		// Shared calling codes: Antigua by its area code, Canada by its area codes, else the US.
		expect( parsePhone( '+1 268 464 1234', 'DE' )?.country ).toBe( 'AG' );
		expect( parsePhone( '+1 416 555 0123', 'DE' )?.country ).toBe( 'CA' );
		expect( parsePhone( '+1 201 555 0123', 'DE' )?.country ).toBe( 'US' );
		expect( parsePhone( '(201) 555-0123', 'US' ) ).toEqual( { country: 'US', national: '2015550123' } );
		// Italy keeps the 0 of its numbers.
		expect( parsePhone( '06 1234 5678', 'IT' ) ).toEqual( { country: 'IT', national: '0612345678' } );
		expect( parsePhone( '+', 'DE' ) ).toBeNull();
	} );

	it( 'checks the length per country and the allowed countries', () => {
		expect( checkPhone( { country: 'DE', national: '15112345678' } ) ).toBe( '' );
		expect( checkPhone( { country: 'DE', national: '151' } ) ).toBe( 'phone_too_short' );
		expect( checkPhone( { country: 'US', national: '20155501234' } ) ).toBe( 'phone_too_long' );
		expect( checkPhone( { country: 'CH', national: '7812345678' } ) ).toBe( 'invalid_phone' );
		expect( checkPhone( { country: 'FR', national: '612345678' }, [ 'DE', 'AT' ] ) ).toBe( 'phone_country_not_allowed' );
	} );

	it( 'formats while typing and for display', () => {
		expect( formatTyped( 'DE', '015112345678' ) ).toBe( '01511 2345678' );
		expect( formatTyped( 'US', '2015550123' ) ).toBe( '201 555 0123' );
		expect( formatTyped( 'FR', '0612345678' ) ).toBe( '06 12 34 56 78' );
		expect( formatInternational( { country: 'CH', national: '781234567' } ) ).toBe( '+41 78 123 45 67' );
		expect( formatInternational( { country: 'DE', national: '15112345678' } ) ).toBe( '+49 1511 2345678' );
		expect( formatInternational( { country: 'DE', national: '3012345678' } ) ).toBe( '+49 3012345678' );
		expect( e164( { country: 'DE', national: '15112345678' } ) ).toBe( '+4915112345678' );
		expect( flag( 'DE' ) ).toBe( '🇩🇪' );
	} );

	it( 'starts with the field country, else the form language, else an allowed one', () => {
		expect( startCountry( 'CH', 'de_DE' ) ).toBe( 'CH' );
		expect( startCountry( undefined, 'de_AT' ) ).toBe( 'AT' );
		expect( startCountry( undefined, 'de_DE_formal' ) ).toBe( 'DE' );
		expect( startCountry( undefined, 'fr' ) ).toBe( 'FR' );
		expect( startCountry( undefined, 'de_DE', [ 'AT', 'CH' ] ) ).toBe( 'AT' );
	} );

	it( 'leaves fields without country settings to the core', () => {
		const plain: Field = { id: 'p', key: 'p', type: 'phone', label: {}, description: {}, required: true, props: { placeholder: {} } };
		expect( check( plain, '0151 123' ) ).toBeUndefined();
		expect( checkStepField( plain, '0151 1234' ) ).toBeNull();
		const picker: Field = { ...plain, props: { placeholder: {}, country: {} } };
		expect( checkStepField( picker, '+49151' ) ).toBe( 'phone_too_short' );
		expect( checkStepField( picker, '+4915112345678' ) ).toBe( '' );
		const sms: ContactField = { id: 'c', key: 'c', type: 'phone', label: {}, required: true, props: { verify: 'sms' } };
		expect( checkContactField( sms, '+4915112345678' ) ).toBe( 'phone_not_confirmed' );
		expect( checkContactField( sms, '' ) ).toBe( 'required' );
	} );
} );

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply[]>;
let requests: Array<{ path: string; body: Record<string, unknown> }>;

beforeEach( () => {
	// The submit waits for the token's minimum age.
	vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout', 'Date' ] } );
	replies = {};
	requests = [];
	let tokens = 0;
	vi.stubGlobal( 'fetch', vi.fn( async ( url: string, init: RequestInit ) => {
		const path = url.replace( /^.*\/forms\/f1/, '' );
		const body = JSON.parse( String( init.body ) );
		requests.push( { path, body } );
		const fallback = path === '/token' ? { status: 200, body: { ok: true, token: `t${ ++tokens }` } } : { status: 500, body: { ok: false, code: 'unexpected' } };
		const next = replies[ path ]?.shift() ?? fallback;
		return { status: next.status, json: async () => next.body };
	} ) );
} );

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
} );

function config( fields: ContactField[], step?: Field ): RuntimeConfig {
	return {
		uid: 'f1',
		endpoint: 'https://example.org/wp-json/funnelforms/v1/forms/f1',
		locale: 'de_DE',
		strings: { submit: 'Senden', next: 'Weiter', required: 'Pflichtfeld', phone_too_short: 'Zu kurz', phone_not_confirmed: 'Bitte bestätigen', phone_country: 'Land: %s', phone_search: 'Land suchen', phone_countries: 'Länder', phone_results: '%d Länder', sms_sent: 'Code an %s gesendet', code_invalid: 'Code falsch', sms_confirmed: 'Bestätigt', sms_resend_in: 'Neuer Code in %d s' },
		document: {
			schemaVersion: 1,
			id: 'frm_1',
			locales: { default: 'de_DE', available: [ 'de_DE' ] },
			start: step ? 'n1' : 'n2',
			nodes: [
				...( step ? [ { id: 'n1', type: 'step', fields: [ step ] } ] : [] ),
				{ id: 'n2', type: 'contact', title: de( 'Kontakt' ), description: de( '' ), submitLabel: de( '' ), showBottomBar: false, fields },
				{ id: 'e1', type: 'end', success: { show: true, text: de( '<p>Danke!</p>' ) }, redirect: null },
			],
			edges: [ ...( step ? [ { id: 'x0', from: 'n1', to: 'n2', default: true } ] : [] ), { id: 'x1', from: 'n2', to: 'e1', default: true } ],
			calculations: [],
			style: { tokens: {} },
			settings: { uiLocale: 'de_DE', progressBar: { show: false }, loadingAnimation: false, scrollToTop: { desktop: false, mobile: false }, rtl: false, autoHeight: false, iconFont: false, savePartialEntries: false },
		},
	} as unknown as RuntimeConfig;
}

async function mount( settings: RuntimeConfig ): Promise<HTMLElement> {
	const root = document.createElement( 'div' );
	root.className = 'ffx-form';
	document.body.append( root );
	new FormApp( root, settings, { url: 'https://example.org/', query: '', title: 'Seite' } );
	await Promise.resolve();
	return root;
}

const $ = <T extends HTMLElement = HTMLElement>( root: ParentNode, selector: string ): T => root.querySelector( selector ) as T;
const type = ( input: HTMLInputElement, value: string ): void => {
	input.value = value;
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
};
const key = ( el: HTMLElement, name: string ): void => void el.dispatchEvent( new KeyboardEvent( 'keydown', { key: name, bubbles: true, cancelable: true } ) );
const phone: ContactField = { id: 'c_tel', key: 'tel', type: 'phone', label: de( 'Telefon' ), required: true, props: { placeholder: de( '' ), country: { preferred: [ 'AT', 'CH' ] } } };

describe( 'phone chunk', () => {
	it( 'shows the country, formats while typing and sends E.164', async () => {
		const root = await mount( config( [ phone ] ) );
		const toggle = $<HTMLButtonElement>( root, '.ffx-phone-country' );
		expect( toggle.getAttribute( 'aria-label' ) ).toBe( 'Land: Deutschland +49' );
		expect( toggle.getAttribute( 'aria-haspopup' ) ).toBe( 'listbox' );
		const input = $<HTMLInputElement>( root, '.ffx-phone input' );
		expect( input.placeholder ).toBe( '1512 3456789' );
		type( input, '0151' );
		expect( input.value ).toBe( '0151' );
		$<HTMLButtonElement>( root, '.ffx-button-submit' ).click();
		expect( $( root, '.ffx-contact-phone .ffx-error' ).textContent ).toBe( 'Zu kurz' );
		type( input, '015112345678' );
		expect( input.value ).toBe( '01511 2345678' );

		// A pasted international number switches the country.
		type( input, '+43 664 1234567' );
		expect( toggle.getAttribute( 'aria-label' ) ).toBe( 'Land: Österreich +43' );
		expect( input.value ).toBe( '664 1234567' );
		$<HTMLButtonElement>( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.contact ).toEqual( { c_tel: '+436641234567' } );
	} );

	it( 'picks a country with the keyboard (combobox and listbox)', async () => {
		const root = await mount( config( [ phone ] ) );
		const toggle = $<HTMLButtonElement>( root, '.ffx-phone-country' );
		toggle.click();
		expect( toggle.getAttribute( 'aria-expanded' ) ).toBe( 'true' );
		const search = $<HTMLInputElement>( root, '.ffx-phone-search' );
		expect( document.activeElement ).toBe( search );
		expect( search.getAttribute( 'role' ) ).toBe( 'combobox' );
		const list = $( root, '[role="listbox"]' );
		expect( search.getAttribute( 'aria-controls' ) ).toBe( list.id );
		// Preferred countries first, then a separator.
		const first = [ ...list.querySelectorAll<HTMLElement>( '[role="option"]' ) ].slice( 0, 2 ).map( ( o ) => o.dataset.iso );
		expect( first ).toEqual( [ 'AT', 'CH' ] );
		expect( list.querySelector( '[role="separator"]' ) ).not.toBeNull();

		type( search, 'schw' );
		const active = () => document.getElementById( search.getAttribute( 'aria-activedescendant' ) ?? '' );
		expect( active()?.dataset.iso ).toBe( 'SE' );
		key( search, 'ArrowDown' );
		expect( active()?.dataset.iso ).toBe( 'CH' );
		key( search, 'Enter' );
		expect( toggle.getAttribute( 'aria-expanded' ) ).toBe( 'false' );
		expect( toggle.getAttribute( 'aria-label' ) ).toBe( 'Land: Schweiz +41' );
		expect( document.activeElement ).toBe( $( root, '.ffx-phone input' ) );

		// The calling code finds countries too; Escape goes back to the button.
		toggle.click();
		type( search, '+1' );
		expect( [ ...list.querySelectorAll<HTMLElement>( '[role="option"]' ) ].map( ( o ) => o.dataset.iso ) ).toContain( 'US' );
		key( search, 'Escape' );
		expect( $( root, '.ffx-phone-panel' ).hidden ).toBe( true );
		expect( document.activeElement ).toBe( toggle );
	} );

	it( 'accepts only the allowed countries and shows a single one without a list', async () => {
		const root = await mount( config( [ { ...phone, props: { placeholder: de( '' ), country: { allowed: [ 'CH' ] } } } ] ) );
		expect( $( root, 'button.ffx-phone-country' ) ).toBeNull();
		expect( $( root, '.ffx-phone-country.is-static' ).textContent ).toContain( '+41' );
		expect( check( { ...phone, props: { country: { allowed: [ 'CH' ] } } }, '+4915112345678' ) ).toBe( 'phone_country_not_allowed' );
	} );

	it( 'works in a step and keeps the number on Back', async () => {
		const step: Field = { id: 'q_tel', key: 'tel', type: 'phone', label: de( 'Ihre Nummer' ), description: de( '' ), required: true, props: { placeholder: de( '' ), country: { default: 'US' } } };
		const root = await mount( config( [], step ) );
		const input = $<HTMLInputElement>( root, '.ffx-phone input' );
		type( input, '2015550123' );
		expect( input.value ).toBe( '201 555 0123' );
		$<HTMLButtonElement>( root, '.ffx-button-next' ).click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		$<HTMLButtonElement>( root, '.ffx-button-back' ).click();
		await Promise.resolve();
		expect( $<HTMLInputElement>( root, '.ffx-phone input' ).value ).toBe( '201 555 0123' );
	} );

	it( 'confirms the number with a code before the contact step can be sent', async () => {
		const field: ContactField = { ...phone, props: { placeholder: de( '' ), country: {}, verify: 'sms' } };
		const root = await mount( config( [ field ] ) );
		const input = $<HTMLInputElement>( root, '.ffx-phone input' );
		type( input, '015112345678' );
		$<HTMLButtonElement>( root, '.ffx-button-submit' ).click();
		expect( $( root, '.ffx-contact-phone .ffx-error' ).textContent ).toBe( 'Bitte bestätigen' );
		expect( requests.some( ( r ) => r.path === '/entries' ) ).toBe( false );

		( replies[ '/phone/send' ] ??= [] ).push( { status: 200, body: { ok: true } } );
		$<HTMLButtonElement>( root, '.ffx-otp-send' ).click();
		await vi.waitFor( () => expect( $( root, '.ffx-otp-entry' ).hidden ).toBe( false ) );
		expect( requests.find( ( r ) => r.path === '/phone/send' )?.body ).toMatchObject( { number: '+4915112345678', field: 'c_tel', token: expect.stringMatching( /^t\d$/ ) } );
		expect( $( root, '.ffx-otp-status' ).textContent ).toBe( 'Code an +49 1511 2345678 gesendet' );
		const code = $<HTMLInputElement>( root, '.ffx-otp-code' );
		expect( code.getAttribute( 'autocomplete' ) ).toBe( 'one-time-code' );
		expect( $<HTMLButtonElement>( root, '.ffx-otp-link' ).disabled ).toBe( true );

		( replies[ '/phone/confirm' ] ??= [] ).push( { status: 400, body: { ok: false, code: 'code_invalid' } } );
		type( code, '111111' );
		await vi.waitFor( () => expect( $( root, '.ffx-otp-status' ).textContent ).toBe( 'Code falsch' ) );
		( replies[ '/phone/confirm' ] ??= [] ).push( { status: 200, body: { ok: true, proof: 'v1.signed' } } );
		type( code, '123456' );
		await vi.waitFor( () => expect( $( root, '.ffx-otp-status' ).textContent ).toBe( 'Bestätigt' ) );

		$<HTMLButtonElement>( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.contact ).toEqual( { c_tel: '+4915112345678', 'c_tel:proof': 'v1.signed' } );

		// Another number needs a new confirmation.
		type( input, '015112345679' );
		expect( check( field, '+4915112345679' ) ).toBe( 'phone_not_confirmed' );
		expect( $<HTMLButtonElement>( root, '.ffx-otp-send' ).hidden ).toBe( false );
	} );

	it( 'treats the 3.x type phone_verification as a phone field that confirms', async () => {
		const legacy: ContactField = { id: 'c_ver', key: 'ver', type: 'phone_verification', label: de( 'Mobil' ), required: true, props: { verify: 'sms' } };
		const root = await mount( config( [ legacy ] ) );
		expect( $( root, '.ffx-phone-country' ) ).not.toBeNull();
		expect( $( root, '.ffx-otp-send' ) ).not.toBeNull();
		expect( $<HTMLInputElement>( root, '.ffx-phone input' ).type ).toBe( 'tel' );
	} );
} );
