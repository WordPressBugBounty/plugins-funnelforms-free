import { describe, expect, it } from 'vitest';
import { localeTag } from '../src';

describe( 'localeTag', () => {
	it.each( [
		[ 'de_DE_formal', 'de-DE' ],
		[ 'de_CH_informal', 'de-CH' ],
		[ 'nl_NL_formal', 'nl-NL' ],
		[ 'de_AT', 'de-AT' ],
		[ 'de_DE', 'de-DE' ],
		[ 'en_US', 'en-US' ],
		[ 'pt_PT_ao90', 'pt-PT' ],
		[ 'es_419', 'es-419' ],
		[ 'zh_TW', 'zh-TW' ],
		[ 'ja', 'ja' ],
		[ 'ary', 'ary' ],
		[ 'en-GB', 'en-GB' ],
		[ 'de-DE_formal', 'de-DE' ],
		[ ' fr_FR ', 'fr-FR' ],
	] )( '%s → %s', ( locale, tag ) => {
		expect( localeTag( locale ) ).toBe( tag );
		// Every tag works in the browser's formats, which threw for de-DE_formal.
		expect( () => new Date( 0 ).toLocaleDateString( tag, { day: 'numeric', month: 'short', year: 'numeric' } ) ).not.toThrow();
	} );

	it( 'leaves the browser language without a usable locale', () => {
		expect( localeTag( undefined ) ).toBeUndefined();
		expect( localeTag( null ) ).toBeUndefined();
		expect( localeTag( '' ) ).toBeUndefined();
		expect( localeTag( '_formal' ) ).toBeUndefined();
		expect( localeTag( '!!' ) ).toBeUndefined();
	} );
} );
