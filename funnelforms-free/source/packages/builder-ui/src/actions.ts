/**
 * Actions of a form: what happens with an entry once it is sent (or paid). Like document.ts,
 * each function changes the document it gets and returns the id of what it created.
 */
import type { Action, ContactField, FormDocument, Text } from '@funnelforms/form-schema';
import { newId } from './document';

/** Kinds the builder creates. */
export const ACTION_KINDS = [ 'email', 'autoresponder', 'webhook', 'crm', 'chat', 'sms', 'whatsapp', 'conversion', 'googleAds' ] as const;

export type ActionKind = ( typeof ACTION_KINDS )[ number ];

/** Connection types each kind can use. */
export const CONNECTION_TYPES: Record<'chat' | 'sms' | 'whatsapp' | 'conversion' | 'smtp', string[]> = {
	chat: [ 'slack', 'teams' ],
	sms: [ 'twilio', 'bird' ],
	whatsapp: [ 'whatsapp' ],
	conversion: [ 'meta', 'ga4', 'tiktok' ],
	smtp: [ 'smtp' ],
};

/**
 * Whether a connection ref names a provider Funnelforms no longer supports: MessageBird (Bird is
 * its successor), created in the builder (messagebird:…) or brought from Funnelforms 3
 * (legacy:messagebird). Such actions are incomplete until another connection is chosen.
 */
export function retiredConnection( ref: string | undefined ): boolean {
	return /^messagebird:/.test( ref ?? '' ) || 'legacy:messagebird' === ref;
}

/** Default texts of new actions, in the form's language. */
export interface ActionTexts {
	adminSubject: string;
	adminBody: string;
	replySubject: string;
	replyBody: string;
	chatMessage: string;
}

const EN: ActionTexts = {
	adminSubject: 'New entry',
	adminBody: 'You have a new entry:\n\n{{lead}}\n\n{{answers}}',
	replySubject: 'Thank you for your request',
	replyBody: 'Thank you! We have received your answers and will get back to you soon.\n\n{{answers}}',
	chatMessage: 'New entry',
};

/** The site's admin address, the recipient of new mails to the owner (set from the page config). */
let ownerEmail = '';

export function setOwnerEmail( address?: string ): void {
	ownerEmail = address ?? '';
}

/** Funnelforms → Integrations, for users who may connect tools (set from the page config). */
let integrations = '';

export function setIntegrationsUrl( address?: string | null ): void {
	integrations = address ?? '';
}

export function integrationsUrl(): string {
	return integrations;
}

/** The kind of action that sends entries through a connection type (CRM tools get crm). */
export const ACTION_FOR_TYPE: Record<string, 'chat' | 'sms' | 'whatsapp' | 'conversion'> = {
	slack: 'chat',
	teams: 'chat',
	twilio: 'sms',
	bird: 'sms',
	whatsapp: 'whatsapp',
	meta: 'conversion',
	ga4: 'conversion',
	tiktok: 'conversion',
};

function t( locale: string, value: string ): Text {
	return { [ locale ]: value };
}

/** E-mail fields of the contact steps, the recipients an autoresponder can use. */
export function emailFields( doc: FormDocument ): ContactField[] {
	const out: ContactField[] = [];
	for ( const node of doc.nodes ) {
		if ( 'contact' === node.type ) {
			out.push( ...node.fields.filter( ( f ) => 'email' === f.type ) );
		}
	}
	return out;
}

/** A new action with sensible defaults; mails go through WordPress. */
export function createAction( doc: FormDocument, kind: ActionKind, texts: Partial<ActionTexts> = {} ): Action {
	const locale = doc.locales.default;
	const x = { ...EN, ...texts };
	const id = newId( doc, 'a' );
	const mail = ( subject: string, body: string ) => ( {
		to: t( locale, '' ),
		cc: t( locale, '' ),
		bcc: t( locale, '' ),
		from: t( locale, '' ),
		fromName: t( locale, '' ),
		replyTo: t( locale, '' ),
		subject: t( locale, subject ),
		body: t( locale, body ),
		nl2br: true,
		transport: { type: 'wp_mail' as const },
		layout: 'branded' as const,
	} );
	switch ( kind ) {
		case 'email': {
			const email = emailFields( doc )[ 0 ];
			const config = { ...mail( x.adminSubject, x.adminBody ), to: t( locale, ownerEmail ) };
			if ( email ) {
				config.replyTo = t( locale, `{{field:${ email.key }}}` );
			}
			return { id, on: 'submit', kind, config };
		}
		case 'autoresponder': {
			const email = emailFields( doc )[ 0 ];
			const config = mail( x.replySubject, x.replyBody );
			if ( ! email ) {
				return { id, on: 'submit', kind, config };
			}
			return { id, on: 'submit', kind, config: { ...config, to: t( locale, `{{field:${ email.key }}}` ), recipientField: email.id } };
		}
		case 'webhook':
			return { id, on: 'submit', kind, config: { url: '' } };
		case 'crm':
			return { id, on: 'submit', kind, config: { provider: '', connectionRef: '', mapping: {} } };
		case 'chat':
			return { id, on: 'submit', kind, config: { service: 'slack', connectionRef: '', message: t( locale, x.chatMessage ), showAnswers: true, showContact: true } };
		case 'sms':
			return { id, on: 'submit', kind, config: { connectionRef: '', to: t( locale, '' ), sender: '', message: t( locale, x.chatMessage ) } };
		case 'whatsapp':
			return { id, on: 'submit', kind, config: { connectionRef: '', to: t( locale, '' ), template: '', language: locale.slice( 0, 2 ), parameters: [] } };
		case 'conversion':
			return { id, on: 'submit', kind, config: { platform: 'meta', connectionRef: '', eventName: '', requireConsent: true } };
		case 'googleAds':
			return { id, on: 'submit', kind, config: { sendTo: '', requireConsent: true } };
	}
}

