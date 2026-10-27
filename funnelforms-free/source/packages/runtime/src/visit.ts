/**
 * How long a visitor takes to fill in the form, overall and per step, for the lead analysis of the
 * plugin (meta.visit). Times count from the first interaction; nothing here identifies a visitor.
 */
export class VisitClock {
	// Unset until the visitor starts and sees a step.
	private startedAt!: number;
	private current!: string;
	private shownAt!: number;
	private readonly steps: Record<string, number> = {};

	/** The visitor starts (first click, key or focus). */
	start(): void {
		if ( ! this.startedAt ) {
			this.startedAt = Date.now();
			this.shownAt = this.startedAt;
		}
	}

	/** A step is shown; the time on the one before is added up. */
	enter( node: string ): void {
		this.leave();
		this.current = node;
		this.shownAt = Date.now();
	}

	/** Seconds overall and per step (rounded), and the address the visitor came from without query. */
	summary(): { seconds?: number; steps: Record<string, number>; referrer: string } {
		this.leave();
		this.shownAt = Date.now();
		const steps: Record<string, number> = {};
		for ( const [ node, ms ] of Object.entries( this.steps ) ) {
			steps[ node ] = Math.round( ms / 1000 );
		}
		return {
			// Left out of the JSON when the visitor never started.
			seconds: this.startedAt ? Math.round( ( Date.now() - this.startedAt ) / 1000 ) : undefined,
			steps,
			referrer: referrerOf( document.referrer ),
		};
	}

	private leave(): void {
		if ( this.startedAt && this.current ) {
			this.steps[ this.current ] = ( this.steps[ this.current ] || 0 ) + Math.max( 0, Date.now() - this.shownAt );
		}
	}
}

/** A web address without query and fragment; empty for anything else. */
export function referrerOf( url: string ): string {
	try {
		const parsed = new URL( url );
		return /^https?:$/.test( parsed.protocol ) ? parsed.origin + parsed.pathname : '';
	} catch {
		return '';
	}
}
