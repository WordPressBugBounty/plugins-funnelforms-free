/**
 * Appointment fields: which appointment type a field books, and the editor of the types (hours,
 * durations, who is booked, calendars). Types belong to the site, so several forms can share one.
 */
import React, { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, fixUrl, type BookingConfig, type BookingType, type BookingTypes, type CalendarChoice, type CalendarConnection, type CalendarSignIn, type FormsApi } from '../api';
import { BuilderContext, useEnv } from './context';
import { __, sprintf } from './i18n';
import { pageLocale, zoneName } from '../appointments';
import { bookingProblems, clockOf, minutesOf, noticeMinutes, noticeOf, previewSlots, spansOf, weekOf, weekSummary, WEEKDAYS, type NoticeUnit } from '../booking-hours';
import { SpecialDays, WeeklyHours } from './BookingSchedule';
import { Button, Dialog, Field, icons, Notice, NumberInput, Select, TextInput, Toggle } from './ui';

/** Reminder choices, minutes before the appointment. */
const REMINDERS = [ 15, 60, 1440, 2880 ];

/** Reminders of a new appointment type: one a day before. */
const NEW_TYPE_REMINDERS = [ 1440 ];

/** Durations offered at one click, in minutes. */
const DURATIONS = [ 15, 30, 45, 60, 90 ];

/** Most durations a type offers, as BookingType::clean() keeps them; each 5 to 720 minutes. */
export const MAX_DURATIONS = 5;

/** Start times offered: every … minutes. */
const INTERVALS = [ 5, 10, 15, 20, 30, 45, 60, 90, 120 ];

/** Problems shown at their field as soon as they come up; the others once saving was tried. */
const LIVE_PROBLEMS = [ 'no_durations', 'no_hours', 'invalid_hours', 'invalid_special', 'invalid_video_link' ];

/** Problems with a place in the form; others (from the plugin) are shown above it. */
const FIELD_PROBLEMS = [ 'no_title', 'invalid_closed', 'invalid_range', ...LIVE_PROBLEMS ];

/** A time zone in the list: its id, which people search for, with the name they read ("Europe/Berlin – Mitteleuropäische Zeit"). */
function zoneLabel( zone: string ): string {
	const id = zone.replace( /_/g, ' ' );
	const name = zoneName( zone, pageLocale() );
	return name === zone || name === id ? id : `${ id } – ${ name }`;
}

/** Whole numbers from a list such as "30, 60". */
export function minutesList( value: string ): number[] {
	return [ ...new Set( value.split( /[\s,;]+/ ).map( ( v ) => parseInt( v, 10 ) ).filter( ( n ) => Number.isFinite( n ) && n > 0 ) ) ];
}

export function reminderName( minutes: number ): string {
	if ( 0 === minutes % 1440 ) {
		return sprintf( __( '%d day(s) before', 'funnelforms-pro' ), minutes / 1440 );
	}
	if ( 0 === minutes % 60 ) {
		return sprintf( __( '%d hour(s) before', 'funnelforms-pro' ), minutes / 60 );
	}
	return sprintf( __( '%d minutes before', 'funnelforms-pro' ), minutes );
}

/** A duration as visitors read it: "45 min", "1 h", "1 h 30 min". */
export function durationName( minutes: number ): string {
	const h = Math.floor( minutes / 60 );
	const m = minutes % 60;
	return [ h ? sprintf( __( '%d h', 'funnelforms-pro' ), h ) : '', m || ! h ? sprintf( __( '%d min', 'funnelforms-pro' ), m ) : '' ].filter( Boolean ).join( ' ' );
}

export function bookingProblemText( code: string ): string {
	const texts: Record<string, string> = {
		no_title: __( 'Please enter a name.', 'funnelforms-pro' ),
		no_durations: __( 'Choose at least one duration.', 'funnelforms-pro' ),
		no_hours: __( 'Add at least one time span.', 'funnelforms-pro' ),
		invalid_hours: __( 'Each time span has to end after it starts.', 'funnelforms-pro' ),
		invalid_special: __( 'Each day with other hours needs a date, and each of its time spans has to end after it starts.', 'funnelforms-pro' ),
		invalid_closed: __( 'Choose the first and the last day.', 'funnelforms-pro' ),
		invalid_range: __( 'Choose the first and the last day.', 'funnelforms-pro' ),
		invalid_timezone: __( 'This time zone is not known.', 'funnelforms-pro' ),
		invalid_video_link: __( 'The video link has to start with https://.', 'funnelforms-pro' ),
	};
	return texts[ code ] ?? __( 'The appointment type is incomplete.', 'funnelforms-pro' );
}

