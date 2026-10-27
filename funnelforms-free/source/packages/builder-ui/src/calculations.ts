/**
 * Calculations: formulas as text for people, the expression tree of the document for the plugin.
 * The text uses [key] for the answer of a field (as 3.x did with [question id]), numbers with a
 * dot or comma, + - * / % ^ and parentheses, with the usual order: ^ before * / %, before + -,
 * before the comparisons < <= > >= = !=. Functions take their arguments separated by ";" (a comma
 * between digits is a decimal comma): round([x]; 2), min(…), if([n] > 3; 10; 0). count([key])
 * counts the answers of a field, [key:category] gives the points of a personality quiz category
 * and {id} the result of another calculation. Printing adds the parentheses a tree needs, so trees
 * migrated from 3.x (which computed 2*3^2 as (2*3)^2) keep their order when they are edited.
 * An argument [key] of days() and age() is the date answered in that field ({ date: key }),
 * date([key]) the same anywhere else.
 */
import type { CalcFunction, Calculation, CalculationFormat, Edge, ExpressionNode, Field, FormDocument, ResultField, Text } from '@funnelforms/form-schema';
import { addStep, createField, defaultPlacement, newId, type Context } from './document';

type Op = '+' | '-' | '*' | '/' | '^' | '%';
type Cmp = '<' | '<=' | '>' | '>=' | '=' | '!=';

/** Functions with the number of arguments they take (at least, at most); Calculator::FUNCTIONS in the plugin. */
export const FUNCTIONS: Record<CalcFunction, [ number, number ]> = {
	round: [ 1, 2 ],
	floor: [ 1, 2 ],
	ceil: [ 1, 2 ],
	abs: [ 1, 1 ],
	sqrt: [ 1, 1 ],
	not: [ 1, 1 ],
	if: [ 2, 3 ],
	min: [ 1, 50 ],
	max: [ 1, 50 ],
	sum: [ 1, 50 ],
	avg: [ 1, 50 ],
	and: [ 1, 50 ],
	or: [ 1, 50 ],
	argmax: [ 1, 50 ],
	clamp: [ 3, 3 ],
	lookup: [ 4, 50 ],
	days: [ 1, 2 ],
	age: [ 1, 2 ],
};

/** Functions whose arguments [key] are dates. */
const DATED: CalcFunction[] = [ 'days', 'age' ];

export type ParseError = 'empty' | 'unexpected' | 'parenthesis' | 'end' | 'function' | 'arguments';

export type ParseResult = { ok: true; expression: ExpressionNode; vars: string[] } | { ok: false; error: ParseError; at: number };

class FormulaError extends Error {
	constructor(
		public code: Exclude<ParseError, 'empty'>,
		public at: number
	) {
		super( code );
	}
}

const ID = '[A-Za-z0-9_-]{1,80}';

