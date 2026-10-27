import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDetail, FormsApi, FormSummary } from '../src/api';
import { cssSize, DEFAULT_FRAME, DEFAULT_POPUP, DEFAULT_WIDGET, frameCode, HEIGHT_UNITS, popupShortcode, widgetShortcode, WIDTH_UNITS, type EmbedConfig } from '../src/embed';
import { setEdition } from '../src/edition';
import { createBuilderStore } from '../src/store';
import { Builder } from '../src/ui/Builder';
import { blank } from './blank';

( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const UID = '9867beec-9b12-4a6a-85b8-9827fe7baddf';
const SHORTCODE = `[funnelforms uid="${ UID }"]`;
const CONFIG: EmbedConfig = { script: 'https://example.org/wp-content/plugins/Funnelforms-pro/assets/embed/embed.js', frame: 'https://example.org/?ffx_frame=', domains: [] };

describe( 'embed codes', () => {
	it( 'write the popup attributes the shortcode, the block and the Elementor widget share', () => {
		expect( popupShortcode( SHORTCODE, DEFAULT_POPUP ) ).toBe( `[funnelforms uid="${ UID }" popup_by_delay="1" popup_delay="5000" popup_pause="24"]` );
		expect( popupShortcode( SHORTCODE, { ...DEFAULT_POPUP, trigger: 'click', clickClass: 'open me"]' } ) ).toBe( `[funnelforms uid="${ UID }" popup_by_click="1" popup_click_class="openme"]` );
		expect( popupShortcode( SHORTCODE, { ...DEFAULT_POPUP, trigger: 'click', clickClass: '' } ) ).toContain( 'popup_click_class="funnelforms-open"' );
		expect( popupShortcode( SHORTCODE, { ...DEFAULT_POPUP, trigger: 'scroll', scroll: 140, pause: 0 } ) ).toBe( `[funnelforms uid="${ UID }" popup="scroll" popup_scroll="100" popup_pause="0"]` );
		expect( popupShortcode( '[funnelforms id="12"]', { ...DEFAULT_POPUP, trigger: 'exit' } ) ).toBe( '[funnelforms id="12" popup="exit" popup_pause="24"]' );
	} );

	it( 'write the corner button without quotes or brackets in its text', () => {
		expect( widgetShortcode( SHORTCODE, DEFAULT_WIDGET ) ).toBe( `[funnelforms uid="${ UID }" widget="bottom-right"]` );
		expect( widgetShortcode( SHORTCODE, { position: 'top-left', text: ' Say "hi" [now] ', color: '#6A30F5', animation: 'pulse' } ) ).toBe(
			`[funnelforms uid="${ UID }" widget="top-left" widget_text="Say hi now" widget_color="#6a30f5" widget_animation="pulse"]`
		);
		expect( widgetShortcode( SHORTCODE, { ...DEFAULT_WIDGET, color: 'red' } ) ).not.toContain( 'widget_color' );
	} );

	it( 'accept sizes with the units of each side', () => {
		expect( cssSize( '100%', WIDTH_UNITS ) ).toBe( '100%' );
		expect( cssSize( ' 600 ', HEIGHT_UNITS ) ).toBe( '600px' );
		expect( cssSize( '80vh', HEIGHT_UNITS ) ).toBe( '80vh' );
		expect( cssSize( '80vh', WIDTH_UNITS ) ).toBeNull();
		expect( cssSize( '0px', WIDTH_UNITS ) ).toBeNull();
		expect( cssSize( 'calc(100% - 1px)', WIDTH_UNITS ) ).toBeNull();
	} );

	it( 'write the embed code for other websites with escaped values', () => {
		const code = frameCode( CONFIG, UID, 'Anfrage "Wohnung" <neu>', { width: '90%', height: 'big', autoHeight: true } );
		expect( code ).toContain( `data-src="https://example.org/?ffx_frame=${ UID }"` );
		expect( code ).toContain( 'data-title="Anfrage &quot;Wohnung&quot; &lt;neu&gt;"' );
		expect( code ).toContain( 'data-width="90%" data-height="600px" data-auto-height="true"' );
		expect( code ).toContain( `<script src="${ CONFIG.script }" async></script>` );
		expect( frameCode( CONFIG, UID, '', { ...DEFAULT_FRAME, autoHeight: false } ) ).not.toContain( 'data-auto-height' );
	} );
} );

const summary: FormSummary = {
	id: 7,
	uid: UID,
	title: 'Anfrage',
	category: '',
	status: 'published',
	renderer: 'v5',
	legacyId: null,
	currentRevision: 3,
	hasDraft: false,
	draftUpdatedAt: null,
	draftAuthor: null,
	lockedBy: null,
	entries: 0,
	shortcode: SHORTCODE,
	publicSlug: '',
	publicUrl: null,
	createdAt: null,
	updatedAt: null,
};

function fakeApi(): FormsApi {
	const detail = (): FormDetail => ( { ...summary, document: blank(), lockTtl: 150 } );
	const calls: Record<string, unknown> = {
		get: vi.fn( async () => detail() ),
		update: vi.fn( async ( _id: number, changes: { publicSlug?: string } ) => ( { ...detail(), publicSlug: changes.publicSlug, publicUrl: 'https://example.org/funnelforms/' + changes.publicSlug } ) ),
		saveDraft: vi.fn( async () => ( { problems: [], missingRights: [], form: summary } ) ),
		revisions: vi.fn( async () => [] ),
		connections: vi.fn( async () => [] ),
		styles: vi.fn( async () => [] ),
		fonts: vi.fn( async () => [] ),
		googleFonts: vi.fn( async () => [] ),
	};
	// Not thenable, so open() can resolve with it.
	return new Proxy( calls, { get: ( target, key: string ) => ( 'then' === key ? undefined : ( target[ key ] ?? ( target[ key ] = vi.fn( async () => undefined ) ) ) ) } ) as unknown as FormsApi;
}

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
} );

