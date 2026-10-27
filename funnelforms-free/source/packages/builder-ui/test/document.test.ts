import { produce } from 'immer';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkReferences, validateDocument, type Field, type FormDocument } from '@funnelforms/form-schema';
import { addContact, addEnd, addField, addRepeatField, moveRepeatField, removeRepeatField, REPEAT_FIELD_TYPES, setRepeatFieldType, addOption, addOptions, addStep, connect, CONTACT_FIELD_TYPES, duplicateField, duplicateNode, isClip, keyClash, pasteField, pasteNode, moveField, moveOption, nodeName, removeField, removeNode, removeOption, reorderEdge, setCondition, setRandom, splitOptionList, STEP_FIELD_TYPES, usedIds } from '../src/document';
import { blank } from './blank';

const ctx = { locale: 'de_DE', labels: { question: 'Neue Frage', option: 'Option %d' } };

interface AnyField {
	id: string;
	key: string;
	type: string;
	options?: Array<{ id: string; label: Record<string, string> }>;
}

/** An item that must be there. */
function at<T>( list: readonly T[], index: number ): T {
	const item = list[ index ];
	if ( undefined === item ) {
		throw new Error( 'No item ' + index );
	}
	return item;
}

/** Fields of a node. */
function fields( doc: FormDocument, nodeId: string ): AnyField[] {
	const node = doc.nodes.find( ( n ) => n.id === nodeId );
	return node && 'fields' in node ? ( node.fields as unknown as AnyField[] ) : [];
}


function seeded(): void {
	let n = 0;
	setRandom( () => ( ( n++ * 7919 ) % 100000 ) / 100000 );
}

