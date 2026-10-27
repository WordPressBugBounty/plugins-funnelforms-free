/**
 * Changes of a form document, as the builder makes them. Each function changes the document it
 * gets (an Immer draft in the store) and returns the id of what it created, if anything.
 */
import { current, isDraft } from 'immer';
import type { Condition, ContactField, ContactFieldType, ContactNode, Edge, EndNode, Field, FormDocument, FormNode, Option, RepeatField, RepeatItemField, StepNode, Text } from '@funnelforms/form-schema';
import type { Leaf } from './conditions';

export type FieldType = Field['type'];

/** Field types the builder offers in steps. */
export const STEP_FIELD_TYPES = [ 'choice', 'dropdown', 'text', 'textarea', 'email', 'phone', 'url', 'number', 'date', 'time', 'slider', 'rating', 'content', 'file', 'address', 'signature', 'repeat', 'booking', 'result' ] as const satisfies readonly FieldType[];

/** Field types of contact steps. Phone verification follows with its sending route. */
export const CONTACT_FIELD_TYPES = [ 'salutation', 'name', 'email', 'phone', 'text', 'textarea', 'select', 'checkbox', 'consent', 'html', 'captcha' ] as const satisfies readonly ContactFieldType[];

export type StepFieldType = ( typeof STEP_FIELD_TYPES )[ number ];

/** Default texts of new fields, in the form's language; English when missing. */
export interface Labels {
	question?: string;
	option?: string;
	contactTitle?: string;
	send?: string;
	thanks?: string;
	name?: string;
	email?: string;
	phone?: string;
	text?: string;
	consent?: string;
	salutation?: string;
	dropzone?: string;
	add?: string;
	item?: string;
	clear?: string;
	typeName?: string;
	next?: string;
	quizResult?: string;
	quizPoints?: string;
	quizRight?: string;
	newsletter?: string;
	liveResult?: string;
	liveTotal?: string;
}

const ENGLISH: Required<Labels> = {
	question: 'New question',
	option: 'Option %d',
	contactTitle: 'Your contact details',
	send: 'Send',
	thanks: 'Thank you! We will get back to you soon.',
	name: 'Name',
	email: 'E-mail address',
	phone: 'Phone number',
	text: 'Your message',
	consent: 'I agree to the privacy policy.',
	salutation: 'Salutation',
	dropzone: 'Drop files here or click to upload.',
	add: 'Add',
	item: 'Item %d',
	clear: 'Clear',
	typeName: 'Type your name instead',
	next: 'Next',
	quizResult: 'Your result',
	quizPoints: 'You scored %1$s of %2$s points.',
	quizRight: 'You answered %1$s of %2$s questions right.',
	newsletter: 'Yes, send me news by e-mail.',
	liveResult: 'Your estimate',
	liveTotal: 'Total',
};

export interface Context {
	locale: string;
	labels?: Labels;
}

let random: () => number = Math.random;

/** A deep copy, also of a part of an Immer draft. */
export function clone<T>( value: T ): T {
	return structuredClone( isDraft( value ) ? current( value ) : value );
}

/** Replaces the random source of new ids (tests). */
export function setRandom( source: () => number ): void {
	random = source;
}

/** Every id used in the document: nodes, fields, options, edges, calculations, actions. */
export function usedIds( doc: FormDocument ): Set<string> {
	const ids = new Set<string>();
	const addField = ( field: { id: string; options?: Option[]; props?: unknown } ): void => {
		ids.add( field.id );
		field.options?.forEach( ( o ) => ids.add( o.id ) );
		const inner = ( field.props as { fields?: Array<{ id: string; options?: Option[] }> } | undefined )?.fields;
		inner?.forEach( addField );
	};
	for ( const node of doc.nodes ) {
		ids.add( node.id );
		if ( 'fields' in node ) {
			( node.fields as Array<{ id: string; options?: Option[]; props?: unknown }> ).forEach( addField );
		}
	}
	doc.edges.forEach( ( e ) => ids.add( e.id ) );
	doc.calculations.forEach( ( c ) => ids.add( c.id ) );
	doc.actions.forEach( ( a ) => ids.add( a.id ) );
	return ids;
}

/**
 * A new id with a random part, so the id of a deleted field is never given to a new one
 * (entries keep their answers by field id).
 */
export function newId( doc: FormDocument, prefix: string, taken: Set<string> = usedIds( doc ) ): string {
	for ( ;; ) {
		const id = prefix + '_' + Math.floor( random() * 36 ** 6 ).toString( 36 ).padStart( 6, '0' );
		if ( ! taken.has( id ) ) {
			taken.add( id );
			return id;
		}
	}
}

/** The text in a language, falling back to the first one there is. */
export function text( value: Text | undefined | null, locale: string ): string {
	if ( ! value ) {
		return '';
	}
	return value[ locale ] ?? Object.values( value )[ 0 ] ?? '';
}

/** A default text in the form's language. */
export function formLabel( ctx: Context, key: keyof Labels ): string {
	return ctx.labels?.[ key ] ?? ENGLISH[ key ];
}

function label( ctx: Context, key: keyof Labels, n?: number ): Text {
	const value = formLabel( ctx, key );
	return { [ ctx.locale ]: undefined === n ? value : value.replace( '%d', String( n ) ) };
}

const empty = ( ctx: Context ): Text => ( { [ ctx.locale ]: '' } );

