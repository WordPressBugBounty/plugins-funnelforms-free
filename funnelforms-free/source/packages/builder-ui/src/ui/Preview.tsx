/**
 * Preview of the draft as visitors see it, in a desktop, tablet or phone frame. The form runs
 * as a test: the plugin checks the answers but stores and sends nothing (Http\PreviewController).
 *
 * The page comes from the plugin and runs in a sandboxed frame without allow-same-origin, so a
 * draft cannot reach the editor's session; its requests carry a signed token instead.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, type FormsApi } from '../api';
import type { Device } from '../store';
import { problemTexts } from './catalog';
import { useBuilder, useEnv } from './context';
import { __ } from './i18n';
import { Button, icons, Notice, Spinner } from './ui';

/** Width of each frame in CSS pixels; heights follow the space there is. */
export const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 };

type State = { state: 'loading' } | { state: 'ready'; html: string; run: number } | { state: 'failed'; message: string; problems: string[] };

export interface PreviewDialogProps {
	/** Shown in the bar, e.g. the template's name. */
	title?: string;
	/** Fetches the frame's page. */
	fetchPage: () => Promise<{ html: string }>;
	device: Device;
	onDevice: ( device: Device ) => void;
	/** More buttons in the bar, e.g. "Use this template". */
	actions?: React.ReactNode;
	onClose: () => void;
}

/** The draft of the form being edited; saved first. */
export function DraftPreview( { api, formId, onClose }: { api: FormsApi; formId: number; onClose: () => void } ) {
	const { store, ctx, lang } = useEnv();
	const device = useBuilder( ( s ) => s.device );
	// While translating, the preview shows that language.
	const locale = lang !== ctx.locale ? lang : undefined;
	const fetchPage = useCallback( async (): Promise<{ html: string }> => {
		// The preview shows what is saved; save the last changes first.
		await store.getState().saveNow();
		return locale ? api.preview( formId, locale ) : api.preview( formId );
	}, [ api, formId, store, locale ] );
	return <PreviewDialog fetchPage={ fetchPage } device={ device } onDevice={ ( d ) => store.getState().setDevice( d ) } onClose={ onClose } />;
}

export function PreviewDialog( { title, fetchPage, device, onDevice, actions, onClose }: PreviewDialogProps ) {
	const ref = useRef<HTMLDialogElement>( null );
	const [ state, setState ] = useState<State>( { state: 'loading' } );

	const load = useCallback( async (): Promise<void> => {
		setState( { state: 'loading' } );
		try {
			const { html } = await fetchPage();
			setState( { state: 'ready', html, run: Date.now() } );
		} catch ( e ) {
			const problems = e instanceof ApiError && Array.isArray( e.data.problems ) ? ( e.data.problems as string[] ) : [];
			setState( { state: 'failed', message: e instanceof Error ? e.message : String( e ), problems } );
		}
	}, [ fetchPage ] );

	useEffect( () => {
		void load();
	}, [ load ] );

	useEffect( () => {
		const dialog = ref.current;
		if ( dialog && ! dialog.open ) {
			dialog.showModal?.();
		}
	}, [] );

	const devices: Array<[ Device, string ]> = [
		[ 'desktop', __( 'Desktop', 'funnelforms-pro' ) ],
		[ 'tablet', __( 'Tablet', 'funnelforms-pro' ) ],
		[ 'mobile', __( 'Mobile', 'funnelforms-pro' ) ],
	];

	return (
		<dialog ref={ ref } className="ffxb-preview" onClose={ onClose } aria-label={ __( 'Preview', 'funnelforms-pro' ) }>
			<div className="ffxb-preview__bar">
				<strong className="ffxb-preview__title">{ title ?? __( 'Preview', 'funnelforms-pro' ) }</strong>
				<div className="ffxb-segmented" role="group" aria-label={ __( 'Screen size', 'funnelforms-pro' ) }>
					{ devices.map( ( [ id, label ] ) => (
						<button key={ id } type="button" className="ffxb-segmented__item" aria-pressed={ device === id } title={ `${ label } (${ DEVICE_WIDTH[ id ] } px)` } onClick={ () => onDevice( id ) }>
							{ icons[ id ] }
							<span>{ label }</span>
						</button>
					) ) }
				</div>
				<div className="ffxb-preview__actions">
					<Button variant="ghost" icon={ icons.reload } disabled={ 'loading' === state.state } onClick={ () => void load() }>
						{ __( 'Start over', 'funnelforms-pro' ) }
					</Button>
					{ actions }
					<Button variant="ghost" icon={ icons.close } aria-label={ __( 'Close preview', 'funnelforms-pro' ) } onClick={ () => ref.current?.close() } />
				</div>
			</div>
			<p className="ffxb-preview__note">{ __( 'Test run: nothing is saved or sent, and redirects are only named.', 'funnelforms-pro' ) }</p>
			{ 'loading' === state.state ? <Spinner label={ __( 'Loading preview…', 'funnelforms-pro' ) } /> : null }
			{ 'failed' === state.state ? (
				<div className="ffxb-preview__error">
					<Notice tone="danger" title={ state.problems.length ? __( 'Fix these to see the preview', 'funnelforms-pro' ) : __( 'The preview could not be loaded.', 'funnelforms-pro' ) }>
						{ state.problems.length ? (
							<ul>
								{ problemTexts( state.problems ).map( ( p ) => (
									<li key={ p }>{ p }</li>
								) ) }
							</ul>
						) : (
							state.message
						) }
					</Notice>
				</div>
			) : null }
			{ 'ready' === state.state ? <Stage key={ state.run } html={ state.html } width={ DEVICE_WIDTH[ device ] } device={ device } /> : null }
		</dialog>
	);
}

