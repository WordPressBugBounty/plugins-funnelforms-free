/**
 * The bar of the prediction above the canvas (Predictive AI, Funnelforms Pro), while the prediction
 * is shown on the canvas: the rate of the last prediction with its range, when it was made and for
 * how many virtual visitors, the button that plays the visitors on the canvas and the way to the tab
 * of the Predictive AI. Predictions are made there only, never on the canvas: without one, the bar
 * leads there. While the visitors run it shows how far they are, the leads so far, and that the
 * steps stay in place meanwhile.
 */
import React, { useContext, useState } from 'react';
import { percent } from '../stats';
import { ViewContext } from './context';
import { __, sprintf } from './i18n';
import { number, usePrediction } from './Prediction';
import { PlaybackContext, usePlaybackProgress } from './PredictionPlayback';
import { reducedMotion } from './PredictionScreen';
import { icons, Spinner } from './ui';

function day( iso: string ): string {
	const time = Date.parse( iso );
	if ( Number.isNaN( time ) ) {
		return '';
	}
	try {
		return new Intl.DateTimeFormat( document.documentElement.lang || undefined, { dateStyle: 'medium' } ).format( new Date( time ) );
	} catch {
		return iso.slice( 0, 10 );
	}
}

const PLAY = (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
	</svg>
);
const STOP = (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<rect x="6" y="5" width="4" height="14" rx="1" />
		<rect x="14" y="5" width="4" height="14" rx="1" />
	</svg>
);
const LOCK = (
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<rect x="4" y="11" width="16" height="10" rx="2" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	</svg>
);

export function PredictionBar( { onPlay }: { onPlay: () => void } ) {
	const mode = usePrediction();
	const setView = useContext( ViewContext );
	const playback = useContext( PlaybackContext );
	const progress = usePlaybackProgress();
	const [ still ] = useState( reducedMotion );
	if ( ! mode?.on ) {
		return null;
	}
	const { stored, result, resultOf, loading, error } = mode;
	const open = (
		<button type="button" className="ffxb-pai-hud__open" onClick={ () => setView( 'predict' ) }>
			{ __( 'Open Predictive AI', 'funnelforms-pro' ) }
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
				<path d="M5 12h14M13 6l6 6-6 6" />
			</svg>
		</button>
	);
	if ( loading || ( stored && ! result ) ) {
		return (
			<div className="ffxb-pai-hud is-quiet" role="status">
				<Spinner label={ loading ? __( 'Loading the prediction…', 'funnelforms-pro' ) : __( 'Simulating the visitors…', 'funnelforms-pro' ) } />
			</div>
		);
	}
	if ( ! stored || ! result || ! resultOf ) {
		// No prediction yet (or it could not be loaded): it is made in the tab of the Predictive AI.
		return (
			<div className="ffxb-pai-hud is-empty" role="status">
				<span className="ffxb-pai-hud__icon" aria-hidden="true">
					{ icons.sparkles }
				</span>
				<span className="ffxb-pai-hud__text">
					<strong>{ error ?? __( 'See how visitors will go through the form before it goes live.', 'funnelforms-pro' ) }</strong>
				</span>
				<span className="ffxb-pai-hud__actions">{ open }</span>
			</div>
		);
	}
	const traced = result.simulation.traces.length;
	const canPlay = ! still && !! playback && traced > 0;
	const playing = null !== progress;
	const each = Math.max( 1, Math.round( result.visitors / Math.max( 1, traced ) ) );
	const of = sprintf( __( 'Prediction of %1$s · %2$s virtual visitors', 'funnelforms-pro' ), day( resultOf.created ), number( result.visitors ) );
	const leads = Math.round( result.simulation.report.totals.completions * ( progress?.leads ?? 0 ) );
	return (
		<div className={ 'ffxb-pai-hud' + ( playing ? ' is-playing' : '' ) } title={ canPlay ? sprintf( __( 'Each dot stands for about %s virtual visitors.', 'funnelforms-pro' ), number( each ) ) : undefined }>
			<span className="ffxb-pai-hud__icon" aria-hidden="true">
				{ icons.sparkles }
			</span>
			<span className="ffxb-pai-hud__text">
				<strong className="ffxb-prediction__rate">{ sprintf( __( '%1$s sent (%2$s to %3$s)', 'funnelforms-pro' ), percent( result.conversion ), percent( result.low ), percent( result.high ) ) }</strong>
				{ playing ? (
					<span className="ffxb-pai-hud__sub" role="status">
						<span className="ffxb-pai-hud__leads">{ sprintf( __( 'Leads: %s', 'funnelforms-pro' ), number( leads ) ) }</span>
						<span className="ffxb-pai-hud__lock">
							{ LOCK }
							{ __( 'The steps stay in place while the visitors run.', 'funnelforms-pro' ) }
						</span>
					</span>
				) : (
					<span className="ffxb-pai-hud__sub" title={ of }>
						{ of }
					</span>
				) }
				{ result.unknown && ! playing ? <span className="ffxb-analytics__small">{ sprintf( __( '%d steps are new since the prediction. Predict again to include them.', 'funnelforms-pro' ), result.unknown ) }</span> : null }
			</span>
			<span className="ffxb-pai-hud__actions">
				{ canPlay ? (
					<button type="button" className="ffxb-button ffxb-button--primary ffxb-button--sm ffxb-pai-hud__play" onClick={ () => ( playing ? playback?.stop() : onPlay() ) }>
						{ playing ? STOP : PLAY }
						{ playing ? __( 'Stop', 'funnelforms-pro' ) : __( 'Play visitors', 'funnelforms-pro' ) }
					</button>
				) : null }
				{ playing ? null : open }
			</span>
			{ playing ? (
				<span className="ffxb-pai-hud__progress" aria-hidden="true">
					<span style={ { transform: `scaleX(${ progress.done })` } } />
				</span>
			) : null }
		</div>
	);
}
