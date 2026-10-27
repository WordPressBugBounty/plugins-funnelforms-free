import type { ChoiceField, ContentField, DateField, DropdownField, EmailField, Field, FileField, NumberField, Option, PhoneField, RatingField, SignatureField, SliderField, TextField, TextareaField, TimeField, UrlField } from '@funnelforms/form-schema';
import { pickText } from '@funnelforms/form-core';
import type { FreeTimes } from './booking';
import { lucideIcon, type IconSet } from './icons';
import { contentMedia } from './media';
import { h, trusted, uniqueId } from './dom';
import { addPart, chunk } from './styles';
import { activateScripts } from './tracking';
import { checkRepeat, dateLimits, formatDate, RANGE_SEPARATOR, toIsoDate } from './validate';

export interface FieldContext {
	text( value: Record<string, string> | undefined ): string;
	t( key: string ): string;
	get( fieldId: string ): unknown;
	set( fieldId: string, value: unknown ): void;
	/** Goes to the next step after the current one is answered. */
	advance(): void;
	/** HTML of the answers so far, for {{answers}} in content steps. */
	summaryHtml(): string;
	/** Uploads a file of a file field; resolves to the stored file or an error code. */
	upload( fieldId: string, file: File ): Promise<UploadedFile | { error: string }>;
	/** Marks the step as busy (uploads running), so Next waits. */
	busy( on: boolean ): void;
	iconFont: boolean;
	/** Elements of the Lucide icons the form uses. */
	icons?: IconSet;
	/** The site's Google Maps key for address suggestions, if any. */
	mapsKey: string | null;
	/** Language of the form for dates and times (BCP 47, e.g. de-DE). */
	locale: string;
	/** Free times of a booking field between two days, or an error code. */
	slots( fieldId: string, from: string, to: string, duration: number ): Promise<FreeTimes | { error: string }>;
}

/** Value of a file field: the uploads, in order. */
export interface UploadedFile {
	ref: string;
	name: string;
	size: number;
	/** Signature: the image as a data URL; image files: a local object URL. Shown again after Back, never sent. */
	preview?: string;
}

export interface RenderedField {
	el: HTMLElement;
	error: HTMLElement;
	focus: HTMLElement | null;
	/**
	 * True when the field moves on by itself (a required single choice or rating), so the step needs
	 * no Next button. Optional ones move on as well, but keep Next so visitors can skip them.
	 */
	selfAdvancing: boolean;
	/**
	 * Fields that show their own errors (repeat groups) check themselves on Next: true when
	 * valid; otherwise `focus` points at the first problem.
	 */
	check?: () => boolean;
}

export { pickText };

/** What the core lends the field chunks: the fields of a repeat group render and check like the others. */
const core = { render: renderField, checkRepeat };
export type Core = typeof core;

/** A field whose controls come from a chunk: the field, its context, the group the core rendered and the core. */
export type Later = [ field: Field, ctx: FieldContext, r: RenderedField, core: Core ];

declare global {
	interface Window {
		/** Fields by type waiting for their chunk (runtime-<type>.js), then the chunk that fills them. */
		ffxFields?: Record<string, { push( item: Later ): unknown }>;
	}
}

/**
 * Pro field types not every form has (address, booking, repeat groups): the core renders the group
 * with its question, description and error, and the chunk runtime-<type>.js (src/chunks) adds the
 * controls before the error, at once when it is there. The plugin loads the chunk with the runtime
 * for the forms that have the type (Frontend\Renderer::chunks()); until it arrives the field waits in
 * window.ffxFields[type]. The core checks the answers either way (validate.ts), so Next and submit
 * never depend on it.
 */
function later( field: Field, ctx: FieldContext, label: string, head: HTMLElement[], error: HTMLElement, describedBy: string ): RenderedField {
	const r: RenderedField = {
		el: h( 'fieldset', { class: `ffx-field ffx-field-${ field.type }`, 'aria-describedby': describedBy }, trusted( 'legend', label, { class: 'ffx-question' } ), ...head, error ),
		error,
		focus: null,
		selfAdvancing: false,
	};
	addPart( field.type, 'js' );
	( ( window.ffxFields ??= {} )[ field.type ] ??= [] ).push( [ field, ctx, r, core ] );
	return r;
}

/** Renders one field of a step. */
export function renderField( field: Field, ctx: FieldContext ): RenderedField {
	const errorId = uniqueId( 'error' );
	const error = h( 'p', { class: 'ffx-error', id: errorId, role: 'alert', hidden: true } );
	const label = ctx.text( field.label );
	const description = ctx.text( field.description );
	const descId = description ? uniqueId( 'desc' ) : null;
	const head = [
		trusted( 'div', description, { class: 'ffx-description', id: descId } ),
	];
	const describedBy = [ descId, errorId ].filter( Boolean ).join( ' ' );
	if ( ( field.type === 'choice' || field.type === 'dropdown' ) && field.props.multiple ) {
		error.setAttribute( 'data-too_few_choices', String( field.props.minChoices ?? '' ) );
		error.setAttribute( 'data-too_many_choices', String( field.props.maxChoices ?? '' ) );
	}

	switch ( field.type ) {
		case 'choice':
			return choice( field, ctx, label, head, error, describedBy );
		case 'content':
			return content( field, ctx, label, head, error );
		case 'file':
			return fileField( field, ctx, label, head, error, describedBy );
		case 'rating':
			return rating( field, ctx, label, head, error, describedBy );
		case 'signature':
			return signature( field, ctx, label, head, error, describedBy );
		case 'address':
		case 'booking':
		case 'repeat':
			return later( field, ctx, label, head, error, describedBy );
		case 'result':
			// Filled by the live results (chunks/live.ts); asks nothing.
			return { el: h( 'div', { class: 'ffx-field ffx-field-result' } ), error, focus: null, selfAdvancing: false };
	}

	const inputId = uniqueId( 'input' );
	let control: HTMLElement;
	switch ( field.type ) {
		case 'dropdown':
			control = dropdown( field, ctx, inputId, describedBy );
			break;
		case 'textarea':
			control = textInput( field, ctx, inputId, describedBy, true );
			break;
		case 'date':
			control = dateInput( field, ctx, inputId, describedBy );
			break;
		case 'slider':
			control = slider( field, ctx, inputId, describedBy );
			break;
		case 'text':
			control = textInput( field, ctx, inputId, describedBy, false );
			break;
		case 'email':
		case 'phone':
		case 'url':
			control = typedInput( field, ctx, inputId, describedBy );
			break;
		case 'number':
			control = numberInput( field, ctx, inputId, describedBy );
			break;
		case 'time':
			control = timeInput( field, ctx, inputId, describedBy );
			break;
		default:
			control = h( 'p', {}, ctx.t( 'error' ).replace( '%s', 'unsupported_field' ) );
	}
	const el = h(
		'div',
		{ class: `ffx-field ffx-field-${ field.type }` },
		trusted( 'label', label, { class: 'ffx-question', for: inputId, id: `${ inputId }-q` } ),
		...head,
		control,
		error
	);
	return { el, error, focus: el.querySelector( '.ffx-pick-toggle, input, select, textarea' ), selfAdvancing: false };
}

