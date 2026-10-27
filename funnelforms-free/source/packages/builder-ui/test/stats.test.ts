import { describe, expect, it } from 'vitest';
import type { FormStatsReport } from '../src/api';
import { sprintf } from '../src/ui/i18n';
import { analyticsUrl, answerRows, canvasAnalytics, change, dropBand, nodeFields, percent, periodDays, shownDay, stepFigures, stepRows, worstStep } from '../src/stats';

const report: FormStatsReport = {
	form: 3,
	from: '2026-09-17',
	to: '2026-10-16',
	totals: { views: 200, starts: 90, completions: 20, conversionRate: 0.1 },
	daily: [],
	steps: [
		{ id: 'n1', type: 'step', title: 'Wofür?', reached: 90, left: 30 },
		{ id: 'n2', type: 'step', title: 'Wann?', reached: 60, left: 10 },
		{ id: 'c', type: 'contact', title: 'Kontakt', reached: 50, left: 30 },
		{ id: 'n3', type: 'step', title: 'Tot', reached: 0, left: 0 },
	],
};

describe( 'statistics', () => {
	it( 'compares a period with the one before it', () => {
		expect( periodDays( 7, new Date( 2026, 9, 16, 12 ) ) ).toEqual( { from: '2026-10-10', to: '2026-10-16', previousFrom: '2026-10-03', previousTo: '2026-10-09' } );
		expect( periodDays( 30, new Date( 2026, 2, 1 ) ).from ).toBe( '2026-01-31' );
		expect( change( 120, 100 ) ).toBeCloseTo( 0.2 );
		expect( change( 5, 0 ) ).toBeNull();
		expect( change( null, 3 ) ).toBeNull();
		expect( percent( 0.0922, 'en-US' ) ).toBe( '9.2%' );
		expect( percent( 0.5, 'de-DE' ) ).toBe( '50\u00a0%' );
		expect( percent( null ) ).toBe( '–' );
	} );

	it( 'finds where visitors leave', () => {
		const rows = stepRows( report );
		expect( rows.map( ( r ) => [ r.id, r.dropRate, r.reachRate ] ) ).toEqual( [
			[ 'n1', 30 / 90, 0.45 ],
			[ 'n2', 10 / 60, 0.3 ],
			[ 'c', 0.6, 0.25 ],
			[ 'n3', null, 0 ],
		] );
		// The first of the steps most visitors leave on.
		expect( worstStep( rows )?.id ).toBe( 'n1' );
		expect( worstStep( [] ) ).toBeNull();
		expect( stepFigures( report ).get( 'c' ) ).toEqual( { reached: 50, left: 30 } );
	} );

	it( 'shares answers and how often they lead to a sent form', () => {
		expect(
			answerRows( [
				{ id: 'a', label: 'Haus', chosen: 30, completed: 9 },
				{ id: 'b', label: 'Wohnung', chosen: 10, completed: 1 },
				{ id: 'c', label: 'Nie', chosen: 0, completed: 0 },
			] ).map( ( r ) => [ r.id, r.share, r.sentRate ] )
		).toEqual( [
			[ 'a', 0.75, 0.3 ],
			[ 'b', 0.25, 0.1 ],
			[ 'c', 0, null ],
		] );
	} );

	it( 'fills placeholders in order and by position', () => {
		expect( sprintf( 'Page %d of %d', 2, 5 ) ).toBe( 'Page 2 of 5' );
		expect( sprintf( '%2$s vor %1$d', 3, 'Eintrag' ) ).toBe( 'Eintrag vor 3' );
		expect( sprintf( '100%% sicher, %s', 'ja' ) ).toBe( '100% sicher, ja' );
	} );
} );

describe( 'analytics page', () => {
	it( 'links to the analytics of the form for the same period', () => {
		expect( analyticsUrl( 12 ) ).toBe( 'admin.php?page=funnelforms-stats&form=12' );
		expect( analyticsUrl( 12, 7 ) ).toBe( 'admin.php?page=funnelforms-stats&form=12&period=7' );
		expect( analyticsUrl( 12, 90 ) ).toBe( 'admin.php?page=funnelforms-stats&form=12&period=90' );
	} );
} );

