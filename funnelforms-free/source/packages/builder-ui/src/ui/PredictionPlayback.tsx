/**
 * The visitors of a prediction played on the canvas (Predictive AI, Funnelforms Pro): one dot per
 * traced virtual visitor (predict.ts, simulation.traces) runs along the paths of the form as the
 * simulation sent it. A dot that leaves sinks from the bottom of its step and fades, a lead turns
 * green; steps flash where visitors leave or become leads, and their figures count up meanwhile.
 * The plan keeps the nodes of each way, not points: the dots are placed on the canvas as it is at
 * each frame, so they stay on their paths whatever changes on the canvas (the canvas keeps its
 * steps in place while the dots run, see Canvas.tsx). Nothing moves for those who asked for less
 * motion: there is no playback then.
 */
import React, { createContext, useContext } from 'react';
import { useStore as useFlowStore, ViewportPortal } from '@xyflow/react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { VisitorTrace } from '../predict';

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

/** Where the nodes are now: read on every frame, so the dots follow a node that moves or grows. */
export interface PlaybackGeometry {
	boxOf: ( id: string ) => PlaybackBox | null;
	wayPoints: WayPoints;
}

/**
 * A stretch of the way a dot runs along, visible: in from the left of the first node (from null),
 * or the path from one node to the next. Only the nodes are kept, not the points: where the path
 * runs is taken from the canvas as it is at each frame.
 */
interface Leg {
	start: number;
	end: number;
	from: string | null;
	to: string;
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
}

