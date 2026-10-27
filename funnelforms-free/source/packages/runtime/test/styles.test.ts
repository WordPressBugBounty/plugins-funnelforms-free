import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe( 'styles', () => {
	it( 'hides what the script hides, over every display rule of the form', () => {
		// The bottom bar is a grid on wide screens (a stronger selector); after sending it must go.
		const css = readFileSync( join( __dirname, '../src/runtime.css' ), 'utf8' );
		expect( css ).toMatch( /\.ffx-form \[hidden\] \{\s*display: none !important;/ );
	} );
} );
