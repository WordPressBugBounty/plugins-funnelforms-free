import { describe, expect, it } from 'vitest';
import type { ExpressionNode, Field, FormDocument } from '@funnelforms/form-schema';
import { calculationUses, dateDay, evaluate, formulaVars, parseFormula, printFormula, rangeText, testValues } from '../src/calculations';
import { blank } from './blank';
import fixture from './calc-functions.json';

/** clamp, lookup, days and age; the plugin's CalculatorFunctionsTest computes the same trees. */
const shared = fixture as unknown as {
	today: string;
	fields: Field[];
	answers: Record<string, unknown>;
	values: Record<string, number>;
	cases: Array<{ formula: string | null; tree: ExpressionNode; result: number | null }>;
};

const [ y, m, d ] = shared.today.split( '-' ).map( Number ) as [ number, number, number ];
const today = Date.UTC( y, m - 1, d ) / 86400000;
const doc = { nodes: [ { id: 'n1', type: 'step', fields: shared.fields } ], calculations: [] } as unknown as Pick<FormDocument, 'nodes' | 'calculations'>;
const values = { ...testValues( doc, shared.answers, today ), ...shared.values };

describe( 'new functions', () => {
	for ( const c of shared.cases ) {
		it( c.formula ?? JSON.stringify( c.tree ), () => {
			if ( c.formula ) {
				const r = parseFormula( c.formula );
				expect( r.ok && r.expression ).toEqual( c.tree );
				expect( printFormula( c.tree ) ).toBe( c.formula );
			}
			const result = evaluate( c.tree, values );
			if ( null === c.result ) {
				expect( result ).toBeNull();
			} else {
				expect( result ).toBeCloseTo( c.result, 9 );
			}
		} );
	}

	it( 'read dates as day numbers like the plugin', () => {
		expect( dateDay( '21.10.2026', 'dd.mm.yy' ) ).toBe( 20747 );
		expect( dateDay( '1969-12-31', 'yy-mm-dd' ) ).toBe( -1 );
		expect( dateDay( '31.02.2026', 'dd.mm.yy' ) ).toBeNull();
		expect( values[ 'date:stay' ] ).toBe( 20635 );
		expect( values[ 'date:stay:end' ] ).toBe( 20642 );
		expect( values[ 'count:move' ] ).toBe( 1 );
		expect( 'date:missing' in values ).toBe( false );
	} );

	it( 'check their arguments and name the fields they use', () => {
		expect( parseFormula( 'lookup([a]; 1; 2)' ) ).toMatchObject( { ok: false, error: 'arguments' } );
		expect( parseFormula( 'lookup([a]; 1; 2; 3; 4)' ) ).toMatchObject( { ok: false, error: 'arguments' } );
		expect( parseFormula( 'clamp([a]; 1)' ) ).toMatchObject( { ok: false, error: 'arguments' } );
		expect( parseFormula( 'days()' ) ).toMatchObject( { ok: false } );
		expect( parseFormula( 'age([a]; [b]; [c])' ) ).toMatchObject( { ok: false, error: 'arguments' } );
		expect( parseFormula( 'date(5)' ) ).toMatchObject( { ok: false, error: 'unexpected' } );
		const r = parseFormula( 'days([from]; [to]) * [price]' );
		expect( r.ok && r.vars ).toEqual( [ 'from', 'to', 'price' ] );
		expect( formulaVars( { fn: 'age', args: [ { date: 'birth' } ] } ) ).toEqual( [ 'birth' ] );
		// Only a bare [key] is a date; inside a sum it stays the number of the answer.
		expect( parseFormula( 'days([a] + 1)' ) ).toMatchObject( { ok: true, expression: { fn: 'days', args: [ { op: '+', args: [ { var: 'a' }, { num: 1 } ] } ] } } );
	} );
} );

describe( 'texts by range', () => {
	const calc = {
		texts: [
			{ to: 40, text: { de_DE: 'Einsteiger' } },
			{ from: 41, to: 70, text: { de_DE: 'Fortgeschritten' } },
			{ from: 70, text: { de_DE: 'Profi' } },
		],
	};
	it( 'take the first range that holds the result, as the plugin', () => {
		expect( rangeText( calc, -5 ) ).toEqual( { de_DE: 'Einsteiger' } );
		expect( rangeText( calc, 40 ) ).toEqual( { de_DE: 'Einsteiger' } );
		expect( rangeText( calc, 40.5 ) ).toBeNull();
		expect( rangeText( calc, 70 ) ).toEqual( { de_DE: 'Fortgeschritten' } );
		expect( rangeText( calc, 70.1 ) ).toEqual( { de_DE: 'Profi' } );
		expect( rangeText( { texts: [ { to: 0.3, text: { de_DE: 'a' } } ] }, 0.1 + 0.2 ) ).toEqual( { de_DE: 'a' } );
		expect( rangeText( calc, null ) ).toBeNull();
		expect( rangeText( {}, 10 ) ).toBeNull();
	} );

	it( 'count as a use of the calculation, as does the lead value', () => {
		const form = blank();
		form.calculations.push( { id: 'c1', label: 'Score', expression: { num: 1 }, format: { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.' } } );
		expect( calculationUses( form, 'c1' ) ).toEqual( [] );
		form.settings.valueCalculation = 'c1';
		expect( calculationUses( form, 'c1' ) ).toEqual( [ 'value' ] );
		delete form.settings.valueCalculation;
		const end = form.nodes.find( ( n ) => 'end' === n.type );
		if ( end && 'end' === end.type ) {
			end.success = { show: true, text: { de_DE: 'Dein Typ: {{calc:c1:text}}' } };
		}
		expect( calculationUses( form, 'c1' ) ).toEqual( [ 'text' ] );
	} );
} );
