/**
 * Everything that is wrong with the open form, as one list for people: the problems that keep it
 * from being published (the reference checks of the plugin, run here on every change, and what the
 * plugin answered on the last save) and the hints about its logic (logic.ts). Each issue says what
 * is wrong, where it is and how to solve it, names the steps, fields and paths to mark, the place
 * "Show" brings into view, and, where the builder can do it safely, a fix (an undoable change).
 */
import type { FormDocument, FormNode } from '@funnelforms/form-schema';
import { checkReferences } from '@funnelforms/form-schema/references';
import { addEnd, connect, dropRules, findNode, nodeName, removeEdge, separateDuplicateIds, setStart, type Context } from '../document';
import type { Leaf } from '../conditions';
import type { LogicHint } from '../logic';
import type { Panel, Selection } from '../store';
import type { View } from './context';
import { contactFieldName, problemText, stepFieldName } from './catalog';
import { hintText } from './hintText';
import { caption } from './Prefill';
import { __, sprintf } from './i18n';

/** Where an issue is: what "Show" selects, the panel of the step it opens, or a workspace. */
export interface IssueTarget {
	node?: string;
	field?: string;
	edge?: string;
	panel?: Panel;
	/** A workspace other than the canvas (settings, design). */
	view?: View;
}

/** A change that solves the issue; it is one step to undo. Returns what to select afterwards. */
export interface IssueFix {
	label: string;
	run: ( doc: FormDocument, ctx: Context ) => Selection | null;
}

export interface Issue {
	/** Stable for lists, the same issue keeps it while the form changes. */
	key: string;
	/** error: blocks publishing or leaves visitors stuck; warning: worth a look. */
	tone: 'error' | 'warning';
	/** The plugin refuses to publish (and to preview) while it is there. */
	blocking: boolean;
	/** What is wrong, in one line. */
	title: string;
	/** Why it matters and how to solve it. */
	help: string;
	/** Where it is, in words ("Contact step “Your details” · Field “E-mail”"); empty for the whole form. */
	place: string;
	target?: IssueTarget;
	fix?: IssueFix;
	/** Steps, fields and paths to mark in red or amber. */
	marks: { nodes: string[]; fields: string[]; edges: string[] };
}

type Marks = Issue[ 'marks' ];

const noMarks = (): Marks => ( { nodes: [], fields: [], edges: [] } );

/* ------------------------------------------------------------------ places */

function kindOf( node: FormNode ): string {
	return 'contact' === node.type ? __( 'Contact step', 'funnelforms-pro' ) : 'end' === node.type ? __( 'End', 'funnelforms-pro' ) : __( 'Step', 'funnelforms-pro' );
}

/** "Contact step “Your details”". */
export function nodePlace( node: FormNode | undefined, locale: string ): string {
	if ( ! node ) {
		return '';
	}
	const name = nodeName( node, locale ).replace( /<[^>]*>/g, ' ' ).replace( /\s+/g, ' ' ).trim();
	return sprintf( /* translators: 1: kind of step (Step, Contact step, End), 2: its title */ __( '%1$s “%2$s”', 'funnelforms-pro' ), kindOf( node ), short( name || __( 'Without a title', 'funnelforms-pro' ) ) );
}

function short( value: string, max = 48 ): string {
	return value.length > max ? value.slice( 0, max - 1 ) + '…' : value;
}

type AnyField = { id: string; type: string; label?: Record<string, string>; props?: unknown };

/** The fields with this id, with their step, in the order of the form (two when ids clash). */
function fieldsWithId( doc: FormDocument, id: string ): Array<{ node: FormNode; field: AnyField; index: number }> {
	const out: Array<{ node: FormNode; field: AnyField; index: number }> = [];
	for ( const node of doc.nodes ) {
		if ( 'fields' in node ) {
			( node.fields as AnyField[] ).forEach( ( field, index ) => field.id === id && out.push( { node, field, index } ) );
		}
	}
	return out;
}

/** The name of a field as the canvas shows it. */
function fieldName( node: FormNode, field: AnyField, locale: string ): string {
	const own = caption( field as { label?: Record<string, string>; props?: unknown }, locale ).replace( /<[^>]*>/g, ' ' ).replace( /\s+/g, ' ' ).trim();
	return short( own || ( 'contact' === node.type ? contactFieldName( field.type ) : stepFieldName( field.type ) ), 40 );
}

