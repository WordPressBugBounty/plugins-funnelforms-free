import type { BookingField } from '@funnelforms/form-schema';
import { h } from './dom';
import type { FieldContext, RenderedField } from './fields';

/** Value of a booking field: the start in UTC and the minutes booked, as the plugin expects them. */
export interface BookingValue {
	start: string;
	duration: number;
}

/** Free times of a booking field (Application\Bookings::free() in the plugin). */
export interface FreeTimes {
	ok: true;
	timezone: string;
	durations: number[];
	duration: number;
	window: { from: string; to: string } | null;
	/** Start times (ISO, UTC) by day of the booking type. */
	days: Record<string, string[]>;
}

export const isBooking = ( value: unknown ): value is BookingValue =>
	typeof value === 'object' && value !== null && typeof ( value as BookingValue ).start === 'string' && typeof ( value as BookingValue ).duration === 'number';

const pad = ( n: number ): string => String( n ).padStart( 2, '0' );

/** Day of a date in the visitor's time zone, Y-m-d. */
const dayOf = ( date: Date ): string => `${ date.getFullYear() }-${ pad( date.getMonth() + 1 ) }-${ pad( date.getDate() ) }`;

/** "30 min", "1 h", "1 h 30 min". */
export function durationText( minutes: number ): string {
	const hours = Math.floor( minutes / 60 );
	const rest = minutes % 60;
	return [ hours ? `${ hours } h` : '', rest ? `${ rest } min` : '' ].filter( Boolean ).join( ' ' );
}

/** Regions whose calendars start on Sunday, for browsers without week data. */
const SUNDAY_FIRST = /[-_](US|CA|MX|BR|JP|IL|PH|KR|TW|HK|IN|ZA|SA|CO|PE)\b/i;

/** The first day of the week in a language (0 Sunday … 6 Saturday): Monday unless the region says otherwise. */
export function weekStart( locale?: string ): number {
	const tag = ( locale ?? '' ).replace( /_/g, '-' );
	try {
		const l = new Intl.Locale( tag || 'und' ) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
		const info = l.getWeekInfo?.() ?? l.weekInfo;
		if ( info && /-[A-Z]{2}\b/i.test( tag ) ) {
			return info.firstDay % 7;
		}
	} catch {
		// An unknown tag gets the fallback.
	}
	return SUNDAY_FIRST.test( tag ) ? 0 : 1;
}

/**
 * A time zone as people read it: "Mitteleuropäische Zeit" for Europe/Berlin in German. Where the
 * language has no such name, the city with its offset ("Istanbul (GMT+03:00)").
 */
export function zoneName( zone: string, locale?: string ): string {
	const city = ( zone.split( '/' ).pop() ?? zone ).replace( /_/g, ' ' );
	try {
		const name = new Intl.DateTimeFormat( locale, { timeZone: zone, timeZoneName: 'longGeneric' } )
			.formatToParts( new Date() )
			.find( ( p ) => 'timeZoneName' === p.type )?.value;
		if ( name ) {
			return /^(GMT|UTC)[+\-−]/.test( name ) && city !== zone ? `${ city } (${ name })` : name;
		}
	} catch {
		// Browsers without generic names show the city.
	}
	return city;
}

/** The booked time in the visitor's time zone, e.g. "Monday, 2 November 2026 at 09:00 (30 min)". */
export function bookingText( value: unknown, locale?: string ): string {
	if ( ! isBooking( value ) ) {
		return '';
	}
	const when = new Date( value.start ).toLocaleString( locale, { dateStyle: 'full', timeStyle: 'short' } );
	return `${ when } (${ durationText( value.duration ) })`;
}

/**
 * Appointment (chunk runtime-booking.js): the visitor picks a duration (when the type offers
 * several), a day in a month view and one of its free times. Times show in the visitor's time zone,
 * which is named below; the plugin checks again on submit that the time is still free. Fills the
 * group the core rendered (fields.ts later()).
 */
