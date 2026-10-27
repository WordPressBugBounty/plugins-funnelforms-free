/**
 * Funnelforms → Integrations: the overview of all services on top (IntegrationsHub), then the
 * calendars of the website and its team. Connect Google, Microsoft, Apple iCloud or another
 * CalDAV calendar, say whose calendar it is, which of its calendars gets the appointments and
 * which are checked for busy times. CRM, newsletter and spreadsheet tools are connected in the
 * overview; webhooks and access for Zapier, Make and n8n keep the settings tab Interfaces, and the
 * page leads there.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ApiError, fixUrl, type CalendarAccount, type CalendarChoice, type CalendarsOverview, type FormsApi } from '../api';
import type { ConnectApi } from '../connect';
import type { HubApi } from '../hub';
import { CalendarDialog, type CalendarApi, type CalendarService } from './BookingTypes';
import { IntegrationsHub } from './IntegrationsHub';
import { __, sprintf } from './i18n';
import { Button, Dialog, Notice, Spinner } from './ui';

export interface IntegrationsConfig {
	root: string;
	nonce: string;
	userLocale?: string;
	appointmentsUrl?: string;
	interfacesUrl?: string;
	importUrl?: string;
	builderUrl?: string;
}

/** What the screen needs of the API; with hub and connect it shows the overview of all integrations on top. */
export type IntegrationsApi = CalendarApi & Required<Pick<FormsApi, 'calendarsOverview' | 'accountCalendars' | 'arrangeCalendar' | 'deleteConnection' | 'testConnection'>> & { hub?: HubApi; connect?: ConnectApi };

const PATHS = {
	calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
	plus: 'M5 12h14M12 5v14',
	shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
	lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z',
	eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
	unlink: 'M18.84 12.25 20.56 10.54a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75 3.45 13.46a5 5 0 0 0 7.07 7.07l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3',
	code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
	chevron: 'm6 9 6 6 6-6',
};

function Icon( { name }: { name: keyof typeof PATHS } ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
			<path d={ PATHS[ name ] } />
		</svg>
	);
}

const message = ( e: unknown ): string => ( e instanceof Error ? e.message : String( e ) );

/** The services a calendar can come from, as tiles and as the name in a row. */
function services(): Array<{ id: CalendarService; name: string; hint: string; oauth: boolean }> {
	return [
		{ id: 'google', name: 'Google Calendar', hint: __( 'Google Workspace and Gmail', 'funnelforms-pro' ), oauth: true },
		{ id: 'microsoft', name: 'Microsoft Outlook', hint: __( 'Microsoft 365, Outlook.com and Exchange Online', 'funnelforms-pro' ), oauth: true },
		{ id: 'icloud', name: 'Apple iCloud', hint: __( 'With an app-specific password', 'funnelforms-pro' ), oauth: false },
		{ id: 'caldav', name: __( 'Other calendar (CalDAV)', 'funnelforms-pro' ), hint: __( 'Nextcloud, Fastmail, mailbox.org and more', 'funnelforms-pro' ), oauth: false },
	];
}

/** Which service a connection is: CalDAV at caldav.icloud.com is iCloud. */
function serviceOf( account: CalendarAccount ): CalendarService {
	if ( 'caldav' !== account.type ) {
		return account.type;
	}
	return /icloud\.com/i.test( account.account ) ? 'icloud' : 'caldav';
}

function Mark( { service }: { service: CalendarService } ) {
	const letters: Record<CalendarService, string> = { google: 'G', microsoft: 'M', icloud: '', caldav: '' };
	return (
		<span className={ 'ffx-cal-mark ffx-cal-mark--' + service } aria-hidden="true">
			{ letters[ service ] || <Icon name="calendar" /> }
		</span>
	);
}

type TestState = { state: 'testing' } | { state: 'ok' } | { state: 'failed'; text: string };

