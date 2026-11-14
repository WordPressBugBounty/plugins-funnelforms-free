/**
 * Conditions of paths in words, for the labels on the canvas and the path editor.
 */
import type { AddressPart, Condition, Field, FormDocument } from '@funnelforms/form-schema';
import { isBetween, ruleOp, withBetween, type RuleOp } from '../conditions';
import { leaves, text } from '../document';
import type { RuleOutput } from '../ports';
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
		between: __( 'is between', 'funnelforms-pro' ),
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

/** Of rules that ask the same of one text, this many texts are named; the others are counted. */
const MAX_TEXTS = 6;

/**
 * Rules of which one must hold and that all compare one text (or one part of an address) with
 * a text, such as the beginnings of the postal codes of an area: the texts by what is asked of
 * them, in their order. Null for other lists.
 */
function sameText( list: Condition[] ): { rule: Extract<Condition, { part?: unknown; value: string }>; asked: Array<{ op: string; values: string[] }> } | null {
	const [ first ] = list;
	if ( list.length < 2 || ! first || ! ( 'field' in first ) ) {
		return null;
	}
	const part = ( c: Condition ): string => ( 'part' in c && c.part ) || '';
	const asked: Array<{ op: string; values: string[] }> = [];
	for ( const c of list ) {
		if ( ! ( 'field' in c ) || c.field !== first.field || part( c ) !== part( first ) || ( 'equalsText' !== c.op && 'contains' !== c.op && 'startsWith' !== c.op && 'endsWith' !== c.op ) ) {
			return null;
		}
		const last = asked[ asked.length - 1 ];
		if ( last && last.op === c.op ) {
			last.values.push( c.value );
		} else {
			asked.push( { op: c.op, values: [ c.value ] } );
		}
	}
	return { rule: first as Extract<Condition, { part?: unknown; value: string }>, asked };
}

/**
 * One condition in words, e.g. “Budget: Over 5,000 is selected”; groups inside groups in brackets.
 * `omit` leaves out the name of that field, where the place already says it (the card of its step).
 */
