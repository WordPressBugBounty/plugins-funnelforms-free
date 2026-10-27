import type { ContactNode, EndNode, StepNode } from '@funnelforms/form-schema';
import { assignVariants, next as nextNode, pickText, progressMap, shownAnswers, startNode, usesCalculations, type Variants } from '@funnelforms/form-core';
import { Api, type ErrorBody } from './api';
import { sendAdsConversions, type AdsConversion } from './ads';
import { languageSwitch, languageTag } from './languages';
import { setPrivacy, trackingInfo } from './consent';
import { renderContactField, prefill, type ContactContext, type RenderedContactField } from './contact';
import { escapeHtml, h, textOf, trusted } from './dom';
import { countdown, successPage } from './end';
import { renderField, type FieldContext, type RenderedField, type UploadedFile } from './fields';
import { item, questionRedirectUrl, summary, summaryHtml, type PageInfo } from './summary';
import { Stats } from './stats';
import { Countdown } from './timer';
import { VisitClock } from './visit';
import { runCode } from './tracking';
import type { EndResponse, PaymentReturn, PaymentStart, RuntimeConfig } from './types';
import { checkContactField, checkStepField, filledItems, siteToday } from './validate';

type AnyNode = StepNode | ContactNode | EndNode;

/** Error codes with their own text instead of the generic one. */
/** Errors of booking fields on submit, shown at the appointment again. */
const BOOKING_ERRORS = [ 'slot_taken', 'booking_unavailable', 'invalid_booking' ];

const OWN_TEXT = [ 'rate_limited', 'form_closed', 'time_up', 'unlock_required', 'embed_not_allowed', 'nothing_to_save', 'progress_not_found', 'payment_unavailable', 'preview_unavailable' ];

/** Query parameter of resume links. */
export const RESUME_PARAM = 'ffx_resume';

/** Query parameter that shows chosen A/B variants, e.g. `headline:b`, for checking them; such views are not measured. */
export const VARIANT_PARAM = 'ffx_variant';

/** A random number in [0, 1) for drawing A/B variants. */
const random = (): number => ( globalThis.crypto.getRandomValues( new Uint32Array( 1 ) )[ 0 ] ?? 0 ) / 4294967296;

declare global {
	interface Window {
		dataLayer?: unknown[];
		/** Chunks that follow the form (chunks/hub.ts): forms waiting for a script, then the scripts' hub. */
		ffxLive?: { push( app: FormApp ): unknown };
	}
}

/** One form on the page. */
export class FormApp {
	readonly doc: RuntimeConfig[ 'document' ];
	private readonly nodes = new Map<string, AnyNode>();
	private progress: Map<string, number>;
	/** Variant of each A/B test for this page view, and the node the form starts at with them. */
	private variants: Variants;
	private start: string;
	private readonly api: Api;
	private readonly stats: Stats;
	/** Answers of step fields by field id, including steps the visitor left by going back. */
	private readonly values: Record<string, unknown> = {};
	private readonly contact: Record<string, unknown> = {};
	private readonly history: string[] = [];
	current = '';
	private busy = false;
	/** Uploads running on the current step. */
	private uploads = 0;
	private prefilled = false;
	private rendered: RenderedField[] = [];
	private renderedContact: RenderedContactField[] = [];
	private partial: Promise<void> = Promise.resolve();
	private readonly tracked = new Set<string>();
	private readonly trackingBox = h( 'div', { class: 'ffx-tracking', hidden: true } );
	private draft = '';
	/** Key of the resume link: from the link the visitor came with, or from the first save. */
	private resumeKey = '';
	/** Step whose right and wrong answers are shown (quiz with feedback); Next then moves on. */
	private revealed: string | null = null;
	/** The step that explains the required marker; the note shows only once per form. */
	private noteAt = '';
	/** While a step is drawn: values its fields set then (defaults, prefill) are no input of the visitor. */
	private rendering = false;
	/** Height of the tallest step so far that has no button of its own (without "adjust height"). */
	private tallest = 0;

	readonly card: HTMLElement;
	private readonly nav: HTMLElement;
	private readonly backButton: HTMLButtonElement;
	private readonly nextButton: HTMLButtonElement;
	private readonly saveButton: HTMLButtonElement | null = null;
	private readonly resumeBox: HTMLElement;
	/** The visitors' choice of language, on the first step only. */
	private readonly langBox: HTMLElement | null = null;
	private readonly bar: HTMLElement | null = null;
	private readonly barLabel: HTMLElement | null = null;
	/** "Step 2 of 5" above the bar, read out when the step changes. */
	private readonly stepLabel: HTMLElement | null = null;
	private readonly formError: HTMLElement;
	private readonly honeypot: HTMLInputElement;
	/** Time overall and per step, sent with the entry. */
	private readonly visit = new VisitClock();
	/** Countdown of the time limit, if the form has one. */
	private readonly countdown: Countdown | null = null;