export function addAction( doc: FormDocument, kind: ActionKind, texts: Partial<ActionTexts> = {} ): string {
	const action = createAction( doc, kind, texts );
	doc.actions.push( action );
	return action.id;
}

/**
 * Adds an action that sends each entry through a connection the site has (Slack, an SMS
 * provider, WhatsApp, a conversion platform), with the connection already chosen. Returns its id,
 * or null for a type no action sends through.
 */
export function addActionFor( doc: FormDocument, connection: { type: string; ref: string }, texts: Partial<ActionTexts> = {} ): string | null {
	const kind = ACTION_FOR_TYPE[ connection.type ];
	if ( ! kind ) {
		return null;
	}
	const action = createAction( doc, kind, texts );
	if ( 'chat' === action.kind ) {
		action.config.service = 'teams' === connection.type ? 'teams' : 'slack';
	} else if ( 'conversion' === action.kind ) {
		action.config.platform = connection.type as typeof action.config.platform;
	}
	if ( 'chat' === action.kind || 'sms' === action.kind || 'whatsapp' === action.kind || 'conversion' === action.kind ) {
		action.config.connectionRef = connection.ref;
	}
	doc.actions.push( action );
	return action.id;
}

/** Adds a CRM, newsletter or spreadsheet action for a connection, with a first mapping. */
export function addCrmAction( doc: FormDocument, provider: string, ref: string, mapping: Record<string, string> ): string {
	const action = createAction( doc, 'crm' );
	if ( 'crm' === action.kind ) {
		action.config = { provider, connectionRef: ref, mapping };
	}
	doc.actions.push( action );
	return action.id;
}

export function removeAction( doc: FormDocument, id: string ): void {
	doc.actions = doc.actions.filter( ( a ) => a.id !== id );
}

export function duplicateAction( doc: FormDocument, id: string ): string | null {
	const index = doc.actions.findIndex( ( a ) => a.id === id );
	const source = doc.actions[ index ];
	if ( ! source ) {
		return null;
	}
	const copy = { ...( JSON.parse( JSON.stringify( source ) ) as Action ), id: newId( doc, 'a' ) };
	doc.actions.splice( index + 1, 0, copy );
	return copy.id;
}

/** Sets the recipient of an autoresponder: the field and the address token for it. */
export function setRecipient( doc: FormDocument, id: string, fieldId: string ): void {
	const action = doc.actions.find( ( a ) => a.id === id );
	const field = emailFields( doc ).find( ( f ) => f.id === fieldId );
	if ( action && 'autoresponder' === action.kind && field ) {
		action.config.recipientField = field.id;
		action.config.to = { ...action.config.to, [ doc.locales.default ]: `{{field:${ field.key }}}` };
	}
}

/** Conversion ID and label of a Google Ads conversion, as the event snippet shows them. */
export const ADS_SEND_TO = /^AW-[0-9]{5,15}\/[A-Za-z0-9_-]{1,64}$/;

/**
 * What keeps new leads from reaching anyone, checked before publishing (a warning, not a block):
 * a form with a contact step that tells nobody about entries, and mails without a recipient.
 */
export function deliveryWarnings( doc: FormDocument ): Array<'nobody' | 'recipient'> {
	const out: Array<'nobody' | 'recipient'> = [];
	const tells = doc.actions.some( ( a ) => [ 'email', 'webhook', 'crm', 'chat', 'sms', 'whatsapp' ].includes( a.kind ) );
	if ( ! tells && doc.nodes.some( ( n ) => 'contact' === n.type ) ) {
		out.push( 'nobody' );
	}
	if ( doc.actions.some( ( a ) => ( 'email' === a.kind || 'autoresponder' === a.kind ) && actionGaps( a, doc.locales.default ).includes( 'recipient' ) ) ) {
		out.push( 'recipient' );
	}
	return out;
}

/** What is still missing for an action to work; empty when it is complete. */
export function actionGaps( action: Action, locale: string ): Array<'recipient' | 'url' | 'connection' | 'template' | 'sendTo'> {
	const value = ( text: Text | undefined ): string => ( text?.[ locale ] ?? Object.values( text ?? {} )[ 0 ] ?? '' ).trim();
	switch ( action.kind ) {
		case 'email':
		case 'autoresponder':
			return '' === value( action.config.to ) ? [ 'recipient' ] : [];
		case 'webhook':
			return /^https?:\/\/\S+\.\S+/.test( action.config.url ) ? [] : [ 'url' ];
		case 'chat':
		case 'conversion':
			return '' === action.config.connectionRef ? [ 'connection' ] : [];
		case 'crm':
			return '' === action.config.provider || '' === action.config.connectionRef ? [ 'connection' ] : [];
		case 'sms':
			return [ ...( '' === action.config.connectionRef || retiredConnection( action.config.connectionRef ) ? [ 'connection' as const ] : [] ), ...( '' === value( action.config.to ) ? [ 'recipient' as const ] : [] ) ];
		case 'whatsapp':
			return [
				...( '' === action.config.connectionRef ? [ 'connection' as const ] : [] ),
				...( '' === value( action.config.to ) ? [ 'recipient' as const ] : [] ),
				...( '' === action.config.template.trim() ? [ 'template' as const ] : [] ),
			];
		case 'googleAds':
			return ADS_SEND_TO.test( action.config.sendTo ) ? [] : [ 'sendTo' ];
		default:
			return [];
	}
}
