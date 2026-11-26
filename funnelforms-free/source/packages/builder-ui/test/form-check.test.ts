import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { validateDocument, type FormDocument } from '@funnelforms/form-schema';
import { addContact, addEnd, addStep, connect, setRandom } from '../src/document';
import { logicHints } from '../src/logic';
import { currentProblems, formIssues, hintIssues, issuesAt, localProblems, markOf, problemIssues } from '../src/ui/formCheck';
import { blank } from './blank';

/** The check of the builder: each problem and hint with its place, what to mark, and a fix where one is safe. */
const ctx = { locale: 'de_DE', labels: { question: 'Neue Frage', option: 'Option %d' } };

function seeded(): void {
	let n = 0;
	setRandom( () => ( ( n++ * 9301 + 49297 ) % 233280 ) / 233280 );
}

/** A choice step before the contact step, and a second contact step with the same field ids (as a form of Funnelforms 3). */
function form(): FormDocument {
	seeded();
	return produce( blank(), ( d ) => {
		const step = addStep( d, 'choice', ctx, { before: 'contact' } );
		const second = addContact( d, ctx, { position: { x: 0, y: 400 } } );
		const choice = d.nodes.find( ( n ) => n.id === step );
		const option = choice && 'step' === choice.type ? choice.fields[ 0 ] : undefined;
		if ( option && 'options' in option ) {
			connect( d, step, second, { field: option.id, op: 'selected', value: option.options[ 0 ]?.id ?? '' } );
		}
		connect( d, second, 'end' );
	} );
}

function clash( doc: FormDocument ): FormDocument {
	return produce( doc, ( d ) => {
		const [ first, second ] = d.nodes.filter( ( n ) => 'contact' === n.type );
		if ( first && second && 'contact' === first.type && 'contact' === second.type ) {
			second.fields.forEach( ( f, i ) => {
				f.id = first.fields[ i ]?.id ?? f.id;
			} );
		}
	} );
}

function run( doc: FormDocument, fix: { run: ( d: FormDocument, c: typeof ctx ) => unknown } | undefined ): FormDocument {
	expect( fix ).toBeDefined();
	return produce( doc, ( d ) => void fix?.run( d, ctx ) );
}