/** Reads a formula. `vars` are the field keys it uses. */
export function parseFormula( source: string ): ParseResult {
	if ( '' === source.trim() ) {
		return { ok: false, error: 'empty', at: 0 };
	}
	let pos = 0;
	const vars: string[] = [];
	const useVar = ( key: string ): void => {
		if ( ! vars.includes( key ) ) {
			vars.push( key );
		}
	};
	const skip = (): void => {
		while ( pos < source.length && /\s/.test( source.charAt( pos ) ) ) {
			pos++;
		}
	};
	const peek = ( n = 1 ): string => {
		skip();
		return source.slice( pos, pos + n );
	};
	const expr = (): ExpressionNode => {
		const left = sum();
		const m = /^(<=|>=|==|!=|<>|<|>|=)/.exec( peek( 2 ) );
		if ( ! m || undefined === m[ 1 ] ) {
			return left;
		}
		pos += m[ 1 ].length;
		const map: Record<string, Cmp> = { '==': '=', '<>': '!=' };
		const cmp = ( map[ m[ 1 ] ] ?? m[ 1 ] ) as Cmp;
		return { cmp, args: [ left, sum() ] };
	};
	const sum = (): ExpressionNode => {
		let left = term();
		for ( let c = peek(); '+' === c || '-' === c; c = peek() ) {
			pos++;
			left = { op: c, args: [ left, term() ] };
		}
		return left;
	};
	const term = (): ExpressionNode => {
		let left = unary();
		for ( let c = peek(); '*' === c || '/' === c || '%' === c; c = peek() ) {
			pos++;
			left = { op: c, args: [ left, unary() ] };
		}
		return left;
	};
	const unary = (): ExpressionNode => {
		const c = peek();
		if ( '-' === c || '+' === c ) {
			pos++;
			const inner = unary();
			return '+' === c ? inner : { neg: inner };
		}
		return power();
	};
	const power = (): ExpressionNode => {
		const base = primary();
		if ( '^' === peek() ) {
			pos++;
			return { op: '^', args: [ base, unary() ] };
		}
		return base;
	};
	const field = (): { key: string; category?: string } | null => {
		const m = new RegExp( `^\\[\\s*(${ ID })\\s*(?::\\s*(${ ID })\\s*)?\\]` ).exec( source.slice( pos ) );
		if ( ! m || undefined === m[ 1 ] ) {
			return null;
		}
		pos += m[ 0 ].length;
		return m[ 2 ] ? { key: m[ 1 ], category: m[ 2 ] } : { key: m[ 1 ] };
	};
	const call = ( name: string, start: number ): ExpressionNode => {
		pos++; // (
		if ( 'count' === name || 'date' === name ) {
			skip();
			const ref = field();
			if ( ! ref || ref.category ) {
				throw new FormulaError( 'unexpected', pos );
			}
			if ( ')' !== peek() ) {
				throw new FormulaError( 'parenthesis', start );
			}
			pos++;
			useVar( ref.key );
			return 'count' === name ? { count: ref.key } : { date: ref.key };
		}
		if ( ! ( name in FUNCTIONS ) ) {
			throw new FormulaError( 'function', start );
		}
		const fn = name as CalcFunction;
		const args: ExpressionNode[] = [ expr() ];
		for ( let c = peek(); ';' === c || ',' === c; c = peek() ) {
			pos++;
			args.push( expr() );
		}
		if ( ')' !== peek() ) {
			throw new FormulaError( '' === peek() ? 'parenthesis' : 'unexpected', '' === peek() ? start : pos );
		}
		pos++;
		const [ least, most ] = FUNCTIONS[ fn ];
		if ( args.length < least || args.length > most || ( 'lookup' === fn && args.length % 2 ) ) {
			throw new FormulaError( 'arguments', start );
		}
		return { fn, args: DATED.includes( fn ) ? args.map( ( a ) => ( 'var' in a ? { date: a.var } : a ) ) : args };
	};
	const primary = (): ExpressionNode => {
		const c = peek();
		const start = pos;
		if ( '(' === c ) {
			pos++;
			const inner = expr();
			if ( ')' !== peek() ) {
				throw new FormulaError( 'parenthesis', start );
			}
			pos++;
			return inner;
		}
		if ( '[' === c ) {
			const ref = field();
			if ( ! ref ) {
				throw new FormulaError( 'unexpected', start );
			}
			useVar( ref.key );
			return ref.category ? { score: ref.key, category: ref.category } : { var: ref.key };
		}
		if ( '{' === c ) {
			const m = new RegExp( `^\\{\\s*(${ ID })\\s*\\}` ).exec( source.slice( pos ) );
			if ( ! m || undefined === m[ 1 ] ) {
				throw new FormulaError( 'unexpected', start );
			}
			pos += m[ 0 ].length;
			return { ref: m[ 1 ] };
		}
		const name = /^([A-Za-z]+)\s*\(/.exec( source.slice( pos ) );
		if ( name && undefined !== name[ 1 ] ) {
			pos += name[ 0 ].length - 1;
			return call( name[ 1 ].toLowerCase(), start );
		}
		const m = /^(\d+(?:[.,]\d+)?|[.,]\d+)/.exec( source.slice( pos ) );
		if ( m && undefined !== m[ 1 ] ) {
			pos += m[ 1 ].length;
			return { num: Number( m[ 1 ].replace( ',', '.' ) ) };
		}
		throw new FormulaError( '' === c ? 'end' : 'unexpected', start );
	};
	try {
		const expression = expr();
		if ( '' !== peek() ) {
			throw new FormulaError( ')' === peek() ? 'parenthesis' : 'unexpected', pos );
		}
		return { ok: true, expression, vars };
	} catch ( e ) {
		if ( e instanceof FormulaError ) {
			return { ok: false, error: e.code, at: e.at };
		}
		throw e;
	}
}

const LEVEL: Record<Op, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 4 };

function level( node: ExpressionNode ): number {
	if ( 'cmp' in node ) {
		return 0;
	}
	if ( 'op' in node ) {
		return LEVEL[ node.op ];
	}
	if ( 'neg' in node || ( 'num' in node && node.num < 0 ) ) {
		return 3;
	}
	return 5;
}

function number( n: number ): string {
	// Plain digits: the parser takes no exponent notation.
	return n.toLocaleString( 'en-US', { useGrouping: false, maximumFractionDigits: 20 } );
}

/** The formula of a tree, with the parentheses it needs. */
export function printFormula( node: ExpressionNode ): string {
	const wrap = ( child: ExpressionNode, min: number ): string => ( level( child ) < min ? `(${ printFormula( child ) })` : printFormula( child ) );
	if ( 'num' in node ) {
		return number( node.num );
	}
	if ( 'var' in node ) {
		return `[${ node.var }]`;
	}
	if ( 'count' in node ) {
		return `count([${ node.count }])`;
	}
	if ( 'score' in node ) {
		return `[${ node.score }:${ node.category }]`;
	}
	if ( 'ref' in node ) {
		return `{${ node.ref }}`;
	}
	if ( 'date' in node ) {
		return `date([${ node.date }])`;
	}
	if ( 'fn' in node ) {
		const dated = DATED.includes( node.fn );
		return `${ node.fn }(${ node.args.map( ( a ) => ( dated && 'date' in a ? `[${ a.date }]` : printFormula( a ) ) ).join( '; ' ) })`;
	}
	if ( 'neg' in node ) {
		return '-' + wrap( node.neg, 3 );
	}
	const [ a, b ] = node.args;
	if ( 'cmp' in node ) {
		return `${ wrap( a, 1 ) } ${ node.cmp } ${ wrap( b, 1 ) }`;
	}
	if ( '^' === node.op ) {
		return `${ wrap( a, 5 ) } ^ ${ wrap( b, 3 ) }`;
	}
	return `${ wrap( a, LEVEL[ node.op ] ) } ${ node.op } ${ wrap( b, LEVEL[ node.op ] + 1 ) }`;
}

function children( node: ExpressionNode ): ExpressionNode[] {
	if ( 'neg' in node ) {
		return [ node.neg ];
	}
	return 'args' in node ? node.args : [];
}

/** Field keys a tree uses. */
export function formulaVars( node: ExpressionNode, out: string[] = [] ): string[] {
	const key = 'var' in node ? node.var : 'count' in node ? node.count : 'score' in node ? node.score : 'date' in node ? node.date : null;
	if ( null !== key && ! out.includes( key ) ) {
		out.push( key );
	}
	children( node ).forEach( ( c ) => formulaVars( c, out ) );
	return out;
}

