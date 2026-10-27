/**
 * Reminders to visitors who leave (settings.abandonment, Funnelforms Pro), loaded as
 * runtime-abandon.js only for forms that send them (data-ffx-chunks, Frontend\Renderer::chunks()).
 *
 * Once the e-mail field of the contact step holds a valid address (and, with basis "consent", the
 * box is ticked), the address, name and salutation go to POST abandon with the answers so far: when
 * a field is left (debounced) and when the page is hidden (keepalive). Only changes are sent. With
 * basis "notice" a notice under the field says so and offers "Don't remind me", which withdraws
 * what was sent. After the form was sent nothing more goes out; the plugin completes the entry.
 *
 * The chunk gets the running FormApp from the core through the hub (chunks/hub.ts) and works with
 * the members named in App.
 */
import type { Abandonment, ContactField } from '@funnelforms/form-schema';
import { h, trusted, uniqueId } from '../dom';
import type { Api } from '../api';
import type { RenderedContactField } from '../contact';
import type { PageInfo } from '../summary';
import type { RuntimeConfig } from '../types';
import { take } from './hub';

type Settings = Pick<Abandonment, 'field' | 'basis' | 'consentField'> & { notice?: Record<string, string> };

/** What the chunk uses of FormApp; private there, plain properties at run time. */
export interface App {
	root: HTMLElement;
	config: RuntimeConfig;
	page: PageInfo;
	contact: Record<string, unknown>;
	current: string;
	draft: string;
	variants: Record<string, string>;
	partial: Promise<void>;
	renderedContact: RenderedContactField[];
	api: Api;
	pathAnswers(): Record<string, unknown>;
	text( value: Record<string, string> | undefined ): string;
	t( key: string ): string;
}

/** Name of the chunk in data-ffx-chunks. */
export const NAME = 'abandon';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DELAY_MS = 800;

/** Calls POST abandon with the token of the form; the token is checked, not used up. */
async function post( api: Api, body: Record<string, unknown>, keepalive: boolean ): Promise<string | null> {
	const client = api as unknown as {
		prepare(): void;
		tokenPromise: Promise<string> | null;
		post<T>( path: string, body: Record<string, unknown>, keepalive?: boolean ): Promise<{ status: number; data: T }>;
	};
	client.prepare();
	const token = await client.tokenPromise;
	const result = await client.post<{ draft?: string }>( '/abandon', { ...body, token }, keepalive );
	return typeof result.data.draft === 'string' ? result.data.draft : null;
}

/** Starts the capture for one form. */
export function start( app: App ): void {
	const settings = app.config.document.settings.abandonment as Settings | undefined;
	if ( ! settings || app.config.preview ) {
		return;
	}
	let sent = '';
	let done = false;
	let optedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** The request body, or null while there is nothing to keep. */
	const payload = (): Record<string, unknown> | null => {
		const email = app.contact[ settings.field ];
		if ( done || optedOut || typeof email !== 'string' || ! EMAIL.test( email.trim() ) ) {
			return null;
		}
		if ( settings.basis !== 'notice' && app.contact[ settings.consentField ?? '' ] !== true ) {
			return null;
		}
		const fields = app.config.document.nodes.flatMap( ( n ) => ( n.type === 'contact' ? n.fields : [] ) as ContactField[] );
		const contact: Record<string, unknown> = {};
		for ( const field of fields ) {
			if ( field.id === settings.field || field.id === settings.consentField || field.type === 'name' || field.type === 'salutation' ) {
				if ( app.contact[ field.id ] !== undefined ) {
					contact[ field.id ] = app.contact[ field.id ];
				}
			}
		}
		return { contact, answers: app.pathAnswers(), node: app.current, page: app.page, locale: app.config.locale, variants: app.variants };
	};

	/** Sends what changed; chained to the incomplete-entry saves, so submit waits for the draft. */
	const send = ( keepalive = false ): void => {
		clearTimeout( timer );
		const body = payload();
		const key = JSON.stringify( body );
		if ( ! body || key === sent ) {
			return;
		}
		sent = key;
		const call = (): Promise<void> => post( app.api, { ...body, draft: app.draft }, keepalive ).then( ( draft ) => {
			app.draft ||= draft ?? '';
		}, () => {
			sent = '';
		} );
		if ( keepalive ) {
			// The page is going: no waiting for earlier saves.
			void call();
		} else {
			app.partial = app.partial.then( call );
		}
	};
	const later = (): void => {
		clearTimeout( timer );
		timer = setTimeout( send, DELAY_MS );
	};

	app.root.addEventListener( 'focusout', later );
	app.root.addEventListener( 'change', later );
	app.root.addEventListener( 'ffx:sent', () => {
		done = true;
		clearTimeout( timer );
	} );
	document.addEventListener( 'visibilitychange', () => {
		if ( document.visibilityState === 'hidden' ) {
			send( true );
		}
	} );
	window.addEventListener( 'pagehide', () => send( true ) );

	if ( settings.basis !== 'notice' ) {
		return;
	}
	// The notice under the e-mail field, whenever the contact step is shown.
	const notice = (): void => {
		const r = app.renderedContact.find( ( c ) => c.field.id === settings.field );
		if ( ! r || r.el.querySelector( '.ffx-abandon-notice' ) ) {
			return;
		}
		const id = uniqueId( 'abandon' );
		const box = h( 'p', { class: 'ffx-abandon-notice', id, 'aria-live': 'polite' } );
		if ( optedOut ) {
			box.append( app.t( 'abandon_off' ) );
		} else {
			const optout = h( 'button', { type: 'button', class: 'ffx-abandon-optout' }, app.t( 'abandon_optout' ) );
			optout.addEventListener( 'click', () => {
				optedOut = true;
				clearTimeout( timer );
				box.replaceChildren( app.t( 'abandon_off' ) );
				if ( sent && app.draft ) {
					// Withdraws what was sent already.
					void post( app.api, { draft: app.draft, stop: true }, false ).catch( () => undefined );
				}
			} );
			box.append( trusted( 'span', app.text( settings.notice ) || app.t( 'abandon_notice' ) ), ' ', optout );
		}
		r.el.append( box );
		const input = r.focus;
		if ( input ) {
			input.setAttribute( 'aria-describedby', [ input.getAttribute( 'aria-describedby' ), id ].filter( Boolean ).join( ' ' ) );
		}
	};
	notice();
	new MutationObserver( notice ).observe( app.root, { childList: true, subtree: true } );
}

const started = new WeakSet<object>();

// The core hands the form over with its first step and answers (FormApp.live(), chunks/hub.ts).
if ( typeof window !== 'undefined' ) {
	take( NAME, ( app ) => {
		if ( ! started.has( app ) ) {
			started.add( app );
			start( app as unknown as App );
		}
	} );
}
