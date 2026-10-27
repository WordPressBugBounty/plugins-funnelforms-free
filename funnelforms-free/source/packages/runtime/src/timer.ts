import { h } from './dom';

/** Seconds before the end at which the visitor is warned and offered more time. */
const WARN = 20;

/** Seconds as a clock: 4:05, or 1:02:05 from an hour on. */
export function clock( seconds: number ): string {
	const s = Math.max( 0, Math.floor( seconds ) );
	const pad = ( n: number ): string => String( n ).padStart( 2, '0' );
	const hours = Math.floor( s / 3600 );
	const minutes = Math.floor( ( s % 3600 ) / 60 );
	return hours > 0 ? `${ hours }:${ pad( minutes ) }:${ pad( s % 60 ) }` : `${ minutes }:${ pad( s % 60 ) }`;
}

/**
 * Countdown of the form's time limit (settings.timeLimit). It starts with the first token, when the
 * visitor starts; the plugin checks the time again when the entry arrives.
 */
export class Countdown {
	readonly el: HTMLElement;
	private readonly clockEl: HTMLElement;
	private readonly warning: HTMLElement;
	private deadline = 0;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;

	/** @param more Asks for more time; the next start() sets the new deadline. */
	constructor( private readonly t: ( key: string ) => string, private readonly expired: () => void, more: () => void ) {
		this.clockEl = h( 'p', { class: 'ffx-timer', role: 'timer' } );
		const button = h( 'button', { type: 'button', class: 'ffx-button' }, t( 'more_time' ) );
		// More time once per visit (the plugin allows one extension): the button goes with the click.
		button.addEventListener( 'click', () => {
			button.hidden = true;
			more();
		} );
		this.warning = h( 'div', { class: 'ffx-timer-warning', role: 'alert', hidden: true } );
		this.el = h( 'div', { class: 'ffx-timer-box', hidden: true }, this.clockEl, this.warning );
		this.warning.append( h( 'span' ), button );
	}

	/** Starts, or goes on, with the seconds left the plugin counts (each token answer, more time). */
	start( seconds: number ): void {
		if ( this.stopped ) {
			return;
		}
		this.deadline = Date.now() + seconds * 1000;
		this.el.hidden = false;
		if ( this.timeout ) {
			clearTimeout( this.timeout );
		}
		this.tick();
	}

	/** Ends the countdown: the form was sent or the time is up. */
	stop(): void {
		this.stopped = true;
		if ( this.timeout ) {
			clearTimeout( this.timeout );
		}
		this.el.hidden = true;
	}

	private tick(): void {
		const left = Math.max( 0, Math.ceil( ( this.deadline - Date.now() ) / 1000 ) );
		this.clockEl.textContent = this.t( 'time_left' ).replace( '%s', clock( left ) );
		this.clockEl.classList.toggle( 'ffx-timer-low', left <= 60 );
		// Shown once per warning, so a screen reader announces it once, not every second.
		// At 0 the whole box is hidden below, so the warning needs no check for it.
		if ( left <= WARN && this.warning.hidden ) {
			( this.warning.firstChild as HTMLElement ).textContent = this.t( 'time_warning' ).replace( '%s', clock( left ) );
			this.warning.hidden = false;
		} else if ( left > WARN ) {
			this.warning.hidden = true;
		}
		if ( left === 0 ) {
			this.stop();
			this.expired();
			return;
		}
		// To the next full second, so the clock does not drift.
		this.timeout = setTimeout( () => this.tick(), ( ( this.deadline - Date.now() ) % 1000 ) || 1000 );
	}
}
