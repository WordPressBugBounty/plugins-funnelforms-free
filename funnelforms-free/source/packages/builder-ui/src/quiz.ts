/**
 * Quiz mode without React. A quiz (settings.quiz) adds up the points of its questions in a
 * calculation and leads from the contact steps to the result with the highest `min` the points
 * reach. A personality quiz adds up points per type (Option.scores) instead; its calculation gives
 * the position of the leading type, and every type has its own result. syncQuiz keeps the formula
 * and these paths in step and runs after every change.
 */
import type { ChoiceField, DropdownField, Edge, ExpressionNode, FormDocument, Quiz, Text } from '@funnelforms/form-schema';
import { addCalculation } from './calculations';
import { addEnd, findNode, formLabel, newId, nodeName, removeNode, type Context } from './document';

export type QuizKind = Quiz[ 'kind' ];
export type QuizQuestion = ChoiceField | DropdownField;

/** Choice and dropdown fields of the steps. */
export function choiceFields( doc: FormDocument ): QuizQuestion[] {
	const out: QuizQuestion[] = [];
	for ( const node of doc.nodes ) {
		if ( 'step' === node.type ) {
			for ( const field of node.fields ) {
				if ( 'choice' === field.type || 'dropdown' === field.type ) {
					out.push( field );
				}
			}
		}
	}
	return out;
}

/** Whether a question counts: it has right answers (knowledge), answers with points or answers that count for a type. */
export function counts( field: QuizQuestion, kind: QuizKind ): boolean {
	if ( 'personality' === kind ) {
		return field.options.some( ( o ) => Object.values( o.scores ?? {} ).some( ( v ) => 0 !== v ) );
	}
	return field.options.some( ( o ) => ( 'knowledge' === kind ? true === o.correct : undefined !== o.calcValue ) );
}

/** A sum of expressions as a chain of additions (0 for none). */
function sumOf( parts: ExpressionNode[] ): ExpressionNode {
	const [ first, ...rest ] = parts;
	return rest.reduce<ExpressionNode>( ( sum, part ) => ( { op: '+', args: [ sum, part ] } ), first ?? { num: 0 } );
}

/** The questions of the quiz, in document order. */
export function quizQuestions( doc: FormDocument ): QuizQuestion[] {
	const kind = doc.settings.quiz?.kind;
	return kind ? choiceFields( doc ).filter( ( f ) => counts( f, kind ) ) : [];
}

/** The sum of the questions' variable names, each name once (both versions of an A/B test share one). */
export function quizExpression( doc: FormDocument ): ExpressionNode {
	const keys = [ ...new Set( quizQuestions( doc ).map( ( f ) => f.key ) ) ];
	const categories = doc.settings.quiz?.categories ?? [];
	if ( 'personality' === doc.settings.quiz?.kind ) {
		// The position of the type with the most points: argmax(points of type 1; points of type 2; …).
		return categories.length ? { fn: 'argmax', args: categories.map( ( c ) => sumOf( keys.map( ( key ) => ( { score: key, category: c.id } ) ) ) ) } : { num: 0 };
	}
	return sumOf( keys.map( ( key ) => ( { var: key } ) ) );
}

/** The most points, as the plugin computes them for {{quiz:max}} (Domain\Form\Quiz::max). */
export function quizMax( doc: FormDocument ): number {
	const kind = doc.settings.quiz?.kind;
	if ( 'personality' === kind ) {
		return 0;
	}
	const best = new Map<string, number>();
	for ( const field of quizQuestions( doc ) ) {
		let points = 1;
		if ( 'points' === kind ) {
			const values = field.options.flatMap( ( o ) => ( undefined === o.calcValue ? [] : [ o.calcValue ] ) );
			points = field.props.multiple ? values.filter( ( v ) => v > 0 ).reduce( ( a, b ) => a + b, 0 ) : Math.max( 0, ...values );
		}
		best.set( field.key, Math.max( best.get( field.key ) ?? 0, points ) );
	}
	return [ ...best.values() ].reduce( ( a, b ) => a + b, 0 );
}

function dropRightAnswers( doc: FormDocument ): void {
	for ( const field of choiceFields( doc ) ) {
		for ( const option of field.options ) {
			delete option.correct;
		}
	}
}

