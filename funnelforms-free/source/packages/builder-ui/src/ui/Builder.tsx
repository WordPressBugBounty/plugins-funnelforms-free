/**
 * The editor of one form: top bar (name, save state, workspaces, undo, revisions, publish) and
 * the open workspace: the palette, the canvas and the properties of what is selected, or the
 * design, the settings, the actions or the ways to embed the form. The figures of a form are on
 * the statistics page; from there the editor can open with them on the canvas (figures).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { AiConfig, FormsApi, Revision } from '../api';
import { AiBar } from './AiForm';
import { deliveryWarnings } from '../actions';
import { asksFor, duplicateField, duplicateNode, isClip, pasteField, pasteNode, removeEdge, removeField, removeNode, type Clip } from '../document';
import { ChangeNotice, fieldsOf, removeWithNotice } from './Removal';
import { createBuilderStore, type BuilderStore } from '../store';
import { Canvas } from './Canvas';
import { problemTexts, rightName } from './catalog';
import { BuilderContext, DEFAULT_RIGHTS, SHORTCUTS_EVENT, useBuilder, useEnv, ViewContext, type BuilderEnv, type Rights, type View } from './context';
import { __, sprintf } from './i18n';
import { Inspector } from './Inspector';
import { LanguagePicker } from './Languages';
import { Palette } from './Palette';
import { EmbedWorkspace } from './Embed';
import type { EmbedConfig } from '../embed';
import { DraftPreview } from './Preview';
import { AnalyticsContext, useAnalyticsState, type Analytics } from './Analytics';
import { canvasFigures, FiguresContext } from './Stats';
import type { StepFigures } from '../stats';
import { StatusBadge } from './FormsList';
import { Tour, TourIcon, tourSeen } from './Tour';
import { Button, Dialog, icons, Notice, Spinner, TextInput } from './ui';
import { ActionsWorkspace, DesignWorkspace, SettingsWorkspace } from './Workspaces';
import type { Labels } from '../document';
import type { ContactField, Field, FormDocument } from '@funnelforms/form-schema';

export interface BuilderProps {
	api: FormsApi;
	formId: number;
	onBack: () => void;
	/** Default texts of new fields for a form language; English for languages without. */
	labelsFor?: ( locale: string ) => Labels | undefined;
	/** Store to use (tests); by default one is made for the form. */
	store?: BuilderStore;
	rights?: Rights;
	/** Offers the tour through the builder, by itself the first time in this browser. */
	tour?: boolean;
	/** Workspace to open first; the canvas by default. */
	view?: View;
	/** Opens with the figures on the canvas ("Show on the canvas" on the statistics page). */
	figures?: boolean;
	/** The embed code for other websites (Funnelforms Pro); without it that way is not offered. */
	embed?: EmbedConfig | null;
	/** The AI form builder (Funnelforms Pro); without it "Edit with AI" is not offered. */
	ai?: AiConfig | null;
}

