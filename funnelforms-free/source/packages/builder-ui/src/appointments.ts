/**
 * The appointments page without React: talking to the appointments API, the days of the agenda
 * and the calendar in the site's time zone, filters and counts. ui/Appointments.tsx shows it.
 */
import { ApiError, type Appointment } from './api';

/** An appointment as GET appointments lists it. */
export interface AppointmentItem extends Omit<Appointment, 'visitor'> {
	visitor: { name: string; email: string; phone: string };
	/** How it went, once the team marked it. */
	outcome: Outcome | null;
	/** Who cancelled or last moved it. */
	changedBy: { kind: 'visitor' | 'team' | 'system'; name: string } | null;
	/** The last message to the visitor from the team. */
	message: string | null;
	/** Confirmed and started: the team can mark how it went. */
	markable: boolean;
}

export type Outcome = 'done' | 'noshow';

/** Where an appointment stands, for badges, colours and the status filter. */
export type AppointmentState = 'upcoming' | 'open' | 'done' | 'noshow' | 'cancelled';

export type StatusFilter = 'active' | AppointmentState | 'all';

export type View = 'list' | 'week' | 'month';

/** What the page passes (AppointmentsPage::config()). */
export interface AppointmentsConfig {
	screen: 'appointments';
	root: string;
	nonce: string;
	userLocale?: string;
	/** Time zone of the site: a name or an offset such as +02:00. */
	timezone: string;
	/** First day of the week: 1 Monday, 0 Sunday. */
	weekStart: 0 | 1;
	forms: Array<{ id: number; title: string }>;
	types: Array<{ ref: string; title: string }>;
	entriesUrl: string;
	user: number;
	canEditTypes: boolean;
	/** Change settings: connect calendars from the editor of a type. */
	canConnect?: boolean;
}

/** GET entries/<id>/appointments/<appointment>/slots. */
export interface FreeTimes {
	timezone: string;
	duration: number;
	window: { from: string; to: string } | null;
	days: Record<string, string[]>;
}

export type MailKind = 'invite' | 'moved' | 'cancel' | 'reminder';

export const MAIL_KINDS: MailKind[] = [ 'invite', 'moved', 'cancel', 'reminder' ];

export type Mails = Record<MailKind, { subject: string; text: string }>;

/** GET appointments/mails. */
export interface MailSettings {
	types: Array<{ id: number; ref: string; title: string; invitation: boolean; reminders: number[]; mails: Mails }>;
	defaults: Record<MailKind, { subject: string; intro: string }>;
	tokens: string[];
}

/** The routes of Http\AppointmentsController, with the REST nonce of the page. */
export class AppointmentsClient {
	private nonce: string;

	constructor(
		private readonly root: string,
		nonce: string,
		private readonly fetcher: typeof fetch = ( input, init ) => fetch( input, init )
	) {
		this.nonce = nonce;
	}

	list( from: string, to: string ): Promise<AppointmentItem[]> {
		return this.request( 'GET', 'appointments', undefined, { from, to, status: 'all' } );
	}

	slots( a: Pick<AppointmentItem, 'entryId' | 'id'>, from: string, to: string ): Promise<FreeTimes> {
		return this.request( 'GET', one( a ) + '/slots', undefined, { from, to } );
	}

	move( a: Pick<AppointmentItem, 'entryId' | 'id'>, start: string, message: string ): Promise<AppointmentItem> {
		return this.request( 'POST', one( a ) + '/move', { start, message } );
	}

	cancel( a: Pick<AppointmentItem, 'entryId' | 'id'>, message: string ): Promise<AppointmentItem> {
		return this.request( 'POST', one( a ) + '/cancel', { message } );
	}

	mark( a: Pick<AppointmentItem, 'entryId' | 'id'>, outcome: Outcome | 'none' ): Promise<AppointmentItem> {
		return this.request( 'POST', one( a ) + '/outcome', { outcome } );
	}

	mails(): Promise<MailSettings> {
		return this.request( 'GET', 'appointments/mails' );
	}

	saveMails( type: number, mails: Mails ): Promise<MailSettings[ 'types' ][ number ]> {
		return this.request( 'PUT', 'appointments/mails/' + type, { mails } );
	}

