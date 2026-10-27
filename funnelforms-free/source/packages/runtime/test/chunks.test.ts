import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressField } from '../src/address';
import { FormApp } from '../src/app';
import { bookingField } from '../src/booking';
import { fill } from '../src/chunks/later';
import { repeatField } from '../src/repeat';
import type { RuntimeConfig } from '../src/types';

// Chunks of field types (runtime-address.js, runtime-booking.js, runtime-repeat.js): the core renders
// the group, the chunk fills it when it comes (fields.ts later(), chunks/later.ts). These tests load
// the chunks by hand, at the moment they would arrive.

const de = ( text: string ): Record<string, string> => ( { de_DE: text } );
const base = { description: de( '' ), required: true };

function config(): RuntimeConfig {
	return {
		uid: 'f1',
		endpoint: 'https://example.org/wp-json/funnelforms/v1/forms/f1',
		locale: 'de_DE',
		strings: { next: 'Weiter', back: 'Zurück', submit: 'Senden', required: 'Pflichtfeld', error: 'Fehler (%s)', street: 'Straße', booking_timezone: 'Zeiten in %s' },
		document: {
			schemaVersion: 1,
			id: 'frm_1',
			locales: { default: 'de_DE', available: [ 'de_DE' ] },
			start: 'na',
			nodes: [
				{ id: 'na', type: 'step', fields: [ { ...base, id: 'qa', key: 'adresse', type: 'address', label: de( 'Adresse' ), props: { combined: false, showCountry: false, placesAutocomplete: false } } ] },
				{ id: 'nb', type: 'step', fields: [ { ...base, id: 'qb', key: 'termin', type: 'booking', label: de( 'Wann passt es?' ), props: { bookingTypeRef: 'bt:1' } } ] },
				{
					id: 'nr',
					type: 'step',
					fields: [ {
						...base,
						id: 'qr',
						key: 'personen',
						type: 'repeat',
						label: de( 'Teilnehmer' ),
						props: { minItems: 1, maxItems: 2, addLabel: de( '' ), itemLabel: de( 'Person %d' ), fields: [ { ...base, id: 'name', key: 'name', type: 'text', label: de( 'Name' ), props: { placeholder: de( '' ) } } ] },
					} ],
				},
				{ id: 'nc', type: 'contact', title: de( '' ), description: de( '' ), submitLabel: de( 'Senden' ), showBottomBar: true, fields: [ { id: 'c_mail', key: 'mail', type: 'email', label: de( 'E-Mail' ), required: true, props: { placeholder: de( '' ), b2bOnly: false } } ] },
				{ id: 'e1', type: 'end', success: { show: true, text: de( '<p>Danke!</p>' ) }, redirect: null },
			],
			edges: [
				{ id: 'x1', from: 'na', to: 'nb' },
				{ id: 'x2', from: 'nb', to: 'nr' },
				{ id: 'x3', from: 'nr', to: 'nc' },
				{ id: 'x4', from: 'nc', to: 'e1' },
			],
			calculations: [],
			style: { tokens: {} },
			settings: { uiLocale: 'de_DE', progressBar: { show: false }, loadingAnimation: false, scrollToTop: { desktop: false, mobile: false }, rtl: false, autoHeight: true, iconFont: false, savePartialEntries: false },
		},
	} as unknown as RuntimeConfig;
}

let requests: Array<{ path: string; body: Record<string, unknown> }>;
let replies: Record<string, unknown[]>;

beforeEach( () => {
	vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout', 'Date' ] } );
	vi.setSystemTime( new Date( '2026-10-28T08:00:00Z' ) );
	// No chunk is there yet.
	window.ffxFields = undefined;
	requests = [];
	replies = {};
	vi.stubGlobal( 'fetch', vi.fn( async ( url: string, init: RequestInit ) => {
		const path = url.replace( /^.*\/forms\/f1/, '' );
		requests.push( { path, body: JSON.parse( String( init.body ) ) } );
		const body = replies[ path ]?.shift() ?? ( path === '/token' ? { ok: true, token: 't1' } : { ok: false, code: 'unexpected' } );
		return { status: ( body as { ok: boolean } ).ok ? 200 : 500, json: async () => body };
	} ) );
} );

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
} );

const $ = <T extends HTMLElement = HTMLElement>( root: HTMLElement, selector: string ): T => root.querySelector( selector ) as T;
const next = ( root: HTMLElement ): void => $( root, '.ffx-button-next' ).click();
const node = ( root: HTMLElement ): string | undefined => $( root, '[data-node]' ).dataset.node;
const type = ( input: HTMLInputElement, value: string ): void => {
	input.value = value;
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
};

function mount(): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'ffx-form';
	document.body.append( root );
	new FormApp( root, config(), { url: '', query: '', title: '' } );
	return root;
}

