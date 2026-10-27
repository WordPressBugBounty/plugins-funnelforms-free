/**
 * Opening hours of appointment types as the editor shows them: one row per weekday with its time
 * spans. The plugin stores rules (weekdays with one time span each, BookingType::clean() keeps up
 * to 21); these helpers turn one into the other.
 */
import type { BookingConfig } from './api';

export interface Span {
	from: string;
	to: string;
}

/** Spans per ISO weekday (1 Monday … 7 Sunday), sorted by start; days without hours are empty. */
export type Week = Record<number, Span[]>;

export const WEEKDAYS = [ 1, 2, 3, 4, 5, 6, 7 ];

/** The rules as one list of spans per weekday. */
export function weekOf( hours: BookingConfig[ 'hours' ] ): Week {
	const week: Week = {};
	for ( const day of WEEKDAYS ) {
		week[ day ] = [];
	}
	for ( const rule of hours ) {
		for ( const day of rule.days ) {
			if ( week[ day ] && ! week[ day ].some( ( s ) => s.from === rule.from && s.to === rule.to ) ) {
				week[ day ].push( { from: rule.from, to: rule.to } );
			}
		}
	}
	for ( const day of WEEKDAYS ) {
		spansOf( week, day ).sort( ( a, b ) => a.from.localeCompare( b.from ) );
	}
	return week;
}

/** The spans of one weekday; none when it is closed. */
export function spansOf( week: Week, day: number ): Span[] {
	return week[ day ] ?? [];
}

/** The week as rules: days with the same span share one rule, in the order of the week. */
export function hoursOf( week: Week ): BookingConfig[ 'hours' ] {
	const rules: BookingConfig[ 'hours' ] = [];
	for ( const day of WEEKDAYS ) {
		for ( const span of week[ day ] ?? [] ) {
			const same = rules.find( ( r ) => r.from === span.from && r.to === span.to );
			if ( same ) {
				same.days.push( day );
			} else {
				rules.push( { days: [ day ], from: span.from, to: span.to } );
			}
		}
	}
	return rules;
}

/** Minutes after midnight of HH:MM; NaN when it is none. */
export function minutesOf( time: string ): number {
	const m = /^(\d{1,2}):(\d{2})$/.exec( time );
	return m ? Number( m[ 1 ] ) * 60 + Number( m[ 2 ] ) : NaN;
}

/** HH:MM of minutes after midnight, at most 24:00. */
export function clockOf( minutes: number ): string {
	const m = Math.max( 0, Math.min( 1440, Math.round( minutes ) ) );
	return String( Math.floor( m / 60 ) ).padStart( 2, '0' ) + ':' + String( m % 60 ).padStart( 2, '0' );
}

/** Whether a span ends after it starts. */
export function validSpan( span: Span ): boolean {
	return minutesOf( span.from ) < minutesOf( span.to );
}

/** Whether spans of one day overlap. */
export function overlapping( spans: Span[] ): boolean {
	const sorted = [ ...spans ].sort( ( a, b ) => minutesOf( a.from ) - minutesOf( b.from ) );
	return sorted.some( ( s, i ) => i > 0 && minutesOf( s.from ) < minutesOf( sorted[ i - 1 ]?.to ?? '' ) );
}

/** A span after the last one of a day: an hour after it ends, an hour long (09:00–17:00 on an empty day). */
export function nextSpan( spans: Span[] ): Span {
	const last = spans.reduce( ( end, s ) => Math.max( end, minutesOf( s.to ) ), -1 );
	if ( last < 0 ) {
		return { from: '09:00', to: '17:00' };
	}
	const from = Math.min( last + 60, 1380 );
	return { from: clockOf( from ), to: clockOf( Math.min( from + 60, 1440 ) ) };
}

export type NoticeUnit = 'minutes' | 'hours' | 'days';

/** Notice in minutes as an amount and the largest unit that fits evenly. */
export function noticeOf( minutes: number ): { amount: number; unit: NoticeUnit } {
	if ( minutes > 0 && 0 === minutes % 1440 ) {
		return { amount: minutes / 1440, unit: 'days' };
	}
	if ( minutes > 0 && 0 === minutes % 60 ) {
		return { amount: minutes / 60, unit: 'hours' };
	}
	return { amount: minutes, unit: 'minutes' };
}

export function noticeMinutes( amount: number, unit: NoticeUnit ): number {
	return Math.max( 0, Math.round( amount ) ) * { minutes: 1, hours: 60, days: 1440 }[ unit ];
}

/**
 * The week in a few words: days in a row with the same spans as one range, e.g. "Mon–Fri
 * 09:00–12:00, 13:00–17:00 · Sat 10:00–14:00". dayName names a weekday (1 Monday).
 */
export function weekSummary( hours: BookingConfig[ 'hours' ], dayName: ( day: number ) => string ): string {
	const week = weekOf( hours );
	const key = ( day: number ): string => spansOf( week, day ).map( ( s ) => s.from + '–' + s.to ).join( ', ' );
	const parts: string[] = [];
	let first = 0;
	for ( let day = 1; day <= 8; day++ ) {
		if ( first && ( day > 7 || key( day ) !== key( first ) ) ) {
			if ( key( first ) ) {
				const last = day - 1;
				parts.push( ( first === last ? dayName( first ) : dayName( first ) + '–' + dayName( last ) ) + ' ' + key( first ) );
			}
			first = 0;
		}
		if ( ! first && day <= 7 ) {
			first = day;
		}
	}
	return parts.join( ' · ' );
}

