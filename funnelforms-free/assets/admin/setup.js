/*
 * Setup assistant (SetupPage): import progress, previews, brand picker. Every step also works
 * without this script except the live parts (progress, previews, website colours).
 */
( function () {
	'use strict';

	var config = window.funnelformsSetup || {};
	var texts = config.texts || {};

	function ajax( action, nonce, params ) {
		var query = new URLSearchParams( Object.assign( { action: action, _ajax_nonce: nonce }, params || {} ) );
		return fetch( config.ajax + '?' + query.toString(), { credentials: 'same-origin' } ).then( function ( response ) {
			return response.json();
		} );
	}

	/* Restore point and import: moves them on while the page is open. */
	var progress = document.querySelector( '[data-ffx-progress]' );
	if ( progress && 'done' !== progress.getAttribute( 'data-ffx-progress' ) && 'failed' !== progress.getAttribute( 'data-ffx-progress' ) ) {
		var poll = function () {
			ajax( 'funnelforms_setup_progress', config.progress )
				.then( function ( result ) {
					if ( ! result || ! result.success ) {
						window.setTimeout( poll, 4000 );
						return;
					}
					progress.innerHTML = result.data.html;
					progress.setAttribute( 'data-ffx-progress', result.data.phase );
					if ( 'done' === result.data.phase ) {
						window.location.reload();
					} else if ( 'failed' !== result.data.phase ) {
						window.setTimeout( poll, 1200 );
					}
				} )
				.catch( function () {
					window.setTimeout( poll, 4000 );
				} );
		};
		poll();
	}

	/* Previews: loaded when their form is opened. */
	function load( frame ) {
		if ( frame.getAttribute( 'data-loaded' ) ) {
			return;
		}
		frame.setAttribute( 'data-loaded', '1' );
		if ( frame.getAttribute( 'data-src' ) ) {
			frame.src = frame.getAttribute( 'data-src' );
			return;
		}
		var box = frame.parentNode;
		box.classList.add( 'is-loading' );
		box.setAttribute( 'data-text', texts.loading || '' );
		ajax( 'funnelforms_setup_preview', config.preview, { form: frame.getAttribute( 'data-form' ), look: frame.getAttribute( 'data-look' ) || '' } )
			.then( function ( result ) {
				box.classList.remove( 'is-loading' );
				if ( result && result.success ) {
					frame.srcdoc = result.data.html;
				} else {
					box.classList.add( 'is-failed' );
					box.setAttribute( 'data-text', ( result && result.data && result.data.message ) || '' );
				}
			} )
			.catch( function () {
				box.classList.remove( 'is-loading' );
				box.classList.add( 'is-failed' );
			} );
	}

	document.querySelectorAll( '[data-ffx-compare]' ).forEach( function ( compare ) {
		var frames = compare.querySelectorAll( 'iframe' );
		var open = function () {
			frames.forEach( load );
		};
		if ( 'DETAILS' === compare.tagName ) {
			compare.addEventListener( 'toggle', function () {
				if ( compare.open ) {
					open();
				}
			} );
			if ( compare.open ) {
				open();
			}
		} else {
			open();
		}
		compare.querySelectorAll( '[data-device]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				compare.querySelectorAll( '[data-device]' ).forEach( function ( other ) {
					other.classList.toggle( 'is-active', other === button );
					other.setAttribute( 'aria-pressed', other === button ? 'true' : 'false' );
				} );
				compare.setAttribute( 'data-mode', button.getAttribute( 'data-device' ) );
			} );
		} );
	} );

	/* Templates: a goal shows its templates; a hidden choice is undone. */
	var templates = document.querySelector( '[data-ffx-templates]' );
	if ( templates ) {
		var filter = function () {
			var goal = document.querySelector( 'input[name="goal"]:checked' );
			var first = null;
			templates.querySelectorAll( '[data-goal]' ).forEach( function ( item ) {
				var show = ! goal || item.getAttribute( 'data-goal' ) === goal.value;
				item.hidden = ! show;
				var input = item.querySelector( 'input' );
				if ( ! show && input.checked ) {
					input.checked = false;
				}
				if ( show && ! first ) {
					first = input;
				}
			} );
			if ( first && ! templates.querySelector( 'input:checked' ) ) {
				first.checked = true;
			}
		};
		document.querySelectorAll( 'input[name="goal"]' ).forEach( function ( input ) {
			input.addEventListener( 'change', filter );
		} );
		filter();
	}

	/* Brand: colour, swatches, the colours of the website and the font in the preview. */
	var color = document.querySelector( '[data-ffx-color]' );
	var mock = document.querySelector( '[data-ffx-mock]' );
	if ( color && mock ) {
		var code = document.querySelector( '[data-ffx-color-code]' );
		var swatches = document.querySelector( '[data-ffx-swatches]' );
		var font = document.querySelector( '[data-ffx-font]' );
		var paint = function () {
			mock.style.setProperty( '--brand', color.value );
			code.textContent = color.value.toUpperCase();
			swatches.querySelectorAll( '[data-color]' ).forEach( function ( swatch ) {
				var on = swatch.getAttribute( 'data-color' ).toLowerCase() === color.value.toLowerCase();
				swatch.classList.toggle( 'is-active', on );
				swatch.setAttribute( 'aria-pressed', on ? 'true' : 'false' );
			} );
		};
		var swatch = function ( value ) {
			var button = document.createElement( 'button' );
			button.type = 'button';
			button.style.setProperty( '--swatch', value );
			button.setAttribute( 'data-color', value );
			button.setAttribute( 'aria-label', value );
			swatches.appendChild( button );
		};
		swatches.addEventListener( 'click', function ( event ) {
			var button = event.target.closest( '[data-color]' );
			if ( button ) {
				color.value = button.getAttribute( 'data-color' );
				paint();
			}
		} );
		color.addEventListener( 'input', paint );
		font.addEventListener( 'change', function () {
			mock.style.fontFamily = font.value ? '"' + font.value + '", sans-serif' : '';
		} );
		paint();

		var branding = document.querySelector( '[data-ffx-branding]' );
		var note = document.querySelector( '[data-ffx-branding-note]' );
		// Funnelforms Free does not read the colours of the website.
		if ( branding ) {
			branding.addEventListener( 'click', function () {
				branding.disabled = true;
				note.textContent = texts.reading || '';
				ajax( 'funnelforms_setup_branding', config.branding )
					.then( function ( result ) {
						branding.disabled = false;
						if ( ! result || ! result.success ) {
							note.textContent = ( result && result.data && result.data.message ) || '';
							return;
						}
						note.textContent = '';
						var known = Array.prototype.map.call( swatches.querySelectorAll( '[data-color]' ), function ( item ) {
							return item.getAttribute( 'data-color' ).toLowerCase();
						} );
						result.data.colors.forEach( function ( value ) {
							if ( known.indexOf( value.toLowerCase() ) === -1 ) {
								swatch( value );
							}
						} );
						if ( result.data.colors.length ) {
							color.value = result.data.colors[ 0 ];
							paint();
						}
						result.data.fonts.forEach( function ( family ) {
							if ( ! font.querySelector( 'option[value="' + family.replace( /"/g, '' ) + '"]' ) ) {
								var option = document.createElement( 'option' );
								option.value = family;
								option.textContent = family;
								font.appendChild( option );
							}
						} );
						if ( result.data.fonts.length ) {
							font.value = result.data.fonts[ 0 ];
							font.dispatchEvent( new Event( 'change' ) );
						}
					} )
					.catch( function () {
						branding.disabled = false;
						note.textContent = '';
					} );
			} );
		}
	}

	/* Go live: the page title only matters for a new page. */
	var title = document.getElementById( 'ffx-setup-page' );
	if ( title ) {
		var place = function () {
			var page = document.querySelector( 'input[name="place"][value="page"]' );
			title.closest( '[data-ffx-page-title]' ).hidden = ! page.checked;
		};
		document.querySelectorAll( 'input[name="place"]' ).forEach( function ( input ) {
			input.addEventListener( 'change', place );
		} );
		place();
	}

	/* Tips and news by email: the address counts only while the box is ticked, so an unticked box never holds up the step. */
	var newsletter = document.querySelector( 'input[name="newsletter"]' );
	var newsletterEmail = document.getElementById( 'ffx-setup-newsletter-email' );
	if ( newsletter && newsletterEmail ) {
		var signUp = function () {
			newsletterEmail.disabled = ! newsletter.checked;
		};
		newsletter.addEventListener( 'change', signUp );
		signUp();
	}

	/* Copy buttons. */
	document.querySelectorAll( '[data-ffx-copy]' ).forEach( function ( button ) {
		button.addEventListener( 'click', function () {
			var field = document.querySelector( button.getAttribute( 'data-ffx-copy' ) );
			var label = button.querySelector( 'span' );
			var before = label.textContent;
			var done = function () {
				label.textContent = texts.copied || before;
				window.setTimeout( function () {
					label.textContent = before;
				}, 1600 );
			};
			if ( navigator.clipboard ) {
				navigator.clipboard.writeText( field.value ).then( done );
			} else {
				field.select();
				document.execCommand( 'copy' );
				done();
			}
		} );
	} );

	/* One submit at a time: the button shows that the step is being saved. */
	var form = document.querySelector( '.ffx-setup__form' );
	if ( form ) {
		form.addEventListener( 'submit', function ( event ) {
			var button = event.submitter;
			if ( form.getAttribute( 'data-sent' ) ) {
				event.preventDefault();
				return;
			}
			form.setAttribute( 'data-sent', '1' );
			if ( button ) {
				button.classList.add( 'is-busy' );
			}
		} );
		// Back in the browser shows the page from its cache: it can be sent again.
		window.addEventListener( 'pageshow', function () {
			form.removeAttribute( 'data-sent' );
			form.querySelectorAll( '.is-busy' ).forEach( function ( button ) {
				button.classList.remove( 'is-busy' );
			} );
		} );
	}
}() );
