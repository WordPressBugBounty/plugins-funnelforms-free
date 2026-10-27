import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { checkReferences, type Condition, type FormDocument, type FormNode } from '@funnelforms/form-schema';
import { answerRoutes, fieldsBefore, fromGroup, nodesBefore, setAnswerRoute, toGroup } from '../src/conditions';
import { dropRules, lossOf, asksFor, removeField, removeOption } from '../src/document';
import { logicHints, never, type HintCode } from '../src/logic';
import { edgeLabel } from '../src/ui/describe';
import { lossText } from '../src/ui/Removal';
import { blank } from './blank';

const house: Condition = { field: 'f_kind', op: 'selected', value: 'o_house' };
const flat: Condition = { field: 'f_kind', op: 'selected', value: 'o_flat' };
const rich: Condition = { field: 'f_budget', op: 'gte', value: 1000 };

/** Kind of property, then budget and a note shown on large budgets, then the contact step. */
function funnel(): FormDocument {
	const doc = blank();
	const steps: FormNode[] = [
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
					props: { multiple: false, layout: 'list', autoAdvance: false },
				},
			],
		},
		{
			id: 'q2',
			type: 'step',
			fields: [
				{ id: 'f_budget', type: 'number', key: 'budget', label: { de_DE: 'Budget' }, required: true, props: {} },
				{ id: 'f_note', type: 'text', key: 'note', label: { de_DE: 'Was ist dir wichtig?' }, required: true, props: { placeholder: { de_DE: '' } }, showWhen: rich },
			],
		},
	] as unknown as FormNode[];
	doc.nodes.unshift( ...steps );
	doc.nodes.push( { id: 'end2', type: 'end', success: { show: true, text: { de_DE: 'Wir rufen an.' } }, redirect: null } );
	doc.start = 'q1';
	doc.edges.unshift( { id: 'e1', from: 'q1', to: 'q2', default: true }, { id: 'e2', from: 'q2', to: 'contact', default: true } );
	return doc;
}

function codes( doc: FormDocument ): Array<[ HintCode, string, string | undefined ]> {
	return logicHints( doc ).map( ( h ) => [ h.code, h.node, h.edge ?? h.field ] );
}

describe( 'rule groups', () => {
	it( 'turns conditions into groups and back, as small as they get', () => {
		const condition: Condition = { all: [ house, { any: [ rich, { field: 'f_note', op: 'filled' } ] } ] };
		const group = toGroup( condition );
		expect( group ).toEqual( { mode: 'all', items: [ house, { mode: 'any', items: [ rich, { field: 'f_note', op: 'filled' } ] } ] } );
		expect( fromGroup( group ) ).toEqual( condition );
		// A group of one rule is the rule; empty groups go; a group of the same kind joins its parent.
		expect( fromGroup( { mode: 'any', items: [ house ] } ) ).toEqual( house );
		expect( fromGroup( { mode: 'all', items: [ { mode: 'any', items: [] } ] } ) ).toBeNull();
		expect( fromGroup( { mode: 'all', items: [ house, { mode: 'all', items: [ rich, flat ] } ] } ) ).toEqual( { all: [ house, rich, flat ] } );
		// A new inner group keeps its first rule as a group, so more rules can join it.
		expect( fromGroup( { mode: 'all', items: [ house, { mode: 'any', items: [ rich ] } ] } ) ).toEqual( { all: [ house, { any: [ rich ] } ] } );
		expect( toGroup( undefined ) ).toEqual( { mode: 'all', items: [] } );
		expect( toGroup( house ) ).toEqual( { mode: 'all', items: [ house ] } );
	} );
} );

describe( 'answers a rule can ask for', () => {
	it( 'offers the answers of earlier steps and of the step itself, in the order visitors give them', () => {
		const doc = funnel();
		const ids = ( list: ReturnType<typeof fieldsBefore> ) => list.map( ( f ) => f.field.id );
		expect( [ ...nodesBefore( doc, 'contact' ) ].sort() ).toEqual( [ 'q1', 'q2' ] );
		expect( ids( fieldsBefore( doc, 'q1' ) ) ).toEqual( [ 'f_kind' ] );
		expect( ids( fieldsBefore( doc, 'q2' ) ) ).toEqual( [ 'f_kind', 'f_budget', 'f_note' ] );
		expect( ids( fieldsBefore( doc, 'contact' ) ) ).toEqual( [ 'f_kind', 'f_budget', 'f_note' ] );
		// A field is shown on answers above it only.
		expect( ids( fieldsBefore( doc, 'q2', 'f_note' ) ) ).toEqual( [ 'f_kind', 'f_budget' ] );
		expect( ids( fieldsBefore( doc, 'q2', 'f_budget' ) ) ).toEqual( [ 'f_kind' ] );
	} );
} );

