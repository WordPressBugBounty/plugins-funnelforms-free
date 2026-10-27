/**
 * "After sending": the form's actions (mails, webhooks, chat, SMS, WhatsApp, conversions), shown
 * with the contact step whose entries they handle, and the connections they use. Changing them
 * needs the right to see entries; whoever lacks it can prepare them, and someone with the right
 * publishes.
 */
import React, { useEffect, useState } from 'react';
import type { Action, Condition, FormDocument, Text } from '@funnelforms/form-schema';
import { ACTION_FOR_TYPE, ACTION_KINDS, actionGaps, addAction, addActionFor, addCrmAction, CONNECTION_TYPES, duplicateAction, emailFields, integrationsUrl, removeAction, retiredConnection, setRecipient, type ActionKind, type ActionTexts } from '../actions';
import type { Connection, ConnectionTest } from '../api';
import { calcRule, entryFields, starterRule } from '../conditions';
import { contactFields, CRM_NAMES, suggestMapping, type CrmConnection } from '../connect';
import { isPro } from '../edition';
import { euPrivacy, openPrivacy } from '../privacy';
import { nodeName, text } from '../document';
import { editText, setText } from '../languages';
import type { Recipe } from '../store';
import { useBuilder, useEnv } from './context';
import { describeCondition, fieldTitle } from './describe';
import { __, sprintf } from './i18n';
import { CrmAction } from './CrmAction';
import { useCrmCatalog } from './CrmConnections';
import { ConditionEditor } from './Logic';
import { MailEditor } from './MailEditor';
import { WhatsAppTemplatePicker } from './WhatsAppTemplates';
import { Button, Dialog, Field as FieldRow, icons, Notice, ProBadge, Select, TextInput, Toggle } from './ui';

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

export function kindName( kind: string ): string {
	const names: Record<string, string> = {
		email: __( 'E-mail to you', 'funnelforms-pro' ),
		autoresponder: __( 'Confirmation to the visitor', 'funnelforms-pro' ),
		webhook: __( 'Webhook', 'funnelforms-pro' ),
		chat: __( 'Slack or Teams message', 'funnelforms-pro' ),
		sms: __( 'Text message (SMS)', 'funnelforms-pro' ),
		whatsapp: __( 'WhatsApp message', 'funnelforms-pro' ),
		conversion: __( 'Conversion (Meta, GA4, TikTok)', 'funnelforms-pro' ),
		googleAds: __( 'Google Ads conversion', 'funnelforms-pro' ),
		crm: __( 'CRM, newsletter or spreadsheet', 'funnelforms-pro' ),
	};
	return names[ kind ] ?? kind;
}

function connectionTypeName( type: string ): string {
	const names: Record<string, string> = {
		slack: 'Slack',
		teams: 'Microsoft Teams',
		twilio: 'Twilio',
		bird: 'Bird',
		whatsapp: 'WhatsApp Business',
		meta: 'Meta',
		ga4: 'Google Analytics 4',
		tiktok: 'TikTok',
		smtp: 'SMTP',
		stripe: 'Stripe',
		paypal: 'PayPal',
		mollie: 'Mollie',
		caldav: 'CalDAV',
		google: 'Google Calendar',
		microsoft: 'Microsoft Outlook',
	};
	return names[ type ] ?? type;
}

/** Credentials each connection type asks for: parameter, label, secret, optional. */
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
		stripe: [
			[ 'secretKey', __( 'Secret key (sk_… or rk_…)', 'funnelforms-pro' ), true ],
			[ 'webhookSecret', __( 'Webhook signing secret (whsec_…)', 'funnelforms-pro' ), true, true ],
		],
		paypal: [
			[ 'clientId', __( 'Client ID', 'funnelforms-pro' ), false ],
			[ 'clientSecret', __( 'Client secret', 'funnelforms-pro' ), true ],
		],
		mollie: [ [ 'apiKey', __( 'API key (live_… or test_…)', 'funnelforms-pro' ), true ] ],
	};
	return all[ type ] ?? [];
}

/** How a connection can be tried out: a message to a number, a message to the channel, or not at all (payments, conversions). */
function testKind( type: string ): 'number' | 'whatsapp' | 'direct' | null {
	if ( CONNECTION_TYPES.sms.includes( type ) ) {
		return 'number';
	}
	if ( 'whatsapp' === type ) {
		return 'whatsapp';
	}
	return [ 'slack', 'teams', 'caldav', 'google', 'microsoft' ].includes( type ) ? 'direct' : null;
}

/** Where the form uses a connection: its actions, the mail server of mails, the payment. */
export function connectionUses( doc: FormDocument | null, ref: string ): string[] {
	if ( ! doc || ! ref ) {
		return [];
	}
	const uses = doc.actions
		.filter( ( a ) => {
			const config = a.config as unknown as { connectionRef?: string; transport?: { connectionRef?: string } };
			return config.connectionRef === ref || config.transport?.connectionRef === ref;
		} )
		.map( ( a ) => kindName( a.kind ) );
	if ( doc.settings.payment?.connection === ref ) {
		uses.push( __( 'Payment', 'funnelforms-pro' ) );
	}
	for ( const node of doc.nodes ) {
		for ( const field of 'contact' === node.type ? node.fields : [] ) {
			if ( ( field.props.sms as { connectionRef?: string } | undefined )?.connectionRef === ref ) {
				uses.push( __( 'Phone verification', 'funnelforms-pro' ) );
			}
		}
	}
	return uses;
}

function defaultTexts(): ActionTexts {
	return {
		adminSubject: __( 'New entry', 'funnelforms-pro' ),
		adminBody: __( 'You have a new entry:', 'funnelforms-pro' ) + '\n\n{{lead}}\n\n{{answers}}',
		replySubject: __( 'Thank you for your request', 'funnelforms-pro' ),
		replyBody: __( 'Thank you! We have received your answers and will get back to you soon.', 'funnelforms-pro' ) + '\n\n{{answers}}',
		chatMessage: __( 'New entry', 'funnelforms-pro' ),
	};
}

function gapText( gap: ReturnType<typeof actionGaps>[ number ] ): string {
	const texts = {
		recipient: __( 'Add a recipient.', 'funnelforms-pro' ),
		url: __( 'Enter the web address that receives the entries.', 'funnelforms-pro' ),
		connection: __( 'Choose a connection.', 'funnelforms-pro' ),
		template: __( 'Enter the name of the approved template.', 'funnelforms-pro' ),
		sendTo: __( 'Enter the conversion ID and label, e.g. AW-123456789/AbC-D_efG.', 'funnelforms-pro' ),
	};
	return texts[ gap ];
}

/** One line about where an action goes. */
function target( action: Action, locale: string, connections: Connection[] ): string {
	const label = ( ref: string ): string => connections.find( ( c ) => c.ref === ref )?.label ?? '';
	switch ( action.kind ) {
		case 'email':
		case 'autoresponder':
			return text( action.config.to, locale );
		case 'webhook':
			return action.config.url;
		case 'sms':
			return retiredConnection( action.config.connectionRef ) ? __( 'MessageBird (no longer supported)', 'funnelforms-pro' ) : label( action.config.connectionRef );
		case 'chat':
		case 'whatsapp':
		case 'conversion':
			return label( action.config.connectionRef );
		case 'crm':
			return [ CRM_NAMES[ action.config.provider ] ?? action.config.provider, label( action.config.connectionRef ) ].filter( Boolean ).join( ' · ' );
		case 'googleAds':
			return action.config.sendTo;
		default:
			return '';
	}
}

