/**
 * The simulation of the Predictive AI as a stage (tab of the editor): the AI reads the form, builds
 * the kinds of visitors, sends the virtual visitors through a funnel as wide as those still there,
 * and works out every suggestion again. It plays the result of predict() (the browser has it at
 * once); while the server still builds the model, the stage waits in the second phase.
 *
 * Phases on a clock of 18.5 s: read the form (0 to 2.6), understand the visitors (2.6 to 5.4,
 * waits there for the model), the visitors (5.4 to 14.2, at least 8 s), the suggestions (to 18.5).
 * From seven steps the names no longer fit on the columns: the columns get numbers, and the
 * questions run below the stage as a band that follows the visitors, each with what it asks and how
 * many leave there. Long forms name only the columns where many leave.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FormDocument, FormNode } from '@funnelforms/form-schema';
import { nodeName } from '../document';
import { funnelScore, isBetter, seeded, worthApplying, type Prediction, type PredictionModel, type PredictionParameters } from '../predict';
import { contactFieldName, stepFieldName } from './catalog';
import { __, sprintf } from './i18n';
import { industryNames, number } from './Prediction';
import { reducedMotion } from './PredictionScreen';

/** The phases of the clock, in seconds; the last is its end. */
export const STAGE = [ 0, 2.6, 5.4, 14.2, 18.5 ] as const;
const END = STAGE[ 4 ];
/** Without the model the clock stops here, in the second phase. */
const HOLD = 5.0;
/** Visitors drawn on the stage; the figures are those of the simulation. */
const DOTS = 210;
/** From this many steps a form counts as long: numbers on the columns. */
export const LONG_FORM = 12;
/** From this many steps the columns get numbers and the questions run in the band below the stage. */
const CROWDED = 7;
/** A column of a long form shows how many leave only where at least this share leaves. */
const HOT = 0.08;
const TICK_MS = 50;
const RING = 263.9;
const GOOD = '#3ddbb0';
const DROP = '#ffb547';
export const PERSONA_COLORS = [ '#a98bff', '#6cb6ff', '#ff8fc8', '#7ff0cf', '#ffd08a' ];
/** The same colours on white, for the result. */
export const PERSONA_DARK = [ '#6a30f5', '#2f7fd6', '#c2407f', '#1d7a46', '#b26a00' ];

/** One decimal, in the browser's language. */
export function decimal( value: number, digits = 1 ): string {
	try {
		return new Intl.NumberFormat( undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits } ).format( value );
	} catch {
		return value.toFixed( digits );
	}
}

/** Percent points of a share: 0.031 is "3.1". */
export function pointsOf( share: number ): string {
	return decimal( share * 100, 1 );
}

/** The steps of the form in the order visitors meet them: from the start along the paths. */
export function stepOrder( doc: FormDocument ): FormNode[] {
	const byId = new Map( doc.nodes.map( ( n ) => [ n.id, n ] ) );
	const seen = new Set<string>();
	const out: FormNode[] = [];
	const queue = [ doc.start ];
	while ( queue.length ) {
		const id = queue.shift() as string;
		const node = byId.get( id );
		if ( ! node || seen.has( id ) ) {
			continue;
		}
		seen.add( id );
		if ( 'end' !== node.type ) {
			out.push( node );
		}
		// The default way first: it is the way most visitors take.
		const edges = doc.edges.filter( ( e ) => e.from === id ).sort( ( a, b ) => Number( !! b.default ) - Number( !! a.default ) );
		queue.push( ...edges.map( ( e ) => e.to ) );
	}
	// Steps no path reaches come last, as on the canvas.
	for ( const n of doc.nodes ) {
		if ( 'end' !== n.type && ! seen.has( n.id ) ) {
			out.push( n );
		}
	}
	return out;
}

/** What the stage shows of the form, before and after the model. */
interface Column {
	id: string;
	name: string;
	/** Of 10,000 visitors: reached; and the share that leaves. */
	reach: number;
	drop: number;
}

export function stepName( doc: FormDocument, node: FormNode ): string {
	return nodeName( node, doc.locales.default ) || __( 'Without a title', 'funnelforms-pro' );
}

/** Counts of the form for the chips: steps, fields, ways with a condition, calculations. */
export function formCounts( doc: FormDocument ): { steps: number; fields: number; paths: number; calculations: number } {
	const steps = doc.nodes.filter( ( n ) => 'end' !== n.type );
	return {
		steps: steps.length,
		fields: steps.reduce( ( sum, n ) => sum + n.fields.filter( ( f ) => 'content' !== f.type ).length, 0 ),
		paths: doc.edges.filter( ( e ) => !! e.when ).length,
		calculations: doc.calculations.length,
	};
}