function dropScores( doc: FormDocument, category?: string ): void {
	for ( const field of choiceFields( doc ) ) {
		for ( const option of field.options ) {
			if ( option.scores && undefined !== category ) {
				Reflect.deleteProperty( option.scores, category );
			}
			if ( undefined === category || ( option.scores && 0 === Object.keys( option.scores ).length ) ) {
				delete option.scores;
			}
		}
	}
}

/** Turns quiz mode on with a new calculation for the points (whole numbers). */
export function startQuiz( doc: FormDocument, kind: QuizKind, label: string ): void {
	if ( doc.settings.quiz ) {
		return;
	}
	const calculation = addCalculation( doc, label );
	const calc = doc.calculations.find( ( c ) => c.id === calculation );
	if ( calc ) {
		calc.format.decimals = 0;
	}
	doc.settings.quiz = { kind, calculation, results: [] };
	if ( 'personality' === kind ) {
		doc.settings.quiz.categories = [];
	}
	syncQuiz( doc );
}

/** Points come from the answers' numbers, or one per question answered right. */
export function setQuizKind( doc: FormDocument, kind: QuizKind ): void {
	const quiz = doc.settings.quiz;
	if ( ! quiz || quiz.kind === kind ) {
		return;
	}
	quiz.kind = kind;
	if ( 'knowledge' !== kind ) {
		dropRightAnswers( doc );
		delete quiz.feedback;
	}
	if ( 'personality' === kind ) {
		// Every result becomes a type of its own, named like its page.
		quiz.categories ??= [];
		const taken = new Set( quiz.categories.map( ( c ) => c.id ) );
		for ( const result of quizResults( doc ) ) {
			if ( ! result.category || ! taken.has( result.category ) ) {
				const node = findNode( doc, result.node );
				const id = newId( doc, 'type', taken );
				quiz.categories.push( { id, label: ( node ? nodeName( node, doc.locales.default ) : '' ).slice( 0, 80 ) || id } );
				result.category = id;
			}
		}
	} else {
		delete quiz.categories;
		dropScores( doc );
		for ( const result of quiz.results ) {
			delete result.category;
		}
	}
	syncQuiz( doc );
}

/** Ends quiz mode. The calculation and the result pages stay as they are; right answers go. */
export function stopQuiz( doc: FormDocument ): void {
	delete doc.settings.quiz;
	dropRightAnswers( doc );
	dropScores( doc );
}

/** Sets the points an answer gives a type of a personality quiz (0 removes them). */
export function setAnswerScore( doc: FormDocument, fieldId: string, optionId: string, category: string, points: number ): void {
	const option = choiceFields( doc )
		.find( ( f ) => f.id === fieldId )
		?.options.find( ( o ) => o.id === optionId );
	if ( ! option || ! doc.settings.quiz?.categories?.some( ( c ) => c.id === category ) ) {
		return;
	}
	if ( Number.isFinite( points ) && 0 !== points ) {
		option.scores = { ...option.scores, [ category ]: points };
	} else if ( option.scores ) {
		Reflect.deleteProperty( option.scores, category );
		if ( 0 === Object.keys( option.scores ).length ) {
			delete option.scores;
		}
	}
}

/** Sets the points of an answer in a points quiz (undefined removes them). */
export function setAnswerPoints( doc: FormDocument, fieldId: string, optionId: string, points: number | undefined ): void {
	const option = choiceFields( doc )
		.find( ( f ) => f.id === fieldId )
		?.options.find( ( o ) => o.id === optionId );
	if ( ! option ) {
		return;
	}
	if ( undefined === points || ! Number.isFinite( points ) ) {
		delete option.calcValue;
	} else {
		option.calcValue = points;
	}
}

/**
 * Adds a type to a personality quiz together with its result page, which shows the type's name.
 * Returns the id of the type.
 */
export function addQuizCategory( doc: FormDocument, ctx: Context, label: string ): string | null {
	const quiz = doc.settings.quiz;
	if ( ! quiz || 'personality' !== quiz.kind || ( quiz.categories?.length ?? 0 ) >= 20 ) {
		return null;
	}
	quiz.categories ??= [];
	const id = newId( doc, 'type', new Set( quiz.categories.map( ( c ) => c.id ) ) );
	quiz.categories.push( { id, label: label.slice( 0, 80 ) } );
	addQuizResult( doc, ctx, categoryText( ctx, label ), id );
	return id;
}

export function renameQuizCategory( doc: FormDocument, id: string, label: string ): void {
	const category = doc.settings.quiz?.categories?.find( ( c ) => c.id === id );
	if ( category ) {
		category.label = label.slice( 0, 80 );
	}
}