/** Ids of the calculations a tree uses. */
export function formulaRefs( node: ExpressionNode, out: string[] = [] ): string[] {
	if ( 'ref' in node && ! out.includes( node.ref ) ) {
		out.push( node.ref );
	}
	children( node ).forEach( ( c ) => formulaRefs( c, out ) );
	return out;
}

/** Whether a calculation uses itself, through others or directly. */
export function inCycle( doc: Pick<FormDocument, 'calculations'>, id: string, expression?: ExpressionNode ): boolean {
	const seen = new Set<string>();
	const walk = ( refs: string[] ): boolean =>
		refs.some( ( ref ) => {
			if ( ref === id ) {
				return true;
			}
			if ( seen.has( ref ) ) {
				return false;
			}
			seen.add( ref );
			const calc = doc.calculations.find( ( c ) => c.id === ref );
			return calc ? walk( formulaRefs( calc.expression ) ) : false;
		} );
	return walk( formulaRefs( expression ?? doc.calculations.find( ( c ) => c.id === id )?.expression ?? { num: 0 } ) );
}

const truthy = ( v: number ): boolean => 0 !== v && ! Number.isNaN( v );

/** Rounds half away from zero, down or up to decimal places (negative: tens, hundreds …), as the plugin. */
export function roundTo( how: 'round' | 'floor' | 'ceil', value: number, decimals = 0 ): number {
	const d = Math.max( -10, Math.min( 10, Math.trunc( decimals ) ) );
	const factor = 10 ** d;
	const scaled = Number( ( value * factor ).toPrecision( 15 ) );
	if ( 'round' === how ) {
		return ( Math.sign( scaled ) * Math.round( Math.abs( scaled ) ) ) / factor;
	}
	return ( 'floor' === how ? Math.floor( scaled ) : Math.ceil( scaled ) ) / factor;
}

function compare( op: Cmp, a: number, b: number ): boolean {
	const equal = Math.abs( a - b ) <= 1e-9 * Math.max( 1, Math.abs( a ), Math.abs( b ) );
	switch ( op ) {
		case '<':
			return a < b && ! equal;
		case '<=':
			return a < b || equal;
		case '>':
			return a > b && ! equal;
		case '>=':
			return a > b || equal;
		case '=':
			return equal;
		default:
			return ! equal;
	}
}

/**
 * Computes a tree like Domain\Form\Calculator; null where the plugin reports an error. Values hold
 * the field keys and, as Calculator::values() puts them, count:<key>, score:<key>:<category> and
 * calc:<id>.
 */
export function evaluate( node: ExpressionNode, values: Record<string, number> ): number | null {
	const run = ( n: ExpressionNode ): number => {
		if ( 'num' in n ) {
			return n.num;
		}
		if ( 'var' in n ) {
			return values[ n.var ] ?? 0;
		}
		if ( 'neg' in n ) {
			return -run( n.neg );
		}
		if ( 'count' in n ) {
			return values[ 'count:' + n.count ] ?? 0;
		}
		if ( 'score' in n ) {
			return values[ `score:${ n.score }:${ n.category }` ] ?? 0;
		}
		if ( 'ref' in n ) {
			return values[ 'calc:' + n.ref ] ?? NaN;
		}
		if ( 'date' in n ) {
			return values[ 'date:' + n.date ] ?? NaN;
		}
		if ( 'fn' in n ) {
			return call( n.fn, n.args );
		}
		const a = run( n.args[ 0 ] );
		const b = run( n.args[ 1 ] );
		if ( 'cmp' in n ) {
			return compare( n.cmp, a, b ) ? 1 : 0;
		}
		switch ( n.op ) {
			case '+':
				return a + b;
			case '-':
				return a - b;
			case '*':
				return a * b;
			case '/':
				if ( 0 === b ) {
					throw new RangeError( 'division by zero' );
				}
				return a / b;
			case '^':
				return a ** b;
			case '%':
				if ( 0 === Math.trunc( b ) ) {
					throw new RangeError( 'modulo by zero' );
				}
				return Math.trunc( a ) % Math.trunc( b );
		}
	};
	const call = ( fn: CalcFunction, args: ExpressionNode[] ): number => {
		const [ least, most ] = FUNCTIONS[ fn ] ?? [ 1, 0 ];
		if ( args.length < least || args.length > most ) {
			return NaN;
		}
		if ( 'if' === fn ) {
			const [ c, yes, no ] = args as [ ExpressionNode, ExpressionNode, ExpressionNode | undefined ];
			return truthy( run( c ) ) ? run( yes ) : no ? run( no ) : 0;
		}
		if ( 'days' === fn || 'age' === fn ) {
			return dated( fn, args, values, run );
		}
		const n = args.map( run );
		const first = n[ 0 ] ?? NaN;
		switch ( fn ) {
			case 'round':
			case 'floor':
			case 'ceil':
				return roundTo( fn, first, n[ 1 ] ?? 0 );
			case 'abs':
				return Math.abs( first );
			case 'sqrt':
				return first < 0 ? NaN : Math.sqrt( first );
			case 'not':
				return truthy( first ) ? 0 : 1;
			case 'min':
				return Math.min( ...n );
			case 'max':
				return Math.max( ...n );
			case 'sum':
				return n.reduce( ( x, y ) => x + y, 0 );
			case 'avg':
				return n.reduce( ( x, y ) => x + y, 0 ) / n.length;
			case 'and':
				return n.every( truthy ) ? 1 : 0;
			case 'or':
				return n.some( truthy ) ? 1 : 0;
			case 'argmax': {
				if ( n.some( Number.isNaN ) ) {
					return NaN;
				}
				let best = 0;
				n.forEach( ( v, i ) => {
					if ( v > ( n[ best ] ?? -Infinity ) ) {
						best = i;
					}
				} );
				return best + 1;
			}
			case 'clamp': {
				const [ x = NaN, lo = NaN, hi = NaN ] = n;
				if ( [ x, lo, hi ].some( Number.isNaN ) ) {
					return NaN;
				}
				return x < lo ? lo : x > hi ? hi : x;
			}
			case 'lookup': {
				if ( n.length % 2 ) {
					return NaN;
				}
				for ( let i = 1; i < n.length - 1; i += 2 ) {
					if ( compare( '<=', first, n[ i ] as number ) ) {
						return n[ i + 1 ] as number;
					}
				}
				return n[ n.length - 1 ] as number;
			}
		}
		return NaN;
	};
	try {
		const v = run( node );
		return Number.isFinite( v ) ? v : null;
	} catch {
		return null;
	}
}

