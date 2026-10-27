/**
 * The overview at the top of Funnelforms → Integrations: every service a form can use, by
 * category, with search and a filter for what is connected. Each tile says whether the site is
 * connected, whether it runs in test mode and whether something is missing; a click opens the
 * service with where to find the keys, the connections with the forms that use them, and the
 * form to connect. Payments are checked with the provider right away, and the Stripe webhook is
 * set up with one click. Calendars open the calendar section below; CRM tools their dialog. This
 * is the only place for CRM, newsletter and spreadsheet connections: they are added, changed,
 * tested and deleted here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormsApi } from '../api';
import type { ConnectApi, CrmConnection, CrmProvider } from '../connect';
import { connectionsOf, deletable, filterServices, hubServices, hubSummary, importable, HUB_CATEGORIES, type HubApi, type HubCategory, type HubConnection, type HubOverview, type HubService } from '../hub';
import type { CalendarService } from './BookingTypes';
import { CrmConnectionDialog } from './CrmConnections';
import { __, sprintf } from './i18n';
import { Button, Dialog, Notice, Spinner, TextInput, Toggle } from './ui';

export interface HubConfig {
	interfacesUrl?: string;
	importUrl?: string;
	builderUrl?: string;
}

/** What the overview needs of the API. */
export type HubScreenApi = Pick<FormsApi, 'createConnection' | 'updateConnection'> & Required<Pick<FormsApi, 'deleteConnection' | 'testConnection'>> & { hub: HubApi; connect: ConnectApi };

const message = ( e: unknown ): string => ( e instanceof Error ? e.message : String( e ) );

const PATHS = {
	search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
	calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
	bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
	upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
	external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
};

function Icon( { name }: { name: keyof typeof PATHS } ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
			<path d={ PATHS[ name ] } />
		</svg>
	);
}

export function categoryName( category: HubCategory ): string {
	const names: Record<HubCategory, string> = {
		payments: __( 'Payments', 'funnelforms-pro' ),
		crm: __( 'CRM', 'funnelforms-pro' ),
		newsletter: __( 'Newsletter', 'funnelforms-pro' ),
		spreadsheet: __( 'Spreadsheets', 'funnelforms-pro' ),
		calendars: __( 'Calendars', 'funnelforms-pro' ),
		messages: __( 'Messages', 'funnelforms-pro' ),
		tracking: __( 'Conversion tracking', 'funnelforms-pro' ),
		automation: __( 'Automation', 'funnelforms-pro' ),
	};
	return names[ category ];
}

/** One line under the name of a tile. */
function hint( service: HubService ): string {
	const hints: Record<string, string> = {
		stripe: __( 'Cards, Apple Pay, Google Pay, SEPA, Klarna and subscriptions', 'funnelforms-pro' ),
		paypal: __( 'PayPal, Pay Later and cards', 'funnelforms-pro' ),
		mollie: __( 'iDEAL, Bancontact, cards, SEPA and more', 'funnelforms-pro' ),
		google: __( 'Google Workspace and Gmail', 'funnelforms-pro' ),
		microsoft: __( 'Microsoft 365, Outlook.com and Exchange Online', 'funnelforms-pro' ),
		icloud: __( 'With an app-specific password', 'funnelforms-pro' ),
		caldav: __( 'Nextcloud, Fastmail, mailbox.org and more', 'funnelforms-pro' ),
		slack: __( 'A message in a channel for each entry', 'funnelforms-pro' ),
		teams: __( 'A message in a channel for each entry', 'funnelforms-pro' ),
		whatsapp: __( 'WhatsApp message', 'funnelforms-pro' ),
		twilio: __( 'Text message (SMS)', 'funnelforms-pro' ),
		bird: __( 'Text message (SMS)', 'funnelforms-pro' ),
		meta: __( 'Conversions from the server, with consent', 'funnelforms-pro' ),
		ga4: __( 'Conversions from the server, with consent', 'funnelforms-pro' ),
		tiktok: __( 'Conversions from the server, with consent', 'funnelforms-pro' ),
		automation: __( 'Webhooks and API tokens for Zapier, Make, n8n and your own tools', 'funnelforms-pro' ),
	};
	const byCategory: Partial<Record<HubCategory, string>> = {
		crm: __( 'Contacts and deals in your CRM', 'funnelforms-pro' ),
		newsletter: __( 'Subscribers for your lists, with double opt-in', 'funnelforms-pro' ),
		spreadsheet: __( 'Each entry as a row', 'funnelforms-pro' ),
	};
	return hints[ service.id ] ?? byCategory[ service.category ] ?? '';
}

/**
 * Where a connected service is used: the place in the form builder, or the page that uses it.
 * Empty for services the page itself uses (calendars) or that are set up elsewhere.
 */
export function usage( service: Pick<HubService, 'id' | 'category' | 'kind'> ): string {
	if ( 'payments' === service.category ) {
		return __( 'In the form builder open Settings → Payment and choose this connection. The form then asks for the payment before the entry is sent.', 'funnelforms-pro' );
	}
	if ( 'twilio' === service.id || 'bird' === service.id ) {
		return __( 'In the form builder select the contact step and open “After sending”: the connection is listed under “Your connected tools” and sends a text message for each entry, to you or to the visitor. A phone field can also confirm numbers by text message.', 'funnelforms-pro' );
	}
	if ( 'crm' === service.kind || 'messages' === service.category || 'tracking' === service.category ) {
		return __( 'In the form builder select the contact step and open “After sending”: the connection is listed under “Your connected tools”. One click adds it, and every entry of the form goes there.', 'funnelforms-pro' );
	}
	return '';
}

