import { describe, expect, it } from 'vitest';
import { checkReferences, validateDocument, type FormDocument } from '@funnelforms/form-schema';
import { addStep, connect, setCondition } from '../src/document';
import { next } from '../../form-core/src/conditions';
import type { ExperimentStats } from '../src/api';
import { addDesignTest, addStepTest, addVariant, endTest, nextPlanned, nextRound, planLater, runAgain, runTime, setVariantStyle, shareOf, splitEvenly, stepTestRefusal, suggestWinner, takeSchedule, testKind, testOf, testSteps, today, variantRefusal, waitsForDecision } from '../src/experiments';
import { blank } from './blank';

const ctx = { locale: 'de_DE' };
const labels = { name: 'Frage kürzer', a: 'Original', b: 'Kürzer' };

/** Start → choice → (option 1: text) / (otherwise: contact); text → contact. */
function funnel(): { doc: FormDocument; choice: string; text: string } {
	const doc = blank();
	const choice = addStep( doc, 'choice', ctx, { before: doc.start } );
	const text = addStep( doc, 'text', ctx );
	connect( doc, text, 'contact' );
	const node = doc.nodes.find( ( n ) => n.id === choice );
	const field = node && 'step' === node.type ? node.fields[ 0 ] : undefined;
	const option = field && 'options' in field ? field.options[ 0 ] : undefined;
	connect( doc, choice, text, { field: field?.id ?? '', op: 'selected', value: option?.id ?? '' } );
	// A later path that asks the choice again.
	const later = connect( doc, text, 'contact', { field: field?.id ?? '', op: 'selected', value: option?.id ?? '' } );
	setCondition( doc, later ?? '', { field: field?.id ?? '', op: 'selected', value: option?.id ?? '' } );
	return { doc, choice, text };
}

function valid( doc: FormDocument ): void {
	expect( validateDocument( doc ).errors ).toEqual( [] );
	expect( checkReferences( doc ) ).toEqual( [] );
}

describe( 'A/B tests of a step', () => {
	it( 'copy the step and send variant B to the copy wherever the form went to the original', () => {
		const { doc, choice, text } = funnel();
		valid( doc );
		const made = addStepTest( doc, text, labels );
		expect( made ).not.toBeNull();
		const copy = made?.copy ?? '';
		valid( doc );
		expect( doc.experiments?.[ 0 ] ).toMatchObject( { name: 'Frage kürzer', status: 'running', variants: [ { id: 'a', label: 'Original', weight: 50 }, { id: 'b', label: 'Kürzer', weight: 50 } ] } );
		// Into the copy: the twin of choice → text, checked right before it.
		const fromChoice = doc.edges.filter( ( e ) => e.from === choice );
		const twin = fromChoice.findIndex( ( e ) => e.to === copy );
		expect( fromChoice[ twin + 1 ]?.to ).toBe( text );
		expect( fromChoice[ twin ]?.when ).toEqual( { all: [ fromChoice[ twin + 1 ]?.when, { experiment: made?.experiment, variant: 'b' } ] } );
		// Onward: the copy goes where the original goes, its fields keep the variable names.
		expect( doc.edges.filter( ( e ) => e.from === copy ).map( ( e ) => e.to ) ).toEqual( doc.edges.filter( ( e ) => e.from === text ).map( ( e ) => e.to ) );
		const original = doc.nodes.find( ( n ) => n.id === text );
		const twinNode = doc.nodes.find( ( n ) => n.id === copy );
		expect( twinNode && 'step' === twinNode.type ? twinNode.fields.map( ( f ) => f.key ) : [] ).toEqual( original && 'step' === original.type ? original.fields.map( ( f ) => f.key ) : [ 'x' ] );
		expect( testSteps( doc, made?.experiment ?? '' ) ).toEqual( new Map( [ [ 'b', [ copy ] ], [ 'a', [ text ] ] ] ) );
	} );

	it( 'test the first step through the start of variant B and remap later conditions', () => {
		const { doc, choice } = funnel();
		const made = addStepTest( doc, choice, labels );
		valid( doc );
		expect( doc.experiments?.[ 0 ]?.variants[ 1 ]?.start ).toBe( made?.copy );
		expect( testSteps( doc, made?.experiment ?? '' ).get( 'a' ) ).toEqual( [ choice ] );
		// The later path on the choice also holds for the same answer in the copy.
		const later = doc.edges.find( ( e ) => e.from !== choice && e.from !== made?.copy && e.when );
		expect( later?.when && 'any' in later.when ? later.when.any : [] ).toHaveLength( 2 );
		// Only one test may set start nodes; other steps can still be tested.
		expect( stepTestRefusal( doc, doc.start ) ).toBe( 'start_taken' );
		expect( stepTestRefusal( doc, made?.copy ?? '' ) ).toBeNull();
		expect( stepTestRefusal( doc, 'contact' ) ).toBe( 'not_a_step' );
	} );

	it( 'end with the kept variant for everyone', () => {
		const keepA = funnel();
		const a = addStepTest( keepA.doc, keepA.text, labels );
		endTest( keepA.doc, a?.experiment ?? '', 'a' );
		valid( keepA.doc );
		expect( keepA.doc.experiments ).toBeUndefined();
		expect( keepA.doc.edges.some( ( e ) => e.to === a?.copy ) ).toBe( false );

		const keepB = funnel();
		const b = addStepTest( keepB.doc, keepB.choice, labels );
		endTest( keepB.doc, b?.experiment ?? '', 'b' );
		valid( keepB.doc );
		expect( keepB.doc.start ).toBe( b?.copy );
		expect( JSON.stringify( keepB.doc.edges ) ).not.toContain( 'experiment' );
	} );
} );