export function Builder( { api, formId, onBack, labelsFor, store: given, rights = DEFAULT_RIGHTS, tour = false, view: first = 'build', figures: withFigures = false, embed, ai }: BuilderProps ) {
	const store = useMemo( () => given ?? createBuilderStore( api, formId ), [ api, formId, given ] );

	useEffect( () => {
		void store.getState().load();
		return () => store.getState().dispose();
	}, [ store ] );

	const status = useStore( store, ( s ) => s.status );
	const loadError = useStore( store, ( s ) => s.loadError );
	const locale = useStore( store, ( s ) => s.doc?.locales.default ?? 'en_US' );
	// A language removed meanwhile (or by undo) falls back to the default language.
	const lang = useStore( store, ( s ) => ( s.lang && s.doc?.locales.available.includes( s.lang ) ? s.lang : locale ) );
	const locked = useStore( store, ( s ) => 'locked' === s.save.state );

	// Funnelforms Free shows the figures per step on the canvas; Pro has the analytics mode instead.
	const [ figures, setFigures ] = useState<{ figures: StepFigures; label: string } | null>( null );
	// The edition is a constant of the build, so the order of the hooks stays the same.
	const analyticsState = 'free' === process.env.FUNNELFORMS_EDITION ? null : useAnalyticsState( api, formId, store );
	// The figures need the right to see entries, so the mode is off without it.
	const analytics = rights.entries ? analyticsState : null;
	const [ touring, setTouring ] = useState( false );
	const [ view, showView ] = useState<View>( first );
	const doc = useStore( store, ( s ) => s.doc );
	/**
	 * What happens after sending is edited at the contact step whose entries it handles; the
	 * former workspace of its own stays only for forms without a contact step.
	 */
	const setView = useCallback(
		( next: View ): void => {
			const contact = 'actions' === next ? store.getState().doc?.nodes.find( ( n ) => 'contact' === n.type ) : undefined;
			if ( contact ) {
				store.getState().select( { node: contact.id }, 'logic' );
				showView( 'build' );
				return;
			}
			showView( next );
		},
		[ store ]
	);
	useEffect( () => {
		if ( 'ready' === status && 'actions' === view ) {
			setView( 'actions' );
		}
	}, [ status, view, setView ] );
	useFoldedMenu();
	// From the statistics page: the figures on the steps, once the form is loaded.
	const setAnalyticsOn = analytics?.setOn;
	useEffect( () => {
		if ( ! withFigures || ! rights.entries || 'ready' !== status ) {
			return;
		}
		if ( setAnalyticsOn ) {
			setAnalyticsOn( true );
			return;
		}
		let cancelled = false;
		canvasFigures( api, formId ).then(
			( shown ) => {
				if ( ! cancelled ) {
					setFigures( shown );
				}
			},
			// Without figures the canvas simply shows the form.
			() => undefined
		);
		return () => {
			cancelled = true;
		};
	}, [ withFigures, rights.entries, status, setAnalyticsOn, api, formId ] );
	useEffect( () => {
		// Not over a workspace the address asked for, or the figures from the statistics page.
		if ( tour && 'ready' === status && ! tourSeen() && 'build' === first && ! withFigures ) {
			setTouring( true );
		}
	}, [ tour, status, first, withFigures ] );
	const env = useMemo<BuilderEnv>( () => ( { api, rights, store, ctx: { locale, labels: labelsFor?.( locale ) }, lang, readOnly: locked } ), [ api, rights, store, locale, lang, labelsFor, locked ] );

	// The tour shows the parts of the canvas workspace.
	const startTour = (): void => {
		setView( 'build' );
		setTouring( true );
	};

	if ( 'loading' === status ) {
		return <Spinner label={ __( 'Loading form…', 'funnelforms-pro' ) } />;
	}
	if ( 'failed' === status ) {
		return (
			<div className="ffxb-page">
				<Notice
					tone="danger"
					title={ __( 'The form could not be opened.', 'funnelforms-pro' ) }
					action={
						<>
							<Button onClick={ onBack }>{ __( 'Back to the forms', 'funnelforms-pro' ) }</Button>
							<Button variant="primary" onClick={ () => void store.getState().load() }>
								{ __( 'Try again', 'funnelforms-pro' ) }
							</Button>
						</>
					}
				>
					{ loadError }
				</Notice>
			</div>
		);
	}
	return (
		<BuilderContext.Provider value={ env }>
			<div className="ffxb-builder">
				<TopBar api={ api } formId={ formId } onBack={ onBack } view={ view } onView={ setView } onTour={ tour ? startTour : undefined } />
				<LockedBanner />
				{ figures && 'build' === view ? (
					<div className="ffxb-figures-bar" role="status">
						{ sprintf( __( 'The steps show the figures of %s: page views that reached them and left there.', 'funnelforms-pro' ), figures.label ) }
						<button type="button" className="ffxb-link" onClick={ () => setFigures( null ) }>
							{ __( 'Hide figures', 'funnelforms-pro' ) }
						</button>
					</div>
				) : null }
				<ViewContext.Provider value={ setView }>
					<AiWorkspaces api={ api } ai={ 'free' === process.env.FUNNELFORMS_EDITION ? null : ai } formId={ formId } show={ 'build' === view || 'design' === view || 'settings' === view }>
						{ 'build' === view ? (
							<AnalyticsContext.Provider value={ analytics }>
								<div className="ffxb-builder__body">
									<Palette />
									<FiguresContext.Provider value={ figures?.figures ?? null }>
										<Canvas />
									</FiguresContext.Provider>
									<Inspector />
								</div>
							</AnalyticsContext.Provider>
						) : null }
						{ 'design' === view ? <DesignWorkspace api={ api } formId={ formId } /> : null }
						{ 'settings' === view && doc ? <SettingsWorkspace doc={ doc } /> : null }
						{ 'actions' === view && doc ? <ActionsWorkspace doc={ doc } /> : null }
						{ 'embed' === view ? <EmbedWorkspace config={ embed } /> : null }
					</AiWorkspaces>
				</ViewContext.Provider>
				<Shortcuts analytics={ 'build' === view ? analytics : null } />
				<ChangeNotice />
				<LeaveGuard />
				{ touring ? <Tour onClose={ () => setTouring( false ) } /> : null }
			</div>
		</BuilderContext.Provider>
	);
}

