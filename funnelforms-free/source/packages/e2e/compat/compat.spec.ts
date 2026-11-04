import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Api, publishTemplate, signIn, visitor, watchErrors } from '../tests/site';

/**
 * Compatibility of the plugin with another plugin or theme (tools/compat/compat.sh). The script
 * installs a profile (plugins, theme, setup) in a fresh WordPress and runs this file twice: first the
 * tests tagged @prepare (the form and its pages), then, after the setup of the profile, the checks.
 *
 * The checks: the builder opens, the form shows on every page of the profile and looks as on a site
 * without other plugins (computed styles against the baseline profile), and a visitor sends it. On a
 * profile with a page cache a second visitor gets the cached page and sends it too.
 */

const OUT = process.env.FFX_COMPAT_OUT ?? path.join( 'results', 'compat' );
const BASELINE = process.env.FFX_COMPAT_BASELINE ?? '';
const CACHED = '1' === process.env.FFX_COMPAT_CACHED;
const TEMPLATE = process.env.FFX_COMPAT_TEMPLATE ?? 'moving';

type Form = { id: number; uid: string; pages: Record<string, number> };

function readForm(): Form {
	const form = JSON.parse( fs.readFileSync( path.join( OUT, 'form.json' ), 'utf8' ) ) as Form;
	// Pages the setup of the profile made (an Elementor page, a WooCommerce product, …).
	const extra = path.join( OUT, 'pages.json' );
	if ( fs.existsSync( extra ) ) {
		Object.assign( form.pages, JSON.parse( fs.readFileSync( extra, 'utf8' ) ) );
	}
	return form;
}

function write( name: string, data: unknown ): void {
	fs.mkdirSync( OUT, { recursive: true } );
	fs.writeFileSync( path.join( OUT, name ), JSON.stringify( data, null, '\t' ) + '\n' );
}

/** Errors of the page that come from the plugin (its scripts, its routes) and those of others. */
function split( errors: string[] ): { ours: string[]; others: string[] } {
	const ours = errors.filter( ( e ) => /funnelforms|ffx/i.test( e ) );
	return { ours, others: errors.filter( ( e ) => ! ours.includes( e ) ) };
}

