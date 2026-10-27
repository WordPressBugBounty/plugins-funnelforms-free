/**
 * The design mode of the live preview: the preview becomes clickable, a hover outlines a part of
 * the form (button, question, answer, input, progress bar, background …) and a click picks it.
 * A panel beside it shows exactly the tokens that part uses; a change shows at once through the
 * style message of the preview (Workspaces.tsx), without loading the frame again.
 *
 * The frame (plugin/assets/admin/preview-frame.js) runs the draft in a sandbox without
 * allow-same-origin, so its origin is "null". Messages from it are read only when they come from
 * that frame's window with that origin and the expected shape (readFrameMessage()); even then they
 * are only hints (a part and a position), never content.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import { effectiveTokens, setStyleToken, toHex } from '../themes';
import { ColorField, ContrastChip } from './ColorPick';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { IconButton, icons, Range } from './ui';

/** Parts of the form the design mode tells apart (the same names as the frame script). */
export const DESIGN_PARTS = [ 'button', 'back', 'question', 'description', 'answer', 'icon', 'input', 'progress', 'form' ] as const;

export type DesignPart = ( typeof DESIGN_PARTS )[ number ];

/** Position of a part in the frame, in CSS pixels of the page in the frame. */
export interface PartRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type FrameMessage =
	| { action: 'ready' }
	| { action: 'pick'; target: DesignPart; rect: PartRect | null }
	| { action: 'rect'; target: DesignPart; rect: PartRect }
	| { action: 'key'; key: 'undo' | 'redo' | 'escape' };

export function partName( part: DesignPart ): string {
	const names: Record<DesignPart, string> = {
		button: __( 'Next and send button', 'funnelforms-pro' ),
		back: __( 'Back button', 'funnelforms-pro' ),
		question: __( 'Questions and headings', 'funnelforms-pro' ),
		description: __( 'Descriptions and hints', 'funnelforms-pro' ),
		answer: __( 'Answers', 'funnelforms-pro' ),
		icon: __( 'Icons of answers', 'funnelforms-pro' ),
		input: __( 'Input fields', 'funnelforms-pro' ),
		progress: __( 'Progress bar', 'funnelforms-pro' ),
		form: __( 'Background of the form', 'funnelforms-pro' ),
	};
	return names[ part ];
}

function isPart( value: unknown ): value is DesignPart {
	return 'string' === typeof value && ( DESIGN_PARTS as readonly string[] ).includes( value );
}

function readRect( value: unknown ): PartRect | null {
	if ( ! value || 'object' !== typeof value ) {
		return null;
	}
	const r = value as Record<string, unknown>;
	const n = ( v: unknown ): v is number => 'number' === typeof v && Number.isFinite( v ) && Math.abs( v ) < 100000;
	return n( r.x ) && n( r.y ) && n( r.width ) && n( r.height ) && r.width >= 0 && r.height >= 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}

/**
 * A message of the design mode from the preview frame, or null for anything else: it must come
 * from the frame's own window, with the opaque origin of the sandbox, and have the shape the frame
 * script sends.
 */
export function readFrameMessage( event: MessageEvent, frame: Window | null | undefined ): FrameMessage | null {
	if ( ! frame || event.source !== frame || 'null' !== event.origin ) {
		return null;
	}
	const data: unknown = event.data;
	if ( ! data || 'object' !== typeof data ) {
		return null;
	}
	const d = data as Record<string, unknown>;
	if ( 'ffx-design' !== d.type ) {
		return null;
	}
	switch ( d.action ) {
		case 'ready':
			return { action: 'ready' };
		case 'pick':
			return isPart( d.target ) ? { action: 'pick', target: d.target, rect: readRect( d.rect ) } : null;
		case 'rect': {
			const rect = readRect( d.rect );
			return isPart( d.target ) && rect ? { action: 'rect', target: d.target, rect } : null;
		}
		case 'key':
			return 'undo' === d.key || 'redo' === d.key || 'escape' === d.key ? { action: 'key', key: d.key } : null;
		default:
			return null;
	}
}

type Tokens = Record<string, string>;

/** A token a part uses: a colour, or a size in pixels. `fallback` is what applies while it is empty. */
interface TokenRow {
	key: string;
	label: string;
	kind: 'color' | 'px';
	fallback: ( t: Tokens ) => string;
	min?: number;
	max?: number;
}

/** A text colour on a background colour of the part, checked for contrast. */
interface Pair {
	label: string;
	text: ( t: Tokens ) => string;
	background: ( t: Tokens ) => string;
}

const get =
	( key: string, ...fallbacks: string[] ) =>
	( t: Tokens ): string => {
		for ( const k of [ key, ...fallbacks ] ) {
			const v = t[ k ];
			if ( v ) {
				return v;
			}
		}
		return '';
	};

