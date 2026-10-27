import type { Condition, Field, FormDocument } from '@funnelforms/form-schema';
import type { Variants } from './experiments';
import { toFloat, toInt, toText } from './numbers';

/**
 * Answers by field id: a list of option ids for choice and dropdown fields, a list of items for
 * repeat groups, a string or number for everything else.
 */
export type Answers = Record<string, unknown>;

/** Calculation results by id; a missing result counts as NaN. */
export type CalcValues = Record<string, number | null>;

/** What date conditions need: today (YYYY-MM-DD, the site's) and the format of each date field. */
export interface ConditionContext {
	today?: string;
	formats?: Record<string, string>;
}

/** Whether a condition holds. Mirrors Conditions::holds() in the plugin. */
export function holds( condition: Condition, answers: Answers, calcs: CalcValues = {}, variants: Variants = {}, context: ConditionContext = {} ): boolean {
	if ( 'all' in condition ) {
		return condition.all.every( ( c ) => holds( c, answers, calcs, variants, context ) );
	}
	if ( 'any' in condition ) {
		return condition.any.some( ( c ) => holds( c, answers, calcs, variants, context ) );
	}
	if ( 'calc' in condition ) {
		return compare( calcs[ condition.calc ] ?? NaN, condition.op, condition.value );
	}
	if ( 'experiment' in condition ) {
		return variants[ condition.experiment ] === condition.variant;
	}
	const raw = answers[ condition.field ];
	const answer = itemCount( raw );
	switch ( condition.op ) {
		case 'selected':
			return Array.isArray( answer ) && answer.includes( condition.value );
		case 'selectedOnly':
			return Array.isArray( answer ) && answer.length === 1 && answer[ 0 ] === condition.value;
		case 'filled':
		case 'empty':
			return filled( condition.part ? partOf( raw, condition.part ) : raw ) === ( condition.op === 'filled' );
		case 'equalsText':
		case 'notEqualsText':
		case 'contains':
		case 'notContains':
		case 'startsWith':
		case 'endsWith':
			return compareText( condition.part ? partOf( raw, condition.part ) : answerText( answer ), condition.op, condition.value );
		case 'dateBefore':
		case 'dateAfter':
		case 'dateOn': {
			const date = isoDate( toText( answer ).split( RANGE_SEPARATOR )[ 0 ] ?? '', context.formats?.[ condition.field ] ?? 'dd.mm.yy' );
			const day = shiftDays( condition.value === 'today' ? context.today ?? localToday() : condition.value, condition.days ?? 0 );
			if ( date === '' || day === '' ) {
				return false;
			}
			return condition.op === 'dateBefore' ? date < day : condition.op === 'dateAfter' ? date > day : date === day;
		}
	}
	if ( condition.number === 'count' ) {
		return compare( count( raw ), condition.op, condition.value );
	}
	return compare( condition.number === 'int' ? toInt( answer ) : toFloat( answer ), condition.op, condition.value );
}

/** Separator of the two dates of a period (AnswerValidator::RANGE_SEPARATOR). */
const RANGE_SEPARATOR = ' – ';

/** How many answers were chosen: the length of a list (options, files, items), otherwise 1 when filled. */
function count( answer: unknown ): number {
	return Array.isArray( answer ) ? answer.length : filled( answer ) ? 1 : 0;
}

/** Whether an answer holds something: text other than spaces, a number, a list or address with content. */
function filled( answer: unknown ): boolean {
	if ( answer === null || answer === undefined ) {
		return false;
	}
	if ( Array.isArray( answer ) ) {
		return answer.length > 0;
	}
	if ( typeof answer === 'object' ) {
		return Object.values( answer as Record<string, unknown> ).some( filled );
	}
	return toText( answer ).trim() !== '';
}

/** A part of an address answer, as text. */
function partOf( answer: unknown, part: string ): string {
	const value = answer && typeof answer === 'object' && ! Array.isArray( answer ) ? ( answer as Record<string, unknown> )[ part ] : undefined;
	return typeof value === 'string' || typeof value === 'number' ? String( value ) : '';
}

/** An answer as text; an address as its filled parts joined by commas. */
function answerText( answer: unknown ): string {
	if ( answer && typeof answer === 'object' && ! Array.isArray( answer ) ) {
		return Object.values( answer as Record<string, unknown> ).map( toText ).map( ( p ) => p.trim() ).filter( Boolean ).join( ', ' );
	}
	return toText( answer );
}

function compareText( text: string, op: 'equalsText' | 'notEqualsText' | 'contains' | 'notContains' | 'startsWith' | 'endsWith', value: string ): boolean {
	if ( op === 'equalsText' ) {
		return text === value;
	}
	if ( op === 'notEqualsText' ) {
		return text !== value;
	}
	const haystack = text.trim().toLowerCase();
	const needle = value.trim().toLowerCase();
	switch ( op ) {
		case 'contains':
			return haystack.includes( needle );
		case 'notContains':
			return ! haystack.includes( needle );
		case 'startsWith':
			return haystack.startsWith( needle );
		case 'endsWith':
			return haystack.endsWith( needle );
	}
}

