/**
 * FormsApi over the plugin's REST routes (funnelforms/v1/admin/forms, docs/api/forms.md).
 */
import type { FormDocument } from '@funnelforms/form-schema';
import { ApiError } from './api';
import { createConnectApi, type ConnectApi } from './connect';
import { createHubApi, type HubApi } from './hub';
import { __ } from './ui/i18n';
import type { PredictionFigures, PredictionParameters, StoredPrediction } from './predict';
import type { AiChange, AiCreated, PredictionHistory, PredictionQuota, PredictionRun, Appointment, BookingConfig, BookingType, BookingTypes, Branding, BulkChanges, CalendarChoice, CalendarSignIn, CalendarsOverview, Connection, ConnectionTest, ConnectionTestResult, EntriesApi, EntryChanges, EntryDetail, EntryFigures, EntryFiguresQuery, EntryFilter, EntryList, EntryNote, EntryPayment, EntrySummary, ExperimentStats, LeadStage, LeadStageInput, FontFile, FormDetail, FormFigures, FormList, FormsApi, FormStatsReport, FormStatus, GoogleFont, IconLibrary, ImportedForm, ListQuery, MediaFile, MediaImage, NewWhatsAppTemplate, PublishResult, Revision, SavedStyle, SaveResult, SiteDesign, SitePage, TemplateCatalog, UserRef, WhatsAppTemplate } from './api';

export interface WpRestOptions {
	/** REST root as WordPress prints it (wpApiSettings.root): …/wp-json/ or …/?rest_route=/ */
	root: string;
	/** Nonce for the login cookie (wp_rest). */
	nonce: string;
	/** Address of the icon set (Frontend\Icons::url()). */
	icons?: string;
	/** Address of the site's logo (Application\SiteLogo::url()). */
	logo?: string | null;
	fetch?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A prediction the Funnelforms server works on is asked for every 3 seconds, for up to 150 seconds (the AI stops after 90). */
const PREDICTION_POLL_MS = 3000;
const PREDICTION_POLLS = 50;
/** Answers in a row without the plugin (a web server or the connection failed) before polling gives up. */
const PREDICTION_MISSES = 3;

const pause = ( ms: number ): Promise<void> => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

/** The part of wp.media (wp_enqueue_media) the builder uses. */
interface WpMediaAttachment {
	id: number;
	url: string;
	alt?: string;
	type?: string;
	title?: string;
	filename?: string;
}
interface WpMedia {
	( options: Record<string, unknown> ): {
		on( event: string, callback: () => void ): void;
		open(): void;
		state(): { get( name: string ): { first(): { toJSON(): WpMediaAttachment } | undefined } };
	};
	attachment( id: number ): { fetch(): PromiseLike<unknown>; toJSON(): WpMediaAttachment };
}

function wpMedia(): WpMedia | null {
	const wp = ( globalThis as { wp?: { media?: WpMedia } } ).wp;
	return wp?.media ?? null;
}

function toImage( a: WpMediaAttachment | undefined ): MediaImage | null {
	return a && a.id && a.url && ( undefined === a.type || 'image' === a.type ) ? { id: a.id, url: a.url, alt: a.alt ?? '' } : null;
}

export class WpRestAdapter implements FormsApi, EntriesApi {
	private readonly fetcher: typeof fetch;
	private nonce: string;
	private iconLibrary: Promise<IconLibrary> | null = null;
	/** CRM connections and the import of forms of other plugins. */
	readonly connect: ConnectApi = createConnectApi( ( method, path, body ) => this.request( method, path, body ) );
	/** The overview of Funnelforms → Integrations. */
	readonly hub: HubApi = createHubApi( ( method, path, body ) => this.request( method, path, body ) );

	constructor( private readonly options: WpRestOptions ) {
		this.fetcher = options.fetch ?? ( ( input, init ) => fetch( input, init ) );
		this.nonce = options.nonce;
	}

