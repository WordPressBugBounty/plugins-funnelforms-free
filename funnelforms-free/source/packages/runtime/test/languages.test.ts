import { describe, expect, it } from 'vitest';
import { addressIn, nativeName } from '../src/languages';

describe( 'language choice', () => {
	it( 'names each language in itself, with the country only where variants share a language', () => {
		const all = [ 'de_DE', 'en_US', 'fr_FR' ];
		expect( all.map( ( l ) => nativeName( l, all ) ) ).toEqual( [ 'Deutsch', 'English', 'Français' ] );
		const variants = [ 'de_DE', 'de_CH', 'de_DE_formal' ];
		expect( nativeName( 'de_CH', variants ) ).toMatch( /^Deutsch \(Schweiz\)$|^Schweizer Hochdeutsch$/ );
		expect( nativeName( 'de_DE_formal', variants ) ).toBe( 'Deutsch (Deutschland) (Sie)' );
	} );

	it( 'keeps the address and sets the language parameter', () => {
		expect( addressIn( 'https://example.org/angebot/?utm_source=x&ffx_lang=de_de#form', 'en_US' ) ).toBe( 'https://example.org/angebot/?utm_source=x&ffx_lang=en_us#form' );
	} );
} );
