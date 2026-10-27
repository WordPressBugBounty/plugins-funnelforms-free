/**
 * Form statistics without React: periods and the one before them, changes between them, drop-off
 * per step and per answer, and the figures of the analytics mode on the canvas.
 */
import type { FormStatsReport } from './api';

export type StatsPeriod = 7 | 30 | 90;

function day( date: Date ): string {
	const m = String( date.getMonth() + 1 ).padStart( 2, '0' );
	const d = String( date.getDate() ).padStart( 2, '0' );
	return `${ date.getFullYear() }-${ m }-${ d }`;
}

/** The last `days` days up to today, and the same number of days before them. */
export function periodDays( days: StatsPeriod, today: Date = new Date() ): { from: string; to: string; previousFrom: string; previousTo: string } {
	const at = ( offset: number ): string => {
		const d = new Date( today.getFullYear(), today.getMonth(), today.getDate() );
		d.setDate( d.getDate() - offset );
		return day( d );
	};
	return { from: at( days - 1 ), to: at( 0 ), previousFrom: at( 2 * days - 1 ), previousTo: at( days ) };
}

/**
 * The analytics page of a form in the admin (StatsPage in the plugin), relative to wp-admin where
 * the builder runs, for the same period.
 */
export function analyticsUrl( formId: number, days: StatsPeriod = 30 ): string {
	return `admin.php?page=funnelforms-stats&form=${ formId }` + ( 30 === days ? '' : `&period=${ days }` );
}

/** Relative change from the previous period; null without figures before. */
export function change( now: number | null, before: number | null ): number | null {
	if ( null === now || null === before || 0 === before ) {
		return null;
	}
	return now / before - 1;
}

/** A day of a report (Y-m-d) in the editor's date format ("21.09.2026"); the same day in every time zone. */
export function shownDay( date: string, locale?: string ): string {
	if ( ! /^\d{4}-\d{2}-\d{2}$/.test( date ) ) {
		return date;
	}
	try {
		return new Intl.DateTimeFormat( locale, { dateStyle: 'medium', timeZone: 'UTC' } ).format( new Date( date + 'T12:00:00Z' ) );
	} catch {
		return date;
	}
}

/** Share as a whole percentage (0.0922 → "9.2 %"), in the editor's language. */
export function percent( share: number | null, locale?: string ): string {
	if ( null === share || ! Number.isFinite( share ) ) {
		return '–';
	}
	try {
		return new Intl.NumberFormat( locale, { style: 'percent', maximumFractionDigits: share < 0.1 && share > -0.1 ? 1 : 0 } ).format( share );
	} catch {
		return `${ Math.round( share * 1000 ) / 10 } %`;
	}
}

export interface StepRow {
	id: string;
	type: 'step' | 'contact';
	title: string;
	reached: number;
	left: number;
	/** Share of those who reached the step and left there. */
	dropRate: number | null;
	/** Share of the views that reached the step. */
	reachRate: number | null;
}

/** Steps with their drop-off; steps nobody reached are kept, so a dead step shows. */
export function stepRows( report: FormStatsReport ): StepRow[] {
	const views = report.totals.views;
	return report.steps.map( ( s ) => ( {
		...s,
		dropRate: s.reached > 0 ? s.left / s.reached : null,
		reachRate: views > 0 ? Math.min( 1, s.reached / views ) : null,
	} ) );
}

/** The step where most visitors leave, when any leave at all. */
export function worstStep( rows: StepRow[] ): StepRow | null {
	let worst: StepRow | null = null;
	for ( const row of rows ) {
		if ( row.left > 0 && ( ! worst || row.left > worst.left ) ) {
			worst = row;
		}
	}
	return worst;
}

export interface AnswerRow {
	id: string;
	label: string;
	chosen: number;
	/** Share of the answers to this question. */
	share: number | null;
	/** Share of those who gave this answer and sent the form. */
	sentRate: number | null;
}

/** Answers of one question with their share and how often they lead to a sent form. */
export function answerRows( options: Array<{ id: string; label: string; chosen: number; completed: number }> ): AnswerRow[] {
	const total = options.reduce( ( sum, o ) => sum + o.chosen, 0 );
	return options.map( ( o ) => ( {
		id: o.id,
		label: o.label,
		chosen: o.chosen,
		share: total > 0 ? o.chosen / total : null,
		sentRate: o.chosen > 0 ? Math.min( 1, o.completed / o.chosen ) : null,
	} ) );
}

/** Figures per step for the canvas. */
export type StepFigures = Map<string, { reached: number; left: number }>;

export function stepFigures( report: FormStatsReport ): StepFigures {
	return new Map( report.steps.map( ( s ) => [ s.id, { reached: s.reached, left: s.left } ] ) );
}

/** How many leave a node: below 15 % low, below 30 % medium, else high. */
export type DropBand = 'low' | 'medium' | 'high';

export function dropBand( rate: number | null ): DropBand | null {
	if ( null === rate ) {
		return null;
	}
	return rate < 0.15 ? 'low' : rate < 0.3 ? 'medium' : 'high';
}

/** Below this many views in the period the shares change a lot from visitor to visitor. */
export const SMALL_SAMPLE = 30;

export interface NodeAnalytics {
	/** Page views that reached the node: steps and contact steps counted by the runtime, ends by their paths. */
	reached: number;
	left: number;
	dropRate: number | null;
	band: DropBand | null;
	/** Median seconds in the step, of sent forms. */
	seconds: number | null;
	/** Contact steps: views that went on from it (sent); ends: sent forms that ended there. */
	sent: number;
	/** Contact steps: share of those who reached it and sent the form. */
	sentRate: number | null;
	strongest: boolean;
}

