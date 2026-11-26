import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import type { ConnectApi, CrmProvider } from '../src/connect';
import { createHubApi, filterServices, hubServices, hubSummary, type HubApi, type HubConnection, type HubOverview } from '../src/hub';
import { categoryName, IntegrationsHub, usage, type HubScreenApi } from '../src/ui/IntegrationsHub';

( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
	HTMLDialogElement.prototype.showModal ??= function ( this: HTMLDialogElement ) {
		this.setAttribute( 'open', '' );
	};
} );

afterEach( () => {
	act( () => root.unmount() );
	container.remove();
} );

async function settle(): Promise<void> {
	await act( async () => {
		for ( let i = 0; i < 8; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );
}

function button( label: string, scope: ParentNode = container ): HTMLButtonElement {
	const found = [ ...scope.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.trim() === label || b.getAttribute( 'aria-label' ) === label );
	if ( ! found ) {
		throw new Error( 'No button ' + label );
	}
	return found;
}

function tile( name: string ): HTMLElement {
	const found = [ ...container.querySelectorAll<HTMLElement>( '.ffx-hub-tile' ) ].find( ( t ) => t.querySelector( 'strong' )?.textContent === name );
	if ( ! found ) {
		throw new Error( 'No tile ' + name );
	}
	return found;
}

async function type( input: HTMLInputElement, value: string ): Promise<void> {
	await act( async () => {
		Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, value );
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	} );
}

function field( scope: ParentNode, label: string ): HTMLInputElement {
	const found = [ ...scope.querySelectorAll( 'label' ) ].find( ( l ) => l.textContent === label );
	const input = found ? scope.querySelector<HTMLInputElement>( '#' + CSS.escape( found.htmlFor ) ) : null;
	if ( ! input ) {
		throw new Error( 'No field ' + label );
	}
	return input;
}

const providers: CrmProvider[] = [
	{ provider: 'hubspot', label: 'HubSpot', category: 'crm', lookups: true, signIn: false, help: 'Create a service key.', credentials: [ { name: 'access_token', label: 'Service key', input: 'password', secret: true, required: true } ], mapping: [] },
	{ provider: 'brevo', label: 'Brevo', category: 'newsletter', lookups: true, signIn: false, help: '', credentials: [ { name: 'api_key', label: 'API key', input: 'password', secret: true, required: true } ], mapping: [] },
	{ provider: 'googlesheets', label: 'Google Sheets', category: 'spreadsheet', lookups: true, signIn: true, help: 'Sign in with Google.', credentials: [], mapping: [] },
];

const stripe: HubConnection = { ref: 'stripe:0b6c3f0e-1d2a-4c5b-8e9f-0a1b2c3d4e5f', type: 'stripe', label: 'Shop', createdAt: '2026-10-20T09:00:00Z', forms: [ { id: 7, title: 'Kurs buchen' } ], formCount: 1, testMode: true, attention: 'webhook_missing', webhookUrl: 'https://site.test/wp-json/funnelforms/v1/payments/stripe/0b6c' };
const slack: HubConnection = { ref: 'slack:2d8e5b2a-3f4c-4e7d-8a1b-2c3d4e5f6071', type: 'slack', label: 'Vertrieb', createdAt: '2026-10-20T09:00:00Z', forms: [], formCount: 0, attention: null };
const icloud: HubConnection = { ref: 'caldav:4fa07d4c-5b6e-4a9f-8c3d-4e5f60718293', type: 'caldav', label: 'Privat', createdAt: '2026-10-20T09:00:00Z', forms: [], formCount: 0, attention: null, service: 'icloud' };

function overview( changes: Partial<HubOverview> = {} ): HubOverview {
	return {
		connections: [ stripe, slack, icloud ],
		imports: [
			{ source: 'wpforms', label: 'WPForms', forms: 3, imported: 1 },
			{ source: 'contact-form-7', label: 'Contact Form 7', forms: 1, imported: 1 },
		],
		website: { connected: true },
		...changes,
	};
}

function fakeApi( hub: Partial<HubApi> = {}, rest: Partial<HubScreenApi> = {} ): HubScreenApi {
	return {
		hub: {
			overview: vi.fn( async () => overview() ),
			checkPayment: vi.fn( async () => ( { ok: true as const, testMode: false, account: '', methods: [ 'Card', 'iDEAL' ] } ) ),
			setUpStripeWebhook: vi.fn( async () => ( { ok: true as const, webhookUrl: stripe.webhookUrl as string, replaced: false } ) ),
			...hub,
		},
		connect: { crmProviders: vi.fn( async () => providers ) } as unknown as ConnectApi,
		createConnection: vi.fn( async ( t: string, label: string ) => ( { ref: t + ':1c7d4a1f-2e3b-4d6c-9f0a-1b2c3d4e5f60', type: t, label } ) ),
		updateConnection: vi.fn(),
		deleteConnection: vi.fn( async () => undefined ),
		testConnection: vi.fn( async () => undefined ),
		...rest,
	};
}

const config = { interfacesUrl: 'admin.php?page=funnelforms-settings&tab=interfaces', leadcallerUrl: 'admin.php?page=funnelforms-leadcaller', builderUrl: 'admin.php?page=funnelforms-builder' };

describe( 'the rules of the overview', () => {
	it( 'puts the CRM tools of the server into their categories and filters by search, category and connections', () => {
		const services = hubServices( providers );
		expect( services.slice( 0, 3 ).map( ( s ) => s.id ) ).toEqual( [ 'stripe', 'paypal', 'mollie' ] );
		expect( services.find( ( s ) => 'brevo' === s.id )?.category ).toBe( 'newsletter' );
		expect( services.findIndex( ( s ) => 'hubspot' === s.id ) ).toBeLessThan( services.findIndex( ( s ) => 'brevo' === s.id ) );
		const connections = [ stripe, slack, icloud ];
		const ids = ( query: string, category: Parameters<typeof filterServices>[ 1 ][ 'category' ] = 'all', connectedOnly = false ): string[] => filterServices( services, { query, category, connectedOnly }, connections, categoryName ).map( ( s ) => s.id );
		expect( ids( 'paypal' ) ).toEqual( [ 'paypal' ] );
		// The name of the category finds its services too.
		expect( ids( 'pay' ) ).toEqual( [ 'stripe', 'paypal', 'mollie' ] );
		expect( ids( 'sheets' ) ).toEqual( [ 'googlesheets' ] );
		expect( ids( '', 'calendars', true ) ).toEqual( [ 'icloud' ] );
		expect( ids( '', 'all', true ) ).toEqual( [ 'stripe', 'icloud', 'slack' ] );
	} );

	it( 'counts connections, those in use and those that need something', () => {
		expect( hubSummary( [ stripe, slack, icloud ] ) ).toEqual( { connected: 3, inUse: 1, attention: 1 } );
	} );

	it( 'asks the routes below funnelforms/v1', async () => {
		const request = vi.fn( async () => ( {} ) );
		const api = createHubApi( request as never );
		await api.overview();
		await api.checkPayment( stripe.ref );
		await api.setUpStripeWebhook( stripe.ref );
		expect( request.mock.calls ).toEqual( [
			[ 'GET', '~/integrations' ],
			[ 'POST', '~/integrations/' + stripe.ref + '/check' ],
			[ 'POST', '~/integrations/' + stripe.ref + '/stripe-webhook' ],
		] );
	} );
} );

describe( 'the overview of all integrations', () => {
	it( 'shows the figures, what needs attention and each service with its state', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		expect( [ ...container.querySelectorAll( '.ffx-hub__figures dd' ) ].map( ( d ) => d.textContent ) ).toEqual( [ '3', '1', '1' ] );
		expect( container.querySelector( '.ffx-hub-todo' )?.textContent ).toContain( 'Shop' );
		expect( [ ...tile( 'Stripe' ).querySelectorAll( '.ffx-badge' ) ].map( ( b ) => b.textContent ) ).toEqual( [ 'Connected', 'Needs attention', 'Test mode' ] );
		expect( tile( 'PayPal' ).querySelector( '.ffx-badge' ) ).toBeNull();
		expect( tile( 'Apple iCloud' ).textContent ).toContain( 'Connected' );
		expect( tile( 'CalDAV' ).querySelector( '.ffx-badge' ) ).toBeNull();
		expect( tile( 'HubSpot' ) ).toBeTruthy();
		expect( tile( 'Zapier, Make, n8n' ).getAttribute( 'href' ) ).toBe( config.interfacesUrl );
		// ElevenLabs is connected in one place only: the page of the AI Phone Agent.
		expect( tile( 'ElevenLabs' ).getAttribute( 'href' ) ).toBe( config.leadcallerUrl );
		expect( [ ...container.querySelectorAll( '.ffx-hub-group h3' ) ].map( ( h ) => h.textContent ) ).toEqual( [ 'Payments', 'CRM', 'Newsletter', 'Spreadsheets', 'Calendars', 'Video meetings', 'Messages', 'Conversion tracking', 'Automation' ] );
	} );

	it( 'sets up the Stripe webhook with one click and loads the overview again', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => button( 'Set up webhook automatically', container.querySelector( '.ffx-hub-todo' ) as Element ).click() );
		await settle();
		expect( api.hub.setUpStripeWebhook ).toHaveBeenCalledWith( stripe.ref );
		expect( api.hub.overview ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'connects Mollie with its key and checks it with Mollie right away', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Mollie' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Mollie"]' ) as HTMLDialogElement;
		expect( dialog.textContent ).toContain( 'How to connect' );
		expect( dialog.querySelector( 'a[href="https://my.mollie.com/dashboard/developers/api-keys"]' )?.getAttribute( 'rel' ) ).toBe( 'noopener noreferrer' );
		expect( field( dialog, 'Name' ).value ).toBe( 'Mollie' );
		expect( button( 'Connect', dialog ).disabled ).toBe( true );
		await type( field( dialog, 'API key (live_… or test_…)' ), ' live_abc ' );
		await act( async () => button( 'Connect', dialog ).click() );
		await settle();
		expect( api.createConnection ).toHaveBeenCalledWith( 'mollie', 'Mollie', { apiKey: 'live_abc' } );
		expect( api.hub.checkPayment ).toHaveBeenCalledWith( 'mollie:1c7d4a1f-2e3b-4d6c-9f0a-1b2c3d4e5f60' );
		expect( api.hub.setUpStripeWebhook ).not.toHaveBeenCalled();
	} );

	it( 'connects Stripe, checks the key and sets up its webhook in one go', async () => {
		const added: HubConnection = { ...stripe, ref: 'stripe:1c7d4a1f-2e3b-4d6c-9f0a-1b2c3d4e5f60', label: 'Stripe', forms: [], formCount: 0, attention: null, testMode: false };
		const api = fakeApi( { overview: vi.fn().mockResolvedValueOnce( overview( { connections: [] } ) ).mockResolvedValue( overview( { connections: [ added ] } ) ) } );
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Stripe' ).click() );
		const dialog = (): HTMLDialogElement => container.querySelector( 'dialog[aria-label="Stripe"]' ) as HTMLDialogElement;
		await type( field( dialog(), 'Secret key (sk_… or rk_…)' ), 'sk_live_abc' );
		await act( async () => button( 'Connect', dialog() ).click() );
		await settle();
		expect( api.createConnection ).toHaveBeenCalledWith( 'stripe', 'Stripe', { secretKey: 'sk_live_abc' } );
		expect( api.hub.checkPayment ).toHaveBeenCalledWith( added.ref );
		expect( api.hub.setUpStripeWebhook ).toHaveBeenCalledWith( added.ref );
		const row = dialog().querySelector( '.ffx-hub-connection' ) as HTMLElement;
		expect( row.textContent ).toContain( 'The keys work.' );
		expect( row.textContent ).toContain( 'The webhook is set up' );
	} );

	it( 'shows why a key was refused', async () => {
		const api = fakeApi( { checkPayment: vi.fn( async () => Promise.reject( new ApiError( 'credentials_rejected', 'The provider rejected the keys.', 400 ) ) ) } );
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Stripe' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Stripe"]' ) as HTMLDialogElement;
		expect( dialog.querySelector( '.ffx-hub-connection__used a' )?.getAttribute( 'href' ) ).toBe( 'admin.php?page=funnelforms-builder&form=7' );
		await act( async () => button( 'Check connection', dialog ).click() );
		await settle();
		expect( dialog.querySelector( '.ffxb-notice--danger' )?.textContent ).toBe( 'The provider rejected the keys.' );
	} );

	it( 'sends a test to Slack and deletes a connection after asking', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Slack' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Slack"]' ) as HTMLDialogElement;
		await act( async () => button( 'Send test', dialog ).click() );
		await settle();
		expect( api.testConnection ).toHaveBeenCalledWith( slack.ref, {} );
		expect( dialog.textContent ).toContain( 'The test message was sent.' );
		await act( async () => button( 'Delete', dialog ).click() );
		expect( dialog.textContent ).toContain( 'Delete “Vertrieb”?' );
		await act( async () => button( 'Delete connection', dialog ).click() );
		await settle();
		expect( api.deleteConnection ).toHaveBeenCalledWith( slack.ref );
	} );

	it( 'says per service where a form uses it', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		expect( container.querySelector( '.ffx-hub__use' )?.textContent ).toContain( 'open “After sending”' );
		await act( async () => tile( 'Slack' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Slack"]' ) as HTMLDialogElement;
		const use = dialog.querySelector( '.ffx-hub-panel__use' );
		expect( use?.textContent ).toContain( 'Use it in a form' );
		expect( use?.textContent ).toContain( '“Your connected tools”' );
		expect( use?.querySelector( 'a' )?.getAttribute( 'href' ) ).toBe( config.builderUrl );
		await act( async () => button( 'Close', dialog ).click() );
		await act( async () => tile( 'Stripe' ).click() );
		expect( container.querySelector( 'dialog[aria-label="Stripe"] .ffx-hub-panel__use' )?.textContent ).toContain( 'Settings → Payment' );

		const of = ( id: string, category: string, kind = 'connection' ): string => usage( { id, category, kind } as Parameters<typeof usage>[ 0 ] );
		expect( of( 'hubspot', 'crm', 'crm' ) ).toContain( 'After sending' );
		expect( of( 'googlesheets', 'spreadsheet', 'crm' ) ).toContain( 'After sending' );
		expect( of( 'bird', 'messages' ) ).toContain( 'confirm numbers by text message' );
		expect( of( 'meta', 'tracking' ) ).toContain( 'After sending' );
		expect( of( 'google', 'calendars', 'calendar' ) ).toBe( '' );
		expect( of( 'automation', 'automation', 'link' ) ).toBe( '' );
	} );

	it( 'leads calendars to the calendar section and CRM tools to their dialog', async () => {
		const onCalendar = vi.fn();
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ onCalendar } /> ) );
		await settle();
		await act( async () => tile( 'Google Calendar' ).click() );
		expect( onCalendar ).toHaveBeenCalledWith( 'google' );
		await act( async () => tile( 'HubSpot' ).click() );
		expect( container.querySelector( 'dialog[aria-label="Add connection"]' ) ).not.toBeNull();
	} );

	it( 'searches and says when nothing matches', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await type( container.querySelector( '.ffx-hub-search input' ) as HTMLInputElement, 'whats' );
		expect( [ ...container.querySelectorAll( '.ffx-hub-tile strong' ) ].map( ( s ) => s.textContent ) ).toEqual( [ 'WhatsApp Business' ] );
		await type( container.querySelector( '.ffx-hub-search input' ) as HTMLInputElement, 'xyz' );
		expect( container.textContent ).toContain( 'No integration matches your search.' );
		await act( async () => button( 'Messages' ).click() );
		await type( container.querySelector( '.ffx-hub-search input' ) as HTMLInputElement, '' );
		expect( [ ...container.querySelectorAll( '.ffx-hub-tile strong' ) ].map( ( s ) => s.textContent ) ).toEqual( [ 'Slack', 'Microsoft Teams', 'WhatsApp Business', 'Twilio', 'Bird', 'ElevenLabs' ] );
	} );

	it( 'has no invitation to import forms of other plugins, found or not', async () => {
		for ( const imports of [ overview().imports, [] ] ) {
			const api = fakeApi( { overview: vi.fn( async () => overview( { imports } ) ) } );
			await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
			await settle();
			expect( container.querySelector( '.ffx-hub__figures' ) ).toBeTruthy();
			expect( container.querySelector( '.ffx-hub-import' ) ).toBeNull();
			expect( container.textContent ).not.toContain( 'Coming from another form plugin?' );
			expect( container.textContent ).not.toContain( 'Import from other plugins' );
		}
	} );
} );