describe( 'next step by answer', () => {
	it( 'adds, changes and removes the path of one answer', () => {
		let doc = produce( funnel(), ( d ) => setAnswerRoute( d, 'q1', 'f_kind', 'o_house', 'end2' ) );
		const routes = () => answerRoutes( doc, 'q1', 'f_kind' ).map( ( r ) => [ r.option.id, r.edge?.to ] );
		expect( routes() ).toEqual( [ [ 'o_house', 'end2' ], [ 'o_flat', undefined ] ] );
		// Checked before the default path.
		expect( doc.edges.filter( ( e ) => 'q1' === e.from ).map( ( e ) => e.default ?? false ) ).toEqual( [ false, true ] );
		expect( checkReferences( doc ) ).toEqual( [] );

		doc = produce( doc, ( d ) => setAnswerRoute( d, 'q1', 'f_kind', 'o_house', 'contact' ) );
		expect( routes() ).toEqual( [ [ 'o_house', 'contact' ], [ 'o_flat', undefined ] ] );
		// The target of the default path, or none, follows the other paths again.
		doc = produce( doc, ( d ) => setAnswerRoute( d, 'q1', 'f_kind', 'o_house', 'q2' ) );
		expect( routes() ).toEqual( [ [ 'o_house', undefined ], [ 'o_flat', undefined ] ] );
		expect( doc.edges.filter( ( e ) => 'q1' === e.from ) ).toHaveLength( 1 );
	} );

	it( 'labels a path with the answers that lead there', () => {
		const doc = funnel();
		expect( edgeLabel( { any: [ house, flat ] }, doc, 'de_DE', 'q1' ) ).toBe( 'Haus or Wohnung' );
		expect( edgeLabel( house, doc, 'de_DE', 'q1' ) ).toBe( 'Haus' );
		// Answers of another step, or other rules, are described.
		expect( edgeLabel( house, doc, 'de_DE', 'q2' ) ).not.toBe( 'Haus' );
		expect( edgeLabel( rich, doc, 'de_DE', 'q2' ).length ).toBeLessThanOrEqual( 34 );
	} );
} );

describe( 'deleting what rules ask for', () => {
	it( 'drops the rules, removes paths that can no longer be taken and shows fields always', () => {
		const doc = produce( funnel(), ( d ) => {
			d.edges.unshift( { id: 'e_both', from: 'q2', to: 'end2', when: { all: [ house, rich ] } }, { id: 'e_either', from: 'q2', to: 'end', when: { any: [ house, { field: 'f_note', op: 'filled' } ] } } );
		} );
		const loss = lossOf( doc, ( leaf ) => 'field' in leaf && 'f_budget' === leaf.field );
		expect( loss ).toEqual( { removedPaths: 1, changedPaths: 0, shownFields: 1 } );
		// Only counted, nothing changed.
		expect( doc.edges.some( ( e ) => 'e_both' === e.id ) ).toBe( true );

		const after = produce( doc, ( d ) => void dropRules( d, asksFor( 'f_kind', 'o_house' ) ) );
		expect( after.edges.some( ( e ) => 'e_both' === e.id ) ).toBe( false );
		expect( after.edges.find( ( e ) => 'e_either' === e.id )?.when ).toEqual( { field: 'f_note', op: 'filled' } );
		expect( lossText( { removedPaths: 1, changedPaths: 1, shownFields: 0 } ) ).toBe( 'Deleted. Rules asked for it, so the logic changed: paths removed: 1, paths with fewer rules: 1.' );
		expect( lossText( { removedPaths: 0, changedPaths: 0, shownFields: 0 } ) ).toBeNull();
	} );

	it( 'keeps the rules on other answers of a field when one answer goes', () => {
		const doc = produce( funnel(), ( d ) => {
			d.edges.unshift( { id: 'e_flat', from: 'q1', to: 'end2', when: flat }, { id: 'e_house', from: 'q1', to: 'end', when: house } );
			d.nodes.push( { id: 'q3', type: 'step', fields: [ { id: 'f_more', type: 'text', key: 'more', label: {}, required: false, props: { placeholder: {} } } ] } as unknown as FormNode );
		} );
		const after = produce( doc, ( d ) => removeOption( d, 'q1', 'f_kind', 'o_house' ) );
		expect( after.edges.map( ( e ) => e.id ) ).toContain( 'e_flat' );
		expect( after.edges.map( ( e ) => e.id ) ).not.toContain( 'e_house' );
		const noNote = produce( doc, ( d ) => void removeField( d, 'q2', 'f_budget' ) );
		const note = noNote.nodes.find( ( n ) => 'q2' === n.id );
		expect( note && 'step' === note.type ? note.fields[ 0 ] : null ).not.toHaveProperty( 'showWhen' );
	} );
} );

