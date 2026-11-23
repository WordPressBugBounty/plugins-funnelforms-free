/**
 * The outputs of a node on the canvas: where its paths start. A step with a choice or dropdown
 * field has one output per answer of that field; every other path with a condition (a slider or
 * number rule, a rule over several fields, a quiz result) is an output of its own; the path
 * without condition is "Otherwise". The paths stay as they are stored (docs/builder/README.md,
 * Logic): an output per answer is the path "this answer is selected", so nothing is migrated.
 *
 * The paths of a node are checked in their order and the first that applies decides. Rules the
 * builder adds go before the paths per answer, so the more special path wins; the card and the
 * panel show them in that order (rules checked first, the answers, rules checked after them).
 * Where a form checks in another order (rules between paths of answers, made with the sidebar
 * of 5.0.8 or imported), card and panel show the paths exactly in the order stored (`parts`):
 * what is shown is always what visitors get, and nothing is moved.
 */
import type { Condition, Edge, Field, FormDocument, FormNode, Option } from '@funnelforms/form-schema';
import { answerOptions, answerRoutes, calcRule, connectFromCanvas, fieldsBefore, freshRule, placeAnswerPath, routeAnswer, type NumberOp } from './conditions';
import { coverage } from './coverage';
import { connect, findNode, removeEdge } from './document';

/** Handle of the path without condition. */
export const OTHERWISE = 'otherwise';

/** Field types whose rules compare numbers. */
export const NUMBER_TYPES: readonly string[] = [ 'slider', 'number', 'rating' ];

/** From this many answers on, answers without a path of their own fold away. */
export const FOLD_FROM = 6;

export function answerHandle( optionId: string ): string {
	return 'a:' + optionId;
}

export function ruleHandle( edgeId: string ): string {
	return 'r:' + edgeId;
}

/** How a rule reads at a glance: below, above or between numbers, equal to one, or anything else. */
export type RuleTone = 'below' | 'above' | 'range' | 'equal' | 'rule';

export interface AnswerOutput {
	handle: string;
	option: Option;
	/** The path of this answer; none when the answer follows "Otherwise". */
	edge?: Edge;
}

/** What a number rule compares with: one number, or two for "between". */
export type NumberRule = { op: NumberOp; value: number } | { op: 'between'; min: number; max: number };

/** How a rule reads its number: as it is, as a whole number or with decimals (imports of Funnelforms 3); kept when the card changes the rule. */
type NumberKind = 'int' | 'float' | undefined;

export interface RuleOutput {
	handle: string;
	edge: Edge;
	tone: RuleTone;
	/** "<", "≥", "↔", … ; empty for other rules. */
	symbol: string;
	/** A rule on a number of a field of this step: its field and bounds (a range has both); `rule` when the card can change it in place. */
	number?: { field: Field; min?: number; max?: number; value?: number; rule?: NumberRule };
	/** A rule on answers of a choice of this step that must all be chosen; `only`: and no other (the exact match of Funnelforms 4). */
	answers?: { field: Field; options: Option[]; only: boolean };
	/** A rule on how many answers of a choice of this step are chosen: that number. */
	count?: number;
	/** Checked before the paths per answer of the step (true when the step has none). */
	first: boolean;
	/** Its place among the paths with a condition of the node, from 1. */
	order: number;
}

export interface Outputs {
	/** The field whose answers are outputs. */
	field?: Field;
	/** The fields with answers the outputs can follow. */
	fields: Field[];
	answers: AnswerOutput[];
	rules: RuleOutput[];
	otherwise?: Edge;
	/** The handles each path of the node starts at: one, or one per answer of a path for several answers. */
	handles: Map<string, string[]>;
	/** Rules and answers in the order card and panel show them, which is the order the form checks them. */
	parts: OutputPart[];
	/** The paths are shown in the order stored, as it differs from rules first, answers, other rules (orderDiffers). */
	stored: boolean;
	/** How many paths with a condition the node has. */
	count: number;
}

