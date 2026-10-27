import type { ContactField, DateField, Field, RepeatField } from '@funnelforms/form-schema';
import { toFloat } from '@funnelforms/form-core';
import { checkAddress } from './address';
import { isBooking } from './booking';
import { chunk } from './styles';

/**
 * Quick feedback in the browser. The plugin decides (Domain\Entry\AnswerValidator); these rules
 * mirror it so visitors rarely see a server error.
 */
export function checkStepField( field: Field, value: unknown ): string | null {
	const empty = value === undefined || value === null || value === '' || ( Array.isArray( value ) && value.length === 0 );
	if ( field.type === 'content' ) {
		return null;
	}
	if ( field.type === 'address' ) {
		return checkAddress( field, value );
	}
	if ( field.type === 'repeat' ) {
		const result = checkRepeat( field, value );
		return result.group ?? ( result.items.some( ( codes ) => Object.keys( codes ).length > 0 ) ? 'invalid_format' : null );
	}
	if ( empty ) {
		return field.required ? 'required' : null;
	}
	switch ( field.type ) {
		case 'choice':
		case 'dropdown': {
			const count = Array.isArray( value ) ? value.length : 1;
			if ( field.props.multiple && field.props.minChoices && count < field.props.minChoices ) {
				return 'too_few_choices';
			}
			return field.props.multiple && field.props.maxChoices && count > field.props.maxChoices ? 'too_many_choices' : null;
		}
		case 'text':
		case 'textarea': {
			const text = String( value ).trim();
			const length = [ ...text ].length;
			if ( field.props.maxLength && length > field.props.maxLength ) {
				return 'too_long';
			}
			if ( field.props.minLength !== undefined && length < field.props.minLength ) {
				return 'too_short';
			}
			if ( field.type === 'text' ) {
				const restrict = field.props.restrict;
				if ( ( restrict === 'letters' && /\d/.test( text ) ) || ( restrict === 'digits' && /\D/.test( text ) ) || ( restrict === 'birthday' && ! isDate( text, 'dd.mm.yy' ) ) ) {
					return 'invalid_format';
				}
			}
			return null;
		}
		case 'date':
			return checkDate( field, String( value ) );
		case 'file':
			return Array.isArray( value ) && value.length > Math.max( 1, field.props.maxFiles || 1 ) ? 'too_many_files' : null;
		case 'signature':
			return null;
		case 'booking':
			return isBooking( value ) ? null : 'invalid_booking';
		case 'slider': {
			const numbers = ( Array.isArray( value ) ? value : [ value ] ).map( Number );
			if ( numbers.some( ( n ) => n < field.props.min || n > field.props.max ) ) {
				return 'out_of_range';
			}
			return numbers.length === 2 && ( numbers[ 0 ] ?? 0 ) > ( numbers[ 1 ] ?? 0 ) ? 'invalid_range' : null;
		}
		case 'email':
			return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( String( value ).trim() ) ? null : 'invalid_email';
		case 'phone': {
			const text = String( value ).trim();
			const digits = text.replace( /\D/g, '' ).length;
			return chunk().check?.( field, value ) ?? ( /^\+?[\d\s()./-]+$/.test( text ) && digits >= 7 && digits <= 20 ? null : 'invalid_phone' );
		}
		case 'url':
			return isWebAddress( String( value ).trim() ) ? null : 'invalid_url';
		case 'number': {
			const number = typeof value === 'number' ? value : Number( String( value ).trim().replace( /^(-?\d+),(\d+)$/, '$1.$2' ) );
			if ( ! Number.isFinite( number ) ) {
				return 'invalid_format';
			}
			return ( field.props.min !== undefined && number < field.props.min ) || ( field.props.max !== undefined && number > field.props.max ) ? 'out_of_range' : null;
		}
		case 'time': {
			const text = String( value );
			if ( ! /^([01]\d|2[0-3]):[0-5]\d$/.test( text ) ) {
				return 'invalid_time';
			}
			return ( field.props.min && text < field.props.min ) || ( field.props.max && text > field.props.max ) ? 'out_of_range' : null;
		}
		case 'rating': {
			const number = Number( value );
			return Number.isInteger( number ) && number >= field.props.min && number <= field.props.max ? null : 'out_of_range';
		}
	}
	return null;
}

/** Separator of the two dates of a period, and of a range in texts (AnswerValidator::RANGE_SEPARATOR). */
export const RANGE_SEPARATOR = ' – ';

/** Today in the visitor's time zone, YYYY-MM-DD. */
export function today(): string {
	const now = new Date();
	return `${ now.getFullYear() }-${ String( now.getMonth() + 1 ).padStart( 2, '0' ) }-${ String( now.getDate() ).padStart( 2, '0' ) }`;
}