/** The chips of the form; logic and calculations only when the form has them. */
export function countChips( doc: FormDocument ): string[] {
	const c = formCounts( doc );
	return [
		sprintf( __( '%d steps', 'funnelforms-pro' ), c.steps ),
		sprintf( __( '%d fields', 'funnelforms-pro' ), c.fields ),
		c.paths ? sprintf( __( '%d logic paths', 'funnelforms-pro' ), c.paths ) : '',
		c.calculations ? sprintf( __( '%d calculations', 'funnelforms-pro' ), c.calculations ) : '',
	].filter( Boolean );
}

/** What a step asks, in a few words: the type of its one field, or its fields. */
export function stepKind( node: FormNode ): string {
	const fields = ( 'end' === node.type ? [] : node.fields ).filter( ( f ) => 'content' !== f.type && 'html' !== f.type && 'captcha' !== f.type && 'consent' !== f.type );
	if ( ! fields.length ) {
		return '';
	}
	if ( 'contact' === node.type ) {
		return fields.map( ( f ) => contactFieldName( f.type ) + ( 'phone' === f.type && f.required ? ' ' + __( '(required)', 'funnelforms-pro' ) : '' ) ).join( ', ' );
	}
	if ( fields.length > 1 ) {
		return sprintf( __( '%d fields', 'funnelforms-pro' ), fields.length );
	}
	const [ field ] = fields as [ ( typeof fields )[ number ] ];
	return field.required ? sprintf( __( '%s, required', 'funnelforms-pro' ), stepFieldName( field.type ) ) : stepFieldName( field.type );
}

function clamp( x: number ): number {
	return Math.max( 0, Math.min( 1, x ) );
}

interface Particle {
	spawn: number;
	persona: number;
	/** The column where the visitor leaves; the number of columns: becomes a lead. */
	exit: number;
	lane: number;
	speed: number;
	size: number;
}

/** The visitors on the stage: each its persona by share and where it leaves by that persona's share. */
function particles( columns: Column[], model: PredictionModel | null ): Particle[] {
	const random = seeded( 7 );
	const personas = model?.personas.length ? model.personas : [ { id: '', share: 1 } ];
	const total = personas.reduce( ( sum, p ) => sum + p.share, 0 ) || 1;
	const steps = new Map( ( model?.steps ?? [] ).map( ( s ) => [ s.node, s ] ) );
	const out: Particle[] = [];
	for ( let i = 0; i < DOTS; i++ ) {
		let r = random() * total;
		let persona = personas.length - 1;
		for ( let p = 0; p < personas.length; p++ ) {
			r -= personas[ p ]?.share ?? 0;
			if ( r < 0 ) {
				persona = p;
				break;
			}
		}
		const id = personas[ persona ]?.id ?? '';
		let exit = columns.length;
		for ( let k = 0; k < columns.length; k++ ) {
			const column = columns[ k ] as Column;
			const own = steps.get( column.id )?.continue[ id ];
			// The persona's own share, scaled so all together leave as in the simulation.
			const prior = steps.get( column.id )?.prior;
			const drop = undefined !== own && undefined !== prior && prior < 1 ? clamp( column.drop * ( ( 1 - own ) / Math.max( 0.001, 1 - prior ) ) ) : column.drop;
			if ( random() < drop ) {
				exit = k;
				break;
			}
		}
		out.push( { spawn: STAGE[ 2 ] + 0.2 + i * ( 5.0 / DOTS ) + random() * 0.04, persona, exit, lane: random() * 2 - 1, speed: 2.6 + random() * 0.7, size: 5 + Math.round( random() * 3 ) } );
	}
	return out;
}

interface Tick {
	at: number;
	text: string;
	tone?: 'warn' | 'good';
}

