import { describe, expect, it } from 'vitest';
import type { VisitorTrace } from '../src/predict';
import { framePlayback, LEAD_COLOR, LEFT_COLOR, PERSONA_COLORS, planPlayback, playedLeads, playedShare, type PlaybackBox, type PlaybackGeometry } from '../src/ui/PredictionPlayback';

// The visitors of a prediction played on the canvas: when and where each dot runs.

/** Three nodes in a row, 200 wide and 100 high, 100 apart. */
const boxes = new Map<string, PlaybackBox>(
	[ 'a', 'b', 'end' ].map( ( id, i ): [ string, PlaybackBox ] => {
		const x = i * 300;
		return [ id, { x, y: 0, width: 200, height: 100, in: [ x, 50 ], out: [ x + 200, 50 ] } ];
	} )
);
const boxOf = ( id: string ): PlaybackBox | null => boxes.get( id ) ?? null;
const straight = ( from: PlaybackBox, to: PlaybackBox ): Array<[ number, number ]> => [ from.out, to.in ];
const canvas: PlaybackGeometry = { boxOf, wayPoints: straight };
/** The dots that run (not the shadows of their trail). */
const running = ( plan: ReturnType<typeof planPlayback>, t: number, geometry = canvas ) => framePlayback( plan, t, geometry ).dots.filter( ( d ) => 1 === d.opacity );

const lead: VisitorTrace = { persona: 'p2', nodes: [ 'a', 'b', 'end' ], left: false, lead: 2 };
const leaves: VisitorTrace = { persona: 'p1', nodes: [ 'a', 'b' ], left: true, lead: -1 };

