import { describe, expect, it } from 'vitest';
import { checkReferences, validateDocument } from '@funnelforms/form-schema';
import { ACTION_KINDS, actionGaps, type ActionKind, type ActionTexts, addAction, addActionFor, addCrmAction, CONNECTION_TYPES, deliveryWarnings, duplicateAction, emailFields, removeAction, retiredConnection, setOwnerEmail, setRecipient } from '../src/actions';
import type { Action, FormDocument } from '@funnelforms/form-schema';
import { addCalculation, calculationUses } from '../src/calculations';
import { blank } from './blank';

function added( doc: FormDocument, kind: ActionKind, texts: Partial<ActionTexts> = {} ): Action | undefined {
	const id = addAction( doc, kind, texts );
	return doc.actions.find( ( a ) => a.id === id );
}

/** Fills in what the user still has to enter. */
function complete( action: Action ): void {
	switch ( action.kind ) {
		case 'email':
		case 'autoresponder':
			action.config.to = { de_DE: 'info@example.com' };
			break;
		case 'webhook':
			action.config.url = 'https://example.com/hook';
			break;
		case 'whatsapp':
			action.config.template = 'neue_anfrage';
			action.config.to = { de_DE: '{{field:phone}}' };
			action.config.connectionRef = 'conn:1';
			break;
		case 'sms':
			action.config.to = { de_DE: '+49171000000' };
			action.config.connectionRef = 'conn:1';
			break;
		case 'chat':
		case 'conversion':
			action.config.connectionRef = 'conn:1';
			break;
		case 'crm':
			action.config.provider = 'hubspot';
			action.config.connectionRef = 'hubspot:1';
			break;
		case 'googleAds':
			action.config.sendTo = 'AW-123456789/AbC-D_efG';
			break;
	}
}

