/**
 * Funnelforms → Integrations, section Video meetings: video call types can get a meeting of their
 * own for each appointment. Google Meet and Microsoft Teams come with the connected Google and
 * Microsoft calendars; Zoom accounts are connected here (sign-in through the Funnelforms broker)
 * and can belong to a team member, whose appointments are then held in their Zoom.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ApiError, fixUrl, type CalendarConnection, type CalendarsOverview, type ZoomAccount } from '../api';
import { waitForSignIn, type CalendarApi, type CalendarService } from './BookingTypes';
import { __, sprintf } from './i18n';
import { Button, Dialog, Notice } from './ui';

/** What the section needs of the API. */
export interface MeetingsApi extends CalendarApi {
	arrangeCalendar( ref: string, changes: { owner?: number } ): Promise<CalendarsOverview>;
	deleteConnection( ref: string ): Promise<void>;
}

const message = ( e: unknown ): string => ( e instanceof Error ? e.message : String( e ) );

/** Marks of the three services, in their colours (styles in admin.css). */
function Mark( { service }: { service: 'zoom' | 'meet' | 'teams' } ) {
	return (
		<span className={ 'ffx-cal-mark ffx-cal-mark--' + service } aria-hidden="true">
			{ { zoom: 'Z', meet: 'M', teams: 'T' }[ service ] }
		</span>
	);
}

