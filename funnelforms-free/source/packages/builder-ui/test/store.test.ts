import { describe, expect, it, vi } from 'vitest';
import type { FormDocument } from '@funnelforms/form-schema';
import { ApiError, type FormDetail, type FormsApi, type FormSummary } from '../src/api';
import { createBuilderStore, type Timers } from '../src/store';
import { blank } from './blank';

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

/** Timers driven by the test. */
function clock(): Timers & { tick( ms: number ): Promise<void> } {
	let now = 0;
	let next = 1;
	const timeouts = new Map<number, { at: number; fn: () => void }>();
	const intervals = new Map<number, { every: number; at: number; fn: () => void }>();
	return {
		now: () => now,
		setTimeout: ( fn, ms ) => {
			timeouts.set( next, { at: now + ms, fn } );
			return next++;
		},
		clearTimeout: ( id ) => void timeouts.delete( id as number ),
		setInterval: ( fn, ms ) => {
			intervals.set( next, { every: ms, at: now + ms, fn } );
			return next++;
		},
		clearInterval: ( id ) => void intervals.delete( id as number ),
		async tick( ms ) {
			now += ms;
			for ( const [ id, t ] of [ ...timeouts ] ) {
				if ( t.at <= now ) {
					timeouts.delete( id );
					t.fn();
				}
			}
			for ( const t of intervals.values() ) {
				while ( t.at <= now ) {
					t.at += t.every;
					t.fn();
				}
			}
			// Let the promises of the fake API settle.
			for ( let i = 0; i < 10; i++ ) {
				await Promise.resolve();
			}
		},
	};
}

function fakeApi( overrides: Partial<FormsApi> = {} ): FormsApi & { saved: FormDocument[] } {
	const saved: FormDocument[] = [];
	const detail = (): FormDetail => ( { ...summary, document: blank(), lockTtl: 150 } );
	const api = {
		saved,
		list: vi.fn(),
		get: vi.fn( async () => detail() ),
		create: vi.fn(),
		update: vi.fn(),
		remove: vi.fn(),
		saveDraft: vi.fn( async ( _id: number, doc: FormDocument ) => {
			saved.push( structuredClone( doc ) );
			return { problems: [ 'x' ], missingRights: [], form: summary };
		} ),
		dropDraft: vi.fn(),
		publish: vi.fn( async () => ( { revision: 3, renderer: 'v5' as const, warnings: [], form: { ...summary, status: 'published' as const, hasDraft: false, currentRevision: 3 } } ) ),
		revisions: vi.fn(),
		revision: vi.fn(),
		restore: vi.fn(),
		duplicate: vi.fn(),
		lock: vi.fn( async () => undefined ),
		unlock: vi.fn( async () => undefined ),
		exportForm: vi.fn(),
		importFile: vi.fn(),
		preview: vi.fn(),
		templates: vi.fn(),
		templatePreview: vi.fn(),
		fromTemplate: vi.fn(),
		...overrides,
	};
	return api as unknown as FormsApi & { saved: FormDocument[] };
}