export function describeCondition( condition: Condition, doc: FormDocument, locale: string, fields: Map<string, Field> = fieldIndex( doc ), nested = false, omit?: string ): string {
	const same = 'any' in condition ? sameText( condition.any ) : null;
	if ( same ) {
		// "Postcode starts with 80, 81, 82": one rule with its texts instead of the same words again and again.
		const one = describeCondition( { ...same.rule, op: 'filled' } as Condition, doc, locale, fields, true, omit );
		const lead = one.slice( 0, one.length - opName( 'filled' ).length );
		const texts = same.asked.map( ( a ) => {
			const more = a.values.length - MAX_TEXTS;
			const named = a.values.slice( 0, more > 0 ? MAX_TEXTS : a.values.length ).map( ( v ) => `"${ short( v ) }"` );
			return opName( a.op as RuleOp ) + ' ' + named.join( ', ' ) + ( more > 0 ? ' ' + sprintf( /* translators: %d: number of further texts of a rule */ __( '+%d more', 'funnelforms-pro' ), more ) : '' );
		} );
		const joined = lead + texts.join( ' ' + __( 'or', 'funnelforms-pro' ) + ' ' );
		return nested ? `(${ joined })` : joined;
	}
	if ( 'all' in condition || 'any' in condition ) {
		// "At least 10 and at most 20" of one field reads as "between 10 and 20".
		const list = 'all' in condition ? withBetween( condition.all ) : condition.any;
		const joined = list
			.map( ( c ) => {
				if ( ! isBetween( c ) ) {
					return describeCondition( c, doc, locale, fields, true, omit );
				}
				const range = sprintf( '%1$s %2$s %3$s %4$s', opName( 'between' ), String( c.min ), __( 'and', 'funnelforms-pro' ), String( c.max ) );
				return c.field === omit ? range : short( fieldTitle( fields.get( c.field ), locale ) ) + ' ' + range;
			} )
			.join( ' ' + ( 'all' in condition ? __( 'and', 'funnelforms-pro' ) : __( 'or', 'funnelforms-pro' ) ) + ' ' );
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
	const bare = condition.field === omit;
	const name = short( fieldTitle( field, locale ) );
	if ( 'selected' === condition.op || 'selectedOnly' === condition.op ) {
		const option = field && 'options' in field ? field.options.find( ( o ) => o.id === condition.value ) : undefined;
		const answer = option ? strip( text( option.label, locale ) ) || option.value : __( 'deleted answer', 'funnelforms-pro' );
		if ( bare ) {
			return 'selected' === condition.op ? short( answer ) : sprintf( '%s %s', short( answer ), opName( condition.op ) );
		}
		return sprintf( '%s: %s %s', name, short( answer ), opName( condition.op ) );
	}
	let subject = bare ? '' : name;
	if ( 'part' in condition && condition.part ) {
		subject = bare ? partName( condition.part ) : sprintf( '%s (%s)', name, partName( condition.part ) );
	}
	const lead = subject ? subject + ' ' : '';
	switch ( condition.op ) {
		case 'filled':
		case 'empty':
			return lead + opName( condition.op );
		case 'equalsText':
		case 'notEqualsText':
		case 'contains':
		case 'notContains':
		case 'startsWith':
		case 'endsWith':
			return lead + sprintf( '%s "%s"', opName( condition.op ), short( condition.value ) );
		case 'dateBefore':
		case 'dateAfter':
		case 'dateOn':
			return ( bare ? '' : name + ' ' ) + sprintf( '%s %s', opName( condition.op ), dayName( condition.value, condition.days ) );
	}
	if ( 'number' in condition && 'count' === condition.number ) {
		return ( bare ? '' : name + ' ' ) + sprintf( '%s: %s', opName( ruleOp( condition ) ), String( condition.value ) );
	}
	return ( bare ? '' : name + ' ' ) + sprintf( '%s %s', opName( condition.op ), String( condition.value ) );
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

/** A number as the admin reads it, with the unit of its field. */
function numberText( field: Field, value: number, locale: string ): string {
	const number = new Intl.NumberFormat( ( 'undefined' !== typeof document && document.documentElement.lang ) || undefined, { maximumFractionDigits: 2 } ).format( value );
	const props = field.props as { unit?: { text: Record<string, string>; position: 'before' | 'after' } } | undefined;
	const word = props?.unit ? strip( text( props.unit.text, locale ) ) : '';
	if ( ! word ) {
		return number;
	}
	return 'before' === props?.unit?.position ? `${ word } ${ number }` : `${ number } ${ word }`;
}

/** Of the texts a rule on a part of an address asks for, the card names this many. */
const MAX_PART_TEXTS = 3;

/**
 * A rule on one part of an address, short enough for the card: "Postcode: 80…, 81…, 82… +5 more"
 * for codes that start with 80, 81 and so on, "Country: Austria" for exactly that text. Null for
 * other rules.
 */
function partText( when: Condition ): string | null {
	const texts: string[] = [];
	let part: AddressPart | undefined;
	for ( const rule of 'any' in when ? when.any : [ when ] ) {
		if ( ! ( 'field' in rule ) || ! ( 'part' in rule ) || ! rule.part || ( part && part !== rule.part ) || ! ( 'value' in rule ) || 'string' !== typeof rule.value || '' === rule.value.trim() ) {
			return null;
		}
		part = rule.part;
		if ( 'startsWith' === rule.op ) {
			texts.push( rule.value + '…' );
		} else if ( 'endsWith' === rule.op ) {
			texts.push( '…' + rule.value );
		} else if ( 'contains' === rule.op ) {
			texts.push( '…' + rule.value + '…' );
		} else if ( 'equalsText' === rule.op ) {
			texts.push( rule.value );
		} else {
			return null;
		}
	}
	if ( ! part ) {
		return null;
	}
	const more = texts.length - MAX_PART_TEXTS;
	return partName( part ) + ': ' + texts.slice( 0, more > 0 ? MAX_PART_TEXTS : texts.length ).join( ', ' ) + ( more > 0 ? ' ' + sprintf( /* translators: %d: number of further texts of a rule */ __( '+%d more', 'funnelforms-pro' ), more ) : '' );
}

/**
 * The words of a rule beside its sign (ports.ts, RuleOutput.symbol), on the card of its step and
 * in the list of the panel: its numbers on a number of the step ("20 m²", "20 – 30"), the answers
 * it asks for together ("Storage + Wallbox"), how many answers ("2 chosen"), otherwise the
 * condition. A step with one question leaves the name of the question out. `full`: not shortened.
 */
export function ruleText( rule: RuleOutput, doc: FormDocument, locale: string, fields: Map<string, Field> = fieldIndex( doc ), full = false ): string {
	const when = rule.edge.when;
	if ( ! when ) {
		return __( 'Always', 'funnelforms-pro' );
	}
	const n = rule.number;
	if ( n && undefined !== n.min && undefined !== n.max ) {
		return `${ numberText( n.field, n.min, locale ) } – ${ numberText( n.field, n.max, locale ) }`;
	}
	if ( n && undefined !== n.value ) {
		return numberText( n.field, n.value, locale );
	}
	if ( rule.answers ) {
		return rule.answers.options.map( ( o ) => strip( text( o.label, locale ) ) || o.value ).join( ' + ' );
	}
	if ( undefined !== rule.count ) {
		return sprintf( /* translators: %s: a number of answers, after a sign: "> 2 chosen" */ __( '%s chosen', 'funnelforms-pro' ), String( rule.count ) );
	}
	const node = doc.nodes.find( ( x ) => x.id === rule.edge.from );
	const only = node && 'step' === node.type && 1 === node.fields.length ? node.fields[ 0 ]?.id : undefined;
	if ( only && leaves( when ).every( ( l ) => 'field' in l && l.field === only ) ) {
		return ( full ? null : partText( when ) ) ?? describeCondition( when, doc, locale, fields, false, only );
	}
	return full ? describeCondition( when, doc, locale, fields ) : edgeLabel( when, doc, locale, rule.edge.from, fields );
}
