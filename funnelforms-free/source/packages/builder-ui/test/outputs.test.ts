import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { next } from '@funnelforms/form-core';
import type { Condition, Edge, FormDocument, FormNode } from '@funnelforms/form-schema';
import { answerOptions, answerRoutes, conditionFieldList, fieldsBefore, freshRule, fromGroup, opsFor, ruleOp, setAnswerRoute, toGroup, withOp } from '../src/conditions';
import { addRulePath, answerHandle, canAddRule, canMoveRule, clearOutput, connectOutput, moveRule, numberRuleFor, orderDiffers, OTHERWISE, outputsOf, ruleHandle, ruleShape, setNumberRule, settlePath } from '../src/ports';
import { describeCondition, ruleText } from '../src/ui/describe';
import { logicHints } from '../src/logic';

/** Forms as the import of Funnelforms 3.x and 4 converts them (plugin tests keep them current). */
const EXAMPLES = join( __dirname, '../../form-schema/test/examples' );

function example( name: string ): FormDocument {
	return JSON.parse( readFileSync( join( EXAMPLES, name ), 'utf8' ) ) as FormDocument;
}

function outputs( doc: FormDocument, id: string ) {
	const node = doc.nodes.find( ( n ) => n.id === id );
	if ( ! node ) {
		throw new Error( id );
	}
	return outputsOf( doc, node );
}

/** Where a visitor goes with these answers, for every answer of a node's field. */
function routes( doc: FormDocument, nodeId: string, fieldId: string ): Record<string, string | null> {
	const node = doc.nodes.find( ( n ) => n.id === nodeId );
	const field = node && 'step' === node.type ? node.fields.find( ( f ) => f.id === fieldId ) : undefined;
	const options = field && 'options' in field ? field.options : [];
	return Object.fromEntries( options.map( ( o ) => [ o.id, next( doc, nodeId, { [ fieldId ]: [ o.id ] } ) ] ) );
}

describe( 'outputs of the imported forms', () => {
	const files = readdirSync( EXAMPLES ).filter( ( f ) => f.endsWith( '.json' ) );

	it.each( files )( 'every path of %s starts at exactly one kind of output', ( file ) => {
		const doc = example( file );
		const before = JSON.stringify( doc );
		for ( const node of doc.nodes ) {
			const out = outputsOf( doc, node );
			const paths = doc.edges.filter( ( e ) => e.from === node.id );
			// The examples are checked in the order their cards show.
			expect( orderDiffers( doc, node ), `${ file } ${ node.id }` ).toBe( false );
			if ( 'end' === node.type ) {
				expect( out.handles.size ).toBe( 0 );
				continue;
			}
			const seen = new Set<string>();
			for ( const edge of paths ) {
				const handles = out.handles.get( edge.id ) ?? [];
				expect( handles.length, `${ file } ${ edge.id }` ).toBeGreaterThan( 0 );
				for ( const handle of handles ) {
					// One output, one path.
					expect( seen.has( handle ), `${ file } ${ handle }` ).toBe( false );
					seen.add( handle );
				}
				if ( edge.default ) {
					expect( handles ).toEqual( [ OTHERWISE ] );
				} else if ( out.field && answerOptions( edge.when, out.field.id ) && handles[ 0 ]?.startsWith( 'a:' ) ) {
					expect( handles ).toEqual( ( answerOptions( edge.when, out.field.id ) ?? [] ).map( answerHandle ) );
				} else {
					expect( handles ).toEqual( [ ruleHandle( edge.id ) ] );
				}
			}
			// An answer with a path of its own is drawn from that answer; the others follow "Otherwise".
			for ( const answer of out.answers ) {
				expect( answer.edge ? out.handles.get( answer.edge.id ) : [] ).toEqual( answer.edge ? expect.arrayContaining( [ answer.handle ] ) : [] );
			}
		}
		// Drawing the outputs changes nothing in the form: no migration.
		expect( JSON.stringify( doc ) ).toBe( before );
	} );

	it( 'shows the paths of 3.x per answer, for groups of answers and as rules on sliders', () => {
		const doc = example( 'synthetic-logic.json' );
		// Select: two answers with a path each, two by the rule "above the third" (one path for
		// both), one following "Otherwise".
		const select = outputs( doc, 'n0_0' );
		expect( select.answers.map( ( a ) => [ a.option.id, a.edge?.to ?? null ] ) ).toEqual( [
			[ 'q1_o0', 'n4_0' ],
			[ 'q1_o1', 'n4_1' ],
			[ 'q1_o2', null ],
			[ 'q1_o3', 'n4_2' ],
			[ 'q1_o4', 'n4_2' ],
		] );
		expect( select.rules ).toEqual( [] );
		expect( select.otherwise?.to ).toBe( 'n1_0' );
		// Dropdown with two equal labels: both answers start the one path.
		const dropdown = outputs( doc, 'n1_0' );
		expect( dropdown.answers.filter( ( a ) => a.edge ).map( ( a ) => a.handle ) ).toEqual( [ 'a:q2_o0', 'a:q2_o2' ] );
		// Slider: rules as outputs, in the order they are checked.
		const slider = outputs( doc, 'n2_0' );
		expect( slider.answers ).toEqual( [] );
		expect( slider.rules.map( ( r ) => [ r.symbol, r.tone, r.number?.value ?? null, r.edge.to ] ) ).toEqual( [
			[ '', 'rule', null, 'n4_2' ],
			[ '<', 'below', 10, 'n4_1' ],
			[ '>', 'above', 50, 'n4_0' ],
		] );
		expect( slider.otherwise?.to ).toBe( 'n3_0' );
		// Multiple choice: "exactly this answer" is a rule, not the output of the answer.
		const multiple = outputs( doc, 'n3_0' );
		expect( multiple.answers.every( ( a ) => ! a.edge ) ).toBe( true );
		expect( multiple.rules.map( ( r ) => r.edge.to ) ).toEqual( [ 'n4_1' ] );
	} );

	it( 'shows the paths of Funnelforms 4 per answer, slider rules and rules on several answers', () => {
		const doc = example( 'ff4-solar.json' );
		const roof = outputs( doc, 's_node-roof' );
		expect( roof.answers.map( ( a ) => a.edge?.to ?? null ) ).toEqual( [ null, 's_node-info', 's_node-zip-again' ] );
		expect( roof.otherwise?.to ).toBe( 's_node-area' );
		const area = outputs( doc, 's_node-area' );
		expect( area.rules.map( ( r ) => [ r.symbol, r.tone, r.number?.value ] ) ).toEqual( [ [ '<', 'below', 20 ] ] );
		// "Exactly these answers" and "more than two answers": rules over the answers, below them.
		const extras = outputs( doc, 's_node-extras' );
		expect( extras.answers.every( ( a ) => ! a.edge ) ).toBe( true );
		expect( extras.rules.map( ( r ) => [ r.symbol, r.tone, r.answers?.options.map( ( o ) => o.id ), r.answers?.only, r.count ] ) ).toEqual( [
			[ '=', 'equal', [ 'f-extras_o0', 'f-extras_o1' ], true, undefined ],
			[ '>', 'above', undefined, undefined, 2 ],
		] );
		// No answer has a path of its own: both rules are checked first.
		expect( extras.rules.map( ( r ) => [ r.first, r.order ] ) ).toEqual( [ [ true, 1 ], [ true, 2 ] ] );
		// The contact step leads on to its thank-you page.
		const contact = outputs( doc, 'c_node-contact' );
		expect( contact.answers ).toEqual( [] );
		expect( contact.rules ).toEqual( [] );
		expect( contact.otherwise?.to ).toBe( 'e_node-contact' );
	} );
} );

