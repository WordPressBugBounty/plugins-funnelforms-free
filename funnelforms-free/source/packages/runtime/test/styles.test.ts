import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = ( name: string ): string => readFileSync( join( __dirname, '../src', name ), 'utf8' );

/** The preludes of the top-level rules of a style sheet (selectors and at-rules), comments left out. */
function topLevel( css: string ): string[] {
	const plain = css.replace( /\/\*[\s\S]*?\*\//g, '' );
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for ( let i = 0; i < plain.length; i++ ) {
		const c = plain[ i ];
		if ( '{' === c ) {
			if ( 0 === depth ) {
				out.push( plain.slice( start, i ).trim().replace( /\s+/g, ' ' ) );
			}
			depth++;
		} else if ( '}' === c ) {
			depth--;
			if ( 0 === depth ) {
				start = i + 1;
			}
		} else if ( ';' === c && 0 === depth ) {
			out.push( plain.slice( start, i + 1 ).trim().replace( /\s+/g, ' ' ) );
			start = i + 1;
		}
	}
	return out;
}

describe( 'styles', () => {
	it( 'hides what the script hides, over every display rule of the form', () => {
		// The bottom bar is a grid on wide screens (a stronger selector); after sending it must go.
		expect( read( 'runtime.css' ) ).toMatch( /\.ffx-form \[hidden\] \{\s*display: none !important;/ );
	} );

	it( 'keeps theme and page builder CSS off the form: everything in layers, behind the shield', () => {
		// Elementor's kit and Divi's list rules sit outside any layer and beat every layered rule;
		// only the shield, which takes them back, and two rules for elements it leaves out may sit there too.
		const shield = ':is(.ffx-form, .ffx-popup):not(#ffx-shield#ffx-shield) :not(i, svg, svg *), :is(.ffx-form, .ffx-popup):not(#ffx-shield#ffx-shield) :not(i, svg, svg *)::before, :is(.ffx-form, .ffx-popup):not(#ffx-shield#ffx-shield) :not(i, svg, svg *)::after, :is(.ffx-form, .ffx-popup):not(#ffx-shield#ffx-shield) :is(input, textarea)::placeholder, .ffx-widget:not(#ffx-shield#ffx-shield)';
		expect( topLevel( read( 'runtime.css' ) ) ).toEqual( [
			'@layer ffx, ffx-strong, ffx-custom;',
			'@layer ffx',
			'html:has(.ffx-popup[open])',
			'@layer ffx-strong',
			'.ffx-form i:is(.ffx-option-icon, .ffx-input-icon)',
			':is(.ffx-form, .ffx-popup):not(#ffx-shield#ffx-shield)',
			shield,
		] );
		expect( read( 'runtime.css' ) ).toMatch( /\{\s*all: revert-layer;\s*\}\s*$/ );
		// The form's own box gets its look back (a CSS reset on div took padding and font), not its place.
		const box = read( 'runtime.css' ).match( /\n:is\(\.ffx-form, \.ffx-popup\):not\(#ffx-shield#ffx-shield\) \{([^}]*)\}/ )?.[ 1 ] ?? '';
		expect( box ).toMatch( /padding: revert-layer;[\s\S]*font: revert-layer;/ );
		expect( box ).not.toMatch( /\b(all|margin|width|max-width|display|position):/ );
		// The second sheet can load first (styles.ts): it names the order of the layers as well.
		expect( topLevel( read( 'runtime-more.css' ) ) ).toEqual( [ '@layer ffx, ffx-strong, ffx-custom;', '@layer ffx', '@layer ffx', '@layer ffx-strong' ] );
	} );
} );
