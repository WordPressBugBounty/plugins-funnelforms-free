/**
 * The visitors' choice of the form's languages (settings.languageSwitch): the page loads again
 * with ?ffx_lang=, and the plugin renders the form in that language (Frontend\Renderer::locale).
 * A row of links, not a list box: moving through a list box with the arrow keys would already
 * load the page in another language (WCAG 3.2.2).
 */
import { h } from './dom';

/** The language's name in itself (Deutsch, English, Français), with the country where it tells variants apart. */
export function nativeName( locale: string, all: string[] ): string {
	const tag = locale.replace( /_formal$/, '' ).replace( /_/g, '-' );
	const language = tag.split( '-' )[ 0 ] ?? tag;
	// Only one variant of the language: its plain name; several: with the country.
	const variants = all.filter( ( l ) => l.split( '_' )[ 0 ] === language ).length;
	let name = tag;
	try {
		name = new Intl.DisplayNames( [ tag ], { type: 'language' } ).of( variants > 1 ? tag : language ) ?? tag;
	} catch {
		// Unknown tags keep their code.
	}
	name = name.charAt( 0 ).toLocaleUpperCase( tag ) + name.slice( 1 );
	return locale.endsWith( '_formal' ) && language === 'de' ? `${ name } (Sie)` : name;
}

/** The address of the page in another language of the form. */
export function addressIn( href: string, locale: string ): string {
	const url = new URL( href );
	url.searchParams.set( 'ffx_lang', locale.toLowerCase() );
	return url.toString();
}

/** The BCP 47 tag of a locale (de_DE_formal: de-DE). */
export function languageTag( locale: string ): string {
	return locale.replace( /_formal$/, '' ).replace( /_/g, '-' );
}

export function languageSwitch( locales: string[], current: string, label: string ): HTMLElement {
	return h(
		'nav',
		{ class: 'ffx-lang', 'aria-label': label },
		...locales.map( ( l ) =>
			h( 'a', { href: addressIn( window.location.href, l ), lang: languageTag( l ), hreflang: languageTag( l ), 'aria-current': l === current ? 'true' : null }, nativeName( l, locales ) )
		)
	);
}