export function bookingField( field: BookingField, ctx: FieldContext, r: RenderedField ): void {
	const describedBy = r.el.getAttribute( 'aria-describedby' ) ?? '';
	const locale = ctx.locale;
	const first = weekStart( locale );
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const today = dayOf( new Date() );
	const stored = ctx.get( field.id );
	let value: BookingValue | null = isBooking( stored ) ? stored : null;
	let duration = value?.duration ?? 0;
	let month = value ? new Date( value.start ) : new Date();
	month = new Date( month.getFullYear(), month.getMonth(), 1 );
	let day: string | null = value ? dayOf( new Date( value.start ) ) : null;
	let free: Record<string, string[]> = {};
	let last: string | null = null;
	let request = 0;

	const durations = h( 'div', { class: 'ffx-booking-durations', role: 'group', 'aria-label': ctx.t( 'booking_duration' ), hidden: true } );
	const durationList = h( 'div', { class: 'ffx-booking-segments' } );
	const title = h( 'span', { class: 'ffx-booking-month', 'aria-live': 'polite' } );
	const prev = h( 'button', { type: 'button', class: 'ffx-booking-nav', 'aria-label': ctx.t( 'booking_prev_month' ) }, '‹' );
	const next = h( 'button', { type: 'button', class: 'ffx-booking-nav', 'aria-label': ctx.t( 'booking_next_month' ) }, '›' );
	const grid = h( 'div', { class: 'ffx-booking-days', role: 'group', tabindex: -1, 'aria-describedby': describedBy } );
	const times = h( 'div', { class: 'ffx-booking-times', role: 'group' } );
	const dayTitle = h( 'p', { class: 'ffx-booking-date', 'aria-hidden': 'true' } );
	const status = h( 'p', { class: 'ffx-booking-status', 'aria-live': 'polite' } );
	const chosen = h( 'p', { class: 'ffx-booking-chosen', 'aria-live': 'polite' } );

	const showChosen = (): void => {
		chosen.hidden = ! value;
		chosen.textContent = value ? ctx.t( 'booking_selected' ).replace( '%s', bookingText( value, locale ) ) : '';
	};

	const drawDurations = ( offered: number[] ): void => {
		durations.hidden = offered.length < 2;
		durations.replaceChildren( h( 'span', { class: 'ffx-booking-label', 'aria-hidden': 'true' }, ctx.t( 'booking_duration' ) ), durationList );
		durationList.replaceChildren( ...offered.map( ( minutes ) => {
			const button = h( 'button', { type: 'button', class: 'ffx-booking-duration', 'aria-pressed': minutes === duration ? 'true' : 'false' }, durationText( minutes ) );
			button.addEventListener( 'click', () => {
				if ( minutes === duration ) {
					return;
				}
				duration = minutes;
				if ( value ) {
					value = null;
					ctx.set( field.id, undefined );
				}
				void load( false );
			} );
			return button;
		} ) );
	};

	const drawTimes = (): void => {
		const list = day ? free[ day ] ?? [] : [];
		const label = day ? new Date( `${ day }T12:00:00` ).toLocaleDateString( locale, { weekday: 'long', day: 'numeric', month: 'long' } ) : '';
		times.hidden = list.length === 0;
		dayTitle.hidden = list.length === 0;
		dayTitle.textContent = label;
		times.setAttribute( 'aria-label', day ? new Date( `${ day }T12:00:00` ).toLocaleDateString( locale, { dateStyle: 'full' } ) : '' );
		times.replaceChildren( ...list.map( ( iso ) => {
			const button = h( 'button', { type: 'button', class: 'ffx-booking-time', 'aria-pressed': value?.start === iso ? 'true' : 'false' }, new Date( iso ).toLocaleTimeString( locale, { timeStyle: 'short' } ) );
			button.addEventListener( 'click', () => {
				value = { start: iso, duration };
				ctx.set( field.id, value );
				times.querySelectorAll( 'button' ).forEach( ( b ) => b.setAttribute( 'aria-pressed', b === button ? 'true' : 'false' ) );
				showChosen();
			} );
			return button;
		} ) );
	};

	const drawMonth = (): void => {
		title.textContent = month.toLocaleDateString( locale, { month: 'long', year: 'numeric' } );
		const cells: HTMLElement[] = [];
		// The week starts as in the visitor's region; 7 January 2024 was a Sunday.
		for ( let i = 0; i < 7; i++ ) {
			cells.push( h( 'span', { class: 'ffx-booking-weekday', 'aria-hidden': 'true' }, new Date( 2024, 0, 7 + ( ( first + i ) % 7 ) ).toLocaleDateString( locale, { weekday: 'short' } ) ) );
		}
		for ( let i = ( month.getDay() - first + 7 ) % 7; i > 0; i-- ) {
			cells.push( h( 'span', {} ) );
		}
		for ( let date = new Date( month ); date.getMonth() === month.getMonth(); date.setDate( date.getDate() + 1 ) ) {
			const key = dayOf( date );
			const button = h( 'button', {
				type: 'button',
				class: 'ffx-booking-day',
				disabled: ! free[ key ],
				'aria-pressed': key === day ? 'true' : 'false',
				'aria-label': date.toLocaleDateString( locale, { dateStyle: 'full' } ),
				'data-day': key,
			}, String( date.getDate() ) );
			button.addEventListener( 'click', () => {
				day = key;
				grid.querySelectorAll( '.ffx-booking-day' ).forEach( ( b ) => b.setAttribute( 'aria-pressed', b === button ? 'true' : 'false' ) );
				drawTimes();
				times.querySelector( 'button' )?.focus();
			} );
			cells.push( button );
		}
		grid.replaceChildren( ...cells );
		prev.disabled = dayOf( month ) <= today;
		const following = new Date( month.getFullYear(), month.getMonth() + 1, 1 );
		next.disabled = last !== null && dayOf( following ) > last;
		drawTimes();
	};

	/** Free times of the month shown; the first time also skips months without any. */
	const load = async ( skipEmpty: boolean ): Promise<void> => {
		const id = ++request;
		// A day either side: the type's days can begin earlier or later than the visitor's.
		const from = dayOf( new Date( month.getFullYear(), month.getMonth(), 0 ) );
		const to = dayOf( new Date( month.getFullYear(), month.getMonth() + 1, 1 ) );
		status.hidden = false;
		status.textContent = ctx.t( 'booking_loading' );
		grid.setAttribute( 'aria-busy', 'true' );
		const result = await ctx.slots( field.id, from, to, duration );
		if ( id !== request ) {
			return;
		}
		grid.removeAttribute( 'aria-busy' );
		free = {};
		if ( 'error' in result ) {
			status.textContent = ctx.t( result.error === 'rate_limited' ? 'rate_limited' : 'booking_unavailable' );
			drawMonth();
			return;
		}
		duration = result.duration;
		last = result.window?.to ?? null;
		for ( const list of Object.values( result.days ) ) {
			for ( const iso of list ) {
				( free[ dayOf( new Date( iso ) ) ] ??= [] ).push( iso );
			}
		}
		const key = dayOf( month ).slice( 0, 7 );
		const found = Object.keys( free ).filter( ( d ) => d.startsWith( key ) ).sort();
		drawDurations( result.durations );
		if ( ! found.length && skipEmpty && last !== null && last > dayOf( new Date( month.getFullYear(), month.getMonth() + 1, 0 ) ) ) {
			month = new Date( month.getFullYear(), month.getMonth() + 1, 1 );
			return load( true );
		}
		if ( ! day || ! free[ day ] ) {
			day = found[ 0 ] ?? null;
		}
		status.hidden = found.length > 0;
		status.textContent = found.length ? '' : ctx.t( result.window ? 'booking_no_times' : 'booking_none' );
		drawMonth();
	};

	const move = ( by: number ): void => {
		month = new Date( month.getFullYear(), month.getMonth() + by, 1 );
		day = null;
		void load( false );
	};
	prev.addEventListener( 'click', () => move( -1 ) );
	next.addEventListener( 'click', () => move( 1 ) );

	showChosen();
	drawMonth();
	void load( ! value );

	// Wide enough (a container query on .ffx-booking), the times stand next to a compact month.
	r.error.before(
		h(
			'div',
			{ class: 'ffx-booking' },
			durations,
			h(
				'div',
				{ class: 'ffx-booking-main' },
				h( 'div', { class: 'ffx-booking-calendar' }, h( 'div', { class: 'ffx-booking-head' }, prev, title, next ), grid, status ),
				h( 'div', { class: 'ffx-booking-slots' }, dayTitle, times )
			),
			h( 'p', { class: 'ffx-booking-zone' }, ctx.t( 'booking_timezone' ).replace( '%s', zoneName( zone, locale ) ) ),
			chosen
		)
	);
	r.focus = grid;
}