/** Line icons of the editor (24px grid, currentColor), several paths each. */
const PATHS = {
	what: [ 'M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z', 'M7.5 7.5h.01' ],
	personal: [ 'M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0', 'M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' ],
	call: [ 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z' ],
	video: [ 'm16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5', 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' ],
	duration: [ 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2' ],
	hours: [ 'M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' ],
	window: [ 'M5 22h14M5 2h14', 'M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2' ],
	people: [ 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8' ],
	calendars: [ 'M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm9 16 2 2 4-4' ],
	messages: [ 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.9 1.9 0 0 0 3.4 0' ],
};

function LineIcon( { name }: { name: keyof typeof PATHS } ) {
	return (
		<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{ PATHS[ name ].map( ( d ) => (
				<path key={ d } d={ d } />
			) ) }
		</svg>
	);
}

/** A part of the editor with its icon and title. */
function Section( { icon, title, hint, children }: { icon: keyof typeof PATHS; title: string; hint?: string; children: React.ReactNode } ) {
	const id = useId();
	return (
		<section className="ffxb-bt__section" aria-labelledby={ id }>
			<header className="ffxb-bt__head">
				<span className="ffxb-bt__icon">
					<LineIcon name={ icon } />
				</span>
				<div>
					<h3 id={ id } className="ffxb-bt__title">
						{ title }
					</h3>
					{ hint ? <p className="ffxb-hint">{ hint }</p> : null }
				</div>
			</header>
			<div className="ffxb-bt__body">{ children }</div>
		</section>
	);
}

/** The text of a problem at its field, when it is shown. */
function Problem( { code, shown, id }: { code: string; shown: string[]; id?: string } ) {
	return shown.includes( code ) ? (
		<p className="ffxb-field__error" id={ id }>
			{ bookingProblemText( code ) }
		</p>
	) : null;
}

/** Weekday names, short, in the editor's language (1 Monday). */
const weekday = ( day: number ): string => new Date( 2024, 0, day ).toLocaleDateString( undefined, { weekday: 'short' } );

/** A day of the preview, e.g. "Tue, 4 Nov". */
const previewDay = ( date: string ): string => new Date( date + 'T12:00:00' ).toLocaleDateString( undefined, { weekday: 'short', day: 'numeric', month: 'short' } );


/** The appointment type of a booking field, with buttons to edit it or create one. */
export function BookingTypeField( { value, onChange }: { value: string; onChange: ( ref: string ) => void } ) {
	const { api, readOnly } = useEnv();
	const [ data, setData ] = useState<BookingTypes | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ editing, setEditing ] = useState<BookingType | 'new' | null>( null );

	useEffect( () => {
		let live = true;
		api.bookingTypes().then(
			( result ) => live && setData( result ),
			( e: unknown ) => live && setError( e instanceof Error ? e.message : String( e ) )
		);
		return () => {
			live = false;
		};
	}, [ api ] );

	if ( error ) {
		return <Notice tone="danger">{ error }</Notice>;
	}
	if ( ! data ) {
		return <p className="ffxb-hint">{ __( 'Loading…', 'funnelforms-pro' ) }</p>;
	}
	const current = data.types.find( ( t ) => t.ref === value );
	const options = [ { value: '', label: __( 'Choose an appointment type', 'funnelforms-pro' ) }, ...data.types.map( ( t ) => ( { value: t.ref, label: t.title } ) ) ];
	if ( value && ! current ) {
		options.push( { value, label: __( '(deleted appointment type)', 'funnelforms-pro' ) } );
	}
	const saved = ( type: BookingType ): void => {
		setData( ( d ) => d && { ...d, types: d.types.some( ( t ) => t.ref === type.ref ) ? d.types.map( ( t ) => ( t.ref === type.ref ? type : t ) ) : [ ...d.types, type ] } );
		onChange( type.ref );
		setEditing( null );
	};
	const deleted = ( type: BookingType ): void => {
		setData( ( d ) => d && { ...d, types: d.types.filter( ( t ) => t.ref !== type.ref ) } );
		setEditing( null );
	};

	return (
		<div className="ffxb-booking-type">
			<Select<string> label={ __( 'Appointment type', 'funnelforms-pro' ) } value={ value } options={ options } onChange={ onChange } />
			{ current?.cronofy ? <Notice tone="warning">{ __( 'This appointment type still uses the calendar connected in Funnelforms 3. Save it again here, so the new form can book it.', 'funnelforms-pro' ) }</Notice> : null }
			<div className="ffxb-booking-type__actions">
				{ current ? (
					<Button size="sm" disabled={ readOnly } onClick={ () => setEditing( current ) }>
						{ __( 'Edit appointment type', 'funnelforms-pro' ) }
					</Button>
				) : null }
				<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => setEditing( 'new' ) }>
					{ __( 'New appointment type', 'funnelforms-pro' ) }
				</Button>
			</div>
			{ editing ? <BookingTypeEditor data={ data } type={ 'new' === editing ? null : editing } onSaved={ saved } onDeleted={ deleted } onClose={ () => setEditing( null ) } /> : null }
		</div>
	);
}

/** What the editor of appointment types needs of the API. */
export type BookingEditorApi = Pick<FormsApi, 'saveBookingType' | 'deleteBookingType'> & CalendarApi;

/** Address of Funnelforms → Integrations, where calendars are connected and arranged. */
export const INTEGRATIONS_URL = 'admin.php?page=funnelforms-integrations';

/**
 * The editor of one appointment type: what it is and where it takes place, how long it lasts,
 * when it can be booked, who is booked, which calendars count and which messages go out, next to
 * a preview of what visitors see. Problems show at their field; Save goes to the plugin only when
 * there are none. In the builder it takes the builder's API; on the appointments page it gets api
 * and canConnect.
 */
export function BookingTypeEditor( { data, type, api: given, canConnect, onSaved, onDeleted, onClose }: { data: BookingTypes; type: BookingType | null; api?: BookingEditorApi; canConnect?: boolean; onSaved: ( type: BookingType ) => void; onDeleted: ( type: BookingType ) => void; onClose: () => void } ) {
	const env = useContext( BuilderContext );
	const api = ( given ?? env?.api ) as BookingEditorApi;
	const connect = canConnect ?? env?.rights.settings ?? false;
	const uid = useId();
	const [ calendars, setCalendars ] = useState( data.calendars );
	const [ connecting, setConnecting ] = useState<boolean | CalendarConnection>( false );
	const [ title, setTitle ] = useState( type?.title ?? '' );
	const [ config, setConfig ] = useState<BookingConfig>( () =>
		structuredClone( type ? { ...data.defaults, ...type.config } : { ...data.defaults, reminders: data.defaults.reminders.length ? data.defaults.reminders : NEW_TYPE_REMINDERS } )
	);
	const [ other, setOther ] = useState( '' );
	const [ notice, setNotice ] = useState( () => noticeOf( config.notice ) );
	const [ busy, setBusy ] = useState( false );
	// Saving was tried: every problem shows, and the first one gets the focus.
	const [ tried, setTried ] = useState( false );
	const [ focusProblem, setFocusProblem ] = useState( 0 );
	// Problems the plugin answered with, until the next change.
	const [ answered, setAnswered ] = useState<string[]>( [] );
	const [ error, setError ] = useState<string | null>( null );
	const main = useRef<HTMLDivElement>( null );
	const now = useMemo( () => new Date(), [] );
	const change = ( recipe: ( c: BookingConfig ) => void ): void => {
		setAnswered( [] );
		setConfig( ( c ) => {
			const next = structuredClone( c );
			recipe( next );
			return next;
		} );
	};
	const toggle = ( list: number[], item: number, on: boolean ): number[] => ( on ? [ ...list, item ].filter( ( v, i, a ) => a.indexOf( v ) === i ) : list.filter( ( v ) => v !== item ) );

	const problems = bookingProblems( title, config );
	const shown = [ ...new Set( [ ...( tried ? problems : problems.filter( ( p ) => LIVE_PROBLEMS.includes( p ) ) ), ...answered ] ) ];
	const elsewhere = answered.filter( ( p ) => ! FIELD_PROBLEMS.includes( p ) );
	const invalid = ( code: string ): boolean => shown.includes( code );
	const errorId = ( code: string ): string => `${ uid }-${ code }`;

	// The first problem shown after Save: its section scrolls into view and its field gets the focus.
	useEffect( () => {
		if ( ! focusProblem ) {
			return;
		}
		const first = main.current?.querySelector<HTMLElement>( '.ffxb-field__error' );
		const section = first?.closest( '.ffxb-bt__section' );
		const target = section?.querySelector<HTMLElement>( '[aria-invalid="true"]' ) ?? first?.parentElement?.querySelector<HTMLElement>( 'input, select, button' );
		target?.focus();
		( target ?? first )?.scrollIntoView?.( { block: 'center' } );
	}, [ focusProblem ] );

	const save = async (): Promise<void> => {
		setError( null );
		if ( problems.length ) {
			setTried( true );
			setFocusProblem( ( n ) => n + 1 );
			return;
		}
		setBusy( true );
		try {
			const special = [ ...config.special ].sort( ( a, b ) => a.date.localeCompare( b.date ) );
			onSaved( await api.saveBookingType( type?.id ?? null, title.trim(), { ...config, special, notice: noticeMinutes( notice.amount, notice.unit ) } ) );
		} catch ( e ) {
			if ( e instanceof ApiError && Array.isArray( e.data.problems ) ) {
				setTried( true );
				setAnswered( e.data.problems as string[] );
				setFocusProblem( ( n ) => n + 1 );
			} else {
				setError( e instanceof Error ? e.message : String( e ) );
			}
		}
		setBusy( false );
	};
	const remove = async (): Promise<void> => {
		if ( ! type || ! window.confirm( sprintf( __( 'Delete the appointment type %s? Booked appointments stay.', 'funnelforms-pro' ), type.title ) ) ) {
			return;
		}
		try {
			await api.deleteBookingType( type.id );
			onDeleted( type );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
	};

	// Older lib typings lack supportedValuesOf; older browsers lack it too.
	const intl = Intl as unknown as { supportedValuesOf?: ( key: string ) => string[] };
	const zones = intl.supportedValuesOf?.( 'timeZone' ) ?? [];
	const horizon = config.horizon;
	const kinds: Array<{ value: BookingConfig[ 'kind' ]; label: string; hint: string; location: string }> = [
		{ value: 'personal', label: __( 'In person', 'funnelforms-pro' ), hint: __( 'At an address', 'funnelforms-pro' ), location: __( 'Address', 'funnelforms-pro' ) },
		{ value: 'call', label: __( 'Phone call', 'funnelforms-pro' ), hint: __( 'By phone', 'funnelforms-pro' ), location: __( 'Phone number', 'funnelforms-pro' ) },
		{ value: 'video', label: __( 'Video call', 'funnelforms-pro' ), hint: __( 'Online, with a link', 'funnelforms-pro' ), location: __( 'Video link', 'funnelforms-pro' ) },
	];
	const kind = kinds.find( ( k ) => k.value === config.kind ) ?? ( kinds[ 0 ] as ( typeof kinds )[ number ] );
	const durationChoices = [ ...new Set( [ ...DURATIONS, ...config.durations ] ) ].sort( ( a, b ) => a - b );
	const full = config.durations.length >= MAX_DURATIONS;
	const otherMinutes = parseInt( other, 10 );
	const otherValid = Number.isFinite( otherMinutes ) && otherMinutes >= 5 && otherMinutes <= 720;
	const addOther = (): void => {
		if ( otherValid && ! full ) {
			change( ( c ) => void ( c.durations = toggle( c.durations, otherMinutes, true ) ) );
			setOther( '' );
		}
	};
	const intervals = [ ...new Set( [ ...INTERVALS, config.interval ] ) ].sort( ( a, b ) => a - b );
	const week = weekOf( config.hours );
	const firstSpan = WEEKDAYS.map( ( d ) => spansOf( week, d )[ 0 ] ).find( Boolean );
	const startExamples = firstSpan && Number.isFinite( minutesOf( firstSpan.from ) ) ? [ 0, 1, 2 ].map( ( i ) => clockOf( minutesOf( firstSpan.from ) + i * config.interval ) ) : [];
	const reminders = [ ...new Set( [ ...REMINDERS, ...config.reminders ] ) ].sort( ( a, b ) => a - b );
	const staffed = config.staff.length > 0;
	const writeOptions = [
		{ value: '', label: __( 'No calendar', 'funnelforms-pro' ) },
		...( staffed || 'owner' === config.calendars.write ? [ { value: 'owner', label: __( 'The calendar of the person booked', 'funnelforms-pro' ) } ] : [] ),
		...calendars.map( ( c ) => ( { value: c.ref, label: c.label } ) ),
	];

	// What visitors see, and the type in a few lines.
	const noticeNow = noticeMinutes( notice.amount, notice.unit );
	const slots = previewSlots( { ...config, notice: noticeNow }, now );
	const noticeText = 0 === noticeNow ? __( 'Right away', 'funnelforms-pro' ) : sprintf( /* translators: %s: notice, e.g. 2 h or 1 day(s) */ __( 'At the earliest %s ahead', 'funnelforms-pro' ), 'days' === notice.unit ? sprintf( /* translators: %d: number of days */ __( '%d day(s)', 'funnelforms-pro' ), notice.amount ) : durationName( noticeNow ) );
	let horizonText = __( 'Without a limit', 'funnelforms-pro' );
	if ( 'rolling' === horizon.mode ) {
		horizonText = sprintf( { day: /* translators: %d: number of days */ __( 'up to %d day(s) ahead', 'funnelforms-pro' ), week: /* translators: %d: number of weeks */ __( 'up to %d week(s) ahead', 'funnelforms-pro' ), month: /* translators: %d: number of months */ __( 'up to %d month(s) ahead', 'funnelforms-pro' ) }[ horizon.unit ], horizon.amount );
	} else if ( 'range' === horizon.mode ) {
		horizonText = horizon.from && horizon.to ? sprintf( /* translators: 1: first day, 2: last day */ __( 'from %1$s to %2$s', 'funnelforms-pro' ), previewDay( horizon.from ), previewDay( horizon.to ) ) : __( 'Between two days', 'funnelforms-pro' );
	}
	const people = data.staff.filter( ( p ) => config.staff.includes( p.id ) ).map( ( p ) => p.name );
	const summary: Array<[ string, string ]> = [
		[ __( 'Hours', 'funnelforms-pro' ), weekSummary( config.hours, weekday ) || __( 'No hours yet', 'funnelforms-pro' ) ],
		[ __( 'Bookable', 'funnelforms-pro' ), [ noticeText, horizonText, config.dailyLimit ? sprintf( /* translators: %d: most appointments per day */ __( 'at most %d per day', 'funnelforms-pro' ), config.dailyLimit ) : '' ].filter( Boolean ).join( ' · ' ) ],
		[ __( 'Breaks', 'funnelforms-pro' ), config.bufferBefore || config.bufferAfter ? sprintf( /* translators: 1: break before an appointment, 2: break after it, e.g. 10 min */ __( '%1$s before, %2$s after', 'funnelforms-pro' ), durationName( config.bufferBefore ), durationName( config.bufferAfter ) ) : __( 'None', 'funnelforms-pro' ) ],
		[
			__( 'Booked', 'funnelforms-pro' ),
			people.length ? people.join( ', ' ) + ( people.length > 1 ? ' · ' + ( 'collective' === config.assignment ? __( 'All of them together', 'funnelforms-pro' ) : __( 'One of them, in turn', 'funnelforms-pro' ) ) : '' ) : __( 'The website, one appointment at a time', 'funnelforms-pro' ),
		],
		[ __( 'Messages', 'funnelforms-pro' ), [ config.invitation ? __( 'Invitation with a calendar file', 'funnelforms-pro' ) : '', ...[ ...config.reminders ].sort( ( a, b ) => b - a ).map( reminderName ) ].filter( Boolean ).join( ' · ' ) || __( 'None', 'funnelforms-pro' ) ],
	];

	return (
		<Dialog
			title={ type ? __( 'Edit appointment type', 'funnelforms-pro' ) : __( 'New appointment type', 'funnelforms-pro' ) }
			open
			wide
			onClose={ onClose }
			actions={
				<>
					{ type ? (
						<Button variant="ghost" className="ffxb-bt__delete" onClick={ () => void remove() }>
							{ __( 'Delete', 'funnelforms-pro' ) }
						</Button>
					) : null }
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ busy } onClick={ () => void save() }>
						{ busy ? __( 'Saving…', 'funnelforms-pro' ) : __( 'Save', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			<div className="ffxb-bt">
				<div className="ffxb-bt__main" ref={ main }>
					{ tried && shown.length ? <Notice tone="danger">{ __( 'The appointment type is incomplete.', 'funnelforms-pro' ) }</Notice> : null }
					{ elsewhere.length ? (
						<Notice tone="danger">
							{ elsewhere.map( ( p ) => (
								<div key={ p }>{ bookingProblemText( p ) }</div>
							) ) }
						</Notice>
					) : null }
					{ error ? <Notice tone="danger">{ error }</Notice> : null }

					<Section icon="what" title={ __( 'What and where', 'funnelforms-pro' ) }>
						<div className={ invalid( 'no_title' ) ? 'ffxb-bt__invalid' : undefined }>
							<Field label={ __( 'Name', 'funnelforms-pro' ) } hint={ __( 'Visitors see it in the invitation, e.g. "First consultation".', 'funnelforms-pro' ) }>
								{ ( id ) => (
									<input
										id={ id }
										className="ffxb-input"
										value={ title }
										maxLength={ 190 }
										aria-invalid={ invalid( 'no_title' ) }
										aria-describedby={ invalid( 'no_title' ) ? errorId( 'no_title' ) : undefined }
										onChange={ ( e ) => ( setTitle( e.target.value ), setAnswered( [] ) ) }
									/>
								) }
							</Field>
							<Problem code="no_title" shown={ shown } id={ errorId( 'no_title' ) } />
						</div>
						<fieldset className="ffxb-bt-kinds">
							<legend className="ffxb-field__label">{ __( 'How it takes place', 'funnelforms-pro' ) }</legend>
							{ kinds.map( ( k ) => (
								<label key={ k.value } className={ 'ffxb-bt-kind' + ( k.value === config.kind ? ' is-active' : '' ) }>
									<input type="radio" name={ `${ uid }-kind` } value={ k.value } checked={ k.value === config.kind } onChange={ () => change( ( c ) => void ( c.kind = k.value ) ) } />
									<span className="ffxb-bt-kind__icon">
										<LineIcon name={ k.value } />
									</span>
									<strong>{ k.label }</strong>
									<span className="ffxb-bt-kind__hint">{ k.hint }</span>
								</label>
							) ) }
						</fieldset>
						<div className={ invalid( 'invalid_video_link' ) ? 'ffxb-bt__invalid' : undefined }>
							<Field label={ kind.location } hint={ __( 'Shown in the confirmation and in the calendar invitation.', 'funnelforms-pro' ) }>
								{ ( id ) => (
									<input
										id={ id }
										className="ffxb-input"
										type={ 'video' === config.kind ? 'url' : 'call' === config.kind ? 'tel' : 'text' }
										value={ config.location }
										placeholder={ 'video' === config.kind ? 'https://' : undefined }
										aria-invalid={ invalid( 'invalid_video_link' ) }
										aria-describedby={ invalid( 'invalid_video_link' ) ? errorId( 'invalid_video_link' ) : undefined }
										onChange={ ( e ) => change( ( c ) => void ( c.location = e.target.value ) ) }
									/>
								) }
							</Field>
							<Problem code="invalid_video_link" shown={ shown } id={ errorId( 'invalid_video_link' ) } />
						</div>
					</Section>

					<Section icon="duration" title={ __( 'Duration and breaks', 'funnelforms-pro' ) }>
						<div className="ffxb-field">
							<span className="ffxb-field__label" id={ `${ uid }-durations` }>
								{ __( 'Durations', 'funnelforms-pro' ) }
							</span>
							<div className="ffxb-bt-chips" role="group" aria-labelledby={ `${ uid }-durations` } aria-describedby={ invalid( 'no_durations' ) ? errorId( 'no_durations' ) : undefined }>
								{ durationChoices.map( ( minutes ) => {
									const on = config.durations.includes( minutes );
									return (
										<button key={ minutes } type="button" className="ffxb-bt-chip" aria-pressed={ on } disabled={ ! on && full } onClick={ () => change( ( c ) => void ( c.durations = toggle( c.durations, minutes, ! on ) ) ) }>
											{ on ? icons.check : null }
											{ durationName( minutes ) }
										</button>
									);
								} ) }
							</div>
							<Problem code="no_durations" shown={ shown } id={ errorId( 'no_durations' ) } />
							<p className="ffxb-field__hint">
								{ config.durations.length > 1
									? sprintf( /* translators: %s: duration, e.g. 30 min */ __( 'Visitors choose; %s is preselected.', 'funnelforms-pro' ), durationName( config.durations[ 0 ] ?? 0 ) )
									: sprintf( /* translators: %d: most durations */ __( 'Choose up to %d, so visitors can pick one.', 'funnelforms-pro' ), MAX_DURATIONS ) }
							</p>
						</div>
						<div className="ffxb-bt-other">
							<Field label={ __( 'Other duration (minutes)', 'funnelforms-pro' ) }>
								{ ( id ) => (
									<input
										id={ id }
										className="ffxb-input"
										type="number"
										min={ 5 }
										max={ 720 }
										step={ 5 }
										value={ other }
										disabled={ full }
										onChange={ ( e ) => setOther( e.target.value ) }
										onKeyDown={ ( e ) => {
											if ( 'Enter' === e.key ) {
												e.preventDefault();
												addOther();
											}
										} }
									/>
								) }
							</Field>
							<Button size="sm" icon={ icons.plus } disabled={ ! otherValid || full } onClick={ addOther }>
								{ __( 'Add', 'funnelforms-pro' ) }
							</Button>
						</div>
						<Select<string>
							label={ __( 'A start time every', 'funnelforms-pro' ) }
							value={ String( config.interval ) }
							options={ intervals.map( ( m ) => ( { value: String( m ), label: sprintf( __( '%d minutes', 'funnelforms-pro' ), m ) } ) ) }
							onChange={ ( v ) => change( ( c ) => void ( c.interval = Number( v ) ) ) }
							hint={ startExamples.length ? sprintf( /* translators: %s: example start times, e.g. 09:00, 09:30, 10:00 */ __( 'Start times such as %s …', 'funnelforms-pro' ), startExamples.join( ', ' ) ) : undefined }
						/>
						<div className="ffxb-pair">
							<NumberInput label={ __( 'Break before (minutes)', 'funnelforms-pro' ) } value={ config.bufferBefore } min={ 0 } max={ 240 } onChange={ ( v ) => change( ( c ) => void ( c.bufferBefore = v ?? 0 ) ) } hint={ __( 'Time to prepare, or to travel there.', 'funnelforms-pro' ) } />
							<NumberInput label={ __( 'Break after (minutes)', 'funnelforms-pro' ) } value={ config.bufferAfter } min={ 0 } max={ 240 } onChange={ ( v ) => change( ( c ) => void ( c.bufferAfter = v ?? 0 ) ) } hint={ __( 'Time for notes, or to get back.', 'funnelforms-pro' ) } />
						</div>
						<p className="ffxb-hint">{ __( 'The breaks stay free of other appointments and of busy times in your calendars.', 'funnelforms-pro' ) }</p>
					</Section>

					<Section icon="hours" title={ __( 'When you are available', 'funnelforms-pro' ) }>
						<WeeklyHours hours={ config.hours } onChange={ ( hours ) => change( ( c ) => void ( c.hours = hours ) ) } />
						<Problem code="no_hours" shown={ shown } />
						<Problem code="invalid_hours" shown={ shown } />
						<Select<string>
							label={ __( 'Time zone of the hours', 'funnelforms-pro' ) }
							value={ config.timezone }
							options={ [ { value: '', label: sprintf( __( 'Time zone of the website (%s)', 'funnelforms-pro' ), zoneName( data.timezone, pageLocale() ) ) }, ...[ ...new Set( [ ...zones, ...( config.timezone ? [ config.timezone ] : [] ) ] ) ].map( ( z ) => ( { value: z, label: zoneLabel( z ) } ) ) ] }
							onChange={ ( v ) => change( ( c ) => void ( c.timezone = v ) ) }
						/>
						<div className="ffxb-bt__sub">
							<h4 className="ffxb-bt__subtitle">{ __( 'Days with other hours', 'funnelforms-pro' ) }</h4>
							<p className="ffxb-hint">{ __( 'For example a short Christmas Eve or an open Saturday. Remove every time span to close the day.', 'funnelforms-pro' ) }</p>
							<SpecialDays special={ config.special } onChange={ ( special ) => change( ( c ) => void ( c.special = special ) ) } />
							<Problem code="invalid_special" shown={ shown } />
						</div>
						<div className="ffxb-bt__sub">
							<h4 className="ffxb-bt__subtitle">{ __( 'Closed days', 'funnelforms-pro' ) }</h4>
							<p className="ffxb-hint">{ __( 'Holidays and vacations: nothing can be booked from the first to the last day.', 'funnelforms-pro' ) }</p>
							{ config.closed.map( ( range, i ) => {
								const bad = invalid( 'invalid_closed' ) && ( ! range.from || ! range.to || range.to < range.from );
								return (
									<div key={ i } className={ 'ffxb-booking-closed' + ( bad ? ' is-invalid' : '' ) }>
										<input className="ffxb-input" type="date" aria-invalid={ bad && ! range.from } aria-label={ sprintf( __( 'From (closed days %d)', 'funnelforms-pro' ), i + 1 ) } value={ range.from } onChange={ ( e ) => change( ( c ) => void ( c.closed[ i ] && ( c.closed[ i ].from = e.target.value ) ) ) } />
										<span aria-hidden="true">–</span>
										<input className="ffxb-input" type="date" aria-invalid={ bad && !! range.from } aria-label={ sprintf( __( 'To (closed days %d)', 'funnelforms-pro' ), i + 1 ) } value={ range.to } min={ range.from || undefined } onChange={ ( e ) => change( ( c ) => void ( c.closed[ i ] && ( c.closed[ i ].to = e.target.value ) ) ) } />
										<button type="button" className="ffxb-icon-button" aria-label={ sprintf( __( 'Remove closed days %d', 'funnelforms-pro' ), i + 1 ) } title={ __( 'Remove', 'funnelforms-pro' ) } onClick={ () => change( ( c ) => void c.closed.splice( i, 1 ) ) }>
											{ icons.trash }
										</button>
									</div>
								);
							} ) }
							<Problem code="invalid_closed" shown={ shown } />
							<Button size="sm" variant="ghost" icon={ icons.plus } onClick={ () => change( ( c ) => void c.closed.push( { from: '', to: '' } ) ) }>
								{ __( 'Add closed days', 'funnelforms-pro' ) }
							</Button>
						</div>
					</Section>

					<Section icon="window" title={ __( 'Booking window', 'funnelforms-pro' ) } hint={ __( 'How soon and how far ahead visitors can book.', 'funnelforms-pro' ) }>
						<div className="ffxb-pair">
							<NumberInput label={ __( 'Bookable at the earliest', 'funnelforms-pro' ) } value={ notice.amount } min={ 0 } onChange={ ( v ) => setNotice( ( n ) => ( { ...n, amount: v ?? 0 } ) ) } hint={ __( 'From now on; 0 books right away.', 'funnelforms-pro' ) } />
							<Select<NoticeUnit>
								label={ __( 'Unit', 'funnelforms-pro' ) }
								value={ notice.unit }
								options={ [
									{ value: 'minutes', label: __( 'Minutes ahead', 'funnelforms-pro' ) },
									{ value: 'hours', label: __( 'Hours ahead', 'funnelforms-pro' ) },
									{ value: 'days', label: __( 'Days ahead', 'funnelforms-pro' ) },
								] }
								onChange={ ( v ) => setNotice( ( n ) => ( { ...n, unit: v } ) ) }
							/>
						</div>
						<Select<BookingConfig[ 'horizon' ][ 'mode' ]>
							label={ __( 'Bookable', 'funnelforms-pro' ) }
							value={ horizon.mode }
							options={ [
								{ value: 'rolling', label: __( 'For a time from today', 'funnelforms-pro' ) },
								{ value: 'range', label: __( 'Between two days', 'funnelforms-pro' ) },
								{ value: 'unlimited', label: __( 'Without a limit', 'funnelforms-pro' ) },
							] }
							onChange={ ( v ) =>
								change( ( c ) => {
									c.horizon = 'rolling' === v ? { mode: v, amount: 2, unit: 'week' } : 'range' === v ? { mode: v, from: '', to: '' } : { mode: v };
								} )
							}
						/>
						{ 'rolling' === horizon.mode ? (
							<div className="ffxb-pair">
								<NumberInput label={ __( 'Number', 'funnelforms-pro' ) } value={ horizon.amount } min={ 1 } onChange={ ( v ) => change( ( c ) => void ( 'rolling' === c.horizon.mode && ( c.horizon.amount = v ?? 1 ) ) ) } />
								<Select<'day' | 'week' | 'month'>
									label={ __( 'Unit', 'funnelforms-pro' ) }
									value={ horizon.unit }
									options={ [
										{ value: 'day', label: __( 'Days', 'funnelforms-pro' ) },
										{ value: 'week', label: __( 'Weeks', 'funnelforms-pro' ) },
										{ value: 'month', label: __( 'Months', 'funnelforms-pro' ) },
									] }
									onChange={ ( v ) => change( ( c ) => void ( 'rolling' === c.horizon.mode && ( c.horizon.unit = v ) ) ) }
								/>
							</div>
						) : null }
						{ 'range' === horizon.mode ? (
							<div className={ 'ffxb-pair' + ( invalid( 'invalid_range' ) ? ' ffxb-bt__invalid' : '' ) }>
								{ ( [ [ 'from', __( 'First day', 'funnelforms-pro' ) ], [ 'to', __( 'Last day', 'funnelforms-pro' ) ] ] as const ).map( ( [ end, label ] ) => (
									<Field key={ end } label={ label }>
										{ ( id ) => (
											<input
												id={ id }
												className="ffxb-input"
												type="date"
												value={ horizon[ end ] }
												aria-invalid={ invalid( 'invalid_range' ) && ! horizon[ end ] }
												onChange={ ( e ) => change( ( c ) => void ( 'range' === c.horizon.mode && ( c.horizon[ end ] = e.target.value ) ) ) }
											/>
										) }
									</Field>
								) ) }
							</div>
						) : null }
						<Problem code="invalid_range" shown={ shown } />
						<NumberInput label={ __( 'Appointments per day (0: no limit)', 'funnelforms-pro' ) } value={ config.dailyLimit } min={ 0 } onChange={ ( v ) => change( ( c ) => void ( c.dailyLimit = v ?? 0 ) ) } />
					</Section>

					<Section icon="people" title={ __( 'Who is booked', 'funnelforms-pro' ) } hint={ __( 'Without anyone chosen, one appointment at a time is booked for the website.', 'funnelforms-pro' ) }>
						<div className="ffxb-booking-staff">
							{ data.staff.map( ( person ) => (
								<label key={ person.id } className="ffxb-consent">
									<input
										type="checkbox"
										checked={ config.staff.includes( person.id ) }
										onChange={ ( e ) =>
											change( ( c ) => {
												c.staff = toggle( c.staff, person.id, e.target.checked );
												if ( ! c.staff.length && 'owner' === c.calendars.write ) {
													c.calendars.write = '';
												}
											} )
										}
									/>
									<span>{ person.name }</span>
								</label>
							) ) }
						</div>
						{ config.staff.length > 1 ? (
							<Select<BookingConfig[ 'assignment' ]>
								label={ __( 'Several people', 'funnelforms-pro' ) }
								value={ config.assignment }
								options={ [
									{ value: 'roundRobin', label: __( 'One of them, in turn', 'funnelforms-pro' ) },
									{ value: 'collective', label: __( 'All of them together', 'funnelforms-pro' ) },
								] }
								onChange={ ( v ) => change( ( c ) => void ( c.assignment = v ) ) }
							/>
						) : null }
					</Section>

					<Section icon="calendars" title={ __( 'Calendars', 'funnelforms-pro' ) }>
						{ calendars.length || staffed ? (
							<>
								<Select<string>
									label={ __( 'Add appointments to', 'funnelforms-pro' ) }
									value={ config.calendars.write }
									options={ writeOptions }
									onChange={ ( v ) => change( ( c ) => void ( c.calendars.write = v ) ) }
									hint={ 'owner' === config.calendars.write ? __( 'Each appointment goes into the main calendar of the person booked, as set under Integrations.', 'funnelforms-pro' ) : undefined }
								/>
								{ calendars.length ? <p className="ffxb-hint">{ __( 'Busy times in these calendars cannot be booked:', 'funnelforms-pro' ) }</p> : null }
								{ calendars.map( ( calendar ) => (
									<label key={ calendar.ref } className="ffxb-consent">
										<input
											type="checkbox"
											checked={ config.calendars.conflicts.includes( calendar.ref ) }
											onChange={ ( e ) => change( ( c ) => void ( c.calendars.conflicts = e.target.checked ? [ ...c.calendars.conflicts, calendar.ref ] : c.calendars.conflicts.filter( ( r ) => r !== calendar.ref ) ) ) }
										/>
										<span>{ calendar.label }</span>
									</label>
								) ) }
								{ staffed ? <p className="ffxb-hint">{ __( 'The calendars of the people booked count for them anyway, once they are assigned to them under Integrations.', 'funnelforms-pro' ) }</p> : null }
								{ calendars
									.filter( ( c ) => c.error && ( config.calendars.conflicts.includes( c.ref ) || config.calendars.write === c.ref ) )
									.map( ( c ) =>
										'auth_failed' === c.error && 'caldav' !== c.type ? (
											<Notice
												key={ c.ref }
												tone="warning"
												action={
													connect ? (
														<Button size="sm" onClick={ () => setConnecting( c ) }>
															{ __( 'Connect again', 'funnelforms-pro' ) }
														</Button>
													) : undefined
												}
											>
												{ sprintf( __( 'The access to %s was withdrawn or has expired. Bookings go on without its busy times until it is connected again.', 'funnelforms-pro' ), c.label ) }
											</Notice>
										) : (
											<Notice key={ c.ref } tone="warning">
												{ sprintf( __( 'The calendar %1$s could not be reached lately (%2$s). Bookings go on without its busy times.', 'funnelforms-pro' ), c.label, c.error ?? '' ) }
											</Notice>
										)
									) }
							</>
						) : (
							<p className="ffxb-hint">{ __( 'Connect a calendar (Google, Microsoft Outlook, Apple iCloud or another with CalDAV), so busy times there cannot be booked and appointments show up in it.', 'funnelforms-pro' ) }</p>
						) }
						{ connect ? (
							<div className="ffxb-booking-type__actions">
								<Button size="sm" variant="ghost" icon={ icons.plus } onClick={ () => setConnecting( true ) }>
									{ __( 'Connect calendar', 'funnelforms-pro' ) }
								</Button>
								<a className="ffxb-link" href={ INTEGRATIONS_URL } target="_blank" rel="noopener">
									{ __( 'Manage calendars under Integrations', 'funnelforms-pro' ) }
								</a>
							</div>
						) : null }
					</Section>

					<Section icon="messages" title={ __( 'Messages', 'funnelforms-pro' ) }>
						<Toggle label={ __( 'Send an invitation with a calendar file', 'funnelforms-pro' ) } checked={ config.invitation } onChange={ ( v ) => change( ( c ) => void ( c.invitation = v ) ) } />
						<p className="ffxb-hint">{ __( 'Reminders by e-mail:', 'funnelforms-pro' ) }</p>
						<div className="ffxb-bt-checks">
							{ reminders.map( ( minutes ) => (
								<label key={ minutes } className={ 'ffxb-bt-check' + ( config.reminders.includes( minutes ) ? ' is-active' : '' ) }>
									<input type="checkbox" checked={ config.reminders.includes( minutes ) } onChange={ ( e ) => change( ( c ) => void ( c.reminders = toggle( c.reminders, minutes, e.target.checked ).sort( ( a, b ) => b - a ) ) ) } />
									<span>{ reminderName( minutes ) }</span>
								</label>
							) ) }
						</div>
					</Section>
				</div>

				<aside className="ffxb-bt__preview" aria-labelledby={ `${ uid }-preview` }>
					<h3 id={ `${ uid }-preview` } className="ffxb-bt__preview-title">
						{ __( 'What visitors see', 'funnelforms-pro' ) }
					</h3>
					<div className="ffxb-bt-card">
						<div className="ffxb-bt-card__head">
							<span className="ffxb-bt-card__icon">
								<LineIcon name={ config.kind } />
							</span>
							<div>
								<strong className={ title.trim() ? undefined : 'is-empty' }>{ title.trim() || __( 'Name of the appointment', 'funnelforms-pro' ) }</strong>
								<span>{ kind.label }</span>
							</div>
						</div>
						<ul className="ffxb-bt-card__facts">
							<li>
								<LineIcon name="duration" />
								{ config.durations.length ? config.durations.map( durationName ).join( ' / ' ) : '–' }
							</li>
							<li>
								<LineIcon name={ config.kind } />
								<span className={ config.location.trim() ? undefined : 'is-empty' }>{ config.location.trim() || sprintf( /* translators: %s: Address, Phone number or Video link */ __( '%s: not entered yet', 'funnelforms-pro' ), kind.location ) }</span>
							</li>
						</ul>
						<div className="ffxb-bt-card__slots">
							{ slots.length ? (
								slots.map( ( day ) => (
									<div key={ day.date } className="ffxb-bt-day">
										<span className="ffxb-bt-day__name">{ previewDay( day.date ) }</span>
										<span className="ffxb-bt-day__times">
											{ day.times.map( ( time ) => (
												<span key={ time } className="ffxb-bt-slot">
													{ time }
												</span>
											) ) }
											{ day.more ? <span className="ffxb-bt-slot is-more">{ sprintf( /* translators: %d: number of further start times */ __( '+%d more', 'funnelforms-pro' ), day.more ) }</span> : null }
										</span>
									</div>
								) )
							) : (
								<p className="ffxb-hint">{ __( 'No free times yet: check the hours and the booking window.', 'funnelforms-pro' ) }</p>
							) }
						</div>
					</div>
					<p className="ffxb-hint">{ sprintf( /* translators: %s: name of a time zone */ __( 'Example in the time zone %s, without other appointments and busy calendar times.', 'funnelforms-pro' ), zoneName( config.timezone || data.timezone, pageLocale() ) ) }</p>
					<dl className="ffxb-bt-summary">
						{ summary.map( ( [ term, text ] ) => (
							<div key={ term }>
								<dt>{ term }</dt>
								<dd>{ text }</dd>
							</div>
						) ) }
					</dl>
				</aside>
			</div>
			{ connecting ? (
				<CalendarDialog
					again={ true === connecting ? undefined : connecting }
					api={ api }
					onClose={ () => setConnecting( false ) }
					onConnected={ ( calendar ) => {
						if ( calendars.some( ( c ) => c.ref === calendar.ref ) ) {
							setCalendars( ( list ) => list.map( ( c ) => ( c.ref === calendar.ref ? calendar : c ) ) );
						} else {
							setCalendars( ( list ) => [ ...list, calendar ] );
							change( ( c ) => {
								c.calendars.conflicts = [ ...c.calendars.conflicts, calendar.ref ];
								c.calendars.write = c.calendars.write || calendar.ref;
							} );
						}
						setConnecting( false );
					} }
				/>
			) : null }
		</Dialog>
	);
}


export type CalendarService = 'google' | 'microsoft' | 'icloud' | 'caldav';

/** What connecting a calendar needs of the API. */
export type CalendarApi = Pick<FormsApi, 'startCalendarSignIn' | 'calendarSignIn' | 'createConnection' | 'updateConnection'>;

/** Seconds a sign-in may take before the dialog stops waiting. */
const SIGN_IN_SECONDS = 900;

/**
 * Connects a calendar: Google and Microsoft by signing in, in a window, through the Funnelforms
 * broker; Apple iCloud and other CalDAV servers with an app-specific password (the server finds
 * the calendars and asks which one when there are several). again: a Google or Microsoft
 * connection whose access ran out, signed in to anew. service: the service chosen already (the
 * tiles of Funnelforms → Integrations); api: outside the builder, the API to use.
 */
export function CalendarDialog( { again, service: chosen, api: given, onClose, onConnected }: { again?: CalendarConnection; service?: CalendarService; api?: CalendarApi; onClose: () => void; onConnected: ( calendar: CalendarConnection ) => void } ) {
	const env = useContext( BuilderContext );
	const api = ( given ?? env?.api ) as CalendarApi;
	const [ service, setService ] = useState<CalendarService | null>( again && ( 'google' === again.type || 'microsoft' === again.type ) ? again.type : chosen ?? null );
	const [ url, setUrl ] = useState( '' );
	const [ username, setUsername ] = useState( '' );
	const [ password, setPassword ] = useState( '' );
	const [ label, setLabel ] = useState( '' );
	const [ choices, setChoices ] = useState<Array<{ url: string; name: string }>>( [] );
	const [ calendar, setCalendar ] = useState( '' );
	const [ signedIn, setSignedIn ] = useState<CalendarSignIn | null>( null );
	const [ link, setLink ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	// The Account page, when the website is not (or no longer) connected with Funnelforms.
	const [ accountUrl, setAccountUrl ] = useState( '' );
	// Each sign-in counts up; closing the dialog stops waiting for the last one.
	const attempt = useRef( 0 );
	useEffect(
		() => () => {
			attempt.current++;
		},
		[]
	);
	const server = 'icloud' === service ? 'caldav.icloud.com' : url.trim();
	const writable = ( signedIn?.calendars ?? [] ).filter( ( c ) => c.writable );

	const waitFor = ( state: string, mine: number ): Promise<CalendarSignIn | null> =>
		new Promise( ( resolve ) => {
			let over = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const done = ( result: CalendarSignIn | null ): void => {
				if ( ! over ) {
					over = true;
					window.removeEventListener( 'message', listen );
					clearTimeout( timer );
					resolve( result );
				}
			};
			// The window tells at once when it can; some sign-in pages cut it off, so the state is asked too.
			const listen = ( event: MessageEvent ): void => {
				const data = event.data as ( CalendarSignIn & { source?: string } ) | null;
				if ( event.origin === window.location.origin && 'funnelforms-calendar' === data?.source && data.state === state ) {
					done( data );
				}
			};
			const poll = async ( left: number ): Promise<void> => {
				if ( over || mine !== attempt.current ) {
					done( null );
					return;
				}
				if ( left <= 0 ) {
					done( { ok: false, state, code: 'timeout', message: __( 'The sign-in took too long. Please try again.', 'funnelforms-pro' ) } );
					return;
				}
				try {
					const result = await api.calendarSignIn( state );
					if ( result ) {
						done( result );
						return;
					}
				} catch {
					// Asked again on the next turn.
				}
				timer = setTimeout( () => void poll( left - 2 ), 2000 );
			};
			window.addEventListener( 'message', listen );
			timer = setTimeout( () => void poll( SIGN_IN_SECONDS ), 2000 );
		} );

	const finish = ( result: CalendarSignIn ): void => {
		setBusy( false );
		setLink( '' );
		if ( ! result.ok || ! result.connection ) {
			setError( result.message ?? __( 'The sign-in did not work.', 'funnelforms-pro' ) );
			setAccountUrl( fixUrl( result.url ) );
			return;
		}
		if ( ! again && ( result.calendars ?? [] ).filter( ( c ) => c.writable ).length > 1 ) {
			setSignedIn( result );
			setCalendar( result.calendar ?? '' );
			return;
		}
		onConnected( result.connection );
	};

	// The window opens right on the click, before the address is known, so browsers allow it.
	const signIn = ( provider: 'google' | 'microsoft' ): void => {
		const popup = window.open( '', 'ffx-calendar', 'popup,width=520,height=720' );
		const mine = ++attempt.current;
		setBusy( true );
		setError( null );
		setAccountUrl( '' );
		void ( async () => {
			try {
				const started = await api.startCalendarSignIn( provider, again?.ref );
				if ( popup && ! popup.closed ) {
					popup.location.href = started.url;
				} else {
					setLink( started.url );
				}
				const result = await waitFor( started.state, mine );
				if ( result && mine === attempt.current ) {
					finish( result );
				}
			} catch ( e ) {
				popup?.close();
				setError( e instanceof Error ? e.message : String( e ) );
				setAccountUrl( e instanceof ApiError ? fixUrl( e.data.url ) : '' );
				setBusy( false );
			}
		} )();
	};

	const chooseCalendar = async (): Promise<void> => {
		const connection = signedIn?.connection as CalendarConnection;
		if ( calendar === signedIn?.calendar ) {
			onConnected( connection );
			return;
		}
		setBusy( true );
		try {
			const updated = await api.updateConnection( connection.ref, { calendar } );
			onConnected( { ...connection, label: updated.label } );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
			setBusy( false );
		}
	};

	const connectCalDav = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		const name = label.trim() || choices.find( ( c ) => c.url === calendar )?.name || ( 'icloud' === service ? 'iCloud' : server );
		try {
			const created = await api.createConnection( 'caldav', name, { url: server, username: username.trim(), password, ...( calendar ? { calendar } : {} ) } );
			onConnected( { ref: created.ref, type: 'caldav', label: created.label, error: null } );
		} catch ( e ) {
			if ( e instanceof ApiError && 'choose_calendar' === e.code && Array.isArray( e.data.calendars ) ) {
				const found = e.data.calendars as Array<{ url: string; name: string }>;
				setChoices( found );
				setCalendar( found[ 0 ]?.url ?? '' );
			} else {
				setError( e instanceof Error ? e.message : String( e ) );
			}
			setBusy( false );
		}
	};

	const services: Array<{ id: CalendarService; name: string; hint: string }> = [
		{ id: 'google', name: 'Google Calendar', hint: __( 'Sign in with your Google account.', 'funnelforms-pro' ) },
		{ id: 'microsoft', name: 'Microsoft Outlook', hint: __( 'Microsoft 365, Outlook.com and Exchange Online: sign in with your Microsoft account.', 'funnelforms-pro' ) },
		{ id: 'icloud', name: 'Apple iCloud', hint: __( 'With your Apple ID and an app-specific password.', 'funnelforms-pro' ) },
		{ id: 'caldav', name: __( 'Other calendar (CalDAV)', 'funnelforms-pro' ), hint: __( 'Nextcloud, Fastmail, mailbox.org and other servers with CalDAV.', 'funnelforms-pro' ) },
	];
	const oauth = 'google' === service || 'microsoft' === service;
	const complete = '' !== server && '' !== username.trim() && '' !== password && ( ! choices.length || '' !== calendar );
	let actions: React.ReactNode = (
		<Button variant="ghost" onClick={ onClose }>
			{ __( 'Cancel', 'funnelforms-pro' ) }
		</Button>
	);
	if ( signedIn ) {
		actions = (
			<Button variant="primary" disabled={ busy || '' === calendar } onClick={ () => void chooseCalendar() }>
				{ __( 'Done', 'funnelforms-pro' ) }
			</Button>
		);
	} else if ( oauth ) {
		actions = (
			<>
				{ actions }
				<Button variant="primary" disabled={ busy } onClick={ () => signIn( service ) }>
					{ busy ? __( 'Waiting for the sign-in…', 'funnelforms-pro' ) : sprintf( __( 'Sign in to %s', 'funnelforms-pro' ), 'google' === service ? 'Google' : 'Microsoft' ) }
				</Button>
			</>
		);
	} else if ( service ) {
		actions = (
			<>
				{ actions }
				<Button variant="primary" disabled={ busy || ! complete } onClick={ () => void connectCalDav() }>
					{ busy ? __( 'Connecting…', 'funnelforms-pro' ) : __( 'Connect', 'funnelforms-pro' ) }
				</Button>
			</>
		);
	}
	return (
		<Dialog title={ again ? __( 'Connect calendar again', 'funnelforms-pro' ) : __( 'Connect calendar', 'funnelforms-pro' ) } open onClose={ onClose } actions={ actions }>
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
			{ null === service ? (
				<div className="ffxb-calendar-services">
					{ services.map( ( s ) => (
						<button key={ s.id } type="button" className="ffxb-calendar-service" onClick={ () => setService( s.id ) }>
							<strong>{ s.name }</strong>
							<span>{ s.hint }</span>
						</button>
					) ) }
				</div>
			) : null }
			{ signedIn ? (
				<>
					<p>{ sprintf( __( '%s is connected. Which calendar should get the appointments?', 'funnelforms-pro' ), signedIn.connection?.label ?? '' ) }</p>
					<Select<string> label={ __( 'Calendar', 'funnelforms-pro' ) } value={ calendar } options={ writable.map( ( c: CalendarChoice ) => ( { value: c.id, label: c.name } ) ) } onChange={ setCalendar } />
					<p className="ffxb-hint">{ __( 'Busy times in this calendar cannot be booked.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
			{ oauth && ! signedIn ? (
				<>
					<p>
						{ again
							? sprintf( __( 'Sign in to %s again so Funnelforms can read busy times and add appointments.', 'funnelforms-pro' ), again.label )
							: __( 'A window opens where you sign in and allow Funnelforms to read busy times and add appointments. Funnelforms asks only for your calendars.', 'funnelforms-pro' ) }
					</p>
					{ link ? (
						<Notice tone="info">
							<a href={ link } target="ffx-calendar" rel="noopener">
								{ __( 'Open the sign-in', 'funnelforms-pro' ) }
							</a>
						</Notice>
					) : null }
					<p className="ffxb-hint">{ __( 'The access is stored encrypted on this website. Appointments go straight from here to your calendar.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
			{ 'icloud' === service || 'caldav' === service ? (
				<>
					{ 'caldav' === service ? (
						<TextInput label={ __( 'Server', 'funnelforms-pro' ) } value={ url } placeholder="cloud.example.com" onChange={ ( v ) => ( setUrl( v ), setChoices( [] ), setCalendar( '' ) ) } hint={ __( 'Nextcloud: the address of your cloud. Others: the CalDAV address from their help pages.', 'funnelforms-pro' ) } />
					) : null }
					<TextInput label={ 'icloud' === service ? __( 'Apple ID', 'funnelforms-pro' ) : __( 'User name', 'funnelforms-pro' ) } value={ username } onChange={ setUsername } hint={ 'icloud' === service ? __( 'The e-mail address you sign in to iCloud with.', 'funnelforms-pro' ) : __( 'Usually your e-mail address.', 'funnelforms-pro' ) } />
					<TextInput
						label={ 'icloud' === service ? __( 'App-specific password', 'funnelforms-pro' ) : __( 'Password', 'funnelforms-pro' ) }
						type="password"
						value={ password }
						onChange={ setPassword }
						hint={ 'icloud' === service ? __( 'Create one at account.apple.com under Sign-In and Security → App-Specific Passwords. Your Apple ID password does not work here.', 'funnelforms-pro' ) : __( 'Fastmail and some others need an app-specific password, which you create in the account settings there.', 'funnelforms-pro' ) }
					/>
					{ choices.length ? (
						<>
							<Notice tone="info">{ __( 'This account has several calendars. Choose the one that gets the appointments, then connect again.', 'funnelforms-pro' ) }</Notice>
							<Select<string> label={ __( 'Calendar', 'funnelforms-pro' ) } value={ calendar } options={ choices.map( ( c ) => ( { value: c.url, label: c.name } ) ) } onChange={ setCalendar } hint={ __( 'Busy times in this calendar cannot be booked.', 'funnelforms-pro' ) } />
						</>
					) : null }
					<TextInput label={ __( 'Name', 'funnelforms-pro' ) } value={ label } placeholder={ choices.find( ( c ) => c.url === calendar )?.name } onChange={ setLabel } hint={ __( 'Your name for this connection, shown when you pick the calendar of an appointment type.', 'funnelforms-pro' ) } />
					<p className="ffxb-hint">{ __( 'The password is stored encrypted and never shown again.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
		</Dialog>
	);
}