/**
 * The actions of the form; with a node, those that run for entries of that contact step (the
 * actions for every contact step among them), and new ones are for that step alone when there
 * are several.
 */
export function ActionsSection( { doc, node }: { doc: FormDocument; node?: string } ) {
	const { api, rights, readOnly } = useEnv();
	const change = useChange();
	const [ connections, setConnections ] = useState<Connection[]>( [] );
	const [ open, setOpen ] = useState<string | null>( null );
	const locale = doc.locales.default;
	const several = doc.nodes.filter( ( n ) => 'contact' === n.type ).length > 1;
	const shown = node ? doc.actions.filter( ( a ) => ! a.node || a.node === node ) : doc.actions;

	useEffect( () => {
		let live = true;
		api.connections().then(
			( list ) => live && setConnections( list ),
			() => undefined
		);
		return () => {
			live = false;
		};
	}, [ api ] );

	const add = ( kind: ActionKind | ( ( d: FormDocument ) => string | null ) ): void => {
		let id = '';
		change( ( d ) => {
			id = ( 'function' === typeof kind ? kind( d ) : addAction( d, kind, defaultTexts() ) ) ?? '';
			const created = d.actions.find( ( a ) => a.id === id );
			if ( created && node && several ) {
				created.node = node;
			}
		} );
		setOpen( id || null );
	};
	const connectionsChanged = ( list: Connection[] ): void => setConnections( list );

	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ node ? __( 'Actions', 'funnelforms-pro' ) : __( 'After sending', 'funnelforms-pro' ) }</h2>
			</header>
			{ rights.entries ? null : <Notice tone="info">{ __( 'Changes here need the right to see entries. You can prepare them; someone with that right publishes them.', 'funnelforms-pro' ) }</Notice> }
			{ 0 === shown.length ? <p className="ffxb-hint">{ __( 'Nothing happens yet besides saving the entry. Add a mail to you, a confirmation for the visitor or a connection to your tools.', 'funnelforms-pro' ) }</p> : null }
			<ul className="ffxb-actions">
				{ shown.map( ( action ) => {
					const gaps = actionGaps( action, locale );
					const expanded = open === action.id;
					return (
						<li key={ action.id } className={ `ffxb-action${ expanded ? ' is-open' : '' }` }>
							<div className="ffxb-action__head">
								<button type="button" className="ffxb-action__toggle" aria-expanded={ expanded } onClick={ () => setOpen( expanded ? null : action.id ) }>
									<strong>{ kindName( action.kind ) }</strong>
									<span className="ffxb-action__target">{ target( action, locale, connections ) || '—' }</span>
									{ node && several && ! action.node ? <span className="ffxb-action__scope">{ __( 'Every contact step', 'funnelforms-pro' ) }</span> : null }
									{ action.when ? <span className="ffxb-action__scope" title={ whenText( doc, action.when ) }>{ __( 'Some entries', 'funnelforms-pro' ) }</span> : null }
									{ gaps.length ? <span className="ffxb-action__gap">{ __( 'Incomplete', 'funnelforms-pro' ) }</span> : null }
								</button>
								<Button size="sm" variant="ghost" icon={ icons.copy } aria-label={ __( 'Duplicate', 'funnelforms-pro' ) } title={ __( 'Duplicate', 'funnelforms-pro' ) } disabled={ 'free' === process.env.FUNNELFORMS_EDITION ? true : readOnly || 'crm' === action.kind } onClick={ () => change( ( d ) => void duplicateAction( d, action.id ) ) } />
								<Button size="sm" variant="ghost" icon={ icons.trash } aria-label={ __( 'Delete', 'funnelforms-pro' ) } title={ __( 'Delete', 'funnelforms-pro' ) } disabled={ readOnly } onClick={ () => change( ( d ) => removeAction( d, action.id ) ) } />
							</div>
							{ expanded ? (
								<div className="ffxb-action__body">
									{ gaps.map( ( g ) => (
										<Notice key={ g } tone="warning">
											{ gapText( g ) }
										</Notice>
									) ) }
									<ActionEditor doc={ doc } action={ action } connections={ connections } onConnections={ connectionsChanged } />
								</div>
							) : null }
						</li>
					);
				} ) }
			</ul>
			{ 'free' === process.env.FUNNELFORMS_EDITION ? (
				<>
					<Select<'' | ActionKind>
						label={ __( 'Add an action', 'funnelforms-pro' ) }
						value=""
						options={ [
							{ value: '', label: __( 'Choose…', 'funnelforms-pro' ) },
							...freeKinds( doc, node && several ? node : undefined ).map( ( k ) => ( { value: k, label: kindName( k ) } ) ),
						] }
						onChange={ ( v ) => {
							if ( '' !== v && ! readOnly ) {
								add( v );
							}
						} }
					/>
					<p className="ffxb-hint">
						<ProBadge /> { __( 'Webhooks, CRM and newsletter tools, Slack and Teams, text messages, WhatsApp, conversion tracking and more than one mail of each kind come with Funnelforms Pro.', 'funnelforms-pro' ) }
					</p>
				</>
			) : (
				<>
					<Select<'' | ActionKind>
						label={ __( 'Add an action', 'funnelforms-pro' ) }
						value=""
						options={ [
							{ value: '', label: __( 'Choose…', 'funnelforms-pro' ) },
							...ACTION_KINDS.map( ( k ) => ( { value: k, label: kindName( k ) } ) ),
						] }
						onChange={ ( v ) => {
							if ( '' !== v && ! readOnly ) {
								add( v );
							}
						} }
					/>
					<ConnectedTools node={ node && several ? node : undefined } shown={ shown } connections={ connections } onAdd={ add } />
				</>
			) }
		</section>
	);
}

/**
 * The site's connections an action can send entries through (CRM, newsletter and spreadsheet
 * tools, Slack and Teams, SMS, WhatsApp, conversion platforms), each ready to add with one click,
 * except those this step already sends to. Tools that are not connected yet are connected under
 * Funnelforms → Integrations, which the hint links to for users who may change settings.
 */