export function IntegrationsScreen( { api, config }: { api: IntegrationsApi; config: IntegrationsConfig } ) {
	const [ data, setData ] = useState<CalendarsOverview | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ adding, setAdding ] = useState<{ service: CalendarService; again?: CalendarAccount } | null>( null );
	const [ removing, setRemoving ] = useState<CalendarAccount | null>( null );
	const [ removeError, setRemoveError ] = useState<string | null>( null );
	const [ tests, setTests ] = useState<Record<string, TestState>>( {} );
	const [ said, say ] = useState( '' );

	const reload = useCallback( async (): Promise<void> => {
		setError( null );
		try {
			setData( await api.calendarsOverview() );
		} catch ( e ) {
			setError( message( e ) );
		}
	}, [ api ] );

	useEffect( () => {
		void reload();
	}, [ reload ] );

	const test = async ( ref: string ): Promise<void> => {
		setTests( ( t ) => ( { ...t, [ ref ]: { state: 'testing' } } ) );
		try {
			await api.testConnection( ref, {} );
			setTests( ( t ) => ( { ...t, [ ref ]: { state: 'ok' } } ) );
		} catch ( e ) {
			setTests( ( t ) => ( { ...t, [ ref ]: { state: 'failed', text: message( e ) } } ) );
		}
	};

	const remove = async (): Promise<void> => {
		if ( ! removing ) {
			return;
		}
		setRemoveError( null );
		try {
			await api.deleteConnection( removing.ref );
			setRemoving( null );
			say( sprintf( __( '%s was removed.', 'funnelforms-pro' ), removing.label ) );
			await reload();
		} catch ( e ) {
			setRemoveError( message( e ) );
		}
	};

	const list = services();
	const blocked = ( s: { oauth: boolean } ): boolean => s.oauth && ! data?.website.connected;
	const date = ( iso: string ): string => {
		const d = new Date( iso );
		return Number.isNaN( d.getTime() ) ? '' : d.toLocaleDateString( ( config.userLocale ?? '' ).replace( '_', '-' ) || undefined, { day: 'numeric', month: 'short', year: 'numeric' } );
	};

	// Class instances (WpRestAdapter) keep their methods only when passed as they are.
	const hubApi = api.hub && api.connect ? ( api as IntegrationsApi & { hub: HubApi; connect: ConnectApi } ) : null;
	// A calendar tile of the overview: the dialog, or the section that says what is missing first.
	const calendarFromHub = ( service: CalendarService ): void => {
		const s = list.find( ( x ) => x.id === service );
		if ( data && s && ! blocked( s ) ) {
			setAdding( { service } );
		} else {
			document.getElementById( 'ffx-calendars-title' )?.scrollIntoView( { behavior: 'smooth', block: 'start' } );
		}
	};

	return (
		<div className="ffx-integrations">
			{ hubApi ? <IntegrationsHub api={ hubApi } config={ config } onCalendar={ calendarFromHub } stamp={ data } /> : null }
			<section className="ffx-card" aria-labelledby="ffx-calendars-title">
				<div className="ffx-card__head">
					<div>
						<h2 id="ffx-calendars-title">{ __( 'Calendars', 'funnelforms-pro' ) }</h2>
						<p>{ __( 'Busy times in your calendars cannot be booked, and every booking shows up in the calendar right away. Assign a calendar to a team member, and it counts for their appointments.', 'funnelforms-pro' ) }</p>
					</div>
				</div>

				{ data && ! data.website.connected ? (
					<div className="ffx-notice ffx-notice--info">
						<p>
							{ __( 'Google and Microsoft sign in through your Funnelforms account. Connect this website with it first; Apple iCloud and CalDAV work without.', 'funnelforms-pro' ) }{ ' ' }
							<a className="ffx-link" href={ data.website.accountUrl }>
								{ __( 'Connect the website', 'funnelforms-pro' ) }
							</a>
						</p>
					</div>
				) : null }

				<div className="ffx-cal-services" role="group" aria-label={ __( 'Connect a calendar', 'funnelforms-pro' ) }>
					{ list.map( ( s ) => (
						<button key={ s.id } type="button" className="ffx-cal-service" disabled={ ! data || blocked( s ) } onClick={ () => setAdding( { service: s.id } ) }>
							<Mark service={ s.id } />
							<span className="ffx-cal-service__text">
								<strong>{ s.name }</strong>
								<span>{ blocked( s ) ? __( 'Needs the Funnelforms account', 'funnelforms-pro' ) : s.hint }</span>
							</span>
							<span className="ffx-cal-service__add">
								<Icon name="plus" />
								<span className="screen-reader-text">{ sprintf( __( 'Connect %s', 'funnelforms-pro' ), s.name ) }</span>
							</span>
						</button>
					) ) }
				</div>

				<h3 className="ffx-cal-subtitle">{ __( 'Connected calendars', 'funnelforms-pro' ) }</h3>
				{ error ? (
					<div className="ffx-notice ffx-notice--danger" role="alert">
						<p>
							{ error }{ ' ' }
							<button type="button" className="ffx-link" onClick={ () => void reload() }>
								{ __( 'Try again', 'funnelforms-pro' ) }
							</button>
						</p>
					</div>
				) : null }
				{ ! error && ! data ? <Spinner label={ __( 'Loading…', 'funnelforms-pro' ) } /> : null }
				{ data && 0 === data.connections.length ? (
					<div className="ffx-empty ffx-cal-empty">
						<span className="ffx-empty__mark" aria-hidden="true">
							<Icon name="calendar" />
						</span>
						<h2>{ __( 'No calendar yet', 'funnelforms-pro' ) }</h2>
						<p>{ __( 'Choose your calendar above. Your appointment types then check it before anyone books.', 'funnelforms-pro' ) }</p>
					</div>
				) : null }
				{ data && data.connections.length ? (
					<ul className="ffx-cal-list">
						{ data.connections.map( ( account ) => (
							<CalendarRow
								key={ account.ref }
								account={ account }
								data={ data }
								api={ api }
								since={ date( account.createdAt ) }
								test={ tests[ account.ref ] }
								onTest={ () => void test( account.ref ) }
								onAgain={ () => setAdding( { service: serviceOf( account ), again: account } ) }
								onRemove={ () => {
									setRemoveError( null );
									setRemoving( account );
								} }
								onChanged={ ( next, text ) => {
									setData( next );
									say( text );
								} }
							/>
						) ) }
					</ul>
				) : null }
				<p className="screen-reader-text" aria-live="polite">
					{ said }
				</p>
			</section>

			<section className="ffx-card ffx-cal-privacy" aria-labelledby="ffx-cal-privacy-title">
				<h2 id="ffx-cal-privacy-title">{ __( 'What Funnelforms does with your calendars', 'funnelforms-pro' ) }</h2>
				<ul>
					<li>
						<Icon name="eye" />
						<span>{ __( 'It reads only when a calendar is busy, for the days a visitor looks at. Titles and guests of your events are not stored.', 'funnelforms-pro' ) }</span>
					</li>
					<li>
						<Icon name="calendar" />
						<span>{ __( 'It adds each booking to the main calendar, and changes or removes it when the appointment is moved or cancelled.', 'funnelforms-pro' ) }</span>
					</li>
					<li>
						<Icon name="lock" />
						<span>{ __( 'The access is stored encrypted on this website. Calendar data goes from here straight to your calendar; Funnelforms only helps with the sign-in.', 'funnelforms-pro' ) }</span>
					</li>
					<li>
						<Icon name="unlink" />
						<span>{ __( 'Remove a calendar here, or withdraw the access in your Google or Microsoft account, at any time.', 'funnelforms-pro' ) }</span>
					</li>
				</ul>
			</section>

			<section className="ffx-cal-more" aria-labelledby="ffx-cal-more-title">
				<h2 id="ffx-cal-more-title">{ __( 'More integrations', 'funnelforms-pro' ) }</h2>
				<div className="ffx-cal-more__grid">
					{ config.appointmentsUrl ? (
						<a className="ffx-card ffx-card--link" href={ config.appointmentsUrl }>
							<span className="ffx-cal-more__icon">
								<Icon name="calendar" />
							</span>
							<strong>{ __( 'Appointments', 'funnelforms-pro' ) }</strong>
							<span>{ __( 'Appointment types, availability and what is booked.', 'funnelforms-pro' ) }</span>
						</a>
					) : null }
					{ config.interfacesUrl ? (
						<a className="ffx-card ffx-card--link" href={ config.interfacesUrl }>
							<span className="ffx-cal-more__icon">
								<Icon name="code" />
							</span>
							<strong>{ __( 'Interfaces', 'funnelforms-pro' ) }</strong>
							<span>{ __( 'Webhooks, and access for Zapier, Make and n8n.', 'funnelforms-pro' ) }</span>
						</a>
					) : null }
				</div>
			</section>

			{ adding ? (
				<CalendarDialog
					api={ api }
					service={ adding.service }
					again={ adding.again ? { ref: adding.again.ref, type: adding.again.type, label: adding.again.label, error: adding.again.error } : undefined }
					onClose={ () => setAdding( null ) }
					onConnected={ ( calendar ) => {
						setAdding( null );
						say( sprintf( __( '%s is connected.', 'funnelforms-pro' ), calendar.label ) );
						setTests( ( t ) => Object.fromEntries( Object.entries( t ).filter( ( [ ref ] ) => ref !== calendar.ref ) ) );
						void reload();
					} }
				/>
			) : null }
			{ removing ? (
				<Dialog
					title={ __( 'Remove calendar', 'funnelforms-pro' ) }
					open
					onClose={ () => setRemoving( null ) }
					actions={
						<>
							<Button variant="ghost" onClick={ () => setRemoving( null ) }>
								{ __( 'Cancel', 'funnelforms-pro' ) }
							</Button>
							<Button variant="danger" onClick={ () => void remove() }>
								{ __( 'Remove', 'funnelforms-pro' ) }
							</Button>
						</>
					}
				>
					{ removeError ? <Notice tone="danger">{ removeError }</Notice> : null }
					<p>{ sprintf( __( 'Remove %s from this website? Appointments already in the calendar stay there.', 'funnelforms-pro' ), removing.label ) }</p>
					{ removing.usedBy.length ? <Notice tone="warning">{ sprintf( __( 'Appointment types that use this calendar lose it and need another calendar: %s.', 'funnelforms-pro' ), removing.usedBy.map( ( t ) => t.title ).join( ', ' ) ) }</Notice> : null }
				</Dialog>
			) : null }
		</div>
	);
}