function SaveState() {
	const save = useBuilder( ( s ) => s.save );
	const saveNow = useEnv().store.getState().saveNow;
	const texts: Record<typeof save.state, string> = {
		saved: __( 'All changes saved', 'funnelforms-pro' ),
		dirty: __( 'Unsaved changes', 'funnelforms-pro' ),
		saving: __( 'Saving…', 'funnelforms-pro' ),
		error: __( 'Not saved. Trying again…', 'funnelforms-pro' ),
		offline: __( 'Offline. Saving when you are back online.', 'funnelforms-pro' ),
		locked: __( 'Read only', 'funnelforms-pro' ),
	};
	return (
		<span className={ `ffxb-save ffxb-save--${ save.state }` } role="status" title={ save.error ?? undefined }>
			<span className="ffxb-save__dot" aria-hidden="true" />
			{ texts[ save.state ] }
			{ 'error' === save.state || 'offline' === save.state ? (
				<button type="button" className="ffxb-link" onClick={ () => void saveNow() }>
					{ __( 'Save now', 'funnelforms-pro' ) }
				</button>
			) : null }
		</span>
	);
}

/**
 * The workspaces in the top bar. The figures of a form are no workspace of the editor: they live
 * under Funnelforms → Statistics, in both editions.
 */
function Views( { view, onView }: { view: View; onView: ( view: View ) => void } ) {
	const views: Array<[ View, string ]> = [
		[ 'build', __( 'Structure', 'funnelforms-pro' ) ],
		[ 'design', __( 'Design', 'funnelforms-pro' ) ],
		[ 'settings', __( 'Settings', 'funnelforms-pro' ) ],
		[ 'embed', __( 'Embed', 'funnelforms-pro' ) ],
	];
	return (
		<nav className="ffxb-views" aria-label={ __( 'Workspaces', 'funnelforms-pro' ) }>
			{ views.map( ( [ id, label ] ) => (
				<button key={ id } type="button" className={ 'ffxb-views__item' + ( view === id ? ' is-active' : '' ) } aria-current={ view === id ? 'page' : undefined } data-view={ id } onClick={ () => onView( id ) }>
					{ label }
				</button>
			) ) }
		</nav>
	);
}