describe( 'CRM tools in the overview', () => {
	const hubspot: HubConnection = { ref: 'hubspot:5e1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6a7b', type: 'hubspot', label: 'HubSpot Vertrieb', createdAt: '2026-10-19T10:00:00Z', forms: [ { id: 7, title: 'Kurs buchen' } ], formCount: 1, attention: null };
	const legacy: HubConnection = { ref: 'legacy:hubspot', type: 'hubspot', label: 'HubSpot (Funnelforms 3)', createdAt: '2026-01-02T10:00:00Z', forms: [], formCount: 0, attention: null };

	function crmApi( connect: Partial<ConnectApi> = {}, connections: HubConnection[] = [ hubspot ] ): HubScreenApi {
		const api = fakeApi( { overview: vi.fn( async () => overview( { connections } ) ) } );
		api.connect = {
			crmProviders: vi.fn( async () => providers ),
			crmOptions: vi.fn( async () => ( { checked: true, options: {} } ) ),
			createCrmConnection: vi.fn( async ( provider: string, label: string ) => ( { ref: provider + ':new', provider, label, legacy: false, createdAt: '', forms: 0 } ) ),
			updateCrmConnection: vi.fn( async ( ref: string, changes: { label?: string } ) => ( { ref, provider: 'hubspot', label: changes.label ?? '', legacy: false, createdAt: '', forms: 1 } ) ),
			deleteCrmConnection: vi.fn( async () => undefined ),
			...connect,
		} as unknown as ConnectApi;
		return api;
	}

	async function open( api: HubScreenApi, name: string ): Promise<HTMLDialogElement> {
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( name ).click() );
		await settle();
		return container.querySelector( 'dialog[aria-label="' + name + '"]' ) as HTMLDialogElement;
	}

	it( 'adds a HubSpot connection with its help text and the access data', async () => {
		const api = crmApi( {}, [] );
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'HubSpot' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Add connection"]' ) as HTMLDialogElement;
		expect( dialog.textContent ).toContain( 'Create a service key.' );
		await type( field( dialog, 'Name' ), 'Neu' );
		await type( field( dialog, 'Service key' ), 'secret-key' );
		await act( async () => button( 'Save connection', dialog ).click() );
		await settle();
		expect( api.connect.createCrmConnection ).toHaveBeenCalledWith( 'hubspot', 'Neu', { access_token: 'secret-key' } );
		expect( api.hub.overview ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'tests a connection and says when the tool refused the access data', async () => {
		const api = crmApi();
		let dialog = await open( api, 'HubSpot' );
		expect( dialog.textContent ).toContain( 'Kurs buchen' );
		await act( async () => button( 'Test', dialog ).click() );
		await settle();
		expect( api.connect.crmOptions ).toHaveBeenCalledWith( hubspot.ref );
		expect( dialog.querySelector( '.ffxb-notice--success' )?.textContent ).toBe( 'The connection works: the tool accepted the access data.' );

		act( () => root.unmount() );
		root = createRoot( container );
		const refused = crmApi( { crmOptions: vi.fn( async () => Promise.reject( new ApiError( 'credentials_rejected', 'HubSpot did not accept the access data.', 400 ) ) ) } );
		dialog = await open( refused, 'HubSpot' );
		await act( async () => button( 'Test', dialog ).click() );
		await settle();
		expect( dialog.querySelector( '.ffxb-notice--danger' )?.textContent ).toBe( 'HubSpot did not accept the access data.' );
	} );

	it( 'says when a tool cannot be checked without an entry', async () => {
		const api = crmApi( { crmOptions: vi.fn( async () => ( { checked: false, options: {} } ) ) } );
		const dialog = await open( api, 'HubSpot' );
		await act( async () => button( 'Test', dialog ).click() );
		await settle();
		expect( dialog.querySelector( '.ffxb-notice--info' )?.textContent ).toContain( 'Send a test entry' );
	} );

	it( 'changes the name and keeps the stored access data', async () => {
		const api = crmApi();
		const dialog = await open( api, 'HubSpot' );
		await act( async () => button( 'Edit', dialog ).click() );
		await settle();
		const change = container.querySelector( 'dialog[aria-label="Change connection"]' ) as HTMLDialogElement;
		await type( field( change, 'Name' ), 'Marketing' );
		await act( async () => button( 'Save', change ).click() );
		await settle();
		expect( api.connect.updateCrmConnection ).toHaveBeenCalledWith( hubspot.ref, { label: 'Marketing', credentials: {} } );
	} );

	it( 'deletes a connection after asking, but not one from Funnelforms 3', async () => {
		const api = crmApi( {}, [ hubspot, legacy ] );
		const dialog = await open( api, 'HubSpot' );
		const [ row, old ] = [ ...dialog.querySelectorAll<HTMLElement>( '.ffx-hub-connection' ) ] as [ HTMLElement, HTMLElement ];
		expect( old.textContent ).toContain( 'From Funnelforms 3' );
		expect( [ ...old.querySelectorAll( 'button' ) ].map( ( b ) => b.textContent ) ).toEqual( [ 'Test', 'Edit' ] );
		await act( async () => button( 'Delete', row ).click() );
		expect( row.textContent ).toContain( 'These stop working: Kurs buchen.' );
		await act( async () => button( 'Delete connection', row ).click() );
		await settle();
		expect( api.connect.deleteCrmConnection ).toHaveBeenCalledWith( hubspot.ref );
		expect( api.deleteConnection ).not.toHaveBeenCalled();
	} );

	it( 'connects Google Sheets by signing in through a window instead of asking for keys', async () => {
		const popup = { closed: false, location: { href: '' }, close: vi.fn() };
		vi.spyOn( window, 'open' ).mockReturnValue( popup as unknown as Window );
		const api = crmApi( { startCrmSignIn: vi.fn( async () => ( { url: 'https://broker.example/auth', state: 'st-1' } ) ) }, [] );
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Google Sheets' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Add connection"]' ) as HTMLDialogElement;
		expect( dialog.textContent ).toContain( 'Sign in with Google.' );
		expect( [ ...dialog.querySelectorAll( 'input' ) ] ).toHaveLength( 0 );
		await act( async () => button( 'Sign in with Google', dialog ).click() );
		await settle();
		expect( popup.location.href ).toBe( 'https://broker.example/auth' );
		await act( async () => {
			window.dispatchEvent( new MessageEvent( 'message', { origin: window.location.origin, data: { source: 'funnelforms-crm', state: 'st-1', ok: true, connection: { ref: 'googlesheets:g1', provider: 'googlesheets', label: 'ada@example.com' } } } ) );
		} );
		await settle();
		expect( popup.close ).toHaveBeenCalled();
		expect( container.textContent ).toContain( 'ada@example.com was saved.' );
		vi.restoreAllMocks();
	} );
} );