function ConnectedTools( { node, shown, connections, onAdd }: { node?: string; shown: Action[]; connections: Connection[]; onAdd: ( create: ( d: FormDocument ) => string | null ) => void } ) {
	const { api, readOnly } = useEnv();
	const catalog = useCrmCatalog( api.connect );
	const used = new Set( shown.map( ( a ) => ( a.config as { connectionRef?: string } ).connectionRef ).filter( Boolean ) );
	const crm =
		( c: CrmConnection ) =>
		( d: FormDocument ): string => {
			const spec = catalog.providers?.find( ( p ) => p.provider === c.provider );
			return addCrmAction( d, c.provider, c.ref, spec ? suggestMapping( spec, contactFields( d, node ) ) : {} );
		};
	const ready = [
		...( catalog.connections ?? [] ).map( ( c ) => ( { ref: c.ref, name: CRM_NAMES[ c.provider ] ?? c.provider, label: c.label, create: crm( c ) } ) ),
		...connections.filter( ( c ) => ACTION_FOR_TYPE[ c.type ] ).map( ( c ) => ( { ref: c.ref, name: connectionTypeName( c.type ), label: c.label, create: ( d: FormDocument ) => addActionFor( d, c, defaultTexts() ) } ) ),
	].filter( ( r ) => ! used.has( r.ref ) );
	const link = integrationsUrl();
	if ( ! ready.length && ! link ) {
		return null;
	}
	return (
		<div className="ffxb-ready">
			{ ready.length ? (
				<>
					<p className="ffxb-field__label">{ __( 'Your connected tools', 'funnelforms-pro' ) }</p>
					<ul className="ffxb-ready__list">
						{ ready.map( ( r ) => (
							<li key={ r.ref }>
								<button
									type="button"
									className="ffxb-ready__item"
									disabled={ readOnly }
									onClick={ () => onAdd( r.create ) }
									title={ sprintf( /* translators: %s: name of a connection, such as Sales team */ __( 'Send each entry to %s', 'funnelforms-pro' ), r.label || r.name ) }
								>
									{ icons.plus }
									<strong>{ r.name }</strong>
									{ r.label && r.label !== r.name ? <span>{ r.label }</span> : null }
								</button>
							</li>
						) ) }
					</ul>
				</>
			) : null }
			{ link ? (
				<p className="ffxb-hint">
					{ ready.length
						? __( 'More tools are connected once under Integrations; they then show up here.', 'funnelforms-pro' )
						: __( 'Send entries to your CRM, newsletter, Slack, WhatsApp or ad platforms: connect the tool once under Integrations, and it shows up here.', 'funnelforms-pro' ) }{ ' ' }
					<a className="ffxb-link" href={ link } target="_blank" rel="noopener noreferrer">
						{ __( 'Open Integrations', 'funnelforms-pro' ) }
					</a>
				</p>
			) : null }
		</div>
	);
}

/** Edits one text of an action's config in the language being edited. */
function useConfigText( doc: FormDocument, action: Action ) {
	const change = useChange();
	const { lang } = useEnv();
	const base = doc.locales.default;
	return ( key: string ) => {
		const config = action.config as unknown as Record<string, unknown>;
		const current = config[ key ] as Text | undefined;
		const value = editText( current, lang, base );
		const placeholder = lang !== base ? text( current, base ) : undefined;
		const set = ( v: string ): void =>
			change( ( d ) => {
				const a = d.actions.find( ( x ) => x.id === action.id );
				if ( a ) {
					const c = a.config as unknown as Record<string, unknown>;
					const next = { ...( ( c[ key ] as Text | undefined ) ?? {} ) };
					setText( next, lang, v, base );
					c[ key ] = next;
				}
			}, `action:${ action.id }:${ key }` );
		return { value, set, placeholder };
	};
}

/** In Funnelforms Free: the kinds that can be added, one notification and one confirmation per contact step. */
function freeKinds( doc: FormDocument, node: string | undefined ): ActionKind[] {
	return ACTION_KINDS.filter( ( k ) => ! isPro( 'action:' + k ) && ! doc.actions.some( ( a ) => a.kind === k && ( a.node ?? '' ) === ( node ?? '' ) ) );
}

/** In Funnelforms Free: an action of Pro, which it neither edits nor runs. */
function ProAction( { kind }: { kind: ActionKind } ) {
	return <Notice tone="warning">{ sprintf( /* translators: %s: name of an action, such as Webhook */ __( '%s is part of Funnelforms Pro. Delete this action to publish the form.', 'funnelforms-pro' ), kindName( kind ) ) }</Notice>;
}

/** Changes a plain value of the action. */
function useConfigValue( action: Action ) {
	const change = useChange();
	return ( key: string, value: unknown ): void =>
		change( ( d ) => {
			const a = d.actions.find( ( x ) => x.id === action.id );
			if ( a ) {
				( a.config as unknown as Record<string, unknown> )[ key ] = value;
			}
		}, `action:${ action.id }:${ key }` );
}

/** Placeholders for mail and message texts: all answers, the lead summary, single fields, calculations. */
function Placeholders( { doc, onInsert }: { doc: FormDocument; onInsert: ( token: string ) => void } ) {
	const locale = doc.locales.default;
	const options: Array<{ value: string; label: string }> = [
		{ value: '', label: __( 'Insert a placeholder…', 'funnelforms-pro' ) },
		{ value: '{{answers}}', label: __( 'All answers', 'funnelforms-pro' ) },
		{ value: '{{lead}}', label: __( 'Lead summary: contact details, results and source', 'funnelforms-pro' ) },
		{ value: '{{contact}}', label: __( 'All contact details', 'funnelforms-pro' ) },
		...( doc.calculations.length ? [ { value: '{{calculations}}', label: __( 'All results of calculations', 'funnelforms-pro' ) } ] : [] ),
		{ value: '{{entry:id}}', label: __( 'Number of the entry', 'funnelforms-pro' ) },
		{ value: '{{page:url}}', label: __( 'Page of the form', 'funnelforms-pro' ) },
		{ value: '{{form:title}}', label: __( 'Name of the form', 'funnelforms-pro' ) },
		{ value: '{{entry:date}}', label: __( 'Date of the entry', 'funnelforms-pro' ) },
		{ value: '{{entry:time}}', label: __( 'Time of the entry', 'funnelforms-pro' ) },
		{ value: '{{visit:device}}', label: __( 'Device (desktop, tablet, mobile)', 'funnelforms-pro' ) },
		{ value: '{{visit:browser}}', label: __( 'Browser and system', 'funnelforms-pro' ) },
		{ value: '{{visit:duration}}', label: __( 'Time to fill in', 'funnelforms-pro' ) },
		{ value: '{{visit:referrer}}', label: __( 'Came from', 'funnelforms-pro' ) },
		{ value: '{{utm}}', label: __( 'All UTM values', 'funnelforms-pro' ) },
		...[ 'source', 'medium', 'campaign', 'term', 'content' ].map( ( key ) => ( { value: `{{utm:${ key }}}`, label: `utm_${ key }` } ) ),
		{ value: '{{url:gclid}}', label: __( 'Google Ads click ID (gclid)', 'funnelforms-pro' ) },
		{ value: '{{url:name}}', label: __( 'Another parameter of the page address (replace "name")', 'funnelforms-pro' ) },
	];
	if ( doc.nodes.some( ( n ) => 'fields' in n && n.fields.some( ( f ) => 'booking' === f.type ) ) ) {
		options.push(
			{ value: '{{booking:date}}', label: __( 'Date of the appointment', 'funnelforms-pro' ) },
			{ value: '{{booking:time}}', label: __( 'Time of the appointment', 'funnelforms-pro' ) },
			{ value: '{{booking:name}}', label: __( 'Type of the appointment', 'funnelforms-pro' ) },
			{ value: '{{booking:duration}}', label: __( 'Duration of the appointment', 'funnelforms-pro' ) }
		);
	}
	if ( doc.settings.payment ) {
		options.push( { value: '{{payment:status}}', label: __( 'Status of the payment', 'funnelforms-pro' ) }, { value: '{{payment:amount}}', label: __( 'Amount paid', 'funnelforms-pro' ) }, { value: '{{payment:reference}}', label: __( 'Reference', 'funnelforms-pro' ) } );
	}
	for ( const node of doc.nodes ) {
		if ( 'end' === node.type ) {
			continue;
		}
		for ( const field of node.fields ) {
			if ( ! [ 'content', 'result', 'html', 'captcha' ].includes( field.type ) ) {
				options.push( { value: `{{field:${ field.key }}}`, label: fieldTitle( field as never, locale ) } );
			}
		}
	}
	for ( const calc of doc.calculations ) {
		options.push( { value: `{{calc:${ calc.id }}}`, label: calc.label || calc.id } );
	}
	return (
		<Select
			label={ __( 'Placeholders', 'funnelforms-pro' ) }
			value=""
			options={ options }
			onChange={ ( v ) => {
				if ( v ) {
					onInsert( v );
				}
			} }
		/>
	);
}