/** A new step field of a type with sensible defaults. */
export function createField( doc: FormDocument, type: StepFieldType, ctx: Context, taken: Set<string> = usedIds( doc ) ): Field {
	const id = newId( doc, 'q', taken );
	const base = { id, key: id, label: label( ctx, 'question' ), description: empty( ctx ), required: true };
	const options = (): Option[] => [ 1, 2 ].map( ( n ) => ( { id: newId( doc, 'o', taken ), label: label( ctx, 'option', n ), value: String( n ) } ) );
	switch ( type ) {
		case 'choice':
			return { ...base, type, options: options(), props: { multiple: false, layout: { desktop: 'grid', mobile: 'list' }, hideIcons: false } };
		case 'dropdown':
			return { ...base, type, options: options(), props: {} };
		case 'text':
		case 'textarea':
		case 'email':
		case 'url':
			return { ...base, type, props: { placeholder: empty( ctx ) } };
		case 'phone':
			// New phone fields have the country picker; older ones keep their free input.
			return { ...base, type, props: { placeholder: empty( ctx ), country: {} } };
		case 'number':
			return { ...base, type, props: { placeholder: empty( ctx ) } };
		case 'date':
			return { ...base, type, props: { placeholder: empty( ctx ), format: 'dd.mm.yy' } };
		case 'time':
			return { ...base, type, props: {} };
		case 'slider':
			return { ...base, type, props: { min: 0, max: 100, step: 1, start: 50, unit: { text: empty( ctx ), position: 'after' }, thousandsSeparator: true, manualInput: { enabled: false, label: empty( ctx ) } } };
		case 'rating':
			return { ...base, type, props: { min: 1, max: 5, style: 'stars', lowLabel: empty( ctx ), highLabel: empty( ctx ) } };
		case 'content':
			return { ...base, required: false, type, props: { html: { [ ctx.locale ]: '<p></p>' }, button: { show: true, label: label( ctx, 'next' ) } } };
		case 'file':
			return { ...base, required: false, type, props: { dropzoneText: label( ctx, 'dropzone' ), maxSizeMb: 10, maxFiles: 1, deniedMimeTypes: [], visibility: 'private' } };
		case 'address':
			return { ...base, type, props: { zoom: 12, start: { name: '', lat: 52.52, lng: 13.405 }, combined: true, showCountry: false, placesAutocomplete: false } };
		case 'booking':
			// The appointment type is chosen in the inspector; until then the form shows a problem.
			return { ...base, type, props: { bookingTypeRef: '' } };
		case 'signature':
			return { ...base, type, props: { clearLabel: label( ctx, 'clear' ), typeLabel: label( ctx, 'typeName' ) } };
		case 'result': {
			// Shows the first calculation, if there is one; the inspector chooses the others.
			const first = doc.calculations[ 0 ];
			const lines = first ? [ { calculation: first.id, label: label( ctx, 'liveTotal' ) } ] : [];
			return { ...base, label: label( ctx, 'liveResult' ), required: false, type, props: { style: 'sticky', lines } };
		}
		case 'repeat': {
			const item = newId( doc, 'q', taken );
			return {
				...base,
				type,
				props: {
					minItems: 1,
					maxItems: 10,
					addLabel: label( ctx, 'add' ),
					itemLabel: label( ctx, 'item' ),
					fields: [ { id: item, key: item, type: 'text', label: label( ctx, 'name' ), description: empty( ctx ), required: true, props: { placeholder: empty( ctx ) } } ],
				},
			};
		}
	}
}

/** A new field of a contact step. */
export function createContactField( doc: FormDocument, type: ( typeof CONTACT_FIELD_TYPES )[ number ], ctx: Context, taken: Set<string> = usedIds( doc ) ): ContactField {
	const id = newId( doc, 'c', taken );
	const field = ( key: string, title: Text, props: Record<string, unknown>, required = true ): ContactField => ( { id, type, key, label: title, required, props } );
	switch ( type ) {
		case 'salutation':
			return field( id, label( ctx, 'salutation' ), {}, false );
		case 'name':
			return field( id, label( ctx, 'name' ), { placeholder: empty( ctx ) } );
		case 'email':
			return field( id, label( ctx, 'email' ), { placeholder: empty( ctx ), b2bOnly: false } );
		case 'phone':
			return field( id, label( ctx, 'phone' ), { placeholder: empty( ctx ), country: {} } );
		case 'text':
			return field( id, label( ctx, 'text' ), { placeholder: empty( ctx ) }, false );
		case 'textarea':
			return field( id, label( ctx, 'text' ), { placeholder: empty( ctx ) }, false );
		case 'select':
			return field( id, label( ctx, 'question' ), { placeholder: empty( ctx ), options: [ 1, 2 ].map( ( n ) => ( { id: `o${ n }`, label: label( ctx, 'option', n ) } ) ) }, false );
		case 'checkbox':
			return field( id, empty( ctx ), { html: label( ctx, 'newsletter' ) }, false );
		case 'consent':
			return field( id, empty( ctx ), { html: label( ctx, 'consent' ) } );
		case 'html':
			return field( id, empty( ctx ), { html: { [ ctx.locale ]: '<p></p>' } }, false );
		case 'captcha':
			return field( id, empty( ctx ), { provider: 'turnstile' } );
	}
}

export interface Placement {
	/** Node the new one follows: its default path leads to the new node, which leads on. */
	after?: string;
	/** Node the new one goes in front of: paths to it lead to the new node, which leads to it. */
	before?: string;
	position?: { x: number; y: number };
}

/** Space a node takes on the canvas, for placing new nodes next to others without overlap. */
const SLOT = { x: 320, y: 180 };

