import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig, FormDetail, FormsApi, FormSummary } from '../src/api';
import { ApiError } from '../src/api';
import type { PredictionModel, StoredPrediction } from '../src/predict';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { blank } from './blank';

// The prediction mode of the canvas (Predictive AI): the last prediction on the canvas and in the inspector, playing its visitors; predictions are made in the tab only.
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

describe( 'the prediction mode', () => {
	it( 'makes no prediction on the canvas: without one it leads to the tab of the Predictive AI', async () => {
		const api = fakeApi();
		await editor( api );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		expect( api.lastPrediction ).toHaveBeenCalledWith( 7 );
		const bar = container.querySelector( '.ffxb-pai-hud' ) as HTMLElement;
		expect( bar.textContent ).toContain( 'before it goes live' );
		// No dialog and no button to predict on the canvas.
		expect( () => button( 'Predict' ) ).toThrow();
		expect( () => button( 'Predict again' ) ).toThrow();
		expect( document.querySelector( '.ffxb-dialog' ) ).toBeNull();

		await act( async () => button( 'Open Predictive AI', bar ).click() );
		await settle();
		expect( container.querySelector( '.ffxb-predict-tab' ) ).not.toBeNull();
		expect( container.querySelector( '.ffxb-views__item[data-view="predict"]' )?.getAttribute( 'aria-current' ) ).toBeTruthy();
		expect( api.predict ).not.toHaveBeenCalled();
	} );

	it( 'shows the last prediction on the canvas and in the inspector, and follows changes to the form', async () => {
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ) } );
		const store = await editor( api );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		const bar = container.querySelector( '.ffxb-pai-hud' ) as HTMLElement;
		expect( bar.querySelector( '.ffxb-prediction__rate' )?.textContent ).toMatch( /% sent \(.+ to .+\)/ );
		expect( bar.textContent ).toMatch( /Prediction of .+ · 1,?000 virtual visitors/ );
		// The canvas carries the figures of the virtual visitors, with the share that goes on and leaves.
		expect( container.querySelector( '.ffxb-node.has-analytics .ffxb-node__analytics' )?.textContent ).toMatch( /1,?000 reached · \d+ left/ );
		expect( container.querySelector( '.ffxb-node.has-analytics .ffxb-node__meter' ) ).not.toBeNull();
		expect( api.predict ).not.toHaveBeenCalled();

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

		// A new step before the contact step: not in the model, so the bar says to predict again.
		await act( async () => {
			store.getState().change( ( doc ) => {
				doc.nodes.unshift( { id: 'neu', type: 'step', fields: [] } );
				doc.edges.unshift( { id: 'e_neu', from: 'neu', to: 'contact', default: true } );
				doc.start = 'neu';
			} );
		} );
		await act( async () => new Promise( ( resolve ) => setTimeout( resolve, 500 ) ) );
		await settle();
		expect( container.querySelector( '.ffxb-pai-hud .ffxb-analytics__small' )?.textContent ).toContain( '1 steps are new since the prediction' );
	} );

	it( 'plays the virtual visitors on the canvas and keeps the steps in place meanwhile', async () => {
		// The frames do not run here: the playback stays at its start.
		const frame = vi.spyOn( window, 'requestAnimationFrame' ).mockImplementation( () => 1 );
		try {
			const store = await editor( fakeApi( { lastPrediction: vi.fn( async () => stored() ) } ) );
			expect( container.querySelector( '.ffxb-pai-hud' ) ).toBeNull();
			await act( async () => button( 'Prediction' ).click() );
			await settle();
			const bar = container.querySelector( '.ffxb-pai-hud' ) as HTMLElement;
			expect( bar.getAttribute( 'title' ) ).toBe( 'Each dot stands for about 10 virtual visitors.' );
			expect( container.querySelector( '.ffxb-analytics-legend' )?.textContent ).not.toContain( 'Leaves' );
			const flow = container.querySelector( '.react-flow' ) as HTMLElement;
			expect( container.querySelector( '.react-flow__node.draggable' ) ).not.toBeNull();

			await act( async () => button( 'Play visitors', bar ).click() );
			expect( frame ).toHaveBeenCalled();
			expect( container.querySelector( '.ffxb-pai-hud__progress' ) ).not.toBeNull();
			expect( bar.textContent ).toContain( 'The steps stay in place while the visitors run.' );
			expect( bar.textContent ).toMatch( /Leads: 0/ );
			expect( container.querySelector( '.ffxb-analytics-legend' )?.textContent ).toContain( 'Becomes a lead' );
			// Nothing can be moved or connected while the dots run.
			expect( flow.classList.contains( 'is-playing' ) ).toBe( true );
			expect( container.querySelector( '.react-flow__node.draggable' ) ).toBeNull();
			await act( async () => button( 'Stop', bar ).click() );
			expect( button( 'Play visitors', bar ) ).toBeTruthy();
			expect( flow.classList.contains( 'is-playing' ) ).toBe( false );
			expect( container.querySelector( '.react-flow__node.draggable' ) ).not.toBeNull();

			// A step added while the dots run ends the playback: its ways are no longer those of the form.
			await act( async () => button( 'Play visitors', bar ).click() );
			expect( flow.classList.contains( 'is-playing' ) ).toBe( true );
			await act( async () => {
				store.getState().change( ( doc ) => {
					doc.nodes.push( { id: 'neu', type: 'step', fields: [] } );
				} );
			} );
			expect( flow.classList.contains( 'is-playing' ) ).toBe( false );

			// Turning the mode off takes the bar away.
			await act( async () => button( 'Prediction' ).click() );
			expect( container.querySelector( '.ffxb-pai-hud' ) ).toBeNull();
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
			expect( container.querySelector( '.ffxb-pai-hud__play' ) ).toBeNull();
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

	it( 'says why the last prediction could not be loaded and leads to the tab', async () => {
		await editor( fakeApi( { lastPrediction: vi.fn( async () => Promise.reject( new ApiError( 'http_error', 'The server could not be reached.', 500 ) ) ) } ) );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		const bar = container.querySelector( '.ffxb-pai-hud' ) as HTMLElement;
		expect( bar.textContent ).toContain( 'The server could not be reached.' );
		expect( button( 'Open Predictive AI', bar ) ).toBeTruthy();
	} );

	it( 'asks to connect the license in the tab of the Predictive AI', async () => {
		await editor( fakeApi(), { ...READY, ready: false } );
		await act( async () => button( 'Prediction' ).click() );
		await settle();
		await act( async () => button( 'Open Predictive AI', container.querySelector( '.ffxb-pai-hud' ) as HTMLElement ).click() );
		await settle();
		expect( container.querySelector( '.ffxb-predict-tab' )?.textContent ).toContain( 'Connect your license' );
	} );

	it( 'plays the visitors at once from Show on the canvas in the tab', async () => {
		const frame = vi.spyOn( window, 'requestAnimationFrame' ).mockImplementation( () => 1 );
		try {
			const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ) } );
			const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
			await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } ai={ READY } view="predict" /> ) );
			await settle();
			await act( async () => button( 'Show on the canvas' ).click() );
			await settle();
			await act( async () => new Promise( ( resolve ) => setTimeout( resolve, 300 ) ) );
			expect( button( 'Prediction' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
			expect( container.querySelector( '.react-flow' )?.classList.contains( 'is-playing' ) ).toBe( true );
			expect( button( 'Stop', container.querySelector( '.ffxb-pai-hud' ) as HTMLElement ) ).toBeTruthy();
		} finally {
			frame.mockRestore();
		}
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
