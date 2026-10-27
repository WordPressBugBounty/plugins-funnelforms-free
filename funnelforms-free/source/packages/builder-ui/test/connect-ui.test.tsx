import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDocument } from '@funnelforms/form-schema';
import { ApiError, type FormsApi } from '../src/api';
import type { ConnectApi, CrmConnection, CrmProvider, ImportSource } from '../src/connect';
import { CrmAction } from '../src/ui/CrmAction';
import { BuilderContext, type BuilderEnv } from '../src/ui/context';
import { FunnelformsImport, ImportScreen } from '../src/ui/ImportScreen';
import { blank } from './blank';

( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const providers: CrmProvider[] = [
	{
		provider: 'hubspot',
		label: 'HubSpot',
		category: 'crm',
		lookups: true,
		signIn: false,
		help: 'Since 26 October 2026 HubSpot no longer creates legacy private apps.',
		credentials: [ { name: 'access_token', label: 'Service key', input: 'password', secret: true, required: true } ],
		mapping: [
			{ name: 'email', label: 'E-mail', kind: 'contact', required: true },
			{ name: 'dealname', label: 'Deal name', kind: 'text', required: true },
			{ name: 'pipeline', label: 'Pipeline', kind: 'choice', required: true },
			{ name: 'dealstage', label: 'Deal stage', kind: 'choice', required: true, dependsOn: 'pipeline' },
		],
	},
	{ provider: 'googlesheets', label: 'Google Sheets', category: 'spreadsheet', lookups: true, signIn: true, help: 'Sign in with Google.', credentials: [], mapping: [ { name: 'spreadsheet', label: 'Spreadsheet', kind: 'choice', required: true } ] },
];

const connection: CrmConnection = { ref: 'hubspot:abc', provider: 'hubspot', label: 'HubSpot Vertrieb', legacy: false, createdAt: '2026-10-19 10:00:00', forms: 2 };

function fakeConnect( overrides: Partial<ConnectApi> = {} ): ConnectApi {
	return {
		crmProviders: vi.fn( async () => providers ),
		crmConnections: vi.fn( async () => [ connection ] ),
		createCrmConnection: vi.fn( async ( provider: string, label: string ) => ( { ...connection, ref: provider + ':new', provider, label, forms: 0 } ) ),
		updateCrmConnection: vi.fn( async ( _ref: string, changes: { label?: string } ) => ( { ...connection, ...changes } ) ),
		deleteCrmConnection: vi.fn( async () => undefined ),
		crmOptions: vi.fn( async () => ( {
			checked: true,
			options: {
				pipeline: [ { value: 'p1', label: 'Sales' }, { value: 'p2', label: 'Partners' } ],
				dealstage: { p1: [ { value: 's1', label: 'Qualified' } ], p2: [ { value: 's2', label: 'New partner' } ] },
				spreadsheet: [ { value: 'sheet-1', label: 'Anfragen' } ],
			},
		} ) ),
		startCrmSignIn: vi.fn(),
		crmSignIn: vi.fn(),
		createSpreadsheet: vi.fn( async () => ( { value: 'sheet-2', label: 'Neu' } ) ),
		importSources: vi.fn( async () => [] ),
		importFile: vi.fn( async () => ( { source: 'wpforms', forms: [] } ) ),
		importSite: vi.fn( async () => ( { source: 'wpforms', forms: [] } ) ),
		...overrides,
	};
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

async function type( el: HTMLInputElement | HTMLSelectElement, value: string ): Promise<void> {
	const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
	await act( async () => {
		Object.getOwnPropertyDescriptor( proto, 'value' )?.set?.call( el, value );
		el.dispatchEvent( new Event( el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true } ) );
	} );
	await settle();
}

function field( label: string ): HTMLInputElement | HTMLSelectElement {
	const l = [ ...container.querySelectorAll( 'label' ) ].find( ( x ) => x.textContent === label );
	const el = l ? container.querySelector<HTMLInputElement | HTMLSelectElement>( '#' + CSS.escape( l.htmlFor ) ) : null;
	if ( ! el ) {
		throw new Error( 'No field ' + label );
	}
	return el;
}

describe( 'import screen', () => {
	const sources: ImportSource[] = [
		{
			source: 'wpforms',
			label: 'WPForms',
			forms: [
				{ id: '5', title: 'Anfrage', importedAs: null },
				{ id: '6', title: 'Newsletter', importedAs: 41 },
			],
		},
	];

	it( 'lists the plugins found, marks imported forms with a link, and imports the chosen ones', async () => {
		const api = fakeConnect( {
			importSources: vi.fn( async () => sources ),
			importSite: vi.fn( async () => ( {
				source: 'wpforms',
				forms: [ { source: 'wpforms', sourceId: '5', id: 77, title: 'Anfrage', problems: [ 'field_type:x' ], notes: [ 'captcha_not_imported' ], messages: [ 'The CAPTCHA was left out.' ] } ],
			} ) ),
		} );
		await act( async () => root.render( <ImportScreen api={ api } config={ { builderUrl: '/wp-admin/admin.php?page=funnelforms-builder', maxBytes: 10 * 1024 * 1024 } } /> ) );
		await settle();
		const boxes = container.querySelectorAll<HTMLInputElement>( '.ffx-import__forms input[type="checkbox"]' );
		expect( boxes ).toHaveLength( 2 );
		expect( boxes[ 1 ]?.disabled ).toBe( true );
		expect( container.querySelector( '.ffx-import__done a' )?.getAttribute( 'href' ) ).toBe( '/wp-admin/admin.php?page=funnelforms-builder&form=41' );
		expect( button( 'Import 0 forms' ).disabled ).toBe( true );
		expect( container.textContent ).toContain( 'Up to 10 MB per file.' );

		await act( async () => boxes[ 0 ]?.click() );
		await click( button( 'Import 1 form' ) );
		expect( api.importSite ).toHaveBeenCalledWith( 'wpforms', [ '5' ], false );
		expect( container.querySelector( '.ffx-import__result' )?.textContent ).toContain( 'The CAPTCHA was left out.' );
		expect( container.querySelector( '.ffx-import__result a' )?.getAttribute( 'href' ) ).toBe( '/wp-admin/admin.php?page=funnelforms-builder&form=77' );
	} );

	it( 'imports again only when asked to', async () => {
		const api = fakeConnect( { importSources: vi.fn( async () => sources ) } );
		await act( async () => root.render( <ImportScreen api={ api } /> ) );
		await settle();
		const again = container.querySelector<HTMLInputElement>( '.ffx-import__bar input' ) as HTMLInputElement;
		await act( async () => again.click() );
		const boxes = container.querySelectorAll<HTMLInputElement>( '.ffx-import__forms input[type="checkbox"]' );
		expect( boxes[ 1 ]?.disabled ).toBe( false );
		await act( async () => boxes[ 1 ]?.click() );
		await click( button( 'Import 1 form' ) );
		expect( api.importSite ).toHaveBeenCalledWith( 'wpforms', [ '6' ], true );
	} );

	it( 'explains a skipped form and offers to import it again', async () => {
		const api = fakeConnect( {
			importSources: vi.fn( async () => sources ),
			importSite: vi.fn( async () => ( { source: 'wpforms', forms: [ { source: 'wpforms', sourceId: '6', id: 41, skipped: 'already_imported' as const } ] } ) ),
		} );
		await act( async () => root.render( <ImportScreen api={ api } config={ { builderUrl: '/b' } } /> ) );
		await settle();
		const again = container.querySelector<HTMLInputElement>( '.ffx-import__bar input' ) as HTMLInputElement;
		await act( async () => again.click() );
		await act( async () => container.querySelectorAll<HTMLInputElement>( '.ffx-import__forms input[type="checkbox"]' )[ 1 ]?.click() );
		await click( button( 'Import 1 form' ) );
		expect( container.querySelector( '.ffx-import__result' )?.textContent ).toContain( 'imported before' );
		await click( button( 'Import again' ) );
		expect( api.importSite ).toHaveBeenLastCalledWith( 'wpforms', [ '6' ], true );
	} );

	it( 'imports a file, refuses a too large one, and shows the error of the server', async () => {
		const api = fakeConnect( {
			importFile: vi.fn( async () => Promise.reject( new ApiError( 'unknown_format', 'The file is no export of a supported form plugin.', 400 ) ) ),
		} );
		await act( async () => root.render( <ImportScreen api={ api } config={ { maxBytes: 10 } } /> ) );
		await settle();
		const input = container.querySelector<HTMLInputElement>( 'input[type="file"]' ) as HTMLInputElement;
		const choose = async ( file: File ): Promise<void> => {
			Object.defineProperty( input, 'files', { value: [ file ], configurable: true } );
			await act( async () => input.dispatchEvent( new Event( 'change', { bubbles: true } ) ) );
			await settle();
		};
		await choose( new File( [ 'x'.repeat( 11 ) ], 'big.json' ) );
		expect( api.importFile ).not.toHaveBeenCalled();
		expect( container.querySelector( '.ffx-import__result' )?.textContent ).toContain( 'big.json is larger than' );
		await choose( new File( [ '{}' ], 'forms.json' ) );
		expect( api.importFile ).toHaveBeenCalledTimes( 1 );
		expect( container.querySelector( '.ffx-import__result' )?.textContent ).toContain( 'forms.json: The file is no export of a supported form plugin.' );
		expect( container.querySelector( '.ffx-import__other' ) ).toBeNull();
	} );

	it( 'points to Import Funnelforms for files of Funnelforms', async () => {
		await act( async () => root.render( <ImportScreen api={ fakeConnect() } config={ { importOwn: 'admin.php?page=funnelforms-import-funnelforms' } } /> ) );
		await settle();
		const link = container.querySelector( '.ffx-import__other a' );
		expect( link?.textContent ).toBe( 'Import Funnelforms' );
		expect( link?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-import-funnelforms' );
	} );
} );

describe( 'Import Funnelforms', () => {
	const choose = async ( files: File[] ): Promise<void> => {
		const input = container.querySelector<HTMLInputElement>( 'input[type="file"]' ) as HTMLInputElement;
		Object.defineProperty( input, 'files', { value: files, configurable: true } );
		await act( async () => input.dispatchEvent( new Event( 'change', { bubbles: true } ) ) );
		await settle();
	};

	it( 'imports Funnelforms files only, and lists the drafts with what to check', async () => {
		const importFile = vi.fn( async ( _file: Blob, name: string ) => {
			if ( 'bad.json' === name ) {
				throw new ApiError( 'unknown_format', 'The file is no Funnelforms export.', 400 );
			}
			return 'old.zip' === name
				? [
						{ id: 12, title: 'Altes Formular', legacyId: 77, problems: [], notes: [ 'The calculation was not taken over.' ] },
						{ id: null, legacyId: 78, errors: [ 'no_questions' ] },
				  ]
				: [ { id: 11, title: 'Anfrage', problems: [], notes: [] } ];
		} );
		await act( async () => root.render( <FunnelformsImport api={ { importFile } } config={ { builderUrl: 'admin.php?page=funnelforms-builder', importUrl: 'admin.php?page=funnelforms-import', maxBytes: 100 } } /> ) );
		await settle();
		const input = container.querySelector<HTMLInputElement>( 'input[type="file"]' ) as HTMLInputElement;
		expect( input.getAttribute( 'accept' ) ).toBe( '.json,.zip,application/json,application/zip' );
		expect( container.textContent ).toContain( 'Funnelforms 3' );
		expect( container.querySelector( '.ffx-import__other a' )?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-import' );

		await choose( [ new File( [ '{}' ], 'form.funnelforms.json' ), new File( [ 'PK' ], 'old.zip' ), new File( [ 'x' ], 'bad.json' ), new File( [ 'x'.repeat( 101 ) ], 'huge.zip' ) ] );
		expect( importFile ).toHaveBeenCalledTimes( 3 );
		const result = container.querySelector( '.ffx-import__result' ) as HTMLElement;
		expect( result.textContent ).toContain( '2 forms were imported as drafts.' );
		expect( [ ...result.querySelectorAll( '.ffx-import__row a' ) ].map( ( a ) => a.getAttribute( 'href' ) ) ).toEqual( [ 'admin.php?page=funnelforms-builder&form=11', 'admin.php?page=funnelforms-builder&form=12' ] );
		expect( result.textContent ).toContain( 'The calculation was not taken over.' );
		expect( result.textContent ).toContain( 'old.zip: a form could not be converted (no_questions).' );
		expect( result.textContent ).toContain( 'bad.json: The file is no Funnelforms export.' );
		expect( result.textContent ).toContain( 'huge.zip is larger than' );
		expect( document.activeElement?.id ).toBe( 'ffx-import-result' );
	} );
} );

describe( 'CRM action', () => {
	/** The action editor over a plain document: changes are applied to it in place. */
	function mount( api: ConnectApi, doc: FormDocument, settings = true ): { doc: FormDocument; render: () => Promise<void> } {
		const store = { getState: () => ( { change: ( recipe: ( d: FormDocument ) => void ) => recipe( doc ) } ) };
		const env = { api: { connect: api } as unknown as FormsApi, rights: { entries: true, code: true, settings }, store, ctx: {}, lang: 'de_DE', readOnly: false } as unknown as BuilderEnv;
		const render = async (): Promise<void> => {
			const action = doc.actions.find( ( a ) => 'crm' === a.kind );
			await act( async () =>
				root.render(
					<BuilderContext.Provider value={ env }>
						{ action && 'crm' === action.kind ? <CrmAction doc={ structuredClone( doc ) } action={ structuredClone( action ) as Extract<typeof action, { kind: 'crm' }> } common={ null } /> : null }
					</BuilderContext.Provider>
				)
			);
			await settle();
		};
		return { doc, render };
	}

	function withAction(): FormDocument {
		const doc = blank();
		doc.actions.push( { id: 'a1', on: 'submit', kind: 'crm', config: { provider: '', connectionRef: '', mapping: {} } } );
		return doc;
	}

	it( 'picks the connection of the tool and maps the e-mail field by itself', async () => {
		const api = fakeConnect();
		const { render } = mount( api, withAction() );
		await render();
		await type( field( 'Tool' ) as HTMLSelectElement, 'hubspot' );
		await render();
		expect( ( field( 'Connection' ) as HTMLSelectElement ).value ).toBe( 'hubspot:abc' );
		await render();
		expect( ( field( 'E-mail (required)' ) as HTMLSelectElement ).value ).toBe( '[email]' );
		expect( api.crmOptions ).toHaveBeenCalledWith( 'hubspot:abc' );
	} );

	it( 'offers the stages of the chosen pipeline and clears them when the pipeline changes', async () => {
		const api = fakeConnect();
		const doc = withAction();
		const action = doc.actions[ 0 ];
		if ( action && 'crm' === action.kind ) {
			action.config = { provider: 'hubspot', connectionRef: 'hubspot:abc', mapping: { email: '[email]', pipeline: 'p1', dealstage: 's1' } };
		}
		const { render } = mount( api, doc );
		await render();
		const stage = (): HTMLSelectElement => field( 'Deal stage (required)' ) as HTMLSelectElement;
		expect( [ ...stage().options ].map( ( o ) => o.value ) ).toEqual( [ '', 's1' ] );
		await type( field( 'Pipeline (required)' ) as HTMLSelectElement, 'p2' );
		await render();
		expect( stage().value ).toBe( '' );
		expect( [ ...stage().options ].map( ( o ) => o.value ) ).toEqual( [ '', 's2' ] );
		expect( container.textContent ).toContain( 'Still to fill in: Deal name, Deal stage.' );
	} );

	it( 'creates a spreadsheet for Google Sheets and chooses it', async () => {
		const api = fakeConnect( { crmConnections: vi.fn( async () => [ { ...connection, ref: 'googlesheets:g1', provider: 'googlesheets', label: 'ada@gmail.com' } ] ) } );
		const doc = withAction();
		const action = doc.actions[ 0 ];
		if ( action && 'crm' === action.kind ) {
			action.config = { provider: 'googlesheets', connectionRef: 'googlesheets:g1', mapping: {} };
		}
		const { render } = mount( api, doc );
		await render();
		await click( button( 'New spreadsheet' ) );
		await click( [ ...container.querySelectorAll( 'dialog button' ) ].find( ( b ) => 'Create spreadsheet' === b.textContent ) as HTMLElement );
		expect( api.createSpreadsheet ).toHaveBeenCalledWith( 'googlesheets:g1', 'Anfrage' );
		await render();
		expect( ( field( 'Spreadsheet (required)' ) as HTMLSelectElement ).value ).toBe( 'sheet-2' );
	} );

	it( 'tells when the account rejects the access data', async () => {
		const api = fakeConnect( { crmOptions: vi.fn( async () => Promise.reject( new ApiError( 'credentials_rejected', 'HubSpot did not accept the access data.', 400 ) ) ) } );
		const doc = withAction();
		const action = doc.actions[ 0 ];
		if ( action && 'crm' === action.kind ) {
			action.config = { provider: 'hubspot', connectionRef: 'hubspot:abc', mapping: {} };
		}
		const { render } = mount( api, doc );
		await render();
		expect( container.textContent ).toContain( 'HubSpot did not accept the access data.' );
		// The values can still be typed in.
		expect( field( 'Pipeline (required)' ).tagName ).toBe( 'INPUT' );
	} );
} );