export function MeetingsSection( { data, api, onChanged, onCalendar }: { data: CalendarsOverview; api: MeetingsApi; onChanged: ( next: CalendarsOverview | null, said: string ) => void; onCalendar: ( service: CalendarService ) => void } ) {
	const [ adding, setAdding ] = useState<{ again?: ZoomAccount } | null>( null );
	const [ removing, setRemoving ] = useState<ZoomAccount | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ saving, setSaving ] = useState<string | null>( null );
	const zoom = data.zoom ?? [];
	const google = data.connections.filter( ( c ) => 'google' === c.type );
	const microsoft = data.connections.filter( ( c ) => 'microsoft' === c.type );
	const people = data.people;

	const owner = async ( account: ZoomAccount, value: number ): Promise<void> => {
		setSaving( account.ref );
		setError( null );
		try {
			onChanged( await api.arrangeCalendar( account.ref, { owner: value } ), sprintf( __( '%s was saved.', 'funnelforms-pro' ), account.label ) );
		} catch ( e ) {
			setError( message( e ) );
		} finally {
			setSaving( null );
		}
	};

	const remove = async (): Promise<void> => {
		if ( ! removing ) {
			return;
		}
		setError( null );
		try {
			await api.deleteConnection( removing.ref );
			const label = removing.label;
			setRemoving( null );
			onChanged( null, sprintf( __( '%s was removed.', 'funnelforms-pro' ), label ) );
		} catch ( e ) {
			setError( message( e ) );
		}
	};

	const calendarState = ( list: typeof google, service: 'google' | 'microsoft' ): React.ReactNode =>
		list.length ? (
			<span className="ffx-badge ffx-badge--success" title={ list.map( ( c ) => c.label ).join( ', ' ) }>
				{ __( 'Ready', 'funnelforms-pro' ) }
			</span>
		) : (
			<button type="button" className="ffx-link" disabled={ ! data.website.connected } onClick={ () => onCalendar( service ) }>
				{ 'google' === service ? __( 'Connect a Google calendar', 'funnelforms-pro' ) : __( 'Connect a Microsoft calendar', 'funnelforms-pro' ) }
			</button>
		);

	return (
		<section className="ffx-card ffx-meetings" aria-labelledby="ffx-meetings-title">
			<div className="ffx-card__head">
				<div>
					<h2 id="ffx-meetings-title">{ __( 'Video meetings', 'funnelforms-pro' ) }</h2>
					<p>{ __( 'Appointment types for video calls can create a meeting of their own for each booking. The link is in the confirmation, the reminders and the calendar entry, moves with the appointment and is removed when it is cancelled. Choose the service in the appointment type.', 'funnelforms-pro' ) }</p>
				</div>
			</div>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<ul className="ffx-cal-list ffx-meetings__services">
				<li className="ffx-cal-row">
					<div className="ffx-cal-row__head">
						<Mark service="meet" />
						<div className="ffx-cal-row__main">
							<span className="ffx-cal-row__title">Google Meet</span>
							<span className="ffx-cal-row__meta">{ __( 'Comes with your Google calendar, nothing else to connect.', 'funnelforms-pro' ) }</span>
						</div>
						<div className="ffx-cal-row__state">{ calendarState( google, 'google' ) }</div>
					</div>
				</li>
				<li className="ffx-cal-row">
					<div className="ffx-cal-row__head">
						<Mark service="teams" />
						<div className="ffx-cal-row__main">
							<span className="ffx-cal-row__title">Microsoft Teams</span>
							<span className="ffx-cal-row__meta">{ __( 'Comes with your Microsoft calendar. Needs Microsoft 365 for work or school with Teams.', 'funnelforms-pro' ) }</span>
						</div>
						<div className="ffx-cal-row__state">{ calendarState( microsoft, 'microsoft' ) }</div>
					</div>
				</li>
				<li className="ffx-cal-row">
					<div className="ffx-cal-row__head">
						<Mark service="zoom" />
						<div className="ffx-cal-row__main">
							<span className="ffx-cal-row__title">Zoom</span>
							<span className="ffx-cal-row__meta">{ data.website.connected ? __( 'Sign in with your Zoom account. Team members can connect their own.', 'funnelforms-pro' ) : __( 'Needs the Funnelforms account', 'funnelforms-pro' ) }</span>
						</div>
						<div className="ffx-cal-row__actions">
							<button type="button" className="ffx-btn ffx-btn--primary ffx-btn--sm" disabled={ ! data.website.connected } onClick={ () => setAdding( {} ) }>
								{ __( 'Connect Zoom', 'funnelforms-pro' ) }
							</button>
						</div>
					</div>
				</li>
			</ul>
			{ zoom.length ? (
				<>
					<h3 className="ffx-cal-subtitle">{ __( 'Connected Zoom accounts', 'funnelforms-pro' ) }</h3>
					<ul className="ffx-cal-list">
						{ zoom.map( ( account ) => (
							<li key={ account.ref } className="ffx-cal-row">
								<div className="ffx-cal-row__head">
									<Mark service="zoom" />
									<div className="ffx-cal-row__main">
										<span className="ffx-cal-row__title">{ account.label }</span>
										<span className="ffx-cal-row__meta">{ account.usedBy.length ? sprintf( __( 'Used by: %s', 'funnelforms-pro' ), account.usedBy.map( ( t ) => t.title ).join( ', ' ) ) : __( 'Not used by an appointment type yet.', 'funnelforms-pro' ) }</span>
									</div>
									<div className="ffx-cal-row__state">
										{ 'auth_failed' === account.error ? <span className="ffx-badge ffx-badge--danger">{ __( 'Access expired', 'funnelforms-pro' ) }</span> : <span className="ffx-badge ffx-badge--success">{ __( 'Connected', 'funnelforms-pro' ) }</span> }
									</div>
									<div className="ffx-cal-row__actions">
										<label className="ffx-cal-field">
											<span className="ffx-cal-field__label">{ __( 'Whose account', 'funnelforms-pro' ) }</span>
											<select value={ account.owner } disabled={ saving === account.ref } onChange={ ( e ) => void owner( account, Number( e.target.value ) ) }>
												<option value={ 0 }>{ __( 'The website', 'funnelforms-pro' ) }</option>
												{ [ ...people, ...( account.owner > 0 && ! people.some( ( p ) => p.id === account.owner ) ? [ { id: account.owner, name: account.ownerName || sprintf( __( 'User %d', 'funnelforms-pro' ), account.owner ) } ] : [] ) ].map( ( p ) => (
													<option key={ p.id } value={ p.id }>
														{ p.name }
													</option>
												) ) }
											</select>
										</label>
										{ 'auth_failed' === account.error ? (
											<button type="button" className="ffx-btn ffx-btn--primary ffx-btn--sm" disabled={ ! data.website.connected } onClick={ () => setAdding( { again: account } ) }>
												{ __( 'Connect again', 'funnelforms-pro' ) }
											</button>
										) : null }
										<button type="button" className="ffx-btn ffx-btn--ghost ffx-btn--sm" aria-label={ sprintf( __( 'Remove %s', 'funnelforms-pro' ), account.label ) } onClick={ () => setRemoving( account ) }>
											{ __( 'Remove', 'funnelforms-pro' ) }
										</button>
									</div>
								</div>
							</li>
						) ) }
					</ul>
				</>
			) : null }
			{ adding ? (
				<ZoomDialog
					api={ api }
					again={ adding.again }
					onClose={ () => setAdding( null ) }
					onConnected={ ( connection ) => {
						setAdding( null );
						onChanged( null, sprintf( __( '%s is connected.', 'funnelforms-pro' ), connection.label ) );
					} }
				/>
			) : null }
			{ removing ? (
				<Dialog
					title={ __( 'Remove Zoom account', 'funnelforms-pro' ) }
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
					<p>{ sprintf( __( 'Remove %s from this website? Meetings already scheduled stay in Zoom.', 'funnelforms-pro' ), removing.label ) }</p>
					{ removing.usedBy.length ? <Notice tone="warning">{ sprintf( __( 'These appointment types then need another Zoom account: %s.', 'funnelforms-pro' ), removing.usedBy.map( ( t ) => t.title ).join( ', ' ) ) }</Notice> : null }
				</Dialog>
			) : null }
		</section>
	);
}