function ticks( doc: FormDocument, parameters: PredictionParameters, result: Prediction | null, model: PredictionModel | null, columns: Column[] ): Tick[] {
	const c = formCounts( doc );
	const out: Tick[] = [ { at: 0.3, text: sprintf( __( 'Form read: %1$d steps, %2$d fields, %3$d logic paths.', 'funnelforms-pro' ), c.steps, c.fields, c.paths ) } ];
	if ( c.steps >= LONG_FORM ) {
		out.push( { at: 1.6, text: __( 'A long form. The AI counts in fatigue: patience drops with every question.', 'funnelforms-pro' ) } );
	} else {
		const industry = 'other' === parameters.industry && parameters.industry_label ? parameters.industry_label : industryNames()[ parameters.industry as keyof ReturnType<typeof industryNames> ] ?? parameters.industry;
		out.push( { at: 1.6, text: sprintf( __( 'Industry: %s. Matching benchmarks loaded.', 'funnelforms-pro' ), industry ) } );
	}
	if ( ! result || ! model ) {
		return out;
	}
	out.push( { at: 5.2, text: sprintf( __( '%d kinds of visitors from your description.', 'funnelforms-pro' ), model.personas.length ) } );
	// The steps that lose the most, in the order visitors meet them, while the visitors pass them.
	const worst = result.sticking.map( ( s ) => s.id );
	const shown = columns.filter( ( col ) => worst.includes( col.id ) );
	shown.forEach( ( col, i ) => {
		const step = result.steps.find( ( s ) => s.id === col.id );
		const reason = step?.reasons[ 0 ];
		out.push( {
			at: 6.6 + ( i * 5.0 ) / Math.max( 1, shown.length ),
			text: sprintf( __( '%1$s: %2$s leave here.', 'funnelforms-pro' ), col.name, `${ decimal( col.drop * 100, 0 ) }\u00a0%` ) + ( reason ? ' ' + reason : '' ),
			tone: 'warn',
		} );
	} );
	const kinds = [ ...result.personas ].filter( ( p ) => null !== p.conversion ).sort( ( a, b ) => ( b.conversion ?? 0 ) - ( a.conversion ?? 0 ) );
	const first = kinds[ 0 ];
	const last = kinds[ kinds.length - 1 ];
	if ( first && last && first !== last ) {
		out.push( { at: 12.8, text: sprintf( __( '%1$s become a lead at %2$s, %3$s only at %4$s.', 'funnelforms-pro' ), first.name, `${ decimal( ( first.conversion ?? 0 ) * 100, 0 ) }\u00a0%`, last.name, `${ decimal( ( last.conversion ?? 0 ) * 100, 0 ) }\u00a0%` ) } );
	}
	const helpful = result.suggestions.filter( ( s ) => s.gain > 0.0005 );
	out.push( { at: 14.4, text: sprintf( __( '%1$d improvements found. Each is simulated again with %2$s visitors.', 'funnelforms-pro' ), result.suggestions.length, number( result.visitors ) ) } );
	const top = helpful[ 0 ];
	const where = top ? columns.find( ( col ) => col.id === top.node )?.name : undefined;
	out.push( {
		at: 17.6,
		text: top ? sprintf( __( 'Done. Strongest lever: +%1$s points at %2$s.', 'funnelforms-pro' ), pointsOf( top.gain ), where ?? top.title ) : __( 'Done. The AI finds nothing that brings noticeably more leads.', 'funnelforms-pro' ),
		tone: 'good',
	} );
	return out;
}

export interface StageProps {
	doc: FormDocument;
	parameters: PredictionParameters;
	/** Null while the server builds the model. */
	result: Prediction | null;
	model: PredictionModel | null;
	/** Second of the clock to start at: 0 for a new analysis, 5.4 to watch the visitors again. */
	from: number;
	onDone: () => void;
	/** The clock, for the stepper in the tab. */
	onProgress?: ( share: number ) => void;
}