describe( 'drawing from an output', () => {
	it( 'gives one answer of a group its own path and keeps the others where they went', () => {
		const doc = example( 'synthetic-logic.json' );
		let id: string | null = null;
		const changed = produce( doc, ( d ) => {
			id = connectOutput( d, 'n0_0', answerHandle( 'q1_o3' ), 'n4_3' );
		} );
		expect( id ).not.toBeNull();
		expect( routes( changed, 'n0_0', 'q1' ) ).toEqual( { ...routes( doc, 'n0_0', 'q1' ), q1_o3: 'n4_3' } );
		const select = outputs( changed, 'n0_0' );
		expect( select.answers.find( ( a ) => 'q1_o4' === a.option.id )?.edge?.when ).toEqual( { field: 'q1', op: 'selected', value: 'q1_o4' } );
		// The sidebar lists the same paths per answer.
		expect( answerRoutes( changed, 'n0_0', 'q1' ).map( ( r ) => r.edge?.to ?? null ) ).toEqual( [ 'n4_0', 'n4_1', null, 'n4_3', 'n4_2' ] );
	} );

	it( 'draws a path of its own from a free answer, even to where "Otherwise" leads', () => {
		const doc = example( 'synthetic-logic.json' );
		const changed = produce( doc, ( d ) => {
			connectOutput( d, 'n0_0', answerHandle( 'q1_o2' ), 'n1_0' );
		} );
		const edge = changed.edges.find( ( e ) => 'n0_0' === e.from && answerOptions( e.when, 'q1' )?.includes( 'q1_o2' ) );
		expect( edge?.to ).toBe( 'n1_0' );
		// Conditional paths stay before the default path.
		const order = changed.edges.filter( ( e ) => 'n0_0' === e.from );
		expect( order[ order.length - 1 ]?.default ).toBe( true );
		expect( routes( changed, 'n0_0', 'q1' ) ).toEqual( routes( doc, 'n0_0', 'q1' ) );
	} );

	it( 'moves "Otherwise" and rules from their outputs, and connects as before without one', () => {
		const doc = example( 'synthetic-logic.json' );
		const rule = doc.edges.find( ( e ) => 'n2_0' === e.from && e.when && 'field' in e.when && 'lt' === e.when.op ) as Edge;
		const changed = produce( doc, ( d ) => {
			connectOutput( d, 'n0_0', OTHERWISE, 'n4_3' );
			connectOutput( d, 'n2_0', ruleHandle( rule.id ), 'n4_3' );
			connectOutput( d, 'n4_0', OTHERWISE, 'n0_0' );
		} );
		expect( outputs( changed, 'n0_0' ).otherwise?.to ).toBe( 'n4_3' );
		expect( changed.edges.find( ( e ) => e.id === rule.id )?.to ).toBe( 'n4_3' );
		// Ends have no outputs.
		expect( changed.edges.some( ( e ) => 'n4_0' === e.from ) ).toBe( false );
		// Without a handle (older drawings) the first path is the default one.
		const plain = produce( changed, ( d ) => {
			connectOutput( d, 'n3_0', null, 'n4_3' );
		} );
		expect( plain.edges.filter( ( e ) => 'n3_0' === e.from ).length ).toBeGreaterThan( 1 );
	} );

	it( 'lets an answer of a group follow "Otherwise" again from the sidebar', () => {
		const doc = example( 'synthetic-logic.json' );
		const changed = produce( doc, ( d ) => setAnswerRoute( d, 'n1_0', 'q2', 'q2_o2', null ) );
		expect( outputs( changed, 'n1_0' ).answers.map( ( a ) => a.edge?.to ?? null ) ).toEqual( [ 'n4_3', null, null ] );
		const back = produce( changed, ( d ) => setAnswerRoute( d, 'n1_0', 'q2', 'q2_o0', null ) );
		expect( back.edges.filter( ( e ) => 'n1_0' === e.from ) ).toEqual( [ expect.objectContaining( { default: true } ) ] );
	} );

	it( 'adds a rule on a slider for the numbers no path takes yet, to where "Otherwise" leads', () => {
		const doc = example( 'synthetic-logic.json' );
		let id: string | null = null;
		const changed = produce( doc, ( d ) => {
			id = addRulePath( d, 'n2_0' );
		} );
		const edge = changed.edges.find( ( e ) => e.id === id );
		// 0 to 9 and 51 to 100 have paths: the new rule takes what is left.
		expect( edge ).toMatchObject( { from: 'n2_0', to: 'n3_0', when: { all: [ { field: 'q3', op: 'gte', value: 10 }, { field: 'q3', op: 'lte', value: 50 } ] } } );
		expect( outputs( changed, 'n2_0' ).rules.at( -1 ) ).toMatchObject( { symbol: '↔', number: { min: 10, max: 50, rule: { op: 'between', min: 10, max: 50 } } } );
	} );

	it( 'reads a rule between two numbers as a range', () => {
		const doc = example( 'synthetic-logic.json' );
		const node = doc.nodes.find( ( n ) => 'n2_0' === n.id );
		const own = node && 'step' === node.type ? node.fields : [];
		const edge: Edge = { id: 'e', from: 'n2_0', to: 'n4_0', when: { all: [ { field: 'q3', op: 'gte', value: 20 }, { field: 'q3', op: 'lte', value: 40 } ] } };
		expect( ruleShape( edge, own ) ).toEqual( { tone: 'range', symbol: '↔', number: { field: own[ 0 ], min: 20, max: 40, rule: { op: 'between', min: 20, max: 40 } } } );
		// "More than 20 and less than 40" is a range too, but not the "between" the card changes in place.
		expect( ruleShape( { ...edge, when: { all: [ { field: 'q3', op: 'gt', value: 20 }, { field: 'q3', op: 'lt', value: 40 } ] } }, own ) ).toEqual( { tone: 'range', symbol: '↔', number: { field: own[ 0 ], min: 20, max: 40 } } );
		expect( ruleShape( { ...edge, when: { all: [ { field: 'q3', op: 'gte', value: 20 }, { field: 'q1', op: 'filled' } ] } }, own ) ).toEqual( { tone: 'rule', symbol: '' } );
		expect( ruleShape( { ...edge, when: undefined }, own ) ).toEqual( { tone: 'rule', symbol: '' } );
	} );
} );