/** "Step “Size” · Field “Area”". */
function fieldPlace( node: FormNode, field: AnyField, locale: string ): string {
	return sprintf( /* translators: 1: a step, e.g. Step “Size”, 2: name of a field */ __( '%1$s · Field “%2$s”', 'funnelforms-pro' ), nodePlace( node, locale ), fieldName( node, field, locale ) );
}

/** "Path from Step “Size” to Contact step “Your details”". */
function edgePlace( doc: FormDocument, edgeId: string, locale: string ): string {
	const edge = doc.edges.find( ( e ) => e.id === edgeId );
	if ( ! edge ) {
		return '';
	}
	const from = findNode( doc, edge.from );
	const to = findNode( doc, edge.to );
	return to
		? sprintf( /* translators: 1: the step a path leaves, 2: the step it leads to */ __( 'Path from %1$s to %2$s', 'funnelforms-pro' ), nodePlace( from, locale ), nodePlace( to, locale ) )
		: sprintf( /* translators: %s: the step a path leaves */ __( 'Path from %s', 'funnelforms-pro' ), nodePlace( from, locale ) );
}

/* ------------------------------------------------------------------ fixes */

/** Rules that ask for a field or answer the form no longer has. */
function brokenRule( doc: FormDocument ): ( leaf: Leaf ) => boolean {
	const options = new Map<string, Set<string>>();
	for ( const node of doc.nodes ) {
		for ( const field of 'fields' in node ? ( node.fields as Array<{ id: string; options?: Array<{ id: string }> }> ) : [] ) {
			options.set( field.id, new Set( ( field.options ?? [] ).map( ( o ) => o.id ) ) );
		}
	}
	return ( leaf ) => {
		if ( ! ( 'field' in leaf ) ) {
			return false;
		}
		const known = options.get( leaf.field );
		return ! known || ( ( 'selected' === leaf.op || 'selectedOnly' === leaf.op ) && ! known.has( String( leaf.value ) ) );
	};
}

const separate = (): IssueFix => ( {
	label: __( 'Give it its own ID', 'funnelforms-pro' ),
	run: ( doc ) => {
		separateDuplicateIds( doc );
		return null;
	},
} );

const dropBroken = (): IssueFix => ( {
	label: __( 'Remove the rule', 'funnelforms-pro' ),
	run: ( doc ) => {
		dropRules( doc, brokenRule( doc ) );
		return null;
	},
} );

/** An end after a step that leads nowhere, with a thank-you text. */
const endAfter = ( nodeId: string ): IssueFix => ( {
	label: __( 'Add an end after it', 'funnelforms-pro' ),
	run: ( doc, ctx ) => {
		const at = doc.layout?.nodes[ nodeId ];
		const end = addEnd( doc, ctx, at ? { position: { x: at.x + 340, y: at.y } } : {} );
		connect( doc, nodeId, end );
		return { node: end };
	},
} );

/* ------------------------------------------------------------------ problems */

/** Problems the builder finds itself, the same the plugin refuses (DocumentChecker). */
export function localProblems( doc: FormDocument ): string[] {
	try {
		return checkReferences( doc );
	} catch {
		// A document the schema would refuse first; the plugin names that on the next save.
		return [];
	}
}

/** Problems of the kinds checkReferences() finds: the builder's own check is current, the last save is not. */
const REFERENCE = /^(duplicate |edge |start node |field |action \S+ (refers|waits)|token |double opt-in |abandonment |public entries |score |lead value |quiz |payment |deposit |subscription |experiments? |calculation |coupon )/;

/** The builder's own problems and what the plugin said on the last save that the builder cannot check. */
export function currentProblems( doc: FormDocument, saved: string[] ): string[] {
	const own = localProblems( doc );
	return [ ...new Set( [ ...own, ...saved.filter( ( p ) => ! REFERENCE.test( p ) ) ] ) ];
}

