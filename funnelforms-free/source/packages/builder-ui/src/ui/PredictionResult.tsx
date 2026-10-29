/**
 * The result of the Predictive AI in the tab of the editor: the funnel score with what the form
 * could reach, where visitors leave (with the reasons and the kinds of visitors per step) and the
 * suggestions by their effect, each applied to the form with one click (PredictionApply). Long
 * forms show the steps that cost leads first.
 */
import React, { useMemo, useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import { funnelScore, isBetter, worthApplying, type Prediction, type PredictionSuggestion, type StoredPrediction } from '../predict';
import { __, sprintf } from './i18n';
import { number, type PredictionMode } from './Prediction';
import { AllDone, ApplyBar, ChangePeek, RevertChoice, Tick } from './PredictionApply';
import { decimal, LONG_FORM, PERSONA_DARK, pointsOf, ScoreRing, stepKind, stepName, stepOrder } from './PredictionStage';

/** A step of a long form is listed at first from this share that leaves. */
const NOTABLE = 0.06;

function money( value: number, currency: string ): string {
	try {
		return new Intl.NumberFormat( undefined, { style: 'currency', currency, maximumFractionDigits: 0 } ).format( value );
	} catch {
		return `${ Math.round( value ) } ${ currency }`;
	}
}

export function when( iso: string, locale?: string ): string {
	const time = Date.parse( iso );
	if ( Number.isNaN( time ) ) {
		return '';
	}
	try {
		return new Intl.DateTimeFormat( locale?.replace( /_formal$/, '' ).replace( /_/g, '-' ), { dateStyle: 'medium', timeStyle: 'short' } ).format( new Date( time ) );
	} catch {
		return iso.slice( 0, 16 ).replace( 'T', ' ' );
	}
}

function band( drop: number ): 'high' | 'warn' | 'low' {
	return drop >= 0.3 ? 'high' : drop >= 0.1 ? 'warn' : 'low';
}

export interface ResultProps {
	doc: FormDocument;
	result: Prediction;
	stored: StoredPrediction;
	locale?: string;
	busy: boolean;
	canRun: boolean;
	/** Plays the visitors again. */
	onReplay: () => void;
	/** Shows the prediction on the canvas, with this step selected. */
	onCanvas: ( node?: string ) => void;
	onSetup: () => void;
	onRun: () => void;
	/** Applying suggestions and taking them out (usePredictionState). */
	apply: Pick<PredictionMode, 'applied' | 'canApply' | 'applying' | 'applyError' | 'apply' | 'revert' | 'undoable'>;
	/** Opens publishing with this note. */
	onPublish?: ( note: string ) => void;
}

export function PredictionResult( { doc, result, stored, locale, busy, canRun, onReplay, onCanvas, onSetup, onRun, apply, onPublish }: ResultProps ) {
	const { model, parameters } = stored;
	const [ help, setHelp ] = useState( false );
	const [ all, setAll ] = useState( false );
	const [ open, setOpen ] = useState<string | null>( null );
	// The applied suggestion whose Undo asks how.
	const [ asking, setAsking ] = useState<string | null>( null );
	const score = funnelScore( result );
	const order = useMemo( () => stepOrder( doc ), [ doc ] );
	const steps = useMemo( () => {
		const byId = new Map( result.steps.map( ( s ) => [ s.id, s ] ) );
		return order.flatMap( ( n ) => {
			const s = byId.get( n.id );
			return s ? [ { ...s, name: stepName( doc, n ), node: n } ] : [];
		} );
	}, [ order, result, doc ] );
	const worst = result.sticking[ 0 ]?.id ?? steps[ steps.length - 1 ]?.id ?? null;
	const [ chosen, setChosen ] = useState<string | null>( null );
	const selected = steps.find( ( s ) => s.id === chosen ) ?? steps.find( ( s ) => s.id === worst ) ?? steps[ 0 ];
	const long = steps.length >= LONG_FORM;
	const compact = long && ! all;
	const rows = compact ? steps.filter( ( s, i ) => ( s.dropRate ?? 0 ) >= NOTABLE || s.sticking || i === steps.length - 1 || s.id === selected?.id ) : steps;
	const recs = worthApplying( result.suggestions );
	// More and better leads; the filter only while there are both.
	const [ filter, setFilter ] = useState<'all' | 'more' | 'better'>( 'all' );
	const better = recs.filter( isBetter );
	const both = better.length > 0 && better.length < recs.length;
	const shown = ! both || 'all' === filter ? recs : recs.filter( ( r ) => isBetter( r ) === ( 'better' === filter ) );
	const quality = result.quality;
	const done = result.applied;
	const appliedAt = new Map( apply.applied.map( ( a ) => [ a.suggestion, a ] ) );
	// What the AI said about a change that applied several suggestions at once: each shows its own instruction instead.
	const shared = new Set( apply.applied.map( ( a ) => a.summary ).filter( ( text, i, all ) => text && all.indexOf( text ) !== i ) );
	const leads = result.conversion * 1000;
	const perfect = 100 === score;
	const allDone = done.length > 0 && ! recs.length;
	const verdict = perfect ? __( 'Perfect form', 'funnelforms-pro' ) : score >= 60 ? __( 'Good, with clear potential', 'funnelforms-pro' ) : __( 'Many leads get lost here', 'funnelforms-pro' );
	const possible = [ recs.length, `${ decimal( result.best * 100 ) }\u00a0%`, `${ decimal( result.conversion * 100 ) }\u00a0%`, number( Math.round( ( result.best - result.conversion ) * 1000 ) ) ] as const;
	const verdictSub = perfect
		? __( 'As things stand, the AI finds no change that brings noticeably more leads.', 'funnelforms-pro' )
		: done.length
			? sprintf( __( 'With the remaining %1$d suggestions, %2$s instead of %3$s are possible. That is %4$s more leads per 1,000 visitors.', 'funnelforms-pro' ), ...possible )
			: sprintf( __( 'With the %1$d suggestions, %2$s instead of %3$s are possible. That is %4$s more leads per 1,000 visitors.', 'funnelforms-pro' ), ...possible );
	// What the suggestions applied add, against the prediction before them.
	const gained = result.conversion - result.original;
	const busyApplying = null !== apply.applying;
	const applyNote = sprintf( __( 'Predictive AI: %d changes', 'funnelforms-pro' ), done.length );
	const sticking = result.sticking[ 0 ];
	const stickingStep = sticking ? steps.find( ( s ) => s.id === sticking.id ) : undefined;
	const nodeLabel = ( id: string ): string => {
		const node = doc.nodes.find( ( n ) => n.id === id );
		return node ? stepName( doc, node ) : __( 'Without a title', 'funnelforms-pro' );
	};
	const continueOf = useMemo( () => new Map( model.steps.map( ( s ) => [ s.node, s ] ) ), [ model ] );

	return (
		<div className="ffxb-pai-result">
			<section className="ffxb-pai-hero" aria-label={ __( 'Result', 'funnelforms-pro' ) }>
				<div className="ffxb-pai-hero__score">
					<ScoreRing score={ score } size={ 120 } label={ __( 'of 100', 'funnelforms-pro' ) } color={ score >= 90 ? '#3ddbb0' : score >= 60 ? '#a98bff' : '#ffb547' } />
					<div>
						<div className="ffxb-pai-eyebrow">{ __( 'Funnel score', 'funnelforms-pro' ) }</div>
						<h2 className="ffxb-pai-hero__verdict">{ verdict }</h2>
						<p className="ffxb-pai-hero__sub">{ verdictSub }</p>
						<button type="button" className="ffxb-pai-link--dark" aria-expanded={ help } onClick={ () => setHelp( ! help ) }>
							{ __( 'How is the score made?', 'funnelforms-pro' ) }
							<Chevron open={ help } />
						</button>
					</div>
				</div>
				<div className="ffxb-pai-kpis">
					<div>
						<span>{ __( 'Conversion rate', 'funnelforms-pro' ) }</span>
						<strong>{ `${ decimal( result.conversion * 100 ) }\u00a0%` }</strong>
						{ done.length ? (
							<span className="is-good">{ sprintf( __( '+%s points from the changes', 'funnelforms-pro' ), pointsOf( Math.max( 0, gained ) ) ) }</span>
						) : (
							<span>{ sprintf( __( 'Range %1$s to %2$s', 'funnelforms-pro' ), `${ decimal( result.low * 100 ) }\u00a0%`, `${ decimal( result.high * 100 ) }\u00a0%` ) }</span>
						) }
					</div>
					<div>
						<span>{ __( 'Leads per 1,000 visitors', 'funnelforms-pro' ) }</span>
						<strong className="is-good">{ number( Math.round( leads ) ) }</strong>
						{ done.length ? (
							<span className="is-good">{ sprintf( __( '+%s from the changes', 'funnelforms-pro' ), number( Math.max( 0, Math.round( gained * 1000 ) ) ) ) }</span>
						) : (
							<span>{ sprintf( __( 'simulated from %s', 'funnelforms-pro' ), number( result.visitors ) ) }</span>
						) }
					</div>
					{ quality ? (
						<div>
							<span>{ __( 'Of them qualified', 'funnelforms-pro' ) }</span>
							<strong>{ number( Math.round( leads * quality.share ) ) }</strong>
							<span title={ quality.byAnswers ? __( 'From the answers in the form', 'funnelforms-pro' ) : __( 'Estimated per kind of visitor; the form does not ask', 'funnelforms-pro' ) }>{ `${ decimal( quality.share * 100, 0 ) }\u00a0% ${ quality.label }` }</span>
						</div>
					) : null }
					<div>
						<span>{ __( 'Value per 1,000 visitors', 'funnelforms-pro' ) }</span>
						<strong>{ money( leads * parameters.lead_value, parameters.currency ) }</strong>
						<span>{ sprintf( __( 'at %s per lead', 'funnelforms-pro' ), money( parameters.lead_value, parameters.currency ) ) }</span>
					</div>
					{ quality ? null : (
						<div>
							<span>{ __( 'Biggest weakness', 'funnelforms-pro' ) }</span>
							<strong className="is-small">{ stickingStep?.name ?? '–' }</strong>
							<span>{ sticking && null !== sticking.dropRate ? sprintf( __( '%s leave here', 'funnelforms-pro' ), `${ decimal( sticking.dropRate * 100, 0 ) }\u00a0%` ) : __( 'No step stands out', 'funnelforms-pro' ) }</span>
						</div>
					) }
				</div>
				{ help ? (
					<div className="ffxb-pai-help ffxb-pai-in">
						<span className="ffxb-pai-help__sum">
							<span>
								<span>{ __( 'Prediction now', 'funnelforms-pro' ) }</span>
								<strong>{ `${ decimal( result.conversion * 100 ) }\u00a0%` }</strong>
							</span>
							<span aria-hidden="true">÷</span>
							<span>
								<span>{ __( 'with all suggestions', 'funnelforms-pro' ) }</span>
								<strong>{ `${ decimal( result.best * 100 ) }\u00a0%` }</strong>
							</span>
							<span aria-hidden="true">=</span>
							<span className="is-score">
								<span>{ __( 'Funnel score', 'funnelforms-pro' ) }</span>
								<strong>{ sprintf( __( '%d of 100', 'funnelforms-pro' ), score ) }</strong>
							</span>
						</span>
						<span className="ffxb-pai-help__text">{ sprintf( __( 'The score shows how much of what is possible with your form you already get today. 100 means: the AI finds no change that brings noticeably more leads. The conversion rate comes from the simulation with %s visitors, the effect of each suggestion from a simulation of its own.', 'funnelforms-pro' ), number( result.visitors ) ) }</span>
					</div>
				) : null }
				<div className="ffxb-pai-hero__foot">
					<span className="ffxb-pai-hero__meta">
						{ [ when( stored.created, locale ), sprintf( __( '%s virtual visitors', 'funnelforms-pro' ), number( result.visitors ) ), __( 'An estimate based on benchmarks and AI, not a promise', 'funnelforms-pro' ) ].filter( Boolean ).join( ' · ' ) }
					</span>
					<span className="ffxb-pai-hero__actions">
						<button type="button" className="ffxb-pai-btn ffxb-pai-btn--ondark" onClick={ onReplay }>
							<Play />
							{ __( 'Watch the simulation', 'funnelforms-pro' ) }
						</button>
						<button type="button" className="ffxb-pai-btn ffxb-pai-btn--ondark" onClick={ () => onCanvas() }>
							{ __( 'Show on the canvas', 'funnelforms-pro' ) }
						</button>
						<button type="button" className="ffxb-pai-btn ffxb-pai-btn--ondark" onClick={ onSetup }>
							{ __( 'Change the audience', 'funnelforms-pro' ) }
						</button>
						<button type="button" className="ffxb-pai-btn ffxb-pai-btn--primary" disabled={ ! canRun || busy } onClick={ onRun }>
							{ __( 'Simulate again', 'funnelforms-pro' ) }
						</button>
					</span>
				</div>
			</section>

			{ allDone ? (
				<AllDone
					more={ result.original > 0 ? Math.round( 100 * ( result.conversion / result.original - 1 ) ) : 0 }
					count={ done.length }
					canRun={ canRun && ! busy }
					onRun={ onRun }
					onPublish={ onPublish ? () => onPublish( applyNote ) : undefined }
				/>
			) : null }

			{ result.unknown ? <p className="ffxb-pai-note">{ sprintf( __( '%d steps are new since the prediction. Predict again to include them.', 'funnelforms-pro' ), result.unknown ) }</p> : null }

			<div className="ffxb-pai-columns">
				<section className="ffxb-pai-card ffxb-pai-steps">
					<div className="ffxb-pai-card__head">
						<h2>{ __( 'Where visitors leave', 'funnelforms-pro' ) }</h2>
						<span>{ sprintf( __( 'of %s visitors reach the step', 'funnelforms-pro' ), number( 10000 ) ) }</span>
					</div>
					<div className="ffxb-pai-rows">
						{ rows.map( ( s ) => {
							const reach = result.visitors > 0 ? s.reached / result.visitors : 0;
							const drop = s.dropRate ?? 0;
							const b = band( drop );
							const on = s.id === selected?.id;
							return (
								<button key={ s.id } type="button" className={ 'ffxb-pai-row' + ( on ? ' is-on' : '' ) } aria-pressed={ on } onClick={ () => setChosen( s.id ) }>
									<span className="ffxb-pai-row__name">
										<span>
											{ s.name }
											{ s.unknown ? <span className="ffxb-pai-new">{ __( 'New', 'funnelforms-pro' ) }</span> : null }
										</span>
										{ stepKind( s.node ) ? <small>{ stepKind( s.node ) }</small> : null }
									</span>
									<span className="ffxb-pai-row__bar">
										<span>
											<span className={ `is-${ b }` } style={ { width: `${ ( reach * 100 ).toFixed( 1 ) }%` } } />
										</span>
										<span>{ number( Math.round( reach * 10000 ) ) }</span>
									</span>
									<span className={ `ffxb-pai-row__drop is-${ b }` }>{ `−${ decimal( drop * 100, 0 ) }\u00a0%` }</span>
								</button>
							);
						} ) }
						{ compact && rows.length < steps.length ? (
							<button type="button" className="ffxb-pai-rows__more" onClick={ () => setAll( true ) }>
								<span>{ sprintf( __( '%d inconspicuous steps hidden', 'funnelforms-pro' ), steps.length - rows.length ) }</span>
								<span>{ __( 'Show all', 'funnelforms-pro' ) }</span>
							</button>
						) : null }
						{ long && all ? (
							<button type="button" className="ffxb-pai-rows__less" onClick={ () => setAll( false ) }>
								{ __( 'Only show notable steps', 'funnelforms-pro' ) }
							</button>
						) : null }
					</div>
					{ selected ? (
						<div className="ffxb-pai-detail">
							<div className="ffxb-pai-detail__head">
								<h3>{ sprintf( __( '%1$s: %2$s leave here', 'funnelforms-pro' ), selected.name, `${ decimal( ( selected.dropRate ?? 0 ) * 100, 0 ) }\u00a0%` ) }</h3>
								<button type="button" className="ffxb-link" onClick={ () => onCanvas( selected.id ) }>
									{ __( 'Show on the canvas', 'funnelforms-pro' ) }
								</button>
							</div>
							{ selected.reasons.length ? (
								<ul className="ffxb-pai-detail__reasons">
									{ selected.reasons.map( ( r ) => (
										<li key={ r }>{ r }</li>
									) ) }
								</ul>
							) : (
								<p className="ffxb-pai-muted">{ __( 'A short step, hardly any hesitation. You lose hardly anyone here.', 'funnelforms-pro' ) }</p>
							) }
							{ model.personas.length ? (
								<div className="ffxb-pai-detail__personas">
									{ model.personas.map( ( p, i ) => {
										const s = continueOf.get( selected.id );
										const share = s ? s.continue[ p.id ] ?? s.prior : null;
										return (
											<div key={ p.id }>
												<span>
													<i style={ { background: PERSONA_DARK[ i % PERSONA_DARK.length ] } } />
													{ p.name }
												</span>
												<span className="ffxb-pai-detail__bar">
													<span style={ { width: `${ ( ( share ?? 0 ) * 100 ).toFixed( 0 ) }%`, background: PERSONA_DARK[ i % PERSONA_DARK.length ] } } />
												</span>
												<span>{ null === share ? '–' : `${ decimal( share * 100, 0 ) }\u00a0%` }</span>
											</div>
										);
									} ) }
									<span className="ffxb-pai-muted is-small">{ __( 'Share that finishes this step, per kind of visitor', 'funnelforms-pro' ) }</span>
								</div>
							) : null }
						</div>
					) : null }
				</section>

				<section className="ffxb-pai-recs">
					<div className="ffxb-pai-recs__head">
						<h2>{ recs.length ? __( 'Suggestions, sorted by effect', 'funnelforms-pro' ) : done.length ? __( 'Suggestions applied', 'funnelforms-pro' ) : __( 'No suggestions', 'funnelforms-pro' ) }</h2>
						{ both ? (
							<div className="ffxb-pai-chips" role="group" aria-label={ __( 'Show suggestions', 'funnelforms-pro' ) }>
								{ (
									[
										[ 'all', sprintf( __( 'All (%d)', 'funnelforms-pro' ), recs.length ) ],
										[ 'more', sprintf( __( 'More leads (%d)', 'funnelforms-pro' ), recs.length - better.length ) ],
										[ 'better', sprintf( __( 'Better leads (%d)', 'funnelforms-pro' ), better.length ) ],
									] as const
								).map( ( [ key, label ] ) => (
									<button key={ key } type="button" className={ 'ffxb-pai-chip' + ( filter === key ? ' is-on' : '' ) } aria-pressed={ filter === key } onClick={ () => setFilter( key ) }>
										{ label }
									</button>
								) ) }
							</div>
						) : null }
					</div>
					{ ! recs.length && ! done.length ? (
						<div className="ffxb-pai-card ffxb-pai-perfect">
							<strong>{ __( 'The AI finds nothing that brings noticeably more leads.', 'funnelforms-pro' ) }</strong>
							{ model.insights.length ? (
								<ul>
									{ model.insights.map( ( x ) => (
										<li key={ x }>
											<Tick size={ 16 } />
											{ x }
										</li>
									) ) }
								</ul>
							) : null }
							<p className="ffxb-pai-muted">{ __( 'Next lever: more visitors who fit. Test two headlines in an A/B test once the form has traffic.', 'funnelforms-pro' ) }</p>
						</div>
					) : null }
					{ shown.map( ( r ) => {
						const i = recs.indexOf( r );
						const peek = open === r.id;
						const working = 1 === apply.applying?.length && apply.applying[ 0 ] === r.id;
						const failed = apply.applyError?.ids.includes( r.id ) ? apply.applyError.message : null;
						return (
							<article key={ r.id } className={ 'ffxb-pai-card ffxb-pai-rec' + ( peek ? ' is-open' : '' ) } aria-busy={ working }>
								<div className="ffxb-pai-rec__head">
									<span className="ffxb-pai-rec__rank">{ i + 1 }</span>
									<div className="ffxb-pai-rec__title">
										<div>
											<Kind suggestion={ r } />
											<span>{ nodeLabel( r.node ) }</span>
										</div>
										<h3>{ r.title }</h3>
									</div>
									{ isBetter( r ) ? (
										<div className="ffxb-pai-rec__impact is-better">
											<strong>{ `+${ decimal( ( r.quality ?? 0 ) * 100, 0 ) }\u00a0%` }</strong>
											<span>{ sprintf( __( 'qualified leads, %s points', 'funnelforms-pro' ), signedPoints( r.gain ) ) }</span>
										</div>
									) : (
										<div className="ffxb-pai-rec__impact">
											<strong>{ sprintf( __( '+%s points', 'funnelforms-pro' ), pointsOf( r.gain ) ) }</strong>
											<span>{ sprintf( __( '+%s leads per 1,000 visitors', 'funnelforms-pro' ), number( Math.round( r.gain * 1000 ) ) ) }</span>
										</div>
									) }
								</div>
								<p className="ffxb-pai-rec__reason">{ r.reason }</p>
								<Source suggestion={ r } benchmark={ model.benchmark } />
								{ peek ? <ChangePeek doc={ doc } suggestion={ r } locale={ doc.locales.default } rate={ sprintf( __( '%1$s sent instead of %2$s', 'funnelforms-pro' ), `${ decimal( r.conversion * 100 ) }\u00a0%`, `${ decimal( result.conversion * 100 ) }\u00a0%` ) } /> : null }
								{ failed ? (
									<p className="ffxb-pai-rec__error" role="alert">
										{ failed }
									</p>
								) : null }
								<div className="ffxb-pai-rec__foot">
									<span className="ffxb-pai-rec__status" role="status">
										{ working ? (
											<>
												<span className="ffxb-spinner" aria-hidden="true" />
												{ __( 'The AI applies the suggestion. This can take up to a minute.', 'funnelforms-pro' ) }
											</>
										) : null }
									</span>
									<span className="ffxb-pai-rec__buttons">
										<button type="button" className="ffxb-pai-btn ffxb-pai-btn--secondary" aria-expanded={ peek } onClick={ () => setOpen( peek ? null : r.id ) }>
											{ peek ? __( 'Close', 'funnelforms-pro' ) : __( 'See the change', 'funnelforms-pro' ) }
										</button>
										<button type="button" className="ffxb-pai-btn ffxb-pai-btn--secondary" onClick={ () => onCanvas( r.node ) }>
											{ __( 'On the canvas', 'funnelforms-pro' ) }
										</button>
										{ apply.canApply ? (
											<button
												type="button"
												className="ffxb-pai-btn ffxb-pai-btn--primary"
												disabled={ busyApplying }
												onClick={ () => {
													setOpen( null );
													void apply.apply( [ r.id ] );
												} }
											>
												{ __( 'Apply change', 'funnelforms-pro' ) }
											</button>
										) : null }
									</span>
								</div>
							</article>
						);
					} ) }
					{ done.map( ( r ) => {
						const info = appliedAt.get( r.id );
						const how = apply.undoable( r.id );
						const failed = apply.applyError?.ids.includes( r.id ) ? apply.applyError.message : null;
						return (
							<article key={ r.id } className="ffxb-pai-card ffxb-pai-rec is-done">
								<div className="ffxb-pai-rec__head">
									<span className="ffxb-pai-rec__rank">
										<Tick size={ 16 } />
									</span>
									<div className="ffxb-pai-rec__title">
										<div>
											<Kind suggestion={ r } />
											<span>{ nodeLabel( r.node ) }</span>
										</div>
										<h3>{ r.title }</h3>
									</div>
									{ isBetter( r ) ? (
										<div className="ffxb-pai-rec__impact is-better">
											<strong>{ `+${ decimal( ( r.quality ?? 0 ) * 100, 0 ) }\u00a0%` }</strong>
											<span>{ __( 'qualified leads', 'funnelforms-pro' ) }</span>
										</div>
									) : (
										<div className="ffxb-pai-rec__impact">
											<strong>{ sprintf( __( '+%s points', 'funnelforms-pro' ), pointsOf( Math.max( 0, r.gain ) ) ) }</strong>
											<span>{ sprintf( __( '+%s leads per 1,000 visitors', 'funnelforms-pro' ), number( Math.max( 0, Math.round( r.gain * 1000 ) ) ) ) }</span>
										</div>
									) }
								</div>
								{ failed ? (
									<p className="ffxb-pai-rec__error" role="alert">
										{ failed }
									</p>
								) : null }
								{ asking === r.id ? (
									<RevertChoice
										how={ 'before' === how ? 'before' : null }
										onBefore={ () => {
											setAsking( null );
											apply.revert( r.id, 'before' );
										} }
										onOpen={ () => {
											setAsking( null );
											apply.revert( r.id, 'open' );
										} }
										onCancel={ () => setAsking( null ) }
									/>
								) : null }
								<div className="ffxb-pai-rec__foot">
									<span className="ffxb-pai-rec__summary">{ [ info?.summary && ! shared.has( info.summary ) ? info.summary : r.instruction, info?.at ? when( info.at, locale ) : '' ].filter( Boolean ).join( ' · ' ) }</span>
									<span className="ffxb-pai-rec__buttons">
										<span className="ffxb-pai-rec__done">
											<Tick />
											{ __( 'Applied in the draft', 'funnelforms-pro' ) }
										</span>
										<button type="button" className="ffxb-pai-btn ffxb-pai-btn--secondary" disabled={ busyApplying || ! apply.canApply } onClick={ () => ( 'undo' === how ? apply.revert( r.id, 'undo' ) : setAsking( asking === r.id ? null : r.id ) ) }>
											{ __( 'Undo', 'funnelforms-pro' ) }
										</button>
									</span>
								</div>
							</article>
						);
					} ) }
				</section>
			</div>

			{ result.personas.length ? (
				<section className="ffxb-pai-card ffxb-pai-kinds">
					<h2>{ __( 'Your kinds of visitors', 'funnelforms-pro' ) }</h2>
					<div className="ffxb-pai-kinds__grid">
						{ result.personas.map( ( p, i ) => (
							<div key={ p.id }>
								<div className="ffxb-pai-kinds__head">
									<strong>
										<i style={ { background: PERSONA_DARK[ i % PERSONA_DARK.length ] } } />
										{ p.name }
									</strong>
									<span>{ sprintf( __( '%s of the visitors', 'funnelforms-pro' ), `${ decimal( p.share * 100, 0 ) }\u00a0%` ) }</span>
								</div>
								<p>{ p.description }</p>
								<div>{ sprintf( __( '%s become a lead', 'funnelforms-pro' ), null === p.conversion ? '–' : `${ decimal( p.conversion * 100, 0 ) }\u00a0%` ) }</div>
							</div>
						) ) }
					</div>
				</section>
			) : null }

			{ apply.canApply && recs.length > 1 ? <ApplyBar count={ recs.length } points={ pointsOf( result.best - result.conversion ) } busy={ busyApplying && ( apply.applying?.length ?? 0 ) > 1 } disabled={ busyApplying } onApply={ () => void apply.apply( recs.map( ( r ) => r.id ) ) } /> : null }
		</div>
	);
}

/** Points with their sign: −0.4, +1.2. */
function signedPoints( share: number ): string {
	return ( share < 0 ? '−' : '+' ) + pointsOf( Math.abs( share ) );
}

/** More leads or better leads. */
function Kind( { suggestion }: { suggestion: Pick<PredictionSuggestion, 'goal' | 'quality'> } ) {
	return isBetter( suggestion ) ? <span className="ffxb-pai-kind is-better">{ __( 'Better leads', 'funnelforms-pro' ) }</span> : <span className="ffxb-pai-kind">{ __( 'More leads', 'funnelforms-pro' ) }</span>;
}

/** What a suggestion rests on: a rule of the benchmarks (assumed or measured) or an estimate of the AI. */
function Source( { suggestion, benchmark }: { suggestion: Pick<PredictionSuggestion, 'source'>; benchmark: string } ) {
	const source = suggestion.source;
	if ( ! source?.text ) {
		return null;
	}
	const origin = 'measured' === source.origin ? __( 'measured', 'funnelforms-pro' ) : 'assumption' === source.origin ? sprintf( __( 'assumption, benchmarks %s', 'funnelforms-pro' ), benchmark ) : __( 'estimate of the AI', 'funnelforms-pro' );
	return (
		<p className={ 'ffxb-pai-rec__source is-' + source.origin }>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
				<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
				<path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
			</svg>
			<span>
				{ source.text } <span className="ffxb-pai-rec__origin">({ origin })</span>
			</span>
		</p>
	);
}

function Chevron( { open }: { open: boolean } ) {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={ { transform: `rotate(${ open ? 180 : 0 }deg)` } }>
			<path d="M6 9l6 6 6-6" />
		</svg>
	);
}

function Play() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
			<path d="M7 5l12 7-12 7z" />
		</svg>
	);
}