/** Where the customer finds the keys of a connection type. */
function steps( type: string ): string {
	const all: Record<string, string> = {
		stripe: __( 'In Stripe open Developers → API keys and copy the secret key. Funnelforms then sets up the webhook for payments, refunds and subscriptions itself.', 'funnelforms-pro' ),
		paypal: __( 'In the PayPal developer dashboard open Apps & Credentials, create an app and copy its client ID and secret. A sandbox app takes test payments.', 'funnelforms-pro' ),
		mollie: __( 'In Mollie open Developers → API keys and copy the live or test API key of your website profile.', 'funnelforms-pro' ),
		slack: __( 'In Slack create an incoming webhook for the channel and paste its address here.', 'funnelforms-pro' ),
		teams: __( 'In Teams add the workflow “Post to a channel when a webhook request is received” to the channel and paste its address here.', 'funnelforms-pro' ),
		whatsapp: __( 'In the WhatsApp Manager of Meta open API Setup and copy the phone number ID and a permanent access token of a system user.', 'funnelforms-pro' ),
		twilio: __( 'In the Twilio console copy the account SID and the auth token from the account info.', 'funnelforms-pro' ),
		bird: __( 'In Bird open Settings → Developer and copy the workspace ID, the channel ID of your SMS channel and an access key.', 'funnelforms-pro' ),
		meta: __( 'In the Meta Events Manager open your pixel, then Settings → Conversions API: copy the pixel ID and generate an access token.', 'funnelforms-pro' ),
		ga4: __( 'In Google Analytics open Admin → Data streams → your web stream, copy the measurement ID and create a Measurement Protocol API secret.', 'funnelforms-pro' ),
		tiktok: __( 'In the TikTok Events Manager open your pixel, then Settings: copy the pixel code and generate an access token.', 'funnelforms-pro' ),
	};
	return all[ type ] ?? '';
}

/** Credentials each connection type asks for: parameter, label, secret, optional (as in the form builder). */
function credentials( type: string ): Array<[ string, string, boolean, boolean? ]> {
	const webhook = __( 'Webhook URL', 'funnelforms-pro' );
	const accessKey = __( 'Access key', 'funnelforms-pro' );
	const accessToken = __( 'Access token', 'funnelforms-pro' );
	const all: Record<string, Array<[ string, string, boolean, boolean? ]>> = {
		slack: [ [ 'url', webhook, true ] ],
		teams: [ [ 'url', webhook, true ] ],
		twilio: [
			[ 'accountSid', __( 'Account SID', 'funnelforms-pro' ), false ],
			[ 'authToken', __( 'Auth token', 'funnelforms-pro' ), true ],
		],
		bird: [
			[ 'workspaceId', __( 'Workspace ID', 'funnelforms-pro' ), false ],
			[ 'channelId', __( 'Channel ID', 'funnelforms-pro' ), false ],
			[ 'accessKey', accessKey, true ],
		],
		whatsapp: [
			[ 'phoneNumberId', __( 'Phone number ID', 'funnelforms-pro' ), false ],
			[ 'accessToken', accessToken, true ],
			[ 'businessAccountId', __( 'WhatsApp Business account ID (for templates)', 'funnelforms-pro' ), false, true ],
		],
		meta: [
			[ 'pixelId', __( 'Pixel ID', 'funnelforms-pro' ), false ],
			[ 'accessToken', accessToken, true ],
		],
		ga4: [
			[ 'measurementId', __( 'Measurement ID', 'funnelforms-pro' ), false ],
			[ 'apiSecret', __( 'API secret', 'funnelforms-pro' ), true ],
		],
		tiktok: [
			[ 'pixelCode', __( 'Pixel code', 'funnelforms-pro' ), false ],
			[ 'accessToken', accessToken, true ],
		],
		stripe: [ [ 'secretKey', __( 'Secret key (sk_… or rk_…)', 'funnelforms-pro' ), true ] ],
		paypal: [
			[ 'clientId', __( 'Client ID', 'funnelforms-pro' ), false ],
			[ 'clientSecret', __( 'Client secret', 'funnelforms-pro' ), true ],
		],
		mollie: [ [ 'apiKey', __( 'API key (live_… or test_…)', 'funnelforms-pro' ), true ] ],
	};
	return all[ type ] ?? [];
}

const PAYMENTS = [ 'stripe', 'paypal', 'mollie' ];
const SMS = [ 'twilio', 'bird' ];

function Mark( { service }: { service: HubService } ) {
	return (
		<span className="ffx-hub-mark" style={ { '--ffx-hub-color': service.color } as React.CSSProperties } aria-hidden="true">
			{ service.mark || <Icon name={ 'automation' === service.id ? 'bolt' : 'calendar' } /> }
		</span>
	);
}

