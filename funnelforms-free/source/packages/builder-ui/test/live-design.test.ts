import { describe, expect, it } from 'vitest';
import { mainColors, pixelColor } from '../src/imageColors';
import { DESIGN_PARTS, partTokens, readFrameMessage } from '../src/ui/LiveDesign';

const frame = {} as Window;

function message( data: unknown, source: unknown = frame, origin = 'null' ): MessageEvent {
	return { data, source, origin } as unknown as MessageEvent;
}

describe( 'messages of the preview frame', () => {
	it( 'reads the messages of the design mode', () => {
		expect( readFrameMessage( message( { type: 'ffx-design', action: 'ready' } ), frame ) ).toEqual( { action: 'ready' } );
		expect( readFrameMessage( message( { type: 'ffx-design', action: 'pick', target: 'button', rect: { x: 10, y: 20, width: 100, height: 40 } } ), frame ) ).toEqual( {
			action: 'pick',
			target: 'button',
			rect: { x: 10, y: 20, width: 100, height: 40 },
		} );
		// A part that is not on this step has no position.
		expect( readFrameMessage( message( { type: 'ffx-design', action: 'pick', target: 'progress', rect: null } ), frame ) ).toEqual( { action: 'pick', target: 'progress', rect: null } );
		expect( readFrameMessage( message( { type: 'ffx-design', action: 'key', key: 'undo' } ), frame ) ).toEqual( { action: 'key', key: 'undo' } );
	} );

	it( 'ignores messages from elsewhere and of another shape', () => {
		const pick = { type: 'ffx-design', action: 'pick', target: 'button', rect: null };
		// Another window, another origin, no frame.
		expect( readFrameMessage( message( pick, {} ), frame ) ).toBeNull();
		expect( readFrameMessage( message( pick, frame, 'https://example.invalid' ), frame ) ).toBeNull();
		expect( readFrameMessage( message( pick ), null ) ).toBeNull();
		// Unknown types, actions, parts and keys; positions that are no numbers.
		expect( readFrameMessage( message( 'ffx-design' ), frame ) ).toBeNull();
		expect( readFrameMessage( message( { ...pick, type: 'ffx-preview-style' } ), frame ) ).toBeNull();
		expect( readFrameMessage( message( { ...pick, action: 'eval' } ), frame ) ).toBeNull();
		expect( readFrameMessage( message( { ...pick, target: 'body' } ), frame ) ).toBeNull();
		expect( readFrameMessage( message( { type: 'ffx-design', action: 'key', key: 'save' } ), frame ) ).toBeNull();
		expect( readFrameMessage( message( { type: 'ffx-design', action: 'rect', target: 'button', rect: { x: '1', y: 0, width: 1, height: 1 } } ), frame ) ).toBeNull();
		expect( readFrameMessage( message( { type: 'ffx-design', action: 'rect', target: 'button', rect: { x: 0, y: 0, width: -1, height: 1 } } ), frame ) ).toBeNull();
		expect( readFrameMessage( message( { ...pick, rect: { x: 1 } } ), frame ) ).toEqual( { action: 'pick', target: 'button', rect: null } );
	} );

	it( 'names the tokens of every part', () => {
		for ( const part of DESIGN_PARTS ) {
			expect( partTokens( part ).rows.length ).toBeGreaterThan( 0 );
		}
		expect( partTokens( 'button' ).rows.map( ( r ) => r.key ) ).toEqual( [ 'color.button', 'color.onButton', 'radius.button', 'space.button' ] );
		// An empty button colour follows the accent colour.
		expect( partTokens( 'button' ).rows[ 0 ]?.fallback( { 'color.primary': '#0e7490' } ) ).toBe( '#0e7490' );
		expect( partTokens( 'progress' ).rows.map( ( r ) => r.key ) ).toEqual( [ 'color.progress', 'color.progressTrack' ] );
	} );
} );

describe( 'colours of images', () => {
	/** Pixels of a 4 x 2 image: given colours, RGBA. */
	function image( colors: Array<[ number, number, number, number ]> ): Uint8ClampedArray {
		return new Uint8ClampedArray( colors.flat() );
	}

	it( 'reads the colour of one pixel', () => {
		const data = image( [
			[ 14, 116, 144, 255 ],
			[ 255, 255, 255, 255 ],
			[ 0, 0, 0, 0 ],
			[ 225, 29, 72, 255 ],
		] );
		expect( pixelColor( data, 2, 0, 0 ) ).toBe( '#0e7490' );
		expect( pixelColor( data, 2, 1, 1 ) ).toBe( '#e11d48' );
		// Transparent and outside the image.
		expect( pixelColor( data, 2, 0, 1 ) ).toBeNull();
		expect( pixelColor( data, 2, 2, 0 ) ).toBeNull();
	} );

	it( 'finds the main colours, colourful ones first', () => {
		const teal: [ number, number, number, number ] = [ 14, 116, 144, 255 ];
		const white: [ number, number, number, number ] = [ 255, 255, 255, 255 ];
		const data = image( [ ...Array( 60 ).fill( white ), ...Array( 30 ).fill( teal ), [ 16, 118, 146, 255 ], ...Array( 9 ).fill( [ 0, 0, 0, 0 ] ) ] );
		const found = mainColors( data );
		expect( found[ 0 ] ).toMatch( /^#0[ef]7[45]9[01]$/ );
		expect( found ).toContain( '#ffffff' );
		expect( found ).toHaveLength( 2 );
	} );
} );