export interface EdgeAnalytics {
	sessions: number;
	completed: number;
	/** Share of the views that reached the node the path starts at. */
	share: number | null;
	/** Stroke width in px, 1 to 10, and opacity, both by the share. */
	width: number;
	opacity: number;
	strongest: boolean;
}

export interface CanvasAnalytics {
	nodes: Map<string, NodeAnalytics>;
	/** By the id of the path in the document. */
	edges: Map<string, EdgeAnalytics>;
	views: number;
	small: boolean;
}

/** What the analytics mode needs of the document: nodes, their paths and the start. */
interface FlowShape {
	start: string;
	nodes: Array<{ id: string; type: 'step' | 'contact' | 'end' }>;
	edges: Array<{ id: string; from: string; to: string }>;
}

/**
 * The figures of the analytics mode on the canvas: per node how many reached and left it, per path
 * how many took it and which share of its node that is, and the strongest way from the start, which
 * always follows the path most views took. Paths of the document with the same nodes at both ends
 * show the same figures, the plugin counts ways between nodes.
 */
export function canvasAnalytics( doc: FlowShape, report: FormStatsReport ): CanvasAnalytics {
	const steps = new Map( report.steps.map( ( s ) => [ s.id, s ] ) );
	const ways = new Map<string, { sessions: number; completed: number }>();
	const into = new Map<string, { sessions: number; completed: number }>();
	for ( const p of report.paths ?? [] ) {
		const key = p.from + '>' + p.to;
		const way = ways.get( key ) ?? { sessions: 0, completed: 0 };
		ways.set( key, { sessions: way.sessions + p.sessions, completed: way.completed + p.completed } );
		const sum = into.get( p.to ) ?? { sessions: 0, completed: 0 };
		into.set( p.to, { sessions: sum.sessions + p.sessions, completed: sum.completed + p.completed } );
	}
	const nodes = new Map<string, NodeAnalytics>();
	for ( const node of doc.nodes ) {
		const s = steps.get( node.id );
		const reached = 'end' === node.type ? into.get( node.id )?.sessions ?? 0 : s?.reached ?? 0;
		const left = 'end' === node.type ? 0 : Math.min( reached, s?.left ?? 0 );
		const dropRate = 'end' !== node.type && reached > 0 ? left / reached : null;
		const sent = 'end' === node.type ? into.get( node.id )?.completed ?? 0 : 'contact' === node.type ? reached - left : 0;
		nodes.set( node.id, {
			reached,
			left,
			dropRate,
			band: dropBand( dropRate ),
			seconds: report.times?.steps[ node.id ] ?? null,
			sent,
			sentRate: 'contact' === node.type && reached > 0 ? sent / reached : null,
			strongest: false,
		} );
	}
	const edges = new Map<string, EdgeAnalytics>();
	for ( const edge of doc.edges ) {
		const way = ways.get( edge.from + '>' + edge.to ) ?? { sessions: 0, completed: 0 };
		const base = nodes.get( edge.from )?.reached ?? 0;
		const share = base > 0 ? Math.min( 1, way.sessions / base ) : null;
		edges.set( edge.id, {
			...way,
			share,
			width: Math.round( ( 1 + 9 * ( share ?? 0 ) ) * 10 ) / 10,
			opacity: way.sessions > 0 ? Math.round( ( 0.45 + 0.55 * ( share ?? 0 ) ) * 100 ) / 100 : 0.35,
			strongest: false,
		} );
	}
	// The strongest way: from the start along the path most views took, until no path was taken.
	let at: string | undefined = doc.start;
	const seen = new Set<string>();
	while ( at && ! seen.has( at ) && ( nodes.get( at )?.reached ?? 0 ) > 0 ) {
		seen.add( at );
		( nodes.get( at ) as NodeAnalytics ).strongest = true;
		let best: { id: string; to: string; sessions: number } | null = null;
		for ( const edge of doc.edges ) {
			const sessions = edges.get( edge.id )?.sessions ?? 0;
			if ( edge.from === at && sessions > 0 && ( ! best || sessions > best.sessions ) ) {
				best = { id: edge.id, to: edge.to, sessions };
			}
		}
		if ( ! best ) {
			break;
		}
		( edges.get( best.id ) as EdgeAnalytics ).strongest = true;
		at = best.to;
	}
	return { nodes, edges, views: report.totals.views, small: report.totals.views < SMALL_SAMPLE };
}

export interface FieldAnalytics {
	field: string;
	title: string;
	type: string;
	invalid: number;
	touched: number;
	lastTouched: number;
	/** Share of the views that reached the step and failed the check of the field. */
	invalidRate: number | null;
	/** Choice and dropdown fields: the answers. */
	answers: AnswerRow[];
}

/** The fields of a node with their checks, inputs and answers, for the inspector. */
export function nodeFields( report: FormStatsReport, nodeId: string ): FieldAnalytics[] {
	const reached = report.steps.find( ( s ) => s.id === nodeId )?.reached ?? 0;
	const answers = new Map( ( report.answers ?? [] ).filter( ( a ) => a.step === nodeId ).map( ( a ) => [ a.field, answerRows( a.options ) ] ) );
	return ( report.fieldStats ?? [] )
		.filter( ( f ) => f.step === nodeId )
		.map( ( f ) => ( { field: f.field, title: f.title, type: f.type, invalid: f.invalid, touched: f.touched, lastTouched: f.lastTouched, invalidRate: reached > 0 ? Math.min( 1, f.invalid / reached ) : null, answers: answers.get( f.field ) ?? [] } ) );
}