/** Signs in to Zoom in a window, through the Funnelforms broker; again: an account whose access ran out. */
export function ZoomDialog( { api, again, onClose, onConnected }: { api: CalendarApi; again?: ZoomAccount; onClose: () => void; onConnected: ( connection: CalendarConnection ) => void } ) {
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ accountUrl, setAccountUrl ] = useState( '' );
	const [ link, setLink ] = useState( '' );
	const attempt = useRef( 0 );
	useEffect(
		() => () => {
			attempt.current++;
		},
		[]
	);

	// The window opens right on the click, before the address is known, so browsers allow it.
	const signIn = (): void => {
		const popup = window.open( '', 'ffx-calendar', 'popup,width=520,height=720' );
		const mine = ++attempt.current;
		setBusy( true );
		setError( null );
		setAccountUrl( '' );
		void ( async () => {
			try {
				const started = await api.startCalendarSignIn( 'zoom', again?.ref );
				if ( popup && ! popup.closed ) {
					popup.location.href = started.url;
				} else {
					setLink( started.url );
				}
				const result = await waitForSignIn( api, started.state, () => mine === attempt.current );
				if ( ! result || mine !== attempt.current ) {
					return;
				}
				setBusy( false );
				setLink( '' );
				if ( ! result.ok || ! result.connection ) {
					setError( result.message ?? __( 'The sign-in did not work.', 'funnelforms-pro' ) );
					setAccountUrl( fixUrl( result.url ) );
					return;
				}
				onConnected( result.connection );
			} catch ( e ) {
				popup?.close();
				setError( message( e ) );
				setAccountUrl( e instanceof ApiError ? fixUrl( e.data.url ) : '' );
				setBusy( false );
			}
		} )();
	};

	return (
		<Dialog
			title={ again ? __( 'Connect Zoom again', 'funnelforms-pro' ) : __( 'Connect Zoom', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ busy } onClick={ signIn }>
						{ busy ? __( 'Waiting for the sign-in…', 'funnelforms-pro' ) : sprintf( __( 'Sign in to %s', 'funnelforms-pro' ), 'Zoom' ) }
					</Button>
				</>
			}
		>
			{ error ? (
				<Notice tone="danger">
					{ error }
					{ accountUrl ? (
						<>
							{ ' ' }
							<a href={ accountUrl }>{ __( 'Connect the website', 'funnelforms-pro' ) }</a>
						</>
					) : null }
				</Notice>
			) : null }
			<p>
				{ again
					? sprintf( __( 'Sign in to %s again so Funnelforms can schedule meetings for your appointments.', 'funnelforms-pro' ), again.label )
					: __( 'A window opens where you sign in to Zoom and allow Funnelforms to schedule, move and delete the meetings of your appointments. Funnelforms reads nothing else in your account.', 'funnelforms-pro' ) }
			</p>
			{ link ? (
				<Notice tone="info">
					<a href={ link } target="ffx-calendar" rel="noopener">
						{ __( 'Open the sign-in', 'funnelforms-pro' ) }
					</a>
				</Notice>
			) : null }
			<p className="ffxb-hint">{ __( 'The access is stored encrypted on this website. Meetings are scheduled straight from here in your Zoom account.', 'funnelforms-pro' ) }</p>
		</Dialog>
	);
}
