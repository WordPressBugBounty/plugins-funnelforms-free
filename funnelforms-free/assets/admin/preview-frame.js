/*
 * Script of the builder's preview frame (Application\FormPreview prints it into the preview page
 * only; the website never gets it). It hears only the builder's window, the frame's parent.
 *
 * Style: { type: 'ffx-preview-style', css, classes } sets the form's style attribute (keeping its
 * background image) and the classes that follow from the tokens, so a change of the design, or a
 * theme the pointer rests on, shows before it is saved (Workspaces.tsx, LivePreview).
 *
 * Design mode (LiveDesign.tsx): { type: 'ffx-design', action, … }. In the design workspace the
 * builder switches it on: a hover outlines the part of the form under the pointer (button,
 * question, answer, input, progress bar, background …), a click picks it instead of using the
 * form, and the builder shows the tokens of that part.
 *   mode   { on: boolean, labels: { <part>: text } }
 *   select { target: <part> }   picks the first such part on the step (keyboard)
 *   clear  {}
 * To the builder: ready {}, pick { target, rect } (rect null: not on this step), rect { target, rect },
 * key { key: 'undo' | 'redo' | 'escape' }. They carry no content of the form, only parts and positions.
 */
( function () {
	'use strict';

	/* The parts, innermost first: an icon inside an answer is the icon. */
	var PARTS = [
		[ 'button', '.ffx-button-primary' ],
		[ 'back', '.ffx-button-back' ],
		[ 'icon', '.ffx-option-icon' ],
		[ 'answer', '.ffx-option' ],
		[ 'input', '.ffx-input, .ffx-pick-toggle, .ffx-salutation label' ],
		[ 'question', '.ffx-question, .ffx-heading, .ffx-contact-title, .ffx-success-heading' ],
		[ 'description', '.ffx-description' ],
		[ 'progress', '.ffx-progress-row, .ffx-progress' ],
		[ 'form', '.ffx-form' ],
	];
	var CLASSES = [ 'ffx-sticky', 'ffx-stack', 'ffx-dark', 'ffx-bshadow', 'ffx-upper' ];
	var script = document.currentScript;
	var more = script ? script.getAttribute( 'data-ffx-more' ) : '';

	var on = false;
	var labels = {};
	var picked = null;
	var pickedPart = '';
	var hover = outline( 'dashed' );
	var chosen = outline( 'solid' );
	var frame = 0;

	function outline( style ) {
		var box = document.createElement( 'div' );
		box.setAttribute( 'aria-hidden', 'true' );
		box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;box-sizing:border-box;border:2px ' + style + ' #6a30f5;border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.8)';
		var tag = document.createElement( 'span' );
		tag.style.cssText = 'position:absolute;left:-2px;bottom:100%;margin-bottom:2px;padding:2px 6px;border-radius:4px;background:#6a30f5;color:#fff;font:600 11px/1.4 system-ui,sans-serif;white-space:nowrap';
		box.appendChild( tag );
		return box;
	}

	function send( message ) {
		message.type = 'ffx-design';
		window.parent.postMessage( message, '*' );
	}

	function part( element ) {
		for ( var el = element; el && el.nodeType === 1; el = el.parentElement ) {
			for ( var i = 0; i < PARTS.length; i++ ) {
				if ( el.matches( PARTS[ i ][ 1 ] ) && el.closest( '.ffx-form' ) ) {
					return { el: el, name: PARTS[ i ][ 0 ] };
				}
			}
		}
		return null;
	}

	function rect( el ) {
		var r = el.getBoundingClientRect();
		return { x: Math.round( r.left ), y: Math.round( r.top ), width: Math.round( r.width ), height: Math.round( r.height ) };
	}

	function place( box, el, name ) {
		if ( ! el || ! on ) {
			box.style.display = 'none';
			return;
		}
		var r = el.getBoundingClientRect();
		box.style.display = 'block';
		box.style.left = r.left - 3 + 'px';
		box.style.top = r.top - 3 + 'px';
		box.style.width = r.width + 6 + 'px';
		box.style.height = r.height + 6 + 'px';
		box.firstChild.textContent = labels[ name ] || name;
		box.firstChild.style.display = r.top < 24 ? 'none' : '';
	}

	function pick( found ) {
		picked = found ? found.el : null;
		pickedPart = found ? found.name : '';
		place( chosen, picked, pickedPart );
		place( hover, null, '' );
	}

	function visible( el ) {
		return el.getClientRects().length > 0;
	}

	/* The style of tokens not saved yet. */
	function style( css, classes ) {
		var forms = document.querySelectorAll( '.ffx-form' );
		for ( var f = 0; f < forms.length; f++ ) {
			var form = forms[ f ];
			if ( undefined === form.ffxImage ) {
				form.ffxImage = ( ( form.getAttribute( 'style' ) || '' ).match( /--ffx-background-image:[^;]*;/ ) || [ '' ] )[ 0 ];
			}
			form.setAttribute( 'style', css + form.ffxImage );
			for ( var c = 0; c < CLASSES.length; c++ ) {
				form.classList.toggle( CLASSES[ c ], ( ' ' + classes + ' ' ).indexOf( ' ' + CLASSES[ c ] + ' ' ) > -1 );
			}
		}
		// Button shadows and capital headings are in runtime-more.css.
		if ( more && /ffx-(bshadow|upper)/.test( classes ) && ! document.querySelector( '[data-ffx-more-css]' ) ) {
			var link = document.createElement( 'link' );
			link.rel = 'stylesheet';
			link.href = more;
			link.setAttribute( 'data-ffx-more-css', '' );
			document.head.appendChild( link );
		}
		// Sizes may have changed: the outline follows.
		follow();
	}

	function follow() {
		if ( frame ) {
			return;
		}
		frame = window.requestAnimationFrame( function () {
			frame = 0;
			if ( picked && ! picked.isConnected ) {
				picked = null;
			}
			place( chosen, picked, pickedPart );
			if ( picked ) {
				send( { action: 'rect', target: pickedPart, rect: rect( picked ) } );
			}
		} );
	}

	window.addEventListener( 'message', function ( event ) {
		var data = event.data;
		if ( event.source !== window.parent || ! data || 'object' !== typeof data ) {
			return;
		}
		if ( 'ffx-preview-style' === data.type ) {
			if ( 'string' === typeof data.css && 'string' === typeof data.classes ) {
				style( data.css, data.classes );
			}
			return;
		}
		if ( 'ffx-design' === data.type ) {
			design( data );
		}
	} );

	/* A message of the design mode from the builder. */
	function design( data ) {
		if ( 'mode' === data.action ) {
			on = true === data.on;
			labels = {};
			for ( var i = 0; i < PARTS.length; i++ ) {
				var text = data.labels && data.labels[ PARTS[ i ][ 0 ] ];
				if ( 'string' === typeof text && text.length <= 60 ) {
					labels[ PARTS[ i ][ 0 ] ] = text;
				}
			}
			document.documentElement.style.cursor = on ? 'crosshair' : '';
			if ( ! on ) {
				pick( null );
			}
		} else if ( 'select' === data.action ) {
			var selector = null;
			for ( var p = 0; p < PARTS.length; p++ ) {
				if ( PARTS[ p ][ 0 ] === data.target ) {
					selector = PARTS[ p ][ 1 ];
				}
			}
			if ( null === selector ) {
				return;
			}
			var all = document.querySelectorAll( selector );
			var el = null;
			for ( var a = 0; a < all.length && ! el; a++ ) {
				el = visible( all[ a ] ) && all[ a ].closest( '.ffx-form' ) ? all[ a ] : null;
			}
			if ( el ) {
				el.scrollIntoView( { block: 'nearest' } );
			}
			pick( el ? { el: el, name: data.target } : null );
			send( { action: 'pick', target: data.target, rect: el ? rect( el ) : null } );
		} else if ( 'clear' === data.action ) {
			pick( null );
		}
	}

	document.addEventListener(
		'mousemove',
		function ( event ) {
			if ( on ) {
				var found = part( event.target );
				place( hover, found && found.el !== picked ? found.el : null, found ? found.name : '' );
			}
		},
		true
	);

	document.addEventListener(
		'mouseleave',
		function () {
			place( hover, null, '' );
		},
		true
	);

	/* While the design mode is on, the form does nothing: a click picks a part (Enter on a focused part too). */
	function intercept( event ) {
		if ( ! on ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if ( 'click' === event.type ) {
			var found = part( event.target );
			pick( found );
			if ( found ) {
				send( { action: 'pick', target: found.name, rect: rect( found.el ) } );
			}
		}
	}
	[ 'click', 'mousedown', 'pointerdown', 'submit', 'dblclick' ].forEach( function ( type ) {
		document.addEventListener( type, intercept, true );
	} );

	document.addEventListener(
		'keydown',
		function ( event ) {
			if ( ! on ) {
				return;
			}
			var key = event.key.toLowerCase();
			var mod = event.ctrlKey || event.metaKey;
			var action = 'escape' === key ? 'escape' : mod && 'z' === key ? ( event.shiftKey ? 'redo' : 'undo' ) : mod && 'y' === key ? 'redo' : '';
			if ( action ) {
				event.preventDefault();
				send( { action: 'key', key: action } );
			}
		},
		true
	);

	window.addEventListener( 'scroll', follow, true );
	window.addEventListener( 'resize', follow );

	function ready() {
		document.body.appendChild( hover );
		document.body.appendChild( chosen );
		send( { action: 'ready' } );
	}
	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', ready );
	} else {
		ready();
	}
} )();