/** One problem the plugin refuses, for people, with its place. */
function problemIssue( doc: FormDocument, problem: string, locale: string ): Issue {
	const base: Issue = { key: 'p:' + problem, tone: 'error', blocking: true, title: problemText( problem ), help: '', place: '', marks: noMarks() };
	let m: RegExpExecArray | null;

	if ( ( m = /^duplicate field id (\S+)(?: in repeat group (\S+))?$/.exec( problem ) ) ) {
		const all = fieldsWithId( doc, m[ 2 ] ?? m[ 1 ] ?? '' );
		const [ first, second ] = all;
		const place = second ?? first;
		return {
			...base,
			title: m[ 2 ] ? __( 'Two fields of a group have the same ID', 'funnelforms-pro' ) : __( 'Two fields have the same ID', 'funnelforms-pro' ),
			help: __( 'Funnelforms tells fields apart by an internal ID, which is not the variable name, so renaming does not help. Until the second field has its own ID the form cannot be published. One click fixes it; answers, mails and paths keep working.', 'funnelforms-pro' ),
			place: second && first ? sprintf( /* translators: 1: a field and its step, 2: another step */ __( '%1$s, the same as in %2$s', 'funnelforms-pro' ), fieldPlace( second.node, second.field, locale ), nodePlace( first.node, locale ) ) : place ? fieldPlace( place.node, place.field, locale ) : '',
			target: place ? { node: place.node.id, field: m[ 2 ] ? undefined : place.field.id } : undefined,
			fix: separate(),
			marks: { nodes: all.map( ( a ) => a.node.id ), fields: all.map( ( a ) => a.field.id ), edges: [] },
		};
	}
	if ( ( m = /^duplicate (node|edge|calculation|action|experiment) id (\S+)$/.exec( problem ) ) ) {
		const what = m[ 1 ];
		const id = m[ 2 ] ?? '';
		const titles: Record<string, string> = {
			node: __( 'Two steps have the same ID', 'funnelforms-pro' ),
			edge: __( 'Two paths have the same ID', 'funnelforms-pro' ),
			calculation: __( 'Two calculations have the same ID', 'funnelforms-pro' ),
			action: __( 'Two actions after sending have the same ID', 'funnelforms-pro' ),
			experiment: __( 'Two A/B tests have the same ID', 'funnelforms-pro' ),
		};
		const nodes = 'node' === what ? doc.nodes.filter( ( n ) => n.id === id ) : [];
		const edge = 'edge' === what ? doc.edges.find( ( e ) => e.id === id ) : undefined;
		return {
			...base,
			title: titles[ what ?? '' ] ?? base.title,
			help: __( 'Funnelforms tells them apart by an internal ID, which you never see or type. Until the second one has its own ID the form cannot be published. One click fixes it; nothing else changes.', 'funnelforms-pro' ),
			place: nodes[ 0 ] ? nodePlace( nodes[ 0 ], locale ) : edge ? edgePlace( doc, edge.id, locale ) : '',
			target: nodes[ 0 ] ? { node: id } : edge ? { node: edge.from, panel: 'logic' } : 'calculation' === what ? { view: 'settings' } : undefined,
			fix: 'experiment' === what ? undefined : separate(),
			marks: { nodes: nodes.length ? [ id ] : edge ? [ edge.from ] : [], fields: [], edges: edge ? [ edge.id ] : [] },
		};
	}
	if ( ( m = /^edge (\S+) (connects unknown nodes|leaves an end node)$/.exec( problem ) ) ) {
		const edgeId = m[ 1 ] ?? '';
		const edge = doc.edges.find( ( e ) => e.id === edgeId );
		const from = edge ? findNode( doc, edge.from ) : undefined;
		return {
			...base,
			title: 'leaves an end node' === m[ 2 ] ? __( 'A path leaves an end', 'funnelforms-pro' ) : __( 'A path leads to a step that no longer exists', 'funnelforms-pro' ),
			help: 'leaves an end node' === m[ 2 ] ? __( 'Visitors stop at an end, so a path from there is never taken. Delete it.', 'funnelforms-pro' ) : __( 'The step it led to was deleted. Delete the path, then connect the step to where visitors should go.', 'funnelforms-pro' ),
			place: from ? sprintf( /* translators: %s: the step a path leaves */ __( 'Path from %s', 'funnelforms-pro' ), nodePlace( from, locale ) ) : '',
			target: from ? { node: from.id, panel: 'end' === from.type ? undefined : 'logic' } : undefined,
			fix: edge ? { label: __( 'Delete the path', 'funnelforms-pro' ), run: ( d ) => {
					removeEdge( d, edgeId );
					return null;
				} } : undefined,
			marks: { nodes: from ? [ from.id ] : [], fields: [], edges: [ edgeId ] },
		};
	}
	if ( ( m = /^(edge|field|action) (\S+) refers to unknown (field|option) (\S+)$/.exec( problem ) ) ) {
		const owner = m[ 1 ];
		const id = m[ 2 ] ?? '';
		const option = 'option' === m[ 3 ];
		const title = option ? __( 'A rule asks for an answer that no longer exists', 'funnelforms-pro' ) : __( 'A rule asks for a question that no longer exists', 'funnelforms-pro' );
		const help = __( 'The answer or question was deleted, so the rule can never apply and the form cannot be published. Remove the rule, or open it and choose another answer.', 'funnelforms-pro' );
		if ( 'edge' === owner ) {
			const edge = doc.edges.find( ( e ) => e.id === id );
			return { ...base, title, help, place: edgePlace( doc, id, locale ), target: edge ? { edge: id } : undefined, fix: dropBroken(), marks: { nodes: edge ? [ edge.from ] : [], fields: [], edges: [ id ] } };
		}
		if ( 'field' === owner ) {
			const [ at ] = fieldsWithId( doc, id );
			return { ...base, title, help, place: at ? fieldPlace( at.node, at.field, locale ) : '', target: at ? { node: at.node.id, field: id } : undefined, fix: dropBroken(), marks: { nodes: at ? [ at.node.id ] : [], fields: [ id ], edges: [] } };
		}
		const action = doc.actions.find( ( a ) => a.id === id );
		return { ...base, title, help: __( 'An action after sending runs only on an answer that no longer exists. Open it and choose another answer or remove the condition.', 'funnelforms-pro' ), place: '', target: action?.node ? { node: action.node, panel: 'logic' } : { view: 'actions' }, marks: { nodes: action?.node ? [ action.node ] : [], fields: [], edges: [] } };
	}
	if ( ( m = /^start node (\S*) does not exist$/.exec( problem ) ) ) {
		const first = doc.nodes.find( ( n ) => 'end' !== n.type );
		return {
			...base,
			title: __( 'The form has no first step', 'funnelforms-pro' ),
			help: __( 'The step visitors start with was deleted. Choose the step they see first.', 'funnelforms-pro' ),
			target: first ? { node: first.id } : undefined,
			fix: first ? { label: sprintf( /* translators: %s: a step */ __( 'Start with %s', 'funnelforms-pro' ), nodePlace( first, locale ) ), run: ( d ) => {
					setStart( d, first.id );
					return null;
				} } : undefined,
		};
	}
	if ( ( m = /^field (\S+) /.exec( problem ) ) ) {
		const [ at ] = fieldsWithId( doc, m[ 1 ] ?? '' );
		return { ...base, help: __( 'Open the field and complete it.', 'funnelforms-pro' ), place: at ? fieldPlace( at.node, at.field, locale ) : '', target: at ? { node: at.node.id, field: at.field.id } : undefined, marks: { nodes: at ? [ at.node.id ] : [], fields: at ? [ at.field.id ] : [], edges: [] } };
	}
	if ( ( m = /^action (\S+) /.exec( problem ) ) ) {
		const action = doc.actions.find( ( a ) => a.id === m?.[ 1 ] );
		const node = action?.node ? findNode( doc, action.node ) : undefined;
		return { ...base, help: __( 'Open “After sending” of the contact step and complete or delete the action.', 'funnelforms-pro' ), place: node ? nodePlace( node, locale ) : '', target: node ? { node: node.id, panel: 'logic' } : { view: 'actions' }, marks: { nodes: node ? [ node.id ] : [], fields: [], edges: [] } };
	}
	if ( ( m = /^\/nodes\/(\d+)(?:\/fields\/(\d+))?/.exec( problem ) ) ) {
		const node = doc.nodes[ Number( m[ 1 ] ) ];
		const field = node && 'fields' in node && undefined !== m[ 2 ] ? ( node.fields as AnyField[] )[ Number( m[ 2 ] ) ] : undefined;
		return {
			...base,
			title: field ? __( 'A field is incomplete', 'funnelforms-pro' ) : __( 'A step is incomplete', 'funnelforms-pro' ),
			help: __( 'A setting has a value Funnelforms cannot use. Open it and check its settings.', 'funnelforms-pro' ),
			place: node && field ? fieldPlace( node, field, locale ) : nodePlace( node, locale ),
			target: node ? { node: node.id, field: field?.id } : undefined,
			marks: { nodes: node ? [ node.id ] : [], fields: field ? [ field.id ] : [], edges: [] },
		};
	}
	if ( ( m = /^\/actions\/(\d+)/.exec( problem ) ) ) {
		const action = doc.actions[ Number( m[ 1 ] ) ];
		const node = action?.node ? findNode( doc, action.node ) : doc.nodes.find( ( n ) => 'contact' === n.type );
		return { ...base, help: __( 'Open “After sending” of the contact step and complete the action.', 'funnelforms-pro' ), place: node ? nodePlace( node, locale ) : '', target: node ? { node: node.id, panel: 'logic' } : { view: 'actions' }, marks: { nodes: node ? [ node.id ] : [], fields: [], edges: [] } };
	}
	if ( /^token refers to unknown calculation (\S+)$/.test( problem ) ) {
		const calc = problem.split( ' ' ).pop() ?? '';
		const node = doc.nodes.find( ( n ) => JSON.stringify( n ).includes( '{{calc:' + calc ) );
		return { ...base, help: __( 'A text shows the result of a calculation that was deleted. Remove the placeholder from the text.', 'funnelforms-pro' ), place: node ? nodePlace( node, locale ) : '', target: node ? { node: node.id } : undefined, marks: { nodes: node ? [ node.id ] : [], fields: [], edges: [] } };
	}
	if ( /^booking_type_missing$/.test( problem ) ) {
		const node = doc.nodes.find( ( n ) => 'fields' in n && ( n.fields as AnyField[] ).some( ( f ) => 'booking' === f.type && ! ( f.props as { bookingType?: unknown } | undefined )?.bookingType ) );
		const field = node && 'fields' in node ? ( node.fields as AnyField[] ).find( ( f ) => 'booking' === f.type ) : undefined;
		return { ...base, help: __( 'Choose the appointment type visitors book, or create one.', 'funnelforms-pro' ), place: node && field ? fieldPlace( node, field, locale ) : '', target: node ? { node: node.id, field: field?.id } : undefined, marks: { nodes: node ? [ node.id ] : [], fields: field ? [ field.id ] : [], edges: [] } };
	}
	if ( /^\/calculations\/|^calculation |refers to unknown calculation|^(score|lead value|quiz|payment|deposit|subscription|coupon|double opt-in|abandonment|public entries|\/settings\/|experiment)/.test( problem ) ) {
		return { ...base, help: __( 'Open the settings of the form and complete it there.', 'funnelforms-pro' ), target: { view: 'settings' } };
	}
	return base;
}