/** Day number (days since 1970-01-01) of a date YYYY-MM-DD in UTC; the plugin's Calculator::day(). */
function dayNumber( year: number, month: number, day: number ): number {
	return Math.round( Date.UTC( year, month - 1, day ) / 86400000 );
}

/** Day number of today in the browser's time zone. */
export function today(): number {
	const now = new Date();
	return dayNumber( now.getFullYear(), now.getMonth() + 1, now.getDate() );
}

/** Day number of a date in a format of dd, mm and yy (four-digit year); null when it is none. Conditions::iso_date(). */
export function dateDay( text: string, format: string ): number | null {
	const order = format.match( /dd|mm|yy/g ) ?? [];
	const source = format
		.split( /(dd|mm|yy)/ )
		.map( ( part ) => ( 'dd' === part || 'mm' === part ? '(\\d{1,2})' : 'yy' === part ? '(\\d{4})' : part.replace( /[.*+?^${}()|[\]\\/-]/g, '\\$&' ) ) )
		.join( '' );
	const m = new RegExp( `^${ source }$` ).exec( text.trim() );
	if ( ! m || 3 !== order.length || 3 !== new Set( order ).size ) {
		return null;
	}
	const p: Record<string, number> = {};
	order.forEach( ( key, i ) => ( p[ key ] = Number( m[ i + 1 ] ) ) );
	const [ y = 0, mo = 0, d = 0 ] = [ p.yy, p.mm, p.dd ];
	const date = new Date( Date.UTC( y, mo - 1, d ) );
	return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? dayNumber( y, mo, d ) : null;
}

/**
 * days() and age() as Calculator::dated(): days from today to a date or between two dates (of a
 * period alone: its length), full years from a date until today or between two; 0 without a date.
 */
function dated( fn: 'days' | 'age', args: ExpressionNode[], values: Record<string, number>, run: ( n: ExpressionNode ) => number ): number {
	const now = values[ 'today:' ] ?? today();
	const [ first = { num: NaN }, second ] = args;
	let from = run( first );
	let to = second ? run( second ) : now;
	if ( 'days' === fn && ! second ) {
		const end = 'date' in first ? values[ `date:${ first.date }:end` ] : undefined;
		to = undefined === end ? from : end;
		from = undefined === end ? now : from;
	}
	if ( ! Number.isFinite( from ) || ! Number.isFinite( to ) ) {
		return 0;
	}
	from = Math.floor( from );
	to = Math.floor( to );
	if ( 'days' === fn ) {
		return to - from;
	}
	const sign = to < from ? -1 : 1;
	const [ early, late ] = ( 1 === sign ? [ from, to ] : [ to, from ] ).map( ( day ) => new Date( day * 86400000 ) ) as [ Date, Date ];
	const before = late.getUTCMonth() < early.getUTCMonth() || ( late.getUTCMonth() === early.getUTCMonth() && late.getUTCDate() < early.getUTCDate() );
	return sign * ( late.getUTCFullYear() - early.getUTCFullYear() - ( before ? 1 : 0 ) );
}

/**
 * Text of the range a result lies in (Calculation.texts), as Calculator::range_text(): the first
 * that holds it; null without one.
 */
export function rangeText( calc: Pick<Calculation, 'texts'>, value: number | null | undefined ): Text | null {
	if ( null === value || undefined === value || Number.isNaN( value ) ) {
		return null;
	}
	const range = ( calc.texts ?? [] ).find( ( r ) => ! ( ( undefined !== r.from && compare( '<', value, r.from ) ) || ( undefined !== r.to && compare( '>', value, r.to ) ) ) );
	return range ? range.text : null;
}

/** A result as the plugin prints it (PHP number_format: half away from zero), with the text before and after. */
export function formatResult( value: number, format: CalculationFormat ): string {
	const decimals = Math.max( 0, Math.min( 10, format.decimals ) );
	const factor = 10 ** decimals;
	const rounded = Math.sign( value ) * Math.round( Number( ( Math.abs( value ) * factor ).toPrecision( 15 ) ) ) / factor;
	const [ whole = '0', part = '' ] = Math.abs( rounded ).toFixed( decimals ).split( '.' );
	const grouped = whole.replace( /\B(?=(\d{3})+(?!\d))/g, format.thousandsSeparator );
	return ( format.prefix ?? '' ) + ( rounded < 0 ? '-' : '' ) + grouped + ( decimals > 0 ? format.decimalSeparator + part : '' ) + ( format.suffix ?? '' );
}

