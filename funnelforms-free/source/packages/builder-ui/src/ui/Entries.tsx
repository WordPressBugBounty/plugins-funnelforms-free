/**
 * The entries screen (Funnelforms → Entries): the lead list of 5.0 in the frame of the other
 * admin pages, with key figures that filter it, a compact filter bar, the list as a table or a
 * board by lead status, changes to many entries at once and one entry in a side panel.
 * Filters, the view and the open entry live in the address, so links and the back button work.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment, BulkChanges, EntryDevice, EntriesApi, EntryDetail, EntryFigures, EntryFilter, EntryList, EntrySummary, EntryVisit, LeadStage, LeadStageTone, LeadStatus, PaymentStatus, SpamReason, UserRef } from '../api';
import { addressOf, avatarTone, byLeadStatus, change, DEVICES, entryEmail, entryName, entryPhone, exportLink, figureMoments, filtered, initials, MAX_STAGE_NAME, MAX_STAGES, moveStage, parseTags, periodStart, relativeTime, STAGE_TONES, stageInputs, stageNameProblem, standardStages, stateFromAddress, valueText, type EntriesState, type Period } from '../entries';
import { pageLocale, zoneName } from '../appointments';
import { kindName } from './Actions';
import { EmptyState, Frame, FrameButton, Icon, Kpi, Pill, type PillTone } from './Frame';
import { __, sprintf } from './i18n';
import { Badge, Button, Dialog, icons, Notice, Spinner } from './ui';

export interface EntriesConfig {
	forms?: Array<{ id: number; title: string }>;
	/** Export link without filters; missing without the right to export. */
	exportUrl?: string | null;
	builderUrl?: string | null;
	user?: { id: number; admin: boolean };
	userLocale?: string;
	/** The lead stages of the site, the columns of the board (Funnelforms Pro). */
	stages?: LeadStage[] | null;
	/** Whether the user may rename, add, order and delete the stages. */
	editStages?: boolean;
}

const PER_PAGE = 25;
const BOARD_SIZE = 100;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand';

/** The site's lead stages, for every part of the screen that names or lists them. */
const StagesContext = createContext<LeadStage[]>( [] );

/** Name of a lead stage: the site's own, else the standard name of the stages of 5.0, else its key. */
export function leadStatusName( status: LeadStatus, stages: readonly LeadStage[] = [] ): string {
	const own = stages.find( ( s ) => s.key === status );
	if ( own ) {
		return own.name;
	}
	const standard: Record<string, string> = {
		new: __( 'New', 'funnelforms-pro' ),
		contacted: __( 'Contacted', 'funnelforms-pro' ),
		won: __( 'Won', 'funnelforms-pro' ),
		lost: __( 'Lost', 'funnelforms-pro' ),
	};
	return standard[ status ] ?? status;
}

/** Names of the colours a stage can have, as the stage dialog offers them. */
function toneName( tone: LeadStageTone ): string {
	return {
		info: __( 'Purple', 'funnelforms-pro' ),
		warning: __( 'Amber', 'funnelforms-pro' ),
		success: __( 'Green', 'funnelforms-pro' ),
		neutral: __( 'Grey', 'funnelforms-pro' ),
		danger: __( 'Red', 'funnelforms-pro' ),
	}[ tone ];
}

/** Colour of a lead stage, the same in the table, on the board and in the panel. */
function stageTone( status: LeadStatus, stages: readonly LeadStage[] ): PillTone {
	return stages.find( ( s ) => s.key === status )?.tone ?? 'neutral';
}

/** Why an entry is in the spam folder, as the panel says it. */
export function spamReasonName( reason: SpamReason ): string {
	return (
		{
			honeypot: __( 'A hidden field was filled in, as bots do', 'funnelforms-pro' ),
			too_fast: __( 'Sent faster than the shortest time to fill in', 'funnelforms-pro' ),
			captcha_score: __( 'Low score of reCAPTCHA v3', 'funnelforms-pro' ),
			akismet: __( 'Akismet rates it as spam', 'funnelforms-pro' ),
			rule_words: __( 'Contains a word of the blocklist', 'funnelforms-pro' ),
			rule_email: __( 'E-mail address or domain of the blocklist', 'funnelforms-pro' ),
			rule_ip: __( 'IP address of the blocklist', 'funnelforms-pro' ),
			rule_disposable: __( 'Throwaway e-mail address', 'funnelforms-pro' ),
		}[ reason ] ?? reason
	);
}

function paymentName( status: PaymentStatus ): string {
	return {
		open: __( 'Not paid yet', 'funnelforms-pro' ),
		pending: __( 'Payment pending', 'funnelforms-pro' ),
		paid: __( 'Paid', 'funnelforms-pro' ),
		failed: __( 'Payment failed', 'funnelforms-pro' ),
		canceled: __( 'Payment canceled', 'funnelforms-pro' ),
		refunded: __( 'Refunded', 'funnelforms-pro' ),
		disputed: __( 'Payment disputed', 'funnelforms-pro' ),
	}[ status ];
}

const PAYMENT_TONE: Record<PaymentStatus, Tone> = { open: 'neutral', pending: 'warning', paid: 'success', failed: 'danger', canceled: 'neutral', refunded: 'neutral', disputed: 'danger' };

function actionName( kind: string ): string {
	return 'optin' === kind ? __( 'Confirmation link (double opt-in)', 'funnelforms-pro' ) : kindName( kind );
}

/** Date and time of an appointment in the time zone of its type, in the editor's language. */
export function appointmentTime( a: Pick<Appointment, 'start' | 'timezone'> ): string {
	try {
		return new Date( a.start ).toLocaleString( undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: a.timezone || undefined } );
	} catch {
		return new Date( a.start ).toLocaleString();
	}
}

/** Name of a delivery the plugin queued itself (appointment mails); the job's name otherwise. */
export function deliveryName( action: string ): string {
	if ( action.startsWith( ':booking-cancel:' ) ) {
		return __( 'Appointment cancellation', 'funnelforms-pro' );
	}
	if ( action.startsWith( ':booking:' ) ) {
		// ":booking:<appointment>:<version>": a version above 0 is the mail about a moved appointment.
		return Number( action.split( ':' )[ 3 ] ) > 0 ? __( 'Appointment moved', 'funnelforms-pro' ) : __( 'Appointment invitation', 'funnelforms-pro' );
	}
	if ( action.startsWith( ':reminder:' ) ) {
		return __( 'Appointment reminder', 'funnelforms-pro' );
	}
	if ( action.startsWith( ':calendar:' ) ) {
		return __( 'Calendar entry', 'funnelforms-pro' );
	}
	if ( ':abandon:1' === action ) {
		return __( 'Reminder to the visitor', 'funnelforms-pro' );
	}
	if ( ':abandon:2' === action ) {
		return __( 'Second reminder to the visitor', 'funnelforms-pro' );
	}
	if ( ':abandon:owner' === action ) {
		return __( 'Note about the abandoned lead', 'funnelforms-pro' );
	}
	return action;
}

/** Badge of a visitor who left after typing the address, or of the entry such a visitor sent later. */
export function abandonBadge( entry: Pick<EntrySummary, 'status' | 'abandon'> ) {
	const state = entry.abandon?.state;
	if ( 'abandoned' === entry.status ) {
		const label = 'sent' === state ? __( 'Abandoned, reminded', 'funnelforms-pro' ) : 'stopped' === state ? __( 'Abandoned, no reminders', 'funnelforms-pro' ) : __( 'Abandoned', 'funnelforms-pro' );
		return <Badge tone="warning">{ label }</Badge>;
	}
	return 'recovered' === state ? <Badge tone="success">{ __( 'Recovered by the reminder', 'funnelforms-pro' ) }</Badge> : null;
}

function deliveryBadge( status: string ) {
	switch ( status ) {
		case 'sent':
			return <Badge tone="success">{ __( 'Sent', 'funnelforms-pro' ) }</Badge>;
		case 'failed':
			return <Badge tone="danger">{ __( 'Failed', 'funnelforms-pro' ) }</Badge>;
		case 'skipped':
			return <Badge>{ __( 'Skipped', 'funnelforms-pro' ) }</Badge>;
		case 'queued':
			return <Badge tone="warning">{ __( 'Waiting', 'funnelforms-pro' ) }</Badge>;
		default:
			return <Badge>{ status }</Badge>;
	}
}

/** Dates in the editor's language: in full, and as people say it ("5 min. ago"). */
interface Dates {
	( iso: string | null ): string;
	ago: ( iso: string | null ) => string;
}

function useDates( locale?: string ): Dates {
	return useMemo( () => {
		const tag = ( locale ?? '' ).replace( '_', '-' ) || undefined;
		let format: Intl.DateTimeFormat;
		try {
			format = new Intl.DateTimeFormat( tag, { dateStyle: 'medium', timeStyle: 'short' } );
		} catch {
			format = new Intl.DateTimeFormat( undefined, { dateStyle: 'medium', timeStyle: 'short' } );
		}
		const full = ( iso: string | null ): string => ( iso ? format.format( new Date( iso ) ) : '' );
		return Object.assign( full, { ago: ( iso: string | null ): string => relativeTime( iso, new Date(), locale ) } );
	}, [ locale ] );
}

function message( e: unknown ): string {
	return e instanceof Error ? e.message : String( e );
}

/** Name of an entry for lists, with a fallback that is never empty. */
function title( entry: EntrySummary ): string {
	return entryName( entry ) || sprintf( __( 'Entry #%d', 'funnelforms-pro' ), entry.id );
}

/** A number in the editor's language (1,234). */
function num( n: number ): string {
	return n.toLocaleString();
}