describe( 'more variants, designs and winners', () => {
	it( 'adds a variant C as a copy with its own path in and the same paths onward', () => {
		const { doc, choice, text } = funnel();
		const made = addStepTest( doc, text, labels );
		const id = made?.experiment ?? '';
		const node = doc.nodes.find( ( n ) => n.id === choice );
		const field = node && 'step' === node.type ? node.fields[ 0 ] : undefined;
		const option = field && 'options' in field ? field.options[ 0 ]?.id ?? '' : '';
		const answers = { [ field?.id ?? '' ]: [ option ] };
		expect( variantRefusal( doc, id ) ).toBeNull();
		const c = addVariant( doc, id, 'Noch kürzer' );
		expect( c ).toBe( 'c' );
		valid( doc );
		const experiment = doc.experiments?.[ 0 ];
		expect( experiment?.variants.map( ( v ) => [ v.id, v.weight ] ) ).toEqual( [ [ 'a', 33 ], [ 'b', 33 ], [ 'c', 33 ] ] );
		const copyC = testSteps( doc, id ).get( 'c' )?.[ 0 ] ?? '';
		expect( copyC ).not.toBe( made?.copy );
		expect( next( doc, choice, answers, {}, { [ id ]: 'a' } ) ).toBe( text );
		expect( next( doc, choice, answers, {}, { [ id ]: 'b' } ) ).toBe( made?.copy );
		expect( next( doc, choice, answers, {}, { [ id ]: 'c' } ) ).toBe( copyC );
		expect( next( doc, copyC, answers, {}, { [ id ]: 'c' } ) ).toBe( 'contact' );
		expect( shareOf( doc.experiments?.[ 0 ] ?? { id, status: 'running', variants: [] }, 'c' ) ).toBeCloseTo( 1 / 3 );

		// Ending the test with C keeps only its path.
		endTest( doc, id, 'c' );
		expect( next( doc, choice, answers ) ).toBe( copyC );
		valid( doc );
	} );

	it( 'tests designs with style tokens per variant and splits the shares', () => {
		const doc = blank();
		const id = addDesignTest( doc, { name: 'Lila oder Grün', a: 'Lila', b: 'Grün' } ) ?? '';
		const experiment = doc.experiments?.[ 0 ];
		expect( experiment && testKind( experiment ) ).toBe( 'design' );
		setVariantStyle( doc, id, 'b', 'color.primary', ' #1d7a46 ' );
		setVariantStyle( doc, id, 'b', 'radius.button', '24' );
		setVariantStyle( doc, id, 'b', 'radius.button', '' );
		setVariantStyle( doc, id, 'a', 'color.primary', '#000000' );
		expect( experiment?.variants ).toEqual( [
			{ id: 'a', label: 'Lila', weight: 50 },
			{ id: 'b', label: 'Grün', weight: 50, style: { 'color.primary': '#1d7a46' } },
		] );
		expect( addVariant( doc, id, 'Blau' ) ).toBe( 'c' );
		expect( experiment?.variants[ 2 ] ).toEqual( { id: 'c', label: 'Blau', weight: 33, style: {} } );
		addVariant( doc, id, 'D' );
		expect( variantRefusal( doc, id ) ).toBe( 'too_many' );
		const first = experiment?.variants[ 0 ];
		if ( experiment && first ) {
			first.weight = 80;
			splitEvenly( experiment );
		}
		expect( experiment?.variants.map( ( v ) => v.weight ) ).toEqual( [ 25, 25, 25, 25 ] );
		valid( doc );
	} );

	it( 'suggests a winner only with enough views and a clear chance', () => {
		const stats = ( b: Partial<ExperimentStats[ 'variants' ][ number ]>, views = 400 ): ExperimentStats => ( {
			id: 'ab',
			name: 'Test',
			status: 'running',
			winner: null,
			variants: [
				{ id: 'a', label: 'A', weight: 50, views, starts: 0, completions: 40, conversionRate: 0.1, uplift: null, chanceToBeatControl: null },
				{ id: 'b', label: 'B', weight: 50, views, starts: 0, completions: 60, conversionRate: 0.15, uplift: 0.5, chanceToBeatControl: 0.5, ...b },
			],
		} );
		expect( suggestWinner( undefined ) ).toBeNull();
		expect( suggestWinner( stats( {}, 60 ) ) ).toEqual( { kind: 'wait', views: 40 } );
		expect( suggestWinner( stats( { chanceToBeatControl: 0.97 } ) ) ).toEqual( { kind: 'winner', variant: 'b', chance: 0.97, uplift: 0.5 } );
		expect( suggestWinner( stats( { chanceToBeatControl: 0.8 } ) ) ).toBeNull();
		expect( suggestWinner( stats( { chanceToBeatControl: 0.02 } ) ) ).toEqual( { kind: 'control', variant: 'a', chance: 0.98 } );
	} );
} );