/** Right answers of a choice or dropdown field (knowledge quiz). */
function rightAnswers( field: Field ): string[] {
	return 'options' in field && ( 'choice' === field.type || 'dropdown' === field.type ) ? field.options.filter( ( o ) => true === o.correct ).map( ( o ) => o.id ) : [];
}

/** The number one answer contributes; Calculator::value() in the plugin. */
export function fieldValue( field: Field, answer: unknown ): number {
	switch ( field.type ) {
		case 'choice':
		case 'dropdown': {
			const chosen = Array.isArray( answer ) ? answer.map( String ) : [];
			const right = rightAnswers( field );
			if ( right.length ) {
				const a = [ ...new Set( chosen ) ].sort();
				const b = [ ...right ].sort();
				return a.length === b.length && a.every( ( x, i ) => x === b[ i ] ) ? 1 : 0;
			}
			return field.options.reduce( ( sum, o ) => sum + ( chosen.includes( o.id ) && undefined !== o.calcValue ? o.calcValue : 0 ), 0 );
		}
		case 'repeat':
			return Array.isArray( answer ) ? answer.length : 0;
		case 'slider':
		case 'number':
		case 'rating':
		case 'text':
		case 'textarea': {
			const n = parseFloat( Array.isArray( answer ) ? answer.map( String ).join( ',' ) : String( answer ?? '' ) );
			return Number.isFinite( n ) ? n : 0;
		}
	}
	return 0;
}

function filled( answer: unknown ): boolean {
	if ( Array.isArray( answer ) ) {
		return answer.some( filled );
	}
	if ( answer && 'object' === typeof answer ) {
		return Object.values( answer ).some( filled );
	}
	return null !== answer && undefined !== answer && '' !== String( answer ).trim();
}

/**
 * Values of the answers by field id, for the builder's test: like Calculator::values() with the
 * fields in document order and the results of all calculations.
 */
export function testValues( doc: Pick<FormDocument, 'nodes' | 'calculations'>, answers: Record<string, unknown>, day = today() ): Record<string, number> {
	const values: Record<string, number> = { 'today:': day };
	for ( const node of doc.nodes ) {
		for ( const field of 'step' === node.type ? node.fields : [] ) {
			if ( ! ( field.id in answers ) ) {
				continue;
			}
			const answer = answers[ field.id ];
			values[ field.key ] = fieldValue( field, answer );
			values[ 'count:' + field.key ] = Array.isArray( answer ) ? answer.length : filled( answer ) ? 1 : 0;
			Object.keys( values ).filter( ( name ) => name.startsWith( `score:${ field.key }:` ) || name === `date:${ field.key }` || name === `date:${ field.key }:end` ).forEach( ( name ) => Reflect.deleteProperty( values, name ) );
			if ( 'date' === field.type && 'string' === typeof answer ) {
				answer.split( ' – ' ).slice( 0, 2 ).forEach( ( part, i ) => {
					const d = dateDay( part, field.props.format );
					if ( null !== d ) {
						values[ `date:${ field.key }${ i ? ':end' : '' }` ] = d;
					}
				} );
			}
			if ( 'options' in field && Array.isArray( answer ) ) {
				for ( const option of field.options ) {
					if ( answer.includes( option.id ) ) {
						for ( const [ category, points ] of Object.entries( option.scores ?? {} ) ) {
							values[ `score:${ field.key }:${ category }` ] = ( values[ `score:${ field.key }:${ category }` ] ?? 0 ) + points;
						}
					}
				}
			}
		}
	}
	const state = new Map<string, 'busy' | 'done'>();
	const visit = ( id: string, depth: number ): void => {
		if ( state.has( id ) ) {
			if ( 'busy' === state.get( id ) ) {
				values[ 'calc:' + id ] = NaN;
			}
			return;
		}
		state.set( id, 'busy' );
		const calc = doc.calculations.find( ( c ) => c.id === id );
		if ( ! calc || depth > 20 ) {
			values[ 'calc:' + id ] = NaN;
		} else {
			formulaRefs( calc.expression ).forEach( ( ref ) => visit( ref, depth + 1 ) );
			if ( ! ( 'calc:' + id in values ) ) {
				values[ 'calc:' + id ] = calc.legacy?.error ? NaN : evaluate( calc.expression, values ) ?? NaN;
			}
		}
		state.set( id, 'done' );
	};
	doc.calculations.forEach( ( c ) => visit( c.id, 0 ) );
	return values;
}

/** Number format of a language: German style for German, Italian, Spanish, French with a space. */
export function localeFormat( locale: string ): CalculationFormat {
	const lang = locale.slice( 0, 2 );
	if ( 'fr' === lang ) {
		return { decimals: 2, decimalSeparator: ',', thousandsSeparator: ' ' };
	}
	if ( 'de_CH' === locale ) {
		return { decimals: 2, decimalSeparator: '.', thousandsSeparator: '’' };
	}
	if ( [ 'de', 'it', 'es', 'nl', 'pt', 'da' ].includes( lang ) ) {
		return { decimals: 2, decimalSeparator: ',', thousandsSeparator: '.' };
	}
	return { decimals: 2, decimalSeparator: '.', thousandsSeparator: ',' };
}

export function addCalculation( doc: FormDocument, label: string ): string {
	const id = newId( doc, 'calc' );
	doc.calculations.push( { id, label, expression: { num: 0 }, format: localeFormat( doc.locales.default ) } );
	return id;
}

export type FormulaResult = ParseResult | { ok: false; error: 'reference' | 'cycle'; at: number; ref: string };