	/**
	 * Address of a route below admin/forms (or, starting with "~/", below funnelforms/v1, or,
	 * starting with "^", any route such as ^wp/v2/pages), also for sites without pretty permalinks.
	 */
	url( path: string, query: Record<string, string | number | boolean | undefined> = {} ): string {
		const route = path.startsWith( '^' ) ? path.slice( 1 ) : path.startsWith( '~/' ) ? 'funnelforms/v1/' + path.slice( 2 ) : 'funnelforms/v1/admin/forms' + path;
		const url = new URL( this.options.root, 'http://localhost' );
		if ( url.searchParams.has( 'rest_route' ) ) {
			url.searchParams.set( 'rest_route', ( url.searchParams.get( 'rest_route' ) ?? '/' ).replace( /\/?$/, '/' ) + route );
		} else {
			url.pathname = url.pathname.replace( /\/?$/, '/' ) + route;
		}
		for ( const [ key, value ] of Object.entries( query ) ) {
			if ( undefined !== value && '' !== value ) {
				url.searchParams.set( key, String( value ) );
			}
		}
		return /^https?:/.test( this.options.root ) ? url.toString() : url.pathname + url.search;
	}

	private async request<T>( method: Method, path: string, body?: unknown, query: Record<string, string | number | boolean | undefined> = {} ): Promise<T> {
		return ( await this.send<T>( method, path, body, query ) ).data;
	}

	/** A request, with the headers of the answer (paging of lists). */
	private async send<T>( method: Method, path: string, body?: unknown, query: Record<string, string | number | boolean | undefined> = {} ): Promise<{ data: T; headers: Headers | undefined }> {
		const headers: Record<string, string> = { 'X-WP-Nonce': this.nonce, Accept: 'application/json' };
		// Some hosts block PUT, PATCH and DELETE; WordPress takes the method from this header, or from
		// _method in the address where a host strips the header.
		if ( 'GET' !== method && 'POST' !== method ) {
			headers[ 'X-HTTP-Method-Override' ] = method;
			query = { ...query, _method: method };
		}
		let payload: BodyInit | undefined;
		if ( body instanceof FormData ) {
			payload = body;
		} else if ( undefined !== body ) {
			headers[ 'Content-Type' ] = 'application/json';
			payload = JSON.stringify( body );
		}
		let response: Response;
		try {
			response = await this.fetcher( this.url( path, query ), {
				method: 'GET' === method ? 'GET' : 'POST',
				headers,
				body: payload,
				credentials: 'same-origin',
			} );
		} catch {
			throw new ApiError( 'offline', 'The server could not be reached.', 0 );
		}
		// WordPress answers with a fresh nonce; using it keeps an editor open all day working.
		const fresh = response.headers?.get( 'X-WP-Nonce' );
		if ( fresh ) {
			this.nonce = fresh;
		}
		const text = await response.text();
		let data: unknown = null;
		try {
			data = '' === text ? null : JSON.parse( text );
		} catch {
			data = null;
		}
		if ( ! response.ok ) {
			const error = ( data && 'object' === typeof data ? data : {} ) as Record<string, unknown>;
			// Without an answer of WordPress a web server or proxy stopped the request ("502 Bad Gateway").
			const fallback = response.status >= 500 ? __( 'The server of your website did not answer in time. Try again in a moment.', 'funnelforms-pro' ) : response.statusText;
			throw new ApiError( String( error.code ?? 'http_' + response.status ), String( error.message ?? fallback ), response.status, error );
		}
		return { data: data as T, headers: response.headers };
	}

	list( query: ListQuery = {} ): Promise<FormList> {
		return this.request( 'GET', '', undefined, { ...query } );
	}

	get( id: number ): Promise<FormDetail> {
		return this.request( 'GET', '/' + id );
	}

	create( title: string, category = '' ): Promise<FormDetail> {
		return this.request( 'POST', '', { title, category } );
	}

	update( id: number, changes: { category?: string; status?: FormStatus; publicSlug?: string } ): Promise<FormDetail> {
		return this.request( 'PATCH', '/' + id, changes );
	}

	async remove( id: number, force = false ): Promise<void> {
		await this.request( 'DELETE', '/' + id, undefined, { force: force ? 'true' : undefined } );
	}

	saveDraft( id: number, document: FormDocument ): Promise<SaveResult> {
		return this.request( 'PUT', '/' + id + '/draft', { document } );
	}

