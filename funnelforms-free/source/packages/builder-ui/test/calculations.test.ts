import { describe, expect, it } from 'vitest';
import { validateDocument, type ChoiceField, type ExpressionNode, type FormDocument } from '@funnelforms/form-schema';
import { addStep, createField } from '../src/document';
import { addCalculation, addResultStep, calculationUses, evaluate, formatResult, formulaRefs, formulaVars, localeCurrency, localeFormat, nameCalculation, parseFormula, printFormula, readFormula, removeCalculation, renameFieldKey, resultPlaces, setFormula, showResultIn, testValues } from '../src/calculations';
import { blank } from './blank';
import calcVectors from './calc-vectors.json';

/** Formulas, their trees and results; the plugin's CalculatorTest computes the same trees. */
const vectors = calcVectors as unknown as {
	values: Record<string, number>;
	cases: Array<{ formula: string; tree: ExpressionNode; result: number | null }>;
};

function tree( source: string ): ExpressionNode {
	const r = parseFormula( source );
	if ( ! r.ok ) {
		throw new Error( `${ r.error } at ${ r.at }` );
	}
	return r.expression;
}

describe( 'formulas', () => {
	it( 'are read with the usual order and printed back', () => {
		expect( tree( '[a] + [b] * 2' ) ).toEqual( { op: '+', args: [ { var: 'a' }, { op: '*', args: [ { var: 'b' }, { num: 2 } ] } ] } );
		expect( tree( '2 * 3 ^ 2' ) ).toEqual( { op: '*', args: [ { num: 2 }, { op: '^', args: [ { num: 3 }, { num: 2 } ] } ] } );
		expect( tree( '-[x] ^ 2' ) ).toEqual( { neg: { op: '^', args: [ { var: 'x' }, { num: 2 } ] } } );
		expect( tree( '2 ^ 3 ^ 2' ) ).toEqual( { op: '^', args: [ { num: 2 }, { op: '^', args: [ { num: 3 }, { num: 2 } ] } ] } );
		expect( tree( '2,5 * [qm-preis]' ) ).toEqual( { op: '*', args: [ { num: 2.5 }, { var: 'qm-preis' } ] } );
		for ( const source of [ '([a] + [b]) * 1.19', '[a] - ([b] - [c])', '[a] / ([b] * [c])', '(2 * 3) ^ 2', '-([a] + 1)', '[a] % 3 + 0.5', '2 ^ -[x]', '1000000000000000000000 * 0.000001' ] ) {
			expect( printFormula( tree( source ) ), source ).toBe( source );
		}
		const r = parseFormula( '[anzahl] * [preis] + [anzahl]' );
		expect( r.ok && r.vars ).toEqual( [ 'anzahl', 'preis' ] );
	} );

	it( 'keep the order of trees migrated from Funnelforms 3', () => {
		// 3.x computed 2*3^2 left to right: (2*3)^2.
		const legacy: ExpressionNode = { op: '^', args: [ { op: '*', args: [ { num: 2 }, { num: 3 } ] }, { num: 2 } ] };
		expect( printFormula( legacy ) ).toBe( '(2 * 3) ^ 2' );
		expect( tree( printFormula( legacy ) ) ).toEqual( legacy );
		const signs: ExpressionNode = { op: '-', args: [ { num: 5 }, { num: -3 } ] };
		expect( evaluate( tree( printFormula( signs ) ), {} ) ).toBe( 8 );
	} );

	it( 'say where they cannot be read', () => {
		expect( parseFormula( '  ' ) ).toEqual( { ok: false, error: 'empty', at: 0 } );
		expect( parseFormula( '[a] +' ) ).toEqual( { ok: false, error: 'end', at: 5 } );
		expect( parseFormula( '([a] + 1' ) ).toEqual( { ok: false, error: 'parenthesis', at: 0 } );
		expect( parseFormula( '[a] + 1)' ) ).toEqual( { ok: false, error: 'parenthesis', at: 7 } );
		expect( parseFormula( '[a] x 2' ) ).toEqual( { ok: false, error: 'unexpected', at: 4 } );
		expect( parseFormula( '[a b]' ) ).toEqual( { ok: false, error: 'unexpected', at: 0 } );
	} );

	it( 'compute like the plugin', () => {
		expect( evaluate( tree( '([a] + [b]) * 1.19' ), { a: 100, b: 50 } ) ).toBeCloseTo( 178.5 );
		expect( evaluate( tree( '[missing] + 1' ), {} ) ).toBe( 1 );
		expect( evaluate( tree( '7.9 % 3' ), {} ) ).toBe( 1 );
		expect( evaluate( tree( '1 / [a]' ), { a: 0 } ) ).toBeNull();
		expect( evaluate( tree( '1 % 0.5' ), {} ) ).toBeNull();
		expect( formatResult( 1234567.125, { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.' } ) ).toBe( '1.234.567,13' );
		expect( formatResult( -2.5, { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.' } ) ).toBe( '-3' );
		expect( formatResult( 1.005, { decimals: 2, decimalSeparator: '.', thousandsSeparator: ',' } ) ).toBe( '1.01' );
		expect( formatResult( 999.5, { decimals: 0, decimalSeparator: '.', thousandsSeparator: ',' } ) ).toBe( '1,000' );
		expect( formatResult( 1499, { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.', suffix: ' €' } ) ).toBe( '1.499,00 €' );
		expect( formatResult( -5, { decimals: 0, decimalSeparator: '.', thousandsSeparator: ',', prefix: '$' } ) ).toBe( '$-5' );
	} );
} );

describe( 'functions', () => {
	it.each( vectors.cases )( '$formula', ( { formula, tree: expected, result } ) => {
		const tree2 = tree( formula );
		expect( tree2 ).toEqual( expected );
		const value = evaluate( tree2, vectors.values );
		if ( null === result ) {
			expect( value ).toBeNull();
		} else {
			expect( value ).toBeCloseTo( result, 9 );
		}
		// Printed back, the formula reads as the same tree.
		expect( tree( printFormula( tree2 ) ) ).toEqual( tree2 );
	} );

	it( 'are printed in one way', () => {
		expect( printFormula( tree( 'ROUND( [a] ,2 )' ) ) ).toBe( 'round([a]; 2)' );
		expect( printFormula( tree( '[a]==1' ) ) ).toBe( '[a] = 1' );
		expect( printFormula( tree( '([a] > 1) + ([b] > 1)' ) ) ).toBe( '([a] > 1) + ([b] > 1)' );
		expect( printFormula( tree( 'if([a] >= 10 ; [a] * 0,9 ; [a])' ) ) ).toBe( 'if([a] >= 10; [a] * 0.9; [a])' );
		expect( printFormula( tree( 'count( [farben] ) + [q:typ] + { calc_1 }' ) ) ).toBe( 'count([farben]) + [q:typ] + {calc_1}' );
	} );

	it( 'name what is wrong', () => {
		expect( parseFormula( 'runden([a])' ) ).toEqual( { ok: false, error: 'function', at: 0 } );
		expect( parseFormula( 'round([a]; 2; 3)' ) ).toEqual( { ok: false, error: 'arguments', at: 0 } );
		expect( parseFormula( 'if([a])' ) ).toEqual( { ok: false, error: 'arguments', at: 0 } );
		expect( parseFormula( 'max([a]; [b]' ) ).toEqual( { ok: false, error: 'parenthesis', at: 0 } );
		expect( parseFormula( 'count(3)' ) ).toMatchObject( { ok: false, error: 'unexpected' } );
		expect( parseFormula( '{a b}' ) ).toMatchObject( { ok: false, error: 'unexpected' } );
		expect( parseFormula( '[a] < [b] < 3' ) ).toMatchObject( { ok: false, error: 'unexpected' } );
	} );

	it( 'list the fields and calculations they use', () => {
		const t = tree( 'count([a]) + [b:typ] + [c] * {total}' );
		expect( formulaVars( t ) ).toEqual( [ 'a', 'b', 'c' ] );
		expect( formulaRefs( t ) ).toEqual( [ 'total' ] );
		const r = parseFormula( 'count([a]) + [a:x]' );
		expect( r.ok && r.vars ).toEqual( [ 'a' ] );
	} );
} );

describe( 'results of other calculations', () => {
	it( 'are used without cycles', () => {
		const doc = blank();
		const net = addCalculation( doc, 'Netto' );
		const gross = addCalculation( doc, 'Brutto' );
		expect( setFormula( doc, net, '100' ).ok ).toBe( true );
		expect( setFormula( doc, gross, `{${ net }} * 1.19` ).ok ).toBe( true );
		expect( readFormula( doc, net, `{${ gross }} + 1` ) ).toMatchObject( { ok: false, error: 'cycle' } );
		expect( readFormula( doc, net, `{${ net }}` ) ).toMatchObject( { ok: false, error: 'cycle' } );
		expect( readFormula( doc, net, '{nowhere}' ) ).toMatchObject( { ok: false, error: 'reference', ref: 'nowhere' } );
		expect( calculationUses( doc, net ) ).toEqual( [ 'calculation' ] );
		expect( removeCalculation( doc, net ) ).toBe( false );
		expect( testValues( doc, {} )[ 'calc:' + gross ] ).toBeCloseTo( 119 );
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );
} );

describe( 'test values', () => {
	it( 'follow the answers like the plugin', () => {
		const doc: FormDocument = blank();
		const field: ChoiceField = {
			id: 'q1',
			key: 'extras',
			type: 'choice',
			label: { de_DE: 'Extras' },
			description: { de_DE: '' },
			required: false,
			options: [
				{ id: 'o1', label: { de_DE: 'A' }, value: 'a', calcValue: 10, scores: { ruhig: 2 } },
				{ id: 'o2', label: { de_DE: 'B' }, value: 'b', calcValue: 5.5, scores: { ruhig: 1, wild: 3 } },
			],
			props: { multiple: true, layout: { desktop: 'grid', mobile: 'grid' }, hideIcons: false },
		};
		doc.nodes.push( { id: 'n1', type: 'step', fields: [ field ] } );
		const id = addCalculation( doc, 'Preis' );
		setFormula( doc, id, '[extras] * 2 + count([extras]) + [extras:wild]' );
		const values = testValues( doc, { q1: [ 'o1', 'o2' ] } );
		expect( values ).toMatchObject( { extras: 15.5, 'count:extras': 2, 'score:extras:ruhig': 3, 'score:extras:wild': 3 } );
		expect( values[ 'calc:' + id ] ).toBeCloseTo( 36 );
		expect( testValues( doc, {} )[ 'calc:' + id ] ).toBe( 0 );
	} );
} );

describe( 'calculations', () => {
	it( 'are added in the format of the form language and stay valid', () => {
		const doc = blank();
		const id = addCalculation( doc, 'Preis' );
		expect( doc.calculations[ 0 ] ).toMatchObject( { id, label: 'Preis', format: localeFormat( 'de_DE' ) } );
		expect( localeFormat( 'en_US' ).decimalSeparator ).toBe( '.' );
		const calc = doc.calculations[ 0 ];
		if ( calc ) {
			calc.legacy = { formula: '[651]*2', error: 'unknown_function' };
		}
		expect( setFormula( doc, id, '[a] +' ).ok ).toBe( false );
		expect( doc.calculations[ 0 ]?.legacy ).toBeDefined();
		expect( setFormula( doc, id, '[name] * 2' ).ok ).toBe( true );
		expect( doc.calculations[ 0 ]?.legacy ).toBeUndefined();
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );

	it( 'are not deleted while something uses them', () => {
		const doc = blank();
		const id = addCalculation( doc, 'Score' );
		expect( calculationUses( doc, id ) ).toEqual( [] );
		const contact = doc.nodes.find( ( n ) => 'contact' === n.type );
		if ( contact && 'contact' === contact.type ) {
			contact.description = { de_DE: 'Dein Preis: {{calc:' + id + '}}' };
		}
		doc.settings.scoreCalculation = id;
		expect( calculationUses( doc, id ) ).toEqual( [ 'text', 'score' ] );
		expect( removeCalculation( doc, id ) ).toBe( false );
		delete doc.settings.scoreCalculation;
		if ( contact && 'contact' === contact.type ) {
			contact.description = { de_DE: '' };
		}
		expect( removeCalculation( doc, id ) ).toBe( true );
		expect( doc.calculations ).toEqual( [] );
	} );
} );

describe( 'live results', () => {
	it( 'show the first calculation and keep the ones they show', () => {
		const doc = blank();
		const ctx = { locale: 'de_DE' };
		const empty = createField( doc, 'result', ctx );
		expect( empty.type === 'result' && empty.props ).toEqual( { style: 'sticky', lines: [] } );
		expect( empty.required ).toBe( false );
		const low = addCalculation( doc, 'Ab' );
		const high = addCalculation( doc, 'Bis' );
		const nodeId = addStep( doc, 'number', ctx );
		const node = doc.nodes.find( ( n ) => n.id === nodeId );
		const field = createField( doc, 'result', { locale: 'de_DE', labels: { liveResult: 'Ihr Preis', liveTotal: 'Gesamt' } } );
		expect( field ).toMatchObject( { label: { de_DE: 'Ihr Preis' }, props: { style: 'sticky', lines: [ { calculation: low, label: { de_DE: 'Gesamt' } } ] } } );
		const line = 'result' === field.type ? field.props.lines[ 0 ] : undefined;
		if ( node && 'step' === node.type && line ) {
			line.to = high;
			node.fields.push( field );
		}
		expect( calculationUses( doc, low ) ).toEqual( [ 'result' ] );
		expect( calculationUses( doc, high ) ).toEqual( [ 'result' ] );
		expect( removeCalculation( doc, high ) ).toBe( false );
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );
} );

describe( 'result steps', () => {
	it( 'show the result before the contact step', () => {
		const doc = blank();
		const id = addCalculation( doc, 'Preis <netto>' );
		const nodeId = addResultStep( doc, id, { locale: 'de_DE' } );
		const node = doc.nodes.find( ( n ) => n.id === nodeId );
		const field = node && 'step' === node.type ? node.fields[ 0 ] : undefined;
		expect( field && 'content' === field.type ? field.props.html.de_DE : '' ).toBe( `<p>Preis netto: <strong>{{calc:${ id }}}</strong></p>` );
		expect( doc.start ).toBe( nodeId );
		expect( calculationUses( doc, id ) ).toEqual( [ 'text' ] );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		expect( addResultStep( doc, 'missing', { locale: 'de_DE' } ) ).toBeNull();
	} );
} );

describe( 'friendly defaults', () => {
	it( 'give prices whole numbers and the currency of the language until the format is changed', () => {
		const doc = blank();
		const id = addCalculation( doc, 'Berechnung 1' );
		nameCalculation( doc, id, 'Punkte' );
		expect( doc.calculations[ 0 ]?.format ).toEqual( localeFormat( 'de_DE' ) );
		nameCalculation( doc, id, 'Gesamtpreis' );
		expect( doc.calculations[ 0 ] ).toMatchObject( { label: 'Gesamtpreis', format: { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.', suffix: ' €' } } );
		// A format someone chose stays.
		const other = addCalculation( doc, 'x' );
		const calc = doc.calculations.find( ( c ) => c.id === other );
		if ( calc ) {
			calc.format.decimals = 2;
			calc.format.suffix = ' m²';
		}
		nameCalculation( doc, other, 'Kosten' );
		expect( calc?.format ).toMatchObject( { decimals: 2, suffix: ' m²' } );
		expect( localeCurrency( 'en_US' ) ).toEqual( { prefix: '$' } );
		expect( localeCurrency( 'de_CH' ) ).toEqual( { prefix: 'CHF ' } );
		expect( localeCurrency( 'fr_FR' ) ).toEqual( { suffix: ' €' } );
		expect( localeCurrency( 'pl_PL' ) ).toBeNull();
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );

	it( 'rename a variable in formulas and placeholders', () => {
		const doc = blank();
		const ctx = { locale: 'de_DE' };
		const nodeId = addStep( doc, 'number', ctx );
		const node = doc.nodes.find( ( n ) => n.id === nodeId );
		const field = node && 'step' === node.type ? node.fields[ 0 ] : undefined;
		const old = field?.key ?? '';
		const id = addCalculation( doc, 'Preis' );
		setFormula( doc, id, `[${ old }] * 2 + count([${ old }])` );
		const contact = doc.nodes.find( ( n ) => 'contact' === n.type );
		if ( contact && 'contact' === contact.type ) {
			contact.description = { de_DE: `Fläche: {{field:${ old }}}` };
		}
		expect( renameFieldKey( doc, field?.id ?? '', 'name' ) ).toBe( false );
		expect( renameFieldKey( doc, field?.id ?? '', 'flaeche m2' ) ).toBe( false );
		expect( renameFieldKey( doc, field?.id ?? '', 'flaeche' ) ).toBe( true );
		expect( field?.key ).toBe( 'flaeche' );
		expect( printFormula( doc.calculations[ 0 ]?.expression ?? { num: 0 } ) ).toBe( '[flaeche] * 2 + count([flaeche])' );
		expect( contact && 'contact' === contact.type ? contact.description : null ).toEqual( { de_DE: 'Fläche: {{field:flaeche}}' } );
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );

	it( 'add a live result to the first step that asks for what it uses', () => {
		const doc = blank();
		const ctx = { locale: 'de_DE' };
		const first = addStep( doc, 'text', ctx );
		const second = addStep( doc, 'number', ctx, { after: first } );
		const node = doc.nodes.find( ( n ) => n.id === second );
		const key = node && 'step' === node.type ? node.fields[ 0 ]?.key : '';
		addCalculation( doc, 'Andere' );
		const id = addCalculation( doc, 'Preis' );
		setFormula( doc, id, `[${ key }] * 10` );
		expect( resultPlaces( doc, id ) ).toContain( 'live' );
		expect( showResultIn( doc, id, 'live', ctx ) ).toBe( second );
		const field = node && 'step' === node.type ? node.fields[ 1 ] : undefined;
		expect( field ).toMatchObject( { type: 'result', props: { style: 'sticky', lines: [ { calculation: id } ] } } );
		expect( resultPlaces( doc, id ) ).not.toContain( 'live' );
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );
} );
