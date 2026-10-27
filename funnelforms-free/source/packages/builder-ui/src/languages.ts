/**
 * Languages of a form without React. Every text of the document is a Text (one string per
 * locale); the default language is always there, other languages hold translations. Visitors see
 * the default text where a translation is missing (form-core pickText, Document::text).
 */
import type { FormDocument, Text } from '@funnelforms/form-schema';

/**
 * Languages the builder offers to add: those with a catalog in plugin/languages, so buttons and
 * messages of the form are in the same language. Others come from imports and stay as they are.
 */
export const LANGUAGES = [
	'de_DE',
	'de_DE_formal',
	'de_AT',
	'de_CH',
	'en_US',
	'en_GB',
	'es_ES',
	'fr_FR',
	'it_IT',
	'nl_NL',
	'pl_PL',
	'pt_PT',
	'pt_BR',
	'da_DK',
	'sv_SE',
	'nb_NO',
	'fi',
	'cs_CZ',
	'tr_TR',
	'ru_RU',
	'ro_RO',
	'hu_HU',
	'el',
	'ja',
	'zh_CN',
	'ko_KR',
	'vi',
	'id_ID',
	'fa_IR',
] as const;

/** The language's name, in `display`'s language; `formal` marks the formal address. */
export function languageName( locale: string, display: string, formal = 'formal' ): string {
	const tag = locale.replace( /_formal$/, '' ).replace( /_/g, '-' );
	let name = tag;
	try {
		name = new Intl.DisplayNames( [ display.replace( /_formal$/, '' ).replace( /_/g, '-' ) ], { type: 'language', languageDisplay: 'standard' } ).of( tag ) ?? tag;
	} catch {
		// Unknown tags keep their code.
	}
	return locale.endsWith( '_formal' ) ? `${ name } (${ formal })` : name;
}

/** Whether a value is a Text of this document: an object of strings keyed by its languages only. */
function isText( value: unknown, locales: Set<string> ): value is Text {
	if ( ! value || 'object' !== typeof value || Array.isArray( value ) ) {
		return false;
	}
	const entries = Object.entries( value );
	return entries.length > 0 && entries.every( ( [ key, v ] ) => locales.has( key ) && 'string' === typeof v );
}

/** Calls `fn` for every text of the document (titles, labels, options, mails, messages …). */
export function forEachText( doc: FormDocument, fn: ( text: Text ) => void ): void {
	const locales = new Set( [ doc.locales.default, ...doc.locales.available ] );
	const walk = ( value: unknown ): void => {
		if ( isText( value, locales ) ) {
			fn( value );
		} else if ( Array.isArray( value ) ) {
			value.forEach( walk );
		} else if ( value && 'object' === typeof value ) {
			Object.values( value ).forEach( walk );
		}
	};
	walk( doc.nodes );
	walk( doc.actions );
	walk( doc.settings );
}

/** Text without HTML tags and spaces: what visitors read. */
function readable( value: string | undefined ): string {
	return ( value ?? '' ).replace( /<[^>]*>/g, '' ).replace( /&nbsp;/g, ' ' ).trim();
}

/** How many texts with a default text have no translation into `locale`. */
export function missingTranslations( doc: FormDocument, locale: string ): number {
	let missing = 0;
	forEachText( doc, ( text ) => {
		if ( '' !== readable( text[ doc.locales.default ] ) && '' === readable( text[ locale ] ) ) {
			missing++;
		}
	} );
	return missing;
}

export function addLanguage( doc: FormDocument, locale: string ): void {
	if ( ! doc.locales.available.includes( locale ) ) {
		doc.locales.available.push( locale );
	}
}

/** Removes a language and its translations; the default language stays. */
export function removeLanguage( doc: FormDocument, locale: string ): void {
	if ( locale === doc.locales.default ) {
		return;
	}
	forEachText( doc, ( text ) => {
		Reflect.deleteProperty( text, locale );
	} );
	doc.locales.available = doc.locales.available.filter( ( l ) => l !== locale );
	if ( doc.locales.available.length < 2 ) {
		delete doc.settings.languageSwitch;
	}
}

/**
 * Writes the text of one language. An empty translation is removed, so visitors see the default
 * text instead of nothing; the default text itself may be empty.
 */
export function setText( text: Text, locale: string, value: string, defaultLocale: string ): void {
	if ( '' === value && locale !== defaultLocale ) {
		Reflect.deleteProperty( text, locale );
	} else {
		text[ locale ] = value;
	}
}

/** What the input of a text shows in `locale`: the translation only, never the default text. */
export function editText( text: Text | undefined | null, locale: string, defaultLocale: string ): string {
	if ( ! text ) {
		return '';
	}
	if ( locale !== defaultLocale ) {
		return text[ locale ] ?? '';
	}
	return text[ locale ] ?? Object.values( text )[ 0 ] ?? '';
}

/** A copy of a text with the text of one language written as setText does. */
export function withText( text: Text | undefined, locale: string, value: string, defaultLocale: string ): Text {
	const next = { ...( text ?? {} ) };
	setText( next, locale, value, defaultLocale );
	return next;
}

/** The placeholder of a translation's input: the default text. */
export function fallbackText( text: Text | undefined | null, locale: string, defaultLocale: string ): string | undefined {
	return locale !== defaultLocale && text ? ( text[ defaultLocale ] ?? undefined ) : undefined;
}