	dropDraft( id: number ): Promise<FormDetail> {
		return this.request( 'DELETE', '/' + id + '/draft' );
	}

	publish( id: number, note = '' ): Promise<PublishResult> {
		return this.request( 'POST', '/' + id + '/publish', { note } );
	}

	revisions( id: number ): Promise<Revision[]> {
		return this.request( 'GET', '/' + id + '/revisions' );
	}

	revision( id: number, revision: number ): Promise<Revision & { document: FormDocument }> {
		return this.request( 'GET', '/' + id + '/revisions/' + revision );
	}

	restore( id: number, revision: number ): Promise<FormDetail> {
		return this.request( 'POST', '/' + id + '/revisions/' + revision + '/restore' );
	}

	duplicate( id: number ): Promise<FormDetail> {
		return this.request( 'POST', '/' + id + '/duplicate' );
	}

	async lock( id: number, force = false ): Promise<void> {
		await this.request( 'POST', '/' + id + '/lock', { force } );
	}

	async unlock( id: number ): Promise<void> {
		await this.request( 'DELETE', '/' + id + '/lock' );
	}

	exportForm( id: number, revision: 'draft' | 'current' = 'draft' ): Promise<unknown> {
		return this.request( 'GET', '/' + id + '/export', undefined, { revision } );
	}

	preview( id: number, locale?: string ): Promise<{ html: string }> {
		return this.request( 'GET', '/' + id + '/preview', undefined, { locale } );
	}

	templates( locale?: string ): Promise<TemplateCatalog> {
		return this.request( 'GET', '/templates', undefined, { locale } );
	}

	templatePreview( id: string, locale?: string ): Promise<{ html: string }> {
		return this.request( 'GET', '/templates/' + encodeURIComponent( id ) + '/preview', undefined, { locale } );
	}

	fromTemplate( id: string, locale?: string ): Promise<FormDetail> {
		return this.request( 'POST', '/templates/' + encodeURIComponent( id ), locale ? { locale } : undefined );
	}

	aiCreate( prompt: string, locale?: string ): Promise<AiCreated> {
		return this.request( 'POST', '/ai', locale ? { prompt, locale } : { prompt } );
	}

	aiEdit( id: number, prompt: string, document: FormDocument ): Promise<AiChange> {
		return this.request( 'POST', '/' + id + '/ai', { prompt, document } );
	}

	/**
	 * The plugin answers 202 {pending} while the Funnelforms server works on the prediction in the
	 * background; then it is asked for every few seconds, so no request waits long enough for a web
	 * server to cut it off.
	 */
	async predict( id: number, document: FormDocument, parameters: PredictionParameters, visitors: number ): Promise<PredictionRun> {
		let answer = await this.request<PredictionRun | { pending: true }>( 'POST', '/' + id + '/prediction', { document, parameters, visitors } );
		let misses = 0;
		for ( let poll = 0; 'pending' in answer; poll++ ) {
			if ( poll >= PREDICTION_POLLS ) {
				throw new ApiError( 'ai_timeout', __( 'The AI took too long. Try again.', 'funnelforms-pro' ), 504 );
			}
			await pause( PREDICTION_POLL_MS );
			try {
				answer = await this.request<PredictionRun | { pending: true }>( 'GET', '/' + id + '/prediction/pending' );
				misses = 0;
			} catch ( e ) {
				const stopped = e instanceof ApiError && ( 'offline' === e.code || e.code.startsWith( 'http_' ) );
				if ( ! stopped || ++misses >= PREDICTION_MISSES ) {
					throw e;
				}
			}
		}
		return answer;
	}

	async lastPrediction( id: number ): Promise<StoredPrediction | null> {
		return ( await this.request<{ prediction: StoredPrediction | null }>( 'GET', '/' + id + '/prediction' ) ).prediction;
	}

	async markApplied( id: number, suggestions: string[], applied: boolean, summary = '' ): Promise<StoredPrediction> {
		return ( await this.request<{ prediction: StoredPrediction }>( 'POST', '/' + id + '/prediction/applied', { suggestions, applied, summary } ) ).prediction;
	}

	async saveFigures( id: number, figures: PredictionFigures ): Promise<StoredPrediction> {
		return ( await this.request<{ prediction: StoredPrediction }>( 'POST', '/' + id + '/prediction/figures', figures ) ).prediction;
	}

