import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig, FormDetail, FormsApi, FormSummary } from '../src/api';
import { ApiError } from '../src/api';
import type { PredictionModel, StoredPrediction } from '../src/predict';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { blank } from './blank';

// The prediction mode of the canvas (Predictive AI): asking for a prediction, its figures on the canvas and in the inspector.
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

const model: PredictionModel = {
	benchmark: '2026-10',
	personas: [
		{ id: 'p1', name: 'Eilige', share: 0.6, description: 'Wollen schnell einen Preis.' },
		{ id: 'p2', name: 'Vorsichtige', share: 0.4, description: 'Haben Sorge vor Anrufen.' },
	],
	steps: [ { node: 'contact', prior: 0.5, estimated: false, uncertainty: 0.05, continue: { p1: 0.6, p2: 0.3 }, reasons: [ 'Viele brechen ab, weil eine Telefonnummer verlangt wird.' ], fields: [] } ],
	insights: [ 'Der Kontaktschritt verliert die meisten Besucher.' ],
	suggestions: [ { id: 's1', kind: 'trust', node: 'contact', field: null, title: 'Vertrauen vor dem Absenden', reason: 'Ein Hinweis auf Datenschutz nimmt Sorgen.', instruction: 'Schreib über den Button: Kostenlos und unverbindlich', effect: [ { node: 'contact', delta: 0.08 } ] } ],
	summary: 'Ein kurzes Formular mit einer Hürde am Ende.',
};

const parameters = { industry: 'other', industry_label: '', lead_value: 50, currency: 'EUR', audience: 'b2c', ages: [], intent: 'compare', traffic: 'mixed', mobile_share: null, notes: '' } as const;

function stored( visitors = 1000 ): StoredPrediction {
	return { model, parameters: { ...parameters, ages: [] }, visitors, created: '2026-10-23T08:00:00+00:00' };
}

/** An API that answers every call; get() returns the blank form. */
function fakeApi( overrides: Record<string, unknown> = {} ): FormsApi {
	const detail = (): FormDetail => ( { ...summary, document: blank(), lockTtl: 150 } );
	const calls: Record<string, unknown> = {
		get: vi.fn( async () => detail() ),
		saveDraft: vi.fn( async () => ( { problems: [], missingRights: [], form: summary } ) ),
		connections: vi.fn( async () => [] ),
		revisions: vi.fn( async () => [] ),
		lastPrediction: vi.fn( async () => null ),
		predict: vi.fn( async ( _id: number, _doc: unknown, p: StoredPrediction[ 'parameters' ], visitors: number ) => ( { prediction: { ...stored( visitors ), parameters: p }, remainingToday: 9, remainingMonth: 59 } ) ),
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

async function editor( api: FormsApi, ai: AiConfig | null = READY ) {
	const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
	await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } ai={ ai } /> ) );
	await settle();
	return store;
}

async function choose( label: string, value: string ): Promise<void> {
	const field = [ ...document.querySelectorAll( '.ffxb-dialog .ffxb-field' ) ].find( ( f ) => f.querySelector( 'label' )?.textContent === label );
	const select = field?.querySelector( 'select' ) as HTMLSelectElement;
	await act( async () => {
		select.value = value;
		select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	} );
}