test.describe( 'compatibility', () => {
	test( 'the form and its pages are published @prepare', async ( { page } ) => {
		await signIn( page );
		const api = await Api.of( page );
		const published = await publishTemplate( api, TEMPLATE, 'Compat Shortcode' );
		const block = await api.raw( 'POST', '/?rest_route=/wp/v2/pages', {
			title: 'Compat Block',
			status: 'publish',
			content: `<!-- wp:funnelforms/form {"formUid":"${ published.uid }"} /-->`,
		} );
		expect( block.status, JSON.stringify( block.body ) ).toBe( 201 );
		write( 'form.json', { id: published.id, uid: published.uid, pages: { shortcode: published.pageId, block: Number( block.body.id ) } } );
	} );

	test( 'the builder opens without errors', async ( { page } ) => {
		const form = readForm();
		await signIn( page );
		const errors = watchErrors( page );
		const failed: string[] = [];
		page.on( 'response', ( response ) => {
			const url = response.url();
			if ( /funnelforms(%2F|\/)v1/.test( url ) && response.status() >= 400 ) {
				failed.push( `${ response.status() } ${ url }` );
			}
		} );
		const response = await page.goto( `/wp-admin/admin.php?page=funnelforms-builder&form=${ form.id }` );
		expect( response?.status() ).toBe( 200 );
		await expect( page.locator( '#funnelforms-builder > *' ).first() ).toBeVisible();
		await page.waitForLoadState( 'networkidle' );
		// The builder shows the questions of the form.
		await expect( page.locator( '#funnelforms-builder' ) ).toContainText( /Umzug|move|moving/i );
		await page.screenshot( { path: path.join( OUT, 'builder.png' ) } );
		const text = await page.locator( 'body' ).innerText();
		expect( text ).not.toMatch( /Fatal error|Parse error|critical error/ );
		const { ours, others } = split( errors );
		write( 'builder.json', { ours, others, failed } );
		expect( failed, 'requests of the builder that failed' ).toEqual( [] );
		expect( ours, 'browser errors of the builder' ).toEqual( [] );
	} );

	for ( const label of [ 'shortcode', 'block', 'elementor', 'product' ] ) {
		test( `the form on the ${ label } page looks as without other plugins`, async ( { browser } ) => {
			const form = readForm();
			test.skip( ! form.pages[ label ], `no ${ label } page in this profile` );
			const context = await browser.newContext( { viewport: { width: 1280, height: 900 }, locale: 'de-DE' } );
			const page = await context.newPage();
			const errors = watchErrors( page );
			await page.goto( `/?page_id=${ form.pages[ label ] }` );
			await expect( page.locator( '.ffx-question' ).first() ).toBeVisible();
			// Which scripts and styles the page loads: shows whether an optimiser combined or deferred ours.
			write( `assets-${ label }.json`, await page.evaluate( () => ( {
				scripts: Array.from( document.scripts ).map( ( s ) => s.src || `inline ${ s.type || 'script' } ${ s.textContent?.length ?? 0 }` + ( s.defer ? ' defer' : '' ) + ( s.async ? ' async' : '' ) ),
				styles: Array.from( document.querySelectorAll( 'link[rel="stylesheet"]' ) ).map( ( l ) => ( l as HTMLLinkElement ).href ),
			} ) ) );
			const styles = await journey( page, label, true );
			write( `styles-${ label }.json`, styles );
			const { ours, others } = split( errors );
			write( `errors-${ label }.json`, { ours, others } );
			let diffs: Diff[] = [];
			// The same kind of page of the baseline; a page builder page against the shortcode page.
			const same = BASELINE && path.join( BASELINE, `styles-${ label }.json` );
			const baseline = same && fs.existsSync( same ) ? same : BASELINE && path.join( BASELINE, 'styles-shortcode.json' );
			if ( baseline && fs.existsSync( baseline ) ) {
				diffs = compare( JSON.parse( fs.readFileSync( baseline, 'utf8' ) ), styles );
				write( `diff-${ label }.json`, diffs );
			}
			await context.close();
			expect( ours, 'browser errors of the form' ).toEqual( [] );
			expect( diffs, 'styles that differ from WordPress without other plugins' ).toEqual( [] );
		} );

		test( `a visitor sends the form on the ${ label } page`, async ( { browser, page: admin } ) => {
			const form = readForm();
			test.skip( ! form.pages[ label ], `no ${ label } page in this profile` );
			await signIn( admin );
			const api = await Api.of( admin );
			const before = ( await api.call( 'GET', `entries?form=${ form.id }` ) ).body.length as number;
			const page = await visitor( browser );
			const errors = watchErrors( page );
			await page.goto( `/?page_id=${ form.pages[ label ] }` );
			await expect( page.locator( '.ffx-question' ).first() ).toBeVisible();
			await journey( page, label, false );
			await page.screenshot( { path: path.join( OUT, `sent-${ label }.png` ) } );
			await page.context().close();
			await expect.poll( async () => ( await api.call( 'GET', `entries?form=${ form.id }` ) ).body.length, { message: 'the entry arrives' } ).toBe( before + 1 );
			expect( split( errors ).ours, 'browser errors of the form' ).toEqual( [] );
		} );
	}

	test( 'a visitor of the cached page sends the form', async ( { browser, page: admin } ) => {
		test.skip( ! CACHED, 'no page cache in this profile' );
		const form = readForm();
		// The first visitors fill the cache, the next one gets the page from it.
		const url = `/?page_id=${ form.pages.shortcode }`;
		for ( let i = 0; i < 2; i++ ) {
			const warm = await visitor( browser );
			await warm.goto( url );
			await warm.context().close();
		}
		const page = await visitor( browser );
		const errors = watchErrors( page );
		const response = await page.goto( url );
		const headers = response?.headers() ?? {};
		const html = ( await response?.text() ) ?? '';
		write( 'cache.json', {
			headers: Object.fromEntries( Object.entries( headers ).filter( ( [ k ] ) => /cache|litespeed|rocket|x-/i.test( k ) ) ),
			marker: ( html.match( /<!--[^>]*(cache|rocket|litespeed|super|w3 total|autoptimize)[^>]*-->/gi ) ?? [] ).slice( 0, 5 ),
		} );
		await expect( page.locator( '.ffx-question' ).first() ).toBeVisible();
		await signIn( admin );
		const api = await Api.of( admin );
		const before = ( await api.call( 'GET', `entries?form=${ form.id }` ) ).body.length as number;
		await journey( page, 'cached', false );
		await page.context().close();
		await expect.poll( async () => ( await api.call( 'GET', `entries?form=${ form.id }` ) ).body.length, { message: 'the entry arrives' } ).toBe( before + 1 );
		expect( split( errors ).ours, 'browser errors of the form' ).toEqual( [] );
	} );
} );