/** The round mark of a person: initials in one of six colours, or a figure without a name. */
function Avatar( { name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' } ) {
	const letters = initials( name );
	return (
		<span className={ `ffxb-avatar ffxb-avatar--${ size }` + ( letters ? ` ffxb-avatar--t${ avatarTone( name ) }` : '' ) } aria-hidden="true">
			{ letters || <Icon name="user" /> }
		</span>
	);
}

/** When an entry came in, as people say it, with date and time on hover. */
function When( { iso, date }: { iso: string | null; date: Dates } ) {
	return iso ? (
		<time className="ffxb-when" dateTime={ iso } title={ date( iso ) }>
			{ date.ago( iso ) }
		</time>
	) : null;
}

/** The lead value of an entry (estimated order value, Pro) as a badge; nothing without one. */
function ValueBadge( { entry }: { entry: EntrySummary } ) {
	if ( 'free' === process.env.FUNNELFORMS_EDITION || null === entry.value || undefined === entry.value ) {
		return null;
	}
	return <Badge tone="success">{ sprintf( /* translators: %s: estimated order value of a lead, e.g. 1,250 */ __( 'Value %s', 'funnelforms-pro' ), entry.value.toLocaleString( undefined, { maximumFractionDigits: 2 } ) ) }</Badge>;
}

function LeadPill( { status }: { status: LeadStatus } ) {
	const stages = useContext( StagesContext );
	return <Pill tone={ stageTone( status, stages ) }>{ leadStatusName( status, stages ) }</Pill>;
}

/** What "Show" filters: unread, sent or incomplete entries. */
function showValue( filter: EntryFilter ): string {
	return filter.status && 'spam' !== filter.status ? filter.status : false === filter.read ? 'unread' : '';
}

/** The state of the address; Funnelforms Free has no lead status, tags, assignment or board, whatever the address says. */
function fromAddress( search: string, stages: readonly LeadStage[] ): EntriesState {
	const next = stateFromAddress( search, stages.map( ( s ) => s.key ) );
	if ( 'free' !== process.env.FUNNELFORMS_EDITION ) {
		return next;
	}
	const filter: EntryFilter = { ...next.filter };
	for ( const key of [ 'leadStatus', 'tag', 'assignedTo' ] as const ) {
		Reflect.deleteProperty( filter, key );
	}
	return { ...next, filter, view: 'list' };
}

export function EntriesScreen( { api, config = {} }: { api: EntriesApi; config?: EntriesConfig } ) {
	const [ stages, setStages ] = useState<LeadStage[]>( () => ( config.stages?.length ? config.stages : standardStages( ( key ) => leadStatusName( key ) ) ) );
	const [ state, setState ] = useState<EntriesState>( () => fromAddress( window.location.search, stages ) );
	// The stage being edited on the board, or ADD_STAGE while one is added.
	const [ stageEdit, setStageEdit ] = useState<LeadStatus | null>( null );
	const [ data, setData ] = useState<EntryList | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ notice, setNotice ] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>( null );
	const [ selected, setSelected ] = useState<number[]>( [] );
	const [ busy, setBusy ] = useState( false );
	const [ tags, setTags ] = useState<Array<{ tag: string; entries: number }>>( [] );
	const [ assignees, setAssignees ] = useState<UserRef[]>( [] );
	const [ search, setSearch ] = useState( state.filter.search ?? '' );
	const [ figures, setFigures ] = useState<EntryFigures | null>( null );
	const [ more, setMore ] = useState( false );
	const date = useDates( config.userLocale );

	// The address follows the state; the back button brings an earlier state back.
	const go = useCallback( ( next: EntriesState, replace = false ): void => {
		const url = addressOf( next, window.location.href );
		if ( url !== window.location.href ) {
			window.history[ replace ? 'replaceState' : 'pushState' ]( null, '', url );
		}
		setState( next );
	}, [] );
	useEffect( () => {
		const onPop = (): void => setState( fromAddress( window.location.search, stages ) );
		window.addEventListener( 'popstate', onPop );
		return () => window.removeEventListener( 'popstate', onPop );
	}, [ stages ] );

	const setFilter = ( changes: Partial<EntryFilter>, period: Period = state.period, view = state.view ): void => {
		const filter: EntryFilter = { ...state.filter, ...changes, page: undefined };
		for ( const key of Object.keys( changes ) as Array<keyof EntryFilter> ) {
			if ( undefined === changes[ key ] || '' === changes[ key ] ) {
				Reflect.deleteProperty( filter, key );
			}
		}
		setSelected( [] );
		go( { ...state, filter, period, view } );
	};

	const query = useMemo( (): EntryFilter => {
		const board = 'board' === state.view && 'spam' !== state.filter.status;
		const { leadStatus, ...rest } = state.filter;
		return {
			...( board ? rest : { ...rest, leadStatus } ),
			after: periodStart( state.period ),
			page: board ? 1 : state.filter.page ?? 1,
			perPage: board ? BOARD_SIZE : PER_PAGE,
		};
	}, [ state.filter, state.period, state.view ] );

	// The key figures count the open entries of the chosen form.
	const figuresForm = state.filter.form;
	const loadFigures = useCallback( async (): Promise<void> => {
		if ( ! api.entryFigures ) {
			return;
		}
		try {
			setFigures( await api.entryFigures( { form: figuresForm, ...figureMoments() } ) );
		} catch {
			// The list works without them.
		}
	}, [ api, figuresForm ] );
	useEffect( () => {
		void loadFigures();
	}, [ loadFigures ] );

	const reload = useCallback( async (): Promise<void> => {
		setError( null );
		try {
			setData( await api.entries( query ) );
		} catch ( e ) {
			setError( message( e ) );
		}
	}, [ api, query ] );

	useEffect( () => {
		void reload();
	}, [ reload ] );

	const loadLists = useCallback( async (): Promise<void> => {
		if ( 'free' === process.env.FUNNELFORMS_EDITION ) {
			// Tags and assignment are part of Funnelforms Pro.
			return;
		}
		try {
			const [ t, a ] = await Promise.all( [ api.entryTags(), api.assignees() ] );
			setTags( t );
			setAssignees( a );
		} catch {
			// The filters work without them.
		}
	}, [ api ] );
	useEffect( () => {
		void loadLists();
	}, [ loadLists ] );

	// Typing searches after a short pause.
	useEffect( () => {
		if ( search === ( state.filter.search ?? '' ) ) {
			return undefined;
		}
		const timer = setTimeout( () => setFilter( { search: search.trim() || undefined } ), 300 );
		return () => clearTimeout( timer );
	}, [ search ] );

	const act = async ( work: () => Promise<unknown>, done?: string ): Promise<boolean> => {
		setBusy( true );
		try {
			await work();
			if ( done ) {
				setNotice( { tone: 'success', text: done } );
			}
			await reload();
			void loadFigures();
			return true;
		} catch ( e ) {
			setNotice( { tone: 'danger', text: message( e ) } );
			return false;
		} finally {
			setBusy( false );
		}
	};

	const bulk = async ( changes: BulkChanges, done: string ): Promise<void> => {
		const ok = await act( () => api.bulkEntries( selected, changes ), done );
		if ( ok ) {
			setSelected( [] );
			if ( changes.addTags || changes.removeTags ) {
				void loadLists();
			}
		}
	};

	const open = ( id: number | null ): void => go( { ...state, entry: id } );

	// The board's columns: saved at once for everyone, entries of a deleted stage move along.
	const canEditStages = !! config.editStages && !! api.saveLeadStages;
	// Answers the problem in words, or null when the stages are saved.
	const saveStages = async ( next: LeadStage[], done: string, moveTo?: Record<string, LeadStatus> ): Promise<string | null> => {
		const save = api.saveLeadStages;
		if ( ! save ) {
			return null;
		}
		setBusy( true );
		try {
			setStages( await save.call( api, stageInputs( next ), moveTo ) );
			setNotice( { tone: 'success', text: done } );
			if ( moveTo && state.filter.leadStatus && moveTo[ state.filter.leadStatus ] ) {
				// The filtered stage is gone.
				setFilter( { leadStatus: undefined } );
			} else {
				await reload();
			}
			void loadFigures();
			return null;
		} catch ( e ) {
			return message( e );
		} finally {
			setBusy( false );
		}
	};
	const moveColumn = ( key: LeadStatus, to: number ): void => {
		const from = stages.findIndex( ( s ) => s.key === key );
		if ( from >= 0 && from !== to ) {
			void saveStages( moveStage( stages, from, to - from ), sprintf( /* translators: %s: name of a lead stage */ __( '“%s” moved.', 'funnelforms-pro' ), stages[ from ]?.name ?? '' ) ).then( ( problem ) => problem && setNotice( { tone: 'danger', text: problem } ) );
		}
	};

	const entries = data?.entries ?? [];
	const spam = 'spam' === state.filter.status;
	const archive = true === state.filter.archived && ! spam;
	const forms = config.forms ?? [];
	// The spam folder is a list; lead statuses mean nothing there.
	const board = 'board' === state.view && ! spam;
	const page = state.filter.page ?? 1;
	const clear = (): void => {
		setSearch( '' );
		setSelected( [] );
		go( { ...state, filter: archive ? { archived: true } : spam ? { status: 'spam' } : {}, period: '' } );
	};

	// Filters behind "Filters", shown as chips while they apply.
	const assigneeName = ( id: number ): string => ( 0 === id ? __( 'Nobody', 'funnelforms-pro' ) : id === config.user?.id ? __( 'Me', 'funnelforms-pro' ) : assignees.find( ( a ) => a.id === id )?.name ?? sprintf( __( 'User #%d', 'funnelforms-pro' ), id ) );
	const showOptions = [
		{ value: '', label: __( 'All entries', 'funnelforms-pro' ) },
		{ value: 'unread', label: __( 'Unread', 'funnelforms-pro' ) },
		{ value: 'complete', label: __( 'Sent', 'funnelforms-pro' ) },
		{ value: 'partial', label: __( 'Incomplete', 'funnelforms-pro' ) },
		...( 'free' !== process.env.FUNNELFORMS_EDITION ? [ { value: 'abandoned', label: __( 'Abandoned', 'funnelforms-pro' ) } ] : [] ),
	];
	const chips: Array<{ key: string; label: string; remove: () => void }> = [];
	if ( undefined !== state.filter.assignedTo ) {
		chips.push( { key: 'assignedTo', label: sprintf( __( 'Assigned to: %s', 'funnelforms-pro' ), assigneeName( state.filter.assignedTo ) ), remove: () => setFilter( { assignedTo: undefined } ) } );
	}
	if ( state.filter.tag ) {
		chips.push( { key: 'tag', label: sprintf( __( 'Tag: %s', 'funnelforms-pro' ), state.filter.tag ), remove: () => setFilter( { tag: undefined } ) } );
	}
	if ( state.filter.device ) {
		chips.push( { key: 'device', label: sprintf( __( 'Device: %s', 'funnelforms-pro' ), deviceName( state.filter.device ) ), remove: () => setFilter( { device: undefined } ) } );
	}
	if ( '' !== showValue( state.filter ) ) {
		chips.push( { key: 'show', label: showOptions.find( ( o ) => o.value === showValue( state.filter ) )?.label ?? '', remove: () => setFilter( { read: undefined, status: undefined } ) } );
	}

	const week = figures && null !== figures.week ? change( figures.week, figures.previous ) : null;
	const toggleKpi = ( pressed: boolean, changes: Partial<EntryFilter>, period: Period, view = state.view ): void => {
		setFilter( pressed ? Object.fromEntries( Object.keys( changes ).map( ( k ) => [ k, undefined ] ) ) : { ...changes, archived: undefined }, period, view );
	};

	const frame = (
		<Frame
			title={ __( 'Entries', 'funnelforms-pro' ) }
			lead={ 'free' === process.env.FUNNELFORMS_EDITION ? __( 'Every entry of your forms in one place.', 'funnelforms-pro' ) : __( 'Every entry of your forms in one place, as a table or as a board by lead status.', 'funnelforms-pro' ) }
			actions={
				<>
					{ 'free' === process.env.FUNNELFORMS_EDITION ? null : (
						<div className="ffx-segment" role="group" aria-label={ __( 'View', 'funnelforms-pro' ) }>
							<button type="button" aria-pressed={ ! board } onClick={ () => go( { ...state, view: 'list' } ) }>
								<Icon name="table" />
								{ __( 'Table', 'funnelforms-pro' ) }
							</button>
							<button type="button" aria-pressed={ board } onClick={ () => go( { ...state, view: 'board' } ) }>
								<Icon name="board" />
								{ __( 'Board', 'funnelforms-pro' ) }
							</button>
						</div>
					) }
					{ config.exportUrl ? <ExportMenu base={ config.exportUrl } filter={ state.filter } /> : null }
				</>
			}
		>
			{ notice ? (
				<Notice tone={ notice.tone } action={ <Button variant="ghost" size="sm" aria-label={ __( 'Close', 'funnelforms-pro' ) } icon={ icons.close } onClick={ () => setNotice( null ) } /> }>
					{ notice.text }
				</Notice>
			) : null }

			{ api.entryFigures ? (
				<section className="ffx-grid ffxb-kpis" aria-label={ __( 'Key figures', 'funnelforms-pro' ) }>
					<Kpi
						icon="inbox"
						label={ __( 'New today', 'funnelforms-pro' ) }
						value={ figures && null !== figures.today ? num( figures.today ) : null }
						hint={ __( 'Since midnight', 'funnelforms-pro' ) }
						pressed={ 'today' === state.period && ! archive }
						onClick={ () => toggleKpi( 'today' === state.period && ! archive, {}, 'today' === state.period ? '' : 'today' ) }
					/>
					<Kpi
						icon="unread"
						label={ __( 'Unread', 'funnelforms-pro' ) }
						value={ figures ? num( figures.unread ) : null }
						hint={ __( 'Not opened yet', 'funnelforms-pro' ) }
						pressed={ false === state.filter.read && ! archive }
						onClick={ () => toggleKpi( false === state.filter.read && ! archive, { read: false, status: undefined }, state.period ) }
					/>
					<Kpi
						icon="trend"
						label={ __( 'Last 7 days', 'funnelforms-pro' ) }
						value={ figures && null !== figures.week ? num( figures.week ) : null }
						hint={ null === week ? __( 'None the 7 days before', 'funnelforms-pro' ) : sprintf( __( '%s against the 7 days before', 'funnelforms-pro' ), ( week > 0 ? '+' : '' ) + num( week ) + ' %' ) }
						tone={ null === week || 0 === week ? '' : week > 0 ? 'up' : 'down' }
						pressed={ '7d' === state.period && ! archive }
						onClick={ () => toggleKpi( '7d' === state.period && ! archive, {}, '7d' === state.period ? '' : '7d' ) }
					/>
					{ 'free' === process.env.FUNNELFORMS_EDITION || ! stages.some( ( s ) => 'won' === s.key ) ? null : (
						<Kpi
							icon="trophy"
							label={ leadStatusName( 'won', stages ) }
							value={ figures ? num( figures.leads.won ?? 0 ) : null }
							hint={ figures && figures.total > 0 ? sprintf( __( '%s of the open entries', 'funnelforms-pro' ), ( Math.round( ( 1000 * ( figures.leads.won ?? 0 ) ) / figures.total ) / 10 ).toLocaleString() + ' %' ) : __( 'Mark leads as won in the table or on the board', 'funnelforms-pro' ) }
							pressed={ 'won' === state.filter.leadStatus && ! archive && ! board }
							onClick={ () => toggleKpi( 'won' === state.filter.leadStatus && ! archive && ! board, { leadStatus: 'won' }, state.period, 'list' ) }
						/>
					) }
				</section>
			) : null }

			<section className="ffx-card ffx-card--flush ffxb-listcard" aria-busy={ busy }>
				<div className="ffxb-listbar">
					<div className="ffxb-listbar__row">
						<div className="ffx-segment ffxb-scope" role="group" aria-label={ __( 'Entries', 'funnelforms-pro' ) }>
							<button type="button" aria-pressed={ ! archive && ! spam } onClick={ () => setFilter( { archived: undefined, status: spam ? undefined : state.filter.status } ) }>
								{ __( 'Open', 'funnelforms-pro' ) }
								{ figures ? <span className="ffxb-scope__count">{ num( figures.total ) }</span> : null }
							</button>
							<button type="button" aria-pressed={ archive } onClick={ () => setFilter( { archived: true, status: spam ? undefined : state.filter.status } ) }>
								<Icon name="archive" />
								{ __( 'Archive', 'funnelforms-pro' ) }
							</button>
							<button type="button" aria-pressed={ spam } onClick={ () => setFilter( { status: 'spam', archived: undefined, read: undefined, leadStatus: undefined } ) }>
								<Icon name="shield" />
								{ __( 'Spam', 'funnelforms-pro' ) }
								{ figures?.spam ? <span className="ffxb-scope__count">{ num( figures.spam ) }</span> : null }
							</button>
						</div>
						<label className="ffxb-search">
							<Icon name="search" />
							<input type="search" placeholder={ __( 'Search entries', 'funnelforms-pro' ) } aria-label={ __( 'Search entries', 'funnelforms-pro' ) } value={ search } onChange={ ( e ) => setSearch( e.target.value ) } />
						</label>
						<BarSelect
							label={ __( 'Form', 'funnelforms-pro' ) }
							value={ state.filter.form ? String( state.filter.form ) : '' }
							options={ [ { value: '', label: __( 'All forms', 'funnelforms-pro' ) }, ...forms.map( ( f ) => ( { value: String( f.id ), label: f.title || sprintf( __( 'Form #%d', 'funnelforms-pro' ), f.id ) } ) ) ] }
							onChange={ ( v ) => setFilter( { form: v ? Number( v ) : undefined } ) }
						/>
						{ board || spam || 'free' === process.env.FUNNELFORMS_EDITION ? null : (
							<BarSelect
								label={ __( 'Lead status', 'funnelforms-pro' ) }
								value={ state.filter.leadStatus ?? '' }
								options={ [ { value: '', label: __( 'Any status', 'funnelforms-pro' ) }, ...stages.map( ( s ) => ( { value: s.key, label: s.name } ) ) ] }
								onChange={ ( v ) => setFilter( { leadStatus: ( v || undefined ) as LeadStatus | undefined } ) }
							/>
						) }
						<BarSelect
							label={ __( 'Period', 'funnelforms-pro' ) }
							value={ state.period }
							options={ [
								{ value: '', label: __( 'All time', 'funnelforms-pro' ) },
								{ value: 'today', label: __( 'Today', 'funnelforms-pro' ) },
								{ value: '7d', label: __( 'Last 7 days', 'funnelforms-pro' ) },
								{ value: '30d', label: __( 'Last 30 days', 'funnelforms-pro' ) },
								{ value: '90d', label: __( 'Last 90 days', 'funnelforms-pro' ) },
							] }
							onChange={ ( v ) => setFilter( {}, v as Period ) }
						/>
						{ spam || 'free' === process.env.FUNNELFORMS_EDITION ? null : (
							<BarSelect
								label={ __( 'Sort', 'funnelforms-pro' ) }
								value={ state.filter.sort ?? '' }
								options={ [
									{ value: '', label: __( 'Newest first', 'funnelforms-pro' ) },
									{ value: 'value', label: __( 'Highest lead value', 'funnelforms-pro' ) },
									{ value: 'score', label: __( 'Highest score', 'funnelforms-pro' ) },
								] }
								onChange={ ( v ) => setFilter( { sort: ( v || undefined ) as EntryFilter[ 'sort' ] } ) }
							/>
						) }
						<button type="button" className={ 'ffxb-morebtn' + ( chips.length ? ' is-active' : '' ) } aria-expanded={ more } aria-controls="ffxb-more-filters" onClick={ () => setMore( ! more ) }>
							<Icon name="filter" />
							{ __( 'Filters', 'funnelforms-pro' ) }
							{ chips.length ? <span className="ffxb-morebtn__count">{ chips.length }</span> : null }
						</button>
					</div>
					<div id="ffxb-more-filters" className="ffxb-more" hidden={ ! more }>
						{ 'free' === process.env.FUNNELFORMS_EDITION ? null : (
							<>
								<FilterSelect
									label={ __( 'Assigned to', 'funnelforms-pro' ) }
									value={ undefined === state.filter.assignedTo ? '' : String( state.filter.assignedTo ) }
									options={ [ { value: '', label: __( 'Anyone', 'funnelforms-pro' ) }, ...( config.user ? [ { value: String( config.user.id ), label: __( 'Me', 'funnelforms-pro' ) } ] : [] ), { value: '0', label: __( 'Nobody', 'funnelforms-pro' ) }, ...assignees.filter( ( a ) => a.id !== config.user?.id ).map( ( a ) => ( { value: String( a.id ), label: a.name } ) ) ] }
									onChange={ ( v ) => setFilter( { assignedTo: '' === v ? undefined : Number( v ) } ) }
								/>
								<FilterSelect
									label={ __( 'Tag', 'funnelforms-pro' ) }
									value={ state.filter.tag ?? '' }
									options={ [ { value: '', label: __( 'Any tag', 'funnelforms-pro' ) }, ...tags.map( ( t ) => ( { value: t.tag, label: `${ t.tag } (${ t.entries })` } ) ) ] }
									onChange={ ( v ) => setFilter( { tag: v || undefined } ) }
								/>
							</>
						) }
						<FilterSelect
							label={ __( 'Device', 'funnelforms-pro' ) }
							value={ state.filter.device ?? '' }
							options={ [ { value: '', label: __( 'Any device', 'funnelforms-pro' ) }, ...DEVICES.map( ( d ) => ( { value: d, label: deviceName( d ) } ) ) ] }
							onChange={ ( v ) => setFilter( { device: ( v || undefined ) as EntryDevice | undefined } ) }
						/>
						{ spam ? null : (
							<FilterSelect
								label={ __( 'Show', 'funnelforms-pro' ) }
								value={ showValue( state.filter ) }
								options={ showOptions }
								onChange={ ( v ) => setFilter( { read: 'unread' === v ? false : undefined, status: 'complete' === v || 'partial' === v || 'abandoned' === v ? v : undefined } ) }
							/>
						) }
					</div>
					{ chips.length || filtered( state ) ? (
						<div className="ffxb-chips">
							{ chips.map( ( c ) => (
								<span key={ c.key } className="ffxb-chip">
									{ c.label }
									<button type="button" className="ffxb-chip__remove" aria-label={ sprintf( __( 'Remove filter %s', 'funnelforms-pro' ), c.label ) } onClick={ c.remove }>
										<Icon name="close" />
									</button>
								</span>
							) ) }
							{ filtered( state ) ? (
								<button type="button" className="ffxb-chips__clear" onClick={ clear }>
									{ __( 'Clear filters', 'funnelforms-pro' ) }
								</button>
							) : null }
						</div>
					) : null }
				</div>

				{ error ? (
					<div className="ffxb-listcard__inner">
						<Notice tone="danger" title={ __( 'The entries could not be loaded.', 'funnelforms-pro' ) } action={ <Button onClick={ () => void reload() }>{ __( 'Try again', 'funnelforms-pro' ) }</Button> }>
							{ error }
						</Notice>
					</div>
				) : null }

				{ ! data && ! error ? <Spinner label={ __( 'Loading entries…', 'funnelforms-pro' ) } /> : null }

				{ data && 0 === entries.length && spam && ! filtered( state ) ? (
					<EmptyState icon="shield" title={ __( 'No spam', 'funnelforms-pro' ) }>
						{ __( 'Entries that look like spam land here instead of in your inbox. They send nothing and are deleted after the days set in the settings.', 'funnelforms-pro' ) }
					</EmptyState>
				) : null }

				{ data && 0 === entries.length && ! ( spam && ! filtered( state ) ) ? (
					filtered( state ) || archive ? (
						<EmptyState
							icon={ archive ? 'archive' : 'search' }
							title={ __( 'No entries found', 'funnelforms-pro' ) }
							action={
								filtered( state ) ? (
									<FrameButton size="sm" onClick={ clear }>
										{ __( 'Clear filters', 'funnelforms-pro' ) }
									</FrameButton>
								) : undefined
							}
						>
							{ archive && ! filtered( state ) ? __( 'Archived entries appear here.', 'funnelforms-pro' ) : __( 'Try other filters.', 'funnelforms-pro' ) }
						</EmptyState>
					) : (
						<EmptyState
							icon="inbox"
							title={ __( 'No entries yet', 'funnelforms-pro' ) }
							action={
								config.builderUrl ? (
									<a className="ffx-btn ffx-btn--primary" href={ config.builderUrl }>
										<Icon name="form" />
										<span>{ __( 'Go to your forms', 'funnelforms-pro' ) }</span>
									</a>
								) : undefined
							}
						>
							{ __( 'Entries of your forms appear here as soon as visitors send them.', 'funnelforms-pro' ) }
						</EmptyState>
					)
				) : null }

				{ data && entries.length && spam ? (
					<p className="ffxb-hint ffxb-listcard__hint">{ __( 'These entries sent no mail and ran no action. "Not spam" takes them back and sends what was held back.', 'funnelforms-pro' ) }</p>
				) : null }

				{ data && entries.length && ! board ? <EntryTable entries={ entries } selected={ selected } onSelect={ setSelected } onOpen={ open } date={ date } busy={ busy } showForm={ ! state.filter.form } current={ state.entry } /> : null }

				{ data && entries.length && board ? (
					<div className="ffxb-listcard__inner">
						<Board
							entries={ entries }
							onOpen={ open }
							onMove={ ( id, leadStatus ) => void act( () => api.updateEntry( id, { leadStatus } ) ) }
							date={ date }
							editable={ canEditStages && ! busy }
							onEditStage={ ( key ) => setStageEdit( key ) }
							onAddStage={ () => setStageEdit( ADD_STAGE ) }
							onMoveStage={ moveColumn }
						/>
						{ data.total > entries.length ? <p className="ffxb-hint">{ sprintf( __( 'The board shows the newest %1$d of %2$d entries. Narrow the filters or use the table for the others.', 'funnelforms-pro' ), entries.length, data.total ) }</p> : null }
					</div>
				) : null }

				{ data && entries.length ? (
					<footer className="ffxb-listfoot">
						<span className="ffxb-entries__count">{ sprintf( __( '%d entries', 'funnelforms-pro' ), num( data.total ) ) }</span>
						{ ! board && data.pages > 1 ? (
							<nav className="ffxb-pagination" aria-label={ __( 'Pages', 'funnelforms-pro' ) }>
								<span>{ sprintf( __( 'Page %1$d of %2$d', 'funnelforms-pro' ), num( page ), num( data.pages ) ) }</span>
								<FrameButton size="sm" icon="left" aria-label={ __( 'Previous', 'funnelforms-pro' ) } title={ __( 'Previous', 'funnelforms-pro' ) } disabled={ page <= 1 } onClick={ () => go( { ...state, filter: { ...state.filter, page: page - 1 } } ) } />
								<FrameButton size="sm" icon="right" aria-label={ __( 'Next', 'funnelforms-pro' ) } title={ __( 'Next', 'funnelforms-pro' ) } disabled={ page >= data.pages } onClick={ () => go( { ...state, filter: { ...state.filter, page: page + 1 } } ) } />
							</nav>
						) : null }
					</footer>
				) : null }
			</section>

			{ selected.length ? <BulkBar count={ selected.length } archive={ archive } spam={ spam } assignees={ assignees } busy={ busy } onApply={ ( c, done ) => void bulk( c, done ) } onClear={ () => setSelected( [] ) } /> : null }

			{ null !== stageEdit ? (
				<StageDialog
					stages={ stages }
					stage={ ADD_STAGE === stageEdit ? null : stages.find( ( s ) => s.key === stageEdit ) ?? null }
					busy={ busy }
					onClose={ () => setStageEdit( null ) }
					onSave={ async ( next, done, moveTo ) => {
						const problem = await saveStages( next, done, moveTo );
						if ( null === problem ) {
							setStageEdit( null );
						}
						return problem;
					} }
				/>
			) : null }

			{ null !== state.entry ? (
				<EntryPanel
					key={ state.entry }
					api={ api }
					id={ state.entry }
					assignees={ assignees }
					user={ config.user }
					date={ date }
					onClose={ () => open( null ) }
					onChanged={ () => {
						void reload();
						void loadLists();
						void loadFigures();
					} }
					onDeleted={ () => {
						open( null );
						setNotice( { tone: 'success', text: __( 'Entry deleted.', 'funnelforms-pro' ) } );
						void reload();
						void loadFigures();
					} }
				/>
			) : null }
		</Frame>
	);
	return <StagesContext.Provider value={ stages }>{ frame }</StagesContext.Provider>;
}

