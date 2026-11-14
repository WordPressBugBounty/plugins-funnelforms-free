import { getBezierPath, Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { pointOn } from '../src/ui/Canvas';

describe( 'path labels', () => {
	it( 'finds the point of the drawn path, the middle as React Flow puts it', () => {
		const [ path, x, y ] = getBezierPath( { sourceX: 0, sourceY: 0, sourcePosition: Position.Right, targetX: 400, targetY: 300, targetPosition: Position.Left } );
		const [ mx, my ] = pointOn( path, 0.5 ) ?? [ NaN, NaN ];
		expect( mx ).toBeCloseTo( x, 0 );
		expect( my ).toBeCloseTo( y, 0 );
		// Nearer the target, so two paths of one step no longer meet with their labels.
		const [ , ly ] = pointOn( path, 0.7 ) ?? [ NaN, NaN ];
		expect( ly ).toBeGreaterThan( 200 );
		expect( pointOn( 'M0,0 L10,10', 0.5 ) ).toBeNull();
	} );
} );

describe( 'paths from the outputs', () => {
	it( 'starts each path at its output, a path for several answers once per answer', async () => {
		const { readFileSync } = await import( 'node:fs' );
		const { join } = await import( 'node:path' );
		const { buildEdges } = await import( '../src/ui/Canvas' );
		const { outputsOf } = await import( '../src/ports' );
		const doc = JSON.parse( readFileSync( join( __dirname, '../../form-schema/test/examples/synthetic-logic.json' ), 'utf8' ) );
		const outputs = new Map( doc.nodes.map( ( n: { id: string } ) => [ n.id, outputsOf( doc, n as never ) ] ) );
		const edges = buildEdges( doc, { edge: 'e_n0_0_2' }, [], null, outputs as never );
		const from = ( id: string ) => edges.filter( ( e ) => e.source === id ).map( ( e ) => [ e.id, e.sourceHandle, e.data?.edge, e.selected, e.className ] );
		expect( from( 'n0_0' ) ).toEqual( [
			[ 'e_n0_0_0', 'a:q1_o0', 'e_n0_0_0', false, 'ffxb-edge ffxb-edge--answer' ],
			[ 'e_n0_0_1', 'a:q1_o1', 'e_n0_0_1', false, 'ffxb-edge ffxb-edge--answer' ],
			[ 'e_n0_0_3', 'otherwise', 'e_n0_0_3', false, 'ffxb-edge ffxb-edge--otherwise' ],
			// The selected path is drawn last, above the others.
			[ 'e_n0_0_2', 'a:q1_o3', 'e_n0_0_2', true, 'ffxb-edge ffxb-edge--answer' ],
			[ 'e_n0_0_2#a:q1_o4', 'a:q1_o4', 'e_n0_0_2', true, 'ffxb-edge ffxb-edge--answer' ],
		] );
		expect( edges.slice( -2 ).map( ( e ) => e.id ) ).toEqual( [ 'e_n0_0_2', 'e_n0_0_2#a:q1_o4' ] );
		expect( edges.every( ( e ) => undefined === e.zIndex && 'in' === e.targetHandle ) ).toBe( true );
		// The paths of a selected step and the path under the pointer stand out the same way.
		const lit = buildEdges( doc, { node: 'n1_0' }, [], null, outputs as never, 'e_n2_0_1' );
		expect( lit.filter( ( e ) => / is-(out|hot)/.test( e.className ?? '' ) ).map( ( e ) => [ e.id, e.className ] ) ).toEqual( [
			[ 'e_n1_0_0', 'ffxb-edge ffxb-edge--answer is-out' ],
			[ 'e_n1_0_0#a:q2_o2', 'ffxb-edge ffxb-edge--answer is-out' ],
			[ 'e_n1_0_1', 'ffxb-edge ffxb-edge--otherwise is-out' ],
			[ 'e_n2_0_1', 'ffxb-edge ffxb-edge--rule ffxb-edge--below is-hot' ],
		] );
		expect( lit.slice( -4 ).every( ( e ) => / is-(out|hot)/.test( e.className ?? '' ) ) ).toBe( true );
		expect( lit.find( ( e ) => 'e_n0_0_3' === e.id )?.className ).toBe( 'ffxb-edge ffxb-edge--otherwise is-in' );
		// The only path of a step is its way on, not "Otherwise".
		const plain = { ...doc, edges: doc.edges.filter( ( e: { from: string; default?: boolean } ) => 'n1_0' !== e.from || e.default ) };
		expect( buildEdges( plain, {}, [], null, new Map( plain.nodes.map( ( n: { id: string } ) => [ n.id, outputsOf( plain, n as never ) ] ) ) as never ).find( ( e ) => 'n1_0' === e.source )?.className ).toBe( 'ffxb-edge ffxb-edge--next' );
		expect( from( 'n2_0' ).map( ( e ) => e[ 4 ] ) ).toEqual( [ 'ffxb-edge ffxb-edge--rule', 'ffxb-edge ffxb-edge--rule ffxb-edge--below', 'ffxb-edge ffxb-edge--rule ffxb-edge--above', 'ffxb-edge ffxb-edge--otherwise' ] );
		// The card names the outputs: no label on the paths.
		expect( edges.every( ( e ) => ! e.data?.label ) ).toBe( true );
	} );
} );
