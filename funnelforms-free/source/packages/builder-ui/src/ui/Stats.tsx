/**
 * Statistics of a published form: views, starts, sent forms and conversion compared with the
 * period before, a chart per day, where visitors leave, and how each answer of a choice leads on.
 * The builder can also show the figures per step on the canvas.
 */
import React, { createContext, useEffect, useMemo, useState } from 'react';
import type { FormsApi, FormStatsReport } from '../api';
import { analyticsUrl, answerRows, change, percent, periodDays, shownDay, stepFigures, stepRows, worstStep, type StatsPeriod, type StepFigures } from '../stats';
import { deviceName, duration } from './Entries';
import { __, sprintf } from './i18n';
import { Badge, Button, Dialog, Empty, icons, Notice, ProBadge, ProLink, Spinner } from './ui';

/** Figures per step shown on the canvas; null while they are hidden. */
export const FiguresContext = createContext<StepFigures | null>( null );

function number( n: number, locale?: string ): string {
	try {
		return new Intl.NumberFormat( locale ).format( n );
	} catch {
		return String( n );
	}
}

/** Change against the period before; with lowerIsBetter a fall shows as good (times). */
function Change( { now, before, locale, lowerIsBetter = false }: { now: number | null; before: number | null; locale?: string; lowerIsBetter?: boolean } ) {
	const c = change( now, before );
	if ( null === c ) {
		return <span className="ffxb-kpi__change">{ __( 'No figures before', 'funnelforms-pro' ) }</span>;
	}
	const text = ( c > 0 ? '+' : '' ) + percent( c, locale );
	const good = lowerIsBetter ? c < 0 : c > 0;
	return (
		<span className={ 'ffxb-kpi__change' + ( 0 === c ? '' : good ? ' is-up' : ' is-down' ) } title={ __( 'Compared with the period before', 'funnelforms-pro' ) }>
			{ sprintf( __( '%s vs. period before', 'funnelforms-pro' ), text ) }
		</span>
	);
}

function Chart( { report, locale }: { report: FormStatsReport; locale?: string } ) {
	const days = report.daily;
	const max = Math.max( 1, ...days.map( ( d ) => Math.max( d.views, d.completions ) ) );
	const width = 640;
	const height = 140;
	const gap = days.length > 60 ? 1 : 2;
	const bar = width / Math.max( 1, days.length );
	const label = sprintf( __( '%1$s views and %2$s sent forms from %3$s to %4$s', 'funnelforms-pro' ), number( report.totals.views, locale ), number( report.totals.completions, locale ), shownDay( report.from, locale ), shownDay( report.to, locale ) );
	return (
		<figure className="ffxb-chart">
			<svg viewBox={ `0 0 ${ width } ${ height }` } role="img" aria-label={ label } preserveAspectRatio="none">
				{ days.map( ( d, i ) => {
					const h = ( d.views / max ) * ( height - 4 );
					const c = ( d.completions / max ) * ( height - 4 );
					return (
						<g key={ d.date }>
							<title>{ sprintf( __( '%1$s: %2$d views, %3$d sent', 'funnelforms-pro' ), shownDay( d.date, locale ), d.views, d.completions ) }</title>
							<rect className="ffxb-chart__views" x={ i * bar + gap / 2 } y={ height - h } width={ Math.max( 1, bar - gap ) } height={ h } />
							<rect className="ffxb-chart__sent" x={ i * bar + gap / 2 } y={ height - c } width={ Math.max( 1, bar - gap ) } height={ c } />
						</g>
					);
				} ) }
			</svg>
			<figcaption className="ffxb-chart__legend">
				<span className="ffxb-chart__key ffxb-chart__key--views">{ __( 'Views', 'funnelforms-pro' ) }</span>
				<span className="ffxb-chart__key ffxb-chart__key--sent">{ __( 'Sent', 'funnelforms-pro' ) }</span>
				<span className="ffxb-chart__range">
					{ shownDay( report.from, locale ) } – { shownDay( report.to, locale ) }
				</span>
			</figcaption>
		</figure>
	);
}