/** Elements of the form whose look is compared, and the properties that count. */
const PROBES: Array<[ string, string ]> = [
	[ 'form', '.ffx-form' ],
	[ 'question', '.ffx-question' ],
	[ 'option', '.ffx-option' ],
	[ 'option icon', '.ffx-option .ffx-option-icon, .ffx-option .ffx-option-media' ],
	[ 'option label', '.ffx-option .ffx-option-label' ],
	[ 'button next', '.ffx-button-next' ],
	[ 'button back', '.ffx-button-back' ],
	[ 'slider', '.ffx-slider, input[type="range"]' ],
	[ 'input', '.ffx-contact input.ffx-input:not([type="tel"]), .ffx-field input[type="text"]' ],
	[ 'input icon', '.ffx-input-icon' ],
	[ 'phone', 'input[type="tel"]' ],
	[ 'phone country', '.ffx-contact select, .ffx-phone select, .ffx-field select' ],
	[ 'checkbox', '.ffx-field input[type="checkbox"]' ],
	[ 'button submit', '.ffx-button-submit' ],
	[ 'list item', '.ffx-form li' ],
	[ 'progress', '.ffx-progress-bar, .ffx-progress' ],
];

const PROPS = [
	'display', 'position', 'box-sizing', 'flex-direction', 'align-items', 'justify-content',
	'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'border-top-width', 'border-top-style', 'border-radius',
	'font-size', 'font-weight', 'line-height', 'text-transform', 'letter-spacing', 'text-align', 'white-space',
	'color', 'background-color', 'background-image', 'box-shadow', 'outline-style',
	'list-style-type', 'appearance', 'opacity', 'visibility', 'font-family',
];

type Snapshot = Record<string, Record<string, string>>;
type Diff = { element: string; property: string; baseline: string; here: string };

/**
 * Goes through the form as a visitor and sends it: picks the first answer of every question, fills
 * the fields of a step (postcode, date, contact data, consent) and goes on, until the thank-you
 * screen shows. With `capture` it takes the computed styles of every probe the first time it shows,
 * plus facts of the layout (icon above the label, label inside the tile, text clear of the icon of a
 * field), and screenshots of the first step and the contact step.
 */
async function journey( page: Page, label: string, capture: boolean ): Promise<Snapshot> {
	const snapshot: Snapshot = {};
	for ( let round = 0; round < 30; round++ ) {
		await page.waitForTimeout( 350 );
		if ( await page.locator( '.ffx-success:visible' ).count() ) {
			return snapshot;
		}
		if ( capture ) {
			for ( const [ name, values ] of Object.entries( await measure( page ) ) ) {
				snapshot[ name ] ??= values;
			}
			if ( 0 === round ) {
				await page.screenshot( { path: path.join( OUT, `form-${ label }-1.png` ) } );
			}
		}
		await fillStep( page );
		const submit = page.locator( '.ffx-button-submit:visible' ).first();
		if ( await submit.count() ) {
			if ( capture ) {
				await submit.scrollIntoViewIfNeeded();
				for ( const [ name, values ] of Object.entries( await measure( page ) ) ) {
					snapshot[ name ] ??= values;
				}
				await page.screenshot( { path: path.join( OUT, `form-${ label }-contact.png` ) } );
			}
			await submit.click();
			await expect( page.locator( '.ffx-success' ).first() ).toBeVisible();
			return snapshot;
		}
		const before = await position( page );
		let moved = false;
		for ( const field of await page.locator( '.ffx-field:visible' ).all() ) {
			const options = field.locator( '[data-option]' );
			if ( ( await options.count() ) > 0 && 0 === ( await field.locator( '[data-option][aria-pressed="true"], [data-option][aria-checked="true"], input:checked' ).count() ) ) {
				await options.first().click();
				await page.waitForTimeout( 350 );
				if ( ( await position( page ) ) !== before ) {
					moved = true;
					break;
				}
			}
		}
		if ( ! moved && ( await position( page ) ) === before ) {
			// A content step (the estimate of the moving form) goes on with its own button.
			const next = page.locator( '.ffx-button-next:visible, .ffx-content-button:visible' ).first();
			if ( ! ( await next.count() ) ) {
				break;
			}
			await next.click();
		}
	}
	throw new Error( 'The form did not reach its thank-you screen in 30 rounds.' );
}

