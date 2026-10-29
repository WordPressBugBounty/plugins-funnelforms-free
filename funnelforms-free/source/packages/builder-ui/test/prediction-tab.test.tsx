import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDocument, FormNode } from '@funnelforms/form-schema';
import type { AiConfig, FormDetail, FormsApi, FormSummary } from '../src/api';
import { predict, type AppliedSuggestion, type EarlierPrediction, type MeasuredFigures, type PredictionFigures, type PredictionModel, type StoredPrediction } from '../src/predict';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { STAGE } from '../src/ui/PredictionStage';
import { blank } from './blank';

// The tab of the Predictive AI in the editor, with a short and a long form (20 questions).
( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const summary: FormSummary = {
	id: 7,
	uid: 'uid',
	title: 'Immobilienbewertung Premium',
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
const LONG = 20;

/** A form of 20 questions, one after the other, then the contact step. */
function long() {
	const doc = blank();
	const steps = Array.from( { length: LONG }, ( _, i ) => ( {
		id: `q${ i + 1 }`,
		type: 'step',
		title: { de_DE: `Frage ${ i + 1 }` },
		fields: [
			{
				id: `f${ i + 1 }`,
				type: 'choice',
				key: `answer_${ i + 1 }`,
				label: { de_DE: `Frage ${ i + 1 }` },
				required: true,
				options: [
					{ id: `o${ i + 1 }a`, label: { de_DE: 'Ja' }, value: 'Ja' },
					{ id: `o${ i + 1 }b`, label: { de_DE: 'Nein' }, value: 'Nein' },
				],
				props: { multiple: false, layout: { desktop: 'grid', mobile: 'list' }, hideIcons: false },
			},
		],
	} ) ) as unknown as FormNode[];
	doc.nodes.unshift( ...steps );
	doc.start = 'q1';
	doc.edges.unshift( ...steps.map( ( s, i ) => ( { id: `e${ i + 1 }`, from: s.id, to: i + 1 < LONG ? `q${ i + 2 }` : 'contact', default: true } ) ) );
	return doc;
}

/** Most keep going; the questions in the middle tire the visitors, the contact step loses the most. */
function longModel(): PredictionModel {
	const rate = ( i: number ): number => ( i >= 8 && i <= 12 ? 0.9 : 0.97 );
	return {
		benchmark: '2026-10',
		personas: [
			{ id: 'p1', name: 'Eilige', share: 0.6, description: 'Wollen schnell einen Wert.' },
			{ id: 'p2', name: 'Gründliche', share: 0.4, description: 'Lesen jede Frage.' },
		],
		steps: [
			...Array.from( { length: LONG }, ( _, i ) => ( {
				node: `q${ i + 1 }`,
				prior: rate( i ),
				estimated: false,
				uncertainty: 0.03,
				continue: { p1: rate( i ) - 0.02, p2: rate( i ) + 0.02 },
				reasons: i >= 8 && i <= 12 ? [ 'Nach acht Fragen werden viele müde.' ] : [],
				fields: [],
			} ) ),
			{ node: 'contact', prior: 0.55, estimated: false, uncertainty: 0.05, continue: { p1: 0.5, p2: 0.6 }, reasons: [ 'Die Telefonnummer schreckt ab.' ], fields: [] },
		],
		insights: [ 'Die Fragen 9 bis 13 verlieren zusammen die meisten Besucher.' ],
		suggestions: [
			{ id: 's1', kind: 'split_step', node: 'q10', field: null, title: 'Zwischenstand vor Frage 10', reason: 'Ein Fortschritt nimmt die Müdigkeit.', instruction: 'Zeig vor Frage 10, wie weit die Bewertung ist.', effect: [ { node: 'q10', delta: 0.05 } ] },
			{ id: 's2', kind: 'remove_field', node: 'q12', field: null, title: 'Frage 12 weglassen', reason: 'Sie ändert den Wert kaum.', instruction: 'Entferne Frage 12.', effect: [ { node: 'q12', delta: 0.07 } ] },
			{ id: 's3', kind: 'trust', node: 'contact', field: null, title: 'Vertrauen vor dem Absenden', reason: 'Ein Hinweis auf Datenschutz nimmt Sorgen.', instruction: 'Schreib über den Button: Kostenlos und unverbindlich', effect: [ { node: 'contact', delta: 0.08 } ] },
		],
		summary: 'Ein langes Formular mit einer müden Mitte.',
	};
}

const parameters = { industry: 'property_valuation', industry_label: '', lead_value: 80, currency: 'EUR', audience: 'b2c', ages: [], intent: 'compare', traffic: 'mixed', mobile_share: null, notes: '' } as const;

function stored( visitors = 10000 ): StoredPrediction {
	return { model: longModel(), parameters: { ...parameters, ages: [] }, visitors, created: '2026-10-24T08:00:00+00:00' };
}

function fakeApi( overrides: Record<string, unknown> = {} ): FormsApi {
	const detail = (): FormDetail => ( { ...summary, document: long(), lockTtl: 150 } );
	const calls: Record<string, unknown> = {
		get: vi.fn( async () => detail() ),
		saveDraft: vi.fn( async () => ( { problems: [], missingRights: [], form: summary } ) ),
		connections: vi.fn( async () => [] ),
		revisions: vi.fn( async () => [] ),
		lastPrediction: vi.fn( async () => null ),
		predictionQuota: vi.fn( async () => ( { included: true, limit: 20, used: 6, remaining: 14, resets: '2026-11-01' } ) ),
		predict: vi.fn( async ( _id: number, _doc: unknown, p: StoredPrediction[ 'parameters' ], visitors: number ) => ( { prediction: { ...stored( visitors ), parameters: p }, remainingToday: 9, remainingMonth: 13 } ) ),
		...overrides,
	};
	return new Proxy( calls, { get: ( target, key: string ) => target[ key ] ?? ( target[ key ] = vi.fn( async () => undefined ) ) } ) as unknown as FormsApi;
}

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	vi.useFakeTimers();
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
} );