function States( { list }: { list: HubConnection[] } ) {
	if ( ! list.length ) {
		return null;
	}
	return (
		<span className="ffx-hub-states">
			<span className="ffx-badge ffx-badge--success">{ list.length > 1 ? __( 'Connected', 'funnelforms-pro' ) + ' · ' + list.length : __( 'Connected', 'funnelforms-pro' ) }</span>
			{ list.some( ( c ) => null !== c.attention ) ? <span className="ffx-badge ffx-badge--danger">{ __( 'Needs attention', 'funnelforms-pro' ) }</span> : null }
			{ list.some( ( c ) => c.testMode ) ? <span className="ffx-badge ffx-badge--warning">{ __( 'Test mode', 'funnelforms-pro' ) }</span> : null }
		</span>
	);
}

type Result = { tone: 'success' | 'danger' | 'warning' | 'info'; text: string };

export function IntegrationsHub( { api, config, onCalendar, stamp }: { api: HubScreenApi; config: HubConfig; onCalendar: ( service: CalendarService ) => void; stamp?: unknown } ) {
	const [ data, setData ] = useState<HubOverview | null>( null );
	const [ providers, setProviders ] = useState<CrmProvider[]>( [] );
	const [ error, setError ] = useState<string | null>( null );
	const [ query, setQuery ] = useState( '' );
	const [ category, setCategory ] = useState<HubCategory | 'all'>( 'all' );
	const [ connectedOnly, setConnectedOnly ] = useState( false );
	const [ open, setOpen ] = useState<string | null>( null );
	const [ crm, setCrm ] = useState<{ provider: string; connection?: CrmConnection } | null>( null );
	const [ results, setResults ] = useState<Record<string, Result>>( {} );
	const [ busy, setBusy ] = useState<string | null>( null );
	const [ said, say ] = useState( '' );

	const reload = useCallback( async (): Promise<void> => {
		setError( null );
		try {
			setData( await api.hub.overview() );
		} catch ( e ) {
			setError( message( e ) );
		}
	}, [ api ] );

	useEffect( () => {
		void reload();
		api.connect.crmProviders().then( setProviders, () => setProviders( [] ) );
	}, [ api, reload ] );

	// Calendars change in the section below; the counts follow (not on the first answer).
	const seen = useRef( false );
	useEffect( () => {
		if ( undefined === stamp || null === stamp ) {
			return;
		}
		if ( seen.current ) {
			void reload();
		}
		seen.current = true;
	}, [ stamp, reload ] );

	const services = useMemo( () => hubServices( providers ), [ providers ] );
	const connections = data?.connections ?? [];
	const shown = filterServices( services, { query, category, connectedOnly }, connections, categoryName );
	const figures = hubSummary( connections );
	const toImport = importable( data?.imports ?? [] );
	const service = services.find( ( s ) => s.id === open ) ?? null;
	const nameOf = ( type: string ): string => services.find( ( s ) => s.types.includes( type ) )?.name ?? type;

	const note = ( ref: string, result: Result | null ): void =>
		setResults( ( r ) => {
			if ( result ) {
				return { ...r, [ ref ]: result };
			}
			return Object.fromEntries( Object.entries( r ).filter( ( [ key ] ) => key !== ref ) );
		} );

	/** Asks the provider whether the keys work; for Stripe then sets up the webhook when it is missing. */
	const checkPayment = async ( connection: Pick<HubConnection, 'ref' | 'type'>, webhook: boolean ): Promise<void> => {
		setBusy( connection.ref );
		note( connection.ref, null );
		try {
			const check = await api.hub.checkPayment( connection.ref );
			const lines = [ __( 'The keys work.', 'funnelforms-pro' ) ];
			if ( check.account ) {
				lines.push( sprintf( __( 'Account: %s.', 'funnelforms-pro' ), check.account ) );
			}
			if ( check.methods.length ) {
				lines.push( sprintf( __( 'Payment methods switched on: %s.', 'funnelforms-pro' ), check.methods.join( ', ' ) ) );
			}
			if ( check.testMode ) {
				lines.push( __( 'These are test keys: nothing is charged. Switch to the live keys before your form goes live.', 'funnelforms-pro' ) );
			}
			if ( webhook && 'stripe' === connection.type ) {
				try {
					await api.hub.setUpStripeWebhook( connection.ref );
					lines.push( __( 'The webhook is set up: Stripe now reports payments, refunds and subscriptions to this website.', 'funnelforms-pro' ) );
				} catch ( e ) {
					note( connection.ref, { tone: 'warning', text: lines.join( ' ' ) + ' ' + message( e ) } );
					return;
				}
			}
			note( connection.ref, { tone: check.testMode ? 'warning' : 'success', text: lines.join( ' ' ) } );
		} catch ( e ) {
			note( connection.ref, { tone: 'danger', text: message( e ) } );
		} finally {
			setBusy( null );
			await reload();
		}
	};

	const setUpWebhook = async ( ref: string ): Promise<void> => {
		setBusy( ref );
		note( ref, null );
		try {
			await api.hub.setUpStripeWebhook( ref );
			note( ref, { tone: 'success', text: __( 'The webhook is set up: Stripe now reports payments, refunds and subscriptions to this website.', 'funnelforms-pro' ) } );
			await reload();
		} catch ( e ) {
			note( ref, { tone: 'danger', text: message( e ) } );
		} finally {
			setBusy( null );
		}
	};

	const crmConnection = ( c: HubConnection ): CrmConnection => ( { ref: c.ref, provider: c.type, label: c.label, legacy: ! deletable( c.ref ), createdAt: c.createdAt, forms: c.formCount } );

	const openService = ( s: HubService ): void => {
		if ( 'calendar' === s.kind ) {
			onCalendar( s.id as CalendarService );
			return;
		}
		if ( 'crm' === s.kind && ! connectionsOf( s, connections ).length ) {
			setCrm( { provider: s.id } );
			return;
		}
		setOpen( s.id );
	};

	const attention = connections.filter( ( c ) => null !== c.attention );
	const groups: Array<[ HubCategory | null, HubService[] ]> = 'all' === category && '' === query.trim() ? HUB_CATEGORIES.map( ( c ) => [ c, shown.filter( ( s ) => s.category === c ) ] ) : [ [ null, shown ] ];

	return (
		<section className="ffx-card ffx-hub" aria-labelledby="ffx-hub-title">
			<div className="ffx-hub__top">
				<div>
					<h2 id="ffx-hub-title">{ __( 'All integrations', 'funnelforms-pro' ) }</h2>
					<p>{ __( 'Choose a service, paste its key and you are done. Each connection works in every form.', 'funnelforms-pro' ) }</p>
					<p className="ffx-hub__use">{ __( 'Then decide per form what happens with each entry: in the form builder select the contact step and open “After sending”, where your connected tools are ready to add.', 'funnelforms-pro' ) }</p>
				</div>
				{ data ? (
					<dl className="ffx-hub__figures">
						<div>
							<dt>{ __( 'Connections', 'funnelforms-pro' ) }</dt>
							<dd>{ figures.connected }</dd>
						</div>
						<div>
							<dt>{ __( 'Used in forms', 'funnelforms-pro' ) }</dt>
							<dd>{ figures.inUse }</dd>
						</div>
						<div className={ figures.attention ? 'is-warning' : '' }>
							<dt>{ __( 'Need attention', 'funnelforms-pro' ) }</dt>
							<dd>{ figures.attention }</dd>
						</div>
					</dl>
				) : null }
			</div>

			{ error ? (
				<div className="ffx-notice ffx-notice--danger" role="alert">
					<p>
						{ error }{ ' ' }
						<button type="button" className="ffx-link" onClick={ () => void reload() }>
							{ __( 'Try again', 'funnelforms-pro' ) }
						</button>
					</p>
				</div>
			) : null }
			{ ! error && ! data ? <Spinner label={ __( 'Loading…', 'funnelforms-pro' ) } /> : null }

			{ attention.length ? (
				<ul className="ffx-hub-todo">
					{ attention.map( ( c ) => (
						<li key={ c.ref }>
							<span>
								<strong>{ c.label }</strong> ({ nameOf( c.type ) }){ ' ' }
								{ 'webhook_missing' === c.attention ? __( 'Payments are confirmed through the webhook, also when visitors close the page. It is not set up yet.', 'funnelforms-pro' ) : __( 'Google no longer accepts this connection. Connect the account again.', 'funnelforms-pro' ) }
								{ results[ c.ref ] && 'danger' === results[ c.ref ]?.tone ? <span className="ffx-hub-todo__error">{ results[ c.ref ]?.text }</span> : null }
							</span>
							{ 'webhook_missing' === c.attention ? (
								<button type="button" className="ffx-btn ffx-btn--primary ffx-btn--sm" disabled={ busy === c.ref } onClick={ () => void setUpWebhook( c.ref ) }>
									{ busy === c.ref ? __( 'Setting up…', 'funnelforms-pro' ) : __( 'Set up webhook automatically', 'funnelforms-pro' ) }
								</button>
							) : (
								<button type="button" className="ffx-btn ffx-btn--sm" onClick={ () => setCrm( { provider: c.type, connection: crmConnection( c ) } ) }>
									{ __( 'Connect again', 'funnelforms-pro' ) }
								</button>
							) }
						</li>
					) ) }
				</ul>
			) : null }

			{ data && config.importUrl ? (
				<div className={ 'ffx-hub-import' + ( toImport.forms ? ' is-found' : '' ) }>
					<span className="ffx-hub-import__icon">
						<Icon name="upload" />
					</span>
					<div>
						<strong>{ toImport.forms ? sprintf( __( 'Forms from %s found on this website', 'funnelforms-pro' ), toImport.plugins.join( ', ' ) ) : __( 'Coming from another form plugin?', 'funnelforms-pro' ) }</strong>
						<p>{ toImport.forms ? __( 'Import them as drafts in a few clicks and check each one before it goes live.', 'funnelforms-pro' ) : __( 'Import forms of WPForms, Gravity Forms, Contact Form 7, Ninja Forms, Fluent Forms, Formidable and Elementor, from this website or from an export file.', 'funnelforms-pro' ) }</p>
					</div>
					{ toImport.forms ? <span className="ffx-hub-import__count">{ toImport.forms }</span> : null }
					<a className={ 'ffx-btn ffx-btn--sm' + ( toImport.forms ? ' ffx-btn--primary' : '' ) } href={ config.importUrl }>
						{ __( 'Import from other plugins', 'funnelforms-pro' ) }
					</a>
				</div>
			) : null }

			<div className="ffx-hub__tools">
				<label className="ffx-hub-search">
					<Icon name="search" />
					<span className="screen-reader-text">{ __( 'Search integrations', 'funnelforms-pro' ) }</span>
					<input type="search" value={ query } placeholder={ __( 'Search integrations', 'funnelforms-pro' ) } onChange={ ( e ) => setQuery( e.target.value ) } />
				</label>
				<div className="ffx-hub-chips" role="group" aria-label={ __( 'Categories', 'funnelforms-pro' ) }>
					{ ( [ 'all', ...HUB_CATEGORIES ] as Array<HubCategory | 'all'> ).map( ( c ) => (
						<button key={ c } type="button" className="ffx-hub-chip" aria-pressed={ category === c } onClick={ () => setCategory( c ) }>
							{ 'all' === c ? __( 'All', 'funnelforms-pro' ) : categoryName( c ) }
						</button>
					) ) }
				</div>
				<label className="ffx-hub-only">
					<input type="checkbox" checked={ connectedOnly } onChange={ ( e ) => setConnectedOnly( e.target.checked ) } />
					{ __( 'Connected only', 'funnelforms-pro' ) }
				</label>
			</div>

			{ data && ! shown.length ? <p className="ffx-hub-none">{ __( 'No integration matches your search.', 'funnelforms-pro' ) }</p> : null }
			{ data
				? groups
						.filter( ( [ , list ] ) => list.length )
						.map( ( [ c, list ] ) => (
							<div key={ c ?? 'found' } className="ffx-hub-group">
								{ c ? <h3>{ categoryName( c ) }</h3> : null }
								<ul className="ffx-hub-grid">
									{ list.map( ( s ) => (
										<li key={ s.id }>
											{ 'link' === s.kind ? (
												<a className="ffx-hub-tile" href={ config.interfacesUrl }>
													<Mark service={ s } />
													<span className="ffx-hub-tile__text">
														<strong>{ s.name }</strong>
														<span>{ hint( s ) }</span>
													</span>
												</a>
											) : (
												<button type="button" className="ffx-hub-tile" onClick={ () => openService( s ) }>
													<Mark service={ s } />
													<span className="ffx-hub-tile__text">
														<strong>{ s.name }</strong>
														<span>{ hint( s ) }</span>
													</span>
													<States list={ connectionsOf( s, connections ) } />
												</button>
											) }
										</li>
									) ) }
								</ul>
							</div>
						) )
				: null }
			<p className="screen-reader-text" aria-live="polite">
				{ said }
			</p>

			{ service ? (
				<ServicePanel
					service={ service }
					provider={ providers.find( ( p ) => p.provider === service.id ) }
					list={ connectionsOf( service, connections ) }
					api={ api }
					config={ config }
					results={ results }
					busy={ busy }
					onClose={ () => setOpen( null ) }
					onCheck={ ( c, webhook ) => void checkPayment( c, webhook ) }
					onWebhook={ ( ref ) => void setUpWebhook( ref ) }
					onCrm={ ( c ) => {
						setOpen( null );
						setCrm( { provider: service.id, connection: c ? crmConnection( c ) : undefined } );
					} }
					onChanged={ async ( text ) => {
						say( text );
						await reload();
					} }
				/>
			) : null }
			{ crm ? (
				<CrmConnectionDialog
					api={ api.connect }
					providers={ providers }
					provider={ crm.provider }
					connection={ crm.connection }
					onClose={ () => setCrm( null ) }
					onSaved={ ( c ) => {
						setCrm( null );
						say( sprintf( __( '%s was saved.', 'funnelforms-pro' ), c.label ) );
						void reload();
					} }
				/>
			) : null }
		</section>
	);
}

