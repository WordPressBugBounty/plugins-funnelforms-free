import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultField } from '@funnelforms/form-schema';
import { FormApp } from '../src/app';
import { DELAY, formatResult } from '../src/chunks/live';
import type { RuntimeConfig } from '../src/types';

const de = ( text: string ): Record<string, string> => ( { de_DE: text } );
const EURO = { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.', suffix: ' €' };

function result( id: string, style: 'card' | 'sticky', props: Partial<ResultField[ 'props' ]> = {} ): ResultField {
	return {
		id,
		key: id,
		type: 'result',
		label: de( 'Ihr Preis' ),
		description: de( '' ),
		required: false,
		props: {
			style,
			lines: [
				{ calculation: 'low', to: 'high', label: de( 'Malerarbeiten' ) },
				{ calculation: 'extras', label: de( 'Extras' ), from: true },
			],
			disclaimer: de( 'Unverbindliche Schätzung' ),
			...props,
		},
	};
}

function config( style: 'card' | 'sticky' = 'card' ): RuntimeConfig {
	return {
		uid: 'f1',
		endpoint: 'https://example.org/wp-json/funnelforms/v1/forms/f1',
		locale: 'de_DE',
		strings: { next: 'Weiter', back: 'Zurück', submit: 'Senden', calc_error: 'Rechenfehler', live_from: 'ab %s', required: 'Pflichtfeld' },
		document: {
			schemaVersion: 1,
			id: 'frm_1',
			locales: { default: 'de_DE', available: [ 'de_DE' ] },
			start: 'n1',
			nodes: [
				{
					id: 'n1',
					type: 'step',
					fields: [
						{ id: 'q1', key: 'size', type: 'number', label: de( 'Fläche' ), description: de( '' ), required: true, props: { placeholder: de( '' ) } },
						{ id: 'q2', key: 'note', type: 'text', label: de( 'Hinweis' ), description: de( '' ), required: false, props: { placeholder: de( '' ) } },
						{ id: 'q3', key: 'tax', type: 'content', label: de( '' ), description: de( '' ), required: false, props: { html: de( '<p>Steuer: {{calc:tax}}</p>' ), button: { show: false, label: de( '' ) } } },
						result( 'r1', style ),
					],
				},
				{
					id: 'n2',
					type: 'step',
					fields: [
						{
							id: 'q4',
							key: 'extra',
							type: 'choice',
							label: de( 'Extras?' ),
							description: de( '' ),
							required: true,
							options: [ { id: 'o1', label: de( 'Ja' ), value: 'ja' }, { id: 'o2', label: de( 'Nein' ), value: 'nein' } ],
							props: { multiple: false, layout: { desktop: 'grid', mobile: 'grid' }, hideIcons: false },
						},
						result( 'r2', 'card', { lines: [ { calculation: 'low', label: de( 'Ab' ), prefix: '', suffix: '' } ] } ),
					],
				},
				{ id: 'n3', type: 'contact', title: de( 'Kontakt' ), description: de( '' ), submitLabel: de( 'Senden' ), showBottomBar: true, fields: [] },
				{ id: 'e1', type: 'end', success: { show: true, text: de( '<p>Danke</p>' ) }, redirect: null },
			],
			edges: [
				{ id: 'x1', from: 'n1', to: 'n2' },
				{ id: 'x2', from: 'n2', to: 'n3' },
				{ id: 'x3', from: 'n3', to: 'e1' },
			],
			calculations: [ { id: 'low', format: EURO }, { id: 'high', format: EURO }, { id: 'extras', format: EURO }, { id: 'tax' } ],
			style: { tokens: {} },
			settings: { uiLocale: 'de_DE', progressBar: { show: false }, loadingAnimation: false, scrollToTop: { desktop: false, mobile: false }, rtl: false, autoHeight: true, iconFont: false, savePartialEntries: false },
		},
	} as unknown as RuntimeConfig;
}

interface Pending {
	body: Record<string, unknown>;
	signal: AbortSignal;
	answer( status: number, body: unknown ): void;
}
let pending: Pending[];
let reduced: boolean;

beforeEach( () => {
	vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout', 'Date' ] } );
	pending = [];
	reduced = true;
	vi.stubGlobal( 'matchMedia', ( query: string ) => ( { matches: query.includes( 'reduce' ) && reduced } ) );
	vi.stubGlobal( 'fetch', vi.fn( ( url: string, init: RequestInit ) => {
		if ( ! url.endsWith( '/calculations' ) ) {
			return Promise.resolve( { status: 200, json: async () => ( { ok: true, token: 't' } ) } );
		}
		return new Promise( ( resolve, reject ) => {
			const signal = init.signal as AbortSignal;
			signal.addEventListener( 'abort', () => reject( new DOMException( 'Aborted', 'AbortError' ) ) );
			pending.push( { body: JSON.parse( String( init.body ) ), signal, answer: ( status, body ) => resolve( { status, json: async () => body } ) } );
		} );
	} ) );
} );

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
} );

