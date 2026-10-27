/**
 * The logic of the form in the properties panel: where visitors go after a step (by answer, by
 * rules, otherwise), the rules of one path, and when a field of a step is shown. Rules read as a
 * sentence: "Go to … when all of these apply: Budget is at least 5000 and …".
 */
import React, { useState } from 'react';
import type { Condition, Edge, FormDocument, FormNode } from '@funnelforms/form-schema';
import {
	answerRoutes,
	calcRule,
	fieldsBefore,
	fromGroup,
	isGroup,
	opsFor,
	ruleKind,
	ruleOp,
	setAnswerRoute,
	starterRule,
	toGroup,
	withOp,
	type ConditionField,
	type Group,
	type Leaf,
	type Rule,
	type RuleKind,
	type RuleOp,
} from '../conditions';
import { addEnd, connect, findNode, nodeName, removeEdge, reorderEdge, setCondition, text } from '../document';
import { isQuizEdge } from '../quiz';
import type { Recipe } from '../store';
import { useBuilder, useEnv } from './context';
import { describeCondition, fieldIndex, fieldTitle, opName, partName } from './describe';
import { HintList, useHints } from './Hints';
import { covered } from '../logic';
import { __, sprintf } from './i18n';
import { Button, IconButton, icons, Notice, Section } from './ui';

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

/** A node's name for lists, with what it is in front: "End: Thank you!". */
export function nodeLabel( node: FormNode, locale: string ): string {
	const name = nodeName( node, locale ) || __( 'Without a title', 'funnelforms-pro' );
	const kind = 'step' === node.type ? __( 'Step', 'funnelforms-pro' ) : 'contact' === node.type ? __( 'Contact step', 'funnelforms-pro' ) : __( 'End', 'funnelforms-pro' );
	return sprintf( '%1$s: %2$s', kind, name.length > 48 ? name.slice( 0, 47 ) + '…' : name );
}

/* ------------------------------------------------------------------ targets */

const NEW_END = '#new-end';

/**
 * Where a path leads: any other node of the form, or a new end. `none` names the choice of no
 * node (empty value), when there is one.
 */
