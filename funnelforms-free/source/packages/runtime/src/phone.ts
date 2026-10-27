/**
 * Phone numbers by country: reading what visitors type or paste, checking the length per country,
 * grouping the digits and the E.164 form (+4915112345678). Data: plugin/assets/phone/countries.json
 * (tools/phone/countries.mjs). Domain\Form\PhoneNumbers in the plugin mirrors these rules.
 * Only the phone chunk (chunks/phone.ts) and the builder use this module.
 */
import data from '../../../plugin/assets/phone/countries.json';

/** Calling code, national prefix, lengths, groups, example, pattern for shared calling codes. */
type Entry = [ string, string, number[], string, string, string? ];

export const COUNTRIES = ( data as unknown as { countries: Record<string, Entry> } ).countries;

/** A number as read: the country and the national (significant) number, digits only. */
export interface PhoneNumber {
	country: string;
	national: string;
}

export interface Country {
	iso: string;
	code: string;
	prefix: string;
	lengths: number[];
	groups: number[];
	example: string;
}

/** Data of a country, or null for an unknown code. */
export function country( iso: string ): Country | null {
	const entry = COUNTRIES[ iso ];
	return entry ? { iso, code: entry[ 0 ], prefix: entry[ 1 ], lengths: entry[ 2 ], groups: entry[ 3 ].split( ' ' ).map( Number ), example: entry[ 4 ] } : null;
}

/** The country of a national number after a calling code: the one whose numbers it fits, else the main one. */
function countryOf( code: string, national: string ): string | null {
	let main: string | null = null;
	for ( const [ iso, entry ] of Object.entries( COUNTRIES ) ) {
		if ( entry[ 0 ] !== code ) {
			continue;
		}
		if ( ! entry[ 5 ] ) {
			main ??= iso;
		} else if ( national && new RegExp( `^(?:${ entry[ 5 ] })$` ).test( national ) ) {
			return iso;
		}
	}
	return main;
}

/**
 * Removes the national prefix (0 in Germany, 1 in the US, 8 in Russia) that visitors type before
 * the national number, also after a calling code (+49 0151 …). National numbers never start with
 * 0, 1 or 06 where that is the prefix; numbers of the countries with 8 may, so there the prefix
 * goes only when the rest can be a number or the whole cannot.
 */
function withoutPrefix( c: Country, digits: string ): string {
	if ( c.prefix && digits.startsWith( c.prefix ) && digits.length > c.prefix.length ) {
		const rest = digits.slice( c.prefix.length );
		if ( c.prefix !== '8' || c.lengths.includes( rest.length ) || ! c.lengths.includes( digits.length ) ) {
			return rest;
		}
	}
	return digits;
}

/**
 * Reads a number. With + or 00 the calling code names the country; otherwise the number is
 * national and belongs to `fallback`. Null when no country fits.
 */
export function parsePhone( text: string, fallback: string ): PhoneNumber | null {
	const trimmed = text.trim();
	let digits = trimmed.replace( /\D/g, '' );
	const international = trimmed.startsWith( '+' ) || ( digits.startsWith( '00' ) && ! trimmed.startsWith( '(' ) );
	if ( international ) {
		if ( ! trimmed.startsWith( '+' ) ) {
			digits = digits.slice( 2 );
		}
		for ( let length = 1; length <= 3; length++ ) {
			const code = digits.slice( 0, length );
			const rest = digits.slice( length );
			const iso = countryOf( code, rest );
			if ( iso ) {
				const c = country( iso ) as Country;
				const national = withoutPrefix( c, rest );
				// Numbers of a shared calling code typed with the prefix (+1 1 268 …) find their country after it.
				return { country: national === rest ? iso : countryOf( code, national ) ?? iso, national };
			}
		}
		return null;
	}
	const c = country( fallback );
	return c ? { country: c.iso, national: withoutPrefix( c, digits ) } : null;
}

/**
 * Checks a number: '' when it fits, else an error code. `allowed` limits the countries.
 */
export function checkPhone( number: PhoneNumber, allowed?: string[] ): string {
	const c = country( number.country );
	if ( ! c ) {
		return 'invalid_phone';
	}
	if ( allowed?.length && ! allowed.includes( c.iso ) ) {
		return 'phone_country_not_allowed';
	}
	const length = number.national.length;
	if ( length < Math.min( ...c.lengths ) ) {
		return 'phone_too_short';
	}
	if ( length > Math.max( ...c.lengths ) ) {
		return 'phone_too_long';
	}
	return c.lengths.includes( length ) && ! ( c.prefix === '0' && number.national.startsWith( '0' ) ) ? '' : 'invalid_phone';
}

/** The number in E.164: +, calling code, national number. */
export function e164( number: PhoneNumber ): string {
	return `+${ country( number.country )?.code ?? '' }${ number.national }`;
}

/** Digits in the groups of the country; the last group takes the rest. */
export function group( iso: string, digits: string ): string {
	const sizes = country( iso )?.groups ?? [ 3, 3, 4 ];
	const out: string[] = [];
	let at = 0;
	sizes.forEach( ( size, i ) => {
		const part = i === sizes.length - 1 ? digits.slice( at ) : digits.slice( at, at + size );
		at += size;
		if ( part ) {
			out.push( part );
		}
	} );
	return out.join( ' ' );
}

/**
 * The national part as visitors type it: a national prefix they typed stays in front of the
 * first group (0151 2345678).
 */
export function formatTyped( iso: string, typed: string ): string {
	const c = country( iso );
	const digits = typed.replace( /\D/g, '' );
	if ( ! c ) {
		return digits;
	}
	const national = withoutPrefix( c, digits );
	return digits.slice( 0, digits.length - national.length ) + group( iso, national );
}

/**
 * Start of mobile numbers in countries whose area codes vary in length, so the groups of a mobile
 * number would split their other numbers wrongly; those are shown ungrouped (PhoneNumbers::MOBILE).
 */
const MOBILE: Record<string, RegExp> = { DE: /^1[5-7]/ };

/** International display: +49 1512 3456789, a German landline without groups (+49 3012345678). */
export function formatInternational( number: PhoneNumber ): string {
	const mobile = MOBILE[ number.country ];
	const national = mobile && ! mobile.test( number.national ) ? number.national : group( number.country, number.national );
	return `+${ country( number.country )?.code ?? '' } ${ national }`.trim();
}

/** Flag of a country as emoji (regional indicator letters). */
export function flag( iso: string ): string {
	return String.fromCodePoint( ...[ ...iso.toUpperCase() ].map( ( ch ) => 0x1f1a5 + ch.charCodeAt( 0 ) ) );
}

/**
 * The country a phone field starts with: the field's own, else the region of the form's language
 * (de_AT → AT; de → DE), else the first allowed one, else the US.
 */
export function startCountry( own: string | undefined, locale: string, allowed?: string[] ): string {
	const fits = ( iso: string | undefined ): iso is string => Boolean( iso && COUNTRIES[ iso ] && ( ! allowed?.length || allowed.includes( iso ) ) );
	if ( fits( own ) ) {
		return own;
	}
	const tag = locale.replace( /_formal$/, '' ).replace( '_', '-' );
	let region = /-([A-Z]{2})\b/.exec( tag )?.[ 1 ];
	if ( ! region ) {
		try {
			region = new Intl.Locale( tag ).maximize().region;
		} catch {
			region = undefined;
		}
	}
	if ( fits( region ) ) {
		return region;
	}
	return allowed?.find( ( iso ) => COUNTRIES[ iso ] ) ?? 'US';
}
