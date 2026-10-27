/**
 * Settings of the form beyond its look, shown in the properties when nothing is selected:
 * access (password, time window, entry limit, time limit), confirming the e-mail address (double opt-in),
 * payment and spam protection. The plugin checks all of them on the server.
 */
import React, { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { FormDocument, Payment, Settings, Text } from '@funnelforms/form-schema';
import { createAction, emailFields } from '../actions';
import { euPrivacy } from '../privacy';
import type { Connection, FormSummary } from '../api';
import { nodeName, text } from '../document';
import { editText, fallbackText, withText } from '../languages';
import { formProtection, spamProtection } from '../spam';
import type { Recipe } from '../store';
import { ConnectionPicker } from './Actions';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { Badge, Button, Field as FieldRow, icons, Notice, NumberInput, Select, TextInput, Toggle } from './ui';

type Access = NonNullable<Settings[ 'access' ]>;

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

/** The value of a datetime-local input for an ISO time, in the editor's time zone. */
export function localInput( iso: string | undefined ): string {
	if ( ! iso ) {
		return '';
	}
	const d = new Date( iso );
	if ( Number.isNaN( d.getTime() ) ) {
		return '';
	}
	const pad = ( n: number ): string => String( n ).padStart( 2, '0' );
	return `${ d.getFullYear() }-${ pad( d.getMonth() + 1 ) }-${ pad( d.getDate() ) }T${ pad( d.getHours() ) }:${ pad( d.getMinutes() ) }`;
}

/** ISO time with the editor's offset for the value of a datetime-local input. */
export function isoFromInput( value: string ): string | undefined {
	const d = new Date( value );
	if ( '' === value || Number.isNaN( d.getTime() ) ) {
		return undefined;
	}
	const pad = ( n: number ): string => String( Math.abs( n ) ).padStart( 2, '0' );
	const offset = -d.getTimezoneOffset();
	return `${ value.slice( 0, 16 ) }:00${ offset >= 0 ? '+' : '-' }${ pad( Math.trunc( offset / 60 ) ) }:${ pad( offset % 60 ) }`;
}

/** Changes the access settings; empty ones are removed, and with them `access` itself. */
function setAccess( d: FormDocument, recipe: ( a: Access ) => void ): void {
	const access: Access = { ...( d.settings.access ?? {} ) };
	recipe( access );
	// The closed message belongs to the limits; without them it would never show.
	if ( undefined === access.maxEntries && undefined === access.opensAt && undefined === access.closesAt ) {
		access.closedMessage = undefined;
	}
	if ( ! access.loginRequired ) {
		access.loginRequired = undefined;
		access.loginMessage = undefined;
	}
	const kept = Object.fromEntries( Object.entries( access ).filter( ( [ , v ] ) => undefined !== v ) ) as Access;
	if ( Object.keys( kept ).length ) {
		d.settings.access = kept;
	} else {
		delete d.settings.access;
	}
}

export function AccessSection( { doc }: { doc: FormDocument } ) {
	const { api, readOnly, lang } = useEnv();
	const change = useChange();
	const access = doc.settings.access ?? {};
	const locale = doc.locales.default;
	const timeLimit = doc.settings.timeLimit;
	const [ password, setPassword ] = useState<string | null>( null );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const limited = undefined !== access.maxEntries || undefined !== access.opensAt || undefined !== access.closesAt;
	const reversed = access.opensAt && access.closesAt && new Date( access.closesAt ).getTime() <= new Date( access.opensAt ).getTime();

	const savePassword = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const hash = await api.passwordHash( password ?? '' );
			change( ( d ) => setAccess( d, ( a ) => void ( a.password = { hash } ) ) );
			setPassword( null );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	const time = ( key: 'opensAt' | 'closesAt', label: string ) => (
		<FieldRow label={ label }>
			{ ( id ) => (
				<input
					id={ id }
					className="ffxb-input"
					type="datetime-local"
					readOnly={ readOnly }
					value={ localInput( access[ key ] ) }
					onChange={ ( e ) => {
						const v = isoFromInput( e.target.value );
						change( ( d ) => setAccess( d, ( a ) => void ( a[ key ] = v ) ), 'access:' + key );
					} }
				/>
			) }
		</FieldRow>
	);

	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Access', 'funnelforms-pro' ) }</h2>
			</header>
			{ access.password && null === password ? (
				<div className="ffxb-inline">
					<p className="ffxb-hint">{ __( 'Visitors need a password to see the form.', 'funnelforms-pro' ) }</p>
					<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => setPassword( '' ) }>
						{ __( 'Change', 'funnelforms-pro' ) }
					</Button>
					<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => change( ( d ) => setAccess( d, ( a ) => void ( a.password = undefined ) ) ) }>
						{ __( 'Remove', 'funnelforms-pro' ) }
					</Button>
				</div>
			) : null }
			{ ! access.password && null === password ? (
				<Button size="sm" disabled={ readOnly } onClick={ () => setPassword( '' ) }>
					{ __( 'Protect with a password', 'funnelforms-pro' ) }
				</Button>
			) : null }
			{ null !== password ? (
				<>
					{ error ? <Notice tone="danger">{ error }</Notice> : null }
					<TextInput label={ __( 'Password for visitors', 'funnelforms-pro' ) } type="password" value={ password } onChange={ setPassword } hint={ __( 'Only a hash is stored; the password cannot be shown again.', 'funnelforms-pro' ) } />
					<div className="ffxb-row-actions">
						<Button size="sm" variant="primary" disabled={ busy || '' === password.trim() } onClick={ () => void savePassword() }>
							{ __( 'Save password', 'funnelforms-pro' ) }
						</Button>
						<Button size="sm" variant="ghost" onClick={ () => setPassword( null ) }>
							{ __( 'Cancel', 'funnelforms-pro' ) }
						</Button>
					</div>
				</>
			) : null }
			<Toggle
				label={ __( 'Only for logged-in visitors', 'funnelforms-pro' ) }
				hint={ __( 'Visitors who are not logged in to this website see a message with a login link instead of the form. Works together with a password.', 'funnelforms-pro' ) }
				checked={ Boolean( access.loginRequired ) }
				onChange={ ( on ) => ! readOnly && change( ( d ) => setAccess( d, ( a ) => void ( a.loginRequired = on || undefined ) ) ) }
			/>
			{ access.loginRequired ? (
				<TextInput
					label={ __( 'Message for visitors who are not logged in', 'funnelforms-pro' ) }
					multiline
					value={ editText( access.loginMessage, lang, locale ) }
					placeholder={ fallbackText( access.loginMessage, lang, locale ) || __( 'Please log in to use this form.', 'funnelforms-pro' ) }
					onChange={ ( v ) => change( ( d ) => setAccess( d, ( a ) => void ( a.loginMessage = '' === v && lang === locale ? undefined : withText( a.loginMessage, lang, v, locale ) ) ), 'access:login' ) }
					hint={ __( 'Empty for the standard text. The login link comes below it.', 'funnelforms-pro' ) }
				/>
			) : null }
			<NumberInput
				label={ __( 'Close after this many entries', 'funnelforms-pro' ) }
				value={ access.maxEntries }
				min={ 1 }
				step={ 1 }
				onChange={ ( v ) => change( ( d ) => setAccess( d, ( a ) => void ( a.maxEntries = undefined === v || v < 1 ? undefined : Math.floor( v ) ) ), 'access:max' ) }
			/>
			{ time( 'opensAt', __( 'Open from', 'funnelforms-pro' ) ) }
			{ time( 'closesAt', __( 'Open until', 'funnelforms-pro' ) ) }
			{ reversed ? <Notice tone="warning">{ __( 'The form closes before it opens, so it never takes entries.', 'funnelforms-pro' ) }</Notice> : null }
			{ limited ? (
				<TextInput
					label={ __( 'Message while the form is closed', 'funnelforms-pro' ) }
					multiline
					value={ editText( access.closedMessage, lang, locale ) }
					placeholder={ fallbackText( access.closedMessage, lang, locale ) }
					onChange={ ( v ) => change( ( d ) => setAccess( d, ( a ) => void ( a.closedMessage = '' === v && lang === locale ? undefined : withText( a.closedMessage, lang, v, locale ) ) ), 'access:message' ) }
					hint={ __( 'Empty for the standard text.', 'funnelforms-pro' ) }
				/>
			) : null }
			<NumberInput
				label={ __( 'Time limit in minutes', 'funnelforms-pro' ) }
				value={ timeLimit?.minutes }
				min={ 1 }
				max={ 1440 }
				step={ 1 }
				onChange={ ( v ) =>
					change( ( d ) => {
						if ( undefined === v || v < 1 ) {
							delete d.settings.timeLimit;
						} else {
							d.settings.timeLimit = { ...d.settings.timeLimit, minutes: Math.min( 1440, Math.floor( v ) ) };
						}
					}, 'time:minutes' )
				}
				hint={ __( 'Counts from the visitor\'s first click. Visitors see the time left; entries sent later are not accepted.', 'funnelforms-pro' ) }
			/>
			{ timeLimit ? (
				<TextInput
					label={ __( 'Message when the time is up', 'funnelforms-pro' ) }
					multiline
					value={ editText( timeLimit.message, lang, locale ) }
					placeholder={ fallbackText( timeLimit.message, lang, locale ) }
					onChange={ ( v ) =>
						change( ( d ) => {
							if ( d.settings.timeLimit ) {
								const message = '' === v && lang === locale ? undefined : withText( d.settings.timeLimit.message, lang, v, locale );
								d.settings.timeLimit = { minutes: d.settings.timeLimit.minutes, ...( message ? { message } : {} ) };
							}
						}, 'time:message' )
					}
					hint={ __( 'Empty for the standard text.', 'funnelforms-pro' ) }
				/>
			) : null }
		</section>
	);
}

