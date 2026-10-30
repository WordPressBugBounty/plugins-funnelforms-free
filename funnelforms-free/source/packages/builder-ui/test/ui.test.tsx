import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type BookingConfig, type FormDetail, type FormsApi, type FormSummary, type IconLibrary, type NewWhatsAppTemplate, type SiteDesign, type WhatsAppTemplate } from '../src/api';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { FormsList } from '../src/ui/FormsList';
import { parseExtensions } from '../src/ui/UploadProps';
import { placement } from '../src/ui/Tour';
import { addStep, defaultPlacement } from '../src/document';
import { setPrivacy } from '../src/privacy';
import { setCode } from '../src/code';
import { setIntegrationsUrl } from '../src/actions';
import type { ConnectApi, CrmProvider } from '../src/connect';
import { formProtection, setSpam } from '../src/spam';
import { today } from '../src/experiments';
import { periodDays } from '../src/stats';
import { blank } from './blank';
import { validateDocument, type ChoiceField, type ContactField, type FormDocument, type FormNode } from '@funnelforms/form-schema';

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
	entries: 3,
	shortcode: '[funnelforms uid="uid"]',
	createdAt: null,
	updatedAt: null,
};

function bookingDefaults(): BookingConfig {
	return { version: 2, kind: 'personal', location: '', timezone: '', hours: [ { days: [ 1, 2, 3, 4, 5 ], from: '09:00', to: '16:00' } ], durations: [ 30 ], interval: 30, bufferBefore: 0, bufferAfter: 15, notice: 60, horizon: { mode: 'rolling', amount: 2, unit: 'week' }, closed: [], special: [], dailyLimit: 0, staff: [], assignment: 'roundRobin', invitation: true, reminders: [], calendars: { write: '', conflicts: [] } };
}

function fakeApi( overrides: Partial<FormsApi> = {} ): FormsApi {
	const detail = (): FormDetail => ( { ...summary, document: blank(), lockTtl: 150 } );
	return {
		list: vi.fn( async () => ( { forms: [ summary ], total: 1, categories: [] } ) ),
		get: vi.fn( async () => detail() ),
		create: vi.fn( async () => detail() ),
		update: vi.fn( async () => detail() ),
		remove: vi.fn( async () => undefined ),
		saveDraft: vi.fn( async () => ( { problems: [], missingRights: [], form: summary } ) ),
		dropDraft: vi.fn( async () => detail() ),
		publish: vi.fn( async () => ( { revision: 1, renderer: 'v5' as const, warnings: [], form: { ...summary, status: 'published' as const } } ) ),
		revisions: vi.fn( async () => [] ),
		revision: vi.fn(),
		restore: vi.fn( async () => detail() ),
		duplicate: vi.fn( async () => detail() ),
		lock: vi.fn( async () => undefined ),
		unlock: vi.fn( async () => undefined ),
		exportForm: vi.fn( async () => ( {} ) ),
		importFile: vi.fn( async () => [] ),
		preview: vi.fn( async () => ( { html: '<!doctype html><p>Vorschau</p>' } ) ),
		templates: vi.fn( async () => ( {
			goals: [ 'quote' as const, 'consultation' as const ],
			categories: [ 'home' as const, 'health' as const ],
			languages: [ 'de_DE' ],
			locale: 'de_DE',
			templates: [
				{ id: 'moving', title: 'Umzugsunternehmen', description: 'Umzugsanfrage mit Preisrahmen.', goal: 'quote' as const, category: 'home' as const, icon: 'lucide:truck', features: [ 'calculation' as const ], steps: 8, firstQuestion: 'Wie viele Personen?', sample: { kind: 'choice', options: [], max: 0, style: '' } },
			],
			icons: {},
		} ) ),
		templatePreview: vi.fn( async () => ( { html: '<!doctype html><p>Vorlage</p>' } ) ),
		fromTemplate: vi.fn( async () => detail() ),
		styles: vi.fn( async () => [ { id: 'st_000000000001', name: 'Hausstil', tokens: { 'color.primary': '#c2410c', 'font.family': 'Poppins' }, createdAt: '' } ] ),
		saveStyle: vi.fn( async ( name: string, tokens: Record<string, string> ) => ( { id: 'st_000000000002', name, tokens, createdAt: '' } ) ),
		deleteStyle: vi.fn( async () => undefined ),
		fonts: vi.fn( async () => [ { file: 'Brand Sans.woff2', family: 'Brand Sans', size: 1000 } ] ),
		uploadFont: vi.fn( async ( _file: Blob, name: string ) => ( { file: name, family: name.replace( /\.[a-z0-9]+$/, '' ), size: 10 } ) ),
		googleFonts: vi.fn( async () => [
			{ family: 'Lobster', category: 'display' as const, installed: false },
			{ family: 'Lora', category: 'serif' as const, installed: false },
			{ family: 'Roboto', category: 'sans-serif' as const, installed: true },
		] ),
		installGoogleFont: vi.fn( async ( family: string ) => ( { family, category: 'display' as const, installed: true } ) ),
		branding: vi.fn( async ( url: string ) => ( {
			url,
			colors: [ '#0b7a75', '#1d1d1d', '#fafafa', '#e11d48' ],
			roles: { primary: '#0b7a75', text: '#1d1d1d' },
			fonts: [
				{ family: 'Open Sans', value: 'Open Sans', local: false },
				{ family: 'Brand Sans', value: 'Brand Sans.woff2', local: true },
			],
		} ) ),
		bookingTypes: vi.fn( async () => ( {
			types: [ { ref: 'legacy:7001', id: 1, title: 'Erstgespräch', config: bookingDefaults(), legacy: true, cronofy: true } ],
			staff: [ { id: 1, name: 'Ada' }, { id: 2, name: 'Grace' } ],
			calendars: [],
			timezone: 'Europe/Berlin',
			defaults: bookingDefaults(),
		} ) ),
		saveBookingType: vi.fn( async ( id: number | null, title: string, config: BookingConfig ) => ( { ref: `bt:${ id ?? 2 }`, id: id ?? 2, title, config, legacy: false, cronofy: false } ) ),
		deleteBookingType: vi.fn( async () => undefined ),
		connections: vi.fn( async () => [ { ref: 'conn:3', type: 'slack', label: 'Vertrieb' } ] ),
		createConnection: vi.fn( async ( type: string, label: string ) => ( { ref: 'conn:9', type, label } ) ),
		updateConnection: vi.fn( async ( ref: string ) => ( { ref, type: 'stripe', label: 'Shop' } ) ),
		startCalendarSignIn: vi.fn( async ( provider: string ) => ( { url: `https://api.funnelforms.cloud/kunde/v1/oauth/${ provider }/authorize?state=s1`, state: 's1' } ) ),
		calendarSignIn: vi.fn( async () => null ),
		passwordHash: vi.fn( async ( password: string ) => '$wp$hash-of-' + password ),
		experimentStats: vi.fn( async () => [] ),
		formStats: vi.fn( async ( _id: number, from = '2026-09-17', to = '2026-10-16' ) => ( {
			form: 7,
			from,
			to,
			// The 30 days before the current 30-day period, whatever today is.
			totals: from < periodDays( 30 ).from ? { views: 100, starts: 40, completions: 10, conversionRate: 0.1 } : { views: 150, starts: 60, completions: 12, conversionRate: 0.08, averageSeconds: 125, medianSeconds: 70 },
			devices: { desktop: 3, tablet: 0, mobile: 9 },
			daily: [ { date: to, views: 150, starts: 60, completions: 12 } ],
			steps: [ { id: 'n1', type: 'step' as const, title: 'Wofür?', reached: 60, left: 20 } ],
			answers: [ { field: 'q1', step: 'n1', title: 'Wofür?', options: [ { id: 'o1', label: 'Haus', chosen: 30, completed: 9 }, { id: 'o2', label: 'Wohnung', chosen: 10, completed: 1 } ] } ],
		} ) ),
		...overrides,
	} as FormsApi;
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

/** The control of a field, by its label. */
function labelled<T extends HTMLElement>( label: string ): T {
	const found = [ ...container.querySelectorAll<HTMLLabelElement>( '.ffxb-field__label' ) ].find( ( l ) => l.textContent === label );
	const control = found ? document.getElementById( found.htmlFor ) : null;
	if ( ! control ) {
		throw new Error( 'No field ' + label );
	}
	return control as T;
}

async function choose( label: string, value: string ): Promise<void> {
	const select = labelled<HTMLSelectElement>( label );
	await act( async () => {
		Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( select, value );
		select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	} );
}

/** Picks the tile of a value in the group of tiles with this legend (ChoiceTiles). */
async function tile( legend: string, value: string ): Promise<void> {
	const group = [ ...document.querySelectorAll<HTMLFieldSetElement>( 'fieldset.ffxb-tiles' ) ].find( ( f ) => legend === f.querySelector( 'legend' )?.textContent );
	const input = group?.querySelector<HTMLInputElement>( `input[value="${ value }"]` );
	if ( ! input ) {
		throw new Error( `No tile ${ value } in ${ legend }` );
	}
	await act( async () => input.click() );
}

async function slide( label: string, value: number ): Promise<void> {
	const input = labelled<HTMLInputElement>( label );
	await act( async () => {
		Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, String( value ) );
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	} );
}

