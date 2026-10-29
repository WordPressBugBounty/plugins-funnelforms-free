/**
 * The page of the Predictive AI (Funnelforms → Predictive AI, Funnelforms Pro): every form with its
 * last prediction, the funnel score, the predicted and the real conversion rate, and what the open
 * suggestions could still bring, the form with the most leads to win first. Predictions are made
 * and applied in the form editor, in the tab Predictive AI (PredictionWorkspace); each card leads
 * there. The figures are those the builder kept with the prediction (figures in the plugin).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormsApi, PredictionQuota } from '../api';
import { __, sprintf } from './i18n';
import { Empty, Spinner } from './ui';
import { NotReady } from './Prediction';

export interface PredictionOverviewForm {
	id: number;
	title: string;
	status: string;
	/** The last prediction; the figures are null while the builder kept none. */
	prediction: { created: string; score: number | null; conversion: number | null; best: number | null; open: number } | null;
	/** Conversion rate of the published form in the last realDays days; null without views. */
	real: { rate: number | null; views: number };
}

export interface PredictionScreenConfig {
	forms: PredictionOverviewForm[];
	/** Funnelforms → Forms; the form is added as ?form=. */
	builderUrl: string;
	/** Days of the real conversion rate. */
	realDays?: number;
	ai?: { ready: boolean; accountUrl: string };
	userLocale?: string;
}

export function reducedMotion(): boolean {
	try {
		return window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	} catch {
		return false;
	}
}

function date( iso: string, locale?: string ): string {
	const time = Date.parse( iso );
	if ( Number.isNaN( time ) ) {
		return '';
	}
	try {
		return new Intl.DateTimeFormat( locale, { dateStyle: 'medium' } ).format( new Date( time ) );
	} catch {
		return iso.slice( 0, 10 );
	}
}

function percent( share: number | null, locale?: string ): string {
	if ( null === share ) {
		return '–';
	}
	try {
		return new Intl.NumberFormat( locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 } ).format( share * 100 ) + '\u00a0%';
	} catch {
		return ( share * 100 ).toFixed( 1 ) + '\u00a0%';
	}
}

/** What the open suggestions of a form could still bring, as a share; 0 without figures. */
function potential( f: PredictionOverviewForm ): number {
	const p = f.prediction;
	return p && null !== p.best && null !== p.conversion ? Math.max( 0, p.best - p.conversion ) : 0;
}

type Kind = 'open' | 'perfect' | 'result' | 'none';

function kindOf( f: PredictionOverviewForm ): Kind {
	const p = f.prediction;
	if ( ! p ) {
		return 'none';
	}
	if ( 100 === p.score ) {
		return 'perfect';
	}
	return p.open > 0 && null !== p.score ? 'open' : 'result';
}

export function PredictionScreen( { api, config }: { api: FormsApi; config: PredictionScreenConfig } ) {
	const locale = config.userLocale?.replace( '_', '-' );
	const ready = !! config.ai?.ready;
	// undefined while it loads; null when the server could not be reached.
	const [ quota, setQuota ] = useState<PredictionQuota | null | undefined>( undefined );
	const loadQuota = useCallback( () => {
		if ( ! api.predictionQuota ) {
			setQuota( null );
			return;
		}
		api.predictionQuota()
			.then( setQuota )
			.catch( () => setQuota( null ) );
	}, [ api ] );
	useEffect( loadQuota, [ loadQuota ] );

	// The most leads to win first; forms without a prediction after them, those with views first.
	const forms = useMemo(
		() =>
			[ ...config.forms ].sort( ( a, b ) => {
				const has = Number( !! b.prediction ) - Number( !! a.prediction );
				return has || potential( b ) - potential( a ) || b.real.views - a.real.views || a.title.localeCompare( b.title );
			} ),
		[ config.forms ]
	);
	const link = ( id: number ): string => config.builderUrl + ( config.builderUrl.includes( '?' ) ? '&' : '?' ) + 'form=' + id + '&view=predict';
	const days = config.realDays ?? 30;

	return (
		<div className="ffxb-pai-overview">
			<section className="ffxb-pai-overview__hero">
				<div className="ffxb-pai-overview__intro">
					<h2>{ __( 'Which form loses the most leads?', 'funnelforms-pro' ) }</h2>
					<p>{ __( 'Every form with its last prediction. Simulating and applying happen in the form editor, in the tab Predictive AI.', 'funnelforms-pro' ) }</p>
				</div>
				<QuotaMeter quota={ quota } ready={ ready } accountUrl={ config.ai?.accountUrl ?? '' } locale={ locale } />
			</section>
			{ ready ? null : <NotReady accountUrl={ config.ai?.accountUrl ?? '' } /> }
			{ ! forms.length ? (
				<Empty
					title={ __( 'No forms yet', 'funnelforms-pro' ) }
					action={
						<a className="ffxb-button ffxb-button--primary ffxb-button--md" href={ config.builderUrl }>
							{ __( 'New form', 'funnelforms-pro' ) }
						</a>
					}
				>
					{ __( 'Create a form, then test it in the tab Predictive AI before it goes live.', 'funnelforms-pro' ) }
				</Empty>
			) : (
				<ul className="ffxb-pai-overview__grid">
					{ forms.map( ( f ) => (
						<li key={ f.id }>
							<OverviewCard form={ f } href={ link( f.id ) } locale={ locale } days={ days } />
						</li>
					) ) }
				</ul>
			) }
			{ forms.length ? <p className="ffxb-hint">{ sprintf( __( 'Sorted by the leads the open suggestions could still win. Real: conversion rate of the published form in the last %d days. Predictions are estimates based on experience and AI, not a promise.', 'funnelforms-pro' ), days ) }</p> : null }
		</div>
	);
}