/** Sent forms per device kind, as share of those with a known device. */
function Devices( { devices, locale }: { devices: NonNullable<FormStatsReport[ 'devices' ]>; locale?: string } ) {
	const total = devices.desktop + devices.tablet + devices.mobile;
	if ( 0 === total ) {
		return null;
	}
	return (
		<section className="ffxb-statsview__section">
			<h3 className="ffxb-statsview__title">{ __( 'Devices', 'funnelforms-pro' ) }</h3>
			<p className="ffxb-hint">{ __( 'On which devices the form was sent.', 'funnelforms-pro' ) }</p>
			<table className="ffxb-stats ffxb-devices">
				<tbody>
					{ ( [ 'mobile', 'desktop', 'tablet' ] as const ).map( ( kind ) => (
						<tr key={ kind }>
							<td>
								<span className="ffxb-steps__name">{ deviceName( kind ) }</span>
								<span className="ffxb-meter" aria-hidden="true">
									<span style={ { width: `${ Math.round( ( devices[ kind ] / total ) * 100 ) }%` } } />
								</span>
							</td>
							<td>{ `${ number( devices[ kind ], locale ) } (${ percent( devices[ kind ] / total, locale ) })` }</td>
						</tr>
					) ) }
				</tbody>
			</table>
		</section>
	);
}

