/**
 * Conditions of paths and fields as the builder edits them: rules on answers and calculations,
 * in groups whose rules must all or any hold, one group inside another at most. Rules on A/B
 * variants come from the tests and are only shown.
 */
import type { Condition, Edge, Field, FormDocument, Option } from '@funnelforms/form-schema';
import { connect, findNode, leaves } from './document';

export { leaves };

export type Rule = Extract<Condition, { field: string }>;
export type RuleKind = 'option' | 'number' | 'text' | 'date' | 'address' | 'count';
export type CalcRule = Extract<Condition, { calc: string }>;
export type VariantRule = Extract<Condition, { experiment: string }>;
/** One rule of a condition: on an answer, a calculation or an A/B variant. */
export type Leaf = Rule | CalcRule | VariantRule;

/** Rules that must all or any hold; a group may hold groups. */
export interface Group {
	mode: 'all' | 'any';
	items: Array<Leaf | Group>;
}
type NumberOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq';
/** An operator as the builder offers it: the number of chosen answers is an operator of its own there. */
export type RuleOp = Rule[ 'op' ] | `count:${ NumberOp }`;

export interface RuleSet {
	mode: 'all' | 'any';
	rules: Rule[];
}

export interface ConditionField {
	nodeId: string;
	field: Field;
	kind: RuleKind;
}

/** How a field can be asked for in a condition; null when it cannot. */
export function ruleKind( field: Field ): RuleKind | null {
	switch ( field.type ) {
		case 'choice':
		case 'dropdown':
			return 'option';
		case 'number':
		case 'slider':
		case 'rating':
			return 'number';
		case 'text':
		case 'textarea':
		case 'email':
		case 'phone':
		case 'url':
		case 'time':
			return 'text';
		case 'date':
			return 'date';
		case 'address':
			return 'address';
		case 'file':
		case 'repeat':
			return 'count';
		default:
			return null;
	}
}

const TEXT_OPS: RuleOp[] = [ 'equalsText', 'notEqualsText', 'contains', 'notContains', 'startsWith', 'endsWith' ];
const PRESENCE: RuleOp[] = [ 'filled', 'empty' ];

/** The operators for a field; a single choice has one answer, so counting it makes no sense. */
export function opsFor( kind: RuleKind, field?: Field ): RuleOp[] {
	switch ( kind ) {
		case 'option':
			return field && 'choice' === field.type && ! field.props.multiple ? [ 'selected', ...PRESENCE ] : [ 'selected', 'selectedOnly', 'count:gte', 'count:lte', 'count:eq', ...PRESENCE ];
		case 'number':
			return [ 'gte', 'gt', 'lte', 'lt', 'eq', 'neq', ...PRESENCE ];
		case 'text':
		case 'address':
			return [ ...TEXT_OPS, ...PRESENCE ];
		case 'date':
			return [ 'dateBefore', 'dateAfter', 'dateOn', ...PRESENCE ];
		case 'count':
			return [ 'count:gte', 'count:lte', 'count:eq', ...PRESENCE ];
	}
}

/** The builder's operator of a rule. */
export function ruleOp( rule: Rule ): RuleOp {
	return 'number' in rule && 'count' === rule.number ? `count:${ rule.op as NumberOp }` : rule.op;
}

/** Step fields a condition can ask for, in the order of the nodes. */
export function conditionFieldList( doc: FormDocument ): ConditionField[] {
	const list: ConditionField[] = [];
	for ( const node of doc.nodes ) {
		if ( 'step' !== node.type ) {
			continue;
		}
		for ( const field of node.fields ) {
			const kind = ruleKind( field );
			if ( kind ) {
				list.push( { nodeId: node.id, field, kind } );
			}
		}
	}
	return list;
}