	async predictionHistory( id: number ): Promise<PredictionHistory> {
		const answer = await this.request<{ real?: PredictionHistory['real']; history?: PredictionHistory['history'] }>( 'GET', '/' + id + '/prediction' );
		return { real: answer.real ?? null, history: answer.history ?? [] };
	}

	async predictionQuota(): Promise<PredictionQuota | null> {
		return ( await this.request<{ quota: PredictionQuota | null }>( 'GET', '/prediction-quota' ) ).quota;
	}

	async styles(): Promise<SavedStyle[]> {
		return ( await this.request<{ styles: SavedStyle[] }>( 'GET', '/styles' ) ).styles;
	}

	saveStyle( name: string, tokens: Record<string, string> ): Promise<SavedStyle> {
		return this.request( 'POST', '/styles', { name, tokens } );
	}

	async deleteStyle( id: string ): Promise<void> {
		await this.request( 'DELETE', '/styles/' + encodeURIComponent( id ) );
	}

	async connections(): Promise<Connection[]> {
		return ( await this.request<{ connections: Connection[] }>( 'GET', '/connections' ) ).connections;
	}

	createConnection( type: string, label: string, credentials: Record<string, string | boolean> ): Promise<Connection> {
		return this.request( 'POST', '~/connections', { ...credentials, type, label } );
	}

	updateConnection( ref: string, credentials: Record<string, string> ): Promise<Connection> {
		return this.request( 'PATCH', '~/connections/' + ref, credentials );
	}

	async deleteConnection( ref: string ): Promise<void> {
		await this.request( 'DELETE', '~/connections/' + ref );
	}

	testConnection( ref: string, test: ConnectionTest ): Promise<ConnectionTestResult> {
		return this.request<ConnectionTestResult>( 'POST', '~/connections/' + ref + '/test', test );
	}

	async pages( search: string ): Promise<SitePage[]> {
		const list = await this.request<Array<{ id: number; title?: { rendered?: string }; link: string }>>( 'GET', '^wp/v2/pages', undefined, { search: search.trim(), per_page: 20, status: 'publish', _fields: 'id,title,link', orderby: search.trim() ? 'relevance' : 'title', order: 'asc' } );
		const decode = ( html: string ): string => {
			const el = globalThis.document?.createElement( 'textarea' );
			if ( ! el ) {
				return html;
			}
			el.innerHTML = html;
			return el.value;
		};
		return list.map( ( p ) => ( { id: p.id, title: decode( p.title?.rendered ?? '' ), url: p.link } ) );
	}

	startCalendarSignIn( provider: 'google' | 'microsoft', ref?: string ): Promise<{ url: string; state: string }> {
		return this.request( 'POST', '~/connections/oauth', { provider, ...( ref ? { ref } : {} ) } );
	}

	async whatsAppTemplates( ref: string ): Promise<WhatsAppTemplate[]> {
		return ( await this.request<{ templates: WhatsAppTemplate[] }>( 'GET', '/connections/' + ref + '/whatsapp-templates' ) ).templates;
	}

	async createWhatsAppTemplate( ref: string, template: NewWhatsAppTemplate ): Promise<WhatsAppTemplate> {
		return this.request( 'POST', '~/connections/' + ref + '/whatsapp-templates', template );
	}

	calendarsOverview(): Promise<CalendarsOverview> {
		return this.request( 'GET', '~/calendars' );
	}

	accountCalendars( ref: string ): Promise<CalendarChoice[]> {
		return this.request( 'GET', '~/connections/' + ref + '/calendars' );
	}

	arrangeCalendar( ref: string, changes: { calendar?: string; busy?: string[]; owner?: number } ): Promise<CalendarsOverview> {
		return this.request( 'PATCH', '~/calendars/' + ref, changes );
	}

	async calendarSignIn( state: string ): Promise<CalendarSignIn | null> {
		const result = await this.request<CalendarSignIn | { pending: true }>( 'GET', '~/connections/oauth/' + encodeURIComponent( state ) );
		return 'pending' in result ? null : result;
	}