/**
 * The problems as issues. Fields whose ids clash in one pair of steps are one issue ("3 fields of
 * Contact step “B” have the same IDs as in …"), as one fix separates them all.
 */
export function problemIssues( doc: FormDocument, problems: string[], locale: string ): Issue[] {
	const out: Issue[] = [];
	const clashes = new Map<string, Issue>();
	for ( const problem of problems ) {
		const issue = problemIssue( doc, problem, locale );
		const id = /^duplicate field id (\S+)$/.exec( problem )?.[ 1 ];
		const node = issue.target?.node;
		if ( id && node ) {
			const before = clashes.get( node );
			if ( before ) {
				before.marks.nodes = [ ...new Set( [ ...before.marks.nodes, ...issue.marks.nodes ] ) ];
				before.marks.fields.push( ...issue.marks.fields );
				const second = findNode( doc, node );
				const other = doc.nodes.find( ( n ) => n.id !== node && before.marks.nodes.includes( n.id ) );
				before.title = __( 'Fields have the same IDs as in another step', 'funnelforms-pro' );
				before.place = sprintf( /* translators: 1: a step, 2: another step */ __( '%1$s, the same as in %2$s', 'funnelforms-pro' ), nodePlace( second, locale ), nodePlace( other, locale ) );
				before.target = { node };
				continue;
			}
			clashes.set( node, issue );
		}
		out.push( issue );
	}
	return out;
}

