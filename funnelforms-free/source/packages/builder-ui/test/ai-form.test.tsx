import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig, FormDetail, FormsApi, FormSummary, TemplateCatalog } from '../src/api';
import { ApiError } from '../src/api';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { NewFormDialog } from '../src/ui/NewForm';
import { blank } from './blank';

// The AI form builder: the step of the new-form dialog and the AI bar in the editor.
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

const READY: AiConfig = { ready: true, accountUrl: 'admin.php?page=funnelforms-account' };
const catalog: TemplateCatalog = { goals: [], categories: [], languages: [ 'de_DE' ], locale: 'de_DE', templates: [], icons: {} };

/** An API that answers every call; get() returns the blank form. */
function fakeApi( overrides: Record<string, unknown> = {} ): FormsApi {
	const detail = ( id = 7 ): FormDetail => ( { ...summary, id, document: blank(), lockTtl: 150 } );
	const calls: Record<string, unknown> = {
		get: vi.fn( async () => detail() ),
		templates: vi.fn( async () => catalog ),
		saveDraft: vi.fn( async () => ( { problems: [], missingRights: [], form: summary } ) ),
		connections: vi.fn( async () => [] ),
		revisions: vi.fn( async () => [] ),
		aiCreate: vi.fn( async () => ( { ...detail( 21 ), summary: 'Ein Anfrageformular.' } ) ),
		...overrides,
	};
	return new Proxy( calls, { get: ( target, key: string ) => target[ key ] ?? ( target[ key ] = vi.fn( async () => undefined ) ) } ) as unknown as FormsApi;
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
	delete process.env.FUNNELFORMS_EDITION;
} );