async function settle(): Promise<void> {
	await act( async () => {
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );
}

/** Sets the value of the input, textarea or select with this label. */
async function fill( label: string, value: string, scope: ParentNode = container ): Promise<void> {
	const found = [ ...scope.querySelectorAll( 'label' ) ].find( ( l ) => l.textContent?.trim() === label );
	const el = found ? document.getElementById( found.htmlFor ) : null;
	if ( ! el ) {
		throw new Error( 'No field ' + label );
	}
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

describe( 'forms list', () => {
	it( 'shows the forms with status, entries and shortcode', async () => {
		await act( async () => root.render( <FormsList api={ fakeApi() } onOpen={ () => undefined } /> ) );
		await settle();
		expect( container.textContent ).toContain( 'Anfrage' );
		expect( container.textContent ).toContain( '3 entries' );
		expect( container.textContent ).toContain( '[funnelforms uid="uid"]' );
	} );

	it( 'shows key figures and the figures of each form of the last 30 days', async () => {
		const published = { ...summary, status: 'published' as const, currentRevision: 3, hasDraft: false };
		const legacy = { ...summary, id: 8, title: 'Alt', status: 'published' as const, currentRevision: 1, renderer: 'legacy' as const, legacyId: 12, hasDraft: false };
		const api = fakeApi( {
			list: vi.fn( async () => ( { forms: [ published, legacy ], total: 2, categories: [] } ) ),
			formFigures: vi.fn( async () => ( {
				forms: { total: 5, published: 2, draft: 3, trashed: 1 },
				figures: {
					days: 30,
					views: 1200,
					entries: 90,
					rate: 0.075,
					viewsBefore: 1000,
					entriesBefore: 60,
					rateBefore: 0.06,
					forms: {
						'7': { views: 1200, entries: 80, rate: 0.0667, measured: true, series: [ 0, 2, 3 ] },
						'8': { views: 0, entries: 10, rate: null, measured: false, series: [ 1, 0, 0 ] },
					},
				},
			} ) ),
		} );
		await act( async () => root.render( <FormsList api={ api } onOpen={ () => undefined } /> ) );
		await settle();
		const kpis = [ ...container.querySelectorAll( '.ffxb-kpis .ffx-kpi' ) ].map( ( k ) => k.textContent );
		expect( kpis ).toEqual( [ 'Forms52 published', 'Views1,200Last 30 days, once per visit', 'Entries90+50 % against the 30 days before', 'Conversion rate7.5 %Entries per view, last 30 days' ] );
		expect( [ ...container.querySelectorAll( '.ffxb-scope button' ) ].map( ( b ) => b.textContent ) ).toEqual( [ 'All5', 'Published2', 'Drafts3', 'Trash1' ] );
		const rows = [ ...container.querySelectorAll( '.ffxb-list > li' ) ];
		const cells = ( row: Element | undefined ): string[] => [ ...( row?.querySelectorAll( '.ffxb-row__figure' ) ?? [] ) ].map( ( c ) => c.getAttribute( 'data-label' ) + ' ' + c.querySelector( 'strong' )?.textContent );
		expect( cells( rows[ 0 ] ) ).toEqual( [ 'Entries 80', 'Views 1,200', 'Conversion 6.7 %' ] );
		expect( rows[ 0 ]?.querySelector( '.ffx-spark' )?.getAttribute( 'aria-label' ) ).toBe( 'Entries per day, last 30 days' );
		// Views of forms on Funnelforms 3 are not measured.
		expect( cells( rows[ 1 ] ) ).toEqual( [ 'Entries 10', 'Views –', 'Conversion –' ] );
		expect( rows[ 1 ]?.textContent ).toContain( 'Live on Funnelforms 3' );
		// The total of all time gives way to the columns.
		expect( rows[ 0 ]?.textContent ).not.toContain( '3 entries' );
	} );

	it( 'names the two imports as the menu does and opens only the chosen one', async () => {
		await act( async () => root.render( <FormsList api={ fakeApi() } onOpen={ () => undefined } importUrl="admin.php?page=funnelforms-import" importOwn="admin.php?page=funnelforms-import-funnelforms" /> ) );
		await settle();
		const links = [ ...container.querySelectorAll<HTMLAnchorElement>( '.ffx-frame__actions a, a.ffx-btn' ) ].map( ( a ) => [ a.textContent, a.getAttribute( 'href' ) ] );
		expect( links ).toContainEqual( [ 'Import Funnelforms', 'admin.php?page=funnelforms-import-funnelforms' ] );
		expect( links ).toContainEqual( [ 'Import from other plugins', 'admin.php?page=funnelforms-import' ] );
		expect( [ ...container.querySelectorAll( 'button' ) ].some( ( b ) => b.textContent === 'Import' ) ).toBe( false );

		// Without the page, the Funnelforms import picks the file right here, and takes only Funnelforms files.
		const api = fakeApi();
		await act( async () => root.render( <FormsList api={ api } onOpen={ () => undefined } /> ) );
		await settle();
		expect( button( 'Import Funnelforms' ).getAttribute( 'title' ) ).toContain( 'Funnelforms 3 (.zip)' );
		expect( container.querySelector( 'input[type="file"]' )?.getAttribute( 'accept' ) ).toBe( '.json,.zip,application/json,application/zip' );
		expect( container.textContent ).not.toContain( 'Import from other plugins' );
	} );

	it( 'invites to create the first form', async () => {
		const api = fakeApi( { list: vi.fn( async () => ( { forms: [], total: 0, categories: [] } ) ) } );
		await act( async () => root.render( <FormsList api={ api } onOpen={ () => undefined } /> ) );
		await settle();
		expect( container.textContent ).toContain( 'Create your first form' );
	} );

	it( 'opens the template gallery and starts a form from a template', async () => {
		const api = fakeApi();
		const onOpen = vi.fn();
		await act( async () => root.render( <FormsList api={ api } onOpen={ onOpen } /> ) );
		await settle();
		await act( async () => button( 'New form' ).click() );
		await settle();
		expect( container.querySelector( '.ffxb-gallery' ) ).not.toBeNull();
		await act( async () => button( 'Use template' ).click() );
		await settle();
		expect( api.fromTemplate ).toHaveBeenCalledWith( 'moving', undefined );
		expect( onOpen ).toHaveBeenCalledWith( 7 );
		expect( container.querySelector( '.ffxb-gallery' ) ).toBeNull();
	} );
} );

/** Opens a workspace of the editor from the top bar. */
async function workspace( name: string ): Promise<void> {
	const tab = [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-views__item' ) ].find( ( b ) => b.textContent === name );
	if ( ! tab ) {
		throw new Error( 'No workspace ' + name );
	}
	await act( async () => tab.click() );
	await settle();
}

/** Opens what happens after sending, from the contact step on the canvas. */
async function afterSending(): Promise<void> {
	const open = container.querySelector<HTMLButtonElement>( '.ffxb-node--contact .ffxb-node__after' );
	if ( ! open ) {
		throw new Error( 'No contact step' );
	}
	await act( async () => open.click() );
	await settle();
}

describe( 'builder', () => {
	it( 'shows the steps and adds, undoes and selects', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-node--contact' )?.textContent ).toContain( 'Deine Kontaktdaten' );

		await act( async () => button( 'Choice' ).click() );
		expect( store.getState().doc?.nodes ).toHaveLength( 3 );
		// The new step is selected and shown in the properties.
		expect( container.querySelector( '.ffxb-inspector' )?.textContent ).toContain( 'Several answers allowed' );

		await act( async () => {
			window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'z', ctrlKey: true } ) );
		} );
		expect( store.getState().doc?.nodes ).toHaveLength( 2 );
		expect( container.textContent ).toContain( 'Unsaved changes' );
	} );

	it( 'copies a step or field with Ctrl+C and pastes it with Ctrl+V', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		window.localStorage.removeItem( 'ffxb-clipboard' );
		const key = async ( k: string ): Promise<void> => {
			await act( async () => {
				window.dispatchEvent( new KeyboardEvent( 'keydown', { key: k, ctrlKey: true } ) );
			} );
		};
		await act( async () => button( 'Choice' ).click() );
		const step = store.getState().selection.node as string;
		await key( 'c' );
		expect( container.querySelector( '.ffxb-toast' )?.textContent ).toContain( 'Step copied' );
		expect( container.querySelector( '.ffxb-toast__action' ) ).toBeNull();
		await key( 'v' );
		const nodes = store.getState().doc?.nodes ?? [];
		expect( nodes ).toHaveLength( 4 );
		const pasted = store.getState().selection.node as string;
		expect( pasted ).not.toBe( step );
		expect( store.getState().doc?.edges.find( ( e ) => e.from === step && e.default )?.to ).toBe( pasted );
		expect( container.querySelector( '.ffxb-toast' )?.textContent ).toContain( 'Step pasted' );

		// A field of a step goes only into a step, below the selected field.
		const field = ( store.getState().doc?.nodes.find( ( n ) => n.id === step ) as Extract<FormNode, { type: 'step' }> ).fields[ 0 ]?.id as string;
		await act( async () => store.getState().select( { node: step, field } ) );
		await key( 'c' );
		await act( async () => store.getState().select( { node: 'contact' } ) );
		await key( 'v' );
		expect( container.querySelector( '.ffxb-toast' )?.textContent ).toContain( 'Select a step to paste this field into.' );
		await act( async () => store.getState().select( { node: step, field } ) );
		await key( 'v' );
		expect( ( store.getState().doc?.nodes.find( ( n ) => n.id === step ) as Extract<FormNode, { type: 'step' }> ).fields ).toHaveLength( 2 );
		expect( store.getState().selection.field ).not.toBe( field );
		expect( validateDocument( store.getState().doc as FormDocument ).errors ).toEqual( [] );
		await key( 'z' );
		expect( ( store.getState().doc?.nodes.find( ( n ) => n.id === step ) as Extract<FormNode, { type: 'step' }> ).fields ).toHaveLength( 1 );
		window.localStorage.removeItem( 'ffxb-clipboard' );
	} );

	it( 'edits the fields of a repeat group, the unit of a number and the hours of a time', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Repeat group' ).click() );
		const step = () => store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node ) as Extract<FormNode, { type: 'step' }>;
		const group = () => step().fields[ 0 ] as Extract<FormNode, { type: 'step' }>[ 'fields' ][ number ] & { props: { fields: Array<{ type: string; required: boolean; label: Record<string, string> }>; itemLabel: Record<string, string> } };
		await act( async () => store.getState().select( { node: step().id, field: group().id } ) );
		await fill( 'Heading of each item', 'Person %d' );
		await choose( 'Type of the new field', 'email' );
		await act( async () => button( 'Add field' ).click() );
		expect( group().props.fields.map( ( f ) => f.type ) ).toEqual( [ 'text', 'email' ] );
		expect( group().props.itemLabel.de_DE ).toBe( 'Person %d' );
		// The new field opens, with its question, type and settings.
		const opened = container.querySelector( '.ffxb-subfield[open]' ) as HTMLElement;
		await fill( 'Question', 'E-Mail der Person', opened );
		await act( async () => ( [ ...opened.querySelectorAll( '.ffxb-toggle input, input[type=checkbox]' ) ][ 0 ] as HTMLInputElement ).click() );
		expect( group().props.fields[ 1 ] ).toMatchObject( { label: { de_DE: 'E-Mail der Person' }, required: false } );
		await fill( 'Type', 'dropdown', opened );
		expect( group().props.fields[ 1 ] ).toMatchObject( { type: 'dropdown', label: { de_DE: 'E-Mail der Person' } } );
		await fill( 'Answers', 'Klein\nGroß\nRiesig', container.querySelector( '.ffxb-subfield[open]' ) as HTMLElement );
		expect( ( group().props.fields[ 1 ] as unknown as { options: Array<{ label: Record<string, string> }> } ).options.map( ( o ) => o.label.de_DE ) ).toEqual( [ 'Klein', 'Groß', 'Riesig' ] );
		expect( validateDocument( store.getState().doc as FormDocument ).errors ).toEqual( [] );

		await act( async () => button( 'Number' ).click() );
		const number = () => step().fields[ step().fields.length - 1 ] as unknown as { id: string; props: { step?: number; unit?: { text: Record<string, string>; position: string } } };
		await act( async () => store.getState().select( { node: step().id, field: number().id } ) );
		await fill( 'Unit', 'm²' );
		await fill( 'Steps of', '0.5' );
		expect( number().props ).toMatchObject( { step: 0.5, unit: { text: { de_DE: 'm²' }, position: 'after' } } );

		await act( async () => button( 'Time' ).click() );
		const time = () => step().fields[ step().fields.length - 1 ] as unknown as { id: string; props: { min?: string; max?: string } };
		await act( async () => store.getState().select( { node: step().id, field: time().id } ) );
		await fill( 'Earliest time', '18:00' );
		await fill( 'Latest time', '08:00' );
		expect( time().props ).toMatchObject( { min: '18:00', max: '08:00' } );
		expect( container.querySelector( '.ffxb-inspector' )?.textContent ).toContain( 'The latest time is before the earliest' );
		expect( validateDocument( store.getState().doc as FormDocument ).errors ).toEqual( [] );
	} );

	it( 'finds field types and opens the design with a live preview from the form at a glance', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		expect( document.body.classList.contains( 'folded' ) ).toBe( true );
		const search = container.querySelector( '.ffxb-palette__search input' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( search, 'mail' );
			search.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( [ ...container.querySelectorAll( '.ffxb-tile' ) ].map( ( t ) => t.textContent ) ).toEqual( [ 'E-mail address' ] );

		expect( container.querySelector( '.ffxb-overview' )?.textContent ).toContain( 'Steps' );
		const jump = [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-jump' ) ].find( ( b ) => b.textContent?.startsWith( 'Design' ) ) as HTMLButtonElement;
		await act( async () => jump.click() );
		await settle();
		expect( container.querySelector( '.ffxb-views__item.is-active' )?.textContent ).toBe( 'Design' );
		expect( container.querySelector( '.ffxb-canvas' ) ).toBeNull();
		expect( api.preview ).toHaveBeenCalledTimes( 1 );
		expect( container.querySelector( '.ffxb-live iframe' )?.getAttribute( 'srcdoc' ) ).toContain( 'Vorschau' );

		// Resting on a theme shows it in the preview at once, before anything is saved; leaving shows the form's again.
		const frame = container.querySelector( '.ffxb-live iframe' ) as HTMLIFrameElement;
		const post = vi.spyOn( frame.contentWindow as Window, 'postMessage' );
		const card = ( name: string ): HTMLButtonElement => [ ...container.querySelectorAll( '.ffxb-theme-card__name' ) ].find( ( n ) => n.textContent?.startsWith( name ) )?.closest( 'button' ) as HTMLButtonElement;
		await act( async () => card( 'Neon' ).dispatchEvent( new MouseEvent( 'mouseover', { bubbles: true } ) ) );
		expect( post ).toHaveBeenLastCalledWith( expect.objectContaining( { type: 'ffx-preview-style', css: expect.stringContaining( '--ffx-color-background:#05060f;' ), classes: expect.stringContaining( 'ffx-dark' ) } ), '*' );
		await act( async () => container.querySelector( '.ffxb-theme-gallery__grid' )?.dispatchEvent( new MouseEvent( 'mouseout', { bubbles: true, relatedTarget: document.body } ) ) );
		expect( post ).toHaveBeenLastCalledWith( expect.objectContaining( { css: expect.not.stringContaining( '#05060f' ) } ), '*' );
		expect( api.saveDraft ).not.toHaveBeenCalled();

		// The gallery shows light, dark, colourful and industry themes on their own.
		const chip = [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-theme-gallery__chip' ) ].find( ( b ) => 'Dark' === b.textContent ) as HTMLButtonElement;
		await act( async () => chip.click() );
		const shown = [ ...container.querySelectorAll( '.ffxb-theme-card__name' ) ].map( ( n ) => n.textContent );
		expect( shown ).toEqual( expect.arrayContaining( [ 'Dark', 'Midnight', 'Neon', 'Luxury', 'Fitness' ] ) );
		expect( shown ).not.toContain( 'Minimal' );
		await act( async () => ( [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-theme-gallery__chip' ) ][ 0 ] as HTMLButtonElement ).click() );

		// A change of the design is saved and shown after a moment.
		const dark = [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-theme-card' ) ].find( ( b ) => b.textContent?.includes( 'Dark' ) ) as HTMLButtonElement;
		await act( async () => dark.click() );
		await act( async () => new Promise( ( resolve ) => setTimeout( resolve, 900 ) ) );
		await settle();
		expect( api.saveDraft ).toHaveBeenCalled();
		expect( api.preview ).toHaveBeenCalledTimes( 2 );

		// The progress bar is built by the runtime, so the preview is loaded again for it too.
		await tile( 'Progress', 'percent' );
		await act( async () => new Promise( ( resolve ) => setTimeout( resolve, 900 ) ) );
		await settle();
		expect( api.preview ).toHaveBeenCalledTimes( 3 );

		await act( async () => root.render( <div /> ) );
		expect( document.body.classList.contains( 'folded' ) ).toBe( false );
	} );

	it( 'opens in the workspace the address asks for, and has no statistics of its own', async () => {
		const api = fakeApi();
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } view="design" /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-views__item.is-active' )?.textContent ).toBe( 'Design' );
		// The figures of a form are on the statistics page, not in the editor.
		expect( container.querySelector( '.ffxb-views__item[data-view="stats"]' ) ).toBeNull();
		expect( container.textContent ).not.toContain( 'Statistics start when the form is published.' );

		// Without the right to see entries, figures asked for by the address stay off.
		await act( async () => root.render( <Builder key="reader" api={ api } formId={ 7 } onBack={ () => undefined } figures rights={ { entries: false, code: false, settings: false } } /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-views__item.is-active' )?.textContent ).toBe( 'Structure' );
		expect( api.formStats ).not.toHaveBeenCalled();
	} );

	it( 'shows who holds the lock and keeps the form read-only', async () => {
		const api = fakeApi( { lock: vi.fn( async () => Promise.reject( new ApiError( 'locked', 'Locked', 409, { lockedBy: { id: 2, name: 'Mia' } } ) ) ) } );
		const store = createBuilderStore( api, 7 );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		expect( container.textContent ).toContain( 'Mia is editing this form.' );
		expect( button( 'Choice' ).disabled ).toBe( true );
		expect( button( 'Take over' ) ).toBeTruthy();
	} );

	it( 'saves, then previews the draft in a sandboxed frame per device', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		await act( async () => button( 'Preview' ).click() );
		await settle();
		expect( api.saveDraft ).toHaveBeenCalled();
		expect( api.preview ).toHaveBeenCalledWith( 7 );
		const frame = container.querySelector( 'iframe' ) as HTMLIFrameElement;
		expect( frame.getAttribute( 'sandbox' ) ).toBe( 'allow-scripts allow-forms' );
		expect( frame.getAttribute( 'srcdoc' ) ).toContain( 'Vorschau' );
		expect( frame.style.width ).toBe( '1280px' );

		await act( async () => button( 'Mobile' ).click() );
		expect( store.getState().device ).toBe( 'mobile' );
		expect( ( container.querySelector( 'iframe' ) as HTMLIFrameElement ).style.width ).toBe( '390px' );
	} );

	it( 'lists what keeps the draft from being previewed', async () => {
		const api = fakeApi( { preview: vi.fn( async () => Promise.reject( new ApiError( 'not_ready', 'Fix the problems.', 409, { problems: [ 'start_missing' ] } ) ) ) } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } /> ) );
		await settle();
		await act( async () => button( 'Preview' ).click() );
		await settle();
		expect( container.textContent ).toContain( 'Fix these to see the preview' );
		expect( container.querySelector( 'iframe' ) ).toBeNull();
	} );

	it( 'applies a theme and warns about colours that are hard to read', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		const theme = ( name: string ): HTMLButtonElement => [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-theme-card' ) ].find( ( b ) => b.textContent?.includes( name ) ) as HTMLButtonElement;
		await act( async () => theme( 'Dark' ).click() );
		expect( store.getState().doc?.style.theme ).toBe( 'dark' );
		expect( theme( 'Dark' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( container.querySelector( '.ffxb-notice--warning' ) ).toBeNull();

		const input = [ ...container.querySelectorAll<HTMLInputElement>( '.ffxb-color input[type="text"]' ) ][ 1 ] as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, '#333333' );
			input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( store.getState().doc?.style.tokens[ 'color.text' ] ).toBe( '#333333' );
		expect( container.textContent ).toContain( 'Text is hard to read on the background' );
		expect( container.textContent ).toContain( 'Based on Dark, with your changes.' );

		// More styles: shadow, gradient and the form's own CSS.
		await choose( 'Shadow', 'soft' );
		expect( store.getState().doc?.style.tokens.shadow ).toBe( 'soft' );
		const gradient = [ ...container.querySelectorAll<HTMLLabelElement>( '.ffxb-advanced .ffxb-toggle label' ) ].find( ( l ) => 'Background as gradient' === l.textContent ) as HTMLLabelElement;
		await act( async () => gradient.click() );
		expect( store.getState().doc?.style.tokens[ 'color.backgroundEnd' ] ).toBe( '#efe9ff' );
		const css = container.querySelector( '.ffxb-input--code' ) as HTMLTextAreaElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLTextAreaElement.prototype, 'value' )?.set?.call( css, '.ffx-question{color:red}' );
			css.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( store.getState().doc?.style.css ).toBe( '.ffx-question{color:red}' );
		expect( container.textContent ).toContain( '[data-ffx-form="uid"]' );
	} );

	it( 'sets fonts, sizes, colours, borders, background and progress of the design', async () => {
		const pickImage = vi.fn( async () => ( { id: 42, url: 'https://example.org/bg.jpg', alt: '' } ) );
		const api = fakeApi( { pickImage, image: vi.fn( async () => ( { id: 42, url: 'https://example.org/bg.jpg', alt: '' } ) ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		const tokens = (): Record<string, string> => store.getState().doc?.style.tokens ?? {};

		await choose( 'Font of questions and headings', 'Brand Sans.woff2' );
		expect( tokens()[ 'font.heading' ] ).toBe( 'Brand Sans.woff2' );
		await choose( 'Font of questions and headings', '' );
		expect( tokens()[ 'font.heading' ] ).toBeUndefined();
		await choose( 'Weight of questions', 'bold' );
		await slide( 'Size of questions on phones', 22 );
		await slide( 'Line height of text', 1.8 );
		expect( tokens() ).toMatchObject( { 'font.weight.heading': 'bold', 'font.size.heading.mobile': '22', 'line.body': '1.8' } );

		const button = labelled<HTMLInputElement>( 'Next and send button' );
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( button, '#fde68a' );
			button.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( tokens()[ 'color.button' ] ).toBe( '#fde68a' );
		expect( tokens()[ 'color.onButton' ] ).toBe( '#1a1a1a' );

		await choose( 'Border style', 'dashed' );
		await choose( 'Shadow', 'custom' );
		await slide( 'Blur', 40 );
		await slide( 'Shadow colour: opacity', 30 );
		expect( tokens() ).toMatchObject( { 'border.style': 'dashed', shadow: 'custom', 'shadow.blur': '40', 'shadow.color': 'rgba(16,24,40,0.3)' } );

		await act( async () => ( [ ...container.querySelectorAll<HTMLButtonElement>( 'button' ) ].find( ( b ) => 'Choose image' === b.textContent ) as HTMLButtonElement ).click() );
		await settle();
		expect( pickImage ).toHaveBeenCalled();
		expect( tokens()[ 'background.image' ] ).toBe( '42' );
		expect( container.querySelector( '.ffxb-image-pick__preview' )?.getAttribute( 'src' ) ).toBe( 'https://example.org/bg.jpg' );
		await slide( 'Colour over the image: opacity', 40 );
		expect( tokens()[ 'color.overlay' ] ).toBe( 'rgba(0,0,0,0.4)' );

		await tile( 'Buttons', 'full' );
		await tile( 'Transition between steps', 'backInRight' );
		await tile( 'Alignment of questions', 'left' );
		expect( tokens() ).toMatchObject( { 'button.align': 'full', animation: 'backInRight', 'align.text': 'left' } );
		await tile( 'Progress', 'percent' );
		expect( store.getState().doc?.settings.progressBar ).toEqual( { show: true, percent: true } );
		await tile( 'Progress', 'none' );
		expect( store.getState().doc?.settings.progressBar ).toEqual( { show: false } );
		await tile( 'Progress', 'bar' );
		expect( store.getState().doc?.settings.progressBar ).toEqual( { show: true } );
		const height = [ ...container.querySelectorAll<HTMLLabelElement>( '.ffxb-flow .ffxb-toggle label' ) ].find( ( l ) => 'Adjust height to each step' === l.textContent ) as HTMLLabelElement;
		const before = store.getState().doc?.settings.autoHeight;
		await act( async () => height.click() );
		expect( store.getState().doc?.settings.autoHeight ).toBe( ! before );
	} );

	it( 'saves the style for other forms and applies a saved one', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		await act( async () => ( container.querySelector( '.ffxb-saved-style__apply' ) as HTMLButtonElement ).click() );
		expect( store.getState().doc?.style.tokens ).toEqual( { 'color.primary': '#c2410c', 'font.family': 'Poppins' } );

		await act( async () => button( 'Save as style' ).click() );
		const input = container.querySelector( '.ffxb-saved-styles__form input' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, 'Kampagne' );
			input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		await act( async () => button( 'Save style' ).click() );
		await settle();
		expect( api.saveStyle ).toHaveBeenCalledWith( 'Kampagne', { 'color.primary': '#c2410c', 'font.family': 'Poppins' } );
		expect( [ ...container.querySelectorAll( '.ffxb-saved-style__apply' ) ].map( ( b ) => b.textContent ) ).toEqual( [ 'Kampagne', 'Hausstil' ] );

		await act( async () => button( 'Delete style Hausstil' ).click() );
		await settle();
		expect( api.deleteStyle ).toHaveBeenCalledWith( 'st_000000000001' );
		expect( container.querySelectorAll( '.ffxb-saved-style' ) ).toHaveLength( 1 );
	} );

	it( 'offers uploaded fonts and uploads a new one', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		const select = [ ...container.querySelectorAll<HTMLSelectElement>( '.ffxb-design-panel select' ) ].find( ( s ) => [ ...s.options ].some( ( o ) => 'Poppins' === o.value ) ) as HTMLSelectElement;
		expect( [ ...select.options ].map( ( o ) => o.textContent ) ).toContain( 'Brand Sans' );

		const input = container.querySelector( 'input[type="file"][accept=".ttf,.otf,.woff,.woff2"]' ) as HTMLInputElement;
		const file = new File( [ 'wOF2' ], 'Hausschrift.woff2' );
		Object.defineProperty( input, 'files', { value: [ file ], configurable: true } );
		await act( async () => input.dispatchEvent( new Event( 'change', { bubbles: true } ) ) );
		await settle();
		expect( api.uploadFont ).toHaveBeenCalledWith( file, 'Hausschrift.woff2' );
		expect( store.getState().doc?.style.tokens[ 'font.family' ] ).toBe( 'Hausschrift.woff2' );
	} );

	it( 'sets limits, look, images and a pasted list of answers', async () => {
		const pickImage = vi.fn( async () => ( { id: 9, url: 'https://example.org/rot.jpg', alt: '' } ) );
		const api = fakeApi( { pickImage } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		const field = (): ChoiceField => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
			return ( node && 'step' === node.type ? node.fields[ 0 ] : undefined ) as ChoiceField;
		};
		const toggle = async ( label: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === label ) as HTMLLabelElement;
			await act( async () => ( document.getElementById( found.htmlFor ) as HTMLInputElement ).click() );
		};

		await toggle( 'Several answers allowed' );
		await fill( 'At least', '2' );
		await fill( 'At most', '1' );
		expect( container.textContent ).toContain( 'The smallest number is above the largest.' );
		await fill( 'At most', '3' );
		await tile( 'Tiles per row on large screens', '3' );
		await tile( 'Height of the answers', 'l' );
		await tile( 'Position of icons and images', 'left' );
		await toggle( 'Images fill the answer' );
		expect( field().props ).toMatchObject( { multiple: true, minChoices: 2, maxChoices: 3, columns: { desktop: 3 }, size: 'l', iconPosition: 'left', imageFull: true } );
		await tile( 'Tiles per row on large screens', '' );
		await tile( 'Height of the answers', 'm' );
		expect( field().props.columns ).toBeUndefined();
		expect( field().props.size ).toBeUndefined();

		await act( async () => button( 'Paste a list' ).click() );
		const dialog = [ ...container.querySelectorAll( 'dialog' ) ].find( ( d ) => 'Paste a list of answers' === d.getAttribute( 'aria-label' ) ) as HTMLDialogElement;
		await fill( 'Answers', 'Rot\nGrün\n\nBlau', dialog );
		await act( async () => button( 'Add 3 answers' ).click() );
		expect( field().options.map( ( o ) => o.label ) ).toEqual( [ { de_DE: 'Rot' }, { de_DE: 'Grün' }, { de_DE: 'Blau' } ] );

		await act( async () => button( 'Choose an image for answer 1' ).click() );
		await settle();
		expect( field().options[ 0 ]?.media ).toEqual( { kind: 'image', value: 'https://example.org/rot.jpg' } );
		expect( ( container.querySelector( '.ffxb-option-image img' ) as HTMLImageElement ).src ).toBe( 'https://example.org/rot.jpg' );
		await act( async () => button( 'Remove the image of answer 1' ).click() );
		expect( field().options[ 0 ]?.media ).toBeUndefined();
	} );

	it( 'chooses icons for answers and contact fields', async () => {
		const library = {
			version: '1.58.0',
			icons: { house: [ [ 'path', { d: 'M3 10 12 3l9 7' } ] ], car: [ [ 'circle', { cx: '7', cy: '17', r: '2' } ] ], mail: [ [ 'rect', { x: '2', y: '4', width: '20', height: '16' } ] ] },
			tags: { house: 'home living building', car: 'vehicle', mail: 'email message' },
		} as unknown as IconLibrary;
		const icons = vi.fn( async () => library );
		const api = fakeApi( { icons } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		const field = (): ChoiceField => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
			return ( node && 'step' === node.type ? node.fields[ 0 ] : undefined ) as ChoiceField;
		};
		expect( icons ).not.toHaveBeenCalled();
		await act( async () => button( 'Choose an icon for answer 1' ).click() );
		await settle();
		expect( icons ).toHaveBeenCalledTimes( 1 );
		const dialog = [ ...container.querySelectorAll( 'dialog' ) ].find( ( d ) => 'Icon of answer 1' === d.getAttribute( 'aria-label' ) ) as HTMLDialogElement;
		// Without a search: the groups, the first with the icons of the set it names
		expect( [ ...dialog.querySelectorAll( '.ffxb-icon-picker__group' ) ].map( ( b ) => b.textContent ) ).toContain( 'Home and building' );
		expect( dialog.querySelector( '.ffxb-icon-picker__group.is-selected' )?.textContent ).toBe( 'Popular' );
		expect( [ ...dialog.querySelectorAll( '.ffxb-icon-picker__icon' ) ].map( ( b ) => b.getAttribute( 'aria-label' ) ) ).toEqual( [ 'house', 'car', 'mail' ] );
		await act( async () => ( [ ...dialog.querySelectorAll( '.ffxb-icon-picker__group' ) ].find( ( b ) => 'All icons' === b.textContent ) as HTMLButtonElement ).click() );
		expect( dialog.textContent ).toContain( 'Icons found: 3' );
		expect( dialog.textContent ).toContain( 'Lucide 1.58.0' );
		const search = dialog.querySelector( 'input[type="search"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( search, 'home' );
			search.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( [ ...dialog.querySelectorAll( '.ffxb-icon-picker__icon' ) ].map( ( b ) => b.getAttribute( 'aria-label' ) ) ).toEqual( [ 'house' ] );
		await act( async () => ( dialog.querySelector( '[aria-label="house"]' ) as HTMLButtonElement ).click() );
		expect( field().options[ 0 ]?.media ).toEqual( { kind: 'lucide', value: 'house' } );
		expect( button( 'Change the icon of answer 1' ).querySelector( 'svg.ffxb-lucide path' )?.getAttribute( 'd' ) ).toBe( 'M3 10 12 3l9 7' );
		await act( async () => button( 'Change the icon of answer 1' ).click() );
		await act( async () => button( 'Remove icon' ).click() );
		expect( field().options[ 0 ]?.media ).toBeUndefined();
		expect( icons ).toHaveBeenCalledTimes( 1 );

		const contact = (): Extract<FormNode, { type: 'contact' }> => store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type ) as Extract<FormNode, { type: 'contact' }>;
		const email = contact().fields.find( ( f ) => 'email' === f.type ) as ContactField;
		await act( async () => store.getState().select( { node: contact().id, field: email.id } ) );
		await act( async () => button( 'Choose an icon for the field' ).click() );
		await settle();
		await act( async () => ( container.querySelector( 'dialog[aria-label="Icon in the field"] [aria-label="mail"]' ) as HTMLButtonElement ).click() );
		expect( ( contact().fields.find( ( f ) => f.id === email.id ) as ContactField ).props.icon ).toBe( 'lucide:mail' );
		expect( container.querySelector( '.ffxb-icon-field' )?.textContent ).toContain( 'mail' );
	} );

	it( 'lists the questions, warns about a shared variable name and sorts answers', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		const first = store.getState().selection;
		await act( async () => button( 'Choice' ).click() );
		const second = store.getState().selection;
		// The second click adds the field to the selected step.
		expect( second.node ).toBe( first.node );
		const fieldOf = ( sel: typeof first ): ChoiceField => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === sel.node );
			return ( node && 'step' === node.type ? node.fields.find( ( f ) => f.id === ( sel.field ?? node.fields[ 0 ]?.id ) ) : undefined ) as ChoiceField;
		};
		expect( container.querySelector( '.ffxb-inspector .ffxb-notice' )?.textContent ?? '' ).not.toContain( 'variable name' );
		await act( async () =>
			store.getState().change( ( d ) => {
				const node = d.nodes.find( ( n ) => n.id === second.node );
				const field = node && 'step' === node.type ? node.fields.find( ( f ) => f.id === second.field ) : undefined;
				if ( field ) {
					field.key = fieldOf( first ).key;
					field.required = false;
				}
			} )
		);
		expect( container.querySelector( '.ffxb-inspector' )?.textContent ).toContain( `The variable name "${ fieldOf( first ).key }" is used by` );

		await act( async () => button( 'Move answer 1' ).dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowDown', bubbles: true } ) ) );
		expect( fieldOf( second ).options.map( ( o ) => o.value ) ).toEqual( [ '2', '1' ] );

		await act( async () => button( 'Questions' ).click() );
		const items = (): string[] => [ ...container.querySelectorAll( '.ffxb-questions__item .ffxb-questions__title' ) ].map( ( e ) => e.textContent ?? '' );
		expect( container.querySelector( '.ffxb-palette .ffxb-palette__hint' )?.textContent ).toMatch( /^\d+ of \d+ questions$/ );
		const all = items().length;
		await fill( 'Search questions', 'e-mail' );
		expect( items().length ).toBeLessThan( all );
		expect( items().every( ( t ) => /e-mail/i.test( t ) ) ).toBe( true );
		await fill( 'Search questions', '' );
		await choose( 'Type', 'choice' );
		expect( items() ).toHaveLength( 2 );
		await choose( 'Type', '' );
		await act( async () => ( container.querySelector( '.ffxb-palette .ffxb-toggle input' ) as HTMLInputElement ).click() );
		expect( items().length ).toBeLessThan( all );
		const reveal = vi.fn();
		window.addEventListener( 'ffxb:reveal', reveal );
		await act( async () => ( container.querySelector( '.ffxb-questions__item' ) as HTMLButtonElement ).click() );
		window.removeEventListener( 'ffxb:reveal', reveal );
		expect( store.getState().selection.field ).toBeDefined();
		expect( reveal ).toHaveBeenCalledTimes( 1 );
		expect( container.querySelector( '.ffxb-questions__item' )?.classList.contains( 'is-selected' ) ).toBe( true );
	} );

	it( 'gives dropdowns a search box, a placeholder and several answers', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Dropdown' ).click() );
		const props = (): Record<string, unknown> => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
			return ( node && 'step' === node.type ? node.fields[ 0 ]?.props : {} ) as Record<string, unknown>;
		};
		await fill( 'Text while nothing is chosen', 'Farbe wählen' );
		for ( const label of [ 'Search box above the answers', 'Several answers allowed' ] ) {
			const found = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === label ) as HTMLLabelElement;
			await act( async () => ( document.getElementById( found.htmlFor ) as HTMLInputElement ).click() );
		}
		await fill( 'At most', '2' );
		expect( props() ).toEqual( { placeholder: { de_DE: 'Farbe wählen' }, search: true, multiple: true, maxChoices: 2 } );
		expect( container.textContent ).not.toContain( 'Continue on its own' );
	} );

	it( 'sets periods and limits of dates and ranges of sliders', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		const props = (): Record<string, unknown> => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
			return ( node && 'step' === node.type ? node.fields.at( -1 )?.props : {} ) as Record<string, unknown>;
		};
		const toggle = async ( label: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === label ) as HTMLLabelElement;
			await act( async () => ( document.getElementById( found.htmlFor ) as HTMLInputElement ).click() );
		};

		await act( async () => button( 'Date' ).click() );
		await toggle( 'A period with start and end' );
		await tile( 'Dates that can be chosen', 'future' );
		await fill( 'Latest date', '2027-06-30' );
		expect( props() ).toMatchObject( { format: 'dd.mm.yy', range: true, allow: 'future', max: '2027-06-30' } );
		await tile( 'Dates that can be chosen', '' );
		await fill( 'Latest date', '' );
		expect( props() ).not.toHaveProperty( 'allow' );
		expect( props() ).not.toHaveProperty( 'max' );

		await act( async () => button( 'Slider' ).click() );
		expect( container.textContent ).not.toContain( 'First handle starts at' );
		await toggle( 'A range with two handles' );
		await fill( 'First handle starts at', '20' );
		await fill( 'Second handle starts at', '80' );
		await choose( 'Thousands separator', "'" );
		expect( props() ).toMatchObject( { range: true, start: 20, startEnd: 80, thousandsSeparator: true, separator: "'" } );
		await choose( 'Thousands separator', 'none' );
		expect( props() ).toMatchObject( { thousandsSeparator: false } );
		expect( props() ).not.toHaveProperty( 'separator' );
		await tile( 'Position of the unit', 'before' );
		expect( props().unit ).toMatchObject( { position: 'before' } );
	} );

	it( 'gives scales colours, faces and own texts', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Rating' ).click() );
		const props = (): Record<string, unknown> => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
			return ( node && 'step' === node.type ? node.fields.at( -1 )?.props : {} ) as Record<string, unknown>;
		};
		await fill( 'Highest rating', '3' );
		await tile( 'Look', 'colors' );
		await tile( 'Points show', 'emojis' );
		expect( props() ).toMatchObject( { min: 1, max: 3, style: 'colors', show: 'emojis' } );
		await tile( 'Points show', 'labels' );
		await fill( 'Text for 3', 'Super' );
		await fill( 'Text for 1', 'Schlecht' );
		expect( props().labels ).toEqual( [ { de_DE: 'Schlecht' }, {}, { de_DE: 'Super' } ] );
		await tile( 'Look', 'stars' );
		expect( container.textContent ).toContain( 'Below the stars' );
		await tile( 'Below the stars', '' );
		expect( props() ).not.toHaveProperty( 'show' );
		expect( container.textContent ).not.toContain( 'Text for 1' );
	} );

	it( 'adds lists to the contact step and sets its look', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		const contact = (): Extract<FormNode, { type: 'contact' }> => store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type ) as Extract<FormNode, { type: 'contact' }>;
		await act( async () => store.getState().select( { node: contact().id } ) );
		await act( async () => button( 'List' ).click() );
		const list = (): ContactField => contact().fields.at( -1 ) as ContactField;
		expect( list().type ).toBe( 'select' );
		await fill( 'Answers', 'Küche\n\nBad\nGarten' );
		expect( list().props.options ).toEqual( [
			{ id: 'o1', label: { de_DE: 'Küche' } },
			{ id: 'o2', label: { de_DE: 'Bad' } },
			{ id: 'o3', label: { de_DE: 'Garten' } },
		] );
		expect( labelled<HTMLTextAreaElement>( 'Answers' ).value ).toBe( 'Küche\n\nBad\nGarten' );

		await act( async () => store.getState().select( { node: contact().id } ) );
		await tile( 'On large screens', '2' );
		await tile( 'Button position', 'right' );
		await tile( 'Button size', 'l' );
		const found = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === 'Hide labels' ) as HTMLLabelElement;
		await act( async () => ( document.getElementById( found.htmlFor ) as HTMLInputElement ).click() );
		expect( contact().layout ).toEqual( { columns: { desktop: 2 }, button: { align: 'right', size: 'l' }, hideLabels: true } );
		await tile( 'On large screens', '1' );
		await tile( 'Button position', '' );
		await tile( 'Button size', '' );
		await act( async () => ( document.getElementById( found.htmlFor ) as HTMLInputElement ).click() );
		expect( contact().layout ).toBeUndefined();
	} );

	it( 'sets custom code on the contact step and points to it from the thank-you page', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		setCode( { allowed: false, settingsUrl: 'https://example.org/wp-admin/admin.php?page=funnelforms-settings#ffx-tracking' } );
		try {
			await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
			await settle();
			const contact = (): Extract<FormNode, { type: 'contact' }> => store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type ) as Extract<FormNode, { type: 'contact' }>;
			const end = store.getState().doc?.nodes.find( ( n ) => 'end' === n.type ) as FormNode;
			await act( async () => store.getState().select( { node: end.id } ) );
			expect( container.textContent ).toContain( 'Code for this thank-you page, such as a conversion pixel, is set on the contact step.' );
			await act( async () => button( 'Custom code' ).click() );
			expect( store.getState().selection.node ).toBe( contact().id );

			expect( container.textContent ).toContain( 'This site does not run custom code yet.' );
			expect( container.querySelector<HTMLAnchorElement>( 'a[href$="#ffx-tracking"]' )?.textContent ).toBe( 'Allow in the settings' );
			await fill( 'When the step appears', "fbq('track', 'Lead');" );
			await fill( 'After sending (thank-you page)', "gtag('event', 'conversion');" );
			expect( contact().tracking ).toEqual( { onShow: "fbq('track', 'Lead');", afterSubmit: "gtag('event', 'conversion');" } );
			expect( validateDocument( store.getState().doc as FormDocument ).errors ).toEqual( [] );
			await fill( 'When the step appears', '' );
			expect( contact().tracking ).toEqual( { afterSubmit: "gtag('event', 'conversion');" } );
			await fill( 'After sending (thank-you page)', '' );
			expect( contact().tracking ).toBeUndefined();
		} finally {
			setCode( undefined );
		}
	} );

	it( 'shows the custom code read-only without the right to use unfiltered HTML', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: false } } /> ) );
		await settle();
		const contact = store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type ) as FormNode;
		await act( async () => store.getState().select( { node: contact.id } ) );
		expect( labelled<HTMLTextAreaElement>( 'After sending (thank-you page)' ).disabled ).toBe( true );
		expect( container.textContent ).toContain( 'Tracking code, scripts and custom CSS need the right to use unfiltered HTML.' );
		expect( container.textContent ).not.toContain( 'This site does not run custom code yet.' );
	} );

	it( 'adds an image or video and a loading screen to text and media', async () => {
		const pickImage = vi.fn( async () => ( { id: 4, url: 'https://example.org/haus.jpg', alt: 'Ein Haus' } ) );
		const api = fakeApi( { pickImage } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Text and media' ).click() );
		const props = (): Record<string, unknown> => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
			return ( node && 'step' === node.type ? node.fields.at( -1 )?.props : {} ) as Record<string, unknown>;
		};
		await tile( 'Image or video above the text', 'image' );
		await act( async () => button( 'Choose from the media library' ).click() );
		await settle();
		await fill( 'Width (%)', '50' );
		expect( props().media ).toEqual( { kind: 'image', url: 'https://example.org/haus.jpg', alt: { de_DE: 'Ein Haus' }, width: 50 } );
		await tile( 'Image or video above the text', 'video' );
		await fill( 'Address of the video', ' https://youtu.be/dQw4w9WgXcQ ' );
		expect( props().media ).toMatchObject( { kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' } );

		await tile( 'How the form goes on', 'loader' );
		await tile( 'Animation', 'circle' );
		await fill( 'Texts while waiting', 'Wir rechnen\n\nGleich fertig' );
		await fill( 'Waiting time (seconds)', '4.5' );
		expect( props() ).toMatchObject( { autoAdvanceMs: 4500, button: { show: false }, loader: { style: 'circle', messages: [ { de_DE: 'Wir rechnen' }, { de_DE: 'Gleich fertig' } ] } } );
		await tile( 'How the form goes on', 'button' );
		expect( props() ).not.toHaveProperty( 'loader' );
		expect( props() ).not.toHaveProperty( 'autoAdvanceMs' );
		expect( props().button ).toMatchObject( { show: true } );
		await tile( 'Image or video above the text', '' );
		expect( props() ).not.toHaveProperty( 'media' );
	} );

	it( 'limits uploads to file types, shows pictures and lets signatures be uploaded', async () => {
		expect( parseExtensions( 'PDF, .jpg;*.png docx pdf ../x' ) ).toEqual( [ 'pdf', 'jpg', 'png', 'docx' ] );
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		const props = (): Record<string, unknown> => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
			return ( node && 'step' === node.type ? node.fields.at( -1 )?.props : {} ) as Record<string, unknown>;
		};
		const toggle = async ( label: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === label ) as HTMLLabelElement;
			await act( async () => ( document.getElementById( found.htmlFor ) as HTMLInputElement ).click() );
		};
		await act( async () => button( 'File upload' ).click() );
		await fill( 'Only these file types', 'PDF, .jpg,' );
		expect( labelled<HTMLInputElement>( 'Only these file types' ).value ).toBe( 'PDF, .jpg,' );
		await fill( 'Text below it', 'Nur PDF oder JPG' );
		await toggle( 'Show small pictures of chosen images' );
		expect( props() ).toMatchObject( { allowedExtensions: [ 'pdf', 'jpg' ], hint: { de_DE: 'Nur PDF oder JPG' }, preview: true } );
		await fill( 'Only these file types', '' );
		await toggle( 'Show small pictures of chosen images' );
		expect( props() ).not.toHaveProperty( 'allowedExtensions' );
		expect( props() ).not.toHaveProperty( 'preview' );

		await act( async () => button( 'Signature' ).click() );
		await toggle( 'Visitors may upload a picture of their signature' );
		await toggle( 'Own ink colour' );
		expect( props() ).toMatchObject( { upload: true, penColor: '#1d3a8a' } );
		await fill( 'Ink colour', '#aa0000' );
		expect( props().penColor ).toBe( '#aa0000' );
		await toggle( 'Own ink colour' );
		expect( props() ).not.toHaveProperty( 'penColor' );
	} );

	it( 'sets what text fields take and what the browser fills in, and Google for addresses', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		const props = (): Record<string, unknown> => {
			const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
			return ( node && 'step' === node.type ? node.fields.at( -1 )?.props : {} ) as Record<string, unknown>;
		};
		const toggle = async ( label: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === label ) as HTMLLabelElement;
			await act( async () => ( document.getElementById( found.htmlFor ) as HTMLInputElement ).click() );
		};
		await act( async () => button( 'Short text' ).click() );
		await tile( 'Allowed input', 'digits' );
		await choose( 'Browser fills in', 'postal-code' );
		expect( props() ).toMatchObject( { restrict: 'digits', autocomplete: 'postal-code' } );
		await tile( 'Allowed input', '' );
		await choose( 'Browser fills in', '' );
		expect( props() ).not.toHaveProperty( 'restrict' );
		expect( props() ).not.toHaveProperty( 'autocomplete' );

		await act( async () => button( 'Address' ).click() );
		expect( container.textContent ).not.toContain( 'Button to use the visitor\'s location' );
		await toggle( 'Suggestions and map from Google' );
		await toggle( 'Button to use the visitor\'s location' );
		await fill( 'Zoom of the map (1 to 22)', '30' );
		await fill( 'Map starts at latitude', '48.137' );
		expect( props() ).toMatchObject( { placesAutocomplete: true, locate: true, zoom: 22, start: { lat: 48.137, lng: 13.405 } } );
		await toggle( 'Suggestions and map from Google' );
		expect( props() ).toMatchObject( { placesAutocomplete: false } );
		expect( props() ).not.toHaveProperty( 'locate' );
	} );

	it( 'builds a thank-you page with heading, animation, answers, downloads and a button, and a countdown', async () => {
		const pickFile = vi.fn( async () => ( { id: 9, url: 'https://example.org/preise.pdf', title: 'Preisliste' } ) );
		const api = fakeApi( { pickFile } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => store.getState().change( ( d ) => void d.nodes.push( { id: 'end_t', type: 'end', success: { show: true, text: { de_DE: 'Danke' } }, redirect: null } ) ) );
		await act( async () => store.getState().select( { node: 'end_t' } ) );
		const end = (): Extract<FormNode, { type: 'end' }> => store.getState().doc?.nodes.find( ( n ) => 'end_t' === n.id ) as Extract<FormNode, { type: 'end' }>;
		const toggle = async ( label: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === label ) as HTMLLabelElement;
			await act( async () => ( document.getElementById( found.htmlFor ) as HTMLInputElement ).click() );
		};
		await fill( 'Heading', 'Geschafft!' );
		await choose( 'Animation', 'confetti' );
		await toggle( 'List the visitor\'s answers' );
		await act( async () => button( 'Choose from the media library' ).click() );
		await settle();
		await toggle( 'Button to a page' );
		await fill( 'Button address', 'https://example.org/termin' );
		expect( end().success ).toEqual( {
			show: true,
			text: { de_DE: 'Danke' },
			heading: { de_DE: 'Geschafft!' },
			animation: 'confetti',
			showAnswers: true,
			downloads: [ { label: { de_DE: 'Preisliste' }, url: 'https://example.org/preise.pdf' } ],
			button: { label: { de_DE: 'Continue' }, url: { de_DE: 'https://example.org/termin' } },
		} );
		await act( async () => button( 'Remove file' ).click() );
		await choose( 'Animation', '' );
		expect( end().success ).not.toHaveProperty( 'downloads' );
		expect( end().success ).not.toHaveProperty( 'animation' );

		// The message first, then the page: time to read it, with the seconds shown.
		await act( async () => button( 'Both' ).click() );
		expect( end().success?.show ).toBe( true );
		expect( end().redirect ).toMatchObject( { delayMs: 5000, countdown: true } );
		await fill( 'Wait before (seconds)', '0' );
		expect( end().redirect ).not.toHaveProperty( 'countdown' );
		expect( container.textContent ).not.toContain( 'Show a countdown' );
		await fill( 'Wait before (seconds)', '3' );
		await toggle( 'Show a countdown' );
		expect( end().redirect ).toMatchObject( { delayMs: 3000, countdown: true } );
		await act( async () => button( 'Redirect' ).click() );
		expect( end().success?.show ).toBe( false );
		expect( end().redirect ).toMatchObject( { delayMs: 0 } );
		expect( end().success?.heading ).toEqual( { de_DE: 'Geschafft!' } );
		await act( async () => button( 'Message' ).click() );
		expect( end().redirect ).toBeNull();
	} );

	it( 'redirects to a page of the site and passes answers along', async () => {
		const pages = vi.fn( async ( search: string ) => [ { id: 4, title: 'Danke', url: 'https://example.org/danke/' }, { id: 5, title: 'Termin', url: 'https://example.org/termin/' } ].filter( ( p ) => p.title.toLowerCase().includes( search.toLowerCase() ) ) );
		const pickImage = vi.fn( async () => ( { id: 3, url: 'https://example.org/bild.png', alt: '' } ) );
		const api = fakeApi( { pages, pickImage } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => store.getState().select( { node: 'end' } ) );
		const end = (): Extract<FormNode, { type: 'end' }> => store.getState().doc?.nodes.find( ( n ) => 'end' === n.id ) as Extract<FormNode, { type: 'end' }>;
		expect( container.querySelector( '.ffxb-arrival' )?.textContent ).toContain( 'Deine Kontaktdaten' );
		expect( container.querySelector( '.ffxb-arrival' )?.textContent ).toContain( 'After sending: the entry is saved, nothing else happens.' );

		await act( async () => button( 'Choose a picture' ).click() );
		await settle();
		expect( end().success?.image ).toBe( 'https://example.org/bild.png' );
		await act( async () => button( 'Remove picture' ).click() );
		expect( end().success ).not.toHaveProperty( 'image' );

		await act( async () => button( 'Redirect' ).click() );
		expect( container.querySelector( '.ffxb-node--end .ffxb-node__meta' )?.textContent ).toBe( 'Redirect' );
		await act( async () => button( 'Choose a page of the site' ).click() );
		await settle();
		const dialog = container.querySelector( 'dialog.ffxb-dialog' ) as HTMLElement;
		expect( dialog.querySelectorAll( '.ffxb-pages__item' ) ).toHaveLength( 2 );
		await fill( 'Search pages', 'term', dialog );
		await act( async () => new Promise( ( resolve ) => setTimeout( resolve, 300 ) ) );
		await settle();
		expect( pages ).toHaveBeenLastCalledWith( 'term' );
		await act( async () => ( dialog.querySelector( '.ffxb-pages__item' ) as HTMLButtonElement ).click() );
		expect( end().redirect?.url ).toEqual( { de_DE: 'https://example.org/termin/' } );

		await act( async () => button( 'Add parameter' ).click() );
		await fill( 'Parameter', 'vor name!' );
		await choose( 'Insert an earlier answer', 'name' );
		expect( end().redirect?.params ).toEqual( [ { name: 'vorname', value: { de_DE: '{{field:name}}' } } ] );
		expect( container.querySelector( '.ffxb-params code' )?.textContent ).toBe( 'https://example.org/termin/?vorname={{field:name}}' );
		await act( async () => button( 'Remove parameter' ).click() );
		expect( end().redirect?.params ).toEqual( [] );
	} );

	it( 'inserts an earlier answer into a question', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Short text' ).click() );
		await fill( 'Question', 'Hallo' );
		await choose( 'Insert an earlier answer', 'name' );
		const node = store.getState().doc?.nodes.find( ( n ) => n.id === store.getState().selection.node );
		expect( node && 'step' === node.type ? node.fields.at( -1 )?.label : null ).toEqual( { de_DE: 'Hallo {{field:name}}' } );
		expect( labelled<HTMLSelectElement>( 'Insert an earlier answer' ).value ).toBe( '' );
	} );

	it( 'downloads a Google Font to the site and uses it', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		const select = labelled<HTMLSelectElement>( 'Font' );
		expect( [ ...select.options ].map( ( o ) => o.value ) ).toContain( 'Roboto' );
		expect( [ ...select.options ].map( ( o ) => o.value ) ).not.toContain( 'Lobster' );

		await act( async () => button( 'Google Fonts' ).click() );
		const dialog = [ ...container.querySelectorAll( 'dialog' ) ].find( ( d ) => 'Google Fonts' === d.getAttribute( 'aria-label' ) ) as HTMLDialogElement;
		const names = (): string[] => [ ...dialog.querySelectorAll( '.ffxb-google-font__name' ) ].map( ( n ) => n.textContent ?? '' );
		expect( names() ).toEqual( [ 'Lobster', 'Lora', 'Roboto' ] );
		await fill( 'Search', 'lo', dialog );
		expect( names() ).toEqual( [ 'Lobster', 'Lora' ] );
		await fill( 'Style', 'serif', dialog );
		expect( names() ).toEqual( [ 'Lora' ] );
		await fill( 'Style', '', dialog );

		await act( async () => ( [ ...dialog.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.startsWith( 'Lobster' ) ) as HTMLButtonElement ).click() );
		await settle();
		expect( api.installGoogleFont ).toHaveBeenCalledWith( 'Lobster' );
		expect( store.getState().doc?.style.tokens[ 'font.family' ] ).toBe( 'Lobster' );
		expect( [ ...labelled<HTMLSelectElement>( 'Font' ).options ].map( ( o ) => o.value ) ).toContain( 'Lobster' );
	} );

	it( 'downloads a Google Font of a website before applying it', async () => {
		const api = fakeApi( {
			branding: vi.fn( async ( url: string ) => ( { url, colors: [], roles: {}, fonts: [ { family: 'Lora', value: 'Lora', local: false, google: true } ] } ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		const dialog = (): HTMLDialogElement => [ ...container.querySelectorAll( 'dialog' ) ].find( ( d ) => 'Colours and font from a website' === d.getAttribute( 'aria-label' ) ) as HTMLDialogElement;
		const inDialog = ( name: string ): HTMLButtonElement => [ ...dialog().querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === name ) as HTMLButtonElement;
		await act( async () => button( 'Take from another website' ).click() );
		await fill( 'Address of the website', 'lora.example', dialog() );
		await act( async () => ( dialog().querySelector( 'input[type="checkbox"]' ) as HTMLInputElement ).click() );
		await act( async () => inDialog( 'Load colours and font' ).click() );
		await settle();
		expect( dialog().textContent ).toContain( 'Lora is a Google Font.' );
		await act( async () => inDialog( 'Apply' ).click() );
		await settle();
		expect( api.installGoogleFont ).toHaveBeenCalledWith( 'Lora' );
		expect( store.getState().doc?.style.tokens[ 'font.family' ] ).toBe( 'Lora' );
	} );

	it( 'takes colours and font from a website', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		const dialog = (): HTMLDialogElement => [ ...container.querySelectorAll( 'dialog' ) ].find( ( d ) => 'Colours and font from a website' === d.getAttribute( 'aria-label' ) ) as HTMLDialogElement;
		const inDialog = ( name: string ): HTMLButtonElement => [ ...dialog().querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === name || b.getAttribute( 'aria-label' ) === name ) as HTMLButtonElement;
		await act( async () => button( 'Take from another website' ).click() );
		const address = dialog().querySelector( 'input[type="url"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( address, 'brand.example' );
			address.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( inDialog( 'Load colours and font' ).disabled ).toBe( true );
		await act( async () => ( dialog().querySelector( 'input[type="checkbox"]' ) as HTMLInputElement ).click() );
		await act( async () => inDialog( 'Load colours and font' ).click() );
		await settle();
		expect( api.branding ).toHaveBeenCalledWith( 'https://brand.example', true );
		expect( dialog().textContent ).toContain( 'Open Sans is not hosted on your site.' );

		const groups = [ ...dialog().querySelectorAll( '[role="radiogroup"]' ) ];
		expect( groups.map( ( g ) => g.querySelector( '[aria-checked="true"]' )?.getAttribute( 'aria-label' ) ?? 'keep' ) ).toEqual( [ '#0b7a75', '#1d1d1d', 'keep' ] );
		await act( async () => ( groups[ 2 ]?.querySelector( '[aria-label="#fafafa"]' ) as HTMLButtonElement ).click() );
		const font = dialog().querySelector( 'select' ) as HTMLSelectElement;
		await act( async () => {
			font.value = 'Brand Sans.woff2';
			font.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
		expect( dialog().textContent ).not.toContain( 'is not hosted on your site' );
		await act( async () => inDialog( 'Apply' ).click() );
		expect( store.getState().doc?.style.tokens ).toMatchObject( {
			'color.primary': '#0b7a75',
			'color.onPrimary': '#ffffff',
			'color.text': '#1d1d1d',
			'color.background': '#fafafa',
			'font.family': 'Brand Sans.woff2',
		} );
	} );

	it( 'explains why it could not open a form', async () => {
		const api = fakeApi( { get: vi.fn( async () => Promise.reject( new ApiError( 'not_found', 'The form does not exist.', 404 ) ) ) } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } /> ) );
		await settle();
		expect( container.textContent ).toContain( 'The form could not be opened.' );
		expect( container.textContent ).toContain( 'The form does not exist.' );
	} );
} );

describe( 'path conditions', () => {
	it( 'asks for dates, parts of addresses and the number of answers', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		let date = '';
		let address = '';
		await act( async () =>
			store.getState().change( ( d ) => {
				date = addStep( d, 'date', { locale: 'de_DE' }, defaultPlacement( d ) );
				address = addStep( d, 'address', { locale: 'de_DE' }, defaultPlacement( d ) );
				// The date is asked before the address, so a path after the address may ask for both.
				d.start = date;
				d.edges.push( { id: 'e_next', from: date, to: address, default: true } );
				d.edges.push( { id: 'e_soon', from: address, to: 'end', when: { field: '', op: 'filled' } } );
			} )
		);
		const fieldOf = ( node: string ): string => ( store.getState().doc?.nodes.find( ( n ) => n.id === node ) as Extract<FormNode, { type: 'step' }> ).fields[ 0 ]?.id ?? '';
		await act( async () =>
			store.getState().change( ( d ) => {
				const edge = d.edges.find( ( e ) => 'e_soon' === e.id );
				if ( edge ) {
					edge.when = { field: fieldOf( date ), op: 'dateAfter', value: 'today' };
				}
			} )
		);
		await act( async () => store.getState().select( { edge: 'e_soon' } ) );
		const when = () => store.getState().doc?.edges.find( ( e ) => 'e_soon' === e.id )?.when;
		const set = async ( label: string, value: string ): Promise<void> => {
			const el = container.querySelector<HTMLInputElement | HTMLSelectElement>( `.ffxb-rule [aria-label="${ label }"]` );
			if ( ! el ) {
				throw new Error( 'No control ' + label );
			}
			const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
			await act( async () => {
				Object.getOwnPropertyDescriptor( proto, 'value' )?.set?.call( el, value );
				el.dispatchEvent( new Event( el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true } ) );
			} );
		};
		await set( 'Comparison', 'dateBefore' );
		await set( 'Plus days (minus for earlier)', '14' );
		expect( when() ).toEqual( { field: fieldOf( date ), op: 'dateBefore', value: 'today', days: 14 } );
		await set( 'Day', 'date' );
		await set( 'Date', '2026-12-24' );
		await set( 'Plus days (minus for earlier)', '0' );
		expect( when() ).toEqual( { field: fieldOf( date ), op: 'dateBefore', value: '2026-12-24' } );

		await set( 'Field', fieldOf( address ) );
		expect( when() ).toEqual( { field: fieldOf( address ), op: 'startsWith', value: '', part: 'zip' } );
		await set( 'Value', '8' );
		await set( 'Part of the address', 'city' );
		await set( 'Comparison', 'contains' );
		expect( when() ).toEqual( { field: fieldOf( address ), op: 'contains', value: '8', part: 'city' } );
		await set( 'Comparison', 'empty' );
		expect( when() ).toEqual( { field: fieldOf( address ), op: 'empty', part: 'city' } );
		expect( container.querySelector( '.ffxb-rule [aria-label="Value"]' ) ).toBeNull();
	} );
} );

