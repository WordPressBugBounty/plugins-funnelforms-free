/**
 * "Quiz": answers score points, right answers one point each, or answers count toward types
 * (personality quiz), and visitors see the result page they reach after the contact step. Shown in
 * the Settings workspace; the builder keeps the points calculation and the paths to the results in
 * step (src/quiz.ts). All questions and their scoring are listed here, so a quiz is set up in one place.
 */
import React from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import { findNode, nodeName } from '../document';
import {
	addQuizCategory,
	addQuizResult,
	choiceFields,
	counts,
	moveQuizCategory,
	quizMax,
	quizQuestions,
	quizResults,
	removeQuizCategory,
	removeQuizResult,
	renameQuizCategory,
	resultText,
	setAnswerPoints,
	setAnswerScore,
	setQuizKind,
	setQuizResultMin,
	setRightAnswer,
	startQuiz,
	stopQuiz,
	type QuizKind,
	type QuizQuestion,
} from '../quiz';
import type { Recipe } from '../store';
import { useEnv } from './context';
import { AskAiButton } from './AiForm';
import { fieldTitle } from './describe';
import { __, sprintf } from './i18n';
import { Button, icons, Notice, Select, Toggle } from './ui';

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

const KINDS = (): Array<{ value: QuizKind; title: string; text: string }> => [
	{ value: 'points', title: __( 'Points per answer', 'funnelforms-pro' ), text: __( 'Every answer is worth points, such as a lead check or a self-test.', 'funnelforms-pro' ) },
	{ value: 'knowledge', title: __( 'Right and wrong answers', 'funnelforms-pro' ), text: __( 'One point per right answer, such as a knowledge test.', 'funnelforms-pro' ) },
	{ value: 'personality', title: __( 'Personality types', 'funnelforms-pro' ), text: __( 'Answers count toward types; the type with the most points is the result.', 'funnelforms-pro' ) },
];

