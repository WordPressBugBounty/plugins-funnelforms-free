import { describe, expect, it } from 'vitest';
import { checkReferences, validateDocument, type ChoiceField, type FormDocument } from '@funnelforms/form-schema';
import { calculationUses, evaluate, removeCalculation, testValues } from '../src/calculations';
import { addStep, findNode } from '../src/document';
import { addQuizCategory, addQuizResult, isQuizEdge, moveQuizCategory, quizExpression, quizMax, quizQuestions, quizResults, removeQuizCategory, removeQuizResult, renameQuizCategory, resultText, setAnswerPoints, setAnswerScore, setQuizKind, setQuizResultMin, setRightAnswer, startQuiz, stopQuiz, syncQuiz } from '../src/quiz';
import { blank } from './blank';

/** The item, which the test knows is there. */
function must<T>( value: T | undefined ): T {
	if ( undefined === value ) {
		throw new Error( 'missing' );
	}
	return value;
}

const ctx = { locale: 'de_DE', labels: { quizResult: 'Dein Ergebnis', quizPoints: 'Du hast %1$s von %2$s Punkten.', quizRight: '%1$s von %2$s richtig.' } };

/** Two choice questions before the contact step. */
function form(): { doc: FormDocument; q1: ChoiceField; q2: ChoiceField } {
	const doc = blank();
	addStep( doc, 'choice', ctx, { before: 'contact' } );
	addStep( doc, 'choice', ctx, { before: 'contact' } );
	const [ q1, q2 ] = doc.nodes.flatMap( ( n ) => ( 'step' === n.type ? n.fields : [] ) ) as ChoiceField[];
	return { doc, q1: must( q1 ), q2: must( q2 ) };
}

function valid( doc: FormDocument ): void {
	expect( validateDocument( doc ).errors ).toEqual( [] );
	expect( checkReferences( doc ) ).toEqual( [] );
}

