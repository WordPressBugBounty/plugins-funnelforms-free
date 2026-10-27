import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDetail, FormsApi, FormSummary } from '../src/api';
import { isPro, isProCondition, setEdition } from '../src/edition';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { FormStatsScreen } from '../src/ui/Stats';
import { problemText } from '../src/ui/catalog';
import { blank } from './blank';

// The builder of Funnelforms Free: the build replaces process.env.FUNNELFORMS_EDITION; here it is set per test.
( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const summary: FormSummary = {
	id: 7,
	uid: 'uid',
	title: 'Anfrage',
	category: '',
	status: 'draft',
	renderer: 'v5',
	legacyId: null,
	currentRevision: null,
	hasDraft: true,
	draftUpdatedAt: null,
	draftAuthor: null,
	lockedBy: null,
	entries: 0,
	shortcode: '[funnelforms uid="uid"]',
	createdAt: null,
	updatedAt: null,
};

/** An API that answers every call; get() returns the blank form. */
function fakeApi(): FormsApi {
	const detail = (): FormDetail => ( { ...summary, document: blank(), lockTtl: 150 } );
	const calls: Record<string, unknown> = {
		get: vi.fn( async () => detail() ),
		saveDraft: vi.fn( async () => ( { problems: [], missingRights: [], form: summary } ) ),
		connections: vi.fn( async () => [] ),
		styles: vi.fn( async () => [] ),
		fonts: vi.fn( async () => [] ),
		googleFonts: vi.fn( async () => [] ),
		revisions: vi.fn( async () => [] ),
		formStats: vi.fn( async () => ( {
			form: 7,
			from: '2026-09-17',
			to: '2026-10-16',
			totals: { views: 150, starts: 60, completions: 12, conversionRate: 0.08, averageSeconds: 125, medianSeconds: 70 },
			devices: { desktop: 3, tablet: 0, mobile: 9 },
			daily: [ { date: '2026-10-16', views: 150, starts: 60, completions: 12 } ],
			steps: [ { id: 'n1', type: 'step' as const, title: 'Wofür?', reached: 60, left: 20 } ],
			answers: [ { field: 'q1', step: 'n1', title: 'Wofür?', options: [ { id: 'o1', label: 'Haus', chosen: 30, completed: 9 } ] } ],
		} ) ),
	};
	return new Proxy( calls, { get: ( target, key: string ) => target[ key ] ?? ( target[ key ] = vi.fn( async () => undefined ) ) } ) as unknown as FormsApi;
}

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	process.env.FUNNELFORMS_EDITION = 'free';
	setEdition( {
		edition: 'free',
		proStepFields: [ 'slider', 'file', 'address', 'signature', 'repeat', 'booking' ],
		proContactFields: [ 'phone_verification', 'html' ],
		proActions: [ 'webhook', 'crm', 'chat', 'sms', 'whatsapp', 'conversion', 'googleAds' ],
		freeConditionOps: [ 'selected' ],
		proFeatures: [ 'calculations' ],
		labels: { calculations: 'Calculations and price calculators' },
		proUrl: 'admin.php?page=funnelforms-upgrade',
	} );
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
} );

afterEach( () => {
	act( () => root.unmount() );
	container.remove();
	delete process.env.FUNNELFORMS_EDITION;
	setEdition( undefined );
} );

async function settle(): Promise<void> {
	await act( async () => {
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );
}

async function open( view?: 'settings' | 'design' ): Promise<ReturnType<typeof createBuilderStore>> {
	const api = fakeApi();
	const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
	await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } view={ view } /> ) );
	await settle();
	return store;
}

