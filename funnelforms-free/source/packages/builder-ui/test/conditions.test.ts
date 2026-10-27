import { produce } from 'immer';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkReferences, validateDocument, type Condition, type FormDocument } from '@funnelforms/form-schema';
import { addAction } from '../src/actions';
import { conditionFieldList, connectFromCanvas, entryFields, fromRuleSet, opsFor, ruleOp, starterRule, toRuleSet, withOp, type Rule } from '../src/conditions';
import { addEnd, addStep, defaultPlacement, reachable, setRandom } from '../src/document';
import { describeCondition } from '../src/ui/describe';
import { blank } from './blank';

const ctx = { locale: 'de_DE' };

function seeded(): void {
	let n = 0;
	setRandom( () => ( ( n++ * 7919 ) % 100000 ) / 100000 );
}

function valid( doc: FormDocument ): void {
	expect( validateDocument( doc ).errors ).toEqual( [] );
	expect( checkReferences( doc ) ).toEqual( [] );
}

describe( 'placing new steps', () => {
	beforeEach( seeded );

	it( 'puts the first question in front of the contact step and makes it the start', () => {
		let id = '';
		const doc = produce( blank(), ( d ) => {
			id = addStep( d, 'choice', ctx, defaultPlacement( d ) );
		} );
		expect( doc.start ).toBe( id );
		expect( doc.edges.find( ( e ) => e.from === id )?.to ).toBe( 'contact' );
		expect( doc.layout?.nodes[ id ]?.x ).toBeLessThan( doc.layout?.nodes.contact?.x ?? 0 );
		valid( doc );
	} );

	it( 'puts further questions after the last question on the default path', () => {
		let first = '';
		let second = '';
		const doc = produce( blank(), ( d ) => {
			first = addStep( d, 'choice', ctx, defaultPlacement( d ) );
			second = addStep( d, 'text', ctx, defaultPlacement( d ) );
		} );
		expect( doc.start ).toBe( first );
		expect( doc.edges.find( ( e ) => e.from === first )?.to ).toBe( second );
		expect( doc.edges.find( ( e ) => e.from === second )?.to ).toBe( 'contact' );
		expect( [ ...reachable( doc ) ].sort() ).toEqual( [ 'contact', 'end', first, second ].sort() );
		// Left to right in the order of the path, without overlapping.
		const xs = [ first, second, 'contact', 'end' ].map( ( id ) => doc.layout?.nodes[ id ]?.x ?? NaN );
		xs.slice( 1 ).forEach( ( x, i ) => expect( x - ( xs[ i ] ?? 0 ) ).toBeGreaterThanOrEqual( 280 ) );
		valid( doc );
	} );

	it( 'knows which nodes cannot be reached', () => {
		let lost = '';
		const doc = produce( blank(), ( d ) => {
			lost = addEnd( d, ctx );
		} );
		expect( reachable( doc ).has( lost ) ).toBe( false );
	} );
} );