describe( 'the order of rules and answers', () => {
	const from = ( doc: FormDocument, id: string ): string[] => doc.edges.filter( ( e ) => e.from === id ).map( ( e ) => e.id );

	it( 'puts a new rule before the paths per answer, and a new answer path at the place of its answer', () => {
		const doc = example( 'synthetic-logic.json' );
		let id: string | null = null;
		const changed = produce( doc, ( d ) => {
			id = addRulePath( d, 'n1_0' );
		} );
		// The dropdown has its answers: the rule asks for the question before it and is checked first.
		expect( from( changed, 'n1_0' ) ).toEqual( [ id, 'e_n1_0_0', 'e_n1_0_1' ] );
		expect( changed.edges.find( ( e ) => e.id === id ) ).toMatchObject( { to: 'n2_0', when: { field: 'q1', op: 'selected', value: 'q1_o0' } } );
		expect( outputs( changed, 'n1_0' ).rules.map( ( r ) => [ r.first, r.order ] ) ).toEqual( [ [ true, 1 ] ] );
		// A second rule never asks the same: the next answer of that question, behind the first rule and before the answers.
		const twice = produce( changed, ( d ) => void addRulePath( d, 'n1_0' ) );
		expect( twice.edges.filter( ( e ) => 'n1_0' === e.from && ! e.default ).map( ( e ) => ( e.when as { value?: unknown } ).value ?? null ) ).toEqual( [ 'q1_o0', 'q1_o1', null ] );

		// An answer drawn later takes its place among the answers: before the next answer with a path.
		const drawn = produce( doc, ( d ) => void connectOutput( d, 'n0_0', answerHandle( 'q1_o2' ), 'n4_3' ) );
		expect( outputs( drawn, 'n0_0' ).answers.map( ( a ) => drawn.edges.findIndex( ( e ) => e.id === a.edge?.id ) ) ).toEqual( [ 0, 1, 2, 3, 3 ] );
	} );

	it( 'starts a rule with what the answers cannot say', () => {
		const doc = example( 'synthetic-logic.json' );
		// Several answers at once: two of them together.
		expect( freshRule( doc, 'n3_0', fieldsBefore( doc, 'n3_0' ) ) ).toEqual( { all: [ { field: 'q4', op: 'selected', value: 'q4_o0' }, { field: 'q4', op: 'selected', value: 'q4_o1' } ] } );
		// The first step with one answer each: only its own answers are left, the first without a path.
		expect( freshRule( doc, 'n0_0', fieldsBefore( doc, 'n0_0' ) ) ).toEqual( { field: 'q1', op: 'selected', value: 'q1_o2' } );
		expect( fieldsBefore( doc, 'n0_0' ).length ).toBeLessThan( conditionFieldList( doc ).length );
		const added = produce( doc, ( d ) => void addRulePath( d, 'n0_0' ) );
		// That is the path of the answer: an output of the answer, not a rule.
		expect( outputs( added, 'n0_0' ).rules ).toEqual( [] );
		expect( outputs( added, 'n0_0' ).answers.map( ( a ) => a.edge?.to ?? null ) ).toEqual( [ 'n4_0', 'n4_1', 'n1_0', 'n4_2', 'n4_2' ] );
	} );

	it( 'moves a rule among the rules and across the answers', () => {
		const doc = produce( example( 'synthetic-logic.json' ), ( d ) => {
			d.edges.unshift( { id: 'r1', from: 'n0_0', to: 'n4_3', when: { field: 'q1', op: 'filled' } }, { id: 'r2', from: 'n0_0', to: 'n4_3', when: { field: 'q1', op: 'empty' } } );
		} );
		const state = ( d: FormDocument ) => outputs( d, 'n0_0' ).rules.map( ( r ) => r.edge.id + ( r.first ? ' first' : ' after' ) );
		const can = ( d: FormDocument, id: string ) => [ canMoveRule( outputs( d, 'n0_0' ), id, -1 ), canMoveRule( outputs( d, 'n0_0' ), id, 1 ) ];
		expect( state( doc ) ).toEqual( [ 'r1 first', 'r2 first' ] );
		expect( can( doc, 'r1' ) ).toEqual( [ false, true ] );
		const swapped = produce( doc, ( d ) => moveRule( d, 'r1', 1 ) );
		expect( state( swapped ) ).toEqual( [ 'r2 first', 'r1 first' ] );
		// Past the last rule: behind the paths per answer, still before "Otherwise".
		const behind = produce( swapped, ( d ) => moveRule( d, 'r1', 1 ) );
		expect( state( behind ) ).toEqual( [ 'r2 first', 'r1 after' ] );
		expect( from( behind, 'n0_0' ) ).toEqual( [ 'r2', 'e_n0_0_0', 'e_n0_0_1', 'e_n0_0_2', 'r1', 'e_n0_0_3' ] );
		expect( can( behind, 'r1' ) ).toEqual( [ true, false ] );
		// What the form does follows the order: the answer wins over the rule behind it.
		expect( next( swapped, 'n0_0', { q1: [ 'q1_o0' ] } ) ).toBe( 'n4_3' );
		expect( next( produce( behind, ( d ) => moveRule( d, 'r2', 1 ) ), 'n0_0', { q1: [ 'q1_o0' ] } ) ).toBe( 'n4_0' );
		// And back before the answers.
		expect( state( produce( behind, ( d ) => moveRule( d, 'r1', -1 ) ) ) ).toEqual( [ 'r2 first', 'r1 first' ] );
		// Without paths per answer there is nothing to cross.
		expect( canMoveRule( outputs( doc, 'n2_0' ), 'e_n2_0_2', 1 ) ).toBe( false );
		expect( canMoveRule( outputs( doc, 'n2_0' ), 'e_n2_0_2', -1 ) ).toBe( true );
	} );

	it( 'changes a number rule in place and keeps how an imported rule reads its number', () => {
		const doc = example( 'synthetic-logic.json' );
		const changed = produce( doc, ( d ) => {
			setNumberRule( d, 'e_n2_0_1', 'q3', { op: 'lte', value: 12 } );
			setNumberRule( d, 'e_n2_0_2', 'q3', { op: 'between', min: 40, max: 60 } );
			setNumberRule( d, 'e_n2_0_3', 'q3', { op: 'eq', value: 1 } );
		} );
		expect( changed.edges.find( ( e ) => 'e_n2_0_1' === e.id )?.when ).toEqual( { field: 'q3', op: 'lte', value: 12, number: 'int' } );
		expect( changed.edges.find( ( e ) => 'e_n2_0_2' === e.id )?.when ).toEqual( { all: [ { field: 'q3', op: 'gte', value: 40, number: 'int' }, { field: 'q3', op: 'lte', value: 60, number: 'int' } ] } );
		// "Otherwise" has no rule to change.
		expect( changed.edges.find( ( e ) => 'e_n2_0_3' === e.id ) ).toEqual( doc.edges.find( ( e ) => 'e_n2_0_3' === e.id ) );
		expect( outputs( changed, 'n2_0' ).rules.map( ( r ) => r.number?.rule ) ).toEqual( [ undefined, { op: 'lte', value: 12 }, { op: 'between', min: 40, max: 60 } ] );
		// Back from "between": the rule keeps reading whole numbers.
		const back = produce( changed, ( d ) => setNumberRule( d, 'e_n2_0_2', 'q3', { op: 'gt', value: 40 } ) );
		expect( back.edges.find( ( e ) => 'e_n2_0_2' === e.id )?.when ).toEqual( { field: 'q3', op: 'gt', value: 40, number: 'int' } );
	} );

	it( 'suggests the numbers no rule takes yet for the next rule', () => {
		const doc = example( 'synthetic-logic.json' );
		const node = doc.nodes.find( ( n ) => 'n2_0' === n.id );
		const field = node && 'step' === node.type ? node.fields[ 0 ] : undefined;
		if ( ! node || ! field ) {
			throw new Error( 'slider' );
		}
		const rule = ( edges: Edge[] ) => numberRuleFor( { ...doc, edges: [ ...doc.edges.filter( ( e ) => 'n2_0' !== e.from ), ...edges ] }, node, field );
		const path = ( id: string, when: Edge[ 'when' ] ): Edge => ( { id, from: 'n2_0', to: 'n3_0', when } );
		// The first rule: the upper half.
		expect( rule( [] ) ).toEqual( { field: 'q3', op: 'gte', value: 50 } );
		// Below the first rule, then above the last one, then the gap between two.
		expect( rule( [ path( 'a', { field: 'q3', op: 'gte', value: 50 } ) ] ) ).toEqual( { field: 'q3', op: 'lte', value: 49 } );
		expect( rule( [ path( 'a', { field: 'q3', op: 'lt', value: 20 } ) ] ) ).toEqual( { field: 'q3', op: 'gte', value: 20 } );
		expect( rule( [ path( 'a', { field: 'q3', op: 'lt', value: 20 } ), path( 'b', { field: 'q3', op: 'gt', value: 40 } ) ] ) ).toEqual( { all: [ { field: 'q3', op: 'gte', value: 20 }, { field: 'q3', op: 'lte', value: 40 } ] } );
		expect( rule( [ path( 'a', { field: 'q3', op: 'lt', value: 20 } ), path( 'b', { field: 'q3', op: 'gt', value: 20 } ) ] ) ).toEqual( { field: 'q3', op: 'eq', value: 20 } );
		// Nothing left: as the first rule.
		expect( rule( [ path( 'a', { field: 'q3', op: 'lt', value: 20 } ), path( 'b', { field: 'q3', op: 'gte', value: 20 } ) ] ) ).toEqual( { field: 'q3', op: 'gte', value: 50 } );
	} );

	it( 'keeps the order shown true when a path becomes a rule or the path of an answer', () => {
		const doc = example( 'synthetic-logic.json' );
		const setWhen = ( d: FormDocument, id: string, when: Condition ) =>
			produce( d, ( draft ) => {
				( draft.edges.find( ( e ) => e.id === id ) as Edge ).when = when;
				settlePath( draft, id );
			} );
		// The path of "Answer 1" gets a second condition: a rule, checked before the answers it stood among.
		const special = setWhen( doc, 'e_n0_0_1', { all: [ { field: 'q1', op: 'selected', value: 'q1_o1' }, { field: 'q1', op: 'filled' } ] } );
		expect( from( special, 'n0_0' ) ).toEqual( [ 'e_n0_0_1', 'e_n0_0_0', 'e_n0_0_2', 'e_n0_0_3' ] );
		expect( outputs( special, 'n0_0' ).rules.map( ( r ) => [ r.edge.id, r.first ] ) ).toEqual( [ [ 'e_n0_0_1', true ] ] );
		expect( orderDiffers( special, special.nodes[ 0 ] as FormNode ) ).toBe( false );
		// Back to one answer: the path of that answer again, at the place of the answer.
		const back = setWhen( special, 'e_n0_0_1', { field: 'q1', op: 'selected', value: 'q1_o1' } );
		expect( from( back, 'n0_0' ) ).toEqual( from( doc, 'n0_0' ) );
		// A rule that already stands before or behind the answers stays where it is.
		const behind = produce( doc, ( d ) => {
			d.edges.splice( 3, 0, { id: 'r', from: 'n0_0', to: 'n4_3', when: { field: 'q1', op: 'filled' } } );
			settlePath( d, 'r' );
			settlePath( d, 'e_n0_0_3' );
			settlePath( d, 'nope' );
		} );
		expect( from( behind, 'n0_0' ) ).toEqual( [ 'e_n0_0_0', 'e_n0_0_1', 'e_n0_0_2', 'r', 'e_n0_0_3' ] );
	} );

	it( 'shows the paths in the order stored where rules stand between the answers (5.0.8 or an import), and moves nothing', () => {
		const doc = example( 'synthetic-logic.json' );
		const node = ( d: FormDocument, id: string ) => d.nodes.find( ( n ) => n.id === id ) as FormNode;
		const shown = ( d: FormDocument, id: string ) =>
			outputs( d, id ).parts.map( ( p ) => ( 'rules' === p.kind ? p.rules.map( ( r ) => 'r:' + r.edge.id ) : p.answers.map( ( a ) => a.handle ) ) );
		expect( doc.nodes.map( ( n ) => orderDiffers( doc, n ) ) ).toEqual( doc.nodes.map( () => false ) );
		// Usual order: rules checked first, the answers, the other rules.
		expect( shown( doc, 'n2_0' ) ).toEqual( [ [ 'r:e_n2_0_0', 'r:e_n2_0_1', 'r:e_n2_0_2' ] ] );
		// A rule between the paths of two answers (the sidebar of 5.0.8 put it there): the card shows it there.
		const between = produce( doc, ( d ) => void d.edges.splice( 1, 0, { id: 'r', from: 'n0_0', to: 'n4_3', when: { field: 'q1', op: 'filled' } } ) );
		expect( orderDiffers( between, node( between, 'n0_0' ) ) ).toBe( true );
		expect( shown( between, 'n0_0' ) ).toEqual( [ [ 'a:q1_o0' ], [ 'r:r' ], [ 'a:q1_o1', 'a:q1_o3', 'a:q1_o4', 'a:q1_o2' ] ] );
		expect( next( between, 'n0_0', { q1: [ 'q1_o1' ] } ) ).toBe( 'n4_3' );
		// Moving it goes past the path next to it, as stored; then the usual order again.
		const up = produce( between, ( d ) => moveRule( d, 'r', -1 ) );
		expect( from( up, 'n0_0' ) ).toEqual( [ 'r', 'e_n0_0_0', 'e_n0_0_1', 'e_n0_0_2', 'e_n0_0_3' ] );
		expect( orderDiffers( up, node( up, 'n0_0' ) ) ).toBe( false );
		expect( canMoveRule( outputs( between, 'n0_0' ), 'r', -1 ) ).toBe( true );
		expect( canMoveRule( outputs( between, 'n0_0' ), 'r', 1 ) ).toBe( true );
		// A changed condition keeps the rule where it is checked.
		const changed = produce( between, ( d ) => {
			( d.edges.find( ( e ) => 'r' === e.id ) as Edge ).when = { field: 'q1', op: 'empty' };
			settlePath( d, 'r', true );
		} );
		expect( from( changed, 'n0_0' ) ).toEqual( from( between, 'n0_0' ) );

		// One answer each: the order of the paths per answer decides nothing, the answers stay in their order.
		const swapped = produce( doc, ( d ) => {
			const [ a, b ] = d.edges;
			if ( a && b ) {
				d.edges[ 0 ] = b;
				d.edges[ 1 ] = a;
			}
		} );
		expect( orderDiffers( swapped, node( swapped, 'n0_0' ) ) ).toBe( false );
		// Several answers at once: the first path decides, so the answers stand in the order of their paths.
		const many = produce( doc, ( d ) => {
			d.edges = d.edges.filter( ( e ) => 'n3_0' !== e.from || e.default );
			d.edges.push( { id: 'c', from: 'n3_0', to: 'n4_2', when: { field: 'q4', op: 'selected', value: 'q4_o2' } }, { id: 'a', from: 'n3_0', to: 'n4_3', when: { field: 'q4', op: 'selected', value: 'q4_o0' } } );
		} );
		expect( orderDiffers( many, node( many, 'n3_0' ) ) ).toBe( true );
		expect( shown( many, 'n3_0' ) ).toEqual( [ [ 'a:q4_o2', 'a:q4_o0', 'a:q4_o1' ] ] );
		expect( next( many, 'n3_0', { q4: [ 'q4_o0', 'q4_o2' ] } ) ).toBe( 'n4_2' );
		// Paths drawn here take the place of their answer by themselves.
		const drawn = produce( doc, ( d ) => {
			d.edges = d.edges.filter( ( e ) => 'n3_0' !== e.from || e.default );
			connectOutput( d, 'n3_0', answerHandle( 'q4_o2' ), 'n4_2' );
			connectOutput( d, 'n3_0', answerHandle( 'q4_o0' ), 'n4_3' );
			connectOutput( d, 'n3_0', answerHandle( 'q4_o1' ), 'n4_1' );
		} );
		expect( orderDiffers( drawn, node( drawn, 'n3_0' ) ) ).toBe( false );
		expect( outputs( drawn, 'n3_0' ).answers.map( ( a ) => a.edge?.to ) ).toEqual( [ 'n4_3', 'n4_1', 'n4_2' ] );
		expect( next( drawn, 'n3_0', { q4: [ 'q4_o0', 'q4_o2' ] } ) ).toBe( 'n4_3' );
	} );

	it( 'takes the path away from an answer, a rule or "Otherwise"', () => {
		const doc = example( 'synthetic-logic.json' );
		const changed = produce( doc, ( d ) => {
			clearOutput( d, 'n0_0', answerHandle( 'q1_o3' ) );
			clearOutput( d, 'n2_0', ruleHandle( 'e_n2_0_1' ) );
			clearOutput( d, 'n1_0', OTHERWISE );
			// Not an output of that node: nothing happens.
			clearOutput( d, 'n3_0', ruleHandle( 'e_n2_0_2' ) );
			clearOutput( d, 'nope', OTHERWISE );
		} );
		// The other answer of the shared path keeps it.
		expect( outputs( changed, 'n0_0' ).answers.map( ( a ) => a.edge?.to ?? null ) ).toEqual( [ 'n4_0', 'n4_1', null, null, 'n4_2' ] );
		expect( from( changed, 'n2_0' ) ).toEqual( [ 'e_n2_0_0', 'e_n2_0_2', 'e_n2_0_3' ] );
		expect( outputs( changed, 'n1_0' ).otherwise ).toBeUndefined();
		expect( from( changed, 'n1_0' ) ).toEqual( [ 'e_n1_0_0' ] );
	} );
} );