describe( 'the prediction mode', () => {
	it( 'asks for a prediction with the description of the visitors and shows it on the canvas', async () => {
		const api = fakeApi();
		const store = await editor( api );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		expect( api.lastPrediction ).toHaveBeenCalledWith( 7 );
		expect( container.querySelector( '.ffxb-prediction .ffxb-analytics__status' )?.textContent ).toContain( 'before it goes live' );

		await act( async () => button( 'Predict' ).click() );
		const dialog = document.querySelector( '.ffxb-dialog' ) as HTMLElement;
		expect( dialog.querySelector( '.ffxb-ai__privacy' )?.textContent ).toContain( 'No entries and no visitor data' );
		await choose( 'Industry', 'solar' );
		await choose( 'Where do they come from?', 'social_ads' );
		await choose( 'Virtual visitors', '1000' );
		await act( async () => button( 'Predict', dialog ).click() );
		await settle();

		expect( api.predict ).toHaveBeenCalledWith( 7, store.getState().doc, expect.objectContaining( { industry: 'solar', traffic: 'social_ads', audience: 'b2c' } ), 1000 );
		expect( document.querySelector( '.ffxb-dialog' ) ).toBeNull();
		// The canvas carries the figures of the virtual visitors; the panel the rate with its range.
		expect( container.querySelector( '.ffxb-node.has-analytics .ffxb-node__analytics' )?.textContent ).toMatch( /1000 reached · \d+ left/ );
		expect( container.querySelector( '.ffxb-prediction__rate' )?.textContent ).toMatch( /% sent \(.+ to .+\)/ );
		expect( container.querySelector( '.ffxb-prediction' )?.textContent ).toContain( '9 predictions left today, 59 this month.' );

		// Nothing selected: the whole form in the inspector, with the sticking point, the kinds of visitors and what would help.
		const overview = container.querySelector( '.ffxb-prediction-section' ) as HTMLElement;
		expect( overview.textContent ).toContain( 'Ein kurzes Formular mit einer Hürde am Ende.' );
		expect( overview.textContent ).toContain( 'Sticking points' );
		expect( overview.textContent ).toContain( 'Viele brechen ab, weil eine Telefonnummer verlangt wird.' );
		expect( [ ...overview.querySelectorAll( '.ffxb-prediction__personas td:first-child' ) ].map( ( td ) => td.textContent ) ).toEqual( [ 'Eilige', 'Vorsichtige' ] );
		expect( overview.textContent ).toContain( 'not a measurement' );
		await act( async () => button( 'Apply with AI', overview ).click() );
		await settle();
		expect( ( container.querySelector( '.ffxb-aibar__input' ) as HTMLTextAreaElement ).value ).toBe( 'Schreib über den Button: Kostenlos und unverbindlich' );

		// A selected step: its reach, why visitors leave.
		await act( async () => store.getState().select( { node: 'contact' } ) );
		await settle();
		expect( container.querySelector( '.ffxb-prediction-section' )?.textContent ).toMatch( /100\s?% of the visitors reach this step/ );
	} );

	it( 'opens with the last prediction and follows changes to the form', async () => {
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ) } );
		const store = await editor( api );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		expect( container.querySelector( '.ffxb-prediction__rate' ) ).not.toBeNull();
		expect( button( 'Predict again' ) ).toBeTruthy();
		expect( api.predict ).not.toHaveBeenCalled();

		// A new step before the contact step: not in the model, so the panel says to predict again.
		await act( async () => {
			store.getState().change( ( doc ) => {
				doc.nodes.unshift( { id: 'neu', type: 'step', fields: [] } );
				doc.edges.unshift( { id: 'e_neu', from: 'neu', to: 'contact', default: true } );
				doc.start = 'neu';
			} );
		} );
		await act( async () => new Promise( ( resolve ) => setTimeout( resolve, 500 ) ) );
		await settle();
		expect( container.querySelector( '.ffxb-prediction .ffxb-analytics__small' )?.textContent ).toContain( '1 steps are new since the prediction' );
	} );

	it( 'plays the virtual visitors on the canvas', async () => {
		// The frames do not run here: the playback stays at its start.
		const frame = vi.spyOn( window, 'requestAnimationFrame' ).mockImplementation( () => 1 );
		try {
			await editor( fakeApi( { lastPrediction: vi.fn( async () => stored() ) } ) );
			expect( container.querySelector( '.ffxb-pai-play' ) ).toBeNull();
			await act( async () => button( 'Prediction' ).click() );
			await settle();
			const control = container.querySelector( '.ffxb-pai-play' ) as HTMLElement;
			expect( control.textContent ).toMatch( /Prediction of .+ · 1,?000 virtual visitors/ );
			expect( control.getAttribute( 'title' ) ).toBe( 'Each dot stands for about 10 virtual visitors.' );
			expect( container.querySelector( '.ffxb-analytics-legend' )?.textContent ).not.toContain( 'Leaves' );

			await act( async () => button( 'Play visitors', control ).click() );
			expect( frame ).toHaveBeenCalled();
			expect( container.querySelector( '.ffxb-pai-play__progress' ) ).not.toBeNull();
			expect( container.querySelector( '.ffxb-analytics-legend' )?.textContent ).toContain( 'Becomes a lead' );
			await act( async () => button( 'Stop', control ).click() );
			expect( button( 'Play visitors', control ) ).toBeTruthy();
			expect( container.querySelector( '.ffxb-analytics-legend' )?.textContent ).not.toContain( 'Leaves' );

			// Turning the mode off takes the control away.
			await act( async () => button( 'Prediction' ).click() );
			expect( container.querySelector( '.ffxb-pai-play' ) ).toBeNull();
		} finally {
			frame.mockRestore();
		}
	} );

	it( 'plays nothing for those who asked for less motion', async () => {
		const media = vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query: string ) => ( { matches: query.includes( 'reduce' ), media: query, addEventListener: () => undefined, removeEventListener: () => undefined } ) as unknown as MediaQueryList );
		try {
			await editor( fakeApi( { lastPrediction: vi.fn( async () => stored() ) } ) );
			await act( async () => button( 'Prediction' ).click() );
			await settle();
			expect( container.querySelector( '.ffxb-prediction__rate' ) ).not.toBeNull();
			expect( container.querySelector( '.ffxb-pai-play' ) ).toBeNull();
		} finally {
			media.mockRestore();
		}
	} );

	it( 'is one mode at a time with the analytics', async () => {
		await editor( fakeApi() );
		await act( async () => button( 'Analytics' ).click() );
		expect( button( 'Analytics' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		expect( button( 'Prediction' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( button( 'Analytics' ).getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		await act( async () => button( 'Analytics' ).click() );
		expect( button( 'Prediction' ).getAttribute( 'aria-pressed' ) ).toBe( 'false' );
	} );

	it( 'shows why a prediction failed and keeps the dialog open', async () => {
		const api = fakeApi( { predict: vi.fn( async () => Promise.reject( new ApiError( 'ai_quota_month', 'Your license has used up its predictions for this month.', 429 ) ) ) } );
		await editor( api );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		await act( async () => button( 'Predict' ).click() );
		await act( async () => button( 'Predict', document.querySelector( '.ffxb-dialog' ) as HTMLElement ).click() );
		await settle();
		expect( document.querySelector( '.ffxb-dialog .ffxb-notice--danger' )?.textContent ).toContain( 'used up its predictions for this month' );
	} );

	it( 'asks to connect the license first', async () => {
		await editor( fakeApi(), { ...READY, ready: false } );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		await act( async () => button( 'Predict' ).click() );
		const dialog = document.querySelector( '.ffxb-dialog' ) as HTMLElement;
		expect( dialog.textContent ).toContain( 'Connect your license' );
		expect( button( 'Predict', dialog ).disabled ).toBe( true );
	} );

	it( 'is not there without the AI form builder or in Funnelforms Free', async () => {
		await editor( fakeApi(), null );
		expect( () => button( 'Prediction' ) ).toThrow();
		act( () => root.unmount() );
		root = createRoot( container );
		process.env.FUNNELFORMS_EDITION = 'free';
		await editor( fakeApi() );
		expect( () => button( 'Prediction' ) ).toThrow();
	} );
} );