describe( 'actions', () => {
	it( 'adds a mail to the owner and a confirmation to the visitor', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await afterSending();
		expect( api.connections ).toHaveBeenCalled();

		await fill( 'Add an action', 'email' );
		const mail = store.getState().doc?.actions[ 0 ];
		expect( mail?.kind ).toBe( 'email' );
		expect( mail && 'email' === mail.kind ? mail.config.replyTo.de_DE : '' ).toBe( '{{field:email}}' );
		expect( container.querySelector( '.ffxb-action__gap' )?.textContent ).toBe( 'Incomplete' );
		await fill( 'To', 'info@example.com' );
		expect( container.querySelector( '.ffxb-action__gap' ) ).toBeNull();
		await fill( 'Placeholders', '{{field:name}}' );
		const body = store.getState().doc?.actions[ 0 ];
		// The editor shows the line breaks as <br> and stores none.
		expect( body && 'email' === body.kind ? body.config.body.de_DE : '' ).toBe( 'You have a new entry:<br><br>{{lead}}<br><br>{{answers}}{{field:name}}' );

		await fill( 'Add an action', 'autoresponder' );
		const reply = store.getState().doc?.actions[ 1 ];
		expect( reply && 'autoresponder' === reply.kind ? [ reply.config.to.de_DE, reply.config.recipientField ] : [] ).toEqual( [ '{{field:email}}', 'c_email' ] );
		expect( container.querySelectorAll( '.ffxb-action.is-open' ) ).toHaveLength( 1 );

		await act( async () => button( 'Duplicate' ).click() );
		expect( store.getState().doc?.actions.map( ( a ) => a.kind ) ).toEqual( [ 'email', 'email', 'autoresponder' ] );
		await act( async () => button( 'Delete' ).click() );
		expect( store.getState().doc?.actions.map( ( a ) => a.kind ) ).toEqual( [ 'email', 'autoresponder' ] );
	} );

	it( 'takes the test event code of a conversion', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'conversion' );
		await fill( 'Test event code', ' TEST123 ' );
		expect( store.getState().doc?.actions[ 0 ]?.config ).toMatchObject( { platform: 'meta', testEventCode: 'TEST123' } );
		await choose( 'Platform', 'ga4' );
		expect( () => labelled( 'Test event code' ) ).toThrow();
	} );

	it( 'offers the reference of the payment as a placeholder once the form takes a payment', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'email' );
		const options = (): string[] => [ ...labelled<HTMLSelectElement>( 'Placeholders' ).options ].map( ( o ) => o.value );
		expect( options() ).not.toContain( '{{payment:reference}}' );
		await act( async () =>
			store.getState().change( ( d ) => {
				d.settings.payment = { connection: '', amount: { fixed: 10 }, currency: 'EUR', mode: 'payment', emailField: 'c_email' } as never;
			} )
		);
		await settle();
		expect( options() ).toEqual( expect.arrayContaining( [ '{{payment:status}}', '{{payment:amount}}', '{{payment:reference}}' ] ) );
	} );

	it( 'locks the consent of Google Ads conversions on in the EU privacy mode and off in the unrestricted mode', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'googleAds' );
		const consent = (): HTMLInputElement => {
			const label = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === 'Only with the visitor\'s consent' ) as HTMLLabelElement;
			return document.getElementById( label.htmlFor ) as HTMLInputElement;
		};
		const ads = (): { requireConsent: boolean } => store.getState().doc?.actions[ 0 ]?.config as { requireConsent: boolean };
		await act( async () => store.getState().change( ( d ) => {
			( d.actions[ 0 ]?.config as { requireConsent: boolean } ).requireConsent = false;
		} ) );
		expect( consent().checked ).toBe( true );
		expect( consent().disabled ).toBe( true );
		expect( consent().closest( '.ffxb-toggle' )?.textContent ).toContain( 'Always on in the EU privacy mode.' );

		// In the global mode the action's own setting counts.
		setPrivacy( 'global' );
		try {
			await fill( 'Conversion ID and label', 'AW-1/x' );
			expect( consent().disabled ).toBe( false );
			expect( consent().checked ).toBe( false );
			await act( async () => consent().click() );
			expect( ads().requireConsent ).toBe( true );

			// The unrestricted mode sends every conversion, whatever the action says.
			setPrivacy( 'open' );
			await fill( 'Conversion ID and label', 'AW-1/y' );
			expect( consent().checked ).toBe( false );
			expect( consent().disabled ).toBe( true );
			expect( consent().closest( '.ffxb-toggle' )?.textContent ).toContain( 'Always off in the unrestricted privacy mode' );
		} finally {
			setPrivacy( undefined );
		}
	} );

	it( 'sends a webhook in the format of Funnelforms 4', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'webhook' );
		await fill( 'Web address', 'https://hooks.zapier.com/hooks/catch/1/abc/' );
		const hook = () => store.getState().doc?.actions[ 0 ];
		expect( hook()?.config ).toEqual( { url: 'https://hooks.zapier.com/hooks/catch/1/abc/' } );
		await fill( 'Format', 'ff4' );
		expect( hook()?.config ).toMatchObject( { url: 'https://hooks.zapier.com/hooks/catch/1/abc/', format: 'ff4' } );
		expect( container.textContent ).toContain( 'existing Zaps keep working' );
		await fill( 'Format', '' );
		const config = hook()?.config as { format?: string };
		expect( config.format ).toBeUndefined();
	} );

	it( 'chooses a WhatsApp template of the account with a preview and submits a new one', async () => {
		const template = ( t: Partial<WhatsAppTemplate> ): WhatsAppTemplate => ( { id: '1', name: '', language: 'de', status: 'APPROVED', category: 'UTILITY', header: '', body: '', footer: '', placeholders: 0, supported: true, rejectedReason: '', ...t } );
		const api = fakeApi( {
			connections: vi.fn( async () => [ { ref: 'whatsapp:a1', type: 'whatsapp', label: 'Firma' } ] ),
			whatsAppTemplates: vi.fn( async () => [
				template( { name: 'anfrage', header: 'Danke', body: 'Hallo {{1}}, wir melden uns zu {{2}}.', footer: 'Firma GmbH', placeholders: 2 } ),
				template( { id: '2', name: 'promo', language: 'en', status: 'REJECTED', category: 'MARKETING', body: 'Sale', rejectedReason: 'PROMOTIONAL' } ),
			] ),
			createWhatsAppTemplate: vi.fn( async ( _ref: string, t: NewWhatsAppTemplate ) => template( { id: '3', name: t.name, language: t.language, status: 'PENDING', body: t.body, placeholders: t.examples.length } ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'whatsapp' );
		await fill( 'Connection', 'whatsapp:a1' );
		await settle();
		expect( api.whatsAppTemplates ).toHaveBeenCalledWith( 'whatsapp:a1' );
		const config = () => store.getState().doc?.actions[ 0 ]?.config as { template: string; language: string; parameters: unknown[] };

		await fill( 'Template', 'anfrage|de' );
		expect( config() ).toMatchObject( { template: 'anfrage', language: 'de' } );
		expect( config().parameters ).toHaveLength( 2 );
		await fill( 'Placeholder {{1}} of the template', 'Ada' );
		const preview = () => container.querySelector( '.ffxb-wa-preview' )?.textContent;
		expect( preview() ).toBe( 'DankeHallo Ada, wir melden uns zu {{2}}.Firma GmbH' );

		await fill( 'Template', 'promo|en' );
		expect( config() ).toMatchObject( { template: 'promo', language: 'en', parameters: [] } );
		expect( container.textContent ).toContain( 'Meta rejected this template (PROMOTIONAL)' );

		await act( async () => button( 'New template' ).click() );
		await fill( 'Name', 'Anfrage Danke' );
		expect( labelled<HTMLInputElement>( 'Name' ).value ).toBe( 'anfrage_danke' );
		await fill( 'Message', 'Hallo {{1}}, danke!' );
		expect( button( 'Submit to Meta' ).disabled ).toBe( true );
		await fill( 'Example for {{1}}', 'Ada' );
		await act( async () => button( 'Submit to Meta' ).click() );
		await settle();
		expect( api.createWhatsAppTemplate ).toHaveBeenCalledWith( 'whatsapp:a1', { name: 'anfrage_danke', language: 'de', category: 'UTILITY', body: 'Hallo {{1}}, danke!', examples: [ 'Ada' ], footer: '' } );
		expect( config() ).toMatchObject( { template: 'anfrage_danke', language: 'de' } );
		expect( config().parameters ).toHaveLength( 1 );
		expect( container.textContent ).toContain( 'Meta is still reviewing this template' );
	} );

	it( 'asks for the business account ID before it lists WhatsApp templates', async () => {
		const templates = vi.fn<( ref: string ) => Promise<WhatsAppTemplate[]>>().mockRejectedValueOnce( new ApiError( 'connection_incomplete', 'Add the ID.', 400 ) ).mockResolvedValue( [] );
		const api = fakeApi( {
			connections: vi.fn( async () => [ { ref: 'whatsapp:a1', type: 'whatsapp', label: 'Firma' } ] ),
			whatsAppTemplates: templates,
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'whatsapp' );
		await fill( 'Connection', 'whatsapp:a1' );
		await settle();
		await fill( 'Template', 'anfrage' );
		expect( store.getState().doc?.actions[ 0 ]?.config ).toMatchObject( { template: 'anfrage' } );
		await fill( 'WhatsApp Business account ID', '1234 5678' );
		await act( async () => container.querySelector<HTMLButtonElement>( '.ffxb-wa-account button' )?.click() );
		await settle();
		expect( api.updateConnection ).toHaveBeenCalledWith( 'whatsapp:a1', { businessAccountId: '12345678' } );
		expect( templates ).toHaveBeenCalledTimes( 2 );
		expect( container.textContent ).toContain( 'The account has no templates yet.' );
	} );

	it( 'formats the mail, links, cleans the HTML and offers more placeholders', async () => {
		const exec = vi.fn<( command: string, ui?: boolean, value?: string ) => boolean>( () => true );
		Object.defineProperty( document, 'execCommand', { value: exec, configurable: true } );
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'email' );
		const box = container.querySelector<HTMLElement>( '.ffxb-mail-editor__box' );
		expect( box?.getAttribute( 'contenteditable' ) ).toBe( 'true' );

		await act( async () => button( 'Bold' ).click() );
		await act( async () => button( 'Heading' ).click() );
		expect( exec.mock.calls.map( ( c ) => [ c[ 0 ], c[ 2 ] ] ) ).toEqual( [ [ 'bold', undefined ], [ 'formatBlock', '<h2>' ] ] );

		const link = async ( url: string ): Promise<void> => {
			await act( async () => button( 'Link' ).click() );
			const input = container.querySelector<HTMLInputElement>( '.ffxb-mail-editor__ask input' );
			await act( async () => {
				Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, url );
				input?.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			} );
			await act( async () => button( 'Insert' ).click() );
		};
		await link( 'javascript:alert(1)' );
		await link( 'https://example.org/' );
		expect( exec.mock.calls.filter( ( c ) => 'createLink' === c[ 0 ] ).map( ( c ) => c[ 2 ] ) ).toEqual( [ 'https://example.org/' ] );

		const options = [ ...labelled<HTMLSelectElement>( 'Placeholders' ).options ].map( ( o ) => o.value );
		expect( options ).toEqual( expect.arrayContaining( [ '{{entry:date}}', '{{form:title}}', '{{visit:device}}', '{{visit:duration}}', '{{visit:referrer}}', '{{utm}}', '{{utm:campaign}}' ] ) );
		expect( options ).not.toContain( '{{booking:date}}' );

		await act( async () => ( [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-mail-editor button' ) ].find( ( b ) => 'HTML' === b.textContent?.trim() ) as HTMLButtonElement ).click() );
		const source = container.querySelector<HTMLTextAreaElement>( '.ffxb-mail-editor__source-text' );
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLTextAreaElement.prototype, 'value' )?.set?.call( source, '<p onclick="x()">Hallo <a href="java\tscript:alert(1)">x</a><img src="https://example.org/a.png" onerror="alert(1)"></p><script>alert(1)</script>' );
			source?.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		const stored = store.getState().doc?.actions[ 0 ];
		expect( stored && 'email' === stored.kind ? stored.config.body.de_DE : '' ).toContain( '<script>' );
		await act( async () => ( [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-mail-editor button' ) ].find( ( b ) => 'HTML' === b.textContent?.trim() ) as HTMLButtonElement ).click() );
		expect( container.querySelector( '.ffxb-mail-editor__box' )?.innerHTML ).toBe( '<p>Hallo <a>x</a><img src="https://example.org/a.png"></p>' );
		Reflect.deleteProperty( document, 'execCommand' );
	} );

	it( 'chooses a connection and adds one when the user may change settings', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'chat' );
		await fill( 'Connection', 'conn:3' );
		const chat = (): string => {
			const a = store.getState().doc?.actions[ 0 ];
			return a && 'chat' === a.kind ? a.config.connectionRef : '';
		};
		expect( chat() ).toBe( 'conn:3' );

		await act( async () => button( 'Add connection' ).click() );
		const dialog = container.querySelector( 'dialog.ffxb-dialog' ) as HTMLElement;
		await fill( 'Name', 'Support', dialog );
		await fill( 'Webhook URL', 'https://hooks.slack.com/services/x', dialog );
		await act( async () => button( 'Save connection' ).click() );
		await settle();
		expect( api.createConnection ).toHaveBeenCalledWith( 'slack', 'Support', { url: 'https://hooks.slack.com/services/x' } );
		expect( chat() ).toBe( 'conn:9' );
	} );

	it( 'shows what protects the form and switches the captcha off for it', async () => {
		setSpam( { captcha: 'Cloudflare Turnstile', protection: [ 'Hidden field', 'Time check', 'Cloudflare Turnstile' ], settingsUrl: '/wp-admin/admin.php?page=funnelforms-settings&tab=entries' } );
		try {
			const api = fakeApi();
			const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
			await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
			await settle();
			await workspace( 'Settings' );
			const badges = (): string[] => [ ...container.querySelectorAll( '.ffxb-badges .ffxb-badge' ) ].map( ( b ) => b.textContent ?? '' );
			expect( badges() ).toEqual( [ 'Hidden field', 'Time check', 'Cloudflare Turnstile' ] );
			expect( container.querySelector( 'a[href="/wp-admin/admin.php?page=funnelforms-settings&tab=entries"]' )?.textContent ).toContain( 'Spam protection of the website' );
			const toggle = (): HTMLInputElement | undefined => [ ...container.querySelectorAll<HTMLInputElement>( 'input[role="switch"]' ) ].find( ( i ) => i.parentElement?.textContent?.includes( 'Ask for Cloudflare Turnstile in the contact step' ) );
			expect( toggle()?.checked ).toBe( true );
			await act( async () => toggle()?.click() );
			expect( store.getState().doc?.settings.captcha ).toBe( false );
			expect( badges() ).toEqual( [ 'Hidden field', 'Time check' ] );
			await act( async () => toggle()?.click() );
			expect( store.getState().doc?.settings ).not.toHaveProperty( 'captcha' );

			setSpam( { protection: [ 'Hidden field' ] } );
			await workspace( 'Structure' );
			await workspace( 'Settings' );
			expect( toggle() ).toBeUndefined();
			expect( container.textContent ).toContain( 'No captcha is set up for the website.' );
		} finally {
			setSpam( undefined );
		}
	} );

	it( 'leaves the captcha out of the protection of a form that does without it', () => {
		const site = { captcha: 'hCaptcha', protection: [ 'Hidden field', 'hCaptcha', 'Akismet' ], settingsUrl: null };
		expect( formProtection( true, site ) ).toEqual( [ 'Hidden field', 'hCaptcha', 'Akismet' ] );
		expect( formProtection( false, site ) ).toEqual( [ 'Hidden field', 'Akismet' ] );
	} );

	it( 'gives the form a page of its own', async () => {
		const api = fakeApi( {
			update: vi.fn( async ( _id: number, changes: { publicSlug?: string } ) => ( { ...summary, currentRevision: 3, publicSlug: changes.publicSlug, publicUrl: changes.publicSlug ? `https://example.org/funnelforms/${ changes.publicSlug }` : null, document: blank(), lockTtl: 150 } ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Settings' );
		await fill( 'Address', 'Angebot Umzug für Köln!' );
		expect( container.querySelector( '.ffxb-own-page' )?.textContent ).toContain( '…/funnelforms/angebot-umzug-fuer-koeln' );
		await act( async () => container.querySelector<HTMLButtonElement>( '.ffxb-own-page button' )?.click() );
		await settle();
		expect( api.update ).toHaveBeenCalledWith( 7, { publicSlug: 'angebot-umzug-fuer-koeln' } );
		expect( container.querySelector<HTMLAnchorElement>( 'a[href="https://example.org/funnelforms/angebot-umzug-fuer-koeln"]' ) ).not.toBeNull();
		expect( store.getState().form?.publicSlug ).toBe( 'angebot-umzug-fuer-koeln' );
		await act( async () => button( 'Remove' ).click() );
		await settle();
		expect( api.update ).toHaveBeenLastCalledWith( 7, { publicSlug: '' } );
		expect( container.querySelector( 'a[href^="https://example.org/funnelforms/"]' ) ).toBeNull();
	} );

	it( 'explains missing rights instead of offering new connections', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: false, code: false, settings: false } } /> ) );
		await settle();
		await afterSending();
		expect( container.textContent ).toContain( 'Changes here need the right to see entries.' );
		await fill( 'Add an action', 'sms' );
		expect( container.textContent ).toContain( 'Connections are added by someone who may change the settings.' );
		expect( () => button( 'Add connection' ) ).toThrow();
	} );
} );

describe( 'logic', () => {
	const tab = ( name: string ): HTMLButtonElement => [ ...container.querySelectorAll<HTMLButtonElement>( '[role="tab"]' ) ].find( ( b ) => b.textContent?.startsWith( name ) ) as HTMLButtonElement;
	const select = async ( el: HTMLSelectElement | null, value: string ): Promise<void> => {
		if ( ! el ) {
			throw new Error( 'No select' );
		}
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( el, value );
			el.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
	};

	it( 'sends answers to their own step, adds rules with groups and an otherwise', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		const step = store.getState().selection.node as string;
		const field = () => ( store.getState().doc?.nodes.find( ( n ) => n.id === step ) as Extract<FormNode, { type: 'step' }> ).fields[ 0 ] as ChoiceField;
		const paths = () => store.getState().doc?.edges.filter( ( e ) => e.from === step ) ?? [];
		await act( async () => tab( 'Logic' ).click() );
		expect( store.getState().panel ).toBe( 'logic' );

		const routes = container.querySelectorAll<HTMLSelectElement>( '.ffxb-answer-routes select' );
		expect( routes ).toHaveLength( 2 );
		await select( routes[ 0 ] ?? null, 'end' );
		expect( paths() ).toEqual( [ { id: expect.any( String ), from: step, to: 'end', when: { field: field().id, op: 'selected', value: field().options[ 0 ]?.id } }, expect.objectContaining( { to: 'contact', default: true } ) ] );

		await act( async () => button( 'Add a rule' ).click() );
		expect( paths() ).toHaveLength( 3 );
		expect( container.querySelector( '.ffxb-logic-rule.is-open .ffxb-rule' ) ).not.toBeNull();
		await act( async () => button( 'Add rule' ).click() );
		await select( container.querySelector( '.ffxb-logic-rule.is-open [aria-label="Which rules must apply"]' ), 'any' );
		const rule = () => paths().find( ( e ) => e.when && 'any' in e.when );
		const anyOf = (): unknown[] => {
			const when = rule()?.when;
			return when && 'any' in when ? when.any : [];
		};
		// New rules start on the step's own question.
		expect( rule()?.when ).toEqual( { any: [ expect.objectContaining( { field: field().id } ), expect.objectContaining( { field: field().id } ) ] } );
		await act( async () => button( 'Add "and" group' ).click() );
		expect( anyOf() ).toHaveLength( 3 );
		await act( async () => container.querySelector<HTMLButtonElement>( '.ffxb-cond-group--inner [aria-label="Remove group"]' )?.click() );
		expect( anyOf() ).toHaveLength( 2 );

		await select( container.querySelector( 'select[aria-label="Otherwise go to"]' ), 'end' );
		expect( paths().find( ( e ) => e.default )?.to ).toBe( 'end' );
		await act( async () => button( 'Delete rule' ).click() );
		expect( paths() ).toHaveLength( 2 );
		// Undo brings the rule back.
		await act( async () => store.getState().undo() );
		expect( paths() ).toHaveLength( 3 );

		// L switches between the question and its logic.
		await act( async () => window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'l' } ) ) );
		expect( store.getState().panel ).toBe( 'content' );
	} );

	it( 'shows a field only on an answer above it, and says what deleting that answer did', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Number' ).click() );
		const step = store.getState().selection.node as string;
		await act( async () => button( 'Short text' ).click() );
		const fields = () => ( store.getState().doc?.nodes.find( ( n ) => n.id === step ) as Extract<FormNode, { type: 'step' }> ).fields;
		expect( fields() ).toHaveLength( 2 );
		expect( store.getState().selection.field ).toBe( fields()[ 1 ]?.id );

		await act( async () => button( 'Only if …' ).click() );
		expect( fields()[ 1 ]?.showWhen ).toEqual( { field: fields()[ 0 ]?.id, op: 'gte', value: 0 } );
		// Only the number above can be asked for, not calculations or the field itself.
		expect( [ ...container.querySelectorAll<HTMLOptionElement>( '.ffxb-visibility [aria-label="Field"] option' ) ].map( ( o ) => o.value ) ).toEqual( [ fields()[ 0 ]?.id ] );
		const value = container.querySelector<HTMLInputElement>( '.ffxb-visibility [aria-label="Value"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( value, '5000' );
			value.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( fields()[ 1 ]?.showWhen ).toEqual( { field: fields()[ 0 ]?.id, op: 'gte', value: 5000 } );
		expect( container.querySelector( '.ffxb-node__field-if' ) ).not.toBeNull();

		await act( async () => store.getState().select( { node: step, field: fields()[ 0 ]?.id } ) );
		await act( async () => button( 'Delete field' ).click() );
		expect( fields() ).toHaveLength( 1 );
		expect( fields()[ 0 ] ).not.toHaveProperty( 'showWhen' );
		expect( container.querySelector( '.ffxb-toast' )?.textContent ).toContain( 'fields now always shown: 1' );
		await act( async () => ( container.querySelector( '.ffxb-toast__action' ) as HTMLButtonElement ).click() );
		expect( fields() ).toHaveLength( 2 );
		expect( fields()[ 1 ]?.showWhen ).toEqual( { field: fields()[ 0 ]?.id, op: 'gte', value: 5000 } );
		expect( container.querySelector( '.ffxb-toast' ) ).toBeNull();

		await act( async () => store.getState().select( { node: step, field: fields()[ 1 ]?.id } ) );
		await act( async () => button( 'Always' ).click() );
		expect( fields()[ 1 ] ).not.toHaveProperty( 'showWhen' );
	} );

	it( 'opens what happens after sending at the contact step, also from the old address', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } view="actions" /> ) );
		await settle();
		expect( store.getState().selection ).toEqual( { node: 'contact' } );
		expect( store.getState().panel ).toBe( 'logic' );
		expect( container.querySelector( '.ffxb-views__item.is-active' )?.textContent ).toBe( 'Structure' );
		expect( [ ...container.querySelectorAll( '.ffxb-views__item' ) ].map( ( b ) => b.textContent ) ).not.toContain( 'After sending' );
		expect( container.querySelector( '.ffxb-inspector' )?.textContent ).toContain( 'Then visitors see' );
		await fill( 'Add an action', 'webhook' );
		expect( container.querySelector( '.ffxb-node--contact .ffxb-node__chip' )?.textContent ).toBe( 'Webhook' );
		await act( async () => store.getState().select( { node: 'end' } ) );
		expect( container.querySelector( '.ffxb-arrival__note' )?.textContent ).toContain( 'After sending: Webhook' );
		await act( async () => button( 'Edit' ).click() );
		expect( store.getState().selection ).toEqual( { node: 'contact' } );
		expect( store.getState().panel ).toBe( 'logic' );

		await act( async () => window.dispatchEvent( new KeyboardEvent( 'keydown', { key: '?' } ) ) );
		expect( container.querySelector( 'dialog[aria-label="Keyboard shortcuts"]' )?.textContent ).toContain( 'Switch between the content and the logic of the selected step' );
	} );
} );

