/**
 * Funnelforms → Settings → E-mail: picking a mail provider fills in its server, port, encryption
 * and fixed user name, and shows where to find the access data. Without the script the server
 * takes the provider's values for empty fields.
 */
( function () {
	'use strict';

	var select = document.querySelector( '[data-ffx-mail-provider]' );
	if ( ! select || ! select.form ) {
		return;
	}
	var form = select.form;
	var hint = form.querySelector( '[data-ffx-mail-hint]' );
	var fixed = [];
	Array.prototype.forEach.call( select.options, function ( option ) {
		if ( option.dataset.username ) {
			fixed.push( option.dataset.username );
		}
	} );

	select.addEventListener( 'change', function () {
		var data = select.options[ select.selectedIndex ].dataset;
		var username = form.elements.username;
		if ( 'custom' !== select.value || data.host ) {
			form.elements.host.value = data.host;
		}
		form.elements.port.value = data.port;
		form.elements.encryption.value = data.encryption;
		// A provider with a fixed user name (SendGrid: apikey) needs exactly that one; leaving it,
		// the fixed name goes again.
		if ( data.username ) {
			username.value = data.username;
		} else if ( ! data.username && -1 !== fixed.indexOf( username.value ) ) {
			username.value = '';
		}
		if ( hint ) {
			hint.textContent = data.hint;
		}
		if ( ! data.host ) {
			form.elements.host.focus();
		}
	} );
} )();