describe( 'problems with their places', () => {
	it( 'names fields with the same id by their step, marks both and gives the second its own id', () => {
		const doc = clash( form() );
		const problems = localProblems( doc );
		expect( problems ).toEqual( [ 'duplicate field id c_name', 'duplicate field id c_email' ] );
		const issues = problemIssues( doc, problems, 'de_DE' );
		// One issue for the pair of steps, as one click separates both fields.
		expect( issues ).toHaveLength( 1 );
		const [ issue ] = issues;
		const second = doc.nodes.filter( ( n ) => 'contact' === n.type )[ 1 ]?.id ?? '';
		expect( issue?.title ).toBe( 'Fields have the same IDs as in another step' );
		expect( issue?.blocking ).toBe( true );
		expect( issue?.target ).toEqual( { node: second } );
		expect( issue?.place ).toContain( 'Contact step' );
		expect( issue?.help ).toContain( 'not the variable name' );
		expect( new Set( issue?.marks.nodes ) ).toEqual( new Set( [ 'contact', second ] ) );
		expect( markOf( issues, 'fields', 'c_email' ) ).toBe( 'error' );
		const fixed = run( doc, issue?.fix );
		expect( validateDocument( fixed ).errors ).toEqual( [] );
	} );

	it( 'points a rule that asks for a deleted answer to its path and removes the rule', () => {
		const doc = produce( form(), ( d ) => {
			const edge = d.edges.find( ( e ) => e.when );
			if ( edge?.when && 'value' in edge.when ) {
				edge.when.value = 'o_gone';
			}
		} );
		const edge = doc.edges.find( ( e ) => e.when );
		const issues = problemIssues( doc, localProblems( doc ), 'de_DE' );
		expect( issues ).toHaveLength( 1 );
		expect( issues[ 0 ]?.title ).toBe( 'A rule asks for an answer that no longer exists' );
		expect( issues[ 0 ]?.target ).toEqual( { edge: edge?.id } );
		expect( issues[ 0 ]?.place ).toMatch( /^Path from Step .* to Contact step/ );
		expect( issuesAt( issues, { edge: edge?.id } ) ).toHaveLength( 1 );
		const fixed = run( doc, issues[ 0 ]?.fix );
		expect( localProblems( fixed ) ).toEqual( [] );
		expect( fixed.edges.some( ( e ) => e.id === edge?.id ) ).toBe( false );
	} );

	it( 'deletes a path to a deleted step and chooses a first step when the start is gone', () => {
		const lost = produce( form(), ( d ) => {
			d.edges.push( { id: 'e_lost', from: 'contact', to: 'gone', default: false, when: { field: 'c_name', op: 'filled' } } as FormDocument[ 'edges' ][ number ] );
		} );
		const path = problemIssues( lost, localProblems( lost ), 'de_DE' ).find( ( i ) => i.marks.edges.includes( 'e_lost' ) );
		expect( path?.title ).toBe( 'A path leads to a step that no longer exists' );
		expect( path?.target ).toEqual( { node: 'contact', panel: 'logic' } );
		expect( run( lost, path?.fix ).edges.some( ( e ) => 'e_lost' === e.id ) ).toBe( false );

		const startless = produce( form(), ( d ) => {
			d.start = 'gone';
		} );
		const [ start ] = problemIssues( startless, localProblems( startless ), 'de_DE' );
		expect( start?.title ).toBe( 'The form has no first step' );
		expect( localProblems( run( startless, start?.fix ) ) ).toEqual( [] );
	} );

	it( 'keeps what only the plugin can check and drops what the builder checks again itself', () => {
		const doc = form();
		expect( currentProblems( doc, [ 'duplicate field id c_name', 'booking_type_missing', '/settings/payment must have required property amount' ] ) ).toEqual( [ 'booking_type_missing', '/settings/payment must have required property amount' ] );
		const [ settings ] = problemIssues( doc, [ '/settings/payment must have required property amount' ], 'de_DE' );
		expect( settings?.target ).toEqual( { view: 'settings' } );
		// Unknown problems stay readable, without a place.
		const [ unknown ] = problemIssues( doc, [ 'something new' ], 'de_DE' );
		expect( unknown?.title ).toBe( 'something new' );
		expect( unknown?.target ).toBeUndefined();
	} );
} );

describe( 'hints about the logic', () => {
	it( 'adds an end after a step that leads nowhere', () => {
		const doc = produce( form(), ( d ) => {
			const step = addStep( d, 'text', ctx, { position: { x: 900, y: 900 } } );
			d.edges.push( { id: 'e_to_text', from: 'contact', to: step, default: false, when: { field: 'c_name', op: 'filled' } } as FormDocument[ 'edges' ][ number ] );
		} );
		const stuck = hintIssues( doc, logicHints( doc ), 'de_DE' ).find( ( i ) => i.key.startsWith( 'h:deadEnd:' ) );
		expect( stuck?.tone ).toBe( 'error' );
		expect( stuck?.blocking ).toBe( false );
		expect( stuck?.target?.panel ).toBe( 'logic' );
		const fixed = run( doc, stuck?.fix );
		expect( logicHints( fixed ).some( ( h ) => 'deadEnd' === h.code ) ).toBe( false );
	} );

	it( 'lists problems first and leaves out what follows from a broken path', () => {
		const doc = produce( form(), ( d ) => {
			const edge = d.edges.find( ( e ) => e.when );
			if ( edge?.when && 'value' in edge.when ) {
				edge.when.value = 'o_gone';
			}
			addEnd( d, ctx, { position: { x: 0, y: 900 } } );
		} );
		const issues = formIssues( doc, localProblems( doc ), logicHints( doc ), 'de_DE' );
		expect( issues[ 0 ]?.blocking ).toBe( true );
		const broken = issues[ 0 ]?.marks.edges[ 0 ];
		expect( issues.filter( ( i ) => i.marks.edges.includes( broken ?? '' ) ) ).toHaveLength( 1 );
		expect( issues.some( ( i ) => i.key.startsWith( 'h:unreachable:' ) ) ).toBe( true );
	} );
} );
