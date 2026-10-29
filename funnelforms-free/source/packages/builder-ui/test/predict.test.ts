import { describe, expect, it } from 'vitest';
import type { FormDocument, FormNode } from '@funnelforms/form-schema';
import { appliedIds, funnelScore, isBetter, predict, seeded, simulate, worthApplying, type PredictionModel } from '../src/predict';
import { applyPrompts } from '../src/ui/Prediction';
import { canvasAnalytics } from '../src/stats';
import { blank } from './blank';

/**
 * Kind of property (house or flat), a flat question only for flats, the budget on a slider with a
 * calculation that sends large budgets to a step of their own, then the contact step.
 */
function funnel(): FormDocument {
	const doc = blank();
	const steps = [
		{
			id: 'q1',
			type: 'step',
			fields: [
				{
					id: 'f_kind',
					type: 'choice',
					key: 'kind',
					label: { de_DE: 'Was suchst du?' },
					required: true,
					options: [
						{ id: 'o_house', label: { de_DE: 'Haus' }, value: 'Haus' },
						{ id: 'o_flat', label: { de_DE: 'Wohnung' }, value: 'Wohnung' },
					],
					props: { multiple: false, layout: { desktop: 'grid', mobile: 'list' }, hideIcons: false },
				},
			],
		},
		{ id: 'q_flat', type: 'step', fields: [ { id: 'f_floor', type: 'number', key: 'floor', label: { de_DE: 'Etage' }, required: false, props: { placeholder: { de_DE: '' } } } ] },
		{
			id: 'q2',
			type: 'step',
			fields: [ { id: 'f_budget', type: 'slider', key: 'budget', label: { de_DE: 'Budget' }, required: true, props: { min: 0, max: 1000, step: 10, start: 500, unit: { text: { de_DE: '€' }, position: 'after' }, thousandsSeparator: false, manualInput: { enabled: false, label: { de_DE: '' } } } } ],
		},
		{ id: 'q_rich', type: 'step', fields: [ { id: 'f_note', type: 'text', key: 'note', label: { de_DE: 'Wunsch' }, required: true, props: { placeholder: { de_DE: '' } } } ] },
	] as unknown as FormNode[];
	doc.nodes.unshift( ...steps );
	doc.start = 'q1';
	doc.calculations = [ { id: 'c_double', label: 'Doppelt', expression: { op: '*', args: [ { var: 'budget' }, { num: 2 } ] }, format: { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.' } } ] as FormDocument[ 'calculations' ];
	doc.edges.unshift(
		{ id: 'e_flat', from: 'q1', to: 'q_flat', when: { field: 'f_kind', op: 'selected', value: 'o_flat' } },
		{ id: 'e_house', from: 'q1', to: 'q2', default: true },
		{ id: 'e_flat2', from: 'q_flat', to: 'q2', default: true },
		{ id: 'e_rich', from: 'q2', to: 'q_rich', when: { calc: 'c_double', op: 'gte', value: 1500 } },
		{ id: 'e_q2', from: 'q2', to: 'contact', default: true },
		{ id: 'e_rich2', from: 'q_rich', to: 'contact', default: true }
	);
	return doc;
}

function model( overrides: Partial<PredictionModel> = {} ): PredictionModel {
	const step = ( node: string, rate: number, fields: PredictionModel[ 'steps' ][ number ][ 'fields' ] = [] ): PredictionModel[ 'steps' ][ number ] => ( {
		node,
		prior: rate,
		estimated: false,
		uncertainty: 0.05,
		continue: { p1: rate },
		reasons: 'contact' === node ? [ 'Viele brechen hier ab, weil eine Telefonnummer verlangt wird.' ] : [],
		fields,
	} );
	return {
		benchmark: '2026-10',
		personas: [ { id: 'p1', name: 'Eilige', share: 1, description: 'Will schnell ein Angebot.' } ],
		steps: [
			step( 'q1', 0.8, [ { field: 'f_kind', options: { p1: { o_house: 0.7, o_flat: 0.3 } } } ] ),
			step( 'q_flat', 0.9 ),
			// Budgets in the top quarter (750 to 1000, doubled 1500 and more) for a quarter.
			step( 'q2', 0.9, [ { field: 'f_budget', buckets: { p1: [ 0.25, 0.25, 0.25, 0.25 ] } } ] ),
			step( 'q_rich', 0.95 ),
			step( 'contact', 0.5 ),
		],
		insights: [],
		suggestions: [
			{ id: 's1', kind: 'optional_field', node: 'contact', field: 'c_email', title: 'Telefon optional', reason: 'Weniger Hürden.', instruction: 'Mach die Telefonnummer optional', effect: [ { node: 'contact', delta: 0.1 } ] },
			{ id: 's2', kind: 'reword', node: 'gone', field: null, title: 'Weg', reason: '', instruction: '', effect: [ { node: 'gone', delta: 0.2 } ] },
		],
		summary: 'Ein kurzer Funnel.',
		...overrides,
	};
}

describe( 'simulation of visitors', () => {
	it( 'keeps the ways of the first visitors to play them, without changing the figures', () => {
		const plain = simulate( funnel(), model(), 2000, 7 );
		const traced = simulate( funnel(), model(), 2000, 7, { trace: 50 } );
		expect( traced.report ).toEqual( plain.report );
		expect( plain.traces ).toEqual( [] );
		expect( traced.traces ).toHaveLength( 50 );
		for ( const t of traced.traces ) {
			expect( t.nodes[ 0 ] ).toBe( 'q1' );
			expect( t.persona ).toBe( 'p1' );
			const last = t.nodes[ t.nodes.length - 1 ];
			if ( t.left ) {
				// Left on a step: no lead, and no end.
				expect( t.lead ).toBe( -1 );
				expect( last ).not.toBe( 'end' );
			} else {
				// Sent the contact step: a lead from the end after it.
				expect( last ).toBe( 'end' );
				expect( t.nodes[ t.lead - 1 ] ).toBe( 'contact' );
				expect( t.nodes[ t.lead ] ).toBe( 'end' );
			}
		}
		expect( traced.traces.some( ( t ) => t.left ) ).toBe( true );
		expect( traced.traces.some( ( t ) => ! t.left ) ).toBe( true );
		// The flat question only for those who want a flat, as the form asks it.
		expect( traced.traces.some( ( t ) => t.nodes.includes( 'q_flat' ) ) ).toBe( true );
		expect( traced.traces.every( ( t ) => ! t.nodes.includes( 'q_flat' ) || 'q1' === t.nodes[ t.nodes.indexOf( 'q_flat' ) - 1 ] ) ).toBe( true );
		// The prediction keeps those of its main run; a form without a contact step has its leads at the end.
		expect( predict( funnel(), model(), 1000 ).simulation.traces ).toHaveLength( 100 );
		const noContact = funnel();
		noContact.nodes = noContact.nodes.filter( ( n ) => 'contact' !== n.type );
		noContact.edges = noContact.edges.map( ( e ) => ( 'contact' === e.to ? { ...e, to: 'end' } : e ) ).filter( ( e ) => 'contact' !== e.from );
		const ends = simulate( noContact, model(), 200, 7, { trace: 200 } ).traces.filter( ( t ) => ! t.left );
		expect( ends.length ).toBeGreaterThan( 0 );
		expect( ends.every( ( t ) => t.lead === t.nodes.length - 1 && 'end' === t.nodes[ t.lead ] ) ).toBe( true );
	} );

	it( 'gives the same figures for the same seed', () => {
		const a = simulate( funnel(), model(), 2000, 7 );
		const b = simulate( funnel(), model(), 2000, 7 );
		expect( a.report ).toEqual( b.report );
		expect( simulate( funnel(), model(), 2000, 8 ).report ).not.toEqual( a.report );
		const r = seeded( 1 );
		const values = Array.from( { length: 1000 }, r );
		expect( Math.min( ...values ) ).toBeGreaterThanOrEqual( 0 );
		expect( Math.max( ...values ) ).toBeLessThan( 1 );
	} );

	it( 'counts every visitor once: each one leaves on a step or sends the form', () => {
		const { report, goal } = simulate( funnel(), model(), 10000 );
		expect( goal ).toBe( 'sent' );
		expect( report.totals.views ).toBe( 10000 );
		expect( report.steps.find( ( s ) => 'q1' === s.id )?.reached ).toBe( 10000 );
		const left = report.steps.reduce( ( sum, s ) => sum + s.left, 0 );
		expect( left + report.totals.completions ).toBe( 10000 );
		expect( report.totals.starts ).toBe( 10000 - ( report.steps.find( ( s ) => 'q1' === s.id )?.left ?? 0 ) );
	} );

	it( 'follows the shares of the model, the paths and the calculations of the form', () => {
		const { report } = simulate( funnel(), model(), 20000 );
		const steps = new Map( report.steps.map( ( s ) => [ s.id, s ] ) );
		const finished = 20000 - ( steps.get( 'q1' )?.left ?? 0 );
		expect( finished / 20000 ).toBeCloseTo( 0.8, 1 );
		// 30 % choose a flat and see its question; the others go to the budget at once.
		expect( ( steps.get( 'q_flat' )?.reached ?? 0 ) / finished ).toBeCloseTo( 0.3, 1 );
		const budget = steps.get( 'q2' )?.reached ?? 0;
		// Doubled budgets of 1500 and more: a quarter of those who finish the budget step.
		expect( ( steps.get( 'q_rich' )?.reached ?? 0 ) / ( budget - ( steps.get( 'q2' )?.left ?? 0 ) ) ).toBeCloseTo( 0.25, 1 );
		// 0.8 × (0.3 × 0.9 + 0.7) × 0.9 × (0.25 × 0.95 + 0.75) × 0.5
		expect( ( report.totals.conversionRate ?? 0 ) ).toBeCloseTo( 0.8 * 0.97 * 0.9 * 0.9875 * 0.5, 1 );
		const answers = report.answers?.find( ( a ) => 'f_kind' === a.field );
		const flat = answers?.options.find( ( o ) => 'o_flat' === o.id );
		expect( flat?.label ).toBe( 'Wohnung' );
		expect( ( flat?.chosen ?? 0 ) / finished ).toBeCloseTo( 0.3, 1 );
		expect( flat?.completed ).toBeLessThan( flat?.chosen ?? 0 );
	} );

	it( 'draws the prediction on the canvas like the statistics', () => {
		const doc = funnel();
		const { report } = simulate( doc, model(), 5000 );
		const figures = canvasAnalytics( doc, report );
		expect( figures.nodes.get( 'q1' )?.strongest ).toBe( true );
		expect( figures.edges.get( 'e_house' )?.strongest ).toBe( true );
		expect( figures.edges.get( 'e_flat' )?.strongest ).toBe( false );
		expect( figures.nodes.get( 'contact' )?.band ).toBe( 'high' );
		expect( figures.nodes.get( 'end' )?.sent ).toBe( report.totals.completions );
	} );

	it( 'splits visitors between the variants of a running A/B test', () => {
		const doc = funnel();
		doc.experiments = [ { id: 'x1', status: 'running', variants: [ { id: 'a', weight: 50 }, { id: 'b', weight: 50, start: 'q2' } ] } ];
		const { report } = simulate( doc, model(), 10000 );
		const q1 = report.steps.find( ( s ) => 'q1' === s.id )?.reached ?? 0;
		expect( q1 / 10000 ).toBeCloseTo( 0.5, 1 );
		expect( report.paths?.find( ( p ) => '' === p.from && 'q2' === p.to )?.sessions ).toBe( 10000 - q1 );
	} );

	it( 'counts forms without a contact step as finished at an end', () => {
		const doc = funnel();
		doc.nodes = doc.nodes.filter( ( n ) => 'contact' !== n.type );
		doc.edges = doc.edges.map( ( e ) => ( 'contact' === e.to ? { ...e, to: 'end' } : e ) ).filter( ( e ) => 'contact' !== e.from );
		const s = simulate( doc, model(), 4000 );
		expect( s.goal ).toBe( 'end' );
		expect( s.report.totals.completions ).toBe( 4000 - s.report.steps.reduce( ( sum, r ) => sum + r.left, 0 ) );
	} );
} );

describe( 'prediction', () => {
	it( 'has a range, sticking points, personas and suggestions with their effect', () => {
		const p = predict( funnel(), model(), 10000 );
		expect( p.low ).toBeLessThan( p.conversion );
		expect( p.high ).toBeGreaterThan( p.conversion );
		expect( p.sticking.map( ( s ) => s.id ) ).toEqual( [ 'contact', 'q1' ] );
		expect( p.steps.find( ( s ) => 'contact' === s.id )?.reasons[ 0 ] ).toContain( 'Telefonnummer' );
		const q2 = p.steps.find( ( s ) => 'q2' === s.id );
		expect( q2?.reachLow ).toBeLessThanOrEqual( q2?.reachRate ?? 0 );
		expect( q2?.reachHigh ).toBeGreaterThanOrEqual( q2?.reachRate ?? 1 );
		expect( p.personas[ 0 ]?.visitors ).toBe( 10000 );
		expect( p.personas[ 0 ]?.conversion ).toBeCloseTo( p.conversion, 5 );
		// The suggestion for a step that is gone is left out; the other raises the rate.
		expect( p.suggestions.map( ( s ) => s.id ) ).toEqual( [ 's1' ] );
		expect( p.suggestions[ 0 ]?.gain ).toBeGreaterThan( 0.02 );
		expect( p.unknown ).toBe( 0 );
	} );

	it( 'counts steps added after the prediction with a fixed share and marks them', () => {
		const doc = funnel();
		doc.nodes.unshift( { id: 'q0', type: 'step', fields: [] } as unknown as FormNode );
		doc.edges.unshift( { id: 'e0', from: 'q0', to: 'q1', default: true } );
		doc.start = 'q0';
		const p = predict( doc, model(), 4000 );
		expect( p.unknown ).toBe( 1 );
		const q0 = p.steps.find( ( s ) => 'q0' === s.id );
		expect( q0?.unknown ).toBe( true );
		expect( ( q0?.left ?? 0 ) / 4000 ).toBeCloseTo( 0.15, 1 );
	} );

	it( 'gives each persona its own rates', () => {
		const m = model( { personas: [ { id: 'p1', name: 'Eilige', share: 0.5, description: '' }, { id: 'p2', name: 'Vorsichtige', share: 0.5, description: '' } ] } );
		m.steps = m.steps.map( ( s ) => ( 'contact' === s.node ? { ...s, continue: { p1: 0.9, p2: 0.1 } } : s ) );
		const p = predict( funnel(), m, 10000 );
		const [ fast, careful ] = p.personas;
		expect( ( fast?.visitors ?? 0 ) / 10000 ).toBeCloseTo( 0.5, 1 );
		expect( fast?.conversion ?? 0 ).toBeGreaterThan( 5 * ( careful?.conversion ?? 1 ) );
	} );

	it( 'scores the form by what it reaches of what is possible with all suggestions together', () => {
		const delta = ( id: string, node: string, d: number ) => ( { id, kind: 'reword' as const, node, field: null, title: id, reason: '', instruction: '', effect: [ { node, delta: d } ] } );
		const p = predict( funnel(), model( { suggestions: [ delta( 'a', 'contact', 0.1 ), delta( 'b', 'q1', 0.1 ), delta( 'worse', 'q2', -0.2 ) ] } ), 10000 );
		// Together the two that help bring more than each alone; the one that hurts is left out.
		const [ first ] = p.suggestions;
		expect( p.best ).toBeGreaterThan( first?.conversion ?? 1 );
		expect( p.best ).toBeGreaterThan( p.conversion );
		const score = funnelScore( p );
		expect( score ).toBe( Math.round( ( 100 * p.conversion ) / p.best ) );
		expect( score ).toBeLessThan( 100 );

		// Without a suggestion that helps the form is as good as the AI can tell.
		const none = predict( funnel(), model( { suggestions: [ delta( 'worse', 'q2', -0.2 ) ] } ), 10000 );
		expect( none.best ).toBe( none.conversion );
		expect( funnelScore( none ) ).toBe( 100 );
		expect( funnelScore( { conversion: 0.1, best: 0.1003 } ) ).toBe( 100 );
		expect( funnelScore( { conversion: 0, best: 0 } ) ).toBe( 100 );
		expect( funnelScore( { conversion: 0.05, best: 0.1 } ) ).toBe( 50 );
	} );

	it( 'counts suggestions applied to the form with their effect and offers them no longer', () => {
		const delta = ( id: string, node: string, d: number ) => ( { id, kind: 'reword' as const, node, field: null, title: id, reason: '', instruction: '', effect: [ { node, delta: d } ] } );
		const m = model( { suggestions: [ delta( 'a', 'contact', 0.1 ), delta( 'b', 'q1', 0.1 ) ] } );
		const before = predict( funnel(), m, 10000 );
		expect( before.original ).toBe( before.conversion );
		expect( before.applied ).toEqual( [] );

		// With "a" applied: the rate the suggestion promised, "b" still open.
		const one = predict( funnel(), m, 10000, undefined, [ 'a' ] );
		expect( one.conversion ).toBeCloseTo( before.suggestions.find( ( s ) => 'a' === s.id )?.conversion ?? 0, 6 );
		expect( one.original ).toBe( before.conversion );
		expect( one.suggestions.map( ( s ) => s.id ) ).toEqual( [ 'b' ] );
		expect( one.applied.map( ( s ) => s.id ) ).toEqual( [ 'a' ] );
		expect( one.applied[ 0 ]?.gain ).toBeCloseTo( one.conversion - one.original, 6 );
		expect( one.best ).toBeCloseTo( before.best, 6 );
		expect( funnelScore( one ) ).toBeGreaterThan( funnelScore( before ) );

		// All of them in: nothing left to gain, a perfect form.
		const all = predict( funnel(), m, 10000, undefined, [ 'a', 'b' ] );
		expect( all.suggestions ).toEqual( [] );
		expect( all.best ).toBe( all.conversion );
		expect( all.conversion ).toBeCloseTo( before.best, 6 );
		expect( funnelScore( all ) ).toBe( 100 );
		// An id the model does not know changes nothing.
		expect( predict( funnel(), m, 10000, undefined, [ 'gone' ] ).conversion ).toBe( before.conversion );
		expect( appliedIds( { applied: [ { suggestion: 'a', summary: '', at: '' } ] } ) ).toEqual( [ 'a' ] );
		expect( appliedIds( null ) ).toEqual( [] );
	} );

	it( 'counts qualified leads by the answers of the form, or by the personas, and suggestions for better leads', () => {
		// Qualified: those looking for a house (70 % of the answers).
		const byAnswer = model( { qualified: { label: 'want a house', field: 'f_kind', options: [ 'o_house' ], share: { p1: 0.1 } } } );
		const plain = predict( funnel(), model() );
		const a = predict( funnel(), byAnswer );
		expect( plain.quality ).toBeNull();
		expect( a.conversion ).toBe( plain.conversion );
		expect( a.quality?.byAnswers ).toBe( true );
		expect( a.quality?.share ).toBeGreaterThan( 0.6 );
		expect( a.quality?.share ).toBeLessThan( 0.8 );
		// Without the question in the form: the persona's share.
		const noField = predict( funnel(), model( { qualified: { label: 'own the house', field: null, options: [], share: { p1: 0.4 } } } ) );
		expect( noField.quality?.byAnswers ).toBe( false );
		expect( noField.quality?.share ).toBeGreaterThan( 0.35 );
		expect( noField.quality?.share ).toBeLessThan( 0.45 );
		const removed = predict( funnel(), { ...byAnswer, qualified: { label: 'x', field: 'f_gone', options: [ 'o_house' ], share: { p1: 0.2 } } } );
		expect( removed.quality?.byAnswers ).toBe( false );

		// A qualifying question costs a little and brings better leads: offered, after the ones for more leads.
		const better = { id: 'q', kind: 'qualify' as const, goal: 'better' as const, quality: 0.12, node: 'q2', field: null, title: 'Zeitpunkt abfragen', reason: '', instruction: 'Frag nach dem Zeitpunkt.', effect: [ { node: 'q2', delta: -0.02 } ], source: { rule: 'qualifying_question', origin: 'assumption' as const, text: 'Erfahrungswert.' } };
		const m = model( { qualified: byAnswer.qualified, suggestions: [ better, ...model().suggestions ] } );
		const b = predict( funnel(), m );
		expect( b.suggestions.map( ( s ) => s.id ) ).toEqual( [ 's1', 'q' ] );
		const q = b.suggestions.find( ( s ) => 'q' === s.id );
		expect( q?.gain ).toBeLessThan( 0 );
		expect( q?.qualityShare ).toBeCloseTo( ( b.quality?.share ?? 0 ) + 0.12, 1 );
		expect( worthApplying( b.suggestions ).map( ( s ) => s.id ) ).toEqual( [ 's1', 'q' ] );
		expect( isBetter( { goal: 'better', quality: 0.001 } ) ).toBe( false );
		// Not perfect while better leads are possible; applied, the share of qualified leads rises.
		const allMore = predict( funnel(), m, 10000, undefined, [ 's1' ] );
		expect( funnelScore( allMore ) ).toBe( 99 );
		const both = predict( funnel(), m, 10000, undefined, [ 's1', 'q' ] );
		expect( funnelScore( both ) ).toBe( 100 );
		expect( both.quality?.share ).toBeCloseTo( ( allMore.quality?.share ?? 0 ) + 0.12, 1 );
	} );

	it( 'puts the instructions of several suggestions into as few prompts for the AI as fit', () => {
		expect( applyPrompts( [ { id: 'a', instruction: 'Make the phone optional.' } ] ) ).toEqual( [ { ids: [ 'a' ], prompt: 'Make the phone optional.' } ] );
		expect( applyPrompts( [ { id: 'a', instruction: 'One.' }, { id: 'b', instruction: ' Two. ' } ] ) ).toEqual( [ { ids: [ 'a', 'b' ], prompt: 'Make these changes to the form:\n1. One.\n2. Two.' } ] );
		const long = 'x'.repeat( 900 );
		const prompts = applyPrompts( [ 'a', 'b', 'c', 'd' ].map( ( id ) => ( { id, instruction: long } ) ) );
		expect( prompts.map( ( p ) => p.ids ) ).toEqual( [ [ 'a', 'b' ], [ 'c', 'd' ] ] );
		expect( prompts.every( ( p ) => p.prompt.length <= 2000 ) ).toBe( true );
		expect( applyPrompts( [] ) ).toEqual( [] );
	} );
} );
