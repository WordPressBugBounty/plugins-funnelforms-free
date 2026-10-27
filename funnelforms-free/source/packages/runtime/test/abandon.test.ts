import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/chunks/abandon';
// Both chunks share the hub (chunks/hub.ts); the live one finds nothing to do in these forms.
import '../src/chunks/live';
import { FormApp } from '../src/app';
import type { RuntimeConfig } from '../src/types';

const de = ( text: string ): Record<string, string> => ( { de_DE: text } );

function config( abandonment: Record<string, unknown> | null ): RuntimeConfig {
	return {
		uid: 'f1',
		endpoint: 'https://example.org/wp-json/funnelforms/v1/forms/f1',
		locale: 'de_DE',
		strings: { next: 'Weiter', back: 'Zurück', submit: 'Senden', sending: 'Senden…', required: 'Pflichtfeld', invalid_email: 'E-Mail ungültig', abandon_notice: 'Wir erinnern Sie einmal.', abandon_optout: 'Nicht erinnern', abandon_off: 'Gut, keine Erinnerung.' },
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
						{ id: 'q1', key: 'q1', type: 'choice', label: de( 'Wofür?' ), description: de( '' ), required: true, options: [ { id: 'o1', label: de( 'Immobilie' ), value: 'Immobilie' } ], props: { multiple: false, layout: { desktop: 'grid', mobile: 'grid' }, hideIcons: false } },
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
						{ id: 'c_name', key: 'name', type: 'name', label: de( 'Name' ), required: false, props: { placeholder: de( '' ) } },
						{ id: 'c_mail', key: 'mail', type: 'email', label: de( 'E-Mail' ), required: true, props: { placeholder: de( '' ), b2bOnly: false } },
						{ id: 'c_phone', key: 'phone', type: 'phone', label: de( 'Telefon' ), required: false, props: { placeholder: de( '' ) } },
						{ id: 'c_ok', key: 'ok', type: 'consent', label: de( '' ), required: false, props: { html: de( 'Erinnern Sie mich' ) } },
					],
				},
				{ id: 'e1', type: 'end', success: { show: true, text: de( '<p>Danke!</p>' ) }, redirect: null },
			],
			edges: [
				{ id: 'x1', from: 'n1', to: 'n4', default: true },
				{ id: 'x2', from: 'n4', to: 'e1' },
			],
			calculations: [],
			style: { tokens: {} },
			settings: { uiLocale: 'de_DE', progressBar: { show: false }, loadingAnimation: false, scrollToTop: { desktop: false, mobile: false }, rtl: false, autoHeight: false, iconFont: false, savePartialEntries: false, ...( abandonment ? { abandonment } : {} ) },
		},
	} as unknown as RuntimeConfig;
}

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply[]>;
let requests: Array<{ path: string; body: Record<string, unknown>; keepalive: boolean }>;

function reply( path: string, status: number, body: unknown ): void {
	( replies[ path ] ??= [] ).push( { status, body } );
}

beforeEach( () => {
	vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout', 'Date' ] } );
	replies = {};
	requests = [];
	let tokens = 0;
	vi.stubGlobal( 'fetch', vi.fn( async ( url: string, init: RequestInit ) => {
		const path = url.replace( /^.*\/forms\/f1/, '' );
		requests.push( { path, body: JSON.parse( String( init.body ) ), keepalive: init.keepalive === true } );
		const fallback = path === '/token' ? { status: 200, body: { ok: true, token: `t${ ++tokens }` } } : { status: 500, body: { ok: false, code: 'unexpected' } };
		const next = replies[ path ]?.shift() ?? fallback;
		return { status: next.status, json: async () => next.body };
	} ) );
} );

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
} );

const $ = <T extends HTMLElement = HTMLElement>( root: HTMLElement, selector: string ): T => root.querySelector( selector ) as T;
const type = ( input: HTMLInputElement, value: string ): void => {
	input.value = value;
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	input.dispatchEvent( new FocusEvent( 'focusout', { bubbles: true } ) );
};
const captures = (): Array<Record<string, unknown>> => requests.filter( ( r ) => r.path === '/abandon' ).map( ( r ) => r.body );

function mount( abandonment: Record<string, unknown> | null, query = '' ): HTMLElement {
	const root = document.createElement( 'div' );
	root.className = 'ffx-form';
	if ( abandonment ) {
		// As Frontend\Renderer::chunk_attribute() marks it.
		root.dataset.ffxChunks = 'live abandon';
	}
	document.body.append( root );
	window.history.replaceState( null, '', `/seite/${ query ? `?${ query }` : '' }` );
	new FormApp( root, config( abandonment ), { url: 'https://example.org/seite/', query, title: 'Seite' } );
	return root;
}

// happy-dom calls MutationObserver callbacks from the setTimeout it kept before the fake timers.
const realTimeout = globalThis.setTimeout;

/**
 * Lets the promise chains of a step run out without moving the clock: requests and their answers
 * are microtasks a few links deep; the observer that adds the notice runs on a real timer.
 */
async function flush(): Promise<void> {
	for ( let i = 0; i < 10; i++ ) {
		await vi.advanceTimersByTimeAsync( 0 );
		await new Promise( ( resolve ) => realTimeout( resolve, 0 ) );
	}
}

/** Answers the first step; the notice comes with the observer after the contact step. */
async function toContact( root: HTMLElement ): Promise<void> {
	$( root, '.ffx-option' ).click();
	await flush();
}

