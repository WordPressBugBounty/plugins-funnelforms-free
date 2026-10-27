/**
 * Funnelforms → Settings: each section saves on its own. Once a field of a section changes, its
 * save button stands out and a bar at the bottom of the window names the section and saves it, so
 * nobody has to scroll back to the button. Saving one section while another has changes asks
 * first, since those changes would be lost. Without the script each section keeps its button.
 */
( function () {
	'use strict';

	var texts = window.funnelformsSettings;
	var rows = document.querySelectorAll( '.ffx-card__save' );
	if ( ! texts || ! rows.length ) {
		return;
	}

	var order = [];
	var leaving = false;
	Array.prototype.forEach.call( rows, function ( row ) {
		var form = row.closest( 'form' );
		var button = row.querySelector( '[name="submit"]' );
		if ( ! form || ! button ) {
			return;
		}
		var card = row.closest( '.ffx-card' );
		var title = card ? card.querySelector( 'h2' ) : null;
		var section = { form: form, button: button, title: title ? title.textContent.trim() : '', dirty: false };
		var change = function () {
			if ( ! section.dirty ) {
				section.dirty = true;
				button.classList.add( 'button-primary' );
			}
			order = order.filter( function ( s ) {
				return s !== section;
			} );
			order.push( section );
			show();
		};
		form.addEventListener( 'input', change );
		form.addEventListener( 'change', change );
		form.addEventListener( 'reset', function () {
			section.dirty = false;
			button.classList.remove( 'button-primary' );
			order = order.filter( function ( s ) {
				return s !== section;
			} );
			// The fields hold their old values only after the reset itself.
			window.setTimeout( show, 0 );
		} );
		form.addEventListener( 'submit', function ( event ) {
			var others = order.filter( function ( s ) {
				return s !== section;
			} );
			if ( others.length && ! window.confirm( texts.others.replace( '%s', names( others ) ) ) ) {
				event.preventDefault();
				return;
			}
			leaving = true;
		} );
	} );

	var bar = document.createElement( 'div' );
	bar.className = 'ffx-savebar';
	bar.setAttribute( 'role', 'region' );
	bar.setAttribute( 'aria-live', 'polite' );
	bar.hidden = true;
	var text = document.createElement( 'span' );
	text.className = 'ffx-savebar__text';
	var undo = document.createElement( 'button' );
	undo.type = 'button';
	undo.className = 'button';
	undo.textContent = texts.undo;
	var save = document.createElement( 'button' );
	save.type = 'button';
	save.className = 'button button-primary';
	save.textContent = texts.save;
	bar.append( text, undo, save );
	var stack = document.querySelector( '.ffx-stack' );
	( stack || rows[ 0 ].closest( '.ffx-card' ) ).after( bar );

	function names( list ) {
		return list
			.map( function ( s ) {
				return '"' + s.title + '"';
			} )
			.join( ', ' );
	}

	function last() {
		return order[ order.length - 1 ] || null;
	}

	function show() {
		var section = last();
		bar.hidden = ! section;
		if ( section ) {
			text.textContent = texts.changed.replace( '%s', section.title );
		}
	}

	save.addEventListener( 'click', function () {
		var section = last();
		if ( ! section ) {
			return;
		}
		if ( section.form.requestSubmit ) {
			section.form.requestSubmit( section.button );
		} else {
			section.button.click();
		}
	} );

	undo.addEventListener( 'click', function () {
		var section = last();
		if ( section ) {
			section.form.reset();
		}
	} );

	window.addEventListener( 'beforeunload', function ( event ) {
		if ( ! leaving && order.length ) {
			event.preventDefault();
			event.returnValue = '';
		}
	} );
} )();