/**
 * Today in the site's time zone, as the plugin compares dates in paths; the visitor's today when
 * the browser does not know the zone.
 */
export function siteToday( timeZone: string | undefined ): string {
	if ( timeZone ) {
		try {
			const parts = new Intl.DateTimeFormat( 'en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' } ).formatToParts( new Date() );
			const part = ( type: string ): string => parts.find( ( p ) => p.type === type )?.value ?? '';
			return `${ part( 'year' ) }-${ part( 'month' ) }-${ part( 'day' ) }`;
		} catch {
			// An offset such as +02:00 is not a zone in every browser.
		}
	}
	return today();
}

/** Earliest and latest ISO date a date field takes ('' for none). */
export function dateLimits( props: DateField[ 'props' ] ): { min: string; max: string } {
	let min = props.min ?? '';
	let max = props.max ?? '';
	if ( props.allow === 'future' ) {
		min = min > today() ? min : today();
	} else if ( props.allow === 'past' ) {
		max = max && max < today() ? max : today();
	}
	return { min, max };
}

/** A date or period in the field's format and within its limits; mirrors AnswerValidator::date(). */
function checkDate( field: DateField, value: string ): string | null {
	const parts = field.props.range ? value.split( RANGE_SEPARATOR ) : [ value ];
	if ( field.props.range && parts.length !== 2 ) {
		return 'invalid_date';
	}
	const { min, max } = dateLimits( field.props );
	const iso: string[] = [];
	for ( const part of parts ) {
		if ( ! isDate( part.trim(), field.props.format ) ) {
			return 'invalid_date';
		}
		const date = toIsoDate( part.trim(), field.props.format );
		if ( ( min && date < min ) || ( max && date > max ) ) {
			return 'date_out_of_range';
		}
		iso.push( date );
	}
	return iso.length === 2 && ( iso[ 1 ] ?? '' ) < ( iso[ 0 ] ?? '' ) ? 'invalid_range' : null;
}

/** One item of a repeat group: answers by sub-field id. */
export type RepeatItem = Record<string, unknown>;

/** Whether a value counts as an answer: not empty, blank or an empty list. */
export const answered = ( value: unknown ): boolean => Array.isArray( value ) ? value.length > 0 : value !== undefined && value !== null && String( value ).trim() !== '';

/** The items of a repeat group with at least one answer; the plugin drops the others too. */
export function filledItems( value: unknown ): RepeatItem[] {
	return ( Array.isArray( value ) ? value : [] ).filter( ( item ): item is RepeatItem => typeof item === 'object' && item !== null && Object.values( item ).some( answered ) );
}

/**
 * Checks a repeat group like AnswerValidator::repeat() in the plugin: `items` holds the error of
 * each sub-field per item (empty items have none), `group` the error of the group itself.
 */
export function checkRepeat( field: RepeatField, value: unknown ): { group: string | null; items: Array<Record<string, string>> } {
	const rows = Array.isArray( value ) ? value : [];
	const items = rows.map( ( row: unknown ) => {
		const codes: Record<string, string> = {};
		if ( typeof row !== 'object' || row === null || ! Object.values( row ).some( answered ) ) {
			return codes;
		}
		for ( const sub of field.props.fields ) {
			const code = checkStepField( sub, ( row as RepeatItem )[ sub.id ] );
			if ( code ) {
				codes[ sub.id ] = code;
			}
		}
		return codes;
	} );
	const count = filledItems( rows ).length;
	let group: string | null = null;
	if ( count === 0 ) {
		group = field.required ? 'required' : null;
	} else if ( count < field.props.minItems ) {
		group = 'too_few_items';
	} else if ( count > Math.max( 1, field.props.maxItems ) ) {
		group = 'too_many_items';
	}
	return { group, items };
}

