/**
 * Settings of text and address fields: what may be typed, what the browser may fill in, and
 * Google suggestions with the map.
 */
import React from 'react';
import type { AddressField, AutocompleteToken, TextareaField, TextField } from '@funnelforms/form-schema';
import type { Edit } from './Answers';
import { __ } from './i18n';
import { ChoiceTiles, NumberInput, Select, Sketch, Toggle } from './ui';

/** What the browser may fill in, in the order of a contact form. */
function autofillOptions(): Array<{ value: AutocompleteToken | ''; label: string }> {
	return [
		{ value: '', label: __( 'Browser decides', 'funnelforms-pro' ) },
		{ value: 'off', label: __( 'Nothing', 'funnelforms-pro' ) },
		{ value: 'name', label: __( 'Full name', 'funnelforms-pro' ) },
		{ value: 'given-name', label: __( 'First name', 'funnelforms-pro' ) },
		{ value: 'family-name', label: __( 'Last name', 'funnelforms-pro' ) },
		{ value: 'organization', label: __( 'Company', 'funnelforms-pro' ) },
		{ value: 'organization-title', label: __( 'Job title', 'funnelforms-pro' ) },
		{ value: 'street-address', label: __( 'Full street address', 'funnelforms-pro' ) },
		{ value: 'address-line1', label: __( 'Street and number', 'funnelforms-pro' ) },
		{ value: 'address-line2', label: __( 'Address addition', 'funnelforms-pro' ) },
		{ value: 'postal-code', label: __( 'Postcode', 'funnelforms-pro' ) },
		{ value: 'address-level2', label: __( 'City', 'funnelforms-pro' ) },
		{ value: 'country-name', label: __( 'Country', 'funnelforms-pro' ) },
		{ value: 'email', label: __( 'Email', 'funnelforms-pro' ) },
		{ value: 'tel', label: __( 'Phone', 'funnelforms-pro' ) },
		{ value: 'bday', label: __( 'Birthday', 'funnelforms-pro' ) },
		{ value: 'url', label: __( 'Website', 'funnelforms-pro' ) },
		{ value: 'username', label: __( 'User name', 'funnelforms-pro' ) },
	];
}

export function TextFieldProps( { field, edit, num }: { field: TextField | TextareaField; edit: Edit; num: ( key: string ) => ( value: number | undefined ) => void } ) {
	const props = ( recipe: ( props: Record<string, unknown> ) => void, key: string ): void => edit( ( f ) => recipe( f.props as Record<string, unknown> ), 'props.' + key );
	const choose = ( key: string ) => ( value: string ): void =>
		props( ( p ) => {
			if ( value ) {
				p[ key ] = value;
			} else {
				Reflect.deleteProperty( p, key );
			}
		}, key );
	return (
		<>
			<div className="ffxb-pair">
				<NumberInput label={ __( 'Minimum length', 'funnelforms-pro' ) } value={ field.props.minLength } min={ 0 } onChange={ num( 'minLength' ) } />
				<NumberInput label={ __( 'Maximum length', 'funnelforms-pro' ) } value={ field.props.maxLength } min={ 1 } onChange={ num( 'maxLength' ) } />
			</div>
			{ 'text' === field.type ? (
				<ChoiceTiles
					label={ __( 'Allowed input', 'funnelforms-pro' ) }
					value={ field.props.restrict ?? '' }
					columns={ 4 }
					options={ [
						{ value: '', label: __( 'Anything', 'funnelforms-pro' ), icon: <InputSketch text="Ab1" /> },
						{ value: 'letters', label: __( 'No digits', 'funnelforms-pro' ), icon: <InputSketch text="Abc" /> },
						{ value: 'digits', label: __( 'Digits only', 'funnelforms-pro' ), icon: <InputSketch text="123" /> },
						{ value: 'birthday', label: __( 'Birthday (dd.mm.yyyy)', 'funnelforms-pro' ), icon: <InputSketch text="31.12." /> },
					] }
					onChange={ choose( 'restrict' ) }
				/>
			) : null }
			<Select label={ __( 'Browser fills in', 'funnelforms-pro' ) } value={ field.props.autocomplete ?? '' } options={ autofillOptions() } onChange={ choose( 'autocomplete' ) } />
		</>
	);
}

export function AddressProps( { field, edit }: { field: AddressField; edit: Edit } ) {
	const p = field.props;
	const props = ( recipe: ( props: AddressField[ 'props' ] ) => void, key: string ): void => edit( ( f ) => recipe( ( f as AddressField ).props ), 'props.' + key );
	return (
		<>
			<Toggle label={ __( 'One input for the whole address', 'funnelforms-pro' ) } checked={ p.combined } onChange={ ( v ) => props( ( x ) => void ( x.combined = v ), 'combined' ) } />
			<Toggle label={ __( 'Ask for the country', 'funnelforms-pro' ) } checked={ p.showCountry } onChange={ ( v ) => props( ( x ) => void ( x.showCountry = v ), 'showCountry' ) } />
			<Toggle
				label={ __( 'Suggestions and map from Google', 'funnelforms-pro' ) }
				hint={ __( 'Needs the Google Maps key of the site (Tools, Funnelforms migration). Visitors then load Google Maps.', 'funnelforms-pro' ) }
				checked={ p.placesAutocomplete }
				onChange={ ( v ) =>
					props( ( x ) => {
						x.placesAutocomplete = v;
						if ( ! v ) {
							delete x.locate;
						}
					}, 'placesAutocomplete' )
				}
			/>
			{ p.placesAutocomplete ? (
				<>
					<Toggle
						label={ __( 'Button to use the visitor\'s location', 'funnelforms-pro' ) }
						hint={ __( 'The browser asks the visitor first.', 'funnelforms-pro' ) }
						checked={ true === p.locate }
						onChange={ ( v ) =>
							props( ( x ) => {
								if ( v ) {
									x.locate = true;
								} else {
									delete x.locate;
								}
							}, 'locate' )
						}
					/>
					<div className="ffxb-pair">
						<NumberInput label={ __( 'Map starts at latitude', 'funnelforms-pro' ) } value={ p.start.lat } min={ -90 } max={ 90 } step={ 0.001 } onChange={ ( v ) => undefined !== v && props( ( x ) => void ( x.start = { ...x.start, lat: v } ), 'start' ) } />
						<NumberInput label={ __( 'and longitude', 'funnelforms-pro' ) } value={ p.start.lng } min={ -180 } max={ 180 } step={ 0.001 } onChange={ ( v ) => undefined !== v && props( ( x ) => void ( x.start = { ...x.start, lng: v } ), 'start' ) } />
					</div>
					<NumberInput label={ __( 'Zoom of the map (1 to 22)', 'funnelforms-pro' ) } value={ p.zoom } min={ 1 } max={ 22 } onChange={ ( v ) => undefined !== v && props( ( x ) => void ( x.zoom = Math.min( 22, Math.max( 1, Math.round( v ) ) ) ), 'zoom' ) } />
				</>
			) : null }
		</>
	);
}

/** An input with an example of what it takes, for the tiles of the properties panel. */
function InputSketch( { text }: { text: string } ) {
	return (
		<Sketch>
			<rect x="4" y="7" width="40" height="18" rx="3" />
			<text x="24" y="20" textAnchor="middle" fontSize="9" fontWeight="600" fill="currentColor" stroke="none">
				{ text }
			</text>
		</Sketch>
	);
}