/** A first rule for a field: its first option, at least the slider's minimum, a text, a date or an answer. */
export function starterRule( field: Field ): Rule | null {
	switch ( ruleKind( field ) ) {
		case 'option': {
			const option = 'options' in field ? field.options[ 0 ] : undefined;
			return option ? { field: field.id, op: 'selected', value: option.id } : null;
		}
		case 'number': {
			const min = 'slider' === field.type || 'rating' === field.type ? field.props.min : 0;
			return { field: field.id, op: 'gte', value: min };
		}
		case 'text':
			return { field: field.id, op: 'equalsText', value: '' };
		case 'address':
			return { field: field.id, op: 'startsWith', value: '', part: 'zip' };
		case 'date':
			return { field: field.id, op: 'dateAfter', value: 'today' };
		case 'count':
			return { field: field.id, op: 'filled' };
		default:
			return null;
	}
}

/** The rules of a condition; null when the builder cannot show it as rules. */
export function toRuleSet( condition: Condition | undefined ): RuleSet | null {
	if ( ! condition ) {
		return { mode: 'all', rules: [] };
	}
	if ( 'field' in condition ) {
		return { mode: 'all', rules: [ condition ] };
	}
	const mode = 'all' in condition ? 'all' : 'any' in condition ? 'any' : null;
	if ( ! mode ) {
		return null;
	}
	const parts = 'all' === mode ? ( condition as { all: Condition[] } ).all : ( condition as { any: Condition[] } ).any;
	const rules: Rule[] = [];
	for ( const part of parts ) {
		if ( ! ( 'field' in part ) ) {
			return null;
		}
		rules.push( part );
	}
	return { mode, rules };
}

/** The condition of rules; null without rules. */
export function fromRuleSet( set: RuleSet ): Condition | null {
	if ( 0 === set.rules.length ) {
		return null;
	}
	const [ first ] = set.rules;
	if ( 1 === set.rules.length && first ) {
		return first;
	}
	return 'all' === set.mode ? { all: set.rules } : { any: set.rules };
}

/** A rule of the same field with another operator, keeping what still fits; `field` gives the first option. */
export function withOp( rule: Rule, op: RuleOp, field?: Field ): Rule {
	const value = 'value' in rule ? rule.value : undefined;
	const part = 'part' in rule ? rule.part : undefined;
	if ( 'selected' === op || 'selectedOnly' === op ) {
		const first = field && 'options' in field ? field.options[ 0 ]?.id ?? '' : '';
		return { field: rule.field, op, value: 'string' === typeof value && ( ! field || ! ( 'options' in field ) || field.options.some( ( o ) => o.id === value ) ) ? value : first };
	}
	if ( 'filled' === op || 'empty' === op ) {
		return part ? { field: rule.field, op, part } : { field: rule.field, op };
	}
	if ( 'dateBefore' === op || 'dateAfter' === op || 'dateOn' === op ) {
		const day = 'string' === typeof value && /^(today|\d{4}-\d{2}-\d{2})$/.test( value ) ? value : 'today';
		const days = 'days' in rule ? rule.days : undefined;
		return undefined === days ? { field: rule.field, op, value: day } : { field: rule.field, op, value: day, days };
	}
	if ( op.startsWith( 'count:' ) ) {
		return { field: rule.field, op: op.slice( 6 ) as NumberOp, value: 'number' === typeof value ? value : 1, number: 'count' };
	}
	if ( TEXT_OPS.includes( op ) ) {
		const text = undefined === value ? '' : String( value );
		return part ? { field: rule.field, op: op as 'equalsText', value: text, part } : { field: rule.field, op: op as 'equalsText', value: text };
	}
	return { field: rule.field, op: op as NumberOp, value: 'number' === typeof value ? value : Number( value ) || 0 };
}

/**
 * A connection drawn on the canvas. The first path of a node is its default path. A further
 * path asks for a field of the node (the first answer no path asks for yet), so drawing never
 * silently moves the default path; without such a field the default path moves to the new
 * target. Funnelforms Free asks only for chosen answers, its paths' only condition. Returns the
 * edge id.
 */