function ServicePanel( {
	service,
	provider,
	list,
	api,
	config,
	results,
	busy,
	onClose,
	onCheck,
	onWebhook,
	onCrm,
	onChanged,
}: {
	service: HubService;
	provider?: CrmProvider;
	list: HubConnection[];
	api: HubScreenApi;
	config: HubConfig;
	results: Record<string, Result>;
	busy: string | null;
	onClose: () => void;
	onCheck: ( c: Pick<HubConnection, 'ref' | 'type'>, webhook: boolean ) => void;
	onWebhook: ( ref: string ) => void;
	onCrm: ( c?: HubConnection ) => void;
	onChanged: ( text: string ) => Promise<void>;
} ) {
	const type = service.types[ 0 ] ?? service.id;
	const [ adding, setAdding ] = useState( 0 === list.length );
	const [ editing, setEditing ] = useState<string | null>( null );
	const crm = 'crm' === service.kind;
	const how = crm ? provider?.help ?? '' : steps( type );
	return (
		<Dialog
			title={ service.name }
			open
			wide
			onClose={ onClose }
			actions={
				<Button variant="ghost" onClick={ onClose }>
					{ __( 'Close', 'funnelforms-pro' ) }
				</Button>
			}
		>
			<div className="ffx-hub-panel">
				<div className="ffx-hub-panel__head">
					<Mark service={ service } />
					<p>{ hint( service ) }</p>
				</div>
				{ how ? (
					<div className="ffx-hub-panel__how">
						<h3>{ __( 'How to connect', 'funnelforms-pro' ) }</h3>
						<p>{ how }</p>
						{ service.dashboard ? (
							<a className="ffx-link" href={ service.dashboard } target="_blank" rel="noopener noreferrer">
								{ sprintf( __( 'Open %s', 'funnelforms-pro' ), service.name ) }
								<Icon name="external" />
							</a>
						) : null }
					</div>
				) : null }

				{ usage( service ) ? (
					<div className="ffx-hub-panel__use">
						<h3>{ __( 'Use it in a form', 'funnelforms-pro' ) }</h3>
						<p>{ usage( service ) }</p>
						{ config.builderUrl && list.length ? (
							<a className="ffx-link" href={ config.builderUrl }>
								{ __( 'Open the forms', 'funnelforms-pro' ) }
							</a>
						) : null }
					</div>
				) : null }

				{ list.length ? (
					<>
						<h3>{ __( 'Your connections', 'funnelforms-pro' ) }</h3>
						<ul className="ffx-hub-connections">
							{ list.map( ( c ) =>
								editing === c.ref ? (
									<li key={ c.ref }>
										<ConnectForm
											type={ c.type }
											connection={ c }
											api={ api }
											onCancel={ () => setEditing( null ) }
											onSaved={ async ( saved ) => {
												setEditing( null );
												await onChanged( sprintf( __( '%s was saved.', 'funnelforms-pro' ), saved.label ) );
												if ( PAYMENTS.includes( c.type ) ) {
													onCheck( c, false );
												}
											} }
										/>
									</li>
								) : (
									<ConnectionRow
										key={ c.ref }
										connection={ c }
										crm={ crm }
										api={ api }
										config={ config }
										result={ results[ c.ref ] }
										busy={ busy === c.ref }
										onCheck={ () => onCheck( c, false ) }
										onWebhook={ () => onWebhook( c.ref ) }
										onEdit={ () => ( crm ? onCrm( c ) : setEditing( c.ref ) ) }
										onChanged={ onChanged }
									/>
								)
							) }
						</ul>
					</>
				) : null }

				{ crm ? (
					<div className="ffx-hub-panel__add">
						<Button variant="primary" onClick={ () => onCrm() }>
							{ __( 'Add connection', 'funnelforms-pro' ) }
						</Button>
					</div>
				) : adding ? (
					<ConnectForm
						type={ type }
						defaultLabel={ list.length ? '' : service.name }
						api={ api }
						onCancel={ list.length ? () => setAdding( false ) : undefined }
						onSaved={ async ( saved ) => {
							setAdding( false );
							await onChanged( sprintf( __( '%s was saved.', 'funnelforms-pro' ), saved.label ) );
							if ( PAYMENTS.includes( type ) ) {
								onCheck( saved, 'stripe' === type );
							}
						} }
					/>
				) : (
					<div className="ffx-hub-panel__add">
						<Button onClick={ () => setAdding( true ) }>{ __( 'Add connection', 'funnelforms-pro' ) }</Button>
					</div>
				) }
			</div>
		</Dialog>
	);
}

