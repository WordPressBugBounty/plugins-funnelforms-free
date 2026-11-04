import type { ContactField, Field, Option } from '@funnelforms/form-schema';
import { PREFILL_CONTACT_TYPES, PREFILL_STEP_TYPES } from '@funnelforms/form-core';

/**
 * Values from the page address for fields with `props.prefillFromQuery` (?<parameter>=<value>;
 * "+" stands for a space). A field is filled once per page view, the first time its step shows,
 * and only while it has no value yet (a resumed entry keeps its own).
 */

/** Query values 3.x accepted to preselect a salutation. */
const SALUTATION_QUERY: Record<string, string> = { herr: 'male', frau: 'female', divers: 'diverse', firma: 'company' };
const SALUTATIONS = [ 'male', 'female', 'diverse', 'company' ];
const YES = [ '1', 'true', 'yes', 'ja', 'on', 'oui', 'si', 'sí' ];
/** Longest text taken from the address, as the server takes it. */
const MAX_TEXT = 5000;

const plain = ( text: string ): string => text.replace( /<[^>]*>/g, '' ).trim().toLowerCase();

/** Name of the parameter that fills the field, or null. */
export function prefillParam( field: { props: unknown } ): string | null {
	const name = ( field.props as { prefillFromQuery?: unknown } | undefined )?.prefillFromQuery;
	return typeof name === 'string' && name !== '' ? name : null;
}

/** The value of the parameter, or null when the address has none (or an empty one). */
function param( params: URLSearchParams, name: string ): string | null {
	const value = params.get( name );
	return value === null || value.trim() === '' ? null : value.trim().slice( 0, MAX_TEXT );
}

/** Option ids for a value: each part matches an option by id, value or label (ignoring case). */
function optionIds( options: Array<Pick<Option, 'id' | 'label'> & { value?: string }>, value: string, multiple: boolean, label: ( o: Pick<Option, 'label'> ) => string ): string[] {
	const parts = multiple ? value.split( ',' ).map( ( p ) => p.trim() ).filter( Boolean ) : [ value ];
	const ids: string[] = [];
	for ( const part of parts ) {
		const wanted = part.toLowerCase();
		const option = options.find( ( o ) => o.id === part ) ?? options.find( ( o ) => ( o.value ?? '' ).toLowerCase() === wanted || plain( label( o ) ) === wanted );
		if ( option && ! ids.includes( option.id ) ) {
			ids.push( option.id );
		}
	}
	return multiple ? ids : ids.slice( 0, 1 );
}

/** Value for a step field from the address, or undefined to leave it as it is. */
export function stepPrefill( field: Field, params: URLSearchParams, label: ( o: Pick<Option, 'label'> ) => string ): unknown {
	const name = prefillParam( field );
	if ( ! name || ! ( PREFILL_STEP_TYPES as readonly string[] ).includes( field.type ) ) {
		return undefined;
	}
	const value = param( params, name );
	if ( value === null ) {
		return undefined;
	}
	switch ( field.type ) {
		case 'number': {
			const number = Number( value.replace( ',', '.' ) );
			return Number.isFinite( number ) ? number : undefined;
		}
		case 'choice':
		case 'dropdown': {
			const multiple = field.props.multiple === true;
			let ids = optionIds( field.options, value, multiple, label );
			if ( multiple && field.props.maxChoices ) {
				ids = ids.slice( 0, field.props.maxChoices );
			}
			return ids.length ? ids : undefined;
		}
		case 'text':
		case 'textarea':
			return field.props.maxLength ? value.slice( 0, field.props.maxLength ) : value;
		default:
			return value;
	}
}

/** Value for a contact field from the address, or undefined to leave it as it is. */
export function contactPrefill( field: ContactField, params: URLSearchParams, label: ( o: Pick<Option, 'label'> ) => string ): unknown {
	const name = prefillParam( field );
	if ( ! name || ! ( PREFILL_CONTACT_TYPES as readonly string[] ).includes( field.type ) ) {
		return undefined;
	}
	const value = param( params, name );
	if ( value === null ) {
		return undefined;
	}
	const props = field.props as { options?: Array<Pick<Option, 'id' | 'label'>>; maxLength?: number; allow?: Record<string, boolean> };
	switch ( field.type ) {
		case 'salutation': {
			const id = SALUTATION_QUERY[ value.toLowerCase() ] ?? ( SALUTATIONS.includes( value.toLowerCase() ) ? value.toLowerCase() : undefined );
			return id && props.allow?.[ id ] !== false ? id : undefined;
		}
		case 'select':
			return optionIds( Array.isArray( props.options ) ? props.options : [], value, false, label )[ 0 ];
		case 'checkbox':
			return YES.includes( value.toLowerCase() ) ? true : undefined;
		case 'text':
		case 'textarea':
			return props.maxLength && props.maxLength > 0 ? value.slice( 0, props.maxLength ) : value;
		default:
			return value;
	}
}

/** Whether a contact field is a hidden field: not shown, never required, filled from the address. */
export function isHiddenField( field: ContactField ): boolean {
	return field.type === 'text' && ( field.props as { hidden?: unknown } ).hidden === true;
}
