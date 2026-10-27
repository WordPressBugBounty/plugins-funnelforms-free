/**
 * The entries screen without React: filters in the address, names and values of entries, tags
 * as typed, the export link.
 */
import type { EntryDevice, EntryFilter, EntrySummary, LeadStage, LeadStageInput, LeadStageTone, LeadStatus, PaymentStatus } from './api';

/** Keys of the lead stages of 5.0; the site's stages may differ (LeadStage). */
export const LEAD_STATUSES: LeadStatus[] = [ 'new', 'contacted', 'won', 'lost' ];

/** Colours a lead stage can have, in the order the stage dialog offers them. */
export const STAGE_TONES: LeadStageTone[] = [ 'info', 'warning', 'success', 'neutral', 'danger' ];

/** Most stages on the board (LeadStages::MAX). */
export const MAX_STAGES = 12;

/** Longest name of a stage (LeadStages::MAX_NAME). */
export const MAX_STAGE_NAME = 40;

const PAYMENT_STATUSES: PaymentStatus[] = [ 'open', 'pending', 'paid', 'failed', 'canceled', 'refunded', 'disputed' ];
export const DEVICES: EntryDevice[] = [ 'desktop', 'tablet', 'mobile' ];

export type EntriesView = 'list' | 'board';

export type Period = '' | 'today' | '7d' | '30d' | '90d';