export interface PlaybackPlan {
	particles: Particle[];
	/** Seconds until the last dot is gone. */
	end: number;
	/** Per node, when the dots reach it and when those leaving there leave, sorted. */
	reached: Map<string, number[]>;
	left: Map<string, number[]>;
	/** Per node, when dots become leads there, sorted: the counter of leads. */
	leads: number[];
	/** The nodes on the canvas (those the dots pass, and nodes): a path that runs under one of them (back to an earlier row) hides its dots there. */
	nodes: string[];
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
/** Seconds a dot that leaves takes to sink and fade, and a node flashes. */
const FALL = 0.9;
const FLASH = 0.35;
/** How far the dots run in before the first node, and how far apart their lanes are, px. */
const LEAD_IN = 60;
const LANE = 7;
/** The trail behind a running dot: this many shadows, this many seconds apart. */
const TRAIL = 3;
const TRAIL_GAP = 0.035;

/** Dots by the persona of the visitor; a lead is green, who leaves orange (the legend of the canvas). */
export const PERSONA_COLORS = [ '#8b5cf6', '#3b9eff', '#f472b6' ];
export const LEAD_COLOR = '#10c08e';
export const LEFT_COLOR = '#ff9f1c';

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

function total( points: Point[] ): number {
	const along = lengths( points );
	return along[ along.length - 1 ] ?? 0;
}

/**
 * When each traced visitor runs where: in from the left of the first node, through each node
 * (hidden, as long as the node is wide) and along the path to the next. The canvas as it is at the
 * start sets the times only, so the longest way takes RUN seconds; where the dots are is read from
 * the canvas on every frame (framePlayback). A node that is not measured (not shown yet) ends the way.
 */
export function planPlayback( traces: VisitorTrace[], boxOf: ( id: string ) => PlaybackBox | null, wayPoints: WayPoints, personas: string[] = [], nodes: string[] = [] ): PlaybackPlan {
	const random = seeded( 11 );
	type Step = { node: string; box: PlaybackBox; way: number };
	const ways = traces.map( ( trace ) => {
		const steps: Step[] = [];
		for ( const id of trace.nodes ) {
			const box = boxOf( id );
			if ( ! box ) {
				break;
			}
			const last = steps[ steps.length - 1 ];
			if ( last ) {
				last.way = total( wayPoints( last.box, box ) );
			}
			steps.push( { node: id, box, way: 0 } );
		}
		// Up to where the dot ends: on entering its last node, or halfway through it when it leaves there.
		const last = steps[ steps.length - 1 ];
		const leaves = trace.left && steps.length === trace.nodes.length;
		const length = steps.reduce( ( sum, s ) => sum + ( s === last ? 0 : s.box.width ) + s.way, LEAD_IN ) + ( leaves && last ? last.box.width / 2 : 0 );
		return { trace, steps, length };
	} );
	const speed = Math.max( MIN_SPEED, Math.max( 0, ...ways.map( ( w ) => w.length ) ) / RUN );
	const reached = new Map<string, number[]>();
	const left = new Map<string, number[]>();
	const leads: number[] = [];
	const shown = new Set( ways.flatMap( ( w ) => w.steps.map( ( s ) => s.node ) ) );
	for ( const id of nodes ) {
		if ( ! shown.has( id ) && boxOf( id ) ) {
			shown.add( id );
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
		const particle: Particle = { spawn, lane, size, color: PERSONA_COLORS[ index % PERSONA_COLORS.length ] ?? LEAD_COLOR, legs: [], finish: null };
		const isLead = ( at: number ): boolean => trace.lead >= 0 && trace.lead <= at;
		const first = steps[ 0 ];
		if ( ! first ) {
			return particle;
		}
		let t = spawn;
		// When the dot turns green: the counter of leads counts it then.
		let became: number | null = null;
		const run = ( from: string | null, to: string, length: number, lead: boolean ): void => {
			const time = length / speed;
			particle.legs.push( { start: t, end: t + time, from, to, lead } );
			if ( lead && null === became ) {
				became = t;
			}
			t += time;
		};
		run( null, first.node, LEAD_IN, isLead( 0 ) );
		steps.forEach( ( step, k ) => {
			push( reached, step.node, t );
			if ( k === steps.length - 1 ) {
				if ( trace.left && k === trace.nodes.length - 1 ) {
					// Leaves halfway through the node, from its bottom.
					t += step.box.width / 2 / speed;
					particle.finish = { node: step.node, at: t, kind: 'left' };
					push( left, step.node, t );
				} else {
					const lead = trace.lead >= 0 && k === trace.nodes.length - 1;
					particle.finish = { node: step.node, at: t, kind: lead ? 'lead' : 'out' };
					if ( lead ) {
						became = became ?? t;
					}
				}
				return;
			}
			t += step.box.width / speed;
			const next = steps[ k + 1 ];
			if ( next ) {
				run( step.node, next.node, step.way, isLead( k + 1 ) );
			}
		} );
		if ( null !== became && trace.lead >= 0 ) {
			leads.push( became );
		}
		end = Math.max( end, ( particle.finish?.at ?? t ) + ( 'left' === particle.finish?.kind ? FALL : FLASH ) );
		return particle;
	} );
	for ( const list of [ ...reached.values(), ...left.values(), leads ] ) {
		list.sort( ( a, b ) => a - b );
	}
	return { particles, end, reached, left, leads, nodes: [ ...shown ] };
}

/** Where a dot is along the points at the share f (0 to 1) of their length, in its lane beside them. */
function positionAlong( points: Point[], along: number[], f: number, lane: number ): Point {
	const length = along[ along.length - 1 ] ?? 0;
	const at = Math.max( 0, Math.min( 1, f ) ) * length;
	let i = 1;
	while ( i < along.length - 1 && ( along[ i ] ?? 0 ) < at ) {
		i++;
	}
	const [ ax = 0, ay = 0 ] = points[ i - 1 ] ?? [];
	const [ bx = 0, by = 0 ] = points[ i ] ?? [];
	const from = along[ i - 1 ] ?? 0;
	const span = ( along[ i ] ?? 0 ) - from;
	const g = span > 0 ? Math.max( 0, Math.min( 1, ( at - from ) / span ) ) : 0;
	const d = Math.hypot( bx - ax, by - ay ) || 1;
	// Beside the path, at a right angle to it.
	return [ ax + ( bx - ax ) * g - ( ( by - ay ) / d ) * lane * LANE, ay + ( by - ay ) * g + ( ( bx - ax ) / d ) * lane * LANE ];
}

/**
 * The dots and flashing nodes at time t (seconds since the start), on the canvas as it is now: a
 * node moved, grown or gone since the start takes its dots with it.
 */
export function framePlayback( plan: PlaybackPlan, t: number, geometry: PlaybackGeometry ): PlaybackFrame {
	const boxes = new Map<string, PlaybackBox | null>();
	const box = ( id: string ): PlaybackBox | null => {
		if ( ! boxes.has( id ) ) {
			boxes.set( id, geometry.boxOf( id ) );
		}
		return boxes.get( id ) ?? null;
	};
	const ways = new Map<string, { points: Point[]; along: number[] } | null>();
	const way = ( from: string | null, to: string ): { points: Point[]; along: number[] } | null => {
		const key = ( from ?? '' ) + '\n' + to;
		if ( ! ways.has( key ) ) {
			const b = box( to );
			const a = null === from ? null : box( from );
			let points: Point[] | null = null;
			if ( b && null === from ) {
				points = [ [ b.in[ 0 ] - LEAD_IN, b.in[ 1 ] ], b.in ];
			} else if ( a && b ) {
				points = geometry.wayPoints( a, b );
			}
			ways.set( key, points ? { points, along: lengths( points ) } : null );
		}
		return ways.get( key ) ?? null;
	};
	const covers = plan.nodes.map( box ).filter( ( b ): b is PlaybackBox => !! b );
	const hidden = ( x: number, y: number ): boolean => covers.some( ( b ) => x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height );
	const at = ( p: Particle, time: number ): { point: Point; lead: boolean } | null => {
		const leg = p.legs.find( ( l ) => time >= l.start && time < l.end );
		const w = leg ? way( leg.from, leg.to ) : null;
		if ( ! leg || ! w ) {
			return null;
		}
		const point = positionAlong( w.points, w.along, ( time - leg.start ) / ( leg.end - leg.start ), p.lane );
		return hidden( point[ 0 ], point[ 1 ] ) ? null : { point, lead: leg.lead };
	};

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
			const b = 'left' === f.kind && dt < FALL ? box( f.node ) : null;
			if ( b ) {
				// Sinks from the bottom of its step and fades.
				const x = b.x + b.width / 2 + p.lane * Math.min( 48, b.width / 2 - 12 );
				dots.push( { x, y: b.y + b.height + 4 + dt * 28 + dt * dt * 46, size: p.size * ( 1 - dt / FALL / 3 ), color: LEFT_COLOR, opacity: 1 - dt / FALL } );
			}
			continue;
		}
		const now = at( p, t );
		if ( ! now ) {
			continue;
		}
		const color = now.lead ? LEAD_COLOR : p.color;
		// The trail first, so the dot lies on top of it.
		for ( let k = TRAIL; k >= 1; k-- ) {
			const back = t - k * TRAIL_GAP;
			const ghost = back >= p.spawn ? at( p, back ) : null;
			if ( ghost ) {
				dots.push( { x: ghost.point[ 0 ], y: ghost.point[ 1 ], size: p.size * ( 1 - k / ( TRAIL + 1 ) ), color, opacity: 0.5 * ( 1 - k / ( TRAIL + 1 ) ) } );
			}
		}
		dots.push( { x: now.point[ 0 ], y: now.point[ 1 ], size: p.size, color, opacity: 1 } );
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

/** Of the leads the dots bring, the share that came by t (the counter of the bar above the canvas). */
export function playedLeads( plan: PlaybackPlan, t: number ): number {
	if ( plan.leads.length ) {
		return countUntil( plan.leads, t ) / plan.leads.length;
	}
	// No traced visitor became a lead: the counter follows the time.
	return plan.end > 0 ? Math.min( 1, t / plan.end ) : 0;
}

interface PlaybackState {
	plan: PlaybackPlan | null;
	/** Seconds since the start; plan.end once it ran to the end. */
	t: number;
	playing: boolean;
}

export interface Playback {
	store: StoreApi<PlaybackState>;
	/** Plays the plan; the dots start after the delay (ms), while the canvas brings the form into view. */
	start: ( plan: PlaybackPlan, delay?: number ) => void;
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
		start: ( plan, delay = 0 ) => {
			cancel();
			store.setState( { plan, t: 0, playing: true } );
			let begin: number | null = null;
			const tick = ( now: number ): void => {
				begin = begin ?? now + delay;
				const t = Math.max( 0, ( now - begin ) / 1000 );
				if ( t >= plan.end ) {
					frame = 0;
					store.setState( { t: plan.end, playing: false } );
					return;
				}
				if ( t !== store.getState().t ) {
					store.setState( { t } );
				}
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

/** How far the playback is (0 to 1, in hundredths) and the share of its leads so far (in steps); null while it does not run. */
export function usePlaybackProgress(): { done: number; leads: number } | null {
	const store = useContext( PlaybackContext )?.store ?? idle;
	const done = useStore( store, ( s ) => ( s.playing && s.plan ? ( s.plan.end > 0 ? Math.round( ( 100 * Math.min( s.t, s.plan.end ) ) / s.plan.end ) : 0 ) : -1 ) );
	const leads = useStore( store, ( s ) => ( s.playing && s.plan ? Math.floor( playedLeads( s.plan, s.t ) * COUNT_STEPS ) : -1 ) );
	return done < 0 ? null : { done: done / 100, leads: leads / COUNT_STEPS };
}

/** The dots and flashing nodes, in the coordinates of the canvas (they move and zoom with it). */
export function PlaybackLayer( { geometry }: { geometry: PlaybackGeometry } ) {
	const store = useContext( PlaybackContext )?.store ?? idle;
	const plan = useStore( store, ( s ) => ( s.playing ? s.plan : null ) );
	const t = useStore( store, ( s ) => s.t );
	// Zoomed out on a long form, the dots and rings grow, so they stay as easy to see.
	const grow = useFlowStore( ( s ) => Math.min( 2.4, Math.max( 1, 0.9 / ( s.transform[ 2 ] || 1 ) ) ) );
	if ( ! plan ) {
		return null;
	}
	const { dots, rings } = framePlayback( plan, t, geometry );
	return (
		<ViewportPortal>
			<svg className="ffxb-pai-flow" aria-hidden="true" width="1" height="1">
				{ rings.map( ( r ) => {
					const box = geometry.boxOf( r.node );
					return box ? (
						<g key={ r.node } className={ `ffxb-pai-flow__ring is-${ r.kind }` }>
							<rect x={ box.x - 5 } y={ box.y - 5 } width={ box.width + 10 } height={ box.height + 10 } rx={ 17 } strokeWidth={ 9 * grow } opacity={ 0.06 + r.strength * 0.12 } />
							<rect x={ box.x - 2 } y={ box.y - 2 } width={ box.width + 4 } height={ box.height + 4 } rx={ 15 } strokeWidth={ 1.5 * grow } opacity={ 0.3 + r.strength * 0.45 } />
						</g>
					) : null;
				} ) }
				{ dots.map( ( d, i ) => (
					<g key={ i } opacity={ d.opacity }>
						<circle cx={ d.x } cy={ d.y } r={ d.size * 0.95 * grow } fill={ d.color } opacity={ 0.22 } />
						<circle cx={ d.x } cy={ d.y } r={ d.size * 0.5 * grow } fill={ d.color } />
					</g>
				) ) }
			</svg>
		</ViewportPortal>
	);
}