function media( option: Option, ctx: FieldContext ): HTMLElement | null {
	if ( ! option.media ) {
		return null;
	}
	if ( option.media.kind === 'lucide' ) {
		return lucideIcon( ctx.icons, option.media.value, 'ffx-option-icon ffx-option-svg' );
	}
	if ( option.media.kind === 'image' ) {
		return h( 'img', { class: 'ffx-option-media', src: option.media.value, alt: '', loading: 'lazy' } );
	}
	return ctx.iconFont ? h( 'i', { class: `ffx-option-icon ${ option.media.value }`, 'aria-hidden': 'true' } ) : null;
}

function choice( field: ChoiceField, ctx: FieldContext, label: string, head: HTMLElement[], error: HTMLElement, describedBy: string ): RenderedField {
	const p = field.props;
	const classes = [
		'ffx-options',
		`ffx-desktop-${ p.layout.desktop }`,
		`ffx-mobile-${ p.layout.mobile }`,
		p.hideIcons ? 'ffx-hide-icons' : '',
		p.columns?.desktop ? 'ffx-columns' : '',
		p.columns?.mobile ? 'ffx-columns-mobile' : '',
		p.iconPosition && p.iconPosition !== 'top' ? `ffx-icon-${ p.iconPosition }` : '',
		p.size && p.size !== 'm' ? `ffx-size-${ p.size }` : '',
		p.imageFull ? 'ffx-image-full' : '',
	];
	const list = h( 'div', { class: classes.filter( Boolean ).join( ' ' ) } );
	// Without a number per row the tiles fill rows evenly: 4 in one row, 5 and 6 in rows of 3, 8 in rows of 4.
	// Where a row is too narrow for that, half as many per row keep the rows even: 4 become 2 by 2.
	const count = field.options.length;
	const cols = count < 5 ? count : count === 5 || count % 3 === 0 ? 3 : 4;
	list.style.setProperty( '--ffx-auto', String( cols ) );
	list.style.setProperty( '--ffx-half', String( Math.ceil( cols / 2 ) ) );
	if ( p.columns?.desktop ) {
		list.style.setProperty( '--ffx-columns', String( p.columns.desktop ) );
	}
	if ( p.columns?.mobile ) {
		list.style.setProperty( '--ffx-columns-mobile', String( p.columns.mobile ) );
	}
	const chosen = (): string[] => ( Array.isArray( ctx.get( field.id ) ) ? ( ctx.get( field.id ) as string[] ) : [] );
	// At the most options, the others cannot be ticked until one is unticked.
	const limit = (): void => {
		const full = Boolean( p.maxChoices ) && chosen().length >= ( p.maxChoices ?? 0 );
		list.querySelectorAll<HTMLInputElement>( 'input[type="checkbox"]' ).forEach( ( input ) => {
			input.disabled = full && ! input.checked;
			input.closest( '.ffx-option' )?.classList.toggle( 'is-disabled', input.disabled );
		} );
	};

	for ( const option of field.options ) {
		const optionLabel = trusted( 'span', ctx.text( option.label ), { class: 'ffx-option-label' } );
		if ( p.multiple ) {
			const input = h( 'input', { type: 'checkbox', value: option.id, checked: chosen().includes( option.id ), 'aria-describedby': describedBy } );
			input.addEventListener( 'change', () => {
				const ids = field.options.map( ( o ) => o.id ).filter( ( id ) => id === option.id ? input.checked : chosen().includes( id ) );
				ctx.set( field.id, ids );
				limit();
				if ( p.autoAdvanceAt && ids.length >= p.autoAdvanceAt ) {
					ctx.advance();
				}
			} );
			list.append( h( 'label', { class: 'ffx-option', 'data-option': option.id }, input, media( option, ctx ), optionLabel ) );
		} else {
			const button = h( 'button', { type: 'button', class: 'ffx-option', 'data-option': option.id, 'aria-pressed': chosen().includes( option.id ) ? 'true' : 'false' }, media( option, ctx ), optionLabel );
			button.addEventListener( 'click', () => {
				ctx.set( field.id, [ option.id ] );
				list.querySelectorAll( 'button' ).forEach( ( b ) => b.setAttribute( 'aria-pressed', b === button ? 'true' : 'false' ) );
				ctx.advance();
			} );
			list.append( button );
		}
	}
	limit();
	const el = h(
		'fieldset',
		{ class: 'ffx-field ffx-field-choice', 'aria-describedby': describedBy },
		trusted( 'legend', label, { class: 'ffx-question' } ),
		...head,
		list,
		error
	);
	return { el, error, focus: list.querySelector( 'button, input' ), selfAdvancing: ! p.multiple && field.required };
}

/** Option labels as plain text, for lists that cannot hold markup. */
function plain( ctx: FieldContext, option: Option ): string {
	return ctx.text( option.label ).replace( /<[^>]*>/g, '' );
}

function dropdown( field: DropdownField, ctx: FieldContext, id: string, describedBy: string ): HTMLElement {
	const p = field.props;
	const placeholder = ctx.text( p.placeholder ) || ctx.t( 'choose' );
	if ( ! p.search && ! p.multiple ) {
		// The browser's own list: best on phones.
		const select = h( 'select', { id, class: 'ffx-input', 'aria-describedby': describedBy, required: field.required } );
		select.append( h( 'option', { value: '' }, placeholder ) );
		const current = ( ctx.get( field.id ) as string[] | undefined )?.[ 0 ];
		for ( const option of field.options ) {
			const el = h( 'option', { value: option.id, selected: option.id === current } );
			el.textContent = plain( ctx, option );
			select.append( el );
		}
		select.addEventListener( 'change', () => ctx.set( field.id, select.value ? [ select.value ] : [] ) );
		return select;
	}
	return pickList( field, ctx, id, describedBy, placeholder );
}