afterEach( () => {
	act( () => root.unmount() );
	container.remove();
	delete process.env.FUNNELFORMS_EDITION;
	setEdition( undefined );
} );

async function open( embed: EmbedConfig | null = CONFIG ): Promise<FormsApi> {
	const api = fakeApi();
	const store = createBuilderStore( api, 7, { autosaveMs: 60000 } );
	await act( async () => root.render( <Builder api={ api } formId={ 7 } onBack={ () => undefined } store={ store } view="embed" embed={ embed } /> ) );
	await act( async () => {
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );
	return api;
}

async function choose( method: string ): Promise<void> {
	await act( async () => container.querySelector<HTMLButtonElement>( `[data-method="${ method }"]` )?.click() );
}

const code = (): string => container.querySelector( '.ffxb-embed__code code' )?.textContent ?? '';

describe( 'embed workspace', () => {
	it( 'opens from the top bar with the shortcode first', async () => {
		await open();
		expect( container.querySelector( '[data-view="embed"]' )?.getAttribute( 'aria-current' ) ).toBe( 'page' );
		expect( container.querySelector( '[data-method="inline"]' )?.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( code() ).toBe( SHORTCODE );
		expect( container.querySelectorAll( '.ffxb-embed__steps li' ).length ).toBe( 4 );
	} );

	it( 'shows the ways in the list of the settings pages and the chosen one as a card', async () => {
		await open();
		const nav = container.querySelector( '.ffxb-workspace--sheet > nav.ffxb-sheet__nav' );
		expect( nav?.getAttribute( 'aria-label' ) ).toBe( 'Ways to embed' );
		expect( nav?.querySelectorAll( '.ffxb-sheet__link[data-method]' ).length ).toBe( 5 );
		expect( container.querySelector( '.ffxb-sheet__card .ffxb-embed' )?.getAttribute( 'aria-labelledby' ) ).toBe( 'ffxb-embed-title' );
		await choose( 'popup' );
		expect( container.querySelector( '#ffxb-embed-title' )?.textContent ).toBe( 'Popup' );
		expect( container.querySelector( '[data-method="popup"]' )?.className ).toContain( 'is-active' );
		expect( container.querySelector( '[data-method="inline"]' )?.getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		expect( container.querySelector( '.ffxb-embed__preview .ffxb-sketch--popup' ) ).not.toBeNull();
	} );

	it( 'writes the code of each way and copies it', async () => {
		const writeText = vi.fn( async () => undefined );
		Object.defineProperty( navigator, 'clipboard', { value: { writeText }, configurable: true } );
		await open();
		await choose( 'popup' );
		expect( code() ).toContain( 'popup_by_delay="1"' );
		await choose( 'widget' );
		expect( code() ).toContain( 'widget="bottom-right"' );
		expect( container.querySelector( '.ffxb-sketch__button--bottom-right' ) ).not.toBeNull();
		await choose( 'external' );
		expect( code() ).toContain( `data-src="https://example.org/?ffx_frame=${ UID }"` );
		await act( async () => container.querySelector<HTMLButtonElement>( '.ffxb-embed__copy' )?.click() );
		expect( writeText ).toHaveBeenCalledWith( code() );
		expect( container.querySelector( '.ffxb-embed__copy' )?.textContent ).toBe( 'Copied' );
	} );

	it( 'gives the form an address for its own page', async () => {
		const api = await open();
		await choose( 'link' );
		expect( container.querySelector( '.ffxb-embed__code' ) ).toBeNull();
		const input = container.querySelector<HTMLInputElement>( '.ffxb-own-page input' );
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, 'Wohnung mieten' );
			input?.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		await act( async () => container.querySelector<HTMLButtonElement>( '.ffxb-own-page button' )?.click() );
		expect( api.update ).toHaveBeenCalledWith( 7, { publicSlug: 'wohnung-mieten' } );
		expect( code() ).toBe( 'https://example.org/funnelforms/wohnung-mieten' );
	} );

	it( 'offers the address with the parameter when the server does not pass the page to WordPress', async () => {
		const fetch = vi.fn( async () => ( { status: 404 } ) as Response );
		vi.stubGlobal( 'fetch', fetch );
		try {
			const api = await open();
			vi.mocked( api.update ).mockImplementation( async ( _id, changes ) => ( { ...summary, document: blank(), lockTtl: 150, publicSlug: changes.publicSlug, publicUrl: 'https://example.org/funnelforms/angebot', publicFallback: 'https://example.org/?funnelforms=angebot' } ) );
			await choose( 'link' );
			const input = container.querySelector<HTMLInputElement>( '.ffxb-own-page input' );
			await act( async () => {
				Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, 'angebot' );
				input?.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			} );
			await act( async () => container.querySelector<HTMLButtonElement>( '.ffxb-own-page button' )?.click() );
			await act( async () => undefined );
			expect( fetch ).toHaveBeenCalledWith( 'https://example.org/funnelforms/angebot', expect.objectContaining( { method: 'HEAD' } ) );
			const hint = container.querySelector( '.ffxb-page-address' );
			expect( hint?.textContent ).toContain( 'This address shows "Not found"' );
			expect( hint?.querySelector( 'a' )?.getAttribute( 'href' ) ).toBe( 'https://example.org/?funnelforms=angebot' );
			expect( hint?.querySelector( 'a[href="options-permalink.php"]' ) ).not.toBeNull();

			// With plain permalinks the address with the parameter is the address; nothing to check.
			fetch.mockClear();
			vi.mocked( api.update ).mockImplementation( async ( _id, changes ) => ( { ...summary, document: blank(), lockTtl: 150, publicSlug: changes.publicSlug, publicUrl: 'https://example.org/?funnelforms=neu', publicFallback: 'https://example.org/?funnelforms=neu' } ) );
			await act( async () => {
				Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, 'neu' );
				input?.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			} );
			await act( async () => container.querySelector<HTMLButtonElement>( '.ffxb-own-page button' )?.click() );
			expect( fetch ).not.toHaveBeenCalled();
			expect( container.querySelector( '.ffxb-page-address' )?.textContent ).toContain( 'Your website uses plain permalinks' );
		} finally {
			vi.unstubAllGlobals();
		}
	} );

	it( 'names the Pro ways in Funnelforms Free without their code', async () => {
		process.env.FUNNELFORMS_EDITION = 'free';
		await open( null );
		expect( container.querySelector( '[data-method="popup"] .ffxb-badge' )?.textContent ).toBe( 'Pro' );
		expect( container.querySelector( '[data-method="inline"] .ffxb-badge' ) ).toBeNull();
		expect( code() ).toBe( SHORTCODE );
		for ( const method of [ 'popup', 'widget', 'external' ] ) {
			await choose( method );
			expect( container.querySelector( '.ffxb-embed__code' ) ).toBeNull();
			expect( container.textContent ).toContain( 'These come with Funnelforms Pro:' );
			// Each part in the list carries the Pro badge.
			const items = [ ...container.querySelectorAll( '.ffxb-pro__list li' ) ];
			expect( items.length ).toBeGreaterThan( 1 );
			expect( items.every( ( li ) => li.querySelector( '.ffxb-badge' )?.textContent === 'Pro' ) ).toBe( true );
		}
	} );
} );
