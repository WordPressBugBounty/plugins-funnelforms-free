import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDocument, type FormDocument, type ResultField } from '@funnelforms/form-schema';
import type { EntriesApi, EntrySummary, FormDetail, FormsApi } from '../src/api';
import { addressOf, stateFromAddress } from '../src/entries';
import { lineTokens, revealedLater, revealOnEndPages } from '../src/reveal';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { lookupFormula } from '../src/ui/CalculationsPlus';
import { EntriesScreen } from '../src/ui/Entries';
import { blank } from './blank';

/** The editor of calculator funnels: price table, texts by result, lead value and locked live results. */
( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const FORMAT = { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.' };

function formsApi( doc: FormDocument = blank() ): FormsApi {
	const detail = (): FormDetail => ( { id: 7, uid: 'uid', title: 'Anfrage', category: '', status: 'draft', renderer: 'v5', legacyId: null, currentRevision: null, hasDraft: true, draftUpdatedAt: null, draftAuthor: null, lockedBy: null, entries: 0, shortcode: '', createdAt: null, updatedAt: null, document: structuredClone( doc ), lockTtl: 150 } );
	const known: Partial<FormsApi> = {
		get: vi.fn( async () => detail() ),
		lock: vi.fn( async () => undefined ),
		unlock: vi.fn( async () => undefined ),
		saveDraft: vi.fn( async () => ( { problems: [], missingRights: [], form: detail() } ) ),
	};
	// Everything else the builder may ask for answers with nothing.
	const rest: Record<string, unknown> = {};
	return new Proxy( known, { get: ( target, key: string ) => ( target as Record<string, unknown> )[ key ] ?? ( rest[ key ] ??= vi.fn( async () => [] ) ) } ) as FormsApi;
}

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
} );

afterEach( () => {
	act( () => root.unmount() );
	container.remove();
} );

async function settle(): Promise<void> {
	await act( async () => {
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );
}

function control<T extends HTMLElement>( label: string ): T {
	const byLabel = [ ...container.querySelectorAll( 'label' ) ].find( ( l ) => l.textContent?.trim() === label );
	const el = byLabel ? document.getElementById( byLabel.htmlFor ) : container.querySelector( `[aria-label="${ label }"]` );
	if ( ! el ) {
		throw new Error( 'No field ' + label );
	}
	return el as T;
}

async function fill( label: string, value: string ): Promise<void> {
	const el = control<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>( label );
	const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	await act( async () => {
		Object.getOwnPropertyDescriptor( proto, 'value' )?.set?.call( el, value );
		el.dispatchEvent( new Event( el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true } ) );
	} );
}

function button( label: string ): HTMLButtonElement {
	const found = [ ...container.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.trim() === label || b.getAttribute( 'aria-label' ) === label );
	if ( ! found ) {
		throw new Error( 'No button ' + label );
	}
	return found;
}

async function click( el: HTMLElement ): Promise<void> {
	await act( async () => el.click() );
	await settle();
}

async function openBuilder( doc: FormDocument = blank() ) {
	const api = formsApi( doc );
	const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
	await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
	await settle();
	return store;
}