afterEach( () => {
	act( () => root.unmount() );
	container.remove();
	vi.useRealTimers();
	delete process.env.FUNNELFORMS_EDITION;
} );

async function flush( ms = 0 ): Promise<void> {
	await act( async () => {
		await vi.advanceTimersByTimeAsync( ms );
	} );
}

function button( label: string, scope: ParentNode = container ): HTMLButtonElement {
	const found = [ ...scope.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.trim() === label || b.getAttribute( 'aria-label' ) === label || b.querySelector( 'strong' )?.textContent === label );
	if ( ! found ) {
		throw new Error( 'No button ' + label );
	}
	return found;
}

function tab(): HTMLButtonElement {
	return container.querySelector( '.ffxb-views__item[data-view="predict"]' ) as HTMLButtonElement;
}

async function editor( api: FormsApi, props: { ai?: AiConfig | null; view?: 'build' | 'predict'; figures?: boolean } = {} ) {
	const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
	await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } ai={ undefined === props.ai ? READY : props.ai } view={ props.view } figures={ props.figures } /> ) );
	await flush();
	return store;
}

describe( 'the tab of the Predictive AI', () => {
	it( 'sits between Settings and Embed, and is not there without the AI form builder', async () => {
		await editor( fakeApi() );
		expect( [ ...container.querySelectorAll( '.ffxb-views__item' ) ].map( ( b ) => b.textContent ) ).toEqual( [ 'Structure', 'Design', 'Settings', 'Predictive AI', 'Embed' ] );
		act( () => root.unmount() );

		root = createRoot( container );
		await editor( fakeApi(), { ai: null, view: 'predict' } );
		expect( tab() ).toBeNull();
		// The address asked for the tab: the canvas instead.
		expect( container.querySelector( '.ffxb-views__item.is-active' )?.textContent ).toBe( 'Structure' );
		expect( container.querySelector( '.ffxb-pai' ) ).toBeNull();
	} );

	it( 'simulates a form of 20 questions: audience, the stage with the visitors, the score and the suggestions', async () => {
		let answer: ( run: { prediction: StoredPrediction; remainingToday: number; remainingMonth: number } ) => void = () => undefined;
		const api = fakeApi( { predict: vi.fn( () => new Promise( ( resolve ) => ( answer = resolve ) ) ) } );
		const store = await editor( api );
		expect( api.lastPrediction ).not.toHaveBeenCalled();

		await act( async () => tab().click() );
		await flush();
		expect( tab().className ).toContain( 'is-active' );
		expect( api.lastPrediction ).toHaveBeenCalledWith( 7 );
		const page = container.querySelector( '.ffxb-predict-tab' ) as HTMLElement;
		expect( page.textContent ).toContain( 'Test your form with 10,000 virtual visitors before real ones come.' );
		expect( page.querySelector( '.ffxb-pai-quota' )?.textContent ).toContain( '14 of 20 behaviour analyses left this month' );
		expect( page.querySelector( '.ffxb-pai-step.is-active' )?.textContent ).toContain( 'Audience' );
		// All 21 steps in the order of the form, in a list that scrolls.
		const ready = [ ...page.querySelectorAll( '.ffxb-pai-ready__steps.is-long li' ) ].map( ( li ) => li.textContent );
		expect( ready ).toHaveLength( LONG + 1 );
		expect( ready[ 0 ] ).toBe( '1Frage 1Choice, required' );
		expect( ready[ LONG ] ).toBe( '21Deine KontaktdatenName, E-mail address' );

		// The audience goes along with the run.
		await act( async () => button( 'Ready to buy', page ).click() );
		await act( async () => button( 'Start the simulation', page ).click() );
		expect( api.predict ).toHaveBeenCalledWith( 7, store.getState().doc, expect.objectContaining( { industry: 'other', intent: 'ready' } ), 10000 );
		expect( tab().querySelector( '.ffxb-views__busy' ) ).not.toBeNull();
		const stage = (): HTMLElement => container.querySelector( '.ffxb-pai-sim' ) as HTMLElement;
		expect( stage() ).not.toBeNull();
		// The columns of a long form are numbered.
		expect( [ ...stage().querySelectorAll( '.ffxb-pai-col__name' ) ].map( ( n ) => n.textContent ) ).toEqual( Array.from( { length: LONG + 1 }, ( _, i ) => String( i + 1 ) ) );

		// Without the answer of the AI the stage waits before the visitors.
		await flush( 9000 );
		expect( stage().querySelector( '.ffxb-pai-sim__pct' )?.textContent ).toBe( '27\u00a0%' );
		expect( button( 'Skip to the result', stage() ).disabled ).toBe( true );

		await act( async () => answer( { prediction: stored(), remainingToday: 9, remainingMonth: 13 } ) );
		// The figures are worked out at once; the clock goes on from there.
		await flush();
		await flush();
		await flush( 1000 );
		const active = (): string | undefined => stage().querySelector( '.ffxb-pai-phase.is-active' )?.textContent ?? undefined;
		expect( active() ).toContain( 'Simulate visitors' );
		expect( button( 'Skip to the result', stage() ).disabled ).toBe( false );
		// The visitors take at least eight seconds, the whole run less than a minute.
		expect( STAGE[ 3 ] - STAGE[ 2 ] ).toBeGreaterThanOrEqual( 8 );
		expect( STAGE[ 4 ] ).toBeLessThanOrEqual( 60 );
		await flush( 7500 );
		expect( active() ).toContain( 'Simulate visitors' );
		expect( stage().querySelectorAll( '.ffxb-pai-dot' ).length ).toBeGreaterThan( 0 );
		await flush( 3500 );
		expect( active() ).toContain( 'Work out the suggestions' );
		expect( stage().querySelector( '.ffxb-pai-rating' ) ).not.toBeNull();
		await flush( 2000 );

		const result = container.querySelector( '.ffxb-pai-result' ) as HTMLElement;
		expect( container.querySelector( '.ffxb-pai-sim' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-pai-step.is-active' )?.textContent ).toContain( 'Result' );
		// The score is a number of 100, and below 100 with three suggestions.
		const score = Number( result.querySelector( '.ffxb-pai-hero .ffxb-pai-ring__score' )?.textContent );
		expect( score ).toBeGreaterThan( 0 );
		expect( score ).toBeLessThan( 100 );
		expect( result.querySelector( '.ffxb-pai-hero__sub' )?.textContent ).toContain( 'With the 3 suggestions' );

		// A long form shows the steps that cost leads first.
		const rows = (): string[] => [ ...result.querySelectorAll( '.ffxb-pai-row .ffxb-pai-row__name > span' ) ].map( ( n ) => n.textContent ?? '' );
		expect( rows().length ).toBeLessThan( LONG + 1 );
		expect( rows() ).toContain( 'Deine Kontaktdaten' );
		expect( rows() ).toContain( 'Frage 9' );
		expect( rows() ).not.toContain( 'Frage 2' );
		expect( result.querySelector( '.ffxb-pai-rows__more' )?.textContent ).toContain( `${ LONG + 1 - rows().length } inconspicuous steps hidden` );
		await act( async () => ( result.querySelector( '.ffxb-pai-rows__more' ) as HTMLButtonElement ).click() );
		expect( rows() ).toHaveLength( LONG + 1 );
		expect( rows()[ 1 ] ).toBe( 'Frage 2' );
		await act( async () => button( 'Only show notable steps', result ).click() );
		expect( rows().length ).toBeLessThan( LONG + 1 );

		// The suggestions by their effect, with a look at the change.
		const recs = [ ...result.querySelectorAll( '.ffxb-pai-rec' ) ] as HTMLElement[];
		expect( recs ).toHaveLength( 3 );
		expect( result.textContent ).toContain( 'Frage 12 weglassen' );
		const twelve = recs.find( ( r ) => r.textContent?.includes( 'Frage 12 weglassen' ) ) as HTMLElement;
		expect( twelve.querySelector( '.ffxb-pai-rec__impact strong' )?.textContent ).toMatch( /^\+\d+(\.\d)? points$/ );
		await act( async () => button( 'See the change', twelve ).click() );
		expect( twelve.querySelector( '.ffxb-pai-peek' )?.textContent ).toContain( 'Entferne Frage 12.' );
		// The tab tells how many suggestions are open.
		expect( tab().querySelector( '.ffxb-views__badge' )?.textContent ).toBe( '3' );

		// "On the canvas" opens the canvas with the prediction on and the step selected.
		await act( async () => button( 'On the canvas', twelve ).click() );
		await flush( 500 );
		expect( container.querySelector( '.ffxb-views__item.is-active' )?.textContent ).toBe( 'Structure' );
		expect( container.querySelector( '.ffxb-node[data-node="q12"]' )?.className ).toContain( 'is-selected' );
		expect( container.querySelectorAll( '.ffxb-node.has-analytics' ).length ).toBeGreaterThanOrEqual( LONG + 1 );
		expect( container.querySelector( '.ffxb-node[data-node="q20"] .ffxb-node__analytics' )?.textContent ).toMatch( /\d+ reached · \d+ left/ );
	} );

	it( 'shows the last prediction when the tab opens, plays it again, and the figures follow the form', async () => {
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ) } );
		const store = await editor( api, { view: 'predict' } );
		await flush();
		const result = (): HTMLElement => container.querySelector( '.ffxb-predict-tab .ffxb-pai-result' ) as HTMLElement;
		expect( result() ).not.toBeNull();
		expect( button( 'Simulate again' ) ).not.toBeNull();
		await act( async () => ( result().querySelector( '.ffxb-pai-rows__more' ) as HTMLButtonElement ).click() );
		expect( result().querySelectorAll( '.ffxb-pai-row' ) ).toHaveLength( LONG + 1 );

		// One question less: the funnel follows without a new analysis.
		await act( async () =>
			store.getState().change( ( d ) => {
				d.nodes = d.nodes.filter( ( n ) => 'q12' !== n.id );
				d.edges = d.edges.filter( ( e ) => 'q12' !== e.from ).map( ( e ) => ( 'q12' === e.to ? { ...e, to: 'q13' } : e ) );
			} )
		);
		await flush( 500 );
		expect( result().querySelectorAll( '.ffxb-pai-row' ) ).toHaveLength( LONG );
		expect( api.predict ).not.toHaveBeenCalled();

		// Watching again starts with the visitors and uses no analysis.
		await act( async () => button( 'Watch the simulation' ).click() );
		const stage = container.querySelector( '.ffxb-pai-sim' ) as HTMLElement;
		expect( stage.querySelector( '.ffxb-pai-phase.is-active' )?.textContent ).toContain( 'Simulate visitors' );
		await act( async () => button( 'Skip to the result', stage ).click() );
		expect( result() ).not.toBeNull();
		expect( api.predict ).not.toHaveBeenCalled();

		// Change the audience goes back to the first step with the audience of the prediction.
		await act( async () => button( 'Change the audience' ).click() );
		expect( button( 'Comparing offers' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( button( 'Start the simulation' ).disabled ).toBe( false );
	} );
} );

/** Real figures as the plugin measures them. */
function measured( views: number, rate: number ): MeasuredFigures {
	return { views, completions: Math.round( views * rate ), rate, enough: views >= 300, days: 30 };
}

/** A prediction a week before the current one: Frage 12 applied and published, the rest left open. */
function earlierOne(): EarlierPrediction {
	return {
		created: '2026-10-17T08:00:00+00:00',
		visitors: 10000,
		industry: 'property_valuation',
		applied: [ { suggestion: 's2', summary: 'Frage 12 entfernt.', at: '2026-10-18T09:00:00+00:00' } ],
		figures: { conversion: 0.21, original: 0.18, low: 0.15, high: 0.27, best: 0.29, score: 62, suggestions: { s1: 0.03, s2: 0.03, s3: 0.05 }, applied: [ 's2' ], at: '2026-10-18T09:00:00+00:00' },
		suggestions: longModel().suggestions.map( ( { id, kind, node, title } ) => ( { id, kind, node, title } ) ),
		real: { before: measured( 1200, 0.17 ), after: measured( 900, 0.2 ), published: '2026-10-18T10:00:00+00:00' },
	};
}

describe( 'what came of the predictions', () => {
	it( 'keeps the figures once per prediction and set of applied suggestions, not on every change', async () => {
		const saveFigures = vi.fn( async () => stored() );
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ), saveFigures } );
		const store = await editor( api, { view: 'predict' } );
		await flush( 500 );
		expect( saveFigures ).toHaveBeenCalledTimes( 1 );
		const [ id, figures ] = saveFigures.mock.calls[ 0 ] as unknown as [ number, PredictionFigures ];
		expect( id ).toBe( 7 );
		expect( figures.applied ).toEqual( [] );
		expect( Object.keys( figures.suggestions ).sort() ).toEqual( [ 's1', 's2', 's3' ] );
		expect( figures.original ).toBe( figures.conversion );
		expect( figures.low ).toBeLessThanOrEqual( figures.conversion );
		expect( figures.best ).toBeGreaterThan( figures.conversion );
		expect( figures.score ).toBe( Number( container.querySelector( '.ffxb-pai-hero .ffxb-pai-ring__score' )?.textContent ) );

		// A change of the form moves the figures, but they are kept with the prediction only once.
		await act( async () => store.getState().change( ( d ) => void ( d.title = 'Anders' ) ) );
		await flush( 500 );
		expect( saveFigures ).toHaveBeenCalledTimes( 1 );
		act( () => root.unmount() );

		// Kept before with the same suggestions applied: not again.
		root = createRoot( container );
		const again = vi.fn( async () => stored() );
		await editor( fakeApi( { lastPrediction: vi.fn( async () => ( { ...stored(), figures } ) ), saveFigures: again } ), { view: 'predict' } );
		await flush( 500 );
		expect( again ).not.toHaveBeenCalled();
	} );

	it( 'lists the earlier predictions with the real figures after them and opens one', async () => {
		const predictionHistory = vi.fn( async () => ( { real: { before: measured( 900, 0.2 ), after: null, published: null }, history: [ earlierOne() ] } ) );
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ), predictionHistory } );
		await editor( api, { view: 'predict' } );
		await flush( 500 );
		expect( predictionHistory ).toHaveBeenCalledWith( 7 );
		const card = container.querySelector( '.ffxb-pai-history-card' ) as HTMLElement;
		const items = [ ...card.querySelectorAll( '.ffxb-pai-hist' ) ];
		expect( items ).toHaveLength( 2 );
		expect( items[ 0 ]?.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( items[ 0 ]?.querySelector( '.ffxb-pai-hist__tag' )?.textContent ).toBe( 'current' );
		const earlier = items[ 1 ] as HTMLButtonElement;
		expect( earlier.querySelector( '.ffxb-pai-hist__ring' )?.textContent ).toBe( '62' );
		expect( earlier.querySelector( '.ffxb-pai-hist__text span' )?.textContent?.replace( /\s/g, ' ' ) ).toBe( '18.0 % · 1 of 3 applied' );
		const tag = earlier.querySelector( '.ffxb-pai-hist__tag' ) as HTMLElement;
		expect( tag.textContent ).toBe( 'real +3.0 points' );
		expect( tag.className ).toContain( 'is-good' );

		await act( async () => earlier.click() );
		const view = container.querySelector( '.ffxb-pai-earlier' ) as HTMLElement;
		expect( container.querySelector( '.ffxb-pai-result' ) ).toBeNull();
		// Dates and counts in the language of the form (de_DE).
		expect( view.querySelector( 'h2' )?.textContent ).toMatch( /^Prediction of 17\.10\.2026, \d\d:\d\d$/ );
		const figures = [ ...view.querySelectorAll( '.ffxb-pai-earlier__figures > div' ) ].map( ( d ) => d.textContent?.replace( /\s/g, ' ' ) );
		expect( figures[ 0 ] ).toBe( 'Predicted then18.0 %21.0 % with the suggestions applied' );
		expect( figures[ 1 ] ).toBe( 'Real before, 30 days17.0 %1.200 views in 30 days' );
		expect( figures[ 2 ] ).toBe( 'Real after publishing20.0 %900 views in 30 days' );
		const rows = [ ...view.querySelectorAll( 'tbody tr' ) ].map( ( r ) => [ ...r.querySelectorAll( 'td' ) ].map( ( td ) => td.textContent ) );
		expect( rows[ 0 ] ).toEqual( [ 'Vertrauen vor dem Absenden', expect.any( String ), '+5.0 points', 'open' ] );
		expect( rows.find( ( r ) => 'Frage 12 weglassen' === r[ 0 ] )?.[ 3 ] ).toBe( 'applied on 18.10.2026' );

		await act( async () => button( 'Back to the current prediction' ).click() );
		expect( container.querySelector( '.ffxb-pai-earlier' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-pai-result' ) ).not.toBeNull();
	} );

	it( 'says when an earlier prediction was not published since, or has too few views to compare', async () => {
		const few: EarlierPrediction = { ...earlierOne(), real: { before: measured( 1200, 0.17 ), after: measured( 120, 0.25 ), published: '2026-10-18T10:00:00+00:00' } };
		const none: EarlierPrediction = { ...earlierOne(), created: '2026-10-10T08:00:00+00:00', figures: null, real: { before: measured( 0, 0 ), after: null, published: null } };
		await editor( fakeApi( { lastPrediction: vi.fn( async () => stored() ), predictionHistory: vi.fn( async () => ( { real: null, history: [ few, none ] } ) ) } ), { view: 'predict' } );
		await flush( 500 );
		const tags = [ ...container.querySelectorAll( '.ffxb-pai-history-card .ffxb-pai-hist__tag' ) ].map( ( t ) => t.textContent );
		expect( tags ).toEqual( [ 'current', 'Not enough data yet', 'Not published since' ] );
		expect( container.querySelectorAll( '.ffxb-pai-hist__ring' )[ 2 ]?.textContent ).toBe( '–' );
	} );
} );

