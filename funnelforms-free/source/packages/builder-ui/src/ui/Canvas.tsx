/**
 * The form as a flow chart (xyflow): steps, contact steps and ends with the paths between them.
 * Nodes are dragged to arrange them, connected by drawing from the right handle to another node,
 * and field types from the palette are dropped onto the canvas (new step) or onto a node (new
 * field in it). The analytics mode (Analytics.tsx) draws the figures of the published form over it.
 */
import React, { memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
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
	type Edge as FlowEdge,
	type EdgeProps,
	type InternalNode,
	type Node as FlowNode,
	type NodeChange,
	type NodeProps,
	type AriaLabelConfig,
} from '@xyflow/react';
import type { FormDocument, FormNode } from '@funnelforms/form-schema';
import { connectFromCanvas } from '../conditions';
import { testKind, testSteps } from '../experiments';
import { addContact, addEnd, addField, addStep, nodeName, setPositions, STEP_FIELD_TYPES, text, type StepFieldType } from '../document';
import type { LogicHint } from '../logic';
import type { Selection } from '../store';
import { kindName } from './Actions';
import { AnalyticsLegend, AnalyticsPanel, edgeFigures, NodeAnalyticsView, useAnalytics } from './Analytics';
import { PredictionPanel, usePrediction } from './Prediction';
import { createPlayback, planPlayback, PlaybackContext, PlaybackControl, PlaybackLayer, usePlayedShare, type PlaybackBox } from './PredictionPlayback';
import { contactFieldName, stepFieldName } from './catalog';
import { SHORTCUTS_EVENT, useBuilder, useEnv } from './context';
import { describeCondition, edgeLabel, fieldIndex } from './describe';
import { hintText, useHints } from './Hints';
import { __, sprintf } from './i18n';
import { REVEAL_EVENT } from './Questions';
import { FiguresContext, NodeFigures } from './Stats';
import { TypeIcon } from './typeIcons';
import { ProBadge } from './ui';
import { proUrl } from '../edition';
import type { CanvasAnalytics, EdgeAnalytics } from '../stats';

/** Type of the data dragged from the palette. */
export const DRAG_TYPE = 'application/x-funnelforms-builder';

/** What the palette drags: a step with a field type, a contact step, an end, or a field. */
export type PaletteItem = { kind: 'step'; type: StepFieldType } | { kind: 'contact' } | { kind: 'end' } | { kind: 'field'; type: string };

type NodeData = {
	node: FormNode;
	locale: string;
	start: boolean;
	unreachable: boolean;
	/** The variant this step shows in an A/B test (A, B, …); empty outside a test. */
	variant: string;
	/** Hints about the node and its paths, in words. */
	hints: Array<{ level: LogicHint[ 'level' ]; text: string }>;
	/** Contact steps: what runs on sending. */
	actions: string[];
	selectedField: string | undefined;
	onSelectField: ( fieldId: string ) => void;
	onAfterSending: () => void;
};

type CanvasNode = FlowNode<NodeData, 'form'>;

const KIND_NAMES = (): Record<FormNode[ 'type' ], string> => ( {
	step: __( 'Step', 'funnelforms-pro' ),
	contact: __( 'Contact step', 'funnelforms-pro' ),
	end: __( 'End', 'funnelforms-pro' ),
} );