/** Reads the formula of a calculation: like parseFormula, and the other calculations it names exist and do not use it. */
export function readFormula( doc: Pick<FormDocument, 'calculations'>, id: string, source: string ): FormulaResult {
	const parsed = parseFormula( source );
	if ( ! parsed.ok ) {
		return parsed;
	}
	for ( const ref of formulaRefs( parsed.expression ) ) {
		if ( ref === id || ! doc.calculations.some( ( c ) => c.id === ref ) ) {
			return { ok: false, error: ref === id ? 'cycle' : 'reference', at: Math.max( 0, source.indexOf( `{${ ref }` ) ), ref };
		}
	}
	if ( inCycle( doc, id, parsed.expression ) ) {
		return { ok: false, error: 'cycle', at: 0, ref: formulaRefs( parsed.expression )[ 0 ] ?? id };
	}
	return parsed;
}

/** Sets the formula when it can be read; returns the result of reading it. */
export function setFormula( doc: FormDocument, id: string, source: string ): FormulaResult {
	const parsed = readFormula( doc, id, source );
	const calc = doc.calculations.find( ( c ) => c.id === id );
	if ( parsed.ok && calc ) {
		calc.expression = parsed.expression;
		// A formula written here replaces the one from 3.x, and with it its error.
		delete calc.legacy;
	}
	return parsed;
}

export type CalculationUse = 'path' | 'text' | 'result' | 'payment' | 'conversion' | 'score' | 'quiz' | 'calculation' | 'value';

/** Where a calculation is used; deleting it would break these. */
export function calculationUses( doc: FormDocument, id: string ): CalculationUse[] {
	const out = new Set<CalculationUse>();
	const hasCalc = ( value: unknown ): boolean => {
		if ( Array.isArray( value ) ) {
			return value.some( hasCalc );
		}
		if ( value && 'object' === typeof value ) {
			return ( 'calc' in value && ( value as { calc: unknown } ).calc === id ) || Object.values( value ).some( hasCalc );
		}
		return false;
	};
	if ( doc.edges.some( ( e ) => hasCalc( e.when ) ) ) {
		out.add( 'path' );
	}
	const token = `{{calc:${ id }}}`;
	const texts = JSON.stringify( { ...doc, calculations: [] } );
	if ( texts.includes( token ) || texts.includes( `{{calc:${ id }:text}}` ) ) {
		out.add( 'text' );
	}
	const shown = ( field: { type: string; props?: unknown } ): boolean =>
		'result' === field.type && ( field.props as ResultField[ 'props' ] ).lines.some( ( l ) => l.calculation === id || l.to === id );
	if ( doc.nodes.some( ( n ) => 'step' === n.type && n.fields.some( shown ) ) ) {
		out.add( 'result' );
	}
	const payment = doc.settings.payment;
	if ( payment && 'calculation' in payment.amount && payment.amount.calculation === id ) {
		out.add( 'payment' );
	}
	if ( doc.actions.some( ( a ) => ( 'conversion' === a.kind || 'googleAds' === a.kind ) && a.config.valueCalculation === id ) ) {
		out.add( 'conversion' );
	}
	if ( doc.settings.scoreCalculation === id ) {
		out.add( 'score' );
	}
	if ( doc.settings.valueCalculation === id ) {
		out.add( 'value' );
	}
	if ( doc.settings.quiz?.calculation === id ) {
		out.add( 'quiz' );
	}
	if ( doc.calculations.some( ( c ) => c.id !== id && formulaRefs( c.expression ).includes( id ) ) ) {
		out.add( 'calculation' );
	}
	return [ ...out ];
}

export function removeCalculation( doc: FormDocument, id: string ): boolean {
	if ( calculationUses( doc, id ).length ) {
		return false;
	}
	doc.calculations = doc.calculations.filter( ( c ) => c.id !== id );
	return true;
}

/**
 * Adds a step that shows the result, before the first contact step: a content element with the
 * label and the placeholder (the runtime fills it in from the answers so far).
 */