/**
 * A dropdown with a search box or several answers: a button that opens a panel of real radio
 * buttons or checkboxes, so keyboards and screen readers work as with any form controls.
 */
function pickList( field: DropdownField, ctx: FieldContext, id: string, describedBy: string, placeholder: string ): HTMLElement {
	const p = field.props;
	const panelId = uniqueId( 'list' );
	const name = uniqueId( 'pick' );
	const chosen = (): string[] => ( Array.isArray( ctx.get( field.id ) ) ? ( ctx.get( field.id ) as string[] ) : [] );
	const summary = h( 'span', { class: 'ffx-pick-summary', id: `${ id }-v` } );
	// Named by the question and what is chosen ("State, Berlin"), so the choice is read out too.
	const toggle = h( 'button', { type: 'button', id, class: 'ffx-input ffx-pick-toggle', 'aria-labelledby': `${ id }-q ${ id }-v`, 'aria-expanded': 'false', 'aria-controls': panelId, 'aria-describedby': describedBy }, summary );
	const panel = h( 'div', { class: 'ffx-pick-panel', id: panelId, hidden: true } );
	const search = p.search ? h( 'input', { type: 'search', class: 'ffx-input ffx-pick-search', 'aria-label': ctx.t( 'search' ), placeholder: ctx.t( 'search' ), autocomplete: 'off' } ) : null;
	const list = h( 'div', { class: 'ffx-pick-options', role: 'group', 'aria-labelledby': `${ id }-q` } );
	const empty = h( 'p', { class: 'ffx-pick-empty', hidden: true }, ctx.t( 'no_matches' ) );
	const wrap = h( 'div', { class: 'ffx-pick' }, toggle, panel );

	const show = (): void => {
		const labels = field.options.filter( ( o ) => chosen().includes( o.id ) ).map( ( o ) => plain( ctx, o ) );
		summary.textContent = labels.length ? labels.join( ', ' ) : placeholder;
		toggle.classList.toggle( 'is-empty', ! labels.length );
	};
	const open = ( on: boolean ): void => {
		panel.hidden = ! on;
		toggle.setAttribute( 'aria-expanded', on ? 'true' : 'false' );
		if ( on ) {
			( search ?? list.querySelector<HTMLInputElement>( 'input:checked, input' ) )?.focus();
		}
	};
	const limit = (): void => {
		const full = Boolean( p.multiple && p.maxChoices ) && chosen().length >= ( p.maxChoices ?? 0 );
		list.querySelectorAll<HTMLInputElement>( 'input' ).forEach( ( input ) => {
			input.disabled = full && ! input.checked;
		} );
	};

	for ( const option of field.options ) {
		const input = h( 'input', { type: p.multiple ? 'checkbox' : 'radio', name, value: option.id, checked: chosen().includes( option.id ) } );
		input.addEventListener( 'change', () => {
			if ( p.multiple ) {
				ctx.set( field.id, field.options.map( ( o ) => o.id ).filter( ( oid ) => oid === option.id ? input.checked : chosen().includes( oid ) ) );
				limit();
			} else {
				ctx.set( field.id, [ option.id ] );
			}
			show();
		} );
		// A single answer closes the list when picked with a click or Enter, not while arrowing through it.
		if ( ! p.multiple ) {
			input.addEventListener( 'click', ( e ) => {
				if ( ( e as MouseEvent ).detail > 0 ) {
					open( false );
					toggle.focus();
				}
			} );
		}
		list.append( h( 'label', { class: 'ffx-pick-option', 'data-option': option.id }, input, h( 'span', {}, plain( ctx, option ) ) ) );
	}
	search?.addEventListener( 'input', () => {
		const needle = search.value.trim().toLowerCase();
		let shown = 0;
		list.querySelectorAll<HTMLElement>( '.ffx-pick-option' ).forEach( ( row ) => {
			row.hidden = '' !== needle && ! ( row.textContent ?? '' ).toLowerCase().includes( needle );
			shown += row.hidden ? 0 : 1;
		} );
		empty.hidden = shown > 0;
	} );
	panel.append( ...( search ? [ search ] : [] ), list, empty );
	toggle.addEventListener( 'click', () => open( panel.hidden ) );
	wrap.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'Escape' && ! panel.hidden ) {
			e.stopPropagation();
			open( false );
			toggle.focus();
		} else if ( e.target === search && ( e.key === 'Enter' || e.key === 'ArrowDown' ) ) {
			// From the search box, Enter picks the first match and the arrow goes down into the list.
			e.preventDefault();
			const first = list.querySelector<HTMLInputElement>( '.ffx-pick-option:not([hidden]) input:not(:disabled)' );
			if ( e.key === 'ArrowDown' ) {
				first?.focus();
			} else if ( first ) {
				first.click();
				if ( ! p.multiple ) {
					open( false );
					toggle.focus();
				}
			}
		} else if ( e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'search' ) {
			// Enter picks the focused answer instead of sending the step.
			e.preventDefault();
			e.target.click();
			if ( ! p.multiple ) {
				open( false );
				toggle.focus();
			}
		}
	} );
	wrap.addEventListener( 'focusout', ( e ) => {
		if ( ! wrap.contains( e.relatedTarget as Node | null ) && null !== e.relatedTarget ) {
			open( false );
		}
	} );
	show();
	limit();
	return wrap;
}