	/** Address of a route below funnelforms/v1, also for sites without pretty permalinks. */
	url( route: string, query: Record<string, string> = {} ): string {
		const url = new URL( this.root, 'http://localhost' );
		const path = 'funnelforms/v1/' + route;
		if ( url.searchParams.has( 'rest_route' ) ) {
			url.searchParams.set( 'rest_route', ( url.searchParams.get( 'rest_route' ) ?? '/' ).replace( /\/?$/, '/' ) + path );
		} else {
			url.pathname = url.pathname.replace( /\/?$/, '/' ) + path;
		}
		for ( const [ key, value ] of Object.entries( query ) ) {
			url.searchParams.set( key, value );
		}
		// Messages and standard texts in the language of the user, as wp.apiFetch asks for them.
		url.searchParams.set( '_locale', 'user' );
		return /^https?:/.test( this.root ) ? url.toString() : url.pathname + url.search;
	}

	private async request<T>( method: 'GET' | 'POST' | 'PUT', route: string, body?: unknown, query: Record<string, string> = {} ): Promise<T> {
		const headers: Record<string, string> = { 'X-WP-Nonce': this.nonce, Accept: 'application/json' };
		if ( 'PUT' === method ) {
			// Some hosts block PUT; WordPress takes the method from this header, or from _method in the
			// address where a host strips the header.
			headers[ 'X-HTTP-Method-Override' ] = 'PUT';
			query = { ...query, _method: 'PUT' };
		}
		if ( undefined !== body ) {
			headers[ 'Content-Type' ] = 'application/json';
		}
		let response: Response;
		try {
			response = await this.fetcher( this.url( route, query ), {
				method: 'GET' === method ? 'GET' : 'POST',
				headers,
				body: undefined === body ? undefined : JSON.stringify( body ),
				credentials: 'same-origin',
			} );
		} catch {
			throw new ApiError( 'offline', 'The server could not be reached.', 0 );
		}
		const fresh = response.headers?.get( 'X-WP-Nonce' );
		if ( fresh ) {
			this.nonce = fresh;
		}
		let data: unknown = null;
		try {
			const text = await response.text();
			data = '' === text ? null : JSON.parse( text );
		} catch {
			data = null;
		}
		if ( ! response.ok ) {
			const error = ( data && 'object' === typeof data ? data : {} ) as Record<string, unknown>;
			throw new ApiError( String( error.code ?? 'http_' + response.status ), String( error.message ?? response.statusText ), response.status, error );
		}
		return data as T;
	}
}

function one( a: Pick<AppointmentItem, 'entryId' | 'id'> ): string {
	return 'entries/' + a.entryId + '/appointments/' + a.id;
}

/* Days and times in a time zone ------------------------------------------------------------ */

/**
 * A time zone Intl understands: names stay, whole-hour offsets become Etc/GMT zones; undefined
 * (the browser's) when it is unknown.
 */
export function zoneOf( timezone: string ): string | undefined {
	const offset = /^([+-])(\d{2}):(\d{2})$/.exec( timezone );
	let zone: string = timezone;
	if ( offset ) {
		const hours = Number( offset[ 2 ] );
		if ( '00' !== offset[ 3 ] ) {
			return undefined;
		}
		// Etc/GMT zones count the other way round.
		zone = 0 === hours ? 'UTC' : 'Etc/GMT' + ( '+' === offset[ 1 ] ? '-' : '+' ) + hours;
	}
	try {
		new Intl.DateTimeFormat( 'en', { timeZone: zone } );
		return zone;
	} catch {
		return undefined;
	}
}

/**
 * A time zone as people read it ("Mitteleuropäische Zeit" for Europe/Berlin in German), as the
 * form does (runtime booking.ts); the city with its offset where the language has no such name.
 * Offsets ("+01:00") and unknown zones stay as they are.
 */
export function zoneName( timezone: string, locale?: string ): string {
	const key = timezone + '|' + ( locale ?? '' );
	let name = zoneNames.get( key );
	if ( undefined === name ) {
		name = readableZone( timezone, locale );
		zoneNames.set( key, name );
	}
	return name;
}

const zoneNames = new Map<string, string>();

