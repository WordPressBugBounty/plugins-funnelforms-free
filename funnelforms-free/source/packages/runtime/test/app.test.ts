import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormApp } from '../src/app';
import { mountAll } from '../src/index';
import { ratingFace } from '../src/fields';
import { videoSource } from '../src/media';
import { base64Json, item, questionRedirectUrl, summary } from '../src/summary';
import type { RuntimeConfig } from '../src/types';
import { checkStepField, isWebAddress, siteToday } from '../src/validate';
import { referrerOf } from '../src/visit';
// The chunks of address, booking and repeat fields are there from the start, as on the plugin's pages.
import '../src/chunks/address';
import '../src/chunks/booking';
import '../src/chunks/repeat';
import type { Field } from '@funnelforms/form-schema';
import { holds } from '@funnelforms/form-core';

const de = ( text: string ): Record<string, string> => ( { de_DE: text } );

function config(): RuntimeConfig {
	return {
		uid: 'f1',
		endpoint: 'https://example.org/wp-json/funnelforms/v1/forms/f1',
		locale: 'de_DE',
		strings: { next: 'Weiter', back: 'Zurück', submit: 'Senden', sending: 'Senden…', required: 'Pflichtfeld', invalid_email: 'E-Mail ungültig', error: 'Fehler (%s)', rate_limited: 'Zu viele Versuche', salutation_male: 'Herr', salutation_female: 'Frau', salutation_diverse: 'Divers', salutation_company: 'Firma', calc_error: 'Rechenfehler' },
		document: {
			schemaVersion: 1,
			id: 'frm_1',
			locales: { default: 'de_DE', available: [ 'de_DE' ] },
			start: 'n1',
			nodes: [
				{
					id: 'n1',
					type: 'step',
					fields: [
						{
							id: 'q1',
							key: 'q1',
							type: 'choice',
							label: de( 'Wofür?' ),
							description: de( '' ),
							required: true,
							legacy: { questionId: 637 },
							options: [
								{ id: 'o1', label: de( 'Immobilie' ), value: 'Immobilie' },
								{ id: 'o2', label: de( 'Grünes Auto' ), value: 'Auto' },
							],
							props: { multiple: false, layout: { desktop: 'grid', mobile: 'grid' }, hideIcons: false },
						},
					],
				},
				{
					id: 'n2',
					type: 'step',
					fields: [
						{ id: 'q2', key: 'q2', type: 'slider', label: de( 'Budget' ), description: de( '' ), required: true, props: { min: 0, max: 100, step: 1, start: 50, unit: { text: de( '€' ), position: 'after' }, thousandsSeparator: false, manualInput: { enabled: false, label: de( '' ) } } },
						{ id: 'q3', key: 'q3', type: 'text', label: de( 'Ort' ), description: de( '' ), required: true, props: { placeholder: de( '' ) } },
					],
				},
				{
					id: 'n3',
					type: 'step',
					fields: [
						{ id: 'q4', key: 'q4', type: 'content', label: de( '' ), description: de( '' ), required: false, props: { html: de( '<p>Ihre Angaben:</p>{{answers}}<p>Rate: {{calc:c1}}</p>' ), button: { show: true, label: de( 'Weiter' ) } } },
					],
				},
				{
					id: 'n4',
					type: 'contact',
					title: de( 'Fast geschafft' ),
					description: de( '' ),
					submitLabel: de( 'Anfrage senden' ),
					showBottomBar: true,
					fields: [
						{ id: 'c_anrede', key: 'anrede', type: 'salutation', label: de( 'Anrede' ), required: false, props: { allow: { male: true, female: true, diverse: false, company: true }, prefillFromQuery: 'anrede' } },
						{ id: 'c_name', key: 'name', type: 'name', label: de( 'Name' ), required: true, props: { placeholder: de( '' ), prefillFromQuery: 'name' } },
						{ id: 'c_mail', key: 'mail', type: 'email', label: de( 'E-Mail' ), required: true, props: { placeholder: de( '' ), b2bOnly: false, prefillFromQuery: 'mail' } },
						{ id: 'c_ok', key: 'ok', type: 'consent', label: de( '' ), required: true, props: { html: de( 'Ich stimme zu' ), prefillFromQuery: 'ok' } },
					],
				},
				{ id: 'e1', type: 'end', success: { show: true, text: de( '<p>Danke!</p>' ) }, redirect: null },
				{ id: 'eq', type: 'end', success: null, redirect: { url: de( 'https://example.org/weiter?d={{answers:base64json}}' ), newTab: true, delayMs: 0, params: [ { name: 'quelle', value: de( 'form {{page:title}}' ) } ] } },
			],
			edges: [
				{ id: 'x1', from: 'n1', to: 'eq', when: { field: 'q1', op: 'selected', value: 'o2' } },
				{ id: 'x2', from: 'n1', to: 'n2', default: true },
				{ id: 'x3', from: 'n2', to: 'n3' },
				{ id: 'x4', from: 'n3', to: 'n4' },
				{ id: 'x5', from: 'n4', to: 'e1' },
			],
			calculations: [ { id: 'c1' } ],
			style: { tokens: {} },
			settings: { uiLocale: 'de_DE', progressBar: { show: true }, loadingAnimation: true, scrollToTop: { desktop: false, mobile: false }, rtl: false, autoHeight: false, iconFont: false, savePartialEntries: false },
		},
	} as unknown as RuntimeConfig;
}

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply[]>;
let requests: Array<{ path: string; body: Record<string, unknown> }>;

function reply( path: string, status: number, body: unknown ): void {
	( replies[ path ] ??= [] ).push( { status, body } );
}

beforeEach( () => {
	vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout', 'Date' ] } );
	replies = {};
	requests = [];
	window.dataLayer = [];
	let tokens = 0;
	vi.stubGlobal( 'fetch', vi.fn( async ( url: string, init: RequestInit ) => {
		const path = url.replace( /^.*\/forms\/f1/, '' );
		const body = init.body instanceof FormData ? Object.fromEntries( [ ...init.body.entries() ].map( ( [ k, v ] ) => [ k, typeof v === 'string' ? v : ( v as File ).name ] ) ) : JSON.parse( String( init.body ) );
		requests.push( { path, body } );
		const fallback = path === '/token' ? { status: 200, body: { ok: true, token: `t${ ++tokens }` } } : { status: 500, body: { ok: false, code: 'unexpected' } };
		const next = replies[ path ]?.shift() ?? fallback;
		return { status: next.status, json: async () => next.body };
	} ) );
} );

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete window.wp_has_consent;
	document.body.innerHTML = '';
} );

function mount( query = '' ): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'ffx-form';
	document.body.append( root );
	new FormApp( root, config(), { url: 'https://example.org/seite/', query, title: 'Seite' } );
	return root;
}

const $ = <T extends HTMLElement = HTMLElement>( root: HTMLElement, selector: string ): T => root.querySelector( selector ) as T;
const clickOption = ( root: HTMLElement, label: string ): void => {
	[ ...root.querySelectorAll<HTMLButtonElement>( '.ffx-option' ) ].find( ( b ) => b.textContent?.includes( label ) )?.click();
};
const type = ( input: HTMLInputElement, value: string ): void => {
	input.value = value;
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
};
const next = ( root: HTMLElement ): void => $( root, '.ffx-button-next' ).click();

async function toContact( root: HTMLElement ): Promise<void> {
	clickOption( root, 'Immobilie' );
	type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
	reply( '/calculations', 200, { ok: true, calculations: { c1: '1.234,50' } } );
	next( root );
	await vi.advanceTimersByTimeAsync( 0 );
	$( root, '.ffx-content-button' ).click();
}

describe( 'FormApp', () => {
	it( 'walks the path, keeps answers on Back and shows the progress', async () => {
		const root = mount();
		expect( $( root, '.ffx-question' ).firstChild?.textContent ).toBe( 'Wofür?' );
		expect( $( root, '.ffx-button-next' ).hidden ).toBe( true );
		expect( $( root, '.ffx-button-back' ).hidden ).toBe( true );

		// The first of four steps already counts as begun.
		expect( $( root, '.ffx-progress' ).getAttribute( 'aria-valuenow' ) ).toBe( '25' );
		clickOption( root, 'Immobilie' );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		expect( window.dataLayer ).toEqual( [ { event: 'af2NextSlide', id: '637', title: 'Wofür?', answer: 'Immobilie' } ] );
		expect( $( root, '.ffx-progress' ).getAttribute( 'aria-valuenow' ) ).toBe( '50' );

		// Required text left empty: the step stays and says why.
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		const error = $( root, '.ffx-field-text .ffx-error' );
		expect( error.hidden ).toBe( false );
		expect( error.textContent ).toBe( 'Pflichtfeld' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		expect( error.hidden ).toBe( true );

		$( root, '.ffx-button-back' ).click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
		expect( $( root, '.ffx-option[aria-pressed="true"]' ).textContent ).toBe( 'Immobilie' );
		clickOption( root, 'Immobilie' );
		expect( $<HTMLInputElement>( root, '.ffx-field-text input' ).value ).toBe( 'Berlin' );
	} );

	it( 'keeps the height of the tallest step unless each step adjusts it or has a button of its own', () => {
		let natural = 300;
		Object.defineProperty( HTMLElement.prototype, 'offsetHeight', {
			configurable: true,
			get( this: HTMLElement ) {
				return this.classList.contains( 'ffx-card' ) ? Math.max( natural, parseFloat( this.style.minHeight ) || 0 ) : 0;
			},
		} );
		try {
			const root = mount();
			const card = $( root, '.ffx-card' );
			expect( card.style.minHeight ).toBe( '300px' );
			natural = 200;
			clickOption( root, 'Immobilie' );
			expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
			expect( card.style.minHeight ).toBe( '300px' );
			// A step with a button of its own takes its own height: no gap between its button and the bar.
			type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
			reply( '/calculations', 200, { ok: true, calculations: { c1: '1' } } );
			next( root );
			expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n3' );
			expect( card.style.minHeight ).toBe( '' );
			$( root, '.ffx-button-back' ).click();
			expect( card.style.minHeight ).toBe( '300px' );

			document.body.innerHTML = '';
			const settings = config();
			settings.document.settings.autoHeight = true;
			const other = document.createElement( 'div' );
			document.body.append( other );
			new FormApp( other, settings, { url: 'https://example.org/', query: '', title: 'Seite' } );
			expect( $( other, '.ffx-card' ).style.minHeight ).toBe( '' );
		} finally {
			Reflect.deleteProperty( HTMLElement.prototype, 'offsetHeight' );
		}
	} );

	it( 'fills {{answers}} and calculations in content steps', async () => {
		const root = mount();
		clickOption( root, 'Immobilie' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		reply( '/calculations', 200, { ok: true, calculations: { c1: '1.234,50' } } );
		next( root );
		// Numbers with their unit, as in mails.
		expect( $( root, '.ffx-summary' ).textContent ).toBe( 'Wofür? ImmobilieBudget 50 €Ort Berlin' );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '[data-ffx-calc]' ).textContent ).toBe( '1.234,50' );
		expect( requests.find( ( r ) => r.path === '/calculations' ) ).toEqual( { path: '/calculations', body: { answers: { q1: [ 'o1' ], q2: 50, q3: 'Berlin' }, ids: [ 'c1' ], locale: 'de_DE' } } );
	} );

	it( 'checks the contact step and submits the answers on the path', async () => {
		const root = mount( 'name=Erika+Muster&anrede=Frau' );
		await toContact( root );
		expect( $<HTMLInputElement>( root, '.ffx-contact-name input' ).value ).toBe( 'Erika Muster' );
		expect( $<HTMLInputElement>( root, '.ffx-contact-salutation input[value="female"]' ).checked ).toBe( true );
		expect( root.querySelectorAll( '.ffx-contact-salutation input' ) ).toHaveLength( 3 );

		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@' );
		$( root, '.ffx-button-submit' ).click();
		expect( $( root, '.ffx-contact-email .ffx-error' ).textContent ).toBe( 'E-Mail ungültig' );
		expect( $( root, '.ffx-contact-consent .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );

		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, eventId: 'ffx-1a2b3c4d-9', end: { success: { show: true, html: '<p>Danke!</p>', image: null }, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );

		expect( $( root, '.ffx-success' ).textContent ).toBe( 'Danke!' );
		expect( window.dataLayer ).toContainEqual( { event: 'ffxLead', eventId: 'ffx-1a2b3c4d-9' } );
		expect( $( root, '.ffx-nav' ).hidden ).toBe( true );
		const entry = requests.find( ( r ) => r.path === '/entries' );
		expect( entry?.body ).toEqual( {
			answers: { q1: [ 'o1' ], q2: 50, q3: 'Berlin' },
			contact: { c_anrede: 'female', c_name: 'Erika Muster', c_mail: 'erika@example.org', c_ok: true },
			page: { url: 'https://example.org/seite/', query: 'name=Erika+Muster&anrede=Frau', title: 'Seite' },
			locale: 'de_DE',
			website: '',
			sid: expect.stringMatching( /^[0-9a-f]{32}$/ ),
			tracking: { consent: { marketing: null, statistics: null } },
			variants: {},
			token: entry?.body.token,
			analytics: { seconds: 0, steps: { n2: 0, n3: 0, n4: 0 }, referrer: '' },
		} );
	} );

	it( 'sends the Google Ads conversions of the answer through the Google tag', async () => {
		const gtag = vi.fn();
		window.gtag = gtag;
		window.wp_has_consent = () => true;
		const root = mount();
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		const conversions = [ { platform: 'googleAds', sendTo: 'AW-123456789/AbC', value: 50, currency: 'EUR', requireConsent: true, enhanced: true } ];
		reply( '/entries', 201, { ok: true, entry: 9, eventId: 'ffx-1a2b3c4d-9', end: { success: { show: true, html: '<p>Danke!</p>', image: null }, redirect: null }, conversions } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( gtag.mock.calls ).toEqual( [
			[ 'set', 'user_data', { email: 'erika@example.org' } ],
			[ 'event', 'conversion', { send_to: 'AW-123456789/AbC', transaction_id: 'ffx-1a2b3c4d-9', value: 50, currency: 'EUR' } ],
		] );
		delete window.gtag;
		delete window.wp_has_consent;
	} );

	it( 'lets visitors choose the language on the first step', () => {
		const base = config();
		base.document.locales = { default: 'de_DE', available: [ 'de_DE', 'en_US' ] };
		base.document.settings.languageSwitch = true;
		const root = document.createElement( 'div' );
		document.body.append( root );
		const assign = vi.fn();
		vi.stubGlobal( 'location', { href: 'https://example.org/seite/?a=1', assign } );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: 'a=1', title: 'Seite' } );
		const links = [ ...root.querySelectorAll<HTMLAnchorElement>( '.ffx-lang a' ) ];
		expect( links.map( ( a ) => [ a.textContent, a.getAttribute( 'href' ), a.lang, a.getAttribute( 'aria-current' ) ] ) ).toEqual( [
			[ 'Deutsch', 'https://example.org/seite/?a=1&ffx_lang=de_de', 'de-DE', 'true' ],
			[ 'English', 'https://example.org/seite/?a=1&ffx_lang=en_us', 'en-US', null ],
		] );
		expect( $( root, '.ffx-lang' ).getAttribute( 'aria-label' ) ).toBe( 'language' );
		expect( assign ).not.toHaveBeenCalled();
		clickOption( root, 'Immobilie' );
		expect( $( root, '.ffx-lang' ).hidden ).toBe( true );
	} );

	it( 'shows the errors the plugin returns', async () => {
		const root = mount();
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@gmail.com' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 422, { ok: false, code: 'invalid_answers', fields: { c_mail: 'business_email_required' } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( $( root, '.ffx-contact-email .ffx-error' ).textContent ).toBe( 'business_email_required' );
		expect( $<HTMLButtonElement>( root, '.ffx-button-submit' ).disabled ).toBe( false );

		reply( '/entries', 429, { ok: false, code: 'rate_limited' } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( $( root, '.ffx-form-error' ).textContent ).toBe( 'Zu viele Versuche' );
	} );

	it( 'gets a fresh token once when the first one was rejected', async () => {
		const root = mount();
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 403, { ok: false, code: 'token_used' } );
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: null, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 8000 );
		// The used token is replaced once.
		const used = requests.filter( ( r ) => r.path === '/entries' ).map( ( r ) => r.body.token );
		expect( used ).toHaveLength( 2 );
		expect( new Set( used ).size ).toBe( 2 );
		expect( root.classList.contains( 'ffx-done' ) ).toBe( true );
	} );

	it( 'leaves from a question with the answers in the address', () => {
		const open = vi.fn();
		vi.stubGlobal( 'open', open );
		const root = mount();
		clickOption( root, 'Grünes Auto' );
		const items = [ { id: '637', title: 'Wofür?', answer: 'Grünes Auto' } ];
		expect( open ).toHaveBeenCalledWith( `https://example.org/weiter?d=${ base64Json( items ) }&quelle=form+Seite`, '_blank', 'noopener' );
		expect( requests ).toEqual( [] );
	} );

	it( 'names the redirect in the builder preview and pushes nothing', () => {
		const open = vi.fn();
		vi.stubGlobal( 'open', open );
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, { ...config(), preview: true, strings: { ...config().strings, preview_redirect: 'Weiter zu %s' } }, { url: 'about:srcdoc', query: '', title: '' } );
		clickOption( root, 'Grünes Auto' );
		expect( open ).not.toHaveBeenCalled();
		expect( $( root, '.ffx-preview-note' ).textContent ).toMatch( /^Weiter zu https:\/\/example\.org\/weiter\?d=/ );
		expect( window.dataLayer ).toEqual( [] );
	} );
} );

