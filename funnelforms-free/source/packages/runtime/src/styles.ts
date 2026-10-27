/**
 * Parts of the runtime not every form needs: the second style sheet (runtime-more.css), the look of
 * field types and features not every form has, and the scripts of such features, the chunks
 * (runtime-<name>.js from src/chunks: live results, phone fields, reminders to visitors who leave, the field types address, booking and repeat). The plugin marks the forms that
 * need them (data-ffx-more, data-ffx-chunks="live phone", Frontend\Renderer) and enqueues them on
 * its pages; where a form is shown otherwise (builder preview, pages loaded later) the runtime adds
 * them here. reCAPTCHA v3 (runtime-recaptcha3.js) loads like a captcha provider, on consent
 * (contact.ts), from the address the plugin gives (Renderer::chunk_url()).
 */

/** The runtime's own address, read while the script runs for the first time. */
const script = typeof document !== 'undefined' ? ( document.currentScript as HTMLScriptElement | null )?.src ?? '' : '';

/** Adds runtime-<name>.css or .js to the page once, next to runtime.js, unless it is there already (the id WordPress gives it). */
export function addPart( name: string, ext: 'css' | 'js' ): void {
	const id = `funnelforms-runtime-${ name }-${ ext }`;
	if ( /runtime\.js/.test( script ) && ! document.getElementById( id ) ) {
		const url = script.replace( /runtime\.js/, `runtime-${ name }.${ ext }` );
		const el = ext === 'js' ? Object.assign( document.createElement( 'script' ), { src: url } ) : Object.assign( document.createElement( 'link' ), { rel: 'stylesheet', href: url } );
		el.id = id;
		document.head.append( el );
	}
}

/**
 * Fields whose code lies in a chunk (runtime-phone.js: phone fields with a country picker). The core
 * pushes [input, field, context] of such fields; the chunk replaces the list with its own object,
 * takes over the inputs and checks their values (check(): undefined for fields it leaves to the core).
 */
export const chunk = (): Array<unknown> & { check?( field: unknown, value: unknown ): string | undefined } => ( ( window as unknown as { ffxChunk: [] } ).ffxChunk ??= [] );