export function TargetSelect( { doc, from, value, label: name, none, onChange }: { doc: FormDocument; from: string; value: string; label: string; none?: string; onChange: ( to: string ) => void } ) {
	const { store, ctx, readOnly } = useEnv();
	// Steps with the same title get their number in the form, so they can be told apart.
	const names = new Map<string, number>();
	doc.nodes.forEach( ( n ) => names.set( nodeName( n, ctx.locale ), ( names.get( nodeName( n, ctx.locale ) ) ?? 0 ) + 1 ) );
	const label = ( n: FormNode ): string => {
		const name = nodeName( n, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' );
		return ( names.get( nodeName( n, ctx.locale ) ) ?? 0 ) > 1 ? sprintf( __( '%1$s (no. %2$d)', 'funnelforms-pro' ), name, doc.nodes.indexOf( n ) + 1 ) : name;
	};
	const current = findNode( doc, value );
	const groups: Array<[ string, FormNode[] ]> = [
		[ __( 'Steps', 'funnelforms-pro' ), doc.nodes.filter( ( n ) => 'step' === n.type && n.id !== from ) ],
		[ __( 'Contact steps', 'funnelforms-pro' ), doc.nodes.filter( ( n ) => 'contact' === n.type && n.id !== from ) ],
		[ __( 'Ends', 'funnelforms-pro' ), doc.nodes.filter( ( n ) => 'end' === n.type ) ],
	];
	const choose = ( to: string ): void => {
		if ( NEW_END !== to ) {
			onChange( to );
			return;
		}
		let id = '';
		store.getState().change( ( d ) => {
			const at = d.layout?.nodes[ from ];
			id = addEnd( d, ctx, { position: at ? { x: at.x + 320, y: at.y + 200 } : undefined } );
		} );
		onChange( id );
	};
	return (
		<select className="ffxb-input" aria-label={ name } title={ current ? label( current ) : undefined } value={ value } disabled={ readOnly } onChange={ ( e ) => choose( e.target.value ) }>
			{ undefined !== none ? <option value="">{ none }</option> : null }
			{ groups
				.filter( ( [ , nodes ] ) => nodes.length )
				.map( ( [ name, nodes ] ) => (
					<optgroup key={ name } label={ name }>
						{ nodes.map( ( n ) => (
							<option key={ n.id } value={ n.id }>
								{ label( n ) }
							</option>
						) ) }
					</optgroup>
				) ) }
			<option value={ NEW_END }>{ __( '+ New end', 'funnelforms-pro' ) }</option>
		</select>
	);
}

/* ------------------------------------------------------------------ rules */

/** A first rule: on the first field of the list, else on the first calculation. */
function firstLeaf( doc: FormDocument, fields: ConditionField[], prefer?: string, calcs = true ): Leaf | null {
	const ordered = prefer ? [ ...fields.filter( ( f ) => f.nodeId === prefer ), ...fields ] : fields;
	// Paths and shown fields of Funnelforms Free ask for a chosen answer only.
	for ( const f of 'free' === process.env.FUNNELFORMS_EDITION ? ordered.filter( ( x ) => 'option' === x.kind ) : ordered ) {
		const rule = starterRule( f.field );
		if ( rule ) {
			return rule;
		}
	}
	const calc = calcs ? doc.calculations[ 0 ] : undefined;
	return calc ? calcRule( calc.id ) : null;
}

interface EditorProps {
	doc: FormDocument;
	/** Fields the rules may ask for. */
	fields: ConditionField[];
	/** Rules on calculations (not for fields, which the browser shows). */
	calcs: boolean;
	/** Node whose fields come first in new rules. */
	prefer?: string;
}

/**
 * Rules of a condition: a group whose rules must all or any hold, with groups of the other kind
 * inside for "A and (B or C)". Changes give the new condition, null without rules; typing in a
 * value passes a key, so a run of keystrokes is one step to undo.
 */
export function ConditionEditor( { value, lead, onChange, ...props }: EditorProps & { value: Condition | undefined; lead: string; onChange: ( condition: Condition | null, key?: string ) => void } ) {
	const group = toGroup( value );
	return <GroupEditor { ...props } group={ group } depth={ 0 } lead={ lead } onChange={ ( g, key ) => onChange( fromGroup( g ), key ) } />;
}

function GroupEditor( { group, depth, lead, onChange, onRemove, ...props }: EditorProps & { group: Group; depth: number; lead: string; onChange: ( group: Group, key?: string ) => void; onRemove?: () => void } ) {
	const { readOnly } = useEnv();
	const set = ( i: number, item: Leaf | Group, key?: string ): void => onChange( { ...group, items: group.items.map( ( x, j ) => ( j === i ? item : x ) ) }, key );
	const remove = ( i: number ): void => onChange( { ...group, items: group.items.filter( ( _x, j ) => j !== i ) } );
	const add = ( item: Leaf | Group | null ): void => {
		if ( item ) {
			onChange( { ...group, items: [ ...group.items, item ] } );
		}
	};
	const joiner = 'all' === group.mode ? __( 'and', 'funnelforms-pro' ) : __( 'or', 'funnelforms-pro' );
	const first = (): Leaf | null => firstLeaf( props.doc, props.fields, props.prefer, props.calcs );
	return (
		<div className={ 'ffxb-cond-group' + ( depth ? ' ffxb-cond-group--inner' : '' ) }>
			<div className="ffxb-cond-group__head">
				<span>{ lead }</span>
				{ group.items.length > 1 || depth ? (
					<select
						className="ffxb-input ffxb-cond-group__mode"
						aria-label={ __( 'Which rules must apply', 'funnelforms-pro' ) }
						value={ group.mode }
						disabled={ readOnly }
						onChange={ ( e ) => onChange( { ...group, mode: e.target.value as Group[ 'mode' ] } ) }
					>
						<option value="all">{ __( 'all of these apply', 'funnelforms-pro' ) }</option>
						<option value="any">{ __( 'one of these applies', 'funnelforms-pro' ) }</option>
					</select>
				) : null }
				{ onRemove ? <IconButton label={ __( 'Remove group', 'funnelforms-pro' ) } icon={ icons.close } disabled={ readOnly } onClick={ onRemove } /> : null }
			</div>
			{ group.items.map( ( item, i ) => (
				<React.Fragment key={ i }>
					{ i > 0 ? <div className="ffxb-cond-joiner">{ joiner }</div> : null }
					{ isGroup( item ) ? (
						<GroupEditor { ...props } group={ item } depth={ depth + 1 } lead={ __( 'Group:', 'funnelforms-pro' ) } onChange={ ( g, key ) => set( i, g, key ) } onRemove={ () => remove( i ) } />
					) : (
						<LeafEditor { ...props } leaf={ item } onChange={ ( l, key ) => set( i, l, key ) } onRemove={ () => remove( i ) } />
					) }
				</React.Fragment>
			) ) }
			<div className="ffxb-cond-group__add">
				<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly || ! first() } onClick={ () => add( first() ) }>
					{ __( 'Add rule', 'funnelforms-pro' ) }
				</Button>
				{ 0 === depth && group.items.length > 0 ? (
					<Button
						size="sm"
						variant="ghost"
						icon={ icons.plus }
						disabled={ readOnly || ! first() }
						onClick={ () => {
							const rule = first();
							add( rule ? { mode: 'all' === group.mode ? 'any' : 'all', items: [ rule ] } : null );
						} }
					>
						{ 'all' === group.mode ? __( 'Add "or" group', 'funnelforms-pro' ) : __( 'Add "and" group', 'funnelforms-pro' ) }
					</Button>
				) : null }
			</div>
		</div>
	);
}

const CALC_OPS: Array<'gte' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq'> = [ 'gte', 'gt', 'lte', 'lt', 'eq', 'neq' ];