export function PredictionStage( { doc, parameters, result, model, from, onDone, onProgress }: StageProps ) {
	const [ t, setT ] = useState( from );
	const ready = !! result && !! model;
	const clock = useRef( { t: from, last: Date.now(), ready } );
	clock.current.ready = ready;
	const done = useRef( onDone );
	done.current = onDone;
	const progress = useRef( onProgress );
	progress.current = onProgress;

	useEffect( () => {
		if ( reducedMotion() ) {
			return undefined;
		}
		const timer = setInterval( () => {
			const c = clock.current;
			const now = Date.now();
			const next = Math.min( END, c.t + ( now - c.last ) / 1000 );
			c.last = now;
			// Without the model the AI is still understanding the visitors.
			c.t = ! c.ready && next >= HOLD ? Math.max( c.t, HOLD ) : next;
			setT( c.t );
			progress.current?.( c.t / END );
			if ( c.t >= END ) {
				clearInterval( timer );
				done.current();
			}
		}, TICK_MS );
		return () => clearInterval( timer );
	}, [] );
	// Without motion: straight to the result once it is there.
	useEffect( () => {
		if ( ready && reducedMotion() ) {
			done.current();
		}
	}, [ ready ] );

	const order = useMemo( () => stepOrder( doc ), [ doc ] );
	const columns = useMemo<Column[]>( () => {
		const byId = new Map( ( result?.steps ?? [] ).map( ( s ) => [ s.id, s ] ) );
		const visitors = result?.visitors ?? 0;
		return order.map( ( n ) => {
			const s = byId.get( n.id );
			return { id: n.id, name: stepName( doc, n ), reach: s && visitors > 0 ? ( 10000 * s.reached ) / visitors : 10000, drop: s?.dropRate ?? 0 };
		} );
	}, [ order, result, doc ] );
	const dots = useMemo( () => ( ready ? particles( columns, model ) : [] ), [ ready, columns, model ] );
	const lines = useMemo( () => ticks( doc, parameters, result, model, columns ), [ doc, parameters, result, model, columns ] );
	const chips = useMemo( () => countChips( doc ), [ doc ] );

	const nS = Math.max( 1, columns.length );
	const long = columns.length >= LONG_FORM;
	const crowded = columns.length >= CROWDED;
	const leadsShare = result ? result.conversion : 0;
	// Of 10,000: who reaches each column, and the leads after the last.
	const R = [ ...columns.map( ( c ) => c.reach ), 10000 * leadsShare ];
	const gap = nS > 1 ? 73.2 / ( nS - 1 ) : 0;
	const tp = Math.min( 1.8, gap * 0.4 );
	const colX = columns.map( ( _, k ) => 7 + k * gap );
	const cy = 215;
	const half = ( r: number ): number => 22 + ( 128 * Math.max( 0, r ) ) / 10000;
	const widthAt = ( x: number ): number => {
		if ( x <= ( colX[ 0 ] ?? 0 ) ) {
			return half( R[ 0 ] ?? 10000 );
		}
		for ( let k = 0; k < nS; k++ ) {
			const a = colX[ k ] ?? 0;
			const nx = k < nS - 1 ? colX[ k + 1 ] ?? 89 : 89;
			if ( x <= nx ) {
				const f = tp > 0 ? clamp( ( x - a ) / tp ) : 1;
				return half( R[ k ] ?? 0 ) + ( half( R[ k + 1 ] ?? 0 ) - half( R[ k ] ?? 0 ) ) * f;
			}
		}
		return half( R[ nS ] ?? 0 );
	};
	const top: Array<[ number, number ]> = [ [ 0, cy - half( R[ 0 ] ?? 10000 ) ] ];
	const bottom: Array<[ number, number ]> = [ [ 0, cy + half( R[ 0 ] ?? 10000 ) ] ];
	colX.forEach( ( x, k ) => {
		top.push( [ x, cy - half( R[ k ] ?? 0 ) ], [ x + tp, cy - half( R[ k + 1 ] ?? 0 ) ] );
		bottom.push( [ x, cy + half( R[ k ] ?? 0 ) ], [ x + tp, cy + half( R[ k + 1 ] ?? 0 ) ] );
	} );
	top.push( [ 89, cy - half( R[ nS ] ?? 0 ) ] );
	bottom.push( [ 89, cy + half( R[ nS ] ?? 0 ) ] );
	const funnel = ready
		? top
				.concat( bottom.reverse() )
				.map( ( p ) => `${ p[ 0 ].toFixed( 2 ) },${ p[ 1 ].toFixed( 1 ) }` )
				.join( ' ' )
		: `0,${ cy - 150 } 89,${ cy - 150 } 89,${ cy + 150 } 0,${ cy + 150 }`;

	// The visitors that are on the way at this second.
	const flash = columns.map( () => 0 );
	let basinHits = 0;
	const shown: Array<{ x: number; y: number; s: number; c: string; o: number }> = [];
	for ( const p of dots ) {
		if ( t < p.spawn ) {
			continue;
		}
		const x = ( ( t - p.spawn ) / p.speed ) * 89;
		const color = PERSONA_COLORS[ p.persona % PERSONA_COLORS.length ] as string;
		if ( p.exit < nS ) {
			const xe = colX[ p.exit ] ?? 0;
			if ( x < xe ) {
				shown.push( { x, y: cy + p.lane * widthAt( x ) * 0.8, s: p.size, c: color, o: 0.95 } );
				continue;
			}
			const dt = t - ( p.spawn + ( xe / 89 ) * p.speed );
			if ( dt < 0.3 ) {
				flash[ p.exit ] = ( flash[ p.exit ] ?? 0 ) + 1;
			}
			if ( dt > 0.9 ) {
				continue;
			}
			const y0 = cy + p.lane * widthAt( xe ) * 0.8;
			shown.push( { x: xe + dt * 1.1, y: Math.min( 400, y0 + dt * dt * 520 + dt * 40 ), s: p.size, c: DROP, o: 1 - dt / 0.9 } );
		} else {
			if ( x < 89 ) {
				shown.push( { x, y: cy + p.lane * widthAt( x ) * 0.8, s: p.size, c: color, o: 0.95 } );
				continue;
			}
			const dt = t - ( p.spawn + p.speed );
			if ( dt < 0.3 ) {
				basinHits++;
			}
			if ( dt > 0.6 ) {
				continue;
			}
			shown.push( { x: 89 + dt * 8, y: cy + p.lane * half( R[ nS ] ?? 0 ) * 0.8 * ( 1 - dt ), s: p.size + 2, c: GOOD, o: 1 - dt / 0.6 } );
		}
	}
	const arrive = ( x: number ): number => clamp( ( t - ( STAGE[ 2 ] + 0.2 + ( x / 89 ) * 2.95 ) ) / 5.0 );
	let dropped = 0;
	let hot = 0;
	const cols = columns.map( ( c, k ) => {
		const x = colX[ k ] ?? 0;
		const lit = t < STAGE[ 1 ] ? ( t / STAGE[ 1 ] ) * 100 > x : true;
		const left = ready ? Math.round( ( R[ k ] ?? 0 ) * c.drop * arrive( x + 1 ) ) : 0;
		dropped += left;
		const pile = left > 0 ? 4 + 40 * Math.sqrt( left / 4000 ) : 0;
		const named = ! long || c.drop >= HOT;
		const lift = long && named ? ( hot++ % 2 ) * 16 : 0;
		return { c, k, x, lit, left, pile, named, lift, flash: Math.min( 1, ( flash[ k ] ?? 0 ) * 0.35 ) };
	} );
	// The question the band shows in the middle: under the scan while the AI reads the form, then
	// one after the other while the visitors pass; none while the AI meets the visitors or rates.
	const focus =
		t < STAGE[ 1 ]
			? Math.max( 0, colX.filter( ( x ) => x <= ( t / STAGE[ 1 ] ) * 100 ).length - 1 )
			: t >= STAGE[ 2 ] + 0.2 && t < STAGE[ 3 ]
			? Math.min( nS - 1, Math.floor( clamp( ( t - STAGE[ 2 ] - 0.2 ) / ( STAGE[ 3 ] - STAGE[ 2 ] - 0.8 ) ) * nS ) )
			: -1;
	const leadFr = arrive( 89 );
	const visitorsLive = Math.round( 10000 * clamp( ( t - STAGE[ 2 ] - 0.2 ) / 5.0 ) );
	const leadsLive = Math.round( ( R[ nS ] ?? 0 ) * leadFr );
	const wobble = leadFr > 0 ? ( 1 - leadFr ) * 3.4 * Math.sin( t * 2.3 ) : 0;
	const phaseNames = [ __( 'Read the form', 'funnelforms-pro' ), __( 'Understand the visitors', 'funnelforms-pro' ), __( 'Simulate visitors', 'funnelforms-pro' ), __( 'Work out the suggestions', 'funnelforms-pro' ) ];
	const personas = model?.personas ?? [];
	const livePersonas = ready ? personas.filter( ( _, i ) => t > 5.0 + i * 0.25 ) : [];
	const score = result ? funnelScore( result ) : 0;
	const countScore = Math.round( score * clamp( ( t - 14.4 ) / 3.0 ) );
	const recs = result ? worthApplying( result.suggestions ) : [];
	const scanning = t < STAGE[ 1 ];
	const meeting = t >= STAGE[ 1 ] && t < STAGE[ 2 ];
	const rating = t >= STAGE[ 3 ];
	const ticker = lines
		.filter( ( l ) => t >= l.at )
		.reverse()
		.slice( 0, 6 );
	const pct = Math.round( ( 100 * t ) / END );

	return (
		<section className="ffxb-pai-sim" aria-label={ __( 'Simulation running', 'funnelforms-pro' ) }>
			<div className="ffxb-pai-sim__head">
				<ol className="ffxb-pai-phases" aria-label={ __( 'Phases', 'funnelforms-pro' ) }>
					{ phaseNames.map( ( name, i ) => {
						const isDone = t >= ( STAGE[ i + 1 ] ?? END );
						const active = ! isDone && t >= ( STAGE[ i ] ?? 0 );
						return (
							<li key={ name } className={ 'ffxb-pai-phase' + ( isDone ? ' is-done' : '' ) + ( active ? ' is-active' : '' ) } aria-current={ active ? 'step' : undefined }>
								<span className="ffxb-pai-phase__dot">{ isDone ? <Check /> : i + 1 }</span>
								{ name }
							</li>
						);
					} ) }
				</ol>
				<div className="ffxb-pai-sim__actions">
					<span className="ffxb-pai-sim__pct">{ `${ pct }\u00a0%` }</span>
					<button type="button" className="ffxb-pai-btn ffxb-pai-btn--ondark" disabled={ ! ready } onClick={ () => done.current() }>
						{ __( 'Skip to the result', 'funnelforms-pro' ) }
					</button>
				</div>
			</div>
			<span className="ffxb-pai-sim__bar" aria-hidden="true">
				<span style={ { width: `${ pct }%` } } />
			</span>

			<div className="ffxb-pai-sim__body">
				<div className="ffxb-pai-sim__main">
					<div className={ 'ffxb-pai-stage' + ( long ? ' is-long' : '' ) } aria-hidden="true">
						<svg width="100%" height="410" viewBox="0 0 100 410" preserveAspectRatio="none" className="ffxb-pai-stage__funnel">
							<defs>
								<linearGradient id="ffxb-pai-funnel" x1="0" x2="1" y1="0" y2="0">
									<stop offset="0" stopColor="#6a30f5" stopOpacity=".30" />
									<stop offset="1" stopColor="#9c42fd" stopOpacity=".16" />
								</linearGradient>
							</defs>
							<polygon points={ funnel } fill="url(#ffxb-pai-funnel)" opacity={ t < STAGE[ 1 ] ? t / STAGE[ 1 ] : 1 } />
						</svg>
						{ cols.map( ( col ) => (
							<React.Fragment key={ col.c.id }>
								<div className={ 'ffxb-pai-col__line' + ( crowded && col.k === focus ? ' is-focus' : '' ) } style={ { left: `${ col.x }%`, opacity: col.lit ? 1 : 0.15 } } />
								<div className="ffxb-pai-col__flash" style={ { left: `${ col.x }%`, opacity: col.flash } } />
								<div className={ 'ffxb-pai-col__head' + ( crowded && col.k === focus ? ' is-focus' : '' ) } style={ { left: `${ col.x }%`, opacity: col.lit ? 1 : 0.15, width: crowded ? `${ Math.max( 3, gap * 0.95 ) }%` : undefined } } title={ col.c.name }>
									<div className="ffxb-pai-col__name">{ crowded ? col.k + 1 : col.c.name }</div>
									<div className="ffxb-pai-col__reach">{ ! crowded && ready && t >= STAGE[ 2 ] ? number( Math.round( col.c.reach * arrive( col.x ) ) ) : '' }</div>
								</div>
								<div className="ffxb-pai-col__pile" style={ { left: `${ col.x }%`, width: crowded ? `${ ( gap * 0.75 ).toFixed( 2 ) }%` : '46px', height: `${ col.pile.toFixed( 0 ) }px`, opacity: col.left > 0 ? 1 : 0 } } />
								<div className="ffxb-pai-col__drop" style={ { left: `${ col.x }%`, bottom: `${ ( col.pile + 4 + col.lift ).toFixed( 0 ) }px`, opacity: col.left > 0 && col.named ? 1 : 0 } }>
									{ `−${ number( col.left ) }` }
								</div>
							</React.Fragment>
						) ) }
						<div className="ffxb-pai-basin" style={ { boxShadow: `0 0 ${ Math.min( 30, basinHits * 10 ) }px rgba(61,219,176,.55)` } }>
							<div className="ffxb-pai-basin__fill" style={ { height: `${ ( 88 * leadFr ).toFixed( 0 ) }%` } } />
							<div className="ffxb-pai-basin__text">
								<span>{ __( 'Leads', 'funnelforms-pro' ) }</span>
								<strong>{ number( leadsLive ) }</strong>
							</div>
						</div>
						{ shown.map( ( d, i ) => (
							<span key={ i } className="ffxb-pai-dot" style={ { left: `${ d.x.toFixed( 2 ) }%`, top: `${ d.y.toFixed( 0 ) }px`, width: d.s, height: d.s, background: d.c, opacity: d.o, boxShadow: `0 0 8px ${ d.c }` } } />
						) ) }
						{ scanning ? (
							<>
								<div className="ffxb-pai-scan" style={ { left: `${ ( ( t / STAGE[ 1 ] ) * 100 ).toFixed( 1 ) }%` } } />
								<div className="ffxb-pai-stage__note ffxb-pai-in">
									<span>{ __( 'The AI reads your form', 'funnelforms-pro' ) }</span>
									<span className="ffxb-pai-chips">
										{ chips
											.filter( ( _, i ) => t > 0.4 + i * 0.5 )
											.map( ( chip ) => (
												<span key={ chip } className="ffxb-pai-chip--dark ffxb-pai-pop">
													{ chip }
												</span>
											) ) }
									</span>
								</div>
							</>
						) : null }
						{ meeting ? (
							<div className="ffxb-pai-stage__note is-wide">
								<span>{ __( 'The AI puts itself in your visitors’ shoes', 'funnelforms-pro' ) }</span>
								{ ready ? (
									<span className="ffxb-pai-bubbles">
										{ personas.map( ( p, i ) => (
											<span key={ p.id } className="ffxb-pai-bubble ffxb-pai-pop">
												<span className="ffxb-pai-bubble__ball" style={ { width: 64 + 56 * p.share, height: 64 + 56 * p.share, background: `radial-gradient(circle at 35% 30%, ${ PERSONA_COLORS[ i % PERSONA_COLORS.length ] }, rgba(17,12,38,.2))`, boxShadow: `0 0 28px ${ PERSONA_COLORS[ i % PERSONA_COLORS.length ] }` } }>
													{ `${ decimal( p.share * 100, 0 ) }\u00a0%` }
												</span>
												<span className="ffxb-pai-bubble__name">{ p.name }</span>
											</span>
										) ) }
									</span>
								) : (
									<span className="ffxb-pai-wait">
										<span className="ffxb-pai-wait__dots" aria-hidden="true">
											<i />
											<i />
											<i />
										</span>
										{ __( 'This can take up to a minute.', 'funnelforms-pro' ) }
									</span>
								) }
							</div>
						) : null }
						{ rating && result ? (
							<div className="ffxb-pai-rating">
								<div className="ffxb-pai-rating__card ffxb-pai-in">
									<ScoreRing score={ countScore } size={ 112 } label={ __( 'Funnel score', 'funnelforms-pro' ) } />
									<div className="ffxb-pai-rating__rows">
										<span className="ffxb-pai-eyebrow">{ __( 'Every suggestion is worked out again', 'funnelforms-pro' ) }</span>
										{ recs
											.filter( ( _, i ) => t > 14.4 + i * 0.55 )
											.slice( 0, 6 )
											.map( ( r, i ) => (
												<div key={ r.id } className="ffxb-pai-rating__row ffxb-pai-in">
													<span>{ r.title }</span>
													{ t > 14.4 + i * 0.55 + 0.45 ? (
														isBetter( r ) ? (
															<strong className="is-better">{ sprintf( __( '+%s qualified', 'funnelforms-pro' ), `${ decimal( ( r.quality ?? 0 ) * 100, 0 ) }\u00a0%` ) }</strong>
														) : (
															<strong>{ sprintf( __( '+%s points', 'funnelforms-pro' ), pointsOf( r.gain ) ) }</strong>
														)
													) : (
														<span className="ffxb-pai-shine" />
													) }
												</div>
											) ) }
										{ ! recs.length ? <span className="ffxb-pai-rating__row">{ __( 'The AI has no suggestion for this form.', 'funnelforms-pro' ) }</span> : null }
									</div>
								</div>
							</div>
						) : null }
					</div>
					{ crowded ? <QuestionBand items={ cols.map( ( col ) => ( { id: col.c.id, name: col.c.name, kind: order[ col.k ] ? stepKind( order[ col.k ] as FormNode ) : '', left: col.left, hot: col.c.drop >= HOT } ) ) } focus={ focus } /> : null }
					<div className="ffxb-pai-legend">
						{ personas.map( ( p, i ) => (
							<span key={ p.id }>
								<i style={ { background: PERSONA_COLORS[ i % PERSONA_COLORS.length ] } } />
								{ p.name }
							</span>
						) ) }
						<span>
							<i style={ { background: DROP } } />
							{ __( 'leaves', 'funnelforms-pro' ) }
						</span>
						<span>
							<i style={ { background: GOOD } } />
							{ __( 'becomes a lead', 'funnelforms-pro' ) }
						</span>
						<span>{ __( 'Width of the funnel: how many are still there', 'funnelforms-pro' ) }</span>
					</div>
					<div className="ffxb-pai-live" role="status">
						<div>
							<span>{ __( 'Visitors simulated', 'funnelforms-pro' ) }</span>
							<strong>{ number( visitorsLive ) }</strong>
						</div>
						<div>
							<span>{ __( 'Leads', 'funnelforms-pro' ) }</span>
							<strong className="is-good">{ number( leadsLive ) }</strong>
						</div>
						<div>
							<span>{ __( 'Conversion rate', 'funnelforms-pro' ) }</span>
							<strong>{ leadFr > 0 ? `${ decimal( leadsShare * 100 + wobble, 1 ) }\u00a0%` : '–' }</strong>
							<span>{ leadFr > 0 ? sprintf( __( '± %s points, getting more precise', 'funnelforms-pro' ), decimal( 1.6 + ( 1 - leadFr ) * 4, 1 ) ) : __( 'no leads yet', 'funnelforms-pro' ) }</span>
						</div>
						<div>
							<span>{ __( 'Dropped out', 'funnelforms-pro' ) }</span>
							<strong className="is-drop">{ number( dropped ) }</strong>
						</div>
					</div>
				</div>

				<div className="ffxb-pai-sim__side">
					<div className="ffxb-pai-panel">
						<div className="ffxb-pai-eyebrow">{ __( 'Your visitors', 'funnelforms-pro' ) }</div>
						{ ! livePersonas.length ? <p className="ffxb-pai-muted">{ __( 'The AI is about to build kinds of visitors from your description.', 'funnelforms-pro' ) }</p> : null }
						<div className="ffxb-pai-personas">
							{ livePersonas.map( ( p, i ) => (
								<div key={ p.id } className="ffxb-pai-persona ffxb-pai-in">
									<i style={ { background: PERSONA_COLORS[ i % PERSONA_COLORS.length ], boxShadow: `0 0 8px ${ PERSONA_COLORS[ i % PERSONA_COLORS.length ] }` } } />
									<div>
										<div className="ffxb-pai-persona__head">
											<span>{ p.name }</span>
											<span>{ `${ decimal( p.share * 100, 0 ) }\u00a0%` }</span>
										</div>
										<div className="ffxb-pai-persona__text">{ p.description }</div>
									</div>
								</div>
							) ) }
						</div>
					</div>
					<div className="ffxb-pai-panel ffxb-pai-glow">
						<div className="ffxb-pai-eyebrow">{ __( 'What the AI sees right now', 'funnelforms-pro' ) }</div>
						<ul className="ffxb-pai-ticker" aria-live="polite">
							{ ticker.map( ( l, i ) => (
								<li key={ l.at } className={ 'ffxb-pai-in' + ( l.tone ? ` is-${ l.tone }` : '' ) + ( 0 === i ? ' is-new' : '' ) }>
									<span>{ `0:${ String( Math.floor( l.at * 3.2 ) ).padStart( 2, '0' ) }` }</span>
									<span>{ l.text }</span>
								</li>
							) ) }
						</ul>
					</div>
					<p className="ffxb-pai-muted is-small">{ __( 'You can leave the tab and keep working. A dot on the tab shows that the simulation is running.', 'funnelforms-pro' ) }</p>
				</div>
			</div>
		</section>
	);
}