describe( 'analytics mode', () => {
	// Start n1, which leads to n2 or to the end q; n2 to the contact step c and its end e; x is new in the draft.
	const flow = {
		start: 'n1',
		nodes: [
			{ id: 'n1', type: 'step' as const },
			{ id: 'n2', type: 'step' as const },
			{ id: 'c', type: 'contact' as const },
			{ id: 'q', type: 'end' as const },
			{ id: 'e', type: 'end' as const },
			{ id: 'x', type: 'step' as const },
		],
		edges: [
			{ id: 'p1', from: 'n1', to: 'n2' },
			{ id: 'p2', from: 'n1', to: 'q' },
			{ id: 'p3', from: 'n2', to: 'c' },
			{ id: 'p4', from: 'c', to: 'e' },
			{ id: 'p5', from: 'n2', to: 'x' },
		],
	};
	const full: FormStatsReport = {
		...report,
		totals: { views: 120, starts: 100, completions: 20, conversionRate: 0.17 },
		steps: [
			{ id: 'n1', type: 'step', title: '', reached: 100, left: 10 },
			{ id: 'n2', type: 'step', title: '', reached: 60, left: 15 },
			{ id: 'c', type: 'contact', title: '', reached: 45, left: 25 },
			{ id: 'x', type: 'step', title: '', reached: 0, left: 0 },
		],
		times: { steps: { n2: 31 } },
		paths: [
			{ from: '', to: 'n1', sessions: 100, completed: 20 },
			{ from: 'n1', to: 'n2', sessions: 60, completed: 20 },
			{ from: 'n1', to: 'q', sessions: 30, completed: 0 },
			{ from: 'n2', to: 'c', sessions: 45, completed: 20 },
			{ from: 'c', to: 'e', sessions: 20, completed: 20 },
		],
		answers: [ { field: 'f2', step: 'n2', title: 'Wann?', options: [ { id: 'o1', label: 'Bald', chosen: 40, completed: 15 } ] } ],
		fieldStats: [
			{ field: 'f2', step: 'n2', type: 'choice', title: 'Wann?', invalid: 6, touched: 30, lastTouched: 4 },
			{ field: 'f1', step: 'n1', type: 'text', title: 'Was?', invalid: 0, touched: 0, lastTouched: 0 },
		],
	};

	it( 'colours steps by how many leave: under 15 %, under 30 %, from 30 %', () => {
		expect( [ 0, 0.149, 0.15, 0.299, 0.3, 1 ].map( dropBand ) ).toEqual( [ 'low', 'low', 'medium', 'medium', 'high', 'high' ] );
		expect( dropBand( null ) ).toBeNull();
	} );

	it( 'draws paths by their share of the node before and follows the strongest way from the start', () => {
		const a = canvasAnalytics( flow, full );
		expect( a.nodes.get( 'n1' ) ).toMatchObject( { reached: 100, left: 10, band: 'low', strongest: true } );
		expect( a.nodes.get( 'n2' ) ).toMatchObject( { band: 'medium', seconds: 31, strongest: true } );
		// The contact step: who reached it and went on sent the form.
		expect( a.nodes.get( 'c' ) ).toMatchObject( { band: 'high', sent: 20, sentRate: 20 / 45, strongest: true } );
		// Ends count the ways into them.
		expect( a.nodes.get( 'e' ) ).toMatchObject( { reached: 20, sent: 20, band: null, strongest: true } );
		expect( a.nodes.get( 'q' ) ).toMatchObject( { reached: 30, sent: 0, strongest: false } );
		expect( a.nodes.get( 'x' ) ).toMatchObject( { reached: 0, dropRate: null, band: null } );

		expect( a.edges.get( 'p1' ) ).toEqual( { sessions: 60, completed: 20, share: 0.6, width: 6.4, opacity: 0.78, strongest: true } );
		expect( a.edges.get( 'p2' ) ).toMatchObject( { share: 0.3, width: 3.7, strongest: false } );
		expect( a.edges.get( 'p4' ) ).toMatchObject( { share: 20 / 45, strongest: true } );
		// Nobody: thin and faint (dashed on the canvas).
		expect( a.edges.get( 'p5' ) ).toEqual( { sessions: 0, completed: 0, share: 0, width: 1, opacity: 0.35, strongest: false } );
		expect( a.small ).toBe( false );
		expect( canvasAnalytics( flow, { ...full, totals: { ...full.totals, views: 29 } } ).small ).toBe( true );
	} );

	it( 'stops the strongest way where nobody went on and works without paths', () => {
		const a = canvasAnalytics( flow, { ...full, paths: undefined } );
		expect( a.nodes.get( 'n1' )?.strongest ).toBe( true );
		expect( [ ...a.edges.values() ].every( ( e ) => ! e.strongest && 0 === e.sessions ) ).toBe( true );
		expect( a.nodes.get( 'n2' )?.strongest ).toBe( false );
	} );

	it( 'lists the fields of a node with checks, inputs and answers', () => {
		expect( nodeFields( full, 'n2' ) ).toEqual( [
			{ field: 'f2', title: 'Wann?', type: 'choice', invalid: 6, touched: 30, lastTouched: 4, invalidRate: 0.1, answers: answerRows( full.answers?.[ 0 ]?.options ?? [] ) },
		] );
		expect( nodeFields( report, 'n1' ) ).toEqual( [] );
	} );
} );

describe( 'days of a report', () => {
	it( 'are shown in the date format of the editor, not as Y-m-d', () => {
		expect( shownDay( '2026-09-21', 'de-DE' ) ).toBe( '21.09.2026' );
		expect( shownDay( '2026-09-21', 'en-US' ) ).toBe( 'Sep 21, 2026' );
		expect( shownDay( 'yesterday', 'de-DE' ) ).toBe( 'yesterday' );
	} );
} );