describe( 'rules in words and "between"', () => {
	it( 'reads "at least" and "at most" of one field as "between" and stores it as the two rules', () => {
		const between: Condition = { all: [ { field: 'q3', op: 'gte', value: 20 }, { field: 'q3', op: 'lte', value: 40 } ] };
		const group = toGroup( between );
		expect( group ).toEqual( { mode: 'all', items: [ { field: 'q3', op: 'between', min: 20, max: 40 } ] } );
		expect( fromGroup( group ) ).toEqual( between );
		// With another rule beside it, and inside "any".
		const more: Condition = { all: [ { field: 'q1', op: 'filled' }, { field: 'q3', op: 'gte', value: 20 }, { field: 'q3', op: 'lte', value: 40 } ] };
		expect( toGroup( more ).items ).toEqual( [ { field: 'q1', op: 'filled' }, { field: 'q3', op: 'between', min: 20, max: 40 } ] );
		expect( fromGroup( toGroup( more ) ) ).toEqual( more );
		const any: Condition = { any: [ between, { field: 'q3', op: 'eq', value: 99 } ] };
		expect( fromGroup( toGroup( any ) ) ).toEqual( any );
		// Not "between": another order, other fields, counted answers, "more than".
		for ( const other of [
			{ all: [ { field: 'q3', op: 'lte', value: 40 }, { field: 'q3', op: 'gte', value: 20 } ] },
			{ all: [ { field: 'q3', op: 'gte', value: 20 }, { field: 'q5', op: 'lte', value: 40 } ] },
			{ all: [ { field: 'q3', op: 'gte', value: 2, number: 'count' }, { field: 'q3', op: 'lte', value: 4, number: 'count' } ] },
			{ all: [ { field: 'q3', op: 'gt', value: 20 }, { field: 'q3', op: 'lte', value: 40 } ] },
		] as Condition[] ) {
			expect( toGroup( other ).items.some( ( i ) => 'op' in i && 'between' === i.op ) ).toBe( false );
			expect( fromGroup( toGroup( other ) ) ).toEqual( other );
		}
	} );

	it( 'changes a rule to "between" and back, up to the largest value of its field', () => {
		const doc = example( 'synthetic-logic.json' );
		const node = doc.nodes.find( ( n ) => 'n2_0' === n.id );
		const field = node && 'step' === node.type ? node.fields[ 0 ] : undefined;
		expect( opsFor( 'number' ) ).toContain( 'between' );
		const between = withOp( { field: 'q3', op: 'gte', value: 20 }, 'between', field );
		expect( between ).toEqual( { field: 'q3', op: 'between', min: 20, max: 100 } );
		expect( ruleOp( between ) ).toBe( 'between' );
		expect( withOp( between, 'lt', field ) ).toEqual( { field: 'q3', op: 'lt', value: 20 } );
		// Without a largest value the range starts as one number.
		expect( withOp( { field: 'x', op: 'gte', value: 7 }, 'between' ) ).toEqual( { field: 'x', op: 'between', min: 7, max: 7 } );
	} );

	it( 'says a rule short on the card of its step and in full where the step has several questions', () => {
		const doc = example( 'ff4-solar.json' );
		const words = ( id: string, full = false ) => outputs( doc, id ).rules.map( ( r ) => ( r.symbol ? r.symbol + ' ' : '' ) + ruleText( r, doc, 'de_DE', undefined, full ) );
		expect( words( 's_node-area' ) ).toEqual( [ '< 20 m²' ] );
		// Exactly these answers, and counted answers.
		expect( words( 's_node-extras' ) ).toEqual( [ '= Speicher + Wallbox', '> 2 chosen' ] );
		// The card of a step with one question names the question: the rule leaves it out.
		expect( words( 's_node-zip' ) ).toEqual( [ 'starts with "99"', 'is not answered' ] );
		const range: Condition = { all: [ { field: 'f-area', op: 'gte', value: 20 }, { field: 'f-area', op: 'lte', value: 40 } ] };
		expect( describeCondition( range, doc, 'de_DE' ) ).toBe( 'Wie groß ist die Dachfläche? is between 20 and 40' );
		const ranged = produce( doc, ( d ) => void ( ( d.edges.find( ( e ) => 's_node-area' === e.from && ! e.default ) as Edge ).when = range ) );
		expect( outputs( ranged, 's_node-area' ).rules.map( ( r ) => r.symbol + ' ' + ruleText( r, ranged, 'de_DE' ) ) ).toEqual( [ '↔ 20 m² – 40 m²' ] );
		// A rule on an earlier question keeps its name: short on the card, in full in the panel.
		const earlier = produce( doc, ( d ) => void addRulePath( d, 's_node-info' ) );
		const [ rule ] = outputs( earlier, 's_node-info' ).rules;
		expect( rule ? ruleText( rule, earlier, 'de_DE', undefined, true ) : '' ).toBe( 'Welche Dachform hat Ihr Hau…: Satteldach is selected' );
		expect( rule ? ruleText( rule, earlier, 'de_DE' ).length : 99 ).toBeLessThan( 40 );
		expect( ruleText( { handle: 'r:x', edge: { id: 'x', from: 's_node-zip', to: 's_node-date' }, tone: 'rule', symbol: '', first: true, order: 1 }, doc, 'de_DE' ) ).toBe( 'Always' );
	} );

	it( 'says the rules of an imported form with all kinds of conditions', () => {
		// The second form from Funnelforms 4 (plugin/tests/fixtures/ff4/logic-editor.json): every kind of condition its editor has.
		const doc = example( 'ff4-logic.json' );
		const words = ( id: string, full = false ) => outputs( doc, id ).rules.map( ( r ) => ( r.symbol ? r.symbol + ' ' : '' ) + ruleText( r, doc, 'de_DE', undefined, full ) );
		expect( words( 's_n-size' ) ).toEqual( [ '< 20 m²', '= 20 m²', '> 20 m²' ] );
		expect( words( 's_n-note' ) ).toEqual( [ 'is exactly "ja"', 'is not exactly "ja"' ] );
		// Postal codes from 80000 to 87999 are the codes that start with 80 to 87: one rule with its texts, short on the card.
		expect( words( 's_n-where' ) ).toEqual( [ 'Postcode: 80…, 81…, 82… +5 more', 'Postcode: 9…', 'Country: Österreich' ] );
		expect( words( 's_n-where', true ) ).toEqual( [ 'Postcode starts with "80", "81", "82", "83", "84", "85" +2 more', 'Postcode starts with "9"', 'Country is exactly "Österreich"' ] );
		expect( words( 's_n-extras' ) ).toEqual( [ '= Speicher + Wärmepumpe', '> 1 chosen' ] );
		expect( words( 's_n-rating' ) ).toEqual( [ '> 3', '< 4' ] );
		expect( words( 's_n-when' ) ).toEqual( [ 'is before 01.01.2027', 'is after 30.06.2027' ] );
		// Texts asked for in several ways, and of a question of another step.
		const mixed: Condition = { any: [ { field: 'f-where', op: 'startsWith', value: '8033', part: 'zip' }, { field: 'f-where', op: 'equalsText', value: '80340', part: 'zip' }, { field: 'f-where', op: 'equalsText', value: '80341', part: 'zip' } ] };
		expect( describeCondition( mixed, doc, 'de_DE' ) ).toBe( 'Wo steht das Haus? (Postcode) starts with "8033" or is exactly "80340", "80341"' );
		expect( describeCondition( { all: [ mixed, { field: 'f-note', op: 'filled' } ] }, doc, 'de_DE' ) ).toBe( '(Wo steht das Haus? (Postcode) starts with "8033" or is exactly "80340", "80341") and Gibt es schon ein Angebot? is answered' );
		// Other lists stay as they are.
		expect( describeCondition( { any: [ { field: 'f-note', op: 'equalsText', value: 'ja' }, { field: 'f-note', op: 'empty' } ] }, doc, 'de_DE' ) ).toBe( 'Gibt es schon ein Angebot? is exactly "ja" or Gibt es schon ein Angebot? is not answered' );
		// No step of it asks for "Otherwise" without need: opposites and rules without gaps are complete.
		expect( logicHints( doc ).filter( ( h ) => 'noOtherwise' === h.code ).map( ( h ) => h.node ) ).toEqual( [ 's_n-who', 's_n-when' ] );
	} );

	it( 'offers a rule only where there is something to ask for and somewhere to lead', () => {
		const doc = example( 'ff4-solar.json' );
		expect( canAddRule( doc, 's_node-roof' ) ).toBe( true );
		// Text and media as the first step: no question before it, none of its own.
		const first = produce( doc, ( d ) => {
			d.edges = d.edges.filter( ( e ) => 's_node-info' !== e.to );
			d.start = 's_node-info';
		} );
		expect( canAddRule( first, 's_node-info' ) ).toBe( false );
		expect( produce( first, ( d ) => void addRulePath( d, 's_node-info' ) ) ).toBe( first );
		// After a question it can ask for that one.
		expect( canAddRule( doc, 's_node-info' ) ).toBe( true );
		expect( canAddRule( doc, 'e_node-contact' ) ).toBe( false );
		expect( canAddRule( doc, 'nope' ) ).toBe( false );
	} );
} );

