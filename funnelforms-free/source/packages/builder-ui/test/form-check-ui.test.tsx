import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { produce } from 'immer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDocument } from '@funnelforms/form-schema';
import type { FormDetail, FormsApi } from '../src/api';
import { addStep, connect, setRandom } from '../src/document';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { blank } from './blank';

/** The check in the editor: its count, the list with "Show" and the fix, the marks on the canvas, publishing blocked. */
( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const ctx = { locale: 'de_DE', labels: { question: 'Neue Frage', option: 'Option %d' } };

/** A choice step whose path asks for an answer that was deleted. */
function broken(): FormDocument {
	let n = 0;
	setRandom( () => ( ( n++ * 9301 + 49297 ) % 233280 ) / 233280 );
	return produce( blank(), ( d ) => {
		const step = addStep( d, 'choice', ctx, { before: 'contact' } );
		connect( d, step, 'contact', { field: 'q_none', op: 'selected', value: 'o_gone' } );
		const node = d.nodes.find( ( x ) => x.id === step );
		const field = node && 'step' === node.type ? node.fields[ 0 ] : undefined;
		const edge = d.edges.find( ( e ) => e.when );
		if ( field && edge?.when && 'field' in edge.when ) {
			edge.when.field = field.id;
		}
	} );
}

function formsApi( doc: FormDocument ): FormsApi {
	const detail = (): FormDetail => ( { id: 7, uid: 'uid', title: 'Anfrage', category: '', status: 'draft', renderer: 'v5', legacyId: null, currentRevision: null, hasDraft: true, draftUpdatedAt: null, draftAuthor: null, lockedBy: null, entries: 0, shortcode: '', createdAt: null, updatedAt: null, document: structuredClone( doc ), lockTtl: 150 } );
	const known: Partial<FormsApi> = {
		get: vi.fn( async () => detail() ),
		lock: vi.fn( async () => undefined ),
		unlock: vi.fn( async () => undefined ),
		saveDraft: vi.fn( async () => ( { problems: [], missingRights: [], form: detail() } ) ),
	};
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

async function click( el: Element | null | undefined ): Promise<void> {
	if ( ! el ) {
		throw new Error( 'Nothing to click' );
	}
	await act( async () => ( el as HTMLElement ).click() );
	await settle();
}

describe( 'the check of the form', () => {
	it( 'counts the problem, shows its place and fixes it in one undoable step', async () => {
		const doc = broken();
		const api = formsApi( doc );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		const edge = doc.edges.find( ( e ) => e.when )?.id;

		// Known at once, before any save, and counted on "Publish".
		const check = container.querySelector( '.ffxb-check__button' );
		expect( check?.className ).toContain( 'is-error' );
		expect( container.querySelector( '[data-tour="publish"] .ffxb-count' )?.textContent ).toBe( '1' );
		// The overview names it too.
		expect( container.querySelector( '.ffxb-inspector .ffxb-issue__title' )?.textContent ).toBe( 'A rule asks for an answer that no longer exists' );

		await click( check );
		const panel = container.querySelector( '.ffxb-check__panel' );
		expect( panel?.querySelector( '.ffxb-issue__place' )?.textContent ).toMatch( /^Path from Step/ );

		await click( panel?.querySelector( '.ffxb-issue__show' ) );
		expect( container.querySelector( '.ffxb-check__panel' ) ).toBeNull();
		expect( store.getState().selection ).toEqual( { edge } );
		// The path's own properties say what is wrong and offer the fix.
		const fix = container.querySelector<HTMLButtonElement>( '.ffxb-inspector .ffxb-issue__fix' );
		expect( fix?.textContent ).toBe( 'Remove the rule' );

		await click( fix );
		expect( store.getState().doc?.edges.some( ( e ) => e.id === edge ) ).toBe( false );
		expect( store.getState().notice?.text ).toBe( 'Fixed: A rule asks for an answer that no longer exists' );
		expect( container.querySelector( '.ffxb-check__button' )?.className ).not.toContain( 'is-error' );

		act( () => store.getState().undo() );
		await settle();
		expect( store.getState().doc?.edges.some( ( e ) => e.id === edge ) ).toBe( true );
	} );

	it( 'keeps publishing closed while a problem is there and leads to it from the dialog', async () => {
		const api = formsApi( broken() );
		const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
		await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } /> ) );
		await settle();
		await click( container.querySelector( '[data-tour="publish"]' ) );
		const now = [ ...document.querySelectorAll<HTMLButtonElement>( 'button' ) ].find( ( b ) => 'Publish now' === b.textContent );
		expect( now?.disabled ).toBe( true );
		expect( document.querySelector( '.ffxb-publish-issues .ffxb-issue__title' )?.textContent ).toBe( 'A rule asks for an answer that no longer exists' );
		await click( document.querySelector( '.ffxb-publish-issues .ffxb-issue__show' ) );
		expect( document.querySelector( '.ffxb-publish-issues' ) ).toBeNull();
		expect( store.getState().selection.edge ).toBeDefined();
	} );
} );
