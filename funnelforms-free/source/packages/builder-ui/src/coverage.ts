/**
 * Which answers of a step take which of its paths, when one field of the step decides alone:
 * the answers left for "Otherwise" and the paths no answer reaches. Worked out by trying the
 * answers the field can give (every option, every position of a slider, every number around the
 * values the rules compare with) on the paths in their order, as the form does (form-core).
 */
import { holds } from '@funnelforms/form-core';
import type { Edge, Field, FormDocument, FormNode, Option } from '@funnelforms/form-schema';
import { leaves } from './document';

/** Numbers from one value to another; a side without a value has no bound, an open side leaves its value out. */
export interface Span {
	from?: number;
	to?: number;
	fromOpen?: boolean;
	toOpen?: boolean;
}

export interface Coverage {
	/** The field whose answers decide. */
	field: Field;
	/** Every answer takes a path with a condition, so "Otherwise" is not needed. */
	complete: boolean;
	/** The answers no path with a condition takes. */
	rest: {
		/** Answers of a choice or dropdown (for several answers: chosen alone). */
		options: Option[];
		/** Numbers of a slider, a rating or a number field. */
		spans: Span[];
		/** Visitors who give no answer. */
		none: boolean;
		/** Several answers chosen together. */
		combinations: boolean;
	};
	/** Paths no answer reaches: `never` when no answer fulfils them at all, otherwise paths before them take their answers. */
	unused: Array<{ edge: string; never: boolean }>;
}

/** More answers than this are not tried. */
const MAX_CASES = 4096;
/** A choice of several answers is tried up to this many options (every combination). */
const MAX_OPTIONS = 10;

interface Case {
	answer: unknown;
	option?: Option;
	span?: Span;
	none?: boolean;
	combination?: boolean;
}

const round = ( n: number ): number => Math.round( n * 1e9 ) / 1e9;

/** The numbers the rules of the paths compare the field with. */
function thresholds( paths: Edge[] ): number[] {
	const set = new Set<number>();
	for ( const path of paths ) {
		for ( const leaf of path.when ? leaves( path.when ) : [] ) {
			if ( 'value' in leaf && 'number' === typeof leaf.value && Number.isFinite( leaf.value ) ) {
				set.add( leaf.value );
			}
		}
	}
	return [ ...set ].sort( ( a, b ) => a - b );
}

/**
 * Numbers to try between two bounds: each value the rules compare with and one number between
 * each two of them, since the rules give the same answer for all numbers in between.
 */
function numberCases( paths: Edge[], low: number | undefined, high: number | undefined ): Case[] {
	const marks = thresholds( paths ).filter( ( t ) => ( undefined === low || t > low ) && ( undefined === high || t < high ) );
	const cases: Case[] = [];
	const between = ( from: number | undefined, to: number | undefined ): void => {
		if ( undefined !== from && undefined !== to && to <= from ) {
			return;
		}
		let at = 0;
		if ( undefined !== from && undefined !== to ) {
			at = ( from + to ) / 2;
		} else if ( undefined !== from ) {
			at = from + 1;
		} else if ( undefined !== to ) {
			at = to - 1;
		}
		cases.push( { answer: at, span: { from, to, fromOpen: true, toOpen: true } } );
	};
	const points = [ ...( undefined === low ? [] : [ low ] ), ...marks, ...( undefined === high ? [] : [ high ] ) ];
	if ( undefined === low ) {
		between( undefined, points[ 0 ] );
	}
	points.forEach( ( point, i ) => {
		cases.push( { answer: point, span: { from: point, to: point } } );
		const next = points[ i + 1 ];
		if ( undefined !== next || undefined === high ) {
			between( point, next );
		}
	} );
	return cases;
}

/** The answers a field can give, as far as they can be listed; null when they cannot. */
function casesOf( field: Field, paths: Edge[] ): Case[] | null {
	const none: Case[] = ! field.required || field.showWhen ? [ { answer: undefined, none: true } ] : [];
	switch ( field.type ) {
		case 'choice':
		case 'dropdown': {
			if ( ! field.props.multiple ) {
				return [ ...field.options.map( ( option ): Case => ( { answer: [ option.id ], option } ) ), ...none ];
			}
			if ( field.options.length > MAX_OPTIONS ) {
				return null;
			}
			const limits = field.props as { minChoices?: number; maxChoices?: number };
			const min = Math.max( 1, limits.minChoices ?? 1 );
			const max = limits.maxChoices ?? field.options.length;
			const cases: Case[] = [];
			for ( let mask = 1; mask < 1 << field.options.length; mask++ ) {
				const chosen = field.options.filter( ( _o, i ) => mask & ( 1 << i ) );
				if ( chosen.length < min || chosen.length > max ) {
					continue;
				}
				cases.push( 1 === chosen.length ? { answer: [ chosen[ 0 ]?.id ], option: chosen[ 0 ] } : { answer: chosen.map( ( o ) => o.id ), combination: true } );
			}
			return [ ...cases, ...none ];
		}
		case 'rating': {
			const cases: Case[] = [];
			for ( let n = field.props.min; n <= field.props.max && cases.length <= MAX_CASES; n++ ) {
				cases.push( { answer: n, span: { from: n, to: n } } );
			}
			return cases.length > MAX_CASES ? null : [ ...cases, ...none ];
		}
		case 'slider': {
			const { min, max, step } = field.props;
			if ( field.props.range || ! ( max >= min ) ) {
				return null;
			}
			// A slider always has a value: where its handle starts.
			const hidden: Case[] = field.showWhen ? [ { answer: undefined, none: true } ] : [];
			if ( field.props.manualInput.enabled ) {
				// Any number between the bounds can be typed.
				return [ ...numberCases( paths, min, max ), ...hidden ];
			}
			const count = step > 0 ? Math.floor( round( ( max - min ) / step ) ) + 1 : 0;
			if ( count < 1 || count > MAX_CASES ) {
				return null;
			}
			const cases: Case[] = [];
			for ( let i = 0; i < count; i++ ) {
				const n = round( min + i * step );
				cases.push( { answer: n, span: { from: n, to: n } } );
			}
			return [ ...cases, ...hidden ];
		}
		case 'number':
			return [ ...numberCases( paths, field.props.min, field.props.max ), ...none ];
		default:
			return null;
	}
}