describe( 'reminders to visitors who leave', () => {
	it( 'keeps the address with the box ticked and only what changed', async () => {
		const root = mount( { field: 'c_mail', basis: 'consent', consentField: 'c_ok' } );
		await toContact( root );
		expect( $( root, '.ffx-abandon-notice' ) ).toBeNull();
		type( $<HTMLInputElement>( root, '.ffx-contact-name input' ), 'Erika' );
		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( captures() ).toEqual( [] );

		$<HTMLInputElement>( root, '.ffx-contact-consent input' ).click();
		root.dispatchEvent( new Event( 'change' ) );
		type( $<HTMLInputElement>( root, '.ffx-contact-phone input' ), '+49 30 1234567' );
		reply( '/abandon', 200, { ok: true, draft: 'a'.repeat( 32 ) } );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( captures() ).toEqual( [ {
			contact: { c_name: 'Erika', c_mail: 'erika@example.org', c_ok: true },
			answers: { q1: [ 'o1' ] },
			node: 'n4',
			page: { url: 'https://example.org/seite/', query: '', title: 'Seite' },
			locale: 'de_DE',
			variants: {},
			draft: '',
			token: 't1',
		} ] );

		// Nothing new: nothing sent, not even when the page is hidden.
		root.dispatchEvent( new FocusEvent( 'focusout', { bubbles: true } ) );
		await vi.advanceTimersByTimeAsync( 1000 );
		window.dispatchEvent( new Event( 'pagehide' ) );
		await flush();
		expect( captures() ).toHaveLength( 1 );

		// A change goes out when the page is hidden, with keepalive and the draft key of the answer.
		$<HTMLInputElement>( root, '.ffx-contact-name input' ).value = 'Erika M.';
		$<HTMLInputElement>( root, '.ffx-contact-name input' ).dispatchEvent( new Event( 'input', { bubbles: true } ) );
		window.dispatchEvent( new Event( 'pagehide' ) );
		await flush();
		const last = requests.filter( ( r ) => r.path === '/abandon' ).at( -1 );
		expect( last?.keepalive ).toBe( true );
		expect( last?.body.draft ).toBe( 'a'.repeat( 32 ) );

		// Sending the form uses the same draft key; afterwards nothing goes out.
		reply( '/entries', 201, { ok: true, entry: 9, eventId: 'e', end: { success: { show: true, html: '<p>Danke!</p>', image: null }, redirect: null } } );
		$( root, '.ffx-button-submit' ).click();
		await vi.advanceTimersByTimeAsync( 4000 );
		expect( requests.find( ( r ) => r.path === '/entries' )?.body.draft ).toBe( 'a'.repeat( 32 ) );
		window.dispatchEvent( new Event( 'pagehide' ) );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( captures() ).toHaveLength( 2 );
	} );

	it( 'shows the notice under the field and withdraws on "Don\'t remind me"', async () => {
		const root = mount( { field: 'c_mail', basis: 'notice', notice: de( 'Wir <b>erinnern</b> Sie.' ) } );
		await toContact( root );
		const notice = $( root, '.ffx-contact-email .ffx-abandon-notice' );
		expect( notice.textContent ).toBe( 'Wir erinnern Sie. Nicht erinnern' );
		expect( $( root, '.ffx-contact-email input' ).getAttribute( 'aria-describedby' ) ).toContain( notice.id );

		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika@example.org' );
		reply( '/abandon', 200, { ok: true, draft: 'b'.repeat( 32 ) } );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( captures()[ 0 ]?.contact ).toEqual( { c_mail: 'erika@example.org' } );

		$( root, '.ffx-abandon-optout' ).click();
		await flush();
		expect( notice.textContent ).toBe( 'Gut, keine Erinnerung.' );
		expect( captures()[ 1 ] ).toEqual( { draft: 'b'.repeat( 32 ), stop: true, token: 't1' } );

		type( $<HTMLInputElement>( root, '.ffx-contact-email input' ), 'erika.m@example.org' );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( captures() ).toHaveLength( 2 );

		// Back and forth: the contact step shows the answer, not the offer.
		$( root, '.ffx-button-back' ).click();
		await toContact( root );
		expect( $( root, '.ffx-abandon-notice' ).textContent ).toBe( 'Gut, keine Erinnerung.' );
	} );

	it( 'falls back to the default notice and stays off without the setting', async () => {
		const root = mount( { field: 'c_mail', basis: 'notice' } );
		await toContact( root );
		expect( $( root, '.ffx-abandon-notice' ).textContent ).toBe( 'Wir erinnern Sie einmal. Nicht erinnern' );
		document.body.innerHTML = '';

		// Without the chunk in data-ffx-chunks the hub does not hand the form over.
		const plain = mount( null );
		await toContact( plain );
		expect( $( plain, '.ffx-abandon-notice' ) ).toBeNull();
		const hub = window.ffxLive as unknown as { apps: Set<unknown> };
		expect( hub.apps.size ).toBeGreaterThan( 0 );
	} );

	it( 'fills in the address again from the reminder link', async () => {
		reply( '/progress/load', 200, { ok: true, answers: { q1: [ 'o1' ] }, locale: 'de_DE', expiresAt: '2026-11-01T00:00:00+00:00', contact: { c_mail: 'erika@example.org', c_name: 'Erika' } } );
		const root = mount( { field: 'c_mail', basis: 'notice' }, `ffx_resume=${ 'c'.repeat( 32 ) }` );
		await flush();
		expect( $( root, '[data-node]' ).dataset.node ).toBe( 'n4' );
		expect( $<HTMLInputElement>( root, '.ffx-contact-email input' ).value ).toBe( 'erika@example.org' );
		expect( $<HTMLInputElement>( root, '.ffx-contact-name input' ).value ).toBe( 'Erika' );
		window.history.replaceState( null, '', '/' );
	} );
} );
