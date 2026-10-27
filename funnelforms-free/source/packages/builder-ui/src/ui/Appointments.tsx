/**
 * The appointments page (Funnelforms → Appointments): what is booked as an agenda by day or as a
 * week or month calendar, with filters and key figures; each appointment opens its details, where
 * the team moves it to another free time, cancels it with a message, or marks how it went. Users
 * who edit forms also set up the appointment types and word the visitor's mails of each here.
 *
 * The page sits in the frame of the other Funnelforms pages (admin.css); this screen uses its
 * cards, buttons and badges plus the appointments block at the end of admin.css.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TypesTab } from './AppointmentTypes';
import {
	addDays,
	addressOf,
	AppointmentsClient,
	byDay,
	counts,
	dayOf,
	figures,
	filtered,
	insertAt,
	lanes,
	MAIL_KINDS,
	minutesOf,
	rangeOf,
	startOfMonth,
	stateFromAddress,
	stateOf,
	step,
	zoneName,
	zoneOf,
	type AppointmentItem,
	type AppointmentsConfig,
	type AppointmentState,
	type Filter,
	type FreeTimes,
	type MailKind,
	type Mails,
	type MailSettings,
	type PageState,
	type StatusFilter,
	type View,
} from '../appointments';
import { __, sprintf } from './i18n';

/* Formatting ---------------------------------------------------------------------------- */

interface Formats {
	locale: string;
	zone: string | undefined;
	time: ( iso: string ) => string;
	/** "Monday, 20 October". */
	day: ( day: string ) => string;
	/** "Mon". */
	weekdayShort: ( day: string ) => string;
	/** "09:00" of an hour of the day. */
	hour: ( hour: number ) => string;
	/** "Monday, 20 October 2026, 10:00". */
	long: ( iso: string ) => string;
	range: ( from: string, to: string, view: View ) => string;
}

function localeOf( userLocale: string | undefined ): string {
	const tag = ( userLocale ?? '' ).split( '_' ).slice( 0, 2 ).join( '-' );
	try {
		return tag ? new Intl.Locale( tag ).toString() : 'en-US';
	} catch {
		return 'en-US';
	}
}

/** A day (Y-m-d) as a Date at noon UTC, formatted in UTC: the same day everywhere. */
function noon( day: string ): Date {
	return new Date( day + 'T12:00:00Z' );
}

