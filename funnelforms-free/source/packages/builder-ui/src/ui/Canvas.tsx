/**
 * The form as a flow chart (xyflow): steps, contact steps and ends with the paths between them.
 * Nodes are dragged to arrange them, connected by drawing from the right handle to another node,
 * and field types from the palette are dropped onto the canvas (new step) or onto a node (new
 * field in it). The analytics mode (Analytics.tsx) draws the figures of the published form over it.
 */
import React, { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import {
	Background,
	BaseEdge,
	ControlButton,
	Controls,
	EdgeLabelRenderer,
	getBezierPath,
	Handle,
	Panel,
	MarkerType,
	MiniMap,
	Position,
	ReactFlow,
	ReactFlowProvider,
	applyNodeChanges,
	useReactFlow,
	type Connection,
	type ConnectionLineComponentProps,
	type Edge as FlowEdge,
	type EdgeProps,
	type InternalNode,
	type Node as FlowNode,
	type NodeChange,
	type NodeProps,
	type AriaLabelConfig,
	useConnection,
	useStoreApi,
	useUpdateNodeInternals,
} from '@xyflow/react';
import type { FormDocument, FormNode } from '@funnelforms/form-schema';
import type { LogicHint } from '../logic';
import { coverage } from '../coverage';
import { addRulePath, canAddRule, clearOutput, connectOutput, FOLD_FROM, NUMBER_TYPES, OTHERWISE, outputsOf, setNumberRule, type NumberRule, type Outputs, type RuleOutput, type RuleTone } from '../ports';
import { localeTag } from '@funnelforms/form-core';
import { testKind, testSteps } from '../experiments';
import { addContact, addEnd, addField, addStep, fieldKind, nodeName, setPositions, STEP_FIELD_TYPES, text, type StepKind } from '../document';
import type { Selection } from '../store';
import { actionName } from './Actions';
import { AnalyticsLegend, AnalyticsPanel, edgeFigures, NodeAnalyticsView, useAnalytics } from './Analytics';
import { PredictionPanel, usePrediction } from './Prediction';
import { PredictionBar } from './PredictionBar';
import { createPlayback, planPlayback, PlaybackContext, PlaybackLayer, usePlayedShare, type PlaybackBox, type PlaybackGeometry } from './PredictionPlayback';
import { contactFieldName, stepFieldName } from './catalog';
import { caption, isHidden, prefillParam } from './Prefill';
import { SHORTCUTS_EVENT, useBuilder, useEnv } from './context';
import { describeCondition, edgeLabel, fieldIndex, fieldTitle, opName, ruleText } from './describe';
import { hintText, restText, useHints } from './Hints';
import { useIssues } from './Issues';
import { markOf, type Issue } from './formCheck';
import { __, sprintf } from './i18n';
import { REVEAL_EVENT } from './Questions';
import { isQuizEdge } from '../quiz';
import { FiguresContext, NodeFigures } from './Stats';
import { TypeIcon } from './typeIcons';
import { ProBadge } from './ui';
import { proUrl } from '../edition';
import type { CanvasAnalytics, EdgeAnalytics } from '../stats';

/** Type of the data dragged from the palette. */
export const DRAG_TYPE = 'application/x-funnelforms-builder';

/** What the palette drags: a step with a field type, a contact step, an end, or a field. */
export type PaletteItem = { kind: 'step'; type: StepKind } | { kind: 'contact' } | { kind: 'end' } | { kind: 'field'; type: string };

type NodeData = {
	node: FormNode;
	locale: string;
	start: boolean;
	unreachable: boolean;
	/** The variant this step shows in an A/B test (A, B, …); empty outside a test. */
	variant: string;
	/** Hints about the node and its paths, in words. */
	hints: Array<{ level: LogicHint[ 'level' ]; text: string }>;
	/** What is wrong here (issues.ts): the worst tone, the issues in words, and the tone of each field marked. */
	issues: { tone?: Issue[ 'tone' ]; titles: string[]; fields: Record<string, Issue[ 'tone' ]> };
	/** Lights up once after "Show" brought it into view; the field, when it was one. */
	flash: { field?: string; seq: number } | null;
	/** Contact steps: what runs on sending. */
	actions: string[];
	selectedField: string | undefined;
	onSelectField: ( fieldId: string ) => void;
	onAfterSending: () => void;
	/** Where the paths of the node start (none on an end). */
	outputs: OutputsView | null;
	onChooseField: ( fieldId: string ) => void;
	onSelectPath: ( edgeId: string ) => void;
	onAddRule: () => void;
	/** Takes the path away from an output (ports.ts, clearOutput). */
	onClearOutput: ( handle: string ) => void;
	/** Changes a number rule in place; `part` names what was typed, so a run of keystrokes is one step to undo. */
	onSetNumber: ( edgeId: string, fieldId: string, rule: NumberRule, part: string ) => void;
};

/** An output of a node in words: an answer or a rule, with the dot its path starts at. */
type OutputRow = {
	kind: 'answer' | 'rule';
	/** Rules checked before the answers, the answers, rules checked after them. */
	/** The part of the outputs the row belongs to (ports.ts, parts): a line between parts. */
	group: number;
	handle: string;
	label: string;
	title: string;
	/** The path starting here; none for an answer that follows "Otherwise". */
	edge?: string;
	/** The node that path leads to. */
	to?: string;
	tone?: RuleTone;
	symbol?: string;
	warn?: boolean;
	/** The path has a problem that keeps the form from being published. */
	error?: boolean;
	/** A rule on a number of the step the card changes in place: its field, unit and bounds. */
	number?: { field: string; rule: NumberRule; unit: string; unitBefore: boolean; max?: number; step?: number };
};

type OutputsView = {
	rows: OutputRow[];
	/** Several fields with answers: the one the outputs follow, and the others to choose. */
	fields: Array<{ id: string; label: string }>;
	field?: string;
	/** Answers of a multiple choice: the first path in the order decides. */
	multiple: boolean;
	/** open: some answers have no path (a warning); stuck: no path leads on at all. */
	otherwise: { label: string; target: string; title: string; edge?: string; to?: string; state: 'set' | 'none' | 'open' | 'stuck'; warn?: boolean };
	/** A rule can be added from the card: always shown where rules are the way to branch (a number), else on the selected card. */
	addRule: false | 'always' | 'quiet';
	/** The paths are set elsewhere (the results of a quiz): the card shows them and changes nothing. */
	locked: boolean;
};

type CanvasNode = FlowNode<NodeData, 'form'>;

/** The handle the paths end at, at the head of a card (a second one takes drops anywhere on it). */
const TARGET = 'in';

const KIND_NAMES = (): Record<FormNode[ 'type' ], string> => ( {
	step: __( 'Step', 'funnelforms-pro' ),
	contact: __( 'Contact step', 'funnelforms-pro' ),
	end: __( 'End', 'funnelforms-pro' ),
} );

const NodeView = memo( function NodeView( { data, selected }: NodeProps<CanvasNode> ) {
	const { node, locale, start, unreachable, variant, issues, flash, actions, selectedField, onSelectField, onAfterSending } = data;
	// While a path is drawn from another node, the whole card takes the drop.
	const drop = useConnection( ( c ) => c.inProgress && c.fromNode.id !== node.id );
	// The card the path under the pointer leads to.
	const aimed = useStore( useContext( HotContext ), ( s ) => s.to === node.id );
	const worst = issues.tone;
	const figures = useContext( FiguresContext )?.get( node.id );
	// The figures of the prediction or of the analytics; one of the two modes is on at a time.
	const forecast = 'free' === process.env.FUNNELFORMS_EDITION ? undefined : usePrediction()?.figures?.nodes.get( node.id );
	const measured = 'free' === process.env.FUNNELFORMS_EDITION ? undefined : useAnalytics()?.figures?.nodes.get( node.id );
	const analytics = forecast ?? measured;
	// While the visitors of the prediction play, its figures count up with the dots.
	const played = 'free' === process.env.FUNNELFORMS_EDITION ? null : usePlayedShare( node.id );
	const name = nodeName( node, locale );
	const fields = 'fields' in node ? ( node.fields as Array<{ id: string; type: string; label: Record<string, string>; showWhen?: unknown; props?: unknown }> ) : [];
	return (
		<div
			className={
				`ffxb-node ffxb-node--${ node.type }` +
				( selected ? ' is-selected' : '' ) +
				( unreachable ? ' is-unreachable' : '' ) +
				( analytics ? ' has-analytics' + ( analytics.band ? ` is-band-${ analytics.band }` : '' ) + ( 0 === analytics.reached ? ' is-cold' : '' ) + ( analytics.strongest ? ' is-strongest' : '' ) : '' ) +
				( drop ? ' is-drop' : '' ) +
				( aimed ? ' is-aimed' : '' ) +
				( worst ? ` has-${ worst }` : '' ) +
				( flash && ! flash.field ? ' is-flash' : '' )
			}
			key={ flash && ! flash.field ? 'flash-' + flash.seq : undefined }
			data-node={ node.id }
		>
			<Handle type="target" position={ Position.Left } id={ TARGET } className="ffxb-handle ffxb-handle--in" isConnectableStart={ false } />
			<Handle type="target" position={ Position.Left } id="drop" className="ffxb-handle-drop" isConnectableStart={ false } />
			<div className="ffxb-node__head">
				<span className="ffxb-node__icon" aria-hidden="true">
					<TypeIcon type={ 'step' === node.type ? ( fields[ 0 ] ? fieldKind( fields[ 0 ] ) : 'text' ) : node.type } size={ 14 } />
				</span>
				<span className="ffxb-node__kind">{ KIND_NAMES()[ node.type ] }</span>
				{ start ? <span className="ffxb-node__flag ffxb-node__flag--start">{ __( 'Start', 'funnelforms-pro' ) }</span> : null }
				{ variant ? (
					<span className="ffxb-node__flag ffxb-node__flag--ab" title={ sprintf( __( 'A/B test: variant %s', 'funnelforms-pro' ), variant ) }>
						{ sprintf( __( 'A/B · %s', 'funnelforms-pro' ), variant ) }
					</span>
				) : null }
				{ unreachable ? <span className="ffxb-node__flag ffxb-node__flag--warn">{ __( 'Not reachable', 'funnelforms-pro' ) }</span> : null }
				{ worst && ( 'error' === worst || ! unreachable ) ? (
					<span className={ `ffxb-node__flag ffxb-node__flag--${ 'error' === worst ? 'error' : 'warn' }` } title={ issues.titles.join( '\n' ) }>
						{ 'error' === worst ? 1 === issues.titles.length ? __( 'Problem', 'funnelforms-pro' ) : sprintf( /* translators: %d: number of problems */ __( 'Problems: %d', 'funnelforms-pro' ), issues.titles.length ) : __( 'Notice', 'funnelforms-pro' ) }
					</span>
				) : null }
			</div>
			<div className="ffxb-node__title" title={ name || undefined }>{ name || <em>{ __( 'Without a title', 'funnelforms-pro' ) }</em> }</div>
			{ fields.length > 1 || 'contact' === node.type ? (
				<ul className="ffxb-node__fields">
					{ fields.map( ( f ) => (
						<li key={ f.id }>
							<button
								type="button"
								className={ 'ffxb-node__field nodrag' + ( selectedField === f.id ? ' is-selected' : '' ) + ( issues.fields[ f.id ] ? ` is-${ issues.fields[ f.id ] }` : '' ) + ( flash?.field === f.id ? ' is-flash' : '' ) }
								key={ flash?.field === f.id ? 'flash-' + flash.seq : undefined }
								onClick={ ( e ) => {
									e.stopPropagation();
									onSelectField( f.id );
								} }
							>
								{ 'contact' === node.type ? null : <span className="ffxb-node__field-type">{ stepFieldName( fieldKind( f ) ) }</span> }
								{ 'showWhen' in f && f.showWhen ? (
									<span className="ffxb-node__field-if" title={ __( 'Shown only on certain answers', 'funnelforms-pro' ) }>
										{ __( 'if', 'funnelforms-pro' ) }
									</span>
								) : null }
								{ isHidden( f, 'contact' === node.type ) ? (
									<span className="ffxb-node__field-if" title={ __( 'Hidden field', 'funnelforms-pro' ) }>
										{ __( 'hidden', 'funnelforms-pro' ) }
									</span>
								) : null }
								{ prefillParam( f ) && isHidden( f, 'contact' === node.type ) ? (
									<span className="ffxb-node__field-if" title={ sprintf( /* translators: %s: name of the URL parameter */ __( 'Filled from the URL parameter %s', 'funnelforms-pro' ), prefillParam( f ) ?? '' ) }>
										URL
									</span>
								) : null }
								<span className="ffxb-node__field-label" title={ caption( f, locale ) || undefined }>{ caption( f, locale ) || ( 'contact' === node.type ? contactFieldName( f.type ) : '' ) }</span>
							</button>
						</li>
					) ) }
				</ul>
			) : fields[ 0 ] ? (
				<div className="ffxb-node__meta">{ loadingMeta( fields[ 0 ] ) ?? stepFieldName( fields[ 0 ].type ) }</div>
			) : null }
			{ 'end' === node.type ? <div className="ffxb-node__meta">{ endKind( node ) }</div> : null }
			{ 'contact' === node.type ? (
				<button
					type="button"
					className="ffxb-node__after nodrag"
					onClick={ ( e ) => {
						e.stopPropagation();
						onAfterSending();
					} }
				>
					<span className="ffxb-node__after-head">{ __( 'After sending', 'funnelforms-pro' ) }</span>
					{ actions.length ? (
						<span className="ffxb-node__chips">
							{ actions.slice( 0, 3 ).map( ( a, i ) => (
								<span key={ i } className="ffxb-node__chip">
									{ a }
								</span>
							) ) }
							{ actions.length > 3 ? <span className="ffxb-node__chip">+{ actions.length - 3 }</span> : null }
						</span>
					) : (
						<span className="ffxb-node__after-none">{ __( 'Only saved. Add a mail …', 'funnelforms-pro' ) }</span>
					) }
				</button>
			) : null }
			{ worst && issues.titles[ 0 ] ? (
				<div className={ `ffxb-node__issue is-${ worst }` } title={ issues.titles.join( '\n' ) }>
					<span aria-hidden="true" className="ffxb-node__issue-icon">
						!
					</span>
					<span className="ffxb-node__issue-text">{ issues.titles[ 0 ] }</span>
					{ issues.titles.length > 1 ? <span className="ffxb-node__issue-more">+{ issues.titles.length - 1 }</span> : null }
				</div>
			) : null }
			{ 'free' !== process.env.FUNNELFORMS_EDITION && analytics ? <NodeAnalyticsView type={ node.type } figures={ analytics } forecast={ !! forecast } played={ forecast ? played : null } /> : figures ? <NodeFigures figures={ figures } /> : null }
			{ data.outputs ? <NodeOutputs id={ node.id } outputs={ data.outputs } selected={ !! selected } onChooseField={ data.onChooseField } onSelectPath={ data.onSelectPath } onAddRule={ data.onAddRule } onClearOutput={ data.onClearOutput } onSetNumber={ data.onSetNumber } /> : null }
		</div>
	);
} );

/**
 * The line while a path is drawn. Over a card it ends at the dot at the head of the card, where the
 * path will end, not at the middle of the card (the "drop" handle covers the whole card).
 */
function ConnectionLine( { fromX, fromY, fromPosition, toX, toY, toPosition, toNode, toHandle, connectionLineStyle }: ConnectionLineComponentProps<CanvasNode> ) {
	let x = toX;
	let y = toY;
	let position = toPosition;
	if ( toNode && toHandle && TARGET !== toHandle.id ) {
		const head = toNode.internals.handleBounds?.target?.find( ( h ) => h.id === TARGET );
		if ( head ) {
			x = toNode.internals.positionAbsolute.x + head.x + head.width / 2;
			y = toNode.internals.positionAbsolute.y + head.y + head.height / 2;
			position = Position.Left;
		}
	}
	const [ path ] = getBezierPath( { sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: x, targetY: y, targetPosition: position } );
	return <path className="react-flow__connection-path" d={ path } fill="none" style={ connectionLineStyle } />;
}

/** The path the pointer is on, on a card or on the canvas: its row, its line and the card it leads to light up together. */
type Hot = { edge: string | null; to: string | null };
const COLD: Hot = { edge: null, to: null };
const HotContext = React.createContext<StoreApi<Hot>>( createStore<Hot>( () => COLD ) );

const SIGNS: Record<NumberRule[ 'op' ], string> = { lt: '<', lte: '≤', eq: '=', gte: '≥', gt: '>', neq: '≠', between: '↔' };
const NUMBER_OPS: Array<NumberRule[ 'op' ]> = [ 'lt', 'lte', 'eq', 'gte', 'gt', 'between' ];

/** A number of a rule on the card; what is typed counts once it is a number. */
function NumberBox( { value, label, step, disabled, onCommit }: { value: number; label: string; step?: number; disabled: boolean; onCommit: ( n: number ) => void } ) {
	const [ draft, setDraft ] = useState<string | null>( null );
	const shown = draft ?? String( value );
	return (
		<input
			className="ffxb-output__value nodrag nopan"
			type="number"
			aria-label={ label }
			step={ step ?? 'any' }
			value={ shown }
			disabled={ disabled }
			style={ { width: `calc(${ Math.min( 9, Math.max( 2, shown.length ) ) }ch + 14px)` } }
			title={ shown }
			onClick={ ( e ) => e.stopPropagation() }
			onKeyDown={ ( e ) => e.stopPropagation() }
			onBlur={ () => setDraft( null ) }
			onChange={ ( e ) => {
				setDraft( e.target.value );
				const n = Number( e.target.value );
				if ( '' !== e.target.value.trim() && Number.isFinite( n ) ) {
					onCommit( n );
				}
			} }
		/>
	);
}

/** A rule on the number of the step, changed where it stands: its comparison and its number, or two for "between". */
function NumberRuleInput( { number, disabled, onChange }: { number: NonNullable<OutputRow[ 'number' ]>; disabled: boolean; onChange: ( rule: NumberRule, key: string ) => void } ) {
	const { rule } = number;
	const low = 'between' === rule.op ? rule.min : rule.value;
	const setOp = ( op: NumberRule[ 'op' ] ): void => {
		if ( 'between' === op ) {
			onChange( { op, min: low, max: 'between' === rule.op ? rule.max : Math.max( low, number.max ?? low ) }, 'op' );
		} else {
			onChange( { op, value: low }, 'op' );
		}
	};
	const ops = NUMBER_OPS.includes( rule.op ) ? NUMBER_OPS : [ rule.op, ...NUMBER_OPS ];
	return (
		<span className="ffxb-output__number">
			{ /* The sign shows at all times; the list over it names each comparison in words. */ }
			<span className={ 'ffxb-output__op' + ( disabled ? ' is-disabled' : '' ) } title={ opName( rule.op ) }>
				<span className="ffxb-output__sign" aria-hidden="true">
					{ SIGNS[ rule.op ] }
				</span>
				<select
					className="ffxb-output__ops nodrag nopan"
					aria-label={ __( 'Comparison', 'funnelforms-pro' ) }
					value={ rule.op }
					disabled={ disabled }
					onClick={ ( e ) => e.stopPropagation() }
					onKeyDown={ ( e ) => e.stopPropagation() }
					onChange={ ( e ) => setOp( e.target.value as NumberRule[ 'op' ] ) }
				>
					{ ops.map( ( op ) => (
						<option key={ op } value={ op }>
							{ SIGNS[ op ] + '  ' + opName( op ) }
						</option>
					) ) }
				</select>
			</span>
			<span className="ffxb-output__values">
			{ number.unit && number.unitBefore ? <span className="ffxb-output__unit">{ number.unit }</span> : null }
			{ 'between' === rule.op ? (
				<>
					<NumberBox value={ rule.min } label={ __( 'Minimum', 'funnelforms-pro' ) } step={ number.step } disabled={ disabled } onCommit={ ( n ) => onChange( { ...rule, min: n }, 'min' ) } />
					<span className="ffxb-output__dash" aria-hidden="true">
						–
					</span>
					<NumberBox value={ rule.max } label={ __( 'Maximum', 'funnelforms-pro' ) } step={ number.step } disabled={ disabled } onCommit={ ( n ) => onChange( { ...rule, max: n }, 'max' ) } />
				</>
			) : (
				<NumberBox value={ rule.value } label={ __( 'Value', 'funnelforms-pro' ) } step={ number.step } disabled={ disabled } onCommit={ ( n ) => onChange( { ...rule, value: n }, 'value' ) } />
			) }
			{ number.unit && ! number.unitBefore ? <span className="ffxb-output__unit">{ number.unit }</span> : null }
			</span>
		</span>
	);
}

type OutputActions = Pick<NodeData, 'onChooseField' | 'onSelectPath' | 'onAddRule' | 'onClearOutput' | 'onSetNumber'>;

/**
 * The outputs of a node, each with the dot its path starts at, in the order the form checks
 * them: rules checked first, the answers of a choice (empty dot: follows "Otherwise"), rules
 * checked after them, and "Otherwise" last. A number rule of the step is changed in place. From
 * six answers on, the answers without a path of their own fold away.
 */
function NodeOutputs( { id, outputs, selected, onChooseField, onSelectPath, onAddRule, onClearOutput, onSetNumber }: { id: string; outputs: OutputsView; selected: boolean } & OutputActions ) {
	const env = useEnv();
	const readOnly = env.readOnly || outputs.locked;
	const [ unfolded, setUnfolded ] = useState( false );
	const answers = outputs.rows.filter( ( r ) => 'answer' === r.kind );
	const foldable = answers.length >= FOLD_FROM && answers.some( ( r ) => ! r.edge );
	const hidden = foldable && ! unfolded ? answers.filter( ( r ) => ! r.edge ).length : 0;
	const rows = hidden ? outputs.rows.filter( ( r ) => 'rule' === r.kind || r.edge ) : outputs.rows;
	const update = useUpdateNodeInternals();
	// The dots move or change with the rows: React Flow measures them again.
	const key = rows.map( ( r ) => r.handle + ( r.number ? r.number.rule.op : '' ) ).join( ' ' ) + ' ' + outputs.otherwise.state;
	useEffect( () => update( id ), [ key, id, update ] );
	const { otherwise } = outputs;
	const linked = answers.filter( ( r ) => r.edge ).length;
	const hotStore = useContext( HotContext );
	const mine = [ ...outputs.rows.map( ( r ) => r.edge ), otherwise.edge ];
	const hot = useStore( hotStore, ( s ) => ( s.edge && mine.includes( s.edge ) ? s.edge : null ) );
	const hover = ( edge: string | undefined, to: string | undefined ) => ( edge ? { onMouseEnter: () => hotStore.setState( { edge, to: to ?? null } ), onMouseLeave: () => hotStore.setState( COLD ) } : {} );
	const stop = ( run: () => void ) => ( e: React.MouseEvent ): void => {
		e.stopPropagation();
		run();
	};
	const toggle = ( label: string, onClick: () => void ): React.ReactElement => (
		<button type="button" className="ffxb-output__toggle nodrag" onClick={ stop( onClick ) }>
			{ label }
		</button>
	);
	const label = ( text: string, edge: string | undefined ): React.ReactElement =>
		edge ? (
			<button type="button" className="ffxb-output__label nodrag" onClick={ stop( () => onSelectPath( edge ) ) }>
				{ text }
			</button>
		) : (
			<span className="ffxb-output__label">{ text }</span>
		);
	const clear = ( handle: string, name: string ): React.ReactElement | null =>
		readOnly ? null : (
			<button type="button" className="ffxb-output__clear nodrag" aria-label={ name } title={ name } onClick={ stop( () => onClearOutput( handle ) ) }>
				<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
					<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
				</svg>
			</button>
		);
	return (
		<div className="ffxb-node__outputs">
			{ outputs.fields.length > 1 ? (
				<label className="ffxb-output-note ffxb-output-note--choose nodrag">
					<span>{ __( 'Outputs by', 'funnelforms-pro' ) }</span>
					<select className="ffxb-output__field" value={ outputs.field ?? '' } onChange={ ( e ) => onChooseField( e.target.value ) } onClick={ ( e ) => e.stopPropagation() }>
						{ outputs.fields.map( ( f ) => (
							<option key={ f.id } value={ f.id }>
								{ f.label }
							</option>
						) ) }
					</select>
				</label>
			) : null }
			{ rows.map( ( r, i ) => (
				<div
					key={ r.handle }
					className={
						`ffxb-output ffxb-output--${ r.kind }` +
						( r.edge ? ' is-linked' : ' is-free' ) +
						( r.tone ? ` is-${ r.tone }` : '' ) +
						( r.warn ? ' is-warn' : '' ) +
						( r.error ? ' is-error' : '' ) +
						( r.edge && hot === r.edge ? ' is-hot' : '' ) +
						( i > 0 && rows[ i - 1 ]?.group !== r.group ? ' is-group-start' : '' )
					}
					title={ r.title }
					data-path={ r.edge }
					{ ...hover( r.edge, r.to ) }
				>
					{ 'rule' === r.kind && ! r.number ? (
						<span className="ffxb-output__symbol" aria-hidden="true">
							{ r.symbol || __( 'If', 'funnelforms-pro' ) }
						</span>
					) : null }
					{ r.number && r.edge ? <NumberRuleInput number={ r.number } disabled={ readOnly } onChange={ ( rule, part ) => onSetNumber( r.edge as string, r.number?.field ?? '', rule, part ) } /> : label( r.label, r.edge ) }
					{ r.edge ? clear( r.handle, sprintf( 'rule' === r.kind ? /* translators: %s: a rule, e.g. "< 20" */ __( 'Delete the rule “%s”', 'funnelforms-pro' ) : /* translators: %s: an answer or "Otherwise" */ __( 'Remove the path of “%s”', 'funnelforms-pro' ), ( r.symbol ? r.symbol + ' ' : '' ) + r.label ) ) : null }
					<Handle type="source" position={ Position.Right } id={ r.handle } className={ 'ffxb-handle ffxb-handle--output' + ( r.edge ? '' : ' is-free' ) } title={ r.title } aria-label={ r.title } isConnectable={ ! outputs.locked } />
				</div>
			) ) }
			{ foldable ? (
				<div className="ffxb-output-note ffxb-output-note--more">
					{ hidden ? <span>{ sprintf( /* translators: %d: number of answers without a path of their own */ __( '%d more like “Otherwise”', 'funnelforms-pro' ), hidden ) }</span> : null }
					{ hidden ? toggle( __( 'Show all', 'funnelforms-pro' ), () => setUnfolded( true ) ) : toggle( __( 'Show fewer', 'funnelforms-pro' ), () => setUnfolded( false ) ) }
				</div>
			) : null }
			{ outputs.multiple && linked > 1 ? <div className="ffxb-output-note">{ __( 'With several answers chosen, the first answer in this list with its own step decides.', 'funnelforms-pro' ) }</div> : null }
			{ ! readOnly && ( 'always' === outputs.addRule || ( 'quiet' === outputs.addRule && selected ) ) ? (
				<button type="button" className="ffxb-output-add nodrag" onClick={ stop( onAddRule ) }>
					<span aria-hidden="true">+</span> { __( 'Add a rule', 'funnelforms-pro' ) }
				</button>
			) : null }
			<div className={ `ffxb-output ffxb-output--otherwise is-${ otherwise.state }` + ( otherwise.warn ? ' is-warn' : '' ) + ( otherwise.edge && hot === otherwise.edge ? ' is-hot' : '' ) } title={ otherwise.title } data-path={ otherwise.edge } { ...hover( otherwise.edge, otherwise.to ) }>
				<b className="ffxb-output__name">{ otherwise.label }</b>
				{ otherwise.edge ? (
					<span className="ffxb-output__arrow" aria-hidden="true" />
				) : null }
				{ label( otherwise.target, otherwise.edge ) }
				{ otherwise.edge ? clear( OTHERWISE, sprintf( __( 'Remove the path of “%s”', 'funnelforms-pro' ), otherwise.label ) ) : null }
				<Handle type="source" position={ Position.Right } id={ OTHERWISE } className={ 'ffxb-handle ffxb-handle--output ffxb-handle--otherwise' + ( otherwise.edge ? '' : ' is-free' ) } title={ otherwise.title } aria-label={ otherwise.title } isConnectable={ ! outputs.locked } />
			</div>
		</div>
	);
}

/** What an end shows, in a word or two. */
function endKind( node: Extract<FormNode, { type: 'end' }> ): string {
	if ( node.success?.show && node.redirect ) {
		return __( 'Message, then redirect', 'funnelforms-pro' );
	}
	if ( node.redirect ) {
		return __( 'Redirect', 'funnelforms-pro' );
	}
	return node.success?.show ? __( 'Message', 'funnelforms-pro' ) : __( 'Shows nothing yet', 'funnelforms-pro' );
}

const nodeTypes = { form: NodeView };

type PathData = {
	/** The path in the form (a path for several answers is drawn once per answer). */
	edge?: string;
	/** Short label on the path; the whole condition is its tooltip. */
	label?: string;
	title?: string;
	/** A number in front: the order the paths of a step are checked in. */
	order?: number;
	warn?: boolean;
	otherwise?: boolean;
	/** Analytics mode: views that took the path. */
	figures?: EdgeAnalytics;
	/** Where along the path the label sits (0.5: the middle). */
	along?: number;
};

type PathEdge = FlowEdge<PathData, 'path'>;

/** A point of a cubic path ("M x,y C x,y x,y x,y", as getBezierPath draws it) at t from 0 to 1. */
export function pointOn( path: string, t: number ): [ number, number ] | null {
	const n = path.match( /-?\d+(?:\.\d+)?(?:e-?\d+)?/gi )?.map( Number ) ?? [];
	if ( n.length !== 8 ) {
		return null;
	}
	const [ x0 = 0, y0 = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0 ] = n;
	const u = 1 - t;
	const at = ( a: number, b: number, c: number, d: number ): number => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
	return [ at( x0, x1, x2, x3 ), at( y0, y1, y2, y3 ) ];
}

/** Where a node is for the playback of the visitors: its box and where its paths start and end. */
function boxOfNode( node: InternalNode | undefined ): PlaybackBox | null {
	const width = node?.measured.width;
	const height = node?.measured.height;
	if ( ! node || ! width || ! height ) {
		return null;
	}
	const { x, y } = node.internals.positionAbsolute;
	// As the paths are drawn: from the middle of the right handle to the middle of the left one.
	const targets = node.internals.handleBounds?.target;
	const target = targets?.find( ( h ) => TARGET === h.id ) ?? targets?.[ 0 ];
	const sources = node.internals.handleBounds?.source;
	const source = sources?.find( ( h ) => OTHERWISE === h.id ) ?? sources?.[ 0 ];
	return {
		x,
		y,
		width,
		height,
		in: target ? [ x + target.x, y + target.y + target.height / 2 ] : [ x, y + height / 2 ],
		out: source ? [ x + source.x + source.width, y + source.y + source.height / 2 ] : [ x + width, y + height / 2 ],
	};
}

/** Points along the path between two nodes, as PathView draws it. */
function wayPoints( from: PlaybackBox, to: PlaybackBox ): Array<[ number, number ]> {
	const [ path ] = getBezierPath( { sourceX: from.out[ 0 ], sourceY: from.out[ 1 ], sourcePosition: Position.Right, targetX: to.in[ 0 ], targetY: to.in[ 1 ], targetPosition: Position.Left } );
	const points: Array<[ number, number ]> = [];
	for ( let i = 0; i <= 24; i++ ) {
		const point = pointOn( path, i / 24 );
		if ( point ) {
			points.push( point );
		}
	}
	return points.length ? points : [ from.out, to.in ];
}

/** How long the canvas takes to bring the whole form into view before the visitors run, ms. */
const PLAY_CAMERA = 450;

/** Space kept between a path's pill and the steps beside it, and the narrowest and widest pill, in px. */
const LABEL_GAP = 8;
const LABEL_MIN = 72;
const LABEL_MAX = 200;

/** Size of the arrowhead at the end of a path, in px. */
const ARROW = 13;

/** Where along a path its pill may sit, the middle first: the first of them where it covers no step. */
const LABEL_AT = [ 0.5, 0.38, 0.62, 0.27, 0.73, 0.17, 0.83 ];

/**
 * The point of a path for its pill (width × height, px): the preferred one, else the middle, unless
 * a step lies there (a path that skips a step runs across it), then further along the path.
 */
export function labelPoint( path: string, preferred: number | undefined, boxes: Array<{ x: number; y: number; width: number; height: number }>, width: number, height: number ): [ number, number ] | null {
	const covers = ( [ x, y ]: [ number, number ] ): boolean => boxes.some( ( b ) => x + width / 2 + 4 > b.x && x - width / 2 - 4 < b.x + b.width && y + height / 2 + 4 > b.y && y - height / 2 - 4 < b.y + b.height );
	const first = pointOn( path, preferred ?? 0.5 );
	for ( const t of preferred ? [ preferred, ...LABEL_AT ] : LABEL_AT ) {
		const point = pointOn( path, t );
		if ( point && ! covers( point ) ) {
			return point;
		}
	}
	return first;
}

/** A path with its condition as a readable label in a pill. */
const PathView = memo( function PathView( { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data }: EdgeProps<PathEdge> ) {
	const [ path, midX, midY ] = getBezierPath( { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } );
	const f = data?.figures;
	// A path nobody took is dashed (the legend says so); a pill with 0 on it would only crowd the canvas.
	const shown = 'free' !== process.env.FUNNELFORMS_EDITION && f && f.sessions > 0 ? edgeFigures( f ) : null;
	// The pill sits in the middle between the two steps and is never wider than the room there, so it
	// does not cover their titles; the condition is cut short (it is the tooltip in full).
	const room = targetX - sourceX - 2 * LABEL_GAP;
	const maxWidth = room > 0 ? Math.max( LABEL_MIN, Math.min( LABEL_MAX, room ) ) : undefined;
	// Where a path runs across a step, its pill moves along it to where it covers none (an estimate of its size).
	const flowStore = useStoreApi<CanvasNode, PathEdge>();
	const labelled = !! ( data?.label || data?.warn || shown );
	const pillWidth = Math.min( maxWidth ?? LABEL_MAX, 22 + 6.8 * Math.max( data?.label?.length ?? 0, ( shown?.label.length ?? 0 ) + ( f?.strongest ? 2 : 0 ) ) + ( data?.order ? 20 : 0 ) + ( data?.warn ? 20 : 0 ) );
	const boxes = labelled ? [ ...flowStore.getState().nodeLookup.values() ].flatMap( ( n ) => ( n.measured.width && n.measured.height ? [ { ...n.internals.positionAbsolute, width: n.measured.width, height: n.measured.height } ] : [] ) ) : [];
	const [ x, y ] = ( labelled ? labelPoint( path, data?.along, boxes, pillWidth, shown && data?.label ? 36 : 22 ) : null ) ?? [ midX, midY ];
	return (
		<>
			<BaseEdge id={ id } path={ path } markerEnd={ markerEnd } style={ f ? { strokeWidth: f.width, opacity: f.opacity } : undefined } />
			{ data?.label || data?.warn || shown ? (
				<EdgeLabelRenderer>
					<div
						className={ 'ffxb-path-label nopan' + ( data?.otherwise ? ' ffxb-path-label--otherwise' : '' ) + ( data?.warn ? ' ffxb-path-label--warn' : '' ) + ( shown && data?.label ? ' ffxb-path-label--figures' : '' ) + ( f?.strongest ? ' ffxb-path-label--strongest' : '' ) + ( f && ! f.sessions ? ' ffxb-path-label--none' : '' ) + ( selected ? ' is-selected' : '' ) }
						style={ { transform: `translate(-50%, -50%) translate(${ x }px, ${ y }px)`, maxWidth } }
						title={ [ shown?.title, data?.title ].filter( Boolean ).join( '\n' ) || undefined }
						data-edge={ id }
					>
						{ data?.order ? <span className="ffxb-path-label__order">{ data.order }</span> : null }
						{ data?.warn ? (
							<span className="ffxb-path-label__warn" aria-hidden="true">
								!
							</span>
						) : null }
						{ data?.label ? <span className="ffxb-path-label__text">{ data.label }</span> : null }
						{ shown ? (
							<span className="ffxb-path-label__figures">
								{ f?.strongest ? (
									<>
										<span className="ffxb-path-label__star" aria-hidden="true">
											★
										</span>
										<span className="screen-reader-text">{ __( 'Strongest path', 'funnelforms-pro' ) + ': ' }</span>
									</>
								) : null }
								{ shown.label }
							</span>
						) : null }
					</div>
				</EdgeLabelRenderer>
			) : null }
		</>
	);
} );

const edgeTypes = { path: PathView };

type NodeActions = {
	onSelectField: ( nodeId: string, fieldId: string ) => void;
	onAfterSending: ( nodeId: string ) => void;
	onChooseField: ( nodeId: string, fieldId: string ) => void;
	onSelectPath: ( edgeId: string ) => void;
	onAddRule: ( nodeId: string ) => void;
	onClearOutput: ( nodeId: string, handle: string ) => void;
	onSetNumber: ( edgeId: string, fieldId: string, rule: NumberRule, part: string ) => void;
};

/** The outputs of a node in words, as its card shows them. */
function outputsView( doc: FormDocument, node: FormNode, outputs: Outputs | undefined, hints: LogicHint[], fields: ReturnType<typeof fieldIndex>, broken: Set<string> = new Set() ): OutputsView | null {
	if ( 'end' === node.type || ! outputs ) {
		return null;
	}
	const locale = doc.locales.default;
	const name = ( id: string ): string => {
		const target = doc.nodes.find( ( n ) => n.id === id );
		return target ? nodeName( target, locale ) || __( 'Without a title', 'funnelforms-pro' ) : '?';
	};
	const mine = hints.filter( ( h ) => h.node === node.id );
	const warned = new Set( mine.filter( ( h ) => h.edge && 'info' !== h.level ).map( ( h ) => h.edge ) );
	const answers: OutputRow[] = outputs.answers.map( ( a ): OutputRow => {
		const answer = text( a.option.label, locale ).replace( /<[^>]*>/g, ' ' ).replace( /\s+/g, ' ' ).trim() || a.option.value;
		return a.edge
			? { kind: 'answer', group: 0, handle: a.handle, label: answer, edge: a.edge.id, to: a.edge.to, warn: warned.has( a.edge.id ), error: broken.has( a.edge.id ), title: sprintf( /* translators: %1$s: answer, %2$s: step */ __( 'Answer “%1$s” leads to %2$s', 'funnelforms-pro' ), answer, name( a.edge.to ) ) }
			: { kind: 'answer', group: 0, handle: a.handle, label: answer, title: __( 'Follows “Otherwise”. Drag from here to give this answer its own path.', 'funnelforms-pro' ) };
	} );
	const rule = ( r: RuleOutput ): OutputRow => {
		const row: OutputRow = {
			kind: 'rule',
			group: 0,
			handle: r.handle,
			label: ruleText( r, doc, locale, fields ),
			edge: r.edge.id,
			to: r.edge.to,
			tone: r.tone,
			symbol: r.symbol,
			warn: warned.has( r.edge.id ),
			error: broken.has( r.edge.id ),
			title: sprintf( /* translators: %1$s: condition, %2$s: step */ __( 'Rule “%1$s” leads to %2$s', 'funnelforms-pro' ), r.edge.when ? describeCondition( r.edge.when, doc, locale, fields ) : __( 'Always', 'funnelforms-pro' ), name( r.edge.to ) ),
		};
		const n = r.number;
		if ( n?.rule && 'free' !== process.env.FUNNELFORMS_EDITION ) {
			const props = n.field.props as { unit?: { text: Record<string, string>; position: 'before' | 'after' }; max?: number; step?: number };
			row.number = { field: n.field.id, rule: n.rule, unit: props.unit ? text( props.unit.text, locale ).replace( /<[^>]*>/g, '' ).trim() : '', unitBefore: 'before' === props.unit?.position };
			if ( undefined !== props.max ) {
				row.number.max = props.max;
			}
			if ( undefined !== props.step ) {
				row.number.step = props.step;
			}
		}
		return row;
	};
	// In the order the form checks them: rules before the answers, the answers, rules after them, or as stored.
	const byHandle = new Map( answers.map( ( a ) => [ a.handle, a ] ) );
	const rows = outputs.parts.flatMap( ( p, group ): OutputRow[] =>
		'rules' === p.kind ? p.rules.map( ( r ) => ( { ...rule( r ), group } ) ) : p.answers.flatMap( ( a ) => { const row = byHandle.get( a.handle ); return row ? [ { ...row, group } ] : []; } )
	);
	const fallback = outputs.otherwise;
	const stuck = mine.some( ( h ) => 'deadEnd' === h.code || 'contactNoEnd' === h.code );
	const open = mine.some( ( h ) => 'noOtherwise' === h.code );
	const rest = rows.length ? restText( coverage( doc, node )?.rest, locale ) : '';
	// "Otherwise" once a path has a condition; until then the one way on.
	const label = 'contact' === node.type ? __( 'After that', 'funnelforms-pro' ) : rows.some( ( r ) => r.edge ) ? __( 'Otherwise', 'funnelforms-pro' ) : __( 'Go to', 'funnelforms-pro' );
	let target = __( 'Not needed', 'funnelforms-pro' );
	let state: OutputsView[ 'otherwise' ][ 'state' ] = 'none';
	if ( fallback ) {
		target = name( fallback.to );
		state = 'set';
	} else if ( open ) {
		target = rest ? sprintf( /* translators: %s: answers without a path, e.g. "Other, 20 – 30" */ __( 'no path for: %s', 'funnelforms-pro' ), rest ) : __( 'Nowhere (visitors get stuck)', 'funnelforms-pro' );
		state = 'open';
	} else if ( stuck ) {
		target = 'contact' === node.type ? __( 'Nowhere (empty form)', 'funnelforms-pro' ) : __( 'Nowhere (visitors get stuck)', 'funnelforms-pro' );
		state = 'stuck';
	}
	const field = outputs.field;
	const own = 'step' === node.type ? node.fields : [];
	let addRule: OutputsView[ 'addRule' ] = false;
	const locked = doc.edges.some( ( e ) => e.from === node.id && isQuizEdge( doc, e ) );
	if ( 'free' !== process.env.FUNNELFORMS_EDITION && ! locked && canAddRule( doc, node.id ) ) {
		addRule = ! field && own.some( ( f ) => NUMBER_TYPES.includes( f.type ) ) ? 'always' : 'quiet';
	}
	return {
		rows,
		fields: outputs.fields.map( ( f ) => ( { id: f.id, label: fieldTitle( f, locale ) } ) ),
		field: field?.id,
		multiple: !! ( field && ( field.props as { multiple?: boolean } ).multiple ),
		otherwise: {
			label,
			target,
			title: label + ': ' + target + ( fallback && rest ? '\n' + sprintf( /* translators: %s: the answers that take the path without condition */ __( 'Applies to: %s', 'funnelforms-pro' ), rest ) : '' ),
			edge: fallback?.id,
			to: fallback?.to,
			state,
			warn: !! fallback && warned.has( fallback.id ),
		},
		addRule,
		locked,
	};
}

/** The issues that mark a node and its fields, for its card. */
function nodeIssues( issues: Issue[], node: FormNode ): NodeData[ 'issues' ] {
	const own = issues.filter( ( i ) => i.marks.nodes.includes( node.id ) && ! ( 'unreachable' === i.key.split( ':' )[ 1 ] ) );
	const fields: Record<string, Issue[ 'tone' ]> = {};
	for ( const f of 'fields' in node ? ( node.fields as Array<{ id: string }> ) : [] ) {
		const tone = markOf( own, 'fields', f.id );
		if ( tone ) {
			fields[ f.id ] = tone;
		}
	}
	return { tone: markOf( own, 'nodes', node.id ), titles: [ ...new Set( own.map( ( i ) => i.title ) ) ], fields };
}

function buildNodes( doc: FormDocument, selection: Selection, hints: LogicHint[], outputs: Map<string, Outputs>, actions: NodeActions, previous: CanvasNode[], issues: Issue[] = [], flash: ( Selection & { seq: number } ) | null = null ): CanvasNode[] {
	const broken = new Set( issues.filter( ( i ) => i.blocking ).flatMap( ( i ) => i.marks.edges ) );
	const { onSelectField, onAfterSending, onChooseField, onSelectPath, onAddRule, onClearOutput, onSetNumber } = actions;
	const locale = doc.locales.default;
	const fields = fieldIndex( doc );
	const before = new Map( previous.map( ( n ) => [ n.id, n ] ) );
	const variants = new Map<string, string>();
	for ( const experiment of doc.experiments ?? [] ) {
		if ( 'design' !== testKind( experiment ) ) {
			testSteps( doc, experiment.id ).forEach( ( nodes, variant ) => nodes.forEach( ( id ) => variants.set( id, variant.toUpperCase() ) ) );
		}
	}
	return doc.nodes.map( ( node, index ) => {
		const position = doc.layout?.nodes[ node.id ] ?? { x: index * 320, y: 0 };
		const old = before.get( node.id );
		return {
			id: node.id,
			type: 'form' as const,
			position,
			// Keep the measured size so edges stay drawn until the node is measured again.
			...( old?.measured ? { measured: old.measured } : {} ),
			selected: selection.node === node.id,
			data: {
				node,
				locale,
				start: doc.start === node.id,
				unreachable: hints.some( ( h ) => h.node === node.id && 'unreachable' === h.code ),
				variant: 'free' === process.env.FUNNELFORMS_EDITION ? '' : variants.get( node.id ) ?? '',
				hints: hints.filter( ( h ) => h.node === node.id && 'unreachable' !== h.code ).map( ( h ) => ( { level: h.level, text: hintText( h, doc, locale ) } ) ),
				issues: nodeIssues( issues, node ),
				flash: flash && flash.node === node.id ? { field: flash.field, seq: flash.seq } : null,
				actions: 'contact' === node.type ? doc.actions.filter( ( a ) => ! a.node || a.node === node.id ).map( ( a ) => actionName( a ) ) : [],
				selectedField: selection.node === node.id ? selection.field : undefined,
				onSelectField: ( fieldId: string ) => onSelectField( node.id, fieldId ),
				onAfterSending: () => onAfterSending( node.id ),
				outputs: outputsView( doc, node, outputs.get( node.id ), hints, fields, broken ),
				onChooseField: ( fieldId: string ) => onChooseField( node.id, fieldId ),
				onSelectPath,
				onAddRule: () => onAddRule( node.id ),
				onClearOutput: ( handle: string ) => onClearOutput( node.id, handle ),
				onSetNumber,
			},
		};
	} );
}

/** Colour of the arrowhead of a path, as its output on the card. */
const EDGE_COLOURS: Record<string, string> = {
	answer: '#8f73f7',
	otherwise: '#a39db3',
	next: '#8a84a0',
	below: '#d9730d',
	above: '#168f63',
	range: '#6a30f5',
	equal: '#6a30f5',
	rule: '#2f6fed',
};

/** Colour of a path with a problem that keeps the form from being published. */
const EDGE_ERROR = '#d92d20';

/** Colour of the paths of the selected step and of the path under the pointer. */
const EDGE_ACTIVE = '#6a30f5';

/** `hot`: the path the pointer is on, on its card or on the canvas. */
export function buildEdges( doc: FormDocument, selection: Selection, hints: LogicHint[], analytics: CanvasAnalytics | null, outputs: Map<string, Outputs>, hot: string | null = null, issues: Issue[] = [] ): PathEdge[] {
	const broken = new Map<string, string[]>();
	issues.filter( ( i ) => 'error' === i.tone ).forEach( ( i ) => i.marks.edges.forEach( ( e ) => broken.set( e, [ ...( broken.get( e ) ?? [] ), i.title ] ) ) );
	const locale = doc.locales.default;
	const fields = fieldIndex( doc );
	const warned = new Set( hints.filter( ( h ) => h.edge && 'info' !== h.level ).map( ( h ) => h.edge ) );
	const list: PathEdge[] = [];
	const active = new Set<string>();
	for ( const edge of doc.edges ) {
		const siblings = doc.edges.filter( ( e ) => e.from === edge.from );
		const ports = outputs.get( edge.from );
		// The card names the output of each path, so the path itself carries no label.
		const rule = ports?.rules.find( ( r ) => r.edge.id === edge.id );
		let kind: string = rule ? 'rule' : 'answer';
		if ( edge.default ) {
			// The only path of a step is its way on; beside paths with a condition it is "Otherwise".
			kind = siblings.length > 1 ? 'otherwise' : 'next';
		}
		const tone = rule?.tone;
		const words = edge.when ? edgeLabel( edge.when, doc, locale, edge.from, fields ) : siblings.length > 1 ? __( 'Otherwise', 'funnelforms-pro' ) : '';
		const data: PathData = { edge: edge.id };
		if ( edge.when ) {
			data.title = describeCondition( edge.when, doc, locale, fields );
		}
		if ( warned.has( edge.id ) ) {
			data.warn = true;
			data.title = hints
				.filter( ( h ) => h.edge === edge.id )
				.map( ( h ) => hintText( h, doc, locale ) )
				.concat( data.title ?? [] )
				.join( '\n' );
		}
		const problems = broken.get( edge.id );
		if ( problems ) {
			data.warn = true;
			data.title = [ ...problems, ...( data.title ? [ data.title ] : [] ) ].join( '\n' );
		}
		const figures = analytics?.edges.get( edge.id );
		if ( figures ) {
			data.figures = figures;
		}
		// The paths of one step start at the same point, so their labels in the middle meet; nearer
		// their own step they stand apart. Not where other paths end at that step too.
		if ( siblings.length > 1 && 1 === doc.edges.filter( ( e ) => e.to === edge.to ).length ) {
			data.along = 0.7;
		}
		const from = doc.nodes.find( ( n ) => n.id === edge.from );
		const to = doc.nodes.find( ( n ) => n.id === edge.to );
		// The paths of the selected step stand out, and the path under the pointer.
		const out = selection.node === edge.from;
		const lit = hot === edge.id;
		const chosen = selection.edge === edge.id;
		const colour = problems ? EDGE_ERROR : out || lit || chosen ? EDGE_ACTIVE : EDGE_COLOURS[ tone ?? kind ];
		const className =
			'ffxb-edge ffxb-edge--' +
			kind +
			( tone && tone !== kind ? ` ffxb-edge--${ tone }` : '' ) +
			( problems ? ' ffxb-edge--error' : data.warn ? ' ffxb-edge--warn' : '' ) +
			( figures ? ( figures.sessions ? '' : ' ffxb-edge--none' ) + ( figures.strongest ? ' ffxb-edge--strongest' : '' ) : '' ) +
			( out ? ' is-out' : '' ) +
			( selection.node === edge.to ? ' is-in' : '' ) +
			( lit ? ' is-hot' : '' );
		// A path for several answers starts at each of them; the figures stand on the first.
		( ports?.handles.get( edge.id ) ?? [ undefined ] ).forEach( ( handle, i ) => {
			if ( out || lit || chosen ) {
				active.add( i ? `${ edge.id }#${ handle ?? i }` : edge.id );
			}
			list.push( {
				id: i ? `${ edge.id }#${ handle ?? i }` : edge.id,
				type: 'path' as const,
				source: edge.from,
				target: edge.to,
				sourceHandle: handle,
				targetHandle: TARGET,
				// Screen readers name the path by its steps, not by their ids.
				ariaLabel: from && to ? sprintf( __( 'Path from %1$s to %2$s', 'funnelforms-pro' ), nodeName( from, locale ), nodeName( to, locale ) ) + ( words ? ': ' + words : '' ) : undefined,
				data: i ? { ...data, figures: undefined, warn: undefined } : data,
				selected: chosen,
				className,
				// The head keeps its size on thick analytics paths (markers grow with the stroke by default).
				markerEnd: figures && ! i ? { type: MarkerType.ArrowClosed, color: colour, width: ARROW + figures.width, height: ARROW + figures.width, markerUnits: 'userSpaceOnUse' } : { type: MarkerType.ArrowClosed, color: colour, width: ARROW, height: ARROW },
			} );
		} );
	}
	// Drawn last, the paths that stand out lie above the other paths (and, as all paths, below the cards).
	return active.size ? [ ...list.filter( ( e ) => ! active.has( e.id ) ), ...list.filter( ( e ) => active.has( e.id ) ) ] : list;
}

function readItem( event: React.DragEvent ): PaletteItem | null {
	const raw = event.dataTransfer.getData( DRAG_TYPE );
	if ( ! raw ) {
		return null;
	}
	try {
		return JSON.parse( raw ) as PaletteItem;
	} catch {
		return null;
	}
}

/** The first nodes on the default path: what the canvas shows first in a large form. */
function opening( doc: FormDocument, count: number ): Array<{ id: string }> {
	const ids: string[] = [];
	let current: string | undefined = doc.start;
	while ( current && ! ids.includes( current ) && ids.length < count ) {
		ids.push( current );
		const from: string = current;
		const out = doc.edges.filter( ( e ) => e.from === from );
		current = ( out.find( ( e ) => e.default ) ?? out[ 0 ] )?.to;
	}
	return ids.map( ( id ) => ( { id } ) );
}

function Flow() {
	const { store, ctx, readOnly } = useEnv();
	const doc = useBuilder( ( s ) => s.doc );
	const selection = useBuilder( ( s ) => s.selection );
	const { change, select } = store.getState();
	const flow = useReactFlow();
	const [ nodes, setNodes ] = useState<CanvasNode[]>( [] );
	// Large forms open on their beginning, readable, instead of all of it tiny.
	const [ focus ] = useState( () => ( doc && doc.nodes.length > 6 ? opening( doc, 3 ) : undefined ) );
	// The same object on every render: React Flow takes a new one as the options of the next fitView,
	// also of one asked for meanwhile (the playback brings the whole form into view).
	const [ opened ] = useState( () => ( { padding: 0.15, minZoom: 0.6, maxZoom: 1, nodes: focus } ) );

	const hints = useHints();
	const issues = useIssues();
	const wanted = useBuilder( ( s ) => s.focus );
	const [ flash, setFlash ] = useState<( Selection & { seq: number } ) | null>( null );
	const prediction = 'free' === process.env.FUNNELFORMS_EDITION ? null : usePrediction();
	const predicted = prediction?.figures ?? null;
	const measured = 'free' === process.env.FUNNELFORMS_EDITION ? null : useAnalytics()?.figures ?? null;
	const shown = predicted ?? measured;
	// Off until turned on: over the canvas it hides steps.
	const [ map, setMap ] = useState( () => readMapChoice() ?? false );

	// The visitors of the prediction played on the canvas; gone with the prediction mode.
	const [ playback ] = useState( createPlayback );
	const playing = useStore( playback.store, ( s ) => s.playing );
	useEffect( () => {
		if ( ! predicted ) {
			playback.reset();
		}
	}, [ predicted, playback ] );
	// Stops when the canvas goes (another workspace).
	useEffect( () => () => playback.stop(), [ playback ] );
	// Where the nodes are now, read on every frame of the playback.
	const geometry = useMemo<PlaybackGeometry>( () => ( { boxOf: ( id ) => boxOfNode( flow.getInternalNode( id ) ), wayPoints } ), [ flow ] );
	const traces = prediction?.result?.simulation.traces;
	const personas = prediction?.resultOf?.model.personas;
	const play = useCallback( () => {
		if ( ! traces?.length ) {
			return;
		}
		const plan = planPlayback( traces, geometry.boxOf, wayPoints, personas?.map( ( p ) => p.id ), flow.getNodes().map( ( n ) => n.id ) );
		// The whole form comes into view first (never closer than now), then the dots start.
		void flow.fitView( { padding: 0.14, duration: PLAY_CAMERA, maxZoom: Math.min( 1, Math.max( 0.5, flow.getZoom() ) ) } );
		playback.start( plan, PLAY_CAMERA + 80 );
	}, [ traces, geometry, playback, personas, flow ] );
	// Show on the canvas in the tab of the Predictive AI: plays once the prediction is on the canvas,
	// after the nodes have their figures and are measured.
	const cue = !! prediction?.cue;
	const setCue = prediction?.setCue;
	useEffect( () => {
		if ( ! cue || ! predicted || ! traces?.length ) {
			return undefined;
		}
		const timer = window.setTimeout( () => {
			setCue?.( false );
			play();
		}, 150 );
		return () => window.clearTimeout( timer );
	}, [ cue, setCue, predicted, traces, play ] );
	// A step or path added or taken away ends the playback: its ways would no longer be those of the form.
	const shape = doc ? doc.nodes.map( ( n ) => n.id ).join( ',' ) + '|' + doc.edges.map( ( e ) => e.from + '>' + e.to ).join( ',' ) : '';
	useEffect( () => {
		playback.stop();
	}, [ shape, playback ] );
	// While the dots run, the steps stay where they are: nothing is moved, connected or dropped.
	const still = readOnly || playing;

	// The path under the pointer, on a card or on the canvas.
	const [ hotStore ] = useState( () => createStore<Hot>( () => COLD ) );
	const hot = useStore( hotStore, ( s ) => s.edge );

	// The field whose answers are the outputs, for steps with several (chosen on the card).
	const [ chosen, setChosen ] = useState<Record<string, string>>( {} );
	const outputs = useMemo( () => new Map( ( doc?.nodes ?? [] ).map( ( n ) => [ n.id, outputsOf( doc as FormDocument, n, chosen[ n.id ] ) ] as const ) ), [ doc, chosen ] );
	const actions = useMemo<NodeActions>(
		() => ( {
			onSelectField: ( node, field ) => select( { node, field } ),
			onAfterSending: ( node ) => select( { node }, 'logic' ),
			onChooseField: ( node, field ) => setChosen( ( c ) => ( { ...c, [ node ]: field } ) ),
			onSelectPath: ( edge ) => select( { edge } ),
			onAddRule: ( node ) => {
				let id: string | null = null;
				let inPlace = false;
				change( ( d ) => {
					id = addRulePath( d, node );
					const source = d.nodes.find( ( n ) => n.id === node );
					// A number rule is changed on the card; other rules open in the panel.
					inPlace = !! id && !! source && outputsOf( d, source ).rules.some( ( r ) => r.edge.id === id && r.number?.rule );
				} );
				if ( id ) {
					select( inPlace ? { node } : { edge: id } );
				}
			},
			onClearOutput: ( node, handle ) => {
				change( ( d ) => clearOutput( d, node, handle ) );
				hotStore.setState( COLD );
			},
			onSetNumber: ( edge, field, rule, part ) => change( ( d ) => setNumberRule( d, edge, field, rule ), `number:${ edge }:${ part }` ),
		} ),
		[ select, change, hotStore ]
	);

	useEffect( () => {
		if ( doc ) {
			setNodes( ( previous ) => buildNodes( doc, selection, hints, outputs, actions, previous, issues, flash ) );
		}
	}, [ doc, selection, hints, outputs, actions, issues, flash ] );

	const edges = useMemo( () => ( doc ? buildEdges( doc, selection, hints, shown, outputs, hot, issues ) : [] ), [ doc, selection, hints, shown, outputs, hot, issues ] );

	// "Show" of an issue: the place into view, once the card is measured (also when the canvas opens
	// for it from another workspace), and lit up once.
	useEffect( () => {
		if ( ! wanted || ! doc ) {
			return undefined;
		}
		const edge = wanted.edge ? doc.edges.find( ( e ) => e.id === wanted.edge ) : undefined;
		// A path is edited at the step it leaves (its rule is on that card), so that step comes into view.
		const ids = edge ? [ edge.from ].filter( ( id ) => flow.getNode( id ) ) : wanted.node ? [ wanted.node ] : [];
		let tries = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const go = (): void => {
			const ready = ids.length > 0 && ids.every( ( id ) => flow.getInternalNode( id )?.measured?.width );
			if ( ! ready && ++tries < 40 ) {
				timer = setTimeout( go, 50 );
				return;
			}
			if ( ready ) {
				// setCenter, not fitView: fitView is queued, and the canvas's own fitViewOptions (its
				// opening steps) replace the nodes asked for when it renders before the fit runs.
				const boxes = ids.map( ( id ) => flow.getInternalNode( id ) ).map( ( n ) => ( { x: n?.internals.positionAbsolute.x ?? 0, y: n?.internals.positionAbsolute.y ?? 0, w: n?.measured.width ?? 0, h: n?.measured.height ?? 0 } ) );
				const x = Math.min( ...boxes.map( ( b ) => b.x ) );
				const y = Math.min( ...boxes.map( ( b ) => b.y ) );
				const width = Math.max( ...boxes.map( ( b ) => b.x + b.w ) ) - x;
				const height = Math.max( ...boxes.map( ( b ) => b.y + b.h ) ) - y;
				// Readable, and not larger than before.
				const pane = document.querySelector( '.ffxb-canvas .react-flow' )?.getBoundingClientRect();
				const fits = pane ? Math.min( ( pane.width * 0.8 ) / Math.max( width, 1 ), ( pane.height * 0.8 ) / Math.max( height, 1 ) ) : 1;
				const zoom = Math.max( 0.5, Math.min( Math.max( flow.getZoom(), 0.85 ), 1.1, fits ) );
				void flow.setCenter( x + width / 2, y + height / 2, { zoom, duration: 450 } );
			}
			setFlash( { ...wanted, node: edge ? edge.from : wanted.node } );
			store.setState( { focus: null } );
		};
		go();
		return () => clearTimeout( timer );
	}, [ wanted, doc, flow, store ] );
	useEffect( () => {
		const timer = flash ? setTimeout( () => setFlash( null ), 2000 ) : undefined;
		return () => clearTimeout( timer );
	}, [ flash ] );
	const toggleMap = (): void => {
		setMap( ! map );
		try {
			window.localStorage.setItem( MAP_KEY, map ? '0' : '1' );
		} catch {
			// The choice is then kept only until the page is left.
		}
	};

	// The question list asks to bring a step into view.
	useEffect( () => {
		const reveal = ( event: Event ): void => {
			const id = ( event as CustomEvent<string> ).detail;
			if ( flow.getNode( id ) ) {
				void flow.fitView( { nodes: [ { id } ], duration: 300, maxZoom: Math.max( 1, flow.getZoom() ) } );
			}
		};
		window.addEventListener( REVEAL_EVENT, reveal );
		return () => window.removeEventListener( REVEAL_EVENT, reveal );
	}, [ flow ] );

	const onNodesChange = useCallback( ( changes: NodeChange<CanvasNode>[] ) => {
		// Moving and measuring happen here; removing and selecting go through the store.
		const kept = changes.filter( ( c ) => 'position' === c.type || 'dimensions' === c.type );
		if ( kept.length ) {
			setNodes( ( current ) => applyNodeChanges( kept, current ) );
		}
	}, [] );

	const onDragStop = useCallback(
		( _event: React.MouseEvent, _node: CanvasNode, moved: CanvasNode[] ) => {
			const positions = Object.fromEntries( moved.map( ( n ) => [ n.id, n.position ] ) );
			change( ( d ) => setPositions( d, positions ), 'move:' + Object.keys( positions ).join( ',' ) );
		},
		[ change ]
	);

	const onConnect = useCallback(
		( connection: Connection ) => {
			if ( playback.store.getState().playing ) {
				return;
			}
			let id: string | null = null;
			change( ( d ) => {
				id = connectOutput( d, connection.source, connection.sourceHandle, connection.target );
			} );
			if ( id ) {
				select( { edge: id } );
			}
		},
		[ change, select, playback ]
	);

	const onDrop = ( event: React.DragEvent ): void => {
		const item = readItem( event );
		if ( ! item || still ) {
			return;
		}
		event.preventDefault();
		const target = ( event.target as Element ).closest?.( '[data-node]' )?.getAttribute( 'data-node' ) ?? null;
		const position = flow.screenToFlowPosition( { x: event.clientX, y: event.clientY } );
		let created: Selection = {};
		change( ( d ) => {
			const node = target ? d.nodes.find( ( n ) => n.id === target ) : undefined;
			if ( node && 'end' !== node.type && ( 'field' === item.kind || 'step' === item.kind ) ) {
				// A field type dropped onto a node goes into that node.
				const field = addField( d, node.id, item.type, ctx );
				if ( field ) {
					created = { node: node.id, field };
					return;
				}
			}
			const placement = { position: { x: position.x - 120, y: position.y - 40 } };
			if ( 'step' === item.kind && ( 'loading' === item.type || ( STEP_FIELD_TYPES as readonly string[] ).includes( item.type ) ) ) {
				created = { node: addStep( d, item.type, ctx, placement ) };
			} else if ( 'contact' === item.kind ) {
				created = { node: addContact( d, ctx, placement ) };
			} else if ( 'end' === item.kind ) {
				created = { node: addEnd( d, ctx, placement ) };
			}
		} );
		select( created );
	};

	if ( ! doc ) {
		return null;
	}

	return (
		<HotContext.Provider value={ hotStore }>
		<PlaybackContext.Provider value={ playback }>
			<ReactFlow<CanvasNode, PathEdge>
				className={ [ hot ? 'has-hot' : '', playing ? 'is-playing' : '' ].filter( Boolean ).join( ' ' ) || undefined }
				nodes={ nodes }
				edges={ edges }
				nodeTypes={ nodeTypes }
				edgeTypes={ edgeTypes }
				onNodesChange={ onNodesChange }
				onNodeDragStop={ onDragStop }
				onConnect={ onConnect }
				onNodeClick={ ( _e, node ) => select( { node: node.id } ) }
				onEdgeClick={ ( _e, edge ) => select( { edge: edge.data?.edge ?? edge.id } ) }
				onEdgeMouseEnter={ ( _e, edge ) => hotStore.setState( { edge: edge.data?.edge ?? edge.id, to: edge.target } ) }
				onEdgeMouseLeave={ () => hotStore.setState( COLD ) }
				connectionRadius={ 28 }
				connectionLineComponent={ ConnectionLine }
				onPaneClick={ () => select( {} ) }
				onDragOver={ ( e ) => {
					if ( ! still && e.dataTransfer.types.includes( DRAG_TYPE ) ) {
						e.preventDefault();
						e.dataTransfer.dropEffect = 'copy';
					}
				} }
				onDrop={ onDrop }
				nodesDraggable={ ! still }
				nodesConnectable={ ! still }
				deleteKeyCode={ null }
				selectionKeyCode={ null }
				multiSelectionKeyCode={ null }
				fitView
				fitViewOptions={ opened }
				minZoom={ 0.2 }
				maxZoom={ 1.5 }
				proOptions={ { hideAttribution: true } }
				aria-label={ __( 'Steps of the form', 'funnelforms-pro' ) }
				ariaLabelConfig={ flowLabels() }
			>
				<Background gap={ 24 } size={ 1.5 } />
				<Controls showInteractive={ false }>
					<ControlButton onClick={ toggleMap } aria-label={ map ? __( 'Hide the overview map', 'funnelforms-pro' ) : __( 'Show the overview map', 'funnelforms-pro' ) } title={ map ? __( 'Hide the overview map', 'funnelforms-pro' ) : __( 'Show the overview map', 'funnelforms-pro' ) } className={ map ? 'is-on' : '' }>
						<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
							<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
							<rect x="8" y="8" width="5" height="4" rx=".5" fill="currentColor" />
						</svg>
					</ControlButton>
					<ControlButton onClick={ () => window.dispatchEvent( new Event( SHORTCUTS_EVENT ) ) } aria-label={ __( 'Keyboard shortcuts', 'funnelforms-pro' ) } title={ __( 'Keyboard shortcuts', 'funnelforms-pro' ) }>
						<span aria-hidden="true" className="ffxb-control-text">
							?
						</span>
					</ControlButton>
				</Controls>
				{ map ? (
					<MiniMap
						className="ffxb-minimap"
						pannable
						zoomable
						ariaLabel={ __( 'Overview map', 'funnelforms-pro' ) }
						nodeBorderRadius={ 6 }
						nodeStrokeWidth={ 0 }
						maskColor="rgba(246, 244, 252, 0.72)"
						nodeColor={ ( n ) => ( { step: '#a98bf9', contact: '#6a30f5', end: '#d9cdfc' } )[ ( n.data as NodeData ).node.type ] }
					/>
				) : null }
				<CanvasTip doc={ doc } />
				<Panel position="top-right">
					{ 'free' === process.env.FUNNELFORMS_EDITION ? (
						<ProAnalytics />
					) : (
						<div className="ffxb-canvas-modes">
							<PredictionPanel />
							<AnalyticsPanel />
						</div>
					) }
				</Panel>
				{ 'free' !== process.env.FUNNELFORMS_EDITION && prediction?.on ? (
					<>
						<Panel position="top-left" className="ffxb-pai-hud-panel">
							<PredictionBar onPlay={ play } />
						</Panel>
						{ predicted ? <PlaybackLayer geometry={ geometry } /> : null }
					</>
				) : null }
				{ 'free' !== process.env.FUNNELFORMS_EDITION && shown ? (
					<Panel position="bottom-center">
						<AnalyticsLegend dots={ !! predicted && playing } />
					</Panel>
				) : null }
			</ReactFlow>
		</PlaybackContext.Provider>
		</HotContext.Provider>
	);
}

/** In Funnelforms Free: the switch of the analytics mode leads to the page about Pro. */
function ProAnalytics() {
	const url = proUrl();
	// As in Pro, the figures need the right to see entries: without it there is no switch.
	if ( ! useEnv().rights.entries ) {
		return null;
	}
	const content = (
		<>
			{ __( 'Analytics', 'funnelforms-pro' ) } <ProBadge />
		</>
	);
	return url ? (
		<a className="ffxb-analytics__toggle ffxb-analytics__toggle--pro" href={ url } title={ __( 'Paths, the strongest way and drop-off per field on the canvas come with Funnelforms Pro.', 'funnelforms-pro' ) }>
			{ content }
		</a>
	) : (
		<span className="ffxb-analytics__toggle ffxb-analytics__toggle--pro">{ content }</span>
	);
}

const MAP_KEY = 'ffxb-canvas-map';

/** Whether the user turned the overview map on or off before; null when never. */
function readMapChoice(): boolean | null {
	try {
		const value = window.localStorage.getItem( MAP_KEY );
		return null === value ? null : '1' === value;
	} catch {
		return null;
	}
}

/** The next thing to do while the form is still taking shape. */
/** The labels React Flow reads out and shows on its controls, in the language of the admin. */
function flowLabels(): Partial<AriaLabelConfig> {
	/* translators: %1$s: horizontal position, %2$s: vertical position of the step on the canvas. */
	const moved: Record<string, string> = {
		up: __( 'Step moved up. New position: %1$s, %2$s.', 'funnelforms-pro' ),
		down: __( 'Step moved down. New position: %1$s, %2$s.', 'funnelforms-pro' ),
		left: __( 'Step moved left. New position: %1$s, %2$s.', 'funnelforms-pro' ),
		right: __( 'Step moved right. New position: %1$s, %2$s.', 'funnelforms-pro' ),
	};
	return {
		'node.a11yDescription.default': __( 'Press Enter or Space to select a step.', 'funnelforms-pro' ),
		'node.a11yDescription.keyboardDisabled': __( 'Press Enter or Space to select a step. Then move it with the arrow keys; Escape cancels.', 'funnelforms-pro' ),
		'node.a11yDescription.ariaLiveMessage': ( { direction, x, y }: { direction: string; x: number; y: number } ) =>
			sprintf( moved[ direction ] ?? moved.right ?? '', Math.round( x ), Math.round( y ) ),
		'edge.a11yDescription.default': __( 'Press Enter or Space to select a path.', 'funnelforms-pro' ),
		'controls.ariaLabel': __( 'Canvas controls', 'funnelforms-pro' ),
		'controls.zoomIn.ariaLabel': __( 'Zoom in', 'funnelforms-pro' ),
		'controls.zoomOut.ariaLabel': __( 'Zoom out', 'funnelforms-pro' ),
		'controls.fitView.ariaLabel': __( 'Show all steps', 'funnelforms-pro' ),
		'minimap.ariaLabel': __( 'Overview map', 'funnelforms-pro' ),
		'handle.ariaLabel': __( 'Connection point', 'funnelforms-pro' ),
	};
}

function CanvasTip( { doc }: { doc: FormDocument } ) {
	let tip: string | null = null;
	if ( 1 === doc.nodes.length ) {
		tip = __( 'Drag a field type from the left onto the canvas for the next step, or onto this step to ask more on it.', 'funnelforms-pro' );
	} else if ( 0 === doc.edges.length ) {
		tip = __( 'Connect the steps: drag from the dot on the right of a step to the next one.', 'funnelforms-pro' );
	} else if ( ! doc.nodes.some( ( n ) => 'end' === n.type ) ) {
		tip = __( 'Add an end from the left: it shows a thank-you message or leads to a page.', 'funnelforms-pro' );
	}
	return tip ? (
		<Panel position="top-center" className="ffxb-canvas-tip">
			{ tip }
		</Panel>
	) : null;
}

export function Canvas() {
	return (
		<div className="ffxb-canvas">
			<ReactFlowProvider>
				<Flow />
			</ReactFlowProvider>
		</div>
	);
}

/** "Loading animation · 4 s" on a step that is one: what it is and how long it waits. */
function loadingMeta( field: { type: string; props?: unknown } ): string | null {
	if ( 'loading' !== fieldKind( field ) ) {
		return null;
	}
	const seconds = ( ( field.props as { autoAdvanceMs?: number } ).autoAdvanceMs ?? 0 ) / 1000;
	const number = new Intl.NumberFormat( localeTag( document.documentElement.lang ), { maximumFractionDigits: 1 } ).format( seconds );
	return `${ stepFieldName( 'loading' ) } · ${ sprintf( /* translators: %s: number of seconds */ __( '%s s', 'funnelforms-pro' ), number ) }`;
}