function TopBar( { api, formId, onBack, view, onView, onTour }: { api: FormsApi; formId: number; onBack: () => void; view: View; onView: ( view: View ) => void; onTour?: () => void } ) {
	const { store, readOnly } = useEnv();
	const form = useBuilder( ( s ) => s.form );
	const title = useBuilder( ( s ) => s.doc?.title ?? '' );
	const canUndo = useBuilder( ( s ) => s.canUndo );
	const canRedo = useBuilder( ( s ) => s.canRedo );
	const problems = useBuilder( ( s ) => problemTexts( s.problems ).length + s.missingRights.length );
	const { undo, redo } = store.getState();
	const [ publishing, setPublishing ] = useState( false );
	const [ revisions, setRevisions ] = useState( false );
	const [ previewing, setPreviewing ] = useState( false );
	return (
		<header className="ffxb-topbar">
			<div className="ffxb-topbar__start">
				<Button variant="ghost" icon={ icons.back } aria-label={ __( 'Forms', 'funnelforms-pro' ) } title={ __( 'Back to the forms', 'funnelforms-pro' ) } onClick={ onBack } />
				<div className="ffxb-topbar__title">
					<strong title={ title }>{ title }</strong>
					<span className="ffxb-topbar__meta">
						{ form ? <StatusBadge form={ form } /> : null }
						<SaveState />
					</span>
				</div>
			</div>
			<Views view={ view } onView={ onView } />
			<div className="ffxb-topbar__actions">
				<LanguagePicker />
				{ onTour ? <Button variant="ghost" icon={ <TourIcon /> } aria-label={ __( 'Tour through the builder', 'funnelforms-pro' ) } title={ __( 'Tour through the builder', 'funnelforms-pro' ) } onClick={ onTour } /> : null }
				<Button variant="ghost" icon={ icons.undo } aria-label={ __( 'Undo', 'funnelforms-pro' ) } title={ __( 'Undo (Ctrl+Z)', 'funnelforms-pro' ) } disabled={ ! canUndo || readOnly } onClick={ undo } />
				<Button variant="ghost" icon={ icons.redo } aria-label={ __( 'Redo', 'funnelforms-pro' ) } title={ __( 'Redo (Ctrl+Shift+Z)', 'funnelforms-pro' ) } disabled={ ! canRedo || readOnly } onClick={ redo } />
				<Button variant="ghost" icon={ icons.history } aria-label={ __( 'Versions', 'funnelforms-pro' ) } title={ __( 'Versions', 'funnelforms-pro' ) } onClick={ () => setRevisions( true ) } />
				<span className="ffxb-topbar__sep" aria-hidden="true" />
				<Button icon={ icons.eye } data-tour="preview" onClick={ () => setPreviewing( true ) }>
					{ __( 'Preview', 'funnelforms-pro' ) }
				</Button>
				<Button variant="primary" icon={ icons.check } data-tour="publish" disabled={ readOnly } onClick={ () => setPublishing( true ) }>
					{ __( 'Publish', 'funnelforms-pro' ) }
					{ problems > 0 ? <span className="ffxb-count">{ problems }</span> : null }
				</Button>
			</div>
			{ publishing ? (
				<PublishDialog
					onClose={ () => setPublishing( false ) }
					onEmbed={ () => {
						setPublishing( false );
						onView( 'embed' );
					} }
				/>
			) : null }
			{ previewing ? <DraftPreview api={ api } formId={ formId } onClose={ () => setPreviewing( false ) } /> : null }
			{ revisions ? <RevisionsDialog api={ api } formId={ formId } onClose={ () => setRevisions( false ) } /> : null }
		</header>
	);
}

/** The workspaces under the AI bar (Funnelforms Pro with the AI form builder); without it the workspaces alone. */
function AiWorkspaces( { api, ai, formId, show, children }: { api: FormsApi; ai?: AiConfig | null; formId: number; show: boolean; children: React.ReactNode } ) {
	if ( 'free' === process.env.FUNNELFORMS_EDITION || ! ai ) {
		return <>{ children }</>;
	}
	return (
		<AiBar api={ api } ai={ ai } formId={ formId } show={ show }>
			{ children }
		</AiBar>
	);
}

/** Folds the admin menu of WordPress while the editor is open, for room on the canvas. */
function useFoldedMenu(): void {
	useEffect( () => {
		const body = document.body;
		if ( body.classList.contains( 'folded' ) ) {
			return undefined;
		}
		body.classList.add( 'folded' );
		return () => body.classList.remove( 'folded' );
	}, [] );
}

function LockedBanner() {
	const { store } = useEnv();
	const save = useBuilder( ( s ) => s.save );
	const [ error, setError ] = useState<string | null>( null );
	if ( 'locked' !== save.state ) {
		return null;
	}
	const name = save.lockedBy?.name ?? __( 'Someone else', 'funnelforms-pro' );
	return (
		<div className="ffxb-banner">
			<Notice
				tone="warning"
				title={ sprintf( __( '%s is editing this form.', 'funnelforms-pro' ), name ) }
				action={
					<Button
						onClick={ () => {
							setError( null );
							store
								.getState()
								.takeOver()
								.catch( ( e: unknown ) => setError( e instanceof Error ? e.message : String( e ) ) );
						} }
					>
						{ __( 'Take over', 'funnelforms-pro' ) }
					</Button>
				}
			>
				{ __( 'You can look at it, but your changes are not saved. If you take over, changes the other person has not saved yet are lost.', 'funnelforms-pro' ) }
				{ error ? <p>{ error }</p> : null }
			</Notice>
		</div>
	);
}