export function deviceName( device: EntryDevice ): string {
	return { desktop: __( 'Desktop', 'funnelforms-pro' ), tablet: __( 'Tablet', 'funnelforms-pro' ), mobile: __( 'Mobile', 'funnelforms-pro' ) }[ device ];
}

/** A duration as people read it: 45 s, 3 min 05 s, 1 h 02 min. */
export function duration( seconds: number ): string {
	const s = Math.max( 0, Math.round( seconds ) );
	if ( s < 60 ) {
		return sprintf( __( '%d s', 'funnelforms-pro' ), s );
	}
	if ( s < 3600 ) {
		return sprintf( __( '%1$d min %2$s s', 'funnelforms-pro' ), Math.floor( s / 60 ), String( s % 60 ).padStart( 2, '0' ) );
	}
	return sprintf( __( '%1$d h %2$s min', 'funnelforms-pro' ), Math.floor( s / 3600 ), String( Math.floor( ( s % 3600 ) / 60 ) ).padStart( 2, '0' ) );
}

/** EntryDevice, browser, where the visitor came from and the time per step, longest step marked. */
function VisitSection( { visit }: { visit: EntryVisit } ) {
	const longest = Math.max( 0, ...visit.steps.map( ( s ) => s.seconds ) );
	return (
		<Section title={ __( 'Visit', 'funnelforms-pro' ) } show>
			<dl className="ffxb-facts">
				{ visit.device ? <Fact label={ __( 'Device', 'funnelforms-pro' ) }>{ deviceName( visit.device ) }</Fact> : null }
				{ visit.browser ? <Fact label={ __( 'Browser', 'funnelforms-pro' ) }>{ [ visit.browser, visit.os ].filter( Boolean ).join( ', ' ) }</Fact> : null }
				{ null !== visit.seconds ? <Fact label={ __( 'Time to fill in', 'funnelforms-pro' ) }>{ duration( visit.seconds ) }</Fact> : null }
				{ visit.referrer ? (
					<Fact label={ __( 'Came from', 'funnelforms-pro' ) }>
						<a href={ visit.referrer } target="_blank" rel="noreferrer noopener">
							{ visit.referrer.replace( /^https?:\/\//, '' ) }
						</a>
					</Fact>
				) : null }
			</dl>
			{ visit.steps.length ? (
				<table className="ffxb-steps-time">
					<caption>{ __( 'Time per step', 'funnelforms-pro' ) }</caption>
					<tbody>
						{ visit.steps.map( ( step ) => (
							<tr key={ step.node } className={ longest > 0 && step.seconds === longest ? 'is-longest' : undefined }>
								<th scope="row">{ step.title || step.node }</th>
								<td>{ duration( step.seconds ) }</td>
							</tr>
						) ) }
					</tbody>
				</table>
			) : null }
		</Section>
	);
}


/** A filter of the bar: a select that names itself and stands out while it filters. */
function BarSelect( { label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: ( value: string ) => void } ) {
	return (
		<span className={ 'ffxb-barselect' + ( '' === value ? '' : ' is-active' ) }>
			<select aria-label={ label } title={ label } value={ value } onChange={ ( e ) => onChange( e.target.value ) }>
				{ options.map( ( o ) => (
					<option key={ o.value } value={ o.value }>
						{ o.label }
					</option>
				) ) }
			</select>
			<Icon name="down" />
		</span>
	);
}

function FilterSelect( { label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: ( value: string ) => void } ) {
	return (
		<label className="ffxb-filter">
			<span className="ffxb-filter__label">{ label }</span>
			<span className={ 'ffxb-barselect' + ( '' === value ? '' : ' is-active' ) }>
				<select value={ value } onChange={ ( e ) => onChange( e.target.value ) }>
					{ options.map( ( o ) => (
						<option key={ o.value } value={ o.value }>
							{ o.label }
						</option>
					) ) }
				</select>
				<Icon name="down" />
			</span>
		</label>
	);
}

function ExportMenu( { base, filter }: { base: string; filter: EntryFilter } ) {
	const menu = useRef<HTMLDetailsElement>( null );
	// Closes when a click or Escape lands elsewhere.
	useEffect( () => {
		const close = ( e: Event ): void => {
			const details = menu.current;
			if ( details?.open && ( ( e instanceof KeyboardEvent && 'Escape' === e.key ) || ( ! ( e instanceof KeyboardEvent ) && ! details.contains( e.target as Node ) ) ) ) {
				details.open = false;
			}
		};
		document.addEventListener( 'click', close );
		document.addEventListener( 'keydown', close );
		return () => {
			document.removeEventListener( 'click', close );
			document.removeEventListener( 'keydown', close );
		};
	}, [] );
	return (
		<details className="ffxb-menu" ref={ menu }>
			<summary className="ffx-btn">
				<Icon name="download" />
				<span>{ __( 'Export', 'funnelforms-pro' ) }</span>
			</summary>
			<div className="ffxb-menu__list" role="menu">
				<a role="menuitem" className="ffxb-menu__item" href={ exportLink( base, filter, 'csv' ) }>
					<Icon name="file" />
					{ __( 'CSV file', 'funnelforms-pro' ) }
				</a>
				{ 'free' === process.env.FUNNELFORMS_EDITION ? null : (
					<a role="menuitem" className="ffxb-menu__item" href={ exportLink( base, filter, 'excel' ) }>
						<Icon name="table" />
						{ __( 'For Excel', 'funnelforms-pro' ) }
					</a>
				) }
				<p className="ffxb-menu__hint">{ __( 'Exports the entries of the current filters, without search and period.', 'funnelforms-pro' ) }</p>
			</div>
		</details>
	);
}

function Tags( { tags, max = 3 }: { tags: string[]; max?: number } ) {
	if ( ! tags.length ) {
		return null;
	}
	return (
		<span className="ffxb-tags">
			{ tags.slice( 0, max ).map( ( t ) => (
				<span key={ t } className="ffxb-tag">
					{ t }
				</span>
			) ) }
			{ tags.length > max ? (
				<span className="ffxb-tag ffxb-tag--more" title={ tags.slice( max ).join( ', ' ) }>
					{ '+' + ( tags.length - max ) }
				</span>
			) : null }
		</span>
	);
}

function Assignee( { user }: { user: UserRef | null } ) {
	return user ? (
		<span className="ffxb-assignee">
			<Avatar name={ user.name } size="sm" />
			<span>{ user.name }</span>
		</span>
	) : (
		<span className="ffxb-muted">–</span>
	);
}

function EntryTable( props: { entries: EntrySummary[]; selected: number[]; onSelect: ( ids: number[] ) => void; onOpen: ( id: number ) => void; date: Dates; busy: boolean; showForm: boolean; current: number | null } ) {
	const { entries, selected } = props;
	const all = entries.length > 0 && entries.every( ( e ) => selected.includes( e.id ) );
	const some = ! all && entries.some( ( e ) => selected.includes( e.id ) );
	const toggle = ( id: number ): void => props.onSelect( selected.includes( id ) ? selected.filter( ( s ) => s !== id ) : [ ...selected, id ] );
	const head = useRef<HTMLInputElement>( null );
	useEffect( () => {
		if ( head.current ) {
			head.current.indeterminate = some;
		}
	}, [ some ] );
	return (
		<div className="ffxb-table-wrap">
			<table className="ffxb-table" aria-busy={ props.busy }>
				<thead>
					<tr>
						<th className="ffxb-table__check">
							<input ref={ head } type="checkbox" aria-label={ __( 'Select all on this page', 'funnelforms-pro' ) } checked={ all } onChange={ () => props.onSelect( all ? [] : entries.map( ( e ) => e.id ) ) } />
						</th>
						<th>{ __( 'Contact', 'funnelforms-pro' ) }</th>
						{ props.showForm ? <th>{ __( 'Form', 'funnelforms-pro' ) }</th> : null }
						<th>{ __( 'Received', 'funnelforms-pro' ) }</th>
						{ 'free' === process.env.FUNNELFORMS_EDITION ? null : (
							<>
								<th>{ __( 'Lead status', 'funnelforms-pro' ) }</th>
								<th>{ __( 'Tags', 'funnelforms-pro' ) }</th>
								<th>{ __( 'Assigned to', 'funnelforms-pro' ) }</th>
							</>
						) }
					</tr>
				</thead>
				<tbody>
					{ entries.map( ( entry ) => {
						const email = entryEmail( entry );
						const name = title( entry );
						const named = '' !== entryName( entry );
						const sub = email && email !== name ? email : entryPhone( entry );
						const classes = [ entry.read ? '' : 'is-unread', selected.includes( entry.id ) ? 'is-selected' : '', props.current === entry.id ? 'is-current' : '' ].filter( Boolean ).join( ' ' );
						return (
							<tr
								key={ entry.id }
								className={ classes }
								onClick={ ( e ) => {
									// The whole row opens the entry; its controls keep their own clicks.
									if ( ! ( e.target as HTMLElement ).closest( 'button, a, input, select, label' ) ) {
										props.onOpen( entry.id );
									}
								} }
							>
								<td className="ffxb-table__check">
									<input type="checkbox" aria-label={ sprintf( __( 'Select %s', 'funnelforms-pro' ), name ) } checked={ selected.includes( entry.id ) } onChange={ () => toggle( entry.id ) } />
								</td>
								<td className="ffxb-table__contact">
									<span className="ffxb-person">
										<Avatar name={ named ? name : '' } />
										<span className="ffxb-person__text">
											<button type="button" className="ffxb-link ffxb-table__title" onClick={ () => props.onOpen( entry.id ) }>
												{ entry.read ? null : <span className="ffxb-dot" aria-label={ __( 'Unread', 'funnelforms-pro' ) } /> }
												{ name }
											</button>
											<span className="ffxb-table__sub">
												{ sub ? <span className="ffxb-table__mail">{ sub }</span> : null }
												{ 'partial' === entry.status ? <Badge tone="warning">{ __( 'Incomplete', 'funnelforms-pro' ) }</Badge> : null }
												{ abandonBadge( entry ) }
												{ entry.payment ? <Badge tone={ PAYMENT_TONE[ entry.payment.status ] }>{ paymentName( entry.payment.status ) }</Badge> : null }
												{ null !== entry.score ? <Badge tone="brand">{ sprintf( __( 'Score %s', 'funnelforms-pro' ), String( entry.score ) ) }</Badge> : null }
												<ValueBadge entry={ entry } />
											</span>
										</span>
									</span>
								</td>
								{ props.showForm ? <td className="ffxb-table__form">{ entry.form?.title ?? '–' }</td> : null }
								<td className="ffxb-table__date">
									<When iso={ entry.completedAt ?? entry.createdAt } date={ props.date } />
								</td>
								{ 'free' === process.env.FUNNELFORMS_EDITION ? null : (
									<>
										<td>
											<LeadPill status={ entry.leadStatus } />
										</td>
										<td>
											<Tags tags={ entry.tags } />
										</td>
										<td>
											<Assignee user={ entry.assignedTo } />
										</td>
									</>
								) }
							</tr>
						);
					} ) }
				</tbody>
			</table>
		</div>
	);
}

/** Stands for a stage being added in the stage dialog; keys have no colon. */
const ADD_STAGE = ':add';

/** What the board drags: an entry to another column, or a column to another place. */
const STAGE_DRAG = 'application/x-funnelforms-stage';

function Board( props: {
	entries: EntrySummary[];
	onOpen: ( id: number ) => void;
	onMove: ( id: number, status: LeadStatus ) => void;
	date: Dates;
	/** The columns can be renamed, added, moved and deleted. */
	editable?: boolean;
	onEditStage?: ( key: LeadStatus ) => void;
	onAddStage?: () => void;
	onMoveStage?: ( key: LeadStatus, to: number ) => void;
} ) {
	const { entries, onOpen, onMove, date, editable = false } = props;
	const stages = useContext( StagesContext );
	const columns = byLeadStatus( entries, stages.map( ( s ) => s.key ) );
	const [ over, setOver ] = useState<LeadStatus | null>( null );
	// The column being dragged by its title.
	const dragged = useRef<LeadStatus | null>( null );
	return (
		<div className="ffxb-board">
			{ stages.map( ( stage, index ) => {
				const list = columns[ stage.key ] ?? [];
				return (
					<section
						key={ stage.key }
						className={ `ffxb-board__column ffxb-board__column--${ stage.tone }` + ( over === stage.key ? ' is-over' : '' ) }
						aria-label={ stage.name }
						onDragOver={ ( e ) => {
							e.preventDefault();
							setOver( stage.key );
						} }
						onDragLeave={ () => setOver( null ) }
						onDrop={ ( e ) => {
							e.preventDefault();
							setOver( null );
							const column = dragged.current ?? e.dataTransfer.getData( STAGE_DRAG );
							dragged.current = null;
							if ( column ) {
								if ( column !== stage.key ) {
									props.onMoveStage?.( column, index );
								}
								return;
							}
							const id = Number( e.dataTransfer.getData( 'text/plain' ) );
							const entry = entries.find( ( x ) => x.id === id );
							if ( entry && entry.leadStatus !== stage.key ) {
								onMove( id, stage.key );
							}
						} }
					>
						<div
							className={ 'ffxb-board__head' + ( editable ? ' is-movable' : '' ) }
							draggable={ editable }
							onDragStart={
								editable
									? ( e ) => {
											dragged.current = stage.key;
											e.dataTransfer.setData( STAGE_DRAG, stage.key );
											e.dataTransfer.effectAllowed = 'move';
									  }
									: undefined
							}
							onDragEnd={ () => ( dragged.current = null ) }
						>
							<h2 className="ffxb-board__title">
								<span className="ffxb-board__dot" aria-hidden="true" />
								<span className="ffxb-board__name">{ stage.name }</span>
								<span className="ffxb-board__count">{ list.length }</span>
							</h2>
							{ editable ? (
								<button type="button" className="ffxb-board__edit" aria-label={ sprintf( /* translators: %s: name of a lead stage */ __( 'Edit stage %s', 'funnelforms-pro' ), stage.name ) } title={ __( 'Rename, colour, move or delete', 'funnelforms-pro' ) } onClick={ () => props.onEditStage?.( stage.key ) }>
									<Icon name="edit" />
								</button>
							) : null }
						</div>
						{ list.length ? null : <p className="ffxb-board__empty">{ __( 'Drag entries here', 'funnelforms-pro' ) }</p> }
						{ list.map( ( entry ) => {
							const name = title( entry );
							return (
								<article key={ entry.id } className={ 'ffxb-card' + ( entry.read ? '' : ' is-unread' ) } draggable onDragStart={ ( e ) => e.dataTransfer.setData( 'text/plain', String( entry.id ) ) }>
									<div className="ffxb-card__head">
										<Avatar name={ entryName( entry ) } size="sm" />
										<button type="button" className="ffxb-link ffxb-card__title" onClick={ () => onOpen( entry.id ) }>
											{ entry.read ? null : <span className="ffxb-dot" aria-label={ __( 'Unread', 'funnelforms-pro' ) } /> }
											{ name }
										</button>
									</div>
									<div className="ffxb-card__meta">
										{ entry.form?.title ? <span>{ entry.form.title }</span> : null }
										<When iso={ entry.completedAt ?? entry.createdAt } date={ date } />
										<ValueBadge entry={ entry } />
									</div>
									{ entry.tags.length ? <Tags tags={ entry.tags } max={ 4 } /> : null }
									<div className="ffxb-card__foot">
										<select className="ffxb-card__move" aria-label={ sprintf( __( 'Lead status of %s', 'funnelforms-pro' ), name ) } value={ entry.leadStatus } onChange={ ( e ) => onMove( entry.id, e.target.value ) }>
											<StageOptions current={ entry.leadStatus } />
										</select>
										{ entry.assignedTo ? (
											<span title={ entry.assignedTo.name }>
												<Avatar name={ entry.assignedTo.name } size="sm" />
											</span>
										) : null }
									</div>
								</article>
							);
						} ) }
					</section>
				);
			} ) }
			{ editable && stages.length < MAX_STAGES ? (
				<button type="button" className="ffxb-board__add" onClick={ props.onAddStage }>
					<Icon name="plus" />
					<span>{ __( 'Add stage', 'funnelforms-pro' ) }</span>
				</button>
			) : null }
		</div>
	);
}

/** The stages as options of a select; a stage the board no longer has stays choosable as it is. */
function StageOptions( { current }: { current?: LeadStatus } ) {
	const stages = useContext( StagesContext );
	return (
		<>
			{ stages.map( ( s ) => (
				<option key={ s.key } value={ s.key }>
					{ s.name }
				</option>
			) ) }
			{ current && ! stages.some( ( s ) => s.key === current ) ? <option value={ current }>{ leadStatusName( current ) }</option> : null }
		</>
	);
}

/**
 * Edits one stage of the board, or adds one (stage null): its name, its colour, its place, and
 * deleting it, which asks where its entries go. The whole list is saved at once.
 */
function StageDialog( props: { stages: LeadStage[]; stage: LeadStage | null; busy: boolean; onClose: () => void; onSave: ( next: LeadStage[], done: string, moveTo?: Record<string, LeadStatus> ) => Promise<string | null> } ) {
	const { stages, stage } = props;
	const [ name, setName ] = useState( stage?.name ?? '' );
	const [ tone, setTone ] = useState<LeadStageTone>( stage?.tone ?? ( STAGE_TONES.find( ( t ) => ! stages.some( ( s ) => s.tone === t ) ) ?? 'neutral' ) );
	const [ index, setIndex ] = useState( () => ( stage ? stages.findIndex( ( s ) => s.key === stage.key ) : stages.length ) );
	const [ deleting, setDeleting ] = useState( false );
	const others = stages.filter( ( s ) => s.key !== stage?.key );
	const [ target, setTarget ] = useState<LeadStatus>( () => ( others.find( ( s ) => 'new' === s.key ) ?? others[ 0 ] )?.key ?? '' );
	const [ touched, setTouched ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const problem = stageNameProblem(
		name,
		others.map( ( s ) => s.name )
	);
	const problemText = { '': '', empty: __( 'Give the stage a name.', 'funnelforms-pro' ), long: sprintf( /* translators: %d: most characters of a name */ __( 'At most %d characters.', 'funnelforms-pro' ), MAX_STAGE_NAME ), taken: __( 'Another stage has this name.', 'funnelforms-pro' ) }[ problem ];
	const count = stage?.entries ?? 0;
	const total = stage ? stages.length : stages.length + 1;

	const save = async (): Promise<void> => {
		setTouched( true );
		if ( problem ) {
			return;
		}
		const own: LeadStage = { ...( stage ?? { key: '' } ), name: name.trim(), tone };
		const rest = stages.filter( ( s ) => s.key !== stage?.key );
		rest.splice( Math.min( index, rest.length ), 0, own );
		setError( await props.onSave( rest, stage ? sprintf( /* translators: %s: name of the lead stage */ __( 'Stage “%s” saved.', 'funnelforms-pro' ), own.name ) : sprintf( /* translators: %s: name of the lead stage */ __( 'Stage “%s” added.', 'funnelforms-pro' ), own.name ) ) );
	};
	const remove = async (): Promise<void> => {
		if ( ! stage ) {
			return;
		}
		setError( await props.onSave( others, count ? sprintf( /* translators: 1: deleted lead stage, 2: lead stage that took its entries */ __( 'Stage “%1$s” deleted; its entries are now in “%2$s”.', 'funnelforms-pro' ), stage.name, leadStatusName( target, stages ) ) : sprintf( /* translators: %s: name of the lead stage */ __( 'Stage “%s” deleted.', 'funnelforms-pro' ), stage.name ), { [ stage.key ]: target } ) );
	};

	return (
		<Dialog
			title={ stage ? __( 'Edit stage', 'funnelforms-pro' ) : __( 'New stage', 'funnelforms-pro' ) }
			open
			onClose={ props.onClose }
			actions={
				deleting ? (
					<>
						<Button variant="ghost" onClick={ () => setDeleting( false ) }>
							{ __( 'Back', 'funnelforms-pro' ) }
						</Button>
						<Button variant="danger" disabled={ props.busy || ( count > 0 && ! target ) } onClick={ () => void remove() }>
							{ __( 'Delete stage', 'funnelforms-pro' ) }
						</Button>
					</>
				) : (
					<>
						<Button variant="ghost" onClick={ props.onClose }>
							{ __( 'Cancel', 'funnelforms-pro' ) }
						</Button>
						<Button variant="primary" disabled={ props.busy } onClick={ () => void save() }>
							{ props.busy ? __( 'Saving…', 'funnelforms-pro' ) : stage ? __( 'Save', 'funnelforms-pro' ) : __( 'Add stage', 'funnelforms-pro' ) }
						</Button>
					</>
				)
			}
		>
			<div className="ffxb-stage">
				{ error ? <Notice tone="danger">{ error }</Notice> : null }
				{ deleting && stage ? (
					<div className="ffxb-stage__delete">
						<p>
							{ count
								? sprintf( 1 === count ? /* translators: %s: name of the lead stage */ __( '1 entry is in “%s”. Where should it go?', 'funnelforms-pro' ) : /* translators: 1: name of the lead stage, 2: number of entries */ __( '%2$d entries are in “%1$s”. Where should they go?', 'funnelforms-pro' ), stage.name, count )
								: sprintf( /* translators: %s: name of the lead stage */ __( 'No entries are in “%s”. The stage goes for everyone who works with the entries.', 'funnelforms-pro' ), stage.name ) }
						</p>
						{ count ? (
							<label className="ffxb-filter">
								<span className="ffxb-filter__label">{ __( 'Move the entries to', 'funnelforms-pro' ) }</span>
								<select className="ffxb-input" value={ target } onChange={ ( e ) => setTarget( e.target.value ) }>
									{ others.map( ( s ) => (
										<option key={ s.key } value={ s.key }>
											{ s.name }
										</option>
									) ) }
								</select>
							</label>
						) : null }
					</div>
				) : (
					<>
						<div className={ 'ffxb-field' + ( touched && problem ? ' is-invalid' : '' ) }>
							<label className="ffxb-field__label" htmlFor="ffxb-stage-name">
								{ __( 'Name', 'funnelforms-pro' ) }
							</label>
							<input
								id="ffxb-stage-name"
								className="ffxb-input"
								value={ name }
								maxLength={ MAX_STAGE_NAME + 10 }
								placeholder={ __( 'e.g. Offer sent', 'funnelforms-pro' ) }
								aria-invalid={ touched && !! problem }
								aria-describedby={ touched && problem ? 'ffxb-stage-name-error' : undefined }
								onChange={ ( e ) => setName( e.target.value ) }
								onBlur={ () => setTouched( true ) }
								onKeyDown={ ( e ) => {
									if ( 'Enter' === e.key ) {
										e.preventDefault();
										void save();
									}
								} }
							/>
							{ touched && problem ? (
								<span id="ffxb-stage-name-error" className="ffxb-field__error" role="alert">
									{ problemText }
								</span>
							) : null }
						</div>
						<fieldset className="ffxb-stage__tones">
							<legend className="ffxb-field__label">{ __( 'Colour', 'funnelforms-pro' ) }</legend>
							<div className="ffxb-swatches">
								{ STAGE_TONES.map( ( t ) => (
									<label key={ t } className={ `ffxb-swatch ffxb-swatch--${ t }` } title={ toneName( t ) }>
										<input type="radio" name="ffxb-stage-tone" value={ t } checked={ tone === t } onChange={ () => setTone( t ) } />
										<span className="ffxb-swatch__dot" aria-hidden="true" />
										<span className="screen-reader-text">{ toneName( t ) }</span>
									</label>
								) ) }
							</div>
						</fieldset>
						<div className="ffxb-stage__place">
							<span className="ffxb-field__label" id="ffxb-stage-place">
								{ __( 'Place on the board', 'funnelforms-pro' ) }
							</span>
							<div className="ffxb-stage__move" role="group" aria-labelledby="ffxb-stage-place">
								<Button size="sm" variant="ghost" icon={ <Icon name="left" /> } disabled={ index <= 0 } onClick={ () => setIndex( index - 1 ) }>
									{ __( 'Move left', 'funnelforms-pro' ) }
								</Button>
								<span className="ffxb-stage__position" aria-live="polite">
									{ sprintf( /* translators: 1: place of the stage on the board, 2: number of stages */ __( 'Column %1$d of %2$d', 'funnelforms-pro' ), Math.min( index, total - 1 ) + 1, total ) }
								</span>
								<Button size="sm" variant="ghost" icon={ <Icon name="right" /> } disabled={ index >= total - 1 } onClick={ () => setIndex( index + 1 ) }>
									{ __( 'Move right', 'funnelforms-pro' ) }
								</Button>
							</div>
						</div>
						{ stage ? (
							<div className="ffxb-stage__danger">
								{ stage.locked ? (
									<p className="ffxb-hint">{ __( 'New entries arrive in this stage, so it stays. Rename it as you like.', 'funnelforms-pro' ) }</p>
								) : (
									<Button size="sm" variant="ghost" icon={ <Icon name="trash" /> } onClick={ () => setDeleting( true ) }>
										{ __( 'Delete stage…', 'funnelforms-pro' ) }
									</Button>
								) }
							</div>
						) : (
							<p className="ffxb-hint">{ __( 'The stage is added for everyone who works with the entries.', 'funnelforms-pro' ) }</p>
						) }
					</>
				) }
			</div>
		</Dialog>
	);
}

function BulkBar( props: { count: number; archive: boolean; spam?: boolean; assignees: UserRef[]; busy: boolean; onApply: ( changes: BulkChanges, done: string ) => void; onClear: () => void } ) {
	const [ tagText, setTagText ] = useState( '' );
	const [ confirm, setConfirm ] = useState( false );
	const { count } = props;
	const stages = useContext( StagesContext );
	return (
		<div className="ffxb-bulk" role="region" aria-label={ __( 'Change selected entries', 'funnelforms-pro' ) }>
			<span className="ffxb-bulk__count">
				<strong>{ sprintf( __( '%d selected', 'funnelforms-pro' ), count ) }</strong>
				<button type="button" className="ffxb-bulk__clear" aria-label={ __( 'Clear selection', 'funnelforms-pro' ) } title={ __( 'Clear selection', 'funnelforms-pro' ) } onClick={ props.onClear }>
					<Icon name="close" />
				</button>
			</span>
			<span className="ffxb-bulk__sep" aria-hidden="true" />
			{ props.spam ? (
				<button type="button" className="ffxb-bulk__button" disabled={ props.busy } onClick={ () => props.onApply( { notSpam: true }, sprintf( /* translators: %d: number of entries */ __( '%d entries taken back; what was held back is being sent.', 'funnelforms-pro' ), count ) ) }>
					<Icon name="check" />
					{ __( 'Not spam', 'funnelforms-pro' ) }
				</button>
			) : null }
			{ 'free' === process.env.FUNNELFORMS_EDITION || props.spam ? null : (
				<>
					<select
						className="ffxb-bulk__select"
						aria-label={ __( 'Set lead status', 'funnelforms-pro' ) }
						value=""
						disabled={ props.busy }
						onChange={ ( e ) => {
							const s = e.target.value;
							props.onApply( { leadStatus: s }, sprintf( __( '%1$d entries set to “%2$s”.', 'funnelforms-pro' ), count, leadStatusName( s, stages ) ) );
						} }
					>
						<option value="">{ __( 'Set lead status…', 'funnelforms-pro' ) }</option>
						<StageOptions />
					</select>
					<select
						className="ffxb-bulk__select"
						aria-label={ __( 'Assign', 'funnelforms-pro' ) }
						value=""
						disabled={ props.busy }
						onChange={ ( e ) => {
							const id = Number( e.target.value );
							const who = props.assignees.find( ( a ) => a.id === id );
							props.onApply( { assignedTo: id }, who ? sprintf( __( '%1$d entries assigned to %2$s.', 'funnelforms-pro' ), count, who.name ) : sprintf( __( 'Assignment removed from %d entries.', 'funnelforms-pro' ), count ) );
						} }
					>
						<option value="">{ __( 'Assign…', 'funnelforms-pro' ) }</option>
						{ props.assignees.map( ( a ) => (
							<option key={ a.id } value={ a.id }>
								{ a.name }
							</option>
						) ) }
						<option value="0">{ __( 'Nobody', 'funnelforms-pro' ) }</option>
					</select>
					<form
						className="ffxb-bulk__tags"
						onSubmit={ ( e ) => {
							e.preventDefault();
							const add = parseTags( tagText );
							if ( add.length ) {
								props.onApply( { addTags: add }, sprintf( __( 'Tags added to %d entries.', 'funnelforms-pro' ), count ) );
								setTagText( '' );
							}
						} }
					>
						<Icon name="tag" />
						<input placeholder={ __( 'Add tags, separated by commas', 'funnelforms-pro' ) } aria-label={ __( 'Add tags', 'funnelforms-pro' ) } value={ tagText } onChange={ ( e ) => setTagText( e.target.value ) } />
						<button type="submit" className="ffxb-bulk__button ffxb-bulk__add" aria-label={ __( 'Add', 'funnelforms-pro' ) } title={ __( 'Add', 'funnelforms-pro' ) } disabled={ props.busy || ! parseTags( tagText ).length }>
							<Icon name="plus" />
						</button>
					</form>
					<span className="ffxb-bulk__sep" aria-hidden="true" />
				</>
			) }
			{ props.spam ? null : (
				<>
					<button type="button" className="ffxb-bulk__button" disabled={ props.busy } onClick={ () => props.onApply( { read: true }, sprintf( __( '%d entries marked as read.', 'funnelforms-pro' ), count ) ) }>
						<Icon name="check" />
						{ __( 'Mark as read', 'funnelforms-pro' ) }
					</button>
					<button type="button" className="ffxb-bulk__button" disabled={ props.busy } onClick={ () => props.onApply( { archived: ! props.archive }, props.archive ? sprintf( __( '%d entries restored.', 'funnelforms-pro' ), count ) : sprintf( __( '%d entries archived.', 'funnelforms-pro' ), count ) ) }>
						<Icon name="archive" />
						{ props.archive ? __( 'Restore', 'funnelforms-pro' ) : __( 'Archive', 'funnelforms-pro' ) }
					</button>
				</>
			) }
			<button type="button" className="ffxb-bulk__button ffxb-bulk__button--danger" disabled={ props.busy } onClick={ () => setConfirm( true ) }>
				<Icon name="trash" />
				{ __( 'Delete', 'funnelforms-pro' ) }
			</button>
			{ confirm ? (
				<Dialog
					open
					title={ sprintf( __( 'Delete %d entries?', 'funnelforms-pro' ), count ) }
					onClose={ () => setConfirm( false ) }
					actions={
						<>
							<Button onClick={ () => setConfirm( false ) }>{ __( 'Cancel', 'funnelforms-pro' ) }</Button>
							<Button
								variant="danger"
								onClick={ () => {
									setConfirm( false );
									props.onApply( { delete: true }, sprintf( __( '%d entries deleted.', 'funnelforms-pro' ), count ) );
								} }
							>
								{ __( 'Delete for good', 'funnelforms-pro' ) }
							</Button>
						</>
					}
				>
					<p>{ __( 'The entries are deleted with their files, notes and delivery log. This cannot be undone. To keep them out of the list, archive them instead.', 'funnelforms-pro' ) }</p>
				</Dialog>
			) : null }
		</div>
	);
}

function EntryPanel( props: { api: EntriesApi; id: number; assignees: UserRef[]; user?: { id: number; admin: boolean }; date: Dates; onClose: () => void; onChanged: () => void; onDeleted: () => void } ) {
	const { api, id, date } = props;
	const [ entry, setEntry ] = useState<EntryDetail | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ notice, setNotice ] = useState<{ tone: 'success' | 'danger'; text: string } | null>( null );
	const [ busy, setBusy ] = useState( false );
	const [ note, setNote ] = useState( '' );
	const [ tagText, setTagText ] = useState( '' );
	const [ resendAction, setResendAction ] = useState( '' );
	const [ confirm, setConfirm ] = useState( false );
	const panel = useRef<HTMLElement>( null );
	const { onChanged } = props;

	const load = useCallback( async (): Promise<void> => {
		try {
			let detail = await api.entry( id );
			if ( ! detail.read ) {
				// Opening an entry marks it as read.
				detail = { ...detail, ...( await api.updateEntry( id, { read: true } ) ) };
				onChanged();
			}
			setEntry( detail );
		} catch ( e ) {
			setError( message( e ) );
		}
	}, [ api, id, onChanged ] );

	useEffect( () => {
		void load();
	}, [ id ] );

	useEffect( () => {
		panel.current?.focus();
		const onKey = ( e: KeyboardEvent ): void => {
			if ( 'Escape' === e.key && ! document.querySelector( 'dialog[open]' ) ) {
				props.onClose();
			}
		};
		document.addEventListener( 'keydown', onKey );
		return () => document.removeEventListener( 'keydown', onKey );
	}, [] );

	const run = async ( work: () => Promise<unknown>, done?: string, refresh = true ): Promise<boolean> => {
		setBusy( true );
		setNotice( null );
		try {
			await work();
			if ( done ) {
				setNotice( { tone: 'success', text: done } );
			}
			if ( refresh ) {
				setEntry( await api.entry( id ) );
				props.onChanged();
			}
			return true;
		} catch ( e ) {
			setNotice( { tone: 'danger', text: message( e ) } );
			return false;
		} finally {
			setBusy( false );
		}
	};

	const files = ( ids: number[] | undefined ) => ( entry?.files ?? [] ).filter( ( f ) => ids?.includes( f.id ) );
	const email = entry ? entryEmail( entry ) : '';
	const phone = entry ? entryPhone( entry ) : '';

	return (
		<>
			<div className="ffxb-scrim" onClick={ props.onClose } aria-hidden="true" />
			<aside ref={ panel } className="ffxb-panel" role="dialog" aria-modal="false" aria-label={ entry ? title( entry ) : __( 'Entry', 'funnelforms-pro' ) } tabIndex={ -1 }>
				<header className="ffxb-panel__header">
					<div className="ffxb-panel__who">
						<Avatar name={ entry ? entryName( entry ) : '' } size="lg" />
						<div>
							<h2 className="ffxb-panel__title">{ entry ? title( entry ) : sprintf( __( 'Entry #%d', 'funnelforms-pro' ), id ) }</h2>
							{ entry ? (
								<p className="ffxb-panel__meta">
									{ sprintf( __( 'Entry #%d', 'funnelforms-pro' ), entry.id ) }
									{ entry.form ? ` · ${ entry.form.title }` : '' }
									{ ' · ' }
									<When iso={ entry.completedAt ?? entry.createdAt } date={ date } />
								</p>
							) : null }
						</div>
					</div>
					<Button variant="ghost" size="sm" icon={ icons.close } aria-label={ __( 'Close', 'funnelforms-pro' ) } onClick={ props.onClose } />
				</header>
				{ email || phone ? (
					<div className="ffxb-panel__quick">
						{ email ? (
							<a className="ffx-btn ffx-btn--sm" href={ 'mailto:' + email }>
								<Icon name="mail" />
								<span>{ __( 'Write an e-mail', 'funnelforms-pro' ) }</span>
							</a>
						) : null }
						{ phone ? (
							<a className="ffx-btn ffx-btn--sm" href={ 'tel:' + phone.replace( /[^\d+]/g, '' ) }>
								<Icon name="phone" />
								<span>{ __( 'Call', 'funnelforms-pro' ) }</span>
							</a>
						) : null }
					</div>
				) : null }

				{ error ? <Notice tone="danger" title={ __( 'The entry could not be loaded.', 'funnelforms-pro' ) }>{ error }</Notice> : null }
				{ ! entry && ! error ? <Spinner label={ __( 'Loading entry…', 'funnelforms-pro' ) } /> : null }
				{ notice ? <Notice tone={ notice.tone }>{ notice.text }</Notice> : null }

				{ entry ? (
					<div className="ffxb-panel__body" aria-busy={ busy }>
						{ 'spam' === entry.status ? (
							<Notice
								tone="warning"
								title={ __( 'In the spam folder', 'funnelforms-pro' ) }
								action={
									<Button
										size="sm"
										disabled={ busy }
										onClick={ async () => {
											let taken = false;
											const ok = await run( async () => {
												taken = ( await api.notSpam( id ) ).appointmentTaken;
											}, __( 'Taken back. Mails and actions are being sent now.', 'funnelforms-pro' ) );
											if ( ok && taken ) {
												setNotice( { tone: 'danger', text: __( 'The entry was taken back, but its appointment time was booked by someone else meanwhile. Please arrange a new time with the visitor.', 'funnelforms-pro' ) } );
											}
										} }
									>
										{ __( 'Not spam', 'funnelforms-pro' ) }
									</Button>
								}
							>
								<p>{ __( 'This entry sent no mail and ran no action. Why it looks like spam:', 'funnelforms-pro' ) }</p>
								<ul className="ffxb-panel__reasons">
									{ ( entry.spam?.reasons ?? [] ).map( ( r ) => (
										<li key={ r }>{ spamReasonName( r ) }</li>
									) ) }
								</ul>
							</Notice>
						) : null }
						{ 'free' === process.env.FUNNELFORMS_EDITION || 'spam' === entry.status ? null : (
							<section className="ffxb-panel__section ffxb-panel__crm">
								<label className="ffxb-filter">
									<span className="ffxb-filter__label">{ __( 'Lead status', 'funnelforms-pro' ) }</span>
									<select className="ffxb-input" value={ entry.leadStatus } disabled={ busy } onChange={ ( e ) => void run( () => api.updateEntry( id, { leadStatus: e.target.value } ) ) }>
										<StageOptions current={ entry.leadStatus } />
									</select>
								</label>
								<label className="ffxb-filter">
									<span className="ffxb-filter__label">{ __( 'Assigned to', 'funnelforms-pro' ) }</span>
									<select className="ffxb-input" value={ entry.assignedTo?.id ?? 0 } disabled={ busy } onChange={ ( e ) => void run( () => api.updateEntry( id, { assignedTo: Number( e.target.value ) } ) ) }>
										<option value={ 0 }>{ __( 'Nobody', 'funnelforms-pro' ) }</option>
										{ props.assignees.map( ( a ) => (
											<option key={ a.id } value={ a.id }>
												{ a.name }
											</option>
										) ) }
										{ entry.assignedTo && ! props.assignees.some( ( a ) => a.id === entry.assignedTo?.id ) ? <option value={ entry.assignedTo.id }>{ entry.assignedTo.name || sprintf( __( 'User #%d', 'funnelforms-pro' ), entry.assignedTo.id ) }</option> : null }
									</select>
								</label>
								<div className="ffxb-filter ffxb-panel__tags">
									<span className="ffxb-filter__label">{ __( 'Tags', 'funnelforms-pro' ) }</span>
									<span className="ffxb-tags">
										{ entry.tags.map( ( t ) => (
											<span key={ t } className="ffxb-tag">
												{ t }
												<button type="button" className="ffxb-tag__remove" aria-label={ sprintf( __( 'Remove tag %s', 'funnelforms-pro' ), t ) } disabled={ busy } onClick={ () => void run( () => api.updateEntry( id, { tags: entry.tags.filter( ( x ) => x !== t ) } ) ) }>
													×
												</button>
											</span>
										) ) }
									</span>
									<form
										className="ffxb-inline"
										onSubmit={ ( e ) => {
											e.preventDefault();
											const add = parseTags( tagText ).filter( ( t ) => ! entry.tags.includes( t ) );
											if ( add.length ) {
												void run( () => api.updateEntry( id, { tags: [ ...entry.tags, ...add ] } ) ).then( ( ok ) => ok && setTagText( '' ) );
											}
										} }
									>
										<input className="ffxb-input ffxb-input--inline" placeholder={ __( 'New tag', 'funnelforms-pro' ) } aria-label={ __( 'Add tags', 'funnelforms-pro' ) } value={ tagText } onChange={ ( e ) => setTagText( e.target.value ) } />
										<Button size="sm" type="submit" disabled={ busy || ! parseTags( tagText ).length }>
											{ __( 'Add', 'funnelforms-pro' ) }
										</Button>
									</form>
								</div>
							</section>
						) }

						<div className="ffxb-panel__badges">
							{ 'partial' === entry.status ? <Badge tone="warning">{ __( 'Incomplete', 'funnelforms-pro' ) }</Badge> : null }
							{ abandonBadge( entry ) }
							{ entry.imported ? <Badge>{ __( 'From Funnelforms 3', 'funnelforms-pro' ) }</Badge> : null }
							{ entry.archived ? <Badge>{ __( 'Archived', 'funnelforms-pro' ) }</Badge> : null }
							{ 'free' !== process.env.FUNNELFORMS_EDITION && entry.public ? <Badge tone="success">{ __( 'Shown on the website', 'funnelforms-pro' ) }</Badge> : null }
							{ entry.optIn ? <Badge tone={ 'confirmed' === entry.optIn.status ? 'success' : 'warning' }>{ 'confirmed' === entry.optIn.status ? __( 'E-mail address confirmed', 'funnelforms-pro' ) : __( 'Waiting for confirmation', 'funnelforms-pro' ) }</Badge> : null }
							{ null !== entry.score ? <Badge tone="brand">{ sprintf( __( 'Score %s', 'funnelforms-pro' ), String( entry.score ) ) }</Badge> : null }
							<ValueBadge entry={ entry } />
						</div>

						{ entry.abandon ? (
							<Section title={ __( 'Left the form', 'funnelforms-pro' ) } show>
								<dl className="ffxb-facts">
									{ entry.abandon.lastStep ? <Fact label={ __( 'Last step', 'funnelforms-pro' ) }>{ entry.abandon.lastStep.title }</Fact> : null }
									{ entry.abandon.leftAt ? <Fact label={ __( 'Left', 'funnelforms-pro' ) }>{ date( entry.abandon.leftAt ) }</Fact> : null }
									<Fact label={ __( 'Reminder', 'funnelforms-pro' ) }>
										{ 'stopped' === entry.abandon.state
											? __( 'The visitor asked for no reminders.', 'funnelforms-pro' )
											: entry.abandon.remindedAt
												? date( entry.abandon.remindedAt )
												: 'abandoned' === entry.status
													? __( 'Not sent yet', 'funnelforms-pro' )
													: __( 'Not needed: sent before it was due', 'funnelforms-pro' ) }
									</Fact>
									{ 'recovered' === entry.abandon.state ? <Fact label={ __( 'Result', 'funnelforms-pro' ) }>{ __( 'Came back with the reminder and sent the form.', 'funnelforms-pro' ) }</Fact> : null }
								</dl>
							</Section>
						) : null }

						<Section title={ __( 'Contact', 'funnelforms-pro' ) } show={ entry.contact.some( ( c ) => '' !== valueText( c.value ) ) }>
							<dl className="ffxb-facts">
								{ entry.contact
									.filter( ( c ) => 'consent' !== c.type && '' !== valueText( c.value ) )
									.map( ( c, i ) => (
										<Fact key={ i } label={ c.label }>
											<ContactValue type={ c.type } value={ valueText( c.value, __( 'Yes', 'funnelforms-pro' ), __( 'No', 'funnelforms-pro' ) ) } />
										</Fact>
									) ) }
							</dl>
						</Section>

						<Section title={ __( 'Answers', 'funnelforms-pro' ) } show={ entry.answers.length > 0 }>
							<dl className="ffxb-facts">
								{ entry.answers.map( ( a, i ) => {
									const attached = files( a.fileIds );
									return (
										<Fact key={ i } label={ a.label }>
											{ attached.length ? (
												<ul className="ffxb-files">
													{ attached.map( ( f ) => (
														<li key={ f.id }>
															{ f.type.startsWith( 'image/' ) ? <img src={ f.url } alt="" className="ffxb-files__thumb" /> : null }
															<a href={ f.url }>{ f.name }</a>
														</li>
													) ) }
												</ul>
											) : (
												<span className="ffxb-facts__text">{ a.display ?? ( valueText( a.value, __( 'Yes', 'funnelforms-pro' ), __( 'No', 'funnelforms-pro' ) ) || '–' ) }</span>
											) }
										</Fact>
									);
								} ) }
							</dl>
						</Section>

						<Section title={ __( 'Appointments', 'funnelforms-pro' ) } show={ entry.appointments.length > 0 }>
							<ul className="ffxb-appointments">
								{ entry.appointments.map( ( a ) => (
									<li key={ a.id } className="ffxb-appointment">
										<p className="ffxb-appointment__when">
											<strong>{ appointmentTime( a ) }</strong>
											{ 'cancelled' === a.status ? <Badge>{ __( 'Cancelled', 'funnelforms-pro' ) }</Badge> : null }
										</p>
										<p className="ffxb-appointment__meta">
											{ [ a.type?.title ?? __( 'Deleted appointment type', 'funnelforms-pro' ), sprintf( __( '%d min', 'funnelforms-pro' ), a.duration ), a.people.map( ( p ) => p.name ).join( ', ' ), a.timezone ? zoneName( a.timezone, pageLocale() ) : '' ].filter( Boolean ).join( ' · ' ) }
										</p>
										{ a.changeable ? (
											<Button
												size="sm"
												disabled={ busy }
												onClick={ () => {
													if ( window.confirm( __( 'Cancel this appointment? The visitor and the people booked get a cancellation by e-mail.', 'funnelforms-pro' ) ) ) {
														void run( () => api.cancelAppointment( id, a.id ), __( 'The appointment is cancelled.', 'funnelforms-pro' ) );
													}
												} }
											>
												{ __( 'Cancel appointment', 'funnelforms-pro' ) }
											</Button>
										) : null }
									</li>
								) ) }
							</ul>
						</Section>

						<Section title={ __( 'Calculations', 'funnelforms-pro' ) } show={ entry.calculations.length > 0 }>
							<dl className="ffxb-facts">
								{ entry.calculations.map( ( c, i ) => (
									<Fact key={ i } label={ c.title || __( 'Calculation', 'funnelforms-pro' ) }>
										{ c.error ? <span className="ffxb-facts__error">{ __( 'Could not be calculated', 'funnelforms-pro' ) }</span> : c.formatted ?? String( c.value ?? '' ) }
									</Fact>
								) ) }
							</dl>
						</Section>

						<Section title={ __( 'Payment', 'funnelforms-pro' ) } show={ null !== entry.payment }>
							{ entry.payment ? (
								<>
									<dl className="ffxb-facts">
										<Fact label={ __( 'Status', 'funnelforms-pro' ) }>
											<Badge tone={ PAYMENT_TONE[ entry.payment.status ] }>{ paymentName( entry.payment.status ) }</Badge>
											{ entry.payment.test ? (
												<>
													{ ' ' }
													<Badge tone="warning">{ __( 'Test payment', 'funnelforms-pro' ) }</Badge>
												</>
											) : null }
										</Fact>
										<Fact label={ __( 'Amount', 'funnelforms-pro' ) }>{ money( entry.payment.amount, entry.payment.currency ) + ( entry.payment.total !== entry.payment.amount ? ' / ' + money( entry.payment.total, entry.payment.currency ) : '' ) }</Fact>
										<Fact label={ __( 'Provider', 'funnelforms-pro' ) }>{ { stripe: 'Stripe', paypal: 'PayPal', mollie: 'Mollie' }[ entry.payment.provider ] ?? entry.payment.provider }</Fact>
										{ entry.payment.paidAt ? <Fact label={ __( 'Paid on', 'funnelforms-pro' ) }>{ date( entry.payment.paidAt ) }</Fact> : null }
										{ entry.payment.coupon ? (
											<Fact label={ __( 'Coupon', 'funnelforms-pro' ) }>
												{ entry.payment.coupon }
												{ entry.payment.discount ? ` (−${ money( entry.payment.discount, entry.payment.currency ) })` : '' }
											</Fact>
										) : null }
										{ entry.payment.subscriptionStatus ? (
											<Fact label={ __( 'Subscription', 'funnelforms-pro' ) }>{ subscriptionName( entry.payment.subscriptionStatus, entry.payment.interval ) }</Fact>
										) : null }
										{ entry.payment.reference ? (
											<Fact label={ __( 'Reference', 'funnelforms-pro' ) }>
												{ entry.payment.dashboardUrl ? (
													<a href={ entry.payment.dashboardUrl } target="_blank" rel="noopener noreferrer">
														{ entry.payment.reference }
														<span className="screen-reader-text"> { __( '(opens in a new tab)', 'funnelforms-pro' ) }</span>
													</a>
												) : (
													entry.payment.reference
												) }
											</Fact>
										) : null }
										{ entry.payment.error ? <Fact label={ __( 'Error', 'funnelforms-pro' ) }>{ entry.payment.error }</Fact> : null }
									</dl>
									<Button size="sm" icon={ icons.reload } disabled={ busy } onClick={ () => void run( () => api.checkPayment( id ), __( 'Payment status updated.', 'funnelforms-pro' ) ) }>
										{ __( 'Check status', 'funnelforms-pro' ) }
									</Button>
								</>
							) : null }
						</Section>

						{ 'free' === process.env.FUNNELFORMS_EDITION ? null : (
							<Section title={ __( 'Notes', 'funnelforms-pro' ) } show>
								<ul className="ffxb-notes">
									{ entry.notes.map( ( n ) => (
										<li key={ n.id } className="ffxb-note">
											<p className="ffxb-note__text">{ n.text }</p>
											<p className="ffxb-note__meta">
												{ [ n.author?.name, date( n.createdAt ) ].filter( Boolean ).join( ' · ' ) }
												{ props.user && ( props.user.admin || n.author?.id === props.user.id ) ? (
													<button type="button" className="ffxb-link ffxb-note__delete" disabled={ busy } onClick={ () => void run( () => api.deleteNote( id, n.id ) ) }>
														{ __( 'Delete', 'funnelforms-pro' ) }
													</button>
												) : null }
											</p>
										</li>
									) ) }
								</ul>
								<form
									className="ffxb-note-form"
									onSubmit={ ( e ) => {
										e.preventDefault();
										if ( note.trim() ) {
											void run( () => api.addNote( id, note.trim() ) ).then( ( ok ) => ok && setNote( '' ) );
										}
									} }
								>
									<textarea className="ffxb-input" rows={ 3 } maxLength={ 5000 } placeholder={ __( 'Write a note for your team. Visitors never see it.', 'funnelforms-pro' ) } aria-label={ __( 'New note', 'funnelforms-pro' ) } value={ note } onChange={ ( e ) => setNote( e.target.value ) } />
									<Button size="sm" type="submit" variant="primary" disabled={ busy || ! note.trim() }>
										{ __( 'Add note', 'funnelforms-pro' ) }
									</Button>
								</form>
							</Section>
						) }

						<Section title={ __( 'Sent to', 'funnelforms-pro' ) } show={ entry.deliveries.length > 0 || ( 'free' !== process.env.FUNNELFORMS_EDITION && entry.actions.length > 0 ) }>
							{ entry.deliveries.length ? (
								<ul className="ffxb-deliveries">
									{ entry.deliveries.map( ( d ) => {
										const kind = entry.actions.find( ( a ) => a.id === d.action )?.kind;
										return (
											<li key={ d.id }>
												<span>{ kind ? actionName( kind ) : deliveryName( d.action ) }</span>
												{ deliveryBadge( d.status ) }
												<span className="ffxb-deliveries__time">{ date( d.updatedAt ) }</span>
												{ d.error ? <span className="ffxb-deliveries__error">{ d.error }</span> : null }
											</li>
										);
									} ) }
								</ul>
							) : null }
							{ 'free' !== process.env.FUNNELFORMS_EDITION && entry.actions.length ? (
								<div className="ffxb-inline">
									<select className="ffxb-input ffxb-input--inline" aria-label={ __( 'Action to send again', 'funnelforms-pro' ) } value={ resendAction } onChange={ ( e ) => setResendAction( e.target.value ) }>
										<option value="">{ __( 'Send again…', 'funnelforms-pro' ) }</option>
										{ entry.actions.map( ( a, i ) => (
											<option key={ a.id } value={ a.id }>
												{ `${ i + 1 }. ${ actionName( a.kind ) }` }
											</option>
										) ) }
									</select>
									<Button
										size="sm"
										disabled={ busy || ! resendAction }
										onClick={ () =>
											void run( () => api.resend( id, resendAction ), __( 'Queued. It is sent again shortly.', 'funnelforms-pro' ) ).then( ( ok ) => ok && setResendAction( '' ) )
										}
									>
										{ __( 'Send', 'funnelforms-pro' ) }
									</Button>
								</div>
							) : null }
						</Section>

						{ entry.visit ? <VisitSection visit={ entry.visit } /> : null }

						<Section title={ __( 'Details', 'funnelforms-pro' ) } show>
							<dl className="ffxb-facts">
								{ entry.page?.url || entry.sourceUrl ? (
									<Fact label={ __( 'Page', 'funnelforms-pro' ) }>
										<a href={ entry.page?.url ?? entry.sourceUrl ?? '' } target="_blank" rel="noreferrer noopener">
											{ entry.page?.title || entry.page?.url || entry.sourceUrl }
										</a>
									</Fact>
								) : null }
								{ Object.entries( entry.utm ).map( ( [ k, v ] ) => (
									<Fact key={ k } label={ k }>
										{ v }
									</Fact>
								) ) }
								{ Object.entries( entry.hiddenFields ).map( ( [ k, v ] ) => (
									<Fact key={ 'h' + k } label={ k }>
										{ valueText( v ) }
									</Fact>
								) ) }
								{ Object.entries( entry.variants ).map( ( [ k, v ] ) => (
									<Fact key={ 'v' + k } label={ sprintf( __( 'A/B test %s', 'funnelforms-pro' ), k ) }>
										{ sprintf( __( 'Variant %s', 'funnelforms-pro' ), v.toUpperCase() ) }
									</Fact>
								) ) }
								{ entry.consent.map( ( c ) => (
									<Fact key={ c.fieldId } label={ c.checked ? __( 'Agreed to', 'funnelforms-pro' ) : __( 'Did not agree to', 'funnelforms-pro' ) }>
										{ c.text }
									</Fact>
								) ) }
								<Fact label={ __( 'Language', 'funnelforms-pro' ) }>{ entry.locale }</Fact>
							</dl>
						</Section>

						<footer className="ffxb-panel__footer">
							{ 'free' === process.env.FUNNELFORMS_EDITION ? null : (
								<a className="ffxb-button ffxb-button--secondary ffxb-button--sm" href={ entry.pdfUrl }>
									{ icons.download }
									{ __( 'PDF', 'funnelforms-pro' ) }
								</a>
							) }
							<Button size="sm" disabled={ busy } onClick={ () => void run( () => api.updateEntry( id, { read: false } ), __( 'Marked as unread.', 'funnelforms-pro' ) ) }>
								{ __( 'Mark as unread', 'funnelforms-pro' ) }
							</Button>
							{ 'free' === process.env.FUNNELFORMS_EDITION ? null : (
								<Button size="sm" disabled={ busy } onClick={ () => void run( () => api.updateEntry( id, { public: ! entry.public } ) ) }>
									{ entry.public ? __( 'Hide on the website', 'funnelforms-pro' ) : __( 'Show on the website', 'funnelforms-pro' ) }
								</Button>
							) }
							<Button size="sm" disabled={ busy } onClick={ () => void run( () => api.updateEntry( id, { archived: ! entry.archived } ), entry.archived ? __( 'Restored.', 'funnelforms-pro' ) : __( 'Archived.', 'funnelforms-pro' ) ) }>
								{ entry.archived ? __( 'Restore', 'funnelforms-pro' ) : __( 'Archive', 'funnelforms-pro' ) }
							</Button>
							<Button size="sm" variant="danger" disabled={ busy } onClick={ () => setConfirm( true ) }>
								{ __( 'Delete', 'funnelforms-pro' ) }
							</Button>
						</footer>
					</div>
				) : null }
			</aside>
			{ confirm ? (
				<Dialog
					open
					title={ __( 'Delete this entry?', 'funnelforms-pro' ) }
					onClose={ () => setConfirm( false ) }
					actions={
						<>
							<Button onClick={ () => setConfirm( false ) }>{ __( 'Cancel', 'funnelforms-pro' ) }</Button>
							<Button
								variant="danger"
								onClick={ () => {
									setConfirm( false );
									void run( () => api.deleteEntry( id ), undefined, false ).then( ( ok ) => ok && props.onDeleted() );
								} }
							>
								{ __( 'Delete for good', 'funnelforms-pro' ) }
							</Button>
						</>
					}
				>
					<p>{ __( 'The entry is deleted with its files, notes and delivery log. This cannot be undone.', 'funnelforms-pro' ) }</p>
				</Dialog>
			) : null }
		</>
	);
}

/** Status of a Stripe subscription, with its interval. */
function subscriptionName( status: string, interval: string | null ): string {
	const names: Record<string, string> = {
		active: __( 'Active', 'funnelforms-pro' ),
		trialing: __( 'Active', 'funnelforms-pro' ),
		past_due: __( 'Payment overdue', 'funnelforms-pro' ),
		unpaid: __( 'Payment overdue', 'funnelforms-pro' ),
		canceled: __( 'Canceled', 'funnelforms-pro' ),
		incomplete_expired: __( 'Canceled', 'funnelforms-pro' ),
		incomplete: __( 'Not started', 'funnelforms-pro' ),
		paused: __( 'Paused', 'funnelforms-pro' ),
	};
	const every = 'year' === interval ? __( 'yearly', 'funnelforms-pro' ) : 'month' === interval ? __( 'monthly', 'funnelforms-pro' ) : '';
	return [ names[ status ] ?? status, every ].filter( Boolean ).join( ', ' );
}

function money( amount: number, currency: string ): string {
	try {
		return new Intl.NumberFormat( undefined, { style: 'currency', currency } ).format( amount );
	} catch {
		return `${ amount } ${ currency }`;
	}
}

function Section( { title: heading, show, children }: { title: string; show: boolean; children: React.ReactNode } ) {
	return show ? (
		<section className="ffxb-panel__section">
			<h3 className="ffxb-panel__heading">{ heading }</h3>
			{ children }
		</section>
	) : null;
}

function Fact( { label, children }: { label: string; children: React.ReactNode } ) {
	return (
		<div className="ffxb-facts__row">
			<dt>{ label }</dt>
			<dd>{ children }</dd>
		</div>
	);
}

function ContactValue( { type, value }: { type: string; value: string } ) {
	if ( 'email' === type ) {
		return <a href={ 'mailto:' + value }>{ value }</a>;
	}
	if ( 'phone' === type || 'tel' === type ) {
		return <a href={ 'tel:' + value.replace( /[^\d+]/g, '' ) }>{ value }</a>;
	}
	return <span className="ffxb-facts__text">{ value }</span>;
}
