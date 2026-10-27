/**
 * The hand-over between the core and the chunks of field types (runtime-address.js,
 * runtime-booking.js, runtime-repeat.js; fields.ts later()). The core renders such a field as a
 * group with its question and error and pushes it to window.ffxFields[type], into a plain list
 * until the chunk is there. The chunk then fills those that waited and replaces the list, so the
 * fields of later steps are filled at once.
 */
import type { Field } from '@funnelforms/form-schema';
import type { Core, FieldContext, Later, RenderedField } from '../fields';

/** Fills every field of the type with fn, those rendered before the chunk came included. */
export function fill<F extends Field>( type: F[ 'type' ], fn: ( field: F, ctx: FieldContext, r: RenderedField, core: Core ) => void ): void {
	const all = ( window.ffxFields ??= {} );
	const queued = all[ type ];
	const take = ( [ field, ctx, r, core ]: Later ): void => fn( field as F, ctx, r, core );
	all[ type ] = { push: take };
	( Array.isArray( queued ) ? ( queued as Later[] ) : [] ).forEach( take );
}