function PublishDialog( { onClose, onEmbed }: { onClose: () => void; onEmbed: () => void } ) {
	const { store } = useEnv();
	const publishing = useBuilder( ( s ) => s.publishing );
	const problems = useBuilder( ( s ) => s.problems );
	const missingRights = useBuilder( ( s ) => s.missingRights );
	const form = useBuilder( ( s ) => s.form );
	const doc = useBuilder( ( s ) => s.doc );
	const delivery = useMemo( () => ( doc ? deliveryWarnings( doc ) : [] ), [ doc ] );
	const [ note, setNote ] = useState( '' );
	const busy = 'publishing' === publishing.state;
	const done = 'published' === publishing.state;
	const blocked = problems.length > 0 || missingRights.length > 0;

	useEffect( () => {
		// Show the state of the current draft, not of an earlier attempt.
		void store.getState().saveNow();
	}, [ store ] );

	return (
		<Dialog
			title={ done ? __( 'Published', 'funnelforms-pro' ) : __( 'Publish form', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				done ? (
					<>
						<Button variant="ghost" onClick={ onEmbed }>
							{ __( 'More ways to embed', 'funnelforms-pro' ) }
						</Button>
						<Button variant="primary" onClick={ onClose }>
							{ __( 'Done', 'funnelforms-pro' ) }
						</Button>
					</>
				) : (
					<>
						<Button variant="ghost" onClick={ onClose }>
							{ __( 'Cancel', 'funnelforms-pro' ) }
						</Button>
						<Button variant="primary" disabled={ busy || blocked } onClick={ () => void store.getState().publish( note ) }>
							{ busy ? __( 'Publishing…', 'funnelforms-pro' ) : __( 'Publish now', 'funnelforms-pro' ) }
						</Button>
					</>
				)
			}
		>
			{ done ? (
				<>
					<p>{ __( 'Visitors now see this version. Embed it with the shortcode, the block or the Elementor widget:', 'funnelforms-pro' ) }</p>
					{ form ? <code className="ffxb-code">{ form.shortcode }</code> : null }
					{ publishing.warnings.length ? (
						<Notice tone="warning" title={ __( 'Please check', 'funnelforms-pro' ) }>
							<ul>
								{ problemTexts( publishing.warnings ).map( ( w ) => (
									<li key={ w }>{ w }</li>
								) ) }
							</ul>
						</Notice>
					) : null }
				</>
			) : (
				<>
					{ problems.length ? (
						<Notice tone="danger" title={ __( 'Fix these first', 'funnelforms-pro' ) }>
							<ul>
								{ problemTexts( problems ).map( ( p ) => (
									<li key={ p }>{ p }</li>
								) ) }
							</ul>
						</Notice>
					) : null }
					{ missingRights.length ? (
						<Notice tone="warning" title={ __( 'Someone with more rights has to publish this', 'funnelforms-pro' ) }>
							<ul>
								{ missingRights.map( ( r ) => (
									<li key={ r }>{ rightName( r ) }</li>
								) ) }
							</ul>
						</Notice>
					) : null }
					{ delivery.length ? (
						<Notice tone="warning" title={ __( 'Please check', 'funnelforms-pro' ) }>
							<ul>
								{ delivery.includes( 'nobody' ) ? <li>{ __( 'Nobody is told about new entries. Add an "E-mail to you" under "After sending".', 'funnelforms-pro' ) }</li> : null }
								{ delivery.includes( 'recipient' ) ? <li>{ __( 'A mail has no recipient and is not sent. Add one under "After sending".', 'funnelforms-pro' ) }</li> : null }
							</ul>
						</Notice>
					) : null }
					{ 'failed' === publishing.state && publishing.error && ! blocked ? <Notice tone="danger">{ publishing.error }</Notice> : null }
					{ ! blocked ? <p>{ __( 'Visitors see the new version right away. The previous version stays in the version history.', 'funnelforms-pro' ) }</p> : null }
					<TextInput label={ __( 'What changed? (optional)', 'funnelforms-pro' ) } value={ note } onChange={ setNote } />
				</>
			) }
		</Dialog>
	);
}

function RevisionsDialog( { api, formId, onClose }: { api: FormsApi; formId: number; onClose: () => void } ) {
	const { store, readOnly } = useEnv();
	const form = useBuilder( ( s ) => s.form );
	const [ list, setList ] = useState<Revision[] | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ busy, setBusy ] = useState( false );

	useEffect( () => {
		api.revisions( formId ).then( setList, ( e: unknown ) => setError( e instanceof Error ? e.message : String( e ) ) );
	}, [ api, formId ] );

	const run = async ( work: () => Promise<void> ): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			await work();
			onClose();
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		} finally {
			setBusy( false );
		}
	};

	const restore = ( revision: Revision ): Promise<void> =>
		run( async () => {
			await store.getState().saveNow();
			const detail = await api.restore( formId, revision.id );
			if ( detail.document ) {
				store.getState().replace( detail.document, detail );
			}
		} );

	const discard = (): Promise<void> => run( async () => store.getState().reset( await api.dropDraft( formId ) ) );

	const date = ( value: string | null ): string => ( value ? new Date( value.replace( ' ', 'T' ) + ( /[zZ+]/.test( value ) ? '' : 'Z' ) ).toLocaleString() : '' );

	return (
		<Dialog title={ __( 'Versions', 'funnelforms-pro' ) } open onClose={ onClose } actions={ <Button onClick={ onClose }>{ __( 'Close', 'funnelforms-pro' ) }</Button> }>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ form?.hasDraft && null !== form.currentRevision ? (
				<Notice
					tone="info"
					title={ __( 'Unpublished changes', 'funnelforms-pro' ) }
					action={
						<Button size="sm" variant="danger" disabled={ busy || readOnly } onClick={ () => void discard() }>
							{ __( 'Discard changes', 'funnelforms-pro' ) }
						</Button>
					}
				>
					{ __( 'Back to the published version. This cannot be undone.', 'funnelforms-pro' ) }
				</Notice>
			) : null }
			{ null === list && ! error ? <Spinner label={ __( 'Loading versions…', 'funnelforms-pro' ) } /> : null }
			{ list && 0 === list.length ? <p>{ __( 'Nothing published yet. Each time you publish, a version is kept here.', 'funnelforms-pro' ) }</p> : null }
			{ list && list.length > 0 ? (
				<ol className="ffxb-revisions">
					{ list.map( ( r ) => (
						<li key={ r.id } className="ffxb-revisions__row">
							<div>
								<strong>{ date( r.createdAt ) }</strong>
								{ r.current ? <span className="ffxb-badge ffxb-badge--success">{ __( 'Live', 'funnelforms-pro' ) }</span> : null }
								<div className="ffxb-revisions__meta">
									{ r.author ? r.author.name : '' }
									{ r.note && 'migration' !== r.note ? ' · ' + r.note : '' }
									{ 'migration' === r.note ? ' · ' + __( 'Imported from Funnelforms 3', 'funnelforms-pro' ) : '' }
								</div>
							</div>
							<Button size="sm" disabled={ busy || readOnly } onClick={ () => void restore( r ) }>
								{ __( 'Load as draft', 'funnelforms-pro' ) }
							</Button>
						</li>
					) ) }
				</ol>
			) : null }
		</Dialog>
	);
}