/** The tokens each part uses (runtime.css), the most telling first. */
export function partTokens( part: DesignPart ): { rows: TokenRow[]; pairs: Pair[] } {
	const color = ( key: string, label: string, ...fallbacks: string[] ): TokenRow => ( { key, label, kind: 'color', fallback: get( key, ...fallbacks ) } );
	const px = ( key: string, label: string, min: number, max: number, fallback: string ): TokenRow => ( { key, label, kind: 'px', min, max, fallback: get( key, fallback ) } );
	const readable = __( 'Text', 'funnelforms-pro' );
	switch ( part ) {
		case 'button':
			return {
				rows: [ color( 'color.button', __( 'Button colour', 'funnelforms-pro' ), 'color.primary' ), color( 'color.onButton', __( 'Text on the button', 'funnelforms-pro' ), 'color.onPrimary' ), px( 'radius.button', __( 'Corners', 'funnelforms-pro' ), 0, 32, 'radius.input' ), px( 'space.button', __( 'Height', 'funnelforms-pro' ), 4, 24, 'space.button' ) ],
				pairs: [ { label: readable, text: get( 'color.onButton', 'color.onPrimary' ), background: get( 'color.button', 'color.primary' ) } ],
			};
		case 'back':
			return {
				rows: [ color( 'color.back', __( 'Button colour', 'funnelforms-pro' ), 'color.background' ), color( 'color.onBack', __( 'Text on the button', 'funnelforms-pro' ), 'color.text' ), px( 'radius.button', __( 'Corners', 'funnelforms-pro' ), 0, 32, 'radius.input' ) ],
				pairs: [ { label: readable, text: get( 'color.onBack', 'color.text' ), background: get( 'color.back', 'color.background' ) } ],
			};
		case 'question':
			return {
				rows: [ color( 'color.heading', __( 'Colour of questions', 'funnelforms-pro' ), 'color.text' ), px( 'font.size.heading', __( 'Size of questions', 'funnelforms-pro' ), 14, 48, 'font.size.heading' ) ],
				pairs: [ { label: readable, text: get( 'color.heading', 'color.text' ), background: get( 'color.background' ) } ],
			};
		case 'description':
			return {
				rows: [ color( 'color.muted', __( 'Colour of descriptions', 'funnelforms-pro' ) ) ],
				pairs: [ { label: readable, text: get( 'color.muted' ), background: get( 'color.background' ) } ],
			};
		case 'answer':
			return {
				rows: [
					color( 'color.option', __( 'Answers', 'funnelforms-pro' ), 'color.background' ),
					color( 'color.optionSelected', __( 'Chosen answer', 'funnelforms-pro' ), 'color.option', 'color.background' ),
					color( 'color.primary', __( 'Accent colour (frame of the chosen answer)', 'funnelforms-pro' ) ),
					color( 'color.border', __( 'Borders', 'funnelforms-pro' ) ),
					px( 'radius.card', __( 'Corners', 'funnelforms-pro' ), 0, 24, 'radius.card' ),
				],
				pairs: [ { label: readable, text: get( 'color.text' ), background: get( 'color.option', 'color.background' ) } ],
			};
		case 'icon':
			return {
				rows: [ color( 'color.icon', __( 'Icons of answers', 'funnelforms-pro' ), 'color.primary' ), px( 'size.icon', __( 'Size of icons and images', 'funnelforms-pro' ), 24, 200, 'size.icon' ) ],
				pairs: [],
			};
		case 'input':
			return {
				rows: [ color( 'color.background', __( 'Background', 'funnelforms-pro' ) ), color( 'color.text', __( 'Text', 'funnelforms-pro' ) ), color( 'color.border', __( 'Borders', 'funnelforms-pro' ) ), px( 'radius.input', __( 'Corners', 'funnelforms-pro' ), 0, 24, 'radius.input' ), px( 'border.width', __( 'Border width', 'funnelforms-pro' ), 0, 6, 'border.width' ) ],
				pairs: [ { label: readable, text: get( 'color.text' ), background: get( 'color.background' ) } ],
			};
		case 'progress':
			return {
				rows: [ color( 'color.progress', __( 'Progress bar', 'funnelforms-pro' ), 'color.primary' ), color( 'color.progressTrack', __( 'Progress bar background', 'funnelforms-pro' ), 'color.border' ) ],
				pairs: [],
			};
		case 'form':
			return {
				rows: [
					color( 'color.background', __( 'Background', 'funnelforms-pro' ) ),
					color( 'color.backgroundEnd', __( 'Second background colour', 'funnelforms-pro' ), 'color.background' ),
					color( 'color.text', __( 'Text', 'funnelforms-pro' ) ),
					color( 'color.primary', __( 'Accent colour', 'funnelforms-pro' ) ),
					px( 'radius.card', __( 'Corners', 'funnelforms-pro' ), 0, 24, 'radius.card' ),
					px( 'space.padding', __( 'Inner spacing', 'funnelforms-pro' ), 0, 64, 'space.padding' ),
				],
				pairs: [ { label: readable, text: get( 'color.text' ), background: get( 'color.background' ) } ],
			};
	}
}

