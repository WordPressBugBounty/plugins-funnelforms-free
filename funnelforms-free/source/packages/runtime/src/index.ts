import { FormApp } from './app';
import { showLock } from './lock';
import { setupPopup } from './popup';
import { addPart } from './styles';
import type { LockedConfig, RuntimeConfig } from './types';

/** Starts one rendered form: the password prompt of a protected form, or the form. */
function start( root: HTMLElement, apps: FormApp[] ): void {
	const data = root.querySelector( 'script.ffx-form-data' );
	if ( ! data ) {
		// A closed form shows only its message.
		root.classList.add( 'ffx-ready' );
		return;
	}
	try {
		const config = JSON.parse( data.textContent ?? '' ) as RuntimeConfig | LockedConfig;
		const page = {
			url: window.location.href,
			query: window.location.search.replace( /^\?/, '' ),
			title: document.title,
		};
		if ( 'locked' in config ) {
			// Password first; the form starts with the configuration the plugin answers.
			showLock( root, config, ( unlocked ) => new FormApp( root, unlocked, page ) );
			return;
		}
		apps.push( new FormApp( root, config, page ) );
	} catch ( error ) {
		// One broken form must not stop the others.
		root.classList.add( 'ffx-failed' );
		console.error( 'Funnelforms: form could not start', error );
	}
}

/** Starts every form the plugin rendered (Frontend\Renderer) that is not running yet. */
export function mountAll( scope: ParentNode = document ): FormApp[] {
	const apps: FormApp[] = [];
	scope.querySelectorAll<HTMLElement>( '.ffx-form[data-ffx-form]:not(.ffx-ready):not(.ffx-failed)' ).forEach( ( root ) => {
		if ( root.hasAttribute( 'data-ffx-more' ) ) {
			addPart( 'more', 'css' );
		}
		// Scripts of features the form has (Frontend\Renderer::chunks()): runtime-<name>.js.
		root.dataset.ffxChunks?.split( ' ' ).forEach( ( name ) => addPart( name, 'js' ) );
		if ( root.dataset.ffxPopup ) {
			setupPopup( root, ( form ) => start( form, [] ) );
			return;
		}
		start( root, apps );
	} );
	return apps;
}

if ( typeof document !== 'undefined' ) {
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', () => mountAll() );
	} else {
		mountAll();
	}
	// The 3.x embed code for other websites loads the forms after the runtime and then reports
	// af2_all_forms_loaded on the body (not bubbling, so listened to while capturing).
	document.addEventListener( 'af2_all_forms_loaded', () => mountAll(), true );
	// Forms loaded later (page builders, AJAX) can start with window.funnelforms.mount().
	( window as unknown as { funnelforms?: { mount: typeof mountAll } } ).funnelforms = { mount: mountAll };
}