/* ------------------------------------------------------------------ logic */

/** Hints about the logic as issues; hints only for information are left out. */
export function hintIssues( doc: FormDocument, hints: LogicHint[], locale: string ): Issue[] {
	return hints
		.filter( ( h ) => 'info' !== h.level )
		.map( ( h ): Issue => {
			const node = findNode( doc, h.node );
			const field = h.field ? fieldsWithId( doc, h.field )[ 0 ] : undefined;
			const panel: Panel | undefined = h.edge || [ 'deadEnd', 'noOtherwise', 'contactNoEnd', 'endlessLoop' ].includes( h.code ) ? 'logic' : undefined;
			let fix: IssueFix | undefined;
			if ( 'deadEnd' === h.code || 'contactNoEnd' === h.code ) {
				fix = endAfter( h.node );
			} else if ( 'emptyEnd' === h.code && node && 'end' === node.type ) {
				fix = {
					label: __( 'Show a thank-you message', 'funnelforms-pro' ),
					run: ( d, ctx ) => {
						const end = findNode( d, h.node );
						if ( end && 'end' === end.type ) {
							end.success = { ...( end.success ?? { text: { [ ctx.locale ]: '' } } ), show: true };
						}
						return null;
					},
				};
			}
			return {
				key: `h:${ h.code }:${ h.node }:${ h.edge ?? h.field ?? '' }`,
				tone: 'error' === h.level ? 'error' : 'warning',
				blocking: false,
				title: HINT_TITLES()[ h.code ] ?? '',
				help: hintText( h, doc, locale ),
				place: h.edge ? edgePlace( doc, h.edge, locale ) : node && field ? fieldPlace( node, field.field, locale ) : nodePlace( node, locale ),
				target: h.edge ? { edge: h.edge } : { node: h.node, field: h.field, panel },
				fix,
				marks: { nodes: [ h.node ], fields: h.field ? [ h.field ] : [], edges: h.edge ? [ h.edge ] : [] },
			};
		} );
}