export function addResultStep( doc: FormDocument, id: string, ctx: Context ): string | null {
	const calc = doc.calculations.find( ( c ) => c.id === id );
	if ( ! calc ) {
		return null;
	}
	const nodeId = addStep( doc, 'content', ctx, defaultPlacement( doc ) );
	const node = doc.nodes.find( ( n ) => n.id === nodeId );
	const field = node && 'step' === node.type ? node.fields[ 0 ] : undefined;
	if ( field && 'content' === field.type ) {
		const label = calc.label.replace( /[<>&"]/g, '' );
		field.props.html = { [ ctx.locale ]: `<p>${ label ? label + ': ' : '' }<strong>{{calc:${ id }}}</strong></p>` };
	}
	return nodeId;
}

/** Places a result can be shown: a new step, a live result while visitors answer, an end page or the body of a mail. */
export type ResultPlace = 'step' | 'live' | `end:${ string }` | `action:${ string }`;

/** Where the result of a calculation can still be added; places that show it already are left out. */
export function resultPlaces( doc: FormDocument, id: string ): ResultPlace[] {
	const token = `{{calc:${ id }}}`;
	const out: ResultPlace[] = [ 'step' ];
	if ( ! doc.nodes.some( ( n ) => 'step' === n.type && n.fields.some( ( f ) => 'result' === f.type && f.props.lines.some( ( l ) => l.calculation === id ) ) ) ) {
		out.push( 'live' );
	}
	for ( const node of doc.nodes ) {
		if ( 'end' === node.type && ! JSON.stringify( node.success?.text ?? {} ).includes( token ) && ( node.success || ! node.redirect ) ) {
			out.push( `end:${ node.id }` );
		}
	}
	for ( const action of doc.actions ) {
		if ( ( 'email' === action.kind || 'autoresponder' === action.kind ) && ! JSON.stringify( action.config.body ).includes( token ) ) {
			out.push( `action:${ action.id }` );
		}
	}
	return out;
}

/**
 * Shows the result of a calculation with its name: in a new step before the contact step, at the
 * end of a thank-you page or at the end of a mail. Returns the node or action it went to.
 */
export function showResultIn( doc: FormDocument, id: string, place: ResultPlace, ctx: Context ): string | null {
	const calc = doc.calculations.find( ( c ) => c.id === id );
	if ( ! calc ) {
		return null;
	}
	if ( 'step' === place ) {
		return addResultStep( doc, id, ctx );
	}
	if ( 'live' === place ) {
		return addLiveResult( doc, id, ctx );
	}
	const label = calc.label.replace( /[<>&"]/g, '' );
	const line = `<p>${ label ? label + ': ' : '' }<strong>{{calc:${ id }}}</strong></p>`;
	const append = ( value: string | undefined ): string => ( value?.trim() ? value.trimEnd() + '\n' : '' ) + line;
	if ( place.startsWith( 'end:' ) ) {
		const node = doc.nodes.find( ( n ) => n.id === place.slice( 4 ) );
		if ( ! node || 'end' !== node.type ) {
			return null;
		}
		node.success = { ...( node.success ?? { show: true, text: {} } ), show: true };
		node.success.text = { ...node.success.text, [ ctx.locale ]: append( node.success.text[ ctx.locale ] ) };
		return node.id;
	}
	const action = doc.actions.find( ( a ) => a.id === place.slice( 7 ) );
	if ( ! action || ( 'email' !== action.kind && 'autoresponder' !== action.kind ) ) {
		return null;
	}
	const body = action.config.body[ ctx.locale ] ?? '';
	// Mails written as plain text (line breaks become <br>) take a plain line.
	action.config.body = { ...action.config.body, [ ctx.locale ]: /<\w/.test( body ) ? append( body ) : ( body.trim() ? body.trimEnd() + '\n\n' : '' ) + `${ label ? label + ': ' : '' }{{calc:${ id }}}` };
	return action.id;
}

export type ResultOp = 'gte' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq';

/** One way on after a step that depends on a result: "from 1000 on, go to …". */
export interface ResultRule {
	edge: string;
	op: ResultOp;
	value: number;
	to: string;
}

/** A rule of a path whose whole condition compares this calculation, or null. */
function ruleOf( edge: Edge, id: string ): ResultRule | null {
	const when = edge.when;
	return when && 'calc' in when && when.calc === id ? { edge: edge.id, op: when.op, value: when.value, to: edge.to } : null;
}

/** Steps whose paths depend on the result, with the rules in the order they are checked and the default way. */
export function resultPaths( doc: FormDocument, id: string ): Array<{ node: string; rules: ResultRule[]; otherwise: string | null }> {
	const nodes: string[] = [];
	for ( const edge of doc.edges ) {
		if ( ruleOf( edge, id ) && ! nodes.includes( edge.from ) ) {
			nodes.push( edge.from );
		}
	}
	return nodes.map( ( node ) => ( {
		node,
		rules: doc.edges.filter( ( e ) => e.from === node ).flatMap( ( e ) => ruleOf( e, id ) ?? [] ),
		otherwise: doc.edges.find( ( e ) => e.from === node && e.default )?.to ?? null,
	} ) );
}

/**
 * Adds a rule after a step: from the result `value` on, the visitor goes to `to`. Rules come
 * before the other paths of the step, highest values first is up to the order they are added. A
 * path of the step without condition becomes its default way, which the rules are checked before.
 */
export function addResultRule( doc: FormDocument, node: string, id: string, to: string, value = 0 ): string | null {
	const source = doc.nodes.find( ( n ) => n.id === node );
	if ( ! source || 'end' === source.type || ! doc.nodes.some( ( n ) => n.id === to ) || ! doc.calculations.some( ( c ) => c.id === id ) ) {
		return null;
	}
	const plain = doc.edges.find( ( e ) => e.from === node && ! e.when && ! e.default );
	if ( plain && ! doc.edges.some( ( e ) => e.from === node && e.default ) ) {
		plain.default = true;
	}
	const edge: Edge = { id: newId( doc, 'e' ), from: node, to, when: { calc: id, op: 'gte', value } };
	const last = doc.edges.reduce( ( at, e, i ) => ( ruleOf( e, id ) && e.from === node ? i : at ), -1 );
	const first = doc.edges.findIndex( ( e ) => e.from === node );
	doc.edges.splice( last >= 0 ? last + 1 : first >= 0 ? first : doc.edges.length, 0, edge );
	return edge.id;
}

export function setResultRule( doc: FormDocument, edgeId: string, id: string, patch: Partial<Omit<ResultRule, 'edge'>> ): void {
	const edge = doc.edges.find( ( e ) => e.id === edgeId );
	const rule = edge ? ruleOf( edge, id ) : null;
	if ( ! edge || ! rule ) {
		return;
	}
	edge.when = { calc: id, op: patch.op ?? rule.op, value: Number.isFinite( patch.value ) ? ( patch.value as number ) : rule.value };
	if ( patch.to && doc.nodes.some( ( n ) => n.id === patch.to ) && patch.to !== edge.from ) {
		edge.to = patch.to;
	}
}

/** The way after a step when no rule holds. */
export function setOtherwise( doc: FormDocument, node: string, to: string ): void {
	const edge = doc.edges.find( ( e ) => e.from === node && e.default );
	if ( edge ) {
		edge.to = to;
	} else if ( to !== node && doc.nodes.some( ( n ) => n.id === to ) ) {
		doc.edges.push( { id: newId( doc, 'e' ), from: node, to, default: true } );
	}
}

/** Removes a path (a rule of a result). */
export function removeEdgeOf( doc: FormDocument, edgeId: string ): void {
	doc.edges = doc.edges.filter( ( e ) => e.id !== edgeId );
}

/** Fields of a calculation, also through the calculations it uses. */
function usedKeys( doc: Pick<FormDocument, 'calculations'>, id: string, seen = new Set<string>() ): string[] {
	const calc = doc.calculations.find( ( c ) => c.id === id );
	if ( ! calc || seen.has( id ) ) {
		return [];
	}
	seen.add( id );
	return [ ...formulaVars( calc.expression ), ...formulaRefs( calc.expression ).flatMap( ( ref ) => usedKeys( doc, ref, seen ) ) ];
}

/**
 * Adds a live result of a calculation (a box that stays visible): to the first step on the way from
 * the start that asks for a field it uses, else to the first step. Returns the step.
 */
export function addLiveResult( doc: FormDocument, id: string, ctx: Context ): string | null {
	const keys = usedKeys( doc, id );
	const steps: string[] = [];
	const queue = doc.start ? [ doc.start ] : [];
	while ( queue.length ) {
		const node = queue.shift() as string;
		if ( ! steps.includes( node ) ) {
			steps.push( node );
			queue.push( ...doc.edges.filter( ( e ) => e.from === node ).map( ( e ) => e.to ) );
		}
	}
	const all = [ ...steps, ...doc.nodes.map( ( n ) => n.id ) ].map( ( n ) => doc.nodes.find( ( x ) => x.id === n ) ).filter( ( n ) => 'step' === n?.type );
	const node = all.find( ( n ) => 'step' === n?.type && n.fields.some( ( f ) => keys.includes( f.key ) ) ) ?? all[ 0 ];
	if ( ! node || 'step' !== node.type ) {
		return null;
	}
	const field = createField( doc, 'result', ctx );
	if ( 'result' === field.type ) {
		field.props.lines = field.props.lines.slice( 0, 1 ).map( ( line ) => ( { ...line, calculation: id } ) );
	}
	node.fields.push( field );
	return node.id;
}

/** Words that make a calculation a price, in the languages of the builder. */
const PRICE = /preis|price|cost|kosten|budget|betrag|summe|total|gesamt|prix|coût|tarif|prezzo|costo|precio|coste|importe|prijs|preço|custo/i;

/** The currency of a language where it is clear: the euro in euro countries, else none. */
export function localeCurrency( locale: string ): Pick<CalculationFormat, 'prefix' | 'suffix'> | null {
	if ( /^(de_(DE|AT|LU)|fr_(FR|BE|LU)|it_IT|es_ES|nl_(NL|BE)|pt_PT|fi|el|sk|sl|et|lv|lt|hr|mt|ga|ca|eu|gl)/.test( locale ) ) {
		return { suffix: ' €' };
	}
	if ( /^(de|fr|it)_CH/.test( locale ) ) {
		return { prefix: 'CHF ' };
	}
	return { en_US: { prefix: '$' }, en_GB: { prefix: '£' } }[ locale ] ?? null;
}

/**
 * Names a calculation. A price ("Price", "Kosten" …) whose number format nobody changed yet gets
 * whole numbers and the currency of the form's language.
 */
export function nameCalculation( doc: FormDocument, id: string, label: string ): void {
	const calc = doc.calculations.find( ( c ) => c.id === id );
	if ( ! calc ) {
		return;
	}
	calc.label = label;
	const untouched = JSON.stringify( calc.format ) === JSON.stringify( localeFormat( doc.locales.default ) );
	if ( untouched && PRICE.test( label ) ) {
		calc.format = { ...calc.format, decimals: 0, ...( localeCurrency( doc.locales.default ) ?? {} ) };
	}
}

/**
 * Renames the variable of a field ([key] in formulas) and changes the formulas and {{field:…}}
 * placeholders that use it. False when the name is not valid or another field has it.
 */
export function renameFieldKey( doc: FormDocument, fieldId: string, key: string ): boolean {
	const fields = doc.nodes.flatMap( ( n ) => ( 'end' === n.type ? [] : ( n.fields as Array<{ id: string; key: string }> ) ) );
	const field = fields.find( ( f ) => f.id === fieldId );
	if ( ! field || ! /^[A-Za-z0-9_-]+$/.test( key ) || fields.some( ( f ) => f.id !== fieldId && f.key === key ) ) {
		return false;
	}
	const old = field.key;
	if ( old === key ) {
		return true;
	}
	field.key = key;
	const visit = ( node: ExpressionNode ): void => {
		const n = node as { var?: string; count?: string; score?: string };
		for ( const k of [ 'var', 'count', 'score' ] as const ) {
			if ( n[ k ] === old ) {
				n[ k ] = key;
			}
		}
		children( node ).forEach( visit );
	};
	doc.calculations.forEach( ( c ) => visit( c.expression ) );
	const token = `{{field:${ old }}}`;
	const swap = ( value: unknown ): unknown => {
		if ( 'string' === typeof value ) {
			return value.split( token ).join( `{{field:${ key }}}` );
		}
		if ( Array.isArray( value ) ) {
			return value.map( swap );
		}
		if ( value && 'object' === typeof value ) {
			const obj = value as Record<string, unknown>;
			Object.keys( obj ).forEach( ( k ) => ( obj[ k ] = swap( obj[ k ] ) ) );
		}
		return value;
	};
	doc.nodes.forEach( swap );
	doc.actions.forEach( swap );
	return true;
}
