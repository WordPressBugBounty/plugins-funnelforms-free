import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultField } from '@funnelforms/form-schema';
import { FormApp } from '../src/app';
import '../src/chunks/live';
import type { RuntimeConfig } from '../src/types';

/** Live results with the text of a range, and live results locked until the contact step. */
const de = ( text: string ): Record<string, string> => ( { de_DE: text } );
const EURO = { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.', suffix: ' €' };

function config( style: 'card' | 'sticky', props: Partial<ResultField[ 'props' ]> ): RuntimeConfig {
	const result: ResultField = { id: 'r1', key: 'r1', type: 'result', label: de( 'Ihr Preis' ), description: de( '' ), required: false, props: { style, lines: [], ...props } };
	return {
		uid: 'f1',
		endpoint: 'https://example.org/wp-json/funnelforms/v1/forms/f1',
		locale: 'de_DE',
		strings: { next: 'Weiter', back: 'Zurück', submit: 'Senden', calc_error: 'Rechenfehler', live_from: 'ab %s', live_locked: 'Ihr Ergebnis ist fertig.' },
		document: {
			schemaVersion: 1,
			id: 'frm_1',
			locales: { default: 'de_DE', available: [ 'de_DE' ] },
			start: 'n1',
			nodes: [
				{ id: 'n1', type: 'step', fields: [ { id: 'q1', key: 'size', type: 'number', label: de( 'Fläche' ), description: de( '' ), required: true, props: { placeholder: de( '' ) } }, result ] },
				{ id: 'n3', type: 'contact', title: de( 'Kontakt' ), description: de( '' ), submitLabel: de( 'Senden' ), showBottomBar: true, fields: [] },
				{ id: 'e1', type: 'end', success: { show: true, text: de( '<p>Danke</p>' ) }, redirect: null },
			],
			edges: [
				{ id: 'x1', from: 'n1', to: 'n3' },
				{ id: 'x3', from: 'n3', to: 'e1' },
			],
			calculations: [ { id: 'low', format: EURO }, { id: 'high', format: EURO }, { id: 'score' } ],
			style: { tokens: {} },
			settings: { uiLocale: 'de_DE', progressBar: { show: false }, loadingAnimation: false, scrollToTop: { desktop: false, mobile: false }, rtl: false, autoHeight: true, iconFont: false, savePartialEntries: false },
		},
	} as unknown as RuntimeConfig;
}

let bodies: Array<Record<string, unknown>>;
let answer: ( body: unknown ) => void;

beforeEach( () => {
	vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout', 'Date' ] } );
	bodies = [];
	vi.stubGlobal( 'matchMedia', () => ( { matches: true } ) );
	vi.stubGlobal(
		'fetch',
		vi.fn( ( url: string, init: RequestInit ) => {
			if ( ! url.endsWith( '/calculations' ) ) {
				return Promise.resolve( { status: 200, json: async () => ( { ok: true, token: 't' } ) } );
			}
			bodies.push( JSON.parse( String( init.body ) ) );
			return new Promise( ( resolve ) => {
				answer = ( body ) => resolve( { status: 200, json: async () => body } );
			} );
		} )
	);
} );

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
} );

function mount( style: 'card' | 'sticky', props: Partial<ResultField[ 'props' ]> ): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'ffx-form';
	root.dataset.ffxChunks = 'live';
	document.body.append( root );
	new FormApp( root, config( style, props ), { url: 'https://example.org/', query: '', title: 'Seite' } );
	return root;
}

const values = ( root: HTMLElement ): string[] => [ ...root.querySelectorAll( '.ffx-live-value' ) ].map( ( e ) => e.textContent ?? '' );

describe( 'live results by range and locked ones', () => {
	it( 'show the text of the range a result lies in', async () => {
		const root = mount( 'card', { lines: [ { calculation: 'low', to: 'high', label: de( 'Preis' ) }, { calculation: 'score', label: de( 'Typ' ), text: true } ] } );
		expect( values( root ) ).toEqual( [ '…', '…' ] );
		expect( bodies[ 0 ] ).toEqual( { answers: {}, ids: [ 'low', 'high', 'score:text' ], live: true, locale: 'de_DE' } );
		answer( { ok: true, calculations: { low: '1.200 €', high: '1.500 €', 'score:text': 'Einsteiger' }, values: { low: 1200, high: 1500, 'score:text': null } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( values( root ) ).toEqual( [ '1.200 – 1.500 €', 'Einsteiger' ] );
	} );

	for ( const style of [ 'card', 'sticky' ] as const ) {
		it( `keep a ${ style } box locked: placeholders and the teaser, and nothing asked`, async () => {
			const root = mount( style, { reveal: 'contact', lines: [ { calculation: 'low', to: 'high', label: de( 'Preis' ) }, { calculation: 'score', label: de( 'Typ' ), text: true } ] } );
			await vi.advanceTimersByTimeAsync( 1000 );
			const box = root.querySelector( `.ffx-live-${ style }` ) as HTMLElement;
			expect( box.classList.contains( 'ffx-live-locked' ) ).toBe( true );
			expect( values( root ) ).toEqual( [ '•••••', '•••••' ] );
			expect( box.querySelector( '.ffx-live-value' )?.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
			expect( box.querySelector( '.ffx-live-teaser' )?.textContent ).toBe( 'Ihr Ergebnis ist fertig.' );
			expect( bodies ).toEqual( [] );
			const input = root.querySelector( '.ffx-field-number input' ) as HTMLInputElement;
			input.value = '50';
			input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			await vi.advanceTimersByTimeAsync( 1000 );
			expect( bodies ).toEqual( [] );
		} );
	}

	it( 'take the teaser of the field', () => {
		const root = mount( 'card', { reveal: 'contact', teaser: de( 'Nach Ihren Kontaktdaten sehen Sie <strong>alles</strong>.' ), lines: [ { calculation: 'low', label: de( 'Preis' ) } ] } );
		expect( root.querySelector( '.ffx-live-teaser' )?.innerHTML ).toBe( 'Nach Ihren Kontaktdaten sehen Sie <strong>alles</strong>.' );
	} );
} );