/** Defaults of sizes the runtime has without a token (runtime.css). */
const SIZE_DEFAULTS: Tokens = { 'space.button': '10', 'font.size.heading': '20', 'size.icon': '64', 'border.width': '1', 'space.padding': '24' };

export interface LiveDesign {
	picked: { part: DesignPart; rect: PartRect | null } | null;
	choose: ( part: DesignPart | null ) => void;
}

/**
 * Talks to the frame: switches its design mode on or off (again after each load), keeps the part
 * picked and where it is, and runs undo and redo pressed inside the frame.
 */
export function useLiveDesign( frame: React.MutableRefObject<HTMLIFrameElement | null>, on: boolean ): LiveDesign {
	const { store } = useEnv();
	const [ picked, setPicked ] = useState<LiveDesign[ 'picked' ]>( null );
	const current = useRef( picked );
	current.current = picked;
	const live = useRef( on );
	live.current = on;

	const post = useCallback(
		( message: Record<string, unknown> ): void => {
			// The frame has an origin of its own (sandbox without allow-same-origin): only "*" reaches it.
			frame.current?.contentWindow?.postMessage( { type: 'ffx-design', ...message }, '*' );
		},
		[ frame ]
	);
	const mode = useCallback( (): void => {
		const labels = Object.fromEntries( DESIGN_PARTS.map( ( p ) => [ p, partName( p ) ] ) );
		post( { action: 'mode', on: live.current, labels } );
	}, [ post ] );

	useEffect( () => {
		const onMessage = ( event: MessageEvent ): void => {
			const message = readFrameMessage( event, frame.current?.contentWindow );
			if ( ! message ) {
				return;
			}
			switch ( message.action ) {
				case 'ready':
					// A new page in the frame (the draft was loaded again): the same mode and part.
					mode();
					if ( live.current && current.current ) {
						post( { action: 'select', target: current.current.part } );
					}
					break;
				case 'pick':
					if ( live.current ) {
						setPicked( { part: message.target, rect: message.rect } );
					}
					break;
				case 'rect':
					setPicked( ( p ) => ( p && p.part === message.target ? { ...p, rect: message.rect } : p ) );
					break;
				case 'key':
					if ( 'undo' === message.key ) {
						store.getState().undo();
					} else if ( 'redo' === message.key ) {
						store.getState().redo();
					} else {
						setPicked( null );
						post( { action: 'clear' } );
					}
					break;
			}
		};
		window.addEventListener( 'message', onMessage );
		return () => window.removeEventListener( 'message', onMessage );
	}, [ frame, mode, post, store ] );

	useEffect( () => {
		mode();
		if ( ! on ) {
			setPicked( null );
		}
	}, [ on, mode ] );

	const choose = useCallback(
		( part: DesignPart | null ): void => {
			if ( null === part ) {
				setPicked( null );
				post( { action: 'clear' } );
				return;
			}
			setPicked( ( p ) => ( p && p.part === part ? p : { part, rect: null } ) );
			post( { action: 'select', target: part } );
		},
		[ post ]
	);
	return { picked, choose };
}

/** The list of parts, for the keyboard and for parts that are on another step. */
export function PartChooser( { value, onChange, chooser }: { value: DesignPart | null; onChange: ( part: DesignPart | null ) => void; chooser?: React.Ref<HTMLSelectElement> } ) {
	return (
		<select ref={ chooser } className="ffxb-input ffxb-live-design__chooser" aria-label={ __( 'Part of the form to design', 'funnelforms-pro' ) } value={ value ?? '' } onChange={ ( e ) => onChange( isPart( e.target.value ) ? e.target.value : null ) }>
			<option value="">{ __( 'Click a part of the form, or choose…', 'funnelforms-pro' ) }</option>
			{ DESIGN_PARTS.map( ( p ) => (
				<option key={ p } value={ p }>
					{ partName( p ) }
				</option>
			) ) }
		</select>
	);
}

/** Width of the panel in pixels (builder.css). */
const PANEL = 300;

/**
 * The tokens of the picked part, beside it in the preview. Changes are steps of the builder's
 * history (undo and redo), with the same keys as the design panel.
 */