describe( 'the test of a step', () => {
	it( 'is found from the original and from each variant, with the step of every variant', () => {
		const { doc, text, choice } = funnel();
		expect( testOf( doc, text ) ).toBeNull();
		const made = addStepTest( doc, text, labels );
		const c = addVariant( doc, made?.experiment ?? '', 'C' );
		const steps = testOf( doc, text )?.steps ?? [];
		expect( steps.map( ( s ) => s.variant ) ).toEqual( [ 'a', 'b', c ] );
		expect( steps[ 0 ]?.node ).toBe( text );
		expect( steps[ 1 ]?.node ).toBe( made?.copy );
		expect( testOf( doc, made?.copy ?? '' ) ).toMatchObject( { variant: 'b', experiment: { id: made?.experiment } } );
		expect( testOf( doc, steps[ 2 ]?.node ?? '' )?.variant ).toBe( c );
		expect( testOf( doc, choice ) ).toBeNull();
		// A test of the design belongs to no step.
		addDesignTest( doc, labels );
		expect( testOf( doc, choice ) ).toBeNull();
	} );
} );

describe( 'the run time of a test', () => {
	it( 'runs ten days by default and counts the days without the days paused', () => {
		const { doc, text } = funnel();
		addStepTest( doc, text, labels );
		const x = doc.experiments?.[ 0 ];
		if ( ! x ) {
			throw new Error( 'no test' );
		}
		expect( [ x.days, x.onEnd ] ).toEqual( [ 10, 'apply' ] );
		expect( addDesignTest( doc, { name: 'D', a: 'A', b: 'B' } ) ).not.toBeNull();
		expect( doc.experiments?.[ 1 ]?.days ).toBe( 10 );

		expect( runTime( x, '2026-10-22' ) ).toBeNull();
		x.startedAt = '2026-10-22';
		expect( runTime( x, '2026-10-22' ) ).toEqual( { day: 1, of: 10, last: '2026-10-31' } );
		x.pausedDays = 2;
		x.extended = 5;
		expect( runTime( x, '2026-10-26' ) ).toEqual( { day: 3, of: 15, last: '2026-11-07' } );
		// Paused since the 26th: the day stands still, the last day moves.
		x.status = 'paused';
		x.pausedAt = '2026-10-26';
		expect( runTime( x, '2026-10-30' ) ).toEqual( { day: 3, of: 15, last: '2026-11-11' } );
		expect( waitsForDecision( x ) ).toBe( false );
		x.outcome = 'winner';
		expect( waitsForDecision( x ) ).toBe( true );
		valid( doc );

		runAgain( x );
		expect( x ).toMatchObject( { status: 'running', days: 10, onEnd: 'apply' } );
		expect( [ x.startedAt, x.pausedAt, x.pausedDays, x.extended, x.outcome ] ).toEqual( [ undefined, undefined, undefined, undefined, undefined ] );
		expect( today( new Date( 2026, 0, 5 ) ) ).toBe( '2026-01-05' );
	} );

	it( 'takes over the dates the plugin noted when publishing', () => {
		const doc = blank();
		addDesignTest( doc, { name: 'D', a: 'A', b: 'B' } );
		const x = doc.experiments?.[ 0 ];
		if ( ! x ) {
			throw new Error( 'no test' );
		}
		x.pausedAt = '2026-10-01';
		takeSchedule( doc, { [ x.id ]: { startedAt: '2026-10-22', pausedDays: 3 }, other: { startedAt: '2026-01-01' } } );
		expect( [ x.startedAt, x.pausedDays, x.pausedAt ] ).toEqual( [ '2026-10-22', 3, undefined ] );
	} );
} );