describe( 'Telegram in the overview', () => {
	const token = '10000:fake-token-for-tests-only-not-a-secret-0000';
	const bot: HubConnection = { ref: 'telegram:6d3f8b21-4c5e-4f70-9a8b-1c2d3e4f5a6b', type: 'telegram', label: 'Vertrieb Nord', createdAt: '2026-11-20T09:00:00Z', forms: [], formCount: 0, attention: null, chat: 'Vertrieb Nord' };
	const chat = ( dialog: HTMLElement ): HTMLSelectElement => field( dialog, 'Chat' ) as unknown as HTMLSelectElement;
	const choose = async ( select: HTMLSelectElement, value: string ): Promise<void> => {
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( select, value );
			select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
	};
	const messages = (): Array<string | null> => {
		const group = [ ...container.querySelectorAll( '.ffx-hub-group' ) ].find( ( g ) => 'Messages' === g.querySelector( 'h3' )?.textContent );
		return group ? [ ...group.querySelectorAll( '.ffx-hub-tile strong' ) ].map( ( s ) => s.textContent ) : [];
	};

	it( 'shows the tile only where the host can find the chat of a bot, or a bot is connected', async () => {
		await act( async () => root.render( <IntegrationsHub api={ fakeApi() } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		expect( messages() ).toEqual( [ 'Slack', 'Microsoft Teams', 'WhatsApp Business', 'Twilio', 'Bird', 'ElevenLabs' ] );
		await act( async () => root.render( <IntegrationsHub api={ fakeApi( {}, { telegramChats: vi.fn( async () => [] ) } ) } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		expect( messages() ).toEqual( [ 'Slack', 'Microsoft Teams', 'Telegram', 'WhatsApp Business', 'Twilio', 'Bird', 'ElevenLabs' ] );
		await act( async () => root.render( <IntegrationsHub key="other" api={ fakeApi( { overview: vi.fn( async () => overview( { connections: [ bot ] } ) ) } ) } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		expect( tile( 'Telegram' ).textContent ).toContain( 'Connected' );
	} );

	it( 'connects a bot: checks the token, finds its chat and takes the name of the group', async () => {
		// Called as a method of the API, as the REST adapter (a class) needs.
		const telegramChats = vi.fn( async function ( this: HubScreenApi | undefined ) {
			if ( ! this?.hub ) {
				throw new Error( 'Called without the API' );
			}
			return [ { id: '-1001234567890', title: 'Vertrieb Nord', type: 'channel' as const } ];
		} );
		const api = fakeApi( { overview: vi.fn( async () => overview( { connections: [] } ) ) }, { telegramChats } );
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Telegram' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Telegram"]' ) as HTMLDialogElement;
		expect( dialog.textContent ).toContain( 'In Telegram open @BotFather, create a bot with /newbot' );
		expect( dialog.querySelector( 'a[href="https://t.me/BotFather"]' )?.textContent ).toContain( 'Open Telegram' );
		expect( field( dialog, 'Name' ).value ).toBe( 'Telegram' );
		expect( field( dialog, 'Bot token' ).type ).toBe( 'password' );
		// Nothing is asked before the token has the form of a token.
		expect( button( 'Find chat', dialog ).disabled ).toBe( true );
		await type( field( dialog, 'Bot token' ), '12345:short' );
		expect( button( 'Find chat', dialog ).disabled ).toBe( true );
		expect( dialog.textContent ).toContain( 'This is not a bot token.' );
		await type( field( dialog, 'Bot token' ), ' ' + token + ' ' );
		await act( async () => button( 'Find chat', dialog ).click() );
		await settle();
		expect( telegramChats ).toHaveBeenCalledWith( { botToken: token } );
		// One group or channel is taken right away, named with its kind; a channel names the connection.
		expect( dialog.querySelector( '.ffxb-notice--success' )?.textContent ).toBe( 'Chat found: Vertrieb Nord (Telegram channel).' );
		expect( dialog.querySelector( '.ffxb-notice--warning' ) ).toBeNull();
		expect( field( dialog, 'Chat ID' ).value ).toBe( '-1001234567890' );
		expect( field( dialog, 'Name' ).value ).toBe( 'Vertrieb Nord' );
		await act( async () => button( 'Connect', dialog ).click() );
		await settle();
		expect( api.createConnection ).toHaveBeenCalledWith( 'telegram', 'Vertrieb Nord', { botToken: token, chatId: '-1001234567890', chatTitle: 'Vertrieb Nord' } );
	} );

	it( 'takes a private chat found alone only when chosen, and a chat ID typed by hand without its name', async () => {
		const telegramChats = vi.fn( async () => [ { id: '123456789', title: 'Erika Beispiel', type: 'private' as const, public: false } ] );
		const api = fakeApi( { overview: vi.fn( async () => overview( { connections: [] } ) ) }, { telegramChats } );
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Telegram' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Telegram"]' ) as HTMLDialogElement;
		await type( field( dialog, 'Bot token' ), token );
		await act( async () => button( 'Find chat', dialog ).click() );
		await settle();
		// Anyone can write to a bot: a private chat found alone could be a stranger's, so it is not taken.
		expect( field( dialog, 'Chat ID' ).value ).toBe( '' );
		expect( dialog.querySelector( '.ffxb-notice--success' ) ).toBeNull();
		expect( [ ...chat( dialog ).options ].map( ( o ) => o.textContent ) ).toEqual( [ 'Choose…', 'Erika Beispiel (Private chat)' ] );
		await choose( chat( dialog ), '123456789' );
		// The name of a person does not name the connection.
		expect( field( dialog, 'Name' ).value ).toBe( 'Telegram' );
		expect( field( dialog, 'Chat ID' ).value ).toBe( '123456789' );
		expect( dialog.querySelector( '.ffxb-notice--success' )?.textContent ).toBe( 'Chat found: Erika Beispiel (Private chat).' );
		await type( field( dialog, 'Chat ID' ), '@vertrieb_news' );
		// Typed by hand: the chat found is no longer named as chosen, and a @name is a public chat.
		expect( dialog.querySelector( '.ffxb-notice--success' ) ).toBeNull();
		expect( chat( dialog ).value ).toBe( '' );
		expect( dialog.querySelector( '.ffxb-notice--warning' )?.textContent ).toBe( 'This chat is public: anyone can read the entries there, with their answers and contact details. Choose a private group or channel.' );
		await act( async () => button( 'Connect', dialog ).click() );
		await settle();
		expect( api.createConnection ).toHaveBeenCalledWith( 'telegram', 'Telegram', { botToken: token, chatId: '@vertrieb_news' } );
	} );

	it( 'warns of public chats and forgets the chats of a bot once another token is typed in', async () => {
		const other = '20000:other-fake-token-for-tests-only-000000';
		let late: ( chats: Array<{ id: string; title: string; type: 'channel' }> ) => void = () => undefined;
		const telegramChats = vi
			.fn()
			.mockResolvedValueOnce( [
				{ id: '-1009876543210', title: 'Neue Leads', type: 'channel', public: true },
				{ id: '-4012345678', title: 'Team Nord', type: 'group', public: false },
			] )
			.mockImplementationOnce( () => new Promise( ( resolve ) => ( late = resolve ) ) );
		const api = fakeApi( { overview: vi.fn( async () => overview( { connections: [] } ) ) }, { telegramChats } );
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Telegram' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Telegram"]' ) as HTMLDialogElement;
		await type( field( dialog, 'Bot token' ), token );
		await act( async () => button( 'Find chat', dialog ).click() );
		await settle();
		await choose( chat( dialog ), '-1009876543210' );
		expect( dialog.querySelector( '.ffxb-notice--warning' )?.textContent ).toContain( 'This chat is public' );
		await choose( chat( dialog ), '-4012345678' );
		expect( dialog.querySelector( '.ffxb-notice--warning' ) ).toBeNull();

		// Another bot: the chats of the first one cannot be chosen any more.
		await type( field( dialog, 'Bot token' ), other );
		expect( dialog.textContent ).not.toContain( 'Chats found' );
		expect( [ ...dialog.querySelectorAll( 'label' ) ].map( ( l ) => l.textContent ) ).not.toContain( 'Chat' );
		// An answer that comes after the token changed is about another bot: nothing is filled in.
		await act( async () => button( 'Find chat', dialog ).click() );
		expect( telegramChats ).toHaveBeenLastCalledWith( { botToken: other } );
		await type( field( dialog, 'Bot token' ), token );
		await act( async () => late( [ { id: '-1001111111111', title: 'Kanal', type: 'channel' } ] ) );
		await settle();
		expect( field( dialog, 'Chat ID' ).value ).toBe( '-4012345678' );
		expect( dialog.querySelector( '.ffxb-notice--success' ) ).toBeNull();
		expect( dialog.textContent ).not.toContain( 'Kanal' );
	} );

	it( 'shows the chat of a connection, tests it and asks the saved bot without its token', async () => {
		const telegramChats = vi.fn().mockResolvedValueOnce( [] ).mockRejectedValueOnce( new ApiError( 'bot_in_use', 'This bot already passes its messages to another program (a webhook or another tool), so they cannot be read here. Enter the chat ID by hand.', 409 ) );
		const api = fakeApi( { overview: vi.fn( async () => overview( { connections: [ bot ] } ) ) }, { telegramChats } );
		await act( async () => root.render( <IntegrationsHub api={ api } config={ config } onCalendar={ () => undefined } /> ) );
		await settle();
		await act( async () => tile( 'Telegram' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Telegram"]' ) as HTMLDialogElement;
		const row = dialog.querySelector( '.ffx-hub-connection' ) as HTMLElement;
		expect( row.textContent ).toContain( 'Chat: Vertrieb Nord' );
		await act( async () => button( 'Send test', row ).click() );
		await settle();
		expect( api.testConnection ).toHaveBeenCalledWith( bot.ref, {} );
		await act( async () => button( 'Edit', row ).click() );
		expect( field( dialog, 'Bot token' ).placeholder ).toBe( 'Unchanged' );
		await act( async () => button( 'Find chat', dialog ).click() );
		await settle();
		expect( telegramChats ).toHaveBeenLastCalledWith( { ref: bot.ref } );
		expect( dialog.textContent ).toContain( 'No chat found yet.' );
		await act( async () => button( 'Find chat', dialog ).click() );
		await settle();
		expect( dialog.querySelector( '.ffxb-notice--danger' )?.textContent ).toContain( 'This bot already passes its messages to another program' );
		// No token anywhere on the page.
		expect( dialog.innerHTML ).not.toContain( token );
	} );
} );