function OverviewCard( { form: f, href, locale, days }: { form: PredictionOverviewForm; href: string; locale?: string; days: number } ) {
	const kind = kindOf( f );
	const p = f.prediction;
	const status = 'published' === f.status ? __( 'Published', 'funnelforms-pro' ) : __( 'Draft', 'funnelforms-pro' );
	const meta = p ? sprintf( __( '%1$s · prediction of %2$s', 'funnelforms-pro' ), status, date( p.created, locale ) ) : status;
	const score = p && null !== p.score ? p.score : null;
	const note = {
		open: p ? sprintf( 1 === p.open ? __( '%1$d suggestion open, up to +%2$s points', 'funnelforms-pro' ) : __( '%1$d suggestions open, up to +%2$s points', 'funnelforms-pro' ), p.open, ( Math.round( potential( f ) * 1000 ) / 10 ).toLocaleString( locale, { maximumFractionDigits: 1 } ) ) : '',
		perfect: __( 'Perfect form', 'funnelforms-pro' ),
		result: __( 'Open the result to see the score', 'funnelforms-pro' ),
		none: __( 'Not simulated yet', 'funnelforms-pro' ),
	}[ kind ];
	const cta = {
		open: __( 'See the suggestions', 'funnelforms-pro' ),
		perfect: __( 'See the result', 'funnelforms-pro' ),
		result: __( 'See the result', 'funnelforms-pro' ),
		none: __( 'Start the first simulation', 'funnelforms-pro' ),
	}[ kind ];
	const ring = null === score ? '' : score >= 90 ? ' is-good' : score >= 60 ? ' is-mid' : ' is-low';
	return (
		<article className="ffxb-pai-overview__card">
			<div className="ffxb-pai-overview__top">
				<div>
					<h3>{ f.title || __( 'Without a title', 'funnelforms-pro' ) }</h3>
					<span>{ meta }</span>
				</div>
				<span className={ 'ffxb-pai-overview__ring' + ring } role="img" aria-label={ null === score ? __( 'No funnel score yet', 'funnelforms-pro' ) : sprintf( __( 'Funnel score %d', 'funnelforms-pro' ), score ) }>
					{ null === score ? '–' : score }
				</span>
			</div>
			<div className="ffxb-pai-overview__figures">
				<span>
					<strong>{ percent( p?.conversion ?? null, locale ) }</strong> { __( 'predicted', 'funnelforms-pro' ) }
				</span>
				<span title={ sprintf( __( 'Conversion rate of the last %d days', 'funnelforms-pro' ), days ) }>
					<strong>{ percent( f.real.rate, locale ) }</strong> { __( 'real', 'funnelforms-pro' ) }
				</span>
			</div>
			<span className={ 'ffxb-pai-overview__note is-' + kind }>{ note }</span>
			<a className={ 'ffxb-pai-btn' + ( 'perfect' === kind ? '' : ' ffxb-pai-btn--primary' ) } href={ href }>
				{ cta }
			</a>
		</article>
	);
}

/** The behaviour analyses of the license this month, on the brand surface of the hero. */
export function QuotaMeter( { quota, ready, accountUrl, locale }: { quota: PredictionQuota | null | undefined; ready: boolean; accountUrl: string; locale?: string } ) {
	if ( ! ready ) {
		return null;
	}
	if ( undefined === quota ) {
		return (
			<aside className="ffxb-pai-overview__quota" aria-busy="true">
				<Spinner label={ __( 'Loading the analyses left…', 'funnelforms-pro' ) } />
			</aside>
		);
	}
	if ( null === quota || ! quota.included ) {
		return (
			<aside className="ffxb-pai-overview__quota">
				<span>{ null === quota ? __( 'The analyses left could not be loaded. Try again in a moment.', 'funnelforms-pro' ) : __( 'Your license does not include the Predictive AI.', 'funnelforms-pro' ) }</span>
			</aside>
		);
	}
	const share = quota.limit > 0 ? Math.max( 0, Math.min( 1, quota.remaining / quota.limit ) ) : 0;
	const reset = date( quota.resetsAt, locale );
	return (
		<aside className="ffxb-pai-overview__quota" aria-label={ __( 'Behaviour analyses available this month', 'funnelforms-pro' ) }>
			<span>{ __( 'Behaviour analyses this month', 'funnelforms-pro' ) }</span>
			<strong className="ffxb-pai-overview__left">
				{ quota.remaining } <span>{ sprintf( __( 'of %d left', 'funnelforms-pro' ), quota.limit ) }</span>
			</strong>
			<span className="ffxb-pai-overview__meter" role="img" aria-label={ sprintf( __( '%1$d of %2$d behaviour analyses left this month', 'funnelforms-pro' ), quota.remaining, quota.limit ) }>
				<span style={ { width: `${ share * 100 }%` } } />
			</span>
			{ quota.remaining > 0 && quota.remainingToday < quota.remaining ? <span>{ sprintf( __( '%d of them today on this website.', 'funnelforms-pro' ), quota.remainingToday ) }</span> : null }
			{ reset ? <span>{ sprintf( __( 'New analyses on %s', 'funnelforms-pro' ), reset ) }</span> : null }
			{ quota.remaining <= 0 && accountUrl ? (
				<a className="ffxb-pai-btn ffxb-pai-btn--onbrand" href={ accountUrl }>
					{ __( 'Choose a larger plan', 'funnelforms-pro' ) }
				</a>
			) : null }
		</aside>
	);
}