describe( 'builder store', () => {
	it( 'loads, takes the lock and saves the draft once typing stops', async () => {
		const api = fakeApi();
		const timers = clock();
		const store = createBuilderStore( api, 7, { timers, autosaveMs: 1000 } );
		await store.getState().load();
		expect( store.getState().status ).toBe( 'ready' );
		expect( api.lock ).toHaveBeenCalledWith( 7 );

		for ( const title of [ 'A', 'An', 'Ang' ] ) {
			store.getState().change( ( d ) => void ( d.title = title ), 'title' );
			await timers.tick( 300 );
		}
		expect( store.getState().save.state ).toBe( 'dirty' );
		expect( api.saved ).toHaveLength( 0 );
		await timers.tick( 1000 );
		expect( api.saved.map( ( d ) => d.title ) ).toEqual( [ 'Ang' ] );
		expect( store.getState().save.state ).toBe( 'saved' );
		expect( store.getState().problems ).toEqual( [ 'x' ] );

		// The lock is renewed while the builder is open (a third of lockTtl).
		await timers.tick( 50000 );
		expect( api.lock ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'undoes a run of typing in one step and redoes it', async () => {
		const timers = clock();
		const store = createBuilderStore( fakeApi(), 7, { timers } );
		await store.getState().load();
		store.getState().change( ( d ) => void ( d.title = 'A' ), 'title' );
		await timers.tick( 200 );
		store.getState().change( ( d ) => void ( d.title = 'AB' ), 'title' );
		store.getState().change( ( d ) => void ( d.settings.rtl = true ) );
		expect( store.getState().canUndo ).toBe( true );

		store.getState().undo();
		expect( store.getState().doc?.settings.rtl ).toBe( false );
		expect( store.getState().doc?.title ).toBe( 'AB' );
		store.getState().undo();
		expect( store.getState().doc?.title ).toBe( 'Anfrage' );
		expect( store.getState().canUndo ).toBe( false );
		store.getState().redo();
		store.getState().redo();
		expect( store.getState().doc?.title ).toBe( 'AB' );
		expect( store.getState().doc?.settings.rtl ).toBe( true );
		expect( store.getState().canRedo ).toBe( false );
	} );

	it( 'stops editing when someone else holds the lock and can take it over', async () => {
		const lockedBy = { id: 2, name: 'Mia' };
		let held = true;
		const api = fakeApi( {
			lock: vi.fn( async ( _id: number, force?: boolean ) => {
				if ( held && ! force ) {
					throw new ApiError( 'locked', 'Someone else is editing this form.', 409, { lockedBy } );
				}
				held = false;
			} ),
		} );
		const store = createBuilderStore( api, 7, { timers: clock() } );
		await store.getState().load();
		expect( store.getState().save ).toMatchObject( { state: 'locked', lockedBy } );
		store.getState().change( ( d ) => void ( d.title = 'Mine' ) );
		expect( store.getState().doc?.title ).toBe( 'Anfrage' );

		await store.getState().takeOver();
		expect( store.getState().save.state ).toBe( 'saved' );
		store.getState().change( ( d ) => void ( d.title = 'Mine' ) );
		expect( store.getState().doc?.title ).toBe( 'Mine' );
	} );

	it( 'saves before publishing and reports refusals', async () => {
		const api = fakeApi();
		const store = createBuilderStore( api, 7, { timers: clock() } );
		await store.getState().load();
		store.getState().change( ( d ) => void ( d.title = 'Live' ) );
		expect( await store.getState().publish( 'first' ) ).toBe( true );
		expect( api.saved.map( ( d ) => d.title ) ).toEqual( [ 'Live' ] );
		expect( api.publish ).toHaveBeenCalledWith( 7, 'first' );
		expect( store.getState().form?.status ).toBe( 'published' );
		expect( store.getState().publishing.state ).toBe( 'published' );

		api.publish = vi.fn( async () => {
			throw new ApiError( 'missing_rights', 'You may not publish these changes.', 403, { missingRights: [ 'funnelforms_view_entries' ] } );
		} );
		expect( await store.getState().publish() ).toBe( false );
		expect( store.getState().missingRights ).toEqual( [ 'funnelforms_view_entries' ] );
		expect( store.getState().publishing ).toMatchObject( { state: 'failed', code: 'missing_rights' } );
	} );

	it( 'keeps changes and tries again when saving fails', async () => {
		let fail = true;
		const timers = clock();
		const api = fakeApi();
		const save = api.saveDraft;
		api.saveDraft = vi.fn( async ( id: number, doc: FormDocument ) => {
			if ( fail ) {
				throw new ApiError( 'offline', 'The server could not be reached.', 0 );
			}
			return save( id, doc );
		} );
		const store = createBuilderStore( api, 7, { timers, autosaveMs: 1000 } );
		await store.getState().load();
		store.getState().change( ( d ) => void ( d.title = 'Offline' ) );
		await timers.tick( 1000 );
		expect( store.getState().save.state ).toBe( 'offline' );
		fail = false;
		await timers.tick( 1000 );
		expect( store.getState().save.state ).toBe( 'saved' );
		expect( api.saved.map( ( d ) => d.title ) ).toEqual( [ 'Offline' ] );
	} );
} );
