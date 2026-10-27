/**
 * Conditions of paths in words, for the labels on the canvas and the path editor.
 */
import type { AddressPart, Condition, Field, FormDocument } from '@funnelforms/form-schema';
import { ruleOp, type RuleOp } from '../conditions';
import { text } from '../document';
import { __, sprintf } from './i18n';

export function opName( op: RuleOp ): string {
	const names: Record<RuleOp, string> = {
		selected: __( 'is selected', 'funnelforms-pro' ),
		selectedOnly: __( 'is the only answer', 'funnelforms-pro' ),
		lt: __( 'is less than', 'funnelforms-pro' ),
		lte: __( 'is at most', 'funnelforms-pro' ),
		gt: __( 'is more than', 'funnelforms-pro' ),
		gte: __( 'is at least', 'funnelforms-pro' ),
		eq: __( 'equals', 'funnelforms-pro' ),
		neq: __( 'does not equal', 'funnelforms-pro' ),
		equalsText: __( 'is exactly', 'funnelforms-pro' ),
		notEqualsText: __( 'is not exactly', 'funnelforms-pro' ),
		contains: __( 'contains', 'funnelforms-pro' ),
		notContains: __( 'does not contain', 'funnelforms-pro' ),
		startsWith: __( 'starts with', 'funnelforms-pro' ),
		endsWith: __( 'ends with', 'funnelforms-pro' ),
		filled: __( 'is answered', 'funnelforms-pro' ),
		empty: __( 'is not answered', 'funnelforms-pro' ),
		dateBefore: __( 'is before', 'funnelforms-pro' ),
		dateAfter: __( 'is after', 'funnelforms-pro' ),
		dateOn: __( 'is on', 'funnelforms-pro' ),
		'count:gte': __( 'has at least this many answers', 'funnelforms-pro' ),
		'count:lte': __( 'has at most this many answers', 'funnelforms-pro' ),
		'count:eq': __( 'has exactly this many answers', 'funnelforms-pro' ),
		'count:gt': __( 'has more answers than', 'funnelforms-pro' ),
		'count:lt': __( 'has fewer answers than', 'funnelforms-pro' ),
		'count:neq': __( 'does not have this many answers', 'funnelforms-pro' ),
	};
	return names[ op ];
}

/** Names of the parts of an address in conditions. */
export function partName( part: AddressPart ): string {
	const names: Record<AddressPart, string> = {
		address: __( 'whole address', 'funnelforms-pro' ),
		street: __( 'Street', 'funnelforms-pro' ),
		number: __( 'House number', 'funnelforms-pro' ),
		zip: __( 'Postcode', 'funnelforms-pro' ),
		city: __( 'City', 'funnelforms-pro' ),
		country: __( 'Country', 'funnelforms-pro' ),
	};
	return names[ part ];
}

/** The day of a date condition in words: today, a date, and the days added. */
export function dayName( value: string, days: number | undefined ): string {
	const day = 'today' === value ? __( 'today', 'funnelforms-pro' ) : value.split( '-' ).reverse().join( '.' );
	if ( ! days ) {
		return day;
	}
	return days > 0 ? sprintf( __( '%1$s + %2$d days', 'funnelforms-pro' ), day, days ) : sprintf( __( '%1$s − %2$d days', 'funnelforms-pro' ), day, -days );
}

/** Every step field by id. */
export function fieldIndex( doc: FormDocument ): Map<string, Field> {
	const map = new Map<string, Field>();
	for ( const node of doc.nodes ) {
		if ( 'step' === node.type ) {
			node.fields.forEach( ( f ) => map.set( f.id, f ) );
		}
	}
	return map;
}

const strip = ( html: string ): string => html.replace( /<[^>]*>/g, ' ' ).replace( /\s+/g, ' ' ).trim();

const short = ( value: string, max = 28 ): string => ( value.length > max ? value.slice( 0, max - 1 ) + '…' : value );

export function fieldTitle( field: Field | undefined, locale: string ): string {
	if ( ! field ) {
		return __( 'Deleted field', 'funnelforms-pro' );
	}
	return strip( text( field.label, locale ) ) || field.key;
}