describe( 'quiz mode', () => {
	it( 'adds the points of the questions with points in a calculation of its own', () => {
		const { doc, q1, q2 } = form();
		startQuiz( doc, 'points', 'Quizpunkte' );
		valid( doc );
		const calc = must( doc.calculations[ 0 ] );
		expect( doc.settings.quiz ).toEqual( { kind: 'points', calculation: calc.id, results: [] } );
		expect( calc ).toMatchObject( { label: 'Quizpunkte', expression: { num: 0 }, format: { decimals: 0 } } );
		expect( calculationUses( doc, calc.id ) ).toContain( 'quiz' );
		expect( removeCalculation( doc, calc.id ) ).toBe( false );

		must( q1.options[ 0 ] ).calcValue = 3;
		must( q1.options[ 1 ] ).calcValue = 5;
		q2.props.multiple = true;
		must( q2.options[ 0 ] ).calcValue = 2;
		must( q2.options[ 1 ] ).calcValue = -1;
		syncQuiz( doc );
		expect( quizQuestions( doc ).map( ( f ) => f.id ) ).toEqual( [ q1.id, q2.id ] );
		expect( calc.expression ).toEqual( { op: '+', args: [ { var: q1.key }, { var: q2.key } ] } );
		// The best single answer, and the positive ones of a multiple choice.
		expect( quizMax( doc ) ).toBe( 7 );

		// A question sharing a name (an A/B copy) counts once, with its larger points.
		q2.key = q1.key;
		syncQuiz( doc );
		expect( calc.expression ).toEqual( { var: q1.key } );
		expect( quizMax( doc ) ).toBe( 5 );
	} );

	it( 'counts questions with right answers in a knowledge quiz, one right answer for single choices', () => {
		const { doc, q1, q2 } = form();
		startQuiz( doc, 'knowledge', 'Quiz' );
		must( q1.options[ 0 ] ).calcValue = 9;
		syncQuiz( doc );
		expect( quizQuestions( doc ) ).toEqual( [] );

		setRightAnswer( doc, q1.id, must( q1.options[ 0 ] ).id, true );
		setRightAnswer( doc, q1.id, must( q1.options[ 1 ] ).id, true );
		expect( q1.options.map( ( o ) => o.correct ) ).toEqual( [ undefined, true ] );
		q2.props.multiple = true;
		setRightAnswer( doc, q2.id, must( q2.options[ 0 ] ).id, true );
		setRightAnswer( doc, q2.id, must( q2.options[ 1 ] ).id, true );
		expect( q2.options.map( ( o ) => o.correct ) ).toEqual( [ true, true ] );
		syncQuiz( doc );
		expect( quizMax( doc ) ).toBe( 2 );
		expect( must( doc.calculations[ 0 ] ).expression ).toEqual( { op: '+', args: [ { var: q1.key }, { var: q2.key } ] } );
		valid( doc );

		// Points per answer drop the right answers and the feedback.
		doc.settings.quiz = { ...( doc.settings.quiz ?? { kind: 'knowledge', calculation: '', results: [] } ), feedback: true };
		setQuizKind( doc, 'points' );
		expect( doc.settings.quiz?.feedback ).toBeUndefined();
		expect( q2.options.some( ( o ) => o.correct ) ).toBe( false );
		expect( must( doc.calculations[ 0 ] ).expression ).toEqual( { var: q1.key } );
	} );

	it( 'leads the contact step to the result the points reach and keeps that path when results change', () => {
		const { doc, q1 } = form();
		startQuiz( doc, 'points', 'Quiz' );
		must( q1.options[ 0 ] ).calcValue = 10;
		syncQuiz( doc );
		const calc = must( doc.calculations[ 0 ] ).id;

		// The first result takes over the thank-you page after the contact step.
		const low = addQuizResult( doc, ctx, resultText( doc, ctx ) );
		expect( low ).toBe( 'end' );
		const end = findNode( doc, 'end' );
		expect( end && 'end' === end.type ? end.success?.text : null ).toEqual( { de_DE: `<h3>Dein Ergebnis</h3><p>Du hast <strong>{{calc:${ calc }}}</strong> von {{quiz:max}} Punkten.</p>` } );
		expect( doc.edges.filter( ( e ) => 'contact' === e.from ) ).toEqual( [ { id: 'e_contact_end', from: 'contact', to: 'end', default: true } ] );

		// The next ones are new pages, halfway to the most points.
		const high = addQuizResult( doc, ctx, resultText( doc, ctx ) ) ?? '';
		expect( quizResults( doc ) ).toEqual( [ { node: 'end', min: 0 }, { node: high, min: 5 } ] );
		const mid = addQuizResult( doc, ctx, resultText( doc, ctx ) ) ?? '';
		expect( quizResults( doc ).map( ( r ) => r.min ) ).toEqual( [ 0, 5, 8 ] );
		setQuizResultMin( doc, mid, 3 );
		const paths = doc.edges.filter( ( e ) => 'contact' === e.from );
		expect( paths.map( ( { from, to, when, default: d } ) => ( { from, to, when, default: d } ) ) ).toEqual( [
			{ from: 'contact', to: high, when: { calc, op: 'gte', value: 5 }, default: undefined },
			{ from: 'contact', to: mid, when: { calc, op: 'gte', value: 3 }, default: undefined },
			{ from: 'contact', to: 'end', when: undefined, default: true },
		] );
		expect( paths.every( ( e ) => isQuizEdge( doc, e ) ) ).toBe( true );
		valid( doc );

		// In step: nothing changes when nothing differs.
		const before = JSON.stringify( doc );
		syncQuiz( doc );
		expect( JSON.stringify( doc ) ).toBe( before );

		// A result removed takes its page; one whose page was deleted goes from the list.
		removeQuizResult( doc, mid );
		expect( findNode( doc, mid ) ).toBeUndefined();
		doc.nodes = doc.nodes.filter( ( n ) => n.id !== high );
		syncQuiz( doc );
		expect( quizResults( doc ) ).toEqual( [ { node: 'end', min: 0 } ] );
		expect( doc.edges.filter( ( e ) => 'contact' === e.from ).map( ( e ) => e.to ) ).toEqual( [ 'end' ] );
		valid( doc );
	} );

	it( 'ends quiz mode without the right answers and keeps calculation and pages', () => {
		const { doc, q1 } = form();
		startQuiz( doc, 'knowledge', 'Quiz' );
		setRightAnswer( doc, q1.id, must( q1.options[ 0 ] ).id, true );
		addQuizResult( doc, ctx, resultText( doc, ctx ) );
		stopQuiz( doc );
		expect( doc.settings.quiz ).toBeUndefined();
		expect( q1.options.some( ( o ) => o.correct ) ).toBe( false );
		expect( doc.calculations ).toHaveLength( 1 );
		expect( quizExpression( doc ) ).toEqual( { num: 0 } );
		valid( doc );
	} );

	it( 'gives the type with the most points in a personality quiz, each type with its own result', () => {
		const { doc, q1, q2 } = form();
		startQuiz( doc, 'personality', 'Typ' );
		const calm = addQuizCategory( doc, ctx, 'Ruhig' ) ?? '';
		const wild = addQuizCategory( doc, ctx, 'Abenteuer' ) ?? '';
		const quiz = must( doc.settings.quiz );
		const calc = quiz.calculation;
		expect( quiz.categories ).toEqual( [ { id: calm, label: 'Ruhig' }, { id: wild, label: 'Abenteuer' } ] );
		// The first type takes over the thank-you page; its text names the type.
		expect( quizResults( doc ) ).toEqual( [ { node: 'end', min: 1, category: calm }, { node: expect.any( String ), min: 2, category: wild } ] );
		const page = findNode( doc, 'end' );
		expect( page && 'end' === page.type ? page.success?.text : null ).toEqual( { de_DE: '<p>Dein Ergebnis</p><h3>Ruhig</h3>' } );

		setAnswerScore( doc, q1.id, must( q1.options[ 0 ] ).id, calm, 2 );
		setAnswerScore( doc, q1.id, must( q1.options[ 1 ] ).id, wild, 3 );
		setAnswerScore( doc, q2.id, must( q2.options[ 0 ] ).id, wild, 1 );
		setAnswerScore( doc, q2.id, must( q2.options[ 1 ] ).id, calm, 1 );
		syncQuiz( doc );
		expect( quizQuestions( doc ) ).toHaveLength( 2 );
		expect( must( doc.calculations[ 0 ] ).expression ).toEqual( {
			fn: 'argmax',
			args: [
				{ op: '+', args: [ { score: q1.key, category: calm }, { score: q2.key, category: calm } ] },
				{ op: '+', args: [ { score: q1.key, category: wild }, { score: q2.key, category: wild } ] },
			],
		} );
		const result = ( a1: number, a2: number ): number => {
			const expression = must( doc.calculations[ 0 ] ).expression;
			return evaluate( expression, testValues( doc, { [ q1.id ]: [ must( q1.options[ a1 ] ).id ], [ q2.id ]: [ must( q2.options[ a2 ] ).id ] } ) ) ?? Number.NaN;
		};
		expect( result( 0, 1 ) ).toBe( 1 );
		expect( result( 1, 0 ) ).toBe( 2 );
		// 2 : 1 for calm, then a tie 2 : 2 goes to the type further up.
		expect( result( 0, 0 ) ).toBe( 1 );
		expect( quizMax( doc ) ).toBe( 0 );

		// Each result shows for exactly its type.
		const paths = doc.edges.filter( ( e ) => 'contact' === e.from );
		expect( paths.map( ( e ) => e.when ?? 'default' ) ).toEqual( [ { calc, op: 'eq', value: 2 }, 'default' ] );
		valid( doc );

		// Moving a type moves its result; removing it removes its page and points.
		moveQuizCategory( doc, wild );
		expect( quizResults( doc ).map( ( r ) => r.category ) ).toEqual( [ wild, calm ] );
		renameQuizCategory( doc, wild, 'Wild' );
		expect( quiz.categories?.[ 0 ]?.label ).toBe( 'Wild' );
		removeQuizCategory( doc, wild );
		expect( quizResults( doc ) ).toEqual( [ { node: 'end', min: 1, category: calm } ] );
		expect( q1.options[ 1 ]?.scores ).toBeUndefined();
		valid( doc );
	} );

	it( 'turns results into types and back, and ends without the points of the types', () => {
		const { doc, q1 } = form();
		startQuiz( doc, 'points', 'Quiz' );
		setAnswerPoints( doc, q1.id, must( q1.options[ 0 ] ).id, 4 );
		expect( q1.options[ 0 ]?.calcValue ).toBe( 4 );
		addQuizResult( doc, ctx, resultText( doc, ctx ) );
		addQuizResult( doc, ctx, resultText( doc, ctx ) );
		setQuizKind( doc, 'personality' );
		const quiz = must( doc.settings.quiz );
		expect( quiz.categories ).toHaveLength( 2 );
		expect( quizResults( doc ).map( ( r ) => r.min ) ).toEqual( [ 1, 2 ] );
		valid( doc );
		setAnswerScore( doc, q1.id, must( q1.options[ 0 ] ).id, must( quiz.categories?.[ 0 ] ).id, 1 );
		setQuizKind( doc, 'points' );
		expect( quiz.categories ).toBeUndefined();
		expect( q1.options[ 0 ]?.scores ).toBeUndefined();
		expect( quizResults( doc ).every( ( r ) => undefined === r.category ) ).toBe( true );
		valid( doc );
		setQuizKind( doc, 'personality' );
		setAnswerScore( doc, q1.id, must( q1.options[ 0 ] ).id, must( quiz.categories?.[ 0 ] ).id, 1 );
		stopQuiz( doc );
		expect( q1.options[ 0 ]?.scores ).toBeUndefined();
		valid( doc );
	} );
} );