describe( 'chunks of field types', () => {
	it( 'shows the question at once, checks the answer without the chunk and fills the group when it comes', async () => {
		const root = mount();
		const group = $( root, 'fieldset.ffx-field-address' );
		expect( group.querySelector( 'legend.ffx-question' )?.firstChild?.textContent ).toBe( 'Adresse' );
		expect( group.querySelector( 'legend.ffx-question .ffx-required' ) ).not.toBeNull();
		expect( group.querySelectorAll( 'input' ) ).toHaveLength( 0 );
		expect( window.ffxFields?.address ).toHaveLength( 1 );

		// Next works as for any required field while the chunk loads.
		next( root );
		expect( node( root ) ).toBe( 'na' );
		expect( $( root, '.ffx-field-address .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );

		fill( 'address', addressField );
		expect( $( root, 'fieldset.ffx-field-address' ) ).toBe( group );
		const inputs = [ ...group.querySelectorAll<HTMLInputElement>( 'input' ) ];
		expect( inputs ).toHaveLength( 4 );
		expect( group.lastElementChild?.classList.contains( 'ffx-error' ) ).toBe( true );
		expect( $( root, '.ffx-address-street label' ).textContent ).toBe( 'Straße' );
		[ 'Hauptstraße', '1', '10115', 'Berlin' ].forEach( ( text, i ) => type( inputs[ i ] as HTMLInputElement, text ) );
		expect( $( root, '.ffx-field-address .ffx-error' ).hidden ).toBe( true );
		next( root );
		expect( node( root ) ).toBe( 'nb' );

		// The booking chunk comes after the step is shown; it asks for the free times then.
		expect( root.querySelector( '.ffx-booking-days' ) ).toBeNull();
		expect( requests.filter( ( r ) => r.path === '/slots' ) ).toHaveLength( 0 );
		( replies[ '/slots' ] ??= [] ).push( { ok: true, timezone: 'Europe/Berlin', durations: [ 30 ], duration: 30, window: null, days: { '2026-10-29': [ '2026-10-29T09:00:00Z' ] } } );
		fill( 'booking', bookingField );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.filter( ( r ) => r.path === '/slots' ).map( ( r ) => r.body.field ) ).toEqual( [ 'qb' ] );
		$( root, '.ffx-booking-time' ).click();

		// A chunk that is there already fills the fields of later steps at once.
		fill( 'repeat', repeatField );
		next( root );
		expect( node( root ) ).toBe( 'nr' );
		expect( root.querySelectorAll( '.ffx-repeat-item' ) ).toHaveLength( 1 );
		next( root );
		expect( node( root ) ).toBe( 'nr' );
		type( $<HTMLInputElement>( root, '.ffx-repeat-item input' ), 'Ada' );
		next( root );
		expect( node( root ) ).toBe( 'nc' );

		// Back to the address: filled at once, with the answers.
		[ 'nr', 'nb', 'na' ].forEach( () => $( root, '.ffx-button-back' ).click() );
		expect( node( root ) ).toBe( 'na' );
		expect( [ ...root.querySelectorAll<HTMLInputElement>( '.ffx-field-address input' ) ].map( ( i ) => i.value ) ).toEqual( [ 'Hauptstraße', '1', '10115', 'Berlin' ] );
	} );

	it( 'checks a repeat group with the core while its chunk loads', () => {
		const doc = config();
		doc.document.start = 'nr';
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, doc, { url: '', query: '', title: '' } );
		expect( root.querySelectorAll( '.ffx-repeat-item' ) ).toHaveLength( 0 );
		next( root );
		expect( node( root ) ).toBe( 'nr' );
		expect( $( root, '.ffx-field-repeat > .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );

		// The chunk takes over the group: items, and the checks of the group and of each item.
		fill( 'repeat', repeatField );
		expect( root.querySelectorAll( '.ffx-repeat-item' ) ).toHaveLength( 1 );
		next( root );
		expect( node( root ) ).toBe( 'nr' );
		expect( $( root, '.ffx-field-repeat > .ffx-error' ).hidden ).toBe( false );
		expect( document.activeElement ).toBe( $( root, '.ffx-repeat-item input' ) );
		type( $<HTMLInputElement>( root, '.ffx-repeat-item input' ), 'Ada' );
		next( root );
		expect( node( root ) ).toBe( 'nc' );
	} );

	it( 'adds the chunk next to the runtime where the plugin did not enqueue it', async () => {
		vi.resetModules();
		const src = 'https://example.org/wp-content/plugins/funnelforms-pro/assets/runtime/runtime.js?ver=5.0.0';
		Object.defineProperty( document, 'currentScript', { configurable: true, get: () => ( { src } ) } );
		try {
			const fresh = await import( '../src/app' );
			const doc = config();
			doc.document.start = 'nb';
			const root = document.createElement( 'div' );
			document.body.append( root );
			new fresh.FormApp( root, doc, { url: '', query: '', title: '' } );
			const script = document.getElementById( 'funnelforms-runtime-booking-js' ) as HTMLScriptElement | null;
			expect( script?.src ).toBe( src.replace( 'runtime.js', 'runtime-booking.js' ) );
			expect( document.querySelectorAll( 'script[id^="funnelforms-runtime-"]' ) ).toHaveLength( 1 );
		} finally {
			Reflect.deleteProperty( document, 'currentScript' );
			document.head.innerHTML = '';
		}
	} );
} );