	constructor( readonly root: HTMLElement, readonly config: RuntimeConfig, private readonly page: PageInfo ) {
		this.doc = config.document;
		// For chunks (styles.ts): endpoint, language and strings of the form.
		( root as unknown as { ffx: RuntimeConfig } ).ffx = config;
		setPrivacy( config.privacy );
		for ( const node of this.doc.nodes ) {
			this.nodes.set( node.id, node );
		}
		const query = new URLSearchParams( window.location.search );
		const forced = Object.fromEntries( ( query.get( VARIANT_PARAM ) ?? '' ).split( ',' ).map( ( pair ) => pair.split( ':' ) ).filter( ( pair ) => pair.length === 2 ) ) as Variants;
		this.variants = assignVariants( this.doc, random, forced );
		this.start = startNode( this.doc, this.variants );
		this.progress = progressMap( { ...this.doc, start: this.start } );
		this.api = new Api( config.endpoint, config.unlock );
		this.stats = new Stats( this.api, root.closest( '[inert]' ) === null && ! config.preview );
		// Only drawn variants of running tests count; a preview link would skew the figures.
		for ( const experiment of this.doc.experiments ?? [] ) {
			const variant = this.variants[ experiment.id ];
			// A test of designs: the variant's colours and shapes, as CSS variables made by the plugin.
			root.style.cssText += experiment.variants.find( ( v ) => v.id === variant )?.css ?? '';
			if ( experiment.status === 'running' && variant !== undefined && forced[ experiment.id ] === undefined ) {
				this.stats.variant( experiment.id, variant );
				this.push( { event: 'ffxExperiment', experiment: experiment.id, variant } );
			}
		}

		const settings = this.doc.settings;
		const heading = this.text( settings.heading );
		const locales = this.doc.locales.available;
		if ( settings.languageSwitch && locales.length > 1 && ! this.config.preview ) {
			this.langBox = languageSwitch( locales, this.config.locale, this.t( 'language' ) );
		}
		// Steps announce themselves by their heading (focused) and the step label, not as a whole.
		this.card = h( 'div', { class: 'ffx-card' } );
		this.formError = h( 'p', { class: 'ffx-error ffx-form-error', role: 'alert', hidden: true } );
		this.backButton = h( 'button', { type: 'button', class: 'ffx-button ffx-button-back' }, this.plain( settings.prevLabel ) || this.t( 'back' ) );
		this.nextButton = h( 'button', { type: 'button', class: 'ffx-button ffx-button-primary ffx-button-next' }, this.plain( settings.nextLabel ) || this.t( 'next' ) );
		this.backButton.addEventListener( 'click', () => this.back() );
		this.nextButton.addEventListener( 'click', () => this.next() );
		if ( settings.saveProgress ) {
			this.saveButton = h( 'button', { type: 'button', class: 'ffx-button ffx-button-save' }, this.t( 'save_progress' ) );
			this.saveButton.addEventListener( 'click', () => void this.saveProgress() );
		}
		this.resumeBox = h( 'div', { class: 'ffx-resume', role: 'status', hidden: true } );
		if ( settings.timeLimit ) {
			const limit = settings.timeLimit.minutes * 60;
			// The preview's token carries no time: there the clock simply starts again.
			const more = (): void => ( this.config.preview ? this.countdown?.start( limit ) : this.api.prepare( true ) );
			this.countdown = new Countdown( ( key ) => this.t( key ), () => this.timeUp(), more );
			this.api.onTimeLeft = ( seconds ) => this.countdown?.start( seconds );
		}
		// Left empty by people; bots that fill every input are turned away by the plugin.
		this.honeypot = h( 'input', { type: 'text', name: 'website', tabindex: -1, autocomplete: 'off', value: '' } );
		const trap = h( 'div', { class: 'ffx-hp', 'aria-hidden': 'true' }, this.honeypot );
		let progress: HTMLElement | null = null;
		if ( settings.progressBar.show ) {
			this.bar = h( 'div', { class: 'ffx-progress-bar' } );
			this.stepLabel = h( 'span', { class: 'ffx-progress-step' } );
			if ( settings.progressBar.percent ) {
				this.barLabel = h( 'span', { class: 'ffx-progress-label', 'aria-hidden': 'true' }, '0 %' );
			}
			progress = h(
				'div',
				{ class: 'ffx-progress-row' },
				h( 'div', { class: 'ffx-progress-meta' }, this.stepLabel, this.barLabel ),
				h( 'div', { class: 'ffx-progress', role: 'progressbar', 'aria-label': this.t( 'progress' ), 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.bar )
			);
		}
		// The bottom bar as in Funnelforms 3: Back, the progress with the step, Next.
		this.nav = h( 'div', { class: 'ffx-nav' }, this.backButton, progress, this.nextButton, this.saveButton );

		root.replaceChildren(
			h(
				'div',
				{ class: 'ffx-shell' },
				this.langBox,
				heading ? trusted( 'h2', heading, { class: 'ffx-heading' } ) : null,
				this.countdown?.el ?? null,
				this.card,
				this.formError,
				this.nav,
				this.resumeBox,
				trap,
				this.trackingBox
			)
		);
		root.classList.add( 'ffx-ready' );
		// The submit token is fetched once the visitor starts, so page views alone cost no request.
		let started = false;
		const start = (): void => {
			if ( ! started ) {
				started = true;
				this.api.prepare();
				this.stats.record( 'start' );
				this.visit.start();
				// The preview's token carries no time; there the limit starts with the visitor.
				if ( this.config.preview && settings.timeLimit ) {
					this.countdown?.start( settings.timeLimit.minutes * 60 );
				}
			}
		};
		for ( const type of [ 'pointerdown', 'keydown', 'focusin' ] ) {
			root.addEventListener( type, start, { once: true } );
		}
		if ( config.payment ) {
			// Back from the payment page: no new view, and no steps.
			this.paymentReturn( config.payment );
			return;
		}
		this.stats.viewWhenVisible( root );
		this.show( this.start, false );
		// Reminders to visitors who leave (chunks/abandon.ts) link back with a resume key too.
		const key = settings.saveProgress || ( 'free' !== process.env.FUNNELFORMS_EDITION && settings.abandonment ) ? query.get( RESUME_PARAM ) : null;
		if ( key ) {
			void this.resume( key );
		}
	}

	/** Loads the answers of a resume link and goes to the first step that still needs answers. */
	private async resume( key: string ): Promise<void> {
		this.busy = true;
		this.root.setAttribute( 'aria-busy', 'true' );
		try {
			const result = await this.api.loadProgress( key );
			if ( ! result.data.ok ) {
				this.fail( result.data.code );
				return;
			}
			this.resumeKey = key;
			Object.assign( this.values, result.data.answers );
			if ( 'free' !== process.env.FUNNELFORMS_EDITION ) {
				Object.assign( this.contact, result.data.contact );
			}
			// The path of the saved answers: the variants they were given with.
			if ( result.data.variants ) {
				this.variants = { ...this.variants, ...result.data.variants };
				this.start = startNode( this.doc, this.variants );
				this.progress = progressMap( { ...this.doc, start: this.start } );
			}
			let id = this.start;
			const seen = new Set<string>();
			while ( ! seen.has( id ) ) {
				seen.add( id );
				const node = this.nodes.get( id );
				// Content steps (results, calculations) are shown again; so is the first open step.
				this.current = id;
				const shown = this.shownFields();
				const fields = node?.type === 'step' ? node.fields.filter( ( f ) => f.type !== 'content' && f.type !== 'result' && shown.has( f.id ) ) : [];
				if ( ! fields.length || fields.some( ( f ) => this.values[ f.id ] === undefined ) ) {
					break;
				}
				// Where calculation results decide the way on, the visitor continues by hand.
				const target = usesCalculations( this.doc, id ) ? null : nextNode( this.doc, id, this.pathAnswers(), {}, this.variants, siteToday( this.config.timeZone ) );
				if ( ! target ) {
					break;
				}
				this.history.push( id );
				id = target;
			}
			this.show( id );
		} catch {
			this.fail( 'network' );
		} finally {
			this.busy = false;
			this.root.removeAttribute( 'aria-busy' );
		}
	}

	/** Saves the answers so far and shows the resume link. */
	private async saveProgress(): Promise<void> {
		const button = this.saveButton;
		if ( this.busy || this.uploads > 0 || ! button ) {
			return;
		}
		this.busy = true;
		button.disabled = true;
		this.formError.hidden = true;
		try {
			const result = await this.api.saveProgress( { answers: this.pathAnswers(), key: this.resumeKey, locale: this.config.locale, variants: this.variants } );
			if ( ! result.data.ok ) {
				this.fail( result.data.code );
				return;
			}
			this.resumeKey = result.data.key;
			const url = new URL( window.location.href );
			url.searchParams.set( RESUME_PARAM, this.resumeKey );
			url.hash = '';
			const link = h( 'input', { type: 'text', class: 'ffx-input ffx-resume-link', readonly: true, value: url.toString(), 'aria-label': this.t( 'resume_link' ) } );
			const copy = h( 'button', { type: 'button', class: 'ffx-button ffx-resume-copy' }, this.t( 'copy_link' ) );
			copy.addEventListener( 'click', () => {
				link.select();
				void navigator.clipboard?.writeText( link.value ).then( () => {
					copy.textContent = this.t( 'link_copied' );
				}, () => undefined );
			} );
			this.resumeBox.replaceChildren( h( 'p', {}, this.t( 'progress_saved' ) ), h( 'div', { class: 'ffx-resume-row' }, link, copy ) );
			this.resumeBox.hidden = false;
			link.focus();
			link.select();
		} catch {
			this.fail( 'network' );
		} finally {
			this.busy = false;
			button.disabled = false;
		}
	}

	text( value: Record<string, string> | undefined ): string {
		return pickText( value, this.config.locale, this.doc.locales.default );
	}

	/**
	 * Results of calculations in the texts of a step ({{calc:<id>}}, {{calc:<id>:text}}), computed by the plugin from the
	 * answers so far; forms with live results leave them to runtime-live.js (one request for both).
	 */
	private fillCalcs( root: HTMLElement ): void {
		if ( this.live() ) {
			return;
		}
		const spans = [ ...root.querySelectorAll<HTMLElement>( '[data-ffx-calc]' ) ];
		const done = ( values: Record<string, string> ): void =>
			spans.forEach( ( span ) => {
				span.textContent = values[ span.dataset.ffxCalc ?? '' ] ?? this.t( 'calc_error' );
				span.removeAttribute( 'aria-busy' );
			} );
		if ( spans.length ) {
			this.api.calculate( this.pathAnswers(), spans.map( ( s ) => s.dataset.ffxCalc ?? '' ), this.config.locale ).then( done, () => done( {} ) );
		}
	}

	/** A text with {{field:<key>}} replaced by the visitor's answer so far ("Hello {{field:name}}"). */
	piped( value: Record<string, string> | undefined, url = false ): string {
		const html = this.fillFields( this.text( value ), url ? encodeURIComponent : escapeHtml );
		return url || ! html.includes( '{{' )
			? html
			: html.replace( /\{\{\s*calc:([\w-]+(?::text)?)\s*\}\}/g, ( _m, id: string ) => `<span class="ffx-calc" data-ffx-calc="${ id }" aria-busy="true">…</span>` );
	}

	/** {{field:<key>}} in a text replaced by the answer so far, passed through `encode`. */
	private fillFields( text: string, encode: ( answer: string ) => string ): string {
		return text.includes( '{{' ) ? text.replace( /\{\{\s*field:([^}\s]+)\s*\}\}/g, ( _m, key: string ) => encode( this.answerOf( key ) ) ) : text;
	}