function place( doc: FormDocument, nodeId: string, placement: Placement ): void {
	const layout = ( doc.layout ??= { nodes: {} } );
	let position = placement.position;
	const anchor = placement.after ? layout.nodes[ placement.after ] : placement.before ? layout.nodes[ placement.before ] : undefined;
	if ( ! position && anchor ) {
		// In a row: right of the node it follows, or where the node it precedes was.
		position = { x: placement.after ? anchor.x + SLOT.x : anchor.x, y: anchor.y };
		const target = position;
		const blocked = Object.entries( layout.nodes ).some( ( [ id, p ] ) => id !== placement.after && Math.abs( p.x - target.x ) < SLOT.x - 40 && Math.abs( p.y - target.y ) < SLOT.y );
		if ( blocked ) {
			// Make room: everything from here on in this row moves one slot to the right.
			for ( const p of Object.values( layout.nodes ) ) {
				if ( p.x >= target.x - 40 && Math.abs( p.y - target.y ) < SLOT.y ) {
					p.x += SLOT.x;
				}
			}
		}
	}
	if ( ! position ) {
		const xs = Object.values( layout.nodes ).map( ( p ) => p.x );
		position = { x: xs.length ? Math.max( ...xs ) + SLOT.x : 0, y: 0 };
	}
	layout.nodes[ nodeId ] = position;
	if ( placement.after ) {
		const before = doc.edges.find( ( e ) => e.from === placement.after && e.default );
		if ( before ) {
			// after → new → where after used to lead.
			doc.edges.push( { id: newId( doc, 'e' ), from: nodeId, to: before.to, default: true } );
			before.to = nodeId;
		} else {
			doc.edges.push( { id: newId( doc, 'e' ), from: placement.after, to: nodeId, default: true } );
		}
	} else if ( placement.before && findNode( doc, placement.before ) ) {
		const target = placement.before;
		doc.edges.filter( ( e ) => e.to === target ).forEach( ( e ) => ( e.to = nodeId ) );
		doc.edges.push( { id: newId( doc, 'e' ), from: nodeId, to: target, default: true } );
		if ( doc.start === target ) {
			doc.start = nodeId;
		}
	}
}

/** Adds a step with one field. */
export function addStep( doc: FormDocument, type: StepFieldType, ctx: Context, placement: Placement = {} ): string {
	const taken = usedIds( doc );
	const node: StepNode = { id: newId( doc, 'n', taken ), type: 'step', fields: [ createField( doc, type, ctx, taken ) ] };
	doc.nodes.push( node );
	place( doc, node.id, placement );
	return node.id;
}

/** Adds a contact step with name and e-mail address. */
export function addContact( doc: FormDocument, ctx: Context, placement: Placement = {} ): string {
	const taken = usedIds( doc );
	const node: ContactNode = {
		id: newId( doc, 'contact', taken ),
		type: 'contact',
		title: label( ctx, 'contactTitle' ),
		description: empty( ctx ),
		submitLabel: label( ctx, 'send' ),
		fields: [ createContactField( doc, 'name', ctx, taken ), createContactField( doc, 'email', ctx, taken ) ],
		showBottomBar: true,
	};
	doc.nodes.push( node );
	place( doc, node.id, placement );
	return node.id;
}

/** Adds an end with a thank-you text. */
export function addEnd( doc: FormDocument, ctx: Context, placement: Placement = {} ): string {
	const node: EndNode = { id: newId( doc, 'end' ), type: 'end', success: { show: true, text: label( ctx, 'thanks' ) }, redirect: null };
	doc.nodes.push( node );
	place( doc, node.id, placement );
	return node.id;
}

export function findNode( doc: FormDocument, nodeId: string ): FormNode | undefined {
	return doc.nodes.find( ( n ) => n.id === nodeId );
}

/** Field ids a condition refers to. */
export function conditionFields( condition: Condition ): string[] {
	if ( 'all' in condition ) {
		return condition.all.flatMap( conditionFields );
	}
	if ( 'any' in condition ) {
		return condition.any.flatMap( conditionFields );
	}
	return 'field' in condition ? [ condition.field ] : [];
}

/**
 * Removes a node with its paths and position, and the rules on its fields (see dropRules()).
 * Actions that only run for a removed contact step go with it. The first remaining node becomes
 * the start when the start is removed.
 */
export function removeNode( doc: FormDocument, nodeId: string ): void {
	const node = findNode( doc, nodeId );
	if ( ! node ) {
		return;
	}
	const fields = new Set<string>( 'fields' in node ? node.fields.map( ( f ) => f.id ) : [] );
	doc.nodes = doc.nodes.filter( ( n ) => n.id !== nodeId );
	doc.edges = doc.edges.filter( ( e ) => e.from !== nodeId && e.to !== nodeId );
	dropRules( doc, ( leaf ) => 'field' in leaf && fields.has( leaf.field ) );
	doc.actions = doc.actions.filter( ( a ) => a.node !== nodeId );
	if ( doc.layout ) {
		doc.layout.nodes = Object.fromEntries( Object.entries( doc.layout.nodes ).filter( ( [ id ] ) => id !== nodeId ) );
	}
	if ( doc.start === nodeId && doc.nodes[ 0 ] ) {
		doc.start = doc.nodes[ 0 ].id;
	}
}