/** Whether a text is an http or https address; the scheme may be left out, as on the server. */
export function isWebAddress( text: string ): boolean {
	try {
		const url = new URL( /^[a-z][a-z0-9+.-]*:\/\//i.test( text ) ? text : `https://${ text }` );
		return ( url.protocol === 'http:' || url.protocol === 'https:' ) && url.hostname.includes( '.' );
	} catch {
		return false;
	}
}

export function checkContactField( field: ContactField, value: unknown ): string | null {
	if ( field.type === 'html' ) {
		return null;
	}
	if ( field.type === 'captcha' ) {
		return typeof value === 'string' && value !== '' ? null : 'captcha_failed';
	}
	if ( field.type === 'consent' || field.type === 'checkbox' ) {
		return field.required && value !== true ? 'required' : null;
	}
	const text = typeof value === 'string' ? value.trim() : '';
	if ( text === '' ) {
		return field.required ? 'required' : null;
	}
	const props = field.props as { pattern?: string; minLength?: number; maxLength?: number; inputType?: string; mask?: string };
	switch ( field.type ) {
		case 'email':
			return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( text ) ? null : 'invalid_email';
		case 'phone':
		case 'phone_verification': {
			const digits = text.replace( /\D/g, '' ).length;
			return chunk().check?.( field, text ) ?? ( field.required && ( digits < 7 || digits > 20 ) ? 'invalid_phone' : null );
		}
		case 'text': {
			const length = [ ...text ].length;
			if ( ( props.minLength !== undefined && length < props.minLength ) || ( props.maxLength && length > props.maxLength ) ) {
				return 'invalid_length';
			}
			if ( props.inputType === 'number' && Number.isNaN( toFloat( text ) ) ) {
				return 'invalid_format';
			}
			if ( props.mask && maskSupported( props.mask ) && ! maskComplete( props.mask, text ) ) {
				return 'invalid_format';
			}
			if ( props.pattern ) {
				try {
					if ( ! new RegExp( `^(?:${ props.pattern })$`, 'u' ).test( text ) ) {
						return 'invalid_format';
					}
				} catch {
					// A broken pattern lets the value through, as on the server.
				}
			}
		}
	}
	return null;
}

/** Whether a text is a valid date in a format of dd, mm and yy (four-digit year). */
export function isDate( text: string, format: string ): boolean {
	const order: string[] = [];
	const source = format.split( /(dd|mm|yy)/ ).map( ( part ) => {
		if ( part === 'dd' || part === 'mm' || part === 'yy' ) {
			order.push( part );
			return part === 'yy' ? '(\\d{4})' : '(\\d{1,2})';
		}
		return part.replace( /[.*+?^${}()|[\]\\/-]/g, '\\$&' );
	} ).join( '' );
	const match = new RegExp( `^${ source }$` ).exec( text.trim() );
	if ( ! match || new Set( order ).size !== 3 ) {
		return false;
	}
	const parts: Record<string, number> = {};
	order.forEach( ( key, i ) => {
		parts[ key ] = Number( match[ i + 1 ] );
	} );
	const day = parts.dd ?? 0;
	const month = parts.mm ?? 0;
	const year = parts.yy ?? 0;
	const date = new Date( Date.UTC( year, month - 1, day ) );
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Formats an ISO date (from a date input) in the field's format. */
export function formatDate( iso: string, format: string ): string {
	const [ y, m, d ] = iso.split( '-' );
	if ( ! y || ! m || ! d ) {
		return '';
	}
	return format.replace( 'dd', d ).replace( 'mm', m ).replace( 'yy', y );
}

/** ISO date (for a date input) of a text in the field's format; empty when it does not parse. */
export function toIsoDate( text: string, format: string ): string {
	if ( ! isDate( text, format ) ) {
		return '';
	}
	const order = format.match( /dd|mm|yy/g ) ?? [];
	const numbers = text.trim().match( /\d+/g ) ?? [];
	const parts: Record<string, string> = {};
	order.forEach( ( key, i ) => {
		parts[ key ] = numbers[ i ] ?? '';
	} );
	return `${ parts.yy }-${ ( parts.mm ?? '' ).padStart( 2, '0' ) }-${ ( parts.dd ?? '' ).padStart( 2, '0' ) }`;
}

/**
 * Input masks of 3.x text fields (Inputmask syntax): 9 a digit, a a letter, * a letter or digit,
 * everything else as typed. Other masks keep the form on the 3.x renderer (InputMask in the plugin).
 */
export function maskSupported( mask: string ): boolean {
	return mask !== '' && ! /[[\]{}()|\\#&b-zA-Z]/.test( mask );
}

const MASK_CLASS: Record<string, RegExp> = { 9: /\d/, a: /\p{L}/u, '*': /[\p{L}\d]/u };

/** Formats typed text with a mask: literals are added, characters that do not fit are dropped. */
export function applyMask( mask: string, text: string ): string {
	const input = [ ...text ];
	let out = '';
	let i = 0;
	for ( const token of mask ) {
		if ( i >= input.length ) {
			break;
		}
		const cls = MASK_CLASS[ token ];
		if ( ! cls ) {
			out += token;
			if ( input[ i ] === token ) {
				i++;
			}
			continue;
		}
		while ( i < input.length && ! cls.test( input[ i ] ?? '' ) ) {
			i++;
		}
		if ( i < input.length ) {
			out += input[ i ] ?? '';
			i++;
		}
	}
	return out;
}

/** Whether a text fills the mask completely. */
export function maskComplete( mask: string, text: string ): boolean {
	const chars = [ ...text ];
	const tokens = [ ...mask ];
	return chars.length === tokens.length && tokens.every( ( token, i ) => {
		const cls = MASK_CLASS[ token ];
		return cls ? cls.test( chars[ i ] ?? '' ) : chars[ i ] === token;
	} );
}