describe( 'more and better leads', () => {
	it( 'shows the qualified leads, filters suggestions by their goal and names their sources', async () => {
		const base = longModel();
		const model: PredictionModel = {
			...base,
			qualified: { label: 'mit Verkaufsabsicht', field: null, options: [], share: { p1: 0.7, p2: 0.5 } },
			suggestions: [
				{ ...( base.suggestions[ 2 ] as PredictionModel[ 'suggestions' ][ number ] ), goal: 'more', quality: 0, source: { rule: 'trust_submit', origin: 'assumption', text: 'Erfahrungswert: ein Vertrauenssatz am Button senkt den Abbruch um 2 bis 5 %.' } },
				{ id: 's4', kind: 'qualify', goal: 'better', quality: 0.11, node: 'q12', field: null, title: 'Verkaufsabsicht abfragen', reason: 'Bisher sehen alle Leads gleich aus.', instruction: 'Frag nach Frage 12, wann verkauft werden soll.', effect: [ { node: 'q12', delta: -0.01 } ], source: { rule: null, origin: 'ai', text: 'Die KI schätzt das für dieses Formular.' } },
			],
		};
		await editor( fakeApi( { lastPrediction: vi.fn( async () => ( { ...stored(), model } ) ) } ), { view: 'predict' } );
		await flush( 500 );
		const kpis = [ ...container.querySelectorAll( '.ffxb-pai-kpis > div' ) ].map( ( d ) => d.querySelector( 'span' )?.textContent );
		expect( kpis ).toEqual( [ 'Conversion rate', 'Leads per 1,000 visitors', 'Of them qualified', 'Value per 1,000 visitors' ] );
		const qualified = container.querySelectorAll( '.ffxb-pai-kpis > div' )[ 2 ] as HTMLElement;
		// Between the shares of the two kinds of visitors (70 % and 50 %), as many leads as the share says.
		const share = Number( qualified.querySelector( 'span:last-child' )?.textContent?.match( /^(\d+)\s%\smit Verkaufsabsicht$/ )?.[ 1 ] );
		expect( share ).toBeGreaterThan( 50 );
		expect( share ).toBeLessThan( 70 );
		const leads = Number( container.querySelectorAll( '.ffxb-pai-kpis > div' )[ 1 ]?.querySelector( 'strong' )?.textContent?.replace( /\D/g, '' ) );
		expect( Math.abs( Number( qualified.querySelector( 'strong' )?.textContent ) - ( leads * share ) / 100 ) ).toBeLessThan( 2 );
		// Not perfect while better leads are possible.
		expect( Number( container.querySelector( '.ffxb-pai-hero .ffxb-pai-ring__score' )?.textContent ) ).toBeLessThan( 100 );

		const titles = (): string[] => [ ...container.querySelectorAll( '.ffxb-pai-rec:not(.is-done) h3' ) ].map( ( h ) => h.textContent ?? '' );
		expect( titles() ).toEqual( [ 'Vertrauen vor dem Absenden', 'Verkaufsabsicht abfragen' ] );
		const card = ( title: string ): HTMLElement => [ ...container.querySelectorAll( '.ffxb-pai-rec' ) ].find( ( r ) => r.querySelector( 'h3' )?.textContent === title ) as HTMLElement;
		const better = card( 'Verkaufsabsicht abfragen' );
		expect( better.querySelector( '.ffxb-pai-kind' )?.textContent ).toBe( 'Better leads' );
		expect( better.querySelector( '.ffxb-pai-rec__impact strong' )?.textContent?.replace( /\s/g, ' ' ) ).toBe( '+11 %' );
		expect( better.querySelector( '.ffxb-pai-rec__impact span' )?.textContent ).toMatch( /^qualified leads, −\d\.\d points$/ );
		expect( better.querySelector( '.ffxb-pai-rec__source' )?.textContent ).toBe( 'Die KI schätzt das für dieses Formular. (estimate of the AI)' );
		expect( card( 'Vertrauen vor dem Absenden' ).querySelector( '.ffxb-pai-rec__source' )?.textContent ).toContain( '(assumption, benchmarks 2026-10)' );

		expect( [ ...container.querySelectorAll( '.ffxb-pai-recs__head .ffxb-pai-chip' ) ].map( ( c ) => c.textContent ) ).toEqual( [ 'All (2)', 'More leads (1)', 'Better leads (1)' ] );
		await act( async () => button( 'Better leads (1)' ).click() );
		expect( titles() ).toEqual( [ 'Verkaufsabsicht abfragen' ] );
		await act( async () => button( 'More leads (1)' ).click() );
		expect( titles() ).toEqual( [ 'Vertrauen vor dem Absenden' ] );
	} );
} );