function textInput( field: TextField | TextareaField, ctx: FieldContext, id: string, describedBy: string, multiline: boolean ): HTMLElement {
	const attrs = {
		id,
		class: 'ffx-input',
		placeholder: ctx.text( field.props.placeholder ) || null,
		maxlength: field.props.maxLength || null,
		minlength: field.props.minLength ?? null,
		required: field.required,
		autocomplete: field.props.autocomplete ?? null,
		'aria-describedby': describedBy,
	};
	const restrict = field.type === 'text' ? field.props.restrict : undefined;
	const input = multiline ? h( 'textarea', { ...attrs, rows: 4 } ) : h( 'input', { ...attrs, type: 'text', inputmode: restrict === 'digits' || restrict === 'birthday' ? 'numeric' : null } );
	input.value = String( ctx.get( field.id ) ?? '' );
	let lastLength = input.value.length;
	input.addEventListener( 'input', () => {
		let value = input.value;
		// Same input filters as 3.x: letters only, digits only, or a dd.mm.yyyy birthday mask.
		if ( restrict === 'letters' ) {
			value = value.replace( /[0-9]/g, '' );
		} else if ( restrict === 'digits' ) {
			value = value.replace( /[^0-9]/g, '' );
		} else if ( restrict === 'birthday' ) {
			value = value.replace( /[^0-9.]/g, '' );
			if ( value.length > lastLength && ( value.length === 2 || value.length === 5 ) ) {
				value += '.';
			}
			value = value.slice( 0, 10 );
		}
		if ( value !== input.value ) {
			input.value = value;
		}
		lastLength = value.length;
		ctx.set( field.id, value );
	} );
	return input;
}

const TYPED: Record<string, { type: string; inputmode: string; autocomplete: string }> = {
	email: { type: 'email', inputmode: 'email', autocomplete: 'email' },
	phone: { type: 'tel', inputmode: 'tel', autocomplete: 'tel' },
	url: { type: 'url', inputmode: 'url', autocomplete: 'url' },
};

function typedInput( field: EmailField | PhoneField | UrlField, ctx: FieldContext, id: string, describedBy: string ): HTMLElement {
	const kind = TYPED[ field.type ] ?? { type: 'text', inputmode: 'text', autocomplete: 'off' };
	const input = h( 'input', {
		id,
		class: 'ffx-input',
		type: kind.type,
		inputmode: kind.inputmode,
		autocomplete: kind.autocomplete,
		placeholder: ctx.text( field.props.placeholder ) || null,
		required: field.required,
		'aria-describedby': describedBy,
	} );
	input.value = String( ctx.get( field.id ) ?? '' );
	input.addEventListener( 'input', () => ctx.set( field.id, input.value ) );
	if ( field.type === 'phone' ) {
		chunk().push( [ input, field, ctx ] );
	}
	return input;
}

function numberInput( field: NumberField, ctx: FieldContext, id: string, describedBy: string ): HTMLElement {
	const p = field.props;
	const input = h( 'input', {
		id,
		class: 'ffx-input',
		type: 'number',
		inputmode: 'decimal',
		min: p.min ?? null,
		max: p.max ?? null,
		step: p.step ?? 'any',
		placeholder: ctx.text( p.placeholder ) || null,
		required: field.required,
		'aria-describedby': describedBy,
	} );
	const current = ctx.get( field.id );
	input.value = current === undefined || current === null ? '' : String( current );
	input.addEventListener( 'input', () => {
		// Typed text the browser cannot read stays text, so the check reports it.
		const number = input.valueAsNumber;
		ctx.set( field.id, input.value === '' ? ( input.validity.badInput ? 'x' : '' ) : Number.isFinite( number ) ? number : input.value );
	} );
	const unit = p.unit ? ctx.text( p.unit.text ).replace( /<[^>]*>/g, '' ) : '';
	if ( ! unit || ! p.unit ) {
		return input;
	}
	const label = h( 'span', { class: 'ffx-unit', 'aria-hidden': 'true' }, unit );
	return h( 'div', { class: `ffx-number ffx-unit-${ p.unit.position }` }, p.unit.position === 'before' ? label : null, input, p.unit.position === 'after' ? label : null );
}

function timeInput( field: TimeField, ctx: FieldContext, id: string, describedBy: string ): HTMLElement {
	const p = field.props;
	const input = h( 'input', {
		id,
		class: 'ffx-input',
		type: 'time',
		min: p.min ?? null,
		max: p.max ?? null,
		step: p.stepMinutes ? p.stepMinutes * 60 : null,
		required: field.required,
		'aria-describedby': describedBy,
	} );
	input.value = String( ctx.get( field.id ) ?? '' );
	input.addEventListener( 'input', () => ctx.set( field.id, input.value.slice( 0, 5 ) ) );
	return input;
}

/** Faces from unhappy to delighted; a scale takes them evenly, so its middle is always 😐. */
const FACES = [ '😫', '😞', '😟', '🙁', '😕', '😐', '🙂', '😊', '😀', '😃', '😍' ];

/** Face of point `i` (from 0) of `count` points. */
export function ratingFace( i: number, count: number ): string {
	return FACES[ Math.round( ( i * ( FACES.length - 1 ) ) / Math.max( 1, count - 1 ) ) ] ?? '';
}

function rating( field: RatingField, ctx: FieldContext, label: string, head: HTMLElement[], error: HTMLElement, describedBy: string ): RenderedField {
	const p = field.props;
	const stars = p.style === 'stars';
	const count = p.max - p.min + 1;
	const list = h( 'div', { class: `ffx-rating ffx-rating-${ p.style }${ p.show === 'emojis' ? ' ffx-rating-faces' : '' }` } );
	const buttons: HTMLButtonElement[] = [];
	/** What point n shows besides its number: a face or an own text ('' for the number). */
	const shown = ( n: number ): string => {
		if ( p.show === 'emojis' ) {
			return ratingFace( n - p.min, count );
		}
		return p.show === 'labels' ? ctx.text( p.labels?.[ n - p.min ] ).replace( /<[^>]*>/g, '' ) : '';
	};
	const chosen = stars && p.show ? h( 'div', { class: 'ffx-rating-chosen', 'aria-hidden': 'true' } ) : null;
	const mark = ( value: unknown ): void => {
		buttons.forEach( ( button ) => {
			const n = Number( button.value );
			button.setAttribute( 'aria-pressed', n === value ? 'true' : 'false' );
			button.classList.toggle( 'ffx-rating-on', stars && typeof value === 'number' && n <= value );
		} );
		if ( chosen ) {
			chosen.textContent = typeof value === 'number' ? shown( value ) : '';
		}
	};
	for ( let n = p.min; n <= p.max; n++ ) {
		const extra = p.show === 'labels' ? shown( n ) : '';
		const text = ctx.t( 'rating_value' ).replace( '%1$s', String( n ) ).replace( '%2$s', String( p.max ) ) + ( extra ? `: ${ extra }` : '' );
		const button = h( 'button', { type: 'button', class: 'ffx-rating-option', value: n, 'aria-label': text, 'aria-describedby': describedBy }, stars ? '★' : shown( n ) || String( n ) );
		if ( p.style === 'colors' ) {
			// Red over yellow to green.
			button.style.setProperty( '--ffx-scale', `hsl(${ Math.round( ( ( n - p.min ) / Math.max( 1, count - 1 ) ) * 120 ) } 70% 50%)` );
		}
		button.addEventListener( 'click', () => {
			ctx.set( field.id, n );
			mark( n );
			ctx.advance();
		} );
		buttons.push( button );
		list.append( button );
	}
	mark( ctx.get( field.id ) );
	const low = ctx.text( p.lowLabel ).replace( /<[^>]*>/g, '' );
	const high = ctx.text( p.highLabel ).replace( /<[^>]*>/g, '' );
	const legend = low || high ? h( 'div', { class: 'ffx-rating-labels', 'aria-hidden': 'true' }, h( 'span', {}, low ), h( 'span', {}, high ) ) : null;
	const el = h(
		'fieldset',
		{ class: 'ffx-field ffx-field-rating', 'aria-describedby': describedBy },
		trusted( 'legend', label, { class: 'ffx-question' } ),
		...head,
		list,
		chosen,
		legend,
		error
	);
	return { el, error, focus: buttons[ 0 ] ?? null, selfAdvancing: field.required };
}