/** Where Ctrl+C keeps a step or field, so it can be pasted in this form or another one. */
const CLIPBOARD = 'ffxb-clipboard';

/** The selected node, or the selected field of it, as a clip. */
function clipOf( doc: FormDocument | null, nodeId: string, fieldId?: string ): Clip | null {
	const node = doc?.nodes.find( ( n ) => n.id === nodeId );
	if ( ! node ) {
		return null;
	}
	if ( ! fieldId ) {
		return { kind: 'node', node };
	}
	const field = 'end' === node.type ? undefined : ( node.fields as Array<Field | ContactField> ).find( ( f ) => f.id === fieldId );
	return field ? { kind: 'field', field, contact: 'contact' === node.type } : null;
}

function writeClip( clip: Clip ): boolean {
	try {
		window.localStorage.setItem( CLIPBOARD, JSON.stringify( { v: 1, ...clip } ) );
		return true;
	} catch {
		return false;
	}
}

function readClip(): Clip | null {
	try {
		const value: unknown = JSON.parse( window.localStorage.getItem( CLIPBOARD ) ?? 'null' );
		return isClip( value ) ? value : null;
	} catch {
		return null;
	}
}

/** Pastes a clip after the selection and selects the copy; tells why when it does not fit there. */
function paste( state: ReturnType<BuilderStore[ 'getState' ]>, clip: Clip ): void {
	const { node, field } = state.selection;
	if ( 'node' === clip.kind ) {
		let id = '';
		state.change( ( d ) => {
			id = pasteNode( d, clip.node, node );
		} );
		state.select( { node: id } );
		state.notify( __( 'Step pasted.', 'funnelforms-pro' ) );
		return;
	}
	const target = node ? state.doc?.nodes.find( ( n ) => n.id === node ) : undefined;
	if ( ! target || target.type !== ( clip.contact ? 'contact' : 'step' ) ) {
		state.notify( clip.contact ? __( 'Select a contact step to paste this field into.', 'funnelforms-pro' ) : __( 'Select a step to paste this field into.', 'funnelforms-pro' ), false );
		return;
	}
	let id: string | null = null;
	state.change( ( d ) => {
		id = pasteField( d, target.id, clip.field, clip.contact, field );
	} );
	if ( id ) {
		state.select( { node: target.id, field: id } );
		state.notify( __( 'Field pasted.', 'funnelforms-pro' ) );
	}
}