export function QuizSection( { doc }: { doc: FormDocument } ) {
	const { readOnly, ctx, store } = useEnv();
	const change = useChange();
	const quiz = doc.settings.quiz;
	const start = ( kind: QuizKind ): void =>
		change( ( d ) => {
			startQuiz( d, kind, 'personality' === kind ? __( 'Quiz type', 'funnelforms-pro' ) : __( 'Quiz points', 'funnelforms-pro' ) );
			if ( 'personality' === kind ) {
				addQuizCategory( d, ctx, sprintf( __( 'Type %d', 'funnelforms-pro' ), 1 ) );
				addQuizCategory( d, ctx, sprintf( __( 'Type %d', 'funnelforms-pro' ), 2 ) );
			}
		} );

	if ( ! quiz ) {
		return (
			<section className="ffxb-section">
				<header className="ffxb-section__head">
					<h2 className="ffxb-section__title">{ __( 'Quiz', 'funnelforms-pro' ) }</h2>
					<div className="ffxb-section__actions">
						<AskAiButton start={ __( 'Turn the form into a quiz: ', 'funnelforms-pro' ) } label={ __( 'Create with AI', 'funnelforms-pro' ) } />
					</div>
				</header>
				<p className="ffxb-hint">{ __( 'Make the form a quiz: answers score points, and after the contact step visitors see the result their points reach.', 'funnelforms-pro' ) }</p>
				<div className="ffxb-quiz-kinds">
					{ KINDS().map( ( k ) => (
						<button key={ k.value } type="button" className="ffxb-quiz-kind" disabled={ readOnly } onClick={ () => start( k.value ) }>
							<strong>{ k.title }</strong>
							<span>{ k.text }</span>
						</button>
					) ) }
				</div>
			</section>
		);
	}

	const questions = quizQuestions( doc );
	const max = quizMax( doc );
	const results = quizResults( doc );
	const contact = doc.nodes.some( ( n ) => 'contact' === n.type );
	const knowledge = 'knowledge' === quiz.kind;
	const personality = 'personality' === quiz.kind;
	const pageName = ( id: string ): string => {
		const node = findNode( doc, id );
		return ( node ? nodeName( node, ctx.locale ) : '' ) || __( 'Without a title', 'funnelforms-pro' );
	};

	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Quiz', 'funnelforms-pro' ) }</h2>
				<div className="ffxb-section__actions">
					<AskAiButton start={ __( 'Change the quiz: ', 'funnelforms-pro' ) } label={ __( 'Change with AI', 'funnelforms-pro' ) } />
				</div>
			</header>
			<Select
				label={ __( 'Points', 'funnelforms-pro' ) }
				value={ quiz.kind }
				options={ [
					{ value: 'points', label: __( 'Each answer has points', 'funnelforms-pro' ) },
					{ value: 'knowledge', label: __( 'One point per right answer', 'funnelforms-pro' ) },
					{ value: 'personality', label: __( 'Answers count toward types', 'funnelforms-pro' ) },
				] }
				onChange={ ( kind ) => change( ( d ) => setQuizKind( d, kind ) ) }
			/>
			{ questions.length ? (
				<p className="ffxb-hint">
					{ personality
						? sprintf( __( 'Questions that count: %d.', 'funnelforms-pro' ), questions.length )
						: sprintf( __( 'Questions that count: %1$d. Most points: %2$s.', 'funnelforms-pro' ), questions.length, String( max ) ) }
				</p>
			) : (
				<Notice tone="warning">
					{ knowledge
						? __( 'Mark the right answers: tick them below or at the question under Answers.', 'funnelforms-pro' )
						: personality
						? __( 'Give answers points for the types below.', 'funnelforms-pro' )
						: __( 'Give answers points: enter them below or at the question under Answers, in the Number column.', 'funnelforms-pro' ) }
				</Notice>
			) }
			{ knowledge ? (
				<Toggle
					label={ __( 'Show right and wrong after each question', 'funnelforms-pro' ) }
					hint={ __( 'Visitors see the right answer before they go on. The right answers are then part of the page.', 'funnelforms-pro' ) }
					checked={ Boolean( quiz.feedback ) }
					onChange={ ( on ) =>
						change( ( d ) => {
							if ( d.settings.quiz ) {
								if ( on ) {
									d.settings.quiz.feedback = true;
								} else {
									delete d.settings.quiz.feedback;
								}
							}
						} )
					}
				/>
			) : null }

			{ personality ? (
				<>
					<h3 className="ffxb-subtitle">{ __( 'Types and their results', 'funnelforms-pro' ) }</h3>
					<p className="ffxb-hint">{ __( 'Visitors get the type with the most points; on a tie, the one further up. Each type has its own result page.', 'funnelforms-pro' ) }</p>
					{ contact ? null : <Notice tone="warning">{ __( 'Results show after the contact step. Add a contact step first.', 'funnelforms-pro' ) }</Notice> }
					<ul className="ffxb-results">
						{ ( quiz.categories ?? [] ).map( ( c, i ) => {
							const result = quiz.results.find( ( r ) => r.category === c.id );
							return (
								<li key={ c.id } className="ffxb-results__item ffxb-quiz-type">
									<input
										className="ffxb-input"
										aria-label={ sprintf( __( 'Name of type %d', 'funnelforms-pro' ), i + 1 ) }
										value={ c.label }
										maxLength={ 80 }
										disabled={ readOnly }
										onChange={ ( e ) => change( ( d ) => renameQuizCategory( d, c.id, e.target.value ), 'quiz-type:' + c.id ) }
									/>
									{ result ? (
										<button type="button" className="ffxb-link ffxb-results__name" onClick={ () => store.getState().select( { node: result.node } ) }>
											{ pageName( result.node ) }
										</button>
									) : (
										<span className="ffxb-results__name ffxb-muted">{ __( 'No result page', 'funnelforms-pro' ) }</span>
									) }
									<Button size="sm" variant="ghost" aria-label={ sprintf( __( 'Move “%s” up', 'funnelforms-pro' ), c.label ) } title={ __( 'Move up', 'funnelforms-pro' ) } disabled={ readOnly || 0 === i } onClick={ () => change( ( d ) => moveQuizCategory( d, c.id ) ) }>
										<span aria-hidden="true">↑</span>
									</Button>
									<Button
										size="sm"
										variant="ghost"
										icon={ icons.trash }
										aria-label={ sprintf( __( 'Remove type “%s”', 'funnelforms-pro' ), c.label ) }
										title={ __( 'Remove type', 'funnelforms-pro' ) }
										disabled={ readOnly }
										onClick={ () => change( ( d ) => removeQuizCategory( d, c.id ) ) }
									/>
								</li>
							);
						} ) }
					</ul>
					<div className="ffxb-row-actions">
						<Button
							size="sm"
							icon={ icons.plus }
							disabled={ readOnly || ! contact || ( quiz.categories?.length ?? 0 ) >= 20 }
							onClick={ () => change( ( d ) => void addQuizCategory( d, ctx, sprintf( __( 'Type %d', 'funnelforms-pro' ), ( d.settings.quiz?.categories?.length ?? 0 ) + 1 ) ) ) }
						>
							{ __( 'Add type', 'funnelforms-pro' ) }
						</Button>
					</div>
				</>
			) : null }

			<QuestionTable doc={ doc } kind={ quiz.kind } />

			{ personality ? null : (
				<>
					<h3 className="ffxb-subtitle">{ __( 'Results', 'funnelforms-pro' ) }</h3>
					{ contact ? (
						<p className="ffxb-hint">{ __( 'After sending, visitors see the result with the most points they reach. Use {{calc:…}} and {{quiz:max}} in its text for their points.', 'funnelforms-pro' ).replace( '{{calc:…}}', `{{calc:${ quiz.calculation }}}` ) }</p>
					) : (
						<Notice tone="warning">{ __( 'Results show after the contact step. Add a contact step first.', 'funnelforms-pro' ) }</Notice>
					) }
					<ul className="ffxb-results">
						{ results.map( ( r, i ) => {
							const above = results[ i + 1 ];
							return (
								<li key={ r.node } className="ffxb-results__item">
									<button type="button" className="ffxb-link ffxb-results__name" onClick={ () => store.getState().select( { node: r.node } ) }>
										{ pageName( r.node ) }
									</button>
									{ 0 === i ? (
										<span className="ffxb-results__range">{ above ? sprintf( __( 'below %s', 'funnelforms-pro' ), String( above.min ) ) : __( 'everyone', 'funnelforms-pro' ) }</span>
									) : (
										<label className="ffxb-results__range">
											{ __( 'from', 'funnelforms-pro' ) }
											<input
												className="ffxb-input ffxb-input--tiny"
												type="number"
												step="any"
												aria-label={ sprintf( __( 'Points from which “%s” shows', 'funnelforms-pro' ), pageName( r.node ) ) }
												value={ r.min }
												disabled={ readOnly }
												onChange={ ( e ) => '' !== e.target.value && change( ( d ) => setQuizResultMin( d, r.node, Number( e.target.value ) ), 'quiz-min:' + r.node ) }
											/>
										</label>
									) }
									<Button size="sm" variant="ghost" icon={ icons.trash } aria-label={ __( 'Remove result', 'funnelforms-pro' ) } title={ __( 'Remove result', 'funnelforms-pro' ) } disabled={ readOnly } onClick={ () => change( ( d ) => removeQuizResult( d, r.node ) ) } />
								</li>
							);
						} ) }
					</ul>
				</>
			) }
			<div className="ffxb-row-actions">
				{ personality ? null : (
					<Button size="sm" icon={ icons.plus } disabled={ readOnly || ! contact || results.length >= 20 } onClick={ () => change( ( d ) => void addQuizResult( d, ctx, resultText( d, ctx ) ) ) }>
						{ __( 'Add result', 'funnelforms-pro' ) }
					</Button>
				) }
				<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => change( ( d ) => stopQuiz( d ) ) }>
					{ __( 'End quiz mode', 'funnelforms-pro' ) }
				</Button>
			</div>
		</section>
	);
}