async function settings(): Promise<void> {
	const tab = [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-views__item' ) ].find( ( b ) => 'Settings' === b.textContent );
	if ( ! tab ) {
		throw new Error( 'No settings' );
	}
	await click( tab );
}

describe( 'price table', () => {
	it( 'writes lookup() with the tiers sorted by their limits', () => {
		expect( lookupFormula( '[qty]', [ { limit: '50', value: '15' }, { limit: '10', value: '25' }, { limit: 'x', value: '1' } ], '' ) ).toBe( 'lookup([qty]; 10; 25; 50; 15; 0)' );
		expect( lookupFormula( '', [ { limit: '2,5', value: '' } ], '9' ) ).toBe( 'lookup(0; 2.5; 0; 9)' );
	} );

	it( 'inserts a table into the formula and edits a lookup in place', async () => {
		const store = await openBuilder();
		await act( async () => store.getState().select( {} ) );
		await settings();
		await click( button( 'Add calculation' ) );
		await click( button( 'Price table' ) );
		await fill( 'Look up', '[qty]' );
		await fill( 'Limit of row 1', '10' );
		await fill( 'Result of row 1', '25' );
		await fill( 'Limit of row 2', '50' );
		await fill( 'Result of row 2', '20' );
		await fill( 'Result above the last limit', '15' );
		expect( container.querySelector( '.ffxb-calc-table__formula' )?.textContent ).toBe( 'lookup([qty]; 10; 25; 50; 20; 15)' );
		await click( button( 'Apply table' ) );
		const calc = (): FormDocument[ 'calculations' ][ number ] | undefined => store.getState().doc?.calculations[ 0 ];
		expect( calc()?.expression ).toEqual( { fn: 'lookup', args: [ { var: 'qty' }, { num: 10 }, { num: 25 }, { num: 50 }, { num: 20 }, { num: 15 } ] } );

		await click( button( 'Edit as price table' ) );
		expect( control<HTMLInputElement>( 'Look up' ).value ).toBe( '[qty]' );
		await click( button( 'Add row' ) );
		await fill( 'Result of row 3', '12' );
		await click( button( 'Apply table' ) );
		expect( calc()?.expression ).toEqual( { fn: 'lookup', args: [ { var: 'qty' }, { num: 10 }, { num: 25 }, { num: 50 }, { num: 20 }, { num: 100 }, { num: 12 }, { num: 15 } ] } );
	} );
} );

describe( 'texts by result and the lead value', () => {
	it( 'adds texts by range, shows the one of the test and makes a calculation the lead value', async () => {
		const doc = blank();
		doc.calculations.push( { id: 'calc_score', label: 'Score', expression: { num: 30 }, format: FORMAT } );
		const store = await openBuilder( doc );
		await act( async () => store.getState().select( {} ) );
		await settings();
		await click( container.querySelector<HTMLElement>( '.ffxb-action__toggle[aria-expanded="false"]' ) as HTMLElement );
		await settle();

		await click( button( 'Add text' ) );
		await fill( 'To (text 1)', '40' );
		await fill( 'Text', 'Beginner' );
		await click( button( 'Add text' ) );
		const texts = (): unknown => store.getState().doc?.calculations[ 0 ]?.texts;
		expect( texts() ).toEqual( [ { to: 40, text: { de_DE: 'Beginner' } }, { from: 41, text: { de_DE: '' } } ] );
		expect( container.querySelector( '.ffxb-calc-texts__row.is-current' )?.textContent ).toContain( 'Applies to the test' );
		expect( container.querySelector<HTMLInputElement>( 'input[value="{{calc:calc_score:text}}"]' )?.readOnly ).toBe( true );
		await click( button( 'Remove text' ) );
		expect( texts() ).toEqual( [ { from: 41, text: { de_DE: '' } } ] );

		await click( control( 'This is the order value of the lead' ) );
		expect( store.getState().doc?.settings.valueCalculation ).toBe( 'calc_score' );
		expect( validateDocument( store.getState().doc as FormDocument ).errors ).toEqual( [] );
		await click( control( 'This is the order value of the lead' ) );
		expect( store.getState().doc?.settings.valueCalculation ).toBeUndefined();
	} );
} );

describe( 'locked live results', () => {
	const field = ( lines: ResultField[ 'props' ][ 'lines' ] ): ResultField => ( { id: 'r1', key: 'r1', type: 'result', label: { de_DE: '' }, description: { de_DE: '' }, required: false, props: { style: 'card', lines, reveal: 'contact' } } );

	it( 'know the placeholders of a line and add them to thank-you pages', () => {
		expect( lineTokens( { calculation: 'a', label: {} } ) ).toBe( '{{calc:a}}' );
		expect( lineTokens( { calculation: 'a', to: 'b', label: {} } ) ).toBe( '{{calc:a}} – {{calc:b}}' );
		expect( lineTokens( { calculation: 'a', label: {}, text: true } ) ).toBe( '{{calc:a:text}}' );

		const doc = blank();
		const result = field( [ { calculation: 'a', to: 'b', label: { de_DE: 'Preis <b>' }, suffix: ' €' } ] );
		expect( revealedLater( doc, result ) ).toBe( false );
		expect( revealOnEndPages( doc, result, 'de_DE' ) ).toBeGreaterThan( 0 );
		expect( revealedLater( doc, result ) ).toBe( true );
		const end = doc.nodes.find( ( n ) => 'end' === n.type );
		expect( end && 'end' === end.type ? end.success?.text.de_DE : '' ).toContain( '<p>Preis: <strong>{{calc:a}} – {{calc:b}} €</strong></p>' );
		// Twice adds nothing.
		expect( revealOnEndPages( doc, result, 'de_DE' ) ).toBe( 0 );
	} );

	it( 'lock a live result until the contact step with a teaser and a line with the text by result', async () => {
		const doc = blank();
		doc.calculations.push( { id: 'calc_low', label: 'From', expression: { num: 1200 }, format: FORMAT, texts: [ { text: { de_DE: 'Small' } } ] } );
		const store = await openBuilder( doc );
		await click( button( 'Live result' ) );
		await click( button( 'Add result' ) );
		const props = (): ResultField[ 'props' ] | undefined => {
			for ( const n of store.getState().doc?.nodes ?? [] ) {
				const f = 'step' === n.type ? n.fields.find( ( x ) => 'result' === x.type ) : undefined;
				if ( f ) {
					return ( f as ResultField ).props;
				}
			}
			return undefined;
		};
		await click( control( 'Show the text by result instead of the number' ) );
		expect( props()?.lines[ 0 ]?.text ).toBe( true );

		await fill( 'Show the result', 'contact' );
		expect( props()?.reveal ).toBe( 'contact' );
		await fill( 'Line while the result is locked', 'Ready after your details.' );
		expect( props()?.teaser ).toEqual( { de_DE: 'Ready after your details.' } );
		await click( button( 'Show it on the thank-you page' ) );
		expect( JSON.stringify( store.getState().doc?.nodes ) ).toContain( '{{calc:calc_low:text}}' );
		expect( container.querySelector( '.ffxb-notice--warning' ) ).toBeNull();
		expect( validateDocument( store.getState().doc as FormDocument ).errors ).toEqual( [] );

		await fill( 'Show the result', 'show' );
		expect( props()?.reveal ).toBeUndefined();
		expect( props()?.teaser ).toBeUndefined();
	} );
} );

describe( 'entries by lead value', () => {
	it( 'keeps the order in the address', () => {
		const state = stateFromAddress( '?page=funnelforms-entries&sort=value' );
		expect( state.filter.sort ).toBe( 'value' );
		expect( stateFromAddress( '?sort=price' ).filter.sort ).toBeUndefined();
		expect( addressOf( state, 'https://example.test/wp-admin/admin.php?page=funnelforms-entries' ) ).toBe( 'https://example.test/wp-admin/admin.php?page=funnelforms-entries&sort=value' );
	} );

	it( 'shows the lead value and sorts by it', async () => {
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries' );
		const entry = ( id: number, value: number | null ): EntrySummary =>
			( { id, uid: 'u' + id, form: { id: 3, legacyId: null, title: 'Angebot' }, status: 'complete', leadStatus: 'new', read: true, archived: false, public: false, tags: [], score: null, value, variants: {}, optIn: null, payment: null, assignedTo: null, imported: false, legacyLeadId: null, locale: 'de_DE', createdAt: null, completedAt: null, sourceUrl: '', device: '', contact: [ { label: 'E-Mail', type: 'email', value: `lead${ id }@example.test` } ] } ) as EntrySummary;
		const entries = vi.fn( async () => ( { entries: [ entry( 1, 1250.5 ), entry( 2, null ) ], total: 2, pages: 1 } ) );
		const none = vi.fn( async () => [] );
		const api = { entries, entry: vi.fn(), updateEntry: vi.fn(), bulkEntries: vi.fn(), deleteEntry: vi.fn(), notSpam: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn(), resend: vi.fn(), checkPayment: vi.fn(), cancelAppointment: vi.fn(), entryTags: none, assignees: none } as unknown as EntriesApi;
		await act( async () => root.render( <EntriesScreen api={ api } config={ { forms: [ { id: 3, title: 'Angebot' } ] } } /> ) );
		await settle();
		const rows = container.querySelectorAll( 'tbody tr' );
		expect( rows[ 0 ]?.textContent ).toContain( 'Value ' + ( 1250.5 ).toLocaleString( undefined, { maximumFractionDigits: 2 } ) );
		expect( rows[ 1 ]?.textContent ).not.toContain( 'Value' );

		const sort = [ ...container.querySelectorAll( 'select' ) ].find( ( s ) => [ ...s.options ].some( ( o ) => 'Highest lead value' === o.text ) ) as HTMLSelectElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( sort, 'value' );
			sort.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
		await settle();
		expect( entries ).toHaveBeenLastCalledWith( expect.objectContaining( { sort: 'value', page: 1 } ) );
		expect( window.location.search ).toBe( '?page=funnelforms-entries&sort=value' );
	} );
} );
