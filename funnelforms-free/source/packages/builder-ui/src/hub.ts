/**
 * The overview of Funnelforms → Integrations: the services a form can use, by category, with the
 * connections the site has for each, what uses them and what they still need. Types of the REST
 * routes (plugin/src/Http/IntegrationsController.php), a client for them and the rules the screen
 * uses to group, filter and count.
 */
import type { CrmProvider } from './connect';

export interface HubForm {
	id: number;
	title: string;
}

export interface HubConnection {
	ref: string;
	type: string;
	label: string;
	createdAt: string;
	/** Forms whose draft or published version uses it (the first ones). */
	forms: HubForm[];
	formCount: number;
	/** Payments: test keys or the PayPal sandbox. */
	testMode?: boolean;
	/** What it still needs: the Stripe webhook, or signing in to Google again. */
	attention: 'webhook_missing' | 'sign_in_again' | null;
	/** Stripe: the address of its webhook endpoint. */
	webhookUrl?: string;
	/** CalDAV: icloud for Apple iCloud. */
	service?: string;
}

/** A form plugin with forms on this site. */
export interface HubImport {
	source: string;
	label: string;
	forms: number;
	imported: number;
}

export interface HubOverview {
	connections: HubConnection[];
	imports: HubImport[];
	website: { connected: boolean };
}

export interface PaymentCheck {
	ok: true;
	testMode: boolean;
	/** Stripe: the name of the account, when the key may read it. */
	account: string;
	/** Mollie: the payment methods switched on. */
	methods: string[];
}

export interface HubApi {
	overview(): Promise<HubOverview>;
	/** Asks Stripe, PayPal or Mollie whether the keys work; fails with credentials_rejected and others. */
	checkPayment( ref: string ): Promise<PaymentCheck>;
	/** Registers the webhook endpoint in the Stripe account and stores its signing secret. */
	setUpStripeWebhook( ref: string ): Promise<{ ok: true; webhookUrl: string; replaced: boolean }>;
}

type Request = <T>( method: 'GET' | 'POST', path: string, body?: unknown ) => Promise<T>;

/** The client over a request function that takes paths below funnelforms/v1 ("~/integrations"). */
export function createHubApi( request: Request ): HubApi {
	return {
		overview: () => request( 'GET', '~/integrations' ),
		checkPayment: ( ref ) => request( 'POST', '~/integrations/' + ref + '/check' ),
		setUpStripeWebhook: ( ref ) => request( 'POST', '~/integrations/' + ref + '/stripe-webhook' ),
	};
}

export type HubCategory = 'payments' | 'crm' | 'newsletter' | 'spreadsheet' | 'calendars' | 'messages' | 'tracking' | 'automation';

export const HUB_CATEGORIES: HubCategory[] = [ 'payments', 'crm', 'newsletter', 'spreadsheet', 'calendars', 'messages', 'tracking', 'automation' ];

/**
 * A service of the overview. connection: credentials typed in here (ConnectionsController);
 * crm: a CRM, newsletter or spreadsheet tool (CrmController); calendar: the calendar section of
 * the page; link: set up on another page.
 */
export interface HubService {
	id: string;
	/** Brand name; not translated. */
	name: string;
	category: HubCategory;
	kind: 'connection' | 'crm' | 'calendar' | 'link';
	/** Connection types that count for it. */
	types: string[];
	/** Where the customer finds the keys. */
	dashboard?: string;
	/** Short mark on the tile and its colour. */
	mark: string;
	color: string;
}