/** Every choice question with its answers and what they score, to set a quiz up in one place. */
function QuestionTable( { doc, kind }: { doc: FormDocument; kind: QuizKind } ) {
	const { readOnly, ctx, store } = useEnv();
	const change = useChange();
	const questions = choiceFields( doc );
	const categories = doc.settings.quiz?.categories ?? [];
	const optionLabel = ( q: QuizQuestion, i: number ): string => {
		const o = q.options[ i ];
		return ( o ? o.label[ ctx.locale ] ?? Object.values( o.label )[ 0 ] ?? o.value : '' ).replace( /<[^>]*>/g, '' ) || sprintf( __( 'Answer %d', 'funnelforms-pro' ), i + 1 );
	};
	const stepOf = ( fieldId: string ): string | undefined => doc.nodes.find( ( n ) => 'step' === n.type && n.fields.some( ( f ) => f.id === fieldId ) )?.id;
	if ( ! questions.length ) {
		return (
			<>
				<h3 className="ffxb-subtitle">{ __( 'Questions', 'funnelforms-pro' ) }</h3>
				<p className="ffxb-hint">{ __( 'Add steps with choices or dropdowns; their answers score here.', 'funnelforms-pro' ) }</p>
			</>
		);
	}
	return (
		<>
			<h3 className="ffxb-subtitle">{ __( 'Questions', 'funnelforms-pro' ) }</h3>
			<div className="ffxb-quiz-questions">
				{ questions.map( ( q ) => {
					const title = fieldTitle( q, ctx.locale );
					return (
						<fieldset key={ q.id } className={ 'ffxb-quiz-question' + ( counts( q, kind ) ? ' is-counted' : '' ) }>
							<legend>
								<button type="button" className="ffxb-link" onClick={ () => store.getState().select( { node: stepOf( q.id ) } ) }>
									{ title }
								</button>
							</legend>
							<table className="ffxb-quiz-table">
								<thead>
									<tr>
										<th scope="col">{ __( 'Answer', 'funnelforms-pro' ) }</th>
										{ 'personality' === kind ? (
											categories.map( ( c ) => (
												<th key={ c.id } scope="col">
													{ c.label }
												</th>
											) )
										) : (
											<th scope="col">{ 'knowledge' === kind ? __( 'Right', 'funnelforms-pro' ) : __( 'Points', 'funnelforms-pro' ) }</th>
										) }
									</tr>
								</thead>
								<tbody>
									{ q.options.map( ( o, i ) => (
										<tr key={ o.id }>
											<th scope="row">{ optionLabel( q, i ) }</th>
											{ 'personality' === kind ? (
												categories.map( ( c ) => (
													<td key={ c.id }>
														<input
															className="ffxb-input ffxb-input--tiny"
															type="number"
															step="any"
															placeholder="0"
															aria-label={ sprintf( __( 'Points of “%1$s” for %2$s', 'funnelforms-pro' ), optionLabel( q, i ), c.label ) }
															value={ o.scores?.[ c.id ] ?? '' }
															disabled={ readOnly }
															onChange={ ( e ) => change( ( d ) => setAnswerScore( d, q.id, o.id, c.id, Number( e.target.value ) ), `quiz-score:${ o.id }:${ c.id }` ) }
														/>
													</td>
												) )
											) : 'knowledge' === kind ? (
												<td>
													<input
														type={ q.props.multiple ? 'checkbox' : 'radio' }
														name={ 'quiz-right-' + q.id }
														aria-label={ sprintf( __( '“%s” is right', 'funnelforms-pro' ), optionLabel( q, i ) ) }
														checked={ true === o.correct }
														disabled={ readOnly }
														onChange={ ( e ) => change( ( d ) => setRightAnswer( d, q.id, o.id, q.props.multiple ? e.target.checked : true ) ) }
													/>
												</td>
											) : (
												<td>
													<input
														className="ffxb-input ffxb-input--tiny"
														type="number"
														step="any"
														placeholder="0"
														aria-label={ sprintf( __( 'Points of “%s”', 'funnelforms-pro' ), optionLabel( q, i ) ) }
														value={ o.calcValue ?? '' }
														disabled={ readOnly }
														onChange={ ( e ) => change( ( d ) => setAnswerPoints( d, q.id, o.id, '' === e.target.value ? undefined : Number( e.target.value ) ), 'calc-value:' + o.id ) }
													/>
												</td>
											) }
										</tr>
									) ) }
								</tbody>
							</table>
						</fieldset>
					);
				} ) }
			</div>
		</>
	);
}
