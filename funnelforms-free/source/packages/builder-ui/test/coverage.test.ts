import { describe, expect, it } from 'vitest';
import type { Condition, Edge, Field, FormDocument, FormNode } from '@funnelforms/form-schema';
import { coverage, spanText } from '../src/coverage';
import { logicHints, opposite, type HintCode } from '../src/logic';
import { hintText, restText } from '../src/ui/Hints';
import { blank } from './blank';

const option = ( id: string ) => ( { id, label: { de_DE: id.toUpperCase() }, value: id } );

const slider = ( props: Record<string, unknown> = {} ): Field =>
	( {
		id: 'f',
		type: 'slider',
		key: 'f',
		label: { de_DE: 'Fläche' },
		required: true,
		props: { min: 10, max: 200, step: 5, start: 50, unit: { text: { de_DE: 'm²' }, position: 'after' }, thousandsSeparator: true, manualInput: { enabled: false, label: { de_DE: '' } }, ...props },
	} ) as unknown as Field;

const choice = ( more: Record<string, unknown> = {}, props: Record<string, unknown> = {} ): Field =>
	( { id: 'f', type: 'choice', key: 'f', label: { de_DE: 'Dach' }, required: true, options: [ option( 'a' ), option( 'b' ), option( 'c' ) ], props: { multiple: false, layout: { desktop: 'grid', mobile: 'list' }, hideIcons: false, ...props }, ...more } ) as unknown as Field;

const field = ( type: string, props: Record<string, unknown> = {}, more: Record<string, unknown> = {} ): Field => ( { id: 'f', type, key: 'f', label: { de_DE: 'Frage' }, required: true, props, ...more } ) as unknown as Field;

const on = ( op: string, value: unknown, more: Record<string, unknown> = {} ): Condition => ( { field: 'f', op, value, ...more } ) as Condition;

/** A step with this field first and these rules as its paths, in their order, without "Otherwise". */
function form( first: Field, rules: Array<Condition | undefined>, others: Field[] = [] ): FormDocument {
	const doc = blank();
	doc.nodes.unshift( { id: 'q', type: 'step', fields: [ first, ...others ] } as unknown as FormNode );
	doc.start = 'q';
	doc.edges.unshift( ...rules.map( ( when, i ): Edge => ( { id: 'e' + ( i + 1 ), from: 'q', to: 'contact', ...( when ? { when } : {} ) } ) ) );
	return doc;
}

function cover( doc: FormDocument ) {
	const node = doc.nodes.find( ( n ) => 'q' === n.id );
	return node ? coverage( doc, node ) : null;
}

/** What is left for "Otherwise", in words. */
function rest( doc: FormDocument ): string {
	return restText( cover( doc )?.rest, 'de_DE' );
}

function codes( doc: FormDocument ): Array<[ HintCode, string | undefined ]> {
	return logicHints( doc )
		.filter( ( h ) => 'q' === h.node )
		.map( ( h ) => [ h.code, h.edge ] );
}