	/** The answer of the field with this key on the path, or of a contact field, as text. */
	private answerOf( key: string ): string {
		const shown = this.shownFields();
		for ( const step of this.pathSteps() ) {
			for ( const field of step.fields ) {
				if ( field.key === key && field.type !== 'content' && shown.has( field.id ) && this.values[ field.id ] !== undefined ) {
					return item( field, this.values[ field.id ], ( v ) => this.text( v ) ).answer;
				}
			}
		}
		for ( const node of this.nodes.values() ) {
			for ( const field of node.type === 'contact' ? node.fields : [] ) {
				const value = this.contact[ field.id ];
				if ( field.key !== key || typeof value !== 'string' ) {
					continue;
				}
				if ( field.type === 'salutation' ) {
					return this.t( `salutation_${ value }` );
				}
				if ( field.type === 'select' ) {
					const options = ( field.props as { options?: Array<{ id: string; label?: Record<string, string> }> } ).options ?? [];
					return textOf( this.text( options.find( ( o ) => o.id === value )?.label ) );
				}
				return value;
			}
		}
		return '';
	}

	private plain( value: Record<string, string> | undefined ): string {
		return this.text( value ).replace( /<[^>]*>/g, '' ).trim();
	}

	t( key: string ): string {
		return this.config.strings[ key ] ?? key;
	}

	/** Steps on the path, oldest first, ending with the current node. */
	pathSteps(): StepNode[] {
		return [ ...this.history, this.current ]
			.map( ( id ) => this.nodes.get( id ) )
			.filter( ( node ): node is StepNode => node?.type === 'step' );
	}

	/**
	 * Answers of the shown fields of the steps on the path only; answers on paths the visitor left,
	 * and of fields hidden by their conditions, do not count.
	 */
	pathAnswers(): Record<string, unknown> {
		return this.shown().answers;
	}

	/** The fields of the path that are shown (showWhen), with the answers that count. */
	private shown(): { fields: Set<string>; answers: Record<string, unknown> } {
		return shownAnswers( this.pathSteps(), this.allPathAnswers(), this.variants, siteToday( this.config.timeZone ) );
	}

	shownFields(): Set<string> {
		return this.shown().fields;
	}