/** Joins numbers left over that follow each other into spans. */
function joinSpans( cases: Case[], left: Set<Case> ): Span[] {
	const spans: Span[] = [];
	let open: Span | null = null;
	for ( const c of cases ) {
		if ( ! c.span ) {
			continue;
		}
		if ( ! left.has( c ) ) {
			open = null;
			continue;
		}
		if ( open ) {
			open.to = c.span.to;
			open.toOpen = c.span.toOpen;
		} else {
			open = { ...c.span };
			spans.push( open );
		}
	}
	return spans.map( ( s ) => {
		const span: Span = {};
		if ( undefined !== s.from ) {
			span.from = s.from;
		}
		if ( undefined !== s.to ) {
			span.to = s.to;
		}
		if ( s.fromOpen && undefined !== s.from ) {
			span.fromOpen = true;
		}
		if ( s.toOpen && undefined !== s.to ) {
			span.toOpen = true;
		}
		return span;
	} );
}

/**
 * The answers and paths of a step whose paths with a condition all ask for one field of the
 * step; null when they ask for more (other fields, calculations, parts of an address) or the
 * answers of the field cannot be listed.
 */
export function coverage( doc: FormDocument, node: FormNode ): Coverage | null {
	if ( 'step' !== node.type ) {
		return null;
	}
	// The documents of the builder do not change once made (immer freezes them): worked out once per step.
	if ( ! Object.isFrozen( doc ) ) {
		return work( doc, node );
	}
	let known = KNOWN.get( doc );
	if ( ! known ) {
		known = new Map();
		KNOWN.set( doc, known );
	}
	if ( ! known.has( node.id ) ) {
		known.set( node.id, work( doc, node ) );
	}
	return known.get( node.id ) ?? null;
}

const KNOWN = new WeakMap<FormDocument, Map<string, Coverage | null>>();

function work( doc: FormDocument, node: Extract<FormNode, { type: 'step' }> ): Coverage | null {
	const paths = doc.edges.filter( ( e ) => e.from === node.id && ! e.default );
	if ( 0 === paths.length || paths.some( ( e ) => ! e.when ) ) {
		return null;
	}
	let id: string | null = null;
	for ( const path of paths ) {
		for ( const leaf of path.when ? leaves( path.when ) : [] ) {
			if ( ! ( 'field' in leaf ) || ( 'part' in leaf && leaf.part ) || ( null !== id && leaf.field !== id ) ) {
				return null;
			}
			id = leaf.field;
		}
	}
	const field = node.fields.find( ( f ) => f.id === id );
	const cases = field ? casesOf( field, paths ) : null;
	if ( ! field || ! cases || cases.length > MAX_CASES ) {
		return null;
	}
	const taken = new Set<string>();
	const possible = new Set<string>();
	const left = new Set<Case>();
	for ( const c of cases ) {
		const answers = undefined === c.answer ? {} : { [ field.id ]: c.answer };
		let first = true;
		for ( const path of paths ) {
			if ( path.when && holds( path.when, answers ) ) {
				possible.add( path.id );
				if ( first ) {
					taken.add( path.id );
					first = false;
				}
			}
		}
		if ( first ) {
			left.add( c );
		}
	}
	return {
		field,
		complete: 0 === left.size,
		rest: {
			options: cases.flatMap( ( c ) => ( c.option && left.has( c ) ? [ c.option ] : [] ) ),
			spans: joinSpans( cases, left ),
			none: cases.some( ( c ) => c.none && left.has( c ) ),
			combinations: cases.some( ( c ) => c.combination && left.has( c ) ),
		},
		unused: paths.filter( ( p ) => ! taken.has( p.id ) ).map( ( p ) => ( { edge: p.id, never: ! possible.has( p.id ) } ) ),
	};
}

/** A span in signs, as the rules on the canvas show their numbers: "< 20", "20 – 30", "> 20 … ≤ 30". */
export function spanText( span: Span, format: ( n: number ) => string = String ): string {
	const { from, to } = span;
	if ( undefined !== from && undefined !== to ) {
		if ( from === to ) {
			return format( from );
		}
		if ( ! span.fromOpen && ! span.toOpen ) {
			return `${ format( from ) } – ${ format( to ) }`;
		}
		return `${ span.fromOpen ? '>' : '≥' } ${ format( from ) } … ${ span.toOpen ? '<' : '≤' } ${ format( to ) }`;
	}
	if ( undefined !== from ) {
		return `${ span.fromOpen ? '>' : '≥' } ${ format( from ) }`;
	}
	if ( undefined !== to ) {
		return `${ span.toOpen ? '<' : '≤' } ${ format( to ) }`;
	}
	return '';
}