/** Codes the editor checks before it saves; the plugin answers with the same ones (no_durations and invalid_closed only here). */
export function bookingProblems( title: string, config: BookingConfig ): string[] {
	const problems: string[] = [];
	if ( '' === title.trim() ) {
		problems.push( 'no_title' );
	}
	if ( ! config.durations.length ) {
		problems.push( 'no_durations' );
	}
	if ( ! config.hours.some( ( rule ) => rule.days.length > 0 && validSpan( rule ) ) ) {
		problems.push( 'no_hours' );
	}
	if ( config.hours.some( ( rule ) => ! validSpan( rule ) ) ) {
		problems.push( 'invalid_hours' );
	}
	if ( config.special.some( ( day ) => ! day.date || day.hours.some( ( span ) => ! validSpan( span ) ) ) ) {
		problems.push( 'invalid_special' );
	}
	if ( config.closed.some( ( range ) => ! range.from || ! range.to || range.to < range.from ) ) {
		problems.push( 'invalid_closed' );
	}
	if ( 'range' === config.horizon.mode && ( ! config.horizon.from || ! config.horizon.to ) ) {
		problems.push( 'invalid_range' );
	}
	if ( 'video' === config.kind && '' !== config.location.trim() && ! /^https:\/\//i.test( config.location.trim() ) ) {
		problems.push( 'invalid_video_link' );
	}
	return problems;
}

/** A local day as Y-m-d. */
export function dateKey( day: Date ): string {
	return `${ day.getFullYear() }-${ String( day.getMonth() + 1 ).padStart( 2, '0' ) }-${ String( day.getDate() ).padStart( 2, '0' ) }`;
}

export interface PreviewDay {
	/** Y-m-d. */
	date: string;
	/** Start times (HH:MM), at most perDay. */
	times: string[];
	/** Further start times of the day. */
	more: number;
}

/** Days the preview of the editor looks ahead at most. */
const PREVIEW_DAYS = 60;

/**
 * The first days with free start times as visitors would see them when nothing else is booked
 * and no calendar is busy: the weekly hours or the day's own hours, without closed days, from the
 * notice on, within the booking window, every interval minutes, for the first duration. It
 * follows Availability::slots() of the plugin, in the time of the browser.
 */
export function previewSlots( config: BookingConfig, now: Date, days = 3, perDay = 6 ): PreviewDay[] {
	const duration = config.durations[ 0 ] ?? 30;
	const step = Math.max( 5, config.interval || 30 );
	const earliest = now.getTime() + Math.max( 0, config.notice ) * 60000;
	const today = new Date( now.getFullYear(), now.getMonth(), now.getDate() );
	const at = ( offset: number ): Date => new Date( today.getFullYear(), today.getMonth(), today.getDate() + offset );
	let first = 0;
	let last = PREVIEW_DAYS - 1;
	const horizon = config.horizon;
	if ( 'rolling' === horizon.mode ) {
		const end = 'month' === horizon.unit ? new Date( today.getFullYear(), today.getMonth() + horizon.amount, today.getDate() ) : at( horizon.amount * ( 'week' === horizon.unit ? 7 : 1 ) );
		last = Math.min( last, Math.round( ( end.getTime() - today.getTime() ) / 86400000 ) );
	} else if ( 'range' === horizon.mode ) {
		if ( ! horizon.from || ! horizon.to ) {
			return [];
		}
		const offset = ( date: string ): number => {
			const [ y, m, d ] = date.split( '-' ).map( Number );
			return Math.round( ( new Date( y ?? 0, ( m ?? 1 ) - 1, d ?? 1 ).getTime() - today.getTime() ) / 86400000 );
		};
		first = Math.max( 0, offset( horizon.from ) );
		last = Math.min( first + PREVIEW_DAYS - 1, offset( horizon.to ) );
	}
	const week = weekOf( config.hours );
	const out: PreviewDay[] = [];
	for ( let i = first; i <= last && out.length < days; i++ ) {
		const day = at( i );
		const date = dateKey( day );
		if ( config.closed.some( ( range ) => range.from && range.from <= date && date <= ( range.to || range.from ) ) ) {
			continue;
		}
		const special = config.special.find( ( s ) => s.date === date );
		const spans = special ? special.hours : spansOf( week, day.getDay() || 7 );
		const starts = new Set<number>();
		for ( const span of spans ) {
			const close = minutesOf( span.to );
			for ( let t = minutesOf( span.from ); t + duration <= close; t += step ) {
				if ( day.getTime() + t * 60000 >= earliest ) {
					starts.add( t );
				}
			}
		}
		if ( starts.size ) {
			const times = [ ...starts ].sort( ( a, b ) => a - b ).map( clockOf );
			out.push( { date, times: times.slice( 0, perDay ), more: Math.max( 0, times.length - perDay ) } );
		}
	}
	return out;
}
