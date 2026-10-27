import type { RepeatField } from '@funnelforms/form-schema';
import { h } from './dom';
import type { Core, FieldContext, RenderedField } from './fields';
import type { RepeatItem } from './validate';

/** Heading of item `n` (from 1): the item label with %d replaced, or "n.". */
export function itemHeading( field: RepeatField, n: number, text: ( v: Record<string, string> | undefined ) => string ): string {
	const label = text( field.props.itemLabel ).replace( /<[^>]*>/g, '' ).trim();
	if ( ! label ) {
		return `${ n }.`;
	}
	return label.includes( '%d' ) ? label.replace( '%d', String( n ) ) : `${ label } ${ n }`;
}

function mark( r: RenderedField, message: string | null ): void {
	r.error.hidden = ! message;
	r.error.textContent = message ?? '';
	r.el.classList.toggle( 'ffx-invalid', Boolean( message ) );
	r.el.querySelectorAll( 'input, select, textarea' ).forEach( ( input ) => {
		if ( message ) {
			input.setAttribute( 'aria-invalid', 'true' );
		} else {
			input.removeAttribute( 'aria-invalid' );
		}
	} );
}

/**
 * A group of fields filled in once per item (chunk runtime-repeat.js). Each item renders the
 * group's fields with a context that reads and writes its own answers; visitors add items up to
 * maxItems and remove those above the minimum. The group checks itself (check) so errors land on
 * the sub-field that has them. Fills the group the core rendered, with the core's renderer and
 * checks (fields.ts later()).
 */
export function repeatField( field: RepeatField, ctx: FieldContext, result: RenderedField, { render, checkRepeat }: Core ): void {
	const { el, error } = result;
	const p = field.props;
	const least = Math.max( 1, p.minItems );
	const most = Math.max( 1, p.maxItems );
	const rows = (): RepeatItem[] => ( Array.isArray( ctx.get( field.id ) ) ? ( ctx.get( field.id ) as RepeatItem[] ) : [] );
	if ( rows().length < least ) {
		ctx.set( field.id, [ ...rows(), ...Array.from( { length: least - rows().length }, () => ( {} ) ) ] );
	}

	const list = h( 'div', { class: 'ffx-repeat-items' } );
	const add = h( 'button', { type: 'button', class: 'ffx-button ffx-repeat-add' }, ctx.text( p.addLabel ).replace( /<[^>]*>/g, '' ) || ctx.t( 'add_item' ) );
	let items: Array<Map<string, RenderedField>> = [];

	const firstInput = ( i: number ): HTMLElement | null => list.children[ i ]?.querySelector( 'input, select, textarea' ) ?? null;
	const draw = (): void => {
		items = [];
		list.replaceChildren(
			...rows().map( ( _row, i ) => {
				const rendered = new Map<string, RenderedField>();
				const sub: FieldContext = {
					...ctx,
					get: ( id ) => rows()[ i ]?.[ id ],
					set: ( id, value ) => {
						ctx.set( field.id, rows().map( ( row, j ) => ( j === i ? { ...row, [ id ]: value } : row ) ) );
						const r = rendered.get( id );
						if ( r && ! r.error.hidden ) {
							mark( r, null );
						}
					},
					advance: () => undefined,
				};
				const heading = itemHeading( field, i + 1, ( v ) => ctx.text( v ) );
				const box = h( 'fieldset', { class: 'ffx-repeat-item' }, h( 'legend', { class: 'ffx-repeat-heading' }, heading ) );
				for ( const f of p.fields ) {
					const r = render( f, sub );
					rendered.set( f.id, r );
					box.append( r.el );
				}
				if ( rows().length > least ) {
					const remove = h( 'button', { type: 'button', class: 'ffx-repeat-remove', 'aria-label': ctx.t( 'remove_item' ).replace( '%d', String( i + 1 ) ) }, '×' );
					remove.addEventListener( 'click', () => {
						ctx.set( field.id, rows().filter( ( _r, j ) => j !== i ) );
						draw();
						( firstInput( Math.min( i, rows().length - 1 ) ) ?? add ).focus();
					} );
					box.append( remove );
				}
				items.push( rendered );
				return box;
			} )
		);
		add.hidden = rows().length >= most;
	};
	add.addEventListener( 'click', () => {
		if ( rows().length < most ) {
			ctx.set( field.id, [ ...rows(), {} ] );
			draw();
			firstInput( rows().length - 1 )?.focus();
		}
	} );
	draw();

	error.before( list, add );
	result.focus = firstInput( 0 );
	result.check = () => {
		const checked = checkRepeat( field, ctx.get( field.id ) );
		const invalid: RenderedField[] = [];
		checked.items.forEach( ( codes, i ) => {
			items[ i ]?.forEach( ( r, id ) => {
				const code = codes[ id ] ?? null;
				mark( r, code ? ctx.t( code ) : null );
				if ( code ) {
					invalid.push( r );
				}
			} );
		} );
		const target = invalid[ 0 ]?.focus ?? null;
		error.hidden = ! checked.group;
		error.textContent = checked.group ? ctx.t( checked.group ).replace( '%d', String( p.minItems ) ) : '';
		el.classList.toggle( 'ffx-invalid', Boolean( checked.group ) );
		result.focus = target ?? ( checked.group ? ( rows().length < most && checked.group === 'too_few_items' ? add : firstInput( 0 ) ) : firstInput( 0 ) );
		return ! checked.group && invalid.length === 0;
	};
}
