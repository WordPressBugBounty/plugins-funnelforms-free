/**
 * The analytics mode of the canvas (Pro): the figures of the published form as a layer over the
 * steps. Paths are drawn by how many took them, nodes carry a band by how many left them, the
 * strongest way from the start stands out, and the inspector shows the fields of the selected node.
 * Editing stays possible; the mode only adds the figures.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { FormsApi, FormStatsReport } from '../api';
import { canvasAnalytics, nodeFields, shownDay, percent, periodDays, SMALL_SAMPLE, type CanvasAnalytics, type DropBand, type EdgeAnalytics, type NodeAnalytics, type StatsPeriod } from '../stats';
import { nodeName } from '../document';
import type { BuilderStore } from '../store';
import { useBuilder } from './context';
import { duration } from './Entries';
import { __, sprintf } from './i18n';
import { Spinner } from './ui';

export interface Analytics {
	on: boolean;
	setOn: ( on: boolean ) => void;
	period: StatsPeriod;
	setPeriod: ( period: StatsPeriod ) => void;
	/** Only a published form has figures. */
	published: boolean;
	report: FormStatsReport | null;
	error: string | null;
	/** The figures per node and path while the mode is on and they are loaded. */
	figures: CanvasAnalytics | null;
}

/** The analytics mode; null in Funnelforms Free and outside the editor. */
export const AnalyticsContext = createContext<Analytics | null>( null );

export function useAnalytics(): Analytics | null {
	return useContext( AnalyticsContext );
}

/** State of the analytics mode of one form: on or off, the period, and its figures. */
export function useAnalyticsState( api: FormsApi, formId: number, store: BuilderStore ): Analytics {
	const [ on, setOn ] = useState( false );
	const [ period, setPeriod ] = useState<StatsPeriod>( 30 );
	const [ loaded, setLoaded ] = useState<{ report: FormStatsReport | null; error: string | null }>( { report: null, error: null } );
	const published = useStore( store, ( s ) => null !== ( s.form?.currentRevision ?? null ) );
	const doc = useStore( store, ( s ) => s.doc );
	// Whether the plugin was told that the mode was opened (view=canvas); once per opening, not per period.
	const counted = useRef( false );

	useEffect( () => {
		if ( ! on ) {
			counted.current = false;
		}
		if ( ! on || ! published ) {
			return undefined;
		}
		let live = true;
		const p = periodDays( period );
		const view = counted.current ? undefined : 'canvas';
		counted.current = true;
		setLoaded( { report: null, error: null } );
		api.formStats( formId, p.from, p.to, 'full', view )
			.then( ( report ) => live && setLoaded( { report, error: null } ) )
			.catch( ( e: unknown ) => live && setLoaded( { report: null, error: e instanceof Error ? e.message : String( e ) } ) );
		return () => {
			live = false;
		};
	}, [ api, formId, on, period, published ] );

	const figures = useMemo( () => ( on && loaded.report && doc ? canvasAnalytics( doc, loaded.report ) : null ), [ on, loaded.report, doc ] );
	return useMemo( () => ( { on, setOn, period, setPeriod, published, report: loaded.report, error: loaded.error, figures } ), [ on, period, published, loaded, figures ] );
}

function number( n: number ): string {
	try {
		return new Intl.NumberFormat().format( n );
	} catch {
		return String( n );
	}
}

function bandName( band: DropBand ): string {
	return { low: __( 'Few leave', 'funnelforms-pro' ), medium: __( 'Some leave', 'funnelforms-pro' ), high: __( 'Many leave', 'funnelforms-pro' ) }[ band ];
}