export function ConnectionPicker( {
	types,
	value,
	connections,
	onChange,
	onConnection,
	onConnections,
	test,
}: {
	types: string[];
	value: string;
	connections: Connection[];
	onChange: ( ref: string ) => void;
	/** A connection was added. */
	onConnection: ( c: Connection ) => void;
	/** The list after a connection was renamed or deleted. */
	onConnections?: ( list: Connection[] ) => void;
	/** What a test sends besides the number: the sender of an SMS, the template of WhatsApp. */
	test?: ConnectionTest;
} ) {
	const { api, rights } = useEnv();
	const doc = useBuilder( ( s ) => s.doc );
	const [ dialog, setDialog ] = useState<'add' | 'edit' | 'delete' | 'test' | 'secret' | null>( null );
	const [ tested, setTested ] = useState<{ ok: boolean; message: string } | null>( null );
	const [ testing, setTesting ] = useState( false );
	const usable = connections.filter( ( c ) => types.includes( c.type ) );
	const chosen = usable.find( ( c ) => c.ref === value );
	const options = [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) }, ...usable.map( ( c ) => ( { value: c.ref, label: `${ c.label } (${ connectionTypeName( c.type ) })` } ) ) ];
	const retired = retiredConnection( value );
	if ( value && ! usable.some( ( c ) => c.ref === value ) ) {
		options.push( { value, label: retired ? __( 'MessageBird (no longer supported)', 'funnelforms-pro' ) : value.startsWith( 'legacy:' ) ? __( 'From Funnelforms 3', 'funnelforms-pro' ) : __( 'Deleted connection', 'funnelforms-pro' ) } );
	}
	const kind = chosen ? testKind( chosen.type ) : null;
	const runTest = async ( given: ConnectionTest ): Promise<void> => {
		if ( ! chosen || ! api.testConnection ) {
			return;
		}
		setTesting( true );
		setTested( null );
		try {
			await api.testConnection( chosen.ref, given );
			setTested( { ok: true, message: [ 'caldav', 'google', 'microsoft' ].includes( chosen.type ) ? __( 'The connection works: the calendar was read.', 'funnelforms-pro' ) : __( 'The test message was sent. Check that it arrived.', 'funnelforms-pro' ) } );
			setDialog( null );
		} catch ( e ) {
			setTested( { ok: false, message: e instanceof Error ? e.message : String( e ) } );
		} finally {
			setTesting( false );
		}
	};
	const manage = chosen && rights.settings;
	return (
		<>
			<Select label={ __( 'Connection', 'funnelforms-pro' ) } value={ value } options={ options } onChange={ ( v ) => {
				setTested( null );
				onChange( v );
			} } />
			{ retired ? <Notice tone="warning">{ __( 'MessageBird is no longer supported; Bird is its successor. Choose a Twilio or Bird connection, or add one. Until then no text message is sent.', 'funnelforms-pro' ) }</Notice> : null }
			{ chosen?.webhookUrl ? (
				<Notice tone="info">
					{ __( 'In Stripe, add this address as webhook endpoint for the events checkout.session.*, customer.subscription.*, charge.refunded and charge.dispute.created, then enter its signing secret here, so payments, subscriptions and refunds are confirmed even when visitors close the page.', 'funnelforms-pro' ) }
					<code className="ffxb-code ffxb-code--wrap">{ chosen.webhookUrl }</code>
				</Notice>
			) : null }
			{ tested && 'test' !== dialog ? <Notice tone={ tested.ok ? 'success' : 'danger' }>{ tested.message }</Notice> : null }
			{ rights.settings ? (
				<div className="ffxb-connection-tools">
					{ manage && kind && api.testConnection ? (
						<Button size="sm" variant="ghost" disabled={ testing } onClick={ () => ( 'direct' === kind ? void runTest( {} ) : setDialog( 'test' ) ) }>
							{ testing && 'direct' === kind ? __( 'Testing…', 'funnelforms-pro' ) : __( 'Test', 'funnelforms-pro' ) }
						</Button>
					) : null }
					{ manage ? (
						<Button size="sm" variant="ghost" onClick={ () => setDialog( 'edit' ) }>
							{ __( 'Edit', 'funnelforms-pro' ) }
						</Button>
					) : null }
					{ manage && api.deleteConnection && /^[a-z0-9]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test( chosen.ref ) ? (
						<Button size="sm" variant="ghost" onClick={ () => setDialog( 'delete' ) }>
							{ __( 'Delete', 'funnelforms-pro' ) }
						</Button>
					) : null }
					{ chosen?.webhookUrl ? (
						<Button size="sm" variant="ghost" onClick={ () => setDialog( 'secret' ) }>
							{ __( 'Enter signing secret', 'funnelforms-pro' ) }
						</Button>
					) : null }
					<Button size="sm" variant="ghost" icon={ icons.plus } onClick={ () => setDialog( 'add' ) }>
						{ __( 'Add connection', 'funnelforms-pro' ) }
					</Button>
				</div>
			) : (
				<p className="ffxb-hint">{ __( 'Connections are added by someone who may change the settings.', 'funnelforms-pro' ) }</p>
			) }
						{ manage && ! kind && chosen ? <p className="ffxb-hint">{ __( 'Try it with a test entry: payments with the test keys of the provider, conversions with the test event code of the platform.', 'funnelforms-pro' ) }</p> : null }
			{ 'secret' === dialog && chosen ? <SecretDialog connection={ chosen } onClose={ () => setDialog( null ) } /> : null }
			{ 'add' === dialog ? (
				<ConnectionDialog
					types={ types }
					onClose={ () => setDialog( null ) }
					onSaved={ ( c ) => {
						onConnection( c );
						onChange( c.ref );
						setDialog( null );
					} }
				/>
			) : null }
			{ 'edit' === dialog && chosen ? (
				<ConnectionDialog
					types={ [ chosen.type ] }
					connection={ chosen }
					onClose={ () => setDialog( null ) }
					onSaved={ ( c ) => {
						onConnections?.( connections.map( ( x ) => ( x.ref === c.ref ? { ...x, ...c } : x ) ) );
						setDialog( null );
					} }
				/>
			) : null }
			{ 'delete' === dialog && chosen ? (
				<DeleteConnectionDialog
					connection={ chosen }
					uses={ connectionUses( doc, chosen.ref ) }
					onClose={ () => setDialog( null ) }
					onDeleted={ () => {
						onConnections?.( connections.filter( ( x ) => x.ref !== chosen.ref ) );
						onChange( '' );
						setDialog( null );
					} }
				/>
			) : null }
			{ 'test' === dialog && chosen && kind ? <TestConnectionDialog connection={ chosen } whatsapp={ 'whatsapp' === kind } test={ test } busy={ testing } result={ tested } onTest={ ( t ) => void runTest( t ) } onClose={ () => {
				setDialog( null );
				setTested( null );
			} } /> : null }
		</>
	);
}