describe( 'connections', () => {
	const slack = 'slack:0b5e0d4c-6f1e-4a7b-9a51-2f0c9e7d1a11';
	const twilio = 'twilio:7a1c2e3d-4b5f-4c6d-8e9f-0a1b2c3d4e5f';

	it( 'tests, renames and deletes a connection, warning while the form uses it', async () => {
		const api = fakeApi( {
			connections: vi.fn( async () => [ { ref: slack, type: 'slack', label: 'Vertrieb' }, { ref: twilio, type: 'twilio', label: 'SMS' } ] ),
			updateConnection: vi.fn( async ( ref: string, c: Record<string, string> ) => ( { ref, type: 'slack', label: c.label ?? '' } ) ),
			testConnection: vi.fn( async () => undefined ),
			deleteConnection: vi.fn( async () => undefined ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'chat' );
		await fill( 'Connection', slack );
		const ref = (): string => ( store.getState().doc?.actions[ 0 ]?.config as { connectionRef: string } ).connectionRef;

		await act( async () => [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-connection-tools button' ) ].find( ( b ) => 'Test' === b.textContent )?.click() );
		await settle();
		expect( api.testConnection ).toHaveBeenCalledWith( slack, {} );
		expect( container.textContent ).toContain( 'The test message was sent. Check that it arrived.' );

		await act( async () => [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-connection-tools button' ) ].find( ( b ) => 'Edit' === b.textContent )?.click() );
		const dialog = container.querySelector( 'dialog.ffxb-dialog' ) as HTMLElement;
		expect( labelled<HTMLInputElement>( 'Name' ).value ).toBe( 'Vertrieb' );
		expect( labelled<HTMLInputElement>( 'Webhook URL' ).placeholder ).toBe( 'Unchanged' );
		await fill( 'Name', 'Vertrieb DE', dialog );
		await act( async () => button( 'Save connection' ).click() );
		await settle();
		expect( api.updateConnection ).toHaveBeenCalledWith( slack, { label: 'Vertrieb DE' } );
		expect( [ ...labelled<HTMLSelectElement>( 'Connection' ).options ].map( ( o ) => o.textContent ) ).toContain( 'Vertrieb DE (Slack)' );

		const tool = ( name: string ): HTMLButtonElement => [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-connection-tools button' ) ].find( ( b ) => b.textContent === name ) as HTMLButtonElement;
		await act( async () => tool( 'Delete' ).click() );
		const confirm = [ ...container.querySelectorAll( 'dialog' ) ].find( ( d ) => d.getAttribute( 'aria-label' )?.startsWith( 'Delete' ) ) as HTMLElement;
		expect( confirm.textContent ).toContain( 'Still in use in this form' );
		expect( confirm.textContent ).toContain( 'Slack or Teams message' );
		await act( async () => button( 'Delete connection' ).click() );
		await settle();
		expect( api.deleteConnection ).toHaveBeenCalledWith( slack );
		expect( ref() ).toBe( '' );
		expect( [ ...labelled<HTMLSelectElement>( 'Connection' ).options ].map( ( o ) => o.value ) ).not.toContain( slack );
	} );

	it( 'offers the connected tools ready to add after sending, and links to the integrations', async () => {
		const hubspot: CrmProvider = {
			provider: 'hubspot',
			label: 'HubSpot',
			category: 'crm',
			lookups: false,
			signIn: false,
			help: '',
			credentials: [],
			mapping: [
				{ name: 'email', label: 'E-mail', kind: 'contact', required: true },
				{ name: 'dealname', label: 'Deal name', kind: 'text', required: true },
			],
		};
		const connect = {
			crmProviders: vi.fn( async () => [ hubspot ] ),
			crmConnections: vi.fn( async () => [ { ref: 'hubspot:a1', provider: 'hubspot', label: 'Vertrieb', legacy: false, createdAt: '', forms: 0 } ] ),
		} as unknown as ConnectApi;
		const api = { ...fakeApi( { connections: vi.fn( async () => [ { ref: slack, type: 'slack', label: 'Slack' }, { ref: twilio, type: 'twilio', label: 'SMS Büro' }, { ref: 'stripe:s1', type: 'stripe', label: 'Shop' } ] ) } ), connect } as FormsApi;
		setIntegrationsUrl( 'https://example.test/wp-admin/admin.php?page=funnelforms-integrations' );
		try {
			const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
			await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
			await settle();
			await afterSending();
			const items = (): string[] => [ ...container.querySelectorAll( '.ffxb-ready__item' ) ].map( ( b ) => b.textContent ?? '' );
			// Payments are no action; a label that only repeats the service is not shown twice.
			expect( items() ).toEqual( [ 'HubSpotVertrieb', 'Slack', 'TwilioSMS Büro' ] );
			const link = container.querySelector<HTMLAnchorElement>( '.ffxb-ready a' );
			expect( link?.href ).toBe( 'https://example.test/wp-admin/admin.php?page=funnelforms-integrations' );
			expect( link?.target ).toBe( '_blank' );

			const item = ( name: string ): HTMLButtonElement => [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-ready__item' ) ].find( ( b ) => b.textContent?.startsWith( name ) ) as HTMLButtonElement;
			await act( async () => item( 'HubSpot' ).click() );
			await settle();
			expect( store.getState().doc?.actions[ 0 ] ).toMatchObject( { kind: 'crm', config: { provider: 'hubspot', connectionRef: 'hubspot:a1', mapping: { email: '[email]' } } } );
			await act( async () => item( 'Twilio' ).click() );
			await settle();
			expect( store.getState().doc?.actions[ 1 ] ).toMatchObject( { kind: 'sms', config: { connectionRef: twilio } } );
			// What the step sends to already is not offered again.
			expect( items() ).toEqual( [ 'Slack' ] );
			expect( container.querySelector( '.ffxb-action.is-open' )?.textContent ).toContain( 'SMS Büro (Twilio)' );
		} finally {
			setIntegrationsUrl( null );
		}
	} );

	it( 'says that MessageBird is retired and asks for another SMS connection', async () => {
		const doc = blank();
		doc.actions.push( { id: 'a_sms', on: 'submit', kind: 'sms', config: { connectionRef: 'legacy:messagebird', to: { de_DE: '+49171000000' }, sender: 'Firma', message: { de_DE: 'Neu' } } } );
		const api = fakeApi( {
			get: vi.fn( async () => ( { ...summary, document: doc, lockTtl: 150 } ) ),
			connections: vi.fn( async () => [ { ref: twilio, type: 'twilio', label: 'SMS' } ] ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await afterSending();
		expect( container.querySelector( '.ffxb-action' )?.textContent ).toContain( 'Incomplete' );
		expect( container.querySelector( '.ffxb-action__target' )?.textContent ).toBe( 'MessageBird (no longer supported)' );
		await act( async () => container.querySelector<HTMLButtonElement>( '.ffxb-action__toggle' )?.click() );
		await settle();
		expect( container.textContent ).toContain( 'MessageBird is no longer supported; Bird is its successor.' );
		expect( [ ...labelled<HTMLSelectElement>( 'Connection' ).options ].map( ( o ) => o.textContent ) ).toEqual( [ 'Choose…', 'SMS (Twilio)', 'MessageBird (no longer supported)' ] );
		await fill( 'Connection', twilio );
		expect( container.textContent ).not.toContain( 'MessageBird is no longer supported' );
		expect( container.querySelector( '.ffxb-action' )?.textContent ).not.toContain( 'Incomplete' );
		expect( container.querySelector( '.ffxb-action__target' )?.textContent ).toBe( 'SMS' );
	} );

	it( 'sends a test message to a number', async () => {
		const testConnection = vi.fn<NonNullable<FormsApi[ 'testConnection' ]>>().mockRejectedValueOnce( new ApiError( 'invalid_number', 'Enter the number in international format.', 400 ) ).mockResolvedValue( undefined );
		const api = fakeApi( { connections: vi.fn( async () => [ { ref: twilio, type: 'twilio', label: 'SMS' } ] ), testConnection } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await afterSending();
		await fill( 'Add an action', 'sms' );
		await fill( 'Connection', twilio );
		await act( async () => button( 'Test' ).click() );
		const dialog = container.querySelector( 'dialog.ffxb-dialog' ) as HTMLElement;
		expect( button( 'Send test' ).disabled ).toBe( true );
		await fill( 'Send to', '0170', dialog );
		await act( async () => button( 'Send test' ).click() );
		await settle();
		expect( dialog.textContent ).toContain( 'Enter the number in international format.' );
		await fill( 'Send to', '+49 170 1234567', dialog );
		await fill( 'Sender', 'Firma', dialog );
		await act( async () => button( 'Send test' ).click() );
		await settle();
		expect( testConnection ).toHaveBeenLastCalledWith( twilio, { to: '+49 170 1234567', sender: 'Firma' } );
		expect( container.querySelector( 'dialog.ffxb-dialog' ) ).toBeNull();
		expect( container.textContent ).toContain( 'The test message was sent.' );
	} );
} );

describe( 'tour', () => {
	it( 'starts the first time, marks each part and comes back from the question mark', async () => {
		window.localStorage.removeItem( 'ffxb-tour-seen' );
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } tour /> ) );
		await settle();
		const tour = () => container.querySelector( '.ffxb-tour' );
		expect( tour()?.textContent ).toContain( '1 of 5' );
		expect( container.querySelector( '.ffxb-palette' )?.classList.contains( 'ffxb-tour-target' ) ).toBe( true );
		await act( async () => button( 'Next' ).click() );
		expect( tour()?.textContent ).toContain( 'The funnel' );
		expect( container.querySelector( '.ffxb-palette' )?.classList.contains( 'ffxb-tour-target' ) ).toBe( false );
		expect( container.querySelector( '.ffxb-canvas' )?.classList.contains( 'ffxb-tour-target' ) ).toBe( true );
		for ( let i = 0; i < 3; i++ ) {
			await act( async () => button( 'Next' ).click() );
		}
		expect( container.querySelector( '[data-tour="publish"]' )?.classList.contains( 'ffxb-tour-target' ) ).toBe( true );
		await act( async () => button( 'Done' ).click() );
		expect( tour() ).toBeNull();
		expect( window.localStorage.getItem( 'ffxb-tour-seen' ) ).toBe( '1' );

		await act( async () => button( 'Tour through the builder' ).click() );
		expect( tour()?.textContent ).toContain( '1 of 5' );
		await act( async () => window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) ) );
		expect( tour() ).toBeNull();
	} );

	it( 'stays away once seen and where the builder does not offer it', async () => {
		window.localStorage.setItem( 'ffxb-tour-seen', '1' );
		const api = fakeApi();
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ createBuilderStore( api, 7, { autosaveMs: 60000 } ) } tour /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-tour' ) ).toBeNull();
		window.localStorage.removeItem( 'ffxb-tour-seen' );
		await act( async () => root.render( <Builder api={ api } formId={ 8 } onBack={ () => undefined } store={ createBuilderStore( api, 8, { autosaveMs: 60000 } ) } /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-tour' ) ).toBeNull();
		expect( () => button( 'Tour through the builder' ) ).toThrow();
	} );

	it( 'puts the box beside large parts and below buttons, inside the window', () => {
		const view = { width: 1200, height: 800 };
		expect( placement( { top: 60, left: 0, right: 240, bottom: 800, width: 240, height: 740 }, view ) ).toEqual( { top: 84, left: 252 } );
		expect( placement( { top: 60, left: 880, right: 1200, bottom: 800, width: 320, height: 740 }, view ) ).toEqual( { top: 84, left: 548 } );
		expect( placement( { top: 10, left: 1100, right: 1180, bottom: 46, width: 80, height: 36 }, view ) ).toEqual( { top: 56, left: 860 } );
	} );
} );

describe( 'calculations', () => {
	it( 'adds a formula over the answers and numbers for the answers', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		const step = store.getState().doc?.nodes.find( ( n ) => 'step' === n.type );
		const field = step && 'step' === step.type ? step.fields[ 0 ] : undefined;
		expect( container.querySelector( 'input[aria-label="Number of answer 1 for calculations"]' ) ).toBeNull();
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );

		await act( async () => button( 'Add calculation' ).click() );
		expect( store.getState().doc?.calculations[ 0 ]?.format ).toEqual( { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.' } );
		await fill( 'Formula', '([x] + 2' );
		expect( container.textContent ).toContain( 'A parenthesis is not closed or not opened (character 1).' );
		await fill( 'Formula', '' );
		await fill( 'Insert a field', field?.key ?? '' );
		await fill( 'Formula', `[${ field?.key }] * 1,19` );
		expect( store.getState().doc?.calculations[ 0 ]?.expression ).toEqual( { op: '*', args: [ { var: field?.key }, { num: 1.19 } ] } );
		expect( container.querySelector( '.ffxb-notice--danger' ) ).toBeNull();

		const value = container.querySelector( '.ffxb-calc__options input[type="number"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( value, '100' );
			value.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		await act( async () => ( container.querySelector( '.ffxb-calc__options input[type="radio"]' ) as HTMLInputElement ).click() );
		expect( container.querySelector( '.ffxb-calc__result strong' )?.textContent ).toBe( '119,00' );
		const token = `{{calc:${ store.getState().doc?.calculations[ 0 ]?.id }}}`;
		expect( ( container.querySelector( `input[value="${ token }"]` ) as HTMLInputElement | null )?.readOnly ).toBe( true );

		await workspace( 'Structure' );
		await act( async () => store.getState().select( { node: step?.id } ) );
		await settle();
		const number = container.querySelector( 'input[aria-label="Number of answer 1 for calculations"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( number, '25' );
			number.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		const options = store.getState().doc?.nodes.find( ( n ) => n.id === step?.id );
		expect( options && 'step' === options.type && 'options' in ( options.fields[ 0 ] ?? {} ) ? ( options.fields[ 0 ] as { options: Array<{ calcValue?: number }> } ).options[ 0 ]?.calcValue : null ).toBe( 25 );
	} );

	it( 'inserts functions and other results and shows a result in a new step', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		await act( async () => button( 'Add calculation' ).click() );
		await fill( 'Formula', 'round(2,345; 2)' );
		const first = store.getState().doc?.calculations[ 0 ];
		expect( first?.expression ).toEqual( { fn: 'round', args: [ { num: 2.345 }, { num: 2 } ] } );
		expect( container.querySelector( '.ffxb-calc__result strong' )?.textContent ).toBe( '2,35' );
		await fill( 'Formula', 'max(1; 2' );
		expect( container.querySelector( '.ffxb-notice--danger' ) ).not.toBeNull();
		await fill( 'Formula', '10' );

		await act( async () => button( 'Add calculation' ).click() );
		await fill( 'Formula', `{${ first?.id }} * 2` );
		const second = store.getState().doc?.calculations[ 1 ];
		expect( second?.expression ).toEqual( { op: '*', args: [ { ref: first?.id }, { num: 2 } ] } );
		expect( container.querySelector( '.ffxb-calc__result strong' )?.textContent ).toBe( '20,00' );
		const steps = store.getState().doc?.nodes.length ?? 0;
		await fill( 'Add it to', 'step' );
		expect( store.getState().doc?.nodes.length ).toBe( steps + 1 );
		expect( JSON.stringify( store.getState().doc?.nodes ) ).toContain( `{{calc:${ second?.id }}}` );
	} );
} );

describe( 'live results', () => {
	it( 'shows calculations as a range in a box that stays visible', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Live result' ).click() );
		await settle();
		expect( container.textContent ).toContain( 'Add a calculation first' );
		expect( button( 'Add result' ).disabled ).toBe( true );
		await act( async () =>
			store.getState().change( ( d ) => {
				const format = { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.' };
				d.calculations.push( { id: 'calc_low', label: 'From', expression: { num: 1200 }, format }, { id: 'calc_high', label: 'To', expression: { num: 1500 }, format } );
			} )
		);
		await act( async () => button( 'Add result' ).click() );
		await fill( 'Label', 'Total' );
		await fill( 'Up to (for a range)', 'calc_high' );
		await fill( 'After the result', ' €' );
		await fill( 'Note below the result', 'Estimate without obligation.' );
		const step = store.getState().doc?.nodes.find( ( n ) => 'step' === n.type && n.fields.some( ( f ) => 'result' === f.type ) );
		const field = step && 'step' === step.type ? step.fields.find( ( f ) => 'result' === f.type ) : undefined;
		expect( field?.required ).toBe( false );
		expect( field?.props ).toEqual( {
			style: 'sticky',
			lines: [ { calculation: 'calc_low', to: 'calc_high', label: { de_DE: 'Total' }, suffix: ' €' } ],
			disclaimer: { de_DE: 'Estimate without obligation.' },
		} );
		expect( [ ...container.querySelectorAll( 'label' ) ].some( ( l ) => 'Required' === l.textContent ) ).toBe( false );
		expect( validateDocument( store.getState().doc as FormDocument ).errors ).toEqual( [] );
	} );
} );

describe( 'appointments', () => {
	it( 'books an appointment type and creates one with hours, durations and people', async () => {
		const api = fakeApi( {
			saveBookingType: vi.fn( async ( id: number | null, title: string, config: BookingConfig ) => ( { ref: 'bt:2', id: id ?? 2, title, config, legacy: false, cronofy: false } ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Appointment' ).click() );
		await settle();
		const field = (): Record<string, unknown> | undefined => {
			const step = store.getState().doc?.nodes.find( ( n ) => 'step' === n.type && n.fields[ 0 ]?.type === 'booking' );
			return step && 'step' === step.type ? ( step.fields[ 0 ]?.props as Record<string, unknown> ) : undefined;
		};
		expect( field() ).toEqual( { bookingTypeRef: '' } );

		await fill( 'Appointment type', 'legacy:7001' );
		expect( field()?.bookingTypeRef ).toBe( 'legacy:7001' );
		expect( container.textContent ).toContain( 'still uses the calendar connected in Funnelforms 3' );

		await act( async () => button( 'New appointment type' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="New appointment type"]' ) as HTMLDialogElement;
		// Durations are chips: 30 minutes is on, 1 hour is added; the first one stays preselected.
		const chip = ( name: string ): HTMLButtonElement => [ ...dialog.querySelectorAll<HTMLButtonElement>( '.ffxb-bt-chip' ) ].find( ( b ) => b.textContent === name ) as HTMLButtonElement;
		expect( [ ...dialog.querySelectorAll( '.ffxb-bt-chip[aria-pressed="true"]' ) ].map( ( b ) => b.textContent ) ).toEqual( [ '30 min' ] );
		await act( async () => chip( '1 h' ).click() );
		expect( dialog.textContent ).toContain( 'Visitors choose; 30 min is preselected.' );
		const time = async ( label: string, value: string ): Promise<void> => {
			const input = dialog.querySelector( `input[aria-label="${ label }"]` ) as HTMLInputElement;
			await act( async () => {
				Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, value );
				input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			} );
		};
		// One row per weekday: Monday to Friday are open from 9 to 5.
		expect( [ ...dialog.querySelectorAll( '.ffxb-week__day' ) ].map( ( d ) => d.classList.contains( 'is-closed' ) ) ).toEqual( [ false, false, false, false, false, true, true ] );
		await time( 'To (Monday)', '08:00' );
		expect( dialog.querySelector( '.ffxb-span.is-invalid' ) ).not.toBeNull();
		const inDialog = ( name: string ): HTMLButtonElement => [ ...dialog.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === name || b.getAttribute( 'aria-label' ) === name ) as HTMLButtonElement;
		expect( dialog.textContent ).toContain( 'Each time span has to end after it starts.' );
		expect( dialog.textContent ).not.toContain( 'Please enter a name.' );
		// Save shows every problem at its field and does not go to the server.
		await act( async () => inDialog( 'Save' ).click() );
		await settle();
		expect( api.saveBookingType ).not.toHaveBeenCalled();
		expect( dialog.textContent ).toContain( 'Please enter a name.' );
		const name = document.activeElement as HTMLInputElement;
		expect( name.getAttribute( 'aria-invalid' ) ).toBe( 'true' );
		expect( document.getElementById( name.getAttribute( 'aria-describedby' ) ?? '' )?.textContent ).toBe( 'Please enter a name.' );

		// A lunch break on Monday, copied to the other open days; Saturday morning too.
		await time( 'To (Monday)', '12:00' );
		await act( async () => inDialog( 'Add a time span on Monday' ).click() );
		await time( 'From (Monday 2)', '13:00' );
		await time( 'To (Monday 2)', '17:00' );
		await act( async () => inDialog( 'Copy the hours of Monday to the other days' ).click() );
		const saturday = [ ...dialog.querySelectorAll( '.ffxb-week__switch' ) ].find( ( l ) => l.textContent === 'Saturday' )?.querySelector( 'input' ) as HTMLInputElement;
		await act( async () => saturday.click() );
		await time( 'To (Saturday)', '13:00' );
		await fill( 'Break before (minutes)', '10', dialog );
		await fill( 'Break after (minutes)', '5', dialog );
		await fill( 'Bookable at the earliest', '2', dialog );
		await fill( 'Unit', 'hours', dialog );
		await act( async () => inDialog( 'Add a day with other hours' ).click() );
		expect( dialog.querySelectorAll( '.ffxb-special__day' ) ).toHaveLength( 1 );

		await fill( 'Name', 'Beratung', dialog );
		const labels = [ ...dialog.querySelectorAll( 'label' ) ];
		// New types remind a day before; two days before is added.
		expect( ( labels.find( ( l ) => l.textContent === '1 day(s) before' )?.querySelector( 'input' ) as HTMLInputElement ).checked ).toBe( true );
		for ( const name of [ 'Ada', 'Grace', '2 day(s) before' ] ) {
			await act( async () => ( labels.find( ( l ) => l.textContent === name )?.querySelector( 'input' ) as HTMLInputElement ).click() );
		}
		await fill( 'Several people', 'collective', dialog );
		// Each appointment can go into the calendar of the person booked.
		await fill( 'Add appointments to', 'owner', dialog );
		expect( dialog.textContent ).toContain( 'Each appointment goes into the main calendar of the person booked' );
		// The preview shows the type as visitors see it, with free times of the new hours.
		const preview = dialog.querySelector( '.ffxb-bt__preview' ) as HTMLElement;
		expect( preview.querySelector( '.ffxb-bt-card__head' )?.textContent ).toContain( 'Beratung' );
		expect( preview.textContent ).toContain( '30 min / 1 h' );
		expect( preview.textContent ).toContain( 'Sat 09:00–13:00' );
		expect( preview.textContent ).toContain( 'At the earliest 2 h ahead · up to 2 week(s) ahead' );
		expect( preview.textContent ).toContain( 'Ada, Grace · All of them together' );
		expect( preview.textContent ).toContain( 'Invitation with a calendar file · 2 day(s) before · 1 day(s) before' );
		expect( preview.querySelectorAll( '.ffxb-bt-day' ).length ).toBeGreaterThan( 0 );
		await act( async () => inDialog( 'Save' ).click() );
		await settle();
		expect( api.saveBookingType ).toHaveBeenLastCalledWith(
			null,
			'Beratung',
			expect.objectContaining( {
				durations: [ 30, 60 ],
				staff: [ 1, 2 ],
				assignment: 'collective',
				reminders: [ 2880, 1440 ],
				hours: [
					{ days: [ 1, 2, 3, 4, 5 ], from: '09:00', to: '12:00' },
					{ days: [ 1, 2, 3, 4, 5 ], from: '13:00', to: '17:00' },
					{ days: [ 6 ], from: '09:00', to: '13:00' },
				],
				bufferBefore: 10,
				bufferAfter: 5,
				notice: 120,
				calendars: expect.objectContaining( { write: 'owner' } ),
				special: [ expect.objectContaining( { hours: [ { from: '09:00', to: '13:00' } ] } ) ],
			} )
		);
		expect( field()?.bookingTypeRef ).toBe( 'bt:2' );
		expect( container.querySelector( 'dialog[aria-label="New appointment type"]' ) ).toBeNull();
		expect( [ ...container.querySelectorAll( 'option' ) ].map( ( o ) => o.textContent ) ).toContain( 'Beratung' );
	} );

	it( 'connects a calendar while editing a type and asks which one when the account has several', async () => {
		const api = fakeApi( {
			createConnection: vi
				.fn()
				.mockRejectedValueOnce(
					// The whole answer of the plugin, as WpRestAdapter hands it on.
					new ApiError( 'choose_calendar', 'This account has several calendars. Choose the one that gets the appointments.', 409, {
						code: 'choose_calendar',
						data: { status: 409 },
						calendars: [
							{ url: 'https://cal.example.com/ada/work/', name: 'Arbeit' },
							{ url: 'https://cal.example.com/ada/home/', name: 'Privat' },
						],
					} )
				)
				.mockImplementation( async ( type: string, label: string ) => ( { ref: 'caldav:c1', type, label } ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await act( async () => button( 'Appointment' ).click() );
		await settle();
		await act( async () => button( 'New appointment type' ).click() );
		const editor = container.querySelector( 'dialog[aria-label="New appointment type"]' ) as HTMLDialogElement;
		expect( editor.textContent ).toContain( 'Connect a calendar (Google, Microsoft Outlook, Apple iCloud' );
		await act( async () => button( 'Connect calendar' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Connect calendar"]' ) as HTMLDialogElement;
		await act( async () => ( [ ...dialog.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.startsWith( 'Other calendar (CalDAV)' ) ) as HTMLButtonElement ).click() );
		await fill( 'Server', 'caldav.icloud.com', dialog );
		await fill( 'User name', 'ada@example.com', dialog );
		await fill( 'Password', 'app-pass', dialog );
		const connect = (): HTMLButtonElement => [ ...dialog.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === 'Connect' ) as HTMLButtonElement;
		await act( async () => connect().click() );
		await settle();
		expect( api.createConnection ).toHaveBeenLastCalledWith( 'caldav', 'caldav.icloud.com', { url: 'caldav.icloud.com', username: 'ada@example.com', password: 'app-pass' } );
		expect( dialog.textContent ).toContain( 'This account has several calendars. Choose the one that gets the appointments, then connect again.' );
		expect( dialog.querySelector( '.ffxb-notice--danger' ) ).toBeNull();
		await fill( 'Calendar', 'https://cal.example.com/ada/home/', dialog );
		await act( async () => connect().click() );
		await settle();
		expect( api.createConnection ).toHaveBeenLastCalledWith( 'caldav', 'Privat', { url: 'caldav.icloud.com', username: 'ada@example.com', password: 'app-pass', calendar: 'https://cal.example.com/ada/home/' } );
		expect( container.querySelector( 'dialog[aria-label="Connect calendar"]' ) ).toBeNull();

		// The new calendar blocks busy times and gets the appointments.
		await fill( 'Name', 'Beratung', editor );
		await act( async () => ( [ ...editor.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === 'Save' ) as HTMLButtonElement ).click() );
		await settle();
		expect( api.saveBookingType ).toHaveBeenLastCalledWith( null, 'Beratung', expect.objectContaining( { calendars: { write: 'caldav:c1', conflicts: [ 'caldav:c1' ] } } ) );
	} );

	it( 'signs in to Google in a window and lets one of the account calendars be chosen', async () => {
		const popup = { closed: false, location: { href: '' }, close: vi.fn() };
		const open = vi.spyOn( window, 'open' ).mockImplementation( () => popup as unknown as Window );
		const signedIn = {
			ok: true,
			state: 's1',
			connection: { ref: 'google:g1', type: 'google', label: 'ada@gmail.com', error: null },
			calendars: [
				{ id: 'ada@gmail.com', name: 'ada@gmail.com', writable: true, primary: true },
				{ id: 'team@group', name: 'Team', writable: true, primary: false },
				{ id: 'holidays', name: 'Feiertage', writable: false, primary: false },
			],
			calendar: 'ada@gmail.com',
		};
		const api = fakeApi( {
			updateConnection: vi.fn( async ( ref: string ) => ( { ref, type: 'google', label: 'ada@gmail.com · Team' } ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await act( async () => button( 'Appointment' ).click() );
		await settle();
		await act( async () => button( 'New appointment type' ).click() );
		const editor = container.querySelector( 'dialog[aria-label="New appointment type"]' ) as HTMLDialogElement;
		await act( async () => button( 'Connect calendar' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Connect calendar"]' ) as HTMLDialogElement;
		const inDialog = ( text: string ): HTMLButtonElement => [ ...dialog.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.startsWith( text ) ) as HTMLButtonElement;
		await act( async () => inDialog( 'Google Calendar' ).click() );
		await act( async () => inDialog( 'Sign in to Google' ).click() );
		await settle();
		expect( open ).toHaveBeenCalledWith( '', 'ffx-calendar', expect.any( String ) );
		expect( api.startCalendarSignIn ).toHaveBeenCalledWith( 'google', undefined );
		expect( popup.location.href ).toBe( 'https://api.funnelforms.cloud/kunde/v1/oauth/google/authorize?state=s1' );
		expect( inDialog( 'Waiting for the sign-in' ).disabled ).toBe( true );

		// The window reports back; the account has two calendars for appointments.
		await act( async () => window.dispatchEvent( new MessageEvent( 'message', { origin: window.location.origin, data: { source: 'funnelforms-calendar', ...signedIn } } ) ) );
		await settle();
		expect( dialog.textContent ).toContain( 'ada@gmail.com is connected.' );
		expect( [ ...dialog.querySelectorAll( 'option' ) ].map( ( o ) => o.textContent ) ).toEqual( [ 'ada@gmail.com', 'Team' ] );
		await fill( 'Calendar', 'team@group', dialog );
		await act( async () => inDialog( 'Done' ).click() );
		await settle();
		expect( api.updateConnection ).toHaveBeenCalledWith( 'google:g1', { calendar: 'team@group' } );
		expect( container.querySelector( 'dialog[aria-label="Connect calendar"]' ) ).toBeNull();
		expect( editor.textContent ).toContain( 'ada@gmail.com · Team' );

		await fill( 'Name', 'Beratung', editor );
		await act( async () => ( [ ...editor.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === 'Save' ) as HTMLButtonElement ).click() );
		await settle();
		expect( api.saveBookingType ).toHaveBeenLastCalledWith( null, 'Beratung', expect.objectContaining( { calendars: { write: 'google:g1', conflicts: [ 'google:g1' ] } } ) );
		open.mockRestore();
	} );

	it( 'lists the calendars of a checked account in the type and saves which of them count', async () => {
		const config = { ...bookingDefaults(), calendars: { write: 'caldav:c1', conflicts: [ 'caldav:c1' ] } };
		const work = 'https://p52-caldav.icloud.com:443/1/calendars/work/';
		const home = 'https://p52-caldav.icloud.com:443/1/calendars/home/';
		const account = { ref: 'caldav:c1', type: 'caldav', label: 'Apple', error: null, busy: [ work ] };
		const api = fakeApi( {
			bookingTypes: vi.fn( async () => ( {
				types: [ { ref: 'bt:1', id: 1, title: 'Beratung', config, legacy: false, cronofy: false } ],
				staff: [ { id: 1, name: 'Ada' } ],
				calendars: [ account ],
				timezone: 'Europe/Berlin',
				defaults: bookingDefaults(),
			} ) ),
			accountCalendars: vi.fn( async () => [
				{ id: work, name: 'Arbeit', writable: true, primary: false },
				{ id: home, name: 'Privat', writable: true, primary: false },
			] ),
			arrangeCalendar: vi.fn( async ( _ref: string, changes: { busy?: string[] } ) => ( {
				connections: [ { ref: 'caldav:c1', type: 'caldav' as const, label: 'Apple', account: 'ada@icloud.com', calendar: work, busy: changes.busy ?? [], owner: 0, ownerName: '', error: null, usedBy: [], removable: true, createdAt: '2026-10-01T00:00:00Z' } ],
				people: [],
				website: { connected: false, accountUrl: '' },
				types: [],
				timezone: 'Europe/Berlin',
			} ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await act( async () => button( 'Appointment' ).click() );
		await settle();
		await fill( 'Appointment type', 'bt:1' );
		await act( async () => button( 'Edit appointment type' ).click() );
		await settle();
		const editor = container.querySelector( 'dialog[aria-label="Edit appointment type"]' ) as HTMLDialogElement;
		expect( api.accountCalendars ).toHaveBeenCalledWith( 'caldav:c1' );
		const box = ( name: string ): HTMLInputElement => [ ...editor.querySelectorAll( '.ffxb-account-calendars label' ) ].find( ( l ) => l.textContent === name )?.querySelector( 'input' ) as HTMLInputElement;
		expect( [ box( 'Arbeit' ).checked, box( 'Privat' ).checked ] ).toEqual( [ true, false ] );
		await act( async () => box( 'Privat' ).click() );
		await settle();
		expect( api.arrangeCalendar ).toHaveBeenLastCalledWith( 'caldav:c1', { busy: [ work, home ] } );
		expect( box( 'Privat' ).checked ).toBe( true );
		await act( async () => box( 'Arbeit' ).click() );
		await act( async () => box( 'Privat' ).click() );
		await settle();
		expect( editor.textContent ).toContain( 'No calendar of this account is checked, so it blocks no times.' );
	} );

	it( 'offers to connect a calendar again whose access ran out', async () => {
		const popup = { closed: false, location: { href: '' }, close: vi.fn() };
		const open = vi.spyOn( window, 'open' ).mockImplementation( () => popup as unknown as Window );
		const config = { ...bookingDefaults(), calendars: { write: 'microsoft:m1', conflicts: [ 'microsoft:m1' ] } };
		const api = fakeApi( {
			bookingTypes: vi.fn( async () => ( {
				types: [ { ref: 'bt:1', id: 1, title: 'Beratung', config, legacy: false, cronofy: false } ],
				staff: [ { id: 1, name: 'Ada' } ],
				calendars: [ { ref: 'microsoft:m1', type: 'microsoft', label: 'ada@contoso.com', error: 'auth_failed' } ],
				timezone: 'Europe/Berlin',
				defaults: bookingDefaults(),
			} ) ),
			calendarSignIn: vi.fn( async () => ( { ok: true, state: 's1', connection: { ref: 'microsoft:m1', type: 'microsoft', label: 'ada@contoso.com', error: null }, calendars: [], calendar: 'AAMk' } ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await act( async () => button( 'Appointment' ).click() );
		await settle();
		await fill( 'Appointment type', 'bt:1' );
		await act( async () => button( 'Edit appointment type' ).click() );
		const editor = container.querySelector( 'dialog[aria-label="Edit appointment type"]' ) as HTMLDialogElement;
		expect( editor.textContent ).toContain( 'The access to ada@contoso.com was withdrawn or has expired.' );
		vi.useFakeTimers();
		await act( async () => ( [ ...editor.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === 'Connect again' ) as HTMLButtonElement ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Connect calendar again"]' ) as HTMLDialogElement;
		expect( dialog.textContent ).toContain( 'Sign in to ada@contoso.com again' );
		await act( async () => ( [ ...dialog.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === 'Sign in to Microsoft' ) as HTMLButtonElement ).click() );
		expect( api.startCalendarSignIn ).toHaveBeenCalledWith( 'microsoft', 'microsoft:m1' );
		// No message from the window: the state is asked for.
		await act( async () => void ( await vi.advanceTimersByTimeAsync( 2500 ) ) );
		vi.useRealTimers();
		await settle();
		expect( api.calendarSignIn ).toHaveBeenCalledWith( 's1' );
		expect( container.querySelector( 'dialog[aria-label="Connect calendar again"]' ) ).toBeNull();
		expect( editor.textContent ).not.toContain( 'was withdrawn' );
		open.mockRestore();
	} );
} );

describe( 'quiz', () => {
	it( 'makes a knowledge quiz with right answers, feedback and results after the contact step', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		const step = store.getState().doc?.nodes.find( ( n ) => 'step' === n.type );
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );

		const kind = ( title: string ): HTMLButtonElement | undefined => [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-quiz-kind' ) ].find( ( b ) => b.querySelector( 'strong' )?.textContent === title );
		expect( kind( 'Personality types' ) ).toBeDefined();
		await act( async () => kind( 'Right and wrong answers' )?.click() );
		const quiz = (): NonNullable<NonNullable<ReturnType<typeof store.getState>[ 'doc' ]>[ 'settings' ][ 'quiz' ]> | undefined => store.getState().doc?.settings.quiz;
		expect( quiz()?.kind ).toBe( 'knowledge' );
		expect( container.textContent ).toContain( 'Mark the right answers' );
		const toggle = [ ...container.querySelectorAll<HTMLInputElement>( 'input[role="switch"]' ) ].find( ( i ) => i.parentElement?.textContent?.includes( 'Show right and wrong after each question' ) );
		await act( async () => toggle?.click() );
		expect( quiz()?.feedback ).toBe( true );

		// Right answers are ticked at the question; the formula follows on its own.
		await workspace( 'Structure' );
		await act( async () => store.getState().select( { node: step?.id } ) );
		await settle();
		expect( container.querySelector( 'input[aria-label="Number of answer 1 for calculations"]' ) ).toBeNull();
		await act( async () => ( container.querySelector( 'input[aria-label="Answer 2 is right"]' ) as HTMLInputElement ).click() );
		const field = store.getState().doc?.nodes.find( ( n ) => n.id === step?.id );
		const options = field && 'step' === field.type ? ( field.fields[ 0 ] as { key: string; options: Array<{ correct?: boolean }> } ) : null;
		expect( options?.options.map( ( o ) => o.correct ) ).toEqual( [ undefined, true ] );
		expect( store.getState().doc?.calculations[ 0 ]?.expression ).toEqual( { var: options?.key } );

		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		expect( container.textContent ).toContain( 'Questions that count: 1. Most points: 1.' );
		await act( async () => button( 'Add result' ).click() );
		await act( async () => button( 'Add result' ).click() );
		expect( quiz()?.results.map( ( r ) => r.min ) ).toEqual( [ 0, 1 ] );
		expect( container.querySelectorAll( '.ffxb-results__item' ) ).toHaveLength( 2 );
		expect( container.textContent ).toContain( 'below 1' );
		const contactPaths = store.getState().doc?.edges.filter( ( e ) => 'contact' === store.getState().doc?.nodes.find( ( n ) => n.id === e.from )?.type ) ?? [];
		expect( contactPaths.map( ( e ) => e.when ?? 'default' ) ).toEqual( [ { calc: quiz()?.calculation, op: 'gte', value: 1 }, 'default' ] );

		// The paths are the quiz's: their inspector says so instead of offering conditions.
		await workspace( 'Structure' );
		await act( async () => store.getState().select( { edge: contactPaths[ 0 ]?.id } ) );
		expect( container.textContent ).toContain( 'Path to a quiz result' );
		expect( container.querySelector( 'button[aria-label="Delete path"]' ) ).toBeNull();

		// The formula of the points is not typed.
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		await act( async () => ( container.querySelector( '.ffxb-action__toggle' ) as HTMLButtonElement ).click() );
		expect( ( container.querySelector( 'textarea.ffxb-input--code' ) as HTMLTextAreaElement ).readOnly ).toBe( true );

		await act( async () => button( 'End quiz mode' ).click() );
		expect( quiz() ).toBeUndefined();
		await act( async () => store.getState().undo() );
		expect( quiz()?.results ).toHaveLength( 2 );
	} );

	it( 'sets up a personality quiz with types, their pages and points in one place', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		const kind = [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-quiz-kind' ) ].find( ( b ) => b.querySelector( 'strong' )?.textContent === 'Personality types' );
		await act( async () => kind?.click() );
		const quiz = () => store.getState().doc?.settings.quiz;
		expect( quiz()?.kind ).toBe( 'personality' );
		expect( quiz()?.categories?.map( ( c ) => c.label ) ).toEqual( [ 'Type 1', 'Type 2' ] );
		expect( quiz()?.results ).toHaveLength( 2 );

		const name = container.querySelector( 'input[aria-label="Name of type 1"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( name, 'Entdecker' );
			name.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( quiz()?.categories?.[ 0 ]?.label ).toBe( 'Entdecker' );

		const points = container.querySelector( '.ffxb-quiz-table input[aria-label$="for Entdecker"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( points, '3' );
			points.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		const step = store.getState().doc?.nodes.find( ( n ) => 'step' === n.type );
		const option = step && 'step' === step.type ? ( step.fields[ 0 ] as { options: Array<{ scores?: Record<string, number> }> } ).options[ 0 ] : undefined;
		expect( option?.scores ).toEqual( { [ quiz()?.categories?.[ 0 ]?.id ?? '' ]: 3 } );
		expect( store.getState().doc?.calculations[ 0 ]?.expression ).toMatchObject( { fn: 'argmax' } );

		await act( async () => button( 'Add type' ).click() );
		expect( quiz()?.categories ).toHaveLength( 3 );
		await act( async () => button( 'Remove type “Type 3”' ).click() );
		expect( quiz()?.categories ).toHaveLength( 2 );
		expect( quiz()?.results ).toHaveLength( 2 );
	} );
} );

describe( 'languages', () => {
	it( 'adds a language, translates in it and previews it', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Settings' );
		expect( container.querySelector( '.ffxb-langpick' ) ).toBeNull();
		await fill( 'Add a language', 'en_US' );
		expect( store.getState().doc?.locales.available ).toEqual( [ 'de_DE', 'en_US' ] );
		// Adding a language switches to translating it.
		const picker = container.querySelector<HTMLSelectElement>( '.ffxb-langpick select' );
		expect( picker?.value ).toBe( 'en_US' );
		expect( container.textContent ).toMatch( /Not translated: \d+/ );
		await workspace( 'Structure' );
		expect( container.querySelector( '.ffxb-translating' )?.textContent ).toContain( 'You are translating into' );

		await act( async () => store.getState().select( { node: 'contact' } ) );
		const heading = [ ...container.querySelectorAll( 'label' ) ].find( ( l ) => 'Heading' === l.textContent?.trim() );
		const input = heading ? ( document.getElementById( heading.htmlFor ) as HTMLInputElement ) : null;
		expect( input?.value ).toBe( '' );
		expect( input?.placeholder ).toBe( 'Deine Kontaktdaten' );
		await fill( 'Heading', 'Your contact details' );
		const contact = (): unknown => store.getState().doc?.nodes.find( ( n ) => 'contact' === n.id );
		expect( ( contact() as { title: unknown } ).title ).toEqual( { de_DE: 'Deine Kontaktdaten', en_US: 'Your contact details' } );
		await fill( 'Heading', '' );
		expect( ( contact() as { title: unknown } ).title ).toEqual( { de_DE: 'Deine Kontaktdaten' } );
		await fill( 'Heading', 'Your details' );

		await act( async () => button( 'Preview' ).click() );
		await settle();
		expect( api.preview ).toHaveBeenLastCalledWith( 7, 'en_US' );

		// Back in the default language the texts are edited as before.
		await act( async () => {
			const select = container.querySelector<HTMLSelectElement>( '.ffxb-langpick select' );
			if ( select ) {
				Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( select, 'de_DE' );
				select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
			}
		} );
		expect( container.querySelector( '.ffxb-translating' ) ).toBeNull();
		await fill( 'Heading', 'Kontakt' );
		expect( ( contact() as { title: unknown } ).title ).toEqual( { de_DE: 'Kontakt', en_US: 'Your details' } );

		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		const toggle = [ ...container.querySelectorAll<HTMLInputElement>( 'input[role="switch"]' ) ].find( ( i ) => i.parentElement?.textContent?.includes( 'Let visitors choose the language' ) );
		await act( async () => toggle?.click() );
		expect( store.getState().doc?.settings.languageSwitch ).toBe( true );
		const confirm = vi.spyOn( window, 'confirm' ).mockReturnValue( true );
		await act( async () => button( 'Remove English (United States)' ).click() );
		confirm.mockRestore();
		expect( store.getState().doc?.locales.available ).toEqual( [ 'de_DE' ] );
		expect( ( contact() as { title: unknown } ).title ).toEqual( { de_DE: 'Kontakt' } );
		expect( container.querySelector( '.ffxb-langpick' ) ).toBeNull();
	} );
} );

describe( 'settings', () => {
	it( 'protects the form with a password, a limit and a time window', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Settings' );
		await act( async () => button( 'Protect with a password' ).click() );
		await fill( 'Password for visitors', 'geheim' );
		await act( async () => button( 'Save password' ).click() );
		await settle();
		expect( api.passwordHash ).toHaveBeenCalledWith( 'geheim' );
		expect( store.getState().doc?.settings.access ).toEqual( { password: { hash: '$wp$hash-of-geheim' } } );
		expect( container.textContent ).toContain( 'Visitors need a password to see the form.' );

		await fill( 'Close after this many entries', '50' );
		await fill( 'Open from', '2026-11-01T09:00' );
		await fill( 'Open until', '2026-10-01T09:00' );
		expect( container.textContent ).toContain( 'The form closes before it opens' );
		const access = store.getState().doc?.settings.access;
		expect( access?.maxEntries ).toBe( 50 );
		expect( access?.opensAt ).toMatch( /^2026-11-01T09:00:00[+-]\d{2}:\d{2}$/ );
		await fill( 'Message while the form is closed', 'Anmeldung geschlossen' );
		expect( store.getState().doc?.settings.access?.closedMessage ).toEqual( { de_DE: 'Anmeldung geschlossen' } );

		const login = () => [ ...container.querySelectorAll<HTMLInputElement>( 'input[role="switch"]' ) ].find( ( i ) => i.parentElement?.textContent?.includes( 'Only for logged-in visitors' ) );
		await act( async () => login()?.click() );
		expect( store.getState().doc?.settings.access?.loginRequired ).toBe( true );
		await fill( 'Message for visitors who are not logged in', 'Nur für Mitglieder' );
		expect( store.getState().doc?.settings.access?.loginMessage ).toEqual( { de_DE: 'Nur für Mitglieder' } );
		await act( async () => login()?.click() );
		expect( store.getState().doc?.settings.access?.loginRequired ).toBeUndefined();
		expect( store.getState().doc?.settings.access?.loginMessage ).toBeUndefined();
		expect( container.textContent ).not.toContain( 'Message for visitors who are not logged in' );

		await act( async () => button( 'Remove' ).click() );
		await fill( 'Close after this many entries', '' );
		await fill( 'Open from', '' );
		await fill( 'Open until', '' );
		expect( store.getState().doc?.settings.access ).toBeUndefined();

		await fill( 'Time limit in minutes', '15' );
		expect( store.getState().doc?.settings.timeLimit ).toEqual( { minutes: 15 } );
		await fill( 'Message when the time is up', 'Zu spät' );
		expect( store.getState().doc?.settings.timeLimit ).toEqual( { minutes: 15, message: { de_DE: 'Zu spät' } } );
		await fill( 'Time limit in minutes', '5000' );
		expect( store.getState().doc?.settings.timeLimit?.minutes ).toBe( 1440 );
		await fill( 'Message when the time is up', '' );
		expect( store.getState().doc?.settings.timeLimit ).toEqual( { minutes: 1440 } );
		await fill( 'Time limit in minutes', '' );
		expect( store.getState().doc?.settings.timeLimit ).toBeUndefined();
		expect( container.textContent ).not.toContain( 'Message when the time is up' );
	} );

	it( 'turns on double opt-in and a payment', async () => {
		const api = fakeApi( { connections: vi.fn( async () => [ { ref: 'stripe:abc', type: 'stripe', label: 'Shop', webhookUrl: 'https://example.com/wp-json/funnelforms/v1/payments/stripe/abc' } ] ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await workspace( 'Settings' );
		const toggle = async ( label: string ): Promise<void> => {
			const found = [ ...container.querySelectorAll<HTMLLabelElement>( '.ffxb-toggle label' ) ].find( ( l ) => label === l.textContent );
			await act( async () => found?.click() );
		};
		await toggle( 'Double opt-in' );
		expect( store.getState().doc?.settings.doubleOptIn ).toMatchObject( { field: 'c_email', body: { de_DE: 'Please confirm your e-mail address with this link:\n\n{{confirm_url}}' } } );

		// Reminders to visitors who leave: a ticked box in the EU privacy mode, or a notice.
		await toggle( 'Reminder mail' );
		expect( store.getState().doc?.settings.abandonment ).toMatchObject( { field: 'c_email', basis: 'consent', delayMinutes: 60 } );
		expect( container.textContent ).toContain( 'Add a consent box to the contact step and choose it here, or use the notice.' );
		await fill( 'Allowed by', 'notice' );
		await fill( 'Send after', '1440' );
		await fill( 'Notice', 'Wir erinnern Sie einmal.' );
		await toggle( 'Second reminder' );
		expect( store.getState().doc?.settings.abandonment ).toMatchObject( { basis: 'notice', delayMinutes: 1440, notice: { de_DE: 'Wir erinnern Sie einmal.' }, secondAfterHours: 24 } );
		await toggle( 'Reminder mail' );
		expect( store.getState().doc?.settings.abandonment ).toBeUndefined();

		await toggle( 'Take a payment after the contact step' );
		expect( store.getState().doc?.settings.payment ).toMatchObject( { connection: '', amount: { fixed: 0 }, currency: 'EUR', mode: 'payment', emailField: 'c_email' } );
		expect( container.textContent ).toContain( 'Choose the account that receives the payments.' );
		await fill( 'Connection', 'stripe:abc' );
		await fill( 'Amount in EUR', '49.5' );
		await fill( 'Charge', 'subscription' );
		expect( store.getState().doc?.settings.payment ).toMatchObject( { connection: 'stripe:abc', amount: { fixed: 49.5 }, mode: 'subscription', interval: 'month' } );
		expect( container.querySelector( '.ffxb-notice--warning' ) ).toBeNull();
		expect( container.textContent ).toContain( 'https://example.com/wp-json/funnelforms/v1/payments/stripe/abc' );

		await act( async () => button( 'Enter signing secret' ).click() );
		const dialog = [ ...container.querySelectorAll<HTMLElement>( 'dialog.ffxb-dialog' ) ].find( ( d ) => d.textContent?.includes( 'Signing secret' ) ) as HTMLElement;
		await fill( 'Signing secret (whsec_…)', 'whsec_x', dialog );
		await act( async () => button( 'Save' ).click() );
		await settle();
		expect( api.updateConnection ).toHaveBeenCalledWith( 'stripe:abc', { webhookSecret: 'whsec_x' } );
	} );

	it( 'marks test accounts, takes coupons and adds the payment confirmation mail', async () => {
		const api = fakeApi( { connections: vi.fn( async () => [ { ref: 'mollie:t', type: 'mollie', label: 'Mollie', test: true } ] ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		await act( async () => store.getState().change( ( d ) => void addStep( d, 'text', { locale: 'de_DE' }, { before: 'contact' } ) ) );
		await workspace( 'Settings' );
		const found = [ ...container.querySelectorAll<HTMLLabelElement>( '.ffxb-toggle label' ) ].find( ( l ) => 'Take a payment after the contact step' === l.textContent );
		await act( async () => found?.click() );
		await fill( 'Connection', 'mollie:t' );
		expect( container.textContent ).toContain( 'This account uses test keys' );
		expect( container.textContent ).not.toContain( 'promotion codes' );

		const field = store.getState().doc?.nodes.flatMap( ( n ) => ( 'step' === n.type ? n.fields : [] ) ).find( ( f ) => 'text' === f.type );
		await fill( 'Coupon code from the field', field?.id ?? '' );
		await act( async () => button( 'Add coupon' ).click() );
		const code = container.querySelector( 'input[aria-label="Code of coupon 1"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( code, 'Herbst 24!' );
			code.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		const kind = container.querySelector( 'select[aria-label="Kind of discount of coupon 1"]' ) as HTMLSelectElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( kind, 'amount' );
			kind.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
		expect( store.getState().doc?.settings.payment ).toMatchObject( { couponField: field?.id, coupons: [ { code: 'Herbst24', amount: 10 } ] } );

		await act( async () => button( 'Add payment confirmation mail' ).click() );
		const mail = store.getState().doc?.actions.find( ( a ) => 'paid' === a.on );
		expect( mail ).toMatchObject( { kind: 'autoresponder', on: 'paid', config: { recipientField: 'c_email' } } );
		expect( container.textContent ).toContain( 'Visitors get a mail once the payment went through.' );
	} );
} );

describe( 'A/B tests', () => {
	it( 'tests a step in two versions, shows the figures and ends the test', async () => {
		const stats = [ { id: '', name: '', status: 'running' as const, winner: null, variants: [
			{ id: 'a', label: 'a', weight: 50, views: 200, starts: 90, completions: 20, conversionRate: 0.1, uplift: null, chanceToBeatControl: null },
			{ id: 'b', label: 'b', weight: 50, views: 210, starts: 101, completions: 32, conversionRate: 0.1524, uplift: 0.5238, chanceToBeatControl: 0.9581 },
		] } ];
		const api = fakeApi( {
			get: vi.fn( async () => ( { ...summary, currentRevision: 3, document: blank(), lockTtl: 150 } ) ),
			experimentStats: vi.fn( async () => stats.map( ( x ) => ( { ...x, id: store.getState().doc?.experiments?.[ 0 ]?.id ?? '' } ) ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		const step = store.getState().doc?.nodes.find( ( n ) => 'step' === n.type )?.id ?? '';
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		await fill( 'Test a step in two versions', step );
		await settle();
		const test = store.getState().doc?.experiments?.[ 0 ];
		expect( test ).toMatchObject( { name: 'Test of “New question”', status: 'running', variants: [ { id: 'a', label: 'Original', weight: 50 }, { id: 'b', label: 'Variant B', weight: 50 } ] } );
		expect( store.getState().doc?.nodes.filter( ( n ) => 'step' === n.type ) ).toHaveLength( 2 );
		expect( container.querySelector( '.ffxb-stats' )?.textContent ).toContain( '15.2 %' );
		expect( container.querySelector( '.ffxb-stats' )?.textContent ).toContain( '95.8 %' );

		await fill( 'Share', '80' );
		expect( store.getState().doc?.experiments?.[ 0 ]?.variants[ 0 ]?.weight ).toBe( 80 );
		await fill( 'Show everyone', 'b' );
		await act( async () => button( 'Stop test' ).click() );
		expect( store.getState().doc?.experiments?.[ 0 ] ).toMatchObject( { status: 'stopped', winner: 'b' } );
		await act( async () => button( 'End test and keep this variant' ).click() );
		expect( store.getState().doc?.experiments ).toBeUndefined();
		expect( JSON.stringify( store.getState().doc?.edges ) ).not.toContain( 'experiment' );
	} );

	it( 'adds a variation right at the step and switches between the variants with the tabs', async () => {
		const api = fakeApi( { get: vi.fn( async () => ( { ...summary, currentRevision: 3, document: blank(), lockTtl: 150 } ) ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => button( 'Choice' ).click() );
		const step = store.getState().doc?.nodes.find( ( n ) => 'step' === n.type )?.id ?? '';
		await act( async () => store.getState().select( { node: step } ) );
		expect( container.textContent ).toContain( 'variant B starts as a copy of this step' );
		await act( async () => button( 'Add a variation' ).click() );
		await settle();
		const copy = store.getState().doc?.nodes.filter( ( n ) => 'step' === n.type ).find( ( n ) => n.id !== step )?.id ?? '';
		expect( copy ).not.toBe( '' );
		expect( store.getState().selection.node ).toBe( copy );
		expect( store.getState().doc?.experiments?.[ 0 ]?.name ).toBe( 'Test of “New question”' );
		// The canvas marks both steps with their variant.
		expect( container.querySelector( `[data-node="${ step }"] .ffxb-node__flag--ab` )?.textContent ).toBe( 'A/B · A' );
		expect( container.querySelector( `[data-node="${ copy }"] .ffxb-node__flag--ab` )?.textContent ).toBe( 'A/B · B' );
		const tabs = (): HTMLButtonElement[] => [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-step-ab__tabs .ffxb-segmented__item' ) ];
		expect( tabs().map( ( t ) => t.textContent ) ).toEqual( [ 'AOriginal', 'B', '+' ] );
		expect( tabs()[ 1 ]?.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		await act( async () => tabs()[ 0 ]?.click() );
		expect( store.getState().selection.node ).toBe( step );
		expect( container.textContent ).toContain( 'You are editing the original.' );
		// "+" adds variant C as a copy and selects it.
		await act( async () => tabs()[ 2 ]?.click() );
		await settle();
		const test = store.getState().doc?.experiments?.[ 0 ];
		expect( test?.variants.map( ( v ) => v.id ) ).toEqual( [ 'a', 'b', 'c' ] );
		expect( tabs().map( ( t ) => t.textContent ) ).toEqual( [ 'AOriginal', 'B', 'C', '+' ] );
		expect( tabs()[ 2 ]?.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		// The link opens the test in the overview of the settings.
		await act( async () => button( 'Shares, results and end of the test' ).click() );
		await act( async () => new Promise( ( r ) => setTimeout( r, 80 ) ) );
		expect( container.textContent ).toContain( 'All tests of this form.' );
		expect( container.querySelector( '.ffxb-action.is-open' ) ).not.toBeNull();
	} );

	it( 'sets how long a test runs, counts its days after publishing, pauses it and decides at the end', async () => {
		const api = fakeApi( { get: vi.fn( async () => ( { ...summary, currentRevision: 3, document: blank(), lockTtl: 150 } ) ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		await act( async () => button( 'New design test' ).click() );
		await settle();
		const test = () => store.getState().doc?.experiments?.[ 0 ];
		expect( container.textContent ).toContain( 'Runs 10 days from the day you publish it.' );
		await fill( 'Runs for', '14' );
		await fill( 'At the end', 'ask' );
		expect( [ test()?.days, test()?.onEnd ] ).toEqual( [ 14, 'ask' ] );
		expect( container.textContent ).toContain( 'At the end the test pauses, everyone sees Current design' );

		// The goal can be the lead value once the form works one out.
		expect( container.textContent ).not.toContain( 'Main goal' );
		await act( async () =>
			store.getState().change( ( d ) => {
				d.settings.valueCalculation = 'c_value';
			} )
		);
		await fill( 'Main goal', 'value' );
		expect( test()?.goal ).toBe( 'value' );
		await fill( 'Main goal', 'complete' );
		expect( test()?.goal ).toBeUndefined();
		await act( async () =>
			store.getState().change( ( d ) => {
				delete d.settings.valueCalculation;
			} )
		);

		// Publishing brings the first day the plugin noted.
		const id = test()?.id ?? '';
		vi.mocked( api.publish ).mockResolvedValueOnce( { revision: 4, renderer: 'v5', warnings: [], form: { ...summary, status: 'published', currentRevision: 4 }, experiments: { [ id ]: { startedAt: today() } } } );
		await act( async () => void ( await store.getState().publish() ) );
		await settle();
		expect( test()?.startedAt ).toBe( today() );
		expect( container.textContent ).toContain( 'Day 1 of 14, the last day is' );

		await act( async () => button( 'Pause test' ).click() );
		expect( test()?.status ).toBe( 'paused' );
		expect( container.querySelector( '.ffxb-action .ffxb-badge--warning' )?.textContent ).toBe( 'Paused' );
		expect( container.textContent ).toContain( 'Paused: everyone sees Current design.' );
		await act( async () => button( 'Go on with the test' ).click() );
		expect( test()?.status ).toBe( 'running' );

		// The plugin ended it after its days and asks.
		await act( async () =>
			store.getState().change( ( d ) => {
				const x = d.experiments?.[ 0 ];
				if ( x ) {
					Object.assign( x, { status: 'paused', pausedAt: today(), outcome: 'winner', suggested: 'b' } );
				}
			} )
		);
		expect( container.querySelector( '.ffxb-action .ffxb-badge--brand' )?.textContent ).toBe( 'Waits for you' );
		expect( container.textContent ).toContain( 'Variant B brought the most entries. Until you decide, everyone sees Current design.' );
		await act( async () => button( 'Run 2 more days' ).click() );
		expect( [ test()?.status, test()?.extended ] ).toEqual( [ 'running', 2 ] );
		await act( async () =>
			store.getState().change( ( d ) => {
				const x = d.experiments?.[ 0 ];
				if ( x ) {
					Object.assign( x, { status: 'paused', outcome: 'winner', suggested: 'b' } );
				}
			} )
		);
		await act( async () => button( 'Show everyone Variant B' ).click() );
		expect( [ test()?.status, test()?.winner ] ).toEqual( [ 'stopped', 'b' ] );
		// Running again starts anew.
		await act( async () => button( 'Run again' ).click() );
		expect( [ test()?.status, test()?.startedAt, test()?.extended ] ).toEqual( [ 'running', undefined, undefined ] );
	} );

	it( 'plans variants for later rounds and starts the next round at the end', async () => {
		const api = fakeApi( { get: vi.fn( async () => ( { ...summary, currentRevision: 3, document: blank(), lockTtl: 150 } ) ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		await act( async () => button( 'New design test' ).click() );
		await settle();
		const test = () => store.getState().doc?.experiments?.[ 0 ];
		const later = () => [ ...container.querySelectorAll<HTMLLabelElement>( '.ffxb-toggle label' ) ].filter( ( l ) => 'Test later against the winner' === l.textContent ).map( ( l ) => document.getElementById( l.htmlFor ) as HTMLInputElement );
		expect( later() ).toHaveLength( 0 );
		await act( async () => button( 'Add variant C' ).click() );
		expect( later() ).toHaveLength( 2 );
		await act( async () => later()[ 1 ]?.click() );
		expect( test()?.variants.map( ( v ) => [ v.weight, v.planned ?? false ] ) ).toEqual( [
			[ 50, false ],
			[ 50, false ],
			[ 0, true ],
		] );
		// Two variants stay in the round.
		expect( later()[ 0 ]?.disabled ).toBe( true );
		expect( container.textContent ).toContain( 'Test plan: when this round ends, the variant kept meets Variant C, one round each.' );
		expect( container.textContent ).toContain( 'meets the next variant of the test plan' );

		await act( async () =>
			store.getState().change( ( d ) => {
				const x = d.experiments?.[ 0 ];
				if ( x ) {
					Object.assign( x, { status: 'paused', startedAt: '2026-10-01', pausedAt: '2026-10-11', outcome: 'winner', suggested: 'b' } );
				}
			} )
		);
		await act( async () => button( 'Next round: Variant B against Variant C' ).click() );
		expect( test()?.variants.map( ( v ) => [ v.id, v.weight, v.retired ?? false ] ) ).toEqual( [
			[ 'b', 50, false ],
			[ 'c', 50, false ],
			[ 'a', 0, true ],
		] );
		expect( [ test()?.status, test()?.startedAt, test()?.outcome ] ).toEqual( [ 'running', undefined, undefined ] );
		expect( container.textContent ).toContain( 'Lost an earlier round and gets no views.' );
	} );

	it( 'tests the design, suggests the winner and keeps its design for the form', async () => {
		const stats = [ { id: '', name: '', status: 'running' as const, winner: null, variants: [
			{ id: 'a', label: 'a', weight: 50, views: 400, starts: 90, completions: 40, conversionRate: 0.1, uplift: null, chanceToBeatControl: null },
			{ id: 'b', label: 'b', weight: 50, views: 410, starts: 101, completions: 70, conversionRate: 0.1707, uplift: 0.707, chanceToBeatControl: 0.998 },
		] } ];
		const api = fakeApi( {
			get: vi.fn( async () => ( { ...summary, currentRevision: 3, document: blank(), lockTtl: 150 } ) ),
			experimentStats: vi.fn( async () => stats.map( ( x ) => ( { ...x, id: store.getState().doc?.experiments?.[ 0 ]?.id ?? '' } ) ) ),
		} );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await act( async () => store.getState().select( {} ) );
		await workspace( 'Settings' );
		await act( async () => button( 'New design test' ).click() );
		await settle();
		const test = () => store.getState().doc?.experiments?.[ 0 ];
		expect( test()?.variants[ 1 ]?.style ).toEqual( {} );
		await fill( 'Main colour', '#1d7a46' );
		await fill( 'Corners of buttons (px)', '24' );
		expect( test()?.variants[ 1 ]?.style ).toEqual( { 'color.primary': '#1d7a46', 'radius.button': '24' } );
		await act( async () => button( 'Add variant C' ).click() );
		expect( test()?.variants.map( ( v ) => v.weight ) ).toEqual( [ 33, 33, 33 ] );

		expect( container.textContent ).toContain( 'Variant B brings 70.7 % more entries than the comparison, with 99.8 % certainty.' );
		await act( async () => button( 'Show everyone Variant B' ).click() );
		expect( test() ).toMatchObject( { status: 'stopped', winner: 'b' } );
		await act( async () => button( 'End test and keep this design' ).click() );
		expect( store.getState().doc?.experiments ).toBeUndefined();
		expect( store.getState().doc?.style.tokens ).toMatchObject( { 'color.primary': '#1d7a46', 'radius.button': '24' } );
	} );
} );

describe( 'statistics', () => {
	it( 'shows figures, the change to the period before, steps and answers', async () => {
		const api = fakeApi();
		const published = { ...summary, status: 'published' as const, currentRevision: 3, hasDraft: false };
		api.list = vi.fn( async () => ( { forms: [ published ], total: 1, categories: [] } ) );
		await act( async () => root.render( <FormsList api={ api } onOpen={ () => undefined } /> ) );
		await settle();
		await act( async () => button( 'Statistics' ).click() );
		await settle();
		const dialog = container.querySelector( 'dialog.ffxb-dialog' ) as HTMLElement;
		expect( dialog.textContent ).toContain( 'Statistics: Anfrage' );
		const kpis = [ ...dialog.querySelectorAll( '.ffxb-kpi' ) ].map( ( k ) => k.textContent );
		expect( kpis[ 0 ] ).toContain( '150' );
		expect( kpis[ 0 ] ).toContain( '+50%' );
		expect( dialog.querySelector( '.ffxb-kpi__change.is-down' )?.closest( '.ffxb-kpi' )?.textContent ).toContain( 'Conversion rate' );
		expect( kpis[ 4 ] ).toContain( 'Average time to fill in2 min 05 sMedian 1 min 10 s' );
		expect( dialog.querySelector( '.ffxb-devices' )?.textContent ).toBe( 'Mobile9 (75%)Desktop3 (25%)Tablet0 (0%)' );
		expect( dialog.textContent ).toContain( 'Most visitors leave on “Wofür?”' );
		expect( dialog.querySelector( '.ffxb-answers' )?.textContent ).toContain( 'Haus' );
		expect( dialog.querySelector( '.ffxb-answers' )?.textContent ).toContain( '30 (75%)' );
		// The previous period is asked for as well.
		expect( ( api.formStats as ReturnType<typeof vi.fn> ).mock.calls ).toHaveLength( 2 );
		const analytics = () => [ ...dialog.querySelectorAll( 'a' ) ].find( ( a ) => a.textContent === 'Open analytics' );
		expect( analytics()?.getAttribute( 'href' ) ).toBe( `admin.php?page=funnelforms-stats&form=${ published.id }` );
		expect( dialog.textContent ).not.toContain( 'More about Funnelforms Pro' );
		await act( async () => button( 'Last 7 days' ).click() );
		await settle();
		expect( ( api.formStats as ReturnType<typeof vi.fn> ).mock.calls ).toHaveLength( 4 );
		expect( analytics()?.getAttribute( 'href' ) ).toBe( `admin.php?page=funnelforms-stats&form=${ published.id }&period=7` );
	} );

	it( 'is offered only for published forms and to who may see entries', async () => {
		await act( async () => root.render( <FormsList api={ fakeApi() } onOpen={ () => undefined } /> ) );
		await settle();
		expect( () => button( 'Statistics' ) ).toThrow();
	} );

	it( 'offers no analytics switch and ignores the shortcut without the right to see entries', async () => {
		const formStats = vi.fn( async () => {
			throw new Error( 'not allowed' );
		} );
		const api = fakeApi( { get: vi.fn( async () => ( { ...summary, status: 'published' as const, currentRevision: 3, document: blank(), lockTtl: 150 } ) ), formStats } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		const rights = { entries: false, code: false, settings: false };
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ rights } /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-analytics__toggle' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-views__item[data-view="stats"]' ) ).toBeNull();
		await act( async () => window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'a' } ) ) );
		await settle();
		expect( formStats ).not.toHaveBeenCalled();
		expect( container.querySelector( '.ffxb-node__analytics' ) ).toBeNull();
		// The list of shortcuts leaves it out as well.
		await act( async () => window.dispatchEvent( new KeyboardEvent( 'keydown', { key: '?' } ) ) );
		expect( document.body.textContent ).toContain( 'Show these shortcuts' );
		expect( document.body.textContent ).not.toContain( 'Turn the analytics on the canvas on or off' );
	} );

	it( 'shows the analytics of the published form on the canvas, by switch, shortcut and from the figures', async () => {
		const doc = blank();
		const step = addStep( doc, 'choice', { locale: 'de_DE' }, { before: 'contact' } );
		const field = ( doc.nodes.find( ( n ) => n.id === step ) as { fields: Array<{ id: string }> } ).fields[ 0 ]?.id ?? '';
		const formStats = vi.fn( async ( _id: number, from = '', to = '', detail?: 'full' ) => ( {
			form: 7,
			from,
			to,
			totals: { views: 20, starts: 12, completions: 4, conversionRate: 0.2 },
			daily: [],
			steps: [
				{ id: step, type: 'step' as const, title: 'Wofür?', reached: 12, left: 4 },
				{ id: 'contact', type: 'contact' as const, title: 'Kontakt', reached: 8, left: 4 },
			],
			answers: [ { field, step, title: 'Wofür?', options: [ { id: 'o1', label: 'Haus', chosen: 6, completed: 3 } ] } ],
			...( 'full' === detail
				? {
						times: { steps: { [ step ]: 42 } },
						paths: [
							{ from: '', to: step, sessions: 12, completed: 4 },
							{ from: step, to: 'contact', sessions: 8, completed: 4 },
							{ from: 'contact', to: 'end', sessions: 4, completed: 4 },
						],
						fieldStats: [ { field, step, type: 'choice', title: 'Wofür?', invalid: 3, touched: 5, lastTouched: 2 } ],
						extended: 10,
				  }
				: {} ),
		} ) );
		const api = fakeApi( { get: vi.fn( async () => ( { ...summary, status: 'published' as const, currentRevision: 3, document: doc, lockTtl: 150 } ) ), formStats } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		const toggle = (): HTMLButtonElement => container.querySelector( '.ffxb-analytics__toggle' ) as HTMLButtonElement;
		expect( toggle().getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		expect( formStats ).not.toHaveBeenCalled();

		// The shortcut A turns it on, outside inputs.
		await act( async () => window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'a' } ) ) );
		await settle();
		expect( toggle().getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		// The first request of an opening says so, for the count of the diagnostics.
		expect( formStats ).toHaveBeenLastCalledWith( 7, expect.any( String ), expect.any( String ), 'full', 'canvas' );
		const node = ( id: string ): HTMLElement => container.querySelector( `.ffxb-node[data-node="${ id }"]` ) as HTMLElement;
		expect( node( step ).className ).toContain( 'is-band-high' );
		expect( node( step ).className ).toContain( 'is-strongest' );
		expect( node( step ).querySelector( '.ffxb-node__analytics' )?.textContent ).toBe( 'Many leave12 reached · 4 left (33%)Median time here: 42 s' );
		expect( node( 'contact' ).querySelector( '.ffxb-node__analytics' )?.textContent ).toContain( '4 sent (50%)' );
		expect( node( 'end' ).querySelector( '.ffxb-node__analytics' )?.textContent ).toBe( '4 sent forms ended here' );
		expect( container.querySelector( '.ffxb-analytics-legend' )?.textContent ).toContain( 'Strongest path' );
		expect( container.querySelector( '.ffxb-analytics__small' )?.textContent ).toBe( 'Fewer than 30 views: the shares can change a lot with each visitor.' );
		// The same figures as a table in the inspector while nothing is selected.
		const paths = [ ...container.querySelectorAll( '.ffxb-analytics-paths tbody tr' ) ].map( ( r ) => r.textContent );
		expect( paths ).toEqual( [ 'Deine Kontaktdaten → Danke! ★ (Strongest path)450%', 'New question → Deine Kontaktdaten ★ (Strongest path)867%' ] );

		// A node shows its fields and answers in the inspector; editing stays.
		await act( async () => node( step ).click() );
		const section = container.querySelector( '.ffxb-inspector .ffxb-analytics-section' ) as HTMLElement;
		expect( section.querySelector( '.ffxb-analytics-fields tbody' )?.textContent ).toBe( 'Wofür?3 (25%)52' );
		expect( section.textContent ).toContain( 'from 10 of 20 views with consent to statistics' );
		expect( section.querySelector( '.ffxb-answers' )?.textContent ).toContain( 'Haus6 (100%)50%' );
		expect( container.querySelector( '.ffxb-inspector' )?.textContent ).toContain( 'Question' );

		await act( async () => button( '7 days' ).click() );
		await settle();
		expect( formStats ).toHaveBeenCalledTimes( 2 );
		expect( formStats ).toHaveBeenLastCalledWith( 7, expect.any( String ), expect.any( String ), 'full', undefined );
		await act( async () => toggle().click() );
		expect( container.querySelector( '.ffxb-node__analytics' ) ).toBeNull();

		// "Show on the canvas" on the statistics page opens the editor with the mode on.
		await act( async () => root.render( <Builder key="stats" api={ api } formId={ 7 } onBack={ () => undefined } store={ store } figures /> ) );
		await settle();
		expect( toggle().getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( formStats ).toHaveBeenLastCalledWith( 7, expect.any( String ), expect.any( String ), 'full', 'canvas' );
		expect( container.querySelector( '.ffxb-figures-bar' ) ).toBeNull();
	} );
} );

describe( 'phone fields', () => {
	const twilio = 'twilio:7a1c2e3d-4b5f-4c6d-8e9f-0a1b2c3d4e5f';
	const toggle = ( label: string ): HTMLInputElement => {
		const found = [ ...container.querySelectorAll( '.ffxb-toggle label' ) ].find( ( l ) => l.textContent === label ) as HTMLLabelElement | undefined;
		const input = found ? document.getElementById( found.htmlFor ) : null;
		if ( ! input ) {
			throw new Error( 'No toggle ' + label );
		}
		return input as HTMLInputElement;
	};

	it( 'sets the countries of the picker and the confirmation by text message', async () => {
		const connections = vi.fn( async () => [ { ref: twilio, type: 'twilio', label: 'SMS' } ] );
		const api = fakeApi( { connections } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } rights={ { entries: true, code: false, settings: true } } /> ) );
		await settle();
		const contact = (): Extract<FormNode, { type: 'contact' }> => store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type ) as Extract<FormNode, { type: 'contact' }>;
		await act( async () =>
			store.getState().change( ( d ) => {
				const node = d.nodes.find( ( n ) => 'contact' === n.type ) as Extract<FormNode, { type: 'contact' }>;
				node.fields.push( { id: 'c_phone', type: 'phone', key: 'phone', label: { de_DE: 'Telefon' }, required: true, props: { placeholder: { de_DE: '' } } } );
			} )
		);
		await act( async () => store.getState().select( { node: contact().id, field: 'c_phone' } ) );
		const props = (): Record<string, unknown> => ( contact().fields.find( ( f ) => 'c_phone' === f.id ) as ContactField ).props;

		// Older phone fields keep their free input until the picker is switched on.
		expect( toggle( 'Country picker' ).checked ).toBe( false );
		await act( async () => toggle( 'Country picker' ).click() );
		expect( props().country ).toEqual( {} );
		await choose( 'Start with', 'AT' );
		await choose( 'Countries on top', 'AT' );
		await choose( 'Countries on top', 'CH' );
		await choose( 'Only these countries', 'CH' );
		expect( props().country ).toEqual( { default: 'AT', preferred: [ 'AT', 'CH' ], allowed: [ 'CH' ] } );
		expect( container.textContent ).toContain( 'The start country is not among the countries accepted.' );
		await act( async () => ( container.querySelector( '.ffxb-phone-countries .ffxb-chip__remove' ) as HTMLButtonElement ).click() );
		expect( ( props().country as { preferred: string[] } ).preferred ).toEqual( [ 'CH' ] );

		expect( connections ).not.toHaveBeenCalled();
		await act( async () => toggle( 'Confirm by text message' ).click() );
		await settle();
		expect( connections ).toHaveBeenCalled();
		expect( toggle( 'Country picker' ).disabled ).toBe( true );
		expect( container.textContent ).not.toContain( 'There is no SMS connection yet.' );
		await fill( 'Connection', twilio );
		await fill( 'Sender', 'Example' );
		await fill( 'Text message', 'Code: {{code}}' );
		expect( props().sms ).toEqual( { connectionRef: twilio, sender: 'Example', text: { de_DE: 'Code: {{code}}' } } );
	} );

	it( 'warns when the site has no SMS connection', async () => {
		const api = fakeApi( { connections: vi.fn( async () => [] ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		const node = store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type ) as Extract<FormNode, { type: 'contact' }>;
		await act( async () =>
			store.getState().change( ( d ) => {
				( d.nodes.find( ( n ) => n.id === node.id ) as Extract<FormNode, { type: 'contact' }> ).fields.push( { id: 'c_code', type: 'phone_verification', key: 'code', label: { de_DE: 'Mobil' }, required: true, props: { sms: { connectionRef: '', sender: '', text: { de_DE: '' } } } } );
			} )
		);
		await act( async () => store.getState().select( { node: node.id, field: 'c_code' } ) );
		await settle();
		expect( toggle( 'Confirm by text message' ).checked ).toBe( true );
		expect( toggle( 'Confirm by text message' ).disabled ).toBe( true );
		expect( container.textContent ).toContain( 'There is no SMS connection yet.' );
	} );
} );

describe( 'design from the website and in the preview', () => {
	const site = ( confidence: 'high' | 'low' ): SiteDesign => ( {
		url: 'https://site.example.test/',
		colors: confidence === 'high' ? [ '#0e7490', '#1f2937', '#fffbeb' ] : [ '#888a8c', '#f4f4f4' ],
		roles: confidence === 'high' ? { primary: '#0e7490', text: '#1f2937', background: '#fffbeb' } : { primary: '#888a8c' },
		origins: confidence === 'high' ? { '#0e7490': 'Astra: buttons', '#1f2937': 'Astra: text', '#fffbeb': 'Astra: background' } : {},
		fonts: confidence === 'high' ? [ { family: 'Lora', value: 'Lora', local: false, google: true, from: 'Astra: font of headings' } ] : [],
		confidence,
		sources: confidence === 'high' ? [ 'Astra' ] : [],
		logo: null,
	} );
	const siteDialog = (): HTMLDialogElement => [ ...container.querySelectorAll( 'dialog' ) ].find( ( d ) => "Your website's design" === d.getAttribute( 'aria-label' ) ) as HTMLDialogElement;
	const inSite = ( name: string ): HTMLButtonElement => [ ...siteDialog().querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === name ) as HTMLButtonElement;

	it( "uses the website's own design in one click, with where each colour was found", async () => {
		const api = fakeApi( { siteDesign: vi.fn( async () => site( 'high' ) ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		// The first thing of the design.
		expect( container.querySelector( '.ffxb-design-panel .ffxb-section button' )?.textContent ).toContain( "Use my website's design" );
		await act( async () => ( container.querySelector( '.ffxb-site-design' ) as HTMLButtonElement ).click() );
		await settle();
		expect( api.siteDesign ).toHaveBeenCalled();
		expect( siteDialog().textContent ).toContain( 'Read from Astra.' );
		expect( siteDialog().textContent ).toContain( '#0e7490, from Astra: buttons' );
		expect( siteDialog().textContent ).toContain( 'Lora (Astra: font of headings)' );
		expect( siteDialog().querySelectorAll( '.ffxb-contrast.is-ok' ) ).toHaveLength( 2 );
		await act( async () => inSite( 'Apply' ).click() );
		await settle();
		expect( api.installGoogleFont ).toHaveBeenCalledWith( 'Lora' );
		expect( store.getState().doc?.style.tokens ).toMatchObject( { 'color.primary': '#0e7490', 'color.text': '#1f2937', 'color.background': '#fffbeb', 'font.family': 'Lora' } );
	} );

	it( 'applies nothing it is unsure about and can read the start page instead', async () => {
		const api = fakeApi( { siteDesign: vi.fn( async () => site( 'low' ) ) } );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		const before = { ...store.getState().doc?.style.tokens };
		await act( async () => ( container.querySelector( '.ffxb-site-design' ) as HTMLButtonElement ).click() );
		await settle();
		expect( siteDialog().textContent ).toContain( 'Not sure about these colours' );
		const groups = [ ...siteDialog().querySelectorAll( '[role="radiogroup"]' ) ];
		expect( groups.map( ( g ) => g.querySelector( '[aria-checked="true"]' )?.textContent ) ).toEqual( [ 'Keep', 'Keep', 'Keep' ] );
		expect( inSite( 'Apply' ).disabled ).toBe( true );
		expect( store.getState().doc?.style.tokens ).toEqual( before );

		await act( async () => inSite( 'Read my start page' ).click() );
		await settle();
		expect( api.branding ).toHaveBeenCalledWith( 'https://site.example.test/', true );
		expect( siteDialog().textContent ).toContain( 'Read from your start page' );
		expect( inSite( 'Apply' ).disabled ).toBe( false );
	} );

	it( 'shows the tokens of a part picked in the preview and changes them live', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		await settle();
		const frame = container.querySelector( '.ffxb-live iframe' ) as HTMLIFrameElement;
		const win = frame.contentWindow as Window;
		const posted = vi.spyOn( win, 'postMessage' );
		const send = async ( data: unknown, source: unknown = win, origin = 'null' ): Promise<void> => {
			await act( async () => {
				window.dispatchEvent( new MessageEvent( 'message', { data, origin, source: source as Window } ) );
			} );
		};
		await send( { type: 'ffx-design', action: 'ready' } );
		// The preview opens to try the form.
		expect( button( 'Try the form' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( posted ).toHaveBeenLastCalledWith( expect.objectContaining( { type: 'ffx-design', action: 'mode', on: false } ), '*' );
		expect( container.querySelector( 'select[aria-label="Part of the form to design"]' ) ).toBeNull();
		await act( async () => button( 'Edit design' ).click() );
		expect( posted ).toHaveBeenLastCalledWith( expect.objectContaining( { type: 'ffx-design', action: 'mode', on: true } ), '*' );

		// Not from the frame: nothing happens.
		await send( { type: 'ffx-design', action: 'pick', target: 'button', rect: { x: 0, y: 0, width: 10, height: 10 } }, window );
		await send( { type: 'ffx-design', action: 'pick', target: 'button', rect: { x: 0, y: 0, width: 10, height: 10 } }, win, 'https://example.invalid' );
		expect( container.querySelector( '.ffxb-live-design' ) ).toBeNull();

		await send( { type: 'ffx-design', action: 'pick', target: 'button', rect: { x: 40, y: 300, width: 120, height: 44 } } );
		const panel = container.querySelector( '.ffxb-live-design' ) as HTMLElement;
		expect( panel.getAttribute( 'aria-label' ) ).toBe( 'Design of Next and send button' );
		expect( [ ...panel.querySelectorAll( '.ffxb-token' ) ].map( ( t ) => t.textContent ) ).toEqual( [ 'color.button', 'color.onButton' ] );
		const field = panel.querySelector( '.ffxb-color input[type="text"]' ) as HTMLInputElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( field, '#c2410c' );
			field.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		expect( store.getState().doc?.style.tokens[ 'color.button' ] ).toBe( '#c2410c' );
		// The frame gets the new style at once, and is not loaded again.
		expect( posted ).toHaveBeenLastCalledWith( expect.objectContaining( { type: 'ffx-preview-style', css: expect.stringContaining( '--ffx-color-button:#c2410c;' ) } ), '*' );
		await act( async () => new Promise( ( resolve ) => setTimeout( resolve, 900 ) ) );
		expect( api.preview ).toHaveBeenCalledTimes( 1 );

		// Undo pressed inside the frame.
		await send( { type: 'ffx-design', action: 'key', key: 'undo' } );
		expect( store.getState().doc?.style.tokens[ 'color.button' ] ).toBeUndefined();

		// The keyboard: the list of parts, Escape closes.
		const parts = container.querySelector( 'select[aria-label="Part of the form to design"]' ) as HTMLSelectElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( parts, 'progress' );
			parts.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
		expect( posted ).toHaveBeenLastCalledWith( { type: 'ffx-design', action: 'select', target: 'progress' }, '*' );
		expect( container.querySelector( '.ffxb-live-design' )?.getAttribute( 'aria-label' ) ).toBe( 'Design of Progress bar' );
		await act( async () => ( container.querySelector( '.ffxb-live-design' ) as HTMLElement ).dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) ) );
		expect( container.querySelector( '.ffxb-live-design' ) ).toBeNull();

		// Trying the form switches the design mode off.
		await act( async () => button( 'Try the form' ).click() );
		expect( posted ).toHaveBeenLastCalledWith( expect.objectContaining( { action: 'mode', on: false } ), '*' );
	} );

	it( 'picks a colour with the pipette or from an image', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await workspace( 'Design' );
		// Without the eye dropper of the browser: picking from an image.
		await act( async () => button( 'Pick Accent colour with the pipette' ).click() );
		expect( [ ...container.querySelectorAll( 'dialog' ) ].some( ( d ) => 'Pick a colour from an image' === d.getAttribute( 'aria-label' ) ) ).toBe( true );
		await act( async () => button( 'Cancel' ).click() );

		( globalThis as { EyeDropper?: unknown } ).EyeDropper = class {
			async open(): Promise<{ sRGBHex: string }> {
				return { sRGBHex: 'rgb(14, 116, 144)' };
			}
		};
		try {
			await act( async () => button( 'Pick Accent colour with the pipette' ).click() );
			await settle();
			expect( store.getState().doc?.style.tokens[ 'color.primary' ] ).toBe( '#0e7490' );
		} finally {
			delete ( globalThis as { EyeDropper?: unknown } ).EyeDropper;
		}
	} );
} );