/** Adds a field to a step or a contact step; returns its id. */
export function addField( doc: FormDocument, nodeId: string, type: string, ctx: Context, index?: number ): string | null {
	const node = findNode( doc, nodeId );
	if ( ! node || 'end' === node.type ) {
		return null;
	}
	if ( 'contact' === node.type ) {
		if ( ! ( CONTACT_FIELD_TYPES as readonly string[] ).includes( type ) ) {
			return null;
		}
		const field = createContactField( doc, type as ContactFieldType & ( typeof CONTACT_FIELD_TYPES )[ number ], ctx );
		node.fields.splice( index ?? node.fields.length, 0, field );
		return field.id;
	}
	if ( ! ( STEP_FIELD_TYPES as readonly string[] ).includes( type ) ) {
		return null;
	}
	const field = createField( doc, type as StepFieldType, ctx );
	node.fields.splice( index ?? node.fields.length, 0, field );
	return field.id;
}

/** Field types a repeat group can ask for in each item. */
export const REPEAT_FIELD_TYPES = [ 'text', 'textarea', 'email', 'phone', 'url', 'number', 'date', 'time', 'dropdown' ] as const satisfies readonly RepeatItemField['type'][];

export type RepeatFieldType = ( typeof REPEAT_FIELD_TYPES )[ number ];

function repeatGroup( doc: FormDocument, nodeId: string, groupId: string ): RepeatField | undefined {
	const node = findNode( doc, nodeId );
	const field = node && 'step' === node.type ? node.fields.find( ( f ) => f.id === groupId ) : undefined;
	return 'repeat' === field?.type ? field : undefined;
}

/** Adds a field to each item of a repeat group; answers its id. */
export function addRepeatField( doc: FormDocument, nodeId: string, groupId: string, type: RepeatFieldType, ctx: Context ): string | null {
	const group = repeatGroup( doc, nodeId, groupId );
	if ( ! group || ! ( REPEAT_FIELD_TYPES as readonly string[] ).includes( type ) ) {
		return null;
	}
	const field = createField( doc, type, ctx ) as RepeatItemField;
	group.props.fields.push( field );
	return field.id;
}

/** Gives a field of a repeat group another type; it keeps its id, name, question and whether it is required. */
export function setRepeatFieldType( doc: FormDocument, nodeId: string, groupId: string, fieldId: string, type: RepeatFieldType, ctx: Context ): void {
	const fields = repeatGroup( doc, nodeId, groupId )?.props.fields;
	const index = fields?.findIndex( ( f ) => f.id === fieldId ) ?? -1;
	const old = fields?.[ index ];
	if ( ! fields || ! old || old.type === type || ! ( REPEAT_FIELD_TYPES as readonly string[] ).includes( type ) ) {
		return;
	}
	const field = createField( doc, type, ctx ) as RepeatItemField;
	Object.assign( field, { id: old.id, key: old.key, label: old.label, description: old.description, required: old.required } );
	if ( 'placeholder' in old.props && 'placeholder' in field.props && old.props.placeholder ) {
		field.props.placeholder = old.props.placeholder;
	}
	fields[ index ] = field;
}

/** Removes a field of a repeat group; the group keeps at least one. */
export function removeRepeatField( doc: FormDocument, nodeId: string, groupId: string, fieldId: string ): boolean {
	const group = repeatGroup( doc, nodeId, groupId );
	if ( ! group || group.props.fields.length <= 1 || ! group.props.fields.some( ( f ) => f.id === fieldId ) ) {
		return false;
	}
	group.props.fields = group.props.fields.filter( ( f ) => f.id !== fieldId );
	return true;
}

/** Moves a field of a repeat group to another place in the item. */
export function moveRepeatField( doc: FormDocument, nodeId: string, groupId: string, fieldId: string, to: number ): void {
	const fields = repeatGroup( doc, nodeId, groupId )?.props.fields;
	const from = fields?.findIndex( ( f ) => f.id === fieldId ) ?? -1;
	if ( ! fields || from < 0 || to < 0 || to >= fields.length ) {
		return;
	}
	const [ field ] = fields.splice( from, 1 );
	if ( field ) {
		fields.splice( to, 0, field );
	}
}

/** Removes a field and the rules that ask for it (see dropRules()). Steps keep at least one field. */
export function removeField( doc: FormDocument, nodeId: string, fieldId: string ): boolean {
	const node = findNode( doc, nodeId );
	if ( ! node || 'end' === node.type ) {
		return false;
	}
	if ( 'step' === node.type && node.fields.length <= 1 ) {
		return false;
	}
	( node as { fields: Array<{ id: string }> } ).fields = node.fields.filter( ( f ) => f.id !== fieldId ) as typeof node.fields;
	dropRules( doc, asksFor( fieldId ) );
	return true;
}

/**
 * Moves a field within its node or to another node of the same kind (step to step, contact to
 * contact). A step that would lose its last field keeps it.
 */
export function moveField( doc: FormDocument, nodeId: string, fieldId: string, toNodeId: string, toIndex: number ): boolean {
	const from = findNode( doc, nodeId );
	const to = findNode( doc, toNodeId );
	if ( ! from || ! to || 'end' === from.type || from.type !== to.type ) {
		return false;
	}
	const list = from.fields as Array<{ id: string }>;
	const index = list.findIndex( ( f ) => f.id === fieldId );
	if ( index < 0 || ( from !== to && 'step' === from.type && list.length <= 1 ) ) {
		return false;
	}
	const [ field ] = list.splice( index, 1 );
	const target = ( to as { fields: Array<{ id: string }> } ).fields;
	target.splice( Math.max( 0, Math.min( toIndex, target.length ) ), 0, field as { id: string } );
	return true;
}