describe( 'a test plan', () => {
	it( 'keeps variants for later and lets the variant kept meet the next one', () => {
		const { doc, text } = funnel();
		addStepTest( doc, text, labels );
		const x = doc.experiments?.[ 0 ];
		if ( ! x ) {
			throw new Error( 'no test' );
		}
		addVariant( doc, x.id, 'C' );
		addVariant( doc, x.id, 'D' );
		planLater( x, 'c', true );
		planLater( x, 'd', true );
		expect( x.variants.map( ( v ) => [ v.id, v.weight, !! v.planned ] ) ).toEqual( [
			[ 'a', 50, false ],
			[ 'b', 50, false ],
			[ 'c', 0, true ],
			[ 'd', 0, true ],
		] );
		// Two variants stay in the round.
		planLater( x, 'b', true );
		expect( x.variants[ 1 ]?.planned ).toBeUndefined();
		expect( nextPlanned( x )?.id ).toBe( 'c' );
		valid( doc );

		x.startedAt = '2026-10-01';
		x.status = 'paused';
		x.outcome = 'winner';
		x.suggested = 'b';
		nextRound( x, 'b' );
		expect( x.variants.map( ( v ) => [ v.id, v.weight, v.planned ?? false, v.retired ?? false ] ) ).toEqual( [
			[ 'b', 50, false, false ],
			[ 'c', 50, false, false ],
			[ 'a', 0, false, true ],
			[ 'd', 0, true, false ],
		] );
		expect( [ x.status, x.startedAt, x.outcome, x.suggested ] ).toEqual( [ 'running', undefined, undefined, undefined ] );
		valid( doc );

		// The variant kept can win again; the last round leaves no plan.
		nextRound( x, 'b' );
		expect( x.variants.map( ( v ) => [ v.id, v.weight ] ) ).toEqual( [
			[ 'b', 50 ],
			[ 'd', 50 ],
			[ 'c', 0 ],
			[ 'a', 0 ],
		] );
		expect( nextPlanned( x ) ).toBeNull();
		splitEvenly( x );
		expect( x.variants.map( ( v ) => v.weight ) ).toEqual( [ 50, 50, 0, 0 ] );
		planLater( x, 'a', false );
		expect( x.variants[ 3 ]?.retired ).toBe( true );
	} );
} );