/** One connected account: its state, whose it is, and its calendars once opened. */
function CalendarRow( {
	account,
	data,
	api,
	since,
	test,
	onTest,
	onAgain,
	onRemove,
	onChanged,
}: {
	account: CalendarAccount;
	data: CalendarsOverview;
	api: IntegrationsApi;
	since: string;
	test?: TestState;
	onTest: () => void;
	onAgain: () => void;
	onRemove: () => void;
	onChanged: ( next: CalendarsOverview, said: string ) => void;
} ) {
	const service = serviceOf( account );
	const name = services().find( ( s ) => s.id === service )?.name ?? service;
	const oauth = 'caldav' !== account.type;
	const [ open, setOpen ] = useState( false );
	const [ calendars, setCalendars ] = useState<CalendarChoice[] | null>( null );
	const [ loadError, setLoadError ] = useState<string | null>( null );
	const [ loadUrl, setLoadUrl ] = useState( '' );
	const [ saving, setSaving ] = useState( false );
	const [ problem, setProblem ] = useState<string | null>( null );
	const [ password, setPassword ] = useState( '' );

	useEffect( () => {
		if ( ! open || calendars ) {
			return;
		}
		let live = true;
		setLoadError( null );
		api.accountCalendars( account.ref ).then(
			( found ) => live && setCalendars( found ),
			( e: unknown ) => {
				if ( live ) {
					setLoadError( message( e ) );
					setLoadUrl( e instanceof ApiError ? fixUrl( e.data.url ) : '' );
				}
			}
		);
		return () => {
			live = false;
		};
	}, [ open, calendars, api, account.ref ] );

	const arrange = async ( changes: { calendar?: string; busy?: string[]; owner?: number } ): Promise<void> => {
		setSaving( true );
		setProblem( null );
		try {
			onChanged( await api.arrangeCalendar( account.ref, changes ), sprintf( __( '%s was saved.', 'funnelforms-pro' ), account.label ) );
		} catch ( e ) {
			setProblem( message( e ) );
		}
		setSaving( false );
	};

	// CalDAV: a new password when the old one stopped working; empty keeps the stored one.
	const changePassword = async (): Promise<void> => {
		setSaving( true );
		setProblem( null );
		try {
			await api.updateConnection( account.ref, { password: password.trim() } );
			setPassword( '' );
			setCalendars( null );
			onChanged( await api.calendarsOverview(), sprintf( __( '%s was saved.', 'funnelforms-pro' ), account.label ) );
		} catch ( e ) {
			setProblem( message( e ) );
		}
		setSaving( false );
	};

	let badge: React.ReactNode = <span className="ffx-badge ffx-badge--success">{ __( 'Connected', 'funnelforms-pro' ) }</span>;
	if ( 'auth_failed' === account.error ) {
		badge = <span className="ffx-badge ffx-badge--danger">{ __( 'Access expired', 'funnelforms-pro' ) }</span>;
	} else if ( account.error ) {
		badge = <span className="ffx-badge ffx-badge--warning">{ __( 'Not reachable lately', 'funnelforms-pro' ) }</span>;
	}
	if ( 'testing' === test?.state ) {
		badge = <span className="ffx-badge">{ __( 'Testing…', 'funnelforms-pro' ) }</span>;
	} else if ( 'ok' === test?.state ) {
		badge = <span className="ffx-badge ffx-badge--success">{ __( 'Works', 'funnelforms-pro' ) }</span>;
	} else if ( 'failed' === test?.state ) {
		badge = <span className="ffx-badge ffx-badge--danger">{ __( 'Not working', 'funnelforms-pro' ) }</span>;
	}
	const owner = account.owner > 0 && ! data.people.some( ( p ) => p.id === account.owner ) ? [ { id: account.owner, name: account.ownerName || sprintf( __( 'User %d', 'funnelforms-pro' ), account.owner ) } ] : [];
	const people = [ ...data.people, ...owner ];
	const writable = ( calendars ?? [] ).filter( ( c ) => c.writable );
	const details = 'ffx-cal-details-' + account.ref.replace( /[^a-z0-9-]/gi, '-' );

	return (
		<li className={ 'ffx-cal-row' + ( open ? ' is-open' : '' ) }>
			<div className="ffx-cal-row__head">
				<Mark service={ service } />
				<div className="ffx-cal-row__main">
					<span className="ffx-cal-row__title">{ account.label }</span>
					<span className="ffx-cal-row__meta">
						{ [ name, account.account, since ? sprintf( __( 'since %s', 'funnelforms-pro' ), since ) : '', account.removable ? '' : __( 'From Funnelforms 3', 'funnelforms-pro' ) ].filter( Boolean ).join( ' · ' ) }
					</span>
				</div>
				<div className="ffx-cal-row__state" aria-live="polite">
					{ badge }
				</div>
				<div className="ffx-cal-row__actions">
					<button type="button" className="ffx-btn ffx-btn--ghost ffx-btn--sm" aria-label={ sprintf( __( 'Test %s', 'funnelforms-pro' ), account.label ) } disabled={ 'testing' === test?.state } onClick={ onTest }>
						{ __( 'Test', 'funnelforms-pro' ) }
					</button>
					{ oauth && ( 'auth_failed' === account.error || 'failed' === test?.state ) ? (
						<button type="button" className="ffx-btn ffx-btn--primary ffx-btn--sm" disabled={ ! data.website.connected } onClick={ onAgain }>
							{ __( 'Connect again', 'funnelforms-pro' ) }
						</button>
					) : null }
					<button type="button" className="ffx-btn ffx-btn--sm" aria-expanded={ open } aria-controls={ details } onClick={ () => setOpen( ! open ) }>
						<span>{ __( 'Calendars', 'funnelforms-pro' ) }</span>
						<Icon name="chevron" />
					</button>
					<button
						type="button"
						className="ffx-btn ffx-btn--ghost ffx-btn--sm"
						aria-label={ sprintf( __( 'Remove %s', 'funnelforms-pro' ), account.label ) }
						title={ account.removable ? undefined : __( 'This calendar came from Funnelforms 3 and is still used there.', 'funnelforms-pro' ) }
						disabled={ ! account.removable }
						onClick={ onRemove }
					>
						{ __( 'Remove', 'funnelforms-pro' ) }
					</button>
				</div>
			</div>
			{ 'failed' === test?.state ? (
				<p className="ffx-cal-row__problem" role="alert">
					{ test.text }
				</p>
			) : null }

			<div className="ffx-cal-row__body">
				<label className="ffx-cal-field">
					<span className="ffx-cal-field__label">{ __( 'Belongs to', 'funnelforms-pro' ) }</span>
					<select value={ account.owner } disabled={ saving } onChange={ ( e ) => void arrange( { owner: Number( e.target.value ) } ) }>
						<option value={ 0 }>{ __( 'The website (counts for everyone)', 'funnelforms-pro' ) }</option>
						{ people.map( ( p ) => (
							<option key={ p.id } value={ p.id }>
								{ p.name }
							</option>
						) ) }
					</select>
				</label>
				<p className="ffx-cal-row__used">
					{ account.usedBy.length
						? sprintf( __( 'Counts for: %s', 'funnelforms-pro' ), account.usedBy.map( ( t ) => t.title ).join( ', ' ) )
						: account.owner > 0
						? __( 'Counts for the appointment types that book this person, once there are some.', 'funnelforms-pro' )
						: __( 'No appointment type uses it yet. Choose it in an appointment type under Calendars.', 'funnelforms-pro' ) }
				</p>
				{ ! oauth && account.removable ? (
					<form
						className="ffx-cal-field"
						onSubmit={ ( e ) => {
							e.preventDefault();
							if ( password.trim() ) {
								void changePassword();
							}
						} }
					>
						<span className="ffx-cal-field__label">{ __( 'New password', 'funnelforms-pro' ) }</span>
						<input type="password" autoComplete="new-password" aria-label={ __( 'New password', 'funnelforms-pro' ) } value={ password } disabled={ saving } onChange={ ( e ) => setPassword( e.target.value ) } />
						<span className="ffx-cal-field__hint">{ __( 'Empty keeps the current password.', 'funnelforms-pro' ) }</span>
						<button type="submit" className="ffx-btn ffx-btn--sm" disabled={ saving || ! password.trim() }>
							{ __( 'Save password', 'funnelforms-pro' ) }
						</button>
					</form>
				) : null }
			</div>

			{ open ? (
				<div className="ffx-cal-row__calendars" id={ details }>
					{ loadError ? (
						<div className="ffx-notice ffx-notice--danger">
							<p>
								{ sprintf( __( 'The calendars could not be read: %s', 'funnelforms-pro' ), loadError ) }{ ' ' }
								{ loadUrl ? (
									<>
										<a className="ffx-link" href={ loadUrl }>
											{ __( 'Connect the website', 'funnelforms-pro' ) }
										</a>{ ' ' }
									</>
								) : null }
								<button type="button" className="ffx-link" onClick={ () => setCalendars( null ) }>
									{ __( 'Try again', 'funnelforms-pro' ) }
								</button>
							</p>
						</div>
					) : null }
					{ ! loadError && ! calendars ? <Spinner label={ __( 'Reading the calendars…', 'funnelforms-pro' ) } /> : null }
					{ calendars ? (
						<>
							<label className="ffx-cal-field">
								<span className="ffx-cal-field__label">{ __( 'Main calendar', 'funnelforms-pro' ) }</span>
								<select value={ account.calendar } disabled={ saving || ! writable.length } onChange={ ( e ) => void arrange( { calendar: e.target.value } ) }>
									{ writable.some( ( c ) => c.id === account.calendar ) ? null : <option value={ account.calendar }>{ account.label }</option> }
									{ writable.map( ( c ) => (
										<option key={ c.id } value={ c.id }>
											{ c.name }
										</option>
									) ) }
								</select>
								<span className="ffx-cal-field__hint">{ __( 'Gets the appointments.', 'funnelforms-pro' ) }</span>
							</label>
							<fieldset className="ffx-cal-busy">
								<legend>{ __( 'Check for busy times', 'funnelforms-pro' ) }</legend>
								{ calendars.map( ( c ) => (
									<label key={ c.id } className="ffx-check">
										<input
											type="checkbox"
											checked={ account.busy.includes( c.id ) }
											disabled={ saving }
											onChange={ ( e ) => void arrange( { busy: e.target.checked ? [ ...account.busy, c.id ] : account.busy.filter( ( id ) => id !== c.id ) } ) }
										/>
										<span>
											{ c.name }
											{ c.writable ? null : <span className="ffx-muted">{ ' · ' + __( 'read only', 'funnelforms-pro' ) }</span> }
										</span>
									</label>
								) ) }
								<span className="ffx-cal-field__hint">{ __( 'Add shared or family calendars, so their events block times too.', 'funnelforms-pro' ) }</span>
							</fieldset>
						</>
					) : null }
				</div>
			) : null }
			{ problem ? (
				<p className="ffx-cal-row__problem" role="alert">
					{ problem }
				</p>
			) : null }
		</li>
	);
}