const SIGNATURE_FONT = 'italic 44px "Segoe Script", "Bradley Hand", "Brush Script MT", cursive';

function signature( field: SignatureField, ctx: FieldContext, label: string, head: HTMLElement[], error: HTMLElement, describedBy: string ): RenderedField {
	const canvas = h( 'canvas', { class: 'ffx-signature-pad', width: 600, height: 200, 'aria-hidden': 'true' } );
	const pen = canvas.getContext( '2d' );
	const typedId = uniqueId( 'input' );
	const typed = h( 'input', { id: typedId, type: 'text', class: 'ffx-input ffx-signature-typed', autocomplete: 'name', 'aria-describedby': describedBy } );
	const clearButton = h( 'button', { type: 'button', class: 'ffx-signature-clear' }, ctx.text( field.props.clearLabel ).replace( /<[^>]*>/g, '' ) || ctx.t( 'clear_signature' ) );
	let drawn = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let waiting = false;
	let round = 0;

	const ink = (): void => {
		if ( pen ) {
			pen.lineWidth = 2.5;
			pen.lineCap = 'round';
			pen.lineJoin = 'round';
			pen.strokeStyle = pen.fillStyle = field.props.penColor || getComputedStyle( canvas ).color || '#1d1b26';
		}
	};
	const wipe = (): void => {
		pen?.clearRect( 0, 0, canvas.width, canvas.height );
		drawn = false;
	};
	const settle = ( on: boolean ): void => {
		if ( on !== waiting ) {
			waiting = on;
			ctx.busy( on );
		}
	};
	const send = async (): Promise<void> => {
		const mine = ++round;
		if ( ! drawn ) {
			ctx.set( field.id, [] );
			settle( false );
			return;
		}
		const preview = canvas.toDataURL( 'image/png' );
		const blob = await new Promise<Blob | null>( ( resolve ) => canvas.toBlob( resolve, 'image/png' ) );
		if ( mine !== round ) {
			return;
		}
		const result = blob ? await ctx.upload( field.id, new File( [ blob ], 'signature.png', { type: 'image/png' } ) ) : { error: 'upload_failed' };
		if ( mine !== round ) {
			return;
		}
		if ( 'error' in result ) {
			error.textContent = ctx.t( result.error );
			error.hidden = false;
			ctx.set( field.id, [] );
		} else {
			error.hidden = true;
			ctx.set( field.id, [ { ...result, preview } ] );
		}
		settle( false );
	};
	// Uploads once the visitor pauses, so Next waits for the latest drawing only.
	const changed = (): void => {
		ctx.set( field.id, [] );
		settle( true );
		clearTimeout( timer );
		timer = setTimeout( () => void send(), 400 );
	};
	const point = ( event: PointerEvent ): [ number, number ] => {
		const box = canvas.getBoundingClientRect();
		return [ ( event.clientX - box.left ) * ( canvas.width / ( box.width || canvas.width ) ), ( event.clientY - box.top ) * ( canvas.height / ( box.height || canvas.height ) ) ];
	};
	let down = false;
	canvas.addEventListener( 'pointerdown', ( event ) => {
		if ( typed.value ) {
			typed.value = '';
			wipe();
		}
		down = true;
		canvas.setPointerCapture?.( event.pointerId );
		ink();
		const [ x, y ] = point( event );
		pen?.beginPath();
		pen?.moveTo( x, y );
		event.preventDefault();
	} );
	canvas.addEventListener( 'pointermove', ( event ) => {
		if ( ! down ) {
			return;
		}
		const [ x, y ] = point( event );
		pen?.lineTo( x, y );
		pen?.stroke();
		drawn = true;
	} );
	const stop = (): void => {
		if ( down ) {
			down = false;
			changed();
		}
	};
	canvas.addEventListener( 'pointerup', stop );
	canvas.addEventListener( 'pointercancel', stop );
	typed.addEventListener( 'input', () => {
		wipe();
		const name = typed.value.trim();
		if ( name && pen ) {
			ink();
			pen.font = SIGNATURE_FONT;
			pen.textBaseline = 'middle';
			pen.fillText( name, 24, canvas.height / 2, canvas.width - 48 );
			drawn = true;
		}
		changed();
	} );
	// A picture of the signature, drawn into the pad and sent as PNG like a drawn one.
	const pictureId = uniqueId( 'input' );
	const picture = field.props.upload ? h( 'input', { id: pictureId, type: 'file', class: 'ffx-file-input', accept: 'image/png,image/jpeg' } ) : null;
	picture?.addEventListener( 'change', () => {
		const chosen = picture.files?.[ 0 ];
		picture.value = '';
		if ( ! chosen || ! /^image\/(png|jpeg)$/.test( chosen.type ) || ! pen ) {
			if ( chosen ) {
				error.textContent = ctx.t( 'file_type_not_allowed' );
				error.hidden = false;
			}
			return;
		}
		const image = new Image();
		const url = URL.createObjectURL( chosen );
		image.onload = () => {
			URL.revokeObjectURL( url );
			typed.value = '';
			wipe();
			const scale = Math.min( canvas.width / image.width, canvas.height / image.height, 1 );
			const w = image.width * scale;
			const hgt = image.height * scale;
			pen.drawImage( image, ( canvas.width - w ) / 2, ( canvas.height - hgt ) / 2, w, hgt );
			drawn = true;
			error.hidden = true;
			changed();
		};
		image.onerror = () => {
			URL.revokeObjectURL( url );
			error.textContent = ctx.t( 'file_type_not_allowed' );
			error.hidden = false;
		};
		image.src = url;
	} );
	clearButton.addEventListener( 'click', () => {
		typed.value = '';
		wipe();
		clearTimeout( timer );
		round++;
		settle( false );
		ctx.set( field.id, [] );
	} );

	const current = ctx.get( field.id );
	const saved = Array.isArray( current ) ? ( current as UploadedFile[] )[ 0 ] : undefined;
	if ( saved?.preview && pen ) {
		const image = new Image();
		image.onload = () => pen.drawImage( image, 0, 0 );
		image.src = saved.preview;
		drawn = true;
	}

	const el = h(
		'div',
		{ class: 'ffx-field ffx-field-signature' },
		trusted( 'label', label, { class: 'ffx-question', for: typedId } ),
		...head,
		h( 'div', { class: 'ffx-signature' }, canvas, clearButton ),
		h( 'label', { class: 'ffx-signature-typed-label', for: typedId }, ctx.text( field.props.typeLabel ).replace( /<[^>]*>/g, '' ) || ctx.t( 'type_signature' ) ),
		typed,
		picture,
		picture ? h( 'label', { class: 'ffx-signature-upload', for: pictureId }, ctx.t( 'upload_signature' ) ) : null,
		error
	);
	return { el, error, focus: typed, selfAdvancing: false };
}

