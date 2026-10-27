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