/** Rules or answers next to each other in the order of a node's outputs. */
export type OutputPart = { kind: 'rules'; rules: RuleOutput[] } | { kind: 'answers'; answers: AnswerOutput[] };

const SYMBOLS: Record<string, string> = { lt: '<', lte: '≤', gt: '>', gte: '≥', eq: '=', neq: '≠' };
const TONES: Record<string, RuleTone> = { lt: 'below', lte: 'below', gt: 'above', gte: 'above', eq: 'equal', neq: 'rule' };

type NumberLeaf = { field: string; op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq'; value: number; number?: string };

function numberLeaf( c: Condition ): NumberLeaf | null {
	return 'field' in c && c.op in SYMBOLS && 'number' === typeof ( c as { value?: unknown } ).value ? ( c as NumberLeaf ) : null;
}

/** The fields of a step whose answers can be outputs. */
export function answerFields( node: FormNode ): Field[] {
	return 'step' === node.type ? node.fields.filter( ( f ) => 'options' in f && f.options.length > 0 ) : [];
}

/**
 * The field whose answers are the outputs of a step: the chosen one, else the first whose
 * answers have paths, else the first with answers.
 */
export function answerField( doc: FormDocument, node: FormNode, chosen?: string ): Field | undefined {
	const fields = answerFields( node );
	const paths = doc.edges.filter( ( e ) => e.from === node.id && ! e.default );
	return fields.find( ( f ) => f.id === chosen ) ?? fields.find( ( f ) => paths.some( ( e ) => answerOptions( e.when, f.id ) ) ) ?? fields[ 0 ];
}

/**
 * Answers of one choice of the step a rule asks for together: every one of them chosen, and with
 * `only` no other (one answer as the only one, or the answers and their number).
 */
function chosenAnswers( when: Condition, own: Field[] ): NonNullable<RuleOutput[ 'answers' ]> | null {
	const list = 'all' in when ? when.all : [ when ];
	const [ first ] = list;
	const field = first && 'field' in first ? own.find( ( f ) => f.id === first.field ) : undefined;
	if ( ! field || ! ( 'options' in field ) || ( 1 === list.length && ! ( first && 'field' in first && 'selectedOnly' === first.op ) ) ) {
		return null;
	}
	const options: Option[] = [];
	let count: number | null = null;
	let alone = false;
	for ( const c of list ) {
		if ( ! ( 'field' in c ) || c.field !== field.id ) {
			return null;
		}
		const option = 'selected' === c.op || 'selectedOnly' === c.op ? field.options.find( ( o ) => o.id === c.value ) : undefined;
		if ( option ) {
			options.push( option );
			alone ||= 'selectedOnly' === c.op;
		} else if ( 'eq' === c.op && 'count' === c.number && null === count ) {
			count = c.value;
		} else {
			return null;
		}
	}
	if ( 0 === options.length || ( null !== count && count !== options.length ) || ( alone && options.length > 1 ) ) {
		return null;
	}
	return { field, options, only: alone || null !== count };
}

/** The shape of a rule output. */
export function ruleShape( edge: Edge, own: Field[] ): Pick<RuleOutput, 'tone' | 'symbol' | 'number' | 'answers' | 'count'> {
	// The card changes a number rule of the step in place; counted answers stay in the panel.
	const when = edge.when;
	if ( ! when ) {
		return { tone: 'rule', symbol: '' };
	}
	const ownField = ( id: string, leaf: NumberLeaf ): Field | undefined => ( 'count' === leaf.number ? undefined : own.find( ( f ) => f.id === id && NUMBER_TYPES.includes( f.type ) ) );
	const leaf = numberLeaf( when );
	if ( leaf && 'count' === leaf.number && own.some( ( f ) => f.id === leaf.field ) ) {
		return { tone: TONES[ leaf.op ] ?? 'rule', symbol: SYMBOLS[ leaf.op ] ?? '', count: leaf.value };
	}
	if ( leaf ) {
		const field = ownField( leaf.field, leaf );
		return { tone: TONES[ leaf.op ] ?? 'rule', symbol: SYMBOLS[ leaf.op ] ?? '', number: field ? { field, value: leaf.value, rule: { op: leaf.op, value: leaf.value } } : undefined };
	}
	const chosen = chosenAnswers( when, own );
	if ( chosen ) {
		return chosen.only ? { tone: 'equal', symbol: '=', answers: chosen } : { tone: 'rule', symbol: '', answers: chosen };
	}
	// Between two numbers: at least one, at most the other, of the same field.
	if ( 'all' in when && 2 === when.all.length ) {
		const [ a, b ] = when.all.map( ( c ) => numberLeaf( c ) );
		const low = [ a, b ].find( ( l ) => l && ( 'gt' === l.op || 'gte' === l.op ) );
		const high = [ a, b ].find( ( l ) => l && ( 'lt' === l.op || 'lte' === l.op ) );
		if ( low && high && low.field === high.field && low.number === high.number ) {
			const field = ownField( low.field, low );
			const rule: NumberRule | undefined = 'gte' === low.op && 'lte' === high.op ? { op: 'between', min: low.value, max: high.value } : undefined;
			return { tone: 'range', symbol: '↔', number: field ? { field, min: low.value, max: high.value, ...( rule ? { rule } : {} ) } : undefined };
		}
	}
	return { tone: 'rule', symbol: '' };
}

/** The outputs of a node; `chosen` is the field whose answers the canvas shows when the step has several. */
export function outputsOf( doc: FormDocument, node: FormNode, chosen?: string ): Outputs {
	const handles = new Map<string, string[]>();
	const out: Outputs = { fields: answerFields( node ), answers: [], rules: [], handles, parts: [], stored: false, count: 0 };
	if ( 'end' === node.type ) {
		return out;
	}
	const field = answerField( doc, node, chosen );
	const own = 'step' === node.type ? node.fields : [];
	const routes = field ? answerRoutes( doc, node.id, field.id ) : [];
	out.field = field;
	for ( const route of routes ) {
		const handle = answerHandle( route.option.id );
		out.answers.push( route.edge ? { handle, option: route.option, edge: route.edge } : { handle, option: route.option } );
		if ( route.edge ) {
			handles.set( route.edge.id, [ ...( handles.get( route.edge.id ) ?? [] ), handle ] );
		}
	}
	// Rules before the first path of an answer are checked before the answers, the others after them.
	let answered = false;
	let order = 0;
	for ( const edge of doc.edges ) {
		if ( edge.from !== node.id ) {
			continue;
		}
		if ( edge.default ) {
			out.otherwise ??= edge;
			handles.set( edge.id, [ OTHERWISE ] );
			continue;
		}
		order++;
		if ( handles.has( edge.id ) ) {
			answered = true;
			continue;
		}
		const handle = ruleHandle( edge.id );
		out.rules.push( { handle, edge, ...ruleShape( edge, own ), first: ! answered, order } );
		handles.set( edge.id, [ handle ] );
	}
	out.count = order;
	out.stored = differs( doc, node, out );
	out.parts = out.stored ? storedParts( doc, node, out ) : shownParts( out );
	return out;
}

function part( parts: OutputPart[], kind: 'rules', item: RuleOutput ): void;
function part( parts: OutputPart[], kind: 'answers', item: AnswerOutput ): void;
function part( parts: OutputPart[], kind: OutputPart[ 'kind' ], item: RuleOutput | AnswerOutput ): void {
	const last = parts[ parts.length - 1 ];
	if ( 'rules' === kind ) {
		if ( last?.kind === 'rules' ) {
			last.rules.push( item as RuleOutput );
		} else {
			parts.push( { kind, rules: [ item as RuleOutput ] } );
		}
	} else if ( last?.kind === 'answers' ) {
		last.answers.push( item as AnswerOutput );
	} else {
		parts.push( { kind, answers: [ item as AnswerOutput ] } );
	}
}

/** Rules checked first, the answers in their order, the other rules. */
function shownParts( out: Outputs ): OutputPart[] {
	const parts: OutputPart[] = [];
	out.rules.filter( ( r ) => r.first ).forEach( ( r ) => part( parts, 'rules', r ) );
	out.answers.forEach( ( a ) => part( parts, 'answers', a ) );
	out.rules.filter( ( r ) => ! r.first ).forEach( ( r ) => part( parts, 'rules', r ) );
	return parts;
}

/**
 * The paths in the order stored: each rule where it is checked, the answers of each path where
 * that path is checked; answers without a path of their own (they follow the other paths) last
 * among the answers.
 */
function storedParts( doc: FormDocument, node: FormNode, out: Outputs ): OutputPart[] {
	const parts: OutputPart[] = [];
	let lastAnswers = -1;
	for ( const edge of doc.edges ) {
		if ( edge.from !== node.id || edge.default ) {
			continue;
		}
		const rule = out.rules.find( ( r ) => r.edge.id === edge.id );
		if ( rule ) {
			part( parts, 'rules', rule );
			continue;
		}
		out.answers.filter( ( a ) => a.edge?.id === edge.id ).forEach( ( a ) => part( parts, 'answers', a ) );
		lastAnswers = parts.length - 1;
	}
	const free = out.answers.filter( ( a ) => ! a.edge );
	const at = parts[ lastAnswers ];
	if ( at?.kind === 'answers' ) {
		at.answers.push( ...free );
	} else {
		free.forEach( ( a ) => part( parts, 'answers', a ) );
	}
	return parts;
}

/**
 * A path drawn on the canvas from an output of a node: from an answer it is the path of that
 * answer, from a rule it moves that rule's path, from "Otherwise" the path without condition.
 * Drawn from a node without outputs (no handle), as before. Returns the id of the path.
 */
export function connectOutput( doc: FormDocument, from: string, handle: string | null | undefined, to: string ): string | null {
	const node = findNode( doc, from );
	if ( ! node || 'end' === node.type || from === to || ! findNode( doc, to ) ) {
		return null;
	}
	if ( handle === OTHERWISE ) {
		return connect( doc, from, to );
	}
	if ( handle?.startsWith( 'a:' ) ) {
		const option = handle.slice( 2 );
		const field = answerFields( node ).find( ( f ) => 'options' in f && f.options.some( ( o ) => o.id === option ) );
		return field ? routeAnswer( doc, from, field.id, option, to, true ) : null;
	}
	if ( handle?.startsWith( 'r:' ) ) {
		const edge = doc.edges.find( ( e ) => e.id === handle.slice( 2 ) && e.from === from );
		if ( edge ) {
			edge.to = to;
			return edge.id;
		}
		return null;
	}
	return connectFromCanvas( doc, from, to );
}

/** Where a new path of a node leads until the user draws it: where "Otherwise" leads, else the first end, else another node. */
function firstTarget( doc: FormDocument, nodeId: string ): string | undefined {
	return doc.edges.find( ( e ) => e.from === nodeId && e.default )?.to ?? doc.nodes.find( ( n ) => 'end' === n.type )?.id ?? doc.nodes.find( ( n ) => n.id !== nodeId )?.id;
}

/**
 * A rule for the next path on the number a step asks for: the numbers no path takes yet (below
 * the first rule, between two rules, above the last one), so the rules add up without gaps; for
 * the first rule the upper half of a slider or rating.
 */
export function numberRuleFor( doc: FormDocument, node: FormNode, field: Field ): Condition {
	const bounds: { min?: number; max?: number } = 'slider' === field.type || 'rating' === field.type ? field.props : {};
	const cover = coverage( doc, node );
	const span = cover && cover.field.id === field.id ? cover.rest.spans[ 0 ] : undefined;
	if ( ! span ) {
		return { field: field.id, op: 'gte', value: undefined !== bounds.min && undefined !== bounds.max ? Math.round( ( bounds.min + bounds.max ) / 2 ) : 0 };
	}
	const low = undefined === span.from || ( span.from === bounds.min && ! span.fromOpen ) ? null : ( { field: field.id, op: span.fromOpen ? 'gt' : 'gte', value: span.from } as const );
	const high = undefined === span.to || ( span.to === bounds.max && ! span.toOpen ) ? null : ( { field: field.id, op: span.toOpen ? 'lt' : 'lte', value: span.to } as const );
	if ( low && high ) {
		return low.value === high.value ? { field: field.id, op: 'eq', value: low.value } : { all: [ low, high ] };
	}
	return low ?? high ?? { field: field.id, op: 'gte', value: span.from ?? 0 };
}

/** The fields a new rule of a node can ask for; Funnelforms Free has rules on answers only. */
function ruleFields( doc: FormDocument, nodeId: string ): ReturnType<typeof fieldsBefore> {
	const free = 'free' === process.env.FUNNELFORMS_EDITION;
	return fieldsBefore( doc, nodeId ).filter( ( f ) => ! free || 'option' === f.kind );
}

/** Whether a node can get a path with a rule (addRulePath): it has something to ask for and somewhere to lead. */
export function canAddRule( doc: FormDocument, nodeId: string ): boolean {
	const node = findNode( doc, nodeId );
	if ( ! node || 'end' === node.type || ! firstTarget( doc, nodeId ) ) {
		return false;
	}
	return ruleFields( doc, nodeId ).length > 0 || ( 'free' !== process.env.FUNNELFORMS_EDITION && doc.calculations.length > 0 );
}

/**
 * A new path with a rule for a node, from its card or the panel: on the number of the step when
 * it asks for one (numberRuleFor), else a first rule no path of the node has yet (freshRule),
 * else on the first calculation. It leads where "Otherwise" leads until it is drawn elsewhere,
 * and is checked before the paths per answer. Returns the id of the path.
 */
export function addRulePath( doc: FormDocument, nodeId: string ): string | null {
	const node = findNode( doc, nodeId );
	const to = firstTarget( doc, nodeId );
	if ( ! node || 'end' === node.type || ! to ) {
		return null;
	}
	const fields = ruleFields( doc, nodeId );
	const own = fields.find( ( f ) => f.nodeId === nodeId );
	let when: Condition | null = null;
	if ( own && 'number' === own.kind ) {
		when = numberRuleFor( doc, node, own.field );
	} else {
		const [ calc ] = 'free' === process.env.FUNNELFORMS_EDITION ? [] : doc.calculations;
		when = freshRule( doc, nodeId, fields ) ?? ( calc ? calcRule( calc.id ) : null );
	}
	const id = when ? connect( doc, nodeId, to, when ) : null;
	if ( ! id ) {
		return null;
	}
	const out = outputsOf( doc, node );
	const [ handle ] = out.handles.get( id ) ?? [];
	if ( handle?.startsWith( 'a:' ) && out.field ) {
		// The rule asks for one answer of the step: that is the path of the answer, at its place.
		placeAnswerPath( doc, nodeId, out.field.id, handle.slice( 2 ), id );
		return id;
	}
	// Before the first path of an answer: a rule is the more special path.
	const firstAnswer = doc.edges.findIndex( ( e ) => e.from === nodeId && ! e.default && ! out.rules.some( ( r ) => r.edge.id === e.id ) );
	const at = doc.edges.findIndex( ( e ) => e.id === id );
	if ( firstAnswer >= 0 && firstAnswer < at ) {
		const [ edge ] = doc.edges.splice( at, 1 );
		if ( edge ) {
			doc.edges.splice( firstAnswer, 0, edge );
		}
	}
	return id;
}

/**
 * Keeps the usual order after the condition of a path changed: a path that now asks for one
 * answer of the step takes its place among the paths per answer, and a path of an answer that
 * became a rule is checked before them, as the more special path. A rule that was one before
 * (`wasRule`) stays where it is checked.
 */
export function settlePath( doc: FormDocument, edgeId: string, wasRule = false ): void {
	const edge = doc.edges.find( ( e ) => e.id === edgeId );
	const node = edge ? findNode( doc, edge.from ) : undefined;
	if ( ! edge || edge.default || ! node || 'end' === node.type ) {
		return;
	}
	const out = outputsOf( doc, node );
	const [ handle ] = out.handles.get( edgeId ) ?? [];
	if ( handle?.startsWith( 'a:' ) && out.field ) {
		placeAnswerPath( doc, node.id, out.field.id, handle.slice( 2 ), edgeId );
		return;
	}
	// A rule that was a rule before stays where it is checked: only its condition changed.
	if ( wasRule ) {
		return;
	}
	const rules = new Set( out.rules.map( ( r ) => r.edge.id ) );
	const paths = doc.edges.filter( ( e ) => e.from === node.id && ! e.default );
	const at = paths.findIndex( ( e ) => e.id === edgeId );
	const before = paths.slice( 0, at ).find( ( e ) => ! rules.has( e.id ) );
	if ( before && paths.slice( at + 1 ).some( ( e ) => ! rules.has( e.id ) ) ) {
		doc.edges.splice( doc.edges.indexOf( edge ), 1 );
		doc.edges.splice( doc.edges.findIndex( ( e ) => e.id === before.id ), 0, edge );
	}
}

/** The paths with a condition of a node in the order rules first, answers, other rules. */
function shownOrder( out: Outputs ): string[] {
	const answers = [ ...new Set( out.answers.flatMap( ( a ) => ( a.edge ? [ a.edge.id ] : [] ) ) ) ];
	return [ ...out.rules.filter( ( r ) => r.first ).map( ( r ) => r.edge.id ), ...answers, ...out.rules.filter( ( r ) => ! r.first ).map( ( r ) => r.edge.id ) ];
}

/**
 * Whether the form checks the paths of a node in another order than rules first, answers, other
 * rules, where that can decide: a rule between the paths per answer, or the paths of answers that
 * can be chosen together in another order than the answers. Card and panel then show the order
 * stored. Forms made with this builder keep the usual order; the sidebar of 5.0.8 or an import may not.
 */
function differs( doc: FormDocument, node: FormNode, out: Outputs ): boolean {
	const rules = new Set( out.rules.map( ( r ) => r.edge.id ) );
	const paths = doc.edges.filter( ( e ) => e.from === node.id && ! e.default );
	const first = paths.findIndex( ( e ) => ! rules.has( e.id ) );
	const last = paths.length - 1 - [ ...paths ].reverse().findIndex( ( e ) => ! rules.has( e.id ) );
	if ( first >= 0 && paths.some( ( e, i ) => rules.has( e.id ) && i > first && i < last ) ) {
		return true;
	}
	if ( ! out.field || ! ( out.field.props as { multiple?: boolean } ).multiple ) {
		return false;
	}
	return shownOrder( out ).join( ' ' ) !== paths.map( ( e ) => e.id ).join( ' ' );
}

/** Whether card and panel show the paths of a node in the order stored (see differs). */
export function orderDiffers( doc: FormDocument, node: FormNode, chosen?: string ): boolean {
	return outputsOf( doc, node, chosen ).stored;
}

/**
 * Moves a rule up (-1) or down (+1) among the rules of its node. Past the last rule checked
 * before the answers it goes behind the paths per answer, and back before them the other way.
 * Where the paths are shown as stored, it changes places with the path next to it.
 */
export function moveRule( doc: FormDocument, edgeId: string, delta: -1 | 1, chosen?: string ): void {
	const moved = doc.edges.find( ( e ) => e.id === edgeId );
	const node = moved ? findNode( doc, moved.from ) : undefined;
	if ( ! moved || ! node ) {
		return;
	}
	const out = outputsOf( doc, node, chosen );
	const at = out.rules.findIndex( ( r ) => r.edge.id === edgeId );
	const rule = out.rules[ at ];
	const other = out.rules[ at + delta ];
	if ( ! rule ) {
		return;
	}
	if ( out.stored ) {
		// Shown as stored: the rule changes places with the path checked just before or after it.
		const paths = doc.edges.filter( ( e ) => e.from === node.id && ! e.default );
		const next = paths[ paths.findIndex( ( e ) => e.id === edgeId ) + delta ];
		if ( next ) {
			const a = doc.edges.indexOf( moved );
			const b = doc.edges.indexOf( next );
			doc.edges[ a ] = next;
			doc.edges[ b ] = moved;
		}
		return;
	}
	if ( other && other.first === rule.first ) {
		const a = doc.edges.findIndex( ( e ) => e.id === rule.edge.id );
		const b = doc.edges.findIndex( ( e ) => e.id === other.edge.id );
		const first = doc.edges[ a ];
		const second = doc.edges[ b ];
		if ( first && second ) {
			doc.edges[ a ] = second;
			doc.edges[ b ] = first;
		}
		return;
	}
	const answers = doc.edges.filter( ( e ) => e.from === node.id && ! e.default && ! out.rules.some( ( r ) => r.edge.id === e.id ) );
	const crossing = delta > 0 ? rule.first : ! rule.first;
	const beside = delta > 0 ? answers[ answers.length - 1 ] : answers[ 0 ];
	if ( ! crossing || ! beside ) {
		return;
	}
	doc.edges.splice( doc.edges.indexOf( moved ), 1 );
	doc.edges.splice( doc.edges.findIndex( ( e ) => e.id === beside.id ) + ( delta > 0 ? 1 : 0 ), 0, moved );
}

/** Whether a rule can move up (-1) or down (+1), as moveRule would move it. */
export function canMoveRule( outputs: Outputs, edgeId: string, delta: -1 | 1 ): boolean {
	const at = outputs.rules.findIndex( ( r ) => r.edge.id === edgeId );
	const rule = outputs.rules[ at ];
	const other = outputs.rules[ at + delta ];
	if ( ! rule ) {
		return false;
	}
	if ( outputs.stored ) {
		return delta < 0 ? rule.order > 1 : rule.order < outputs.count;
	}
	if ( other && other.first === rule.first ) {
		return true;
	}
	return outputs.answers.some( ( a ) => a.edge ) && ( delta > 0 ? rule.first : ! rule.first );
}

/** Sets what a number rule of a step compares with, as its card edits it; the field and how it reads its number stay. */
export function setNumberRule( doc: FormDocument, edgeId: string, fieldId: string, rule: NumberRule ): void {
	const edge = doc.edges.find( ( e ) => e.id === edgeId );
	if ( ! edge || edge.default ) {
		return;
	}
	const [ old ] = edge.when ? ( 'all' in edge.when ? edge.when.all : [ edge.when ] ) : [];
	const was = old ? numberLeaf( old )?.number : undefined;
	const kind: NumberKind = 'int' === was || 'float' === was ? was : undefined;
	const leaf = ( op: NumberOp, value: number ): Condition => ( { field: fieldId, op, value, ...( kind ? { number: kind } : {} ) } );
	edge.when = 'between' === rule.op ? { all: [ leaf( 'gte', rule.min ), leaf( 'lte', rule.max ) ] } : leaf( rule.op, rule.value );
}

/**
 * Takes the path away from an output of a node: an answer follows "Otherwise" again (others of
 * a path for several answers keep it), a rule goes with its path, "Otherwise" leads nowhere.
 */
export function clearOutput( doc: FormDocument, from: string, handle: string ): void {
	const node = findNode( doc, from );
	if ( ! node ) {
		return;
	}
	if ( handle === OTHERWISE ) {
		doc.edges = doc.edges.filter( ( e ) => ! ( e.from === from && e.default ) );
	} else if ( handle.startsWith( 'a:' ) ) {
		const option = handle.slice( 2 );
		const field = answerFields( node ).find( ( f ) => 'options' in f && f.options.some( ( o ) => o.id === option ) );
		if ( field ) {
			routeAnswer( doc, from, field.id, option, null );
		}
	} else if ( handle.startsWith( 'r:' ) && doc.edges.some( ( e ) => e.id === handle.slice( 2 ) && e.from === from ) ) {
		removeEdge( doc, handle.slice( 2 ) );
	}
}