describe( 'Funnelforms Free', () => {
	it( 'knows which field types, actions and conditions are Pro', () => {
		expect( isPro( 'field:slider' ) ).toBe( true );
		expect( isPro( 'field:choice' ) ).toBe( false );
		expect( isPro( 'contact_field:html' ) ).toBe( true );
		expect( isPro( 'action:webhook' ) ).toBe( true );
		expect( isPro( 'action:email' ) ).toBe( false );
		expect( isProCondition( 'selected' ) ).toBe( false );
		expect( isProCondition( 'gte' ) ).toBe( true );
	} );

	it( 'names the Pro feature that keeps a form from being published', () => {
		expect( problemText( 'pro feature calculations' ) ).toBe( 'The form uses “Calculations and price calculators”, which is part of Funnelforms Pro, so Funnelforms Free cannot publish it.' );
		delete process.env.FUNNELFORMS_EDITION;
		expect( problemText( 'pro feature calculations' ) ).toBe( 'pro feature calculations' );
	} );

	it( 'shows Pro field types with a badge that cannot be added', async () => {
		const store = await open();
		const slider = [ ...container.querySelectorAll( '.ffxb-tile--pro' ) ].find( ( t ) => t.textContent?.includes( 'Slider' ) );
		expect( slider?.textContent ).toContain( 'Pro' );
		expect( slider?.tagName ).toBe( 'SPAN' );
		expect( [ ...container.querySelectorAll( 'button.ffxb-tile' ) ].map( ( b ) => b.textContent ) ).not.toContain( 'Slider' );
		const choice = [ ...container.querySelectorAll<HTMLButtonElement>( 'button.ffxb-tile' ) ].find( ( b ) => b.textContent === 'Choice' );
		await act( async () => choice?.click() );
		expect( store.getState().doc?.nodes ).toHaveLength( 3 );
	} );

	it( 'shows the Pro settings as cards with what each brings instead of showing them', async () => {
		await open( 'settings' );
		const text = container.textContent ?? '';
		expect( text ).toContain( 'More settings' );
		expect( text ).toContain( 'These settings come with Funnelforms Pro:' );
		expect( text ).not.toContain( 'Save incomplete entries' );
		const cards = [ ...container.querySelectorAll( '.ffxb-pro__feature' ) ];
		expect( cards.map( ( c ) => c.getAttribute( 'data-feature' ) ) ).toEqual( [ 'languages', 'calculations', 'quiz', 'experiments', 'payment', 'optin', 'abandon', 'access' ] );
		expect( cards.every( ( c ) => c.querySelector( '.ffxb-badge' )?.textContent === 'Pro' && c.querySelector( 'svg' ) ) ).toBe( true );
		expect( cards[ 1 ]?.textContent ).toContain( 'Prices, budgets and scores worked out from the answers.' );
		// The list at the side marks the part of Pro.
		const links = [ ...container.querySelectorAll( '.ffxb-sheet__link' ) ];
		expect( links.filter( ( l ) => l.querySelector( '.ffxb-badge' ) ).map( ( l ) => l.textContent ) ).toEqual( [ 'More settingsPro' ] );
		expect( container.querySelector( '.ffxb-pro__link' )?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-upgrade' );
	} );

	it( 'shows the editor of a Pro setting the form already uses, to switch it off', async () => {
		const store = await open( 'settings' );
		expect( container.querySelector( '#ffxb-part-calculations' ) ).toBeNull();
		await act( async () =>
			store.getState().change( ( d ) => {
				d.calculations.push( { id: 'calc1', label: 'Preis', expression: { num: 1 }, format: { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.' } } );
			} )
		);
		await settle();
		expect( container.querySelector( '#ffxb-part-calculations' ) ).not.toBeNull();
		expect( container.querySelector( '#ffxb-part-quiz' ) ).toBeNull();
	} );

	it( 'offers one mail to the owner and one confirmation per contact step', async () => {
		const store = await open();
		const after = container.querySelector<HTMLButtonElement>( '.ffxb-node--contact .ffxb-node__after' );
		await act( async () => after?.click() );
		await settle();
		const select = (): HTMLSelectElement => {
			const label = [ ...container.querySelectorAll( 'label' ) ].find( ( l ) => 'Add an action' === l.textContent?.trim() );
			return document.getElementById( label?.htmlFor ?? '' ) as HTMLSelectElement;
		};
		expect( [ ...select().options ].map( ( o ) => o.value ) ).toEqual( [ '', 'email', 'autoresponder' ] );
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( select(), 'email' );
			select().dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
		expect( store.getState().doc?.actions.map( ( a ) => a.kind ) ).toEqual( [ 'email' ] );
		expect( [ ...select().options ].map( ( o ) => o.value ) ).toEqual( [ '', 'autoresponder' ] );
		expect( container.textContent ).toContain( 'come with Funnelforms Pro' );
		expect( container.textContent ).not.toContain( 'Attach the entry as PDF' );
	} );

	it( 'offers the language choice of visitors only to switch it off', async () => {
		const store = await open( 'settings' );
		await act( async () =>
			store.getState().change( ( d ) => {
				d.locales.available.push( 'en_US' );
			} )
		);
		await settle();
		expect( container.querySelector( '#ffxb-part-languages' ) ).not.toBeNull();
		expect( container.textContent ).not.toContain( 'Let visitors choose the language' );
		expect( container.textContent ).not.toContain( 'Add a language' );
		await act( async () =>
			store.getState().change( ( d ) => {
				d.settings.languageSwitch = true;
			} )
		);
		await settle();
		expect( container.textContent ).toContain( 'Let visitors choose the language' );
	} );

	it( 'has no saved styles in the design', async () => {
		const api = fakeApi();
		await open( 'design' );
		expect( container.textContent ).toContain( 'Corporate' );
		expect( container.textContent ).not.toContain( 'Save as style' );
		expect( container.querySelector( '.ffxb-saved-styles' ) ).toBeNull();
		void api;
	} );

	it( 'shows a field only on a chosen answer, and keeps a Pro rule visible to replace it', async () => {
		const store = await open();
		const press = async ( label: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll<HTMLButtonElement>( 'button' ) ].find( ( b ) => b.textContent?.trim() === label );
			if ( ! found ) {
				throw new Error( 'No button ' + label );
			}
			await act( async () => found.click() );
			await settle();
		};
		await press( 'Choice' );
		const step = store.getState().selection.node as string;
		await press( 'Short text' );
		const fields = () => ( store.getState().doc?.nodes.find( ( n ) => n.id === step ) as { fields: Array<{ id: string; showWhen?: Record<string, unknown> }> } ).fields;
		expect( fields() ).toHaveLength( 2 );
		await press( 'Only if …' );
		expect( fields()[ 1 ]?.showWhen ).toMatchObject( { field: fields()[ 0 ]?.id, op: 'selected' } );
		expect( container.querySelector( '.ffxb-visibility [aria-label="Answer"]' ) ).not.toBeNull();
		expect( container.querySelector( '.ffxb-visibility [aria-label="Value"]' ) ).toBeNull();

		await act( async () =>
			store.getState().change( ( d ) => {
				const n = d.nodes.find( ( x ) => x.id === step );
				const f = n && 'fields' in n ? n.fields[ 1 ] : undefined;
				if ( f ) {
					( f as { showWhen?: unknown } ).showWhen = { field: fields()[ 0 ]?.id ?? '', op: 'gte', value: 3 };
				}
			} )
		);
		await settle();
		expect( container.querySelector( '.ffxb-visibility' )?.textContent ).toContain( 'condition of Funnelforms Pro' );
		// Field wording under "Show this field", not the wording of paths.
		expect( container.querySelector( '.ffxb-visibility' )?.textContent ).toContain( 'This field has a condition of Funnelforms Pro. Choose a question and an answer to replace it, or show the field always.' );
		expect( container.querySelector( '.ffxb-visibility' )?.textContent ).not.toContain( 'path' );
	} );

	it( 'hides the analytics switch without the right to see entries', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: false, code: false, settings: false } } /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-analytics__toggle' ) ).toBeNull();
		expect( container.textContent ).not.toContain( 'Analytics' );
	} );

	it( 'passes fixed parameters to a redirect, but leaves inserting answers to Pro', async () => {
		const store = await open();
		const press = async ( label: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll<HTMLButtonElement>( 'button' ) ].find( ( b ) => b.textContent?.trim() === label );
			if ( ! found ) {
				throw new Error( 'No button ' + label );
			}
			await act( async () => found.click() );
			await settle();
		};
		const type = async ( label: string, value: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll( 'label' ) ].find( ( l ) => l.textContent?.trim() === label );
			const el = found ? ( document.getElementById( found.htmlFor ) as HTMLInputElement ) : null;
			if ( ! el ) {
				throw new Error( 'No field ' + label );
			}
			await act( async () => {
				Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( el, value );
				el.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			} );
		};
		await act( async () => store.getState().select( { node: 'end' } ) );
		await press( 'Redirect' );
		const end = () => store.getState().doc?.nodes.find( ( n ) => 'end' === n.id ) as { redirect?: { params: Array<{ name: string; value: Record<string, string> }> } };
		expect( container.querySelector( '.ffxb-params' ) ).not.toBeNull();
		expect( container.querySelector( '.ffxb-params' )?.textContent ).not.toContain( 'Pass answers' );
		await press( 'Add parameter' );
		await type( 'Parameter', 'source' );
		await type( 'Value', 'newsletter' );
		expect( end().redirect?.params ).toEqual( [ { name: 'source', value: { de_DE: 'newsletter' } } ] );
		// No control to insert an answer, and no note for a fixed value.
		expect( [ ...container.querySelectorAll( '.ffxb-params label' ) ].map( ( l ) => l.textContent?.trim() ) ).not.toContain( 'Insert an earlier answer' );
		expect( container.querySelector( '.ffxb-params .ffxb-badge' ) ).toBeNull();

		// A value with a placeholder of an earlier answer gets the note at its row.
		await type( 'Value', '{{field:name}}' );
		const note = container.querySelector( '.ffxb-param .ffxb-hint' );
		expect( note?.textContent ).toBe( 'Pro Inserting earlier answers comes with Funnelforms Pro.' );
		expect( note?.querySelector( '.ffxb-badge' )?.textContent ).toBe( 'Pro' );
	} );

	it( 'leads the analytics switch to Pro and keeps the figures per step on the canvas', async () => {
		const api = fakeApi();
		api.get = vi.fn( async () => ( { ...summary, status: 'published' as const, currentRevision: 3, document: blank(), lockTtl: 150 } ) );
		api.formStats = vi.fn( async ( _id: number, from = '', to = '' ) => ( {
			form: 7,
			from,
			to,
			totals: { views: 10, starts: 5, completions: 1, conversionRate: 0.1 },
			daily: [],
			steps: [ { id: 'contact', type: 'contact' as const, title: '', reached: 5, left: 2 } ],
		} ) );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		const toggle = container.querySelector( '.ffxb-analytics__toggle' );
		expect( toggle?.tagName ).toBe( 'A' );
		expect( toggle?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-upgrade' );
		expect( toggle?.textContent ).toBe( 'Analytics Pro' );
		// No shortcut in Free.
		await act( async () => window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'a' } ) ) );
		expect( container.querySelector( '.ffxb-node__analytics' ) ).toBeNull();

		const button = ( label: string ): HTMLButtonElement => [ ...container.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.trim() === label ) as HTMLButtonElement;
		// The figures of the form are on the statistics page; the analytics of one form are Pro.
		await act( async () => root.render( <FormStatsScreen api={ api } formId={ 7 } published canvasUrl="admin.php?page=funnelforms-builder&form=7&figures=1" /> ) );
		await settle();
		const more = [ ...container.querySelectorAll( '.ffxb-notice' ) ].find( ( n ) => n.textContent?.includes( 'More in the analytics' ) );
		expect( more?.querySelector( '.ffxb-badge' )?.textContent ).toBe( 'Pro' );
		expect( more?.querySelector( 'a' )?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-upgrade' );
		expect( more?.querySelector( 'a' )?.textContent ).toBe( 'More about Funnelforms Pro' );
		expect( container.querySelector( 'a[href*="page=funnelforms-stats"]' ) ).toBeNull();
		expect( container.textContent ).not.toContain( 'Open analytics' );
		expect( container.querySelector( '.ffxb-kpis' )?.textContent ).toContain( '10' );
		const show = [ ...container.querySelectorAll( 'a' ) ].find( ( a ) => 'Show on the canvas' === a.textContent?.trim() );
		expect( show?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-builder&form=7&figures=1' );
		// Not published yet: no figures and no way to the canvas.
		await act( async () => root.render( <FormStatsScreen key="draft" api={ api } formId={ 7 } published={ false } canvasUrl="x" /> ) );
		expect( container.textContent ).toContain( 'Statistics start when the form is published.' );
		expect( container.textContent ).not.toContain( 'Show on the canvas' );

		// The link opens the editor with the figures per step on the canvas.
		await act( async () => root.render( <Builder key="figures" api={ api } formId={ 7 } onBack={ () => undefined } store={ store } figures /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-node .ffxb-node__figures' )?.textContent ).toContain( '2 left (40%)' );
		expect( container.querySelector( '.ffxb-figures-bar' )?.textContent ).toContain( 'The steps show the figures of' );
		expect( ( api.formStats as ReturnType<typeof vi.fn> ).mock.calls.every( ( c ) => undefined === c[ 3 ] ) ).toBe( true );
		await act( async () => button( 'Hide figures' ).click() );
		expect( container.querySelector( '.ffxb-node__figures' ) ).toBeNull();
	} );

	it( 'has the country picker of phone fields, and confirming numbers by text message as Pro', async () => {
		const store = await open();
		const contact = store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type ) as { id: string };
		await act( async () =>
			store.getState().change( ( d ) => {
				const node = d.nodes.find( ( n ) => n.id === contact.id ) as { fields: unknown[] };
				node.fields.push( { id: 'c_phone', type: 'phone', key: 'phone', label: { de_DE: 'Telefon' }, required: true, props: { placeholder: { de_DE: '' }, country: {} } } );
			} )
		);
		await act( async () => store.getState().select( { node: contact.id, field: 'c_phone' } ) );
		const toggles = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].map( ( l ) => l.textContent );
		expect( toggles ).toContain( 'Country picker' );
		expect( toggles ).not.toContain( 'Confirm by text message' );
		expect( container.textContent ).toContain( 'Confirming numbers by text message comes with Funnelforms Pro.' );
	} );
} );