describe( 'playing the visitors', () => {
	it( 'runs the longest way in five seconds and drops those who leave from their step', () => {
		const plan = planPlayback( [ lead, leaves ], boxOf, straight, [ 'p1', 'p2' ] );
		// In 60, through two nodes of 200 and two paths of 100 into the end: 660 px in 5 seconds.
		const speed = 660 / 5;
		const [ first, second ] = plan.particles;
		expect( first?.color ).toBe( PERSONA_COLORS[ 1 ] );
		expect( second?.color ).toBe( PERSONA_COLORS[ 0 ] );
		expect( first?.finish ).toEqual( { node: 'end', at: expect.closeTo( ( first?.spawn ?? 0 ) + 5, 5 ), kind: 'lead' } );
		// Leaves halfway through its second step, from its bottom.
		expect( second?.finish?.kind ).toBe( 'left' );
		expect( second?.finish?.at ).toBeCloseTo( ( second?.spawn ?? 0 ) + ( 60 + 200 + 100 + 100 ) / speed, 5 );
		expect( plan.end ).toBeCloseTo( Math.max( ( first?.spawn ?? 0 ) + 5 + 0.35, ( second?.finish?.at ?? 0 ) + 0.9 ), 5 );

		// On the path from a to b: visible between the two, in its lane.
		const onPath = ( first?.spawn ?? 0 ) + ( 60 + 200 + 50 ) / speed;
		const dot = running( plan, onPath )[ 0 ];
		expect( dot?.x ).toBeCloseTo( 250, 3 );
		expect( Math.abs( ( dot?.y ?? 0 ) - 50 ) ).toBeLessThanOrEqual( 7 );
		expect( dot?.color ).toBe( PERSONA_COLORS[ 1 ] );
		// Inside a node a dot is hidden; on the way into the end it is a lead (green).
		expect( running( plan, ( first?.spawn ?? 0 ) + ( 60 + 100 ) / speed ).filter( ( d ) => d.color === PERSONA_COLORS[ 1 ] ) ).toHaveLength( 0 );
		expect( running( plan, ( first?.spawn ?? 0 ) + ( 60 + 200 + 100 + 200 + 50 ) / speed ).some( ( d ) => d.color === LEAD_COLOR ) ).toBe( true );

		// Leaving: sinks orange from the bottom of the step and fades, the step flashes orange.
		const gone = ( second?.finish?.at ?? 0 ) + 0.18;
		const frame = framePlayback( plan, gone, canvas );
		const fall = frame.dots.find( ( d ) => d.color === LEFT_COLOR );
		expect( fall?.y ).toBeGreaterThan( 100 );
		expect( fall?.y ).toBeLessThan( 120 );
		expect( fall?.x ).toBeGreaterThan( 300 );
		expect( fall?.x ).toBeLessThan( 500 );
		expect( fall?.opacity ).toBeCloseTo( 0.8, 5 );
		expect( frame.rings ).toContainEqual( { node: 'b', kind: 'left', strength: 0.4 } );
		// A lead makes the end flash green.
		expect( framePlayback( plan, ( first?.finish?.at ?? 0 ) + 0.1, canvas ).rings ).toContainEqual( { node: 'end', kind: 'lead', strength: 0.3 } );
		expect( framePlayback( plan, plan.end, canvas ).dots ).toEqual( [] );
	} );

	it( 'counts up the figures of each step with the dots', () => {
		const plan = planPlayback( [ lead, leaves ], boxOf, straight );
		expect( playedShare( plan, 'a', 0 ) ).toEqual( { reached: 0, left: 1 } );
		expect( playedShare( plan, 'b', plan.end ) ).toEqual( { reached: 1, left: 1 } );
		const one = ( plan.particles[ 1 ]?.finish?.at ?? 0 ) + 0.01;
		expect( playedShare( plan, 'b', one ).left ).toBe( 1 );
		expect( playedShare( plan, 'end', 0 ).reached ).toBe( 0 );
		// A node no dot reaches shows its figures as they are.
		expect( playedShare( plan, 'other', 0 ) ).toEqual( { reached: 1, left: 1 } );
	} );

	it( 'hides the dots where a path runs under a node', () => {
		// From the end back to a: the path runs under b.
		const back: VisitorTrace = { persona: 'p1', nodes: [ 'end', 'a' ], left: false, lead: -1 };
		const plan = planPlayback( [ back ], boxOf, straight, [], [ 'a', 'b', 'end', 'gone' ] );
		expect( plan.nodes ).toHaveLength( 3 );
		const leg = plan.particles[ 0 ]?.legs[ 1 ];
		const at = ( x: number ): number => ( leg?.start ?? 0 ) + ( ( 800 - x ) / 800 ) * ( ( leg?.end ?? 0 ) - ( leg?.start ?? 0 ) );
		expect( running( plan, at( 400 ) ) ).toEqual( [] );
		expect( running( plan, at( 250 ) ) ).toHaveLength( 1 );
	} );

	it( 'ends a way at a node that is not on the canvas yet', () => {
		const plan = planPlayback( [ lead ], ( id ) => ( 'end' === id ? null : boxOf( id ) ), straight );
		expect( plan.particles[ 0 ]?.finish?.kind ).toBe( 'out' );
		expect( plan.reached.has( 'end' ) ).toBe( false );
		expect( planPlayback( [ lead ], () => null, straight ).particles[ 0 ]?.finish ).toBeNull();
	} );

	it( 'keeps the dots on their paths when a node moves or grows while they run', () => {
		const plan = planPlayback( [ lead, leaves ], boxOf, straight, [ 'p1', 'p2' ] );
		const first = plan.particles[ 0 ];
		const speed = 660 / 5;
		const onPath = ( first?.spawn ?? 0 ) + ( 60 + 200 + 50 ) / speed;
		// b is now 300 lower and twice as high: the dot runs halfway down the new path from a to b.
		const moved = new Map( boxes );
		moved.set( 'b', { x: 300, y: 300, width: 200, height: 200, in: [ 300, 400 ], out: [ 500, 400 ] } );
		const now: PlaybackGeometry = { boxOf: ( id ) => moved.get( id ) ?? null, wayPoints: straight };
		const dot = running( plan, onPath, now )[ 0 ];
		expect( dot?.x ).toBeCloseTo( 250, 0 );
		expect( dot?.y ).toBeGreaterThan( 210 );
		expect( dot?.y ).toBeLessThan( 240 );
		// The one that leaves at b sinks from its new bottom.
		const fall = framePlayback( plan, ( plan.particles[ 1 ]?.finish?.at ?? 0 ) + 0.1, now ).dots.find( ( d ) => d.color === LEFT_COLOR );
		expect( fall?.y ).toBeGreaterThan( 500 );
		// A node taken away takes its dots with it, nothing is drawn where it was.
		const gone: PlaybackGeometry = { boxOf: ( id ) => ( 'b' === id ? null : boxOf( id ) ), wayPoints: straight };
		expect( running( plan, onPath, gone ) ).toEqual( [] );
	} );

	it( 'draws a short trail behind each running dot and counts the leads', () => {
		const plan = planPlayback( [ lead, leaves ], boxOf, straight, [ 'p1', 'p2' ] );
		const speed = 660 / 5;
		const t = ( plan.particles[ 0 ]?.spawn ?? 0 ) + ( 60 + 200 + 50 ) / speed;
		const dots = framePlayback( plan, t, canvas ).dots;
		const trail = dots.filter( ( d ) => d.opacity < 1 );
		expect( trail.length ).toBeGreaterThanOrEqual( 2 );
		// Behind the dot (to its left on a path to the right), smaller and fainter.
		const dot = dots.find( ( d ) => 1 === d.opacity );
		expect( trail.every( ( d ) => d.x < ( dot?.x ?? 0 ) && d.size < ( dot?.size ?? 0 ) ) ).toBe( true );
		expect( plan.leads ).toHaveLength( 1 );
		expect( playedLeads( plan, 0 ) ).toBe( 0 );
		expect( playedLeads( plan, plan.end ) ).toBe( 1 );
	} );
} );
