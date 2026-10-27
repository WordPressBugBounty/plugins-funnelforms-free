/**
 * Checks of a form's logic in the builder: steps that lead nowhere or cannot be reached, rules
 * that can never apply or ask for answers given only later, loops visitors cannot leave, ends
 * that show nothing. The plugin refuses only broken references; these are hints for the user.
 */
import type { Condition, Edge, Field, FormDocument, FormNode } from '@funnelforms/form-schema';
import { answerRoutes, fieldsBefore, leaves, type Leaf } from './conditions';
import { findNode, reachable, text } from './document';
import { isQuizEdge } from './quiz';

export type HintCode =
	/** A step without a path on. */
	| 'deadEnd'
	/** Only paths with conditions leave the node, and they do not cover every answer. */
	| 'noOtherwise'
	/** No path from the start leads to the node. */
	| 'unreachable'
	/** A contact step without an end after it. */
	| 'contactNoEnd'
	/** A path asks for an answer given only after its step. */
	| 'laterAnswer'
	/** A path comes after a path without condition, so it is never checked. */
	| 'neverChecked'
	/** A path asks the same as one checked before it. */
	| 'sameRule'
	/** A path's rules contradict each other. */
	| 'impossible'
	/** Paths without conditions lead round in a circle. */
	| 'endlessLoop'
	/** A field is shown on an answer given only below or after it. */
	| 'showLater'
	/** Every field of a step can be hidden. */
	| 'allHidden'
	/** An end shows nothing and leads nowhere. */
	| 'emptyEnd'
	/** A redirect without an address. */
	| 'redirectNoUrl'
	/** An end reached from a question: those visitors send no entry. */
	| 'noEntry';

export interface LogicHint {
	code: HintCode;
	level: 'error' | 'warning' | 'info';
	/** The node the hint belongs to (for paths: the node they leave). */
	node: string;
	edge?: string;
	field?: string;
	/** The field a rule asks for, or the step a visitor comes from. */
	other?: string;
}

const LEVEL: Record<HintCode, LogicHint[ 'level' ]> = {
	deadEnd: 'error',
	endlessLoop: 'error',
	noOtherwise: 'warning',
	unreachable: 'warning',
	contactNoEnd: 'warning',
	laterAnswer: 'warning',
	neverChecked: 'warning',
	sameRule: 'warning',
	impossible: 'warning',
	showLater: 'warning',
	allHidden: 'warning',
	emptyEnd: 'warning',
	redirectNoUrl: 'warning',
	noEntry: 'info',
};

function hint( code: HintCode, node: string, more: Partial<LogicHint> = {} ): LogicHint {
	return { code, level: LEVEL[ code ], node, ...more };
}

/** Every hint of the document, in the order of its nodes. */
export function logicHints( doc: FormDocument ): LogicHint[] {
	const out: LogicHint[] = [];
	const live = reachable( doc );
	const loops = endlessLoops( doc );
	const contacts = doc.nodes.some( ( n ) => 'contact' === n.type );
	for ( const node of doc.nodes ) {
		if ( ! live.has( node.id ) ) {
			out.push( hint( 'unreachable', node.id ) );
		}
		if ( 'end' === node.type ) {
			out.push( ...endHints( doc, node, contacts ) );
			continue;
		}
		const paths = doc.edges.filter( ( e ) => e.from === node.id );
		if ( 0 === paths.length ) {
			out.push( hint( 'contact' === node.type ? 'contactNoEnd' : 'deadEnd', node.id ) );
		} else if ( paths.every( ( e ) => e.when ) && ! covered( doc, node, paths ) ) {
			out.push( hint( 'noOtherwise', node.id ) );
		}
		out.push( ...pathHints( doc, node, paths, loops ) );
		if ( 'step' === node.type ) {
			out.push( ...fieldHints( doc, node ) );
		}
	}
	return out;
}

