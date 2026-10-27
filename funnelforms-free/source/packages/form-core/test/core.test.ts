import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Condition, Field, FormDocument } from '@funnelforms/form-schema';
import { assignVariants, holds, next, pickText, progressMap, shownAnswers, startNode, toInt, usesCalculations } from '../src';

const here = dirname( fileURLToPath( import.meta.url ) );
const examples = join( here, '../../form-schema/test/examples' );

interface Vector {
	doc: string;
	node: string;
	answers: Record<string, unknown>;
	next: string | null;
}

const load = ( name: string ): FormDocument => JSON.parse( readFileSync( join( examples, `${ name }.json` ), 'utf8' ) ) as FormDocument;

describe( 'navigation vectors from the plugin', () => {
	const vectors = JSON.parse( readFileSync( join( here, 'vectors.json' ), 'utf8' ) ) as { cases: Vector[] };
	const docs = new Map<string, FormDocument>();

	it( 'has cases', () => {
		expect( vectors.cases.length ).toBeGreaterThan( 100 );
	} );

	it( 'picks the same next node as the server', () => {
		for ( const vector of vectors.cases ) {
			if ( ! docs.has( vector.doc ) ) {
				docs.set( vector.doc, load( vector.doc ) );
			}
			const doc = docs.get( vector.doc ) as FormDocument;
			expect( next( doc, vector.node, vector.answers ), `${ vector.doc } ${ vector.node } ${ JSON.stringify( vector.answers ) }` ).toBe( vector.next );
		}
	} );
} );

describe( 'condition cases shared with the plugin', () => {
	const shared = JSON.parse( readFileSync( join( here, 'conditions.json' ), 'utf8' ) ) as { today: string; formats: Record<string, string>; cases: Array<{ note: string; condition: Condition; answers: Record<string, unknown>; holds: boolean }> };

	it( 'holds as the plugin decides', () => {
		for ( const c of shared.cases ) {
			expect( holds( c.condition, c.answers, {}, {}, { today: shared.today, formats: shared.formats } ), c.note ).toBe( c.holds );
		}
	} );

	it( 'reads date formats from the document in next()', () => {
		const doc = {
			nodes: [ { id: 'a', type: 'step' as const, fields: [ { id: 'g', key: 'g', type: 'date' as const, label: {}, description: {}, required: true, props: { placeholder: {}, format: 'mm/dd/yy' } } ] } ],
			edges: [
				{ id: 'e1', from: 'a', to: 'soon', when: { field: 'g', op: 'dateBefore' as const, value: 'today', days: 7 } },
				{ id: 'e2', from: 'a', to: 'later', default: true },
			],
		};
		expect( next( doc, 'a', { g: '10/20/2026' }, {}, {}, '2026-10-16' ) ).toBe( 'soon' );
		expect( next( doc, 'a', { g: '10/23/2026' }, {}, {}, '2026-10-16' ) ).toBe( 'later' );
	} );
} );

describe( 'conditions', () => {
	it( 'treats NaN like the browser', () => {
		expect( holds( { field: 'f', op: 'lt', value: 1, number: 'int' }, { f: 'abc' } ) ).toBe( false );
		expect( holds( { field: 'f', op: 'neq', value: 1, number: 'int' }, { f: 'abc' } ) ).toBe( true );
		expect( toInt( '0x1A' ) ).toBe( 26 );
	} );

	it( 'distinguishes selected and selectedOnly', () => {
		expect( holds( { field: 'f', op: 'selected', value: 'a' }, { f: [ 'a', 'b' ] } ) ).toBe( true );
		expect( holds( { field: 'f', op: 'selectedOnly', value: 'a' }, { f: [ 'a', 'b' ] } ) ).toBe( false );
	} );

	it( 'compares calculation results the plugin computed', () => {
		const doc = {
			edges: [
				{ id: 'e1', from: 'a', to: 'hot', when: { all: [ { calc: 'score', op: 'gte' as const, value: 50 } ] } },
				{ id: 'e2', from: 'a', to: 'cold', default: true },
				{ id: 'e3', from: 'b', to: 'c', when: { field: 'f', op: 'eq' as const, value: 1 } },
			],
		};
		expect( next( doc, 'a', {}, { score: 50 } ) ).toBe( 'hot' );
		expect( next( doc, 'a', {}, { score: 49 } ) ).toBe( 'cold' );
		// Without a result the comparison fails, like NaN.
		expect( next( doc, 'a', {} ) ).toBe( 'cold' );
		expect( holds( { calc: 'score', op: 'neq', value: 1 }, {} ) ).toBe( true );
		expect( usesCalculations( doc, 'a' ) ).toBe( true );
		expect( usesCalculations( doc, 'b' ) ).toBe( false );
	} );
} );