/** What the screen shows: the API filter plus the view, the period and the open entry. */
export interface EntriesState {
	filter: EntryFilter;
	period: Period;
	view: EntriesView;
	entry: number | null;
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

function positive( value: string | null ): number | undefined {
	const n = Number( value );
	return null !== value && '' !== value && Number.isInteger( n ) && n >= 0 ? n : undefined;
}

function oneOf<T extends string>( value: string | null, allowed: readonly T[] ): T | undefined {
	return allowed.find( ( a ) => a === value );
}

/** The state from the address (?form=3&leadStatus=won&view=board&entry=12 …); stages: the keys of the site's lead stages. */
export function stateFromAddress( search: string, stages: readonly LeadStatus[] = LEAD_STATUSES ): EntriesState {
	const q = new URLSearchParams( search );
	const filter: EntryFilter = {};
	const form = positive( q.get( 'form' ) );
	if ( form ) {
		filter.form = form;
	}
	const leadStatus = oneOf( q.get( 'leadStatus' ), stages );
	if ( leadStatus ) {
		filter.leadStatus = leadStatus;
	}
	const status = oneOf( q.get( 'status' ), [ 'complete', 'partial', 'spam', 'abandoned' ] as const );
	if ( status ) {
		filter.status = status;
	}
	const payment = oneOf( q.get( 'payment' ), PAYMENT_STATUSES );
	if ( payment ) {
		filter.payment = payment;
	}
	const device = oneOf( q.get( 'device' ), DEVICES );
	if ( device ) {
		filter.device = device;
	}
	const assignedTo = positive( q.get( 'assignedTo' ) );
	if ( undefined !== assignedTo ) {
		filter.assignedTo = assignedTo;
	}
	const tag = q.get( 'tag' );
	if ( tag ) {
		filter.tag = tag;
	}
	const search_ = q.get( 'search' );
	if ( search_ ) {
		filter.search = search_;
	}
	if ( '1' === q.get( 'archived' ) ) {
		filter.archived = true;
	}
	if ( '0' === q.get( 'read' ) ) {
		filter.read = false;
	}
	const sort = oneOf( q.get( 'sort' ), [ 'value', 'score' ] as const );
	if ( sort ) {
		filter.sort = sort;
	}
	const page = positive( q.get( 'paged' ) );
	if ( page && page > 1 ) {
		filter.page = page;
	}
	return {
		filter,
		period: oneOf( q.get( 'period' ), [ 'today', '7d', '30d', '90d' ] as const ) ?? '',
		view: 'board' === q.get( 'view' ) ? 'board' : 'list',
		entry: positive( q.get( 'entry' ) ) || null,
	};
}

/** The address of a state; other parameters (page=funnelforms-entries) stay. */
export function addressOf( state: EntriesState, href: string ): string {
	const url = new URL( href );
	for ( const key of [ 'form', 'leadStatus', 'status', 'payment', 'device', 'assignedTo', 'tag', 'search', 'archived', 'read', 'sort', 'paged', 'period', 'view', 'entry' ] ) {
		url.searchParams.delete( key );
	}
	const f = state.filter;
	const set = ( key: string, value: string | number | undefined ): void => {
		if ( undefined !== value && '' !== value ) {
			url.searchParams.set( key, String( value ) );
		}
	};
	set( 'form', f.form );
	set( 'leadStatus', f.leadStatus );
	set( 'status', f.status );
	set( 'payment', f.payment );
	set( 'device', f.device );
	set( 'assignedTo', f.assignedTo );
	set( 'tag', f.tag );
	set( 'search', f.search );
	set( 'archived', f.archived ? 1 : undefined );
	set( 'read', false === f.read ? 0 : undefined );
	set( 'sort', f.sort );
	set( 'paged', f.page && f.page > 1 ? f.page : undefined );
	set( 'period', state.period );
	set( 'view', 'board' === state.view ? 'board' : undefined );
	set( 'entry', state.entry ?? undefined );
	return url.toString();
}

/** Start of a period in the editor's time zone, as RFC 3339; undefined for all time. */
export function periodStart( period: Period, now: Date = new Date() ): string | undefined {
	if ( '' === period ) {
		return undefined;
	}
	const start = new Date( now );
	start.setHours( 0, 0, 0, 0 );
	const days = { today: 0, '7d': 6, '30d': 29, '90d': 89 }[ period ];
	start.setDate( start.getDate() - days );
	return start.toISOString();
}

/** Text of a stored value: lists joined, numbers as they are, yes/no for booleans. */
export function valueText( value: unknown, yes = 'Yes', no = 'No' ): string {
	if ( null === value || undefined === value ) {
		return '';
	}
	if ( Array.isArray( value ) ) {
		return value
			.map( ( v ) => valueText( v, yes, no ) )
			.filter( ( v ) => '' !== v )
			.join( ', ' );
	}
	if ( 'boolean' === typeof value ) {
		return value ? yes : no;
	}
	if ( 'object' === typeof value ) {
		return Object.entries( value as Record<string, unknown> )
			.map( ( [ k, v ] ) => ( /^\d+$/.test( k ) ? valueText( v, yes, no ) : `${ k }: ${ valueText( v, yes, no ) }` ) )
			.filter( ( v ) => '' !== v )
			.join( ', ' );
	}
	return String( value );
}

function contactValue( entry: EntrySummary, test: ( field: { label: string; type: string } ) => boolean ): string {
	for ( const field of entry.contact ) {
		const text = valueText( field.value ).trim();
		if ( '' !== text && test( field ) ) {
			return text;
		}
	}
	return '';
}

/** E-mail address of the visitor, when the entry has one. */
export function entryEmail( entry: EntrySummary ): string {
	return contactValue( entry, ( f ) => 'email' === f.type );
}

export function entryPhone( entry: EntrySummary ): string {
	return contactValue( entry, ( f ) => 'phone' === f.type || 'tel' === f.type );
}

/** Who sent the entry: a name field, else the e-mail address, else the first contact value. */
export function entryName( entry: EntrySummary ): string {
	const named = contactValue( entry, ( f ) => 'name' === f.type || 'salutation' !== f.type && /name/i.test( f.label ) && 'email' !== f.type );
	return named || entryEmail( entry ) || contactValue( entry, ( f ) => 'consent' !== f.type && 'checkbox' !== f.type );
}

/**
 * Tags as typed: separated by commas, lower case, without inner commas, each once, at most 20
 * of 40 characters (as the server stores them).
 */
export function parseTags( input: string ): string[] {
	const out: string[] = [];
	for ( const raw of input.split( ',' ) ) {
		const tag = raw.trim().toLowerCase().replace( /\s+/g, ' ' ).slice( 0, MAX_TAG_LENGTH ).trim();
		if ( '' !== tag && ! out.includes( tag ) ) {
			out.push( tag );
		}
	}
	return out.slice( 0, MAX_TAGS );
}

/** The export link with the filters the export knows. */
export function exportLink( base: string, filter: EntryFilter, format: 'csv' | 'excel' ): string {
	const url = new URL( base, 'http://localhost' );
	const set = ( key: string, value: string | number | undefined ): void => {
		if ( undefined !== value && '' !== value ) {
			url.searchParams.set( key, String( value ) );
		}
	};
	set( 'form', filter.form );
	set( 'status', filter.status );
	set( 'leadStatus', filter.leadStatus );
	set( 'tag', filter.tag );
	set( 'assignedTo', filter.assignedTo );
	set( 'payment', filter.payment );
	set( 'device', filter.device );
	set( 'archived', filter.archived ? 1 : 0 );
	set( 'format', 'excel' === format ? 'excel' : undefined );
	return /^https?:/.test( base ) ? url.toString() : url.pathname + url.search;
}

/**
 * Entries by lead stage, for the board: one list per key, in the order of the keys. An entry in a
 * stage the board does not have (deleted elsewhere) goes into the first column, where new entries are.
 */
export function byLeadStatus( entries: EntrySummary[], keys: readonly LeadStatus[] = LEAD_STATUSES ): Record<LeadStatus, EntrySummary[]> {
	const out: Record<LeadStatus, EntrySummary[]> = Object.fromEntries( keys.map( ( k ) => [ k, [] as EntrySummary[] ] ) );
	const first = keys.includes( 'new' ) ? 'new' : keys[ 0 ];
	for ( const entry of entries ) {
		( out[ entry.leadStatus ] ?? ( undefined === first ? undefined : out[ first ] ) )?.push( entry );
	}
	return out;
}

/** The stages of 5.0 with their standard names, until the site's own arrive. */
export function standardStages( name: ( key: LeadStatus ) => string ): LeadStage[] {
	const tones: Record<string, LeadStageTone> = { new: 'info', contacted: 'warning', won: 'success', lost: 'neutral' };
	return LEAD_STATUSES.map( ( key ) => ( { key, name: name( key ), tone: tones[ key ] ?? 'neutral', standard: true, locked: 'new' === key } ) );
}

/** The stages as the server takes them back; a new stage (no key yet) gets its key there. */
export function stageInputs( stages: readonly LeadStage[] ): LeadStageInput[] {
	return stages.map( ( s ) => ( s.key ? { key: s.key, name: s.name, tone: s.tone } : { name: s.name, tone: s.tone } ) );
}

/** The stages with the one at index moved by delta places (−1 left, 1 right); the same list when it cannot move. */
export function moveStage<T>( stages: readonly T[], index: number, delta: number ): T[] {
	const to = index + delta;
	if ( index < 0 || index >= stages.length || to < 0 || to >= stages.length || 0 === delta ) {
		return [ ...stages ];
	}
	const next = [ ...stages ];
	const [ item ] = next.splice( index, 1 );
	next.splice( to, 0, item as T );
	return next;
}

/** What is wrong with a stage name ('' when nothing): empty, too long, or the name of another stage. */
export function stageNameProblem( name: string, others: readonly string[] ): '' | 'empty' | 'long' | 'taken' {
	const clean = name.trim();
	if ( '' === clean ) {
		return 'empty';
	}
	if ( clean.length > MAX_STAGE_NAME ) {
		return 'long';
	}
	return others.some( ( o ) => o.trim().toLocaleLowerCase() === clean.toLocaleLowerCase() ) ? 'taken' : '';
}

/** Whether a filter narrows the list (to tell "no entries yet" from "none match"); the archive and the spam folder are places, not filters. */
export function filtered( state: EntriesState ): boolean {
	const ignore = [ 'page', 'perPage', 'archived', 'sort' ];
	return Object.entries( state.filter ).some( ( [ key, v ] ) => ! ignore.includes( key ) && ! ( 'status' === key && 'spam' === v ) && undefined !== v && '' !== v ) || '' !== state.period;
}

/** The moments the key figures of the list count from: today, the last 7 days and the 7 before. */
export function figureMoments( now: Date = new Date() ): { today: string; week: string; previous: string } {
	const week = new Date( periodStart( '7d', now ) as string );
	const previous = new Date( week );
	previous.setDate( previous.getDate() - 7 );
	return { today: periodStart( 'today', now ) as string, week: week.toISOString(), previous: previous.toISOString() };
}

/** Change in percent, rounded; null without a value before. */
export function change( now: number, before: number | null ): number | null {
	return null === before || 0 === before ? null : Math.round( ( 100 * ( now - before ) ) / before );
}

function languageTag( locale?: string ): string | undefined {
	return ( locale ?? '' ).replace( '_', '-' ) || undefined;
}

/**
 * When something happened, as people say it: "5 min. ago", "yesterday", "3 days ago"; a date
 * after a week.
 */
export function relativeTime( iso: string | null, now: Date = new Date(), locale?: string ): string {
	if ( ! iso ) {
		return '';
	}
	const then = new Date( iso );
	if ( Number.isNaN( then.getTime() ) ) {
		return '';
	}
	const tag = languageTag( locale );
	const seconds = Math.round( ( then.getTime() - now.getTime() ) / 1000 );
	const past = -seconds;
	let format: Intl.RelativeTimeFormat;
	try {
		format = new Intl.RelativeTimeFormat( tag, { numeric: 'auto', style: 'short' } );
	} catch {
		format = new Intl.RelativeTimeFormat( undefined, { numeric: 'auto', style: 'short' } );
	}
	if ( past < 45 ) {
		return format.format( 0, 'second' );
	}
	if ( past < 3600 ) {
		return format.format( -Math.max( 1, Math.round( past / 60 ) ), 'minute' );
	}
	if ( past < 86400 ) {
		return format.format( -Math.round( past / 3600 ), 'hour' );
	}
	// Days by the calendar: yesterday is yesterday, also 20 hours ago.
	const day = ( d: Date ): number => Date.UTC( d.getFullYear(), d.getMonth(), d.getDate() ) / 86400000;
	const days = day( now ) - day( then );
	if ( days < 7 ) {
		return format.format( -Math.max( 1, days ), 'day' );
	}
	const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
	if ( then.getFullYear() !== now.getFullYear() ) {
		options.year = 'numeric';
	}
	try {
		return new Intl.DateTimeFormat( tag, options ).format( then );
	} catch {
		return then.toLocaleDateString();
	}
}

/** Up to two letters for an avatar: the initials of a name, or the start of an e-mail address. */
export function initials( name: string ): string {
	const text = name.trim();
	if ( '' === text ) {
		return '';
	}
	if ( text.includes( '@' ) && ! text.includes( ' ' ) ) {
		return text.slice( 0, 1 ).toUpperCase();
	}
	const words = text.split( /\s+/ ).filter( ( w ) => /\p{L}|\p{N}/u.test( w ) );
	const picked = words.length > 1 ? [ words[ 0 ] ?? '', words[ words.length - 1 ] ?? '' ] : words;
	const letters = picked.map( ( w ) => [ ...w.replace( /^[^\p{L}\p{N}]+/u, '' ) ][ 0 ] ?? '' );
	return letters.join( '' ).toUpperCase();
}

/** One of six avatar colours, always the same for the same name. */
export function avatarTone( seed: string ): number {
	let hash = 0;
	for ( const char of seed ) {
		hash = ( hash * 31 + ( char.codePointAt( 0 ) ?? 0 ) ) % 9973;
	}
	return hash % 6;
}
