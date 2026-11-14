/**
 * WordPress locales (de_DE, de_DE_formal, de_CH_informal, pt_PT_ao90) are not language tags of
 * the browser (BCP 47: de-DE). Intl and toLocale*() throw a RangeError on a tag they do not know,
 * such as "de-DE_formal" ("Deutsch (Sie)"), and a throw while rendering empties a whole screen.
 * Every locale from WordPress goes through localeTag() before it reaches Intl.
 */

/** Variants of WordPress that only change the form of address, not the language. */
const ADDRESS = /^(formal|informal)$/i;

/**
 * The language tag of a WordPress locale, or undefined (the browser's language) if there is none
 * the browser accepts: de_DE_formal → de-DE, de_CH_informal → de-CH, nl_NL_formal → nl-NL,
 * de_AT → de-AT, pt_PT_ao90 → pt-PT, en-US stays en-US.
 */
export function localeTag( locale?: string | null ): string | undefined {
	const raw = ( locale ?? '' ).trim();
	if ( '' === raw ) {
		return undefined;
	}
	const parts = raw.split( /[_-]+/ ).filter( ( p, i ) => '' !== p && ( 0 === i || ! ADDRESS.test( p ) ) );
	let tag: string | undefined;
	// The longest part the browser accepts: pt-PT-ao90 is no tag, pt-PT is.
	for ( let n = parts.length; n > 0 && undefined === tag; n-- ) {
		try {
			tag = Intl.getCanonicalLocales( parts.slice( 0, n ).join( '-' ) )[ 0 ];
		} catch {
			// Not a tag: one part less.
		}
	}
	return tag;
}