/** Default texts of the confirmation mail, in the editor's language. */
function optInTexts( locale: string ): { subject: Text; body: Text; confirmation: Text } {
	return {
		subject: { [ locale ]: __( 'Please confirm your e-mail address', 'funnelforms-pro' ) },
		body: { [ locale ]: __( 'Please confirm your e-mail address with this link:', 'funnelforms-pro' ) + '\n\n{{confirm_url}}' },
		confirmation: { [ locale ]: '<p>' + __( 'Thank you, your e-mail address is confirmed.', 'funnelforms-pro' ) + '</p>' },
	};
}

export function DoubleOptInSection( { doc }: { doc: FormDocument } ) {
	const { readOnly, lang } = useEnv();
	const change = useChange();
	const optIn = doc.settings.doubleOptIn;
	const locale = doc.locales.default;
	const emails = emailFields( doc );
	const edit = ( key: 'subject' | 'body' | 'confirmation' ) => ( v: string ): void =>
		change( ( d ) => {
			if ( d.settings.doubleOptIn ) {
				d.settings.doubleOptIn[ key ] = withText( d.settings.doubleOptIn[ key ], lang, v, locale );
			}
		}, 'optin:' + key );
	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Confirm e-mail address', 'funnelforms-pro' ) }</h2>
			</header>
			<Toggle
				label={ __( 'Double opt-in', 'funnelforms-pro' ) }
				hint={ __( 'Visitors get a link to confirm their address. Mails to them and connections to your tools run only after they confirm; mails to you are sent right away.', 'funnelforms-pro' ) }
				checked={ !! optIn }
				onChange={ ( on ) => {
					const first = emails[ 0 ];
					if ( readOnly || ( on && ! first ) ) {
						return;
					}
					change( ( d ) => {
						if ( on && first ) {
							d.settings.doubleOptIn = { field: first.id, ...optInTexts( locale ) };
						} else {
							delete d.settings.doubleOptIn;
						}
					} );
				} }
			/>
			{ ! optIn && ! emails.length ? <p className="ffxb-hint">{ __( 'Needs an e-mail field in a contact step.', 'funnelforms-pro' ) }</p> : null }
			{ optIn ? (
				<>
					<Select
						label={ __( 'Address from', 'funnelforms-pro' ) }
						value={ optIn.field }
						options={ emails.map( ( f ) => ( { value: f.id, label: text( f.label, locale ) || f.key } ) ) }
						onChange={ ( v ) => change( ( d ) => void ( d.settings.doubleOptIn && ( d.settings.doubleOptIn.field = v ) ) ) }
					/>
					{ emails.some( ( f ) => f.id === optIn.field ) ? null : <Notice tone="warning">{ __( 'The e-mail field of the double opt-in no longer exists. Choose another one.', 'funnelforms-pro' ) }</Notice> }
					<TextInput label={ __( 'Subject', 'funnelforms-pro' ) } value={ editText( optIn.subject, lang, locale ) } placeholder={ fallbackText( optIn.subject, lang, locale ) } onChange={ edit( 'subject' ) } />
					<TextInput label={ __( 'Message', 'funnelforms-pro' ) } multiline value={ editText( optIn.body, lang, locale ) } placeholder={ fallbackText( optIn.body, lang, locale ) } onChange={ edit( 'body' ) } hint={ __( '{{confirm_url}} places the link; without it, the link is added at the end.', 'funnelforms-pro' ) } />
					<TextInput
						label={ __( 'Shown after confirming', 'funnelforms-pro' ) }
						multiline
						value={ editText( optIn.confirmation, lang, locale ) }
						placeholder={ fallbackText( optIn.confirmation, lang, locale ) }
						onChange={ edit( 'confirmation' ) }
						hint={ __( 'Placeholders of mails work here, such as {{field:…}}.', 'funnelforms-pro' ) }
					/>
					<p className="ffxb-hint">{ __( 'The link stays valid until it is used. Entries show whether the address is confirmed.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
		</section>
	);
}

/** Boxes of contact steps that can carry the visitor's consent to a reminder. */
export function consentBoxes( doc: FormDocument ): Array<{ id: string; label: string }> {
	const locale = doc.locales.default;
	const out: Array<{ id: string; label: string }> = [];
	for ( const node of doc.nodes ) {
		if ( 'contact' === node.type ) {
			for ( const f of node.fields ) {
				if ( 'consent' === f.type || 'checkbox' === f.type ) {
					const html = 'html' in f.props ? ( f.props as { html?: Text } ).html : undefined;
					out.push( { id: f.id, label: ( text( html ?? f.label, locale ).replace( /<[^>]*>/g, '' ).trim() || f.key ).slice( 0, 60 ) } );
				}
			}
		}
	}
	return out;
}

/** Default settings of reminders to visitors who leave: consent in the EU privacy mode, a notice elsewhere. */
export function abandonDefaults( doc: FormDocument, eu: boolean ): NonNullable<Settings[ 'abandonment' ]> | null {
	const field = emailFields( doc )[ 0 ];
	if ( ! field ) {
		return null;
	}
	const locale = doc.locales.default;
	const box = consentBoxes( doc )[ 0 ];
	return {
		field: field.id,
		basis: eu ? 'consent' : 'notice',
		...( eu && box ? { consentField: box.id } : {} ),
		delayMinutes: 60,
		subject: { [ locale ]: __( 'Your answers are waiting for you', 'funnelforms-pro' ) },
		/* translators: {{form:title}} and {{resume_url}} are placeholders and stay as they are. */
		body: { [ locale ]: __( 'You started the form "{{form:title}}" but did not send it. Your answers are saved, so it only takes a moment:', 'funnelforms-pro' ) + '\n\n{{resume_url}}' },
		layout: 'branded',
	};
}

const DELAYS = [ 30, 60, 180, 1440 ];

/** Reminders to visitors who leave after typing their address (Abandonment in the plugin). */
export function AbandonSection( { doc }: { doc: FormDocument } ) {
	const { readOnly, lang } = useEnv();
	const change = useChange();
	const abandon = doc.settings.abandonment;
	const locale = doc.locales.default;
	const emails = emailFields( doc );
	const boxes = consentBoxes( doc );
	const set = ( recipe: ( a: NonNullable<Settings[ 'abandonment' ]> ) => void, key?: string ): void =>
		change( ( d ) => void ( d.settings.abandonment && recipe( d.settings.abandonment ) ), key );
	const edit = ( key: 'subject' | 'body' | 'notice' ) => ( v: string ): void =>
		set( ( a ) => {
			const next = '' === v && 'notice' === key && lang === locale ? undefined : withText( a[ key ], lang, v, locale );
			if ( next ) {
				a[ key ] = next;
			} else {
				delete a.notice;
			}
		}, 'abandon:' + key );
	const delayLabel = ( minutes: number ): string => {
		if ( 60 === minutes ) {
			return __( '1 hour', 'funnelforms-pro' );
		}
		return minutes < 60 || minutes % 60
			? /* translators: %d: number of minutes. */ sprintf( __( '%d minutes', 'funnelforms-pro' ), minutes )
			: /* translators: %d: number of hours, more than one. */ sprintf( __( '%d hours', 'funnelforms-pro' ), minutes / 60 );
	};
	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Win back visitors who leave', 'funnelforms-pro' ) }</h2>
			</header>
			<Toggle
				label={ __( 'Reminder mail', 'funnelforms-pro' ) }
				hint={ __( 'Visitors who typed their e-mail address and left without sending get one mail with a link back to their answers. Sending the form stops it.', 'funnelforms-pro' ) }
				checked={ !! abandon }
				onChange={ ( on ) => {
					const defaults = abandonDefaults( doc, euPrivacy() );
					if ( readOnly || ( on && ! defaults ) ) {
						return;
					}
					change( ( d ) => {
						if ( on && defaults ) {
							d.settings.abandonment = defaults;
						} else {
							delete d.settings.abandonment;
						}
					} );
				} }
			/>
			{ ! abandon && ! emails.length ? <p className="ffxb-hint">{ __( 'Needs an e-mail field in a contact step.', 'funnelforms-pro' ) }</p> : null }
			{ abandon ? (
				<>
					<Select
						label={ __( 'Address from', 'funnelforms-pro' ) }
						value={ abandon.field }
						options={ emails.map( ( f ) => ( { value: f.id, label: text( f.label, locale ) || f.key } ) ) }
						onChange={ ( v ) => set( ( a ) => void ( a.field = v ) ) }
					/>
					{ emails.some( ( f ) => f.id === abandon.field ) ? null : <Notice tone="warning">{ __( 'The e-mail field of the reminder no longer exists. Choose another one.', 'funnelforms-pro' ) }</Notice> }
					<Select
						label={ __( 'Allowed by', 'funnelforms-pro' ) }
						value={ abandon.basis }
						options={ [
							{ value: 'consent', label: __( 'A box the visitor ticks', 'funnelforms-pro' ) },
							{ value: 'notice', label: __( 'A notice under the e-mail field', 'funnelforms-pro' ) },
						] }
						onChange={ ( v ) =>
							set( ( a ) => {
								a.basis = v;
								if ( 'consent' === v && ! a.consentField && boxes[ 0 ] ) {
									a.consentField = boxes[ 0 ].id;
								}
							} )
						}
						hint={ euPrivacy()
							? __( 'In the EU privacy mode a ticked box is the safe choice. With the notice, the address is kept as soon as it is typed; check this with your privacy policy.', 'funnelforms-pro' )
							: __( 'The notice tells visitors about the reminder and lets them say no.', 'funnelforms-pro' ) }
					/>
					{ 'consent' === abandon.basis ? (
						<>
							<Select
								label={ __( 'Box', 'funnelforms-pro' ) }
								value={ abandon.consentField ?? '' }
								options={ [ { value: '', label: __( '(choose a box)', 'funnelforms-pro' ) }, ...boxes.map( ( b ) => ( { value: b.id, label: b.label } ) ) ] }
								onChange={ ( v ) => set( ( a ) => void ( a.consentField = v || undefined ) ) }
								hint={ __( 'Its text should say that you send one reminder, e.g. "Remind me by e-mail if I leave before sending."', 'funnelforms-pro' ) }
							/>
							{ boxes.some( ( b ) => b.id === abandon.consentField ) ? null : <Notice tone="warning">{ __( 'Add a consent box to the contact step and choose it here, or use the notice.', 'funnelforms-pro' ) }</Notice> }
						</>
					) : (
						<TextInput
							label={ __( 'Notice', 'funnelforms-pro' ) }
							multiline
							value={ editText( abandon.notice, lang, locale ) }
							placeholder={ __( 'If you leave without sending, we will e-mail you one reminder with a link back to your answers.', 'funnelforms-pro' ) }
							onChange={ edit( 'notice' ) }
							hint={ __( 'Shown under the e-mail field with "Don\'t remind me". Empty for the standard text; links are allowed, e.g. to the privacy policy.', 'funnelforms-pro' ) }
						/>
					) }
					<Select
						label={ __( 'Send after', 'funnelforms-pro' ) }
						value={ String( abandon.delayMinutes ) }
						options={ [ ...new Set( [ ...DELAYS, abandon.delayMinutes ] ) ].sort( ( a, b ) => a - b ).map( ( m ) => ( { value: String( m ), label: delayLabel( m ) } ) ) }
						onChange={ ( v ) => set( ( a ) => void ( a.delayMinutes = Number( v ) ) ) }
					/>
					<TextInput label={ __( 'Subject', 'funnelforms-pro' ) } value={ editText( abandon.subject, lang, locale ) } placeholder={ fallbackText( abandon.subject, lang, locale ) } onChange={ edit( 'subject' ) } />
					<TextInput
						label={ __( 'Message', 'funnelforms-pro' ) }
						multiline
						value={ editText( abandon.body, lang, locale ) }
						placeholder={ fallbackText( abandon.body, lang, locale ) }
						onChange={ edit( 'body' ) }
						hint={ __( '{{resume_url}} places the button back to the answers; without it, it is added at the end. {{form:title}}, {{field:…}} and {{answers}} work too. "Don\'t remind me" is always added.', 'funnelforms-pro' ) }
					/>
					<Select
						label={ __( 'Design', 'funnelforms-pro' ) }
						value={ abandon.layout ?? 'branded' }
						options={ [
							{ value: 'branded', label: __( 'Designed mail', 'funnelforms-pro' ) },
							{ value: 'plain', label: __( 'Plain mail', 'funnelforms-pro' ) },
						] }
						onChange={ ( v ) => set( ( a ) => void ( a.layout = v ) ) }
						hint={ __( 'The sender is that of the form\'s first mail to visitors, else the site\'s.', 'funnelforms-pro' ) }
					/>
					<Toggle
						label={ __( 'Second reminder', 'funnelforms-pro' ) }
						hint={ __( 'One more mail a day after the first, if the form is still not sent.', 'funnelforms-pro' ) }
						checked={ undefined !== abandon.secondAfterHours }
						onChange={ ( on ) => set( ( a ) => ( on ? ( a.secondAfterHours = 24 ) : delete a.secondAfterHours ) ) }
					/>
					<Toggle
						label={ __( 'Tell me as well', 'funnelforms-pro' ) }
						hint={ __( 'A mail to the recipients of the form\'s notification when the reminder goes out, with the address and the answers so far.', 'funnelforms-pro' ) }
						checked={ true === abandon.notifyOwner }
						onChange={ ( on ) => set( ( a ) => ( on ? ( a.notifyOwner = true ) : delete a.notifyOwner ) ) }
					/>
					<p className="ffxb-hint">{ __( 'Each address gets reminders of this form once in 30 days. Abandoned entries are listed under Entries and deleted after 30 days.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
		</section>
	);
}

const CURRENCIES = [ 'EUR','USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'CAD', 'AUD' ];

/** What is still missing for the payment to work. */
export function paymentGaps( payment: Payment, doc: FormDocument ): Array<'connection' | 'amount'> {
	const out: Array<'connection' | 'amount'> = [];
	if ( ! /^(stripe|paypal|mollie):/.test( payment.connection ) ) {
		out.push( 'connection' );
	}
	if ( 'fixed' in payment.amount ? ! ( payment.amount.fixed > 0 ) : ! doc.calculations.some( ( c ) => 'calculation' in payment.amount && c.id === payment.amount.calculation ) ) {
		out.push( 'amount' );
	}
	return out;
}

/** Text fields of the steps and contact steps, which can take a coupon code. */
export function couponFields( doc: FormDocument ): Array<{ id: string; label: string }> {
	const locale = doc.locales.default;
	const out: Array<{ id: string; label: string }> = [];
	for ( const node of doc.nodes ) {
		if ( 'end' !== node.type ) {
			for ( const f of node.fields ) {
				if ( 'text' === f.type ) {
					out.push( { id: f.id, label: ( text( f.label, locale ).replace( /<[^>]*>/g, '' ) || f.key ) + ' [' + f.key + ']' } );
				}
			}
		}
	}
	return out;
}

/** A coupon code as the plugin takes it: letters, digits, - and _, up to 40. */
export function cleanCode( value: string ): string {
	return value.replace( /[^A-Za-z0-9_-]/g, '' ).slice( 0, 40 );
}

/** Coupons: codes visitors type into a text field of the form; the plugin takes their discount off. */
function Coupons( { doc, payment, set }: { doc: FormDocument; payment: Payment; set: ( recipe: ( p: Payment ) => void, key?: string ) => void } ) {
	const { readOnly } = useEnv();
	const fields = couponFields( doc );
	const coupons = payment.coupons ?? [];
	const seen = new Set<string>();
	const duplicate = coupons.some( ( c ) => {
		const code = c.code.toLowerCase();
		const again = seen.has( code );
		seen.add( code );
		return again;
	} );
	return (
		<div className="ffxb-coupons">
			<h3 className="ffxb-subtitle">{ __( 'Coupons', 'funnelforms-pro' ) }</h3>
			{ fields.length ? (
				<Select
					label={ __( 'Coupon code from the field', 'funnelforms-pro' ) }
					hint={ __( 'Add a text field such as “Coupon code” to a step or the contact step. Upper and lower case do not matter; unknown codes change nothing.', 'funnelforms-pro' ) }
					value={ payment.couponField ?? '' }
					options={ [ { value: '', label: __( 'No coupons', 'funnelforms-pro' ) }, ...fields.map( ( f ) => ( { value: f.id, label: f.label } ) ) ] }
					onChange={ ( v ) =>
						set( ( p ) => {
							if ( v ) {
								p.couponField = v;
								p.coupons ??= [];
							} else {
								delete p.couponField;
							}
						} )
					}
				/>
			) : (
				<p className="ffxb-hint">{ __( 'For coupons, add a text field such as “Coupon code” to a step or the contact step.', 'funnelforms-pro' ) }</p>
			) }
			{ payment.couponField ? (
				<>
					{ coupons.length ? (
						<ul className="ffxb-coupons__list">
							{ coupons.map( ( c, i ) => (
								<li key={ i } className="ffxb-coupons__item">
									<input
										className="ffxb-input ffxb-input--code"
										aria-label={ sprintf( __( 'Code of coupon %d', 'funnelforms-pro' ), i + 1 ) }
										value={ c.code }
										placeholder="SOMMER10"
										disabled={ readOnly }
										onChange={ ( e ) => set( ( p ) => void ( p.coupons && p.coupons[ i ] && ( p.coupons[ i ].code = cleanCode( e.target.value ) ) ), `coupon-code:${ i }` ) }
									/>
									<input
										className="ffxb-input ffxb-input--tiny"
										type="number"
										min={ 0 }
										step="any"
										aria-label={ sprintf( __( 'Discount of coupon %d', 'funnelforms-pro' ), i + 1 ) }
										value={ c.percent ?? c.amount ?? '' }
										disabled={ readOnly }
										onChange={ ( e ) =>
											set( ( p ) => {
												const coupon = p.coupons?.[ i ];
												const value = Number( e.target.value );
												if ( coupon ) {
													const percent = undefined !== coupon.percent || undefined === coupon.amount;
													delete coupon.percent;
													delete coupon.amount;
													if ( value > 0 ) {
														coupon[ percent ? 'percent' : 'amount' ] = percent ? Math.min( 100, value ) : value;
													}
												}
											}, `coupon-value:${ i }` )
										}
									/>
									<select
										className="ffxb-input"
										aria-label={ sprintf( __( 'Kind of discount of coupon %d', 'funnelforms-pro' ), i + 1 ) }
										value={ undefined !== c.amount ? 'amount' : 'percent' }
										disabled={ readOnly }
										onChange={ ( e ) =>
											set( ( p ) => {
												const coupon = p.coupons?.[ i ];
												if ( coupon ) {
													const value = coupon.percent ?? coupon.amount;
													delete coupon.percent;
													delete coupon.amount;
													if ( undefined !== value ) {
														coupon[ 'amount' === e.target.value ? 'amount' : 'percent' ] = 'amount' === e.target.value ? value : Math.min( 100, value );
													} else if ( 'amount' === e.target.value ) {
														coupon.amount = 10;
													}
												}
											} )
										}
									>
										<option value="percent">%</option>
										<option value="amount">{ payment.currency }</option>
									</select>
									<Button size="sm" variant="ghost" icon={ icons.trash } aria-label={ sprintf( __( 'Remove coupon %s', 'funnelforms-pro' ), c.code || String( i + 1 ) ) } disabled={ readOnly } onClick={ () => set( ( p ) => void p.coupons?.splice( i, 1 ) ) } />
								</li>
							) ) }
						</ul>
					) : null }
					{ coupons.some( ( c ) => ! c.code || ( undefined === c.percent && undefined === c.amount ) ) ? <Notice tone="warning">{ __( 'Every coupon needs a code and a discount above 0.', 'funnelforms-pro' ) }</Notice> : null }
					{ duplicate ? <Notice tone="warning">{ __( 'Two coupons have the same code.', 'funnelforms-pro' ) }</Notice> : null }
					<Button size="sm" icon={ icons.plus } disabled={ readOnly || coupons.length >= 100 } onClick={ () => set( ( p ) => void ( p.coupons = [ ...( p.coupons ?? [] ), { code: '', percent: 10 } ] ) ) }>
						{ __( 'Add coupon', 'funnelforms-pro' ) }
					</Button>
				</>
			) : null }
		</div>
	);
}

export function PaymentSection( { doc }: { doc: FormDocument } ) {
	const { api, rights, readOnly, lang } = useEnv();
	const change = useChange();
	const payment = doc.settings.payment;
	const locale = doc.locales.default;
	const [ connections, setConnections ] = useState<Connection[]>( [] );
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
	const set = ( recipe: ( p: Payment ) => void, key?: string ): void =>
		change( ( d ) => {
			if ( d.settings.payment ) {
				recipe( d.settings.payment );
			}
		}, key && 'payment:' + key );
	const emails = emailFields( doc );
	const contacts = doc.nodes.filter( ( n ) => 'contact' === n.type );
	const gaps = payment ? paymentGaps( payment, doc ) : [];
	const provider = payment?.connection.split( ':' )[ 0 ] ?? '';

	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Payment', 'funnelforms-pro' ) }</h2>
			</header>
			<Toggle
				label={ __( 'Take a payment after the contact step', 'funnelforms-pro' ) }
				hint={ __( 'Through your own Stripe, PayPal or Mollie account. The amount is computed on the server; visitors cannot change it.', 'funnelforms-pro' ) }
				checked={ !! payment }
				onChange={ ( on ) =>
					! readOnly &&
					change( ( d ) => {
						if ( on ) {
							const calc = d.calculations[ 0 ];
							d.settings.payment = {
								connection: '',
								amount: calc ? { calculation: calc.id } : { fixed: 0 },
								currency: 'EUR',
								mode: 'payment',
								description: { [ locale ]: d.title },
								...( emailFields( d )[ 0 ] ? { emailField: emailFields( d )[ 0 ]?.id } : {} ),
							};
						} else {
							delete d.settings.payment;
							// Actions waiting for a payment would never run.
							for ( const action of d.actions ) {
								action.on = 'submit';
							}
						}
					} )
				}
			/>
			{ payment && ! rights.entries ? <Notice tone="info">{ __( 'Changes to the payment need the right to see entries. You can prepare them; someone with that right publishes them.', 'funnelforms-pro' ) }</Notice> : null }
			{ payment ? (
				<>
					{ gaps.includes( 'connection' ) ? <Notice tone="warning">{ __( 'Choose the account that receives the payments.', 'funnelforms-pro' ) }</Notice> : null }
					<ConnectionPicker types={ [ 'stripe', 'paypal', 'mollie' ] } value={ payment.connection } connections={ connections } onChange={ ( v ) => set( ( p ) => void ( p.connection = v ) ) } onConnection={ ( c ) => setConnections( ( list ) => [ ...list, c ] ) } />
					{ connections.find( ( c ) => c.ref === payment.connection )?.test ? (
						<Notice tone="warning" title={ __( 'Test mode', 'funnelforms-pro' ) }>
							{ __( 'This account uses test keys: nobody is charged, and entries mark the payments as test payments. Connect the live keys before the form goes live.', 'funnelforms-pro' ) }
						</Notice>
					) : null }
					<Select
						label={ __( 'Amount', 'funnelforms-pro' ) }
						value={ 'fixed' in payment.amount ? '' : payment.amount.calculation }
						options={ [ { value: '', label: __( 'Fixed amount', 'funnelforms-pro' ) }, ...doc.calculations.map( ( c ) => ( { value: c.id, label: sprintf( __( 'Result of “%s”', 'funnelforms-pro' ), c.label || c.id ) } ) ) ] }
						onChange={ ( v ) => set( ( p ) => void ( p.amount = v ? { calculation: v } : { fixed: 0 } ) ) }
					/>
					{ 'fixed' in payment.amount ? (
						<NumberInput label={ sprintf( __( 'Amount in %s', 'funnelforms-pro' ), payment.currency ) } value={ payment.amount.fixed || undefined } min={ 0 } step={ 0.01 } onChange={ ( v ) => set( ( p ) => void ( p.amount = { fixed: v ?? 0 } ), 'fixed' ) } />
					) : null }
					{ gaps.includes( 'amount' ) ? <Notice tone="warning">{ __( 'Enter an amount above 0 or choose a calculation.', 'funnelforms-pro' ) }</Notice> : null }
					<div className="ffxb-inline">
						<Select label={ __( 'Currency', 'funnelforms-pro' ) } value={ payment.currency } options={ ( CURRENCIES.includes( payment.currency ) ? CURRENCIES : [ payment.currency, ...CURRENCIES ] ).map( ( c ) => ( { value: c, label: c } ) ) } onChange={ ( v ) => set( ( p ) => void ( p.currency = v ) ) } />
						<Select<Payment[ 'mode' ]>
							label={ __( 'Charge', 'funnelforms-pro' ) }
							value={ payment.mode }
							options={ [
								{ value: 'payment', label: __( 'The whole amount', 'funnelforms-pro' ) },
								{ value: 'deposit', label: __( 'A deposit', 'funnelforms-pro' ) },
								...( 'stripe' === provider || 'subscription' === payment.mode ? [ { value: 'subscription' as const, label: __( 'A subscription', 'funnelforms-pro' ) } ] : [] ),
							] }
							onChange={ ( v ) =>
								set( ( p ) => {
									p.mode = v;
									if ( 'deposit' === v ) {
										p.depositPercent = p.depositPercent ?? 30;
									} else {
										delete p.depositPercent;
									}
									if ( 'subscription' === v ) {
										p.interval = p.interval ?? 'month';
									} else {
										delete p.interval;
									}
								} )
							}
						/>
					</div>
					{ 'deposit' === payment.mode ? (
						<NumberInput label={ __( 'Deposit in percent', 'funnelforms-pro' ) } value={ payment.depositPercent } min={ 1 } max={ 99 } step={ 1 } onChange={ ( v ) => set( ( p ) => void ( p.depositPercent = Math.min( 99, Math.max( 1, Math.round( v ?? 30 ) ) ) ), 'deposit' ) } />
					) : null }
					{ 'subscription' === payment.mode ? (
						<>
							<Select
								label={ __( 'Every', 'funnelforms-pro' ) }
								value={ payment.interval ?? 'month' }
								options={ [
									{ value: 'month', label: __( 'Month', 'funnelforms-pro' ) },
									{ value: 'year', label: __( 'Year', 'funnelforms-pro' ) },
								] }
								onChange={ ( v ) => set( ( p ) => void ( p.interval = v ) ) }
							/>
							{ 'stripe' === provider ? null : <Notice tone="warning">{ __( 'Subscriptions work with Stripe only.', 'funnelforms-pro' ) }</Notice> }
						</>
					) : null }
					<Coupons doc={ doc } payment={ payment } set={ set } />
					{ 'stripe' === provider ? (
						<Toggle
							label={ __( 'Also take promotion codes of the Stripe account', 'funnelforms-pro' ) }
							hint={ __( 'The Stripe payment page then has a field for codes you made in Stripe.', 'funnelforms-pro' ) }
							checked={ Boolean( payment.promotionCodes ) }
							onChange={ ( on ) =>
								set( ( p ) => {
									if ( on ) {
										p.promotionCodes = true;
									} else {
										delete p.promotionCodes;
									}
								} )
							}
						/>
					) : null }
					<TextInput
						label={ __( 'What the visitor pays for', 'funnelforms-pro' ) }
						value={ editText( payment.description, lang, locale ) }
						placeholder={ fallbackText( payment.description, lang, locale ) }
						onChange={ ( v ) => set( ( p ) => void ( p.description = withText( p.description, lang, v, locale ) ), 'description' ) }
						hint={ __( 'Shown on the payment page; placeholders of mails work here too.', 'funnelforms-pro' ) }
					/>
					{ emails.length ? (
						<Select
							label={ __( 'Receipt to the address in', 'funnelforms-pro' ) }
							value={ payment.emailField ?? '' }
							options={ [ { value: '', label: __( 'No field', 'funnelforms-pro' ) }, ...emails.map( ( f ) => ( { value: f.id, label: text( f.label, locale ) || f.key } ) ) ] }
							onChange={ ( v ) =>
								set( ( p ) => {
									if ( v ) {
										p.emailField = v;
									} else {
										delete p.emailField;
									}
								} )
							}
						/>
					) : null }
					{ contacts.length > 1 || payment.node ? (
						<Select
							label={ __( 'For entries from', 'funnelforms-pro' ) }
							value={ payment.node ?? '' }
							options={ [ { value: '', label: __( 'Every contact step', 'funnelforms-pro' ) }, ...contacts.map( ( n ) => ( { value: n.id, label: nodeName( n, locale ) } ) ) ] }
							onChange={ ( v ) =>
								set( ( p ) => {
									if ( v ) {
										p.node = v;
									} else {
										delete p.node;
									}
								} )
							}
						/>
					) : null }
					<PaidMail doc={ doc } />
				</>
			) : null }
		</section>
	);
}

/** The confirmation mail of the payment: an autoresponder that waits until the payment went through. */
function PaidMail( { doc }: { doc: FormDocument } ) {
	const { readOnly } = useEnv();
	const change = useChange();
	const paid = doc.actions.filter( ( a ) => 'paid' === a.on );
	const mail = paid.find( ( a ) => 'autoresponder' === a.kind );
	const add = (): void =>
		change( ( d ) => {
			const action = createAction( d, 'autoresponder', {
				replySubject: __( 'Your payment', 'funnelforms-pro' ),
				replyBody: __( 'Thank you for your payment of {{payment:amount}}.\n\nReference: {{payment:reference}}\n\n{{answers}}', 'funnelforms-pro' ),
			} );
			d.actions.push( { ...action, on: 'paid' } );
		} );
	return (
		<div className="ffxb-paid-mail">
			<h3 className="ffxb-subtitle">{ __( 'After the payment', 'funnelforms-pro' ) }</h3>
			{ mail ? (
				<p className="ffxb-hint">
					<Badge tone="success">{ __( 'Payment confirmation', 'funnelforms-pro' ) }</Badge> { __( 'Visitors get a mail once the payment went through. Change it under “After sending”.', 'funnelforms-pro' ) }
				</p>
			) : (
				<>
					<p className="ffxb-hint">{ __( 'Actions under “After sending” can wait until the payment went through, such as a confirmation mail with the amount and reference.', 'funnelforms-pro' ) }</p>
					<Button size="sm" icon={ icons.plus } disabled={ readOnly || 0 === emailFields( doc ).length } onClick={ add }>
						{ __( 'Add payment confirmation mail', 'funnelforms-pro' ) }
					</Button>
					{ 0 === emailFields( doc ).length ? <p className="ffxb-hint">{ __( 'Needs an e-mail field in the contact step.', 'funnelforms-pro' ) }</p> : null }
				</>
			) }
			{ paid.length > ( mail ? 1 : 0 ) ? <p className="ffxb-hint">{ sprintf( __( 'Actions waiting for the payment: %d.', 'funnelforms-pro' ), paid.length ) }</p> : null }
		</div>
	);
}

/** Same cleaning as the plugin (sanitize_title): lowercase letters, digits and dashes. */
export function cleanSlug( value: string ): string {
	return value
		.toLowerCase()
		.replace( /ä/g, 'ae' )
		.replace( /ö/g, 'oe' )
		.replace( /ü/g, 'ue' )
		.replace( /ß/g, 'ss' )
		.normalize( 'NFD' )
		.replace( /[\u0300-\u036f]/g, '' )
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 100 );
}

/** The form on a page of its own, /funnelforms/<slug>, like the direct link of Funnelforms 3 and 4. */
export function OwnPageSection() {
	const { api, store, readOnly } = useEnv();
	const form = useStore( store, ( s ) => s.form );
	const saved = form?.publicSlug ?? '';
	const [ slug, setSlug ] = useState( saved );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ copied, setCopied ] = useState( false );
	useEffect( () => setSlug( saved ), [ saved ] );
	if ( ! form ) {
		return null;
	}
	const save = async ( value: string ): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const detail = await api.update( form.id, { publicSlug: value } );
			const current = store.getState().form;
			if ( current ) {
				store.setState( { form: { ...current, publicSlug: detail.publicSlug ?? '', publicUrl: detail.publicUrl ?? null, publicFallback: detail.publicFallback ?? null } } );
			}
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	const copy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText( form.publicUrl ?? '' );
			setCopied( true );
			setTimeout( () => setCopied( false ), 1500 );
		} catch {
			// The address stays visible to copy by hand.
		}
	};
	const cleaned = cleanSlug( slug );
	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Own page', 'funnelforms-pro' ) }</h2>
			</header>
			<p className="ffxb-hint">{ __( 'The form on a page of its own, without the theme around it, for ads, mails and links in posts.', 'funnelforms-pro' ) }</p>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<div className="ffxb-inline ffxb-own-page">
				<TextInput label={ __( 'Address', 'funnelforms-pro' ) } value={ slug } placeholder="angebot" onChange={ setSlug } hint={ cleaned ? addressOf( form, cleaned ) : __( 'Letters, digits and dashes.', 'funnelforms-pro' ) } />
				<Button size="sm" variant="primary" disabled={ readOnly || busy || '' === cleaned || cleaned === saved } onClick={ () => void save( cleaned ) }>
					{ __( 'Save', 'funnelforms-pro' ) }
				</Button>
			</div>
			{ form.publicUrl ? (
				<div className="ffxb-inline">
					<a className="ffxb-code ffxb-code--wrap" href={ form.publicUrl } target="_blank" rel="noopener noreferrer">
						{ form.publicUrl }
					</a>
					<Button size="sm" variant="ghost" onClick={ () => void copy() }>
						{ copied ? __( 'Copied', 'funnelforms-pro' ) : __( 'Copy', 'funnelforms-pro' ) }
					</Button>
					<Button size="sm" variant="ghost" disabled={ readOnly || busy } onClick={ () => void save( '' ) }>
						{ __( 'Remove', 'funnelforms-pro' ) }
					</Button>
				</div>
			) : null }
			{ form.publicUrl && null === form.currentRevision ? <p className="ffxb-hint">{ __( 'The page shows the form once it is published.', 'funnelforms-pro' ) }</p> : null }
			<PageAddressHint form={ form } />
		</section>
	);
}

/** The end of the page's address for a slug: …/funnelforms/<slug>, or …/?funnelforms=<slug> with plain permalinks. */
export function addressOf( form: FormSummary, slug: string ): string {
	return form.publicUrl && form.publicUrl === form.publicFallback ? `…/?funnelforms=${ slug }` : `…/funnelforms/${ slug }`;
}

/**
 * Whether the address of the form's page reaches WordPress. Some servers answer /funnelforms/<slug>
 * with their own "Not found" (Apache without the .htaccess of WordPress); then the address with
 * ?funnelforms= is offered, which works on every server. With plain permalinks that is the address
 * already, and the hint says how to get the short one.
 */
export function PageAddressHint( { form }: { form: FormSummary } ) {
	const [ missing, setMissing ] = useState( false );
	const url = form.publicUrl ?? '';
	const fallback = form.publicFallback ?? '';
	const plain = '' !== url && url === fallback;
	// Only a published form on the new renderer has a page; anything else is "Not found" anyway.
	const check = '' !== url && '' !== fallback && ! plain && null !== form.currentRevision && 'legacy' !== form.renderer;
	useEffect( () => {
		setMissing( false );
		if ( ! check || 'function' !== typeof fetch ) {
			return;
		}
		let live = true;
		fetch( url, { method: 'HEAD', credentials: 'omit', cache: 'no-store' } )
			.then( ( response ) => {
				if ( live && 404 === response.status ) {
					setMissing( true );
				}
			} )
			// Another host or no answer: nothing to say.
			.catch( () => undefined );
		return () => {
			live = false;
		};
	}, [ url, check ] );
	if ( plain ) {
		return <p className="ffxb-hint ffxb-page-address">{ __( 'Your website uses plain permalinks, so the page has an address with "?funnelforms=". With "Post name" under Settings → Permalinks in WordPress it becomes /funnelforms/ and the name.', 'funnelforms-pro' ) }</p>;
	}
	if ( ! missing ) {
		return null;
	}
	return (
		<Notice tone="warning">
			<span className="ffxb-page-address">
				{ __( 'This address shows "Not found": your web server does not pass it to WordPress. This address works on every server:', 'funnelforms-pro' ) }{ ' ' }
				<a className="ffxb-link" href={ fallback } target="_blank" rel="noopener noreferrer">
					{ fallback }
				</a>
				{ ' ' }
				{ __( 'For the short address, open Settings → Permalinks in WordPress and click Save once.', 'funnelforms-pro' ) }{ ' ' }
				<a className="ffxb-link" href="options-permalink.php">
					{ __( 'Open Permalinks', 'funnelforms-pro' ) }
				</a>
			</span>
		</Notice>
	);
}

/**
 * Spam protection: what protects the form, and whether it uses the site's captcha. The other
 * checks (hidden field, time check, limits, spam folder, Akismet, blocklists) apply to every form
 * and are set up in the plugin's settings.
 */
export function SpamSection( { doc }: { doc: FormDocument } ) {
	const { readOnly } = useEnv();
	const change = useChange();
	const site = spamProtection();
	const on = false !== doc.settings.captcha;
	const settings = site.settingsUrl ? (
		<a className="ffxb-link" href={ site.settingsUrl } target="_blank" rel="noreferrer">
			{ __( 'Spam protection of the website', 'funnelforms-pro' ) }
			<span className="screen-reader-text"> { __( '(opens in a new tab)', 'funnelforms-pro' ) }</span>
		</a>
	) : null;
	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Spam protection', 'funnelforms-pro' ) }</h2>
			</header>
			<p className="ffxb-hint">{ __( 'This form is protected by:', 'funnelforms-pro' ) }</p>
			<p className="ffxb-badges">
				{ formProtection( on, site ).map( ( name ) => (
					<Badge key={ name } tone="success">
						{ name }
					</Badge>
				) ) }
			</p>
			{ site.captcha ? (
				<Toggle
					label={ sprintf( /* translators: %s: name of the captcha service, such as Cloudflare Turnstile */ __( 'Ask for %s in the contact step', 'funnelforms-pro' ), site.captcha ) }
					hint={ __( 'Switch it off only for forms that need no captcha, such as internal ones. Entries that look like spam still go into the spam folder.', 'funnelforms-pro' ) }
					checked={ on }
					disabled={ readOnly }
					onChange={ ( v ) =>
						change( ( d ) => {
							if ( v ) {
								delete d.settings.captcha;
							} else {
								d.settings.captcha = false;
							}
						} )
					}
				/>
			) : (
				<p className="ffxb-hint">{ __( 'No captcha is set up for the website. Cloudflare Turnstile, hCaptcha or Google reCAPTCHA protect every form once you add its keys.', 'funnelforms-pro' ) }</p>
			) }
			{ settings ? <p className="ffxb-hint">{ settings }</p> : null }
		</section>
	);
}