/** Removes a type, its result page and the points answers give it. */
export function removeQuizCategory( doc: FormDocument, id: string ): void {
	const quiz = doc.settings.quiz;
	if ( ! quiz?.categories ) {
		return;
	}
	quiz.categories = quiz.categories.filter( ( c ) => c.id !== id );
	dropScores( doc, id );
	for ( const result of quiz.results.filter( ( r ) => r.category === id ) ) {
		removeQuizResult( doc, result.node );
	}
	syncQuiz( doc );
}

/** Moves a type one place up; ties go to the type further up. */
export function moveQuizCategory( doc: FormDocument, id: string ): void {
	const list = doc.settings.quiz?.categories;
	const at = list ? list.findIndex( ( c ) => c.id === id ) : -1;
	if ( list && at > 0 ) {
		list.splice( at - 1, 2, list[ at ] as ( typeof list )[ number ], list[ at - 1 ] as ( typeof list )[ number ] );
		syncQuiz( doc );
	}
}

/**
 * Marks an answer as right or not. A single choice or a dropdown has one right answer, so marking
 * one unmarks the others.
 */
export function setRightAnswer( doc: FormDocument, fieldId: string, optionId: string, right: boolean ): void {
	const field = choiceFields( doc ).find( ( f ) => f.id === fieldId );
	if ( ! field ) {
		return;
	}
	const single = ! field.props.multiple;
	for ( const option of field.options ) {
		if ( option.id === optionId ) {
			if ( right ) {
				option.correct = true;
			} else {
				delete option.correct;
			}
		} else if ( single && right ) {
			delete option.correct;
		}
	}
}

/** The result pages, fewest points first. */
export function quizResults( doc: FormDocument ): Quiz[ 'results' ] {
	return [ ...( doc.settings.quiz?.results ?? [] ) ].sort( ( a, b ) => a.min - b.min );
}

/** End nodes that only contact steps lead to. */
function onlyAfterContact( doc: FormDocument, nodeId: string ): boolean {
	const into = doc.edges.filter( ( e ) => e.to === nodeId );
	return into.length > 0 && into.every( ( e ) => 'contact' === findNode( doc, e.from )?.type );
}

/**
 * Adds a result page with this text. The first one takes over the end the first contact step leads
 * to (when only contact steps lead there), so no thank-you page is left over; the others are new
 * ends. New results start halfway between the highest one and the most points; the result of a
 * type in a personality quiz names its category.
 */
export function addQuizResult( doc: FormDocument, ctx: Context, text: Text, category?: string ): string | null {
	const quiz = doc.settings.quiz;
	if ( ! quiz ) {
		return null;
	}
	const results = quizResults( doc );
	let node: string | null = null;
	if ( 0 === results.length ) {
		const contact = doc.nodes.find( ( n ) => 'contact' === n.type );
		const after = contact ? doc.edges.find( ( e ) => e.from === contact.id && e.default ) ?? doc.edges.find( ( e ) => e.from === contact.id ) : undefined;
		const end = after ? findNode( doc, after.to ) : undefined;
		if ( end && 'end' === end.type && onlyAfterContact( doc, end.id ) ) {
			end.success = { show: true, text };
			node = end.id;
		}
	}
	if ( ! node ) {
		const below = results.at( -1 )?.node ?? doc.nodes.find( ( n ) => 'contact' === n.type )?.id;
		const at = below ? doc.layout?.nodes[ below ] : undefined;
		node = addEnd( doc, ctx, at ? { position: { x: at.x + ( results.length ? 0 : 320 ), y: at.y + 180 } } : {} );
		const end = findNode( doc, node );
		if ( end && 'end' === end.type ) {
			end.success = { show: true, text };
		}
	}
	const top = results.at( -1 )?.min ?? null;
	const max = quizMax( doc );
	const min = null === top ? 0 : Math.max( top + 1, Math.ceil( ( top + max ) / 2 ) );
	quiz.results.push( undefined === category ? { node, min } : { node, min, category } );
	syncQuiz( doc );
	return node;
}

export function setQuizResultMin( doc: FormDocument, nodeId: string, min: number ): void {
	const result = doc.settings.quiz?.results.find( ( r ) => r.node === nodeId );
	if ( result && Number.isFinite( min ) ) {
		result.min = min;
		syncQuiz( doc );
	}
}

