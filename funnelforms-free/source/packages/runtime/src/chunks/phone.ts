/**
 * Chunk runtime-phone.js: phone fields with a country picker, and confirming a number by text
 * message (Funnelforms Pro). The core loads it for forms that need it (data-ffx-chunks, styles.ts)
 * and hands over the inputs of phone fields through window.ffxChunk; until it arrives they are
 * plain inputs. Values are E.164 (+4915112345678); check() mirrors Domain\Form\PhoneNumbers.
 *
 * The picker follows the combobox pattern of WAI-ARIA 1.2: a button opens a panel with a search
 * box (role combobox) that controls a listbox; arrows move through the countries, Enter picks,
 * Escape closes and returns to the button.
 */
import type { ContactField, PhoneCountries, PhoneField } from '@funnelforms/form-schema';
import { h, uniqueId } from '../dom';
import { checkPhone, COUNTRIES, country, e164, flag, formatInternational, formatTyped, parsePhone, startCountry } from '../phone';
import type { RuntimeConfig } from '../types';

interface Ctx {
	t( key: string ): string;
	get( fieldId: string ): unknown;
	set( fieldId: string, value: unknown ): void;
}

type AnyField = PhoneField | ContactField;
type Item = [ HTMLInputElement, AnyField, Ctx ];

interface Props {
	placeholder?: unknown;
	country?: PhoneCountries;
	/** Public document: the number is confirmed by text message (props.sms stays on the server). */
	verify?: string;
}

const props = ( field: AnyField ): Props => field.props as Props;

/** Whether the field asks for a confirmation by text message (always for the 3.x type). */
const verifies = ( field: AnyField ): boolean => props( field ).verify === 'sms' || field.type === 'phone_verification';

/** Fields this chunk takes over: with a country picker, or confirmed by text message. */
export const managed = ( field: AnyField ): boolean => Boolean( props( field ).country ) || verifies( field );

/** Countries a field accepts; empty for all. */
const allowedOf = ( field: AnyField ): string[] => ( props( field ).country?.allowed ?? [] ).filter( ( iso ) => COUNTRIES[ iso ] );

/** Numbers confirmed by text message, by field id: the number and the proof the plugin signed. */
const confirmed = new Map<string, { number: string; proof: string }>();

/**
 * Checks the value of a field: '' when it fits, an error code otherwise, undefined for fields the
 * core checks itself. Empty values are the core's business (required).
 */
export function check( field: AnyField, value: unknown ): string | undefined {
	if ( ! managed( field ) ) {
		return undefined;
	}
	const text = typeof value === 'string' ? value.trim() : '';
	return numberError( field, text ) || ( verifies( field ) && confirmed.get( field.id )?.number !== text ? 'phone_not_confirmed' : '' );
}

/** The error of a number in E.164 for a field, '' when it fits. */
function numberError( field: AnyField, text: string ): string {
	const number = text.startsWith( '+' ) ? parsePhone( text, '' ) : null;
	return number ? checkPhone( number, allowedOf( field ) ) : 'invalid_phone';
}

/** Windows shows the letters of flag emoji, so it gets the country code instead. */
const emojiFlags = typeof navigator === 'undefined' || ! /Windows/.test( navigator.userAgent );

/** Name of a country in the form's language, with English for the search. */
function namer( locale: string ): ( iso: string ) => string {
	let names: Intl.DisplayNames | null = null;
	try {
		names = new Intl.DisplayNames( [ locale.replace( /_formal$/, '' ).replace( '_', '-' ), 'en' ], { type: 'region' } );
	} catch {
		names = null;
	}
	return ( iso ) => names?.of( iso ) ?? iso;
}

let english: ( ( iso: string ) => string ) | null = null;

/** Lower case without accents, for the search. */
const fold = ( text: string ): string => text.normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).toLowerCase();