/** One condition in words, e.g. “Budget: Over 5,000 is selected”; groups inside groups in brackets. */
export function describeCondition( condition: Condition, doc: FormDocument, locale: string, fields: Map<string, Field> = fieldIndex( doc ), nested = false ): string {
	if ( 'all' in condition || 'any' in condition ) {
		const list = 'all' in condition ? condition.all : condition.any;
		const joined = list.map( ( c ) => describeCondition( c, doc, locale, fields, true ) ).join( ' ' + ( 'all' in condition ? __( 'and', 'funnelforms-pro' ) : __( 'or', 'funnelforms-pro' ) ) + ' ' );
		return nested && list.length > 1 ? `(${ joined })` : joined;
	}
	if ( 'experiment' in condition ) {
		const experiment = doc.experiments?.find( ( x ) => x.id === condition.experiment );
		const variant = experiment?.variants.find( ( v ) => v.id === condition.variant );
		return sprintf( __( 'A/B test: %s', 'funnelforms-pro' ), variant?.label ?? condition.variant );
	}
	if ( 'calc' in condition ) {
		const calc = doc.calculations.find( ( c ) => c.id === condition.calc );
		return sprintf( '%s %s %s', calc?.label || condition.calc, opName( condition.op ), String( condition.value ) );
	}
	const field = fields.get( condition.field );
	const name = short( fieldTitle( field, locale ) );
	if ( 'selected' === condition.op || 'selectedOnly' === condition.op ) {
		const option = field && 'options' in field ? field.options.find( ( o ) => o.id === condition.value ) : undefined;
		const answer = option ? strip( text( option.label, locale ) ) || option.value : __( 'deleted answer', 'funnelforms-pro' );
		return sprintf( '%s: %s %s', name, short( answer ), opName( condition.op ) );
	}
	const subject = 'part' in condition && condition.part ? sprintf( '%s (%s)', name, partName( condition.part ) ) : name;
	switch ( condition.op ) {
		case 'filled':
		case 'empty':
			return sprintf( '%s %s', subject, opName( condition.op ) );
		case 'equalsText':
		case 'notEqualsText':
		case 'contains':
		case 'notContains':
		case 'startsWith':
		case 'endsWith':
			return sprintf( '%s %s "%s"', subject, opName( condition.op ), short( condition.value ) );
		case 'dateBefore':
		case 'dateAfter':
		case 'dateOn':
			return sprintf( '%s %s %s', name, opName( condition.op ), dayName( condition.value, condition.days ) );
	}
	if ( 'number' in condition && 'count' === condition.number ) {
		return sprintf( '%s %s: %s', name, opName( ruleOp( condition ) ), String( condition.value ) );
	}
	return sprintf( '%s %s %s', name, opName( condition.op ), String( condition.value ) );
}

/**
 * A short label of a path on the canvas: the answers it asks for when it asks for answers of
 * one field of its own step ("House or Flat"), otherwise the condition in words, cut short.
 */
export function edgeLabel( condition: Condition, doc: FormDocument, locale: string, from: string, fields: Map<string, Field> = fieldIndex( doc ) ): string {
	const rules = 'any' in condition ? condition.any : [ condition ];
	const node = doc.nodes.find( ( n ) => n.id === from );
	const own = node && 'step' === node.type ? node.fields : [];
	const answers: string[] = [];
	for ( const rule of rules ) {
		if ( ! ( 'field' in rule ) || 'selected' !== rule.op || rule.field !== ( rules[ 0 ] as { field?: string } ).field ) {
			answers.length = 0;
			break;
		}
		const field = own.find( ( f ) => f.id === rule.field );
		const option = field && 'options' in field ? field.options.find( ( o ) => o.id === rule.value ) : undefined;
		if ( ! option ) {
			answers.length = 0;
			break;
		}
		answers.push( strip( text( option.label, locale ) ) || option.value );
	}
	const label = answers.length ? answers.join( ' ' + __( 'or', 'funnelforms-pro' ) + ' ' ) : describeCondition( condition, doc, locale, fields );
	return short( label, 34 );
}