/** The hints of a node and of the paths leaving it. */
export function nodeHints( hints: LogicHint[], nodeId: string ): LogicHint[] {
	return hints.filter( ( h ) => h.node === nodeId );
}

/**
 * Whether the paths with conditions of a node cover every visitor: a required single choice
 * whose answers all have a path of their own.
 */
export function covered( doc: FormDocument, node: FormNode, paths: Edge[] ): boolean {
	if ( 'step' !== node.type ) {
		// The quiz leads every contact step to its results, the lowest one without condition.
		return 'contact' === node.type && paths.some( ( e ) => isQuizEdge( doc, e ) );
	}
	return node.fields.some( ( field ) => {
		const single = ( 'choice' === field.type && ! field.props.multiple ) || ( 'dropdown' === field.type && ! field.props.multiple );
		return single && field.required && ! field.showWhen && answerRoutes( doc, node.id, field.id ).every( ( r ) => r.edge );
	} );
}

function pathHints( doc: FormDocument, node: FormNode, paths: Edge[], loops: Set<string> ): LogicHint[] {
	const out: LogicHint[] = [];
	const known = new Set( fieldsBefore( doc, node.id ).map( ( f ) => f.field.id ) );
	const fields = allFields( doc );
	const seen: string[] = [];
	let open = true;
	for ( const edge of paths ) {
		if ( loops.has( edge.id ) ) {
			out.push( hint( 'endlessLoop', node.id, { edge: edge.id } ) );
		}
		if ( edge.default ) {
			continue;
		}
		if ( ! open ) {
			out.push( hint( 'neverChecked', node.id, { edge: edge.id } ) );
			continue;
		}
		if ( ! edge.when ) {
			// A path without condition that is not the default is always taken.
			open = false;
			continue;
		}
		const same = JSON.stringify( edge.when );
		if ( seen.includes( same ) ) {
			out.push( hint( 'sameRule', node.id, { edge: edge.id } ) );
		} else if ( never( edge.when, fields ) ) {
			out.push( hint( 'impossible', node.id, { edge: edge.id } ) );
		}
		seen.push( same );
		const later = leaves( edge.when ).find( ( l ): l is Extract<Leaf, { field: string }> => 'field' in l && fields.has( l.field ) && ! known.has( l.field ) );
		if ( later ) {
			out.push( hint( 'laterAnswer', node.id, { edge: edge.id, other: later.field } ) );
		}
	}
	return out;
}

function fieldHints( doc: FormDocument, node: Extract<FormNode, { type: 'step' }> ): LogicHint[] {
	const out: LogicHint[] = [];
	const fields = allFields( doc );
	for ( const field of node.fields ) {
		if ( ! field.showWhen ) {
			continue;
		}
		const known = new Set( fieldsBefore( doc, node.id, field.id ).map( ( f ) => f.field.id ) );
		const later = leaves( field.showWhen ).find( ( l ): l is Extract<Leaf, { field: string }> => 'field' in l && fields.has( l.field ) && ! known.has( l.field ) );
		if ( later ) {
			out.push( hint( 'showLater', node.id, { field: field.id, other: later.field } ) );
		}
	}
	if ( node.fields.length > 0 && node.fields.every( ( f ) => f.showWhen ) ) {
		out.push( hint( 'allHidden', node.id ) );
	}
	return out;
}

function endHints( doc: FormDocument, node: Extract<FormNode, { type: 'end' }>, contacts: boolean ): LogicHint[] {
	const out: LogicHint[] = [];
	if ( ! node.success?.show && ! node.redirect ) {
		out.push( hint( 'emptyEnd', node.id ) );
	}
	if ( node.redirect && '' === text( node.redirect.url, doc.locales.default ).trim() ) {
		out.push( hint( 'redirectNoUrl', node.id ) );
	}
	if ( contacts ) {
		const from = doc.edges.find( ( e ) => e.to === node.id && 'step' === findNode( doc, e.from )?.type );
		if ( from ) {
			out.push( hint( 'noEntry', node.id, { other: from.from } ) );
		}
	}
	return out;
}