describe( 'conditions', () => {
	beforeEach( seeded );

	it( 'lists the fields a condition can ask for', () => {
		const doc = produce( blank(), ( d ) => {
			addStep( d, 'choice', ctx, defaultPlacement( d ) );
			addStep( d, 'file', ctx, defaultPlacement( d ) );
			addStep( d, 'signature', ctx, defaultPlacement( d ) );
			addStep( d, 'slider', ctx, defaultPlacement( d ) );
			addStep( d, 'date', ctx, defaultPlacement( d ) );
			addStep( d, 'address', ctx, defaultPlacement( d ) );
		} );
		expect( conditionFieldList( doc ).map( ( f ) => [ f.field.type, f.kind ] ) ).toEqual( [
			[ 'choice', 'option' ],
			[ 'file', 'count' ],
			[ 'slider', 'number' ],
			[ 'date', 'date' ],
			[ 'address', 'address' ],
		] );
	} );

	it( 'lets actions also ask for what visitors typed into the contact step', () => {
		const doc = produce( blank(), ( d ) => {
			addStep( d, 'choice', ctx, defaultPlacement( d ) );
		} );
		expect( entryFields( doc ).map( ( f ) => [ f.field.id, f.field.type, f.kind ] ) ).toEqual( [
			[ conditionFieldList( doc )[ 0 ]?.field.id, 'choice', 'option' ],
			[ 'c_name', 'text', 'text' ],
			[ 'c_email', 'text', 'text' ],
		] );
		const routed = produce( doc, ( d ) => {
			const id = addAction( d, 'email' );
			const mail = d.actions.find( ( a ) => a.id === id );
			if ( mail ) {
				mail.when = { field: 'c_email', op: 'endsWith', value: '.org' };
			}
		} );
		expect( routed.actions[ 0 ]?.when ).toEqual( { field: 'c_email', op: 'endsWith', value: '.org' } );
		expect( routed.actions[ 0 ]?.config ).toMatchObject( { layout: 'branded' } );
		valid( routed );
	} );

	it( 'starts rules with the first option, the minimum or a text', () => {
		const doc = produce( blank(), ( d ) => {
			addStep( d, 'choice', ctx, defaultPlacement( d ) );
			addStep( d, 'rating', ctx, defaultPlacement( d ) );
			addStep( d, 'email', ctx, defaultPlacement( d ) );
		} );
		const [ choice, rating, email ] = conditionFieldList( doc ).map( ( f ) => starterRule( f.field ) );
		expect( choice ).toMatchObject( { op: 'selected' } );
		expect( rating ).toMatchObject( { op: 'gte', value: 1 } );
		expect( email ).toMatchObject( { op: 'equalsText', value: '' } );
	} );

	it( 'turns conditions into rules and back', () => {
		const a: Rule = { field: 'q1', op: 'selected', value: 'o1' };
		const b: Rule = { field: 'q2', op: 'gt', value: 3 };
		expect( toRuleSet( undefined ) ).toEqual( { mode: 'all', rules: [] } );
		expect( toRuleSet( a ) ).toEqual( { mode: 'all', rules: [ a ] } );
		expect( toRuleSet( { any: [ a, b ] } ) ).toEqual( { mode: 'any', rules: [ a, b ] } );
		expect( toRuleSet( { all: [ a, { any: [ b ] } ] } ) ).toBeNull();
		expect( toRuleSet( { calc: 'c1', op: 'gt', value: 1 } as Condition ) ).toBeNull();
		expect( fromRuleSet( { mode: 'any', rules: [] } ) ).toBeNull();
		expect( fromRuleSet( { mode: 'any', rules: [ a ] } ) ).toEqual( a );
		expect( fromRuleSet( { mode: 'any', rules: [ a, b ] } ) ).toEqual( { any: [ a, b ] } );
	} );

	it( 'keeps what fits when the operator changes', () => {
		expect( withOp( { field: 'q', op: 'gt', value: 4 }, 'lte' ) ).toEqual( { field: 'q', op: 'lte', value: 4 } );
		expect( withOp( { field: 'q', op: 'equalsText', value: '12' }, 'eq' ) ).toEqual( { field: 'q', op: 'eq', value: 12 } );
		expect( withOp( { field: 'q', op: 'gt', value: 4 }, 'equalsText' ) ).toEqual( { field: 'q', op: 'equalsText', value: '4' } );
		expect( withOp( { field: 'q', op: 'contains', value: '8', part: 'zip' }, 'empty' ) ).toEqual( { field: 'q', op: 'empty', part: 'zip' } );
		expect( withOp( { field: 'q', op: 'empty', part: 'zip' }, 'startsWith' ) ).toEqual( { field: 'q', op: 'startsWith', value: '', part: 'zip' } );
		expect( withOp( { field: 'q', op: 'selected', value: 'o2' }, 'count:gte' ) ).toEqual( { field: 'q', op: 'gte', value: 1, number: 'count' } );
		expect( ruleOp( { field: 'q', op: 'gte', value: 2, number: 'count' } ) ).toBe( 'count:gte' );
		expect( withOp( { field: 'q', op: 'gte', value: 2, number: 'count' }, 'selected', { id: 'q', key: 'q', type: 'choice', label: {}, description: {}, required: true, options: [ { id: 'o1', label: {}, value: 'a' } ], props: { multiple: true, layout: { desktop: 'grid', mobile: 'grid' }, hideIcons: false } } ) ).toEqual( { field: 'q', op: 'selected', value: 'o1' } );
		expect( withOp( { field: 'q', op: 'dateAfter', value: '2026-12-24', days: 3 }, 'dateOn' ) ).toEqual( { field: 'q', op: 'dateOn', value: '2026-12-24', days: 3 } );
		expect( withOp( { field: 'q', op: 'filled' }, 'dateBefore' ) ).toEqual( { field: 'q', op: 'dateBefore', value: 'today' } );
	} );

	it( 'describes the new rules in words', () => {
		const doc = produce( blank(), ( d ) => {
			addStep( d, 'date', ctx, defaultPlacement( d ) );
		} );
		const field = conditionFieldList( doc )[ 0 ]?.field.id ?? '';
		expect( describeCondition( { field, op: 'dateBefore', value: 'today', days: 14 }, doc, 'de_DE' ) ).toBe( 'New question is before today + 14 days' );
		expect( describeCondition( { field, op: 'dateOn', value: '2026-12-24' }, doc, 'de_DE' ) ).toBe( 'New question is on 24.12.2026' );
		expect( describeCondition( { field, op: 'startsWith', value: '8', part: 'zip' }, doc, 'de_DE' ) ).toBe( 'New question (Postcode) starts with "8"' );
		expect( describeCondition( { field, op: 'empty' }, doc, 'de_DE' ) ).toBe( 'New question is not answered' );
		expect( describeCondition( { field, op: 'gte', value: 2, number: 'count' }, doc, 'de_DE' ) ).toBe( 'New question has at least this many answers: 2' );
	} );

	it( 'offers the operators that fit the field', () => {
		expect( opsFor( 'count' ) ).toEqual( [ 'count:gte', 'count:lte', 'count:eq', 'filled', 'empty' ] );
		expect( opsFor( 'date' ) ).toEqual( [ 'dateBefore', 'dateAfter', 'dateOn', 'filled', 'empty' ] );
		expect( opsFor( 'address' ) ).toContain( 'startsWith' );
	} );

	it( 'adds a conditional path when a node already has its default path', () => {
		let step = '';
		let other = '';
		let edge: string | null = null;
		const doc = produce( blank(), ( d ) => {
			step = addStep( d, 'choice', ctx, defaultPlacement( d ) );
			other = addEnd( d, ctx );
			edge = connectFromCanvas( d, step, other );
		} );
		const paths = doc.edges.filter( ( e ) => e.from === step );
		expect( paths ).toHaveLength( 2 );
		expect( paths.find( ( e ) => e.id === edge )?.when ).toMatchObject( { op: 'selected' } );
		expect( paths.find( ( e ) => e.default )?.to ).toBe( 'contact' );
		valid( doc );
	} );

	it( 'moves the default path of a node without a field to ask for', () => {
		let step = '';
		let other = '';
		const doc = produce( blank(), ( d ) => {
			step = addStep( d, 'signature', ctx, defaultPlacement( d ) );
			other = addEnd( d, ctx );
			connectFromCanvas( d, step, other );
		} );
		expect( doc.edges.filter( ( e ) => e.from === step ).map( ( e ) => e.to ) ).toEqual( [ other ] );
	} );

	it( 'draws no Pro rule in Funnelforms Free, where paths ask for chosen answers only', () => {
		process.env.FUNNELFORMS_EDITION = 'free';
		try {
			let step = '';
			let other = '';
			const doc = produce( blank(), ( d ) => {
				step = addStep( d, 'text', ctx, defaultPlacement( d ) );
				other = addEnd( d, ctx );
				connectFromCanvas( d, step, other );
			} );
			const paths = doc.edges.filter( ( e ) => e.from === step );
			expect( paths.map( ( e ) => e.to ) ).toEqual( [ other ] );
			expect( paths.every( ( e ) => undefined === e.when ) ).toBe( true );
		} finally {
			delete process.env.FUNNELFORMS_EDITION;
		}
	} );
} );