describe( 'fields shown on answers', () => {
	/** The budget step asks for the place only from 60 on. */
	function shownConfig(): RuntimeConfig {
		const c = config();
		const step = c.document.nodes.find( ( n ) => n.id === 'n2' );
		if ( step?.type === 'step' && step.fields[ 1 ] ) {
			step.fields[ 1 ].showWhen = { field: 'q2', op: 'gte', value: 60 };
		}
		return c;
	}

	function mountShown(): HTMLElement {
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, shownConfig(), { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		return root;
	}

	const slide = ( root: HTMLElement, value: string ): void => {
		const range = $<HTMLInputElement>( root, '.ffx-range' );
		range.value = value;
		range.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	};

	it( 'hides a field until its condition holds and neither asks for nor sends it', async () => {
		const root = mountShown();
		clickOption( root, 'Immobilie' );
		const place = $( root, '.ffx-field-text' );
		expect( place.hidden ).toBe( true );
		expect( place.style.display ).toBe( 'none' );

		slide( root, '70' );
		expect( place.hidden ).toBe( false );
		next( root );
		expect( $( root, '.ffx-field-text .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );

		// Back under 60: the place is hidden again, not required, and its answer stays home.
		slide( root, '40' );
		expect( place.hidden ).toBe( true );
		reply( '/calculations', 200, { ok: true, calculations: { c1: '1' } } );
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n3' );
		expect( $( root, '.ffx-summary' ).textContent ).toBe( 'Wofür? ImmobilieBudget 40 €' );
		expect( requests.find( ( r ) => r.path === '/calculations' )?.body.answers ).toEqual( { q1: [ 'o1' ], q2: 40 } );
		expect( window.dataLayer?.map( ( d ) => ( d as { title?: string } ).title ) ).toEqual( [ 'Wofür?', 'Budget' ] );
	} );

	it( 'puts answers into the parameters of a redirect from a question', () => {
		const open = vi.fn();
		vi.stubGlobal( 'open', open );
		const c = config();
		const end = c.document.nodes.find( ( n ) => n.id === 'eq' );
		if ( end?.type === 'end' && end.redirect ) {
			end.redirect.url = de( 'https://example.org/auto/{{field:q1}}' );
			end.redirect.params = [ { name: 'wahl', value: de( 'Wahl: {{field:q1}}' ) } ];
		}
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, c, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		clickOption( root, 'Grünes Auto' );
		expect( open ).toHaveBeenCalledWith( 'https://example.org/auto/Gr%C3%BCnes%20Auto?wahl=Wahl%3A+Gr%C3%BCnes+Auto', '_blank', 'noopener' );
	} );
} );

describe( 'bottom bar', () => {
	it( 'holds Back, the progress with the step and Next, and says which step is shown', () => {
		const base = config();
		base.strings.step_of = 'Schritt %1$d von %2$d';
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		const nav = $( root, '.ffx-nav' );
		expect( [ ...nav.children ].map( ( child ) => child.className ) ).toEqual( [ 'ffx-button ffx-button-back', 'ffx-progress-row', 'ffx-button ffx-button-primary ffx-button-next' ] );
		const label = $( root, '.ffx-progress-step' );
		expect( label.textContent ).toBe( 'Schritt 1 von 4' );
		expect( $( root, '.ffx-progress' ).getAttribute( 'aria-valuetext' ) ).toBe( 'Schritt 1 von 4' );
		expect( label.getAttribute( 'aria-live' ) ).toBe( 'polite' );

		clickOption( root, 'Immobilie' );
		expect( label.textContent ).toBe( 'Schritt 2 von 4' );
		expect( $( root, '.ffx-card' ).classList.contains( 'ffx-back' ) ).toBe( false );
		$( root, '.ffx-button-back' ).click();
		expect( label.textContent ).toBe( 'Schritt 1 von 4' );
		// Steps slide in from the side the visitor came from.
		expect( $( root, '.ffx-card' ).classList.contains( 'ffx-back' ) ).toBe( true );
	} );

	it( 'marks required questions and says what the star means', () => {
		const root = mount();
		const legend = $( root, 'legend.ffx-question' );
		expect( $( legend, '.ffx-required' ).getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		expect( $( legend, '.ffx-sr-only' ).textContent ).toBe( ' required_mark' );
		expect( $( root, '.ffx-required-note' ).textContent ).toBe( 'required_note' );
		clickOption( root, 'Immobilie' );
		// Inputs carry required themselves; their label only shows the star.
		const label = $( root, '.ffx-field-text .ffx-question' );
		expect( label.textContent ).toBe( 'Ort *' );
		// The note explains the star once, on the first step that uses it.
		expect( root.querySelectorAll( '.ffx-required-note' ) ).toHaveLength( 0 );
		$( root, '.ffx-button-back' ).click();
		expect( root.querySelectorAll( '.ffx-required-note' ) ).toHaveLength( 1 );
	} );

	it( 'sizes the answer grid by the number of answers and fills the slider track', () => {
		const root = mount();
		expect( $( root, '.ffx-options' ).style.getPropertyValue( '--ffx-auto' ) ).toBe( '2' );
		clickOption( root, 'Immobilie' );
		const range = $<HTMLInputElement>( root, '.ffx-field-slider input[type="range"]' );
		expect( range.style.getPropertyValue( '--ffx-fill' ) ).toBe( '50%' );
		range.value = '80';
		range.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		expect( range.style.getPropertyValue( '--ffx-fill' ) ).toBe( '80%' );
	} );
} );

describe( 'answers in texts', () => {
	it( 'puts earlier answers into texts, escaped', async () => {
		const base = config();
		const doc = base.document as unknown as { nodes: Array<{ id: string; title?: Record<string, string>; fields?: Array<{ id: string; props: Record<string, unknown> }> }> };
		const content = doc.nodes.find( ( n ) => n.id === 'n3' )?.fields?.[ 0 ];
		const contact = doc.nodes.find( ( n ) => n.id === 'n4' );
		if ( ! content || ! contact ) {
			throw new Error( 'no nodes' );
		}
		content.props.html = de( '<p>Schön, dass du aus {{field:q3}} kommst. Unbekannt: [{{field:nope}}]</p>' );
		contact.title = de( 'Fast geschafft in {{ field:q3 }}' );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		clickOption( root, 'Immobilie' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), '<b>Köln</b>' );
		reply( '/calculations', 200, { ok: true, calculations: {} } );
		next( root );
		expect( $( root, '.ffx-content' ).textContent ).toBe( 'Schön, dass du aus <b>Köln</b> kommst. Unbekannt: []' );
		expect( root.querySelector( '.ffx-content b' ) ).toBeNull();
		$( root, '.ffx-content-button' ).click();
		expect( $( root, '.ffx-contact-title' ).textContent ).toBe( 'Fast geschafft in <b>Köln</b>' );
	} );
} );

describe( 'thank-you page', () => {
	it( 'shows heading, check mark, answers, downloads and a button, and counts down to the redirect', async () => {
		const open = vi.fn();
		vi.stubGlobal( 'open', open );
		const base = config();
		Object.assign( base.strings, { your_answers: 'Deine Antworten', redirect_countdown: 'Weiter in %d Sekunden.', redirect_countdown_one: 'Weiter in 1 Sekunde.', redirect_now: 'Jetzt weiter' } );
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, {
			ok: true,
			entry: 9,
			end: {
				success: {
					show: true,
					html: '<p>Wir melden uns.</p>',
					image: null,
					heading: 'Geschafft, Erika',
					animation: 'check',
					button: { label: 'Zum Shop', url: 'https://example.org/shop', newTab: true },
					downloads: [ { label: 'Preisliste', url: 'https://example.org/preise.pdf' }, { label: 'Böse', url: 'javascript:alert(1)' } ],
					answers: [ { title: '<b>Wofür?</b>', answer: 'Immobilie' } ],
				},
				redirect: { url: 'https://example.org/weiter', newTab: true, delayMs: 3000, countdown: true },
			},
		} );
		$( root, '.ffx-button-submit' ).click();
		// The runtime waits until its token is old enough for the plugin.
		for ( let i = 0; i < 100 && ! root.querySelector( '.ffx-success' ); i++ ) {
			await vi.advanceTimersByTimeAsync( 50 );
		}
		expect( $( root, '.ffx-success-heading' ).textContent ).toBe( 'Geschafft, Erika' );
		expect( root.querySelector( '.ffx-success-check' ) ).not.toBeNull();
		expect( $( root, '.ffx-success-answers h3' ).textContent ).toBe( 'Deine Antworten' );
		expect( [ ...root.querySelectorAll( '.ffx-success-answers dt, .ffx-success-answers dd' ) ].map( ( e ) => e.textContent ) ).toEqual( [ 'Wofür?', 'Immobilie' ] );
		expect( [ ...root.querySelectorAll<HTMLAnchorElement>( '.ffx-success-downloads a' ) ].map( ( a ) => [ a.textContent, a.href ] ) ).toEqual( [ [ 'Preisliste', 'https://example.org/preise.pdf' ] ] );
		const shop = $<HTMLAnchorElement>( root, '.ffx-success-button' );
		expect( [ shop.textContent, shop.href, shop.target ] ).toEqual( [ 'Zum Shop', 'https://example.org/shop', '_blank' ] );

		expect( $( root, '.ffx-redirect-text' ).textContent ).toBe( 'Weiter in 3 Sekunden.' );
		expect( $<HTMLAnchorElement>( root, '.ffx-redirect-now' ).href ).toBe( 'https://example.org/weiter' );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( $( root, '.ffx-redirect-text' ).textContent ).toBe( 'Weiter in 2 Sekunden.' );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( $( root, '.ffx-redirect-text' ).textContent ).toBe( 'Weiter in 1 Sekunde.' );
		expect( open ).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( open ).toHaveBeenCalledWith( 'https://example.org/weiter', '_blank', 'noopener' );
	} );

	it( 'shows confetti and the answers at an end reached from a question', async () => {
		const base = config();
		base.strings.your_answers = 'Deine Antworten';
		const doc = base.document as unknown as { nodes: Array<Record<string, unknown>> };
		const end = doc.nodes.find( ( n ) => n.id === 'eq' );
		if ( ! end ) {
			throw new Error( 'no eq' );
		}
		end.success = { show: true, text: de( '<p>Danke</p>' ), heading: de( '<em>Super</em>' ), animation: 'confetti', showAnswers: true, downloads: [ { label: de( '' ), url: 'https://example.org/files/info.pdf' } ] };
		end.redirect = null;
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		clickOption( root, 'Grünes Auto' );
		expect( $( root, '.ffx-success-heading' ).textContent ).toBe( 'Super' );
		expect( root.querySelectorAll( '.ffx-confetti i' ) ).toHaveLength( 60 );
		expect( [ ...root.querySelectorAll( '.ffx-success-answers dt, .ffx-success-answers dd' ) ].map( ( e ) => e.textContent ) ).toEqual( [ 'Wofür?', 'Grünes Auto' ] );
		expect( $( root, '.ffx-success-downloads a' ).textContent ).toBe( 'info.pdf' );
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( root.querySelector( '.ffx-confetti' ) ).toBeNull();
	} );
} );

describe( 'summary helpers', () => {
	it( 'encodes like PHP json_encode', () => {
		const encoded = base64Json( [ { id: '1', title: 'Grün/Blau', answer: '€' } ] );
		expect( atob( encoded ) ).toBe( '[{"id":"1","title":"Gr\\u00fcn\\/Blau","answer":"\\u20ac"}]' );
	} );

	it( 'leaves out questions without an answer', () => {
		const text = ( f: string ): Field => ( { id: f, key: f, type: 'text', label: de( f ), description: de( '' ), required: false, props: { placeholder: de( '' ) } } ) as Field;
		const steps = [ { id: 'n', type: 'step' as const, fields: [ text( 'a' ), text( 'b' ), text( 'c' ), text( 'd' ) ] } ];
		expect( summary( steps, { a: 'Ja', b: '', c: '  ', d: [] }, ( v ) => v?.de_DE ?? '' ).map( ( i ) => i.title ) ).toEqual( [ 'a' ] );
	} );

	it( 'fills only the tokens known before a submit', () => {
		expect( questionRedirectUrl( 'https://x.test/{{page:query}}/{{entry:id}}', [], [], { url: '', query: 'a=b c', title: '' } ) ).toBe( 'https://x.test/a%3Db%20c/' );
	} );
} );

describe( 'mountAll', () => {
	it( 'starts each rendered form once', () => {
		document.body.innerHTML = `<div class="ffx-form" data-ffx-form="f1"><script type="application/json" class="ffx-form-data">${ JSON.stringify( config() ) }</script></div><div class="ffx-form" data-ffx-form="bad"><script type="application/json" class="ffx-form-data">{</script></div>`;
		const error = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		expect( mountAll() ).toHaveLength( 1 );
		expect( mountAll() ).toHaveLength( 0 );
		expect( document.querySelector( '.ffx-question' )?.firstChild?.textContent ).toBe( 'Wofür?' );
		expect( error ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'file fields', () => {
	function uploadForm( extra: Record<string, unknown> = {} ): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: unknown[]; edges: unknown[]; start: string };
		doc.nodes.unshift( {
			id: 'nf',
			type: 'step',
			fields: [ { id: 'qf', key: 'qf', type: 'file', label: de( 'Unterlagen' ), description: de( '' ), required: true, props: { dropzoneText: de( 'Dateien hierher' ), maxSizeMb: 1, maxFiles: 2, deniedMimeTypes: [], visibility: 'private', ...extra } } ],
		} );
		doc.edges.unshift( { id: 'xf', from: 'nf', to: 'n1' } );
		doc.start = 'nf';
		base.strings.file_too_large = 'Zu groß';
		base.strings.file_type_not_allowed = 'Typ nicht erlaubt';
		base.strings.too_many_files = 'Höchstens 2 Dateien';
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	const choose = ( root: HTMLElement, files: File[] ): void => {
		const input = $<HTMLInputElement>( root, '.ffx-file-input' );
		Object.defineProperty( input, 'files', { value: files, configurable: true } );
		input.dispatchEvent( new Event( 'change' ) );
	};

	it( 'uploads, lists and removes files, and sends their references', async () => {
		const root = uploadForm();
		expect( $( root, '.ffx-dropzone' ).textContent ).toBe( 'Dateien hierher' );
		next( root );
		expect( $( root, '.ffx-field-file .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );

		reply( '/files', 201, { ok: true, ref: 'a'.repeat( 32 ), name: 'angebot.pdf', size: 3 } );
		reply( '/files', 400, { ok: false, code: 'file_type_not_allowed' } );
		choose( root, [ new File( [ 'pdf' ], 'angebot.pdf' ), new File( [ 'exe' ], 'tool.exe' ) ] );
		expect( $<HTMLButtonElement>( root, '.ffx-button-next' ).disabled ).toBe( true );
		await vi.advanceTimersByTimeAsync( 0 );

		expect( [ ...root.querySelectorAll( '.ffx-file-name' ) ].map( ( n ) => n.textContent ) ).toEqual( [ 'angebot.pdf' ] );
		expect( $( root, '.ffx-field-file .ffx-error' ).textContent ).toBe( 'Typ nicht erlaubt' );
		expect( $<HTMLButtonElement>( root, '.ffx-button-next' ).disabled ).toBe( false );
		const upload = requests.find( ( r ) => r.path === '/files' );
		expect( upload?.body ).toMatchObject( { field: 'qf', file: 'angebot.pdf' } );
		expect( String( upload?.body.token ) ).toMatch( /^t\d+$/ );

		// Too large files never leave the browser.
		choose( root, [ new File( [ new Uint8Array( 2 * 1024 * 1024 ) ], 'gross.zip' ) ] );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-field-file .ffx-error' ).textContent ).toBe( 'Zu groß' );
		expect( requests.filter( ( r ) => r.path === '/files' ) ).toHaveLength( 2 );

		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
		reply( '/calculations', 200, { ok: true, calculations: {} } );
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: null, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( ( requests.find( ( r ) => r.path === '/entries' )?.body.answers as Record<string, unknown> ).qf ).toEqual( [ 'a'.repeat( 32 ) ] );
	} );

	it( 'takes only the named file types and shows pictures it took', async () => {
		const created: string[] = [];
		const revoked: string[] = [];
		const create = URL.createObjectURL;
		const revoke = URL.revokeObjectURL;
		URL.createObjectURL = ( blob: Blob | MediaSource ) => {
			created.push( ( blob as File ).name );
			return `blob:${ ( blob as File ).name }`;
		};
		URL.revokeObjectURL = ( url: string ) => {
			revoked.push( url );
		};
		try {
			const root = uploadForm( { allowedExtensions: [ 'jpg', 'PDF' ], hint: de( 'Nur <b>JPG</b> oder PDF' ), preview: true } );
			expect( $<HTMLInputElement>( root, '.ffx-file-input' ).accept ).toBe( '.jpg,.jpeg,.pdf' );
			expect( $( root, '.ffx-dropzone-hint' ).textContent ).toBe( 'Nur JPG oder PDF' );

			// A file of another type never leaves the browser.
			choose( root, [ new File( [ 'png' ], 'bild.png', { type: 'image/png' } ) ] );
			await vi.advanceTimersByTimeAsync( 0 );
			expect( $( root, '.ffx-field-file .ffx-error' ).textContent ).toBe( 'Typ nicht erlaubt' );
			expect( requests.filter( ( r ) => r.path === '/files' ) ).toHaveLength( 0 );

			reply( '/files', 201, { ok: true, ref: 'a'.repeat( 32 ), name: 'foto.JPG', size: 3 } );
			reply( '/files', 201, { ok: true, ref: 'b'.repeat( 32 ), name: 'plan.pdf', size: 3 } );
			choose( root, [ new File( [ 'jpg' ], 'foto.JPG', { type: 'image/jpeg' } ), new File( [ 'pdf' ], 'plan.pdf', { type: 'application/pdf' } ) ] );
			await vi.advanceTimersByTimeAsync( 0 );
			expect( created ).toEqual( [ 'foto.JPG' ] );
			expect( [ ...root.querySelectorAll<HTMLImageElement>( '.ffx-file-thumb' ) ].map( ( i ) => i.getAttribute( 'src' ) ) ).toEqual( [ 'blob:foto.JPG' ] );
			$( root, '.ffx-file-remove' ).click();
			expect( revoked ).toEqual( [ 'blob:foto.JPG' ] );
			expect( root.querySelectorAll( '.ffx-file-thumb' ) ).toHaveLength( 0 );
		} finally {
			URL.createObjectURL = create;
			URL.revokeObjectURL = revoke;
		}
	} );

	it( 'takes jpeg for jpg and says why a file was left out after the others are through', async () => {
		const root = uploadForm( { allowedExtensions: [ 'jpg' ] } );
		expect( $<HTMLInputElement>( root, '.ffx-file-input' ).accept ).toBe( '.jpg,.jpeg' );
		reply( '/files', 201, { ok: true, ref: 'a'.repeat( 32 ), name: 'IMG_1.jpeg', size: 3 } );
		reply( '/files', 201, { ok: true, ref: 'b'.repeat( 32 ), name: 'IMG_2.JPG', size: 3 } );
		choose( root, [ new File( [ 'a' ], 'IMG_1.jpeg' ), new File( [ 'b' ], 'IMG_2.JPG' ), new File( [ 'c' ], 'IMG_3.jpg' ) ] );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( [ ...root.querySelectorAll( '.ffx-file-name' ) ].map( ( n ) => n.textContent ) ).toEqual( [ 'IMG_1.jpeg', 'IMG_2.JPG' ] );
		const error = $( root, '.ffx-field-file .ffx-error' );
		expect( error.hidden ).toBe( false );
		expect( error.textContent ).toBe( 'Höchstens 2 Dateien' );
	} );

	it( 'shows no hint, filter or picture unless set', () => {
		const root = uploadForm();
		expect( $<HTMLInputElement>( root, '.ffx-file-input' ).hasAttribute( 'accept' ) ).toBe( false );
		expect( root.querySelector( '.ffx-dropzone-hint' ) ).toBeNull();
	} );

	it( 'removes a file from the list', async () => {
		const root = uploadForm();
		reply( '/files', 201, { ok: true, ref: 'b'.repeat( 32 ), name: 'foto.jpg', size: 3 } );
		choose( root, [ new File( [ 'jpg' ], 'foto.jpg' ) ] );
		await vi.advanceTimersByTimeAsync( 0 );
		$( root, '.ffx-file-remove' ).click();
		expect( root.querySelectorAll( '.ffx-file' ) ).toHaveLength( 0 );
		next( root );
		expect( $( root, '.ffx-field-file .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );
	} );
} );

describe( 'appointments', () => {
	function bookingForm( locale = 'de_DE' ): HTMLElement {
		const base = { ...config(), locale };
		const doc = base.document as unknown as { nodes: unknown[]; edges: unknown[]; start: string };
		doc.nodes.unshift( {
			id: 'nb',
			type: 'step',
			fields: [ { id: 'qb', key: 'termin', type: 'booking', label: de( 'Wann passt es?' ), description: de( '' ), required: true, props: { bookingTypeRef: 'bt:1' } } ],
		} );
		doc.edges.unshift( { id: 'xb', from: 'nb', to: 'n1' } );
		doc.start = 'nb';
		Object.assign( base.strings, { booking_selected: 'Ihr Termin: %s', slot_taken: 'Schon vergeben', booking_no_times: 'Nichts frei', booking_timezone: 'Zeiten in %s' } );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	const free = ( days: Record<string, string[]>, duration = 30 ): Record<string, unknown> => ( { ok: true, timezone: 'Europe/Berlin', durations: [ 30, 60 ], duration, window: { from: '2026-10-28', to: '2026-12-31' }, days } );
	const pressed = ( root: HTMLElement, selector: string ): string[] => [ ...root.querySelectorAll<HTMLElement>( `${ selector }[aria-pressed="true"]` ) ].map( ( b ) => b.dataset.day ?? b.textContent ?? '' );

	it( 'shows the calendar in formal German too', async () => {
		vi.setSystemTime( new Date( '2026-10-28T08:00:00Z' ) );
		reply( '/slots', 200, free( {} ) );
		reply( '/slots', 200, free( { '2026-11-02': [ '2026-11-02T09:00:00Z' ] } ) );
		// "de-DE_formal" is no language tag; dates in it threw and left the step without times.
		const root = bookingForm( 'de_DE_formal' );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-booking-month' ).textContent ).toBe( 'November 2026' );
		expect( root.querySelectorAll( '.ffx-booking-time' ) ).toHaveLength( 1 );
	} );

	it( 'shows the first month with free times, books a time and picks again when it was taken', async () => {
		vi.setSystemTime( new Date( '2026-10-28T08:00:00Z' ) );
		reply( '/slots', 200, free( {} ) );
		reply( '/slots', 200, free( { '2026-11-02': [ '2026-11-02T09:00:00Z', '2026-11-02T10:00:00Z' ], '2026-11-03': [ '2026-11-03T13:00:00Z' ] } ) );
		const root = bookingForm();
		await vi.advanceTimersByTimeAsync( 0 );

		const asked = requests.filter( ( r ) => r.path === '/slots' ).map( ( r ) => r.body );
		expect( asked ).toEqual( [
			{ field: 'qb', from: '2026-09-30', to: '2026-11-01', duration: 0 },
			{ field: 'qb', from: '2026-10-31', to: '2026-12-01', duration: 30 },
		] );
		expect( $( root, '.ffx-booking-month' ).textContent ).toBe( 'November 2026' );
		expect( pressed( root, '.ffx-booking-day' ) ).toEqual( [ '2026-11-02' ] );
		expect( root.querySelectorAll( '.ffx-booking-time' ) ).toHaveLength( 2 );
		expect( $<HTMLButtonElement>( root, '[data-day="2026-11-04"]' ).disabled ).toBe( true );
		expect( $( root, '.ffx-booking-zone' ).textContent ).toMatch( /^Zeiten in / );
		// The month and the times of the chosen day sit side by side where the field is wide enough.
		expect( root.querySelectorAll( '.ffx-booking-main > .ffx-booking-calendar .ffx-booking-day' ).length ).toBeGreaterThan( 27 );
		expect( root.querySelectorAll( '.ffx-booking-main > .ffx-booking-slots .ffx-booking-time' ) ).toHaveLength( 2 );
		expect( $( root, '.ffx-booking-date' ).textContent ).toMatch( /2\. November$/ );
		expect( $( root, '.ffx-booking-durations .ffx-booking-label' ).textContent ).toBe( $( root, '.ffx-booking-durations' ).getAttribute( 'aria-label' ) );
		next( root );
		expect( $( root, '.ffx-field-booking .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );

		// Another duration asks again; the day with times comes first.
		reply( '/slots', 200, free( { '2026-11-03': [ '2026-11-03T13:00:00Z' ] }, 60 ) );
		[ ...root.querySelectorAll<HTMLButtonElement>( '.ffx-booking-duration' ) ].find( ( b ) => b.textContent === '1 h' )?.click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.filter( ( r ) => r.path === '/slots' ).at( -1 )?.body.duration ).toBe( 60 );
		expect( pressed( root, '.ffx-booking-day' ) ).toEqual( [ '2026-11-03' ] );
		$( root, '.ffx-booking-time' ).click();
		expect( $( root, '.ffx-booking-chosen' ).textContent ).toMatch( /^Ihr Termin: .*2026.*\(1 h\)$/ );

		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 422, { ok: false, code: 'invalid_answers', fields: { qb: 'slot_taken' } } );
		reply( '/slots', 200, free( {} ) );
		reply( '/slots', 200, free( { '2026-11-02': [ '2026-11-02T09:00:00Z' ] } ) );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( ( requests.find( ( r ) => r.path === '/entries' )?.body.answers as Record<string, unknown> ).qb ).toEqual( { start: '2026-11-03T13:00:00Z', duration: 60 } );

		// Back at the appointment, with the times as they are now.
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'nb' );
		expect( $( root, '.ffx-field-booking .ffx-error' ).textContent ).toBe( 'Schon vergeben' );
		expect( pressed( root, '.ffx-booking-day' ) ).toEqual( [ '2026-11-02' ] );
		expect( pressed( root, '.ffx-booking-time' ) ).toEqual( [] );
		expect( $( root, '.ffx-button-back' ).hidden ).toBe( true );
	} );

	it( 'checks the answer like the plugin', () => {
		const field = { id: 'qb', type: 'booking', required: false, props: { bookingTypeRef: 'bt:1' } } as unknown as Field;
		expect( checkStepField( field, undefined ) ).toBeNull();
		expect( checkStepField( field, { start: '2026-11-03T13:00:00Z', duration: 30 } ) ).toBeNull();
		expect( checkStepField( field, '2026-11-03' ) ).toBe( 'invalid_booking' );
		expect( item( field, { start: '2026-11-03T13:00:00Z', duration: 90 }, () => '' ).answer ).toMatch( /2026.*\(1 h 30 min\)$/ );
	} );
} );

describe( 'contact extras', () => {
	function extrasForm( captcha: Record<string, string> = { siteKey: 'site-key' } ): HTMLElement {
		const base = config();
		const contact = ( base.document as unknown as { nodes: Array<{ id: string; fields: unknown[] }> } ).nodes.find( ( n ) => n.id === 'n4' );
		contact?.fields.push(
			{ id: 'c_plz', key: 'plz', type: 'text', label: de( 'PLZ' ), required: false, props: { placeholder: de( '' ), mask: '99999' } },
			{ id: 'c_cap', key: 'cap', type: 'captcha', label: de( '' ), required: true, props: captcha }
		);
		base.strings.invalid_format = 'Format ungültig';
		base.strings.captcha_failed = 'Kein Roboter?';
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	it( 'applies input masks and checks reCAPTCHA', async () => {
		const grecaptcha = { render: vi.fn( () => 7 ), reset: vi.fn() };
		const root = extrasForm();
		await toContact( root );

		const plz = $<HTMLInputElement>( root, '.ffx-contact-text input' );
		expect( plz.placeholder ).toBe( '_____' );
		type( plz, 'a1b0115x9' );
		expect( plz.value ).toBe( '10115' );
		type( plz, '1011' );

		// Without consent for Google the script waits for a click.
		expect( document.head.querySelector( 'script[src*="recaptcha/api.js"]' ) ).toBeNull();
		const ask = $( root, '.ffx-contact-captcha .ffx-consent-load' );
		expect( ask.textContent ).toBe( 'load_captcha'.replace( '%s', 'Google' ) );
		ask.click();
		expect( document.activeElement ).toBe( $( root, '.ffx-captcha-box' ) );
		const script = document.head.querySelector<HTMLScriptElement>( 'script[src*="recaptcha/api.js"]' );
		expect( script?.src ).toContain( 'render=explicit' );
		window.grecaptcha = grecaptcha;
		window.ffxRecaptchaReady?.();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( grecaptcha.render ).toHaveBeenCalledWith( expect.any( HTMLElement ), expect.objectContaining( { sitekey: 'site-key' } ) );

		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		$( root, '.ffx-button-submit' ).click();
		expect( $( root, '.ffx-contact-text .ffx-error' ).textContent ).toBe( 'Format ungültig' );
		expect( $( root, '.ffx-contact-captcha .ffx-error' ).textContent ).toBe( 'Kein Roboter?' );

		type( plz, '10115' );
		const options = ( grecaptcha.render.mock.calls[ 0 ] as unknown[] )[ 1 ] as { callback: ( token: string ) => void };
		options.callback( 'widget-answer' );
		reply( '/entries', 422, { ok: false, code: 'invalid_answers', fields: { c_cap: 'captcha_failed' } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( ( requests.find( ( r ) => r.path === '/entries' )?.body.contact as Record<string, unknown> ) ).toMatchObject( { c_plz: '10115', c_cap: 'widget-answer' } );
		// A used answer is worthless; the box starts over.
		expect( grecaptcha.reset ).toHaveBeenCalledWith( 7 );
		expect( $( root, '.ffx-contact-captcha .ffx-error' ).textContent ).toBe( 'Kein Roboter?' );
	} );

	it( 'loads Turnstile or hCaptcha for the site-wide spam protection', async () => {
		const turnstile = { render: vi.fn( () => 'w1' ), reset: vi.fn() };
		// The consent tool allows it already: no button, the box loads at once.
		window.wp_has_consent = ( category ) => category === 'marketing';
		const root = extrasForm( { siteKey: 'ts-key', provider: 'turnstile' } );
		await toContact( root );
		const script = document.head.querySelector<HTMLScriptElement>( 'script[src*="challenges.cloudflare.com/turnstile"]' );
		expect( script?.src ).toContain( 'onload=ffxTurnstileReady&render=explicit' );
		( window as unknown as Record<string, unknown> ).turnstile = turnstile;
		( window as unknown as Record<string, () => void> ).ffxTurnstileReady?.();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( turnstile.render ).toHaveBeenCalledWith( expect.any( HTMLElement ), expect.objectContaining( { sitekey: 'ts-key' } ) );
	} );

	it( 'loads reCAPTCHA v3 from the chunk of the plugin, which answers without a box', async () => {
		window.wp_has_consent = ( category ) => category === 'marketing';
		const root = extrasForm( { siteKey: 'v3-key', provider: 'recaptcha3', src: 'https://example.org/wp-content/plugins/funnelforms/assets/runtime/runtime-recaptcha3.js?ver=5' } );
		await toContact( root );
		const chunk = document.head.querySelector<HTMLScriptElement>( 'script[src*="runtime-recaptcha3.js"]' );
		expect( chunk?.src ).toContain( '?ver=5?onload=ffxRecaptcha3Ready' );

		const execute = vi.fn( async () => 'v3-token' );
		( window as unknown as Record<string, unknown> ).grecaptcha = { ready: ( callback: () => void ) => callback(), execute };
		await import( '../src/chunks/recaptcha3' );
		await vi.advanceTimersByTimeAsync( 0 );
		const google = [ ...document.head.querySelectorAll( 'script' ) ].find( ( s ) => s.src === 'https://www.google.com/recaptcha/api.js?render=v3-key' );
		expect( google ).not.toBeNull();
		google?.onload?.( new Event( 'load' ) );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( execute ).toHaveBeenCalledWith( 'v3-key', { action: 'submit' } );
		// Answers expire after two minutes; the chunk asks again before.
		await vi.advanceTimersByTimeAsync( 100000 );
		expect( execute ).toHaveBeenCalledTimes( 2 );
	} );
} );

describe( 'field types of 5.0', () => {
	function typesForm(): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: unknown[]; edges: unknown[]; start: string };
		const field = ( id: string, type: string, props: Record<string, unknown> ): Record<string, unknown> => ( { id, key: id, type, label: de( id ), description: de( '' ), required: false, props } );
		doc.nodes.unshift(
			{
				id: 'nt',
				type: 'step',
				fields: [
					field( 'f_mail', 'email', { placeholder: de( '' ) } ),
					field( 'f_tel', 'phone', { placeholder: de( '' ) } ),
					field( 'f_web', 'url', { placeholder: de( '' ) } ),
					field( 'f_num', 'number', { placeholder: de( '' ), min: 0, max: 500, unit: { text: de( 'm²' ), position: 'after' } } ),
					field( 'f_time', 'time', { min: '08:00', max: '18:00', stepMinutes: 15 } ),
				],
			},
			{ id: 'nr', type: 'step', fields: [ field( 'f_rate', 'rating', { min: 1, max: 5, style: 'stars', lowLabel: de( 'schlecht' ), highLabel: de( 'super' ) } ) ] }
		);
		doc.edges.unshift( { id: 'xt', from: 'nt', to: 'nr' }, { id: 'xr', from: 'nr', to: 'n1' } );
		doc.start = 'nt';
		Object.assign( base.strings, { invalid_phone: 'Telefon ungültig', invalid_url: 'Adresse ungültig', invalid_time: 'Zeit ungültig', out_of_range: 'Außerhalb', invalid_format: 'Format', rating_value: '%1$s von %2$s' } );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}
	const input = ( root: HTMLElement, type: string ): HTMLInputElement => $<HTMLInputElement>( root, `.ffx-field-${ type } input` );
	const errorOf = ( root: HTMLElement, type: string ): string => $( root, `.ffx-field-${ type } .ffx-error` ).textContent ?? '';

	it( 'checks e-mail, phone, web address, number and time and sends them', async () => {
		const root = typesForm();
		expect( input( root, 'email' ).type ).toBe( 'email' );
		expect( input( root, 'phone' ).type ).toBe( 'tel' );
		expect( input( root, 'number' ).step ).toBe( 'any' );
		expect( $( root, '.ffx-field-number .ffx-unit' ).textContent ).toBe( 'm²' );
		expect( input( root, 'time' ).step ).toBe( '900' );
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'nr' );
	} );

	it( 'shows what is wrong and sends the values', async () => {
		const root = typesForm();
		type( input( root, 'email' ), 'erika@' );
		type( input( root, 'phone' ), '12 34' );
		type( input( root, 'url' ), 'nicht da' );
		type( input( root, 'number' ), '900' );
		next( root );
		expect( [ 'email', 'phone', 'url', 'number' ].map( ( t ) => errorOf( root, t ) ) ).toEqual( [ 'E-Mail ungültig', 'Telefon ungültig', 'Adresse ungültig', 'Außerhalb' ] );

		type( input( root, 'email' ), 'erika@example.org' );
		type( input( root, 'phone' ), '+49 (30) 123-456' );
		type( input( root, 'url' ), 'example.org/angebot' );
		type( input( root, 'number' ), '120.5' );
		type( input( root, 'time' ), '09:30' );
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'nr' );

		// An optional rating keeps Next, so it can be skipped.
		expect( $( root, '.ffx-nav .ffx-button-next' ).hidden ).toBe( false );
		const stars = root.querySelectorAll<HTMLButtonElement>( '.ffx-rating-option' );
		expect( [ ...stars ].map( ( s ) => s.getAttribute( 'aria-label' ) ) ).toEqual( [ '1 von 5', '2 von 5', '3 von 5', '4 von 5', '5 von 5' ] );
		expect( $( root, '.ffx-rating-labels' ).textContent ).toBe( 'schlechtsuper' );
		stars[ 3 ]?.click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );

		$( root, '.ffx-button-back' ).click();
		expect( root.querySelectorAll( '.ffx-rating-on' ) ).toHaveLength( 4 );
		expect( root.querySelector( '.ffx-rating-option[aria-pressed="true"]' )?.textContent ).toBe( '★' );
		root.querySelectorAll<HTMLButtonElement>( '.ffx-rating-option' )[ 3 ]?.click();

		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: { show: true, html: '<p>Danke!</p>', image: null }, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.answers ).toEqual( {
			f_mail: 'erika@example.org',
			f_tel: '+49 (30) 123-456',
			f_web: 'example.org/angebot',
			f_num: 120.5,
			f_time: '09:30',
			f_rate: 4,
			q1: [ 'o1' ],
			q2: 50,
			q3: 'Berlin',
		} );
	} );
} );

describe( 'signature fields', () => {
	let calls: string[];
	beforeEach( () => {
		calls = [];
		const pen = new Proxy( {}, {
			get: ( _t, name: string ) => ( name === 'canvas' ? undefined : ( ...args: unknown[] ) => calls.push( `${ name }(${ args.map( String ).join( ',' ) })` ) ),
			set: ( _t, name: string, value: unknown ) => {
				calls.push( `${ name }=${ String( value ) }` );
				return true;
			},
		} );
		vi.spyOn( HTMLCanvasElement.prototype, 'getContext' ).mockReturnValue( pen as unknown as CanvasRenderingContext2D );
		HTMLCanvasElement.prototype.toBlob = function ( done: BlobCallback ) {
			done( new Blob( [ 'png' ], { type: 'image/png' } ) );
		};
		HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,cG5n';
	} );
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	function signatureForm( extra: Record<string, unknown> = {} ): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: unknown[]; edges: unknown[]; start: string };
		doc.nodes.unshift( { id: 'ns', type: 'step', fields: [ { id: 'qs', key: 'qs', type: 'signature', label: de( 'Unterschrift' ), description: de( '' ), required: true, props: { clearLabel: de( '' ), typeLabel: de( 'Oder Namen tippen' ), ...extra } } ] } );
		doc.edges.unshift( { id: 'xs', from: 'ns', to: 'n1' } );
		doc.start = 'ns';
		base.strings.clear_signature = 'Löschen';
		base.strings.upload_signature = 'Bild hochladen';
		base.strings.file_type_not_allowed = 'Typ nicht erlaubt';
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	it( 'uploads the typed or drawn signature once the visitor pauses', async () => {
		const root = signatureForm();
		expect( $( root, '.ffx-signature-clear' ).textContent ).toBe( 'Löschen' );
		expect( $( root, '.ffx-signature-typed-label' ).textContent ).toBe( 'Oder Namen tippen' );
		next( root );
		expect( $( root, '.ffx-field-signature .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );

		reply( '/files', 201, { ok: true, ref: 'b'.repeat( 32 ), name: 'signature.png', size: 3 } );
		type( $<HTMLInputElement>( root, '.ffx-signature-typed' ), 'Erika Muster' );
		expect( calls.some( ( c ) => c.startsWith( 'fillText(Erika Muster' ) ) ).toBe( true );
		expect( $<HTMLButtonElement>( root, '.ffx-button-next' ).disabled ).toBe( true );
		await vi.advanceTimersByTimeAsync( 400 );
		expect( $<HTMLButtonElement>( root, '.ffx-button-next' ).disabled ).toBe( false );
		expect( requests.filter( ( r ) => r.path === '/files' ).map( ( r ) => r.body ) ).toMatchObject( [ { field: 'qs', file: 'signature.png' } ] );

		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
		$( root, '.ffx-button-back' ).click();
		$( root, '.ffx-signature-clear' ).click();
		next( root );
		expect( $( root, '.ffx-field-signature .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );

		// Drawing with a pointer.
		reply( '/files', 201, { ok: true, ref: 'c'.repeat( 32 ), name: 'signature.png', size: 3 } );
		const pad = $( root, '.ffx-signature-pad' );
		pad.dispatchEvent( new PointerEvent( 'pointerdown', { clientX: 10, clientY: 10 } ) );
		pad.dispatchEvent( new PointerEvent( 'pointermove', { clientX: 50, clientY: 30 } ) );
		pad.dispatchEvent( new PointerEvent( 'pointerup' ) );
		expect( calls ).toContain( 'stroke()' );
		await vi.advanceTimersByTimeAsync( 400 );
		next( root );
		reply( '/calculations', 200, { ok: true, calculations: {} } );
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: null, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.answers ).toMatchObject( { qs: [ 'c'.repeat( 32 ) ] } );
	} );
	it( 'draws in its own ink and takes a picture of a signature', async () => {
		const root = signatureForm( { penColor: '#1d3a8a', upload: true } );
		type( $<HTMLInputElement>( root, '.ffx-signature-typed' ), 'E' );
		expect( calls ).toContain( 'strokeStyle=#1d3a8a' );
		$( root, '.ffx-signature-clear' ).click();
		expect( $( root, '.ffx-signature-upload' ).textContent ).toBe( 'Bild hochladen' );
		const picture = $<HTMLInputElement>( root, '.ffx-field-signature .ffx-file-input' );
		expect( picture.accept ).toBe( 'image/png,image/jpeg' );
		expect( $<HTMLLabelElement>( root, '.ffx-signature-upload' ).htmlFor ).toBe( picture.id );

		const pick = ( file: File ): void => {
			Object.defineProperty( picture, 'files', { value: [ file ], configurable: true } );
			picture.dispatchEvent( new Event( 'change' ) );
		};
		pick( new File( [ 'gif' ], 'name.gif', { type: 'image/gif' } ) );
		expect( $( root, '.ffx-field-signature .ffx-error' ).textContent ).toBe( 'Typ nicht erlaubt' );

		const images: Array<{ onload: () => void; width: number; height: number; src: string }> = [];
		vi.stubGlobal( 'Image', class {
			width = 800;
			height = 200;
			src = '';
			onload = (): void => undefined;
			onerror = (): void => undefined;
			constructor() {
				images.push( this );
			}
		} );
		const create = URL.createObjectURL;
		const revoke = URL.revokeObjectURL;
		URL.createObjectURL = () => 'blob:sig';
		URL.revokeObjectURL = () => undefined;
		try {
			reply( '/files', 201, { ok: true, ref: 'd'.repeat( 32 ), name: 'signature.png', size: 3 } );
			pick( new File( [ 'png' ], 'name.png', { type: 'image/png' } ) );
			const image = images[ 0 ];
			expect( image?.src ).toBe( 'blob:sig' );
			image?.onload();
			expect( calls.some( ( c ) => c.startsWith( 'drawImage(' ) ) ).toBe( true );
			expect( $( root, '.ffx-field-signature .ffx-error' ).hidden ).toBe( true );
			await vi.advanceTimersByTimeAsync( 400 );
			expect( requests.filter( ( r ) => r.path === '/files' ).map( ( r ) => r.body ) ).toMatchObject( [ { field: 'qs', file: 'signature.png' } ] );
			next( root );
			expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
		} finally {
			URL.createObjectURL = create;
			URL.revokeObjectURL = revoke;
			vi.unstubAllGlobals();
		}
	} );

	it( 'offers no picture upload unless set', () => {
		const root = signatureForm();
		expect( root.querySelector( '.ffx-signature-upload' ) ).toBeNull();
		expect( root.querySelector( '.ffx-field-signature .ffx-file-input' ) ).toBeNull();
	} );
} );

describe( 'save and continue later', () => {
	const key = 'a1'.repeat( 16 );
	function saveForm(): HTMLElement {
		const base = config();
		base.document.settings.saveProgress = true;
		Object.assign( base.strings, { save_progress: 'Später weitermachen', progress_saved: 'Gespeichert', copy_link: 'Kopieren', nothing_to_save: 'Erst etwas beantworten', progress_not_found: 'Link abgelaufen', preview_unavailable: 'In der Vorschau nicht verfügbar' } );
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		return root;
	}
	afterEach( () => {
		window.history.replaceState( null, '', '/' );
	} );

	it( 'saves the answers so far and shows the link', async () => {
		window.history.replaceState( null, '', '/seite/?a=1' );
		const root = saveForm();
		const save = $<HTMLButtonElement>( root, '.ffx-button-save' );
		expect( save.textContent ).toBe( 'Später weitermachen' );
		reply( '/progress', 400, { ok: false, code: 'nothing_to_save' } );
		save.click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-form-error' ).textContent ).toBe( 'Erst etwas beantworten' );
		// The preview keeps nothing, so it says so instead of a failed send.
		reply( '/progress', 200, { ok: false, code: 'preview_unavailable' } );
		save.click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-form-error' ).textContent ).toBe( 'In der Vorschau nicht verfügbar' );

		clickOption( root, 'Immobilie' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		reply( '/progress', 200, { ok: true, key, expiresAt: '2026-11-14T08:00:00+00:00' } );
		save.click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.filter( ( r ) => r.path === '/progress' ).at( -1 )?.body ).toMatchObject( { answers: { q1: [ 'o1' ], q2: 50, q3: 'Berlin' }, key: '', token: 't1' } );
		expect( $( root, '.ffx-resume' ).hidden ).toBe( false );
		expect( $<HTMLInputElement>( root, '.ffx-resume-link' ).value ).toBe( `${ window.location.origin }/seite/?a=1&ffx_resume=${ key }` );

		// The link stays the same for later saves; the box goes with the next step.
		reply( '/progress', 200, { ok: true, key, expiresAt: '2026-11-14T08:00:00+00:00' } );
		save.click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.filter( ( r ) => r.path === '/progress' ).at( -1 )?.body.key ).toBe( key );
		reply( '/calculations', 200, { ok: true, calculations: {} } );
		next( root );
		expect( $( root, '.ffx-resume' ).hidden ).toBe( true );
	} );

	it( 'continues where the visitor stopped and drops the saved answers with the entry', async () => {
		window.history.replaceState( null, '', `/seite/?ffx_resume=${ key }` );
		reply( '/progress/load', 200, { ok: true, answers: { q1: [ 'o1' ], q2: 70, q3: 'Köln' } } );
		reply( '/calculations', 200, { ok: true, calculations: { c1: '1,00' } } );
		const root = saveForm();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.find( ( r ) => r.path === '/progress/load' )?.body ).toEqual( { key } );
		// The content step with the results is shown again.
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n3' );
		$( root, '.ffx-button-back' ).click();
		expect( $<HTMLInputElement>( root, '.ffx-field-text input' ).value ).toBe( 'Köln' );
		reply( '/calculations', 200, { ok: true, calculations: { c1: '1,00' } } );
		next( root );
		await vi.advanceTimersByTimeAsync( 0 );
		$( root, '.ffx-content-button' ).click();
		expect( $( root, '.ffx-button-save' ).hidden ).toBe( true );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: null, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body ).toMatchObject( { progress: key, answers: { q1: [ 'o1' ], q2: 70, q3: 'Köln' } } );
	} );

	it( 'says when a link expired', async () => {
		window.history.replaceState( null, '', `/seite/?ffx_resume=${ key }` );
		reply( '/progress/load', 404, { ok: false, code: 'progress_not_found' } );
		const root = saveForm();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-form-error' ).textContent ).toBe( 'Link abgelaufen' );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
	} );
} );

describe( 'calculation conditions', () => {
	it( 'asks the plugin where steps with score conditions lead', async () => {
		const base = config();
		base.document.edges.splice( 2, 0, { id: 'xs', from: 'n2', to: 'n4', when: { calc: 'c1', op: 'gte', value: 10 } } );
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );

		// Steps without them still move on in the browser.
		clickOption( root, 'Immobilie' );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );

		reply( '/next', 429, { ok: false, code: 'rate_limited' } );
		next( root );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		expect( $( root, '.ffx-form-error' ).hidden ).toBe( false );

		reply( '/next', 200, { ok: true, next: 'n4' } );
		next( root );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.filter( ( r ) => r.path === '/next' ).at( -1 )?.body ).toEqual( { answers: { q1: [ 'o1' ], q2: 50, q3: 'Berlin' }, node: 'n2', variants: {} } );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n4' );
		$( root, '.ffx-button-back' ).click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
	} );
} );

describe( 'A/B tests', () => {
	function abForm(): HTMLElement {
		// The form is on screen at once.
		vi.stubGlobal( 'IntersectionObserver', class {
			constructor( private readonly callback: ( entries: Array<{ isIntersecting: boolean }> ) => void ) {}
			observe(): void {
				this.callback( [ { isIntersecting: true } ] );
			}
			disconnect(): void {}
		} );
		const base = config();
		// Weights of 0 make the draw predictable: every page view gets "b" of the start test and "a" of the step test.
		base.document.experiments = [
			{ id: 'whole', status: 'running', variants: [ { id: 'a', weight: 0 }, { id: 'b', weight: 1, start: 'n2' } ] },
			{ id: 'step', status: 'running', variants: [ { id: 'a', weight: 1 }, { id: 'b', weight: 0 } ] },
			{ id: 'old', status: 'stopped', winner: 'b', variants: [ { id: 'a', weight: 1 }, { id: 'b', weight: 1, css: '--ffx-color-primary:#1d7a46;' } ] },
		];
		base.document.edges.splice( 2, 0, { id: 'xb', from: 'n2', to: 'n4', when: { experiment: 'step', variant: 'b' } } );
		base.document.settings.saveProgress = true;
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		return root;
	}
	afterEach( () => {
		window.history.replaceState( null, '', '/' );
	} );

	it( 'starts and branches by the variants drawn and measures them with the view', async () => {
		reply( '/events', 200, { ok: true } );
		const root = abForm();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		expect( window.dataLayer ).toEqual( [ { event: 'ffxExperiment', experiment: 'whole', variant: 'b' }, { event: 'ffxExperiment', experiment: 'step', variant: 'a' } ] );
		// The design of a variant shown (here the winner of a stopped test) is on the form.
		expect( root.style.getPropertyValue( '--ffx-color-primary' ) ).toBe( '#1d7a46' );
		await vi.advanceTimersByTimeAsync( 1500 );
		expect( requests.find( ( r ) => r.path === '/events' )?.body.events ).toEqual( [
			{ event: 'variant', step: 'whole', variant: 'b' },
			{ event: 'variant', step: 'step', variant: 'a' },
			{ event: 'view', step: '' },
			{ event: 'step', step: 'n2', variant: '' },
		] );

		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		reply( '/calculations', 200, { ok: true, calculations: {} } );
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n3' );
		reply( '/progress', 200, { ok: true, key: 'k'.repeat( 32 ), expiresAt: '2026-11-14T08:00:00+00:00' } );
		$( root, '.ffx-button-back' ).click();
		$( root, '.ffx-button-save' ).click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.find( ( r ) => r.path === '/progress' )?.body.variants ).toEqual( { whole: 'b', step: 'a', old: 'b' } );
	} );

	it( 'shows variants named in the address without measuring them', async () => {
		window.history.replaceState( null, '', '/seite/?ffx_variant=step:b,old:a' );
		reply( '/events', 200, { ok: true } );
		const root = abForm();
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n4' );
		await vi.advanceTimersByTimeAsync( 1500 );
		expect( requests.find( ( r ) => r.path === '/events' )?.body.events ).toContainEqual( { event: 'variant', step: 'whole', variant: 'b' } );
		expect( requests.find( ( r ) => r.path === '/events' )?.body.events ).not.toContainEqual( expect.objectContaining( { step: 'step' } ) );
	} );

	it( 'continues a resume link on the path of its variants', async () => {
		window.history.replaceState( null, '', `/seite/?ffx_resume=${ 'a1'.repeat( 16 ) }` );
		reply( '/progress/load', 200, { ok: true, answers: { q1: [ 'o1' ] }, variants: { whole: 'a', step: 'a', old: 'b' } } );
		const root = abForm();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
		$( root, '.ffx-button-back' ).click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
	} );
} );

describe( 'loading screens', () => {
	it( 'shows the animation and its texts, moves on by itself and is skipped on Back', async () => {
		const base = config();
		const step = base.document.nodes.find( ( n ) => n.id === 'n3' );
		if ( step?.type !== 'step' || step.fields[ 0 ]?.type !== 'content' ) {
			throw new Error( 'n3 holds a content field' );
		}
		step.fields[ 0 ].props = { html: de( '' ), autoAdvanceMs: 3000, button: { show: false, label: de( '' ) }, loader: { style: 'bar', messages: [ de( 'Wir rechnen…' ), de( 'Gleich fertig' ) ] } };
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );

		clickOption( root, 'Immobilie' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		next( root );
		expect( $( root, '.ffx-loader-bar' ).getAttribute( 'role' ) ).toBe( 'status' );
		expect( $( root, '.ffx-loader' ).style.getPropertyValue( '--ffx-loader-ms' ) ).toBe( '3000ms' );
		expect( $( root, '.ffx-loader-message' ).textContent ).toBe( 'Wir rechnen…' );
		expect( $( root, '.ffx-button-next' ).hidden ).toBe( true );
		await vi.advanceTimersByTimeAsync( 1500 );
		expect( $( root, '.ffx-loader-message' ).textContent ).toBe( 'Gleich fertig' );
		await vi.advanceTimersByTimeAsync( 1500 );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n4' );

		$( root, '.ffx-button-back' ).click();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n2' );
	} );

	function contentStep( props: Record<string, unknown> ): HTMLElement {
		const base = config();
		const step = base.document.nodes.find( ( n ) => n.id === 'n3' );
		if ( step?.type !== 'step' || step.fields[ 0 ]?.type !== 'content' ) {
			throw new Error( 'n3 holds a content field' );
		}
		( step.fields[ 0 ] as { props: unknown } ).props = { html: de( '<p>Text</p>' ), button: { show: true, label: de( '' ) }, ...props };
		( base.document as unknown as { start: string } ).start = 'n3';
		Object.assign( base.strings, { video_load: 'Video laden', video_note: 'Erst nach Klick von %s.' } );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	it( 'lets visitors hold text that moves on by itself, and never moves it for reduced motion', async () => {
		const props = { autoAdvanceMs: 2000, button: { show: false, label: de( '' ) } };
		let root = contentStep( props );
		// Without a heading the step itself takes the focus, so it does not fall back to the page.
		const pause = $( root, '.ffx-content-pause' );
		expect( pause.getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		pause.click();
		await vi.advanceTimersByTimeAsync( 5000 );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n3' );
		pause.click();
		await vi.advanceTimersByTimeAsync( 2000 );
		expect( $( root, '[data-node]' ).dataset.node ).not.toBe( 'n3' );
		root.remove();

		vi.stubGlobal( 'matchMedia', ( query: string ) => ( { matches: query.includes( 'reduce' ) } ) );
		root = contentStep( props );
		expect( root.querySelector( '.ffx-content-pause' ) ).toBeNull();
		await vi.advanceTimersByTimeAsync( 5000 );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n3' );
		expect( $( root, '.ffx-button-next' ).hidden ).toBe( false );
	} );

	it( 'moves the focus to a step without a heading', () => {
		const root = mount();
		clickOption( root, 'Immobilie' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		reply( '/calculations', 200, { ok: true, calculations: { c1: '1' } } );
		next( root );
		expect( document.activeElement ).toBe( $( root, '[data-node]' ) );
		expect( $( root, '[data-node]' ).tabIndex ).toBe( -1 );
	} );

	it( 'counts up to 100 percent in a ring, or shows dots', async () => {
		let root = contentStep( { autoAdvanceMs: 2000, button: { show: false, label: de( '' ) }, loader: { style: 'circle', messages: [] } } );
		expect( $( root, '.ffx-loader-percent' ).textContent ).toBe( '0 %' );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( $( root, '.ffx-loader-percent' ).textContent ).toBe( '50 %' );
		expect( $( root, '.ffx-loader' ).style.getPropertyValue( '--ffx-loader-done' ) ).toBe( '50' );
		root.remove();
		root = contentStep( { autoAdvanceMs: 2000, button: { show: false, label: de( '' ) }, loader: { style: 'dots', messages: [] } } );
		expect( root.querySelectorAll( '.ffx-loader-dots span' ) ).toHaveLength( 3 );
	} );

	it( 'loads YouTube and Vimeo only after a click', () => {
		expect( [ 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871?h=1', 'https://example.org/v.mp4', 'javascript:alert(1)', 'https://youtube.com/about' ].map( videoSource ) ).toEqual( [
			{ provider: 'youtube', id: 'dQw4w9WgXcQ' },
			{ provider: 'youtube', id: 'dQw4w9WgXcQ' },
			{ provider: 'youtube', id: 'dQw4w9WgXcQ' },
			{ provider: 'vimeo', id: '76979871' },
			{ provider: 'vimeo', id: '76979871' },
			{ provider: 'file', url: 'https://example.org/v.mp4' },
			null,
			null,
		] );
		const root = contentStep( { media: { kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', caption: de( 'Unser Film' ), width: 60 } } );
		expect( root.querySelector( 'iframe' ) ).toBeNull();
		expect( $( root, '.ffx-video-note' ).textContent ).toBe( 'Erst nach Klick von YouTube.' );
		expect( $( root, '.ffx-media' ).style.getPropertyValue( '--ffx-media-width' ) ).toBe( '60%' );
		// Detached, so the test browser does not load the frame.
		root.remove();
		$( root, '.ffx-video-play' ).click();
		const frame = $<HTMLIFrameElement>( root, 'iframe' );
		expect( frame.src ).toBe( 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0' );
		expect( frame.title ).toBe( 'Unser Film' );
		expect( $( root, 'figcaption' ).textContent ).toBe( 'Unser Film' );
	} );

	it( 'shows images and video files, never other addresses', () => {
		let root = contentStep( { media: { kind: 'image', url: 'https://example.org/bild.jpg', alt: de( 'Ein <b>Haus</b>' ) } } );
		const image = $<HTMLImageElement>( root, '.ffx-media img' );
		expect( [ image.src, image.alt, image.getAttribute( 'loading' ) ] ).toEqual( [ 'https://example.org/bild.jpg', 'Ein Haus', 'lazy' ] );
		root.remove();
		root = contentStep( { media: { kind: 'video', url: 'https://example.org/film.mp4' } } );
		expect( $<HTMLVideoElement>( root, 'video' ).controls ).toBe( true );
		root.remove();
		root = contentStep( { media: { kind: 'image', url: 'javascript:alert(1)' } } );
		expect( root.querySelector( '.ffx-media' ) ).toBeNull();
	} );
} );

describe( 'repeat groups', () => {
	function repeatForm(): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: unknown[]; edges: unknown[]; start: string };
		const sub = { description: de( '' ), required: true };
		doc.nodes.unshift( {
			id: 'nr',
			type: 'step',
			fields: [ {
				id: 'qr',
				key: 'qr',
				type: 'repeat',
				label: de( 'Teilnehmer' ),
				description: de( '' ),
				required: true,
				props: {
					minItems: 2,
					maxItems: 3,
					addLabel: de( '' ),
					itemLabel: de( 'Person %d' ),
					fields: [
						{ ...sub, id: 'name', key: 'name', type: 'text', label: de( 'Name' ), props: { placeholder: de( '' ) } },
						{ ...sub, id: 'mail', key: 'mail', type: 'email', label: de( 'E-Mail' ), required: false, props: { placeholder: de( '' ) } },
					],
				},
			} ],
		} );
		doc.edges.unshift( { id: 'xr', from: 'nr', to: 'n1' } );
		doc.start = 'nr';
		Object.assign( base.strings, { add_item: 'Weitere', remove_item: 'Eintrag %d entfernen', too_few_items: 'Mindestens %d Einträge' } );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	it( 'adds and removes items and checks each of them', async () => {
		const root = repeatForm();
		const items = (): HTMLElement[] => [ ...root.querySelectorAll<HTMLElement>( '.ffx-repeat-item' ) ];
		const at = ( i: number ): HTMLElement => {
			const el = items()[ i ];
			if ( ! el ) {
				throw new Error( `no item ${ i }` );
			}
			return el;
		};
		expect( items().map( ( i ) => i.querySelector( 'legend' )?.textContent ) ).toEqual( [ 'Person 1', 'Person 2' ] );
		expect( root.querySelector( '.ffx-repeat-remove' ) ).toBeNull();

		next( root );
		expect( $( root, '.ffx-field-repeat > .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );

		type( at( 0 ).querySelector( 'input' ) as HTMLInputElement, 'Ada' );
		next( root );
		expect( $( root, '.ffx-field-repeat > .ffx-error' ).textContent ).toBe( 'Mindestens 2 Einträge' );

		// The second item gets an e-mail address only: its name is missing, and the address is wrong.
		type( at( 1 ).querySelectorAll( 'input' )[ 1 ] as HTMLInputElement, 'nope' );
		next( root );
		expect( $( root, '.ffx-field-repeat > .ffx-error' ).hidden ).toBe( true );
		expect( [ ...at( 1 ).querySelectorAll( '.ffx-error' ) ].map( ( e ) => e.textContent ) ).toEqual( [ 'Pflichtfeld', 'E-Mail ungültig' ] );
		expect( document.activeElement ).toBe( at( 1 ).querySelector( 'input' ) );

		$( root, '.ffx-repeat-add' ).click();
		expect( items() ).toHaveLength( 3 );
		expect( $( root, '.ffx-repeat-add' ).hidden ).toBe( true );
		expect( at( 2 ).querySelector( '.ffx-repeat-remove' )?.getAttribute( 'aria-label' ) ).toBe( 'Eintrag 3 entfernen' );
		( at( 1 ).querySelector( '.ffx-repeat-remove' ) as HTMLElement ).click();
		expect( items() ).toHaveLength( 2 );
		type( at( 1 ).querySelector( 'input' ) as HTMLInputElement, 'Bob' );
		type( at( 1 ).querySelectorAll( 'input' )[ 1 ] as HTMLInputElement, 'bob@example.org' );
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );

		// Back shows the items again.
		$( root, '.ffx-button-back' ).click();
		expect( items().map( ( i ) => ( i.querySelector( 'input' ) as HTMLInputElement ).value ) ).toEqual( [ 'Ada', 'Bob' ] );
		next( root );
		reply( '/calculations', 200, { ok: true, calculations: {} } );
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: null, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.answers ).toMatchObject( { qr: [ { name: 'Ada' }, { name: 'Bob', mail: 'bob@example.org' } ] } );
	} );

	it( 'counts filled items only and summarizes them', () => {
		const group = {
			id: 'g', key: 'g', type: 'repeat', label: {}, description: {}, required: false,
			props: { minItems: 0, maxItems: 2, addLabel: {}, itemLabel: {}, fields: [ { id: 'a', key: 'a', type: 'text', label: { en_US: 'A' }, description: {}, required: false, props: { placeholder: {} } } ] },
		} as unknown as Field;
		expect( checkStepField( group, [ {}, { a: ' ' } ] ) ).toBeNull();
		expect( checkStepField( group, [ { a: '1' }, { a: '2' }, { a: '3' } ] ) ).toBe( 'too_many_items' );
		expect( item( group, [ { a: 'x' }, {}, { a: 'y' } ], ( t ) => t?.en_US ?? '' ).answer ).toBe( '1. A: x; 2. A: y' );
		expect( holds( { field: 'g', op: 'gte', value: 2, number: 'int' }, { g: [ { a: 'x' }, { a: 'y' } ] } ) ).toBe( true );
	} );
} );

describe( 'checks of the 5.0 field types', () => {
	const field = ( type: string, props: Record<string, unknown> ): Field => ( { id: 'f', key: 'f', type, label: {}, description: {}, required: true, props } ) as unknown as Field;

	it( 'mirrors the plugin', () => {
		const time = field( 'time', { min: '08:00', max: '18:00' } );
		expect( [ '07:59', '08:00', '18:01', '8:00', '24:00' ].map( ( v ) => checkStepField( time, v ) ) ).toEqual( [ 'out_of_range', null, 'out_of_range', 'invalid_time', 'invalid_time' ] );
		const number = field( 'number', { placeholder: {}, min: -5 } );
		expect( [ '1,5', '-6', 'abc', 3 ].map( ( v ) => checkStepField( number, v ) ) ).toEqual( [ null, 'out_of_range', 'invalid_format', null ] );
		const rating = field( 'rating', { min: 0, max: 10, style: 'numbers', lowLabel: {}, highLabel: {} } );
		expect( [ 0, 10, 11, 2.5 ].map( ( v ) => checkStepField( rating, v ) ) ).toEqual( [ null, null, 'out_of_range', 'out_of_range' ] );
		expect( [ 'https://example.org', 'example.org', 'ftp://example.org', 'localhost', 'javascript:alert(1)' ].map( isWebAddress ) ).toEqual( [ true, true, false, false, false ] );
		expect( checkStepField( field( 'phone', { placeholder: {} } ), '030 1234567 ext' ) ).toBe( 'invalid_phone' );
		expect( checkStepField( field( 'email', { placeholder: {} } ), '' ) ).toBe( 'required' );
	} );
} );

describe( 'address fields', () => {
	function addressForm( combined: boolean, mapsKey?: string, extra: Record<string, unknown> = {} ): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: unknown[]; edges: unknown[]; start: string };
		doc.nodes.unshift( {
			id: 'na',
			type: 'step',
			fields: [ { id: 'qa', key: 'qa', type: 'address', label: de( 'Wo?' ), description: de( '' ), required: true, legacy: { questionId: 88 }, props: { zoom: 8, start: { name: '', lat: 52.5, lng: 13.4 }, combined, showCountry: true, placesAutocomplete: true, ...extra } } ],
		} );
		doc.edges.unshift( { id: 'xa', from: 'na', to: 'n1' } );
		doc.start = 'na';
		base.strings.incomplete_address = 'Adresse unvollständig';
		base.strings.street = 'Straße';
		base.strings.use_location = 'Meinen Standort nutzen';
		base.strings.location_failed = 'Standort nicht gefunden';
		if ( mapsKey ) {
			base.mapsKey = mapsKey;
		}
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	it( 'asks for every part and sends them', async () => {
		const root = addressForm( false );
		expect( root.querySelector( '.ffx-address-street label' )?.textContent ).toBe( 'Straße' );
		expect( root.querySelectorAll( '.ffx-address input' ) ).toHaveLength( 5 );
		expect( root.querySelector( '.ffx-address-search' ) ).toBeNull();
		next( root );
		expect( $( root, '.ffx-field-address .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );
		type( $<HTMLInputElement>( root, '.ffx-address-street input' ), 'Hauptstraße' );
		next( root );
		expect( $( root, '.ffx-field-address .ffx-error' ).textContent ).toBe( 'Adresse unvollständig' );
		type( $<HTMLInputElement>( root, '.ffx-address-number input' ), '5' );
		type( $<HTMLInputElement>( root, '.ffx-address-zip input' ), '10115' );
		type( $<HTMLInputElement>( root, '.ffx-address-city input' ), 'Berlin' );
		type( $<HTMLInputElement>( root, '.ffx-address-country input' ), 'Deutschland' );
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
		const slide = ( window.dataLayer as Array<Record<string, unknown>> ).find( ( e ) => e.event === 'af2NextSlide' );
		expect( slide?.answer ).toBe( 'Hauptstraße 5, 10115 Berlin, Deutschland' );
	} );

	it( 'fills the parts from a Google suggestion', async () => {
		const box = document.createElement( 'div' );
		const marker = vi.fn();
		const importLibrary = vi.fn( async ( name: string ) => ( name === 'places'
			? { PlaceAutocompleteElement: function () {
				return box;
			} }
			: { Map: function () {
				return { setCenter: vi.fn(), setZoom: vi.fn() };
			} } ) );
		const root = addressForm( false, 'maps-key' );
		expect( document.head.querySelector( 'script[src*="maps.googleapis.com"]' ) ).toBeNull();
		expect( root.querySelector( '.ffx-address-search' ) ).toBeNull();
		$( root, '.ffx-field-address .ffx-consent-load' ).click();
		const script = document.head.querySelector<HTMLScriptElement>( 'script[src*="maps.googleapis.com"]' );
		expect( script?.src ).toContain( 'key=maps-key' );
		window.google = { maps: { importLibrary, Marker: marker as unknown as new () => { setMap(): void } } };
		window.ffxMapsReady?.();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( root.querySelector( '.ffx-address-search' )?.contains( box ) ).toBe( true );

		const place = {
			location: { lat: 1, lng: 2 },
			addressComponents: [
				{ longText: '5', types: [ 'street_number' ] },
				{ longText: 'Hauptstraße', types: [ 'route' ] },
				{ longText: 'Berlin', types: [ 'locality', 'political' ] },
				{ longText: 'Deutschland', types: [ 'country', 'political' ] },
				{ longText: '10115', types: [ 'postal_code' ] },
			],
			fetchFields: vi.fn( async () => ( {} ) ),
		};
		box.dispatchEvent( Object.assign( new Event( 'gmp-select' ), { placePrediction: { toPlace: () => place } } ) );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $<HTMLInputElement>( root, '.ffx-address-city input' ).value ).toBe( 'Berlin' );
		expect( marker ).toHaveBeenCalledWith( expect.objectContaining( { position: place.location } ) );
		next( root );
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
	} );

	it( 'fills the address from the visitor\'s location after a click', async () => {
		let allow = false;
		const asked = vi.fn();
		Object.defineProperty( navigator, 'geolocation', {
			configurable: true,
			value: {
				getCurrentPosition: ( ok: PositionCallback, fail: PositionErrorCallback ) => {
					asked();
					if ( allow ) {
						ok( { coords: { latitude: 52.52, longitude: 13.4 } } as GeolocationPosition );
					} else {
						fail( { code: 1 } as GeolocationPositionError );
					}
				},
			},
		} );
		const geocode = vi.fn( async () => ( {
			results: [ {
				address_components: [
					{ long_name: '1', types: [ 'street_number' ] },
					{ long_name: 'Unter den Linden', types: [ 'route' ] },
					{ long_name: '10117', types: [ 'postal_code' ] },
					{ long_name: 'Berlin', types: [ 'locality', 'political' ] },
				],
			} ],
		} ) );
		const center = vi.fn();
		const api = {
			importLibrary: vi.fn( async ( name: string ) => ( {
				places: { PlaceAutocompleteElement: function () {
					return document.createElement( 'div' );
				} },
				maps: { Map: function () {
					return { setCenter: center, setZoom: vi.fn() };
				} },
				geocoding: { Geocoder: function () {
					return { geocode };
				} },
			} as Record<string, Record<string, unknown>> )[ name ] ?? {} ),
			Marker: vi.fn() as unknown as new () => { setMap(): void },
		};
		window.wp_has_consent = () => true;
		try {
			const root = addressForm( true, 'maps-key', { locate: true } );
			// The loader may be done from an earlier test; it then hands out the same object.
			if ( window.google?.maps ) {
				Object.assign( window.google.maps, api );
			} else {
				window.google = { maps: api };
			}
			window.ffxMapsReady?.();
			await vi.advanceTimersByTimeAsync( 0 );
			const button = $<HTMLButtonElement>( root, '.ffx-address-locate' );
			expect( button.textContent ).toBe( 'Meinen Standort nutzen' );
			expect( button.hidden ).toBe( false );
			expect( asked ).not.toHaveBeenCalled();

			button.click();
			await vi.advanceTimersByTimeAsync( 0 );
			expect( $( root, '.ffx-field-address .ffx-error' ).textContent ).toBe( 'Standort nicht gefunden' );
			expect( geocode ).not.toHaveBeenCalled();

			allow = true;
			button.click();
			await vi.advanceTimersByTimeAsync( 0 );
			expect( geocode ).toHaveBeenCalledWith( { location: { lat: 52.52, lng: 13.4 } } );
			expect( $<HTMLInputElement>( root, '.ffx-address-combined input' ).value ).toBe( 'Unter den Linden 1, 10117 Berlin' );
			expect( $( root, '.ffx-field-address .ffx-error' ).hidden ).toBe( true );
			expect( center ).toHaveBeenCalledWith( { lat: 52.52, lng: 13.4 } );
			next( root );
			expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n1' );
		} finally {
			Reflect.deleteProperty( navigator, 'geolocation' );
		}
	} );

	it( 'offers no location button unless set', () => {
		const root = addressForm( false, 'maps-key' );
		expect( root.querySelector( '.ffx-address-locate' ) ).toBeNull();
	} );
} );

describe( 'text fields', () => {
	it( 'tell the browser what it may fill in', () => {
		const base = config();
		const doc = base.document as unknown as { nodes: Array<{ id: string; fields?: Array<{ id: string; props: Record<string, unknown> }> }>; start: string };
		const step = doc.nodes.find( ( n ) => n.id === 'n2' );
		const city = step?.fields?.find( ( f ) => f.id === 'q3' );
		if ( ! city ) {
			throw new Error( 'no q3' );
		}
		city.props.autocomplete = 'address-level2';
		doc.start = 'n2';
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		expect( $<HTMLInputElement>( root, '.ffx-field-text input' ).getAttribute( 'autocomplete' ) ).toBe( 'address-level2' );
	} );
} );

describe( 'incomplete entries', () => {
	it( 'saves the answers after every step and submits with the draft key', async () => {
		const base = config();
		base.document.settings.savePartialEntries = true;
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/', query: '', title: 'Seite' } );

		reply( '/partials', 200, { ok: true, draft: 'd'.repeat( 32 ) } );
		reply( '/partials', 200, { ok: true, draft: 'd'.repeat( 32 ) } );
		await toContact( root );
		await vi.advanceTimersByTimeAsync( 0 );
		const saves = requests.filter( ( r ) => r.path === '/partials' );
		expect( saves.map( ( r ) => r.body.answers ) ).toEqual( [ { q1: [ 'o1' ] }, { q1: [ 'o1' ], q2: 50, q3: 'Berlin' }, { q1: [ 'o1' ], q2: 50, q3: 'Berlin' } ] );
		expect( saves[ 0 ]?.body.draft ).toBe( '' );
		expect( saves[ 1 ]?.body.draft ).toBe( 'd'.repeat( 32 ) );

		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: null, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.draft ).toBe( 'd'.repeat( 32 ) );
	} );
} );

describe( 'tracking code', () => {
	it( 'runs the code of a step once and the after-submit code after the submit', async () => {
		const base = config();
		const nodes = base.document.nodes as Array<{ id: string; tracking?: Record<string, string> }>;
		( nodes.find( ( n ) => n.id === 'n2' ) as { tracking?: Record<string, string> } ).tracking = { onShow: '<script>window.ffxSeen = ( window.ffxSeen || 0 ) + 1;</script><img src="data:," alt="">' };
		( nodes.find( ( n ) => n.id === 'n4' ) as { tracking?: Record<string, string> } ).tracking = { afterSubmit: 'window.ffxLead = true;' };
		const win = window as unknown as Record<string, unknown>;
		delete win.ffxSeen;
		delete win.ffxLead;
		window.wp_has_consent = ( category ) => category === 'marketing';
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );

		clickOption( root, 'Immobilie' );
		expect( win.ffxSeen ).toBe( 1 );
		expect( root.querySelector( '.ffx-tracking img' ) ).not.toBeNull();
		$( root, '.ffx-button-back' ).click();
		clickOption( root, 'Immobilie' );
		expect( win.ffxSeen ).toBe( 1 );

		reply( '/calculations', 200, { ok: true, calculations: {} } );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		next( root );
		await vi.advanceTimersByTimeAsync( 0 );
		$( root, '.ffx-content-button' ).click();
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		expect( win.ffxLead ).toBeUndefined();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: null, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( win.ffxLead ).toBe( true );
	} );

	it( 'runs the code only where marketing is allowed', () => {
		const base = config();
		const step = ( base.document.nodes as Array<{ id: string; tracking?: Record<string, string> }> ).find( ( n ) => n.id === 'n2' ) as { tracking?: Record<string, string> };
		step.tracking = { onShow: 'window.ffxSeen = ( window.ffxSeen || 0 ) + 1;' };
		const win = window as unknown as Record<string, unknown>;
		const show = ( privacy?: 'eu' | 'global' ): unknown => {
			delete win.ffxSeen;
			const root = document.createElement( 'div' );
			document.body.append( root );
			new FormApp( root, { ...base, privacy }, { url: '', query: '', title: '' } );
			clickOption( root, 'Immobilie' );
			return win.ffxSeen;
		};
		// EU mode (default): only with the consent tool's yes.
		expect( show() ).toBeUndefined();
		window.wp_has_consent = () => false;
		expect( show( 'global' ) ).toBeUndefined();
		// Global mode: without a consent tool it runs, with Global Privacy Control it does not.
		delete window.wp_has_consent;
		expect( show( 'global' ) ).toBe( 1 );
		vi.stubGlobal( 'navigator', { ...navigator, globalPrivacyControl: true } );
		expect( show( 'global' ) ).toBeUndefined();
	} );

	it( 'runs scripts in content steps the plugin sends', async () => {
		const base = config();
		const content = ( base.document.nodes as Array<{ id: string; fields?: Array<{ props: Record<string, unknown> }> }> ).find( ( n ) => n.id === 'n3' );
		( content?.fields?.[ 0 ] as { props: Record<string, unknown> } ).props.html = de( '<p>Kalender</p><script>window.ffxWidget = ( window.ffxWidget || 0 ) + 1;</script>' );
		const win = window as unknown as Record<string, unknown>;
		delete win.ffxWidget;
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		clickOption( root, 'Immobilie' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		next( root );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-content' ).textContent ).toContain( 'Kalender' );
		expect( win.ffxWidget ).toBe( 1 );
	} );
} );

describe( 'password-protected forms', () => {
	it( 'asks for the password and sends the key with every request', async () => {
		const locked = { uid: 'f1', endpoint: config().endpoint, locale: 'de_DE', strings: { ...config().strings, unlock: 'Öffnen', wrong_password: 'Falsches Passwort' }, locked: true };
		document.body.innerHTML = `<div class="ffx-form" data-ffx-form="f1"><script type="application/json" class="ffx-form-data">${ JSON.stringify( locked ) }</script></div>`;
		mountAll();
		const root = document.querySelector<HTMLElement>( '.ffx-form' ) as HTMLElement;
		expect( root.querySelector( '.ffx-question' )?.firstChild?.textContent ).not.toBe( 'Wofür?' );
		const input = $<HTMLInputElement>( root, '.ffx-lock input[type=password]' );

		reply( '/unlock', 403, { ok: false, code: 'wrong_password' } );
		input.value = 'falsch';
		$( root, '.ffx-lock button' ).click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-lock .ffx-error' ).textContent ).toBe( 'Falsches Passwort' );

		reply( '/unlock', 200, { ok: true, config: { ...config(), unlock: 'k1' } } );
		input.value = 'geheim';
		$( root, '.ffx-lock button' ).click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.filter( ( r ) => r.path === '/unlock' ).map( ( r ) => r.body.password ) ).toEqual( [ 'falsch', 'geheim' ] );
		expect( root.querySelector( '.ffx-question' )?.firstChild?.textContent ).toBe( 'Wofür?' );

		await toContact( root );
		expect( requests.filter( ( r ) => r.path !== '/unlock' ).map( ( r ) => r.body.unlock ) ).toEqual( [ 'k1', 'k1' ] );
	} );

	it( 'sends the key of a logged-in member along with the password', async () => {
		const locked = { uid: 'f1', endpoint: config().endpoint, locale: 'de_DE', strings: config().strings, locked: true, unlock: 'member' };
		document.body.innerHTML = `<div class="ffx-form" data-ffx-form="f1"><script type="application/json" class="ffx-form-data">${ JSON.stringify( locked ) }</script></div>`;
		mountAll();
		const root = document.querySelector<HTMLElement>( '.ffx-form' ) as HTMLElement;
		reply( '/unlock', 200, { ok: true, config: { ...config(), unlock: 'k2' } } );
		$<HTMLInputElement>( root, '.ffx-lock input[type=password]' ).value = 'geheim';
		$( root, '.ffx-lock button' ).click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.find( ( r ) => r.path === '/unlock' )?.body ).toEqual( { password: 'geheim', unlock: 'member' } );
	} );

	it( 'says when the form closed in the meantime', async () => {
		const root = mount();
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 403, { ok: false, code: 'form_closed' } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( $( root, '.ffx-form-error' ).textContent ).toBe( 'form_closed' );
	} );
} );

describe( 'form statistics', () => {
	const events = (): Array<{ sid: unknown; events: unknown }> => requests.filter( ( r ) => r.path === '/events' ).map( ( r ) => ( { sid: r.body.sid, events: r.body.events } ) );

	it( 'reports the view, the start, each step and the answers of choices once per page view', async () => {
		// The form is on screen at once.
		vi.stubGlobal( 'IntersectionObserver', class {
			constructor( private readonly callback: ( entries: Array<{ isIntersecting: boolean }> ) => void ) {}
			observe(): void {
				this.callback( [ { isIntersecting: true } ] );
			}
			disconnect(): void {}
		} );
		reply( '/events', 200, { ok: true } );
		reply( '/events', 200, { ok: true } );
		const root = mount();
		await vi.advanceTimersByTimeAsync( 1500 );
		const sid = events()[ 0 ]?.sid;
		expect( sid ).toMatch( /^[0-9a-f]{32}$/ );
		// The first step has no node before it.
		expect( events() ).toEqual( [ { sid, events: [ { event: 'view', step: '' }, { event: 'step', step: 'n1', variant: '' } ] } ] );

		root.dispatchEvent( new Event( 'focusin' ) );
		clickOption( root, 'Immobilie' );
		$( root, '.ffx-button-back' ).click();
		clickOption( root, 'Immobilie' );
		await vi.advanceTimersByTimeAsync( 1500 );
		// The answer goes with it as option id, once: going back and choosing again counts nothing more.
		// The step names the node it came from.
		expect( events()[ 1 ] ).toEqual( { sid, events: [ { event: 'start', step: '' }, { event: 'answer', step: 'q1', variant: 'o1' }, { event: 'step', step: 'n2', variant: 'n1' } ] } );
		expect( events() ).toHaveLength( 2 );
	} );

	it( 'counts each way between nodes, ends reached from a question and fields whose check stops the visitor', async () => {
		reply( '/events', 200, { ok: true } );
		const root = mount();
		clickOption( root, 'Immobilie' );
		// Next with the place missing: the field stops the visitor, counted once per page view.
		next( root );
		next( root );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		reply( '/calculations', 200, { ok: true, calculations: {} } );
		next( root );
		await vi.advanceTimersByTimeAsync( 0 );
		$( root, '.ffx-content-button' ).click();
		// Sending without the required contact fields.
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 1500 );
		const sent = requests.filter( ( r ) => r.path === '/events' ).flatMap( ( r ) => r.body.events as unknown[] );
		expect( sent.filter( ( e ) => ( e as { event: string } ).event === 'step' ) ).toEqual( [
			{ event: 'step', step: 'n1', variant: '' },
			{ event: 'step', step: 'n2', variant: 'n1' },
			{ event: 'step', step: 'n3', variant: 'n2' },
			{ event: 'step', step: 'n4', variant: 'n3' },
		] );
		expect( sent.filter( ( e ) => ( e as { event: string } ).event === 'invalid' ) ).toEqual( [
			{ event: 'invalid', step: 'q3' },
			{ event: 'invalid', step: 'c_name' },
			{ event: 'invalid', step: 'c_mail' },
			{ event: 'invalid', step: 'c_ok' },
		] );
		// Without the extended level: no input per field, no consent flag.
		expect( sent.some( ( e ) => ( e as { event: string } ).event === 'field' ) ).toBe( false );
		expect( requests.find( ( r ) => r.path === '/events' )?.body.consent ).toBeUndefined();

		vi.stubGlobal( 'open', vi.fn() );
		requests = [];
		reply( '/events', 200, { ok: true } );
		const other = mount();
		clickOption( other, 'Grünes Auto' );
		await vi.advanceTimersByTimeAsync( 1500 );
		expect( requests.find( ( r ) => r.path === '/events' )?.body.events ).toContainEqual( { event: 'step', step: 'eq', variant: 'n1' } );
	} );

	const hide = (): void => {
		Object.defineProperty( document, 'visibilityState', { value: 'hidden', configurable: true } );
		document.dispatchEvent( new Event( 'visibilitychange' ) );
		Object.defineProperty( document, 'visibilityState', { value: 'visible', configurable: true } );
	};

	it( 'sends what is left when the page is hidden, and nothing from previews', async () => {
		// Forms of earlier tests send what they still hold.
		hide();
		requests = [];
		const root = mount();
		document.dispatchEvent( new Event( 'visibilitychange' ) );
		expect( events() ).toHaveLength( 0 );
		hide();
		expect( events() ).toHaveLength( 1 );
		const call = ( fetch as unknown as { mock: { calls: Array<[ string, RequestInit ]> } } ).mock.calls.find( ( c ) => c[ 0 ].endsWith( '/events' ) );
		expect( call?.[ 1 ].keepalive ).toBe( true );
		root.remove();

		const preview = document.createElement( 'div' );
		preview.setAttribute( 'inert', '' );
		document.body.append( preview );
		const form = document.createElement( 'div' );
		preview.append( form );
		new FormApp( form, config(), { url: 'https://example.org/', query: '', title: '' } );
		form.dispatchEvent( new Event( 'focusin' ) );
		await vi.advanceTimersByTimeAsync( 3000 );
		expect( events() ).toHaveLength( 1 );
	} );
} );

describe( 'extended statistics', () => {
	const sent = (): Array<Record<string, unknown>> => requests.filter( ( r ) => r.path === '/events' ).map( ( r ) => r.body );

	function mountWith( privacy?: 'eu' | 'global' ): HTMLElement {
		const base = config();
		base.privacy = privacy;
		const root = document.createElement( 'div' );
		root.className = 'ffx-form';
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		return root;
	}

	beforeEach( () => {
		// The form is on screen at once.
		vi.stubGlobal( 'IntersectionObserver', class {
			constructor( private readonly callback: ( entries: Array<{ isIntersecting: boolean }> ) => void ) {}
			observe(): void {
				this.callback( [ { isIntersecting: true } ] );
			}
			disconnect(): void {}
		} );
	} );

	afterEach( () => {
		localStorage.clear();
	} );

	it( 'reports device, visitor and the first input per field when statistics are allowed', async () => {
		vi.stubGlobal( 'innerWidth', 390 );
		window.wp_has_consent = ( category ) => category === 'statistics';
		const shown = Date.now();
		const root = mountWith( 'eu' );
		clickOption( root, 'Immobilie' );
		// The slider sets its start value while it is drawn: no input of the visitor.
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Ber' );
		type( $<HTMLInputElement>( root, '.ffx-field-text input' ), 'Berlin' );
		await vi.advanceTimersByTimeAsync( 1500 );
		const body = sent()[ 0 ] as { sid: string; events: unknown[]; consent: string };
		expect( body.consent ).toBe( 'statistics' );
		expect( body.events.slice( 0, 3 ) ).toEqual( [
			{ event: 'device', step: 'mobile' },
			{ event: 'visitor', step: body.sid, variant: 'new' },
			{ event: 'view', step: '' },
		] );
		expect( body.events.filter( ( e ) => ( e as { event: string } ).event === 'field' ) ).toEqual( [ { event: 'field', step: 'q1' }, { event: 'field', step: 'q3' } ] );
		// The new id is kept for 180 days from now, and only then.
		const [ id, until ] = ( localStorage.getItem( 'ffx_vid' ) ?? '' ).split( '.' );
		expect( id ).toBe( body.sid );
		expect( Number( until ) ).toBe( shown + 180 * 864e5 );
	} );

	it( 'recognises a returning visitor, and a form next to it on the page still as new', async () => {
		const known = 'a1'.repeat( 16 );
		localStorage.setItem( 'ffx_vid', `${ known }.${ Date.now() + 1000 }` );
		mountWith( 'global' );
		await vi.advanceTimersByTimeAsync( 1500 );
		expect( sent()[ 0 ]?.events ).toContainEqual( { event: 'visitor', step: known, variant: 'return' } );
		expect( sent()[ 0 ]?.events ).toContainEqual( { event: 'device', step: 'desktop' } );

		// An expired id is deleted and a new one made.
		localStorage.setItem( 'ffx_vid', `${ known }.${ Date.now() - 1 }` );
		requests = [];
		mountWith( 'global' );
		await vi.advanceTimersByTimeAsync( 1500 );
		const body = sent()[ 0 ] as { sid: string; events: unknown[] };
		expect( body.events ).toContainEqual( { event: 'visitor', step: body.sid, variant: 'new' } );
		requests = [];
		mountWith( 'global' );
		await vi.advanceTimersByTimeAsync( 1500 );
		expect( sent()[ 0 ]?.events ).toContainEqual( { event: 'visitor', step: body.sid, variant: 'new' } );
	} );

	it( 'keeps to the basic level without a yes in the EU mode or with Global Privacy Control, and deletes the id', async () => {
		for ( const run of [ () => mountWith( 'eu' ), () => ( vi.stubGlobal( 'navigator', { ...navigator, globalPrivacyControl: true } ), mountWith( 'global' ) ) ] ) {
			localStorage.setItem( 'ffx_vid', `${ 'b2'.repeat( 16 ) }.${ Date.now() + 1000 }` );
			requests = [];
			const root = run();
			expect( localStorage.getItem( 'ffx_vid' ) ).toBeNull();
			clickOption( root, 'Immobilie' );
			await vi.advanceTimersByTimeAsync( 1500 );
			const events = sent().flatMap( ( b ) => b.events as Array<{ event: string }> );
			expect( events.map( ( e ) => e.event ) ).not.toContain( 'device' );
			expect( events.map( ( e ) => e.event ) ).not.toContain( 'visitor' );
			expect( events.map( ( e ) => e.event ) ).not.toContain( 'field' );
			expect( sent().every( ( b ) => b.consent === undefined ) ).toBe( true );
			expect( localStorage.getItem( 'ffx_vid' ) ).toBeNull();
		}
	} );

	it( 'counts nothing and stores nothing in previews', async () => {
		window.wp_has_consent = () => true;
		const base = config();
		base.preview = true;
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		await vi.advanceTimersByTimeAsync( 1500 );
		expect( sent() ).toEqual( [] );
		expect( localStorage.getItem( 'ffx_vid' ) ).toBeNull();
	} );
} );

describe( 'popups', () => {
	const markup = ( attrs: string ): string => `<div class="ffx-form" data-ffx-form="f1" hidden ${ attrs }><script type="application/json" class="ffx-form-data">${ JSON.stringify( config() ) }</script></div>`;

	it( 'opens after the delay and starts fresh after closing', async () => {
		document.body.innerHTML = markup( 'data-ffx-popup="delay" data-ffx-popup-delay="2000" data-ffx-popup-close="Schließen"' );
		expect( mountAll() ).toHaveLength( 0 );
		expect( document.querySelector( '.ffx-popup' ) ).toBeNull();
		await vi.advanceTimersByTimeAsync( 2000 );
		const popup = document.querySelector( 'dialog.ffx-popup' ) as HTMLDialogElement;
		expect( popup.querySelector( '.ffx-question' )?.firstChild?.textContent ).toBe( 'Wofür?' );
		expect( popup.querySelector( '.ffx-popup-close' )?.getAttribute( 'aria-label' ) ).toBe( 'Schließen' );
		( popup.querySelector( '.ffx-popup-close' ) as HTMLButtonElement ).click();
		expect( document.querySelector( '.ffx-popup' ) ).toBeNull();
		expect( mountAll() ).toHaveLength( 0 );
	} );

	it( 'opens on a click on the given class, once at a time', () => {
		document.body.innerHTML = markup( 'data-ffx-popup="click" data-ffx-popup-click="open-offer"' ) + '<a href="#" class="open-offer"><span>Angebot</span></a>';
		mountAll();
		const link = document.querySelector( '.open-offer span' ) as HTMLElement;
		link.click();
		link.click();
		expect( document.querySelectorAll( 'dialog.ffx-popup' ) ).toHaveLength( 1 );
		clickOption( document.querySelector( '.ffx-popup' ) as HTMLElement, 'Immobilie' );
		expect( document.querySelector( '.ffx-popup .ffx-question' )?.firstChild?.textContent ).toBe( 'Budget' );
		const popup = document.querySelector( 'dialog.ffx-popup' ) as HTMLDialogElement;
		popup.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		expect( document.querySelector( '.ffx-popup' ) ).toBeNull();
		link.click();
		expect( document.querySelector( '.ffx-popup .ffx-question' )?.firstChild?.textContent ).toBe( 'Wofür?' );
	} );

	const scrollTo = ( y: number ): void => {
		Object.defineProperty( window, 'scrollY', { value: y, configurable: true } );
		window.dispatchEvent( new Event( 'scroll' ) );
	};

	afterEach( () => {
		window.localStorage.clear();
		Reflect.deleteProperty( document.documentElement, 'scrollHeight' );
		scrollTo( 0 );
	} );

	it( 'opens after the visitor scrolled the share of the page and then pauses for the hours set', async () => {
		Object.defineProperty( document.documentElement, 'scrollHeight', { value: window.innerHeight + 1000, configurable: true } );
		document.body.innerHTML = markup( 'data-ffx-popup="scroll" data-ffx-popup-scroll="60" data-ffx-popup-pause="24"' );
		mountAll();
		await vi.advanceTimersByTimeAsync( 1500 );
		scrollTo( 400 );
		expect( document.querySelector( 'dialog.ffx-popup' ) ).toBeNull();
		scrollTo( 600 );
		const popup = document.querySelector( 'dialog.ffx-popup' ) as HTMLDialogElement;
		expect( popup ).not.toBeNull();
		scrollTo( 900 );
		expect( document.querySelectorAll( 'dialog.ffx-popup' ) ).toHaveLength( 1 );
		( popup.querySelector( '.ffx-popup-close' ) as HTMLButtonElement ).click();
		expect( Number( window.localStorage.getItem( 'ffx-popup-f1' ) ) - Date.now() ).toBe( 24 * 3600 * 1000 );

		document.body.innerHTML = markup( 'data-ffx-popup="scroll" data-ffx-popup-scroll="60" data-ffx-popup-pause="24"' );
		mountAll();
		scrollTo( 1000 );
		expect( document.querySelector( 'dialog.ffx-popup' ) ).toBeNull();
		document.body.innerHTML = markup( 'data-ffx-popup="click" data-ffx-popup-click="open-offer"' ) + '<button class="open-offer">Angebot</button>';
		mountAll();
		( document.querySelector( '.open-offer' ) as HTMLElement ).click();
		expect( document.querySelector( 'dialog.ffx-popup' ) ).not.toBeNull();
	} );

	it( 'opens on exit intent once armed, and stays closed for 30 days after an entry', async () => {
		document.body.innerHTML = markup( 'data-ffx-popup="exit"' );
		mountAll();
		const leave = (): void => {
			document.dispatchEvent( new MouseEvent( 'mouseout', { clientY: -2, relatedTarget: null } ) );
		};
		leave();
		expect( document.querySelector( 'dialog.ffx-popup' ) ).toBeNull();
		await vi.advanceTimersByTimeAsync( 3000 );
		document.dispatchEvent( new MouseEvent( 'mouseout', { clientY: 200, relatedTarget: null } ) );
		expect( document.querySelector( 'dialog.ffx-popup' ) ).toBeNull();
		leave();
		const popup = document.querySelector( 'dialog.ffx-popup' ) as HTMLDialogElement;
		expect( popup ).not.toBeNull();
		( popup.querySelector( '.ffx-form' ) as HTMLElement ).dispatchEvent( new CustomEvent( 'ffx:sent', { bubbles: true } ) );
		( popup.querySelector( '.ffx-popup-close' ) as HTMLButtonElement ).click();
		expect( Number( window.localStorage.getItem( 'ffx-popup-f1' ) ) - Date.now() ).toBe( 30 * 24 * 3600 * 1000 );
		leave();
		expect( document.querySelector( 'dialog.ffx-popup' ) ).toBeNull();
	} );

	it( 'shows a button in a corner that opens the form', () => {
		document.body.innerHTML = markup( 'data-ffx-popup="widget" data-ffx-widget="top-left" data-ffx-widget-text="Angebot anfragen" data-ffx-widget-color="#ff6600" data-ffx-widget-animation="pulse" style="--ffx-color-primary:#123456"' );
		mountAll();
		const button = document.querySelector( 'body > button.ffx-widget' ) as HTMLButtonElement;
		expect( button.className ).toBe( 'ffx-widget ffx-widget-top-left ffx-widget-pulse' );
		expect( button.textContent ).toBe( 'Angebot anfragen' );
		expect( button.style.getPropertyValue( '--ffx-widget-color' ) ).toBe( '#ff6600' );
		expect( button.style.getPropertyValue( '--ffx-color-primary' ) ).toBe( '#123456' );
		button.click();
		const form = document.querySelector( 'dialog.ffx-popup .ffx-form' ) as HTMLElement;
		expect( form.querySelector( '.ffx-question' )?.firstChild?.textContent ).toBe( 'Wofür?' );
		expect( [ ...form.attributes ].some( ( a ) => a.name.startsWith( 'data-ffx-widget' ) ) ).toBe( false );
		mountAll();
		expect( document.querySelectorAll( 'button.ffx-widget' ) ).toHaveLength( 1 );
	} );

	it( 'shows the message of a closed form and does not nest popups when mounted again', () => {
		document.body.innerHTML = '<div class="ffx-form ffx-closed" data-ffx-form="f1" hidden data-ffx-popup="click" data-ffx-popup-click="open-offer"><div class="ffx-closed-message">Geschlossen</div></div><button class="open-offer">Angebot</button>';
		mountAll();
		( document.querySelector( '.open-offer' ) as HTMLElement ).click();
		const form = document.querySelector( 'dialog.ffx-popup .ffx-form' ) as HTMLElement;
		expect( form.textContent ).toBe( 'Geschlossen' );
		expect( form.hasAttribute( 'data-ffx-popup' ) ).toBe( false );
		mountAll();
		( document.querySelector( '.open-offer' ) as HTMLElement ).click();
		expect( document.querySelectorAll( 'dialog.ffx-popup' ) ).toHaveLength( 1 );
	} );
} );

describe( 'embed code of 3.x on other websites', () => {
	it( 'starts the forms once the 3.x loader reports them loaded', () => {
		document.body.innerHTML = '<div class="af2_external_form" data-form-id="7"></div>';
		mountAll();
		// The loader sets the shortcode's HTML, then dispatches its event on the body.
		( document.querySelector( '.af2_external_form' ) as HTMLElement ).innerHTML = `<div class="ffx-form" data-ffx-form="f1"><script type="application/json" class="ffx-form-data">${ JSON.stringify( config() ) }</script></div>`;
		document.body.dispatchEvent( new CustomEvent( 'af2_all_forms_loaded' ) );
		expect( document.querySelector( '.ffx-form' )?.classList.contains( 'ffx-ready' ) ).toBe( true );
		expect( document.querySelector( '.ffx-question' )?.firstChild?.textContent ).toBe( 'Wofür?' );
	} );
} );

describe( 'payments', () => {
	const strings = { payment_redirect: 'Weiter zur Zahlung', payment_open: 'Nicht bezahlt', payment_failed: 'Fehlgeschlagen', payment_refunded: 'Erstattet', payment_retry: 'Jetzt bezahlen', payment_unavailable: 'Zahlung nicht möglich' };

	function navigation(): ReturnType<typeof vi.fn> {
		const assign = vi.fn();
		vi.stubGlobal( 'location', { href: 'https://example.org/seite/', origin: 'https://example.org', search: '', assign, reload: vi.fn() } );
		return assign;
	}

	it( 'goes on to the payment page after the submit', async () => {
		const assign = navigation();
		const root = document.createElement( 'div' );
		document.body.append( root );
		const base = config();
		Object.assign( base.strings, strings );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, eventId: 'e9', end: { success: { show: true, html: '<p>Danke!</p>', image: null }, redirect: null }, payment: { url: 'https://checkout.stripe.com/c/pay/cs_test_1', param: '9-abc' } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( assign ).toHaveBeenCalledWith( 'https://checkout.stripe.com/c/pay/cs_test_1' );
		expect( $( root, '.ffx-payment-text' ).textContent ).toBe( 'Weiter zur Zahlung' );
		expect( root.querySelector( '.ffx-success' ) ).toBeNull();
	} );

	it( 'shows the end once paid, and another attempt otherwise', async () => {
		const assign = navigation();
		const paid = config();
		paid.payment = { param: '9-abc', status: 'paid', end: { success: { show: true, html: '<p>Danke!</p>', image: null }, redirect: null } };
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, paid, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		expect( $( root, '.ffx-success' ).textContent ).toBe( 'Danke!' );
		expect( window.dataLayer ).toContainEqual( { event: 'ffxPayment', status: 'paid' } );

		const open = config();
		Object.assign( open.strings, strings );
		open.payment = { param: '9-abc', status: 'canceled', end: null };
		const again = document.createElement( 'div' );
		document.body.append( again );
		new FormApp( again, open, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		expect( $( again, '.ffx-payment-text' ).textContent ).toBe( 'Nicht bezahlt' );
		expect( $( again, '.ffx-nav' ).hidden ).toBe( true );
		expect( again.querySelector( '[data-node]' ) ).toBeNull();
		reply( '/payments/retry', 200, { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_2', status: 'canceled' } );
		$( again, '.ffx-payment-retry' ).click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.find( ( r ) => r.path === '/payments/retry' )?.body ).toEqual( { payment: '9-abc' } );
		expect( assign ).toHaveBeenCalledWith( 'https://checkout.stripe.com/c/pay/cs_test_2' );
	} );
} );


describe( 'quiz feedback', () => {
	function quizForm( feedback: boolean ): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: Array<{ id: string; fields?: Array<{ options?: Array<Record<string, unknown>> }> }>; edges: Array<{ id: string }>; settings: Record<string, unknown> };
		// Both answers lead on to the next question.
		doc.edges = doc.edges.filter( ( e ) => e.id !== 'x1' );
		const right = doc.nodes[ 0 ]?.fields?.[ 0 ]?.options?.[ 0 ];
		if ( right ) {
			right.correct = true;
		}
		if ( feedback ) {
			doc.settings.quiz = { feedback: true };
		}
		base.strings.quizRight = 'Richtig!';
		base.strings.quizWrong = 'Leider nicht. Richtig ist: %s';
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	it( 'shows whether the answer was right and moves on with Next', () => {
		const root = quizForm( true );
		// A single choice moves on alone; with feedback the step stays until Next.
		clickOption( root, 'Grünes Auto' );
		expect( $( root, '.ffx-step' ).dataset.node ).toBe( 'n1' );
		expect( $( root, '.ffx-quiz-feedback' ).textContent ).toBe( 'Leider nicht. Richtig ist: Immobilie' );
		expect( $( root, '.ffx-quiz-feedback' ).className ).toContain( 'is-wrong' );
		expect( $( root, '[data-option="o1"]' ).className ).toContain( 'is-right' );
		expect( $( root, '[data-option="o2"]' ).className ).toContain( 'is-wrong' );
		expect( [ ...root.querySelectorAll<HTMLButtonElement>( '.ffx-option' ) ].every( ( b ) => b.disabled ) ).toBe( true );
		const next = $<HTMLButtonElement>( root, '.ffx-button-next' );
		expect( next.hidden ).toBe( false );
		expect( document.activeElement ).toBe( next );

		next.click();
		expect( $( root, '.ffx-step' ).dataset.node ).toBe( 'n2' );
		expect( root.querySelector( '.ffx-quiz-feedback' ) ).toBeNull();

		// Back on the question it can be answered again, and a right answer says so.
		const again = quizForm( true );
		clickOption( again, 'Immobilie' );
		expect( $( again, '.ffx-quiz-feedback' ).textContent ).toBe( 'Richtig!' );
		$<HTMLButtonElement>( again, '.ffx-button-next' ).click();
		expect( $( again, '.ffx-step' ).dataset.node ).toBe( 'n2' );
	} );

	it( 'goes straight on without feedback', () => {
		const root = quizForm( false );
		clickOption( root, 'Immobilie' );
		expect( $( root, '.ffx-step' ).dataset.node ).toBe( 'n2' );
		expect( root.querySelector( '.ffx-quiz-feedback' ) ).toBeNull();
	} );
} );

describe( 'answers', () => {
	/** The form with the first question replaced. */
	function withQuestion( field: Record<string, unknown> ): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: Array<{ fields?: Array<Record<string, unknown>> }>; edges: Array<{ id: string }> };
		doc.edges = doc.edges.filter( ( e ) => e.id !== 'x1' );
		const fields = doc.nodes[ 0 ]?.fields as Array<Record<string, unknown>>;
		fields[ 0 ] = { ...fields[ 0 ], ...field };
		Object.assign( base.strings, { too_few_choices: 'Mindestens %d', too_many_choices: 'Höchstens %d', search: 'Suchen', no_matches: 'Nichts gefunden', choose: 'Bitte wählen' } );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}
	const three = [
		{ id: 'o1', label: de( 'Rot' ), value: 'rot' },
		{ id: 'o2', label: de( 'Grün' ), value: 'gruen' },
		{ id: 'o3', label: de( 'Blau' ), value: 'blau' },
	];

	it( 'lays out the answers and keeps the number of choices within the limits', () => {
		const root = withQuestion( { options: three, props: { multiple: true, layout: { desktop: 'grid', mobile: 'grid' }, hideIcons: false, minChoices: 2, maxChoices: 2, columns: { desktop: 3, mobile: 1 }, iconPosition: 'left', size: 'l', imageFull: true } } );
		const list = $( root, '.ffx-options' );
		expect( list.className ).toBe( 'ffx-options ffx-desktop-grid ffx-mobile-grid ffx-columns ffx-columns-mobile ffx-icon-left ffx-size-l ffx-image-full' );
		expect( list.style.getPropertyValue( '--ffx-columns' ) ).toBe( '3' );
		expect( list.style.getPropertyValue( '--ffx-columns-mobile' ) ).toBe( '1' );

		const boxes = [ ...root.querySelectorAll<HTMLInputElement>( '.ffx-option input' ) ];
		boxes[ 0 ]?.click();
		next( root );
		expect( $( root, '.ffx-error' ).textContent ).toBe( 'Mindestens 2' );
		boxes[ 1 ]?.click();
		expect( boxes[ 2 ]?.disabled ).toBe( true );
		expect( boxes[ 2 ]?.closest( '.ffx-option' )?.classList.contains( 'is-disabled' ) ).toBe( true );
		boxes[ 0 ]?.click();
		expect( boxes[ 2 ]?.disabled ).toBe( false );
		boxes[ 2 ]?.click();
		next( root );
		expect( $( root, '.ffx-step' ).dataset.node ).toBe( 'n2' );
	} );

	it( 'searches the answers of a dropdown and picks several', () => {
		const root = withQuestion( { type: 'dropdown', options: three, props: { search: true, multiple: true, maxChoices: 2, placeholder: de( 'Farben wählen' ) } } );
		const toggle = $<HTMLButtonElement>( root, '.ffx-pick-toggle' );
		expect( toggle.textContent ).toBe( 'Farben wählen' );
		expect( $( root, 'label.ffx-question' ).getAttribute( 'for' ) ).toBe( toggle.id );
		// Named by the question and the choice, so screen readers say both.
		const name = ( toggle.getAttribute( 'aria-labelledby' ) ?? '' ).split( ' ' ).map( ( ref ) => document.getElementById( ref )?.textContent );
		expect( name ).toEqual( [ $( root, 'label.ffx-question' ).textContent, 'Farben wählen' ] );
		toggle.click();
		expect( toggle.getAttribute( 'aria-expanded' ) ).toBe( 'true' );
		const search = $<HTMLInputElement>( root, '.ffx-pick-search' );
		expect( document.activeElement ).toBe( search );
		type( search, 'gr' );
		const rows = [ ...root.querySelectorAll<HTMLElement>( '.ffx-pick-option' ) ];
		expect( rows.map( ( r ) => r.hidden ) ).toEqual( [ true, false, true ] );
		type( search, 'xyz' );
		expect( $( root, '.ffx-pick-empty' ).hidden ).toBe( false );
		type( search, '' );

		const boxes = rows.map( ( r ) => r.querySelector( 'input' ) as HTMLInputElement );
		boxes[ 2 ]?.click();
		boxes[ 0 ]?.click();
		expect( toggle.textContent ).toBe( 'Rot, Blau' );
		expect( boxes[ 1 ]?.disabled ).toBe( true );
		toggle.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		expect( $( root, '.ffx-pick-panel' ).hidden ).toBe( true );
		next( root );
		expect( $( root, '.ffx-step' ).dataset.node ).toBe( 'n2' );
	} );

	it( 'closes a searchable dropdown with one answer once it is picked', () => {
		const root = withQuestion( { type: 'dropdown', options: three, props: { search: true } } );
		const toggle = $<HTMLButtonElement>( root, '.ffx-pick-toggle' );
		expect( toggle.textContent ).toBe( 'Bitte wählen' );
		toggle.click();
		const radio = root.querySelectorAll<HTMLInputElement>( '.ffx-pick-option input' )[ 1 ] as HTMLInputElement;
		expect( radio.type ).toBe( 'radio' );
		radio.focus();
		radio.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ) );
		expect( toggle.textContent ).toBe( 'Grün' );
		expect( $( root, '.ffx-pick-panel' ).hidden ).toBe( true );
		expect( document.activeElement ).toBe( toggle );
	} );

	it( 'picks the first match of the search with Enter and goes into the list with the arrow', () => {
		const root = withQuestion( { type: 'dropdown', options: three, props: { search: true } } );
		const toggle = $<HTMLButtonElement>( root, '.ffx-pick-toggle' );
		toggle.click();
		const search = $<HTMLInputElement>( root, '.ffx-pick-search' );
		type( search, 'bl' );
		search.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowDown', bubbles: true } ) );
		expect( document.activeElement ).toBe( root.querySelectorAll( '.ffx-pick-option input' )[ 2 ] );
		search.focus();
		const enter = new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true, cancelable: true } );
		search.dispatchEvent( enter );
		expect( enter.defaultPrevented ).toBe( true );
		expect( toggle.textContent ).toBe( 'Blau' );
		expect( $( root, '.ffx-pick-panel' ).hidden ).toBe( true );
		expect( document.activeElement ).toBe( toggle );
	} );

	it( 'keeps Next on optional single choices and ratings, so visitors can skip them', () => {
		const choice = withQuestion( { required: false, options: three } );
		expect( $( choice, '.ffx-button-next' ).hidden ).toBe( false );
		next( choice );
		expect( $( choice, '.ffx-step' ).dataset.node ).toBe( 'n2' );
		document.body.innerHTML = '';
		const rating = withQuestion( { type: 'rating', required: false, props: { min: 1, max: 5, style: 'stars', lowLabel: {}, highLabel: {} } } );
		expect( $( rating, '.ffx-button-next' ).hidden ).toBe( false );
		// A pick still moves on by itself.
		rating.querySelectorAll<HTMLButtonElement>( '.ffx-rating-option' )[ 2 ]?.click();
		expect( $( rating, '.ffx-step' ).dataset.node ).toBe( 'n2' );
		document.body.innerHTML = '';
		expect( $( withQuestion( { type: 'rating', props: { min: 1, max: 5, style: 'stars', lowLabel: {}, highLabel: {} } } ), '.ffx-button-next' ).hidden ).toBe( true );
	} );

	it( 'checks the number of choices like the plugin', () => {
		const field = { id: 'q', type: 'dropdown', required: false, options: three, props: { multiple: true, minChoices: 2, maxChoices: 2 } } as unknown as Field;
		expect( checkStepField( field, [] ) ).toBeNull();
		expect( checkStepField( field, [ 'o1' ] ) ).toBe( 'too_few_choices' );
		expect( checkStepField( field, [ 'o1', 'o2' ] ) ).toBeNull();
		expect( checkStepField( field, [ 'o1', 'o2', 'o3' ] ) ).toBe( 'too_many_choices' );
	} );
} );