/** Where the visitor is: the questions on screen. */
async function position( page: Page ): Promise<string> {
	return ( await page.locator( '.ffx-question:visible, .ffx-step:visible' ).allInnerTexts() ).join( '|' );
}

/** Gives every empty field of the step a value a visitor would type. */
async function fillStep( page: Page ): Promise<void> {
	// Not the honeypot (name website, tabindex -1): a visitor never sees it, and a filled one is spam.
	for ( const input of await page.locator( '.ffx-form input:visible:not([tabindex="-1"]), .ffx-form textarea:visible' ).all() ) {
		const type = ( ( await input.getAttribute( 'type' ) ) ?? 'text' ).toLowerCase();
		if ( 'checkbox' === type || 'radio' === type ) {
			// Answers in tiles are picked as options; a consent box is ticked as a visitor clicks it.
			const inOption = await input.evaluate( ( el ) => !! el.closest( '[data-option]' ) );
			const group = await input.getAttribute( 'name' );
			const taken = 'radio' === type && group && ( await page.locator( `.ffx-form input[name="${ group }"]:checked` ).count() );
			if ( ! inOption && ! taken && ! ( await input.isChecked() ) ) {
				await input.evaluate( ( el ) => ( el as HTMLInputElement ).click() );
			}
			continue;
		}
		if ( [ 'range', 'hidden', 'submit', 'button', 'file' ].includes( type ) || ( await input.inputValue() ) ) {
			continue;
		}
		const hints = [ 'inputmode', 'autocomplete', 'name', 'placeholder', 'pattern', 'aria-label' ];
		const hint = ( await Promise.all( hints.map( ( h ) => input.getAttribute( h ) ) ) ).join( ' ' ).toLowerCase();
		let value = 'Erika';
		if ( 'email' === type || hint.includes( 'mail' ) ) {
			value = `compat-${ Date.now() }@example.org`;
		} else if ( 'tel' === type ) {
			value = '0151 23456789';
		} else if ( 'date' === type ) {
			value = new Date( Date.now() + 21 * 864e5 ).toISOString().slice( 0, 10 );
		} else if ( 'number' === type ) {
			value = '3';
		} else if ( /numeric|postal|plz|zip|\d{5}/.test( hint ) ) {
			value = '10115';
		} else if ( hint.includes( 'family' ) ) {
			value = 'Muster';
		} else if ( 'textarea' === ( await input.evaluate( ( el ) => el.tagName.toLowerCase() ) ) ) {
			value = 'Test der Kompatibilität';
		}
		await input.fill( value );
	}
	for ( const select of await page.locator( '.ffx-form select:visible' ).all() ) {
		if ( ! ( await select.inputValue() ) ) {
			const values = await select.locator( 'option' ).evaluateAll( ( options ) => options.map( ( o ) => ( o as HTMLOptionElement ).value ).filter( Boolean ) );
			const first = values[ 0 ];
			if ( first ) {
				await select.selectOption( first );
			}
		}
	}
}