/** Keyboard shortcuts while no input has the focus (undo and save also inside inputs). */
function Shortcuts( { analytics }: { analytics: Analytics | null } ) {
	const { store, readOnly, rights } = useEnv();
	const [ help, setHelp ] = useState( false );
	useEffect( () => {
		const open = (): void => setHelp( true );
		window.addEventListener( SHORTCUTS_EVENT, open );
		return () => window.removeEventListener( SHORTCUTS_EVENT, open );
	}, [] );
	useEffect( () => {
		const onKey = ( event: KeyboardEvent ): void => {
			const state = store.getState();
			const mod = event.ctrlKey || event.metaKey;
			const target = event.target as HTMLElement | null;
			const typing = !! target && ( /^(INPUT|TEXTAREA|SELECT)$/.test( target.tagName ) || target.isContentEditable );
			const key = event.key.toLowerCase();
			if ( mod && 's' === key ) {
				event.preventDefault();
				void state.saveNow();
				return;
			}
			if ( typing ) {
				return;
			}
			if ( '?' === event.key && ! mod ) {
				event.preventDefault();
				setHelp( true );
				return;
			}
			if ( 'a' === key && ! mod && ! event.altKey && analytics ) {
				event.preventDefault();
				analytics.setOn( ! analytics.on );
				return;
			}
			const { node: selected } = state.selection;
			if ( 'l' === key && ! mod && ! event.altKey && selected && 'end' !== state.doc?.nodes.find( ( n ) => n.id === selected )?.type ) {
				event.preventDefault();
				state.select( { node: selected }, 'logic' === state.panel && ! state.selection.field ? 'content' : 'logic' );
				return;
			}
			if ( mod && 'c' === key && selected && ! event.altKey && ! window.getSelection()?.toString() ) {
				const clip = clipOf( state.doc, selected, state.selection.field );
				if ( clip && writeClip( clip ) ) {
					event.preventDefault();
					state.notify( 'node' === clip.kind ? __( 'Step copied. Paste it into this form or another one.', 'funnelforms-pro' ) : __( 'Field copied. Paste it into this form or another one.', 'funnelforms-pro' ), false );
				}
				return;
			}
			if ( readOnly ) {
				return;
			}
			if ( mod && 'v' === key && ! event.altKey ) {
				const clip = readClip();
				if ( ! clip ) {
					return;
				}
				event.preventDefault();
				paste( state, clip );
				return;
			}
			if ( mod && 'z' === key ) {
				event.preventDefault();
				if ( event.shiftKey ) {
					state.redo();
				} else {
					state.undo();
				}
				return;
			}
			if ( mod && 'y' === key ) {
				event.preventDefault();
				state.redo();
				return;
			}
			const { node, field, edge } = state.selection;
			if ( mod && 'd' === key && node ) {
				event.preventDefault();
				let id: string | null = null;
				state.change( ( d ) => {
					id = field ? duplicateField( d, node, field ) : duplicateNode( d, node );
				} );
				if ( id ) {
					state.select( field ? { node, field: id } : { node: id } );
				}
				return;
			}
			if ( 'delete' === key || 'backspace' === key ) {
				if ( edge ) {
					state.change( ( d ) => removeEdge( d, edge ) );
					state.select( {} );
				} else if ( node && field ) {
					removeWithNotice( store, ( d ) => void removeField( d, node, field ), asksFor( field ) );
					state.select( { node } );
				} else if ( node && ( state.doc?.nodes.length ?? 0 ) > 1 ) {
					removeWithNotice( store, ( d ) => removeNode( d, node ), fieldsOf( state.doc, node ) );
					state.select( {} );
				} else {
					return;
				}
				event.preventDefault();
				return;
			}
			if ( 'escape' === key ) {
				state.select( {} );
			}
		};
		window.addEventListener( 'keydown', onKey );
		return () => window.removeEventListener( 'keydown', onKey );
	}, [ store, readOnly, analytics ] );
	if ( ! help ) {
		return null;
	}
	const mod = /Mac|iPhone|iPad/.test( globalThis.navigator?.platform ?? '' ) ? '⌘' : 'Ctrl';
	const keys: Array<[ string[], string ]> = [
		[ [ mod, 'Z' ], __( 'Undo', 'funnelforms-pro' ) ],
		[ [ mod, 'Shift', 'Z' ], __( 'Redo', 'funnelforms-pro' ) ],
		[ [ mod, 'S' ], __( 'Save now', 'funnelforms-pro' ) ],
		[ [ mod, 'D' ], __( 'Duplicate the selected step or field', 'funnelforms-pro' ) ],
		[ [ mod, 'C' ], __( 'Copy the selected step or field', 'funnelforms-pro' ) ],
		[ [ mod, 'V' ], __( 'Paste it after the selected step or field, also in another form', 'funnelforms-pro' ) ],
		[ [ __( 'Delete', 'funnelforms-pro' ) ], __( 'Delete the selected step, field or path', 'funnelforms-pro' ) ],
		[ [ 'L' ], __( 'Switch between the content and the logic of the selected step', 'funnelforms-pro' ) ],
		...( 'free' === process.env.FUNNELFORMS_EDITION || ! rights.entries ? [] : [ [ [ 'A' ], __( 'Turn the analytics on the canvas on or off', 'funnelforms-pro' ) ] as [ string[], string ] ] ),
		[ [ 'Esc' ], __( 'Deselect', 'funnelforms-pro' ) ],
		[ [ '?' ], __( 'Show these shortcuts', 'funnelforms-pro' ) ],
	];
	return (
		<Dialog title={ __( 'Keyboard shortcuts', 'funnelforms-pro' ) } open onClose={ () => setHelp( false ) } actions={ <Button onClick={ () => setHelp( false ) }>{ __( 'Close', 'funnelforms-pro' ) }</Button> }>
			<dl className="ffxb-shortcuts">
				{ keys.map( ( [ combo, what ] ) => (
					<div key={ what } className="ffxb-shortcuts__row">
						<dt>
							{ combo.map( ( k, i ) => (
								<React.Fragment key={ k }>
									{ i ? ' + ' : null }
									<kbd>{ k }</kbd>
								</React.Fragment>
							) ) }
						</dt>
						<dd>{ what }</dd>
					</div>
				) ) }
			</dl>
		</Dialog>
	);
}

/** Asks before leaving the page while changes are not saved. */
function LeaveGuard() {
	const state = useBuilder( ( s ) => s.save.state );
	useEffect( () => {
		if ( 'saved' === state || 'locked' === state ) {
			return undefined;
		}
		const warn = ( event: BeforeUnloadEvent ): void => {
			event.preventDefault();
			// Older browsers show the dialog only with a return value.
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ state ] );
	return null;
}