/** The form without question 12, as the AI answers "Entferne Frage 12." */
function without12( doc: FormDocument ): FormDocument {
	return {
		...doc,
		nodes: doc.nodes.filter( ( n ) => 'q12' !== n.id ),
		edges: doc.edges.filter( ( e ) => 'q12' !== e.from ).map( ( e ) => ( 'q12' === e.to ? { ...e, to: 'q13' } : e ) ),
	};
}

/** The server side of the suggestions applied: what markApplied keeps. */
function appliedServer( start: AppliedSuggestion[] = [] ) {
	let list = [ ...start ];
	return vi.fn( async ( _id: number, ids: string[], applied: boolean, summary = '' ): Promise<StoredPrediction> => {
		list = [ ...list.filter( ( a ) => ! ids.includes( a.suggestion ) ), ...( applied ? ids.map( ( suggestion ) => ( { suggestion, summary, at: '2026-10-24T15:00:00+00:00' } ) ) : [] ) ];
		return { ...stored(), applied: list };
	} );
}

describe( 'applying suggestions with one click', () => {
	const card = ( title: string ): HTMLElement => [ ...container.querySelectorAll( '.ffxb-pai-rec' ) ].find( ( r ) => r.querySelector( 'h3' )?.textContent === title ) as HTMLElement;
	const open = (): string[] => [ ...container.querySelectorAll( '.ffxb-pai-rec:not(.is-done) h3' ) ].map( ( h ) => h.textContent ?? '' );
	const done = (): string[] => [ ...container.querySelectorAll( '.ffxb-pai-rec.is-done h3' ) ].map( ( h ) => h.textContent ?? '' );
	const score = (): number => Number( container.querySelector( '.ffxb-pai-hero .ffxb-pai-ring__score' )?.textContent );

	it( 'applies one, shows it in the draft with what it brings, and undoes it', async () => {
		let answer: ( change: { document: FormDocument; summary: string } ) => void = () => undefined;
		const aiEdit = vi.fn( () => new Promise<{ document: FormDocument; summary: string }>( ( resolve ) => ( answer = resolve ) ) );
		const markApplied = appliedServer();
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ), aiEdit, markApplied } );
		const store = await editor( api, { view: 'predict' } );
		await flush();
		expect( open() ).toHaveLength( 3 );
		const before = score();

		// See the change: the step now and the instruction the AI gets.
		await act( async () => button( 'See the change', card( 'Frage 12 weglassen' ) ).click() );
		const peek = card( 'Frage 12 weglassen' ).querySelector( '.ffxb-pai-peek' ) as HTMLElement;
		expect( peek.querySelector( '.ffxb-pai-side__title' )?.textContent ).toBe( 'Frage 12' );
		expect( peek.querySelector( '.ffxb-pai-side__tiles' )?.textContent ).toBe( 'JaNein' );
		expect( peek.textContent ).toContain( 'What "Apply change" does to your form' );
		expect( peek.textContent ).toContain( 'Lands in the draft and can be undone at any time.' );

		await act( async () => button( 'Apply change', card( 'Frage 12 weglassen' ) ).click() );
		const doc = store.getState().doc as FormDocument;
		expect( aiEdit ).toHaveBeenCalledWith( 7, 'Entferne Frage 12.', doc );
		expect( card( 'Frage 12 weglassen' ).querySelector( '.ffxb-pai-rec__status' )?.textContent ).toContain( 'The AI applies the suggestion.' );
		// One at a time.
		expect( button( 'Apply change', card( 'Vertrauen vor dem Absenden' ) ).disabled ).toBe( true );
		expect( button( 'Apply all 3' ).disabled ).toBe( true );

		await act( async () => answer( { document: without12( doc ), summary: 'Frage 12 ist entfernt.' } ) );
		await flush( 500 );
		expect( store.getState().doc?.nodes.some( ( n ) => 'q12' === n.id ) ).toBe( false );
		expect( markApplied ).toHaveBeenCalledWith( 7, [ 's2' ], true, 'Frage 12 ist entfernt.' );
		expect( done() ).toEqual( [ 'Frage 12 weglassen' ] );
		expect( open() ).toHaveLength( 2 );
		const applied = card( 'Frage 12 weglassen' );
		expect( applied.textContent ).toContain( 'Applied in the draft' );
		expect( applied.querySelector( '.ffxb-pai-rec__summary' )?.textContent ).toContain( 'Frage 12 ist entfernt.' );
		expect( applied.querySelector( '.ffxb-pai-rec__impact strong' )?.textContent ).toMatch( /^\+\d+(\.\d)? points$/ );
		// The prediction counts it: a better score, what it brought, the rest still open.
		expect( score() ).toBeGreaterThan( before );
		expect( container.querySelector( '.ffxb-pai-kpis' )?.textContent ).toMatch( /\+\d+(\.\d)? points from the changes/ );
		expect( container.querySelector( '.ffxb-pai-hero__sub' )?.textContent ).toContain( 'With the remaining 2 suggestions' );
		expect( tab().querySelector( '.ffxb-views__badge' )?.textContent ).toBe( '2' );
		// The message says what changed, without its own undo: Undo on the suggestion also counts it as open again.
		expect( container.querySelector( '.ffxb-toast__text' )?.textContent ).toBe( 'Frage 12 ist entfernt.' );
		expect( container.querySelector( '.ffxb-toast__action' ) ).toBeNull();

		// Undo: the change is the last one, so it is simply undone.
		await act( async () => button( 'Undo', applied ).click() );
		await flush( 500 );
		expect( store.getState().doc?.nodes.some( ( n ) => 'q12' === n.id ) ).toBe( true );
		expect( markApplied ).toHaveBeenLastCalledWith( 7, [ 's2' ], false, '' );
		expect( done() ).toEqual( [] );
		expect( open() ).toHaveLength( 3 );
		expect( score() ).toBe( before );
	} );

	it( 'applies all at once, then the form is perfect and can be published with a note', async () => {
		const aiEdit = vi.fn( async ( _id: number, _prompt: string, doc: FormDocument ) => ( { document: without12( doc ), summary: 'Drei Änderungen.' } ) );
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ), aiEdit, markApplied: appliedServer() } );
		await editor( api, { view: 'predict' } );
		await flush();
		expect( container.querySelector( '.ffxb-pai-applybar' )?.textContent ).toMatch( /^3 suggestions open · together about \+\d+(\.\d)? points conversion rate/ );

		await act( async () => button( 'Apply all 3' ).click() );
		await flush( 500 );
		// One instruction for the AI with all three.
		expect( aiEdit ).toHaveBeenCalledTimes( 1 );
		const prompt = aiEdit.mock.calls[ 0 ]?.[ 1 ] ?? '';
		expect( prompt.split( '\n' )[ 0 ] ).toBe( 'Make these changes to the form:' );
		for ( const instruction of [ 'Zeig vor Frage 10, wie weit die Bewertung ist.', 'Entferne Frage 12.', 'Schreib über den Button: Kostenlos und unverbindlich' ] ) {
			expect( prompt ).toContain( instruction );
		}
		expect( done() ).toHaveLength( 3 );
		expect( open() ).toEqual( [] );
		expect( score() ).toBe( 100 );
		expect( container.querySelector( '.ffxb-pai-hero__verdict' )?.textContent ).toBe( 'Perfect form' );
		expect( container.querySelector( '.ffxb-pai-applybar' ) ).toBeNull();
		const banner = container.querySelector( '.ffxb-pai-alldone' ) as HTMLElement;
		expect( banner.textContent ).toMatch( /All suggestions applied: probably \d+\u00a0% more leads\./ );
		expect( banner.textContent ).toContain( 'The 3 changes are in the draft.' );

		await act( async () => button( 'Publish now', banner ).click() );
		await flush();
		const dialog = container.querySelector( 'dialog.ffxb-dialog' ) as HTMLElement;
		expect( dialog.textContent ).toContain( 'Publish form' );
		expect( ( dialog.querySelector( 'input' ) as HTMLInputElement ).value ).toBe( 'Predictive AI: 3 changes' );
	} );

	// Waits on several runs of the simulation: more than the default time under load.
	it( 'asks before undoing a change the form has moved on from, and after a new visit only counts it as open', async () => {
		const aiEdit = vi.fn( async ( _id: number, _prompt: string, doc: FormDocument ) => ( { document: without12( doc ), summary: 'Frage 12 ist entfernt.' } ) );
		const markApplied = appliedServer();
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ), aiEdit, markApplied } );
		const store = await editor( api, { view: 'predict' } );
		await flush();
		await act( async () => button( 'Apply change', card( 'Frage 12 weglassen' ) ).click() );
		await flush( 500 );
		// A change after it.
		await act( async () => store.getState().change( ( d ) => void ( d.title = 'Neu' ) ) );
		await flush( 500 );

		await act( async () => button( 'Undo', card( 'Frage 12 weglassen' ) ).click() );
		const choice = card( 'Frage 12 weglassen' ).querySelector( '.ffxb-pai-revert' ) as HTMLElement;
		expect( choice.textContent ).toContain( 'You changed the form since.' );
		await act( async () => button( 'Undo anyway', choice ).click() );
		await flush( 500 );
		expect( store.getState().doc?.nodes.some( ( n ) => 'q12' === n.id ) ).toBe( true );
		expect( store.getState().doc?.title ).not.toBe( 'Neu' );
		expect( done() ).toEqual( [] );
		// Ctrl+Z brings the form back with the change and the title.
		await act( async () => store.getState().undo() );
		expect( store.getState().doc?.title ).toBe( 'Neu' );
		act( () => root.unmount() );

		// Applied on an earlier visit: the change is not known here, so it only counts as open again.
		root = createRoot( container );
		const later = fakeApi( { lastPrediction: vi.fn( async () => ( { ...stored(), applied: [ { suggestion: 's3', summary: 'Hinweis über dem Button.', at: '2026-10-23T10:00:00+00:00' } ] } ) ), aiEdit, markApplied: appliedServer() } );
		const second = await editor( later, { view: 'predict' } );
		await flush();
		expect( done() ).toEqual( [ 'Vertrauen vor dem Absenden' ] );
		const docBefore = second.getState().doc;
		await act( async () => button( 'Undo', card( 'Vertrauen vor dem Absenden' ) ).click() );
		const note = card( 'Vertrauen vor dem Absenden' ).querySelector( '.ffxb-pai-revert' ) as HTMLElement;
		expect( note.textContent ).toContain( 'This change is already saved in the draft.' );
		expect( [ ...note.querySelectorAll( 'button' ) ].map( ( b ) => b.textContent ) ).toEqual( [ 'Only count as open', 'Cancel' ] );
		await act( async () => button( 'Only count as open', note ).click() );
		await flush( 500 );
		expect( later.markApplied ).toHaveBeenCalledWith( 7, [ 's3' ], false, '' );
		expect( second.getState().doc ).toBe( docBefore );
		expect( done() ).toEqual( [] );
	}, 15000 );

	it( 'shows what went wrong and marks nothing when the AI fails', async () => {
		const aiEdit = vi.fn( async () => {
			throw new Error( 'The AI is busy. Try again in a few minutes.' );
		} );
		const markApplied = appliedServer();
		const api = fakeApi( { lastPrediction: vi.fn( async () => stored() ), aiEdit, markApplied } );
		const store = await editor( api, { view: 'predict' } );
		await flush();
		const doc = store.getState().doc;
		await act( async () => button( 'Apply change', card( 'Frage 12 weglassen' ) ).click() );
		await flush( 500 );
		expect( card( 'Frage 12 weglassen' ).querySelector( '[role="alert"]' )?.textContent ).toBe( 'The AI is busy. Try again in a few minutes.' );
		expect( markApplied ).not.toHaveBeenCalled();
		expect( store.getState().doc ).toBe( doc );
		expect( done() ).toEqual( [] );
		expect( button( 'Apply change', card( 'Frage 12 weglassen' ) ).disabled ).toBe( false );
	} );
} );