/** A short name of each kind of hint; the hint itself (hintText) says the rest. */
const HINT_TITLES = (): Partial<Record<LogicHint[ 'code' ], string>> => ( {
	deadEnd: __( 'Visitors get stuck here', 'funnelforms-pro' ),
	noOtherwise: __( 'Some answers lead nowhere', 'funnelforms-pro' ),
	unreachable: __( 'Visitors never get here', 'funnelforms-pro' ),
	contactNoEnd: __( 'No end after sending', 'funnelforms-pro' ),
	laterAnswer: __( 'A rule asks for a later answer', 'funnelforms-pro' ),
	neverChecked: __( 'A path is never taken', 'funnelforms-pro' ),
	sameRule: __( 'A path is never taken', 'funnelforms-pro' ),
	impossible: __( 'A path is never taken', 'funnelforms-pro' ),
	shadowed: __( 'A path is never taken', 'funnelforms-pro' ),
	noAnswer: __( 'A path is never taken', 'funnelforms-pro' ),
	endlessLoop: __( 'Visitors go round in a circle', 'funnelforms-pro' ),
	showLater: __( 'A field depends on a later answer', 'funnelforms-pro' ),
	allHidden: __( 'The step can be empty', 'funnelforms-pro' ),
	emptyEnd: __( 'The end shows nothing', 'funnelforms-pro' ),
	redirectNoUrl: __( 'The redirect has no address', 'funnelforms-pro' ),
} );

/** Problems first, then what leaves visitors stuck, then the rest; each issue once. */
export function formIssues( doc: FormDocument, problems: string[], hints: LogicHint[], locale: string ): Issue[] {
	const blocking = problemIssues( doc, problems, locale );
	// A path that blocks publishing is not also "never taken": that follows from the same cause.
	const broken = new Set( blocking.flatMap( ( i ) => i.marks.edges ) );
	const all = [ ...blocking, ...hintIssues( doc, hints.filter( ( h ) => ! h.edge || ! broken.has( h.edge ) ), locale ) ];
	const seen = new Set<string>();
	const rank = ( i: Issue ): number => ( i.blocking ? 0 : 'error' === i.tone ? 1 : 2 );
	return all.filter( ( i ) => ! seen.has( i.key ) && !! seen.add( i.key ) ).sort( ( a, b ) => rank( a ) - rank( b ) );
}

/** The worst tone of the issues that mark a step, field or path; undefined when none does. */
export function markOf( issues: Issue[], kind: keyof Marks, id: string ): Issue[ 'tone' ] | undefined {
	let tone: Issue[ 'tone' ] | undefined;
	for ( const issue of issues ) {
		if ( issue.marks[ kind ].includes( id ) ) {
			if ( 'error' === issue.tone ) {
				return 'error';
			}
			tone = 'warning';
		}
	}
	return tone;
}

/** The issues of a path, of a field, or of a step and its fields (not its paths). */
export function issuesAt( issues: Issue[], at: { node?: string; field?: string; edge?: string } ): Issue[] {
	return issues.filter( ( i ) => {
		if ( at.edge ) {
			return i.marks.edges.includes( at.edge );
		}
		if ( at.field ) {
			return i.marks.fields.includes( at.field ) && ( ! at.node || i.marks.nodes.includes( at.node ) );
		}
		return !! at.node && i.marks.nodes.includes( at.node ) && ! i.marks.edges.length;
	} );
}