	/** The visitor's own answers of the shown fields on the path, for lists of answers. */
	private shownValues(): Record<string, unknown> {
		const shown = this.shownFields();
		return Object.fromEntries( Object.entries( this.values ).filter( ( [ id ] ) => shown.has( id ) ) );
	}

	/** Answers of the steps on the path, as they are sent: file references and filled items. */
	private allPathAnswers(): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for ( const step of this.pathSteps() ) {
			for ( const field of step.fields ) {
				const value = this.values[ field.id ];
				if ( value !== undefined ) {
					// File fields send the references of their uploads, repeat groups their filled items.
					if ( field.type === 'repeat' ) {
						out[ field.id ] = filledItems( value );
					} else {
						out[ field.id ] = ( field.type === 'file' || field.type === 'signature' ) && Array.isArray( value ) ? ( value as UploadedFile[] ).map( ( f ) => f.ref ) : value;
					}
				}
			}
		}
		return out;
	}

	private show( id: string, moveFocus = true ): void {
		const node = this.nodes.get( id );
		if ( ! node ) {
			this.fail( 'unknown_node' );
			return;
		}
		this.current = id;
		this.visit.enter( id );
		this.revealed = null;
		this.formError.hidden = true;
		this.resumeBox.hidden = true;
		this.rendered = [];
		this.renderedContact = [];
		// The path: each node shown with the node before it, also an end reached from a question.
		this.stats.record( 'step', id, this.history[ this.history.length - 1 ] ?? '' );
		if ( node.type === 'end' ) {
			this.leaveFromQuestion( node );
			return;
		}
		this.rendering = true;
		const content = node.type === 'step' ? this.renderStep( node ) : this.renderContact( node );
		this.rendering = false;
		this.card.replaceChildren( content );
		this.fillCalcs( content );
		// Without "adjust height", the card keeps the height of its tallest step so buttons stay put. A step
		// with a button of its own (a result with "Get your quote", the contact step) takes its own height,
		// so no gap opens between its button and the bottom bar.
		if ( ! this.doc.settings.autoHeight ) {
			this.card.style.minHeight = '';
			if ( ! content.querySelector( '.ffx-content-button, .ffx-button-submit' ) ) {
				this.tallest = Math.max( this.tallest, this.card.offsetHeight );
				this.card.style.minHeight = this.tallest + 'px';
			}
		}
		if ( ! this.tracked.has( id ) ) {
			this.tracked.add( id );
			runCode( this.trackingBox, node.tracking?.onShow );
			for ( const field of node.type === 'step' ? node.fields : [] ) {
				runCode( this.trackingBox, field.tracking?.onShow );
			}
		}
		this.backButton.hidden = this.history.length === 0;
		if ( this.langBox ) {
			this.langBox.hidden = this.history.length > 0;
		}
		if ( this.saveButton ) {
			this.saveButton.hidden = node.type !== 'step';
		}
		this.nav.hidden = node.type === 'contact' && ! node.showBottomBar;
		this.setProgress( this.progress.get( id ) ?? 0 );
		if ( moveFocus ) {
			this.scrollIntoView();
			// The question, or the step itself where it has no heading (content and loading steps).
			const target = content.querySelector<HTMLElement>( '.ffx-question, .ffx-contact-title' ) ?? content;
			target.tabIndex = -1;
			target.focus( { preventScroll: true } );
		}
	}

	private renderStep( node: StepNode ): HTMLElement {
		// A live result asks nothing, so a single choice next to it still moves on by itself.
		const single = node.fields.filter( ( f ) => f.type !== 'result' ).length === 1;
		const ctx: FieldContext = {
			text: ( v ) => this.piped( v ),
			t: ( k ) => this.t( k ),
			get: ( f ) => this.values[ f ],
			set: ( f, v ) => {
				this.values[ f ] = v;
				this.touched( f );
				this.clearError( this.rendered.find( ( r ) => r.el.dataset.field === f )?.error );
				this.applyShown( node );
			},
			// Steps with several fields wait for Next; single choices and content buttons move on alone.
			advance: () => {
				if ( single ) {
					this.next();
				}
			},
			summaryHtml: () => summaryHtml( summary( this.pathSteps().filter( ( s ) => s.id !== node.id ), this.shownValues(), ( v ) => this.text( v ), true ) ),
			upload: async ( fieldId, file ) => {
				try {
					const result = await this.api.upload( fieldId, file );
					const data = result.data;
					return data.ok ? { ref: data.ref, name: data.name, size: data.size } : { error: data.code };
				} catch {
					return { error: 'upload_failed' };
				}
			},
			busy: ( on ) => {
				this.uploads = Math.max( 0, this.uploads + ( on ? 1 : -1 ) );
				this.nextButton.disabled = this.uploads > 0;
			},
			iconFont: this.doc.settings.iconFont,
			icons: this.config.icons,
			mapsKey: this.config.mapsKey || null,
			locale: languageTag( this.config.locale ),
			slots: async ( fieldId, from, to, duration ) => {
				try {
					const data = ( await this.api.slots( fieldId, from, to, duration ) ).data;
					return data.ok ? data : { error: data.code };
				} catch {
					return { error: 'network' };
				}
			},
		};
		this.uploads = 0;
		this.nextButton.disabled = false;
		const wrap = h( 'div', { class: 'ffx-step', 'data-node': node.id } );
		let marked = false;
		for ( const field of node.fields ) {
			const r = renderField( field, ctx );
			r.el.dataset.field = field.id;
			// Required questions carry a star (WCAG 3.3.2); inputs say so themselves, groups in their legend.
			const question = field.required && field.type !== 'content' ? [ ...r.el.children ].find( ( c ) => c.classList.contains( 'ffx-question' ) ) : undefined;
			if ( question ) {
				marked = true;
				question.append( h( 'span', { class: 'ffx-required', 'aria-hidden': 'true' }, ' *' ), question.tagName === 'LEGEND' ? h( 'span', { class: 'ffx-sr-only' }, ` ${ this.t( 'required_mark' ) }` ) : '' );
			}
			this.rendered.push( r );
			wrap.append( r.el );
		}
		if ( marked ) {
			wrap.append( this.requiredNote( node.id ) );
		}
		this.nextButton.hidden = single && this.rendered.some( ( r ) => r.selfAdvancing );
		this.nextButton.textContent = this.plain( this.doc.settings.nextLabel ) || this.t( 'next' );
		this.applyShown( node );
		return wrap;
	}

	/** Shows the fields of the step whose conditions hold for the answers so far, and hides the others. */
	private applyShown( node: StepNode ): void {
		if ( ! node.fields.some( ( f ) => f.showWhen ) ) {
			return;
		}
		const shown = this.shownFields();
		node.fields.forEach( ( field, i ) => {
			const r = this.rendered[ i ];
			if ( ! r || ! field.showWhen ) {
				return;
			}
			const hide = ! shown.has( field.id );
			if ( r.el.hidden !== hide ) {
				r.el.hidden = hide;
				// Field styles may set a display of their own, which would win over the attribute.
				r.el.style.display = hide ? 'none' : '';
				if ( hide ) {
					this.clearError( r.error );
				}
			}
		} );
	}

	/** The visitor changed a field (extended statistics count the first input; live results work out again). */
	private touched( field: string ): void {
		if ( ! this.rendering ) {
			this.stats.field( field );
			this.live();
		}
	}

	/**
	 * Tells the chunks that follow the form (runtime-live.js, runtime-abandon.js; chunks/hub.ts) of a
	 * new step or answer; until a script is there, the form waits in a list. True when live results take it.
	 */
	private live(): boolean {
		const chunks = 'free' !== process.env.FUNNELFORMS_EDITION ? this.root.dataset.ffxChunks ?? '' : '';
		if ( /\b(live|abandon)\b/.test( chunks ) ) {
			( window.ffxLive ??= [] as FormApp[] ).push( this );
		}
		return /\blive\b/.test( chunks );
	}

	/** Explains the asterisk on the first step that uses it, and on no later one. */
	private requiredNote( id: string ): HTMLElement | string {
		this.noteAt ||= id;
		return this.noteAt === id ? h( 'p', { class: 'ffx-required-note' }, this.t( 'required_note' ) ) : '';
	}

	private renderContact( node: ContactNode ): HTMLElement {
		const ctx: ContactContext = {
			text: ( v ) => this.piped( v ),
			t: ( k ) => this.t( k ),
			get: ( f ) => this.contact[ f ],
			set: ( f, v ) => {
				this.contact[ f ] = v;
				this.touched( f );
				this.clearError( this.renderedContact.find( ( r ) => r.field.id === f )?.error );
			},
			iconFont: this.doc.settings.iconFont,
			icons: this.config.icons,
			hideLabels: node.layout?.hideLabels === true,
		};
		if ( ! this.prefilled ) {
			this.prefilled = true;
			prefill( node, this.page.query, ctx );
		}
		const title = this.piped( node.title );
		const description = this.piped( node.description );
		const layout = node.layout ?? {};
		const form = h( 'form', {
			class: [
				'ffx-contact',
				layout.columns?.desktop === 2 ? 'ffx-contact-columns' : '',
				layout.columns?.mobile === 2 ? 'ffx-contact-columns-mobile' : '',
				layout.button?.size ? `ffx-submit-${ layout.button.size }` : '',
				layout.button?.align ? `ffx-submit-${ layout.button.align }` : '',
			].filter( Boolean ).join( ' ' ),
			novalidate: true,
			'data-node': node.id,
		} );
		if ( layout.inputHeight ) {
			form.style.setProperty( '--ffx-input-height', `${ layout.inputHeight }px` );
		}
		if ( title ) {
			form.append( trusted( 'h3', title, { class: 'ffx-contact-title' } ) );
		}
		if ( description ) {
			form.append( trusted( 'div', description, { class: 'ffx-description' } ) );
		}
		for ( const field of node.fields ) {
			const r = renderContactField( field, ctx );
			this.renderedContact.push( r );
			form.append( r.el );
		}
		if ( node.fields.some( ( f ) => f.required ) ) {
			form.append( this.requiredNote( node.id ) );
		}
		const submit = h( 'button', { type: 'submit', class: 'ffx-button ffx-button-primary ffx-button-submit' }, this.plain( node.submitLabel ) || this.t( 'submit' ) );
		form.append( submit );
		form.addEventListener( 'submit', ( event ) => {
			event.preventDefault();
			void this.submit( node, submit );
		} );
		this.nextButton.hidden = true;
		return form;
	}

	private next(): void {
		const node = this.nodes.get( this.current );
		if ( this.busy || this.uploads > 0 || node?.type !== 'step' ) {
			return;
		}
		let invalid: RenderedField | null = null;
		const shown = this.shownFields();
		node.fields.forEach( ( field, i ) => {
			const r = this.rendered[ i ];
			// Hidden fields are not asked: neither required nor checked.
			if ( ! shown.has( field.id ) ) {
				return;
			}
			let code: string | null = null;
			if ( r?.check ) {
				code = r.check() ? null : 'invalid';
			} else {
				code = checkStepField( field, this.values[ field.id ] );
				if ( r ) {
					this.setError( r.error, code );
				}
			}
			if ( code && r ) {
				// Where the check stops visitors, once per field and page view.
				this.stats.record( 'invalid', field.id );
				invalid ??= r;
			}
		} );
		if ( invalid ) {
			( invalid as RenderedField ).focus?.focus();
			return;
		}
		if ( this.doc.settings.quiz?.feedback && this.revealed !== node.id && this.reveal( node ) ) {
			return;
		}
		if ( usesCalculations( this.doc, this.current ) ) {
			void this.nextFromServer().then( ( target ) => {
				if ( target !== undefined ) {
					this.go( node, target );
				}
			} );
			return;
		}
		this.go( node, nextNode( this.doc, this.current, this.pathAnswers(), {}, this.variants, siteToday( this.config.timeZone ) ) );
	}

	/**
	 * Quiz with feedback: marks the right answers and the wrong choices of the step's questions and
	 * says whether the answer was right; the visitor goes on with Next. False when the step has no
	 * question with right answers.
	 */
	private reveal( node: StepNode ): boolean {
		let shown = false;
		const visible = this.shownFields();
		node.fields.forEach( ( field, i ) => {
			const r = this.rendered[ i ];
			const right = field.type === 'choice' || field.type === 'dropdown' ? field.options.filter( ( o ) => o.correct ) : [];
			if ( ! r || right.length === 0 || ! visible.has( field.id ) ) {
				return;
			}
			const ids = right.map( ( o ) => o.id );
			const chosen = [ this.values[ field.id ] ].flat().filter( ( v ): v is string => typeof v === 'string' );
			const ok = chosen.length === ids.length && ids.every( ( id ) => chosen.includes( id ) );
			r.el.querySelectorAll<HTMLElement>( '[data-option]' ).forEach( ( el ) => {
				const id = el.dataset.option ?? '';
				el.classList.toggle( 'is-right', ids.includes( id ) );
				el.classList.toggle( 'is-wrong', chosen.includes( id ) && ! ids.includes( id ) );
			} );
			r.el.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>( 'button, input, select' ).forEach( ( control ) => {
				control.disabled = true;
			} );
			r.el.classList.add( 'is-revealed' );
			const text = ok ? this.t( 'quizRight' ) : this.t( 'quizWrong' ).replace( '%s', right.map( ( o ) => this.plain( o.label ) ).join( ', ' ) );
			r.el.insertBefore( h( 'p', { class: `ffx-quiz-feedback ${ ok ? 'is-right' : 'is-wrong' }` }, text ), r.error );
			shown = true;
		} );
		if ( shown ) {
			this.revealed = node.id;
			this.nextButton.hidden = false;
			this.nextButton.focus( { preventScroll: true } );
		}
		return shown;
	}

	/** Leaves a valid step for the node after it. */
	private go( node: StepNode, target: string | null ): void {
		if ( ! target ) {
			this.fail( 'dead_end' );
			return;
		}
		const shown = this.shownFields();
		for ( const field of node.fields ) {
			if ( ! shown.has( field.id ) ) {
				continue;
			}
			if ( field.type !== 'content' && this.values[ field.id ] !== undefined ) {
				this.push( { event: 'af2NextSlide', ...item( field, this.values[ field.id ], ( v ) => this.text( v ) ) } );
			}
			if ( field.type === 'choice' || field.type === 'dropdown' ) {
				const ids = field.options.map( ( o ) => o.id );
				this.stats.answer( field.id, [ this.values[ field.id ] ].flat().filter( ( v ): v is string => typeof v === 'string' && ids.includes( v ) ) );
			}
		}
		const answers = this.pathAnswers();
		this.history.push( this.current );
		this.card.classList.remove( 'ffx-back' );
		this.show( target );
		this.savePartial( answers );
	}

	/**
	 * The node after a step whose edges compare calculation results: only the plugin knows the
	 * formulas. Undefined when the request failed (the error is shown).
	 */
	private async nextFromServer(): Promise<string | null | undefined> {
		this.busy = true;
		this.root.setAttribute( 'aria-busy', 'true' );
		try {
			const result = await this.api.next( this.pathAnswers(), this.current, this.variants );
			if ( ! result.data.ok ) {
				this.fail( result.data.code );
				return undefined;
			}
			return result.data.next;
		} catch {
			this.fail( 'network' );
			return undefined;
		} finally {
			this.busy = false;
			this.root.removeAttribute( 'aria-busy' );
		}
	}

	/**
	 * Forms set to "save incomplete entries" store the answers after every step, as 3.x did. Saves
	 * run one after another so all of them update the same entry; a failed save is skipped.
	 */
	private savePartial( answers: Record<string, unknown> ): void {
		if ( ! this.doc.settings.savePartialEntries ) {
			return;
		}
		this.partial = this.partial
			.then( () => this.api.savePartial( { answers, draft: this.draft, page: this.page, locale: this.config.locale, variants: this.variants } ) )
			.then( ( draft ) => {
				this.draft = draft ?? this.draft;
			}, () => undefined );
	}

	private back(): void {
		if ( this.busy || ! this.history.length ) {
			return;
		}
		let previous = this.history.pop() as string;
		// Steps that move on by themselves (loading screens) would send the visitor forward again.
		while ( this.history.length && this.movesOnAlone( previous ) ) {
			previous = this.history.pop() as string;
		}
		this.push( { event: 'af2PrevSlide' } );
		// Transitions that move sideways come in from the other side.
		this.card.classList.add( 'ffx-back' );
		this.show( previous );
	}

	/** A loading screen: a step of one content field that moves on after a while, without a button. */
	private movesOnAlone( id: string ): boolean {
		const node = this.nodes.get( id );
		const field = node?.type === 'step' && node.fields.length === 1 ? node.fields[ 0 ] : undefined;
		return field?.type === 'content' && ! field.props.button.show && Boolean( field.props.autoAdvanceMs ) && Boolean( field.props.loader );
	}

	private async submit( node: ContactNode, button: HTMLButtonElement ): Promise<void> {
		if ( this.busy ) {
			return;
		}
		let first: RenderedContactField | null = null;
		for ( const r of this.renderedContact ) {
			const code = checkContactField( r.field, this.contact[ r.field.id ] );
			if ( r.error ) {
				this.setError( r.error, code );
			}
			if ( code ) {
				this.stats.record( 'invalid', r.field.id );
				first ??= r;
			}
		}
		if ( first ) {
			first.focus?.focus();
			return;
		}

		this.busy = true;
		const label = button.textContent;
		button.disabled = true;
		button.textContent = this.t( 'sending' );
		this.root.setAttribute( 'aria-busy', 'true' );
		if ( this.doc.settings.loadingAnimation ) {
			this.root.classList.add( 'ffx-loading' );
		}
		this.formError.hidden = true;
		try {
			// The submitted entry replaces the incomplete one.
			await this.partial;
			// A sandboxed preview has no cookies (reading them throws there).
			const tracking = this.config.preview ? null : trackingInfo( window.location.search, document.cookie );
			const result = await this.api.submit<{ ok: true; entry: number; eventId: string; end: EndResponse; payment?: PaymentStart; conversions?: AdsConversion[] }>( {
				...( this.draft ? { draft: this.draft } : {} ),
				...( this.resumeKey ? { progress: this.resumeKey } : {} ),
				answers: this.pathAnswers(),
				contact: this.contact,
				page: this.page,
				locale: this.config.locale,
				website: this.honeypot.value,
				sid: this.stats.sid,
				tracking: tracking ?? {},
				variants: this.variants,
				analytics: this.config.preview ? {} : this.visit.summary(),
			} );
			const data = result.data;
			if ( data.ok ) {
				// The same ID as the plugin's server-side conversions, so tags can deduplicate. An entry
				// the plugin put into the spam folder has none and is no lead.
				if ( data.eventId ) {
					this.push( { event: 'ffxLead', eventId: data.eventId } );
				}
				// Popups that open by themselves stay closed for this visitor afterwards.
				this.root.dispatchEvent( new CustomEvent( 'ffx:sent', { bubbles: true } ) );
				if ( tracking ) {
					sendAdsConversions( data.conversions, data.eventId, this.contactValues( node ), tracking.consent.marketing );
				}
				if ( data.payment ) {
					this.toPayment( data.payment );
					return;
				}
				this.finish( data.end );
				return;
			}
			// A reCAPTCHA answer is valid once; the visitor confirms again. Before the errors are shown,
			// since clearing the answer also clears the field's error.
			this.renderedContact.forEach( ( r ) => r.reset?.() );
			this.handleError( node, data as ErrorBody );
		} catch ( error ) {
			// The token request names its error (e.g. form_closed); anything else is the network.
			const code = error instanceof Error && OWN_TEXT.includes( error.message ) ? error.message : 'network';
			this.fail( code );
		} finally {
			this.busy = false;
			button.disabled = false;
			button.textContent = label;
			this.root.removeAttribute( 'aria-busy' );
			this.root.classList.remove( 'ffx-loading' );
		}
	}

	/** The e-mail address and phone number the visitor gave in a contact step. */
	private contactValues( node: ContactNode ): { email?: string; phone?: string } {
		const out: { email?: string; phone?: string } = {};
		for ( const field of node.fields ) {
			const value = this.contact[ field.id ];
			if ( ( field.type === 'email' || field.type === 'phone' ) && typeof value === 'string' && value.trim() !== '' && out[ field.type ] === undefined ) {
				out[ field.type ] = value.trim();
			}
		}
		return out;
	}

	private handleError( node: ContactNode, error: ErrorBody ): void {
		if ( error.code === 'invalid_answers' && error.fields ) {
			let focus: HTMLElement | null = null;
			let elsewhere = false;
			for ( const [ fieldId, code ] of Object.entries( error.fields ) ) {
				const r = this.renderedContact.find( ( c ) => c.field.id === fieldId );
				const step = BOOKING_ERRORS.includes( code ) ? this.pathSteps().find( ( s ) => s.fields.some( ( f ) => f.id === fieldId ) ) : undefined;
				if ( step ) {
					// The time was booked meanwhile: back to the appointment to pick another.
					this.values[ fieldId ] = undefined;
					this.history.splice( this.history.indexOf( step.id ) );
					this.show( step.id );
					const index = step.fields.findIndex( ( f ) => f.id === fieldId );
					this.setError( ( this.rendered[ index ] as RenderedField ).error, code );
					return;
				}
				if ( r?.error ) {
					this.setError( r.error, code );
					focus ??= r.focus;
				} else if ( ! node.fields.some( ( f ) => f.id === fieldId ) ) {
					elsewhere = true;
				}
			}
			if ( elsewhere ) {
				this.fail( 'invalid_answers' );
			}
			focus?.focus();
			return;
		}
		this.fail( error.code );
	}

	/** After a submit: success text and/or redirect, as the plugin computed them. */
	private finish( end: EndResponse ): void {
		this.countdown?.stop();
		const node = this.nodes.get( this.current );
		if ( node?.type === 'contact' ) {
			runCode( this.trackingBox, node.tracking?.afterSubmit );
		}
		this.nav.hidden = true;
		this.setProgress( 1 );
		this.root.classList.add( 'ffx-done' );
		this.card.style.minHeight = '';
		const success = end.success?.show ? end.success : null;
		if ( success ) {
			this.card.replaceChildren( successPage( success, ( key ) => this.t( key ) ) );
			this.fillCalcs( this.card );
			this.scrollIntoView();
			this.card.querySelector<HTMLElement>( '.ffx-success' )?.focus( { preventScroll: true } );
		} else {
			this.card.replaceChildren();
		}
		if ( end.redirect ) {
			this.redirect( end.redirect.url, end.redirect.newTab, end.redirect.delayMs, end.redirect.countdown );
		}
	}

	/** After a submit that takes a payment: on to the provider's payment page. */
	private toPayment( payment: PaymentStart ): void {
		if ( ! payment.url ) {
			this.paymentNotice( 'payment_unavailable', payment.param );
			return;
		}
		this.paymentNotice( 'payment_redirect', null );
		this.redirect( payment.url, false, 0 );
	}

	/** Back from the payment page: the end of the funnel once paid, otherwise another attempt. */
	private paymentReturn( payment: PaymentReturn ): void {
		this.setProgress( 1 );
		if ( payment.status === 'paid' || payment.status === 'pending' ) {
			this.push( { event: 'ffxPayment', status: payment.status } );
			this.finish( payment.end ?? { success: null, redirect: null } );
			return;
		}
		if ( payment.status === 'refunded' ) {
			this.paymentNotice( 'payment_refunded', null );
			return;
		}
		this.paymentNotice( payment.status === 'failed' ? 'payment_failed' : 'payment_open', payment.param );
	}

	/** A message about the payment instead of the steps, with a button to pay when a parameter is given. */
	private paymentNotice( key: string, param: string | null ): void {
		this.countdown?.stop();
		this.nav.hidden = true;
		const button = param ? h( 'button', { type: 'button', class: 'ffx-button ffx-button-primary ffx-payment-retry' }, this.t( 'payment_retry' ) ) : null;
		button?.addEventListener( 'click', () => void this.retryPayment( param as string, button ) );
		this.card.replaceChildren( h( 'div', { class: 'ffx-payment', role: 'status' }, h( 'p', { class: 'ffx-payment-text' }, this.t( key ) ), button ) );
	}

	private async retryPayment( param: string, button: HTMLButtonElement ): Promise<void> {
		if ( this.busy ) {
			return;
		}
		this.busy = true;
		button.disabled = true;
		this.formError.hidden = true;
		try {
			const result = await this.api.retryPayment( param );
			if ( result.data.ok && result.data.url ) {
				this.redirect( result.data.url, false, 0 );
				return;
			}
			if ( result.data.ok ) {
				// Paid in the meantime (e.g. in another tab): the page shows the end.
				window.location.reload();
				return;
			}
			this.fail( 'payment_unavailable' );
		} catch {
			this.fail( 'network' );
		} finally {
			this.busy = false;
			button.disabled = false;
		}
	}

	/** An end reached from a question: no entry; the visitor leaves (3.x redirect after a question). */
	private leaveFromQuestion( node: EndNode ): void {
		const items = summary( this.pathSteps(), this.shownValues(), ( v ) => this.text( v ) );
		const redirect = node.redirect
			? {
				// Answers fill {{field:<key>}}; parameter values are encoded with the address.
				url: questionRedirectUrl(
					this.piped( node.redirect.url, true ),
					node.redirect.params.map( ( p ) => ( { name: p.name, value: this.fillFields( this.text( p.value ), ( answer ) => answer ) } ) ),
					items,
					this.page
				),
				newTab: node.redirect.newTab,
				delayMs: node.redirect.delayMs,
				countdown: node.redirect.countdown,
			}
			: null;
		const success = node.success;
		const plain = ( value: Record<string, string> | undefined ): string => textOf( this.piped( value ) );
		this.finish( {
			success: success
				? {
					show: success.show,
					html: this.piped( success.text ),
					image: success.image ?? null,
					heading: plain( success.heading ),
					animation: success.animation ?? null,
					button: success.button ? { label: plain( success.button.label ), url: textOf( this.piped( success.button.url, true ) ), newTab: Boolean( success.button.newTab ) } : null,
					downloads: ( success.downloads ?? [] ).map( ( d ) => ( { label: plain( d.label ) || d.url.split( '/' ).pop() || d.url, url: d.url } ) ),
					answers: success.showAnswers ? summary( this.pathSteps(), this.shownValues(), ( v ) => this.text( v ), true ) : null,
				}
				: null,
			redirect,
		} );
	}

	private redirect( url: string, newTab: boolean, delayMs: number, showCountdown = false ): void {
		// Only web addresses; the plugin cleans the ones it sends, these may come from the document.
		let target: URL;
		try {
			target = new URL( url, window.location.href );
		} catch {
			return;
		}
		if ( target.protocol !== 'https:' && target.protocol !== 'http:' ) {
			return;
		}
		if ( this.config.preview ) {
			// The preview stays on the form and names where visitors would go.
			this.card.append( h( 'p', { class: 'ffx-preview-note' }, this.t( 'preview_redirect' ).replace( '%s', target.href ) ) );
			return;
		}
		const go = (): void => {
			if ( newTab ) {
				window.open( target.href, '_blank', 'noopener' );
			} else {
				window.location.assign( target.href );
			}
		};
		if ( delayMs > 0 ) {
			if ( showCountdown && delayMs >= 1000 ) {
				this.card.append( countdown( target.href, delayMs, ( key ) => this.t( key ) ) );
			}
			setTimeout( go, delayMs );
		} else {
			go();
		}
	}

	private setError( el: HTMLElement, code: string | null ): void {
		el.hidden = ! code;
		// Limits a field names on its error element (data-too_few_choices="2") fill in %d.
		el.textContent = code ? this.t( code ).replace( '%d', el.getAttribute( 'data-' + code ) ?? '' ) : '';
		const field = el.closest( '.ffx-field' );
		field?.classList.toggle( 'ffx-invalid', Boolean( code ) );
		field?.querySelectorAll( 'input, select, textarea' ).forEach( ( input ) => {
			if ( code ) {
				input.setAttribute( 'aria-invalid', 'true' );
			} else {
				input.removeAttribute( 'aria-invalid' );
			}
		} );
	}

	private clearError( el: HTMLElement | null | undefined ): void {
		if ( el && ! el.hidden ) {
			this.setError( el, null );
		}
	}

	/**
	 * The time limit is over: a note instead of the steps. While an entry is on its way the plugin
	 * decides (it allows a few seconds more); its time_up answer ends the form then.
	 */
	private timeUp( force = false ): void {
		if ( this.busy && ! force ) {
			return;
		}
		this.countdown?.stop();
		this.nav.hidden = true;
		this.formError.hidden = true;
		this.root.classList.add( 'ffx-done' );
		const note = h( 'p', { class: 'ffx-time-up', role: 'alert', tabindex: -1 }, this.plain( this.doc.settings.timeLimit?.message ) || this.t( 'time_up' ) );
		this.card.replaceChildren( note );
		note.focus( { preventScroll: true } );
	}

	private fail( code: string ): void {
		if ( code === 'time_up' ) {
			this.timeUp( true );
			return;
		}
		this.formError.textContent = OWN_TEXT.includes( code ) ? this.t( code ) : this.t( 'error' ).replace( '%s', code );
		this.formError.hidden = false;
	}

	private setProgress( value: number ): void {
		if ( this.bar ) {
			// The share of one step: progress counts the steps of the longest way to the contact step.
			let unit = 1;
			this.progress.forEach( ( share ) => {
				unit = share > 0 && share < unit ? share : unit;
			} );
			const step = this.history.length + 1;
			const total = step + Math.round( ( 1 - value ) / unit );
			// The current step counts as begun, so step 1 of 9 already shows 11 %.
			const percent = Math.round( ( step / total ) * 100 );
			const label = this.t( 'step_of' ).replace( '%1$d', String( step ) ).replace( '%2$d', String( total ) );
			const track = this.bar.parentElement;
			this.bar.style.width = `${ percent }%`;
			track?.setAttribute( 'aria-valuenow', String( percent ) );
			track?.setAttribute( 'aria-valuetext', label );
			if ( this.stepLabel ) {
				this.stepLabel.textContent = label;
				// Read out on later changes, not when the page loads.
				this.stepLabel.setAttribute( 'aria-live', 'polite' );
			}
			if ( this.barLabel ) {
				this.barLabel.textContent = `${ percent } %`;
			}
		}
	}

	private scrollIntoView(): void {
		const setting = this.doc.settings.scrollToTop;
		const mobile = window.matchMedia?.( '(max-width: 768px)' ).matches ?? false;
		if ( ( mobile ? setting.mobile : setting.desktop ) && typeof this.root.scrollIntoView === 'function' ) {
			const still = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;
			this.root.scrollIntoView( { behavior: still ? 'auto' : 'smooth', block: 'start' } );
		}
	}

	private push( data: Record<string, unknown> ): void {
		if ( this.config.preview ) {
			return;
		}
		window.dataLayer = window.dataLayer || [];
		window.dataLayer.push( data );
	}
}