function flagEl( iso: string ): HTMLElement {
	return emojiFlags ? h( 'span', { class: 'ffx-phone-flag', 'aria-hidden': 'true' }, flag( iso ) ) : h( 'span', { class: 'ffx-phone-flag ffx-phone-iso', 'aria-hidden': 'true' }, iso );
}

/** Puts the caret after the same number of digits as before formatting. */
function caretAfterDigits( input: HTMLInputElement, digits: number ): void {
	let at = 0;
	let seen = 0;
	while ( at < input.value.length && seen < digits ) {
		if ( /\d/.test( input.value[ at ] ?? '' ) ) {
			seen++;
		}
		at++;
	}
	try {
		input.setSelectionRange( at, at );
	} catch {
		// Inputs of type tel take a selection; others might not.
	}
}

/** Takes over one phone input once it is in the page. */
export function enhance( input: HTMLInputElement, field: AnyField, ctx: Ctx ): void {
	if ( ! managed( field ) || input.dataset.ffxPhone ) {
		return;
	}
	input.dataset.ffxPhone = '1';
	const root = input.closest( '.ffx-form' ) as ( HTMLElement & { ffx?: RuntimeConfig } ) | null;
	const config = root?.ffx;
	const locale = config?.locale ?? document.documentElement.lang ?? 'en';
	const own = props( field ).country ?? {};
	const allowed = allowedOf( field );
	const preferred = ( own.preferred ?? [] ).filter( ( iso ) => COUNTRIES[ iso ] && ( ! allowed.length || allowed.includes( iso ) ) );
	const name = namer( locale );
	english ??= namer( 'en' );
	let iso = startCountry( own.default, locale, allowed );
	const ownPlaceholder = input.placeholder;

	const current = String( ctx.get( field.id ) ?? '' );
	if ( current ) {
		const number = parsePhone( current, iso );
		if ( number && ( ! allowed.length || allowed.includes( number.country ) ) ) {
			iso = number.country;
			input.value = formatTyped( iso, number.national );
		}
	}
	input.type = 'tel';
	input.inputMode = 'tel';
	input.autocomplete = 'tel';

	const box = h( 'div', { class: 'ffx-phone' } );
	const toggle = h( 'button', { type: 'button', class: 'ffx-phone-country', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' } );
	const single = allowed.length === 1;
	const prefix = single ? h( 'span', { class: 'ffx-phone-country is-static' } ) : toggle;
	input.before( box );
	box.append( prefix, input );
	box.closest( '.ffx-input-wrap' )?.classList.add( 'ffx-has-phone' );

	const showCountry = (): void => {
		const c = country( iso );
		prefix.replaceChildren( flagEl( iso ), h( 'span', { class: 'ffx-phone-code', 'aria-hidden': 'true' }, `+${ c?.code ?? '' }` ) );
		const label = ctx.t( 'phone_country' ).replace( '%s', `${ name( iso ) } +${ c?.code ?? '' }` );
		if ( single ) {
			prefix.append( h( 'span', { class: 'ffx-sr-only' }, label ) );
		} else {
			toggle.setAttribute( 'aria-label', label );
		}
		input.placeholder = ownPlaceholder || formatTyped( iso, c?.example ?? '' );
	};

	/** Formats what was typed and stores the number: E.164 once there are national digits. */
	const update = (): void => {
		const raw = input.value;
		const caret = input.selectionStart ?? raw.length;
		const before = raw.slice( 0, caret ).replace( /\D/g, '' ).length;
		const international = /^\s*(\+|00)/.test( raw );
		const number = parsePhone( raw, iso );
		let value = '';
		if ( number && number.national ) {
			if ( number.country !== iso && ( ! allowed.length || allowed.includes( number.country ) ) ) {
				iso = number.country;
				showCountry();
			}
			const shown = international ? formatTyped( number.country, number.national ) : formatTyped( iso, raw );
			if ( shown !== raw ) {
				input.value = shown;
				// Pasted or autofilled international numbers lose the calling code, which the button shows.
				caretAfterDigits( input, international ? number.national.length : before );
			}
			value = e164( { country: number.country, national: number.national } );
		} else if ( international ) {
			// "+49" alone: the country follows once the number goes on.
			if ( number && number.country !== iso && ( ! allowed.length || allowed.includes( number.country ) ) ) {
				iso = number.country;
				showCountry();
			}
			value = raw.trim() === '' ? '' : raw.trim();
		} else if ( raw.replace( /\D/g, '' ) === '' && raw !== '' ) {
			input.value = '';
		}
		ctx.set( field.id, value );
		otp?.changed( value );
	};

	/** Another country: the typed digits stay and are read for it. */
	const choose = ( next: string ): void => {
		iso = next;
		showCountry();
		const digits = input.value.replace( /^\s*(\+|00)\d{0,3}/, '' );
		input.value = formatTyped( iso, digits );
		update();
	};

	showCountry();
	const otp = verifies( field ) ? verification( input, field, ctx, config ) : null;
	input.addEventListener( 'input', update );
	if ( input.value ) {
		update();
	}
	if ( ! single ) {
		picker( toggle, box, { name, preferred, allowed, current: () => iso, choose, t: ( k ) => ctx.t( k ), focus: () => input.focus() } );
	}
}

interface PickerOptions {
	name( iso: string ): string;
	preferred: string[];
	allowed: string[];
	current(): string;
	choose( iso: string ): void;
	t( key: string ): string;
	focus(): void;
}

/** The panel with the search and the list of countries. */
function picker( toggle: HTMLButtonElement, box: HTMLElement, o: PickerOptions ): void {
	const listId = uniqueId( 'countries' );
	const search = h( 'input', {
		type: 'text',
		class: 'ffx-input ffx-phone-search',
		role: 'combobox',
		'aria-expanded': 'true',
		'aria-controls': listId,
		'aria-autocomplete': 'list',
		'aria-label': o.t( 'phone_search' ),
		placeholder: o.t( 'phone_search' ),
		autocomplete: 'off',
		spellcheck: 'false',
	} );
	const list = h( 'ul', { class: 'ffx-phone-list', role: 'listbox', id: listId, 'aria-label': o.t( 'phone_countries' ) } );
	const status = h( 'p', { class: 'ffx-sr-only', role: 'status' } );
	const panel = h( 'div', { class: 'ffx-phone-panel', hidden: true }, search, list, status );
	box.append( panel );
	let options: HTMLElement[] = [];
	let active = -1;
	const all = Object.keys( COUNTRIES ).filter( ( iso ) => ! o.allowed.length || o.allowed.includes( iso ) );

	const option = ( iso: string ): HTMLElement => {
		const c = country( iso );
		const li = h( 'li', { class: 'ffx-phone-option', role: 'option', id: uniqueId( 'country' ), 'data-iso': iso, 'aria-selected': String( iso === o.current() ) },
			flagEl( iso ),
			h( 'span', { class: 'ffx-phone-name' }, o.name( iso ) ),
			h( 'span', { class: 'ffx-phone-code' }, `+${ c?.code ?? '' }` )
		);
		// The search keeps the focus; a click picks.
		li.addEventListener( 'mousedown', ( e ) => e.preventDefault() );
		li.addEventListener( 'click', () => pick( iso ) );
		return li;
	};

	const setActive = ( index: number ): void => {
		options[ active ]?.classList.remove( 'is-active' );
		active = options.length ? ( index + options.length ) % options.length : -1;
		const el = options[ active ];
		if ( el ) {
			el.classList.add( 'is-active' );
			search.setAttribute( 'aria-activedescendant', el.id );
			el.scrollIntoView?.( { block: 'nearest' } );
		} else {
			search.removeAttribute( 'aria-activedescendant' );
		}
	};

	const render = (): void => {
		const query = fold( search.value.trim() );
		const digits = query.replace( /^\+/, '' );
		const collator = new Intl.Collator( undefined, { sensitivity: 'base' } );
		let isos: string[];
		if ( query ) {
			const scored = all.map( ( iso ): [ string, number ] => {
				const names = [ fold( o.name( iso ) ), fold( english?.( iso ) ?? '' ) ];
				const code = country( iso )?.code ?? '';
				let score = 0;
				if ( names.some( ( n ) => n.startsWith( query ) ) || iso.toLowerCase() === query ) {
					score = 3;
				} else if ( /^\d+$/.test( digits ) && code.startsWith( digits ) ) {
					score = code === digits ? 3 : 2;
				} else if ( names.some( ( n ) => n.includes( query ) ) ) {
					score = 1;
				}
				return [ iso, score ];
			} ).filter( ( [ , score ] ) => score > 0 );
			scored.sort( ( a, b ) => b[ 1 ] - a[ 1 ] || collator.compare( o.name( a[ 0 ] ), o.name( b[ 0 ] ) ) );
			isos = scored.map( ( [ iso ] ) => iso );
		} else {
			isos = [ ...all ].sort( ( a, b ) => collator.compare( o.name( a ), o.name( b ) ) );
		}
		const top = query ? [] : o.preferred;
		options = [ ...top, ...isos ].map( option );
		list.replaceChildren( ...options.slice( 0, top.length ), ...( top.length ? [ h( 'li', { class: 'ffx-phone-sep', role: 'separator' } ) ] : [] ), ...options.slice( top.length ) );
		if ( ! options.length ) {
			list.append( h( 'li', { class: 'ffx-phone-empty', role: 'presentation' }, o.t( 'no_matches' ) ) );
		}
		status.textContent = query ? o.t( 'phone_results' ).replace( '%d', String( options.length ) ) : '';
		const selected = options.findIndex( ( el ) => el.dataset.iso === o.current() );
		setActive( query ? 0 : Math.max( 0, selected ) );
	};

	const open = (): void => {
		if ( ! panel.hidden ) {
			return;
		}
		panel.hidden = false;
		toggle.setAttribute( 'aria-expanded', 'true' );
		box.classList.add( 'is-open' );
		search.value = '';
		render();
		search.focus();
		document.addEventListener( 'pointerdown', outside, true );
	};

	const close = ( focusToggle: boolean ): void => {
		if ( panel.hidden ) {
			return;
		}
		panel.hidden = true;
		toggle.setAttribute( 'aria-expanded', 'false' );
		box.classList.remove( 'is-open' );
		document.removeEventListener( 'pointerdown', outside, true );
		if ( focusToggle ) {
			toggle.focus();
		}
	};

	const pick = ( iso: string ): void => {
		close( false );
		o.choose( iso );
		o.focus();
	};

	function outside( e: Event ): void {
		if ( ! panel.contains( e.target as Node ) && ! toggle.contains( e.target as Node ) ) {
			close( false );
		}
	}

	toggle.addEventListener( 'click', () => ( panel.hidden ? open() : close( true ) ) );
	toggle.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
			e.preventDefault();
			open();
		}
	} );
	search.addEventListener( 'input', render );
	search.addEventListener( 'keydown', ( e ) => {
		const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
		if ( e.key in moves ) {
			e.preventDefault();
			const step = moves[ e.key ] ?? 0;
			setActive( Math.abs( step ) > 1 ? Math.min( options.length - 1, Math.max( 0, active + step ) ) : active + step );
		} else if ( e.key === 'Enter' ) {
			// Enter picks and never sends the contact step.
			e.preventDefault();
			const iso = options[ active ]?.dataset.iso;
			if ( iso ) {
				pick( iso );
			}
		} else if ( e.key === 'Escape' ) {
			e.preventDefault();
			e.stopPropagation();
			close( true );
		} else if ( e.key === 'Tab' ) {
			close( false );
		}
	} );
}