describe( 'document changes', () => {
	beforeEach( seeded );

	it( 'creates valid fields of every type', () => {
		let doc = blank();
		for ( const type of STEP_FIELD_TYPES ) {
			doc = produce( doc, ( d ) => {
				addStep( d, type, ctx, { after: d.start } );
			} );
		}
		for ( const type of CONTACT_FIELD_TYPES ) {
			doc = produce( doc, ( d ) => {
				addField( d, 'contact', type, ctx );
			} );
		}
		expect( validateDocument( doc ).errors ).toEqual( [] );
		expect( doc.nodes ).toHaveLength( 2 + STEP_FIELD_TYPES.length );
		expect( usedIds( doc ).size ).toBeGreaterThan( 40 );
	} );

	it( 'adds, changes, orders and removes the fields of a repeat group', () => {
		let group = '';
		let node = '';
		let doc = produce( blank(), ( d ) => {
			node = addStep( d, 'repeat', ctx, { after: d.start } );
			group = at( fields( d, node ), 0 ).id;
		} );
		const inner = ( x: FormDocument ): AnyField[] => ( at( fields( x, node ), 0 ) as unknown as { props: { fields: AnyField[] } } ).props.fields;
		const first = at( inner( doc ), 0 ).id;
		doc = produce( doc, ( d ) => {
			for ( const type of REPEAT_FIELD_TYPES ) {
				expect( addRepeatField( d, node, group, type, ctx ) ).not.toBeNull();
			}
		} );
		expect( inner( doc ).map( ( f ) => f.type ) ).toEqual( [ 'text', ...REPEAT_FIELD_TYPES ] );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		expect( checkReferences( doc ) ).toEqual( [] );
		expect( new Set( inner( doc ).map( ( f ) => f.id ) ).size ).toBe( 1 + REPEAT_FIELD_TYPES.length );

		// Another type keeps the id, the question and whether it is required.
		doc = produce( doc, ( d ) => setRepeatFieldType( d, node, group, first, 'dropdown', ctx ) );
		const changed = at( inner( doc ), 0 ) as AnyField & { required: boolean; label: Record<string, string> };
		expect( [ changed.id, changed.type, changed.required, changed.label.de_DE, changed.options?.length ] ).toEqual( [ first, 'dropdown', true, 'Name', 2 ] );
		expect( validateDocument( doc ).errors ).toEqual( [] );

		doc = produce( doc, ( d ) => moveRepeatField( d, node, group, first, 2 ) );
		expect( at( inner( doc ), 2 ).id ).toBe( first );
		doc = produce( doc, ( d ) => {
			for ( const f of inner( d ) ) {
				removeRepeatField( d, node, group, f.id );
			}
		} );
		// The group keeps one field.
		expect( inner( doc ) ).toHaveLength( 1 );
		expect( produce( doc, ( d ) => void addRepeatField( d, node, group, 'choice' as never, ctx ) ) ).toBe( doc );
	} );

	it( 'puts a new step on the default path after a node', () => {
		const doc = produce( blank(), ( d ) => {
			const first = addStep( d, 'choice', ctx );
			d.start = first;
			connect( d, first, 'contact' );
			addStep( d, 'text', ctx, { after: first } );
		} );
		const first = at( doc.nodes, 2 );
		const second = at( doc.nodes, 3 );
		expect( doc.edges.filter( ( e ) => e.default ).map( ( e ) => [ e.from, e.to ] ) ).toEqual( expect.arrayContaining( [ [ first.id, second.id ], [ second.id, 'contact' ] ] ) );
		expect( doc.layout?.nodes[ second.id ]?.x ).toBe( ( doc.layout?.nodes[ first.id ]?.x ?? 0 ) + 320 );
		expect( nodeName( first, 'de_DE' ) ).toBe( 'Neue Frage' );
		expect( checkReferences( doc ) ).toEqual( [] );
	} );

	it( 'keeps one default path per node, conditional paths before it', () => {
		let field = '';
		let option = '';
		const doc = produce( blank(), ( d ) => {
			const step = addStep( d, 'choice', ctx );
			const choice = at( fields( d, step ), 0 );
			field = choice.id;
			option = at( choice.options ?? [], 0 ).id;
			const end = addEnd( d, ctx );
			connect( d, step, 'contact' );
			connect( d, step, end );
			connect( d, step, end, { field, op: 'selected', value: option } );
		} );
		const from = at( doc.nodes, 2 ).id;
		const paths = doc.edges.filter( ( e ) => e.from === from );
		expect( paths ).toHaveLength( 2 );
		expect( at( paths, 0 ).when ).toEqual( { field, op: 'selected', value: option } );
		expect( at( paths, 1 ).default ).toBe( true );
		expect( at( paths, 1 ).to ).toBe( at( doc.nodes, 3 ).id );

		// Making the conditional path the default replaces the old default path.
		const conditional = at( paths, 0 );
		const changed = produce( doc, ( d ) => setCondition( d, conditional.id, null ) );
		expect( changed.edges.filter( ( e ) => e.from === from ) ).toEqual( [ { id: conditional.id, from, to: conditional.to, default: true } ] );

		// Removing the option removes the path that asks for it.
		const fewer = produce( doc, ( d ) => removeOption( d, from, field, option ) );
		expect( fewer.edges.filter( ( e ) => e.from === from ) ).toHaveLength( 1 );
	} );

	it( 'reorders conditional paths', () => {
		const doc = produce( blank(), ( d ) => {
			const step = addStep( d, 'number', ctx );
			const field = at( fields( d, step ), 0 ).id;
			connect( d, step, 'contact', { field, op: 'gt', value: 5 } );
			connect( d, step, 'end', { field, op: 'gt', value: 10 } );
			reorderEdge( d, at( d.edges, d.edges.length - 1 ).id, -1 );
		} );
		expect( doc.edges.slice( -2 ).map( ( e ) => e.to ) ).toEqual( [ 'end', 'contact' ] );
	} );

	it( 'removes nodes with their paths, positions and actions', () => {
		const doc = produce( blank(), ( d ) => {
			d.actions.push( { id: 'a_mail', on: 'submit', node: 'contact', kind: 'webhook', config: { url: 'https://hook.test' } } );
			removeNode( d, 'contact' );
		} );
		expect( doc.start ).toBe( 'end' );
		expect( doc.edges ).toEqual( [] );
		expect( doc.actions ).toEqual( [] );
		expect( doc.layout?.nodes.contact ).toBeUndefined();
	} );

	it( 'duplicates nodes and fields with new ids and keys', () => {
		const doc = produce( blank(), ( d ) => {
			const step = addStep( d, 'choice', ctx );
			duplicateNode( d, step );
			duplicateField( d, 'contact', 'c_email' );
		} );
		expect( checkReferences( doc ) ).toEqual( [] );
		const a = at( fields( doc, at( doc.nodes, 2 ).id ), 0 );
		const b = at( fields( doc, at( doc.nodes, 3 ).id ), 0 );
		expect( a.id ).not.toBe( b.id );
		expect( b.key ).toBe( b.id );
		expect( at( a.options ?? [], 0 ).id ).not.toBe( at( b.options ?? [], 0 ).id );
		expect( fields( doc, 'contact' ).map( ( f ) => f.type ) ).toEqual( [ 'name', 'email', 'email' ] );
	} );

	it( 'copies steps and fields into this form and others, with their rules fitted', () => {
		let step = '';
		let before = '';
		let source = produce( blank(), ( d ) => {
			before = addStep( d, 'email', ctx );
			step = addStep( d, 'choice', ctx );
			connect( d, step, 'contact' );
			addField( d, step, 'text', ctx );
			addField( d, step, 'result', ctx );
			d.calculations.push( { id: 'calc1', label: 'Preis', expression: { num: 1 }, format: { decimals: 0, decimalSeparator: ',', thousandsSeparator: '.' } } );
		} );
		const [ choice, text, result ] = fields( source, step ) as unknown as [ Field & AnyField, Field, Field ];
		source = produce( source, ( d ) => {
			const [ , t, r ] = fields( d, step ) as unknown as [ Field, Field, Field & { props: { lines: unknown[] } } ];
			t.key = 'wunsch';
			t.showWhen = { all: [ { field: choice.id, op: 'selected', value: at( choice.options ?? [], 1 ).id }, { field: at( fields( d, before ), 0 ).id, op: 'filled' } ] };
			r.props.lines = [ { calculation: 'calc1', label: { de_DE: 'Preis' } } ];
		} );
		const node = at( source.nodes.filter( ( n ) => n.id === step ), 0 );
		expect( isClip( { kind: 'node', node } ) ).toBe( true );
		expect( isClip( { kind: 'field', field: at( fields( source, 'contact' ), 0 ), contact: false } ) ).toBe( false );
		expect( isClip( { kind: 'node', node: { id: 'x', type: 'step', fields: [] } } ) ).toBe( false );

		// In the same form: after the selected step, keys renewed, the rule asks for the copied answer.
		let copy = '';
		const same = produce( source, ( d ) => {
			copy = pasteNode( d, node, step );
		} );
		expect( validateDocument( same ).errors ).toEqual( [] );
		expect( checkReferences( same ) ).toEqual( [] );
		expect( same.edges.find( ( e ) => e.from === step && e.default )?.to ).toBe( copy );
		expect( same.edges.find( ( e ) => e.from === copy && e.default )?.to ).toBe( 'contact' );
		const [ c0, c1 ] = fields( same, copy ) as unknown as [ Field & AnyField, Field ];
		expect( c1.key ).toBe( c1.id );
		expect( c1.showWhen ).toEqual( { all: [ { field: c0.id, op: 'selected', value: at( c0.options ?? [], 1 ).id }, { field: at( fields( source, before ), 0 ).id, op: 'filled' } ] } );

		// In another form: keys kept, rules and result lines on what it lacks go.
		const other = produce( blank(), ( d ) => {
			copy = pasteNode( d, node, 'contact' );
		} );
		expect( validateDocument( other ).errors ).toEqual( [] );
		const [ o0, o1, o2 ] = fields( other, copy ) as unknown as [ Field, Field, Field & { props: { lines: unknown[] } } ];
		expect( o1.key ).toBe( 'wunsch' );
		expect( o1.showWhen ).toBeUndefined();
		expect( o2.props.lines ).toEqual( [] );
		expect( other.edges.some( ( e ) => e.from === copy || e.to === copy ) ).toBe( false );
		expect( o0.id ).not.toBe( choice.id );

		// A single field: only into a node of its kind, below the selected field.
		const withField = produce( source, ( d ) => {
			expect( pasteField( d, 'contact', text, false ) ).toBeNull();
			expect( pasteField( d, step, at( fields( source, 'contact' ), 1 ) as never, true ) ).toBeNull();
			const id = pasteField( d, step, text, false, choice.id );
			expect( fields( d, step ).map( ( f ) => f.id ) ).toEqual( [ choice.id, id, text.id, result.id ] );
			expect( pasteField( d, 'contact', at( fields( source, 'contact' ), 1 ) as never, true ) ).toMatch( /^c_/ );
		} );
		expect( validateDocument( withField ).errors ).toEqual( [] );
		expect( checkReferences( withField ) ).toEqual( [] );
	} );

	it( 'duplicates the rules between the fields of a step with the step', () => {
		let step = '';
		const doc = produce( blank(), ( d ) => {
			step = addStep( d, 'choice', ctx );
			addField( d, step, 'text', ctx );
			const [ c, t ] = fields( d, step ) as unknown as [ Field, Field ];
			t.showWhen = { field: c.id, op: 'filled' };
		} );
		const copied = produce( doc, ( d ) => void duplicateNode( d, step ) );
		const [ c, t ] = fields( copied, at( copied.nodes, copied.nodes.length - 1 ).id ) as unknown as [ Field, Field ];
		expect( t.showWhen ).toEqual( { field: c.id, op: 'filled' } );
	} );

	it( 'moves fields between steps but keeps the last field of a step', () => {
		let one = '';
		let two = '';
		const doc = produce( blank(), ( d ) => {
			one = addStep( d, 'text', ctx );
			two = addStep( d, 'number', ctx );
			addField( d, two, 'email', ctx );
		} );
		const fieldOfOne = at( fields( doc, one ), 0 ).id;
		const [ firstOfTwo, secondOfTwo ] = fields( doc, two ).map( ( f ) => f.id ) as [ string, string ];
		const moved = produce( doc, ( d ) => {
			expect( moveField( d, two, secondOfTwo, one, 0 ) ).toBe( true );
			expect( moveField( d, one, fieldOfOne, 'contact', 0 ) ).toBe( false );
		} );
		expect( fields( moved, one ).map( ( f ) => f.id ) ).toEqual( [ secondOfTwo, fieldOfOne ] );
		const kept = produce( moved, ( d ) => {
			expect( moveField( d, two, firstOfTwo, one, 0 ) ).toBe( false );
			expect( removeField( d, two, firstOfTwo ) ).toBe( false );
		} );
		expect( kept ).toBe( moved );
	} );

	it( 'adds options and contact steps', () => {
		const doc = produce( blank(), ( d ) => {
			const step = addStep( d, 'dropdown', ctx );
			addOption( d, step, at( fields( d, step ), 0 ).id, ctx );
			addContact( d, ctx, { position: { x: 5, y: 6 } } );
		} );
		const field = at( fields( doc, at( doc.nodes, 2 ).id ), 0 );
		expect( ( field.options ?? [] ).map( ( o ) => o.label.de_DE ) ).toEqual( [ 'Option 1', 'Option 2', 'Option 3' ] );
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );
} );

describe( 'pasted answers', () => {
	it( 'splits lines, or semicolons and commas in one line', () => {
		expect( splitOptionList( ' Rot \n\nGrün\r\nBlau, hell ' ) ).toEqual( [ 'Rot', 'Grün', 'Blau, hell' ] );
		expect( splitOptionList( 'Rot; Grün;Blau' ) ).toEqual( [ 'Rot', 'Grün', 'Blau' ] );
		expect( splitOptionList( 'Rot, Grün,,Blau' ) ).toEqual( [ 'Rot', 'Grün', 'Blau' ] );
		expect( splitOptionList( Array.from( { length: 300 }, ( _, i ) => String( i ) ).join( '\n' ) ) ).toHaveLength( 200 );
	} );

	it( 'replaces the starting answers, keeps edited ones and those paths ask for', () => {
		const base = blank();
		const step = addStep( base, 'choice', ctx );
		const nodeOf = ( d: FormDocument ) => d.nodes.find( ( n ) => n.id === step ) as Extract<FormDocument[ 'nodes' ][ number ], { type: 'step' }>;
		const fieldId = nodeOf( base ).fields[ 0 ]?.id as string;
		const labels = ( d: FormDocument ): unknown[] => ( nodeOf( d ).fields[ 0 ] as { options: Array<{ label: unknown }> } ).options.map( ( o ) => o.label );

		const fresh = produce( base, ( d ) => void addOptions( d, step, fieldId, [ 'Rot', 'Grün' ], ctx ) );
		expect( labels( fresh ) ).toEqual( [ { de_DE: 'Rot' }, { de_DE: 'Grün' } ] );
		expect( checkReferences( fresh ) ).toEqual( [] );

		const more = produce( fresh, ( d ) => void addOptions( d, step, fieldId, [ 'Blau' ], ctx ) );
		expect( labels( more ) ).toHaveLength( 3 );
	} );
} );

describe( 'answer order and variable names', () => {
	it( 'moves an answer within its list', () => {
		const doc = produce( blank(), ( d ) => {
			const node = addStep( d, 'choice', ctx );
			const field = ( d.nodes.find( ( n ) => n.id === node ) as { fields: AnyField[] } ).fields[ 0 ] as AnyField;
			addOption( d, node, field.id, ctx );
			const ids = ( field.options ?? [] ).map( ( o ) => o.id );
			expect( moveOption( d, node, field.id, at( ids, 2 ), 0 ) ).toBe( true );
			expect( moveOption( d, node, field.id, at( ids, 2 ), -5 ) ).toBe( false );
			expect( moveOption( d, node, field.id, at( ids, 0 ), 99 ) ).toBe( true );
			expect( ( field.options ?? [] ).map( ( o ) => o.id ) ).toEqual( [ ids[ 2 ], ids[ 1 ], ids[ 0 ] ] );
		} );
		expect( doc.nodes ).toHaveLength( 3 );
	} );

	it( 'finds another field with the same variable name, but not the copies of an A/B test', () => {
		produce( blank(), ( d ) => {
			const a = addStep( d, 'choice', ctx );
			const b = addStep( d, 'text', ctx );
			const fa = ( d.nodes.find( ( n ) => n.id === a ) as { fields: AnyField[] } ).fields[ 0 ] as AnyField;
			const fb = ( d.nodes.find( ( n ) => n.id === b ) as { fields: AnyField[] } ).fields[ 0 ] as AnyField;
			expect( keyClash( d, fa.id ) ).toBeNull();
			fb.key = fa.key;
			expect( keyClash( d, fa.id )?.field.id ).toBe( fb.id );
			expect( keyClash( d, fb.id )?.node.id ).toBe( a );
			d.experiments = [ { id: 'x1', status: 'running', variants: [ { id: 'a', weight: 1 }, { id: 'b', weight: 1 } ] } ];
			// Different types are no copies.
			expect( keyClash( d, fa.id )?.field.id ).toBe( fb.id );
			fb.type = fa.type;
			expect( keyClash( d, fa.id ) ).toBeNull();
		} );
	} );
} );
