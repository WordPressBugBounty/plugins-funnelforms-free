/**
 * Phone fields: the country picker (start country, countries on top, countries accepted) and, in
 * contact steps, the confirmation by text message (Funnelforms Pro) with its SMS connection.
 * The country data is the runtime's (plugin/assets/phone/countries.json).
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { PhoneCountries, PhoneSms, Text } from '@funnelforms/form-schema';
import data from '../../../../plugin/assets/phone/countries.json';
import type { Connection } from '../api';
import { CONNECTION_TYPES } from '../actions';
import { ConnectionPicker } from './Actions';
import { Icon } from './Frame';
import { useEnv } from './context';
import { put, TextProp } from './texts';
import { __, sprintf } from './i18n';
import { Notice, ProBadge, Select, TextInput, Toggle } from './ui';

type Props = Record<string, unknown> & { country?: PhoneCountries; sms?: PhoneSms };
type Edit = ( recipe: ( props: Props ) => void, key?: string ) => void;

const CODES = ( data as unknown as { countries: Record<string, [ string ]> } ).countries;

/** Names of the countries in the language of the admin, sorted. */
function useCountries(): Array<{ iso: string; name: string; code: string }> {
	return useMemo( () => {
		const lang = document.documentElement.lang || 'en';
		let names: Intl.DisplayNames | null = null;
		try {
			names = new Intl.DisplayNames( [ lang, 'en' ], { type: 'region' } );
		} catch {
			names = null;
		}
		return Object.keys( CODES )
			.map( ( iso ) => ( { iso, name: names?.of( iso ) ?? iso, code: CODES[ iso ]?.[ 0 ] ?? '' } ) )
			.sort( ( a, b ) => a.name.localeCompare( b.name, lang ) );
	}, [] );
}

/** Countries as removable chips and a list to add one. */
function CountryList( { label, hint, value, onChange }: { label: string; hint: string; value: string[]; onChange: ( value: string[] ) => void } ) {
	const { readOnly } = useEnv();
	const countries = useCountries();
	const name = ( iso: string ): string => countries.find( ( c ) => c.iso === iso )?.name ?? iso;
	return (
		<div className="ffxb-phone-countries">
			<Select
				label={ label }
				hint={ hint }
				value=""
				disabled={ readOnly }
				options={ [ { value: '', label: __( 'Add a country…', 'funnelforms-pro' ) }, ...countries.filter( ( c ) => ! value.includes( c.iso ) ).map( ( c ) => ( { value: c.iso, label: `${ c.name } +${ c.code }` } ) ) ] }
				onChange={ ( iso ) => iso && onChange( [ ...value, iso ] ) }
			/>
			{ value.length ? (
				<div className="ffxb-chips">
					{ value.map( ( iso ) => (
						<span key={ iso } className="ffxb-chip">
							{ name( iso ) }
							<button type="button" className="ffxb-chip__remove" disabled={ readOnly } aria-label={ sprintf( __( 'Remove %s', 'funnelforms-pro' ), name( iso ) ) } onClick={ () => onChange( value.filter( ( v ) => v !== iso ) ) }>
								<Icon name="close" />
							</button>
						</span>
					) ) }
				</div>
			) : null }
		</div>
	);
}

/** Country picker of a phone field. */
export function PhoneCountryProps( { props, edit }: { props: Props; edit: Edit } ) {
	const { readOnly } = useEnv();
	const countries = useCountries();
	const picker = props.country;
	const set = ( key: keyof PhoneCountries, value: string | string[] ): void =>
		edit( ( p ) => {
			const country = ( p.country ??= {} ) as Record<string, unknown>;
			if ( '' === value || ( Array.isArray( value ) && 0 === value.length ) ) {
				Reflect.deleteProperty( country, key );
			} else {
				country[ key ] = value;
			}
		}, 'props.country.' + key );
	const allowed = picker?.allowed ?? [];
	return (
		<>
			<Toggle
				label={ __( 'Country picker', 'funnelforms-pro' ) }
				hint={ __( 'Visitors choose the country with its flag and code; numbers are checked per country and saved in international format.', 'funnelforms-pro' ) }
				checked={ undefined !== picker }
				disabled={ readOnly || undefined !== props.sms }
				onChange={ ( on ) =>
					edit( ( p ) => {
						if ( on ) {
							p.country = {};
						} else {
							delete p.country;
						}
					}, 'props.country' )
				}
			/>
			{ undefined !== picker || undefined !== props.sms ? (
				<>
					<Select
						label={ __( 'Start with', 'funnelforms-pro' ) }
						value={ picker?.default ?? '' }
						disabled={ readOnly }
						options={ [ { value: '', label: __( 'The country of the form’s language', 'funnelforms-pro' ) }, ...countries.filter( ( c ) => ! allowed.length || allowed.includes( c.iso ) ).map( ( c ) => ( { value: c.iso, label: `${ c.name } +${ c.code }` } ) ) ] }
						onChange={ ( v ) => set( 'default', v ) }
					/>
					<CountryList label={ __( 'Countries on top', 'funnelforms-pro' ) } hint={ __( 'Listed first in the picker.', 'funnelforms-pro' ) } value={ picker?.preferred ?? [] } onChange={ ( v ) => set( 'preferred', v ) } />
					<CountryList label={ __( 'Only these countries', 'funnelforms-pro' ) } hint={ __( 'Without a country here, numbers of every country are accepted.', 'funnelforms-pro' ) } value={ allowed } onChange={ ( v ) => set( 'allowed', v ) } />
					{ picker?.default && allowed.length && ! allowed.includes( picker.default ) ? <Notice tone="warning">{ __( 'The start country is not among the countries accepted.', 'funnelforms-pro' ) }</Notice> : null }
				</>
			) : null }
		</>
	);
}