describe( 'dates and ranges', () => {
	function withQuestion( field: Record<string, unknown> ): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: Array<{ fields?: Array<Record<string, unknown>> }>; edges: Array<{ id: string }> };
		doc.edges = doc.edges.filter( ( e ) => e.id !== 'x1' );
		const fields = doc.nodes[ 0 ]?.fields as Array<Record<string, unknown>>;
		fields[ 0 ] = { id: 'q1', key: 'q1', label: de( 'Frage' ), description: de( '' ), required: true, ...field };
		Object.assign( base.strings, { date_from: 'Von', date_to: 'Bis', invalid_date: 'Datum ungültig', date_out_of_range: 'Nicht erlaubt', invalid_range: 'Ende vor Start' } );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}
	const change = ( input: HTMLInputElement, value: string ): void => {
		input.value = value;
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	};

	it( 'asks for a period within the limits', () => {
		const root = withQuestion( { type: 'date', props: { placeholder: de( '' ), format: 'dd.mm.yy', range: true, min: '2030-01-01', max: '2030-12-31' } } );
		const [ from, to ] = [ ...root.querySelectorAll<HTMLInputElement>( 'input[type="date"]' ) ] as [ HTMLInputElement, HTMLInputElement ];
		expect( [ from.min, from.max ] ).toEqual( [ '2030-01-01', '2030-12-31' ] );
		expect( root.querySelector( 'label[for="' + to.id + '"]' )?.textContent ).toBe( 'Bis' );
		change( to, '2030-03-01' );
		next( root );
		expect( $( root, '.ffx-error' ).textContent ).toBe( 'Datum ungültig' );
		change( from, '2030-03-10' );
		expect( to.min ).toBe( '2030-03-10' );
		next( root );
		expect( $( root, '.ffx-error' ).textContent ).toBe( 'Ende vor Start' );
		change( to, '2030-03-14' );
		next( root );
		expect( $( root, '.ffx-step' ).dataset.node ).toBe( 'n2' );
	} );

	it( 'checks dates like the plugin', () => {
		const future = { id: 'd', type: 'date', required: true, props: { format: 'dd.mm.yy', allow: 'future' } } as unknown as Field;
		expect( checkStepField( future, '01.01.2000' ) ).toBe( 'date_out_of_range' );
		expect( checkStepField( future, '01.01.2999' ) ).toBeNull();
		const past = { id: 'd', type: 'date', required: true, props: { format: 'yy-mm-dd', allow: 'past', min: '1900-01-01' } } as unknown as Field;
		expect( checkStepField( past, '2999-01-01' ) ).toBe( 'date_out_of_range' );
		expect( checkStepField( past, '1899-12-31' ) ).toBe( 'date_out_of_range' );
		expect( checkStepField( past, '1990-05-17' ) ).toBeNull();
		const period = { id: 'd', type: 'date', required: true, props: { format: 'dd.mm.yy', range: true } } as unknown as Field;
		expect( checkStepField( period, '01.02.2030' ) ).toBe( 'invalid_date' );
		expect( checkStepField( period, '01.02.2030 – 31.01.2030' ) ).toBe( 'invalid_range' );
		expect( checkStepField( period, '01.02.2030 – 01.02.2030' ) ).toBeNull();
	} );

	it( 'moves two handles that cannot pass each other and shows the range', () => {
		const root = withQuestion( { type: 'slider', props: { min: 0, max: 100000, step: 1000, start: 10000, startEnd: 50000, range: true, thousandsSeparator: true, separator: "'", unit: { text: de( '€' ), position: 'after' }, manualInput: { enabled: true, label: de( '' ) } } } );
		const [ low, high ] = [ ...root.querySelectorAll<HTMLInputElement>( '.ffx-range-handle' ) ] as [ HTMLInputElement, HTMLInputElement ];
		expect( $( root, '.ffx-slider-value' ).textContent ).toBe( "10'000 € – 50'000 €" );
		expect( [ low.getAttribute( 'aria-label' ), high.getAttribute( 'aria-label' ) ] ).toEqual( [ 'Von', 'Bis' ] );
		expect( $( root, '.ffx-range-fill' ).style.insetInlineStart ).toBe( '10%' );
		low.value = '70000';
		low.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		expect( low.value ).toBe( '50000' );
		const manual = [ ...root.querySelectorAll<HTMLInputElement>( '.ffx-slider-manual' ) ];
		type( manual[ 1 ] as HTMLInputElement, '80000' );
		expect( high.value ).toBe( '80000' );
		expect( $( root, '.ffx-slider-value' ).textContent ).toBe( "50'000 € – 80'000 €" );
		next( root );
		expect( $( root, '.ffx-step' ).dataset.node ).toBe( 'n2' );
	} );
} );

