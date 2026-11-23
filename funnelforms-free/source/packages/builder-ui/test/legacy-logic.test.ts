/**
 * Forms whose logic was made with the sidebar of 5.0.8 (the old rules), opened in the editor of
 * 5.0.9. The paths are built with the code of 5.0.8 itself (test/v508, a copy of v5.0.8's
 * builder-ui/src: conditions.ts, document.ts), then canvas and sidebar must show every path,
 * change nothing, and lead every visitor where the form leads them, read from top to bottom.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { holds, next } from '@funnelforms/form-core';
import type { Condition, Field, FormDocument, FormNode } from '@funnelforms/form-schema';
import * as old from './v508/conditions';
import * as oldDoc from './v508/document';
import { answerOptions } from '../src/conditions';
import { coverage } from '../src/coverage';
import { logicHints } from '../src/logic';
import { orderDiffers, outputsOf, OTHERWISE } from '../src/ports';
import { describeCondition, ruleText } from '../src/ui/describe';
import { buildEdges } from '../src/ui/Canvas';

const EXAMPLES = join( __dirname, '../../form-schema/test/examples' );
const TODAY = '2026-11-14';

/** Deterministic random numbers (mulberry32). */
function rng( seed: number ): () => number {
	let a = seed >>> 0;
	return () => {
		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}

type R = () => number;
const pick = <T>( r: R, list: readonly T[] ): T => list[ Math.floor( r() * list.length ) ] as T;

function stepsOf( doc: FormDocument ): Array<Extract<FormNode, { type: 'step' }>> {
	return doc.nodes.filter( ( n ): n is Extract<FormNode, { type: 'step' }> => 'step' === n.type );
}

function fieldsUpTo( doc: FormDocument, node: FormNode ): Field[] {
	// Fields the old sidebar offered: those of the steps before and of this step (fieldsBefore of 5.0.8).
	const ids = new Set( old.fieldsBefore( doc, node.id ).map( ( f ) => f.field.id ) );
	return stepsOf( doc ).flatMap( ( s ) => s.fields ).filter( ( f ) => ids.has( f.id ) || ( 'step' === node.type && node.fields.includes( f ) ) );
}

const NUM_OPS = [ 'lt', 'lte', 'gt', 'gte', 'eq', 'neq' ] as const;
const TEXT_OPS = [ 'equalsText', 'notEqualsText', 'contains', 'notContains', 'startsWith', 'endsWith' ] as const;

function range( f: Field ): [ number, number ] {
	const p = f.props as { min?: number; max?: number };
	return [ p.min ?? 0, p.max ?? 10 ];
}

/** A rule as the old sidebar could write it for a field. */
function leaf( r: R, f: Field ): Condition | null {
	if ( 'options' in f && f.options.length ) {
		const o = pick( r, f.options ).id;
		const k = r();
		if ( k < 0.55 ) {
			return { field: f.id, op: 'selected', value: o };
		}
		if ( k < 0.7 ) {
			return { field: f.id, op: 'selectedOnly', value: o };
		}
		if ( k < 0.85 ) {
			return { all: [ { field: f.id, op: 'selected', value: o }, { field: f.id, op: 'selected', value: pick( r, f.options ).id } ] };
		}
		return { field: f.id, op: pick( r, NUM_OPS ), value: Math.floor( r() * 4 ), number: 'count' };
	}
	if ( [ 'slider', 'number', 'rating' ].includes( f.type ) ) {
		const [ lo, hi ] = range( f );
		const v = Math.round( lo + r() * ( hi - lo ) );
		if ( r() < 0.25 ) {
			const w = Math.round( v + r() * ( hi - v ) );
			return { all: [ { field: f.id, op: 'gte', value: v }, { field: f.id, op: 'lte', value: w } ] };
		}
		return { field: f.id, op: pick( r, NUM_OPS ), value: v };
	}
	if ( 'date' === f.type ) {
		return { field: f.id, op: pick( r, [ 'dateBefore', 'dateAfter', 'dateOn' ] as const ), value: r() < 0.5 ? 'today' : '2026-12-01' };
	}
	if ( 'address' === f.type ) {
		return { field: f.id, op: 'startsWith', value: pick( r, [ '8', '80', '1' ] ), part: 'zip' };
	}
	if ( [ 'text', 'textarea', 'email', 'phone', 'url' ].includes( f.type ) ) {
		return r() < 0.3 ? { field: f.id, op: r() < 0.5 ? 'filled' : 'empty' } : { field: f.id, op: pick( r, TEXT_OPS ), value: pick( r, [ 'a', 'ab', 'x' ] ) };
	}
	return null;
}

function condition( r: R, fields: Field[], depth = 0 ): Condition | null {
	if ( ! fields.length ) {
		return null;
	}
	const k = r();
	if ( depth < 2 && k < 0.3 ) {
		const items = Array.from( { length: 2 + Math.floor( r() * 2 ) }, () => condition( r, fields, depth + 1 ) ).filter( ( c ): c is Condition => !! c );
		return items.length ? ( r() < 0.5 ? { all: items } : { any: items } ) : null;
	}
	return leaf( r, pick( r, fields ) );
}

/** What a visitor of a 5.0.8 form did in the sidebar, one random step after another, with the code of 5.0.8. */
function editWith508( base: FormDocument, seed: number ): FormDocument {
	const r = rng( seed );
	return produce( base, ( d ) => {
		const targets = d.nodes.map( ( n ) => n.id );
		for ( let i = 0; i < 40; i++ ) {
			const node = pick( r, d.nodes.filter( ( n ) => 'end' !== n.type ) );
			if ( ! node ) {
				break;
			}
			const to = pick( r, targets.filter( ( t ) => t !== node.id ) );
			const paths = d.edges.filter( ( e ) => e.from === node.id && ! e.default );
			const k = r();
			const choices = 'step' === node.type ? node.fields.filter( ( f ) => 'options' in f && f.options.length ) : [];
			if ( k < 0.35 && choices.length ) {
				// "Next step" per answer of the choice.
				const f = pick( r, choices );
				const o = 'options' in f ? pick( r, f.options ).id : '';
				old.setAnswerRoute( d, node.id, f.id, o, r() < 0.15 ? null : to );
			} else if ( k < 0.6 ) {
				// "Add a rule", then its condition in the rule editor.
				const when = condition( r, fieldsUpTo( d, node ) );
				if ( when ) {
					oldDoc.connect( d, node.id, to, when );
				}
			} else if ( k < 0.7 && paths.length ) {
				const when = condition( r, fieldsUpTo( d, node ) );
				if ( when ) {
					oldDoc.setCondition( d, pick( r, paths ).id, when );
				}
			} else if ( k < 0.8 && paths.length ) {
				oldDoc.reorderEdge( d, pick( r, paths ).id, r() < 0.5 ? -1 : 1 );
			} else if ( k < 0.87 ) {
				// "Otherwise go to".
				oldDoc.connect( d, node.id, to );
			} else if ( k < 0.92 && paths.length ) {
				oldDoc.removeEdge( d, pick( r, paths ).id );
			} else if ( k < 0.96 ) {
				// Drawn on the canvas of 5.0.8.
				old.connectFromCanvas( d, node.id, to );
			} else if ( paths.length ) {
				oldDoc.setCondition( d, pick( r, paths ).id, null );
			}
		}
	} );
}

function formats( doc: FormDocument ): Record<string, string> {
	const out: Record<string, string> = {};
	for ( const s of stepsOf( doc ) ) {
		for ( const f of s.fields ) {
			if ( 'date' === f.type ) {
				out[ f.id ] = ( f.props as { format: string } ).format;
			}
		}
	}
	return out;
}

/** Random answers of a visitor, near the numbers and texts the rules ask for. */
function answers( r: R, doc: FormDocument ): Record<string, unknown> {
	const a: Record<string, unknown> = {};
	for ( const f of stepsOf( doc ).flatMap( ( s ) => s.fields ) ) {
		if ( r() < 0.1 ) {
			continue;
		}
		if ( 'options' in f && f.options.length ) {
			const multiple = !! ( f.props as { multiple?: boolean } ).multiple;
			a[ f.id ] = multiple ? f.options.filter( () => r() < 0.4 ).map( ( o ) => o.id ) : [ pick( r, f.options ).id ];
		} else if ( [ 'slider', 'number', 'rating' ].includes( f.type ) ) {
			const [ lo, hi ] = range( f );
			a[ f.id ] = Math.round( lo - 1 + r() * ( hi - lo + 2 ) );
		} else if ( 'date' === f.type ) {
			a[ f.id ] = pick( r, [ '13.11.2026', '14.11.2026', '01.12.2026', '24.12.2026' ] );
		} else if ( 'address' === f.type ) {
			a[ f.id ] = { street: 'x', zip: pick( r, [ '80331', '10115', '8', '' ] ), city: 'y' };
		} else {
			a[ f.id ] = pick( r, [ '', 'a', 'ab', 'xa', 'A' ] );
		}
	}
	return a;
}

/**
 * Where the card leads a visitor, read from top to bottom as card and panel show the outputs: a
 * rule leads where its condition holds, an answer row with a path where that answer is chosen,
 * else "Otherwise".
 */
function shownNext( doc: FormDocument, node: FormNode, a: Record<string, unknown>, calcs: Record<string, number>, chosen?: string ): string | null {
	const out = outputsOf( doc, node, chosen );
	const ctx = { today: TODAY, formats: formats( doc ) };
	const given = out.field ? a[ out.field.id ] : undefined;
	for ( const p of out.parts ) {
		if ( 'rules' === p.kind ) {
			const hit = p.rules.find( ( x ) => ! x.edge.when || holds( x.edge.when, a, calcs, {}, ctx ) );
			if ( hit ) {
				return hit.edge.to;
			}
		} else {
			const hit = p.answers.find( ( x ) => x.edge && Array.isArray( given ) && given.includes( x.option.id ) );
			if ( hit?.edge ) {
				return hit.edge.to;
			}
		}
	}
	return out.otherwise?.to ?? null;
}

const files = readdirSync( EXAMPLES ).filter( ( f ) => f.endsWith( '.json' ) && ! f.startsWith( 'ff4' ) );
const SEEDS = Array.from( { length: 30 }, ( _, i ) => i + 1 );

describe( 'logic from the sidebar of 5.0.8 in the editor of 5.0.9', () => {
	const stats = { forms: 0, nodes: 0, paths: 0, stored: 0, visits: 0 };

	it.each( files )( '%s, edited with the old sidebar, shows every path true to how the form checks', ( file ) => {
		const base = JSON.parse( readFileSync( join( EXAMPLES, file ), 'utf8' ) ) as FormDocument;
		for ( const seed of SEEDS ) {
			const doc = editWith508( base, seed * 7919 + file.length );
			const before = JSON.stringify( doc );
			stats.forms++;
			const fields = new Map( stepsOf( doc ).flatMap( ( s ) => s.fields ).map( ( f ) => [ f.id, f ] ) );
			const outputs = new Map( doc.nodes.map( ( n ) => [ n.id, outputsOf( doc, n ) ] ) );
			// The canvas draws every stored path from a step.
			const drawn = new Set( buildEdges( doc, {}, [], null, outputs as never ).map( ( e ) => e.data?.edge ?? e.id ) );
			for ( const node of doc.nodes ) {
				const paths = doc.edges.filter( ( e ) => e.from === node.id );
				if ( 'end' === node.type ) {
					continue;
				}
				stats.nodes++;
				stats.paths += paths.length;
				const choices = 'step' === node.type ? node.fields.filter( ( f ) => 'options' in f && f.options.length ) : [];
				for ( const chosen of [ undefined, ...choices.map( ( f ) => f.id ) ] ) {
					const out = outputsOf( doc, node, chosen );
					const firstDefault = paths.find( ( e ) => e.default );
					for ( const e of paths ) {
						const h = out.handles.get( e.id ) ?? [];
						if ( e.default ) {
							// One "Otherwise": the first default path, the one the form takes.
							expect( h, `${ file }#${ seed } ${ e.id }` ).toEqual( e === firstDefault ? [ OTHERWISE ] : [] );
						} else {
							expect( h.length, `${ file }#${ seed } ${ node.id } ${ e.id } has no output` ).toBeGreaterThan( 0 );
							expect( drawn.has( e.id ), `${ file }#${ seed } ${ e.id } not drawn` ).toBe( true );
						}
						if ( e.when ) {
							expect( describeCondition( e.when, doc, 'de-DE', fields ) ).not.toBe( '' );
						}
					}
					for ( const rule of out.rules ) {
						expect( typeof ruleText( rule, doc, 'de-DE', fields, true ) ).toBe( 'string' );
					}
					if ( orderDiffers( doc, node, chosen ) ) {
						stats.stored++;
					}
					// What card and panel show is where the form leads, for every visitor.
					const r = rng( seed );
					for ( let v = 0; v < 80; v++ ) {
						const a = answers( r, doc );
						const calcs = Object.fromEntries( ( doc.calculations ?? [] ).map( ( c ) => [ c.id, Math.round( r() * 100 ) ] ) );
						stats.visits++;
						expect( shownNext( doc, node, a, calcs, chosen ), `${ file }#${ seed } ${ node.id } ${ JSON.stringify( a ) }` ).toBe( next( doc, node.id, a, calcs, {}, TODAY ) );
					}
				}
				coverage( doc, node );
				// Answers of a group of the old 3.x import keep their one path.
				for ( const e of paths ) {
					void answerOptions( e.when, '' );
				}
			}
			logicHints( doc );
			// Opening the form changes nothing.
			expect( JSON.stringify( doc ) ).toBe( before );
		}
	} );

	it( 'tried enough forms, among them forms shown in the order stored', () => {
		expect( stats.forms ).toBe( files.length * SEEDS.length );
		expect( stats.stored ).toBeGreaterThan( 20 );
		expect( stats.visits ).toBeGreaterThan( 100000 );
	} );
} );