const NodeView = memo( function NodeView( { data, selected }: NodeProps<CanvasNode> ) {
	const { node, locale, start, unreachable, variant, hints, actions, selectedField, onSelectField, onAfterSending } = data;
	const problems = hints.filter( ( h ) => 'info' !== h.level );
	const worst = problems.some( ( h ) => 'error' === h.level ) ? 'error' : 'warn';
	const figures = useContext( FiguresContext )?.get( node.id );
	// The figures of the prediction or of the analytics; one of the two modes is on at a time.
	const forecast = 'free' === process.env.FUNNELFORMS_EDITION ? undefined : usePrediction()?.figures?.nodes.get( node.id );
	const measured = 'free' === process.env.FUNNELFORMS_EDITION ? undefined : useAnalytics()?.figures?.nodes.get( node.id );
	const analytics = forecast ?? measured;
	// While the visitors of the prediction play, its figures count up with the dots.
	const played = 'free' === process.env.FUNNELFORMS_EDITION ? null : usePlayedShare( node.id );
	const name = nodeName( node, locale );
	const fields = 'fields' in node ? ( node.fields as Array<{ id: string; type: string; label: Record<string, string>; showWhen?: unknown }> ) : [];
	return (
		<div
			className={
				`ffxb-node ffxb-node--${ node.type }` +
				( selected ? ' is-selected' : '' ) +
				( unreachable ? ' is-unreachable' : '' ) +
				( analytics ? ' has-analytics' + ( analytics.band ? ` is-band-${ analytics.band }` : '' ) + ( 0 === analytics.reached ? ' is-cold' : '' ) + ( analytics.strongest ? ' is-strongest' : '' ) : '' )
			}
			data-node={ node.id }
		>
			<Handle type="target" position={ Position.Left } className="ffxb-handle" />
			<div className="ffxb-node__head">
				<span className="ffxb-node__icon" aria-hidden="true">
					<TypeIcon type={ 'step' === node.type ? fields[ 0 ]?.type ?? 'text' : node.type } size={ 14 } />
				</span>
				<span className="ffxb-node__kind">{ KIND_NAMES()[ node.type ] }</span>
				{ start ? <span className="ffxb-node__flag ffxb-node__flag--start">{ __( 'Start', 'funnelforms-pro' ) }</span> : null }
				{ variant ? (
					<span className="ffxb-node__flag ffxb-node__flag--ab" title={ sprintf( __( 'A/B test: variant %s', 'funnelforms-pro' ), variant ) }>
						{ sprintf( __( 'A/B · %s', 'funnelforms-pro' ), variant ) }
					</span>
				) : null }
				{ unreachable ? <span className="ffxb-node__flag ffxb-node__flag--warn">{ __( 'Not reachable', 'funnelforms-pro' ) }</span> : null }
				{ problems.length && ! unreachable ? (
					<span className={ `ffxb-node__flag ffxb-node__flag--${ worst }` } title={ problems.map( ( h ) => h.text ).join( '\n' ) }>
						{ 'error' === worst ? __( 'Stuck', 'funnelforms-pro' ) : __( 'Check', 'funnelforms-pro' ) }
					</span>
				) : null }
			</div>
			<div className="ffxb-node__title">{ name || <em>{ __( 'Without a title', 'funnelforms-pro' ) }</em> }</div>
			{ fields.length > 1 || 'contact' === node.type ? (
				<ul className="ffxb-node__fields">
					{ fields.map( ( f ) => (
						<li key={ f.id }>
							<button
								type="button"
								className={ 'ffxb-node__field nodrag' + ( selectedField === f.id ? ' is-selected' : '' ) }
								onClick={ ( e ) => {
									e.stopPropagation();
									onSelectField( f.id );
								} }
							>
								{ 'contact' === node.type ? null : <span className="ffxb-node__field-type">{ stepFieldName( f.type ) }</span> }
								{ 'showWhen' in f && f.showWhen ? (
									<span className="ffxb-node__field-if" title={ __( 'Shown only on certain answers', 'funnelforms-pro' ) }>
										{ __( 'if', 'funnelforms-pro' ) }
									</span>
								) : null }
								<span className="ffxb-node__field-label">{ text( f.label, locale ) || ( 'contact' === node.type ? contactFieldName( f.type ) : '' ) }</span>
							</button>
						</li>
					) ) }
				</ul>
			) : fields[ 0 ] ? (
				<div className="ffxb-node__meta">{ stepFieldName( fields[ 0 ].type ) }</div>
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
			{ 'free' !== process.env.FUNNELFORMS_EDITION && analytics ? <NodeAnalyticsView type={ node.type } figures={ analytics } forecast={ !! forecast } played={ forecast ? played : null } /> : figures ? <NodeFigures figures={ figures } /> : null }
			{ 'end' !== node.type ? <Handle type="source" position={ Position.Right } className="ffxb-handle" /> : null }
		</div>
	);
} );

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
	const target = node.internals.handleBounds?.target?.[ 0 ];
	const source = node.internals.handleBounds?.source?.[ 0 ];
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

/** Space kept between a path's pill and the steps beside it, and the narrowest and widest pill, in px. */
const LABEL_GAP = 8;
const LABEL_MIN = 72;
const LABEL_MAX = 200;

/** Size of the arrowhead at the end of a path, in px. */
const ARROW = 16;

/** A path with its condition as a readable label in a pill. */
const PathView = memo( function PathView( { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data }: EdgeProps<PathEdge> ) {
	const [ path, midX, midY ] = getBezierPath( { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } );
	const [ x, y ] = data?.along ? pointOn( path, data.along ) ?? [ midX, midY ] : [ midX, midY ];
	const f = data?.figures;
	const shown = 'free' !== process.env.FUNNELFORMS_EDITION && f ? edgeFigures( f ) : null;
	// The pill sits in the middle between the two steps and is never wider than the room there, so it
	// does not cover their titles; the condition is cut short (it is the tooltip in full).
	const room = targetX - sourceX - 2 * LABEL_GAP;
	const maxWidth = room > 0 ? Math.max( LABEL_MIN, Math.min( LABEL_MAX, room ) ) : undefined;
	return (
		<>
			<BaseEdge id={ id } path={ path } markerEnd={ markerEnd } style={ f ? { strokeWidth: f.width, opacity: f.opacity } : undefined } />
			{ data?.label || shown ? (
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

function buildNodes( doc: FormDocument, selection: Selection, hints: LogicHint[], onSelectField: ( nodeId: string, fieldId: string ) => void, onAfterSending: ( nodeId: string ) => void, previous: CanvasNode[] ): CanvasNode[] {
	const locale = doc.locales.default;
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
				actions: 'contact' === node.type ? doc.actions.filter( ( a ) => ! a.node || a.node === node.id ).map( ( a ) => kindName( a.kind ) ) : [],
				selectedField: selection.node === node.id ? selection.field : undefined,
				onSelectField: ( fieldId: string ) => onSelectField( node.id, fieldId ),
				onAfterSending: () => onAfterSending( node.id ),
			},
		};
	} );
}

function buildEdges( doc: FormDocument, selection: Selection, hints: LogicHint[], analytics: CanvasAnalytics | null ): PathEdge[] {
	const locale = doc.locales.default;
	const fields = fieldIndex( doc );
	const warned = new Set( hints.filter( ( h ) => h.edge && 'info' !== h.level ).map( ( h ) => h.edge ) );
	return doc.edges.map( ( edge ) => {
		const siblings = doc.edges.filter( ( e ) => e.from === edge.from );
		const conditional = siblings.filter( ( e ) => ! e.default );
		let data: PathData = {};
		if ( edge.when ) {
			data = {
				label: edgeLabel( edge.when, doc, locale, edge.from, fields ),
				title: describeCondition( edge.when, doc, locale, fields ),
				order: conditional.length > 1 ? conditional.indexOf( edge ) + 1 : undefined,
			};
		} else if ( siblings.length > 1 ) {
			data = { label: __( 'Otherwise', 'funnelforms-pro' ), otherwise: true };
		}
		if ( warned.has( edge.id ) ) {
			data.warn = true;
			data.title = hints
				.filter( ( h ) => h.edge === edge.id )
				.map( ( h ) => hintText( h, doc, locale ) )
				.concat( data.title ?? [] )
				.join( '\n' );
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
		return {
			id: edge.id,
			type: 'path' as const,
			source: edge.from,
			target: edge.to,
			// Screen readers name the path by its steps, not by their ids.
			ariaLabel: from && to ? sprintf( __( 'Path from %1$s to %2$s', 'funnelforms-pro' ), nodeName( from, locale ), nodeName( to, locale ) ) + ( data.label ? ': ' + data.label : '' ) : undefined,
			data,
			selected: selection.edge === edge.id,
			className: 'ffxb-edge' + ( edge.when ? ' ffxb-edge--conditional' : '' ) + ( data.warn ? ' ffxb-edge--warn' : '' ) + ( figures ? ( figures.sessions ? '' : ' ffxb-edge--none' ) + ( figures.strongest ? ' ffxb-edge--strongest' : '' ) : '' ),
			// The head keeps its size on thick analytics paths (markers grow with the stroke by default).
			markerEnd: figures ? { type: MarkerType.ArrowClosed, width: ARROW + figures.width, height: ARROW + figures.width, markerUnits: 'userSpaceOnUse' } : { type: MarkerType.ArrowClosed, width: ARROW, height: ARROW },
		};
	} );
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

	const hints = useHints();
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
	const boxOf = useCallback( ( id: string ) => boxOfNode( flow.getInternalNode( id ) ), [ flow ] );
	const traces = prediction?.result?.simulation.traces;
	const play = useCallback( () => {
		if ( traces?.length ) {
			playback.start( planPlayback( traces, boxOf, wayPoints, prediction?.resultOf?.model.personas.map( ( p ) => p.id ), flow.getNodes().map( ( n ) => n.id ) ) );
		}
	}, [ traces, boxOf, playback, prediction?.resultOf, flow ] );

	const onSelectField = useCallback( ( node: string, field: string ) => select( { node, field } ), [ select ] );
	const onAfterSending = useCallback( ( node: string ) => select( { node }, 'logic' ), [ select ] );

	useEffect( () => {
		if ( doc ) {
			setNodes( ( previous ) => buildNodes( doc, selection, hints, onSelectField, onAfterSending, previous ) );
		}
	}, [ doc, selection, hints, onSelectField, onAfterSending ] );

	const edges = useMemo( () => ( doc ? buildEdges( doc, selection, hints, shown ) : [] ), [ doc, selection, hints, shown ] );
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
			let id: string | null = null;
			change( ( d ) => {
				id = connectFromCanvas( d, connection.source, connection.target );
			} );
			if ( id ) {
				select( { edge: id } );
			}
		},
		[ change, select ]
	);

	const onDrop = ( event: React.DragEvent ): void => {
		const item = readItem( event );
		if ( ! item || readOnly ) {
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
			if ( 'step' === item.kind && ( STEP_FIELD_TYPES as readonly string[] ).includes( item.type ) ) {
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
		<PlaybackContext.Provider value={ playback }>
			<ReactFlow<CanvasNode, PathEdge>
				nodes={ nodes }
				edges={ edges }
				nodeTypes={ nodeTypes }
				edgeTypes={ edgeTypes }
				onNodesChange={ onNodesChange }
				onNodeDragStop={ onDragStop }
				onConnect={ onConnect }
				onNodeClick={ ( _e, node ) => select( { node: node.id } ) }
				onEdgeClick={ ( _e, edge ) => select( { edge: edge.id } ) }
				onPaneClick={ () => select( {} ) }
				onDragOver={ ( e ) => {
					if ( e.dataTransfer.types.includes( DRAG_TYPE ) ) {
						e.preventDefault();
						e.dataTransfer.dropEffect = 'copy';
					}
				} }
				onDrop={ onDrop }
				nodesDraggable={ ! readOnly }
				nodesConnectable={ ! readOnly }
				deleteKeyCode={ null }
				selectionKeyCode={ null }
				multiSelectionKeyCode={ null }
				fitView
				fitViewOptions={ { padding: 0.15, minZoom: 0.6, maxZoom: 1, nodes: focus } }
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
				{ 'free' !== process.env.FUNNELFORMS_EDITION && predicted && prediction?.result && prediction.resultOf ? (
					<>
						<Panel position="top-left" className="ffxb-pai-play-panel">
							<PlaybackControl created={ prediction.resultOf.created } visitors={ prediction.result.visitors } traced={ prediction.result.simulation.traces.length } onPlay={ play } />
						</Panel>
						<PlaybackLayer boxOf={ boxOf } />
					</>
				) : null }
				{ 'free' !== process.env.FUNNELFORMS_EDITION && shown ? (
					<Panel position="bottom-center">
						<AnalyticsLegend dots={ !! predicted && playing } />
					</Panel>
				) : null }
			</ReactFlow>
		</PlaybackContext.Provider>
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