/**
 * The frame at the device's width, scaled down when the window is narrower. `message` is posted
 * to the page in the frame whenever it changes and when the page has loaded (the style of the
 * live preview, FormPreview::html()). `frameRef` gets the frame, for messages of the design mode.
 */
export function Stage( { html, width, device, message, frameRef }: { html: string; width: number; device: Device; message?: unknown; frameRef?: React.MutableRefObject<HTMLIFrameElement | null> } ) {
	const ref = useRef<HTMLDivElement>( null );
	const own = useRef<HTMLIFrameElement>( null );
	// The design mode (LiveDesign.tsx) talks to the same frame.
	const frame = frameRef ?? own;
	const post = useCallback( (): void => {
		if ( undefined !== message ) {
			// The frame has an origin of its own (sandbox without allow-same-origin): only "*" reaches it.
			frame.current?.contentWindow?.postMessage( message, '*' );
		}
	}, [ message ] );
	useEffect( post, [ post ] );
	const [ space, setSpace ] = useState<{ width: number; height: number }>( { width: width, height: 640 } );

	useLayoutEffect( () => {
		const stage = ref.current;
		if ( ! stage ) {
			return undefined;
		}
		const measure = (): void => setSpace( { width: stage.clientWidth - 32, height: stage.clientHeight - 32 } );
		measure();
		if ( 'undefined' === typeof ResizeObserver ) {
			return undefined;
		}
		const observer = new ResizeObserver( measure );
		observer.observe( stage );
		return () => observer.disconnect();
	}, [] );

	// Border of the device around the frame (builder.css).
	const bezel = 'desktop' === device ? 2 : 16;
	const scale = space.width > bezel ? Math.min( 1, ( space.width - bezel ) / width ) : 1;
	const height = Math.max( 320, ( space.height - bezel ) / scale );
	return (
		<div ref={ ref } className="ffxb-preview__stage">
			<div className={ `ffxb-preview__device ffxb-preview__device--${ device }` } style={ { width: width * scale, height: height * scale } }>
				<iframe
					ref={ frame }
					onLoad={ post }
					title={ __( 'Preview of the form', 'funnelforms-pro' ) }
					className="ffxb-preview__frame"
					sandbox="allow-scripts allow-forms"
					srcDoc={ html }
					style={ { width, height, transform: `scale(${ scale })` } }
				/>
			</div>
		</div>
	);
}
