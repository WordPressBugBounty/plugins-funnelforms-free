/**
 * Funnelforms → Statistics: values on hover and click in the charts, the details of each step and
 * the AI analysis (Pro). Without the script the page shows the same figures as titles and tables.
 */
( function () {
	'use strict';

	var config = window.funnelformsStats || {};
	var texts = config.texts || {};
	// A WordPress locale the browser does not accept as a tag (pt_PT_ao90 → pt-PT-ao90) falls back to the
	// browser's language instead of stopping the script with a RangeError.
	function numberFormat( options ) {
		try {
			return new Intl.NumberFormat( config.locale || undefined, options );
		} catch ( e ) {
			return new Intl.NumberFormat( undefined, options );
		}
	}
	var number = numberFormat( {} );
	var percent = numberFormat( { style: 'percent', maximumFractionDigits: 1 } );

	function el( tag, className, text ) {
		var node = document.createElement( tag );
		if ( className ) {
			node.className = className;
		}
		if ( undefined !== text ) {
			node.textContent = text;
		}
		return node;
	}

	/* One floating tip for the whole page. */
	var tip = el( 'div', 'ffx-tip' );
	tip.setAttribute( 'role', 'tooltip' );
	tip.hidden = true;
	document.body.appendChild( tip );

	function showTip( content, x, y ) {
		tip.textContent = '';
		if ( 'string' === typeof content ) {
			tip.textContent = content;
		} else {
			tip.appendChild( content );
		}
		tip.hidden = false;
		var width = tip.offsetWidth;
		var height = tip.offsetHeight;
		var left = Math.min( window.innerWidth - width - 8, Math.max( 8, x - width / 2 ) );
		var top = y - height - 12;
		if ( top < 8 ) {
			top = y + 16;
		}
		tip.style.left = left + window.scrollX + 'px';
		tip.style.top = top + window.scrollY + 'px';
	}

	function hideTip() {
		tip.hidden = true;
	}

	/* Heatmap, histograms: their titles become tips at once. */
	document.querySelectorAll( '.ffx-heat td[title], .ffx-histo__col[title]' ).forEach( function ( cell ) {
		var text = cell.getAttribute( 'title' );
		cell.removeAttribute( 'title' );
		cell.setAttribute( 'data-ffx-tip', text );
		if ( ! cell.querySelector( '.screen-reader-text' ) ) {
			cell.setAttribute( 'aria-label', text );
		}
		var show = function () {
			var box = cell.getBoundingClientRect();
			showTip( text, box.left + box.width / 2, box.top );
		};
		cell.addEventListener( 'mouseenter', show );
		cell.addEventListener( 'click', show );
		cell.addEventListener( 'mouseleave', hideTip );
	} );

	/* Charts of views and entries per day. */
	document.querySelectorAll( '[data-ffx-chart]' ).forEach( function ( chart ) {
		var data;
		try {
			data = JSON.parse( chart.getAttribute( 'data-ffx-chart' ) );
		} catch ( e ) {
			return;
		}
		var days = data.days || [];
		var svg = chart.querySelector( 'svg' );
		if ( ! svg || 0 === days.length ) {
			return;
		}
		var max = Math.max( 1, data.max || 1 );
		var previous = null !== days[ 0 ][ 3 ];
		var totals = days.reduce( function ( sum, d ) {
			return [ sum[ 0 ] + d[ 1 ], sum[ 1 ] + d[ 2 ] ];
		}, [ 0, 0 ] );
		var hidden = {};

		// The native titles stay for screen readers in the SVG, not as a second tip.
		svg.querySelectorAll( '.ffx-chart__hit title' ).forEach( function ( title ) {
			title.remove();
		} );

		var layer = el( 'div', 'ffx-chart__layer' );
		var guide = el( 'span', 'ffx-chart__guide' );
		var dotViews = el( 'span', 'ffx-chart__dot ffx-chart__dot--views' );
		var dotEntries = el( 'span', 'ffx-chart__dot ffx-chart__dot--entries' );
		var dotPrevious = el( 'span', 'ffx-chart__dot ffx-chart__dot--previous' );
		layer.append( guide, dotViews, dotEntries );
		if ( previous ) {
			layer.appendChild( dotPrevious );
		}
		layer.hidden = true;
		chart.appendChild( layer );

		var pinned = -1;
		var active = -1;

		function place() {
			layer.style.left = svg.offsetLeft + 'px';
			layer.style.top = svg.offsetTop + 'px';
			layer.style.width = svg.clientWidth + 'px';
			layer.style.height = svg.clientHeight + 'px';
		}

		function top( n ) {
			return ( 100 - 92 * n / max ) + '%';
		}

		function row( label, value, className ) {
			var line = el( 'div', 'ffx-tip__row' + ( className ? ' ' + className : '' ) );
			line.append( el( 'span', '', label ), el( 'strong', '', value ) );
			return line;
		}

		function content( i, full ) {
			var d = days[ i ];
			var box = el( 'div' );
			box.appendChild( el( 'div', 'ffx-tip__head', d[ 0 ] ) );
			if ( ! hidden.views ) {
				box.appendChild( row( texts.views || 'Views', number.format( d[ 1 ] ), 'is-views' ) );
			}
			if ( ! hidden.entries ) {
				box.appendChild( row( texts.entries || 'Entries', number.format( d[ 2 ] ), 'is-entries' ) );
			}
			if ( previous && ! hidden.previous ) {
				box.appendChild( row( texts.before || 'Before', number.format( d[ 3 ] ), 'is-previous' ) );
			}
			if ( d[ 1 ] > 0 ) {
				box.appendChild( row( texts.rate || 'Conversion rate', percent.format( Math.min( 1, d[ 2 ] / d[ 1 ] ) ) ) );
			}
			if ( full ) {
				var avg = el( 'div', 'ffx-tip__foot' );
				avg.textContent = ( texts.average || 'Average per day' ) + ': ' +
					number.format( Math.round( totals[ 0 ] / days.length ) ) + ' / ' +
					number.format( Math.round( 10 * totals[ 1 ] / days.length ) / 10 );
				box.appendChild( avg );
				var close = el( 'button', 'ffx-tip__close', '×' );
				close.type = 'button';
				close.setAttribute( 'aria-label', texts.close || 'Close' );
				close.addEventListener( 'click', function () {
					unpin();
				} );
				box.appendChild( close );
			}
			return box;
		}

		function show( i ) {
			active = i;
			place();
			layer.hidden = false;
			var d = days[ i ];
			var left = ( 100 * ( i + 0.5 ) / days.length ) + '%';
			guide.style.left = left;
			[ [ dotViews, d[ 1 ], 'views' ], [ dotEntries, d[ 2 ], 'entries' ], [ dotPrevious, d[ 3 ] || 0, 'previous' ] ].forEach( function ( dot ) {
				dot[ 0 ].style.left = left;
				dot[ 0 ].style.top = top( dot[ 1 ] );
				dot[ 0 ].hidden = !! hidden[ dot[ 2 ] ];
			} );
			var box = svg.getBoundingClientRect();
			showTip( content( i, pinned === i ), box.left + box.width * ( i + 0.5 ) / days.length, box.top + box.height * ( 1 - 0.92 * Math.max( hidden.views ? 0 : d[ 1 ], d[ 2 ] ) / max ) );
			tip.classList.toggle( 'is-pinned', pinned === i );
		}

		function hide() {
			if ( pinned >= 0 ) {
				show( pinned );
				return;
			}
			active = -1;
			layer.hidden = true;
			hideTip();
		}

		function unpin() {
			pinned = -1;
			chart.classList.remove( 'is-pinned' );
			hide();
		}

		function index( event ) {
			var box = svg.getBoundingClientRect();
			return Math.max( 0, Math.min( days.length - 1, Math.floor( ( event.clientX - box.left ) / box.width * days.length ) ) );
		}

		svg.addEventListener( 'mousemove', function ( event ) {
			if ( pinned < 0 ) {
				show( index( event ) );
			}
		} );
		svg.addEventListener( 'mouseleave', hide );
		svg.addEventListener( 'click', function ( event ) {
			var i = index( event );
			if ( pinned === i ) {
				unpin();
				return;
			}
			pinned = i;
			chart.classList.add( 'is-pinned' );
			show( i );
		} );

		// Keyboard: arrows go from day to day, Escape closes.
		chart.tabIndex = 0;
		chart.setAttribute( 'aria-roledescription', 'chart' );
		chart.addEventListener( 'keydown', function ( event ) {
			var i = pinned >= 0 ? pinned : active;
			if ( 'ArrowRight' === event.key || 'ArrowLeft' === event.key ) {
				i = i < 0 ? ( 'ArrowRight' === event.key ? 0 : days.length - 1 ) : Math.max( 0, Math.min( days.length - 1, i + ( 'ArrowRight' === event.key ? 1 : -1 ) ) );
				pinned = i;
				chart.classList.add( 'is-pinned' );
				show( i );
				event.preventDefault();
			} else if ( 'Escape' === event.key ) {
				unpin();
			}
		} );
		chart.addEventListener( 'blur', function () {
			if ( ! chart.contains( document.activeElement ) && ! tip.contains( document.activeElement ) ) {
				unpin();
			}
		} );
		document.addEventListener( 'click', function ( event ) {
			if ( pinned >= 0 && ! chart.contains( event.target ) && ! tip.contains( event.target ) ) {
				unpin();
			}
		} );
		window.addEventListener( 'resize', function () {
			if ( active >= 0 ) {
				show( active );
			}
		} );

		// The legend shows and hides each series.
		var card = chart.closest( '.ffx-card' );
		var legend = card && card.querySelector( '[data-ffx-legend]' );
		if ( ! legend ) {
			return;
		}
		legend.querySelectorAll( '[data-ffx-series]' ).forEach( function ( item ) {
			var series = item.getAttribute( 'data-ffx-series' );
			var button = el( 'button', item.className + ' ffx-legend__toggle' );
			button.type = 'button';
			button.textContent = item.textContent;
			button.setAttribute( 'aria-pressed', 'true' );
			button.addEventListener( 'click', function () {
				hidden[ series ] = ! hidden[ series ];
				button.setAttribute( 'aria-pressed', hidden[ series ] ? 'false' : 'true' );
				chart.classList.toggle( 'is-hide-' + series, !! hidden[ series ] );
				if ( active >= 0 ) {
					show( active );
				}
			} );
			item.replaceWith( button );
		} );
	} );

	/* Steps of one form: a click on a step opens its details. */
	document.querySelectorAll( '.ffx-steptable__toggle' ).forEach( function ( button ) {
		var detail = document.getElementById( button.getAttribute( 'aria-controls' ) );
		if ( ! detail ) {
			return;
		}
		detail.hidden = true;
		button.addEventListener( 'click', function () {
			var open = 'true' !== button.getAttribute( 'aria-expanded' );
			button.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
			button.closest( 'tr' ).classList.toggle( 'is-open', open );
			detail.hidden = ! open;
		} );
	} );

	/* AI analysis (Funnelforms Pro). */
	function request( method, path, body ) {
		return window.fetch( config.root + path, {
			method: method,
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce },
			body: body ? JSON.stringify( body ) : undefined,
		} ).then( function ( response ) {
			return response.json().catch( function () {
				return {};
			} ).then( function ( json ) {
				return { status: response.status, json: json || {} };
			} );
		} );
	}

	function showError( card, message ) {
		var box = card.querySelector( '[data-ffx-analyze-error]' );
		if ( box ) {
			box.querySelector( 'p' ).textContent = message || texts.failed || '';
			box.hidden = false;
		}
	}

	function busy( card, on ) {
		var progress = card.querySelector( '[data-ffx-analyze-progress]' );
		var form = card.querySelector( '[data-ffx-analyze-form]' );
		if ( progress ) {
			progress.hidden = ! on;
		}
		if ( form ) {
			form.querySelectorAll( 'button, select' ).forEach( function ( control ) {
				control.disabled = on;
			} );
		}
	}

	function reloadTo( hash ) {
		var url = new URL( window.location.href );
		url.hash = hash;
		window.location.replace( url.toString() );
		window.location.reload();
	}

	function poll( card, form ) {
		var tries = 0;
		var next = function () {
			tries++;
			request( 'GET', 'stats/' + form + '/analysis' ).then( function ( answer ) {
				if ( 202 === answer.status && tries < 60 ) {
					window.setTimeout( next, tries < 10 ? 3000 : 5000 );
				} else if ( 200 === answer.status && answer.json.analysis ) {
					var status = card.querySelector( '[data-ffx-analyze-status]' );
					if ( status ) {
						status.textContent = texts.done || '';
					}
					reloadTo( 'ffx-ai-result' );
				} else {
					busy( card, false );
					showError( card, answer.json.message );
				}
			} ).catch( function () {
				busy( card, false );
				showError( card );
			} );
		};
		window.setTimeout( next, 3000 );
	}

	var analyze = document.querySelector( '[data-ffx-analyze]' );
	if ( analyze && config.root ) {
		var formId = analyze.getAttribute( 'data-form' );
		if ( analyze.hasAttribute( 'data-pending' ) ) {
			busy( analyze, true );
			poll( analyze, formId );
		}
		var start = analyze.querySelector( '[data-ffx-analyze-form]' );
		if ( start ) {
			start.addEventListener( 'submit', function ( event ) {
				event.preventDefault();
				analyze.querySelector( '[data-ffx-analyze-error]' ).hidden = true;
				busy( analyze, true );
				request( 'POST', 'stats/' + formId + '/analysis', { days: Number( start.elements.days.value ) } ).then( function ( answer ) {
					if ( 202 === answer.status ) {
						poll( analyze, formId );
					} else if ( 200 === answer.status ) {
						reloadTo( 'ffx-ai-result' );
					} else {
						busy( analyze, false );
						showError( analyze, answer.json.message );
					}
				} ).catch( function () {
					busy( analyze, false );
					showError( analyze );
				} );
			} );
		}
	}

	// On the page of all forms: start, then go to the form, which waits for the result.
	var pick = document.querySelector( '[data-ffx-analyze-pick]' );
	if ( pick && config.root ) {
		var choose = pick.querySelector( '[data-ffx-analyze-form]' );
		choose.addEventListener( 'submit', function ( event ) {
			event.preventDefault();
			var form = choose.elements.form.value;
			pick.querySelector( '[data-ffx-analyze-error]' ).hidden = true;
			busy( pick, true );
			request( 'POST', 'stats/' + form + '/analysis', { days: Number( choose.elements.days.value ) } ).then( function ( answer ) {
				if ( 202 === answer.status || 200 === answer.status ) {
					var url = new URL( choose.action, window.location.href );
					url.searchParams.set( 'page', choose.elements.page.value );
					url.searchParams.set( 'form', form );
					url.searchParams.set( 'days', choose.elements.days.value );
					url.hash = 202 === answer.status ? 'ffx-ai' : 'ffx-ai-result';
					window.location.assign( url.toString() );
				} else {
					busy( pick, false );
					showError( pick, answer.json.message );
				}
			} ).catch( function () {
				busy( pick, false );
				showError( pick );
			} );
		} );
	}

	// Recommendations: tick off, copy the instruction for the AI bar.
	var result = document.querySelector( '[data-ffx-analysis]' );
	if ( result && config.root ) {
		var count = result.querySelector( '[data-ffx-rec-count]' );
		var update = function () {
			if ( ! count ) {
				return;
			}
			var done = result.querySelectorAll( '.ffx-rec.is-done' ).length;
			count.textContent = ( texts.progress || '%1$d / %2$d' ).replace( '%1$d', done ).replace( '%2$d', count.getAttribute( 'data-total' ) );
		};
		result.querySelectorAll( '[data-ffx-rec-done]' ).forEach( function ( box ) {
			box.addEventListener( 'change', function () {
				var item = box.closest( '.ffx-rec' );
				var done = box.checked;
				item.classList.toggle( 'is-done', done );
				update();
				request( 'POST', 'stats/' + result.getAttribute( 'data-form' ) + '/analysis/done', { recommendations: [ item.getAttribute( 'data-id' ) ], done: done } ).then( function ( answer ) {
					if ( 200 !== answer.status ) {
						box.checked = ! done;
						item.classList.toggle( 'is-done', ! done );
						update();
					}
				} ).catch( function () {
					box.checked = ! done;
					item.classList.toggle( 'is-done', ! done );
					update();
				} );
			} );
		} );
		result.querySelectorAll( '[data-ffx-copy]' ).forEach( function ( button ) {
			button.addEventListener( 'click', function () {
				var text = button.getAttribute( 'data-ffx-copy' );
				var label = button.querySelector( 'span' );
				var before = label.textContent;
				var done = function () {
					label.textContent = texts.copied || before;
					window.setTimeout( function () {
						label.textContent = before;
					}, 1600 );
				};
				if ( navigator.clipboard ) {
					navigator.clipboard.writeText( text ).then( done );
				}
			} );
		} );
	}
}() );