/** YYYY-MM-DD of a date in a format of dd, mm and yy (four-digit year); empty when it is none. */
export function isoDate( text: string, format: string ): string {
	const order = format.match( /dd|mm|yy/g ) ?? [];
	const source = format.split( /(dd|mm|yy)/ ).map( ( part ) => ( part === 'dd' || part === 'mm' ? '(\\d{1,2})' : part === 'yy' ? '(\\d{4})' : part.replace( /[.*+?^${}()|[\]\\/-]/g, '\\$&' ) ) ).join( '' );
	const match = new RegExp( `^${ source }$` ).exec( text.trim() );
	if ( ! match || new Set( order ).size !== 3 || order.length !== 3 ) {
		return '';
	}
	const parts: Record<string, number> = {};
	order.forEach( ( key, i ) => {
		parts[ key ] = Number( match[ i + 1 ] );
	} );
	return validDate( parts.yy ?? 0, parts.mm ?? 0, parts.dd ?? 0 );
}

/** YYYY-MM-DD moved by a number of days; empty for anything but such a date. */
function shiftDays( iso: string, days: number ): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec( iso );
	if ( ! match ) {
		return '';
	}
	const date = new Date( Date.UTC( Number( match[ 1 ] ), Number( match[ 2 ] ) - 1, Number( match[ 3 ] ) + days ) );
	return date.toISOString().slice( 0, 10 );
}

function validDate( year: number, month: number, day: number ): string {
	const date = new Date( Date.UTC( year, month - 1, day ) );
	if ( date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ) {
		return '';
	}
	return date.toISOString().slice( 0, 10 );
}

/** Today in the browser's time zone, when the site's is not known. */
function localToday(): string {
	const now = new Date();
	return `${ now.getFullYear() }-${ String( now.getMonth() + 1 ).padStart( 2, '0' ) }-${ String( now.getDate() ).padStart( 2, '0' ) }`;
}

function compare( number: number, op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq', value: number ): boolean {
	if ( Number.isNaN( number ) ) {
		return op === 'neq';
	}
	switch ( op ) {
		case 'lt':
			return number < value;
		case 'lte':
			return number <= value;
		case 'gt':
			return number > value;
		case 'gte':
			return number >= value;
		case 'eq':
			return number === value;
		case 'neq':
			return number !== value;
	}
	return false;
}

/** A repeat group (a list of items) counts as its number of items; other answers stay as they are. */
export function itemCount( answer: unknown ): unknown {
	return Array.isArray( answer ) && answer.length > 0 && typeof answer[ 0 ] === 'object' && answer[ 0 ] !== null ? answer.length : answer;
}

/**
 * The node after `nodeId`: the first edge in document order whose condition holds, otherwise
 * the default edge; null when no edge applies. Mirrors Conditions::next() in the plugin.
 */
export function next( doc: Pick<FormDocument, 'edges'> & Partial<Pick<FormDocument, 'nodes'>>, nodeId: string, answers: Answers, calcs: CalcValues = {}, variants: Variants = {}, today?: string ): string | null {
	const context: ConditionContext = { today, formats: dateFormats( doc ) };
	let fallback: string | null = null;
	for ( const edge of doc.edges ) {
		if ( edge.from !== nodeId ) {
			continue;
		}
		if ( edge.default ) {
			fallback ??= edge.to;
			continue;
		}
		if ( ! edge.when || holds( edge.when, answers, calcs, variants, context ) ) {
			return edge.to;
		}
	}
	return fallback;
}

/** The format of each date field of the steps, by field id. */
function dateFormats( doc: Partial<Pick<FormDocument, 'nodes'>> ): Record<string, string> {
	const formats: Record<string, string> = {};
	for ( const node of doc.nodes ?? [] ) {
		if ( node.type === 'step' ) {
			for ( const field of node.fields ) {
				if ( field.type === 'date' ) {
					formats[ field.id ] = field.props.format;
				}
			}
		}
	}
	return formats;
}

/** Whether the edges leaving a node compare calculations, so only the plugin can pick the next node. */
export function usesCalculations( doc: Pick<FormDocument, 'edges'>, nodeId: string ): boolean {
	const has = ( c: Condition ): boolean => 'all' in c ? c.all.some( has ) : 'any' in c ? c.any.some( has ) : 'calc' in c;
	return doc.edges.some( ( edge ) => edge.from === nodeId && edge.when !== undefined && has( edge.when ) );
}

/**
 * The fields of steps that visitors see, in order, and the answers that count. A field with
 * `showWhen` is shown only while its condition holds for the answers of the shown fields before
 * it: on earlier steps and above it in its step. Hidden fields are not asked, so their answers
 * are left out. Mirrors Conditions::shown() in the plugin.
 */
export function shownAnswers( steps: ReadonlyArray<{ fields: ReadonlyArray<Field> }>, answers: Answers, variants: Variants = {}, today?: string ): { fields: Set<string>; answers: Answers } {
	const context: ConditionContext = { today, formats: dateFormats( { nodes: steps.map( ( s ) => ( { id: '', type: 'step', fields: [ ...s.fields ] } ) ) } ) };
	const fields = new Set<string>();
	const given: Answers = {};
	for ( const step of steps ) {
		for ( const field of step.fields ) {
			if ( field.showWhen && ! holds( field.showWhen, given, {}, variants, context ) ) {
				continue;
			}
			fields.add( field.id );
			if ( answers[ field.id ] !== undefined && answers[ field.id ] !== null ) {
				given[ field.id ] = answers[ field.id ];
			}
		}
	}
	return { fields, answers: given };
}
