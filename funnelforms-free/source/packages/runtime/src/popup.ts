import { h } from './dom';

/** Popup modes the plugin renders (Frontend\Shortcode::popup()). */
type Mode = 'delay' | 'click' | 'scroll' | 'exit' | 'widget';

const WIDGET_POSITIONS = [ 'bottom-right', 'bottom-left', 'top-right', 'top-left' ];
const WIDGET_ANIMATIONS = [ 'pulse', 'bounce', 'shake' ];
const DAY = 24 * 3600 * 1000;

/** Until when popups that open by themselves stay closed for this visitor (local storage). */
function pausedUntil( uid: string ): number {
	try {
		return Number( window.localStorage.getItem( `ffx-popup-${ uid }` ) ) || 0;
	} catch {
		return 0;
	}
}

function pause( uid: string, ms: number ): void {
	if ( ms <= 0 ) {
		return;
	}
	try {
		window.localStorage.setItem( `ffx-popup-${ uid }`, String( Date.now() + ms ) );
	} catch {
		// Without storage the popup simply opens again on the next page.
	}
}

/** Share of the page scrolled, 0 to 100; 100 when the page does not scroll. */
function scrolled(): number {
	const room = document.documentElement.scrollHeight - window.innerHeight;
	return room <= 0 ? 100 : ( window.scrollY / room ) * 100;
}

/**
 * Exit intent: on a desktop the mouse leaves the page at the top (towards tabs and address bar);
 * on touch screens a quick scroll back up after reading on. Armed after a few seconds on the page.
 */
function onExitIntent( show: () => void ): void {
	const armedAt = Date.now() + 3000;
	let done = false;
	const fire = (): void => {
		if ( ! done && Date.now() >= armedAt ) {
			done = true;
			show();
		}
	};
	document.addEventListener( 'mouseout', ( event ) => {
		if ( ! event.relatedTarget && event.clientY <= 0 ) {
			fire();
		}
	} );
	let peak = window.scrollY;
	let peakAt = Date.now();
	window.addEventListener(
		'scroll',
		() => {
			const y = window.scrollY;
			if ( y >= peak ) {
				peak = y;
				peakAt = Date.now();
			} else if ( peak > window.innerHeight / 2 && peak - y > window.innerHeight / 4 && Date.now() - peakAt < 600 ) {
				fire();
			}
		},
		{ passive: true }
	);
}

/**
 * Popups: after a delay, on a click on elements with a CSS class (both as in 3.x), after the
 * visitor scrolled a share of the page, on exit intent, or from a button in a corner of the page.
 * The form starts fresh on every opening, and closing (button, Escape, a click beside it) discards
 * what was entered. Popups that open by themselves stay closed for `popup_pause` hours after the
 * visitor closed one, and for 30 days after an entry was sent.
 */
export function setupPopup( root: HTMLElement, start: ( form: HTMLElement ) => void ): void {
	const template = root.innerHTML;
	const data = root.dataset;
	const mode = ( data.ffxPopup ?? '' ) as Mode;
	const label = data.ffxPopupClose ?? 'Close';
	const uid = data.ffxForm ?? '';
	const automatic = 'delay' === mode || 'scroll' === mode || 'exit' === mode;
	const pauseMs = Math.max( 0, Number( data.ffxPopupPause ) || 0 ) * 3600 * 1000;
	let dialog: HTMLDialogElement | null = null;
	let sent = false;
	root.classList.add( 'ffx-ready' );

	const close = (): void => {
		if ( dialog ) {
			const open = dialog;
			dialog = null;
			if ( open.open ) {
				open.close();
			}
			open.remove();
			if ( automatic && ! sent ) {
				pause( uid, pauseMs );
			}
		}
	};

	const show = (): void => {
		if ( dialog ) {
			return;
		}
		const form = root.cloneNode( false ) as HTMLElement;
		form.removeAttribute( 'hidden' );
		for ( const name of [ ...form.attributes ].map( ( a ) => a.name ) ) {
			if ( name.startsWith( 'data-ffx-popup' ) || name.startsWith( 'data-ffx-widget' ) ) {
				form.removeAttribute( name );
			}
		}
		form.classList.remove( 'ffx-ready' );
		form.classList.add( 'ffx-in-popup' );
		form.innerHTML = template;
		form.addEventListener( 'ffx:sent', () => {
			sent = true;
			if ( automatic ) {
				pause( uid, 30 * DAY );
			}
		} );
		const button = h( 'button', { type: 'button', class: 'ffx-popup-close', 'aria-label': label }, '×' );
		button.addEventListener( 'click', close );
		dialog = h( 'dialog', { class: 'ffx-popup' }, button, form ) as HTMLDialogElement;
		// The form's colours, for the close button.
		dialog.setAttribute( 'style', root.getAttribute( 'style' ) ?? '' );
		// A click on the backdrop reaches the dialog itself.
		dialog.addEventListener( 'click', ( event ) => {
			if ( event.target === event.currentTarget ) {
				close();
			}
		} );
		dialog.addEventListener( 'close', close );
		document.body.append( dialog );
		if ( typeof dialog.showModal === 'function' ) {
			dialog.showModal();
		} else {
			dialog.setAttribute( 'open', '' );
		}
		start( form );
	};

	if ( automatic && pausedUntil( uid ) > Date.now() ) {
		return;
	}
	switch ( mode ) {
		case 'delay':
			setTimeout( show, Math.max( 0, Number( data.ffxPopupDelay ) || 0 ) );
			return;
		case 'scroll': {
			const share = Math.min( 100, Math.max( 1, Number( data.ffxPopupScroll ) || 50 ) );
			const check = (): void => {
				if ( scrolled() >= share - 0.5 ) {
					window.removeEventListener( 'scroll', check );
					show();
				}
			};
			window.addEventListener( 'scroll', check, { passive: true } );
			// A page shorter than the window cannot be scrolled; give it a moment, then open.
			setTimeout( check, 1000 );
			return;
		}
		case 'exit':
			onExitIntent( show );
			return;
		case 'widget':
			showWidget( root, data, show );
			return;
	}
	const selector = `.${ data.ffxPopupClick ?? '' }`;
	if ( selector === '.' ) {
		return;
	}
	document.addEventListener( 'click', ( event ) => {
		if ( event.target instanceof Element && event.target.closest( selector ) ) {
			show();
		}
	} );
}

/** The button in a corner of the page that opens the form. */
function showWidget( root: HTMLElement, data: DOMStringMap, show: () => void ): void {
	const position = WIDGET_POSITIONS.includes( data.ffxWidget ?? '' ) ? data.ffxWidget : 'bottom-right';
	const animation = WIDGET_ANIMATIONS.includes( data.ffxWidgetAnimation ?? '' ) ? ` ffx-widget-${ data.ffxWidgetAnimation }` : '';
	const button = h( 'button', { type: 'button', class: `ffx-widget ffx-widget-${ position }${ animation }`, 'aria-haspopup': 'dialog' }, data.ffxWidgetText ?? '' );
	// The form's tokens, so the button takes its accent colour and font.
	button.setAttribute( 'style', root.getAttribute( 'style' ) ?? '' );
	if ( /^#[0-9a-f]{3,8}$/i.test( data.ffxWidgetColor ?? '' ) ) {
		button.style.setProperty( '--ffx-widget-color', data.ffxWidgetColor ?? '' );
	}
	button.addEventListener( 'click', show );
	document.body.append( button );
}