/** The services that are not CRM tools; those come from the catalog of the server. */
export const SERVICES: HubService[] = [
	{ id: 'stripe', name: 'Stripe', category: 'payments', kind: 'connection', types: [ 'stripe' ], dashboard: 'https://dashboard.stripe.com/apikeys', mark: 'S', color: '#635bff' },
	{ id: 'paypal', name: 'PayPal', category: 'payments', kind: 'connection', types: [ 'paypal' ], dashboard: 'https://developer.paypal.com/dashboard/applications', mark: 'P', color: '#003087' },
	{ id: 'mollie', name: 'Mollie', category: 'payments', kind: 'connection', types: [ 'mollie' ], dashboard: 'https://my.mollie.com/dashboard/developers/api-keys', mark: 'M', color: '#0a0a0a' },
	{ id: 'google', name: 'Google Calendar', category: 'calendars', kind: 'calendar', types: [ 'google' ], mark: 'G', color: '#1a73e8' },
	{ id: 'microsoft', name: 'Microsoft Outlook', category: 'calendars', kind: 'calendar', types: [ 'microsoft' ], mark: 'O', color: '#0078d4' },
	{ id: 'icloud', name: 'Apple iCloud', category: 'calendars', kind: 'calendar', types: [ 'caldav' ], mark: '', color: '#6e6e73' },
	{ id: 'caldav', name: 'CalDAV', category: 'calendars', kind: 'calendar', types: [ 'caldav' ], mark: '', color: '#4b5563' },
	{ id: 'slack', name: 'Slack', category: 'messages', kind: 'connection', types: [ 'slack' ], dashboard: 'https://api.slack.com/messaging/webhooks', mark: 'S', color: '#4a154b' },
	{ id: 'teams', name: 'Microsoft Teams', category: 'messages', kind: 'connection', types: [ 'teams' ], mark: 'T', color: '#5b5fc7' },
	{ id: 'whatsapp', name: 'WhatsApp Business', category: 'messages', kind: 'connection', types: [ 'whatsapp' ], dashboard: 'https://business.facebook.com/wa/manage/home/', mark: 'W', color: '#25d366' },
	{ id: 'twilio', name: 'Twilio', category: 'messages', kind: 'connection', types: [ 'twilio' ], dashboard: 'https://console.twilio.com/', mark: 'T', color: '#f22f46' },
	{ id: 'bird', name: 'Bird', category: 'messages', kind: 'connection', types: [ 'bird' ], dashboard: 'https://app.bird.com/', mark: 'B', color: '#0b0b0b' },
	{ id: 'meta', name: 'Meta', category: 'tracking', kind: 'connection', types: [ 'meta' ], dashboard: 'https://business.facebook.com/events_manager2', mark: 'M', color: '#0866ff' },
	{ id: 'ga4', name: 'Google Analytics 4', category: 'tracking', kind: 'connection', types: [ 'ga4' ], dashboard: 'https://analytics.google.com/', mark: 'G', color: '#e37400' },
	{ id: 'tiktok', name: 'TikTok', category: 'tracking', kind: 'connection', types: [ 'tiktok' ], dashboard: 'https://ads.tiktok.com/i18n/events_manager', mark: 'T', color: '#010101' },
	{ id: 'automation', name: 'Zapier, Make, n8n', category: 'automation', kind: 'link', types: [], mark: '', color: '#ff4f00' },
];

/** Colours of the CRM tools on their tiles. */
const CRM_COLORS: Record<string, string> = {
	hubspot: '#ff7a59',
	pipedrive: '#017737',
	activecampaign: '#356ae6',
	mailchimp: '#241c15',
	klicktipp: '#e8590c',
	brevo: '#0b996e',
	cleverreach: '#ef7d00',
	getresponse: '#00baff',
	googlesheets: '#0f9d58',
};

/** All services: the fixed ones with the CRM tools of the server in their categories. */
export function hubServices( providers: CrmProvider[] ): HubService[] {
	const crm: HubService[] = providers.map( ( p ) => ( {
		id: p.provider,
		name: p.label,
		category: p.category,
		kind: 'crm',
		types: [ p.provider ],
		mark: p.label.charAt( 0 ).toUpperCase(),
		color: CRM_COLORS[ p.provider ] ?? '#4b5563',
	} ) );
	return HUB_CATEGORIES.flatMap( ( c ) => [ ...SERVICES, ...crm ].filter( ( s ) => s.category === c ) );
}

/** Which service a connection belongs to (CalDAV at iCloud is Apple iCloud). */
export function serviceOfConnection( connection: HubConnection ): string {
	return 'caldav' === connection.type ? connection.service ?? 'caldav' : connection.type;
}

export function connectionsOf( service: HubService, connections: HubConnection[] ): HubConnection[] {
	return connections.filter( ( c ) => service.types.includes( c.type ) && ( 'calendar' !== service.kind || serviceOfConnection( c ) === service.id ) );
}

export interface HubFilter {
	query: string;
	category: HubCategory | 'all';
	connectedOnly: boolean;
}

/** The services that match the search (name or category name), category and the connected filter. */
export function filterServices( services: HubService[], filter: HubFilter, connections: HubConnection[], categoryName: ( c: HubCategory ) => string ): HubService[] {
	const query = filter.query.trim().toLowerCase();
	return services.filter(
		( s ) =>
			( 'all' === filter.category || s.category === filter.category ) &&
			( ! filter.connectedOnly || connectionsOf( s, connections ).length > 0 ) &&
			( '' === query || s.name.toLowerCase().includes( query ) || s.id.includes( query ) || categoryName( s.category ).toLowerCase().includes( query ) )
	);
}

/** The figures above the tiles: connections, those forms use, and those that need something. */
export function hubSummary( connections: HubConnection[] ): { connected: number; inUse: number; attention: number } {
	return {
		connected: connections.length,
		inUse: connections.filter( ( c ) => c.formCount > 0 ).length,
		attention: connections.filter( ( c ) => null !== c.attention ).length,
	};
}

/** Forms of other plugins that are not imported yet, and the plugins they are in. */
export function importable( imports: HubImport[] ): { forms: number; plugins: string[] } {
	const open = imports.filter( ( i ) => i.forms > i.imported );
	return { forms: open.reduce( ( n, i ) => n + i.forms - i.imported, 0 ), plugins: open.map( ( i ) => i.label ) };
}

/** Connections created on this site (not brought over from Funnelforms 3) can be deleted. */
export function deletable( ref: string ): boolean {
	return /^[a-z0-9]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test( ref );
}
