import type { FreeTimes } from './booking';

/**
 * REST client for funnelforms/v1/forms/<uid> (Http\FormsController in the plugin).
 */
export interface ApiResult<T> {
	status: number;
	data: T;
}

export interface UploadResult {
	ok: true;
	ref: string;
	name: string;
	size: number;
}

export interface ErrorBody {
	ok: false;
	code: string;
	fields?: Record<string, string>;
}

const MIN_TOKEN_AGE_MS = 3200;
const wait = ( ms: number ): Promise<void> => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

export class Api {
	private tokenPromise: Promise<string> | null = null;
	private tokenAt = 0;
	/** Signed start of the visit, for forms with a time limit; new tokens keep it. */
	private started = '';
	/** Seconds left of the time limit, from each token answer. */
	onTimeLeft: ( ( seconds: number ) => void ) | null = null;

	/** @param unlock Key of a password-protected form, sent with every request. */
	constructor( private readonly endpoint: string, private readonly unlock = '' ) {}

	/**
	 * Fetches a submit token early, when the visitor starts, so the time trap has passed at submit.
	 * With extend, the time limit starts again (the visitor asked for more time, WCAG 2.2.1).
	 */
	prepare( extend = false ): void {
		if ( ! this.tokenPromise || extend ) {
			this.tokenAt = Date.now();
			const promise = this.post<{ token?: string; started?: string; timeLeft?: number }>( '/token', this.started ? { started: this.started, ...( extend ? { extend: true } : {} ) } : {} ).then( ( r ) => {
				if ( ! r.data.token ) {
					throw new Error( ( r.data as unknown as ErrorBody ).code ?? 'token' );
				}
				if ( typeof r.data.started === 'string' ) {
					this.started = r.data.started;
				}
				if ( typeof r.data.timeLeft === 'number' ) {
					this.onTimeLeft?.( r.data.timeLeft );
				}
				return r.data.token;
			} );
			// A failed request is not kept, so the next call asks again.
			promise.catch( () => {
				if ( this.tokenPromise === promise ) {
					this.tokenPromise = null;
				}
			} );
			this.tokenPromise = promise;
		}
	}

	/** Sends the entry; retries once with a new token when the first was too young, used, expired or not issued. */
	async submit<T>( body: Record<string, unknown> ): Promise<ApiResult<T | ErrorBody>> {
		for ( let attempt = 0; ; attempt++ ) {
			this.prepare();
			let token: string;
			try {
				token = await ( this.tokenPromise as Promise<string> );
			} catch ( error ) {
				if ( attempt === 0 ) {
					continue;
				}
				throw error;
			}
			const age = Date.now() - this.tokenAt;
			if ( age < MIN_TOKEN_AGE_MS ) {
				await wait( MIN_TOKEN_AGE_MS - age );
			}
			// A token is used once, whatever the answer.
			this.tokenPromise = null;
			const result = await this.post<T | ErrorBody>( '/entries', { ...body, token, ...( this.started ? { started: this.started } : {} ) } );
			const code = ( result.data as ErrorBody ).code;
			if ( attempt === 0 && [ 'too_fast', 'token_used', 'token_expired', 'token_invalid' ].includes( code ) ) {
				continue;
			}
			return result;
		}
	}

	/** Uploads one file for a file field; the token is checked, not used up. */
	async upload( fieldId: string, file: File ): Promise<ApiResult<UploadResult | ErrorBody>> {
		this.prepare();
		const token = await ( this.tokenPromise as Promise<string> );
		const body = new FormData();
		body.append( 'token', token );
		body.append( 'field', fieldId );
		if ( this.unlock ) {
			body.append( 'unlock', this.unlock );
		}
		body.append( 'file', file, file.name );
		return this.request<UploadResult | ErrorBody>( '/files', body );
	}

	/** Saves the answers so far as an incomplete entry; answers the draft key. The token is checked, not used up. */
	async savePartial( body: Record<string, unknown> ): Promise<string | null> {
		this.prepare();
		const token = await ( this.tokenPromise as Promise<string> );
		const result = await this.post<{ draft?: string }>( '/partials', { ...body, token } );
		return typeof result.data.draft === 'string' ? result.data.draft : null;
	}

	/** Saves the answers so far for a resume link; the token is checked, not used up. */
	async saveProgress( body: Record<string, unknown> ): Promise<ApiResult<{ ok: true; key: string; expiresAt: string } | ErrorBody>> {
		this.prepare();
		const token = await ( this.tokenPromise as Promise<string> );
		return this.post( '/progress', { ...body, token } );
	}

	/** The saved answers of a resume link. */
	loadProgress( key: string ): Promise<ApiResult<{ ok: true; answers: Record<string, unknown>; variants?: Record<string, string>; contact?: Record<string, string> } | ErrorBody>> {
		return this.post( '/progress/load', { key } );
	}

	/** Formatted results of calculations for the answers so far (ids "<id>:text": the text of the result's range, in `locale`). */
	async calculate( answers: Record<string, unknown>, ids: string[], locale: string ): Promise<Record<string, string>> {
		const result = await this.post<{ calculations?: Record<string, string> }>( '/calculations', { answers, ids, locale } );
		return result.data.calculations ?? {};
	}

	/** The node after a step whose edges compare calculation results. */
	next( answers: Record<string, unknown>, node: string, variants: Record<string, string> = {} ): Promise<ApiResult<{ ok: true; next: string | null } | ErrorBody>> {
		return this.post( '/next', { answers, node, variants } );
	}

	/** Free times of a booking field between two days. */
	slots( field: string, from: string, to: string, duration: number ): Promise<ApiResult<FreeTimes | ErrorBody>> {
		return this.post( '/slots', { field, from, to, duration } );
	}

	/** Another attempt at a payment that did not go through; answers the payment page. */
	retryPayment( payment: string ): Promise<ApiResult<{ ok: true; url: string | null; status: string } | ErrorBody>> {
		return this.post( '/payments/retry', { payment } );
	}

	/**
	 * Reports what the page view saw (form statistics); keepalive lets it finish while the page
	 * closes. extended: the view has the extended level, sent as consent: 'statistics'.
	 */
	async events( sid: string, events: Array<{ event: string; step: string; variant?: string }>, keepalive = false, extended = false ): Promise<void> {
		await this.post( '/events', { sid, events, consent: extended ? 'statistics' : undefined }, keepalive );
	}

	private post<T>( path: string, body: Record<string, unknown>, keepalive = false ): Promise<ApiResult<T>> {
		return this.request<T>( path, JSON.stringify( this.unlock ? { ...body, unlock: this.unlock } : body ), keepalive );
	}

	/** Sends the password of a protected form; answers the full configuration with the unlock key. */
	async unlockWith<T>( password: string ): Promise<ApiResult<T | ErrorBody>> {
		return this.post<T | ErrorBody>( '/unlock', { password } );
	}

	private async request<T>( path: string, body: string | FormData, keepalive = false ): Promise<ApiResult<T>> {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if ( typeof body === 'string' ) {
			headers[ 'Content-Type' ] = 'application/json';
		}
		const response = await fetch( this.endpoint + path, {
			method: 'POST',
			headers,
			body,
			credentials: 'omit',
			...( keepalive ? { keepalive: true } : {} ),
		} );
		let data: unknown = {};
		try {
			data = await response.json();
		} catch {
			data = { ok: false, code: `http_${ response.status }` };
		}
		return { status: response.status, data: data as T };
	}
}