/** Computed styles of the probes on screen and facts of the layout. */
async function measure( page: Page ): Promise<Snapshot> {
	return page.evaluate( ( [ probes, props ] ) => {
		const result: Record<string, Record<string, string>> = {};
		// What the page's text has from the theme: the form follows it where it sets nothing itself.
		const body = getComputedStyle( document.body );
		result.body = Object.fromEntries( [ 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height' ].map( ( p ) => [ p, body.getPropertyValue( p ) ] ) );
		const visible = ( el: Element ) => {
			const r = el.getBoundingClientRect();
			return r.width > 0 && r.height > 0 && 'hidden' !== getComputedStyle( el ).visibility;
		};
		for ( const [ name, selector ] of probes as Array<[ string, string ]> ) {
			const el = Array.from( document.querySelectorAll( selector ) ).find( visible );
			if ( ! el ) {
				continue;
			}
			const style = getComputedStyle( el );
			const values: Record<string, string> = {};
			for ( const prop of props as string[] ) {
				values[ prop ] = style.getPropertyValue( prop );
			}
			result[ name ] = values;
		}
		const option = Array.from( document.querySelectorAll( '.ffx-option' ) ).find( visible );
		if ( option ) {
			const icon = option.querySelector( '.ffx-option-icon, .ffx-option-media' );
			const text = option.querySelector( '.ffx-option-label' ) as HTMLElement | null;
			const box = option.getBoundingClientRect();
			const facts: Record<string, string> = {};
			if ( icon && text ) {
				facts[ 'icon above label' ] = String( icon.getBoundingClientRect().bottom <= text.getBoundingClientRect().top + 2 );
			}
			if ( text ) {
				const t = text.getBoundingClientRect();
				facts[ 'label inside tile' ] = String( t.left >= box.left - 1 && t.right <= box.right + 1 && text.scrollWidth <= text.clientWidth + 1 );
			}
			result[ 'option layout' ] = facts;
		}
		const iconOfInput = Array.from( document.querySelectorAll( '.ffx-input-icon' ) ).find( visible );
		const input = iconOfInput?.closest( '.ffx-input-wrap, .ffx-field' )?.querySelector( 'input' );
		if ( iconOfInput && input ) {
			const i = iconOfInput.getBoundingClientRect();
			const r = input.getBoundingClientRect();
			const s = getComputedStyle( input );
			// The text starts after an icon on the left, or ends before one on the right.
			const clear = i.left < r.left + r.width / 2 ? r.left + parseFloat( s.paddingLeft ) >= i.right - 1 : r.right - parseFloat( s.paddingRight ) <= i.left + 1;
			result[ 'input layout' ] = { 'text clear of icon': String( clear ) };
		}
		return result;
	}, [ PROBES, PROPS ] as const );
}

/**
 * Differences to the baseline. The font family follows the theme on purpose when the form has none
 * of its own, and the outer margins of the form are the theme's; both are left out, and so is a text
 * property that equals the body text of the theme on both sites (the form sets none of its own there,
 * e.g. the light weight of Twenty Twenty-Five). Everything else should not change with another plugin
 * or theme.
 */
function compare( baseline: Snapshot, here: Snapshot ): Diff[] {
	const diffs: Diff[] = [];
	const inherited = ( snapshot: Snapshot, element: string, property: string ) => snapshot.body?.[ property ] !== undefined && snapshot[ element ]?.[ property ] === snapshot.body[ property ];
	for ( const [ element, values ] of Object.entries( baseline ) ) {
		if ( 'body' === element ) {
			continue;
		}
		const other = here[ element ];
		if ( ! other ) {
			diffs.push( { element, property: '(element)', baseline: 'shown', here: 'missing' } );
			continue;
		}
		for ( const [ property, value ] of Object.entries( values ) ) {
			// Where the form sits on the page (its outer margins) is up to the theme and the page builder.
			if ( 'font-family' === property || ( 'form' === element && property.startsWith( 'margin-' ) ) ) {
				continue;
			}
			// Text properties the form does not set: on both sites as the theme's body text.
			if ( inherited( baseline, element, property ) && inherited( here, element, property ) ) {
				continue;
			}
			const mine = other[ property ] ?? '';
			const a = parseFloat( value );
			const b = parseFloat( mine );
			const numeric = /^-?[\d.]+px$/.test( value ) && /^-?[\d.]+px$/.test( mine );
			if ( numeric ? Math.abs( a - b ) > 1 : value !== mine ) {
				diffs.push( { element, property, baseline: value, here: mine } );
			}
		}
	}
	return diffs;
}