/** Confirmation by text message of a contact phone field (Funnelforms Pro). */
export function PhoneSmsProps( { props, edit, always }: { props: Props; edit: Edit; always: boolean } ) {
	const { api, ctx, lang, readOnly } = useEnv();
	const [ connections, setConnections ] = useState<Connection[] | null>( null );
	const sms = props.sms;
	const free = 'free' === process.env.FUNNELFORMS_EDITION;
	const on = undefined !== sms;
	useEffect( () => {
		let live = true;
		if ( on && ! free ) {
			api.connections().then(
				( list ) => live && setConnections( list ),
				() => live && setConnections( [] )
			);
		}
		return () => {
			live = false;
		};
	}, [ api, free, on ] );
	const set = ( key: keyof PhoneSms, value: string ): void => edit( ( p ) => void ( ( p.sms as unknown as Record<string, unknown> )[ key ] = value ), 'props.sms.' + key );
	const none = null !== connections && ! connections.some( ( c ) => CONNECTION_TYPES.sms.includes( c.type ) );
	if ( free && always ) {
		return <Notice tone="warning">{ __( 'This field type is part of Funnelforms Pro. Delete the question to publish the form.', 'funnelforms-pro' ) }</Notice>;
	}
	if ( free && ! on ) {
		return (
			<p className="ffxb-hint">
				<ProBadge /> { __( 'Confirming numbers by text message comes with Funnelforms Pro.', 'funnelforms-pro' ) }
			</p>
		);
	}
	return (
		<>
			<Toggle
				label={ __( 'Confirm by text message', 'funnelforms-pro' ) }
				hint={ __( 'Visitors get a code of six digits by text message and enter it before they send the form.', 'funnelforms-pro' ) }
				checked={ on }
				disabled={ readOnly || always }
				onChange={ ( checked ) =>
					edit( ( p ) => {
						if ( checked ) {
							p.country ??= {};
							p.sms = { connectionRef: '', sender: '', text: { [ ctx.locale ]: '' } };
						} else {
							delete p.sms;
						}
					}, 'props.sms' )
				}
			/>
			{ sms && free ? <Notice tone="warning">{ __( 'Confirming numbers by text message is part of Funnelforms Pro. Switch it off to publish the form.', 'funnelforms-pro' ) }</Notice> : null }
			{ sms && ! free ? (
				<>
					{ none ? <Notice tone="warning">{ __( 'There is no SMS connection yet. Add one with Twilio or Bird; without it the form cannot go live.', 'funnelforms-pro' ) }</Notice> : null }
					{ null === connections ? null : (
						<ConnectionPicker
							types={ CONNECTION_TYPES.sms }
							value={ sms.connectionRef }
							connections={ connections }
							onChange={ ( v ) => set( 'connectionRef', v ) }
							onConnection={ ( c ) => setConnections( [ ...connections, c ] ) }
							onConnections={ setConnections }
							test={ { sender: sms.sender ?? '' } }
						/>
					) }
					<TextInput label={ __( 'Sender', 'funnelforms-pro' ) } value={ sms.sender ?? '' } onChange={ ( v ) => set( 'sender', v ) } hint={ __( 'Name (up to 11 letters) or number shown as sender; some countries only allow numbers.', 'funnelforms-pro' ) } />
					<TextProp
						label={ __( 'Text message', 'funnelforms-pro' ) }
						value={ sms.text as Text }
						onChange={ ( v ) => edit( ( p ) => put( p.sms as unknown as Record<string, unknown>, 'text', lang, v, ctx.locale ), 'props.sms.text' ) }
						multiline
						hint={ __( 'Write {{code}} where the code goes. Left empty, the message is "Your confirmation code:" with the code.', 'funnelforms-pro' ) }
					/>
				</>
			) : null }
		</>
	);
}
