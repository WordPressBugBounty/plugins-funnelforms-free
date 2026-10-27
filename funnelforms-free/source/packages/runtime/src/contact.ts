import type { ContactField, ContactNode } from '@funnelforms/form-schema';
import { loadWithConsent } from './consent';
import { escapeHtml, h, trusted, uniqueId } from './dom';
import { lucideIcon, type IconSet } from './icons';
import { chunk } from './styles';
import { activateScripts } from './tracking';
import { applyMask, maskSupported } from './validate';

export interface ContactContext {
	text( value: Record<string, string> | undefined ): string;
	t( key: string ): string;
	get( fieldId: string ): unknown;
	set( fieldId: string, value: unknown ): void;
	iconFont: boolean;
	/** Elements of the Lucide icons the form uses. */
	icons?: IconSet;
	/** Labels only for screen readers (`layout.hideLabels`). */
	hideLabels?: boolean;
}

export interface RenderedContactField {
	field: ContactField;
	el: HTMLElement;
	error: HTMLElement | null;
	focus: HTMLElement | null;
	/** Clears a one-time answer after a failed submit (captcha). */
	reset?: () => void;
}

/** The API reCAPTCHA, Turnstile and hCaptcha share for explicit rendering. */
interface CaptchaApi {
	render( el: HTMLElement, options: Record<string, unknown> ): unknown;
	reset( id?: unknown ): void;
}

type Provider = 'recaptcha' | 'turnstile' | 'hcaptcha' | 'recaptcha3';