describe( 'scales', () => {
	function withScale( props: Record<string, unknown> ): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { nodes: Array<{ fields?: Array<Record<string, unknown>> }> };
		const fields = doc.nodes[ 0 ]?.fields as Array<Record<string, unknown>>;
		fields[ 0 ] = { id: 'q1', key: 'q1', type: 'rating', label: de( 'Wie zufrieden?' ), description: de( '' ), required: true, props: { min: 1, lowLabel: {}, highLabel: {}, ...props } };
		Object.assign( base.strings, { rating_value: '%1$s von %2$s' } );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}
	const options = ( root: HTMLElement ): HTMLButtonElement[] => [ ...root.querySelectorAll<HTMLButtonElement>( '.ffx-rating-option' ) ];

	it( 'colours the points from red to green and shows faces', () => {
		expect( [ 0, 1, 2, 3, 4 ].map( ( i ) => ratingFace( i, 5 ) ) ).toEqual( [ '😫', '🙁', '😐', '😀', '😍' ] );
		expect( ratingFace( 1, 3 ) ).toBe( '😐' );
		const root = withScale( { max: 5, style: 'colors', show: 'emojis' } );
		expect( $( root, '.ffx-rating' ).classList.contains( 'ffx-rating-colors' ) ).toBe( true );
		expect( options( root ).map( ( b ) => b.style.getPropertyValue( '--ffx-scale' ) ) ).toEqual( [ 'hsl(0 70% 50%)', 'hsl(30 70% 50%)', 'hsl(60 70% 50%)', 'hsl(90 70% 50%)', 'hsl(120 70% 50%)' ] );
		expect( options( root ).map( ( b ) => b.textContent ) ).toEqual( [ '😫', '🙁', '😐', '😀', '😍' ] );
		expect( options( root )[ 0 ]?.getAttribute( 'aria-label' ) ).toBe( '1 von 5' );
	} );

	it( 'shows own texts on the points or below the stars', () => {
		const labels = [ de( 'Schlecht' ), de( '' ), de( 'Gut' ) ];
		let root = withScale( { max: 3, style: 'numbers', show: 'labels', labels } );
		expect( options( root ).map( ( b ) => b.textContent ) ).toEqual( [ 'Schlecht', '2', 'Gut' ] );
		expect( options( root ).map( ( b ) => b.getAttribute( 'aria-label' ) ) ).toEqual( [ '1 von 3: Schlecht', '2 von 3', '3 von 3: Gut' ] );
		root.remove();

		root = withScale( { max: 3, style: 'stars', show: 'labels', labels } );
		expect( options( root ).map( ( b ) => b.textContent ) ).toEqual( [ '★', '★', '★' ] );
		options( root )[ 2 ]?.click();
		$( root, '.ffx-button-back' ).click();
		expect( $( root, '.ffx-rating-chosen' ).textContent ).toBe( 'Gut' );
	} );
} );