export function connectFromCanvas( doc: FormDocument, from: string, to: string ): string | null {
	const source = findNode( doc, from );
	if ( ! source || 'end' === source.type ) {
		return null;
	}
	const existing = doc.edges.find( ( e ) => e.from === from && e.default );
	if ( ! existing ) {
		return connect( doc, from, to );
	}
	if ( existing.to === to ) {
		return existing.id;
	}
	if ( 'step' === source.type ) {
		for ( const field of source.fields ) {
			const free = 'options' in field ? answerRoutes( doc, from, field.id ).find( ( r ) => ! r.edge ) : undefined;
			const rule = free ? answerRule( field.id, free.option.id ) : 'free' === process.env.FUNNELFORMS_EDITION ? null : starterRule( field );
			if ( rule ) {
				return connect( doc, from, to, rule );
			}
		}
	}
	return connect( doc, from, to );
}

/* ------------------------------------------------------------------ groups */

export function isGroup( item: Leaf | Group ): item is Group {
	return 'items' in item;
}

/** A condition as a group of rules; without a condition an empty group of all. */
export function toGroup( condition: Condition | undefined ): Group {
	if ( ! condition ) {
		return { mode: 'all', items: [] };
	}
	if ( 'all' in condition || 'any' in condition ) {
		const list = 'all' in condition ? condition.all : condition.any;
		return { mode: 'all' in condition ? 'all' : 'any', items: list.map( ( c ) => ( 'all' in c || 'any' in c ? toGroup( c ) : c ) ) };
	}
	return { mode: 'all', items: [ condition ] };
}

/**
 * The condition of a group, as small as it gets: empty groups go, a group of one rule is the
 * rule, and a group of the same kind as the one around it joins it. Null without rules. A
 * group inside another one stays a group while it has one rule, so more can be added to it.
 */
export function fromGroup( group: Group, nested = false ): Condition | null {
	const items: Condition[] = [];
	for ( const item of group.items ) {
		const condition = isGroup( item ) ? fromGroup( item, true ) : item;
		if ( ! condition ) {
			continue;
		}
		const same = 'all' === group.mode ? ( condition as { all?: Condition[] } ).all : ( condition as { any?: Condition[] } ).any;
		items.push( ...( same ?? [ condition ] ) );
	}
	if ( 0 === items.length || ( 1 === items.length && ! nested ) ) {
		return items[ 0 ] ?? null;
	}
	return 'all' === group.mode ? { all: items } : { any: items };
}

/** A first rule on a calculation: its result is at least 0. */
export function calcRule( calc: string ): CalcRule {
	return { calc, op: 'gte', value: 0 };
}

/* ------------------------------------------------------------------ where answers come from */

/** Nodes visitors can pass before they reach this one. */
export function nodesBefore( doc: FormDocument, nodeId: string ): Set<string> {
	const before = new Set<string>();
	const queue = [ nodeId ];
	while ( queue.length ) {
		const id = queue.shift() as string;
		for ( const edge of doc.edges ) {
			if ( edge.to === id && ! before.has( edge.from ) ) {
				before.add( edge.from );
				queue.push( edge.from );
			}
		}
	}
	before.delete( nodeId );
	return before;
}

/** Nodes in the order visitors meet them: by their shortest distance from the start. */
function pathOrder( doc: FormDocument ): Map<string, number> {
	const order = new Map<string, number>();
	const queue = [ doc.start ];
	while ( queue.length ) {
		const id = queue.shift() as string;
		if ( order.has( id ) ) {
			continue;
		}
		order.set( id, order.size );
		doc.edges.filter( ( e ) => e.from === id ).forEach( ( e ) => queue.push( e.to ) );
	}
	doc.nodes.forEach( ( n ) => order.has( n.id ) || order.set( n.id, order.size ) );
	return order;
}

/**
 * The fields a condition can ask for at a place: the fields of the steps that can come before
 * a node, then the node's own fields; for the condition of a field (showWhen) only the fields
 * above it in its step. In the order visitors answer them.
 */
