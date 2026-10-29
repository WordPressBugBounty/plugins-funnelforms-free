import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormsApi, PredictionQuota } from '../src/api';
import { PredictionScreen, type PredictionOverviewForm, type PredictionScreenConfig } from '../src/ui/PredictionScreen';

// The page of the Predictive AI: every form with its last prediction, the most leads to win first, and the analyses left this month.
( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

function quota( remaining: number ): PredictionQuota {
	return { connected: true, included: true, plan: 'personal', limit: 20, used: 20 - remaining, remaining, remainingToday: remaining, resetsAt: '2026-11-01T00:00:00+00:00' };
}

function fakeApi( overrides: Partial<Record<keyof FormsApi, unknown>> = {} ): FormsApi {
	return { predictionQuota: vi.fn( async () => quota( 14 ) ), ...overrides } as unknown as FormsApi;
}

function form( id: number, title: string, prediction: PredictionOverviewForm[ 'prediction' ], real: PredictionOverviewForm[ 'real' ] = { rate: null, views: 0 }, status = 'published' ): PredictionOverviewForm {
	return { id, title, status, prediction, real };
}

const FORMS: PredictionOverviewForm[] = [
	form( 1, 'Kontakt Website', null, { rate: 0.041, views: 900 } ),
	form( 2, 'Wärmepumpe Förder-Check', { created: '2026-10-15T08:00:00+00:00', score: 100, conversion: 0.312, best: 0.312, open: 0 }, { rate: 0.298, views: 1200 } ),
	form( 3, 'Immobilienbewertung', { created: '2026-10-24T08:00:00+00:00', score: 70, conversion: 0.184, best: 0.263, open: 5 }, { rate: 0.176, views: 2400 } ),
	form( 4, 'Solar-Angebot', { created: '2026-10-19T08:00:00+00:00', score: 54, conversion: 0.098, best: 0.179, open: 4 }, { rate: 0.104, views: 800 } ),
	form( 5, 'Finanzierungsrechner', null, { rate: null, views: 0 }, 'draft' ),
	form( 6, 'Recruiting', { created: '2026-10-22T08:00:00+00:00', score: null, conversion: null, best: null, open: 3 }, { rate: null, views: 0 }, 'draft' ),
];

const CONFIG: PredictionScreenConfig = {
	forms: FORMS,
	builderUrl: 'admin.php?page=funnelforms-builder',
	realDays: 30,
	ai: { ready: true, accountUrl: 'admin.php?page=funnelforms-account' },
	userLocale: 'en_US',
};

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

async function show( api: FormsApi, config: PredictionScreenConfig = CONFIG ): Promise<void> {
	await act( async () => root.render( <PredictionScreen api={ api } config={ config } /> ) );
	await act( async () => undefined );
}

/** Text with the spaces of the number formats as plain spaces. */
function text( el: Element | null | undefined ): string | undefined {
	return el?.textContent?.replace( /\s/g, ' ' );
}

function cards(): HTMLElement[] {
	return [ ...container.querySelectorAll<HTMLElement>( '.ffxb-pai-overview__card' ) ];
}

describe( 'the page of the Predictive AI', () => {
	it( 'lists the forms, the most leads to win first, each leading to its tab in the editor', async () => {
		const api = fakeApi();
		await show( api );
		expect( container.querySelector( 'h2' )?.textContent ).toBe( 'Which form loses the most leads?' );
		expect( cards().map( ( c ) => c.querySelector( 'h3' )?.textContent ) ).toEqual( [ 'Solar-Angebot', 'Immobilienbewertung', 'Wärmepumpe Förder-Check', 'Recruiting', 'Kontakt Website', 'Finanzierungsrechner' ] );

		const [ solar, valuation, perfect, recruiting, contact, draft ] = cards() as [ HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement ];
		expect( solar.querySelector( '.ffxb-pai-overview__ring' )?.textContent ).toBe( '54' );
		expect( solar.querySelector( '.ffxb-pai-overview__ring' )?.className ).toContain( 'is-low' );
		expect( text( solar.querySelector( '.ffxb-pai-overview__figures' ) ) ).toBe( '9.8 % predicted10.4 % real' );
		expect( solar.querySelector( '.ffxb-pai-overview__note' )?.textContent ).toBe( '4 suggestions open, up to +8.1 points' );
		expect( solar.textContent ).toContain( 'Published · prediction of Oct 19, 2026' );
		const link = solar.querySelector( 'a' ) as HTMLAnchorElement;
		expect( link.textContent ).toBe( 'See the suggestions' );
		expect( link.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-builder&form=4&view=predict' );

		expect( valuation.querySelector( '.ffxb-pai-overview__ring' )?.className ).toContain( 'is-mid' );
		expect( perfect.querySelector( '.ffxb-pai-overview__note' )?.textContent ).toBe( 'Perfect form' );
		expect( perfect.querySelector( '.ffxb-pai-overview__ring' )?.className ).toContain( 'is-good' );
		expect( perfect.querySelector( 'a' )?.textContent ).toBe( 'See the result' );
		// A prediction the builder kept no figures for yet.
		expect( recruiting.querySelector( '.ffxb-pai-overview__ring' )?.textContent ).toBe( '–' );
		expect( recruiting.querySelector( '.ffxb-pai-overview__note' )?.textContent ).toBe( 'Open the result to see the score' );
		// Without a prediction: those with views first.
		expect( contact.querySelector( '.ffxb-pai-overview__note' )?.textContent ).toBe( 'Not simulated yet' );
		expect( text( contact.querySelector( '.ffxb-pai-overview__figures' ) ) ).toBe( '– predicted4.1 % real' );
		expect( contact.querySelector( 'a' )?.textContent ).toBe( 'Start the first simulation' );
		expect( draft.textContent ).toContain( 'Draft' );
		expect( container.textContent ).toContain( 'conversion rate of the published form in the last 30 days' );
	} );

	it( 'shows the analyses left this month, and a larger plan when none are left', async () => {
		await show( fakeApi() );
		const meter = container.querySelector( '.ffxb-pai-overview__quota' ) as HTMLElement;
		expect( meter.querySelector( '.ffxb-pai-overview__left' )?.textContent ).toBe( '14 of 20 left' );
		expect( ( meter.querySelector( '.ffxb-pai-overview__meter > span' ) as HTMLElement ).style.width ).toBe( '70%' );
		expect( meter.textContent ).toContain( 'New analyses on Nov 1, 2026' );
		expect( meter.querySelector( 'a' ) ).toBeNull();

		await act( async () => root.unmount() );
		root = createRoot( container );
		await show( fakeApi( { predictionQuota: vi.fn( async () => quota( 0 ) ) } ) );
		expect( container.querySelector( '.ffxb-pai-overview__quota a' )?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-account' );
	} );

	it( 'says when the analyses left could not be loaded', async () => {
		await show( fakeApi( { predictionQuota: vi.fn( async () => Promise.reject( new Error( 'offline' ) ) ) } ) );
		expect( container.querySelector( '.ffxb-pai-overview__quota' )?.textContent ).toContain( 'could not be loaded' );
	} );

	it( 'without a license that includes AI it says where to connect one', async () => {
		await show( fakeApi(), { ...CONFIG, ai: { ready: false, accountUrl: 'admin.php?page=funnelforms-account' } } );
		expect( container.textContent ).toContain( 'Connect your license' );
		expect( container.querySelector( '.ffxb-pai-overview__quota' ) ).toBeNull();
		expect( cards() ).toHaveLength( 6 );
	} );

	it( 'without forms it leads to a new one', async () => {
		await show( fakeApi(), { ...CONFIG, forms: [] } );
		expect( container.textContent ).toContain( 'No forms yet' );
		expect( container.querySelector( '.ffxb-empty a' )?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-builder' );
	} );
} );