describe( 'contact step extras', () => {
	function contactForm(): HTMLElement {
		const base = config();
		const doc = base.document as unknown as { start: string; nodes: Array<{ id: string; layout?: unknown; fields?: unknown[] }> };
		doc.start = 'n4';
		const node = doc.nodes.find( ( n ) => n.id === 'n4' ) as { layout?: unknown; fields: unknown[] };
		node.layout = { columns: { desktop: 2, mobile: 2 }, hideLabels: true, inputHeight: 40, button: { size: 'l', align: 'right' } };
		node.fields.push(
			{ id: 'c_topic', key: 'topic', type: 'select', label: de( 'Thema' ), required: true, props: { placeholder: de( '' ), options: [ { id: 'o1', label: de( 'Küche' ) }, { id: 'o2', label: de( '<b>Bad</b>' ) } ] } },
			{ id: 'c_note', key: 'note', type: 'textarea', label: de( 'Nachricht' ), required: false, props: { placeholder: de( 'Ihre Nachricht' ), maxLength: 500 } },
			{ id: 'c_news', key: 'news', type: 'checkbox', label: de( '' ), required: false, props: { html: de( 'Newsletter' ) } }
		);
		Object.assign( base.strings, { required: 'Pflichtfeld' } );
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		return root;
	}

	it( 'lays out the step and asks for lists, long texts and boxes to tick', async () => {
		const root = contactForm();
		const form = $<HTMLFormElement>( root, 'form.ffx-contact' );
		expect( [ ...form.classList ] ).toEqual( [ 'ffx-contact', 'ffx-contact-columns', 'ffx-contact-columns-mobile', 'ffx-submit-l', 'ffx-submit-right' ] );
		expect( form.style.getPropertyValue( '--ffx-input-height' ) ).toBe( '40px' );
		const name = $<HTMLInputElement>( root, '.ffx-contact-name input' );
		expect( name.placeholder ).toBe( 'Name *' );
		expect( root.querySelector( `label[for="${ name.id }"]` )?.className ).toBe( 'ffx-label ffx-sr-only' );
		expect( root.querySelector( `label[for="${ name.id }"] .ffx-required[aria-hidden="true"]` )?.textContent, 'the red star' ).toBe( ' *' );

		const topic = $<HTMLSelectElement>( root, '.ffx-contact-select select' );
		expect( [ ...topic.options ].map( ( o ) => o.textContent ) ).toEqual( [ 'Thema *', 'Küche', 'Bad' ] );
		const note = $<HTMLTextAreaElement>( root, '.ffx-contact-textarea textarea' );
		expect( [ note.placeholder, note.maxLength ] ).toEqual( [ 'Ihre Nachricht', 500 ] );
		expect( $( root, '.ffx-contact-checkbox label' ).textContent ).toBe( 'Newsletter' );

		type( name, 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-contact-select .ffx-error' ).textContent ).toBe( 'Pflichtfeld' );
		expect( requests.some( ( r ) => r.path === '/entries' ) ).toBe( false );

		topic.value = 'o2';
		topic.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		note.value = 'Zwei\nZeilen';
		note.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		$<HTMLInputElement>( root, '.ffx-contact-checkbox input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: { show: true, html: '<p>Danke!</p>', image: null }, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.contact ).toMatchObject( { c_topic: 'o2', c_note: 'Zwei\nZeilen', c_news: true } );
	} );
} );

describe( 'time limit', () => {
	function timed( message?: string ): HTMLElement {
		const base = config();
		Object.assign( base.strings, { time_left: 'Noch %s', time_up: 'Die Zeit ist abgelaufen.', time_warning: 'Nur noch %s.', more_time: 'Mehr Zeit' } );
		base.document.settings.timeLimit = { minutes: 2, ...( message ? { message: de( message ) } : {} ) };
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: 'https://example.org/seite/', query: '', title: 'Seite' } );
		return root;
	}

	it( 'counts down from the start, keeps the start for new tokens and stops once sent', async () => {
		reply( '/token', 200, { ok: true, token: 't1', started: 's1', timeLeft: 90 } );
		reply( '/token', 200, { ok: true, token: 't2', started: 's1', timeLeft: 20 } );
		const root = timed();
		expect( $( root, '.ffx-timer-box' ).hidden ).toBe( true );
		root.dispatchEvent( new Event( 'pointerdown' ) );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-timer' ).textContent ).toBe( 'Noch 1:30' );
		expect( $( root, '.ffx-timer' ).getAttribute( 'role' ) ).toBe( 'timer' );
		await vi.advanceTimersByTimeAsync( 30000 );
		expect( $( root, '.ffx-timer' ).textContent ).toBe( 'Noch 1:00' );
		expect( $( root, '.ffx-timer' ).classList.contains( 'ffx-timer-low' ) ).toBe( true );

		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		// The first token is turned down; the second keeps the start of the visit.
		reply( '/entries', 429, { ok: false, code: 'too_fast' } );
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: { show: true, html: '<p>Danke</p>', image: null }, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		for ( let i = 0; i < 100 && ! root.querySelector( '.ffx-success' ); i++ ) {
			await vi.advanceTimersByTimeAsync( 50 );
		}
		expect( requests.filter( ( r ) => r.path === '/token' ).map( ( r ) => r.body ) ).toEqual( [ {}, { started: 's1' } ] );
		expect( requests.filter( ( r ) => r.path === '/entries' ).map( ( r ) => [ r.body.token, r.body.started ] ) ).toEqual( [ [ 't1', 's1' ], [ 't2', 's1' ] ] );
		// Once sent, the clock is gone and nothing ends the form any more.
		expect( $( root, '.ffx-timer-box' ).hidden ).toBe( true );
		await vi.advanceTimersByTimeAsync( 120000 );
		expect( root.querySelector( '.ffx-time-up' ) ).toBeNull();
	} );

	it( 'warns 20 seconds before the end and starts the time again on request', async () => {
		reply( '/token', 200, { ok: true, token: 't1', started: 's1', timeLeft: 25 } );
		reply( '/token', 200, { ok: true, token: 't2', started: 's2', timeLeft: 120 } );
		const root = timed();
		root.dispatchEvent( new Event( 'pointerdown' ) );
		await vi.advanceTimersByTimeAsync( 0 );
		const warning = $( root, '.ffx-timer-warning' );
		expect( warning.hidden ).toBe( true );
		await vi.advanceTimersByTimeAsync( 5000 );
		expect( warning.hidden ).toBe( false );
		expect( warning.getAttribute( 'role' ) ).toBe( 'alert' );
		expect( warning.textContent ).toBe( 'Nur noch 0:20.Mehr Zeit' );
		// The text stays as it was, so it is read out once and not every second.
		await vi.advanceTimersByTimeAsync( 3000 );
		expect( warning.textContent ).toBe( 'Nur noch 0:20.Mehr Zeit' );
		$( warning, 'button' ).click();
		await vi.advanceTimersByTimeAsync( 0 );
		expect( requests.filter( ( r ) => r.path === '/token' ).map( ( r ) => r.body ) ).toEqual( [ {}, { started: 's1', extend: true } ] );
		expect( warning.hidden ).toBe( true );
		expect( $( root, '.ffx-timer' ).textContent ).toBe( 'Noch 2:00' );
		await vi.advanceTimersByTimeAsync( 60000 );
		expect( root.querySelector( '.ffx-time-up' ) ).toBeNull();
		// The plugin gives more time once: the second warning offers no button.
		await vi.advanceTimersByTimeAsync( 41000 );
		expect( warning.hidden ).toBe( false );
		expect( $( warning, 'button' ).hidden ).toBe( true );
	} );

	it( 'ends the form when the time is over', async () => {
		reply( '/token', 200, { ok: true, token: 't1', started: 's1', timeLeft: 5 } );
		const root = timed( 'Leider zu spät.' );
		root.dispatchEvent( new Event( 'pointerdown' ) );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( $( root, '.ffx-timer' ).textContent ).toBe( 'Noch 0:05' );
		await vi.advanceTimersByTimeAsync( 5000 );
		expect( $( root, '.ffx-time-up' ).textContent ).toBe( 'Leider zu spät.' );
		expect( root.querySelector( '.ffx-question' ) ).toBeNull();
		expect( $( root, '.ffx-nav' ).hidden ).toBe( true );
		expect( $( root, '.ffx-timer-box' ).hidden ).toBe( true );
	} );

	it( 'ends the form when the plugin says the time is up', async () => {
		const root = timed();
		await toContact( root );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 403, { ok: false, code: 'time_up' } );
		$( root, '.ffx-button-submit' ).click();
		for ( let i = 0; i < 100 && ! root.querySelector( '.ffx-time-up' ); i++ ) {
			await vi.advanceTimersByTimeAsync( 50 );
		}
		expect( $( root, '.ffx-time-up' ).textContent ).toBe( 'Die Zeit ist abgelaufen.' );
		expect( $( root, '.ffx-form-error' ).hidden ).toBe( true );
	} );
} );