/** Asks for the number (and for WhatsApp the template) a test goes to. */
function TestConnectionDialog( { connection, whatsapp, test, busy, result, onTest, onClose }: { connection: Connection; whatsapp: boolean; test?: ConnectionTest; busy: boolean; result: { ok: boolean; message: string } | null; onTest: ( test: ConnectionTest ) => void; onClose: () => void } ) {
	const [ to, setTo ] = useState( '' );
	const [ sender, setSender ] = useState( test?.sender ?? '' );
	const [ template, setTemplate ] = useState( test?.template || 'hello_world' );
	const [ language, setLanguage ] = useState( test?.language || 'en_US' );
	const ready = '' !== to.trim() && ( ! whatsapp || ( '' !== template.trim() && '' !== language.trim() ) );
	return (
		<Dialog
			title={ sprintf( __( 'Test “%s”', 'funnelforms-pro' ), connection.label ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Close', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ busy || ! ready } onClick={ () => onTest( whatsapp ? { to: to.trim(), template: template.trim(), language: language.trim() } : { to: to.trim(), ...( sender.trim() ? { sender: sender.trim() } : {} ) } ) }>
						{ busy ? __( 'Sending…', 'funnelforms-pro' ) : __( 'Send test', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			{ result && ! result.ok ? <Notice tone="danger">{ result.message }</Notice> : null }
			<TextInput label={ __( 'Send to', 'funnelforms-pro' ) } type="tel" value={ to } placeholder="+49 170 1234567" onChange={ setTo } hint={ __( 'Your own number in international format.', 'funnelforms-pro' ) } />
			{ whatsapp ? (
				<>
					<TextInput label={ __( 'Approved template', 'funnelforms-pro' ) } value={ template } onChange={ setTemplate } hint={ __( 'WhatsApp sends first messages only as approved template; hello_world exists in every account.', 'funnelforms-pro' ) } />
					<TextInput label={ __( 'Language of the template', 'funnelforms-pro' ) } value={ language } onChange={ setLanguage } />
				</>
			) : (
				<TextInput label={ __( 'Sender', 'funnelforms-pro' ) } value={ sender } onChange={ setSender } hint={ __( 'Empty for the name of the website.', 'funnelforms-pro' ) } />
			) }
		</Dialog>
	);
}

/** Deleting a connection, with what stops working in this form. */
function DeleteConnectionDialog( { connection, uses, onClose, onDeleted }: { connection: Connection; uses: string[]; onClose: () => void; onDeleted: () => void } ) {
	const { api } = useEnv();
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const remove = async (): Promise<void> => {
		if ( ! api.deleteConnection ) {
			return;
		}
		setBusy( true );
		setError( null );
		try {
			await api.deleteConnection( connection.ref );
			onDeleted();
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
			setBusy( false );
		}
	};
	return (
		<Dialog
			title={ sprintf( __( 'Delete “%s”?', 'funnelforms-pro' ), connection.label ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="danger" disabled={ busy } onClick={ () => void remove() }>
						{ __( 'Delete connection', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ uses.length ? (
				<Notice tone="warning" title={ __( 'Still in use in this form', 'funnelforms-pro' ) }>
					{ sprintf( __( 'These stop working: %s. Choose another connection for them afterwards.', 'funnelforms-pro' ), uses.join( ', ' ) ) }
				</Notice>
			) : null }
			<p>{ __( 'The connection is deleted for the whole site: other forms that use it stop sending through it too. The stored access keys are removed; this cannot be undone.', 'funnelforms-pro' ) }</p>
		</Dialog>
	);
}

/** The Stripe signing secret, known only once the webhook address is registered in Stripe. */
function SecretDialog( { connection, onClose }: { connection: Connection; onClose: () => void } ) {
	const { api } = useEnv();
	const [ secret, setSecret ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const save = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			await api.updateConnection( connection.ref, { webhookSecret: secret.trim() } );
			onClose();
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
			setBusy( false );
		}
	};
	return (
		<Dialog
			title={ __( 'Enter signing secret', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ busy || '' === secret.trim() } onClick={ () => void save() }>
						{ __( 'Save', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<TextInput label={ __( 'Signing secret (whsec_…)', 'funnelforms-pro' ) } type="password" value={ secret } onChange={ setSecret } hint={ __( 'Shown in Stripe under Developers → Webhooks for the endpoint.', 'funnelforms-pro' ) } />
		</Dialog>
	);
}

/** Adds a connection, or with one given changes its name and replaces the access keys typed in. */
function ConnectionDialog( { types, connection, onClose, onSaved }: { types: string[]; connection?: Connection; onClose: () => void; onSaved: ( c: Connection ) => void } ) {
	const { api } = useEnv();
	const [ type, setType ] = useState( connection?.type ?? types[ 0 ] ?? '' );
	const [ label, setLabel ] = useState( connection?.label ?? '' );
	const [ values, setValues ] = useState<Record<string, string>>( {} );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ sandbox, setSandbox ] = useState( false );
	const fields = credentials( type );
	const complete = '' !== label.trim() && ( connection ? true : fields.every( ( [ key, , , optional ] ) => optional || '' !== ( values[ key ] ?? '' ).trim() ) );
	const save = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const given = Object.fromEntries( Object.entries( values ).filter( ( [ , v ] ) => '' !== v.trim() ) );
			if ( connection ) {
				onSaved( await api.updateConnection( connection.ref, { ...given, label: label.trim() } ) );
			} else {
				onSaved( await api.createConnection( type, label.trim(), 'paypal' === type && sandbox ? { ...given, sandbox: true } : given ) );
			}
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
			setBusy( false );
		}
	};
	return (
		<Dialog
			title={ connection ? __( 'Edit connection', 'funnelforms-pro' ) : __( 'Add connection', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ busy || ! complete } onClick={ () => void save() }>
						{ __( 'Save connection', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ types.length > 1 && ! connection ? <Select label={ __( 'Service', 'funnelforms-pro' ) } value={ type } options={ types.map( ( t ) => ( { value: t, label: connectionTypeName( t ) } ) ) } onChange={ setType } /> : null }
			{ connection ? <p className="ffxb-hint">{ connectionTypeName( type ) }</p> : null }
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
			<p className="ffxb-hint">{ connection ? __( 'Fill in only what changes; empty fields keep the stored values. Access keys are stored encrypted and never shown again.', 'funnelforms-pro' ) : __( 'Access keys are stored encrypted and never shown again.', 'funnelforms-pro' ) }</p>
		</Dialog>
	);
}

/** The condition of an action in words, with the contact fields it may ask for. */
function whenText( doc: FormDocument, when: Condition ): string {
	return describeCondition( when, doc, doc.locales.default, new Map( entryFields( doc ).map( ( f ) => [ f.field.id, f.field ] ) ) );
}

/**
 * For which entries an action runs: every entry, or only those a condition holds for, so leads
 * from one region or with a high score go to the person responsible (lead routing). Funnelforms
 * Pro; Free shows such a condition only to remove it.
 */
function ActionCondition( { doc, action }: { doc: FormDocument; action: Action } ) {
	const change = useChange();
	const { readOnly } = useEnv();
	const write = ( when: Condition | null, key?: string ): void =>
		change( ( d ) => {
			const a = d.actions.find( ( x ) => x.id === action.id );
			if ( a && when ) {
				a.when = when;
			} else if ( a ) {
				delete a.when;
			}
		}, key ? `action:${ action.id }:when:${ key }` : undefined );
	if ( 'free' === process.env.FUNNELFORMS_EDITION ) {
		return action.when ? (
			<Notice
				tone="warning"
				action={
					<Button size="sm" disabled={ readOnly } onClick={ () => write( null ) }>
						{ __( 'Run for every entry', 'funnelforms-pro' ) }
					</Button>
				}
			>
				{ __( 'This action runs only for some entries. Conditions of actions are part of Funnelforms Pro.', 'funnelforms-pro' ) }
			</Notice>
		) : null;
	}
	const fields = entryFields( doc );
	const starter = fields.map( ( f ) => starterRule( f.field ) ).find( Boolean ) ?? ( doc.calculations[ 0 ] ? calcRule( doc.calculations[ 0 ].id ) : null );
	return (
		<div className="ffxb-visibility">
			<p className="ffxb-field__label">{ __( 'For which entries', 'funnelforms-pro' ) }</p>
			<div className="ffxb-segmented" role="group" aria-label={ __( 'For which entries', 'funnelforms-pro' ) }>
				<button type="button" className="ffxb-segmented__item" aria-pressed={ ! action.when } disabled={ readOnly } onClick={ () => write( null ) }>
					{ __( 'Every entry', 'funnelforms-pro' ) }
				</button>
				<button type="button" className="ffxb-segmented__item" aria-pressed={ Boolean( action.when ) } disabled={ readOnly || ( ! action.when && ! starter ) } onClick={ () => ! action.when && starter && write( starter ) }>
					{ __( 'Only if …', 'funnelforms-pro' ) }
				</button>
			</div>
			{ action.when ? (
				<>
					<ConditionEditor doc={ doc } fields={ fields } calcs value={ action.when } lead={ __( 'Only for entries where', 'funnelforms-pro' ) } onChange={ write } />
					<p className="ffxb-hint">{ __( 'For example, a second mail for postcodes starting with 8 goes to your team in Bavaria. Skipped entries appear in the delivery log.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
		</div>
	);
}

function ActionEditor( { doc, action, connections, onConnections }: { doc: FormDocument; action: Action; connections: Connection[]; onConnections: ( list: Connection[] ) => void } ) {
	const onConnection = ( c: Connection ): void => onConnections( [ ...connections, c ] );
	const change = useChange();
	const textOf = useConfigText( doc, action );
	const set = useConfigValue( action );
	const locale = doc.locales.default;
	const contacts = doc.nodes.filter( ( n ) => 'contact' === n.type );

	const field = ( key: string, label: string, options: { multiline?: boolean; hint?: string; placeholders?: boolean } = {} ) => {
		const t = textOf( key );
		return (
			<>
				<TextInput label={ label } value={ t.value } placeholder={ t.placeholder } onChange={ t.set } multiline={ options.multiline } hint={ options.hint } />
				{ options.placeholders ? <Placeholders doc={ doc } onInsert={ ( token ) => t.set( t.value + ( t.value && ! /\s$/.test( t.value ) ? ' ' : '' ) + token ) } /> : null }
			</>
		);
	};

	const common = (
		<>
			{ ( doc.settings.payment || 'paid' === action.on ) && 'googleAds' !== action.kind ? (
				<Select
					label={ __( 'When', 'funnelforms-pro' ) }
					value={ action.on }
					options={ [
						{ value: 'submit', label: __( 'When the entry is sent', 'funnelforms-pro' ) },
						{ value: 'paid', label: __( 'Once the payment went through', 'funnelforms-pro' ) },
					] }
					onChange={ ( v ) =>
						change( ( d ) => {
							const a = d.actions.find( ( x ) => x.id === action.id );
							if ( a ) {
								a.on = v;
							}
						} )
					}
				/>
			) : null }
			{ contacts.length > 1 || action.node ? (
				<Select
					label={ __( 'For entries from', 'funnelforms-pro' ) }
					value={ action.node ?? '' }
					options={ [ { value: '', label: __( 'Every contact step', 'funnelforms-pro' ) }, ...contacts.map( ( n ) => ( { value: n.id, label: nodeName( n, locale ) } ) ) ] }
					onChange={ ( v ) =>
						change( ( d ) => {
							const a = d.actions.find( ( x ) => x.id === action.id );
							if ( a ) {
								if ( v ) {
									a.node = v;
								} else {
									delete a.node;
								}
							}
						} )
					}
				/>
			) : null }
			<ActionCondition doc={ doc } action={ action } />
		</>
	);

	switch ( action.kind ) {
		case 'email':
		case 'autoresponder': {
			const smtp = connections.filter( ( c ) => CONNECTION_TYPES.smtp.includes( c.type ) );
			const transport = action.config.transport;
			const emails = emailFields( doc );
			return (
				<>
					{ 'autoresponder' === action.kind ? (
						emails.length ? (
							<Select
								label={ __( 'Send to the address in', 'funnelforms-pro' ) }
								value={ action.config.recipientField ?? '' }
								options={ [ ...( action.config.recipientField ? [] : [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) } ] ), ...emails.map( ( f ) => ( { value: f.id, label: text( f.label, locale ) || f.key } ) ) ] }
								onChange={ ( v ) => change( ( d ) => setRecipient( d, action.id, v ) ) }
							/>
						) : (
							<Notice tone="warning">{ __( 'Add an e-mail field to a contact step to send a confirmation.', 'funnelforms-pro' ) }</Notice>
						)
					) : (
						field( 'to', __( 'To', 'funnelforms-pro' ), { hint: __( 'Several addresses separated by commas.', 'funnelforms-pro' ) } )
					) }
					{ field( 'subject', __( 'Subject', 'funnelforms-pro' ) ) }
					<MailEditor label={ __( 'Message', 'funnelforms-pro' ) } value={ textOf( 'body' ).value } nl2br={ action.config.nl2br } onChange={ textOf( 'body' ).set } placeholders={ ( insert ) => <Placeholders doc={ doc } onInsert={ insert } /> } />
					<Toggle
						label={ __( 'Designed mail', 'funnelforms-pro' ) }
						checked={ 'branded' === action.config.layout }
						onChange={ ( v ) => set( 'layout', v ? 'branded' : 'plain' ) }
						hint={ __( 'Your text on a card in the colour of the form, with the logo of your website; all answers as a clear table.', 'funnelforms-pro' ) }
					/>
					{ /* The PDF is Funnelforms Pro: Free shows the switch only to turn it off. */ }
					{ 'free' !== process.env.FUNNELFORMS_EDITION || true === action.config.attachPdf ? <Toggle label={ __( 'Attach the entry as PDF', 'funnelforms-pro' ) } checked={ true === action.config.attachPdf } onChange={ ( v ) => set( 'attachPdf', v ) } /> : null }
					<details className="ffxb-advanced">
						<summary>{ __( 'Sender and copies', 'funnelforms-pro' ) }</summary>
						{ field( 'fromName', __( 'Sender name', 'funnelforms-pro' ) ) }
						{ field( 'from', __( 'Sender address', 'funnelforms-pro' ), { hint: __( 'Empty for the address of the website. Use an address of your own domain, or mails may land in spam.', 'funnelforms-pro' ) } ) }
						{ field( 'replyTo', __( 'Reply to', 'funnelforms-pro' ) ) }
						{ field( 'cc', __( 'Copy to (CC)', 'funnelforms-pro' ) ) }
						{ field( 'bcc', __( 'Blind copy to (BCC)', 'funnelforms-pro' ) ) }
						<Toggle label={ __( 'Keep line breaks', 'funnelforms-pro' ) } checked={ action.config.nl2br } onChange={ ( v ) => set( 'nl2br', v ) } />
						{ smtp.length || 'smtp' === transport.type ? (
							<Select
								label={ __( 'Send through', 'funnelforms-pro' ) }
								value={ 'smtp' === transport.type ? transport.connectionRef : '' }
								options={ [ { value: '', label: __( 'As set under Settings → E-mail', 'funnelforms-pro' ) }, ...smtp.map( ( c ) => ( { value: c.ref, label: c.label } ) ), ...( 'smtp' === transport.type && ! smtp.some( ( c ) => c.ref === transport.connectionRef ) ? [ { value: transport.connectionRef, label: __( 'SMTP from Funnelforms 3', 'funnelforms-pro' ) } ] : [] ) ] }
								onChange={ ( v ) => set( 'transport', v ? { type: 'smtp', connectionRef: v } : { type: 'wp_mail' } ) }
							/>
						) : null }
						{ 'autoresponder' === action.kind ? (
							<TextInput label={ __( 'Attachment (address of a file in the media library)', 'funnelforms-pro' ) } value={ action.config.attachmentUrl ?? '' } onChange={ ( v ) => set( 'attachmentUrl', v.trim() ? v : undefined ) } />
						) : null }
					</details>
					{ common }
				</>
			);
		}
		case 'webhook':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProAction kind={ action.kind } /> : (
				<>
					<TextInput
						label={ __( 'Web address', 'funnelforms-pro' ) }
						type="url"
						value={ action.config.url }
						placeholder="https://"
						onChange={ ( v ) => set( 'url', v.trim() ) }
						hint={ __( 'Receives each entry as JSON, signed with the site\'s webhook secret.', 'funnelforms-pro' ) }
					/>
					<Select
						label={ __( 'Format', 'funnelforms-pro' ) }
						value={ action.config.format ?? '' }
						options={ [
							{ value: '', label: __( 'Funnelforms 3 (Pro)', 'funnelforms-pro' ) },
							{ value: 'ff4', label: __( 'Funnelforms 4 (Zaps and scenarios built on the online version)', 'funnelforms-pro' ) },
						] }
						onChange={ ( v ) => set( 'format', 'ff4' === v ? 'ff4' : undefined ) }
						hint={
							'ff4' === action.config.format
								? __( 'Fields are named by their variable names; contact fields as "field-" plus the name. Give fields the IDs they had in Funnelforms 4 as variable names, and existing Zaps keep working.', 'funnelforms-pro' )
								: undefined
						}
					/>
					{ common }
				</>
			);
		case 'crm':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProAction kind={ action.kind } /> : <CrmAction doc={ doc } action={ action } common={ common } />;
		case 'chat':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProAction kind={ action.kind } /> : (
				<>
					<Select
						label={ __( 'Service', 'funnelforms-pro' ) }
						value={ action.config.service }
						options={ [
							{ value: 'slack', label: 'Slack' },
							{ value: 'teams', label: 'Microsoft Teams' },
						] }
						onChange={ ( v ) => set( 'service', v ) }
					/>
					<ConnectionPicker types={ [ action.config.service ] } value={ action.config.connectionRef } connections={ connections } onChange={ ( v ) => set( 'connectionRef', v ) } onConnection={ onConnection } onConnections={ onConnections } />
					{ field( 'message', __( 'Message', 'funnelforms-pro' ), { multiline: true, placeholders: true } ) }
					<Toggle label={ __( 'Show the answers', 'funnelforms-pro' ) } checked={ action.config.showAnswers } onChange={ ( v ) => set( 'showAnswers', v ) } />
					<Toggle label={ __( 'Show the contact details', 'funnelforms-pro' ) } checked={ action.config.showContact } onChange={ ( v ) => set( 'showContact', v ) } />
					{ common }
				</>
			);
		case 'sms':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProAction kind={ action.kind } /> : (
				<>
					<ConnectionPicker types={ CONNECTION_TYPES.sms } value={ action.config.connectionRef } connections={ connections } onChange={ ( v ) => set( 'connectionRef', v ) } onConnection={ onConnection } onConnections={ onConnections } test={ { sender: action.config.sender } } />
					{ field( 'to', __( 'To', 'funnelforms-pro' ), { hint: __( 'Numbers separated by commas; a placeholder of a phone field sends to the visitor.', 'funnelforms-pro' ), placeholders: true } ) }
					<TextInput label={ __( 'Sender', 'funnelforms-pro' ) } value={ action.config.sender } onChange={ ( v ) => set( 'sender', v ) } hint={ __( 'Up to 11 letters or a number, as your provider allows.', 'funnelforms-pro' ) } />
					{ field( 'message', __( 'Message', 'funnelforms-pro' ), { multiline: true, placeholders: true } ) }
					<TextInput label={ __( 'Country code for numbers without one', 'funnelforms-pro' ) } value={ action.config.countryCode ?? '' } placeholder="49" onChange={ ( v ) => set( 'countryCode', v.replace( /\D/g, '' ) || undefined ) } />
					{ common }
				</>
			);
		case 'whatsapp':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProAction kind={ action.kind } /> : (
				<>
					<ConnectionPicker types={ CONNECTION_TYPES.whatsapp } value={ action.config.connectionRef } connections={ connections } onChange={ ( v ) => set( 'connectionRef', v ) } onConnection={ onConnection } onConnections={ onConnections } test={ { template: action.config.template, language: action.config.language } } />
					{ field( 'to', __( 'To', 'funnelforms-pro' ), { placeholders: true } ) }
					<WhatsAppTemplatePicker
						connectionRef={ action.config.connectionRef }
						template={ action.config.template }
						language={ action.config.language }
						values={ action.config.parameters.map( ( p ) => text( p, locale ) ) }
						defaultLanguage={ locale.replace( '-', '_' ) }
						onTemplate={ ( v ) => set( 'template', v ) }
						onLanguage={ ( v ) => set( 'language', v ) }
						onChoose={ ( t ) =>
							change( ( d ) => {
								const a = d.actions.find( ( x ) => x.id === action.id );
								if ( a && 'whatsapp' === a.kind ) {
									a.config.template = t.name;
									a.config.language = t.language;
									// One text per placeholder: kept where there is one, empty where it is new.
									a.config.parameters = Array.from( { length: t.placeholders }, ( _, i ) => a.config.parameters[ i ] ?? { [ locale ]: '' } );
								}
							} )
						}
					/>
					{ action.config.parameters.map( ( p, i ) => (
						<FieldRow key={ i } label={ sprintf( __( 'Placeholder {{%d}} of the template', 'funnelforms-pro' ), i + 1 ) }>
							{ ( id ) => (
								<div className="ffxb-inline">
									<input
										id={ id }
										className="ffxb-input"
										value={ text( p, locale ) }
										onChange={ ( e ) => {
											const v = e.target.value;
											change( ( d ) => {
												const a = d.actions.find( ( x ) => x.id === action.id );
												if ( a && 'whatsapp' === a.kind ) {
													a.config.parameters[ i ] = { ...a.config.parameters[ i ], [ locale ]: v };
												}
											}, `action:${ action.id }:p${ i }` );
										} }
									/>
									<Button
										size="sm"
										variant="ghost"
										icon={ icons.trash }
										aria-label={ __( 'Delete', 'funnelforms-pro' ) }
										onClick={ () =>
											change( ( d ) => {
												const a = d.actions.find( ( x ) => x.id === action.id );
												if ( a && 'whatsapp' === a.kind ) {
													a.config.parameters.splice( i, 1 );
												}
											} )
										}
									/>
								</div>
							) }
						</FieldRow>
					) ) }
					<Button
						size="sm"
						variant="ghost"
						icon={ icons.plus }
						onClick={ () =>
							change( ( d ) => {
								const a = d.actions.find( ( x ) => x.id === action.id );
								if ( a && 'whatsapp' === a.kind ) {
									a.config.parameters.push( { [ locale ]: '' } );
								}
							} )
						}
					>
						{ __( 'Add a placeholder text', 'funnelforms-pro' ) }
					</Button>
					{ common }
				</>
			);
		case 'conversion':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProAction kind={ action.kind } /> : (
				<>
					<Select
						label={ __( 'Platform', 'funnelforms-pro' ) }
						value={ action.config.platform }
						options={ [
							{ value: 'meta', label: 'Meta (Conversions API)' },
							{ value: 'ga4', label: 'Google Analytics 4' },
							{ value: 'tiktok', label: 'TikTok (Events API)' },
						] }
						onChange={ ( v ) => {
							set( 'platform', v );
							set( 'connectionRef', '' );
						} }
					/>
					<ConnectionPicker types={ [ action.config.platform ] } value={ action.config.connectionRef } connections={ connections } onChange={ ( v ) => set( 'connectionRef', v ) } onConnection={ onConnection } onConnections={ onConnections } />
					<TextInput label={ __( 'Event', 'funnelforms-pro' ) } value={ action.config.eventName } placeholder={ __( 'Standard event of the platform', 'funnelforms-pro' ) } onChange={ ( v ) => set( 'eventName', v.trim() ) } />
						{ 'ga4' === action.config.platform ? null : (
							<TextInput
								label={ __( 'Test event code', 'funnelforms-pro' ) }
								value={ action.config.testEventCode ?? '' }
								onChange={ ( v ) => set( 'testEventCode', v.trim() || undefined ) }
								hint={ __( 'Only for tests: events with a code show up in the test view of the platform. Remove it before going live.', 'funnelforms-pro' ) }
							/>
						) }
					{ doc.calculations.length ? (
						<Select
							label={ __( 'Value from the calculation', 'funnelforms-pro' ) }
							value={ action.config.valueCalculation ?? '' }
							options={ [ { value: '', label: __( 'No value', 'funnelforms-pro' ) }, ...doc.calculations.map( ( c ) => ( { value: c.id, label: c.label || c.id } ) ) ] }
							onChange={ ( v ) => set( 'valueCalculation', v || undefined ) }
						/>
					) : null }
					{ action.config.valueCalculation ? <TextInput label={ __( 'Currency', 'funnelforms-pro' ) } value={ action.config.currency ?? '' } placeholder="EUR" onChange={ ( v ) => set( 'currency', v.trim().toUpperCase() || undefined ) } /> : null }
					<p className="ffxb-hint">{ __( 'Sent only when the cookie banner of your website reports the visitor\'s consent through the WP Consent API. Without that consent nothing is sent.', 'funnelforms-pro' ) }</p>
					{ common }
				</>
			);
		case 'googleAds':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProAction kind={ action.kind } /> : (
				<>
					<TextInput
						label={ __( 'Conversion ID and label', 'funnelforms-pro' ) }
						value={ action.config.sendTo }
						placeholder="AW-123456789/AbC-D_efG"
						onChange={ ( v ) => set( 'sendTo', v.replace( /\s/g, '' ) ) }
						hint={ __( 'In Google Ads under Goals, Conversions: the value of send_to in the event snippet.', 'funnelforms-pro' ) }
					/>
					<p className="ffxb-hint">{ __( 'Sent in the visitor\'s browser through the Google tag of your website once the entry is stored. Without a Google tag on the page nothing is sent.', 'funnelforms-pro' ) }</p>
					{ doc.calculations.length ? (
						<Select
							label={ __( 'Value from the calculation', 'funnelforms-pro' ) }
							value={ action.config.valueCalculation ?? '' }
							options={ [ { value: '', label: __( 'No value', 'funnelforms-pro' ) }, ...doc.calculations.map( ( c ) => ( { value: c.id, label: c.label || c.id } ) ) ] }
							onChange={ ( v ) => set( 'valueCalculation', v || undefined ) }
						/>
					) : null }
					{ action.config.valueCalculation ? <TextInput label={ __( 'Currency', 'funnelforms-pro' ) } value={ action.config.currency ?? '' } placeholder="EUR" onChange={ ( v ) => set( 'currency', v.trim().toUpperCase() || undefined ) } /> : null }
					<Toggle
						label={ __( 'Only with the visitor\'s consent', 'funnelforms-pro' ) }
						hint={
							euPrivacy()
								? __( 'Always on in the EU privacy mode.', 'funnelforms-pro' )
								: openPrivacy()
									? __( 'Always off in the unrestricted privacy mode: sent for every visitor.', 'funnelforms-pro' )
									: __( 'Off: sent unless the visitor refused, for cookie banners that do not report consent.', 'funnelforms-pro' )
						}
						checked={ euPrivacy() || ( ! openPrivacy() && action.config.requireConsent ) }
						disabled={ euPrivacy() || openPrivacy() }
						onChange={ ( v ) => set( 'requireConsent', v ) }
					/>
					<Toggle
						label={ __( 'Enhanced conversions', 'funnelforms-pro' ) }
						hint={ __( 'The Google tag gets the e-mail address and phone number of the contact step and hashes them before sending. Only with marketing consent; turn on enhanced conversions in Google Ads too.', 'funnelforms-pro' ) }
						checked={ true === action.config.enhanced }
						onChange={ ( v ) => set( 'enhanced', v || undefined ) }
					/>
					{ common }
				</>
			);
		default:
			return (
				<>
					<p className="ffxb-hint">{ __( 'This connection comes from Funnelforms 3 and keeps working as it is. Its settings are not edited here yet.', 'funnelforms-pro' ) }</p>
					{ common }
				</>
			);
	}
}