function LeafEditor( { doc, fields, calcs, leaf, onChange, onRemove }: EditorProps & { leaf: Leaf; onChange: ( leaf: Leaf, key?: string ) => void; onRemove: () => void } ) {
	const { ctx, readOnly } = useEnv();
	if ( 'experiment' in leaf ) {
		const experiment = doc.experiments?.find( ( x ) => x.id === leaf.experiment );
		return (
			<div className="ffxb-rule">
				<span className="ffxb-rule__text">{ describeCondition( leaf, doc, ctx.locale ) + ( experiment?.name ? ` (${ experiment.name })` : '' ) }</span>
				<IconButton label={ __( 'Remove rule', 'funnelforms-pro' ) } icon={ icons.close } disabled={ readOnly } onClick={ onRemove } />
			</div>
		);
	}
	// The subject: a field (its id) or a calculation ("calc:" and its id).
	const subject = 'calc' in leaf ? 'calc:' + leaf.calc : leaf.field;
	const known = fields.some( ( f ) => f.field.id === subject ) || ( 'calc' in leaf && doc.calculations.some( ( c ) => c.id === leaf.calc ) );
	const all = fieldIndex( doc );
	const steps: Array<[ string, ConditionField[] ]> = [];
	for ( const f of fields ) {
		const node = findNode( doc, f.nodeId );
		const name = node ? nodeName( node, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' ) : '';
		const last = steps[ steps.length - 1 ];
		if ( last && last[ 1 ][ 0 ]?.nodeId === f.nodeId ) {
			last[ 1 ].push( f );
		} else {
			steps.push( [ name.length > 40 ? name.slice( 0, 39 ) + '…' : name, [ f ] ] );
		}
	}
	const chooseSubject = ( value: string ): void => {
		if ( value.startsWith( 'calc:' ) ) {
			onChange( calcRule( value.slice( 5 ) ) );
			return;
		}
		const next = fields.find( ( f ) => f.field.id === value );
		const start = next ? starterRule( next.field ) : null;
		if ( start ) {
			onChange( start );
		}
	};
	const subjectSelect = (
		<select className="ffxb-input ffxb-rule__subject" aria-label={ __( 'Field', 'funnelforms-pro' ) } value={ subject } disabled={ readOnly } onChange={ ( e ) => chooseSubject( e.target.value ) }>
			{ known ? null : <option value={ subject }>{ 'calc' in leaf ? __( 'Deleted calculation', 'funnelforms-pro' ) : all.has( leaf.field ) ? sprintf( __( '%s (answered later)', 'funnelforms-pro' ), fieldTitle( all.get( leaf.field ), ctx.locale ) ) : __( 'Deleted field', 'funnelforms-pro' ) }</option> }
			{ steps.map( ( [ name, list ], i ) => (
				<optgroup key={ i } label={ name }>
					{ list.map( ( f ) => (
						<option key={ f.field.id } value={ f.field.id }>
							{ fieldTitle( f.field, ctx.locale ) }
						</option>
					) ) }
				</optgroup>
			) ) }
			{ calcs && doc.calculations.length ? (
				<optgroup label={ __( 'Calculations', 'funnelforms-pro' ) }>
					{ doc.calculations.map( ( c ) => (
						<option key={ c.id } value={ 'calc:' + c.id }>
							{ c.label || c.id }
						</option>
					) ) }
				</optgroup>
			) : null }
		</select>
	);
	const remove = <IconButton label={ __( 'Remove rule', 'funnelforms-pro' ) } icon={ icons.close } disabled={ readOnly } onClick={ onRemove } />;
	if ( 'calc' in leaf ) {
		return (
			<div className="ffxb-rule">
				<div className="ffxb-rule__line">
					{ subjectSelect }
					{ remove }
				</div>
				<div className="ffxb-rule__line">
					<select className="ffxb-input" aria-label={ __( 'Comparison', 'funnelforms-pro' ) } value={ leaf.op } disabled={ readOnly } onChange={ ( e ) => onChange( { ...leaf, op: e.target.value as CalcRuleOp } ) }>
						{ CALC_OPS.map( ( o ) => (
							<option key={ o } value={ o }>
								{ opName( o ) }
							</option>
						) ) }
					</select>
					<input className="ffxb-input" type="number" aria-label={ __( 'Value', 'funnelforms-pro' ) } value={ String( leaf.value ) } disabled={ readOnly } onChange={ ( e ) => onChange( { ...leaf, value: Number( e.target.value ) || 0 }, 'value' ) } />
				</div>
			</div>
		);
	}
	return (
		<div className="ffxb-rule">
			<div className="ffxb-rule__line">
				{ subjectSelect }
				{ remove }
			</div>
			<RuleInputs rule={ leaf } field={ fields.find( ( f ) => f.field.id === leaf.field ) ?? ( all.has( leaf.field ) ? { nodeId: '', field: all.get( leaf.field ) as NonNullable<ReturnType<typeof all.get>>, kind: ruleKind( all.get( leaf.field ) as NonNullable<ReturnType<typeof all.get>> ) ?? 'text' } : undefined ) } onChange={ onChange } />
		</div>
	);
}

type CalcRuleOp = ( typeof CALC_OPS )[ number ];

/** Comparison and value of a rule on an answer. */
function RuleInputs( { rule, field, onChange }: { rule: Rule; field: ConditionField | undefined; onChange: ( rule: Rule, key?: string ) => void } ) {
	const { ctx, readOnly } = useEnv();
	const value = 'value' in rule ? rule.value : undefined;
	const kind: RuleKind = field?.kind ?? ( 'string' === typeof value ? 'text' : 'number' );
	const op = ruleOp( rule );
	const ops = opsFor( kind, field?.field );
	const set = ( change: Partial<Record<'value' | 'days' | 'part', unknown>>, key?: string ): void => {
		// Unset settings are left out, as the schema has no empty values for them.
		const next = Object.fromEntries( Object.entries( { ...rule, ...change } ).filter( ( [ , v ] ) => undefined !== v ) );
		onChange( next as Rule, key );
	};
	let input: React.ReactNode = null;
	if ( 'filled' === rule.op || 'empty' === rule.op ) {
		input = null;
	} else if ( ( 'selected' === rule.op || 'selectedOnly' === rule.op ) && field && 'options' in field.field ) {
		input = (
			<select className="ffxb-input" aria-label={ __( 'Answer', 'funnelforms-pro' ) } value={ String( value ) } disabled={ readOnly } onChange={ ( e ) => set( { value: e.target.value } ) }>
				{ field.field.options.some( ( o ) => o.id === value ) ? null : <option value={ String( value ) }>{ __( 'deleted answer', 'funnelforms-pro' ) }</option> }
				{ field.field.options.map( ( o ) => (
					<option key={ o.id } value={ o.id }>
						{ text( o.label, ctx.locale ).replace( /<[^>]*>/g, '' ) || o.value }
					</option>
				) ) }
			</select>
		);
	} else if ( 'dateBefore' === rule.op || 'dateAfter' === rule.op || 'dateOn' === rule.op ) {
		const today = 'today' === rule.value;
		input = (
			<>
				<select
					className="ffxb-input"
					aria-label={ __( 'Day', 'funnelforms-pro' ) }
					value={ today ? 'today' : 'date' }
					disabled={ readOnly }
					onChange={ ( e ) => set( { value: 'today' === e.target.value ? 'today' : new Date().toISOString().slice( 0, 10 ) } ) }
				>
					<option value="today">{ __( 'today', 'funnelforms-pro' ) }</option>
					<option value="date">{ __( 'a date', 'funnelforms-pro' ) }</option>
				</select>
				{ today ? null : (
					<input className="ffxb-input" type="date" aria-label={ __( 'Date', 'funnelforms-pro' ) } value={ rule.value } disabled={ readOnly } onChange={ ( e ) => e.target.value && set( { value: e.target.value } ) } />
				) }
				<input
					className="ffxb-input ffxb-rule__days"
					type="number"
					step={ 1 }
					aria-label={ __( 'Plus days (minus for earlier)', 'funnelforms-pro' ) }
					title={ __( 'Plus days (minus for earlier)', 'funnelforms-pro' ) }
					value={ rule.days ?? 0 }
					disabled={ readOnly }
					onChange={ ( e ) => {
						const days = Math.trunc( Number( e.target.value ) || 0 );
						set( { days: 0 === days ? undefined : Math.max( -36500, Math.min( 36500, days ) ) }, 'days' );
					} }
				/>
			</>
		);
	} else {
		const numeric = 'number' === typeof value;
		input = (
			<input
				className="ffxb-input"
				aria-label={ __( 'Value', 'funnelforms-pro' ) }
				type={ numeric ? 'number' : 'text' }
				value={ String( value ?? '' ) }
				disabled={ readOnly }
				onChange={ ( e ) => set( { value: numeric ? Number( e.target.value ) || 0 : e.target.value }, 'value' ) }
			/>
		);
	}
	return (
		<div className="ffxb-rule__line">
			{ 'address' === kind ? (
				<select
					className="ffxb-input"
					aria-label={ __( 'Part of the address', 'funnelforms-pro' ) }
					value={ ( 'part' in rule ? rule.part : undefined ) ?? 'address' }
					disabled={ readOnly }
					onChange={ ( e ) => set( { part: 'address' === e.target.value ? undefined : e.target.value } ) }
				>
					{ ( [ 'address', 'street', 'number', 'zip', 'city', 'country' ] as const ).map( ( part ) => (
						<option key={ part } value={ part }>
							{ partName( part ) }
						</option>
					) ) }
				</select>
			) : null }
			<select className="ffxb-input" aria-label={ __( 'Comparison', 'funnelforms-pro' ) } value={ op } disabled={ readOnly } onChange={ ( e ) => onChange( withOp( rule, e.target.value as RuleOp, field?.field ) ) }>
				{ ( ops.includes( op ) ? ops : [ op, ...ops ] ).map( ( o ) => (
					<option key={ o } value={ o }>
						{ opName( o ) }
					</option>
				) ) }
			</select>
			{ input }
		</div>
	);
}

/**
 * The condition of a path in Funnelforms Free: one chosen answer. Rules with "and" and "or",
 * numbers, texts or dates are Pro; a path that has one can get a rule of Free instead.
 */
function FreeCondition( { candidates, value, onChange, subject = 'path' }: { candidates: ConditionField[]; value: Condition | undefined; onChange: ( when: Condition ) => void; subject?: 'path' | 'field' } ) {
	const { ctx, readOnly } = useEnv();
	const fields = candidates.filter( ( f ) => 'option' === f.kind && 'options' in f.field && f.field.options.length > 0 );
	const rule = value && 'field' in value && 'selected' === value.op ? value : undefined;
	const current = rule ? fields.find( ( f ) => f.field.id === rule.field ) : undefined;
	const choose = ( id: string ): void => {
		const next = fields.find( ( f ) => f.field.id === id );
		const start = next ? starterRule( next.field ) : null;
		if ( start ) {
			onChange( start );
		}
	};
	if ( ! fields.length ) {
		return <p className="ffxb-hint">{ 'field' === subject ? __( 'A field can depend on the answer to a choice or dropdown question before it.', 'funnelforms-pro' ) : __( 'A path can ask for the answer to a choice or dropdown question before it.', 'funnelforms-pro' ) }</p>;
	}
	return (
		<div className="ffxb-cond-group">
			{ value && ! rule ? (
				<Notice tone="warning">
					{ 'field' === subject
						? __( 'This field has a condition of Funnelforms Pro. Choose a question and an answer to replace it, or show the field always.', 'funnelforms-pro' )
						: __( 'This path has a condition of Funnelforms Pro. Choose a question and an answer to replace it.', 'funnelforms-pro' ) }
				</Notice>
			) : null }
			<div className="ffxb-rule">
				<div className="ffxb-rule__line">
					<span>{ __( 'when', 'funnelforms-pro' ) }</span>
					<select className="ffxb-input ffxb-rule__subject" aria-label={ __( 'Field', 'funnelforms-pro' ) } value={ current ? current.field.id : '' } disabled={ readOnly } onChange={ ( e ) => choose( e.target.value ) }>
						{ current ? null : <option value="">{ __( 'Choose a question', 'funnelforms-pro' ) }</option> }
						{ fields.map( ( f ) => (
							<option key={ f.field.id } value={ f.field.id }>
								{ fieldTitle( f.field, ctx.locale ) }
							</option>
						) ) }
					</select>
				</div>
				{ current && rule && 'options' in current.field ? (
					<div className="ffxb-rule__line">
						<span>{ __( 'is answered with', 'funnelforms-pro' ) }</span>
						<select className="ffxb-input" aria-label={ __( 'Answer', 'funnelforms-pro' ) } value={ rule.value } disabled={ readOnly } onChange={ ( e ) => onChange( { ...rule, value: e.target.value } ) }>
							{ current.field.options.some( ( o ) => o.id === rule.value ) ? null : <option value={ rule.value }>{ __( 'deleted answer', 'funnelforms-pro' ) }</option> }
							{ current.field.options.map( ( o ) => (
								<option key={ o.id } value={ o.id }>
									{ text( o.label, ctx.locale ).replace( /<[^>]*>/g, '' ) || o.value }
								</option>
							) ) }
						</select>
					</div>
				) : null }
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ one path */

/** The rules, the target and the order of a path with a condition. */
export function PathEditor( { doc, edge, position, count, deletable = true }: { doc: FormDocument; edge: Edge; position: number; count: number; deletable?: boolean } ) {
	const { readOnly } = useEnv();
	const change = useChange();
	return (
		<div className="ffxb-path-editor">
			<div className="ffxb-path-editor__target">
				<span>{ __( 'Go to', 'funnelforms-pro' ) }</span>
				<TargetSelect doc={ doc } from={ edge.from } value={ edge.to } label={ __( 'Go to', 'funnelforms-pro' ) } onChange={ ( to ) => change( ( d ) => void ( ( d.edges.find( ( e ) => e.id === edge.id ) ?? { to } ).to = to ) ) } />
			</div>
			{ 'free' === process.env.FUNNELFORMS_EDITION ? (
				<FreeCondition candidates={ fieldsBefore( doc, edge.from ) } value={ edge.when } onChange={ ( when ) => change( ( d ) => setCondition( d, edge.id, when ) ) } />
			) : (
				<ConditionEditor
					doc={ doc }
					fields={ fieldsBefore( doc, edge.from ) }
					calcs
					prefer={ edge.from }
					value={ edge.when }
					lead={ __( 'when', 'funnelforms-pro' ) }
					onChange={ ( when, key ) => {
						if ( when ) {
							change( ( d ) => setCondition( d, edge.id, when ), key ? `when:${ edge.id }:${ key }` : undefined );
						} else if ( deletable ) {
							// Without rules the path would always be taken: it goes, as with "Delete rule".
							change( ( d ) => removeEdge( d, edge.id ) );
						} else {
							change( ( d ) => setCondition( d, edge.id, null ) );
						}
					} }
				/>
			) }
			<div className="ffxb-row-actions">
				{ count > 1 ? (
					<>
						<Button size="sm" disabled={ readOnly || position <= 0 } onClick={ () => change( ( d ) => reorderEdge( d, edge.id, -1 ) ) }>
							{ __( 'Check earlier', 'funnelforms-pro' ) }
						</Button>
						<Button size="sm" disabled={ readOnly || position >= count - 1 } onClick={ () => change( ( d ) => reorderEdge( d, edge.id, 1 ) ) }>
							{ __( 'Check later', 'funnelforms-pro' ) }
						</Button>
					</>
				) : null }
				{ deletable ? (
					<Button size="sm" variant="ghost" icon={ icons.trash } disabled={ readOnly } onClick={ () => change( ( d ) => removeEdge( d, edge.id ) ) }>
						{ __( 'Delete rule', 'funnelforms-pro' ) }
					</Button>
				) : null }
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ a node's way on */

/**
 * Where visitors go after a step or contact step: by answer (choice fields), by rules checked
 * from the top, and otherwise. Rules open in place.
 */
export function NodeLogic( { doc, node, title }: { doc: FormDocument; node: Extract<FormNode, { type: 'step' | 'contact' }>; title?: string } ) {
	const { ctx, readOnly } = useEnv();
	const change = useChange();
	const hints = useHints().filter( ( h ) => h.node === node.id && 'unreachable' !== h.code );
	const choices = 'step' === node.type ? node.fields.filter( ( f ) => 'options' in f && f.options.length > 0 ) : [];
	const [ by, setBy ] = useState<string>( '' );
	const [ open, setOpen ] = useState<string | null>( null );
	const choice = choices.find( ( f ) => f.id === by ) ?? choices[ 0 ];
	const routes = choice ? answerRoutes( doc, node.id, choice.id ) : [];
	const routed = new Set( routes.flatMap( ( r ) => ( r.edge ? [ r.edge.id ] : [] ) ) );
	const conditional = doc.edges.filter( ( e ) => e.from === node.id && ! e.default );
	const rules = conditional.filter( ( e ) => ! routed.has( e.id ) );
	const fallback = doc.edges.find( ( e ) => e.from === node.id && e.default );
	const quiz = conditional.some( ( e ) => isQuizEdge( doc, e ) );
	const complete = ! fallback && conditional.length > 0 && covered( doc, node, conditional );
	const fields = fieldIndex( doc );

	const addRule = (): void => {
		const when = firstLeaf( doc, fieldsBefore( doc, node.id ), node.id );
		const target = fallback?.to ?? doc.nodes.find( ( n ) => 'end' === n.type )?.id ?? doc.nodes.find( ( n ) => n.id !== node.id )?.id;
		if ( ! when || ! target ) {
			return;
		}
		let id: string | null = null;
		change( ( d ) => {
			id = connect( d, node.id, target, when );
		} );
		setOpen( id );
	};

	const addButton = (
		<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly } onClick={ addRule }>
			{ rules.length || choice ? __( 'Add a rule', 'funnelforms-pro' ) : 'contact' === node.type ? __( 'Another end on certain answers', 'funnelforms-pro' ) : __( 'Add a rule (if … then …)', 'funnelforms-pro' ) }
		</Button>
	);

	if ( quiz ) {
		return (
			<Section title={ title ?? __( 'Next step', 'funnelforms-pro' ) }>
				<Notice tone="info" title={ __( 'Paths to the quiz results', 'funnelforms-pro' ) }>
					{ __( 'The quiz sets the paths after the contact steps: visitors see the result their points reach. Change the results under Quiz in the settings.', 'funnelforms-pro' ) }
				</Notice>
			</Section>
		);
	}

	return (
		<Section title={ title ?? __( 'Next step', 'funnelforms-pro' ) }>
			<HintList doc={ doc } hints={ hints } compact />
			{ choice ? (
				<div className="ffxb-answer-routes">
					<div className="ffxb-answer-routes__head">
						{ choices.length > 1 ? (
							<label>
								<span>{ __( 'By the answer to', 'funnelforms-pro' ) }</span>
								<select className="ffxb-input" value={ choice.id } onChange={ ( e ) => setBy( e.target.value ) }>
									{ choices.map( ( f ) => (
										<option key={ f.id } value={ f.id }>
											{ fieldTitle( f, ctx.locale ) }
										</option>
									) ) }
								</select>
							</label>
						) : (
							<span>
								{ choice && 'step' === node.type && node.fields.length > 1
									? sprintf( __( 'By answer to “%s”', 'funnelforms-pro' ), fieldTitle( choice, ctx.locale ) )
									: __( 'By answer', 'funnelforms-pro' ) }
							</span>
						) }
					</div>
					<ul className="ffxb-answer-routes__list">
						{ routes.map( ( r ) => (
							<li key={ r.option.id }>
								<span className="ffxb-answer-routes__answer" title={ text( r.option.label, ctx.locale ) }>
									{ text( r.option.label, ctx.locale ).replace( /<[^>]*>/g, '' ) || r.option.value }
								</span>
								<span aria-hidden="true" className="ffxb-answer-routes__arrow">
									→
								</span>
								<TargetSelect
									doc={ doc }
									from={ node.id }
									value={ r.edge?.to ?? '' }
									label={ sprintf( __( 'Next step for "%s"', 'funnelforms-pro' ), text( r.option.label, ctx.locale ).replace( /<[^>]*>/g, '' ) || r.option.value ) }
									none={ fallback ? __( 'Like all others', 'funnelforms-pro' ) : __( 'Choose…', 'funnelforms-pro' ) }
									onChange={ ( to ) => change( ( d ) => setAnswerRoute( d, node.id, choice.id, r.option.id, to || null ) ) }
								/>
							</li>
						) ) }
					</ul>
					{ 'choice' === choice.type && choice.props.multiple ? <p className="ffxb-hint">{ __( 'With several answers chosen, the first answer in this list with its own step decides.', 'funnelforms-pro' ) }</p> : null }
				</div>
			) : null }
			{ rules.length ? (
				<ol className="ffxb-logic-rules">
					{ rules.map( ( e ) => {
						const target = findNode( doc, e.to );
						const expanded = open === e.id;
						const position = conditional.indexOf( e );
						return (
							<li key={ e.id } className={ 'ffxb-logic-rule' + ( expanded ? ' is-open' : '' ) + ( hints.some( ( h ) => h.edge === e.id ) ? ' has-hint' : '' ) }>
								<button type="button" className="ffxb-logic-rule__head" aria-expanded={ expanded } onClick={ () => setOpen( expanded ? null : e.id ) }>
									<span className="ffxb-logic-rule__when">
										<span className="ffxb-logic-rule__if">{ __( 'If', 'funnelforms-pro' ) }</span> { e.when ? describeCondition( e.when, doc, ctx.locale, fields ) : __( 'Always', 'funnelforms-pro' ) }
									</span>
									<span className="ffxb-logic-rule__to">→ { target ? nodeName( target, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' ) : '?' }</span>
								</button>
								{ expanded ? <PathEditor doc={ doc } edge={ e } position={ position } count={ conditional.length } /> : null }
								{ expanded ? <HintList doc={ doc } hints={ hints.filter( ( h ) => h.edge === e.id ) } compact /> : null }
							</li>
						);
					} ) }
				</ol>
			) : null }
			{ rules.length || choice ? addButton : null }
			<div className="ffxb-otherwise">
				<span>{ conditional.length ? __( 'Otherwise go to', 'funnelforms-pro' ) : __( 'Go to', 'funnelforms-pro' ) }</span>
				<TargetSelect
					doc={ doc }
					from={ node.id }
					value={ fallback?.to ?? '' }
					label={ conditional.length ? __( 'Otherwise go to', 'funnelforms-pro' ) : __( 'Go to', 'funnelforms-pro' ) }
					none={ complete ? __( 'Not needed', 'funnelforms-pro' ) : 'contact' === node.type ? __( 'Nowhere (empty form)', 'funnelforms-pro' ) : __( 'Nowhere (visitors get stuck)', 'funnelforms-pro' ) }
					onChange={ ( to ) =>
						change( ( d ) => {
							if ( to ) {
								connect( d, node.id, to );
							} else {
								d.edges = d.edges.filter( ( e ) => ! ( e.from === node.id && e.default ) );
							}
						} )
					}
				/>
			</div>
			{ complete ? <p className="ffxb-hint">{ __( 'Every answer has its own next step.', 'funnelforms-pro' ) }</p> : null }
			{ rules.length || choice ? null : addButton }
			<p className="ffxb-hint">{ __( 'Rules are checked from the top; the first that applies decides. You can also draw paths on the canvas.', 'funnelforms-pro' ) }</p>
		</Section>
	);
}

/* ------------------------------------------------------------------ a path selected on the canvas */

export function EdgeInspector( { doc, edgeId }: { doc: FormDocument; edgeId: string } ) {
	const { store, ctx, readOnly } = useEnv();
	const change = useChange();
	const select = store.getState().select;
	const hints = useHints().filter( ( h ) => h.edge === edgeId );
	const edge = doc.edges.find( ( e ) => e.id === edgeId );
	if ( ! edge ) {
		return null;
	}
	const from = findNode( doc, edge.from );
	const to = findNode( doc, edge.to );
	const siblings = doc.edges.filter( ( e ) => e.from === edge.from && ! e.default );
	const position = siblings.findIndex( ( e ) => e.id === edge.id );
	const route = (
		<p className="ffxb-route">
			<span>{ from ? nodeName( from, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' ) : '?' }</span>
			<span aria-hidden="true"> → </span>
			<span>{ to ? nodeName( to, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' ) : '?' }</span>
		</p>
	);
	if ( isQuizEdge( doc, edge ) ) {
		return (
			<Section title={ __( 'Path', 'funnelforms-pro' ) }>
				{ route }
				<Notice tone="info" title={ __( 'Path to a quiz result', 'funnelforms-pro' ) }>
					{ edge.when ? describeCondition( edge.when, doc, ctx.locale ) + '. ' : '' }
					{ __( 'The quiz sets the paths after the contact steps: visitors see the result their points reach. Change the results under Quiz, with nothing selected.', 'funnelforms-pro' ) }
				</Notice>
			</Section>
		);
	}
	const firstRule = (): Leaf | null => firstLeaf( doc, fieldsBefore( doc, edge.from ), edge.from );
	const actions = (
		<IconButton
			label={ __( 'Delete path', 'funnelforms-pro' ) }
			icon={ icons.trash }
			danger
			disabled={ readOnly }
			onClick={ () => {
				change( ( d ) => removeEdge( d, edge.id ) );
				select( {} );
			} }
		/>
	);
	return (
		<>
			<Section title={ __( 'Path', 'funnelforms-pro' ) } actions={ actions }>
				{ route }
				<HintList doc={ doc } hints={ hints } compact />
				{ edge.when ? (
					<>
						<PathEditor doc={ doc } edge={ edge } position={ position } count={ siblings.length } deletable={ false } />
						<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => change( ( d ) => setCondition( d, edge.id, null ) ) }>
							{ __( 'Make it the path without condition', 'funnelforms-pro' ) }
						</Button>
					</>
				) : (
					<>
						<p className="ffxb-hint">{ __( 'Visitors take this path when no path with a condition applies.', 'funnelforms-pro' ) }</p>
						<Button
							size="sm"
							icon={ icons.plus }
							disabled={ readOnly || ! firstRule() }
							onClick={ () => {
								const rule = firstRule();
								if ( rule ) {
									change( ( d ) => setCondition( d, edge.id, rule ) );
								}
							} }
						>
							{ __( 'Add a condition', 'funnelforms-pro' ) }
						</Button>
					</>
				) }
			</Section>
			{ from && 'end' !== from.type ? (
				<div className="ffxb-crumbs">
					<Button size="sm" variant="ghost" icon={ icons.back } onClick={ () => select( { node: from.id } ) }>
						{ __( 'All paths of this step', 'funnelforms-pro' ) }
					</Button>
				</div>
			) : null }
		</>
	);
}

/* ------------------------------------------------------------------ fields shown on answers */

/** When a field of a step with several fields is shown. */
export function FieldVisibility( { node, fieldId }: { node: Extract<FormNode, { type: 'step' }>; fieldId: string } ) {
	const doc = useBuilder( ( s ) => s.doc );
	const { readOnly } = useEnv();
	const change = useChange();
	const field = node.fields.find( ( f ) => f.id === fieldId );
	const hints = useHints().filter( ( h ) => h.field === fieldId );
	if ( ! doc || ! field || ( node.fields.length < 2 && ! field.showWhen ) ) {
		return null;
	}
	const fields = fieldsBefore( doc, node.id, field.id );
	const write = ( when: Condition | null, key?: string ): void =>
		change( ( d ) => {
			const n = findNode( d, node.id );
			const f = n && 'step' === n.type ? n.fields.find( ( x ) => x.id === fieldId ) : undefined;
			if ( f ) {
				if ( when ) {
					f.showWhen = when;
				} else {
					delete f.showWhen;
				}
			}
		}, key ? `show:${ fieldId }:${ key }` : undefined );
	const first = firstLeaf( doc, fields, node.id, false );
	return (
		<div className="ffxb-visibility">
			<p className="ffxb-field__label">{ __( 'Show this field', 'funnelforms-pro' ) }</p>
			<div className="ffxb-segmented" role="group" aria-label={ __( 'Show this field', 'funnelforms-pro' ) }>
				<button type="button" className="ffxb-segmented__item" aria-pressed={ ! field.showWhen } disabled={ readOnly } onClick={ () => write( null ) }>
					{ __( 'Always', 'funnelforms-pro' ) }
				</button>
				<button type="button" className="ffxb-segmented__item" aria-pressed={ Boolean( field.showWhen ) } disabled={ readOnly || ( ! field.showWhen && ! first ) } onClick={ () => ! field.showWhen && first && write( first ) }>
					{ __( 'Only if …', 'funnelforms-pro' ) }
				</button>
			</div>
			{ ! field.showWhen && ! first ? <p className="ffxb-hint">{ __( 'Fields can be shown on answers given above them or on earlier steps. Put the question it depends on first.', 'funnelforms-pro' ) }</p> : null }
			{ field.showWhen ? (
				<>
					{ 'free' === process.env.FUNNELFORMS_EDITION ? (
						<FreeCondition subject="field" candidates={ fields } value={ field.showWhen } onChange={ ( when ) => write( when ) } />
					) : (
						<ConditionEditor doc={ doc } fields={ fields } calcs={ false } prefer={ node.id } value={ field.showWhen } lead={ __( 'Show when', 'funnelforms-pro' ) } onChange={ write } />
					) }
					<p className="ffxb-hint">{ __( 'While hidden, the field is not required and its answer is not sent.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
			<HintList doc={ doc } hints={ hints } compact />
		</div>
	);
}