function dateInput( field: DateField, ctx: FieldContext, id: string, describedBy: string ): HTMLElement {
	const p = field.props;
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
	const { min, max } = dateLimits( p );
	const input = ( inputId: string, value: string ): HTMLInputElement => {
		const el = h( 'input', { id: inputId, type: 'date', class: 'ffx-input', required: field.required, min: min || null, max: max || null, 'aria-describedby': describedBy } );
		el.value = toIsoDate( value, p.format );
		return el;
	};
	const shown = ( el: HTMLInputElement ): string => ( iso.test( el.value ) ? formatDate( el.value, p.format ) : '' );
	if ( ! p.range ) {
		const single = input( id, String( ctx.get( field.id ) ?? '' ) );
		single.addEventListener( 'change', () => ctx.set( field.id, shown( single ) ) );
		return single;
	}
	// A period: two dates; the answer is "<from> – <to>" once one of them is set.
	const [ fromText = '', toText = '' ] = String( ctx.get( field.id ) ?? '' ).split( RANGE_SEPARATOR );
	const from = input( id, fromText );
	const to = input( id + '-to', toText );
	const update = (): void => {
		if ( iso.test( from.value ) ) {
			to.min = from.value > min ? from.value : min;
		}
		ctx.set( field.id, from.value || to.value ? shown( from ) + RANGE_SEPARATOR + shown( to ) : '' );
	};
	from.addEventListener( 'change', update );
	to.addEventListener( 'change', update );
	return h(
		'div',
		{ class: 'ffx-date-range' },
		h( 'div', { class: 'ffx-date-part' }, h( 'span', { class: 'ffx-date-label', 'aria-hidden': 'true' }, ctx.t( 'date_from' ) ), from ),
		h( 'div', { class: 'ffx-date-part' }, h( 'label', { class: 'ffx-date-label', for: id + '-to' }, ctx.t( 'date_to' ) ), to )
	);
}

/** A number with the slider's thousands separator and unit. */
function sliderText( p: SliderField[ 'props' ], n: number, unit: string ): string {
	const [ whole = '', decimals ] = String( Math.abs( n ) ).split( '.' );
	const grouped = p.thousandsSeparator ? whole.replace( /\B(?=(\d{3})+(?!\d))/g, p.separator ?? '.' ) : whole;
	const decimal = ( p.separator ?? '.' ) === ',' ? '.' : ',';
	const number = ( n < 0 ? '-' : '' ) + grouped + ( decimals ? ( p.thousandsSeparator ? decimal : '.' ) + decimals : '' );
	return unit ? ( p.unit.position === 'before' ? `${ unit } ${ number }` : `${ number } ${ unit }` ) : number;
}

function slider( field: SliderField, ctx: FieldContext, id: string, describedBy: string ): HTMLElement {
	const p = field.props;
	const unit = ctx.text( p.unit.text ).replace( /<[^>]*>/g, '' );
	if ( p.range ) {
		return rangeSlider( field, ctx, id, describedBy, unit );
	}
	if ( ctx.get( field.id ) === undefined ) {
		ctx.set( field.id, p.start );
	}
	const value = Number( ctx.get( field.id ) );
	const show = ( n: number ): string => sliderText( p, n, unit );
	const output = h( 'output', { class: 'ffx-slider-value', for: id, 'aria-live': 'polite' }, show( value ) );
	const range = h( 'input', { id, type: 'range', class: 'ffx-range', min: p.min, max: p.max, step: p.step, value, 'aria-describedby': describedBy } );
	// The chosen part of the track, drawn by the style.
	const fill = ( n: number ): void => range.style.setProperty( '--ffx-fill', `${ ( ( n - p.min ) / ( p.max - p.min || 1 ) ) * 100 }%` );
	fill( value );
	const wrap = h( 'div', { class: 'ffx-slider' }, output, range );
	let manual: HTMLInputElement | null = null;
	if ( p.manualInput.enabled ) {
		const manualId = id + '-manual';
		manual = h( 'input', { id: manualId, type: 'number', class: 'ffx-input ffx-slider-manual', min: p.min, max: p.max, step: 'any', value } );
		wrap.append( h( 'label', { class: 'ffx-slider-manual-label', for: manualId }, ctx.text( p.manualInput.label ).replace( /<[^>]*>/g, '' ) || unit ), manual );
		manual.addEventListener( 'input', () => {
			const n = Number( manual?.value );
			if ( manual?.value !== '' && Number.isFinite( n ) ) {
				ctx.set( field.id, n );
				range.value = String( n );
				output.textContent = show( n );
				fill( n );
			}
		} );
	}
	range.addEventListener( 'input', () => {
		const n = Number( range.value );
		ctx.set( field.id, n );
		output.textContent = show( n );
		fill( n );
		if ( manual ) {
			manual.value = String( n );
		}
	} );
	return wrap;
}