export function DesignPartPanel( { doc, part, rect, frame, onClose }: { doc: FormDocument; part: DesignPart; rect: PartRect | null; frame: HTMLIFrameElement | null; onClose: () => void } ) {
	const { store, readOnly } = useEnv();
	const ref = useRef<HTMLDivElement>( null );
	const tokens = { ...SIZE_DEFAULTS, ...effectiveTokens( doc.style.tokens ) } as Tokens;
	const { rows, pairs } = partTokens( part );
	const token = ( key: string, value: string | null ): void => {
		if ( ! readOnly ) {
			store.getState().change( ( d ) => setStyleToken( d, key, value ), 'style:' + key );
		}
	};

	// Focus moves into the panel when a part is picked.
	useEffect( () => {
		ref.current?.focus();
	}, [ part ] );

	// Beside the part when there is room, else below it; at the top right when it is not on this step.
	useLayoutEffect( () => {
		const panel = ref.current;
		const box = panel?.offsetParent as HTMLElement | null;
		if ( ! panel || ! box ) {
			return;
		}
		const area = box.getBoundingClientRect();
		const height = panel.offsetHeight;
		let left = area.width - PANEL - 16;
		let top = 64;
		if ( rect && frame ) {
			const f = frame.getBoundingClientRect();
			const scale = frame.offsetWidth > 0 ? f.width / frame.offsetWidth : 1;
			const x = f.left - area.left + rect.x * scale;
			const y = f.top - area.top + rect.y * scale;
			const right = x + rect.width * scale;
			if ( right + 12 + PANEL <= area.width - 8 ) {
				left = right + 12;
				top = y;
			} else if ( x - 12 - PANEL >= 8 ) {
				left = x - 12 - PANEL;
				top = y;
			} else {
				left = x;
				top = y + rect.height * scale + 12;
			}
		}
		panel.style.left = `${ Math.max( 8, Math.min( left, area.width - PANEL - 8 ) ) }px`;
		panel.style.top = `${ Math.max( 56, Math.min( top, area.height - height - 8 ) ) }px`;
	} );

	return (
		<div
			ref={ ref }
			className="ffxb-live-design"
			role="dialog"
			aria-label={ sprintf( /* translators: %s: part of the form, e.g. Answers */ __( 'Design of %s', 'funnelforms-pro' ), partName( part ) ) }
			tabIndex={ -1 }
			onKeyDown={ ( e ) => {
				if ( 'Escape' === e.key ) {
					e.stopPropagation();
					onClose();
				}
			} }
		>
			<div className="ffxb-live-design__head">
				<strong>{ partName( part ) }</strong>
				<IconButton label={ __( 'Close', 'funnelforms-pro' ) } icon={ icons.close } onClick={ onClose } />
			</div>
			{ rect ? null : <p className="ffxb-hint">{ __( 'Not on this step of the form. Your changes still apply to it.', 'funnelforms-pro' ) }</p> }
			{ pairs.map( ( p ) => (
				<ContrastChip key={ p.label } label={ p.label } text={ p.text( tokens ) } background={ p.background( tokens ) } />
			) ) }
			{ rows.map( ( row ) => {
				const value = doc.style.tokens[ row.key ] ?? '';
				const shown = '' !== value ? value : row.fallback( tokens );
				if ( 'px' === row.kind ) {
					const n = Number.parseFloat( shown );
					return <Range key={ row.key } label={ row.label } min={ row.min ?? 0 } max={ row.max ?? 64 } unit=" px" value={ Number.isFinite( n ) ? n : row.min ?? 0 } onChange={ ( v ) => token( row.key, String( v ) ) } />;
				}
				return <ColorField key={ row.key } label={ row.label } value={ value } hex={ toHex( shown ) } token={ row.key } onChange={ ( v ) => token( row.key, v ) } />;
			} ) }
		</div>
	);
}

/** The part chooser and the switch between designing and trying the form. */
export function DesignModeBar( { on, onToggle, picked, onChoose, chooser }: { on: boolean; onToggle: ( on: boolean ) => void; picked: DesignPart | null; onChoose: ( part: DesignPart | null ) => void; chooser?: React.Ref<HTMLSelectElement> } ) {
	return (
		<div className="ffxb-live-design__bar">
			<div className="ffxb-segmented" role="group" aria-label={ __( 'What a click in the preview does', 'funnelforms-pro' ) }>
				<button type="button" className="ffxb-segmented__item" aria-pressed={ on } onClick={ () => onToggle( true ) }>
					{ pickIcon }
					<span>{ __( 'Edit design', 'funnelforms-pro' ) }</span>
				</button>
				<button type="button" className="ffxb-segmented__item" aria-pressed={ ! on } onClick={ () => onToggle( false ) }>
					{ icons.start }
					<span>{ __( 'Try the form', 'funnelforms-pro' ) }</span>
				</button>
			</div>
			{ on ? <PartChooser value={ picked } onChange={ onChoose } chooser={ chooser } /> : null }
		</div>
	);
}

const pickIcon = (
	<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M4 4l6.5 16 2.3-6.7L19.5 11z" />
	</svg>
);