export function fieldsBefore( doc: FormDocument, nodeId: string, fieldId?: string ): ConditionField[] {
	const before = nodesBefore( doc, nodeId );
	const order = pathOrder( doc );
	const out: ConditionField[] = [];
	const nodes = doc.nodes.filter( ( n ) => before.has( n.id ) ).sort( ( a, b ) => ( order.get( a.id ) ?? 0 ) - ( order.get( b.id ) ?? 0 ) );
	const own = findNode( doc, nodeId );
	for ( const node of [ ...nodes, ...( own ? [ own ] : [] ) ] ) {
		if ( 'step' !== node.type ) {
			continue;
		}
		for ( const field of node.fields ) {
			if ( node.id === nodeId && field.id === fieldId ) {
				break;
			}
			const kind = ruleKind( field );
			if ( kind ) {
				out.push( { nodeId: node.id, field, kind } );
			}
		}
	}
	return out;
}

/** Contact fields whose input a condition of an action can compare as text, such as a postcode. */
const CONTACT_TEXT = [ 'name', 'email', 'phone', 'text', 'textarea' ];

/**
 * The fields the condition of an action can ask for: the answers of every step, then what
 * visitors type into the contact steps (postcode, company), since actions run on the complete
 * entry. Contact fields are offered as text fields.
 */
export function entryFields( doc: FormDocument ): ConditionField[] {
	const contact: ConditionField[] = [];
	for ( const node of doc.nodes ) {
		if ( 'contact' !== node.type ) {
			continue;
		}
		for ( const field of node.fields ) {
			if ( CONTACT_TEXT.includes( field.type ) ) {
				const asText: Field = { id: field.id, key: field.key, label: field.label, description: {}, required: field.required, type: 'text', props: { placeholder: {} } };
				contact.push( { nodeId: node.id, field: asText, kind: 'text' } );
			}
		}
	}
	return [ ...conditionFieldList( doc ), ...contact ];
}

/* ------------------------------------------------------------------ answers that lead somewhere */

export interface AnswerRoute {
	option: Option;
	/** The path taken for this answer; none when the answer follows the other paths. */
	edge?: Edge;
}

function answerRule( field: string, option: string ): Rule {
	return { field, op: 'selected', value: option };
}

/** The path of each answer of a choice or dropdown field: a path from the node asking for just that answer. */
export function answerRoutes( doc: FormDocument, nodeId: string, fieldId: string ): AnswerRoute[] {
	const node = findNode( doc, nodeId );
	const field = node && 'step' === node.type ? node.fields.find( ( f ) => f.id === fieldId ) : undefined;
	if ( ! field || ! ( 'options' in field ) ) {
		return [];
	}
	return field.options.map( ( option ) => {
		const edge = doc.edges.find( ( e ) => e.from === nodeId && ! e.default && e.when && 'field' in e.when && e.when.field === fieldId && 'selected' === e.when.op && e.when.value === option.id );
		return edge ? { option, edge } : { option };
	} );
}

/**
 * Sends visitors with this answer to a node; null (or the target of the default path) lets the
 * answer follow the other paths again.
 */
export function setAnswerRoute( doc: FormDocument, nodeId: string, fieldId: string, optionId: string, to: string | null ): void {
	const route = answerRoutes( doc, nodeId, fieldId ).find( ( r ) => r.option.id === optionId );
	if ( ! route ) {
		return;
	}
	const fallback = doc.edges.find( ( e ) => e.from === nodeId && e.default )?.to;
	if ( null === to || to === fallback ) {
		if ( route.edge ) {
			const id = route.edge.id;
			doc.edges = doc.edges.filter( ( e ) => e.id !== id );
		}
		return;
	}
	if ( route.edge ) {
		const id = route.edge.id;
		const edge = doc.edges.find( ( e ) => e.id === id );
		if ( edge ) {
			edge.to = to;
		}
		return;
	}
	connect( doc, nodeId, to, answerRule( fieldId, optionId ) );
}