/**
 * Two handles on one track for a range ("from" and "to"); each is a real range input, so
 * keyboards and screen readers work, and neither can pass the other.
 */
function rangeSlider( field: SliderField, ctx: FieldContext, id: string, describedBy: string, unit: string ): HTMLElement {
	const p = field.props;
	const stored = ctx.get( field.id );
	const start: [ number, number ] = Array.isArray( stored ) && stored.length === 2 ? [ Number( stored[ 0 ] ), Number( stored[ 1 ] ) ] : [ p.start, p.startEnd ?? p.max ];
	ctx.set( field.id, start );
	const output = h( 'output', { class: 'ffx-slider-value', for: `${ id } ${ id }-to`, 'aria-live': 'polite' } );
	const track = h( 'div', { class: 'ffx-range-fill' } );
	const handle = ( handleId: string, value: number, label: string ): HTMLInputElement =>
		h( 'input', { id: handleId, type: 'range', class: 'ffx-range ffx-range-handle', min: p.min, max: p.max, step: p.step, value, 'aria-label': label, 'aria-describedby': describedBy } );
	const low = handle( id, start[ 0 ], ctx.t( 'date_from' ) );
	const high = handle( id + '-to', start[ 1 ], ctx.t( 'date_to' ) );
	const manual = p.manualInput.enabled
		? [ low, high ].map( ( r, i ) => h( 'input', { type: 'number', class: 'ffx-input ffx-slider-manual', min: p.min, max: p.max, step: 'any', value: r.value, 'aria-label': ctx.t( i ? 'date_to' : 'date_from' ) } ) )
		: [];
	const span = p.max - p.min || 1;
	const update = ( moved?: HTMLInputElement ): void => {
		let a = Number( low.value );
		let b = Number( high.value );
		if ( a > b ) {
			// The handle being moved stops at the other one.
			if ( moved === low ) {
				a = b;
				low.value = String( a );
			} else {
				b = a;
				high.value = String( b );
			}
		}
		ctx.set( field.id, [ a, b ] );
		output.textContent = sliderText( p, a, unit ) + RANGE_SEPARATOR + sliderText( p, b, unit );
		track.style.insetInlineStart = `${ ( ( a - p.min ) / span ) * 100 }%`;
		track.style.insetInlineEnd = `${ 100 - ( ( b - p.min ) / span ) * 100 }%`;
		manual.forEach( ( m, i ) => {
			if ( document.activeElement !== m ) {
				m.value = String( i ? b : a );
			}
		} );
	};
	low.addEventListener( 'input', () => update( low ) );
	high.addEventListener( 'input', () => update( high ) );
	manual.forEach( ( m, i ) =>
		m.addEventListener( 'input', () => {
			const n = Number( m.value );
			if ( m.value !== '' && Number.isFinite( n ) ) {
				( i ? high : low ).value = String( n );
				update( i ? high : low );
			}
		} )
	);
	update();
	const bar = h( 'div', { class: 'ffx-range-double' }, h( 'div', { class: 'ffx-range-track' }, track ), low, high );
	return h( 'div', { class: 'ffx-slider ffx-slider-range' }, output, bar, ...( manual.length ? [ h( 'div', { class: 'ffx-slider-manuals' }, ...manual ) ] : [] ) );
}

function content( field: ContentField, ctx: FieldContext, label: string, head: HTMLElement[], error: HTMLElement ): RenderedField {
	// {{calc:<id>}} stays as text; the app fills in the results of the whole step (FormApp.fillCalcs).
	const html = ctx.text( field.props.html ).replace( /\{\{\s*answers\s*\}\}/, () => ctx.summaryHtml() );
	const body = trusted( 'div', html, { class: 'ffx-content' } );
	activateScripts( body );
	const button = field.props.button.show
		? h( 'button', { type: 'button', class: 'ffx-button ffx-button-primary ffx-content-button' }, ctx.text( field.props.button.label ).replace( /<[^>]*>/g, '' ) || ctx.t( 'next' ) )
		: null;
	button?.addEventListener( 'click', () => ctx.advance() );
	// Text to read does not move on by itself for visitors who reduce motion (Next stays); a loading screen does.
	const still = ! field.props.loader && ( window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false );
	const wait = button || still ? 0 : field.props.autoAdvanceMs ?? 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// Only while the step is still shown; the visitor may have moved on already.
	const run = (): void => void ( timer = setTimeout( () => body.isConnected && ctx.advance(), wait ) );
	let pause: HTMLElement | null = null;
	if ( wait ) {
		run();
		if ( ! field.props.loader ) {
			// WCAG 2.2.1: the visitor can hold the step and go on with Next.
			pause = h( 'button', { type: 'button', class: 'ffx-button ffx-content-pause', 'aria-pressed': 'false' }, ctx.t( 'pause' ) );
			pause.addEventListener( 'click', () => {
				const held = pause?.getAttribute( 'aria-pressed' ) !== 'true';
				pause?.setAttribute( 'aria-pressed', String( held ) );
				clearTimeout( timer );
				if ( ! held ) {
					run();
				}
			} );
		}
	}
	const loader = wait && field.props.loader ? loadingScreen( field.props.loader, wait, ctx ) : null;
	const media = field.props.media ? contentMedia( field.props.media, ctx ) : null;
	const el = h( 'div', { class: 'ffx-field ffx-field-content' }, label ? trusted( 'h3', label, { class: 'ffx-question' } ) : null, ...head, media, body, loader, button, pause, error );
	// A loading screen moves on by itself, so it offers no Next.
	return { el, error, focus: button, selfAdvancing: Boolean( button ) || Boolean( loader ) };
}