describe( 'which answers have a path', () => {
	it( 'needs no "Otherwise" when the rules on a slider leave no number out', () => {
		// As Funnelforms 4 has no "else": below, exactly and above.
		const doc = form( slider(), [ on( 'lt', 20 ), on( 'eq', 20 ), on( 'gt', 20 ) ] );
		expect( cover( doc ) ).toMatchObject( { complete: true, unused: [], rest: { options: [], spans: [], none: false, combinations: false } } );
		expect( codes( doc ) ).toEqual( [] );
		// "Between" with the numbers around it.
		expect( cover( form( slider(), [ on( 'lt', 20 ), { all: [ on( 'gte', 20 ), on( 'lte', 100 ) ] }, on( 'gt', 100 ) ] ) )?.complete ).toBe( true );
	} );

	it( 'names the numbers no rule takes', () => {
		const gap = form( slider(), [ on( 'lt', 20 ), on( 'gt', 30 ) ] );
		expect( cover( gap )?.complete ).toBe( false );
		expect( cover( gap )?.rest.spans ).toEqual( [ { from: 20, to: 30 } ] );
		expect( rest( gap ) ).toBe( '20 – 30' );
		expect( codes( gap ) ).toEqual( [ [ 'noOtherwise', undefined ] ] );
		const [ hint ] = logicHints( gap ).filter( ( h ) => 'noOtherwise' === h.code );
		expect( hint ? hintText( hint, gap, 'de_DE' ) : '' ).toBe( 'No path takes these answers, so visitors get stuck: 20 – 30. Choose where they go under “Otherwise”.' );
		// One position of the slider, the ends, and several gaps.
		expect( rest( form( slider(), [ on( 'lt', 20 ), on( 'gt', 20 ) ] ) ) ).toBe( '20' );
		expect( rest( form( slider(), [ on( 'gte', 50 ) ] ) ) ).toBe( '10 – 45' );
		expect( rest( form( slider(), [ { all: [ on( 'gte', 50 ), on( 'lte', 100 ) ] } ] ) ) ).toBe( '10 – 45, 105 – 200' );
		// Steps with decimals.
		expect( rest( form( slider( { min: 0, max: 1, step: 0.1 } ), [ on( 'lt', 0.3 ), on( 'gt', 0.5 ) ] ) ) ).toBe( '0.3 – 0.5' );
		// A rating has its points.
		expect( rest( form( field( 'rating', { min: 1, max: 5 } ), [ on( 'gte', 4 ) ] ) ) ).toBe( '1 – 3' );
		expect( cover( form( field( 'rating', { min: 1, max: 5 } ), [ on( 'gte', 4 ), on( 'lte', 3 ) ] ) )?.complete ).toBe( true );
	} );

	it( 'reads typed numbers as every number between the bounds', () => {
		const typed = slider( { manualInput: { enabled: true, label: { de_DE: '' } } } );
		expect( rest( form( typed, [ on( 'lt', 20 ), on( 'gt', 20 ) ] ) ) ).toBe( '20' );
		expect( rest( form( typed, [ on( 'lt', 20 ), on( 'gte', 30 ) ] ) ) ).toBe( '≥ 20 … < 30' );
		expect( rest( form( typed, [ on( 'lte', 20 ), on( 'gte', 30 ) ] ) ) ).toBe( '> 20 … < 30' );
		expect( cover( form( typed, [ on( 'lte', 20 ), on( 'gt', 20 ) ] ) )?.complete ).toBe( true );
		// A number field without bounds; left empty when it need not be answered.
		const number = field( 'number', {} );
		expect( cover( form( number, [ on( 'lt', 0 ), on( 'gte', 0 ) ] ) )?.complete ).toBe( true );
		expect( rest( form( number, [ on( 'gt', 100 ) ] ) ) ).toBe( '≤ 100' );
		expect( rest( form( number, [ on( 'lt', 10 ), on( 'gt', 20 ) ] ) ) ).toBe( '10 – 20' );
		expect( rest( form( field( 'number', {}, { required: false } ), [ on( 'lt', 0 ), on( 'gte', 0 ) ] ) ) ).toBe( 'no answer' );
		// With bounds nothing outside them is missing.
		expect( cover( form( field( 'number', { min: 0, max: 10 } ), [ on( 'lte', 5 ), on( 'gt', 5 ) ] ) )?.complete ).toBe( true );
		expect( rest( form( field( 'number', { min: 0 } ), [ on( 'lte', 5 ) ] ) ) ).toBe( '> 5' );
	} );

	it( 'finds paths no answer reaches', () => {
		// The path before takes every number it asks for.
		const shadowed = form( slider(), [ on( 'lt', 50 ), on( 'lt', 20 ), on( 'gte', 50 ) ] );
		expect( cover( shadowed )?.unused ).toEqual( [ { edge: 'e2', never: false } ] );
		expect( codes( shadowed ) ).toEqual( [ [ 'shadowed', 'e2' ] ] );
		// No position of the slider fulfils it.
		const never = form( slider(), [ on( 'gt', 500 ), on( 'lte', 200 ) ] );
		expect( cover( never )?.unused ).toEqual( [ { edge: 'e1', never: true } ] );
		expect( codes( never ) ).toEqual( [ [ 'noAnswer', 'e1' ] ] );
		// Between two positions of a slider there is no answer; a typed number can be there.
		expect( codes( form( slider(), [ { all: [ on( 'gt', 20 ), on( 'lt', 25 ) ] }, on( 'gte', 10 ) ] ) ) ).toEqual( [ [ 'noAnswer', 'e1' ] ] );
		expect( codes( form( slider( { manualInput: { enabled: true, label: { de_DE: '' } } } ), [ { all: [ on( 'gt', 20 ), on( 'lt', 25 ) ] }, on( 'gte', 10 ) ] ) ) ).toEqual( [] );
		// The same rule twice and rules that contradict each other keep their own hints.
		expect( codes( form( slider(), [ on( 'lt', 50 ), on( 'lt', 50 ), on( 'gte', 50 ) ] ) ) ).toEqual( [ [ 'sameRule', 'e2' ] ] );
	} );

	it( 'counts "no answer" for a choice that need not be answered or can be hidden', () => {
		const all = [ on( 'selected', 'a' ), on( 'selected', 'b' ), on( 'selected', 'c' ) ];
		expect( cover( form( choice(), all ) )?.complete ).toBe( true );
		expect( rest( form( choice( { required: false } ), all ) ) ).toBe( 'no answer' );
		expect( rest( form( choice( { showWhen: { field: 'x', op: 'filled' } } ), all ) ) ).toBe( 'no answer' );
		// "Is not answered" takes those visitors.
		expect( cover( form( choice( { required: false } ), [ ...all, on( 'empty', undefined ) ] ) )?.complete ).toBe( true );
		expect( rest( form( choice(), [ on( 'selected', 'a' ) ] ) ) ).toBe( 'B, C' );
		// Answers that lead to the same step in one path.
		expect( rest( form( choice(), [ { any: [ on( 'selected', 'a' ), on( 'selected', 'c' ) ] } ] ) ) ).toBe( 'B' );
		// A dropdown as a choice.
		expect( rest( form( { ...choice(), type: 'dropdown', props: {} } as unknown as Field, [ on( 'selected', 'b' ) ] ) ) ).toBe( 'A, C' );
	} );

	it( 'tries every combination of several answers', () => {
		const many = ( props: Record<string, unknown> = {} ) => choice( {}, { multiple: true, ...props } );
		// Each answer has a path: every combination contains one of them.
		expect( cover( form( many(), [ on( 'selected', 'a' ), on( 'selected', 'b' ), on( 'selected', 'c' ) ] ) )?.complete ).toBe( true );
		expect( rest( form( many(), [ on( 'selected', 'a' ), on( 'selected', 'b' ) ] ) ) ).toBe( 'C' );
		// As Funnelforms 4 matches exactly: only these answers and no other.
		const exact = form( many(), [ { all: [ on( 'selected', 'a' ), on( 'selected', 'b' ), on( 'eq', 2, { number: 'count' } ) ] }, on( 'selectedOnly', 'c' ) ] );
		expect( cover( exact )?.rest ).toMatchObject( { options: [ { id: 'a' }, { id: 'b' } ], combinations: true } );
		expect( rest( exact ) ).toBe( 'A, B' );
		// Only combinations are left.
		expect( rest( form( many(), [ on( 'selectedOnly', 'a' ), on( 'selectedOnly', 'b' ), on( 'selectedOnly', 'c' ) ] ) ) ).toBe( 'some combinations of answers' );
		// By their number.
		expect( cover( form( many(), [ on( 'gte', 2, { number: 'count' } ), on( 'lt', 2, { number: 'count' } ) ] ) )?.complete ).toBe( true );
		// With at least two answers a single one is no answer; with at most one no combination is.
		expect( cover( form( many( { minChoices: 2 } ), [ on( 'gte', 2, { number: 'count' } ) ] ) )?.complete ).toBe( true );
		expect( cover( form( many( { maxChoices: 1 } ), [ on( 'selectedOnly', 'a' ), on( 'selectedOnly', 'b' ), on( 'selectedOnly', 'c' ) ] ) )?.complete ).toBe( true );
		// A rule after the answers that only they reach is never taken.
		expect( codes( form( many(), [ on( 'selected', 'a' ), on( 'selected', 'b' ), { all: [ on( 'selected', 'a' ), on( 'selected', 'b' ) ] }, on( 'selected', 'c' ) ] ) ) ).toEqual( [ [ 'shadowed', 'e3' ] ] );
	} );

	it( 'says nothing where the answers cannot be listed', () => {
		const other = field( 'text', { placeholder: { de_DE: '' } }, { id: 'g', key: 'g' } );
		// Another field, or two fields.
		expect( cover( form( slider(), [ { field: 'g', op: 'filled' } as Condition ], [ other ] ) ) ).toBeNull();
		expect( cover( form( slider(), [ on( 'lt', 20 ), { all: [ on( 'gte', 20 ), { field: 'g', op: 'filled' } as Condition ] } ], [ other ] ) ) ).toBeNull();
		// Text, a calculation, an A/B test, a slider with two handles, a part of an address.
		expect( cover( form( field( 'text', { placeholder: { de_DE: '' } } ), [ on( 'startsWith', '99' ) ] ) ) ).toBeNull();
		expect( cover( form( slider(), [ { calc: 'c', op: 'gte', value: 1 } as Condition ] ) ) ).toBeNull();
		expect( cover( form( slider(), [ { experiment: 'x', variant: 'b' } as Condition ] ) ) ).toBeNull();
		expect( cover( form( slider( { range: true } ), [ on( 'lt', 20 ) ] ) ) ).toBeNull();
		expect( cover( form( field( 'address', {} ), [ on( 'startsWith', '99', { part: 'zip' } ) ] ) ) ).toBeNull();
		// A path that is always taken, no rules at all, more answers than can be tried.
		expect( cover( form( slider(), [ on( 'lt', 20 ), undefined ] ) ) ).toBeNull();
		expect( cover( form( slider(), [] ) ) ).toBeNull();
		const twelve = { ...choice( {}, { multiple: true } ), options: Array.from( { length: 12 }, ( _x, i ) => option( 'o' + i ) ) } as unknown as Field;
		expect( cover( form( twelve, [ on( 'selected', 'o1' ) ] ) ) ).toBeNull();
		expect( cover( form( slider( { min: 0, max: 100000, step: 1 } ), [ on( 'lt', 20 ) ] ) ) ).toBeNull();
		// Contact steps and ends have none.
		const doc = form( slider(), [ on( 'lt', 20 ) ] );
		expect( doc.nodes.filter( ( n ) => 'step' !== n.type ).map( ( n ) => coverage( doc, n ) ) ).toEqual( [ null, null ] );
		// Without knowing better the step still asks for "Otherwise".
		expect( codes( form( field( 'text', { placeholder: { de_DE: '' } } ), [ on( 'startsWith', '99' ) ] ) ) ).toEqual( [ [ 'noOtherwise', undefined ] ] );
	} );

	it( 'needs no "Otherwise" when two rules are each other\'s opposite', () => {
		// As Funnelforms 4 forms have it: "is exactly yes" to one step, "is not exactly yes" to another.
		const text = field( 'text', { placeholder: { de_DE: '' } }, { required: false } );
		expect( codes( form( text, [ on( 'equalsText', 'ja' ), on( 'notEqualsText', 'ja' ) ] ) ) ).toEqual( [] );
		expect( codes( form( text, [ on( 'notContains', 'Solar ' ), on( 'startsWith', 'x' ), on( 'contains', 'solar' ) ] ) ) ).toEqual( [] );
		expect( codes( form( text, [ on( 'filled', undefined ), on( 'empty', undefined ) ] ) ) ).toEqual( [] );
		expect( codes( form( field( 'address', {} ), [ on( 'equalsText', 'AT', { part: 'country' } ), on( 'notEqualsText', 'AT', { part: 'country' } ) ] ) ) ).toEqual( [] );
		expect( opposite( on( 'eq', 3 ), on( 'neq', 3 ) ) ).toBe( true );
		// Not opposites: another text, another part, another way of counting, or rules a visitor without a number fulfils neither of.
		expect( codes( form( text, [ on( 'equalsText', 'ja' ), on( 'notEqualsText', 'Ja' ) ] ) ) ).toEqual( [ [ 'noOtherwise', undefined ] ] );
		expect( opposite( on( 'equalsText', 'AT', { part: 'country' } ), on( 'notEqualsText', 'AT', { part: 'city' } ) ) ).toBe( false );
		expect( opposite( on( 'eq', 2, { number: 'count' } ), on( 'neq', 2 ) ) ).toBe( false );
		expect( opposite( on( 'lt', 20 ), on( 'gte', 20 ) ) ).toBe( false );
		expect( opposite( on( 'equalsText', 'ja' ), { field: 'g', op: 'notEqualsText', value: 'ja' } ) ).toBe( false );
		expect( opposite( { all: [ on( 'equalsText', 'ja' ) ] }, on( 'notEqualsText', 'ja' ) ) ).toBe( false );
	} );

	it( 'writes spans as the rules show their numbers', () => {
		expect( spanText( { from: 20, to: 20 } ) ).toBe( '20' );
		expect( spanText( { from: 20, to: 30 } ) ).toBe( '20 – 30' );
		expect( spanText( { from: 20, to: 30, fromOpen: true } ) ).toBe( '> 20 … ≤ 30' );
		expect( spanText( { to: 30, toOpen: true } ) ).toBe( '< 30' );
		expect( spanText( { from: 1000 }, ( n ) => n.toLocaleString( 'de-DE' ) ) ).toBe( '≥ 1.000' );
		expect( spanText( {} ) ).toBe( '' );
		// More than four answers: the rest as a number.
		const six = { ...choice(), options: [ 'a', 'b', 'c', 'd', 'e', 'g' ].map( option ) } as unknown as Field;
		expect( rest( form( six, [ on( 'selected', 'a' ) ] ) ) ).toBe( 'B, C, D, E, +1' );
		expect( restText( undefined, 'de_DE' ) ).toBe( '' );
	} );
} );
