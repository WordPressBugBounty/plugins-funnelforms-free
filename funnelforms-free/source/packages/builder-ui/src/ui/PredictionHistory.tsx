/**
 * Earlier predictions in the tab of the Predictive AI: each with its funnel score and what came of
 * it in the real figures of the published form (the plugin measures them, PredictionChanges), and
 * one of them opened with its suggestions, what each was expected to bring and whether it was
 * applied. Measured is per publishing, not per suggestion.
 */
import React, { useEffect, useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import type { FormsApi, PredictionHistory } from '../api';
import type { EarlierPrediction, MeasuredFigures, RealFigures } from '../predict';
import { __, sprintf } from './i18n';
import { decimal, pointsOf, stepName } from './PredictionStage';
import { when } from './PredictionResult';

/** The earlier predictions of a form; loaded again with each new prediction. Null while they load or without the route. */
export function useEarlier( api: FormsApi, formId: number, created: string | null ): PredictionHistory | null {
	const [ history, setHistory ] = useState<PredictionHistory | null>( null );
	useEffect( () => {
		if ( ! api.predictionHistory || ! created ) {
			setHistory( null );
			return undefined;
		}
		let live = true;
		api.predictionHistory( formId )
			.then( ( h ) => live && setHistory( h ) )
			.catch( () => live && setHistory( null ) );
		return () => {
			live = false;
		};
	}, [ api, formId, created ] );
	return history;
}

function percent( share: number | null ): string {
	return null === share ? '–' : `${ decimal( share * 100 ) }\u00a0%`;
}

function signed( share: number ): string {
	return ( share > 0 ? '+' : share < 0 ? '−' : '' ) + pointsOf( Math.abs( share ) );
}

/** What came of a prediction in the real figures, in a few words, and whether it is good. */
export function realTag( real: RealFigures | null ): { text: string; tone: 'good' | 'bad' | 'none' } {
	if ( ! real || ! real.after ) {
		return { text: __( 'Not published since', 'funnelforms-pro' ), tone: 'none' };
	}
	const { before, after } = real;
	if ( ! after.enough || null === after.rate ) {
		return { text: __( 'Not enough data yet', 'funnelforms-pro' ), tone: 'none' };
	}
	if ( before.enough && null !== before.rate ) {
		const change = after.rate - before.rate;
		return { text: sprintf( __( 'real %s points', 'funnelforms-pro' ), signed( change ) ), tone: change > 0.0005 ? 'good' : change < -0.0005 ? 'bad' : 'none' };
	}
	return { text: sprintf( __( 'real %s', 'funnelforms-pro' ), percent( after.rate ) ), tone: 'none' };
}

function ringColor( score: number | null ): string {
	return null === score ? 'var(--ffxb-border, #e6e4ea)' : score >= 90 ? '#1d7a46' : score >= 60 ? '#6a30f5' : '#b45309';
}

export interface CurrentEntry {
	created: string;
	score: number;
	conversion: number;
	open: number;
}

/**
 * The predictions of a form as a list: the current one first, then the earlier ones. Choosing an
 * earlier one opens it (onOpen with its index), the current one goes back to it (onOpen(null)).
 */
export function EarlierList( { current, history, locale, chosen, onOpen }: { current: CurrentEntry | null; history: PredictionHistory | null; locale?: string; chosen: number | null; onOpen: ( index: number | null ) => void } ) {
	const earlier = history?.history ?? [];
	if ( ! current && ! earlier.length ) {
		return null;
	}
	const now = current ? realTag( history?.real ?? null ) : null;
	return (
		<ul className="ffxb-pai-history">
			{ current ? (
				<li>
					<button type="button" className={ 'ffxb-pai-hist' + ( null === chosen ? ' is-on' : '' ) } aria-pressed={ null === chosen } onClick={ () => onOpen( null ) }>
						<span className="ffxb-pai-hist__ring" style={ { borderColor: ringColor( current.score ) } }>
							{ current.score }
						</span>
						<span className="ffxb-pai-hist__text">
							<strong>{ when( current.created, locale ) }</strong>
							<span>{ sprintf( __( '%1$s conversion rate · %2$d suggestions open', 'funnelforms-pro' ), percent( current.conversion ), current.open ) }</span>
						</span>
						<span className="ffxb-pai-hist__tag is-current">{ __( 'current', 'funnelforms-pro' ) }</span>
					</button>
					{ now && 'none' !== now.tone ? <span className={ 'ffxb-pai-hist__real is-' + now.tone }>{ now.text }</span> : null }
				</li>
			) : null }
			{ earlier.map( ( e, i ) => {
				const tag = realTag( e.real );
				const applied = e.applied.length;
				const line = e.figures
					? applied
						? sprintf( __( '%1$s · %2$d of %3$d applied', 'funnelforms-pro' ), percent( e.figures.original ), applied, e.suggestions.length )
						: sprintf( __( '%1$s · none applied', 'funnelforms-pro' ), percent( e.figures.original ) )
					: sprintf( __( '%1$d of %2$d applied', 'funnelforms-pro' ), applied, e.suggestions.length );
				return (
					<li key={ e.created }>
						<button type="button" className={ 'ffxb-pai-hist' + ( chosen === i ? ' is-on' : '' ) } aria-pressed={ chosen === i } onClick={ () => onOpen( i ) }>
							<span className="ffxb-pai-hist__ring" style={ { borderColor: ringColor( e.figures?.score ?? null ) } }>
								{ e.figures ? e.figures.score : '–' }
							</span>
							<span className="ffxb-pai-hist__text">
								<strong>{ when( e.created, locale ) }</strong>
								<span>{ line }</span>
							</span>
							<span className={ 'ffxb-pai-hist__tag is-' + tag.tone }>{ tag.text }</span>
						</button>
					</li>
				);
			} ) }
		</ul>
	);
}

function Measured( { label, m, locale }: { label: string; m: MeasuredFigures | null; locale?: string } ) {
	const views = ( n: number ): string => {
		try {
			return new Intl.NumberFormat( locale?.replace( /_formal$/, '' ).replace( /_/g, '-' ) ).format( n );
		} catch {
			return String( n );
		}
	};
	return (
		<div>
			<span>{ label }</span>
			<strong>{ m ? percent( m.rate ) : '–' }</strong>
			<span>{ m ? ( m.enough ? sprintf( __( '%1$s views in %2$d days', 'funnelforms-pro' ), views( m.views ), m.days ) : sprintf( __( 'Only %s views, not enough to compare', 'funnelforms-pro' ), views( m.views ) ) ) : __( 'Not published since', 'funnelforms-pro' ) }</span>
		</div>
	);
}

/** An earlier prediction opened: what it predicted, what came of it, and its suggestions. */
export function EarlierView( { entry, doc, locale, onBack }: { entry: EarlierPrediction; doc: FormDocument; locale?: string; onBack: () => void } ) {
	const applied = new Map( entry.applied.map( ( a ) => [ a.suggestion, a ] ) );
	const node = ( id: string ): string => {
		const n = doc.nodes.find( ( x ) => x.id === id );
		return n ? stepName( doc, n ) : __( 'Step no longer in the form', 'funnelforms-pro' );
	};
	const day = ( iso: string ): string => {
		try {
			return new Intl.DateTimeFormat( locale?.replace( /_formal$/, '' ).replace( /_/g, '-' ), { dateStyle: 'medium' } ).format( new Date( iso ) );
		} catch {
			return iso.slice( 0, 10 );
		}
	};
	const rows = [ ...entry.suggestions ].sort( ( a, b ) => ( entry.figures?.suggestions[ b.id ] ?? 0 ) - ( entry.figures?.suggestions[ a.id ] ?? 0 ) );
	return (
		<section className="ffxb-pai-earlier" aria-label={ sprintf( __( 'Prediction of %s', 'funnelforms-pro' ), when( entry.created, locale ) ) }>
			<div className="ffxb-pai-earlier__head">
				<div>
					<div className="ffxb-pai-eyebrow is-light">{ __( 'Earlier prediction', 'funnelforms-pro' ) }</div>
					<h2>{ sprintf( __( 'Prediction of %s', 'funnelforms-pro' ), when( entry.created, locale ) ) }</h2>
				</div>
				<button type="button" className="ffxb-pai-btn" onClick={ onBack }>
					{ __( 'Back to the current prediction', 'funnelforms-pro' ) }
				</button>
			</div>
			<div className="ffxb-pai-earlier__figures">
				<div className="is-forecast">
					<span>{ __( 'Predicted then', 'funnelforms-pro' ) }</span>
					<strong>{ entry.figures ? percent( entry.figures.original ) : '–' }</strong>
					<span>{ entry.figures && entry.applied.length ? sprintf( __( '%s with the suggestions applied', 'funnelforms-pro' ), percent( entry.figures.conversion ) ) : __( 'Conversion rate of the form as it was', 'funnelforms-pro' ) }</span>
				</div>
				<Measured label={ __( 'Real before, 30 days', 'funnelforms-pro' ) } m={ entry.real.before } locale={ locale } />
				<Measured label={ __( 'Real after publishing', 'funnelforms-pro' ) } m={ entry.real.after } locale={ locale } />
			</div>
			<table className="ffxb-pai-earlier__table">
				<thead>
					<tr>
						<th scope="col">{ __( 'Suggestion', 'funnelforms-pro' ) }</th>
						<th scope="col">{ __( 'Step', 'funnelforms-pro' ) }</th>
						<th scope="col" className="is-num">
							{ __( 'Predicted', 'funnelforms-pro' ) }
						</th>
						<th scope="col">{ __( 'Status', 'funnelforms-pro' ) }</th>
					</tr>
				</thead>
				<tbody>
					{ rows.map( ( s ) => {
						const gain = entry.figures?.suggestions[ s.id ];
						const a = applied.get( s.id );
						return (
							<tr key={ s.id }>
								<td>{ s.title }</td>
								<td>{ node( s.node ) }</td>
								<td className="is-num">{ undefined === gain ? '–' : sprintf( __( '%s points', 'funnelforms-pro' ), signed( gain ) ) }</td>
								<td>
									<span className={ 'ffxb-pai-hist__tag ' + ( a ? 'is-good' : 'is-open' ) }>{ a ? sprintf( __( 'applied on %s', 'funnelforms-pro' ), day( a.at ) ) : __( 'open', 'funnelforms-pro' ) }</span>
								</td>
							</tr>
						);
					} ) }
				</tbody>
			</table>
			<p className="ffxb-pai-muted is-small">{ __( 'Real figures are measured per publishing, not per suggestion: changes published together share one measurement. Below 300 views on a side they are not compared.', 'funnelforms-pro' ) }</p>
		</section>
	);
}