/**
 * Fresh ids for a copied field and its options (and the fields of a repeat group); `ids` learns
 * which new id each old one became. The key stays when it is free in `keys` (a copy into another
 * form), else it becomes the new id.
 */
function renew<T extends { id: string; key?: string; options?: Option[]; props?: unknown }>(
	doc: FormDocument,
	field: T,
	prefix: string,
	taken: Set<string>,
	ids: Map<string, string> = new Map(),
	keys?: Set<string>
): T {
	const copy = clone( field );
	copy.id = newId( doc, prefix, taken );
	ids.set( field.id, copy.id );
	if ( undefined !== copy.key ) {
		copy.key = keys && copy.key && ! keys.has( copy.key ) ? copy.key : copy.id;
		keys?.add( copy.key );
	}
	copy.options?.forEach( ( o ) => {
		const id = newId( doc, 'o', taken );
		ids.set( o.id, id );
		o.id = id;
	} );
	const inner = ( copy.props as { fields?: Array<{ id: string; key: string }> } | undefined )?.fields;
	inner?.forEach( ( f ) => {
		f.id = newId( doc, 'q', taken );
		f.key = f.id;
	} );
	delete ( copy as { legacy?: unknown } ).legacy;
	return copy;
}

/** Keys of the fields of a form. */
function usedKeys( doc: FormDocument ): Set<string> {
	return new Set( doc.nodes.flatMap( ( n ) => ( 'fields' in n ? ( n.fields as Array<{ key: string }> ).map( ( f ) => f.key ) : [] ) ) );
}

/**
 * Fits the rules of copied fields to where they landed: rules on copied fields and their answers
 * ask for the copies; rules on fields, calculations or tests the form does not have go, as when
 * they are removed (the field is then shown always). Live results keep the lines whose
 * calculation the form has.
 */
function refit( doc: FormDocument, copies: Array<{ id: string }>, ids: Map<string, string> ): void {
	const fields = new Set( doc.nodes.flatMap( ( n ) => ( 'step' === n.type ? n.fields.map( ( f ) => f.id ) : [] ) ) );
	const calcs = new Set( doc.calculations.map( ( c ) => c.id ) );
	const tests = new Set( ( doc.experiments ?? [] ).map( ( e ) => e.id ) );
	const move = ( c: Condition ): Condition => {
		if ( 'all' in c ) {
			return { all: c.all.map( move ) };
		}
		if ( 'any' in c ) {
			return { any: c.any.map( move ) };
		}
		if ( ! ( 'field' in c ) ) {
			return c;
		}
		const leaf = { ...c, field: ids.get( c.field ) ?? c.field };
		if ( ( 'selected' === leaf.op || 'selectedOnly' === leaf.op ) && ids.has( leaf.value ) ) {
			leaf.value = ids.get( leaf.value ) as string;
		}
		return leaf;
	};
	const unknown = ( leaf: Leaf ): boolean => ( 'field' in leaf ? ! fields.has( leaf.field ) : 'calc' in leaf ? ! calcs.has( leaf.calc ) : ! tests.has( leaf.experiment ) );
	for ( const copy of copies as Field[] ) {
		if ( copy.showWhen ) {
			const when = withoutRules( move( copy.showWhen ), unknown );
			if ( false === when ) {
				delete copy.showWhen;
			} else {
				copy.showWhen = when;
			}
		}
		if ( 'result' === copy.type ) {
			copy.props.lines = copy.props.lines.filter( ( l ) => calcs.has( l.calculation ) );
		}
	}
}

/** A copy of a node with new ids, not yet in the form. */
function copyOf( doc: FormDocument, node: FormNode, taken: Set<string>, ids: Map<string, string>, keys?: Set<string> ): FormNode {
	const copy = clone( node ) as FormNode;
	copy.id = newId( doc, 'contact' === node.type ? 'contact' : 'end' === node.type ? 'end' : 'n', taken );
	if ( 'fields' in copy ) {
		( copy as { fields: Array<{ id: string }> } ).fields = copy.fields.map( ( f ) => renew( doc, f as { id: string }, 'contact' === copy.type ? 'c' : 'q', taken, ids, keys ) );
	}
	delete ( copy as { legacy?: unknown } ).legacy;
	return copy;
}

/**
 * Copies a node with new ids, next to the original, without paths. Rules between its fields ask
 * for the copies.
 */
export function duplicateNode( doc: FormDocument, nodeId: string ): string | null {
	const node = findNode( doc, nodeId );
	if ( ! node ) {
		return null;
	}
	const ids = new Map<string, string>();
	const copy = copyOf( doc, node, usedIds( doc ), ids );
	doc.nodes.push( copy );
	const at = doc.layout?.nodes[ nodeId ];
	place( doc, copy.id, { position: at ? { x: at.x + 40, y: at.y + 160 } : undefined } );
	if ( 'step' === copy.type ) {
		refit( doc, copy.fields, ids );
	}
	return copy.id;
}

/** Copies a field right below the original. */
export function duplicateField( doc: FormDocument, nodeId: string, fieldId: string ): string | null {
	const node = findNode( doc, nodeId );
	if ( ! node || 'end' === node.type ) {
		return null;
	}
	const list = node.fields as Array<{ id: string; key?: string }>;
	const index = list.findIndex( ( f ) => f.id === fieldId );
	if ( index < 0 ) {
		return null;
	}
	const copy = renew( doc, list[ index ] as { id: string; key?: string }, 'contact' === node.type ? 'c' : 'q', usedIds( doc ) );
	list.splice( index + 1, 0, copy );
	return copy.id;
}