	async experimentStats( formId: number ): Promise<ExperimentStats[]> {
		return ( await this.request<{ experiments?: ExperimentStats[] }>( 'GET', '~/stats/' + formId ) ).experiments ?? [];
	}

	formStats( formId: number, from?: string, to?: string, detail?: 'full', view?: 'canvas' ): Promise<FormStatsReport> {
		return this.request( 'GET', '~/stats/' + formId, undefined, { from, to, detail, view } );
	}

	async passwordHash( password: string ): Promise<string> {
		return ( await this.request<{ hash: string }>( 'POST', '/password-hash', { password } ) ).hash;
	}

	async fonts(): Promise<FontFile[]> {
		return ( await this.request<{ fonts: FontFile[] }>( 'GET', '/fonts' ) ).fonts;
	}

	uploadFont( file: Blob, name: string ): Promise<FontFile> {
		const body = new FormData();
		body.append( 'file', file, name );
		return this.request( 'POST', '/fonts', body );
	}

	async googleFonts(): Promise<GoogleFont[]> {
		return ( await this.request<{ fonts: GoogleFont[] }>( 'GET', '/fonts/google' ) ).fonts;
	}

	async installGoogleFont( family: string ): Promise<GoogleFont> {
		return { ...( await this.request<Omit<GoogleFont, 'installed'>>( 'POST', '/fonts/google', { family } ) ), installed: true };
	}

	/** The icon set, loaded once. */
	icons(): Promise<IconLibrary> {
		if ( ! this.iconLibrary ) {
			const url = this.options.icons;
			this.iconLibrary = url
				? this.fetcher( url, { credentials: 'same-origin' } ).then( async ( response ) => {
						if ( ! response.ok ) {
							throw new ApiError( 'icons_failed', __( 'The icons could not be loaded.', 'funnelforms-pro' ), response.status );
						}
						return ( await response.json() ) as IconLibrary;
				  } )
				: Promise.reject( new ApiError( 'icons_missing', __( 'The icons could not be loaded.', 'funnelforms-pro' ), 0 ) );
			// Another try after a failure.
			this.iconLibrary.catch( () => {
				this.iconLibrary = null;
			} );
		}
		return this.iconLibrary;
	}

	pickImage( current?: number ): Promise<MediaImage | null> {
		const media = wpMedia();
		if ( ! media ) {
			return Promise.resolve( null );
		}
		return new Promise( ( resolve ) => {
			let chosen: MediaImage | null = null;
			const frame = media( { title: __( 'Choose an image', 'funnelforms-pro' ), button: { text: __( 'Use this image', 'funnelforms-pro' ) }, library: { type: 'image' }, multiple: false } );
			frame.on( 'select', () => {
				chosen = toImage( frame.state().get( 'selection' ).first()?.toJSON() );
			} );
			frame.on( 'close', () => {
				// "close" follows "select"; let the selection land first.
				setTimeout( () => resolve( chosen ), 0 );
			} );
			if ( current ) {
				frame.on( 'open', () => {
					const selected = frame.state().get( 'selection' ) as unknown as { add?: ( a: unknown ) => void };
					selected.add?.( media.attachment( current ) );
				} );
			}
			frame.open();
		} );
	}

	pickFile(): Promise<MediaFile | null> {
		const media = wpMedia();
		if ( ! media ) {
			return Promise.resolve( null );
		}
		return new Promise( ( resolve ) => {
			let chosen: MediaFile | null = null;
			const frame = media( { title: __( 'Choose a file', 'funnelforms-pro' ), button: { text: __( 'Use this file', 'funnelforms-pro' ) }, multiple: false } );
			frame.on( 'select', () => {
				const a = frame.state().get( 'selection' ).first()?.toJSON();
				chosen = a && a.id && a.url ? { id: a.id, url: a.url, title: a.title || a.filename || '' } : null;
			} );
			frame.on( 'close', () => {
				setTimeout( () => resolve( chosen ), 0 );
			} );
			frame.open();
		} );
	}

	async image( id: number ): Promise<MediaImage | null> {
		const media = wpMedia();
		if ( ! media ) {
			return null;
		}
		const attachment = media.attachment( id );
		try {
			await attachment.fetch();
		} catch {
			return null;
		}
		return toImage( attachment.toJSON() );
	}