function allFields( doc: FormDocument ): Map<string, Field> {
	const map = new Map<string, Field>();
	for ( const node of doc.nodes ) {
		if ( 'step' === node.type ) {
			node.fields.forEach( ( f ) => map.set( f.id, f ) );
		}
	}
	return map;
}

/** Whether a field takes only one answer, so two different answers of it never hold together. */
function singleAnswer( field: Field | undefined ): boolean {
	return ( 'choice' === field?.type || 'dropdown' === field?.type ) && ! field.props.multiple;
}

/** Whether a condition can never hold: rules of a group of all that contradict each other. */
export function never( condition: Condition, fields: Map<string, Field> ): boolean {
	if ( 'any' in condition ) {
		return condition.any.every( ( c ) => never( c, fields ) );
	}
	if ( ! ( 'all' in condition ) ) {
		return false;
	}
	if ( condition.all.some( ( c ) => never( c, fields ) ) ) {
		return true;
	}
	const rules = condition.all.filter( ( c ): c is Extract<Leaf, { field: string }> => 'field' in c );
	const chosen = new Map<string, string>();
	const presence = new Map<string, string>();
	const low = new Map<string, number>();
	const high = new Map<string, number>();
	for ( const rule of rules ) {
		const key = rule.field + ( 'part' in rule && rule.part ? ':' + rule.part : '' );
		if ( ( 'selected' === rule.op && singleAnswer( fields.get( rule.field ) ) ) || 'selectedOnly' === rule.op ) {
			const other = chosen.get( rule.field );
			if ( undefined !== other && other !== rule.value ) {
				return true;
			}
			chosen.set( rule.field, rule.value );
		}
		if ( 'filled' === rule.op || 'empty' === rule.op ) {
			const other = presence.get( key );
			if ( undefined !== other && other !== rule.op ) {
				return true;
			}
			presence.set( key, rule.op );
		}
		if ( 'value' in rule && 'number' === typeof rule.value && ! ( 'number' in rule && 'count' === rule.number ) ) {
			const v = rule.value;
			// Whole numbers would allow a little more; the bounds are only compared when they cross.
			if ( 'gt' === rule.op || 'gte' === rule.op || 'eq' === rule.op ) {
				low.set( rule.field, Math.max( low.get( rule.field ) ?? -Infinity, 'gt' === rule.op ? v + 1e-9 : v ) );
			}
			if ( 'lt' === rule.op || 'lte' === rule.op || 'eq' === rule.op ) {
				high.set( rule.field, Math.min( high.get( rule.field ) ?? Infinity, 'lt' === rule.op ? v - 1e-9 : v ) );
			}
			if ( ( low.get( rule.field ) ?? -Infinity ) > ( high.get( rule.field ) ?? Infinity ) ) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Paths of loops visitors cannot leave: from each node on such a loop exactly one path leads
 * on, without a condition, so the server meets a step twice and refuses the entry.
 */
function endlessLoops( doc: FormDocument ): Set<string> {
	const only = new Map<string, Edge>();
	for ( const node of doc.nodes ) {
		const paths = doc.edges.filter( ( e ) => e.from === node.id );
		const [ first ] = paths;
		if ( 1 === paths.length && first && ! first.when ) {
			only.set( node.id, first );
		}
	}
	const out = new Set<string>();
	for ( const start of only.keys() ) {
		const trail: Edge[] = [];
		let id: string | undefined = start;
		while ( id && only.has( id ) && trail.length <= only.size ) {
			const edge = only.get( id ) as Edge;
			trail.push( edge );
			id = edge.to;
			if ( id === start ) {
				trail.forEach( ( e ) => out.add( e.id ) );
				break;
			}
		}
	}
	return out;
}