/** Removes a result together with its page. */
export function removeQuizResult( doc: FormDocument, nodeId: string ): void {
	const quiz = doc.settings.quiz;
	if ( ! quiz ) {
		return;
	}
	quiz.results = quiz.results.filter( ( r ) => r.node !== nodeId );
	removeNode( doc, nodeId );
	syncQuiz( doc );
}

/** Text of the result page of a type: "Your result" and the type's name. */
export function categoryText( ctx: Context, label: string ): Text {
	const escape = ( value: string ): string => value.replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
	return { [ ctx.locale ]: `<p>${ escape( formLabel( ctx, 'quizResult' ) ) }</p><h3>${ escape( label ) }</h3>` };
}

/** Text of a new result page: a heading and the points, in the form's language. */
export function resultText( doc: FormDocument, ctx: Context ): Text {
	const quiz = doc.settings.quiz;
	const escape = ( value: string ): string => value.replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
	const line = escape( formLabel( ctx, 'knowledge' === quiz?.kind ? 'quizRight' : 'quizPoints' ) )
		.replace( '%1$s', `<strong>{{calc:${ quiz?.calculation ?? '' }}}</strong>` )
		.replace( '%2$s', '{{quiz:max}}' );
	return { [ ctx.locale ]: `<h3>${ escape( formLabel( ctx, 'quizResult' ) ) }</h3><p>${ line }</p>` };
}

/** Whether an edge is one of the paths to the results (the builder writes them). */
export function isQuizEdge( doc: FormDocument, edge: Edge ): boolean {
	const quiz = doc.settings.quiz;
	return Boolean( quiz?.results.length ) && 'contact' === findNode( doc, edge.from )?.type;
}

function same( a: unknown, b: unknown ): boolean {
	return JSON.stringify( a ) === JSON.stringify( b );
}

/**
 * Keeps a quiz in step with the document: the formula is the sum of the questions, and every
 * contact step leads to the results, highest first, the lowest one as the default. Changes only
 * what differs, so it adds nothing to undo when all is in step.
 */
export function syncQuiz( doc: FormDocument ): void {
	const quiz = doc.settings.quiz;
	if ( ! quiz ) {
		return;
	}
	const calc = doc.calculations.find( ( c ) => c.id === quiz.calculation );
	if ( ! calc ) {
		delete doc.settings.quiz;
		return;
	}
	const expression = quizExpression( doc );
	if ( ! same( calc.expression, expression ) ) {
		calc.expression = expression;
		delete calc.legacy;
	}
	if ( quiz.results.some( ( r ) => 'end' !== findNode( doc, r.node )?.type ) ) {
		quiz.results = quiz.results.filter( ( r ) => 'end' === findNode( doc, r.node )?.type );
	}
	const personality = 'personality' === quiz.kind;
	if ( personality ) {
		// A result shows for the position of its type.
		const position = new Map( ( quiz.categories ?? [] ).map( ( c, i ) => [ c.id, i + 1 ] ) );
		if ( quiz.results.some( ( r ) => ! position.has( r.category ?? '' ) ) ) {
			quiz.results = quiz.results.filter( ( r ) => position.has( r.category ?? '' ) );
		}
		for ( const result of quiz.results ) {
			const at = position.get( result.category ?? '' ) ?? 0;
			if ( result.min !== at ) {
				result.min = at;
			}
		}
	}
	if ( 0 === quiz.results.length ) {
		return;
	}
	const highestFirst = [ ...quiz.results ].sort( ( a, b ) => b.min - a.min );
	for ( const contact of doc.nodes.filter( ( n ) => 'contact' === n.type ) ) {
		const current = doc.edges.filter( ( e ) => e.from === contact.id );
		const wanted = highestFirst.map( ( r, i ): Omit<Edge, 'id'> =>
			i === highestFirst.length - 1 ? { from: contact.id, to: r.node, default: true } : { from: contact.id, to: r.node, when: { calc: quiz.calculation, op: personality ? 'eq' : 'gte', value: r.min } }
		);
		if ( same( current.map( ( e ) => ( { ...e, id: undefined } ) ), wanted.map( ( e ) => ( { ...e, id: undefined } ) ) ) ) {
			continue;
		}
		const ids = new Map( current.map( ( e ) => [ e.to, e.id ] ) );
		doc.edges = doc.edges.filter( ( e ) => e.from !== contact.id );
		for ( const edge of wanted ) {
			doc.edges.push( { id: ids.get( edge.to ) ?? newId( doc, 'e' ), ...edge } );
		}
	}
}
