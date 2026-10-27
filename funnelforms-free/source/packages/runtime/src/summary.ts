import type { Field, StepNode } from '@funnelforms/form-schema';
import { formatAddress } from './address';
import { bookingText } from './booking';
import { escapeHtml, textOf } from './dom';
import { itemHeading } from './repeat';
import { answered, filledItems } from './validate';

export interface SummaryItem {
	id: string;
	title: string;
	answer: string;
}

type TextOf = ( value: Record<string, string> | undefined ) => string;

/**
 * Answers on the path as {id, title, answer}, the list 3.x kept for {{answers:base64json}} and the
 * dataLayer; Templates::summary() in the plugin builds the same list after a submit.
 */
export function summary( steps: StepNode[], values: Record<string, unknown>, text: TextOf, units = false ): SummaryItem[] {
	const out: SummaryItem[] = [];
	for ( const step of steps ) {
		for ( const field of step.fields ) {
			// Questions left empty (a text typed and deleted, an optional period) are not listed.
			if ( field.type === 'content' || ! answered( values[ field.id ] ) ) {
				continue;
			}
			out.push( item( field, values[ field.id ], text, units ) );
		}
	}
	return out;
}

/** One answer; with `units`, for people: numbers of sliders and number fields with their unit ("100 m²"). */
export function item( field: Field, value: unknown, text: TextOf, units = false ): SummaryItem {
	let answer: string;
	if ( field.type === 'address' ) {
		answer = formatAddress( field, value );
	} else if ( field.type === 'repeat' ) {
		// "Person 1: Name: Ada, Age: 30; Person 2: …", like Submission::display() in the plugin.
		answer = filledItems( value ).map( ( row, i ) => {
			const heading = itemHeading( field, i + 1, text );
			const pairs = field.props.fields.filter( ( f ) => answered( row[ f.id ] ) ).map( ( f ) => {
				const label = textOf( text( f.label ) );
				return ( label ? `${ label }: ` : '' ) + item( f, row[ f.id ], text ).answer;
			} );
			return heading + ( heading.endsWith( '.' ) ? ' ' : ': ' ) + pairs.join( ', ' );
		} ).join( '; ' );
	} else if ( field.type === 'booking' ) {
		answer = bookingText( value, document.documentElement.lang || undefined );
	} else if ( field.type === 'signature' ) {
		answer = Array.isArray( value ) && value.length ? '✓' : '';
	} else if ( field.type === 'file' ) {
		answer = ( Array.isArray( value ) ? value : [] ).map( ( f: { name?: string } ) => f.name ?? '' ).join( ', ' );
	} else if ( Array.isArray( value ) && 'options' in field ) {
		answer = field.options.filter( ( o ) => value.includes( o.id ) ).map( ( o ) => textOf( text( o.label ) ) ).join( ', ' );
	} else {
		// A range slider answers [from, to], shown like the plugin does: "10 – 20".
		const unit = units && ( field.type === 'slider' || field.type === 'number' ) ? field.props.unit : undefined;
		const label = unit ? textOf( text( unit.text ) ) : '';
		answer = ( Array.isArray( value ) ? value : [ value ?? '' ] )
			.map( ( n ) => ( ! label || n === '' ? n : unit?.position === 'before' ? label + ' ' + n : n + ' ' + label ) )
			.join( ' – ' );
	}
	return { id: String( field.legacy?.questionId ?? field.id ), title: textOf( text( field.label ) ), answer };
}

/** Answer list for {{answers}} in content steps. */
export function summaryHtml( items: SummaryItem[] ): string {
	if ( ! items.length ) {
		return '';
	}
	return '<ul class="ffx-summary">' + items.map( ( i ) => `<li><span>${ escapeHtml( i.title ) }</span> <strong>${ escapeHtml( i.answer ) }</strong></li>` ).join( '' ) + '</ul>';
}

/**
 * Base64 of the JSON list. Non-ASCII characters are written as \u escapes and slashes as \/, like
 * PHP's json_encode, so btoa() works for every language (3.x left the tag in place when it failed).
 */
export function base64Json( items: SummaryItem[] ): string {
	const json = JSON.stringify( items )
		.replace( /\//g, '\\/' )
		.replace( /[\u007f-￿]/g, ( c ) => '\\u' + c.charCodeAt( 0 ).toString( 16 ).padStart( 4, '0' ) );
	return btoa( json );
}

export interface PageInfo {
	url: string;
	query: string;
	title: string;
}

/**
 * URL of a redirect reached from a question (no entry, so no server round trip). Only the tokens
 * known before a submit are filled; the base64 answers stay unencoded as in 3.x.
 */
export function questionRedirectUrl( template: string, params: Array<{ name: string; value: string }>, items: SummaryItem[], page: PageInfo ): string {
	const fill = ( value: string, encode: ( s: string ) => string ): string =>
		value.replace( /\{\{\s*([a-z_]+(?::[A-Za-z0-9_]+)?)\s*\}\}/g, ( _m, token: string ) => {
			switch ( token ) {
				case 'answers:base64json':
					return base64Json( items );
				case 'page:url':
					return encode( page.url );
				case 'page:query':
					return encode( page.query );
				case 'page:title':
					return encode( page.title );
			}
			return '';
		} );
	let url = fill( template, encodeURIComponent );
	const query = params.map( ( p ) => encodeURIComponent( p.name ) + '=' + encodeURIComponent( fill( p.value, ( s ) => s ) ).replace( /%20/g, '+' ) );
	if ( query.length ) {
		url += ( url.includes( '?' ) ? '&' : '?' ) + query.join( '&' );
	}
	return url;
}