	branding( url: string, consent: boolean ): Promise<Branding> {
		return this.request( 'POST', '/branding', { url, consent } );
	}

	siteDesign(): Promise<SiteDesign> {
		return this.request( 'GET', '/site-design' );
	}

	get siteLogo(): string | null {
		return this.options.logo ?? null;
	}

	bookingTypes(): Promise<BookingTypes> {
		return this.request( 'GET', '/booking-types' );
	}

	saveBookingType( id: number | null, title: string, config: BookingConfig ): Promise<BookingType> {
		return null === id ? this.request( 'POST', '/booking-types', { title, config } ) : this.request( 'PUT', '/booking-types/' + id, { title, config } );
	}

	async deleteBookingType( id: number ): Promise<void> {
		await this.request( 'DELETE', '/booking-types/' + id );
	}

	async importFile( file: Blob, name: string ): Promise<ImportedForm[]> {
		const body = new FormData();
		body.append( 'file', file, name );
		const result = await this.request<{ forms: ImportedForm[] }>( 'POST', '/import', body );
		return result.forms;
	}

	async entries( filter: EntryFilter ): Promise<EntryList> {
		const { perPage, ...rest } = filter;
		const { data, headers } = await this.send<EntrySummary[]>( 'GET', '~/entries', undefined, { ...rest, per_page: perPage } );
		return { entries: data ?? [], total: Number( headers?.get( 'X-WP-Total' ) ?? data?.length ?? 0 ), pages: Number( headers?.get( 'X-WP-TotalPages' ) ?? 1 ) };
	}

	entry( id: number ): Promise<EntryDetail> {
		return this.request( 'GET', '~/entries/' + id );
	}

	updateEntry( id: number, changes: EntryChanges ): Promise<EntrySummary> {
		return this.request( 'PATCH', '~/entries/' + id, changes );
	}

	bulkEntries( ids: number[], changes: BulkChanges ): Promise<{ updated?: number; deleted?: number; released?: number; missing: number[] }> {
		return this.request( 'POST', '~/entries/bulk', { ...changes, ids } );
	}

	notSpam( id: number ): Promise<EntrySummary & { appointmentTaken: boolean }> {
		return this.request( 'POST', '~/entries/' + id + '/not-spam' );
	}

	async deleteEntry( id: number ): Promise<void> {
		await this.request( 'DELETE', '~/entries/' + id );
	}

	addNote( id: number, text: string ): Promise<EntryNote> {
		return this.request( 'POST', '~/entries/' + id + '/notes', { text } );
	}

	async deleteNote( id: number, note: number ): Promise<void> {
		await this.request( 'DELETE', '~/entries/' + id + '/notes/' + note );
	}

	async resend( id: number, action: string ): Promise<void> {
		await this.request( 'POST', '~/entries/' + id + '/resend', { action } );
	}

	checkPayment( id: number ): Promise<EntryPayment> {
		return this.request( 'POST', '~/entries/' + id + '/payment/check' );
	}

	cancelAppointment( id: number, appointment: number ): Promise<Appointment> {
		return this.request( 'POST', '~/entries/' + id + '/appointments/' + appointment + '/cancel' );
	}

	entryTags(): Promise<Array<{ tag: string; entries: number }>> {
		return this.request( 'GET', '~/entries/tags' );
	}

	assignees(): Promise<UserRef[]> {
		return this.request( 'GET', '~/entries/assignees' );
	}

	leadStages(): Promise<LeadStage[]> {
		return this.request( 'GET', '~/entries/stages' );
	}

	saveLeadStages( stages: LeadStageInput[], moveTo: Record<string, string> = {} ): Promise<LeadStage[]> {
		// An empty object, not an empty list, so the server reads a map.
		return this.request( 'PUT', '~/entries/stages', { stages, moveTo: { ...moveTo } } );
	}

	entryFigures( query: EntryFiguresQuery ): Promise<EntryFigures> {
		return this.request( 'GET', '~/stats/entries', undefined, { ...query } );
	}

	formFigures(): Promise<FormFigures> {
		return this.request( 'GET', '~/stats/forms' );
	}
}