/** A node or field copied with Ctrl+C, to paste into this form or another one. */
export type Clip = { kind: 'node'; node: FormNode } | { kind: 'field'; field: Field | ContactField; contact: boolean };

/** Whether a value (read from storage) is a clip the builder can paste. */
export function isClip( value: unknown ): value is Clip {
	const clip = value as Partial<{ kind: string; node: { id?: unknown; type?: unknown; fields?: unknown }; field: { id?: unknown; type?: unknown }; contact: unknown }> | null;
	if ( ! clip || 'object' !== typeof clip ) {
		return false;
	}
	if ( 'node' === clip.kind ) {
		const node = clip.node;
		return !! node && 'string' === typeof node.id && ( 'end' === node.type || ( ( 'step' === node.type || 'contact' === node.type ) && Array.isArray( node.fields ) && node.fields.length > 0 ) );
	}
	const field = clip.field;
	if ( 'field' !== clip.kind || ! field || 'string' !== typeof field.id || 'string' !== typeof field.type ) {
		return false;
	}
	return ( ( clip.contact ? CONTACT_FIELD_TYPES : STEP_FIELD_TYPES ) as readonly string[] ).includes( field.type );
}

/**
 * Pastes a copied node with new ids. A step pasted after a step goes into that step's default
 * path; else the copy stands next to `after` (or at the end) without paths. Fields keep their
 * keys when they are free; rules on what the form does not have go (see refit()).
 */
export function pasteNode( doc: FormDocument, node: FormNode, after?: string ): string {
	const ids = new Map<string, string>();
	const copy = copyOf( doc, node, usedIds( doc ), ids, usedKeys( doc ) );
	doc.nodes.push( copy );
	const anchor = after ? findNode( doc, after ) : undefined;
	const at = anchor ? doc.layout?.nodes[ anchor.id ] : undefined;
	if ( 'step' === anchor?.type && 'step' === copy.type ) {
		place( doc, copy.id, { after: anchor.id } );
	} else {
		place( doc, copy.id, { position: at ? { x: at.x + 40, y: at.y + 160 } : undefined } );
	}
	if ( 'step' === copy.type ) {
		refit( doc, copy.fields, ids );
	}
	return copy.id;
}

/**
 * Pastes a copied field into a node, below `afterFieldId` or at the end: step fields into steps,
 * fields of contact steps into contact steps. Null when the node does not take it.
 */
export function pasteField( doc: FormDocument, nodeId: string, field: Field | ContactField, contact: boolean, afterFieldId?: string ): string | null {
	const node = findNode( doc, nodeId );
	if ( ! node || node.type !== ( contact ? 'contact' : 'step' ) ) {
		return null;
	}
	const list = node.fields as Array<{ id: string }>;
	const index = afterFieldId ? list.findIndex( ( f ) => f.id === afterFieldId ) : -1;
	const ids = new Map<string, string>();
	const copy = renew( doc, field as { id: string; key: string }, contact ? 'c' : 'q', usedIds( doc ), ids, usedKeys( doc ) );
	list.splice( index < 0 ? list.length : index + 1, 0, copy );
	if ( ! contact ) {
		refit( doc, [ copy ], ids );
	}
	return copy.id;
}

/**
 * Connects two nodes. Without a condition the path becomes the default path of its node (an
 * earlier default path of that node is replaced); with one it is checked before the default.
 */
export function connect( doc: FormDocument, from: string, to: string, when?: Condition ): string | null {
	const source = findNode( doc, from );
	if ( ! source || ! findNode( doc, to ) || 'end' === source.type || from === to ) {
		return null;
	}
	if ( ! when ) {
		const existing = doc.edges.find( ( e ) => e.from === from && e.default );
		if ( existing ) {
			existing.to = to;
			return existing.id;
		}
	}
	const edge: Edge = when ? { id: newId( doc, 'e' ), from, to, when } : { id: newId( doc, 'e' ), from, to, default: true };
	// Conditional paths go before the default path; their order is the order they are checked in.
	const defaultIndex = doc.edges.findIndex( ( e ) => e.from === from && e.default );
	if ( when && defaultIndex >= 0 ) {
		doc.edges.splice( defaultIndex, 0, edge );
	} else {
		doc.edges.push( edge );
	}
	return edge.id;
}

export function removeEdge( doc: FormDocument, edgeId: string ): void {
	doc.edges = doc.edges.filter( ( e ) => e.id !== edgeId );
}

/** Sets the condition of a path; null makes it the default path of its node. */
export function setCondition( doc: FormDocument, edgeId: string, when: Condition | null ): void {
	const edge = doc.edges.find( ( e ) => e.id === edgeId );
	if ( ! edge ) {
		return;
	}
	if ( null === when ) {
		doc.edges = doc.edges.filter( ( e ) => e.id === edgeId || ! ( e.from === edge.from && e.default ) );
		delete edge.when;
		edge.default = true;
		return;
	}
	delete edge.default;
	edge.when = when;
}

