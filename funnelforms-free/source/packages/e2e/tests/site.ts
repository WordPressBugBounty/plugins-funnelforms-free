import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/** Edition of the plugin under test. */
export const EDITION: 'pro' | 'free' = process.env.FFX_E2E_EDITION === 'free' ? 'free' : 'pro';

const USER = process.env.FFX_E2E_USER ?? 'admin';
const PASSWORD = process.env.FFX_E2E_PASSWORD ?? 'admin';

/**
 * Signs in as the administrator tools/e2e.sh made. Through the login form's request, not by
 * typing: the script of the login page empties the password field once it loads.
 */
export async function signIn( page: Page ): Promise<void> {
	// The login sets its cookies only when the test cookie of the login page is there.
	await page.request.get( '/wp-login.php' );
	const response = await page.request.post( '/wp-login.php', { form: { log: USER, pwd: PASSWORD, testcookie: '1', 'wp-submit': 'Log In' }, maxRedirects: 0 } );
	expect( response.status(), 'login redirects to wp-admin' ).toBe( 302 );
	await page.goto( '/wp-admin/' );
	await expect( page ).toHaveURL( /wp-admin/ );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON of the routes, checked by the tests.
export type Answer = { status: number; body: any };

/** The REST API as the signed-in administrator (plain permalinks, so ?rest_route=). */
export class Api {
	private constructor( private readonly request: APIRequestContext, private readonly nonce: string ) {}

	static async of( page: Page ): Promise<Api> {
		const nonce = await ( await page.request.get( '/wp-admin/admin-ajax.php?action=rest-nonce' ) ).text();
		expect( nonce, 'REST nonce for the signed-in user' ).toMatch( /^[0-9a-f]{10}$/ );
		return new Api( page.request, nonce );
	}

	async call( method: string, route: string, data?: unknown ): Promise<Answer> {
		const [ path, query ] = route.split( '?' );
		const url = '/?rest_route=/funnelforms/v1/' + path + ( query ? '&' + query : '' );
		return this.raw( method, url, data );
	}

	async raw( method: string, url: string, data?: unknown ): Promise<Answer> {
		const response = await this.request.fetch( url, { method, data, headers: { 'X-WP-Nonce': this.nonce } } );
		const text = await response.text();
		let body: unknown;
		try {
			body = JSON.parse( text );
		} catch {
			body = { text };
		}
		return { status: response.status(), body };
	}
}

/** A published form from a template, shown on a new page. */
export type Published = { id: number; uid: string; pageId: number };

export async function publishTemplate( api: Api, template: string, title: string ): Promise<Published> {
	const made = await api.call( 'POST', 'admin/forms/templates/' + template, { locale: 'de_DE' } );
	expect( made.status, JSON.stringify( made.body ) ).toBe( 201 );
	const id = Number( made.body.id );
	const published = await api.call( 'POST', `admin/forms/${ id }/publish`, {} );
	expect( published.status, JSON.stringify( published.body ) ).toBe( 200 );
	expect( published.body.renderer ).toBe( 'v5' );
	const uid = String( made.body.uid );
	const page = await api.raw( 'POST', '/?rest_route=/wp/v2/pages', { title, status: 'publish', content: `[funnelforms uid="${ uid }"]` } );
	expect( page.status, JSON.stringify( page.body ) ).toBe( 201 );
	return { id, uid, pageId: Number( page.body.id ) };
}

/**
 * Goes through a form as a visitor: picks an answer in every question (the `pick`-th, so runs
 * differ), fills the contact step and sends it. Returns once the thank-you screen shows.
 */
export async function fillIn( page: Page, pick = 0 ): Promise<void> {
	for ( let round = 0; round < 20; round++ ) {
		await page.waitForTimeout( 300 );
		if ( await page.locator( '.ffx-success:visible' ).count() ) {
			return;
		}
		if ( await page.locator( '.ffx-button-submit:visible' ).count() ) {
			for ( const input of await page.locator( '.ffx-field input:visible, .ffx-field textarea:visible' ).all() ) {
				const type = ( await input.getAttribute( 'type' ) ) ?? 'text';
				const autocomplete = ( await input.getAttribute( 'autocomplete' ) ) ?? '';
				if ( 'email' === type ) {
					await input.fill( `e2e-${ pick }-${ Date.now() }@example.org` );
				} else if ( 'tel' === type ) {
					await input.fill( '0151 23456789' );
				} else if ( 'checkbox' === type || 'radio' === type ) {
					await input.check( { force: true } );
				} else if ( 'text' === type || 'textarea' === type ) {
					await input.fill( autocomplete.includes( 'family' ) ? 'Muster' : 'Erika' );
				}
			}
			await page.locator( '.ffx-button-submit:visible' ).first().click();
			await expect( page.locator( '.ffx-success' ).first() ).toBeVisible();
			return;
		}
		const before = ( await page.locator( '.ffx-question:visible' ).allInnerTexts() ).join( '|' );
		let moved = false;
		for ( const field of await page.locator( '.ffx-field:visible' ).all() ) {
			const options = field.locator( '[data-option]' );
			const count = await options.count();
			if ( count > 0 && 0 === ( await field.locator( '[data-option][aria-pressed="true"], [data-option][aria-checked="true"], input:checked' ).count() ) ) {
				await options.nth( pick % count ).click();
				await page.waitForTimeout( 300 );
				if ( ( await page.locator( '.ffx-question:visible' ).allInnerTexts() ).join( '|' ) !== before ) {
					moved = true;
					break;
				}
			}
		}
		if ( ! moved && ( await page.locator( '.ffx-question:visible' ).allInnerTexts() ).join( '|' ) === before ) {
			await page.locator( '.ffx-button-next:visible' ).first().click();
		}
	}
	throw new Error( 'The form did not reach its thank-you screen in 20 rounds.' );
}

/** A fresh visitor with a phone-sized window. */
export async function visitor( browser: Browser ): Promise<Page> {
	const context = await browser.newContext( { viewport: { width: 390, height: 844 }, locale: 'de-DE' } );
	return context.newPage();
}

/** Collects errors of the browser console and failed scripts of a page. */
export function watchErrors( page: Page ): string[] {
	const errors: string[] = [];
	page.on( 'pageerror', ( error ) => errors.push( error.message ) );
	page.on( 'console', ( message ) => {
		// Missing favicons and the like are no errors of the plugin.
		if ( 'error' === message.type() && ! message.text().includes( 'Failed to load resource' ) ) {
			errors.push( message.text() );
		}
	} );
	return errors;
}
