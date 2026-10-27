import { Api, type ErrorBody } from './api';
import { h, uniqueId } from './dom';
import type { LockedConfig, RuntimeConfig } from './types';

/**
 * Password prompt of a protected form. The plugin sends the form's content only for the right
 * password, together with the key the form then sends with every request.
 */
export function showLock( root: HTMLElement, config: LockedConfig, open: ( config: RuntimeConfig ) => void ): void {
	const t = ( key: string ): string => config.strings[ key ] ?? key;
	const id = uniqueId( 'password' );
	const input = h( 'input', { id, type: 'password', class: 'ffx-input', autocomplete: 'off', required: true } );
	const error = h( 'p', { class: 'ffx-error', role: 'alert', hidden: true } );
	const button = h( 'button', { type: 'submit', class: 'ffx-button ffx-button-primary' }, t( 'unlock' ) );
	const form = h(
		'form',
		{ class: 'ffx-lock', novalidate: true },
		h( 'p', { class: 'ffx-question' }, t( 'password_intro' ) ),
		h( 'div', { class: 'ffx-field' }, h( 'label', { class: 'ffx-label', for: id }, t( 'password' ) ), input ),
		error,
		h( 'div', { class: 'ffx-nav' }, button )
	);
	// A form for members sends the key of the signed-in visitor along.
	const api = new Api( config.endpoint, config.unlock );
	form.addEventListener( 'submit', ( event ) => {
		event.preventDefault();
		if ( input.value === '' || button.disabled ) {
			input.focus();
			return;
		}
		button.disabled = true;
		error.hidden = true;
		api.unlockWith<{ ok: true; config: RuntimeConfig }>( input.value )
			.then( ( result ) => {
				if ( result.data.ok ) {
					open( result.data.config );
					return;
				}
				const code = ( result.data as ErrorBody ).code;
				error.textContent = [ 'wrong_password', 'rate_limited', 'form_closed', 'embed_not_allowed' ].includes( code ) ? t( code ) : t( 'error' ).replace( '%s', code );
				error.hidden = false;
				input.select();
			} )
			.catch( () => {
				error.textContent = t( 'error' ).replace( '%s', 'network' );
				error.hidden = false;
			} )
			.finally( () => {
				button.disabled = false;
			} );
	} );
	root.replaceChildren( h( 'div', { class: 'ffx-shell' }, h( 'div', { class: 'ffx-card' }, form ) ) );
	root.classList.add( 'ffx-ready' );
}