function readableZone( timezone: string, locale?: string ): string {
	const zone = zoneOf( timezone );
	if ( ! zone || ! timezone ) {
		return timezone;
	}
	const city = ( zone.split( '/' ).pop() ?? zone ).replace( /_/g, ' ' );
	try {
		const name = new Intl.DateTimeFormat( locale, { timeZone: zone, timeZoneName: 'longGeneric' } )
			.formatToParts( new Date() )
			.find( ( p ) => 'timeZoneName' === p.type )?.value;
		if ( name ) {
			return /^(GMT|UTC)[+\-−]/.test( name ) && zone.includes( '/' ) && ! zone.startsWith( 'Etc/' ) ? `${ city } (${ name })` : name;
		}
	} catch {
		// Browsers without generic names show the zone.
	}
	return timezone;
}

/** The language of the admin page, for names of time zones outside the appointments screen. */
export function pageLocale(): string | undefined {
	return ( 'undefined' !== typeof document && document.documentElement.lang ) || undefined;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function parts( iso: string | number, zone: string | undefined ): { year: number; month: number; day: number; hour: number; minute: number } {
	const key = zone ?? '';
	let format = partsCache.get( key );
	if ( ! format ) {
		format = new Intl.DateTimeFormat( 'en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' } );
		partsCache.set( key, format );
	}
	const out = { year: 1970, month: 1, day: 1, hour: 0, minute: 0 };
	for ( const part of format.formatToParts( new Date( iso ) ) ) {
		if ( part.type in out ) {
			out[ part.type as keyof typeof out ] = Number( part.value );
		}
	}
	return out;
}

/** The day (Y-m-d) of a time in a zone. */
export function dayOf( iso: string | number, zone: string | undefined ): string {
	const p = parts( iso, zone );
	return p.year + '-' + pad( p.month ) + '-' + pad( p.day );
}

/** Minutes after midnight of a time in a zone. */
export function minutesOf( iso: string | number, zone: string | undefined ): number {
	const p = parts( iso, zone );
	return ( 24 === p.hour ? 0 : p.hour ) * 60 + p.minute;
}

function pad( n: number ): string {
	return ( n < 10 ? '0' : '' ) + n;
}

function utc( day: string ): Date {
	const [ y = 1970, m = 1, d = 1 ] = day.split( '-' ).map( Number );
	return new Date( Date.UTC( y, m - 1, d ) );
}

/** A day plus some days. */
export function addDays( day: string, days: number ): string {
	const date = utc( day );
	date.setUTCDate( date.getUTCDate() + days );
	return date.toISOString().slice( 0, 10 );
}

/** Weekday of a day: 0 Sunday … 6 Saturday. */
export function weekday( day: string ): number {
	return utc( day ).getUTCDay();
}

/** The first day of the week of a day. */
export function startOfWeek( day: string, weekStart: 0 | 1 ): string {
	return addDays( day, -( ( weekday( day ) - weekStart + 7 ) % 7 ) );
}

/** The first day of the month of a day. */
export function startOfMonth( day: string ): string {
	return day.slice( 0, 8 ) + '01';
}

/** The day a month later or earlier, on the first of that month. */
export function addMonths( day: string, months: number ): string {
	const date = utc( startOfMonth( day ) );
	date.setUTCMonth( date.getUTCMonth() + months );
	return date.toISOString().slice( 0, 10 );
}

/** Days the agenda shows at once. */
export const LIST_DAYS = 14;

/** The days a view shows around its day: list from the day on, the week, the month in whole weeks. */
export function rangeOf( view: View, day: string, weekStart: 0 | 1 ): { from: string; to: string; days: string[] } {
	let from = day;
	let count = LIST_DAYS;
	if ( 'week' === view ) {
		from = startOfWeek( day, weekStart );
		count = 7;
	} else if ( 'month' === view ) {
		from = startOfWeek( startOfMonth( day ), weekStart );
		const last = addDays( addMonths( day, 1 ), -1 );
		count = Math.round( ( utc( startOfWeek( last, weekStart ) ).getTime() - utc( from ).getTime() ) / 864e5 ) + 7;
	}
	const days = Array.from( { length: count }, ( _, i ) => addDays( from, i ) );
	return { from, to: days[ days.length - 1 ] ?? from, days };
}

/** The day the view shows after (1) or before (-1) the current one. */
export function step( view: View, day: string, direction: 1 | -1 ): string {
	if ( 'month' === view ) {
		return addMonths( day, direction );
	}
	return addDays( day, direction * ( 'week' === view ? 7 : LIST_DAYS ) );
}