/** Moves a conditional path up (-1) or down (+1) among the paths of its node. */
export function reorderEdge( doc: FormDocument, edgeId: string, delta: -1 | 1 ): void {
	const index = doc.edges.findIndex( ( e ) => e.id === edgeId );
	const edge = doc.edges[ index ];
	if ( ! edge ) {
		return;
	}
	const siblings = doc.edges.map( ( e, i ) => [ e, i ] as const ).filter( ( [ e ] ) => e.from === edge.from && ! e.default );
	const at = siblings.findIndex( ( [ e ] ) => e.id === edgeId );
	const other = siblings[ at + delta ];
	if ( ! other ) {
		return;
	}
	doc.edges[ index ] = other[ 0 ];
	doc.edges[ other[ 1 ] ] = edge;
}

export function setStart( doc: FormDocument, nodeId: string ): void {
	if ( findNode( doc, nodeId ) ) {
		doc.start = nodeId;
	}
}

/** Positions of nodes on the canvas. */
export function setPositions( doc: FormDocument, positions: Record<string, { x: number; y: number }> ): void {
	const layout = ( doc.layout ??= { nodes: {} } );
	for ( const [ id, position ] of Object.entries( positions ) ) {
		layout.nodes[ id ] = { x: Math.round( position.x ), y: Math.round( position.y ) };
	}
}

/** Adds an option to a choice or dropdown field. */
export function addOption( doc: FormDocument, nodeId: string, fieldId: string, ctx: Context ): string | null {
	const node = findNode( doc, nodeId );
	const field = node && 'step' === node.type ? node.fields.find( ( f ) => f.id === fieldId ) : undefined;
	if ( ! field || ! ( 'options' in field ) ) {
		return null;
	}
	const n = field.options.length + 1;
	const option: Option = { id: newId( doc, 'o' ), label: label( ctx, 'option', n ), value: String( n ) };
	field.options.push( option );
	return option.id;
}

/**
 * Answers pasted as a list: one per line, or separated by semicolons or commas when the text has
 * a single line. Empty entries are dropped; at most 200.
 */
export function splitOptionList( value: string ): string[] {
	const separator = /\n/.test( value.trim() ) ? /\r?\n/ : value.includes( ';' ) ? ';' : ',';
	return value
		.split( separator )
		.map( ( v ) => v.trim() )
		.filter( Boolean )
		.slice( 0, 200 );
}

/** Adds answers with these labels (in the form's language); answers that only had the default label are replaced. */
export function addOptions( doc: FormDocument, nodeId: string, fieldId: string, labels: string[], ctx: Context ): number {
	const node = findNode( doc, nodeId );
	const field = node && 'step' === node.type ? node.fields.find( ( f ) => f.id === fieldId ) : undefined;
	if ( ! field || ! ( 'options' in field ) || ! labels.length ) {
		return 0;
	}
	// The answers a new field starts with ("Answer 1", "Answer 2") make way for the list.
	const untouched = ! JSON.stringify( doc.edges ).includes( `"${ fieldId }"` ) && field.options.every( ( o, i ) => text( o.label, ctx.locale ) === text( label( ctx, 'option', i + 1 ), ctx.locale ) && undefined === o.media && undefined === o.calcValue );
	if ( untouched ) {
		field.options = [];
	}
	for ( const name of labels ) {
		const n = field.options.length + 1;
		field.options.push( { id: newId( doc, 'o' ), label: { [ ctx.locale ]: name }, value: String( n ) } );
	}
	return labels.length;
}

/** Removes an option and the rules that ask for it (see dropRules()). Fields keep at least one option. */
export function removeOption( doc: FormDocument, nodeId: string, fieldId: string, optionId: string ): void {
	const node = findNode( doc, nodeId );
	const field = node && 'step' === node.type ? node.fields.find( ( f ) => f.id === fieldId ) : undefined;
	if ( ! field || ! ( 'options' in field ) || field.options.length <= 1 ) {
		return;
	}
	field.options = field.options.filter( ( o ) => o.id !== optionId );
	dropRules( doc, asksFor( fieldId, optionId ) );
}

/** Moves an option of a choice or dropdown field to another place in its list. */
export function moveOption( doc: FormDocument, nodeId: string, fieldId: string, optionId: string, toIndex: number ): boolean {
	const node = findNode( doc, nodeId );
	const field = node && 'step' === node.type ? node.fields.find( ( f ) => f.id === fieldId ) : undefined;
	if ( ! field || ! ( 'options' in field ) ) {
		return false;
	}
	const from = field.options.findIndex( ( o ) => o.id === optionId );
	const to = Math.max( 0, Math.min( field.options.length - 1, toIndex ) );
	if ( from < 0 || from === to ) {
		return false;
	}
	const [ moved ] = field.options.splice( from, 1 );
	field.options.splice( to, 0, moved as Option );
	return true;
}

/**
 * Another field with the same variable name, which calculations, placeholders and integrations
 * would mix up with this one; null when the name is free. The copies of an A/B test share their
 * names on purpose: a field of the same type counts as such a copy while the form has a test.
 */
export function keyClash( doc: FormDocument, fieldId: string ): { node: FormNode; field: Field | ContactField } | null {
	let own: Field | ContactField | undefined;
	const all: Array<{ node: FormNode; field: Field | ContactField }> = [];
	for ( const node of doc.nodes ) {
		for ( const field of 'fields' in node ? ( node.fields as Array<Field | ContactField> ) : [] ) {
			all.push( { node, field } );
			if ( field.id === fieldId ) {
				own = field;
			}
		}
	}
	if ( ! own || '' === own.key ) {
		return null;
	}
	const testing = ( doc.experiments ?? [] ).length > 0;
	return all.find( ( x ) => x.field.id !== fieldId && x.field.key === own?.key && ! ( testing && x.field.type === own.type ) ) ?? null;
}