describe( 'the figures from the statistics page', () => {
	it( 'can be turned off, and the prediction turned on instead', async () => {
		const doc = long();
		const formStats = vi.fn( async ( _id: number, from = '', to = '' ) => ( {
			form: 7,
			from,
			to,
			totals: { views: 400, starts: 300, completions: 30, conversionRate: 0.075 },
			daily: [],
			steps: doc.nodes.filter( ( n ) => 'end' !== n.type ).map( ( n, i ) => ( { id: n.id, type: ( 'contact' === n.type ? 'contact' : 'step' ) as 'step' | 'contact', title: n.id, reached: 300 - i * 10, left: 10 } ) ),
			paths: [],
		} ) );
		const api = fakeApi( {
			get: vi.fn( async () => ( { ...summary, status: 'published' as const, currentRevision: 3, document: doc, lockTtl: 150 } ) ),
			lastPrediction: vi.fn( async () => stored() ),
			formStats,
		} );
		await editor( api, { figures: true } );
		await flush();
		const toggle = (): HTMLButtonElement => button( 'Analytics' );
		expect( toggle().getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( container.querySelector( '.ffxb-node[data-node="q1"] .ffxb-node__analytics' )?.textContent ).toContain( '300 reached' );

		await act( async () => toggle().click() );
		await flush();
		expect( toggle().getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		expect( container.querySelector( '.ffxb-node__analytics' ) ).toBeNull();

		await act( async () => button( 'Prediction' ).click() );
		await flush( 500 );
		expect( button( 'Prediction' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( toggle().getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		expect( container.querySelector( '.ffxb-node[data-node="q20"] .ffxb-node__analytics' )?.textContent ).toMatch( /\d+ reached/ );
	} );
} );

describe( 'the simulation of a long form', () => {
	it( 'runs 50,000 visitors through 20 questions quickly and keeps the counts consistent', () => {
		vi.useRealTimers();
		const started = performance.now();
		const result = predict( long(), longModel(), 50000 );
		expect( performance.now() - started ).toBeLessThan( 6000 );
		expect( result.steps ).toHaveLength( LONG + 1 );
		let before = result.visitors;
		for ( const s of [ ...result.steps ].sort( ( a, b ) => b.reached - a.reached ) ) {
			expect( s.reached ).toBeLessThanOrEqual( before );
			before = s.reached - s.left;
		}
		// The tiring middle is where the questions lose the most.
		const drop = ( id: string ): number => result.steps.find( ( s ) => s.id === id )?.dropRate ?? 0;
		expect( drop( 'q10' ) ).toBeGreaterThan( drop( 'q3' ) );
	} );
} );
