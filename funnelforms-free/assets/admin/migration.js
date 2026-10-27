/*
 * Migration page (MigrationPage, SafetySection): moves long jobs on while the page is open and
 * loads the comparison of old and new. Every action also works without this script; only the
 * live progress and the previews need it.
 */
( function () {
	'use strict';

	var config = window.funnelformsMigration || {};
	var texts = config.texts || {};

	function ajax( action, nonce, params ) {
		var query = new URLSearchParams( Object.assign( { action: action, _ajax_nonce: nonce }, params || {} ) );
		return fetch( config.ajax + '?' + query.toString(), { credentials: 'same-origin' } ).then( function ( response ) {
			return response.json();
		} );
	}

	/* Jobs: import, check, restore and restore point. Each poll moves the job one step on. */
	document.querySelectorAll( '[data-ffx-job]' ).forEach( function ( box ) {
		var job = box.getAttribute( 'data-ffx-job' );
		var bar = box.querySelector( '[data-ffx-bar]' );
		var meter = box.querySelector( '[role="progressbar"]' );
		var text = box.querySelector( '[data-ffx-job-text]' );
		var next = box.closest( '[data-ffx-next]' );
		var failures = 0;
		var poll = function () {
			ajax( 'funnelforms_migration_progress', config.progress, { job: job } )
				.then( function ( result ) {
					if ( ! result || ! result.success ) {
						throw new Error( 'progress' );
					}
					failures = 0;
					var data = result.data;
					bar.style.width = Math.max( 3, data.percent ) + '%';
					meter.setAttribute( 'aria-valuenow', String( data.percent ) );
					text.textContent = data.text;
					if ( 'done' === data.status ) {
						box.classList.add( 'is-done' );
						window.setTimeout( function () {
							if ( next ) {
								window.location.assign( next.getAttribute( 'data-ffx-next' ) );
							} else {
								window.location.reload();
							}
						}, 600 );
					} else if ( 'failed' === data.status ) {
						box.classList.add( 'is-failed' );
					} else {
						window.setTimeout( poll, 800 );
					}
				} )
				.catch( function () {
					failures++;
					if ( failures >= 3 ) {
						text.textContent = texts.failed || '';
					}
					window.setTimeout( poll, 5000 );
				} );
		};
		poll();
	} );

	/* Old and new side by side: loaded when the comparison is on the page. */
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
		ajax( 'funnelforms_setup_preview', config.preview, { form: frame.getAttribute( 'data-form' ) } )
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
		if ( 'IntersectionObserver' in window ) {
			var observer = new IntersectionObserver( function ( entries ) {
				if ( entries.some( function ( entry ) {
					return entry.isIntersecting;
				} ) ) {
					observer.disconnect();
					open();
				}
			}, { rootMargin: '200px' } );
			observer.observe( compare );
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

	/* One submit at a time. */
	document.querySelectorAll( '.ffx-mig form, .ffx-mig-step form' ).forEach( function ( form ) {
		form.addEventListener( 'submit', function ( event ) {
			if ( form.getAttribute( 'data-sent' ) ) {
				event.preventDefault();
				return;
			}
			form.setAttribute( 'data-sent', '1' );
			if ( event.submitter ) {
				event.submitter.classList.add( 'is-busy' );
			}
		} );
	} );
	window.addEventListener( 'pageshow', function () {
		document.querySelectorAll( 'form[data-sent]' ).forEach( function ( form ) {
			form.removeAttribute( 'data-sent' );
			form.querySelectorAll( '.is-busy' ).forEach( function ( button ) {
				button.classList.remove( 'is-busy' );
			} );
		} );
	} );
}() );