/** Name of a node on the canvas: the contact title, the first field's label, or the end text. */
export function nodeName( node: FormNode, locale: string ): string {
	const strip = ( html: string ): string => html.replace( /<[^>]*>/g, ' ' ).replace( /\s+/g, ' ' ).trim();
	if ( 'contact' === node.type ) {
		return strip( text( node.title, locale ) );
	}
	if ( 'end' === node.type ) {
		return strip( text( node.success?.text, locale ) ) || text( node.redirect?.url, locale );
	}
	const first = node.fields[ 0 ];
	if ( ! first ) {
		return '';
	}
	return strip( text( first.label, locale ) ) || ( 'content' === first.type ? strip( text( first.props.html, locale ) ) : '' );
}

/** Nodes a visitor can reach from the start. */
export function reachable( doc: FormDocument ): Set<string> {
	const seen = new Set<string>();
	const starts = [ doc.start, ...( doc.experiments ?? [] ).flatMap( ( x ) => x.variants.map( ( v ) => v.start ?? '' ) ) ].filter( Boolean );
	const queue = [ ...starts ];
	while ( queue.length ) {
		const id = queue.shift() as string;
		if ( seen.has( id ) || ! findNode( doc, id ) ) {
			continue;
		}
		seen.add( id );
		doc.edges.filter( ( e ) => e.from === id ).forEach( ( e ) => queue.push( e.to ) );
	}
	return seen;
}

/**
 * Where a new step goes when nothing is selected: on the default path from the start, in front
 * of the first contact step or end.
 */
export function defaultPlacement( doc: FormDocument ): Placement {
	let id: string | undefined = doc.start;
	let last: string | undefined;
	const seen = new Set<string>();
	while ( id && ! seen.has( id ) ) {
		seen.add( id );
		const node = findNode( doc, id );
		if ( ! node ) {
			break;
		}
		if ( 'step' !== node.type ) {
			return last ? { after: last } : { before: id };
		}
		last = id;
		const from: string = id;
		id = ( doc.edges.find( ( e ) => e.from === from && e.default ) ?? doc.edges.find( ( e ) => e.from === from ) )?.to;
	}
	return last ? { after: last } : {};
}

/** The rules of a condition, at any depth. */
export function leaves( condition: Condition ): Leaf[] {
	return 'all' in condition ? condition.all.flatMap( leaves ) : 'any' in condition ? condition.any.flatMap( leaves ) : [ condition ];
}

/* ------------------------------------------------------------------ rules of removed fields */

/**
 * A condition without the rules `gone` names, as they can no longer hold (a removed field or
 * answer): in a group of all the group fails with them, in a group of any the others decide.
 * False when the condition can no longer hold at all.
 */
export function withoutRules( condition: Condition, gone: ( leaf: Leaf ) => boolean ): Condition | false {
	if ( 'all' in condition || 'any' in condition ) {
		const all = 'all' in condition;
		const parts = ( all ? condition.all : condition.any ).map( ( c ) => withoutRules( c, gone ) );
		if ( all && parts.includes( false ) ) {
			return false;
		}
		const kept = parts.filter( ( c ): c is Condition => false !== c );
		if ( 0 === kept.length ) {
			return false;
		}
		if ( 1 === kept.length ) {
			return kept[ 0 ] as Condition;
		}
		return all ? { all: kept } : { any: kept };
	}
	return gone( condition ) ? false : condition;
}

/** What the logic loses when rules go: paths removed, paths changed, fields always shown again. */
export interface LogicLoss {
	removedPaths: number;
	changedPaths: number;
	shownFields: number;
}

/**
 * Removes the rules `gone` names from every path and field: a path whose condition can no
 * longer hold is removed, a field whose condition can no longer hold is shown always.
 */
export function dropRules( doc: FormDocument, gone: ( leaf: Leaf ) => boolean ): LogicLoss {
	const loss: LogicLoss = { removedPaths: 0, changedPaths: 0, shownFields: 0 };
	const kept: Edge[] = [];
	for ( const edge of doc.edges ) {
		if ( ! edge.when || ! leaves( edge.when ).some( gone ) ) {
			kept.push( edge );
			continue;
		}
		const when = withoutRules( edge.when, gone );
		if ( false === when ) {
			++loss.removedPaths;
			continue;
		}
		edge.when = when;
		++loss.changedPaths;
		kept.push( edge );
	}
	if ( loss.removedPaths ) {
		doc.edges = kept;
	}
	for ( const node of doc.nodes ) {
		for ( const field of 'step' === node.type ? node.fields : [] ) {
			if ( ! field.showWhen || ! leaves( field.showWhen ).some( gone ) ) {
				continue;
			}
			const when = withoutRules( field.showWhen, gone );
			if ( false === when ) {
				delete field.showWhen;
				++loss.shownFields;
			} else {
				field.showWhen = when;
			}
		}
	}
	return loss;
}

/** What removing these rules would cost, without changing the document. */
export function lossOf( doc: FormDocument, gone: ( leaf: Leaf ) => boolean ): LogicLoss {
	return dropRules( structuredClone( doc ), gone );
}

/** Rules on a field, or on one answer of it. */
export function asksFor( fieldId: string, optionId?: string ): ( leaf: Leaf ) => boolean {
	return ( leaf ) => 'field' in leaf && leaf.field === fieldId && ( undefined === optionId || ( ( 'selected' === leaf.op || 'selectedOnly' === leaf.op ) && leaf.value === optionId ) );
}