function ConnectionRow( {
	connection,
	crm,
	api,
	config,
	result,
	busy,
	onCheck,
	onWebhook,
	onEdit,
	onChanged,
}: {
	connection: HubConnection;
	crm: boolean;
	api: HubScreenApi;
	config: HubConfig;
	result?: Result;
	busy: boolean;
	onCheck: () => void;
	onWebhook: () => void;
	onEdit: () => void;
	onChanged: ( text: string ) => Promise<void>;
} ) {
	const [ removing, setRemoving ] = useState( false );
	const [ testing, setTesting ] = useState( false );
	const [ to, setTo ] = useState( '' );
	const [ own, setOwn ] = useState<Result | null>( null );
	const [ secret, setSecret ] = useState( '' );
	const [ copied, setCopied ] = useState( false );
	const c = connection;
	const payment = PAYMENTS.includes( c.type );
	const number = SMS.includes( c.type ) || 'whatsapp' === c.type;
	const direct = [ 'slack', 'teams' ].includes( c.type );
	// CRM tools brought over from Funnelforms 3 are still used there: they can be changed, not deleted.
	const legacy = crm && ! deletable( c.ref );
	const formUrl = ( id: number ): string => ( config.builderUrl ? config.builderUrl + ( config.builderUrl.includes( '?' ) ? '&' : '?' ) + 'form=' + id : '' );

	const test = async (): Promise<void> => {
		setTesting( true );
		setOwn( null );
		try {
			if ( crm ) {
				// Reading the choices of the account (lists, pipelines) checks the access data.
				const result = await api.connect.crmOptions( c.ref );
				setOwn( result.checked ? { tone: 'success', text: __( 'The connection works: the tool accepted the access data.', 'funnelforms-pro' ) } : { tone: 'info', text: __( 'This tool cannot be checked from here. Send a test entry to try the connection.', 'funnelforms-pro' ) } );
				return;
			}
			await api.testConnection( c.ref, number ? ( 'whatsapp' === c.type ? { to: to.trim(), template: 'hello_world', language: 'en_US' } : { to: to.trim() } ) : {} );
			setOwn( { tone: 'success', text: __( 'The test message was sent. Check that it arrived.', 'funnelforms-pro' ) } );
		} catch ( e ) {
			setOwn( { tone: 'danger', text: message( e ) } );
		} finally {
			setTesting( false );
		}
	};

	const remove = async (): Promise<void> => {
		setOwn( null );
		try {
			if ( crm ) {
				await api.connect.deleteCrmConnection( c.ref );
			} else {
				await api.deleteConnection( c.ref );
			}
			await onChanged( sprintf( __( '%s was removed.', 'funnelforms-pro' ), c.label ) );
		} catch ( e ) {
			setRemoving( false );
			setOwn( { tone: 'danger', text: message( e ) } );
		}
	};

	const saveSecret = async (): Promise<void> => {
		setOwn( null );
		try {
			await api.updateConnection( c.ref, { webhookSecret: secret.trim() } );
			setSecret( '' );
			await onChanged( sprintf( __( '%s was saved.', 'funnelforms-pro' ), c.label ) );
		} catch ( e ) {
			setOwn( { tone: 'danger', text: message( e ) } );
		}
	};

	const copy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText( c.webhookUrl ?? '' );
			setCopied( true );
		} catch {
			setCopied( false );
		}
	};

	const shown = own ?? result ?? null;
	return (
		<li className="ffx-hub-connection">
			<div className="ffx-hub-connection__head">
				<strong>{ c.label }</strong>
				{ c.testMode ? <span className="ffx-badge ffx-badge--warning">{ __( 'Test mode', 'funnelforms-pro' ) }</span> : null }
				{ c.attention ? <span className="ffx-badge ffx-badge--danger">{ __( 'Needs attention', 'funnelforms-pro' ) }</span> : <span className="ffx-badge ffx-badge--success">{ __( 'Connected', 'funnelforms-pro' ) }</span> }
				{ legacy ? <span className="ffx-badge">{ __( 'From Funnelforms 3', 'funnelforms-pro' ) }</span> : null }
			</div>
			<p className="ffx-hub-connection__used">
				{ c.formCount ? (
					<>
						{ __( 'Used in:', 'funnelforms-pro' ) }{ ' ' }
						{ c.forms.map( ( f, i ) => (
							<React.Fragment key={ f.id }>
								{ i ? ', ' : '' }
								{ formUrl( f.id ) ? <a href={ formUrl( f.id ) }>{ f.title || '#' + f.id }</a> : f.title || '#' + f.id }
							</React.Fragment>
						) ) }
						{ c.formCount > c.forms.length ? ' …' : '' }
					</>
				) : (
					__( 'Not used in any form yet.', 'funnelforms-pro' )
				) }
			</p>
			{ shown ? <Notice tone={ shown.tone }>{ shown.text }</Notice> : null }

			{ 'webhook_missing' === c.attention && c.webhookUrl ? (
				<div className="ffx-hub-webhook">
					<p>{ __( 'Payments are confirmed through the webhook, also when visitors close the page. It is not set up yet.', 'funnelforms-pro' ) }</p>
					<Button variant="primary" size="sm" disabled={ busy } onClick={ onWebhook }>
						{ busy ? __( 'Setting up…', 'funnelforms-pro' ) : __( 'Set up webhook automatically', 'funnelforms-pro' ) }
					</Button>
					<details>
						<summary>{ __( 'Set it up by hand', 'funnelforms-pro' ) }</summary>
						<p>{ __( 'In Stripe, add this address as webhook endpoint for the events checkout.session.*, customer.subscription.*, charge.refunded and charge.dispute.created, then enter its signing secret here, so payments, subscriptions and refunds are confirmed even when visitors close the page.', 'funnelforms-pro' ) }</p>
						<div className="ffx-hub-webhook__url">
							<code>{ c.webhookUrl }</code>
							<Button size="sm" onClick={ () => void copy() }>
								{ copied ? __( 'Copied', 'funnelforms-pro' ) : __( 'Copy', 'funnelforms-pro' ) }
							</Button>
						</div>
						<TextInput label={ __( 'Signing secret (whsec_…)', 'funnelforms-pro' ) } type="password" value={ secret } onChange={ setSecret } hint={ __( 'Shown in Stripe under Developers → Webhooks for the endpoint.', 'funnelforms-pro' ) } />
						<Button size="sm" disabled={ '' === secret.trim() } onClick={ () => void saveSecret() }>
							{ __( 'Save', 'funnelforms-pro' ) }
						</Button>
					</details>
				</div>
			) : null }

			{ number && ! removing ? (
				<div className="ffx-hub-connection__test">
					<TextInput label={ __( 'Send to', 'funnelforms-pro' ) } type="tel" value={ to } placeholder="+49 170 1234567" onChange={ setTo } hint={ 'whatsapp' === c.type ? __( 'WhatsApp sends first messages only as approved template; hello_world exists in every account.', 'funnelforms-pro' ) : __( 'Your own number in international format.', 'funnelforms-pro' ) } />
				</div>
			) : null }

			{ removing ? (
				<div className="ffx-hub-connection__remove">
					<strong>{ sprintf( __( 'Delete “%s”?', 'funnelforms-pro' ), c.label ) }</strong>
					{ c.formCount ? <Notice tone="warning">{ sprintf( __( 'These stop working: %s. Choose another connection for them afterwards.', 'funnelforms-pro' ), c.forms.map( ( f ) => f.title || '#' + f.id ).join( ', ' ) ) }</Notice> : null }
					<p>{ __( 'The connection is deleted for the whole site: other forms that use it stop sending through it too. The stored access keys are removed; this cannot be undone.', 'funnelforms-pro' ) }</p>
					<div className="ffx-actions">
						<Button variant="ghost" size="sm" onClick={ () => setRemoving( false ) }>
							{ __( 'Cancel', 'funnelforms-pro' ) }
						</Button>
						<Button variant="danger" size="sm" onClick={ () => void remove() }>
							{ __( 'Delete connection', 'funnelforms-pro' ) }
						</Button>
					</div>
				</div>
			) : (
				<div className="ffx-actions">
					{ payment ? (
						<Button size="sm" disabled={ busy } onClick={ onCheck }>
							{ busy ? __( 'Checking…', 'funnelforms-pro' ) : __( 'Check connection', 'funnelforms-pro' ) }
						</Button>
					) : null }
					{ direct || number ? (
						<Button size="sm" disabled={ testing || ( number && '' === to.trim() ) } onClick={ () => void test() }>
							{ testing ? __( 'Sending…', 'funnelforms-pro' ) : __( 'Send test', 'funnelforms-pro' ) }
						</Button>
					) : null }
					{ crm ? (
						<Button size="sm" disabled={ testing } onClick={ () => void test() }>
							{ testing ? __( 'Testing…', 'funnelforms-pro' ) : __( 'Test', 'funnelforms-pro' ) }
						</Button>
					) : null }
					<Button size="sm" variant="ghost" onClick={ onEdit }>
						{ __( 'Edit', 'funnelforms-pro' ) }
					</Button>
					{ deletable( c.ref ) ? (
						<Button size="sm" variant="ghost" onClick={ () => setRemoving( true ) }>
							{ __( 'Delete', 'funnelforms-pro' ) }
						</Button>
					) : null }
				</div>
			) }
			{ legacy ? <p className="ffx-hub-connection__hint">{ __( 'This connection came from Funnelforms 3 and is still used there. Change its access data instead.', 'funnelforms-pro' ) }</p> : null }
			{ [ 'meta', 'ga4', 'tiktok' ].includes( c.type ) ? <p className="ffx-hub-connection__hint">{ __( 'Try it with a test entry: payments with the test keys of the provider, conversions with the test event code of the platform.', 'funnelforms-pro' ) }</p> : null }
		</li>
	);
}

