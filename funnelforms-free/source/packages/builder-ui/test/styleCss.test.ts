import { describe, expect, it } from 'vitest';
import { fontFamilyCss } from '../src/fonts';
import { styleClasses, styleCss } from '../src/styleCss';
import vectors from './style-vectors.json';

describe( 'style CSS', () => {
	// The plugin checks the same vectors (tests/Integration/StyleTest.php).
	it( 'is written as the plugin writes it', () => {
		for ( const v of vectors as Array<{ tokens: Record<string, string>; css: string; classes: string }> ) {
			expect( styleCss( v.tokens ), JSON.stringify( v.tokens ) ).toBe( v.css );
			expect( styleClasses( v.tokens ), JSON.stringify( v.tokens ) ).toBe( v.classes );
		}
	} );

	it( 'names fonts as the plugin does', () => {
		expect( fontFamilyCss( 'Serif' ) ).toBe( 'serif' );
		expect( fontFamilyCss( 'poppins' ) ).toBe( '"Poppins", sans-serif' );
		expect( fontFamilyCss( 'serif-classic' ) ).toContain( 'Palatino' );
		expect( fontFamilyCss( 'Lato.woff2' ) ).toBe( '"Lato", sans-serif' );
		expect( fontFamilyCss( 'a;b' ) ).toBe( '' );
	} );
} );