interface Otp {
	/** The number changed: a confirmation of another number no longer counts. */
	changed( value: string ): void;
}

/** Seconds before another code can be asked for (PhoneVerification::RESEND_AFTER). */
const RESEND_AFTER = 30;

/**
 * Confirming the number by text message: send a code, enter it, send a new one after a while,
 * change the number. In the builder's preview nothing is sent and any six digits confirm.
 */
function verification( input: HTMLInputElement, field: AnyField, ctx: Ctx, config: RuntimeConfig | undefined ): Otp {
	const t = ( key: string ): string => ctx.t( key );
	const proofKey = `${ field.id }:proof`;
	const codeId = uniqueId( 'code' );
	const send = h( 'button', { type: 'button', class: 'ffx-button ffx-otp-send' }, t( 'sms_send' ) );
	const code = h( 'input', { id: codeId, class: 'ffx-input ffx-otp-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*', enterkeyhint: 'done' } );
	const confirm = h( 'button', { type: 'button', class: 'ffx-button ffx-button-primary ffx-otp-confirm' }, t( 'sms_confirm' ) );
	const resend = h( 'button', { type: 'button', class: 'ffx-otp-link' }, t( 'sms_resend' ) );
	const change = h( 'button', { type: 'button', class: 'ffx-otp-link' }, t( 'sms_change' ) );
	const entry = h( 'div', { class: 'ffx-otp-entry', hidden: true },
		h( 'label', { class: 'ffx-otp-label', for: codeId }, t( 'sms_code' ) ),
		h( 'div', { class: 'ffx-otp-row' }, code, confirm ),
		h( 'div', { class: 'ffx-otp-actions' }, resend, change )
	);
	const status = h( 'p', { class: 'ffx-otp-status', role: 'status' } );
	const note = h( 'p', { class: 'ffx-otp-note' }, t( config?.preview ? 'sms_preview' : 'sms_notice' ) );
	const box = h( 'div', { class: 'ffx-otp' }, note, send, entry, status );
	( input.closest( '.ffx-field' ) ?? input.parentElement )?.append( box );

	let sentTo = '';
	let timer: ReturnType<typeof setInterval> | undefined;
	let busy = false;

	const say = ( text: string, tone: '' | 'error' | 'done' = '' ): void => {
		status.textContent = text;
		status.className = `ffx-otp-status${ tone ? ` is-${ tone }` : '' }`;
	};
	const number = (): string => String( ctx.get( field.id ) ?? '' );
	const shown = ( value: string ): string => {
		const parsed = parsePhone( value, '' );
		return parsed ? formatInternational( parsed ) : value;
	};

	const countdown = (): void => {
		let left = RESEND_AFTER;
		resend.disabled = true;
		clearInterval( timer );
		const tick = (): void => {
			resend.textContent = left > 0 ? t( 'sms_resend_in' ).replace( '%d', String( left ) ) : t( 'sms_resend' );
			if ( left <= 0 ) {
				resend.disabled = false;
				clearInterval( timer );
			}
			left--;
		};
		tick();
		timer = setInterval( tick, 1000 );
	};

	const post = async ( path: string, body: Record<string, unknown> ): Promise<{ ok?: boolean; code?: string; proof?: string }> => {
		const request = ( route: string, data: Record<string, unknown> ): Promise<Response> => fetch( `${ config?.endpoint ?? '' }${ route }`, {
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify( config?.unlock ? { ...data, unlock: config.unlock } : data ),
			credentials: 'omit',
		} );
		const token = ( await ( await request( '/token', {} ) ).json() as { token?: string; code?: string } );
		if ( ! token.token ) {
			return { ok: false, code: token.code ?? 'network' };
		}
		return ( await request( path, { ...body, token: token.token, field: field.id } ) ).json();
	};

	const done = ( value: string, proof: string ): void => {
		confirmed.set( field.id, { number: value, proof } );
		ctx.set( proofKey, proof );
		// Setting the number again clears the field's error.
		ctx.set( field.id, value );
		entry.hidden = true;
		send.hidden = true;
		note.hidden = true;
		box.classList.add( 'is-confirmed' );
		say( t( 'sms_confirmed' ), 'done' );
		clearInterval( timer );
	};

	const start = async (): Promise<void> => {
		const value = number();
		const error = value ? numberError( field, value ) : 'required';
		if ( error ) {
			say( t( error ), 'error' );
			input.focus();
			return;
		}
		if ( busy ) {
			return;
		}
		busy = true;
		send.disabled = true;
		resend.disabled = true;
		try {
			const result = config?.preview ? { ok: true } : await post( '/phone/send', { number: value, locale: config?.locale ?? '' } );
			if ( ! result.ok ) {
				say( t( /^(rate_limited|sms_unavailable|invalid_phone|phone_\w+)$/.test( result.code ?? '' ) ? result.code as string : 'sms_failed' ), 'error' );
				resend.disabled = false;
				return;
			}
			sentTo = value;
			entry.hidden = false;
			send.hidden = true;
			code.value = '';
			say( t( 'sms_sent' ).replace( '%s', shown( value ) ) );
			countdown();
			code.focus();
		} catch {
			say( t( 'sms_failed' ), 'error' );
			resend.disabled = false;
		} finally {
			busy = false;
			send.disabled = false;
		}
	};

	const verify = async (): Promise<void> => {
		const digits = code.value.replace( /\D/g, '' );
		if ( digits.length !== 6 ) {
			say( t( 'code_invalid' ), 'error' );
			code.focus();
			return;
		}
		if ( busy ) {
			return;
		}
		busy = true;
		confirm.disabled = true;
		try {
			const result = config?.preview ? { ok: true, proof: 'preview' } : await post( '/phone/confirm', { number: sentTo, code: digits } );
			if ( result.ok && result.proof && sentTo === number() ) {
				done( sentTo, result.proof );
				return;
			}
			say( t( result.code === 'rate_limited' ? 'rate_limited' : 'code_invalid' ), 'error' );
			code.select();
		} catch {
			say( t( 'sms_failed' ), 'error' );
		} finally {
			busy = false;
			confirm.disabled = false;
		}
	};

	send.addEventListener( 'click', () => void start() );
	resend.addEventListener( 'click', () => void start() );
	confirm.addEventListener( 'click', () => void verify() );
	change.addEventListener( 'click', () => {
		entry.hidden = true;
		send.hidden = false;
		say( '' );
		clearInterval( timer );
		input.focus();
		input.select();
	} );
	code.addEventListener( 'input', () => {
		code.value = code.value.replace( /\D/g, '' ).slice( 0, 6 );
		if ( code.value.length === 6 ) {
			void verify();
		}
	} );
	code.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'Enter' ) {
			// Enter confirms the code instead of sending the contact step.
			e.preventDefault();
			void verify();
		}
	} );

	const previous = confirmed.get( field.id );
	if ( previous && previous.number === number() ) {
		done( previous.number, previous.proof );
	}

	return {
		changed( value: string ): void {
			const was = confirmed.get( field.id );
			if ( was && was.number !== value ) {
				confirmed.delete( field.id );
				ctx.set( proofKey, '' );
				box.classList.remove( 'is-confirmed' );
				send.hidden = false;
				note.hidden = false;
				say( '' );
			}
			if ( sentTo && value !== sentTo && ! entry.hidden ) {
				entry.hidden = true;
				send.hidden = false;
				clearInterval( timer );
				say( '' );
			}
		},
	};
}

/** Takes the inputs the core pushed before the chunk arrived and those it pushes later. */
function takeOver(): void {
	const win = window as unknown as { ffxChunk?: Item[] | { push( item: Item ): void; check: typeof check } };
	const queued = Array.isArray( win.ffxChunk ) ? win.ffxChunk : [];
	const take = ( [ input, field, ctx ]: Item ): void => {
		// The core puts the input into the page right after rendering the step.
		queueMicrotask( () => enhance( input, field, ctx ) );
	};
	win.ffxChunk = { push: take, check };
	queued.forEach( take );
}

if ( typeof window !== 'undefined' ) {
	takeOver();
}
