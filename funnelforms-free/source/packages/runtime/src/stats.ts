import type { Api } from './api';
import { allowed } from './consent';

export type StatsEvent = 'view' | 'start' | 'step' | 'variant' | 'answer' | 'source' | 'invalid' | 'field' | 'device' | 'visitor';

type Event = { event: StatsEvent; step: string; variant?: string };

/** Most events the plugin takes in one request. */
const BATCH = 30;

const FLUSH_MS = 1500;

/**
 * Key in localStorage of the visitor id of the extended statistics, "<id>.<expiry in ms>". The id
 * expires 180 days after it was made; visits do not extend it.
 */
export const VISITOR_KEY = 'ffx_vid';

const VISITOR_MS = 180 * 864e5;

/** A random id for this page view; nothing is stored in the browser. */
function pageViewId(): string {
	return Array.from( crypto.getRandomValues( new Uint8Array( 16 ) ), ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}

/** The stored visitor id while it is valid, else ''. Blocked storage throws. */
function storedVisitor(): string {
	const [ id = '', until ] = ( localStorage.getItem( VISITOR_KEY ) ?? '' ).split( '.' );
	return Number( until ) > Date.now() ? id : '';
}

/** A visitor id made on this page load: other forms of the page are no return visit. */
let fresh = '';

/**
 * The extended level of a view, decided when it is counted: the device class from the width of the
 * window, and the visitor (a new one gets the id of this page view), or null while statistics are
 * not allowed. A module function, so the Free build leaves it out.
 */
function extendedEvents( sid: string ): Event[] | null {
	if ( ! allowed( 'statistics' ) ) {
		return null;
	}
	const width = window.innerWidth;
	const events: Event[] = [ { event: 'device', step: width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop' } ];
	try {
		const id = storedVisitor();
		if ( ! id ) {
			localStorage.setItem( VISITOR_KEY, ( fresh = sid ) + '.' + ( Date.now() + VISITOR_MS ) );
		}
		events.push( { event: 'visitor', step: id || sid, variant: id && id !== fresh ? 'return' : 'new' } );
	} catch {
		// Without storage nobody can be recognised; the view counts without a visitor.
	}
	return events;
}

/**
 * Form statistics: the form was seen, the visitor began, which steps were shown (with the node
 * before), the answers of choice and dropdown fields, and fields whose check stopped the visitor,
 * each once per page view. Events are sent in small batches, and right away when the page is
 * hidden or closed. The plugin adds the sent form itself (FormStats in the plugin).
 *
 * Extended level (Pro): when statistics are allowed at the time of the view (allowed()), the view
 * also reports the device class and a visitor id kept in localStorage (new or return), and the
 * first input into each field is counted. Batches of such a view carry consent: 'statistics'.
 */
export class Stats {
	readonly sid = pageViewId();
	private readonly seen = new Set<string>();
	private queue: Event[] = [];
	/** Sent with the view: the variants of A/B tests and where the view came from. */
	private readonly withView: Event[] = [];
	private timer?: ReturnType<typeof setTimeout>;
	/** Whether the extended level applies to this page view; decided with the view. */
	private extended = false;

	/** @param enabled False for previews in the block editor and Elementor (inert), which count nothing. */
	constructor( private readonly api: Api, private readonly enabled = true ) {
		if ( ! enabled ) {
			return;
		}
		// An id that expired or is no longer allowed is deleted on every page load with a form.
		try {
			if ( 'free' === process.env.FUNNELFORMS_EDITION || ! allowed( 'statistics' ) || ! storedVisitor() ) {
				localStorage.removeItem( VISITOR_KEY );
			}
		} catch {
			// Nothing is stored where storage is blocked.
		}
		// For the plugin to read the host and the UTM parameters from (TrafficSources); both were in
		// the request of the page anyway. Nothing for a direct visit.
		if ( document.referrer || location.search ) {
			this.withView.push( { event: 'source', step: document.referrer, variant: location.search } );
		}
		document.addEventListener( 'visibilitychange', () => {
			if ( document.visibilityState === 'hidden' ) {
				this.flush( true );
			}
		} );
		window.addEventListener( 'pagehide', () => this.flush( true ) );
	}

	/** Counts the view once the form is on screen (at once where the browser cannot tell). */
	viewWhenVisible( root: HTMLElement ): void {
		// view() counts nothing when the statistics are off.
		if ( typeof IntersectionObserver === 'undefined' ) {
			this.view();
			return;
		}
		const observer = new IntersectionObserver( ( entries ) => {
			if ( entries.some( ( e ) => e.isIntersecting ) ) {
				observer.disconnect();
				this.view();
			}
		} );
		observer.observe( root );
	}

	/** The view, with the extended level when statistics are allowed now. */
	private view(): void {
		if ( this.enabled && 'free' !== process.env.FUNNELFORMS_EDITION ) {
			const extended = extendedEvents( this.sid );
			this.extended = null !== extended;
			this.withView.push( ...( extended ?? [] ) );
		}
		this.record( 'view' );
	}

	/** The variant of an A/B test this page view shows; reported with the view, so unseen forms count for no variant. */
	variant( experiment: string, variant: string ): void {
		this.withView.push( { event: 'variant', step: experiment, variant } );
	}

	/** An event once per page view; a step with the node before it as variant ('' for the first). */
	record( event: StatsEvent, step = '', variant?: string ): void {
		if ( this.once( event, step + '|' + variant ) ) {
			this.push( ...( event === 'view' ? this.withView : [] ), { event, step, variant } );
		}
	}

	/** First input into a field (extended level only). */
	field( id: string ): void {
		if ( this.extended ) {
			this.record( 'field', id );
		}
	}

	/** True the first time an event happens in this page view, while statistics are on. */
	private once( event: StatsEvent, step: string ): boolean {
		const key = `${ event }|${ step }`;
		const first = this.enabled && ! this.seen.has( key );
		this.seen.add( key );
		return first;
	}

	private push( ...events: Event[] ): void {
		this.queue.push( ...events );
		this.timer ||= setTimeout( () => this.flush(), FLUSH_MS );
	}

	/**
	 * The answer of a choice or dropdown field: the ids of the chosen options, never text. Once per
	 * field and page view, when the visitor leaves its step (going back and changing it later is not
	 * counted again).
	 */
	answer( field: string, options: string[] ): void {
		if ( options.length > 0 && this.once( 'answer', field ) ) {
			this.push( ...options.map( ( option ) => ( { event: 'answer' as const, step: field, variant: option } ) ) );
		}
	}

	flush( keepalive = false ): void {
		clearTimeout( this.timer );
		this.timer = undefined;
		while ( this.queue.length > 0 ) {
			const events = this.queue.splice( 0, BATCH );
			// Statistics never get in the visitor's way.
			this.api.events( this.sid, events, keepalive, this.extended ).catch( () => undefined );
		}
	}
}
