/**
 * Filling fields from the page address (`props.prefillFromQuery`) and hidden fields of the contact
 * step (`props.hidden`, `props.defaultValue`). The runtime fills a field the first time its step
 * shows; the server fills a hidden field's fixed value and keeps it out of the page.
 */
import React from 'react';
import type { ContactField, Field } from '@funnelforms/form-schema';
import { PREFILL_CONTACT_TYPES, PREFILL_STEP_TYPES } from '@funnelforms/form-core';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { Button, icons, Notice, TextInput, Toggle } from './ui';

type AnyField = Field | ContactField;
type Edit = ( recipe: ( f: AnyField ) => void, key?: string ) => void;

/** Characters a parameter name keeps; the others become "_". */
export const paramName = ( value: string ): string => value.replace( /[^A-Za-z0-9_.-]/g, '_' ).slice( 0, 64 );

/** Whether a field of this step can be filled from the address. */
export function canPrefill( field: AnyField, contact: boolean ): boolean {
	return ( ( contact ? PREFILL_CONTACT_TYPES : PREFILL_STEP_TYPES ) as readonly string[] ).includes( field.type );
}

/** Whether a contact field is a hidden field. */
export function isHidden( field: { type: string; props?: unknown }, contact: boolean ): boolean {
	return contact && 'text' === field.type && true === ( field.props as Record<string, unknown> | undefined )?.hidden;
}

/** Name of the URL parameter that fills a field, or null. */
export function prefillParam( field: { props?: unknown } ): string | null {
	const name = ( field.props as Record<string, unknown> | undefined )?.prefillFromQuery;
	return typeof name === 'string' && '' !== name ? name : null;
}

/** What the address carries for a field, as an example: kundennummer=123. */
function example( field: AnyField, name: string ): string {
	const sample: Record<string, string> = {
		salutation: 'frau',
		email: 'max%40example.com',
		phone: '%2B4930123456',
		number: '3',
		checkbox: '1',
		url: 'https%3A%2F%2Fexample.com',
	};
	return `?${ name }=${ sample[ field.type ] ?? ( 'name' === field.type ? 'Max+Muster' : '…' ) }`;
}

/** Hint on what the address can say for a field of this type. */
function valuesHint( field: AnyField ): string {
	switch ( field.type ) {
		case 'choice':
		case 'dropdown':
		case 'select':
			return __( 'The value is an answer: its text, its value or its ID. Several answers are separated by commas.', 'funnelforms-pro' );
		case 'salutation':
			return __( 'Values: herr, frau, divers, firma.', 'funnelforms-pro' );
		case 'checkbox':
			return __( 'Ticks the box with 1, true, yes or ja.', 'funnelforms-pro' );
		default:
			return __( 'Spaces are written as + or %20.', 'funnelforms-pro' );
	}
}

/** "Fill from the page address": on/off, the name of the parameter and an example. */
export function PrefillProps( { field, contact, edit, readOnly }: { field: AnyField; contact: boolean; edit: Edit; readOnly: boolean } ) {
	if ( ! canPrefill( field, contact ) ) {
		return null;
	}
	const props = field.props as Record<string, unknown>;
	const name = typeof props.prefillFromQuery === 'string' ? props.prefillFromQuery : '';
	const on = '' !== name;
	const sample = example( field, name || paramName( field.key ) );
	return (
		<div className="ffxb-prefill">
			<Toggle
				label={ __( 'Fill from the page address', 'funnelforms-pro' ) }
				checked={ on }
				disabled={ readOnly }
				hint={ on ? undefined : __( 'A link such as ?name=value fills the field when the form opens. Visitors can still change it.', 'funnelforms-pro' ) }
				onChange={ ( v ) =>
					edit( ( f ) => {
						const p = f.props as Record<string, unknown>;
						if ( v ) {
							p.prefillFromQuery = paramName( f.key );
						} else {
							delete p.prefillFromQuery;
						}
					}, 'props.prefillFromQuery' )
				}
			/>
			{ on ? (
				<>
					<TextInput
						label={ __( 'URL parameter', 'funnelforms-pro' ) }
						value={ name }
						onChange={ ( v ) => edit( ( f ) => void ( ( f.props as Record<string, unknown> ).prefillFromQuery = paramName( v ) || name ), 'props.prefillFromQuery' ) }
						hint={ valuesHint( field ) }
					/>
					<p className="ffxb-field__hint">
						{ __( 'Example for the page with the form:', 'funnelforms-pro' ) } <code className="ffxb-code">{ sample }</code>{ ' ' }
						<Button size="sm" variant="ghost" icon={ icons.copy } aria-label={ __( 'Copy example', 'funnelforms-pro' ) } title={ __( 'Copy example', 'funnelforms-pro' ) } onClick={ () => void navigator.clipboard?.writeText( sample ).catch( () => undefined ) } />
					</p>
				</>
			) : null }
		</div>
	);
}

/** The switch that makes a text field of the contact step hidden, and the fixed value of a hidden field. */
export function HiddenFieldProps( { field, edit, readOnly }: { field: ContactField; edit: Edit; readOnly: boolean } ) {
	const { ctx } = useEnv();
	const props = field.props;
	const hidden = true === props.hidden;
	return (
		<>
			<Toggle
				label={ __( 'Hidden field', 'funnelforms-pro' ) }
				checked={ hidden }
				disabled={ readOnly }
				hint={ hidden ? undefined : __( 'Not shown in the form; holds a value from the page address or a fixed value for the entry.', 'funnelforms-pro' ) }
				onChange={ ( v ) =>
					edit( ( f ) => {
						const p = f.props as Record<string, unknown>;
						if ( v ) {
							p.hidden = true;
							f.required = false;
							p.prefillFromQuery ??= paramName( f.key );
						} else {
							delete p.hidden;
							delete p.defaultValue;
							p.placeholder ??= { [ ctx.locale ]: '' };
						}
					}, 'props.hidden' )
				}
			/>
			{ hidden ? (
				<>
					<TextInput
						label={ __( 'Fixed value', 'funnelforms-pro' ) }
						value={ typeof props.defaultValue === 'string' ? props.defaultValue : '' }
						onChange={ ( v ) =>
							edit( ( f ) => {
								const p = f.props as Record<string, unknown>;
								if ( '' === v ) {
									delete p.defaultValue;
								} else {
									p.defaultValue = v;
								}
							}, 'props.defaultValue' )
						}
						hint={ __( 'Used when the page address has no value for the field. It stays on the server and does not appear in the page.', 'funnelforms-pro' ) }
					/>
					<Notice>
						{ sprintf(
							/* translators: %s: placeholder of the field, e.g. {{field:kundennummer}} */
							__( 'The value is saved with the entry and shown in the lead. In mails, redirects and integrations it is %s.', 'funnelforms-pro' ),
							`{{field:${ field.key }}}`
						) }
					</Notice>
				</>
			) : null }
		</>
	);
}
