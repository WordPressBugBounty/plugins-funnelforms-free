import { expect, test } from '@playwright/test';
import { Api, EDITION, signIn } from './site';

test( 'the edition offers its own templates', async ( { page } ) => {
	await signIn( page );
	const api = await Api.of( page );
	const gallery = await api.call( 'GET', 'admin/forms/templates?locale=de_DE' );
	expect( gallery.status ).toBe( 200 );
	expect( gallery.body.templates.length ).toBeGreaterThan( 50 );
	// The solar calculator needs calculations, which are Pro.
	const solar = await api.call( 'POST', 'admin/forms/templates/solar', { locale: 'de_DE' } );
	if ( 'free' === EDITION ) {
		expect( solar.status ).toBe( 403 );
		expect( solar.body.code ).toBe( 'pro_template' );
	} else {
		expect( solar.status ).toBe( 201 );
	}
} );