/* State, filters, counts ------------------------------------------------------------------ */

/** Where an appointment stands at a time. */
export function stateOf( a: Pick<AppointmentItem, 'status' | 'outcome' | 'start'>, now: number ): AppointmentState {
	if ( 'cancelled' === a.status ) {
		return 'cancelled';
	}
	if ( a.outcome ) {
		return a.outcome;
	}
	return Date.parse( a.start ) > now ? 'upcoming' : 'open';
}

export interface Filter {
	form: number;
	type: string;
	status: StatusFilter;
	/** Only those the current user is booked for. */
	mine: boolean;
}

export const NO_FILTER: Filter = { form: 0, type: '', status: 'active', mine: false };

/** Whether an appointment passes the filters, apart from its status. */
export function inScope( a: AppointmentItem, filter: Filter, user: number ): boolean {
	return ( ! filter.form || a.form?.id === filter.form ) && ( ! filter.type || a.type?.ref === filter.type ) && ( ! filter.mine || a.people.some( ( p ) => p.id === user ) );
}

/** Whether a state passes the status filter. */
export function statusMatches( state: AppointmentState, status: StatusFilter ): boolean {
	return 'all' === status || ( 'active' === status ? 'cancelled' !== state : state === status );
}

/** The appointments the filters let through, earliest first. */
export function filtered( items: AppointmentItem[], filter: Filter, user: number, now: number ): AppointmentItem[] {
	return items.filter( ( a ) => inScope( a, filter, user ) && statusMatches( stateOf( a, now ), filter.status ) ).sort( ( a, b ) => Date.parse( a.start ) - Date.parse( b.start ) || a.id - b.id );
}

/** How many appointments each status filter would show. */
export function counts( items: AppointmentItem[], filter: Filter, user: number, now: number ): Record<StatusFilter, number> {
	const out: Record<StatusFilter, number> = { active: 0, upcoming: 0, open: 0, done: 0, noshow: 0, cancelled: 0, all: 0 };
	for ( const a of items ) {
		if ( ! inScope( a, filter, user ) ) {
			continue;
		}
		const state = stateOf( a, now );
		out[ state ]++;
		out.all++;
		if ( 'cancelled' !== state ) {
			out.active++;
		}
	}
	return out;
}

/** Appointments by day (Y-m-d in the zone), in the order given. */
export function byDay( items: AppointmentItem[], zone: string | undefined ): Map<string, AppointmentItem[]> {
	const out = new Map<string, AppointmentItem[]>();
	for ( const a of items ) {
		const day = dayOf( a.start, zone );
		out.set( day, [ ...( out.get( day ) ?? [] ), a ] );
	}
	return out;
}

/** The key figures above the calendar, from the appointments of the last 30 and the next 7 days. */
export interface Figures {
	today: number;
	/** The next appointment today that has not started. */
	nextToday: AppointmentItem | null;
	week: number;
	/** Minutes booked in the next 7 days. */
	weekMinutes: number;
	/** Started in the last 30 days and not marked yet. */
	open: number;
	/** The day of the first of them. */
	firstOpen: string | null;
	noshow: number;
	/** Started in the last 30 days, not cancelled. */
	past: number;
}

export function figures( items: AppointmentItem[], zone: string | undefined, now: number ): Figures {
	const today = dayOf( now, zone );
	const out: Figures = { today: 0, nextToday: null, week: 0, weekMinutes: 0, open: 0, firstOpen: null, noshow: 0, past: 0 };
	const sorted = [ ...items ].sort( ( a, b ) => Date.parse( a.start ) - Date.parse( b.start ) );
	for ( const a of sorted ) {
		const state = stateOf( a, now );
		const start = Date.parse( a.start );
		if ( 'cancelled' === state ) {
			continue;
		}
		if ( dayOf( a.start, zone ) === today ) {
			out.today++;
			if ( start > now && ! out.nextToday ) {
				out.nextToday = a;
			}
		}
		if ( start > now && start <= now + 7 * 864e5 ) {
			out.week++;
			out.weekMinutes += a.duration;
		}
		if ( start <= now && start > now - 30 * 864e5 ) {
			out.past++;
			if ( 'open' === state ) {
				out.open++;
				out.firstOpen = out.firstOpen ?? dayOf( a.start, zone );
			}
			if ( 'noshow' === state ) {
				out.noshow++;
			}
		}
	}
	return out;
}