/** Animation and texts that change evenly over the waiting time, read out politely. */
function loadingScreen( loader: NonNullable<ContentField[ 'props' ][ 'loader' ]>, wait: number, ctx: FieldContext ): HTMLElement {
	const messages = loader.messages.map( ( m ) => ctx.text( m ).replace( /<[^>]*>/g, '' ).trim() ).filter( Boolean );
	const text = h( 'p', { class: 'ffx-loader-message' }, messages[ 0 ] ?? '' );
	const animation = h( 'div', { class: 'ffx-loader-animation', 'aria-hidden': 'true' } );
	if ( loader.style === 'dots' ) {
		animation.append( h( 'span', {} ), h( 'span', {} ), h( 'span', {} ) );
	}
	const box = h( 'div', { class: `ffx-loader ffx-loader-${ loader.style }`, role: 'status' }, animation, text );
	// Through the CSSOM, which a content security policy without inline styles still allows.
	box.style.setProperty( '--ffx-loader-ms', `${ wait }ms` );
	if ( loader.style === 'circle' ) {
		// Counts up to 100 % in the waiting time.
		const percent = h( 'span', { class: 'ffx-loader-percent' }, '0 %' );
		animation.append( percent );
		const started = Date.now();
		const tick = (): void => {
			const done = Math.min( 100, Math.round( ( ( Date.now() - started ) / wait ) * 100 ) );
			percent.textContent = `${ done } %`;
			box.style.setProperty( '--ffx-loader-done', String( done ) );
			if ( done < 100 ) {
				setTimeout( tick, 50 );
			}
		};
		tick();
	}
	messages.slice( 1 ).forEach( ( message, i ) => {
		setTimeout( () => {
			text.textContent = message;
		}, ( ( i + 1 ) * wait ) / messages.length );
	} );
	return box;
}

function fileField( field: FileField, ctx: FieldContext, label: string, head: HTMLElement[], error: HTMLElement, describedBy: string ): RenderedField {
	const p = field.props;
	const max = Math.max( 1, p.maxFiles || 1 );
	const files = (): UploadedFile[] => ( Array.isArray( ctx.get( field.id ) ) ? ( ctx.get( field.id ) as UploadedFile[] ) : [] );
	const inputId = uniqueId( 'input' );
	// jpg, jpeg and jpe are one type, as for WordPress; phones name their photos either way.
	const sameType = ( e: string ): string => ( /^(jpe?g|jpe)$/.test( e ) ? 'jpg' : e );
	const extensions = ( p.allowedExtensions ?? [] ).map( ( e ) => sameType( e.toLowerCase() ) );
	const accept = extensions.flatMap( ( e ) => ( 'jpg' === e ? [ '.jpg', '.jpeg' ] : [ '.' + e ] ) );
	const input = h( 'input', { id: inputId, type: 'file', class: 'ffx-file-input', multiple: max > 1, accept: accept.join( ',' ) || null, 'aria-describedby': describedBy } );
	const hint = ctx.text( p.hint ).replace( /<[^>]*>/g, '' ).trim();
	const zone = h(
		'label',
		{ class: 'ffx-dropzone', for: inputId },
		h( 'span', { class: 'ffx-dropzone-text' }, ctx.text( p.dropzoneText ).replace( /<[^>]*>/g, '' ) || ctx.t( 'choose_files' ) ),
		hint ? h( 'span', { class: 'ffx-dropzone-hint' }, hint ) : null
	);
	const list = h( 'ul', { class: 'ffx-files', 'aria-live': 'polite' } );
	const showError = ( code: string ): void => {
		error.textContent = ctx.t( code );
		error.hidden = false;
	};
	const draw = (): void => {
		list.replaceChildren(
			...files().map( ( file ) => {
				const remove = h( 'button', { type: 'button', class: 'ffx-file-remove', 'aria-label': ctx.t( 'remove_file' ).replace( '%s', file.name ) }, '×' );
				remove.addEventListener( 'click', () => {
					// The upload stays pending on the server and is removed by its cleanup job.
					ctx.set( field.id, files().filter( ( f ) => f.ref !== file.ref ) );
					if ( file.preview?.startsWith( 'blob:' ) ) {
						URL.revokeObjectURL( file.preview );
					}
					draw();
					input.focus();
				} );
				const thumb = p.preview && file.preview ? h( 'img', { class: 'ffx-file-thumb', src: file.preview, alt: '' } ) : null;
				return h( 'li', { class: 'ffx-file' }, thumb, h( 'span', { class: 'ffx-file-name' }, file.name ), remove );
			} )
		);
		zone.hidden = files().length >= max;
	};
	const add = async ( chosen: File[] ): Promise<void> => {
		error.hidden = true;
		// Shown once all files are through, so a later upload does not hide why one was left out.
		let problem = '';
		if ( files().length + chosen.length > max ) {
			problem = 'too_many_files';
			chosen = chosen.slice( 0, Math.max( 0, max - files().length ) );
		}
		for ( const file of chosen ) {
			if ( p.maxSizeMb > 0 && file.size > p.maxSizeMb * 1024 * 1024 ) {
				problem = 'file_too_large';
				continue;
			}
			if ( extensions.length && ! extensions.includes( sameType( file.name.split( '.' ).pop()?.toLowerCase() ?? '' ) ) ) {
				problem = 'file_type_not_allowed';
				continue;
			}
			const pending = h( 'li', { class: 'ffx-file ffx-file-uploading' }, h( 'span', { class: 'ffx-file-name' }, file.name ), h( 'span', { class: 'ffx-file-status' }, ctx.t( 'uploading' ) ) );
			list.append( pending );
			ctx.busy( true );
			try {
				const result = await ctx.upload( field.id, file );
				if ( 'error' in result ) {
					problem = result.error;
				} else {
					const local = p.preview && /^image\/(png|jpeg|gif|webp)$/.test( file.type ) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL( file ) : undefined;
					ctx.set( field.id, [ ...files(), local ? { ...result, preview: local } : result ] );
				}
			} finally {
				ctx.busy( false );
				pending.remove();
			}
		}
		draw();
		if ( problem ) {
			showError( problem );
		}
	};
	input.addEventListener( 'change', () => {
		void add( [ ...( input.files ?? [] ) ] );
		input.value = '';
	} );
	zone.addEventListener( 'dragover', ( event ) => {
		event.preventDefault();
		zone.classList.add( 'ffx-dragging' );
	} );
	zone.addEventListener( 'dragleave', () => zone.classList.remove( 'ffx-dragging' ) );
	zone.addEventListener( 'drop', ( event ) => {
		event.preventDefault();
		zone.classList.remove( 'ffx-dragging' );
		void add( [ ...( event.dataTransfer?.files ?? [] ) ] );
	} );
	draw();
	const el = h(
		'div',
		{ class: 'ffx-field ffx-field-file' },
		trusted( 'label', label, { class: 'ffx-question', for: inputId } ),
		...head,
		input,
		zone,
		list,
		error
	);
	return { el, error, focus: input, selfAdvancing: false };
}
