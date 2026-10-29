/**
 * The visitors of a prediction played on the canvas (Predictive AI, Funnelforms Pro): one dot per
 * traced virtual visitor (predict.ts, simulation.traces) runs along the paths of the form as the
 * simulation sent it. A dot that leaves falls from the bottom of its step and fades, a lead turns
 * green; steps flash where visitors leave or become leads, and their figures count up meanwhile.
 * Nothing moves for those who asked for less motion: there is no playback then.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ViewportPortal } from '@xyflow/react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { VisitorTrace } from '../predict';
import { __, sprintf } from './i18n';
import { number } from './Prediction';
import { reducedMotion } from './PredictionScreen';

type Point = [ number, number ];

/** Where a node is on the canvas: its box, and where paths come in (left) and go out (right). */
export interface PlaybackBox {
	x: number;
	y: number;
	width: number;
	height: number;
	in: Point;
	out: Point;
}

/** A path drawn between two nodes, as points along it. */
export type WayPoints = ( from: PlaybackBox, to: PlaybackBox ) => Point[];

/** A stretch of a path a dot runs along, visible. */
interface Leg {
	start: number;
	end: number;
	points: Point[];
	/** Length from the first point to each point. */
	along: number[];
	lead: boolean;
}

interface Particle {
	spawn: number;
	/** -1 to 1: the dot's lane beside the path. */
	lane: number;
	size: number;
	color: string;
	legs: Leg[];
	/** How the dot ends: leaves on the node, becomes a lead there, or just stops (an end without the goal). */
	finish: { node: string; at: number; kind: 'left' | 'lead' | 'out' } | null;
	/** Where a dot that leaves starts to fall. */
	fall: Point | null;
}

export interface PlaybackPlan {
	particles: Particle[];
	/** Seconds until the last dot is gone. */
	end: number;
	/** Per node, when the dots reach it and when those leaving there leave, sorted. */
	reached: Map<string, number[]>;
	left: Map<string, number[]>;
	/** The nodes on the canvas (those the dots pass, and nodes): a path that runs under one of them (back to an earlier row) hides its dots there. */
	boxes: PlaybackBox[];
}

export interface PlaybackFrame {
	dots: Array<{ x: number; y: number; size: number; color: string; opacity: number }>;
	/** Nodes that flash now: where visitors leave (orange) or become leads (green), 0 to 1. */
	rings: Array<{ node: string; kind: 'left' | 'lead'; strength: number }>;
}

/** A new dot this often, seconds. */
const SPAWN_GAP = 0.055;
const SPAWN_JITTER = 0.03;
/** The longest way takes this long, seconds; slower than MIN_SPEED (px per second) never. */
const RUN = 5;
const MIN_SPEED = 120;
/** Seconds a dot that leaves takes to fall and fade, and a node flashes. */
const FALL = 1;
const FLASH = 0.35;
/** How far the dots run in before the first node, and how far apart their lanes are, px. */
const LEAD_IN = 60;
const LANE = 8;

/** Dots by the persona of the visitor; a lead is green, who leaves orange (the legend of the canvas). */
export const PERSONA_COLORS = [ '#a98bff', '#6cb6ff', '#ff8fc8' ];
export const LEAD_COLOR = '#3ddbb0';
export const LEFT_COLOR = '#ffb547';