describe( 'logic hints', () => {
	it( 'finds nothing in a form whose every step leads on', () => {
		expect( codes( produce( funnel(), ( d ) => void ( d.nodes = d.nodes.filter( ( n ) => 'end2' !== n.id ) ) ) ) ).toEqual( [] );
	} );

	it( 'finds dead ends, gaps, ends nobody reaches and ends that show nothing', () => {
		const doc = produce( funnel(), ( d ) => {
			d.edges = d.edges.filter( ( e ) => 'e2' !== e.id );
			d.edges.unshift( { id: 'e_house', from: 'q1', to: 'q2', when: house } );
			d.edges = d.edges.filter( ( e ) => 'e1' !== e.id );
			const end = d.nodes.find( ( n ) => 'end2' === n.id );
			if ( end && 'end' === end.type ) {
				end.success = null;
				end.redirect = { url: { de_DE: '' }, newTab: false, delayMs: 0, params: [] };
			}
		} );
		expect( codes( doc ) ).toEqual( [
			[ 'noOtherwise', 'q1', undefined ],
			[ 'deadEnd', 'q2', undefined ],
			[ 'unreachable', 'contact', undefined ],
			[ 'unreachable', 'end', undefined ],
			[ 'unreachable', 'end2', undefined ],
			[ 'redirectNoUrl', 'end2', undefined ],
		] );
		// Every answer of a required single choice with a path of its own needs no "otherwise".
		const routed = produce( doc, ( d ) => setAnswerRoute( d, 'q1', 'f_kind', 'o_flat', 'end2' ) );
		expect( codes( routed ).map( ( c ) => c[ 0 ] ) ).not.toContain( 'noOtherwise' );
		expect( codes( routed ) ).toContainEqual( [ 'noEntry', 'end2', undefined ] );
	} );

	it( 'finds paths that are never taken or ask for answers given later', () => {
		const doc = produce( funnel(), ( d ) => {
			d.edges.unshift(
				{ id: 'e_later', from: 'q1', to: 'end2', when: rich },
				{ id: 'e_never', from: 'q1', to: 'end2', when: { all: [ house, flat ] } },
				{ id: 'e_house', from: 'q1', to: 'contact', when: house },
				{ id: 'e_again', from: 'q1', to: 'end', when: house },
				{ id: 'e_always', from: 'q1', to: 'contact' },
				{ id: 'e_after', from: 'q1', to: 'end', when: flat }
			);
		} );
		expect( codes( doc ).filter( ( c ) => 'q1' === c[ 1 ] ) ).toEqual( [
			[ 'laterAnswer', 'q1', 'e_later' ],
			[ 'impossible', 'q1', 'e_never' ],
			[ 'sameRule', 'q1', 'e_again' ],
			[ 'neverChecked', 'q1', 'e_after' ],
		] );
		expect( never( { all: [ rich, { field: 'f_budget', op: 'lt', value: 500 } ] }, new Map() ) ).toBe( true );
		expect( never( { all: [ rich, { field: 'f_budget', op: 'lt', value: 5000 } ] }, new Map() ) ).toBe( false );
		expect( never( { all: [ { field: 'f_note', op: 'filled' }, { field: 'f_note', op: 'empty' } ] }, new Map() ) ).toBe( true );
	} );

	it( 'finds loops visitors cannot leave and fields shown on answers given below them', () => {
		const doc = produce( funnel(), ( d ) => {
			const back = d.edges.find( ( e ) => 'e2' === e.id );
			if ( back ) {
				back.to = 'q1';
			}
			const step = d.nodes.find( ( n ) => 'q2' === n.id );
			const budget = step && 'step' === step.type ? step.fields[ 0 ] : undefined;
			if ( budget ) {
				budget.showWhen = { field: 'f_note', op: 'filled' };
			}
		} );
		const found = codes( doc );
		expect( found ).toContainEqual( [ 'endlessLoop', 'q1', 'e1' ] );
		expect( found ).toContainEqual( [ 'endlessLoop', 'q2', 'e2' ] );
		expect( found ).toContainEqual( [ 'showLater', 'q2', 'f_budget' ] );
		expect( found ).toContainEqual( [ 'allHidden', 'q2', undefined ] );
	} );
} );