export function StatsView( { api, formId, locale }: { api: FormsApi; formId: number; locale?: string } ) {
	const [ period, setPeriod ] = useState<StatsPeriod>( 30 );
	const [ data, setData ] = useState<{ now: FormStatsReport; before: FormStatsReport } | null>( null );
	const [ error, setError ] = useState<string | null>( null );

	useEffect( () => {
		let live = true;
		const p = periodDays( period );
		setData( null );
		setError( null );
		Promise.all( [ api.formStats( formId, p.from, p.to ), api.formStats( formId, p.previousFrom, p.previousTo ) ] )
			.then( ( [ now, before ] ) => live && setData( { now, before } ) )
			.catch( ( e: unknown ) => live && setError( e instanceof Error ? e.message : String( e ) ) );
		return () => {
			live = false;
		};
	}, [ api, formId, period ] );

	const steps = useMemo( () => ( data ? stepRows( data.now ) : [] ), [ data ] );
	const worst = worstStep( steps );

	return (
		<div className="ffxb-statsview">
			<div className="ffxb-chips" role="group" aria-label={ __( 'Period', 'funnelforms-pro' ) }>
				{ ( [ 7, 30, 90 ] as StatsPeriod[] ).map( ( p ) => (
					<button key={ p } type="button" className="ffxb-chip" aria-pressed={ period === p } onClick={ () => setPeriod( p ) }>
						{ sprintf( __( 'Last %d days', 'funnelforms-pro' ), p ) }
					</button>
				) ) }
			</div>
			{ /* The analytics of one form are Funnelforms Pro; Free names them with a link to the page about Pro. */ }
			{ 'free' === process.env.FUNNELFORMS_EDITION ? (
				<Notice title={ __( 'More in the analytics', 'funnelforms-pro' ) } action={ <ProLink /> }>
					<ProBadge /> { __( 'Where visitors come from, times per step, numbers and ratings, campaigns and when entries come in.', 'funnelforms-pro' ) }
				</Notice>
			) : (
				<Notice
					title={ __( 'More in the analytics', 'funnelforms-pro' ) }
					action={
						<a className="ffxb-button ffxb-button--secondary ffxb-button--sm" href={ analyticsUrl( formId, period ) }>
							{ __( 'Open analytics', 'funnelforms-pro' ) }
						</a>
					}
				>
					{ __( 'Where visitors come from, times per step, numbers and ratings, campaigns and when entries come in.', 'funnelforms-pro' ) }
				</Notice>
			) }
			{ error ? <Notice tone="danger" title={ __( 'The figures could not be loaded.', 'funnelforms-pro' ) }>{ error }</Notice> : null }
			{ ! data && ! error ? <Spinner label={ __( 'Loading figures…', 'funnelforms-pro' ) } /> : null }
			{ data ? (
				<>
					<div className="ffxb-kpis">
						<div className="ffxb-kpi">
							<span className="ffxb-kpi__label">{ __( 'Views', 'funnelforms-pro' ) }</span>
							<strong className="ffxb-kpi__value">{ number( data.now.totals.views, locale ) }</strong>
							<Change now={ data.now.totals.views } before={ data.before.totals.views } locale={ locale } />
						</div>
						<div className="ffxb-kpi">
							<span className="ffxb-kpi__label">{ __( 'Started', 'funnelforms-pro' ) }</span>
							<strong className="ffxb-kpi__value">{ number( data.now.totals.starts, locale ) }</strong>
							<Change now={ data.now.totals.starts } before={ data.before.totals.starts } locale={ locale } />
						</div>
						<div className="ffxb-kpi">
							<span className="ffxb-kpi__label">{ __( 'Sent', 'funnelforms-pro' ) }</span>
							<strong className="ffxb-kpi__value">{ number( data.now.totals.completions, locale ) }</strong>
							<Change now={ data.now.totals.completions } before={ data.before.totals.completions } locale={ locale } />
						</div>
						<div className="ffxb-kpi">
							<span className="ffxb-kpi__label">{ __( 'Conversion rate', 'funnelforms-pro' ) }</span>
							<strong className="ffxb-kpi__value">{ percent( data.now.totals.conversionRate, locale ) }</strong>
							<Change now={ data.now.totals.conversionRate } before={ data.before.totals.conversionRate } locale={ locale } />
						</div>
						<div className="ffxb-kpi">
							<span className="ffxb-kpi__label">{ __( 'Average time to fill in', 'funnelforms-pro' ) }</span>
							<strong className="ffxb-kpi__value">{ null == data.now.totals.averageSeconds ? '–' : duration( data.now.totals.averageSeconds ) }</strong>
							{ null == data.now.totals.medianSeconds ? (
								<Change now={ null } before={ null } locale={ locale } />
							) : (
								<span className="ffxb-kpi__change" title={ __( 'Half of the visitors took less, half took longer.', 'funnelforms-pro' ) }>
									{ sprintf( __( 'Median %s', 'funnelforms-pro' ), duration( data.now.totals.medianSeconds ) ) }
								</span>
							) }
						</div>
						{ data.now.abandonment ? (
							<div className="ffxb-kpi">
								<span className="ffxb-kpi__label">{ __( 'Recovered by reminders', 'funnelforms-pro' ) }</span>
								<strong className="ffxb-kpi__value">{ number( data.now.abandonment.recovered, locale ) }</strong>
								<span className="ffxb-kpi__change">
									{ /* translators: 1: share of reminded visitors who came back, 2: number of reminded visitors, 3: number of visitors who left after typing their address. */ }
									{ sprintf( __( '%1$s of %2$s reminded (%3$s left)', 'funnelforms-pro' ), percent( data.now.abandonment.recoveryRate, locale ), number( data.now.abandonment.reminded, locale ), number( data.now.abandonment.abandoned, locale ) ) }
								</span>
							</div>
						) : null }
					</div>

					<Chart report={ data.now } locale={ locale } />

					<section className="ffxb-statsview__section">
						<h3 className="ffxb-statsview__title">{ __( 'Where visitors leave', 'funnelforms-pro' ) }</h3>
						{ worst ? <p className="ffxb-hint">{ sprintf( __( 'Most visitors leave on “%1$s” (%2$s of those who reach it).', 'funnelforms-pro' ), worst.title || __( 'Without a title', 'funnelforms-pro' ), percent( worst.dropRate, locale ) ) }</p> : null }
						<table className="ffxb-stats ffxb-steps">
							<thead>
								<tr>
									<th>{ __( 'Step', 'funnelforms-pro' ) }</th>
									<th>{ __( 'Reached', 'funnelforms-pro' ) }</th>
									<th>{ __( 'Left here', 'funnelforms-pro' ) }</th>
								</tr>
							</thead>
							<tbody>
								{ steps.map( ( s ) => (
									<tr key={ s.id } className={ worst?.id === s.id ? 'is-worst' : '' }>
										<td>
											<span className="ffxb-steps__name">{ s.title || __( 'Without a title', 'funnelforms-pro' ) }</span>
											<span className="ffxb-meter" aria-hidden="true">
												<span style={ { width: `${ Math.round( ( s.reachRate ?? 0 ) * 100 ) }%` } } />
											</span>
										</td>
										<td>{ `${ number( s.reached, locale ) } (${ percent( s.reachRate, locale ) })` }</td>
										<td>{ s.left ? `${ number( s.left, locale ) } (${ percent( s.dropRate, locale ) })` : '0' }</td>
									</tr>
								) ) }
							</tbody>
						</table>
					</section>

					{ data.now.devices ? <Devices devices={ data.now.devices } locale={ locale } /> : null }

					{ data.now.answers?.length ? (
						<section className="ffxb-statsview__section">
							<h3 className="ffxb-statsview__title">{ __( 'Answers', 'funnelforms-pro' ) }</h3>
							<p className="ffxb-hint">{ __( 'How often each answer was given, and how many of those visitors sent the form.', 'funnelforms-pro' ) }</p>
							{ data.now.answers.map( ( q ) => (
								<table key={ q.field } className="ffxb-stats ffxb-answers">
									<caption>{ q.title || __( 'Without a title', 'funnelforms-pro' ) }</caption>
									<thead>
										<tr>
											<th>{ __( 'Answer', 'funnelforms-pro' ) }</th>
											<th>{ __( 'Given', 'funnelforms-pro' ) }</th>
											<th>{ __( 'Sent the form', 'funnelforms-pro' ) }</th>
										</tr>
									</thead>
									<tbody>
										{ answerRows( q.options ).map( ( o ) => (
											<tr key={ o.id }>
												<td>
													<span className="ffxb-steps__name">{ o.label || o.id }</span>
													<span className="ffxb-meter" aria-hidden="true">
														<span style={ { width: `${ Math.round( ( o.share ?? 0 ) * 100 ) }%` } } />
													</span>
												</td>
												<td>{ `${ number( o.chosen, locale ) } (${ percent( o.share, locale ) })` }</td>
												<td>{ percent( o.sentRate, locale ) }</td>
											</tr>
										) ) }
									</tbody>
								</table>
							) ) }
						</section>
					) : null }
					<p className="ffxb-hint">{ __( 'Counted per page view, without cookies, for the published version.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
		</div>
	);
}

/** The figures per step of the last 30 days, for the canvas, with the period as its label. */
export async function canvasFigures( api: FormsApi, formId: number ): Promise<{ figures: StepFigures; label: string }> {
	const p = periodDays( 30 );
	const report = await api.formStats( formId, p.from, p.to );
	return { figures: stepFigures( report ), label: sprintf( __( '%1$s – %2$s', 'funnelforms-pro' ), shownDay( report.from ), shownDay( report.to ) ) };
}

/**
 * The figures of one form on the statistics page of Funnelforms Free (screen form-stats): the
 * same figures as in the dialog of the form list, with the way to see them on the steps.
 */
export function FormStatsScreen( { api, formId, published, canvasUrl, locale }: { api: FormsApi; formId: number; published: boolean; canvasUrl?: string; locale?: string } ) {
	return (
		<section className="ffxb-section ffxb-formstats">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Statistics', 'funnelforms-pro' ) }</h2>
				{ published && canvasUrl ? (
					<div className="ffxb-section__actions">
						<a className="ffxb-button ffxb-button--secondary ffxb-button--sm" href={ canvasUrl }>
							{ icons.chart }
							{ __( 'Show on the canvas', 'funnelforms-pro' ) }
						</a>
					</div>
				) : null }
			</header>
			{ published ? <StatsView api={ api } formId={ formId } locale={ locale } /> : <Empty title={ __( 'No figures yet', 'funnelforms-pro' ) }>{ __( 'Statistics start when the form is published.', 'funnelforms-pro' ) }</Empty> }
		</section>
	);
}

export function StatsDialog( props: { api: FormsApi; formId: number; title: string; locale?: string; onClose: () => void; onShowOnCanvas?: ( figures: StepFigures, label: string ) => void } ) {
	const { api, formId } = props;
	const [ busy, setBusy ] = useState( false );
	const showOnCanvas = async (): Promise<void> => {
		if ( ! props.onShowOnCanvas ) {
			return;
		}
		setBusy( true );
		try {
			const shown = await canvasFigures( api, formId );
			props.onShowOnCanvas( shown.figures, shown.label );
			props.onClose();
		} finally {
			setBusy( false );
		}
	};
	return (
		<Dialog
			open
			wide
			title={ sprintf( __( 'Statistics: %s', 'funnelforms-pro' ), props.title ) }
			onClose={ props.onClose }
			actions={
				<>
					{ props.onShowOnCanvas ? (
						<Button disabled={ busy } onClick={ () => void showOnCanvas() }>
							{ __( 'Show on the canvas', 'funnelforms-pro' ) }
						</Button>
					) : null }
					<Button variant="primary" onClick={ props.onClose }>
						{ __( 'Close', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			<StatsView api={ api } formId={ formId } locale={ props.locale } />
		</Dialog>
	);
}

/** The figures of a step on the canvas. */
export function NodeFigures( { figures }: { figures: { reached: number; left: number } } ) {
	const rate = figures.reached > 0 ? figures.left / figures.reached : null;
	return (
		<div className="ffxb-node__figures">
			<span>{ sprintf( __( '%d reached', 'funnelforms-pro' ), figures.reached ) }</span>
			{ figures.left ? <Badge tone={ null !== rate && rate >= 0.3 ? 'danger' : 'warning' }>{ sprintf( __( '%1$d left (%2$s)', 'funnelforms-pro' ), figures.left, percent( rate ) ) }</Badge> : null }
		</div>
	);
}