/**
 * Side by side: appointments of a day that overlap get lanes, so the week view can place them
 * next to each other. Answers lane and how many lanes its group has.
 */
export function lanes( items: AppointmentItem[] ): Map<number, { lane: number; of: number }> {
	const out = new Map<number, { lane: number; of: number }>();
	const sorted = [ ...items ].sort( ( a, b ) => Date.parse( a.start ) - Date.parse( b.start ) || Date.parse( b.end ) - Date.parse( a.end ) );
	let group: AppointmentItem[] = [];
	let ends: number[] = [];
	let groupEnd = 0;
	const close = (): void => {
		for ( const a of group ) {
			out.set( a.id, { lane: out.get( a.id )?.lane ?? 0, of: ends.length } );
		}
		group = [];
		ends = [];
	};
	for ( const a of sorted ) {
		const start = Date.parse( a.start );
		if ( group.length && start >= groupEnd ) {
			close();
		}
		let lane = ends.findIndex( ( end ) => end <= start );
		if ( -1 === lane ) {
			lane = ends.length;
			ends.push( 0 );
		}
		ends[ lane ] = Date.parse( a.end );
		groupEnd = Math.max( group.length ? groupEnd : 0, Date.parse( a.end ) );
		out.set( a.id, { lane, of: 1 } );
		group.push( a );
	}
	close();
	return out;
}

/* Address of the page --------------------------------------------------------------------- */

export interface PageState {
	tab: 'calendar' | 'types' | 'mails';
	view: View;
	/** The day the view is at; empty for today. */
	day: string;
	filter: Filter;
}

const VIEWS: View[] = [ 'list', 'week', 'month' ];
const STATUSES: StatusFilter[] = [ 'active', 'upcoming', 'open', 'done', 'noshow', 'cancelled', 'all' ];

/** The state of the page from its address, so reloading and links keep the view. */
export function stateFromAddress( search: string ): PageState {
	const q = new URLSearchParams( search );
	const view = q.get( 'view' ) as View;
	const status = q.get( 'status' ) as StatusFilter;
	const day = q.get( 'date' ) ?? '';
	const form = Number( q.get( 'form' ) );
	const type = q.get( 'type' ) ?? '';
	return {
		tab: 'mails' === q.get( 'tab' ) || 'types' === q.get( 'tab' ) ? ( q.get( 'tab' ) as 'mails' | 'types' ) : 'calendar',
		view: VIEWS.includes( view ) ? view : 'list',
		day: /^\d{4}-\d{2}-\d{2}$/.test( day ) ? day : '',
		filter: {
			form: Number.isInteger( form ) && form > 0 ? form : 0,
			type: /^(bt|legacy):\d+$/.test( type ) ? type : '',
			status: STATUSES.includes( status ) ? status : 'active',
			mine: '1' === q.get( 'mine' ),
		},
	};
}

/** The address of a state, from the current one (keeps page and other arguments). */
export function addressOf( state: PageState, current: string ): string {
	const url = new URL( current );
	const set = ( key: string, value: string ): void => {
		if ( value ) {
			url.searchParams.set( key, value );
		} else {
			url.searchParams.delete( key );
		}
	};
	set( 'tab', 'calendar' === state.tab ? '' : state.tab );
	set( 'view', 'list' === state.view ? '' : state.view );
	set( 'date', state.day );
	set( 'form', state.filter.form ? String( state.filter.form ) : '' );
	set( 'type', state.filter.type );
	set( 'status', 'active' === state.filter.status ? '' : state.filter.status );
	set( 'mine', state.filter.mine ? '1' : '' );
	return url.toString();
}

/** Inserts a placeholder at the cursor of a text (or at its end). */
export function insertAt( text: string, token: string, start: number | null, end: number | null ): { text: string; cursor: number } {
	const from = null === start ? text.length : Math.max( 0, Math.min( start, text.length ) );
	const to = null === end ? from : Math.max( from, Math.min( end, text.length ) );
	const piece = '{{' + token + '}}';
	return { text: text.slice( 0, from ) + piece + text.slice( to ), cursor: from + piece.length };
}