interface BandItem {
	id: string;
	name: string;
	/** What the step asks, in a few words (stepKind()). */
	kind: string;
	/** Visitors who left there so far. */
	left: number;
	/** Many leave there. */
	hot: boolean;
}

/**
 * The questions of a form with many steps as a band below the stage, readable one by one: the one
 * the visitors are at now stands in the middle and the band glides on with them. While the pointer
 * is on the band it stays put, so a question can be read and the band scrolled by hand.
 */
function QuestionBand( { items, focus }: { items: BandItem[]; focus: number } ) {
	const strip = useRef<HTMLOListElement | null>( null );
	const held = useRef( false );
	useEffect( () => {
		const el = strip.current;
		const chip = el?.children[ focus ] as HTMLElement | undefined;
		if ( ! el || ! chip || held.current || typeof el.scrollTo !== 'function' ) {
			return;
		}
		el.scrollTo( { left: chip.offsetLeft - ( el.clientWidth - chip.offsetWidth ) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' } );
	}, [ focus ] );
	return (
		<ol
			ref={ strip }
			className="ffxb-pai-band"
			aria-label={ __( 'Questions of the form', 'funnelforms-pro' ) }
			onPointerEnter={ () => {
				held.current = true;
			} }
			onPointerLeave={ () => {
				held.current = false;
			} }
		>
			{ items.map( ( item, k ) => (
				<li key={ item.id } className={ 'ffxb-pai-band__item' + ( k === focus ? ' is-focus' : k < focus ? ' is-past' : '' ) + ( item.hot && item.left > 0 ? ' is-hot' : '' ) } aria-current={ k === focus ? 'step' : undefined }>
					<span className="ffxb-pai-band__num">{ k + 1 }</span>
					<span className="ffxb-pai-band__text">
						<strong title={ item.name }>{ item.name }</strong>
						{ item.kind ? <span>{ item.kind }</span> : null }
					</span>
					{ item.left > 0 ? <span className="ffxb-pai-band__drop">{ `−${ number( item.left ) }` }</span> : null }
				</li>
			) ) }
		</ol>
	);
}

export function Check() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M5 12l5 5 9-10" />
		</svg>
	);
}

/** The funnel score as a ring with its number. */
export function ScoreRing( { score, size, label, color = '#a98bff' }: { score: number; size: number; label: string; color?: string } ) {
	return (
		<div className="ffxb-pai-ring" style={ { width: size, height: size } }>
			<svg width={ size } height={ size } viewBox="0 0 100 100" aria-hidden="true">
				<circle cx="50" cy="50" r="42" fill="none" stroke="#2e2656" strokeWidth="8" />
				<circle cx="50" cy="50" r="42" fill="none" stroke={ color } strokeWidth="8" strokeLinecap="round" strokeDasharray={ `${ ( ( score / 100 ) * RING ).toFixed( 1 ) } ${ RING }` } transform="rotate(-90 50 50)" />
			</svg>
			<div className="ffxb-pai-ring__text">
				<span className="ffxb-pai-ring__score">{ score }</span>
				<span className="ffxb-pai-ring__label">{ label }</span>
			</div>
		</div>
	);
}