/** Switch, period and state of the mode, in a panel at the top right of the canvas. */
export function AnalyticsPanel() {
	const analytics = useAnalytics();
	const toggle = useCallback( () => analytics?.setOn( ! analytics.on ), [ analytics ] );
	if ( ! analytics ) {
		return null;
	}
	const { on, period, setPeriod, published, report, error } = analytics;
	return (
		<div className="ffxb-analytics">
			<button type="button" className="ffxb-analytics__toggle" aria-pressed={ on } onClick={ toggle } title={ __( 'Analytics on the canvas (A)', 'funnelforms-pro' ) } aria-keyshortcuts="A">
				{ __( 'Analytics', 'funnelforms-pro' ) }
			</button>
			{ on ? (
				<div className="ffxb-analytics__body">
					{ published ? (
						<div className="ffxb-chips" role="group" aria-label={ __( 'Period', 'funnelforms-pro' ) }>
							{ ( [ 7, 30, 90 ] as StatsPeriod[] ).map( ( p ) => (
								<button key={ p } type="button" className="ffxb-chip" aria-pressed={ period === p } onClick={ () => setPeriod( p ) }>
									{ sprintf( __( '%d days', 'funnelforms-pro' ), p ) }
								</button>
							) ) }
						</div>
					) : null }
					<div role="status" className="ffxb-analytics__status">
						{ ! published ? __( 'Statistics start when the form is published.', 'funnelforms-pro' ) : null }
						{ published && error ? sprintf( __( 'The figures could not be loaded: %s', 'funnelforms-pro' ), error ) : null }
						{ published && ! error && ! report ? <Spinner label={ __( 'Loading figures…', 'funnelforms-pro' ) } /> : null }
						{ report ? sprintf( __( '%1$s views from %2$s to %3$s, of the published version.', 'funnelforms-pro' ), number( report.totals.views ), shownDay( report.from ), shownDay( report.to ) ) : null }
						{ report && report.totals.views < SMALL_SAMPLE ? <p className="ffxb-analytics__small">{ sprintf( __( 'Fewer than %d views: the shares can change a lot with each visitor.', 'funnelforms-pro' ), SMALL_SAMPLE ) }</p> : null }
					</div>
				</div>
			) : null }
		</div>
	);
}

/** What the lines, bands and marks of the mode mean, at the bottom of the canvas. */
export function AnalyticsLegend( { dots = false }: { dots?: boolean } ) {
	return (
		<div className="ffxb-analytics-legend" aria-label={ __( 'Legend of the analytics', 'funnelforms-pro' ) } role="group">
			{ dots ? (
				<>
					<span className="ffxb-analytics-legend__item">
						<span className="ffxb-analytics-legend__dot ffxb-analytics-legend__dot--left" aria-hidden="true" />
						{ __( 'Leaves', 'funnelforms-pro' ) }
					</span>
					<span className="ffxb-analytics-legend__item">
						<span className="ffxb-analytics-legend__dot ffxb-analytics-legend__dot--lead" aria-hidden="true" />
						{ __( 'Becomes a lead', 'funnelforms-pro' ) }
					</span>
				</>
			) : null }
			<span className="ffxb-analytics-legend__item">
				<span className="ffxb-analytics-legend__line" aria-hidden="true" />
				{ __( 'Thicker path: more of the step took it', 'funnelforms-pro' ) }
			</span>
			<span className="ffxb-analytics-legend__item">
				<span className="ffxb-analytics-legend__line ffxb-analytics-legend__line--none" aria-hidden="true" />
				{ __( 'Dashed: nobody', 'funnelforms-pro' ) }
			</span>
			<span className="ffxb-analytics-legend__item">
				<span className="ffxb-path-label__star" aria-hidden="true">
					★
				</span>
				{ __( 'Strongest path', 'funnelforms-pro' ) }
			</span>
			{ ( [ 'low', 'medium', 'high' ] as DropBand[] ).map( ( band ) => (
				<span key={ band } className="ffxb-analytics-legend__item">
					<span className={ `ffxb-analytics-band ffxb-analytics-band--${ band }` } aria-hidden="true" />
					{ bandName( band ) + ' ' + { low: __( '(under 15 %)', 'funnelforms-pro' ), medium: __( '(15 to 30 %)', 'funnelforms-pro' ), high: __( '(30 % or more)', 'funnelforms-pro' ) }[ band ] }
				</span>
			) ) }
		</div>
	);
}