/** Script, global object and onload callback of each provider; reCAPTCHA v3 runs from a chunk (src from the plugin). */
const CAPTCHA: Record<Provider, { src: string; global: string; ready: string; by: string }> = {
	recaptcha: { src: 'https://www.google.com/recaptcha/api.js', global: 'grecaptcha', ready: 'ffxRecaptchaReady', by: 'Google' },
	turnstile: { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js', global: 'turnstile', ready: 'ffxTurnstileReady', by: 'Cloudflare' },
	hcaptcha: { src: 'https://js.hcaptcha.com/1/api.js', global: 'hcaptcha', ready: 'ffxHcaptchaReady', by: 'hCaptcha' },
	recaptcha3: { src: '', global: 'ffxRecaptcha3', ready: 'ffxRecaptcha3Ready', by: 'Google' },
};

declare global {
	interface Window {
		grecaptcha?: CaptchaApi;
		ffxRecaptchaReady?: () => void;
	}
}

const captchas: Partial<Record<Provider, Promise<CaptchaApi>>> = {};

/** Loads a captcha script once, with consent (loadWithConsent()). */
function loadCaptcha( provider: Provider, chunk: unknown ): Promise<CaptchaApi> {
	const { src, global, ready } = CAPTCHA[ provider ];
	const win = window as unknown as Record<string, unknown>;
	captchas[ provider ] ??= new Promise( ( resolve, reject ) => {
		win[ ready ] = () => ( win[ global ] ? resolve( win[ global ] as CaptchaApi ) : reject( new Error( provider ) ) );
		const script = document.createElement( 'script' );
		script.src = `${ src || chunk }?onload=${ ready }&render=explicit`;
		script.async = true;
		script.onerror = () => {
			captchas[ provider ] = undefined;
			reject( new Error( provider ) );
		};
		document.head.append( script );
	} );
	return captchas[ provider ] as Promise<CaptchaApi>;
}

const SALUTATIONS = [ 'male', 'female', 'diverse', 'company' ] as const;
/** Query values 3.x accepted to preselect a salutation. */
const SALUTATION_QUERY: Record<string, string> = { herr: 'male', frau: 'female', divers: 'diverse', firma: 'company' };
const AUTOCOMPLETE: Record<string, string> = { name: 'name', email: 'email', phone: 'tel' };
const plain = ( html: string ): string => html.replace( /<[^>]*>/g, '' ).trim();

/**
 * Fills contact fields from the page URL (?<3.x field id>=value) the first time the step shows,
 * as 3.x did; "+" stands for a space.
 */
export function prefill( node: ContactNode, query: string, ctx: ContactContext ): void {
	const params = new URLSearchParams( query );
	for ( const field of node.fields ) {
		const name = field.props.prefillFromQuery;
		if ( typeof name !== 'string' || name === '' || ctx.get( field.id ) !== undefined || ! params.has( name ) ) {
			continue;
		}
		const value = params.get( name ) ?? '';
		if ( field.type === 'salutation' ) {
			const id = SALUTATION_QUERY[ value.toLowerCase() ];
			if ( id ) {
				ctx.set( field.id, id );
			}
		} else if ( [ 'name', 'email', 'phone', 'text', 'textarea' ].includes( field.type ) ) {
			ctx.set( field.id, value );
		}
	}
}

/** Renders one field of the contact step. */
export function renderContactField( field: ContactField, ctx: ContactContext ): RenderedContactField {
	const props = field.props as Record<string, unknown>;
	if ( field.type === 'html' ) {
		const el = trusted( 'div', ctx.text( props.html as Record<string, string> ), { class: 'ffx-contact-html' } );
		activateScripts( el );
		return { field, el, error: null, focus: null };
	}

	const errorId = uniqueId( 'error' );
	const error = h( 'p', { class: 'ffx-error', id: errorId, role: 'alert', hidden: true } );
	// The star is red like that of the questions; screen readers hear "required" from the input.
	const marker = field.required ? '<span class="ffx-required" aria-hidden="true"> *</span>' : '';
	let label = ctx.text( field.label );

	if ( field.type === 'consent' || field.type === 'checkbox' ) {
		const id = uniqueId( 'input' );
		const input = h( 'input', { id, type: 'checkbox', class: 'ffx-checkbox', checked: ctx.get( field.id ) === true, required: field.required, 'aria-describedby': errorId } );
		input.addEventListener( 'change', () => ctx.set( field.id, input.checked ) );
		const text = trusted( 'label', ctx.text( props.html as Record<string, string> ) + marker, { for: id } );
		const el = h( 'div', { class: `ffx-field ffx-contact-${ field.type }` }, h( 'div', { class: 'ffx-consent' }, input, text ), error );
		return { field, el, error, focus: input };
	}

	if ( field.type === 'captcha' ) {
		const box = h( 'div', { class: 'ffx-captcha-box' } );
		const el = h( 'div', { class: 'ffx-field ffx-contact-captcha' }, box, error );
		const provider: Provider = typeof props.provider === 'string' && props.provider in CAPTCHA ? props.provider as Provider : 'recaptcha';
		let api: CaptchaApi | undefined;
		let widget: unknown;
		ctx.set( field.id, '' );
		if ( typeof props.siteKey === 'string' && props.siteKey ) {
			const load = (): void => void loadCaptcha( provider, props.src ).then( ( loaded ) => {
				api = loaded;
				widget = loaded.render( box, {
					sitekey: props.siteKey,
					callback: ( token: string ) => ctx.set( field.id, token ),
					'expired-callback': () => ctx.set( field.id, '' ),
				} );
			}, () => {
				error.textContent = ctx.t( 'captcha_failed' );
				error.hidden = false;
			} );
			const ask = loadWithConsent( ctx.t( 'load_captcha' ).replace( '%s', CAPTCHA[ provider ].by ), load, box );
			if ( ask ) {
				box.replaceWith( ask );
			}
		}
		const reset = (): void => {
			ctx.set( field.id, '' );
			if ( widget !== undefined ) {
				api?.reset( widget );
			}
		};
		return { field, el, error, focus: null, reset };
	}

	if ( field.type === 'salutation' ) {
		const allow = ( props.allow ?? {} ) as Record<string, boolean>;
		const name = uniqueId( 'salutation' );
		const group = h( 'div', { class: 'ffx-salutations' } );
		for ( const option of SALUTATIONS ) {
			if ( allow[ option ] === false ) {
				continue;
			}
			const id = uniqueId( 'input' );
			const input = h( 'input', { id, type: 'radio', name, value: option, checked: ctx.get( field.id ) === option, required: field.required } );
			input.addEventListener( 'change', () => ctx.set( field.id, option ) );
			group.append( h( 'span', { class: 'ffx-salutation' }, input, h( 'label', { for: id }, ctx.t( `salutation_${ option }` ) ) ) );
		}
		const el = h(
			'fieldset',
			{ class: 'ffx-field ffx-contact-salutation', 'aria-describedby': errorId },
			label ? trusted( 'legend', label + marker + ( field.required ? `<span class="ffx-sr-only"> ${ escapeHtml( ctx.t( 'required_mark' ) ) }</span>` : '' ), { class: ctx.hideLabels ? 'ffx-label ffx-sr-only' : 'ffx-label' } ) : null,
			group,
			error
		);
		return { field, el, error, focus: group.querySelector( 'input' ) };
	}

	const id = uniqueId( 'input' );
	let placeholder = plain( ctx.text( props.placeholder as Record<string, string> | undefined ) );
	if ( ctx.hideLabels && ! placeholder ) {
		// The label moves into the input, so the field still says what it wants.
		placeholder = plain( label );
	}
	if ( field.required && ( ! label || ( ctx.hideLabels && placeholder ) ) ) {
		placeholder += ' *';
	}
	if ( label ) {
		label += marker;
	}
	const labelEl = label ? trusted( 'label', label, { class: ctx.hideLabels ? 'ffx-label ffx-sr-only' : 'ffx-label', for: id } ) : null;

	if ( field.type === 'select' ) {
		const options = Array.isArray( props.options ) ? ( props.options as Array<{ id: string; label?: Record<string, string> }> ) : [];
		const select = h(
			'select',
			{ id, class: 'ffx-input ffx-select', required: field.required, 'aria-label': label ? null : placeholder || field.key, 'aria-describedby': errorId },
			h( 'option', { value: '' }, placeholder || ctx.t( 'choose' ) ),
			...options.map( ( o ) => h( 'option', { value: o.id, selected: ctx.get( field.id ) === o.id }, plain( ctx.text( o.label ) ) ) )
		);
		select.addEventListener( 'change', () => ctx.set( field.id, select.value ) );
		const el = h( 'div', { class: 'ffx-field ffx-contact-select' }, labelEl, h( 'div', { class: 'ffx-input-wrap' }, select ), error );
		return { field, el, error, focus: select };
	}

	if ( field.type === 'textarea' ) {
		const area = h( 'textarea', {
			id,
			name: String( props.prefillFromQuery || field.key ),
			class: 'ffx-input ffx-textarea',
			rows: 4,
			placeholder: placeholder || null,
			required: field.required,
			maxlength: typeof props.maxLength === 'number' && props.maxLength > 0 ? props.maxLength : null,
			'aria-label': label ? null : placeholder || field.key,
			'aria-describedby': errorId,
		} );
		area.value = String( ctx.get( field.id ) ?? '' );
		area.addEventListener( 'input', () => ctx.set( field.id, area.value ) );
		const el = h( 'div', { class: 'ffx-field ffx-contact-textarea' }, labelEl, h( 'div', { class: 'ffx-input-wrap' }, area ), error );
		return { field, el, error, focus: area };
	}
	const mask = typeof props.mask === 'string' && maskSupported( props.mask ) ? props.mask : null;
	// Number inputs cannot hold the literals of a mask.
	const number = field.type === 'text' && props.inputType === 'number' && ! mask;
	const input = h( 'input', {
		id,
		name: String( props.prefillFromQuery || field.key ),
		type: field.type === 'email' ? 'email' : ( field.type === 'phone' ? 'tel' : ( number ? 'number' : 'text' ) ),
		class: 'ffx-input',
		placeholder: placeholder || null,
		autocomplete: AUTOCOMPLETE[ field.type ] ?? null,
		required: field.required,
		minlength: typeof props.minLength === 'number' ? props.minLength : null,
		maxlength: typeof props.maxLength === 'number' && props.maxLength > 0 ? props.maxLength : null,
		'aria-label': label ? null : placeholder || field.key,
		'aria-describedby': errorId,
	} );
	input.value = String( ctx.get( field.id ) ?? '' );
	if ( mask ) {
		input.placeholder ||= mask.replace( /[9a*]/g, '_' );
	}
	input.addEventListener( 'input', () => {
		if ( mask ) {
			const masked = applyMask( mask, input.value );
			if ( masked !== input.value ) {
				input.value = masked;
			}
		}
		ctx.set( field.id, input.value );
	} );
	if ( field.type.startsWith( 'phone' ) ) {
		chunk().push( [ input, field, ctx ] );
	}
	const icon = inputIcon( props.icon, ctx );
	const el = h(
		'div',
		{ class: `ffx-field ffx-contact-${ field.type }` },
		labelEl,
		h( 'div', { class: icon ? 'ffx-input-wrap ffx-has-icon' : 'ffx-input-wrap' }, icon, input ),
		error
	);
	return { field, el, error, focus: input };
}

/** Icon in an input: a Lucide icon ("lucide:<name>"), or classes of the icon font of 3.x forms. */
function inputIcon( value: unknown, ctx: ContactContext ): HTMLElement | null {
	if ( typeof value !== 'string' || ! value ) {
		return null;
	}
	if ( value.startsWith( 'lucide:' ) ) {
		return lucideIcon( ctx.icons, value.slice( 7 ), 'ffx-input-icon ffx-input-svg' );
	}
	return ctx.iconFont ? h( 'i', { class: `ffx-input-icon ${ value }`, 'aria-hidden': 'true' } ) : null;
}