describe( 'dates in paths', () => {
	const pickDate = ( root: HTMLElement, iso: string ): void => {
		const input = $<HTMLInputElement>( root, '.ffx-field-date input' );
		input.value = iso;
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	};

	it( 'takes today from the site\'s time zone', () => {
		vi.setSystemTime( new Date( '2026-10-16T22:30:00Z' ) );
		expect( siteToday( 'Europe/Berlin' ) ).toBe( '2026-10-17' );
		expect( siteToday( 'UTC' ) ).toBe( '2026-10-16' );
		expect( siteToday( 'Not/AZone' ) ).toMatch( /^2026-10-1[67]$/ );
	} );

	it( 'follows a path by the date and the site\'s today', () => {
		vi.setSystemTime( new Date( '2026-10-16T22:30:00Z' ) );
		const base = config();
		base.timeZone = 'Europe/Berlin';
		const doc = base.document as unknown as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>; start: string };
		doc.nodes.unshift( { id: 'nd', type: 'step', fields: [ { id: 'qd', key: 'qd', type: 'date', label: de( 'Wann?' ), description: de( '' ), required: true, props: { placeholder: de( '' ), format: 'dd.mm.yy' } } ] } );
		doc.edges.unshift( { id: 'xd1', from: 'nd', to: 'eq', when: { field: 'qd', op: 'dateOn', value: 'today' } }, { id: 'xd2', from: 'nd', to: 'n1', default: true } );
		doc.start = 'nd';
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, base, { url: '', query: '', title: '' } );
		pickDate( root, '2026-10-16' );
		next( root );
		expect( $( root, '.ffx-question' ).firstChild?.textContent ).toBe( 'Wofür?' );
		$( root, '.ffx-button-back' ).click();
		pickDate( root, '2026-10-17' );
		next( root );
		expect( root.querySelector( '.ffx-question' ) ).toBeNull();
	} );
} );

describe( 'lead analysis', () => {
	it( 'sends the time overall and per step from the first interaction', async () => {
		const root = mount();
		// Time before the visitor starts does not count.
		await vi.advanceTimersByTimeAsync( 60000 );
		root.dispatchEvent( new Event( 'pointerdown' ) );
		await vi.advanceTimersByTimeAsync( 4000 );
		await toContact( root );
		await vi.advanceTimersByTimeAsync( 10000 );
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		reply( '/entries', 201, { ok: true, entry: 9, end: { success: { show: true, html: '<p>Danke</p>', image: null }, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		for ( let i = 0; i < 100 && ! root.querySelector( '.ffx-success' ); i++ ) {
			await vi.advanceTimersByTimeAsync( 50 );
		}
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.analytics ).toEqual( { seconds: 14, steps: { n1: 4, n2: 0, n3: 0, n4: 10 }, referrer: '' } );
	} );

	it( 'keeps only the address of the referrer', () => {
		expect( referrerOf( 'https://www.google.com/search?q=kredit#x' ) ).toBe( 'https://www.google.com/search' );
		expect( referrerOf( 'android-app://com.google' ) ).toBe( '' );
		expect( referrerOf( '' ) ).toBe( '' );
	} );
} );