function mount( style: 'card' | 'sticky' = 'card', live = true, change?: ( c: RuntimeConfig ) => void ): { root: HTMLElement; app: FormApp } {
	const root = document.createElement( 'div' );
	root.className = 'ffx-form';
	if ( live ) {
		root.dataset.ffxChunks = 'live';
	}
	document.body.append( root );
	const c = config( style );
	change?.( c );
	const app = new FormApp( root, c, { url: 'https://example.org/', query: '', title: 'Seite' } );
	return { root, app };
}

const $ = <T extends HTMLElement = HTMLElement>( root: HTMLElement, selector: string ): T => root.querySelector( selector ) as T;
const type = ( input: HTMLInputElement, value: string ): void => {
	input.value = value;
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
};
const values = ( root: HTMLElement ): string[] => [ ...root.querySelectorAll( '.ffx-live-value' ) ].map( ( e ) => e.textContent ?? '' );

describe( 'live results', () => {
	it( 'formats results like the plugin', () => {
		expect( formatResult( 1234.5, { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.', prefix: '€ ' } ) ).toBe( '€ 1.234,50' );
		expect( formatResult( -999.5, { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.' } ) ).toBe( '-1.000' );
	} );

	it( 'draws a card with the results, a range, a starting price and the small print', async () => {
		const { root } = mount();
		const box = $( root, '.ffx-field-result .ffx-live-card' );
		expect( $( box, '.ffx-live-title' ).textContent ).toBe( 'Ihr Preis' );
		expect( $( box, '.ffx-live-note' ).textContent ).toBe( 'Unverbindliche Schätzung' );
		// Nothing is known yet: the place is kept with a placeholder.
		expect( values( root ) ).toEqual( [ '…', '…' ] );
		expect( pending ).toHaveLength( 1 );
		// The texts of the step come with the boxes, in one request.
		expect( pending[ 0 ]?.body ).toEqual( { answers: {}, ids: [ 'tax', 'low', 'high', 'extras' ], live: true, locale: 'de_DE' } );
		pending[ 0 ]?.answer( 200, { ok: true, calculations: { low: '1.200 €', high: '1.500 €', extras: '0 €' }, values: { low: 1200, high: 1500, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( values( root ) ).toEqual( [ '1.200 – 1.500 €', 'ab 0 €' ] );
		expect( $( box, '[role="status"]' ).textContent ).toBe( 'Malerarbeiten: 1.200 – 1.500 €' );
	} );

	it( 'asks again once the input rests, drops overtaken answers and keeps the last results meanwhile', async () => {
		const { root } = mount();
		pending[ 0 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1200, high: 1500, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		const input = $<HTMLInputElement>( root, '.ffx-field-number input' );
		type( input, '5' );
		await vi.advanceTimersByTimeAsync( DELAY - 50 );
		type( input, '50' );
		await vi.advanceTimersByTimeAsync( DELAY - 50 );
		// Still typing: no request yet.
		expect( pending ).toHaveLength( 1 );
		await vi.advanceTimersByTimeAsync( 50 );
		expect( pending ).toHaveLength( 2 );
		expect( pending[ 1 ]?.body ).toEqual( { answers: { q1: 50 }, ids: [ 'tax', 'low', 'high', 'extras' ], live: true, locale: 'de_DE' } );
		expect( $( root, '.ffx-live' ).classList.contains( 'is-loading' ) ).toBe( true );
		expect( values( root ) ).toEqual( [ '1.200 – 1.500 €', 'ab 0 €' ] );

		// A newer answer overtakes the request on its way.
		type( input, '60' );
		await vi.advanceTimersByTimeAsync( DELAY );
		expect( pending ).toHaveLength( 3 );
		expect( pending[ 1 ]?.signal.aborted ).toBe( true );
		pending[ 1 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1, high: 2, extras: 3 } } );
		pending[ 2 ]?.answer( 200, { ok: true, calculations: { tax: '19,00' }, values: { low: 2400, high: 3000, extras: 400, tax: 19 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( values( root ) ).toEqual( [ '2.400 – 3.000 €', 'ab 400 €' ] );
		expect( $( root, '[data-ffx-calc="tax"]' ).textContent ).toBe( '19,00' );
		expect( $( root, '.ffx-live' ).classList.contains( 'is-loading' ) ).toBe( false );
		expect( $( root, '.ffx-live' ).hasAttribute( 'aria-busy' ) ).toBe( false );

		// The same answers again need no request.
		type( input, '60' );
		await vi.advanceTimersByTimeAsync( DELAY );
		expect( pending ).toHaveLength( 3 );
	} );

	it( 'keeps the last results when the plugin refuses or cannot compute', async () => {
		const { root } = mount();
		pending[ 0 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1200, high: 1500, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		type( $<HTMLInputElement>( root, '.ffx-field-number input' ), '7' );
		await vi.advanceTimersByTimeAsync( DELAY );
		pending[ 1 ]?.answer( 429, { ok: false, code: 'rate_limited' } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( values( root ) ).toEqual( [ '1.200 – 1.500 €', 'ab 0 €' ] );

		type( $<HTMLInputElement>( root, '.ffx-field-number input' ), '8' );
		await vi.advanceTimersByTimeAsync( DELAY );
		pending[ 2 ]?.answer( 200, { ok: true, calculations: { low: 'Fehler!', high: '1 €', extras: '2 €' }, values: { low: null, high: 1, extras: 2 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( values( root ) ).toEqual( [ 'Fehler!', 'ab 2 €' ] );
	} );

	it( 'counts up to a new result, unless the visitor reduces motion', async () => {
		reduced = false;
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal( 'requestAnimationFrame', ( cb: FrameRequestCallback ) => frames.push( cb ) );
		vi.stubGlobal( 'cancelAnimationFrame', () => undefined );
		const now = vi.spyOn( performance, 'now' ).mockReturnValue( 0 );
		const { root } = mount();
		pending[ 0 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1000, high: 2000, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		// The first result shows at once.
		expect( values( root )[ 0 ] ).toBe( '1.000 – 2.000 €' );
		type( $<HTMLInputElement>( root, '.ffx-field-number input' ), '9' );
		await vi.advanceTimersByTimeAsync( DELAY );
		pending[ 1 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 2000, high: 4000, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( values( root )[ 0 ] ).toBe( '1.000 – 2.000 €' );
		frames.shift()?.( 200 );
		expect( values( root )[ 0 ] ).toBe( '1.875 – 3.750 €' );
		frames.shift()?.( 400 );
		expect( values( root )[ 0 ] ).toBe( '2.000 – 4.000 €' );
		expect( $( root, '[role="status"]' ).textContent ).toBe( 'Malerarbeiten: 2.000 – 4.000 €' );
		now.mockRestore();
	} );

	it( 'keeps the sticky box from its step on and hides it at the end', async () => {
		const { root } = mount( 'sticky' );
		// The step keeps no room for it; the box sits in the shell, after the steps.
		expect( $( root, '.ffx-field-result' ).childElementCount ).toBe( 0 );
		const box = $( root, '.ffx-shell > aside.ffx-live-sticky' );
		expect( box.getAttribute( 'aria-label' ) ).toBe( 'Ihr Preis' );
		expect( root.classList.contains( 'ffx-has-live' ) ).toBe( true );
		pending[ 0 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1200, high: 1500, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		type( $<HTMLInputElement>( root, '.ffx-field-number input' ), '40' );
		$( root, '.ffx-button-next' ).click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		// The same box stays; the card of the new step shows the known result at once.
		expect( $( root, '.ffx-shell > aside.ffx-live-sticky' ) ).toBe( box );
		expect( values( $( root, '.ffx-card' ) ) ).toEqual( [ '1.200 €' ] );
		expect( pending ).toHaveLength( 2 );
		expect( pending[ 1 ]?.body.answers ).toEqual( { q1: 40 } );
		pending[ 1 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1300, high: 1600, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( values( box ) ).toEqual( [ '1.300 – 1.600 €', 'ab 0 €' ] );
		expect( values( $( root, '.ffx-card' ) ) ).toEqual( [ '1.300 €' ] );

		// Back on its step, it is still there.
		$( root, '.ffx-button-back' ).click();
		expect( $( root, '.ffx-shell > aside.ffx-live-sticky' ) ).toBe( box );
	} );

	it( 'waits with a placeholder while a required question it uses is still open', async () => {
		const { root } = mount( 'sticky', true, ( c ) => {
			c.document.calculations = [
				{ id: 'low', format: EURO, uses: [ 'size', 'note' ] },
				{ id: 'high', format: EURO, uses: [ 'size' ] },
				{ id: 'extras', format: EURO, uses: [ 'extra' ] },
				{ id: 'tax' },
			];
		} );
		const box = $( root, '.ffx-live-sticky' );
		// The box sits before the bottom bar, so on phones it stays right above it.
		expect( box.nextElementSibling?.classList.contains( 'ffx-nav' ) ).toBe( true );
		pending[ 0 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 0, high: 0, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		// Size (required, here) and the extras (required, on the next step) are open; the note is optional.
		expect( values( box ) ).toEqual( [ '–', '–' ] );
		expect( $( box, '[role="status"]' ).textContent ).toBe( '' );
		type( $<HTMLInputElement>( root, '.ffx-field-number input' ), '40' );
		await vi.advanceTimersByTimeAsync( DELAY );
		pending[ 1 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1200, high: 1500, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( values( box ) ).toEqual( [ '1.200 – 1.500 €', '–' ] );
		// On the next step the extras are still open; the answers are those of the results shown.
		$( root, '.ffx-button-next' ).click();
		expect( pending ).toHaveLength( 2 );
		expect( values( box ) ).toEqual( [ '1.200 – 1.500 €', '–' ] );
		$<HTMLButtonElement>( root, '.ffx-option' ).click();
		// Answered (and on to the contact step): the extras count.
		pending[ 2 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1200, high: 1500, extras: 300 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n3' );
		expect( values( box ) ).toEqual( [ '1.200 – 1.500 €', 'ab 300 €' ] );
	} );

	it( 'shows a result once and asks once on a step that shows it as text', async () => {
		const calls = vi.mocked( fetch );
		const { root } = mount( 'sticky', true, ( c ) => {
			const step = c.document.nodes[ 1 ] as Extract<RuntimeConfig[ 'document' ][ 'nodes' ][ number ], { type: 'step' }>;
			step.fields = [ { id: 'q5', key: 'res', type: 'content', label: de( '' ), description: de( '' ), required: false, props: { html: de( '<p>Preis: {{calc:low}}</p>' ), button: { show: true, label: de( 'Weiter' ) } } } as never ];
		} );
		pending[ 0 ]?.answer( 200, { ok: true, calculations: {}, values: { low: 1200, high: 1500, extras: 0 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		type( $<HTMLInputElement>( root, '.ffx-field-number input' ), '40' );
		$( root, '.ffx-button-next' ).click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		expect( $( root, '.ffx-live-sticky' ).hidden ).toBe( true );
		// One request for the text, none of the core.
		const asked = calls.mock.calls.filter( ( [ url ] ) => String( url ).endsWith( '/calculations' ) ).length;
		expect( pending ).toHaveLength( 2 );
		expect( asked ).toBe( 2 );
		expect( pending[ 1 ]?.body.ids ).toEqual( [ 'low' ] );
		pending[ 1 ]?.answer( 200, { ok: true, calculations: { low: '1.300 €' }, values: { low: 1300 } } );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '[data-ffx-calc="low"]' ).textContent ).toBe( '1.300 €' );
		// Back on the step before, the box shows again.
		$( root, '.ffx-button-back' ).click();
		expect( $( root, '.ffx-live-sticky' ).hidden ).toBe( false );
	} );

	it( 'lets a single choice next to a live result move on by itself', () => {
		const { root } = mount();
		type( $<HTMLInputElement>( root, '.ffx-field-number input' ), '40' );
		$( root, '.ffx-button-next' ).click();
		expect( $( root, '.ffx-button-next' ).hidden ).toBe( true );
		$<HTMLButtonElement>( root, '.ffx-option' ).click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n3' );
		// The contact step and the end show no box.
		expect( root.querySelector( '.ffx-live-sticky' ) ).toBeNull();
	} );

	it( 'waits for the script only when the form lists the live chunk', () => {
		const queue = window.ffxLive;
		window.ffxLive = undefined;
		try {
			mount( 'card', false );
			expect( window.ffxLive ).toBeUndefined();
			const { app } = mount();
			expect( window.ffxLive ).toEqual( [ app ] );
		} finally {
			window.ffxLive = queue;
		}
	} );
} );