describe( 'actions', () => {
	it( 'are valid for every kind once what actionGaps names is filled in', () => {
		const doc = blank();
		for ( const kind of ACTION_KINDS ) {
			addAction( doc, kind );
		}
		expect( doc.actions.map( ( a ) => a.kind ) ).toEqual( [ ...ACTION_KINDS ] );
		expect( new Set( doc.actions.map( ( a ) => a.id ) ).size ).toBe( ACTION_KINDS.length );
		expect( checkReferences( doc ) ).toEqual( [] );
		// What actionGaps names keeps the document from being published; a mail without recipient
		// only sends nothing (forms from Funnelforms 3 can have such mails), so it is just a hint.
		// A CRM action without a tool passes the schema; the server's check of the providers refuses it.
		for ( const action of doc.actions ) {
			const single = { ...blank(), actions: [ action ] };
			const mail = 'email' === action.kind || 'autoresponder' === action.kind || 'crm' === action.kind;
			expect( validateDocument( single ).valid, action.kind ).toBe( mail || 0 === actionGaps( action, 'de_DE' ).length );
			complete( action );
			expect( actionGaps( action, 'de_DE' ), action.kind ).toEqual( [] );
		}
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );

	it( 'send the confirmation to the e-mail field and replies to the visitor', () => {
		const doc = blank();
		const reply = added( doc, 'autoresponder', { replySubject: 'Danke' } );
		expect( reply?.kind ).toBe( 'autoresponder' );
		if ( reply && 'autoresponder' === reply.kind ) {
			expect( reply.config.to ).toEqual( { de_DE: '{{field:email}}' } );
			expect( reply.config.recipientField ).toBe( 'c_email' );
			expect( reply.config.subject ).toEqual( { de_DE: 'Danke' } );
		}
		const mail = added( doc, 'email' );
		expect( mail && 'email' === mail.kind ? mail.config.replyTo : null ).toEqual( { de_DE: '{{field:email}}' } );
		expect( mail ? actionGaps( mail, 'de_DE' ) : null ).toEqual( [ 'recipient' ] );
	} );

	it( 'send the mail to the owner to the site\'s address, with the lead summary', () => {
		setOwnerEmail( 'owner@example.test' );
		try {
			const mail = added( blank(), 'email' );
			expect( mail && 'email' === mail.kind ? mail.config.to : null ).toEqual( { de_DE: 'owner@example.test' } );
			expect( mail && 'email' === mail.kind ? mail.config.body.de_DE : '' ).toBe( 'You have a new entry:\n\n{{lead}}\n\n{{answers}}' );
			expect( mail ? actionGaps( mail, 'de_DE' ) : null ).toEqual( [] );
		} finally {
			setOwnerEmail();
		}
	} );

	it( 'warn before publishing when nobody hears of new entries', () => {
		const doc = blank();
		expect( deliveryWarnings( doc ) ).toEqual( [ 'nobody' ] );
		const mail = added( doc, 'email' );
		expect( deliveryWarnings( doc ) ).toEqual( [ 'recipient' ] );
		if ( mail ) {
			complete( mail );
		}
		expect( deliveryWarnings( doc ) ).toEqual( [] );
		const chat = { ...blank(), actions: [] };
		addAction( chat, 'chat' );
		expect( deliveryWarnings( chat ) ).toEqual( [] );
		expect( deliveryWarnings( { ...blank(), nodes: blank().nodes.filter( ( n ) => 'contact' !== n.type ) } ) ).toEqual( [] );
	} );

	it( 'leave the recipient open without an e-mail field', () => {
		const doc = blank();
		for ( const node of doc.nodes ) {
			if ( 'contact' === node.type ) {
				node.fields = node.fields.filter( ( f ) => 'email' !== f.type );
			}
		}
		expect( emailFields( doc ) ).toEqual( [] );
		const reply = added( doc, 'autoresponder' );
		expect( reply && 'autoresponder' === reply.kind ? reply.config.recipientField : 'x' ).toBeUndefined();
		expect( reply ? actionGaps( reply, 'de_DE' ) : null ).toEqual( [ 'recipient' ] );
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );

	it( 'are duplicated next to the original and removed', () => {
		const doc = blank();
		const first = addAction( doc, 'webhook' );
		addAction( doc, 'chat' );
		const copy = duplicateAction( doc, first );
		expect( doc.actions.map( ( a ) => a.id ) ).toEqual( [ first, copy, expect.any( String ) ] );
		expect( copy ).not.toBe( first );
		removeAction( doc, first );
		expect( doc.actions ).toHaveLength( 2 );
		expect( duplicateAction( doc, 'missing' ) ).toBeNull();
	} );

	it( 'change the recipient field only to an e-mail field', () => {
		const doc = blank();
		const id = addAction( doc, 'autoresponder' );
		setRecipient( doc, id, 'c_name' );
		const reply = doc.actions[ 0 ];
		expect( reply && 'autoresponder' === reply.kind ? reply.config.recipientField : '' ).toBe( 'c_email' );
	} );

	it( 'name what is missing', () => {
		const doc = blank();
		const hook = added( doc, 'webhook' );
		const whatsapp = added( doc, 'whatsapp' );
		expect( hook ? actionGaps( hook, 'de_DE' ) : null ).toEqual( [ 'url' ] );
		if ( hook && 'webhook' === hook.kind ) {
			hook.config.url = 'https://example.com/hook';
			expect( actionGaps( hook, 'de_DE' ) ).toEqual( [] );
		}
		expect( whatsapp ? actionGaps( whatsapp, 'de_DE' ) : null ).toEqual( [ 'connection', 'recipient', 'template' ] );
	} );

	it( 'want the conversion ID and label of a Google Ads conversion and count its value as a use of the calculation', () => {
		const doc = blank();
		const ads = added( doc, 'googleAds' );
		if ( ! ads || 'googleAds' !== ads.kind ) {
			throw new Error( 'missing' );
		}
		expect( ads ).toMatchObject( { on: 'submit', config: { sendTo: '', requireConsent: true } } );
		for ( const sendTo of [ 'AW-123456789', '123456789/abc', 'AW-12/abc', 'AW-123456789/ab c' ] ) {
			ads.config.sendTo = sendTo;
			expect( actionGaps( ads, 'de_DE' ), sendTo ).toEqual( [ 'sendTo' ] );
		}
		ads.config.sendTo = 'AW-123456789/AbC-D_efG';
		expect( actionGaps( ads, 'de_DE' ) ).toEqual( [] );
		const calc = addCalculation( doc, 'Wert' );
		ads.config.valueCalculation = calc;
		expect( calculationUses( doc, calc ) ).toEqual( [ 'conversion' ] );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		expect( checkReferences( doc ) ).toEqual( [] );
	} );

	it( 'are added ready to send through a connection the site has', () => {
		const doc = blank();
		const of = ( type: string, ref: string ): Action | undefined => {
			const id = addActionFor( doc, { type, ref } );
			return doc.actions.find( ( a ) => a.id === id );
		};
		expect( of( 'teams', 'teams:1' ) ).toMatchObject( { on: 'submit', kind: 'chat', config: { service: 'teams', connectionRef: 'teams:1', showAnswers: true } } );
		expect( of( 'slack', 'slack:1' ) ).toMatchObject( { kind: 'chat', config: { service: 'slack', connectionRef: 'slack:1' } } );
		expect( of( 'bird', 'bird:1' ) ).toMatchObject( { kind: 'sms', config: { connectionRef: 'bird:1' } } );
		expect( of( 'whatsapp', 'whatsapp:1' ) ).toMatchObject( { kind: 'whatsapp', config: { connectionRef: 'whatsapp:1', template: '' } } );
		expect( of( 'ga4', 'ga4:1' ) ).toMatchObject( { kind: 'conversion', config: { platform: 'ga4', connectionRef: 'ga4:1', requireConsent: true } } );
		expect( addActionFor( doc, { type: 'stripe', ref: 'stripe:1' } ) ).toBeNull();
		expect( addActionFor( doc, { type: 'messagebird', ref: 'messagebird:1' } ) ).toBeNull();
		const crmId = addCrmAction( doc, 'hubspot', 'hubspot:1', { email: '[email]' } );
		const crm = doc.actions.find( ( a ) => a.id === crmId );
		expect( crm ).toMatchObject( { kind: 'crm', on: 'submit', config: { provider: 'hubspot', connectionRef: 'hubspot:1', mapping: { email: '[email]' } } } );
		expect( doc.actions ).toHaveLength( 6 );
		expect( actionGaps( doc.actions[ 0 ] as Action, 'de_DE' ) ).toEqual( [] );
		// WhatsApp still needs its approved template; the rest is complete.
		doc.actions.forEach( complete );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		expect( checkReferences( doc ) ).toEqual( [] );
	} );

	it( 'treat MessageBird, which is retired, as a missing connection', () => {
		expect( CONNECTION_TYPES.sms ).toEqual( [ 'twilio', 'bird' ] );
		expect( retiredConnection( 'legacy:messagebird' ) ).toBe( true );
		expect( retiredConnection( 'messagebird:0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9' ) ).toBe( true );
		expect( retiredConnection( 'bird:0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9' ) ).toBe( false );
		expect( retiredConnection( '' ) ).toBe( false );
		const doc = blank();
		const sms = added( doc, 'sms' );
		if ( ! sms || 'sms' !== sms.kind ) {
			throw new Error( 'missing' );
		}
		sms.config.to = { de_DE: '+49171000000' };
		sms.config.connectionRef = 'legacy:messagebird';
		expect( actionGaps( sms, 'de_DE' ) ).toEqual( [ 'connection' ] );
		sms.config.connectionRef = 'bird:1';
		expect( actionGaps( sms, 'de_DE' ) ).toEqual( [] );
	} );
} );