function makeFormats( locale: string, zone: string | undefined ): Formats {
	const time = new Intl.DateTimeFormat( locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' } );
	const day = new Intl.DateTimeFormat( locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' } );
	const short = new Intl.DateTimeFormat( locale, { timeZone: 'UTC', weekday: 'short' } );
	const long = new Intl.DateTimeFormat( locale, { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } );
	const month = new Intl.DateTimeFormat( locale, { timeZone: 'UTC', month: 'long', year: 'numeric' } );
	const span = new Intl.DateTimeFormat( locale, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' } );
	const hour = new Intl.DateTimeFormat( locale, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' } );
	return {
		locale,
		zone,
		time: ( iso ) => time.format( new Date( iso ) ),
		day: ( d ) => day.format( noon( d ) ),
		weekdayShort: ( d ) => short.format( noon( d ) ),
		hour: ( h ) => hour.format( Date.UTC( 2026, 0, 1, h ) ),
		long: ( iso ) => long.format( new Date( iso ) ) + ', ' + time.format( new Date( iso ) ),
		range: ( from, to, view ) => {
			if ( 'month' === view ) {
				return month.format( noon( from ) );
			}
			const ranged = span as Intl.DateTimeFormat & { formatRange?: ( a: Date, b: Date ) => string };
			return ranged.formatRange ? ranged.formatRange( noon( from ), noon( to ) ) : span.format( noon( from ) ) + ' – ' + span.format( noon( to ) );
		},
	};
}

function duration( minutes: number ): string {
	const h = Math.floor( minutes / 60 );
	const m = minutes % 60;
	return [ h ? sprintf( __( '%d h', 'funnelforms-pro' ), h ) : '', m || ! h ? sprintf( __( '%d min', 'funnelforms-pro' ), m ) : '' ].filter( Boolean ).join( ' ' );
}

function appointmentsCount( n: number ): string {
	return 1 === n ? __( '1 appointment', 'funnelforms-pro' ) : sprintf( __( '%d appointments', 'funnelforms-pro' ), n );
}

/** Who booked: the name, else the e-mail address. */
function visitorName( a: AppointmentItem ): string {
	return a.visitor.name || a.visitor.email || sprintf( __( 'Entry #%d', 'funnelforms-pro' ), a.entryId );
}

export function stateLabel( state: AppointmentState ): string {
	return {
		upcoming: __( 'Upcoming', 'funnelforms-pro' ),
		open: __( 'To mark', 'funnelforms-pro' ),
		done: __( 'Done', 'funnelforms-pro' ),
		noshow: __( 'No-show', 'funnelforms-pro' ),
		cancelled: __( 'Cancelled', 'funnelforms-pro' ),
	}[ state ];
}

const TONES: Record<AppointmentState, string> = { upcoming: 'info', open: 'warning', done: 'success', noshow: 'danger', cancelled: '' };

function StateBadge( { state }: { state: AppointmentState } ) {
	return <span className={ 'ffx-badge' + ( TONES[ state ] ? ' ffx-badge--' + TONES[ state ] : '' ) }>{ stateLabel( state ) }</span>;
}

/* Icons (Lucide, ISC licence) ---------------------------------------------------------- */

const PATHS = {
	calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
	clock: 'M12 6v6l4 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
	check: 'M20 6 9 17l-5-5',
	alert: 'M12 8v4M12 16h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
	userX: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17 8l5 5M22 8l-5 5',
	left: 'm15 18-6-6 6-6',
	right: 'm9 18 6-6-6-6',
	list: 'M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13',
	week: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10 10v12M14 10v12',
	month: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 16h18M9 10v12M15 10v12',
	move: 'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h5M17.5 17.5 16 16.3V14M22 16a6 6 0 1 1-12 0 6 6 0 0 1 12 0z',
	x: 'M18 6 6 18M6 6l12 12',
	external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
	mail: 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
	undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
};

function Icon( { name }: { name: keyof typeof PATHS } ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
			<path d={ PATHS[ name ] } />
		</svg>
	);
}

/* The screen ---------------------------------------------------------------------------- */

export interface AppointmentsScreenProps {
	config: AppointmentsConfig;
	/** The API; the page's own without it. */
	client?: AppointmentsClient;
	/** Now, for tests. */
	now?: () => number;
}

export function AppointmentsScreen( { config, client: given, now: clock = Date.now }: AppointmentsScreenProps ) {
	const client = useMemo( () => given ?? new AppointmentsClient( config.root, config.nonce ), [ given, config.root, config.nonce ] );
	const zone = useMemo( () => zoneOf( config.timezone ), [ config.timezone ] );
	const f = useMemo( () => makeFormats( localeOf( config.userLocale ), zone ), [ config.userLocale, zone ] );
	const [ page, setPage ] = useState<PageState>( () => stateFromAddress( window.location.search ) );
	const today = dayOf( clock(), zone );
	const day = page.day || today;
	const range = useMemo( () => rangeOf( page.view, day, config.weekStart ), [ page.view, day, config.weekStart ] );
	const [ items, setItems ] = useState<AppointmentItem[] | null>( null );
	const [ recent, setRecent ] = useState<AppointmentItem[] | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ version, setVersion ] = useState( 0 );
	const [ open, setOpen ] = useState<AppointmentItem | null>( null );
	const [ said, say ] = useState( '' );

	const go = useCallback( ( changes: Partial<PageState> ) => {
		setPage( ( p ) => {
			const next = { ...p, ...changes };
			const url = addressOf( next, window.location.href );
			if ( url !== window.location.href ) {
				window.history.replaceState( null, '', url );
			}
			return next;
		} );
	}, [] );
	const setFilter = ( changes: Partial<Filter> ): void => go( { filter: { ...page.filter, ...changes } } );

	// The appointments of the days shown.
	useEffect( () => {
		let live = true;
		setError( null );
		client.list( range.from, range.to ).then(
			( list ) => live && setItems( list ),
			( e: unknown ) => {
				if ( live ) {
					setItems( [] );
					setError( e instanceof Error ? e.message : String( e ) );
				}
			}
		);
		return () => {
			live = false;
		};
	}, [ client, range.from, range.to, version ] );

	// The last 30 and the next 7 days, for the key figures.
	useEffect( () => {
		let live = true;
		client.list( addDays( today, -30 ), addDays( today, 7 ) ).then(
			( list ) => live && setRecent( list ),
			() => live && setRecent( [] )
		);
		return () => {
			live = false;
		};
	}, [ client, today, version ] );

	const changed = ( updated: AppointmentItem, message: string ): void => {
		setItems( ( list ) => list && list.map( ( a ) => ( a.id === updated.id ? updated : a ) ) );
		setOpen( ( current ) => ( current && current.id === updated.id ? updated : current ) );
		say( message );
		setVersion( ( v ) => v + 1 );
	};

	const now = clock();
	const shown = items ? filtered( items, page.filter, config.user, now ) : [];
	const numbers = items ? counts( items, page.filter, config.user, now ) : null;
	const target = typeof document === 'undefined' ? null : document.getElementById( 'funnelforms-appointments-actions' );
	const views = <ViewSwitch view={ page.view } onChange={ ( view ) => go( { view } ) } />;

	return (
		<div className="ffx-appt">
			{ config.canEditTypes ? (
				<nav className="ffx-tabs" aria-label={ __( 'Sections', 'funnelforms-pro' ) }>
					{ ( [ [ 'calendar', __( 'Appointments', 'funnelforms-pro' ), 'calendar' ], [ 'types', __( 'Appointment types', 'funnelforms-pro' ), 'clock' ], [ 'mails', __( 'Mails', 'funnelforms-pro' ), 'mail' ] ] as const ).map( ( [ tab, label, icon ] ) => (
						<a
							key={ tab }
							href={ addressOf( { ...page, tab }, window.location.href ) }
							aria-current={ tab === page.tab ? 'page' : undefined }
							onClick={ ( e ) => {
								e.preventDefault();
								go( { tab } );
							} }
						>
							<Icon name={ icon } />
							<span>{ label }</span>
						</a>
					) ) }
				</nav>
			) : null }

			{ 'types' === page.tab && config.canEditTypes ? <TypesTab root={ config.root } nonce={ config.nonce } canConnect={ !! config.canConnect } say={ say } /> : null }
			{ 'mails' === page.tab && config.canEditTypes ? <MailsTab client={ client } say={ say } /> : null }
			{ 'calendar' !== page.tab && config.canEditTypes ? null : (
				<>
					{ target && 'calendar' === page.tab ? createPortal( views, target ) : null }
					<KeyFigures items={ recent } zone={ zone } now={ now } f={ f } onOpenList={ ( first ) => go( { view: 'list', day: first, filter: { ...page.filter, status: 'open' } } ) } />
					<section className="ffx-card ffx-card--flush ffx-section ffx-appt-board" aria-labelledby="ffx-appt-range">
						<div className="ffx-appt-toolbar">
							<div className="ffx-appt-nav">
								<button type="button" className="ffx-btn ffx-btn--sm" onClick={ () => go( { day: '' } ) } disabled={ ! page.day || page.day === today }>
									{ __( 'Today', 'funnelforms-pro' ) }
								</button>
								<span className="ffx-appt-nav__arrows">
									<button type="button" className="ffx-btn ffx-btn--sm ffx-btn--ghost ffx-appt-icon" aria-label={ __( 'Earlier', 'funnelforms-pro' ) } title={ __( 'Earlier', 'funnelforms-pro' ) } onClick={ () => go( { day: step( page.view, day, -1 ) } ) }>
										<Icon name="left" />
									</button>
									<button type="button" className="ffx-btn ffx-btn--sm ffx-btn--ghost ffx-appt-icon" aria-label={ __( 'Later', 'funnelforms-pro' ) } title={ __( 'Later', 'funnelforms-pro' ) } onClick={ () => go( { day: step( page.view, day, 1 ) } ) }>
										<Icon name="right" />
									</button>
								</span>
								<h2 id="ffx-appt-range" className="ffx-appt-nav__label">
									{ f.range( 'month' === page.view ? startOfMonth( day ) : range.from, range.to, page.view ) }
								</h2>
							</div>
							{ target ? null : views }
						</div>
						<Filters config={ config } filter={ page.filter } numbers={ numbers } onChange={ setFilter } />
						{ error ? (
							<div className="ffx-notice ffx-notice--danger ffx-appt-error" role="alert">
								<p>{ error }</p>
							</div>
						) : null }
						{ null === items ? (
							<p className="ffx-appt-loading" role="status">
								{ __( 'Loading appointments…', 'funnelforms-pro' ) }
							</p>
						) : 'list' === page.view ? (
							<Agenda items={ shown } days={ range.days } today={ today } f={ f } now={ now } onOpen={ setOpen } />
						) : 'week' === page.view ? (
							<Week items={ shown } days={ range.days } today={ today } f={ f } now={ now } onOpen={ setOpen } />
						) : (
							<Month items={ shown } days={ range.days } month={ day.slice( 0, 7 ) } today={ today } f={ f } now={ now } onOpen={ setOpen } onDay={ ( d ) => go( { view: 'list', day: d } ) } />
						) }
					</section>
				</>
			) }

			{ open ? <AppointmentDialog appointment={ open } client={ client } config={ config } f={ f } now={ clock } onChanged={ changed } onClose={ () => setOpen( null ) } /> : null }
			<p className="screen-reader-text" aria-live="polite">
				{ said }
			</p>
		</div>
	);
}

function ViewSwitch( { view, onChange }: { view: View; onChange: ( view: View ) => void } ) {
	const labels: Record<View, string> = { list: __( 'List', 'funnelforms-pro' ), week: __( 'Week', 'funnelforms-pro' ), month: __( 'Month', 'funnelforms-pro' ) };
	return (
		<div className="ffx-appt-switch" role="group" aria-label={ __( 'View', 'funnelforms-pro' ) }>
			{ ( [ 'list', 'week', 'month' ] as const ).map( ( v ) => (
				<button key={ v } type="button" aria-pressed={ v === view } onClick={ () => onChange( v ) }>
					<Icon name={ v } />
					<span>{ labels[ v ] }</span>
				</button>
			) ) }
		</div>
	);
}

/* Key figures --------------------------------------------------------------------------- */

function KeyFigures( { items, zone, now, f, onOpenList }: { items: AppointmentItem[] | null; zone: string | undefined; now: number; f: Formats; onOpenList: ( first: string ) => void } ) {
	const n = items ? figures( items, zone, now ) : null;
	const value = ( v: number | undefined ): string => ( undefined === v ? '–' : v.toLocaleString( f.locale ) );
	const hours = n ? Math.round( n.weekMinutes / 6 ) / 10 : 0;
	return (
		<div className="ffx-grid ffx-section ffx-appt-kpis">
			<Kpi icon="calendar" label={ __( 'Today', 'funnelforms-pro' ) } value={ value( n?.today ) }>
				{ n?.nextToday ? sprintf( __( 'Next at %1$s: %2$s', 'funnelforms-pro' ), f.time( n.nextToday.start ), visitorName( n.nextToday ) ) : n && n.today ? __( 'None left for today', 'funnelforms-pro' ) : __( 'Nothing booked for today', 'funnelforms-pro' ) }
			</Kpi>
			<Kpi icon="clock" label={ __( 'Next 7 days', 'funnelforms-pro' ) } value={ value( n?.week ) }>
				{ sprintf( __( '%s hours booked', 'funnelforms-pro' ), hours.toLocaleString( f.locale ) ) }
			</Kpi>
			<Kpi icon="alert" label={ __( 'To mark', 'funnelforms-pro' ) } value={ value( n?.open ) } tone={ n && n.open ? 'warning' : '' }>
				{ n && n.firstOpen ? (
					<button type="button" className="ffx-appt-link" onClick={ () => onOpenList( n.firstOpen ?? '' ) }>
						{ __( 'Mark as done or no-show', 'funnelforms-pro' ) }
					</button>
				) : (
					__( 'Past appointments of the last 30 days', 'funnelforms-pro' )
				) }
			</Kpi>
			<Kpi icon="userX" label={ __( 'No-shows', 'funnelforms-pro' ) } value={ value( n?.noshow ) }>
				{ n && n.past ? sprintf( __( '%1$s %% of %2$d past appointments, last 30 days', 'funnelforms-pro' ), Math.round( ( 100 * n.noshow ) / n.past ).toLocaleString( f.locale ), n.past ) : __( 'Last 30 days', 'funnelforms-pro' ) }
			</Kpi>
		</div>
	);
}

function Kpi( { icon, label, value, tone = '', children }: { icon: keyof typeof PATHS; label: string; value: string; tone?: string; children: React.ReactNode } ) {
	return (
		<div className={ 'ffx-card ffx-kpi ffx-appt-kpi' + ( tone ? ' is-' + tone : '' ) }>
			<span className="ffx-kpi__label">
				<span className="ffx-kpi__icon">
					<Icon name={ icon } />
				</span>
				{ label }
			</span>
			<span className="ffx-kpi__value">{ value }</span>
			<span className="ffx-kpi__hint">{ children }</span>
		</div>
	);
}

/* Filters --------------------------------------------------------------------------------- */

function Filters( { config, filter, numbers, onChange }: { config: AppointmentsConfig; filter: Filter; numbers: Record<StatusFilter, number> | null; onChange: ( changes: Partial<Filter> ) => void } ) {
	const id = useId();
	const statuses: Array<[ StatusFilter, string ]> = [
		[ 'active', __( 'Not cancelled', 'funnelforms-pro' ) ],
		[ 'upcoming', __( 'Upcoming', 'funnelforms-pro' ) ],
		[ 'open', __( 'To mark', 'funnelforms-pro' ) ],
		[ 'done', __( 'Done', 'funnelforms-pro' ) ],
		[ 'noshow', __( 'No-show', 'funnelforms-pro' ) ],
		[ 'cancelled', __( 'Cancelled', 'funnelforms-pro' ) ],
		[ 'all', __( 'All', 'funnelforms-pro' ) ],
	];
	return (
		<div className="ffx-appt-filters">
			<div className="ffx-appt-filter">
				<label htmlFor={ id + 'status' }>{ __( 'Status', 'funnelforms-pro' ) }</label>
				<select id={ id + 'status' } value={ filter.status } onChange={ ( e ) => onChange( { status: e.target.value as StatusFilter } ) }>
					{ statuses.map( ( [ value, label ] ) => (
						<option key={ value } value={ value }>
							{ numbers ? label + ' (' + numbers[ value ] + ')' : label }
						</option>
					) ) }
				</select>
			</div>
			<div className="ffx-appt-filter">
				<label htmlFor={ id + 'form' }>{ __( 'Form', 'funnelforms-pro' ) }</label>
				<select id={ id + 'form' } value={ filter.form } onChange={ ( e ) => onChange( { form: Number( e.target.value ) } ) }>
					<option value={ 0 }>{ __( 'All forms', 'funnelforms-pro' ) }</option>
					{ config.forms.map( ( form ) => (
						<option key={ form.id } value={ form.id }>
							{ form.title }
						</option>
					) ) }
				</select>
			</div>
			<div className="ffx-appt-filter">
				<label htmlFor={ id + 'type' }>{ __( 'Appointment type', 'funnelforms-pro' ) }</label>
				<select id={ id + 'type' } value={ filter.type } onChange={ ( e ) => onChange( { type: e.target.value } ) }>
					<option value="">{ __( 'All appointment types', 'funnelforms-pro' ) }</option>
					{ config.types.map( ( type ) => (
						<option key={ type.ref } value={ type.ref }>
							{ type.title }
						</option>
					) ) }
				</select>
			</div>
			<label className="ffx-appt-mine">
				<input type="checkbox" checked={ filter.mine } onChange={ ( e ) => onChange( { mine: e.target.checked } ) } />
				<span>{ __( 'Only mine', 'funnelforms-pro' ) }</span>
			</label>
		</div>
	);
}

/* Views ----------------------------------------------------------------------------------- */

interface ViewProps {
	items: AppointmentItem[];
	days: string[];
	today: string;
	f: Formats;
	now: number;
	onOpen: ( a: AppointmentItem ) => void;
}

function label( a: AppointmentItem, f: Formats, now: number ): string {
	return [ f.long( a.start ), visitorName( a ), a.type?.title ?? '', stateLabel( stateOf( a, now ) ) ].filter( Boolean ).join( ', ' );
}

function Empty( { children }: { children: React.ReactNode } ) {
	return (
		<div className="ffx-empty ffx-appt-empty">
			<span className="ffx-empty__mark" aria-hidden="true">
				<Icon name="calendar" />
			</span>
			<h3>{ __( 'No appointments in these days', 'funnelforms-pro' ) }</h3>
			<p>{ children }</p>
		</div>
	);
}

function Agenda( { items, days, today, f, now, onOpen }: ViewProps ) {
	const zone = f.zone;
	const grouped = byDay( items, zone );
	const shown = days.filter( ( d ) => grouped.has( d ) );
	if ( ! shown.length ) {
		return <Empty>{ __( 'Go to later days, or change the filters.', 'funnelforms-pro' ) }</Empty>;
	}
	return (
		<ol className="ffx-appt-agenda">
			{ shown.map( ( d ) => {
				const list = grouped.get( d ) ?? [];
				return (
					<li key={ d } className={ 'ffx-appt-day' + ( d === today ? ' is-today' : '' ) }>
						<h3 className="ffx-appt-day__head">
							<span className="ffx-appt-day__date">{ f.day( d ) }</span>
							{ d === today ? <span className="ffx-badge ffx-badge--info">{ __( 'Today', 'funnelforms-pro' ) }</span> : null }
							<span className="ffx-appt-day__count">{ appointmentsCount( list.length ) }</span>
						</h3>
						<ul className="ffx-appt-rows">
							{ list.map( ( a ) => (
								<AgendaRow key={ a.id } a={ a } f={ f } now={ now } onOpen={ onOpen } />
							) ) }
						</ul>
					</li>
				);
			} ) }
		</ol>
	);
}

function AgendaRow( { a, f, now, onOpen }: { a: AppointmentItem; f: Formats; now: number; onOpen: ( a: AppointmentItem ) => void } ) {
	const state = stateOf( a, now );
	const contact = [ a.visitor.email, a.visitor.phone ].filter( Boolean ).join( ' · ' );
	const what = [ a.type?.title ?? __( 'Deleted appointment type', 'funnelforms-pro' ), a.form?.title ?? '' ].filter( Boolean ).join( ' · ' );
	return (
		<li className={ 'ffx-appt-row is-' + state }>
			<span className="ffx-appt-row__time">
				<strong>{ f.time( a.start ) }</strong>
				<span>{ f.time( a.end ) }</span>
			</span>
			<button type="button" className="ffx-appt-row__main" onClick={ () => onOpen( a ) } aria-label={ label( a, f, now ) }>
				<span className="ffx-appt-row__who">{ visitorName( a ) }</span>
				<span className="ffx-appt-row__meta">{ contact }</span>
			</button>
			<span className="ffx-appt-row__what">
				<span>{ what }</span>
				<span className="ffx-appt-row__meta">{ a.people.length ? a.people.map( ( p ) => p.name ).join( ', ' ) : duration( a.duration ) }</span>
			</span>
			<span className="ffx-appt-row__state">
				<StateBadge state={ state } />
			</span>
			<span className="ffx-appt-row__go">
				<button type="button" className="ffx-btn ffx-btn--sm ffx-btn--ghost" onClick={ () => onOpen( a ) }>
					{ __( 'Details', 'funnelforms-pro' ) }
				</button>
			</span>
		</li>
	);
}

/** Hours shown at least in the week. */
const FIRST_HOUR = 8;
const LAST_HOUR = 18;
/** Height of an hour in the week, in px. */
const HOUR = 56;

function Week( { items, days, today, f, now, onOpen }: ViewProps ) {
	const zone = f.zone;
	const grouped = byDay( items, zone );
	let first = FIRST_HOUR;
	let last = LAST_HOUR;
	for ( const a of items ) {
		const start = minutesOf( a.start, zone );
		const end = dayOf( a.end, zone ) === dayOf( a.start, zone ) ? minutesOf( a.end, zone ) : 1440;
		first = Math.min( first, Math.floor( start / 60 ) );
		last = Math.max( last, Math.ceil( end / 60 ) );
	}
	const hours = Array.from( { length: last - first }, ( _, i ) => first + i );
	const nowDay = dayOf( now, zone );
	const nowMinutes = minutesOf( now, zone );
	return (
		<div className="ffx-appt-scroll">
			<div className="ffx-appt-week" style={ { '--ffx-appt-hours': hours.length, '--ffx-appt-hour': HOUR + 'px' } as React.CSSProperties }>
				<div className="ffx-appt-week__head" aria-hidden="true">
					<span />
					{ days.map( ( d ) => (
						<span key={ d } className={ d === today ? 'is-today' : '' }>
							<small>{ f.weekdayShort( d ) }</small>
							<strong>{ Number( d.slice( 8 ) ) }</strong>
						</span>
					) ) }
				</div>
				<div className="ffx-appt-week__body">
					<div className="ffx-appt-week__hours" aria-hidden="true">
						{ hours.map( ( h ) => (
							<span key={ h }>{ f.hour( h ) }</span>
						) ) }
					</div>
					{ days.map( ( d ) => {
						const list = grouped.get( d ) ?? [];
						const placed = lanes( list );
						return (
							<div key={ d } className={ 'ffx-appt-week__col' + ( d === today ? ' is-today' : '' ) }>
								<h3 className="screen-reader-text">{ f.day( d ) + ': ' + appointmentsCount( list.length ) }</h3>
								{ d === nowDay && nowMinutes >= first * 60 && nowMinutes <= last * 60 ? <span className="ffx-appt-week__now" style={ { top: ( ( nowMinutes - first * 60 ) * HOUR ) / 60 } } aria-hidden="true" /> : null }
								{ list.map( ( a ) => {
									const state = stateOf( a, now );
									const start = minutesOf( a.start, zone );
									const end = Math.max( start + 15, dayOf( a.end, zone ) === d ? minutesOf( a.end, zone ) : 1440 );
									const lane = placed.get( a.id ) ?? { lane: 0, of: 1 };
									return (
										<button
											key={ a.id }
											type="button"
											className={ 'ffx-appt-event is-' + state + ( end - start < 40 ? ' is-short' : '' ) + ( lane.of > 1 ? ' is-lane' : '' ) }
											style={ {
												top: ( ( start - first * 60 ) * HOUR ) / 60,
												height: Math.max( 22, ( ( end - start ) * HOUR ) / 60 - 2 ),
												left: ( 100 * lane.lane ) / lane.of + '%',
												width: 100 / lane.of + '%',
											} }
											onClick={ () => onOpen( a ) }
											aria-label={ label( a, f, now ) }
											title={ lane.of > 1 ? label( a, f, now ) : undefined }
										>
											<span className="ffx-appt-event__time">{ f.time( a.start ) }</span>
											<span className="ffx-appt-event__who">{ visitorName( a ) }</span>
											<span className="ffx-appt-event__what">{ a.type?.title ?? '' }</span>
										</button>
									);
								} ) }
							</div>
						);
					} ) }
				</div>
			</div>
		</div>
	);
}

/** Appointments listed in a day of the month before "+ n more". */
const MONTH_CHIPS = 3;

function Month( { items, days, month, today, f, now, onOpen, onDay }: ViewProps & { month: string; onDay: ( day: string ) => void } ) {
	const grouped = byDay( items, f.zone );
	return (
		<div className="ffx-appt-scroll">
			<div className="ffx-appt-month">
				<div className="ffx-appt-month__head" aria-hidden="true">
					{ days.slice( 0, 7 ).map( ( d ) => (
						<span key={ d }>{ f.weekdayShort( d ) }</span>
					) ) }
				</div>
				<div className="ffx-appt-month__grid">
					{ days.map( ( d ) => {
						const list = grouped.get( d ) ?? [];
						return (
							<div key={ d } className={ 'ffx-appt-month__cell' + ( d.startsWith( month ) ? '' : ' is-other' ) + ( d === today ? ' is-today' : '' ) }>
								<h3 className="ffx-appt-month__num">
									<span aria-hidden="true">{ Number( d.slice( 8 ) ) }</span>
									<span className="screen-reader-text">{ f.day( d ) + ': ' + appointmentsCount( list.length ) }</span>
								</h3>
								{ list.slice( 0, MONTH_CHIPS ).map( ( a ) => (
									<button key={ a.id } type="button" className={ 'ffx-appt-chip is-' + stateOf( a, now ) } onClick={ () => onOpen( a ) } aria-label={ label( a, f, now ) }>
										<span className="ffx-appt-chip__time">{ f.time( a.start ) }</span>
										<span className="ffx-appt-chip__who">{ visitorName( a ) }</span>
									</button>
								) ) }
								{ list.length > MONTH_CHIPS ? (
									<button type="button" className="ffx-appt-month__more" onClick={ () => onDay( d ) }>
										{ sprintf( __( '+ %d more', 'funnelforms-pro' ), list.length - MONTH_CHIPS ) }
									</button>
								) : null }
							</div>
						);
					} ) }
				</div>
			</div>
		</div>
	);
}

/* The appointment ------------------------------------------------------------------------- */

type Mode = 'details' | 'move' | 'cancel';

function AppointmentDialog( { appointment: a, client, config, f, now, onChanged, onClose }: { appointment: AppointmentItem; client: AppointmentsClient; config: AppointmentsConfig; f: Formats; now: () => number; onChanged: ( a: AppointmentItem, message: string ) => void; onClose: () => void } ) {
	const ref = useRef<HTMLDialogElement>( null );
	const titleId = useId();
	const [ mode, setMode ] = useState<Mode>( 'details' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ done, setDone ] = useState<string | null>( null );
	const [ message, setMessage ] = useState( '' );
	// The free time chosen while moving, with how it reads.
	const [ chosen, setChosen ] = useState<{ start: string; label: string } | null>( null );
	const state = stateOf( a, now() );
	const who = visitorName( a );

	useEffect( () => {
		const dialog = ref.current;
		if ( dialog && ! dialog.open ) {
			dialog.showModal?.();
		}
	}, [] );

	const run = async ( action: () => Promise<AppointmentItem>, success: string ): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const updated = await action();
			setMode( 'details' );
			setMessage( '' );
			setChosen( null );
			setDone( success );
			onChanged( updated, success );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	const switchTo = ( next: Mode ): void => {
		setMode( next );
		setError( null );
		setDone( null );
		setChosen( null );
	};
	const entryUrl = config.entriesUrl + ( config.entriesUrl.includes( '?' ) ? '&' : '?' ) + 'entry=' + a.entryId;

	return (
		<dialog ref={ ref } className={ 'ffx-appt-dialog' + ( 'move' === mode ? ' is-wide' : '' ) } aria-labelledby={ titleId } onClose={ onClose }>
			<header className="ffx-appt-dialog__head">
				<div>
					<StateBadge state={ state } />
					<h2 id={ titleId }>{ 'move' === mode ? __( 'Choose a new time', 'funnelforms-pro' ) : 'cancel' === mode ? __( 'Cancel the appointment?', 'funnelforms-pro' ) : sprintf( __( '%1$s with %2$s', 'funnelforms-pro' ), a.type?.title ?? __( 'Appointment', 'funnelforms-pro' ), who ) }</h2>
					<p className="ffx-appt-dialog__when">
						{ f.long( a.start ) } – { f.time( a.end ) } · { duration( a.duration ) }
					</p>
				</div>
				<button type="button" className="ffx-btn ffx-btn--ghost ffx-btn--sm ffx-appt-icon" aria-label={ __( 'Close', 'funnelforms-pro' ) } onClick={ () => ( ref.current?.open ? ref.current.close() : onClose() ) }>
					<Icon name="x" />
				</button>
			</header>

			<div className="ffx-appt-dialog__body">
				{ done ? (
					<div className="ffx-notice ffx-notice--success" role="status">
						<p>{ done }</p>
					</div>
				) : null }
				{ error ? (
					<div className="ffx-notice ffx-notice--danger" role="alert">
						<p>{ error }</p>
					</div>
				) : null }

				{ 'details' === mode ? <Details a={ a } f={ f } entryUrl={ entryUrl } /> : null }
				{ 'move' === mode ? <MoveTo a={ a } client={ client } f={ f } now={ now } chosen={ chosen?.start ?? '' } onChoose={ ( start, label ) => setChosen( { start, label } ) } message={ message } onMessage={ setMessage } /> : null }
				{ 'cancel' === mode ? (
					<>
						<p>{ sprintf( __( '%s and the people booked get a cancellation by e-mail. The time is free again.', 'funnelforms-pro' ), who ) }</p>
						<MessageField value={ message } onChange={ setMessage } />
					</>
				) : null }
			</div>

			<footer className="ffx-appt-dialog__foot">
				{ 'details' === mode ? (
					<>
						<a className="ffx-btn ffx-btn--ghost" href={ entryUrl }>
							<Icon name="external" />
							<span>{ __( 'Open entry', 'funnelforms-pro' ) }</span>
						</a>
						<span className="ffx-appt-dialog__spacer" />
						{ a.changeable ? (
							<>
								<button type="button" className="ffx-btn" disabled={ busy } onClick={ () => switchTo( 'cancel' ) }>
									<Icon name="x" />
									<span>{ __( 'Cancel appointment', 'funnelforms-pro' ) }</span>
								</button>
								<button type="button" className="ffx-btn ffx-btn--primary" disabled={ busy } onClick={ () => switchTo( 'move' ) }>
									<Icon name="move" />
									<span>{ __( 'Reschedule', 'funnelforms-pro' ) }</span>
								</button>
							</>
						) : null }
						{ a.markable && ! a.outcome ? (
							<>
								<button type="button" className="ffx-btn" disabled={ busy } onClick={ () => void run( () => client.mark( a, 'noshow' ), __( 'Marked as no-show.', 'funnelforms-pro' ) ) }>
									<Icon name="userX" />
									<span>{ __( 'No-show', 'funnelforms-pro' ) }</span>
								</button>
								<button type="button" className="ffx-btn ffx-btn--primary" disabled={ busy } onClick={ () => void run( () => client.mark( a, 'done' ), __( 'Marked as done.', 'funnelforms-pro' ) ) }>
									<Icon name="check" />
									<span>{ __( 'Done', 'funnelforms-pro' ) }</span>
								</button>
							</>
						) : null }
						{ a.markable && a.outcome ? (
							<button type="button" className="ffx-btn" disabled={ busy } onClick={ () => void run( () => client.mark( a, 'none' ), __( 'The mark is taken back.', 'funnelforms-pro' ) ) }>
								<Icon name="undo" />
								<span>{ __( 'Take back the mark', 'funnelforms-pro' ) }</span>
							</button>
						) : null }
					</>
				) : null }
				{ 'move' === mode ? (
					<>
						<button type="button" className="ffx-btn ffx-btn--ghost" disabled={ busy } onClick={ () => switchTo( 'details' ) }>
							{ __( 'Back', 'funnelforms-pro' ) }
						</button>
						<span className="ffx-appt-move__chosen" aria-live="polite">
							{ chosen ? sprintf( __( 'New time: %s', 'funnelforms-pro' ), chosen.label ) : '' }
						</span>
						<button type="button" className="ffx-btn ffx-btn--primary" disabled={ busy || ! chosen } onClick={ () => chosen && void run( () => client.move( a, chosen.start, message ), sprintf( __( 'The appointment is moved. %s gets the new time by e-mail.', 'funnelforms-pro' ), who ) ) }>
							{ busy ? __( 'Moving…', 'funnelforms-pro' ) : __( 'Move appointment', 'funnelforms-pro' ) }
						</button>
					</>
				) : null }
				{ 'cancel' === mode ? (
					<>
						<button type="button" className="ffx-btn ffx-btn--ghost" disabled={ busy } onClick={ () => switchTo( 'details' ) }>
							{ __( 'Back', 'funnelforms-pro' ) }
						</button>
						<button type="button" className="ffx-btn ffx-btn--danger" disabled={ busy } onClick={ () => void run( () => client.cancel( a, message ), __( 'The appointment is cancelled.', 'funnelforms-pro' ) ) }>
							{ busy ? __( 'Cancelling…', 'funnelforms-pro' ) : __( 'Cancel appointment', 'funnelforms-pro' ) }
						</button>
					</>
				) : null }
			</footer>
		</dialog>
	);
}

function Details( { a, f, entryUrl }: { a: AppointmentItem; f: Formats; entryUrl: string } ) {
	const kind = a.type ? { personal: __( 'Place', 'funnelforms-pro' ), call: __( 'Phone', 'funnelforms-pro' ), video: __( 'Video call', 'funnelforms-pro' ) }[ a.type.kind ] : '';
	const changed = a.changedBy
		? 'cancelled' === a.status
			? { visitor: __( 'Cancelled by the visitor', 'funnelforms-pro' ), team: sprintf( __( 'Cancelled by %s', 'funnelforms-pro' ), a.changedBy.name || __( 'the team', 'funnelforms-pro' ) ), system: __( 'Cancelled automatically', 'funnelforms-pro' ) }[ a.changedBy.kind ]
			: { visitor: __( 'Moved by the visitor', 'funnelforms-pro' ), team: sprintf( __( 'Moved by %s', 'funnelforms-pro' ), a.changedBy.name || __( 'the team', 'funnelforms-pro' ) ), system: '' }[ a.changedBy.kind ]
		: '';
	const zone = f.zone && a.timezone && ! [ f.zone, 'UTC' ].includes( a.timezone ) && a.timezone !== f.zone ? a.timezone : '';
	return (
		<dl className="ffx-appt-facts">
			<dt>{ __( 'Contact', 'funnelforms-pro' ) }</dt>
			<dd>
				<strong>{ a.visitor.name || '–' }</strong>
				{ a.visitor.email ? (
					<>
						<br />
						<a href={ 'mailto:' + a.visitor.email }>{ a.visitor.email }</a>
					</>
				) : null }
				{ a.visitor.phone ? (
					<>
						<br />
						<a href={ 'tel:' + a.visitor.phone.replace( /[^\d+]/g, '' ) }>{ a.visitor.phone }</a>
					</>
				) : null }
			</dd>
			<dt>{ __( 'Form', 'funnelforms-pro' ) }</dt>
			<dd>
				{ a.form?.title ?? '–' } · <a href={ entryUrl }>{ sprintf( __( 'Entry #%d', 'funnelforms-pro' ), a.entryId ) }</a>
			</dd>
			<dt>{ __( 'Appointment type', 'funnelforms-pro' ) }</dt>
			<dd>{ a.type?.title ?? __( 'Deleted appointment type', 'funnelforms-pro' ) }</dd>
			{ a.type?.location ? (
				<>
					<dt>{ kind }</dt>
					<dd>{ 'video' === a.type.kind ? <a href={ a.type.location }>{ a.type.location }</a> : a.type.location }</dd>
				</>
			) : null }
			<dt>{ __( 'Booked with', 'funnelforms-pro' ) }</dt>
			<dd>{ a.people.length ? a.people.map( ( p ) => p.name ).join( ', ' ) : __( 'Your website (no one in particular)', 'funnelforms-pro' ) }</dd>
			{ zone ? (
				<>
					<dt>{ __( 'Time zone of the type', 'funnelforms-pro' ) }</dt>
					<dd>{ zoneName( zone, f.locale ) }</dd>
				</>
			) : null }
			{ changed ? (
				<>
					<dt>{ __( 'Changed', 'funnelforms-pro' ) }</dt>
					<dd>{ changed }</dd>
				</>
			) : null }
			{ a.message ? (
				<>
					<dt>{ __( 'Message to the visitor', 'funnelforms-pro' ) }</dt>
					<dd className="ffx-appt-message">{ a.message }</dd>
				</>
			) : null }
		</dl>
	);
}

function MessageField( { value, onChange }: { value: string; onChange: ( value: string ) => void } ) {
	const id = useId();
	return (
		<div className="ffx-field ffx-appt-message-field">
			<label htmlFor={ id }>{ __( 'Message to the visitor (optional)', 'funnelforms-pro' ) }</label>
			<textarea id={ id } rows={ 3 } maxLength={ 2000 } value={ value } onChange={ ( e ) => onChange( e.target.value ) } placeholder={ __( 'It goes with the e-mail, e.g. why the time changes.', 'funnelforms-pro' ) } />
		</div>
	);
}

/** Weeks searched ahead for the first free time. */
const SEARCH_WEEKS = 8;

function MoveTo( { a, client, f, now, chosen, onChoose, message, onMessage }: { a: AppointmentItem; client: AppointmentsClient; f: Formats; now: () => number; chosen: string; onChoose: ( start: string, label: string ) => void; message: string; onMessage: ( value: string ) => void } ) {
	const today = dayOf( now(), zoneOf( a.timezone ) ?? f.zone );
	const [ from, setFrom ] = useState( today );
	const [ free, setFree ] = useState<FreeTimes | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const searched = useRef( false );
	const to = addDays( from, 6 );

	useEffect( () => {
		let live = true;
		setFree( null );
		setError( null );
		client.slots( a, from, to ).then(
			( times ) => {
				if ( ! live ) {
					return;
				}
				const any = Object.values( times.days ).some( ( list ) => list.length );
				// At first, look ahead for the first week with free times.
				if ( ! any && ! searched.current && from < addDays( today, 7 * SEARCH_WEEKS ) && ( ! times.window || to < times.window.to ) ) {
					setFrom( addDays( from, 7 ) );
					return;
				}
				searched.current = true;
				setFree( times );
			},
			( e: unknown ) => live && setError( e instanceof Error ? e.message : String( e ) )
		);
		return () => {
			live = false;
		};
	}, [ client, a, from, to, today ] );

	const zone = zoneOf( free?.timezone ?? a.timezone ) ?? f.zone;
	const time = useMemo( () => new Intl.DateTimeFormat( f.locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' } ), [ f.locale, zone ] );
	const days = Array.from( { length: 7 }, ( _, i ) => addDays( from, i ) );
	const later = ! free?.window || to < free.window.to;
	const any = free ? days.some( ( d ) => free.days[ d ]?.length ) : false;

	return (
		<div className="ffx-appt-move">
			<div className="ffx-appt-move__bar">
				<button type="button" className="ffx-btn ffx-btn--sm ffx-btn--ghost" disabled={ from <= today || ! free } onClick={ () => setFrom( from <= addDays( today, 7 ) ? today : addDays( from, -7 ) ) }>
					<Icon name="left" />
					<span>{ __( 'Earlier', 'funnelforms-pro' ) }</span>
				</button>
				<strong>{ f.range( from, to, 'week' ) }</strong>
				<button type="button" className="ffx-btn ffx-btn--sm ffx-btn--ghost" disabled={ ! later || ! free } onClick={ () => setFrom( addDays( from, 7 ) ) }>
					<span>{ __( 'Later', 'funnelforms-pro' ) }</span>
					<Icon name="right" />
				</button>
			</div>
			<p className="ffx-appt-move__zone">{ sprintf( __( 'Free times of the appointment type, in %s. The current time is not listed.', 'funnelforms-pro' ), zoneName( free?.timezone ?? a.timezone, f.locale ) ) }</p>
			{ error ? (
				<div className="ffx-notice ffx-notice--danger" role="alert">
					<p>{ error }</p>
				</div>
			) : ! free ? (
				<p className="ffx-appt-loading" role="status">
					{ __( 'Loading free times…', 'funnelforms-pro' ) }
				</p>
			) : (
				<div className="ffx-appt-slots" role="group" aria-label={ __( 'Free times', 'funnelforms-pro' ) }>
					{ days.map( ( d ) => (
						<div key={ d } className="ffx-appt-slots__day">
							<h3>
								<small>{ f.weekdayShort( d ) }</small>
								<span>{ Number( d.slice( 8 ) ) + '.' + Number( d.slice( 5, 7 ) ) + '.' }</span>
							</h3>
							{ ( free.days[ d ] ?? [] ).length ? (
								( free.days[ d ] ?? [] ).map( ( iso ) => (
									<button key={ iso } type="button" className="ffx-appt-slot" aria-pressed={ iso === chosen } aria-label={ f.day( d ) + ', ' + time.format( new Date( iso ) ) } onClick={ () => onChoose( iso, f.day( d ) + ', ' + time.format( new Date( iso ) ) ) }>
										{ time.format( new Date( iso ) ) }
									</button>
								) )
							) : (
								<span className="ffx-appt-slots__none">–</span>
							) }
						</div>
					) ) }
				</div>
			) }
			{ free && ! any ? <p className="ffx-appt-move__none">{ __( 'No free times in these days.', 'funnelforms-pro' ) }</p> : null }
			<MessageField value={ message } onChange={ onMessage } />
		</div>
	);
}

/* Mails ------------------------------------------------------------------------------------ */

function tokenLabel( token: string ): string {
	const labels: Record<string, string> = {
		'contact:name': __( 'Name of the visitor', 'funnelforms-pro' ),
		'contact:email': __( 'E-mail address of the visitor', 'funnelforms-pro' ),
		'booking:name': __( 'Name of the appointment type', 'funnelforms-pro' ),
		'booking:date': __( 'Date', 'funnelforms-pro' ),
		'booking:time': __( 'Start time', 'funnelforms-pro' ),
		'booking:end': __( 'End time', 'funnelforms-pro' ),
		'booking:duration': __( 'Duration', 'funnelforms-pro' ),
		'booking:timezone': __( 'Time zone', 'funnelforms-pro' ),
		'booking:location': __( 'Place, phone number or video link', 'funnelforms-pro' ),
		'booking:message': __( 'Message from your team', 'funnelforms-pro' ),
		'form:title': __( 'Name of the form', 'funnelforms-pro' ),
		'entry:id': __( 'Number of the entry', 'funnelforms-pro' ),
	};
	return labels[ token ] ?? '';
}

function mailInfo( kind: MailKind ): { title: string; when: string } {
	return {
		invite: { title: __( 'Confirmation', 'funnelforms-pro' ), when: __( 'Right after booking, with the calendar file.', 'funnelforms-pro' ) },
		moved: { title: __( 'New time', 'funnelforms-pro' ), when: __( 'When the visitor or your team moves the appointment.', 'funnelforms-pro' ) },
		cancel: { title: __( 'Cancellation', 'funnelforms-pro' ), when: __( 'When the visitor or your team cancels the appointment.', 'funnelforms-pro' ) },
		reminder: { title: __( 'Reminder', 'funnelforms-pro' ), when: __( 'Before the appointment, at the times set in the appointment type.', 'funnelforms-pro' ) },
	}[ kind ];
}

function MailsTab( { client, say }: { client: AppointmentsClient; say: ( text: string ) => void } ) {
	const [ settings, setSettings ] = useState<MailSettings | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ ref, setRef ] = useState( '' );
	const [ draft, setDraft ] = useState<Mails | null>( null );
	const [ busy, setBusy ] = useState( false );
	const [ saved, setSaved ] = useState<string | null>( null );
	const focused = useRef<{ kind: MailKind; part: 'subject' | 'text'; element: HTMLInputElement | HTMLTextAreaElement } | null>( null );
	const id = useId();

	useEffect( () => {
		let live = true;
		client.mails().then(
			( s ) => {
				if ( live ) {
					setSettings( s );
					setRef( s.types[ 0 ]?.ref ?? '' );
					setDraft( s.types[ 0 ] ? structuredClone( s.types[ 0 ].mails ) : null );
				}
			},
			( e: unknown ) => live && setError( e instanceof Error ? e.message : String( e ) )
		);
		return () => {
			live = false;
		};
	}, [ client ] );

	if ( error ) {
		return (
			<div className="ffx-notice ffx-notice--danger" role="alert">
				<p>{ error }</p>
			</div>
		);
	}
	if ( ! settings ) {
		return (
			<p className="ffx-appt-loading" role="status">
				{ __( 'Loading…', 'funnelforms-pro' ) }
			</p>
		);
	}
	const type = settings.types.find( ( t ) => t.ref === ref );
	if ( ! type || ! draft ) {
		return (
			<section className="ffx-card">
				<div className="ffx-empty">
					<span className="ffx-empty__mark" aria-hidden="true">
						<Icon name="mail" />
					</span>
					<h2>{ __( 'No appointment types yet', 'funnelforms-pro' ) }</h2>
					<p>{ __( 'Add a booking question to a form and create an appointment type there. Its mails can be worded here.', 'funnelforms-pro' ) }</p>
				</div>
			</section>
		);
	}
	const dirty = JSON.stringify( draft ) !== JSON.stringify( type.mails );
	const choose = ( next: string ): void => {
		if ( dirty && ! window.confirm( __( 'Discard the changes to the mails?', 'funnelforms-pro' ) ) ) {
			return;
		}
		const found = settings.types.find( ( t ) => t.ref === next );
		setRef( next );
		setDraft( found ? structuredClone( found.mails ) : null );
		setSaved( null );
	};
	const edit = ( kind: MailKind, part: 'subject' | 'text', value: string ): void => {
		setSaved( null );
		setDraft( ( d ) => d && { ...d, [ kind ]: { ...d[ kind ], [ part ]: value } } );
	};
	const insert = ( token: string ): void => {
		const at = focused.current;
		if ( ! at ) {
			return;
		}
		const result = insertAt( draft[ at.kind ][ at.part ], token, at.element.selectionStart, at.element.selectionEnd );
		edit( at.kind, at.part, result.text );
		window.requestAnimationFrame( () => {
			at.element.focus();
			at.element.setSelectionRange( result.cursor, result.cursor );
		} );
	};
	const save = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const updated = await client.saveMails( type.id, draft );
			setSettings( { ...settings, types: settings.types.map( ( t ) => ( t.ref === updated.ref ? updated : t ) ) } );
			setDraft( structuredClone( updated.mails ) );
			setSaved( __( 'The mails are saved.', 'funnelforms-pro' ) );
			say( __( 'The mails are saved.', 'funnelforms-pro' ) );
		} catch ( e ) {
			setSaved( null );
			window.alert( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	const off = ( kind: MailKind ): string => {
		if ( 'invite' === kind && ! type.invitation ) {
			return __( 'Off for this appointment type: turn on “Send an invitation with a calendar file” in its settings.', 'funnelforms-pro' );
		}
		if ( 'reminder' === kind && ! type.reminders.length ) {
			return __( 'This appointment type sends no reminders; choose them in its settings.', 'funnelforms-pro' );
		}
		return '';
	};

	return (
		<div className="ffx-appt-mails">
			<section className="ffx-card ffx-appt-mails__intro">
				<div className="ffx-card__head">
					<div>
						<h2>{ __( 'Mails to the visitor', 'funnelforms-pro' ) }</h2>
						<p>{ __( 'Your own subject and opening text for each appointment type. Leave a field empty for the standard text in the visitor’s language. The details of the appointment and the link to change it always follow.', 'funnelforms-pro' ) }</p>
					</div>
				</div>
				<div className="ffx-appt-mails__type">
					<label htmlFor={ id + 'type' }>{ __( 'Appointment type', 'funnelforms-pro' ) }</label>
					<select id={ id + 'type' } value={ ref } onChange={ ( e ) => choose( e.target.value ) }>
						{ settings.types.map( ( t ) => (
							<option key={ t.ref } value={ t.ref }>
								{ t.title }
							</option>
						) ) }
					</select>
				</div>
				<div className="ffx-appt-tokens">
					<span id={ id + 'tokens' }>{ __( 'Placeholders, inserted where the cursor is:', 'funnelforms-pro' ) }</span>
					<ul aria-labelledby={ id + 'tokens' }>
						{ settings.tokens.map( ( token ) => (
							<li key={ token }>
								<button type="button" title={ tokenLabel( token ) || token } aria-label={ sprintf( __( 'Insert %s', 'funnelforms-pro' ), tokenLabel( token ) || token ) } onMouseDown={ ( e ) => e.preventDefault() } onClick={ () => insert( token ) }>
									<code>{ '{{' + token + '}}' }</code>
									<span>{ tokenLabel( token ) }</span>
								</button>
							</li>
						) ) }
					</ul>
				</div>
			</section>

			<div className="ffx-grid ffx-grid--2 ffx-appt-mails__list">
				{ MAIL_KINDS.map( ( kind ) => {
					const info = mailInfo( kind );
					const note = off( kind );
					const own = draft[ kind ].subject || draft[ kind ].text;
					return (
						<section key={ kind } className="ffx-card ffx-appt-mail" aria-labelledby={ id + kind }>
							<div className="ffx-appt-mail__head">
								<h3 id={ id + kind }>{ info.title }</h3>
								{ own ? <span className="ffx-badge ffx-badge--info">{ __( 'Own text', 'funnelforms-pro' ) }</span> : <span className="ffx-badge">{ __( 'Standard', 'funnelforms-pro' ) }</span> }
							</div>
							<p className="ffx-appt-mail__when">{ info.when }</p>
							{ note ? <p className="ffx-notice ffx-notice--warning ffx-appt-mail__off">{ note }</p> : null }
							<div className="ffx-field">
								<label htmlFor={ id + kind + 's' }>{ __( 'Subject', 'funnelforms-pro' ) }</label>
								<input
									id={ id + kind + 's' }
									type="text"
									maxLength={ 200 }
									value={ draft[ kind ].subject }
									placeholder={ settings.defaults[ kind ].subject }
									onFocus={ ( e ) => ( focused.current = { kind, part: 'subject', element: e.currentTarget } ) }
									onChange={ ( e ) => edit( kind, 'subject', e.target.value ) }
								/>
							</div>
							<div className="ffx-field">
								<label htmlFor={ id + kind + 't' }>{ __( 'Text', 'funnelforms-pro' ) }</label>
								<textarea
									id={ id + kind + 't' }
									rows={ 4 }
									maxLength={ 5000 }
									value={ draft[ kind ].text }
									placeholder={ settings.defaults[ kind ].intro }
									onFocus={ ( e ) => ( focused.current = { kind, part: 'text', element: e.currentTarget } ) }
									onChange={ ( e ) => edit( kind, 'text', e.target.value ) }
								/>
							</div>
							{ own ? (
								<button type="button" className="ffx-btn ffx-btn--ghost ffx-btn--sm" onClick={ () => setDraft( ( d ) => d && { ...d, [ kind ]: { subject: '', text: '' } } ) }>
									<Icon name="undo" />
									<span>{ __( 'Use the standard text', 'funnelforms-pro' ) }</span>
								</button>
							) : null }
						</section>
					);
				} ) }
			</div>

			<div className="ffx-appt-mails__save">
				{ saved ? (
					<span className="ffx-appt-mails__saved" role="status">
						<Icon name="check" />
						{ saved }
					</span>
				) : dirty ? (
					<span className="ffx-muted">{ __( 'Unsaved changes', 'funnelforms-pro' ) }</span>
				) : null }
				<button type="button" className="ffx-btn ffx-btn--primary" disabled={ busy || ! dirty } onClick={ () => void save() }>
					{ busy ? __( 'Saving…', 'funnelforms-pro' ) : __( 'Save mails', 'funnelforms-pro' ) }
				</button>
			</div>
		</div>
	);
}