/** Connects a service, or with a connection given renames it and replaces the keys typed in. */
function ConnectForm( { type, connection, defaultLabel = '', api, onCancel, onSaved }: { type: string; connection?: HubConnection; defaultLabel?: string; api: HubScreenApi; onCancel?: () => void; onSaved: ( c: { ref: string; type: string; label: string } ) => void } ) {
	const [ label, setLabel ] = useState( connection?.label ?? defaultLabel );
	const [ values, setValues ] = useState<Record<string, string>>( {} );
	const [ sandbox, setSandbox ] = useState( false );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const fields = credentials( type );
	const complete = '' !== label.trim() && ( connection ? true : fields.every( ( [ key, , , optional ] ) => optional || '' !== ( values[ key ] ?? '' ).trim() ) );
	const save = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const given = Object.fromEntries( Object.entries( values ).map( ( [ k, v ] ) => [ k, v.trim() ] ).filter( ( [ , v ] ) => '' !== v ) );
			if ( connection ) {
				const saved = await api.updateConnection( connection.ref, { ...given, label: label.trim() } );
				onSaved( { ref: connection.ref, type, label: saved.label ?? label.trim() } );
			} else {
				onSaved( await api.createConnection( type, label.trim(), 'paypal' === type && sandbox ? { ...given, sandbox: true } : given ) );
			}
		} catch ( e ) {
			setError( message( e ) );
			setBusy( false );
		}
	};
	return (
		<form
			className="ffx-hub-form"
			onSubmit={ ( e ) => {
				e.preventDefault();
				if ( complete && ! busy ) {
					void save();
				}
			} }
		>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<TextInput label={ __( 'Name', 'funnelforms-pro' ) } value={ label } onChange={ setLabel } hint={ __( 'Shown when you choose the connection.', 'funnelforms-pro' ) } />
			{ fields.map( ( [ key, name, secret, optional ] ) => (
				<TextInput
					key={ type + key }
					label={ optional && ! connection ? sprintf( __( '%s (optional)', 'funnelforms-pro' ), name ) : name }
					type={ secret ? 'password' : 'text' }
					value={ values[ key ] ?? '' }
					placeholder={ connection ? __( 'Unchanged', 'funnelforms-pro' ) : undefined }
					onChange={ ( v ) => setValues( ( x ) => ( { ...x, [ key ]: v } ) ) }
				/>
			) ) }
			{ 'paypal' === type && ! connection ? <Toggle label={ __( 'App of the PayPal sandbox (test payments)', 'funnelforms-pro' ) } checked={ sandbox } onChange={ setSandbox } /> : null }
			<p className="ffx-hub-form__hint">{ connection ? __( 'Fill in only what changes; empty fields keep the stored values. Access keys are stored encrypted and never shown again.', 'funnelforms-pro' ) : __( 'Access keys are stored encrypted and never shown again.', 'funnelforms-pro' ) }</p>
			<div className="ffx-actions">
				{ onCancel ? (
					<Button variant="ghost" onClick={ onCancel }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
				) : null }
				<Button variant="primary" type="submit" disabled={ busy || ! complete }>
					{ busy ? __( 'Connecting…', 'funnelforms-pro' ) : connection ? __( 'Save connection', 'funnelforms-pro' ) : __( 'Connect', 'funnelforms-pro' ) }
				</Button>
			</div>
		</form>
	);
}