describe( 'texts and progress', () => {
	it( 'falls back to the default locale', () => {
		expect( pickText( { de_DE: 'Hallo', en_US: 'Hello' }, 'fr_FR', 'en_US' ) ).toBe( 'Hello' );
		expect( pickText( { de_DE: 'Hallo' }, 'fr_FR', 'en_US' ) ).toBe( 'Hallo' );
	} );

	it( 'measures progress by depth', () => {
		const progress = progressMap( load( 'synthetic-kitchen-sink' ) );
		expect( progress.get( 'n0_0' ) ).toBe( 0 );
		expect( progress.get( 'n1_1' ) ).toBeCloseTo( 2 / 3 );
		expect( progress.get( 'n2_0' ) ).toBe( 1 );
	} );
} );

describe( 'A/B tests', () => {
	const doc = {
		start: 'n0',
		experiments: [
			{ id: 'whole', status: 'running' as const, variants: [ { id: 'a', weight: 25 }, { id: 'b', weight: 75, start: 'n9' } ] },
			{ id: 'step', status: 'running' as const, variants: [ { id: 'a', weight: 0 }, { id: 'b', weight: 1 } ] },
			{ id: 'done', status: 'stopped' as const, winner: 'b', variants: [ { id: 'a', weight: 50 }, { id: 'b', weight: 50 } ] },
			{ id: 'off', status: 'stopped' as const, variants: [ { id: 'a', weight: 50 }, { id: 'b', weight: 50 } ] },
		],
		edges: [
			{ id: 'e1', from: 'n0', to: 'n1', when: { experiment: 'step', variant: 'b' } },
			{ id: 'e2', from: 'n0', to: 'n2', default: true },
		],
	};

	it( 'draws variants by weight and settles stopped tests', () => {
		expect( assignVariants( doc, () => 0.2 ) ).toEqual( { whole: 'a', step: 'b', done: 'b', off: 'a' } );
		expect( assignVariants( doc, () => 0.25 ) ).toEqual( { whole: 'b', step: 'b', done: 'b', off: 'a' } );
		expect( assignVariants( doc, () => 0.999 ).whole ).toBe( 'b' );
		// A preview link may pick a variant of a running test, never of a stopped one.
		expect( assignVariants( doc, () => 0.9, { whole: 'a', step: 'a', done: 'a', off: 'x' } ) ).toEqual( { whole: 'a', step: 'a', done: 'b', off: 'a' } );
	} );

	it( 'starts at the variant\'s node and follows variant edges', () => {
		expect( startNode( doc, { whole: 'b' } ) ).toBe( 'n9' );
		expect( startNode( doc, { whole: 'a' } ) ).toBe( 'n0' );
		expect( next( doc, 'n0', {}, {}, { step: 'b' } ) ).toBe( 'n1' );
		expect( next( doc, 'n0', {}, {}, { step: 'a' } ) ).toBe( 'n2' );
		expect( next( doc, 'n0', {} ) ).toBe( 'n2' );
	} );
} );

describe( 'fields shown on answers, shared with the plugin', () => {
	const shared = JSON.parse( readFileSync( join( here, 'shown.json' ), 'utf8' ) ) as { today: string; cases: Array<{ note: string; steps: Field[][]; answers: Record<string, unknown>; variants?: Record<string, string>; shown: string[]; given: Record<string, unknown> }> };

	it( 'shows and hides as the plugin does', () => {
		for ( const c of shared.cases ) {
			const result = shownAnswers( c.steps.map( ( fields ) => ( { fields } ) ), c.answers, c.variants ?? {}, shared.today );
			expect( [ ...result.fields ], c.note ).toEqual( c.shown );
			expect( result.answers, c.note ).toEqual( c.given );
		}
	} );
} );