/** The figures of a node on the canvas; forecast: of the prediction (virtual visitors). */
export function NodeAnalyticsView( { type, figures: all, forecast = false, played = null }: { type: 'step' | 'contact' | 'end'; figures: NodeAnalytics; forecast?: boolean; played?: { reached: number; left: number } | null } ) {
	// While the visitors of a prediction play, the counts so far.
	const figures = played ? { ...all, reached: Math.round( all.reached * played.reached ), left: Math.round( all.left * played.left ), sent: Math.round( all.sent * played.reached ) } : all;
	if ( 0 === all.reached ) {
		return <div className="ffxb-node__analytics ffxb-node__analytics--none">{ forecast ? __( 'No virtual visitor reaches this.', 'funnelforms-pro' ) : __( 'Nobody reached this in the period.', 'funnelforms-pro' ) }</div>;
	}
	if ( 'end' === type ) {
		return (
			<div className="ffxb-node__analytics">
				<span>{ figures.sent ? sprintf( __( '%d sent forms ended here', 'funnelforms-pro' ), figures.sent ) : sprintf( __( '%d reached', 'funnelforms-pro' ), figures.reached ) }</span>
			</div>
		);
	}
	return (
		<div className="ffxb-node__analytics">
			{ figures.band ? (
				<span className={ `ffxb-analytics-band ffxb-analytics-band--${ figures.band }` }>
					{ bandName( figures.band ) }
				</span>
			) : null }
			<span>{ sprintf( __( '%1$d reached · %2$d left (%3$s)', 'funnelforms-pro' ), figures.reached, figures.left, percent( figures.dropRate ) ) }</span>
			{ 'contact' === type ? <span>{ sprintf( __( '%1$d sent (%2$s)', 'funnelforms-pro' ), figures.sent, percent( figures.sentRate ) ) }</span> : null }
			{ null !== figures.seconds ? <span>{ sprintf( __( 'Median time here: %s', 'funnelforms-pro' ), duration( figures.seconds ) ) }</span> : null }
		</div>
	);
}

/** The label of a path: views that took it and their share of the step before. */
export function edgeFigures( figures: EdgeAnalytics ): { label: string; title: string } {
	return {
		label: sprintf( __( '%1$s · %2$s', 'funnelforms-pro' ), number( figures.sessions ), percent( figures.share ?? 0 ) ),
		title: sprintf( __( '%1$s views took this path, %2$s of those who reached the step before.', 'funnelforms-pro' ), number( figures.sessions ), percent( figures.share ?? 0 ) ),
	};
}