async function settle(): Promise<void> {
	await act( async () => {
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );
}

function button( label: string, scope: ParentNode = container ): HTMLButtonElement {
	const found = [ ...scope.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.trim() === label || b.getAttribute( 'aria-label' ) === label );
	if ( ! found ) {
		throw new Error( 'No button ' + label );
	}
	return found;
}

async function write( text: string ): Promise<void> {
	const area = container.querySelector( '.ffxb-ai__prompt' ) as HTMLTextAreaElement;
	await act( async () => {
		Object.getOwnPropertyDescriptor( HTMLTextAreaElement.prototype, 'value' )?.set?.call( area, text );
		area.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	} );
}

async function gallery( api: FormsApi, ai: AiConfig | null | undefined, onCreated = vi.fn() ): Promise<void> {
	await act( async () => root.render( <NewFormDialog api={ api } ai={ ai } onCreated={ onCreated } onClose={ () => undefined } /> ) );
	await settle();
}

describe( 'create with AI', () => {
	it( 'writes a draft from a description and opens it', async () => {
		let answer: ( value: unknown ) => void = () => undefined;
		const api = fakeApi( { aiCreate: vi.fn( () => new Promise( ( resolve ) => ( answer = resolve ) ) ) } );
		const onCreated = vi.fn();
		await gallery( api, READY, onCreated );
		await act( async () => ( container.querySelector( '.ffxb-tcard--ai button' ) as HTMLButtonElement ).click() );

		expect( container.querySelector( '.ffxb-gallery__toolbar' ) ).toBeNull();
		expect( container.textContent ).toContain( 'Describe your business and what the form should achieve' );
		expect( container.textContent ).toContain( 'in German' );
		expect( container.querySelector( '.ffxb-ai__privacy' )?.textContent ).toContain( 'Anthropic' );
		expect( button( 'Create draft' ).disabled ).toBe( true );

		// An example fills the text; it can be changed before sending.
		const example = container.querySelector( '.ffxb-ai__example' ) as HTMLButtonElement;
		await act( async () => example.click() );
		expect( ( container.querySelector( '.ffxb-ai__prompt' ) as HTMLTextAreaElement ).value ).toBe( example.textContent );
		await write( '  Heat pumps for houses, qualify by budget  ' );
		await act( async () => button( 'Create draft' ).click() );

		expect( api.aiCreate ).toHaveBeenCalledWith( 'Heat pumps for houses, qualify by budget' );
		expect( container.querySelector( '.ffxb-ai__progress' )?.getAttribute( 'role' ) ).toBe( 'status' );
		expect( ( container.querySelector( '.ffxb-ai__prompt' ) as HTMLTextAreaElement ).disabled ).toBe( true );
		expect( button( 'Back to the templates' ).disabled ).toBe( true );

		await act( async () => answer( { id: 21, summary: 'Fertig.' } ) );
		await settle();
		expect( onCreated ).toHaveBeenCalledWith( 21 );
	} );

	it( 'shows why it failed and lets the user try again', async () => {
		const aiCreate = vi.fn( async () => Promise.reject( new ApiError( 'ai_quota', 'The daily limit is reached.', 429 ) ) );
		const onCreated = vi.fn();
		await gallery( fakeApi( { aiCreate } ), READY, onCreated );
		await act( async () => ( container.querySelector( '.ffxb-tcard--ai button' ) as HTMLButtonElement ).click() );
		await write( 'A quote form' );
		await act( async () => button( 'Create draft' ).click() );
		await settle();
		expect( container.querySelector( '.ffxb-ai .ffxb-notice--danger' )?.textContent ).toContain( 'The daily limit is reached.' );
		expect( onCreated ).not.toHaveBeenCalled();
		expect( button( 'Create draft' ).disabled ).toBe( false );
		await act( async () => button( 'Back to the templates' ).click() );
		expect( container.querySelector( '.ffxb-tcard--ai' ) ).not.toBeNull();
	} );

	it( 'asks to connect the license first', async () => {
		const api = fakeApi();
		await gallery( api, { ready: false, accountUrl: 'admin.php?page=funnelforms-account' } );
		await act( async () => ( container.querySelector( '.ffxb-tcard--ai button' ) as HTMLButtonElement ).click() );
		expect( container.querySelector( '.ffxb-ai a' )?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-account' );
		await write( 'A quote form' );
		expect( button( 'Create draft' ).disabled ).toBe( true );
	} );

	it( 'is not offered without the AI form builder', async () => {
		await gallery( fakeApi(), null );
		expect( container.querySelector( '.ffxb-tcard--ai' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-tcard--blank' ) ).not.toBeNull();
	} );

	it( 'shows the Pro badge in Funnelforms Free', async () => {
		process.env.FUNNELFORMS_EDITION = 'free';
		const api = fakeApi();
		await gallery( api, null );
		const card = container.querySelector( '.ffxb-tcard--ai' ) as HTMLElement;
		expect( card.querySelector( '.ffxb-badge' )?.textContent ).toBe( 'Pro' );
		await act( async () => ( card.querySelector( 'button' ) as HTMLButtonElement ).click() );
		expect( container.querySelector( '.ffxb-pro' ) ).not.toBeNull();
		expect( container.querySelector( '.ffxb-ai__prompt' ) ).toBeNull();
		expect( api.aiCreate ).not.toHaveBeenCalled();
	} );
} );

describe( 'the AI bar', () => {
	async function editor( api: FormsApi, ai: AiConfig | null = READY ) {
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } ai={ ai } /> ) );
		await settle();
		return store;
	}
	const bar = (): HTMLTextAreaElement => container.querySelector( '.ffxb-aibar__input' ) as HTMLTextAreaElement;
	async function type( text: string ): Promise<void> {
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLTextAreaElement.prototype, 'value' )?.set?.call( bar(), text );
			bar().dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
	}

	it( 'changes the whole form from one instruction, as one step that can be undone', async () => {
		const aiEdit = vi.fn( async ( _id: number, _prompt: string, document: ReturnType<typeof blank> ) => ( { document: { ...document, title: 'Kürzer' }, summary: 'Den Titel gekürzt.' } ) );
		const store = await editor( fakeApi( { aiEdit } ) );
		const before = store.getState().doc;

		expect( bar().placeholder ).toContain( 'calculations, quizzes, texts or the design' );
		await act( async () => bar().focus() );
		const panel = container.querySelector( '.ffxb-aibar__panel' ) as HTMLElement;
		expect( [ ...panel.querySelectorAll( '.ffxb-aibar__topic strong' ) ].map( ( t ) => t.textContent ) ).toEqual( [ 'Questions and answers', 'Paths', 'Calculation', 'Quiz', 'Design', 'Texts' ] );
		expect( panel.querySelector( '.ffxb-ai__privacy' ) ).not.toBeNull();
		await act( async () => ( panel.querySelectorAll( '.ffxb-aibar__topic' )[ 4 ] as HTMLButtonElement ).click() );
		expect( bar().value ).toBe( 'Make the buttons blue and the corners rounder' );

		await type( 'Make the title shorter' );
		await act( async () => button( 'Change' ).click() );
		await settle();

		expect( aiEdit ).toHaveBeenCalledWith( 7, 'Make the title shorter', before );
		expect( store.getState().doc?.title ).toBe( 'Kürzer' );
		expect( bar().value ).toBe( '' );
		expect( container.querySelector( '.ffxb-aibar__panel' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-toast__text' )?.textContent ).toBe( 'Den Titel gekürzt.' );

		await act( async () => button( 'Undo', container.querySelector( '.ffxb-toast' ) as HTMLElement ).click() );
		expect( store.getState().doc?.title ).toBe( before?.title );
	} );

	it( 'keeps the form as it is when the AI fails', async () => {
		const aiEdit = vi.fn( async () => Promise.reject( new ApiError( 'ai_invalid', 'The AI made a form with errors.', 422 ) ) );
		const store = await editor( fakeApi( { aiEdit } ) );
		const before = store.getState().doc;
		await act( async () => bar().focus() );
		await type( 'Break it' );
		await act( async () => button( 'Change' ).click() );
		await settle();
		expect( container.querySelector( '.ffxb-aibar__panel .ffxb-notice--danger' )?.textContent ).toContain( 'The AI made a form with errors.' );
		expect( bar().value ).toBe( 'Break it' );
		expect( store.getState().doc ).toBe( before );
		expect( store.getState().canUndo ).toBe( false );
	} );

	it( 'opens from the selected step with the start of an instruction', async () => {
		const store = await editor( fakeApi( { aiEdit: vi.fn() } ) );
		const contact = store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type );
		await act( async () => store.getState().select( { node: contact?.id ?? '' } ) );
		await settle();
		await act( async () => button( 'Change with AI' ).click() );
		await settle();
		expect( bar().value ).toMatch( /^In the step ".+": $/ );
		expect( container.querySelector( '.ffxb-aibar__panel' ) ).not.toBeNull();
	} );

	it( 'asks to connect the license first', async () => {
		await editor( fakeApi( { aiEdit: vi.fn() } ), { ...READY, ready: false } );
		await act( async () => bar().focus() );
		await type( 'Make the title shorter' );
		expect( container.querySelector( '.ffxb-aibar__panel' )?.textContent ).toContain( 'Connect your license' );
		expect( button( 'Change' ).disabled ).toBe( true );
	} );

	it( 'is not there without the AI form builder', async () => {
		await editor( fakeApi( { aiEdit: vi.fn() } ), null );
		expect( container.querySelector( '.ffxb-aibar' ) ).toBeNull();
		expect( () => button( 'Change with AI' ) ).toThrow();
	} );
} );