/** The same numbers on every play, so the dots of a prediction look the same each time. */
function seeded( seed: number ): () => number {
	let a = seed >>> 0;
	return () => {
		a = ( a + 0x6d2b79f5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}

function lengths( points: Point[] ): number[] {
	const along = [ 0 ];
	for ( let i = 1; i < points.length; i++ ) {
		const [ ax = 0, ay = 0 ] = points[ i - 1 ] ?? [];
		const [ bx = 0, by = 0 ] = points[ i ] ?? [];
		along.push( ( along[ i - 1 ] ?? 0 ) + Math.hypot( bx - ax, by - ay ) );
	}
	return along;
}

/**
 * When and where each traced visitor runs: in from the left of the first node, through each node
 * (hidden, as long as the node is wide) and along the path to the next. The longest way takes RUN
 * seconds; a node that is not measured (not shown yet) ends the way.
 */
export function planPlayback( traces: VisitorTrace[], boxOf: ( id: string ) => PlaybackBox | null, wayPoints: WayPoints, personas: string[] = [], nodes: string[] = [] ): PlaybackPlan {
	const random = seeded( 11 );
	type Step = { node: string; box: PlaybackBox; way: { points: Point[]; along: number[] } | null };
	const ways = traces.map( ( trace ) => {
		const steps: Step[] = [];
		for ( const id of trace.nodes ) {
			const box = boxOf( id );
			if ( ! box ) {
				break;
			}
			const last = steps[ steps.length - 1 ];
			if ( last ) {
				const points = wayPoints( last.box, box );
				last.way = { points, along: lengths( points ) };
			}
			steps.push( { node: id, box, way: null } );
		}
		// Up to where the dot ends: on entering its last node, or halfway through it when it leaves there.
		const last = steps[ steps.length - 1 ];
		const leaves = trace.left && steps.length === trace.nodes.length;
		const length = steps.reduce( ( sum, s ) => sum + ( s === last ? 0 : s.box.width ) + ( s.way?.along[ s.way.along.length - 1 ] ?? 0 ), LEAD_IN ) + ( leaves && last ? last.box.width / 2 : 0 );
		return { trace, steps, length };
	} );
	const speed = Math.max( MIN_SPEED, Math.max( 0, ...ways.map( ( w ) => w.length ) ) / RUN );
	const reached = new Map<string, number[]>();
	const left = new Map<string, number[]>();
	const boxes = new Map( ways.flatMap( ( w ) => w.steps.map( ( s ): [ string, PlaybackBox ] => [ s.node, s.box ] ) ) );
	for ( const id of nodes ) {
		const box = boxes.has( id ) ? null : boxOf( id );
		if ( box ) {
			boxes.set( id, box );
		}
	}
	const push = ( map: Map<string, number[]>, id: string, at: number ): void => {
		const list = map.get( id ) ?? [];
		list.push( at );
		map.set( id, list );
	};
	let end = 0;
	const particles = ways.map( ( { trace, steps }, i ): Particle => {
		const spawn = i * SPAWN_GAP + random() * SPAWN_JITTER;
		const lane = random() * 2 - 1;
		const size = 6 + Math.round( random() * 2 );
		const index = Math.max( 0, personas.indexOf( trace.persona ) );
		const particle: Particle = { spawn, lane, size, color: PERSONA_COLORS[ index % PERSONA_COLORS.length ] ?? LEAD_COLOR, legs: [], finish: null, fall: null };
		const isLead = ( at: number ): boolean => trace.lead >= 0 && trace.lead <= at;
		const first = steps[ 0 ];
		if ( ! first ) {
			return particle;
		}
		let t = spawn;
		const run = ( points: Point[], along: number[], lead: boolean ): void => {
			const time = ( along[ along.length - 1 ] ?? 0 ) / speed;
			particle.legs.push( { start: t, end: t + time, points, along, lead } );
			t += time;
		};
		const inPoints: Point[] = [ [ first.box.in[ 0 ] - LEAD_IN, first.box.in[ 1 ] ], first.box.in ];
		run( inPoints, lengths( inPoints ), isLead( 0 ) );
		steps.forEach( ( step, k ) => {
			push( reached, step.node, t );
			if ( k === steps.length - 1 ) {
				if ( trace.left && k === trace.nodes.length - 1 ) {
					// Leaves halfway through the node, from its bottom.
					t += step.box.width / 2 / speed;
					particle.finish = { node: step.node, at: t, kind: 'left' };
					particle.fall = [ step.box.x + step.box.width / 2 + lane * Math.min( 40, step.box.width / 2 - 10 ), step.box.y + step.box.height ];
					push( left, step.node, t );
				} else {
					particle.finish = { node: step.node, at: t, kind: trace.lead >= 0 && k === trace.nodes.length - 1 ? 'lead' : 'out' };
				}
				return;
			}
			t += step.box.width / speed;
			if ( step.way ) {
				run( step.way.points, step.way.along, isLead( k + 1 ) );
			}
		} );
		end = Math.max( end, ( particle.finish?.at ?? t ) + ( 'left' === particle.finish?.kind ? FALL : FLASH ) );
		return particle;
	} );
	for ( const list of [ ...reached.values(), ...left.values() ] ) {
		list.sort( ( a, b ) => a - b );
	}
	return { particles, end, reached, left, boxes: [ ...boxes.values() ] };
}

/** Where a dot is on a leg at time t, in its lane beside the path. */
function positionOn( leg: Leg, t: number, lane: number ): Point {
	const total = leg.along[ leg.along.length - 1 ] ?? 0;
	const at = leg.end > leg.start ? ( ( t - leg.start ) / ( leg.end - leg.start ) ) * total : 0;
	let i = 1;
	while ( i < leg.along.length - 1 && ( leg.along[ i ] ?? 0 ) < at ) {
		i++;
	}
	const [ ax = 0, ay = 0 ] = leg.points[ i - 1 ] ?? [];
	const [ bx = 0, by = 0 ] = leg.points[ i ] ?? [];
	const from = leg.along[ i - 1 ] ?? 0;
	const span = ( leg.along[ i ] ?? 0 ) - from;
	const f = span > 0 ? Math.max( 0, Math.min( 1, ( at - from ) / span ) ) : 0;
	const length = Math.hypot( bx - ax, by - ay ) || 1;
	// Beside the path, at a right angle to it.
	return [ ax + ( bx - ax ) * f - ( ( by - ay ) / length ) * lane * LANE, ay + ( by - ay ) * f + ( ( bx - ax ) / length ) * lane * LANE ];
}

/** The dots and flashing nodes at time t (seconds since the start). */
export function framePlayback( plan: PlaybackPlan, t: number ): PlaybackFrame {
	const dots: PlaybackFrame[ 'dots' ] = [];
	const flashes = new Map<string, { left: number; lead: number }>();
	for ( const p of plan.particles ) {
		if ( t < p.spawn ) {
			continue;
		}
		const f = p.finish;
		if ( f && t >= f.at ) {
			const dt = t - f.at;
			if ( 'out' !== f.kind && dt < FLASH ) {
				const flash = flashes.get( f.node ) ?? { left: 0, lead: 0 };
				flash[ f.kind ]++;
				flashes.set( f.node, flash );
			}
			if ( 'left' === f.kind && p.fall && dt < FALL ) {
				dots.push( { x: p.fall[ 0 ], y: p.fall[ 1 ] + 6 + dt * 50 + dt * dt * 90, size: p.size, color: LEFT_COLOR, opacity: 1 - dt } );
			}
			continue;
		}
		const leg = p.legs.find( ( l ) => t >= l.start && t < l.end );
		if ( leg ) {
			const [ x, y ] = positionOn( leg, t, p.lane );
			if ( plan.boxes.some( ( b ) => x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height ) ) {
				continue;
			}
			dots.push( { x, y, size: p.size, color: leg.lead ? LEAD_COLOR : p.color, opacity: 0.95 } );
		}
	}
	const rings = [ ...flashes ].map( ( [ node, { left, lead } ] ) => ( lead >= left ? { node, kind: 'lead' as const, strength: Math.min( 1, lead * 0.3 ) } : { node, kind: 'left' as const, strength: Math.min( 1, left * 0.4 ) } ) );
	return { dots, rings };
}

/** How many of the sorted times have come by t. */
function countUntil( times: number[] | undefined, t: number ): number {
	if ( ! times ) {
		return 0;
	}
	let low = 0;
	let high = times.length;
	while ( low < high ) {
		const mid = ( low + high ) >> 1;
		if ( ( times[ mid ] ?? 0 ) <= t ) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

/** Of the dots that reach a node (and leave there), the share that did by t; 1 for a node no dot reaches. */
export function playedShare( plan: PlaybackPlan, node: string, t: number ): { reached: number; left: number } {
	const reached = plan.reached.get( node );
	const left = plan.left.get( node );
	return {
		reached: reached?.length ? countUntil( reached, t ) / reached.length : 1,
		left: left?.length ? countUntil( left, t ) / left.length : 1,
	};
}

interface PlaybackState {
	plan: PlaybackPlan | null;
	/** Seconds since the start; plan.end once it ran to the end. */
	t: number;
	playing: boolean;
}

export interface Playback {
	store: StoreApi<PlaybackState>;
	start: ( plan: PlaybackPlan ) => void;
	stop: () => void;
	/** Stops and forgets the plan (the prediction mode was turned off). */
	reset: () => void;
}

export function createPlayback(): Playback {
	const store = createStore<PlaybackState>()( () => ( { plan: null, t: 0, playing: false } ) );
	let frame = 0;
	const cancel = (): void => {
		if ( frame ) {
			window.cancelAnimationFrame( frame );
			frame = 0;
		}
	};
	const stop = (): void => {
		cancel();
		if ( store.getState().playing ) {
			store.setState( { playing: false } );
		}
	};
	return {
		store,
		start: ( plan ) => {
			cancel();
			store.setState( { plan, t: 0, playing: true } );
			let begin: number | null = null;
			const tick = ( now: number ): void => {
				begin = begin ?? now;
				const t = ( now - begin ) / 1000;
				if ( t >= plan.end ) {
					frame = 0;
					store.setState( { t: plan.end, playing: false } );
					return;
				}
				store.setState( { t } );
				frame = window.requestAnimationFrame( tick );
			};
			frame = window.requestAnimationFrame( tick );
		},
		stop,
		reset: () => {
			cancel();
			store.setState( { plan: null, t: 0, playing: false } );
		},
	};
}

export const PlaybackContext = createContext<Playback | null>( null );

const idle = createStore<PlaybackState>()( () => ( { plan: null, t: 0, playing: false } ) );

/** The counters count up in this many steps while the dots run, not on every frame. */
const COUNT_STEPS = 40;

/**
 * Of a node's figures, the share the dots have played so far while they run; null otherwise (the
 * whole figures). In steps of 1/COUNT_STEPS, so the node draws again only when its counter moves.
 */
export function usePlayedShare( node: string ): { reached: number; left: number } | null {
	const store = useContext( PlaybackContext )?.store ?? idle;
	const reached = useStore( store, ( s ) => ( s.playing && s.plan ? Math.floor( playedShare( s.plan, node, s.t ).reached * COUNT_STEPS ) : -1 ) );
	const left = useStore( store, ( s ) => ( s.playing && s.plan ? Math.floor( playedShare( s.plan, node, s.t ).left * COUNT_STEPS ) : -1 ) );
	return reached < 0 ? null : { reached: reached / COUNT_STEPS, left: left / COUNT_STEPS };
}

/** Whether the dots run now. */
export function usePlaying(): boolean {
	return useStore( useContext( PlaybackContext )?.store ?? idle, ( s ) => s.playing );
}

/** The dots and flashing nodes, in the coordinates of the canvas (they move and zoom with it). */
export function PlaybackLayer( { boxOf }: { boxOf: ( id: string ) => PlaybackBox | null } ) {
	const store = useContext( PlaybackContext )?.store ?? idle;
	const plan = useStore( store, ( s ) => ( s.playing ? s.plan : null ) );
	const t = useStore( store, ( s ) => s.t );
	if ( ! plan ) {
		return null;
	}
	const { dots, rings } = framePlayback( plan, t );
	return (
		<ViewportPortal>
			<svg className="ffxb-pai-flow" aria-hidden="true" width="1" height="1">
				{ rings.map( ( r ) => {
					const box = boxOf( r.node );
					return box ? (
						<rect
							key={ r.node }
							className={ `ffxb-pai-flow__ring is-${ r.kind }` }
							x={ box.x - 2 }
							y={ box.y - 2 }
							width={ box.width + 4 }
							height={ box.height + 4 }
							rx={ 12 }
							strokeWidth={ 3 + r.strength * 6 }
							opacity={ 0.3 + r.strength * 0.4 }
						/>
					) : null;
				} ) }
				{ dots.map( ( d, i ) => (
					<g key={ i } opacity={ d.opacity }>
						<circle cx={ d.x } cy={ d.y } r={ d.size * 1.1 } fill={ d.color } opacity={ 0.25 } />
						<circle cx={ d.x } cy={ d.y } r={ d.size * 0.6 } fill={ d.color } />
					</g>
				) ) }
			</svg>
		</ViewportPortal>
	);
}

function date( iso: string ): string {
	const time = Date.parse( iso );
	if ( Number.isNaN( time ) ) {
		return '';
	}
	try {
		return new Intl.DateTimeFormat( undefined, { dateStyle: 'medium' } ).format( new Date( time ) );
	} catch {
		return iso.slice( 0, 10 );
	}
}

/**
 * The control of the playback above the canvas: which prediction it plays, how far it is, and
 * the button to play or stop it. Nothing for those who asked for less motion.
 */
export function PlaybackControl( { created, visitors, traced, onPlay }: { created: string; visitors: number; traced: number; onPlay: () => void } ) {
	const playback = useContext( PlaybackContext );
	const store = playback?.store ?? idle;
	const playing = useStore( store, ( s ) => s.playing );
	const progress = useStore( store, ( s ) => ( s.plan && s.plan.end > 0 ? Math.round( ( 100 * s.t ) / s.plan.end ) : 0 ) );
	const [ still ] = useState( reducedMotion );
	// Stops when the control goes (the prediction mode turned off).
	useEffect( () => () => playback?.stop(), [ playback ] );
	if ( still || ! playback || ! traced ) {
		return null;
	}
	const each = Math.max( 1, Math.round( visitors / traced ) );
	const of = sprintf( __( 'Prediction of %1$s · %2$s virtual visitors', 'funnelforms-pro' ), date( created ), number( visitors ) );
	return (
		<div className="ffxb-pai-play" title={ sprintf( __( 'Each dot stands for about %s virtual visitors.', 'funnelforms-pro' ), number( each ) ) }>
			{ /* Cut short where the canvas is narrow: in full as its tooltip. */ }
			<span className="ffxb-pai-play__of" title={ of }>
				{ of }
			</span>
			{ playing ? (
				<span className="ffxb-pai-play__progress" aria-hidden="true">
					<span style={ { width: `${ progress }%` } } />
				</span>
			) : null }
			<button type="button" className="ffxb-button ffxb-button--primary ffxb-button--sm ffxb-pai-play__button" onClick={ () => ( playing ? playback.stop() : onPlay() ) }>
				{ playing ? (
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<rect x="6" y="5" width="4" height="14" rx="1" />
						<rect x="14" y="5" width="4" height="14" rx="1" />
					</svg>
				) : (
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M7 5l12 7-12 7z" />
					</svg>
				) }
				{ playing ? __( 'Stop', 'funnelforms-pro' ) : progress > 0 ? __( 'Play again', 'funnelforms-pro' ) : __( 'Play visitors', 'funnelforms-pro' ) }
			</button>
		</div>
	);
}