/** The analytics of the selected node in the inspector: its fields with checks, inputs and answers. */
export function NodeAnalyticsSection( { nodeId }: { nodeId: string } ) {
	const analytics = useAnalytics();
	const node = useBuilder( ( s ) => s.doc?.nodes.find( ( n ) => n.id === nodeId ) );
	const report = analytics?.report;
	const figures = analytics?.figures?.nodes.get( nodeId );
	if ( ! report || ! figures || ! node ) {
		return null;
	}
	const fields = nodeFields( report, nodeId );
	const extended = report.extended ?? 0;
	return (
		<section className="ffxb-section ffxb-analytics-section" aria-label={ __( 'Analytics', 'funnelforms-pro' ) }>
			<h3 className="ffxb-section__title">{ __( 'Analytics', 'funnelforms-pro' ) }</h3>
			<NodeAnalyticsView type={ node.type } figures={ figures } />
			{ fields.length ? (
				<table className="ffxb-stats ffxb-analytics-fields">
					<caption className="screen-reader-text">{ __( 'Fields of the step', 'funnelforms-pro' ) }</caption>
					<thead>
						<tr>
							<th>{ __( 'Field', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Check failed', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Filled in', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Last before leaving', 'funnelforms-pro' ) }</th>
						</tr>
					</thead>
					<tbody>
						{ fields.map( ( f ) => (
							<tr key={ f.field }>
								<td>{ f.title || __( 'Without a title', 'funnelforms-pro' ) }</td>
								<td>{ f.invalid ? `${ number( f.invalid ) } (${ percent( f.invalidRate ) })` : '0' }</td>
								<td>{ extended ? number( f.touched ) : '–' }</td>
								<td>{ extended ? number( f.lastTouched ) : '–' }</td>
							</tr>
						) ) }
					</tbody>
				</table>
			) : null }
			{ fields.length ? (
				<p className="ffxb-hint">
					{ extended
						? sprintf( __( 'Filled in and last before leaving: from %1$s of %2$s views with consent to statistics.', 'funnelforms-pro' ), number( extended ), number( report.totals.views ) )
						: __( 'Filled in and last before leaving are counted only for views with consent to statistics; there were none in the period.', 'funnelforms-pro' ) }
				</p>
			) : null }
			{ fields
				.filter( ( f ) => f.answers.length )
				.map( ( f ) => (
					<table key={ f.field } className="ffxb-stats ffxb-answers">
						<caption>{ f.title || __( 'Without a title', 'funnelforms-pro' ) }</caption>
						<thead>
							<tr>
								<th>{ __( 'Answer', 'funnelforms-pro' ) }</th>
								<th>{ __( 'Given', 'funnelforms-pro' ) }</th>
								<th>{ __( 'Sent the form', 'funnelforms-pro' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ f.answers.map( ( o ) => (
								<tr key={ o.id }>
									<td>{ o.label || o.id }</td>
									<td>{ `${ number( o.chosen ) } (${ percent( o.share ) })` }</td>
									<td>{ percent( o.sentRate ) }</td>
								</tr>
							) ) }
						</tbody>
					</table>
				) ) }
		</section>
	);
}

/** The paths with their figures as a table, in the inspector while nothing is selected. */
export function PathsSection() {
	const analytics = useAnalytics();
	const doc = useBuilder( ( s ) => s.doc );
	const figures = analytics?.figures;
	if ( ! figures || ! doc ) {
		return null;
	}
	const name = ( id: string ): string => {
		const node = doc.nodes.find( ( n ) => n.id === id );
		return ( node && nodeName( node, doc.locales.default ) ) || __( 'Without a title', 'funnelforms-pro' );
	};
	return (
		<section className="ffxb-section ffxb-analytics-section" aria-label={ __( 'Analytics', 'funnelforms-pro' ) }>
			<h3 className="ffxb-section__title">{ __( 'Paths', 'funnelforms-pro' ) }</h3>
			<p className="ffxb-hint">{ __( 'Select a step to see its fields and answers.', 'funnelforms-pro' ) }</p>
			<table className="ffxb-stats ffxb-analytics-paths">
				<thead>
					<tr>
						<th>{ __( 'Path', 'funnelforms-pro' ) }</th>
						<th>{ __( 'Views', 'funnelforms-pro' ) }</th>
						<th>{ __( 'Share', 'funnelforms-pro' ) }</th>
					</tr>
				</thead>
				<tbody>
					{ doc.edges.map( ( edge ) => {
						const f = figures.edges.get( edge.id );
						return f ? (
							<tr key={ edge.id } className={ f.strongest ? 'is-strongest' : '' }>
								<td>
									{ sprintf( __( '%1$s → %2$s', 'funnelforms-pro' ), name( edge.from ), name( edge.to ) ) }
									{ f.strongest ? (
										<>
											<span className="ffxb-path-label__star" aria-hidden="true">
												{ ' ★' }
											</span>
											<span className="screen-reader-text">{ ' (' + __( 'Strongest path', 'funnelforms-pro' ) + ')' }</span>
										</>
									) : null }
								</td>
								<td>{ number( f.sessions ) }</td>
								<td>{ percent( f.share ) }</td>
							</tr>
						) : null;
					} ) }
				</tbody>
			</table>
		</section>
	);
}
