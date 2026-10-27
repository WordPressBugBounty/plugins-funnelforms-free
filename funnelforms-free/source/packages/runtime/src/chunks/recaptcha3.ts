/**
 * Google reCAPTCHA v3 (invisible) for the captcha field of a contact step, as a chunk the runtime
 * loads like a provider script (runtime-recaptcha3.js, only for forms whose site protection is
 * reCAPTCHA v3, after the visitor's consent). It offers the same render() and reset() as the
 * other providers: render() loads Google's script with the site key and hands the field a fresh
 * answer at once and every 100 seconds, since an answer of v3 is valid for two minutes. Google's
 * badge shows instead of a box. The plugin checks the answer's score and puts low ones into the
 * spam folder.
 */

interface Grecaptcha3 {
	ready( callback: () => void ): void;
	execute( siteKey: string, options: { action: string } ): Promise<string>;
}

type Options = { sitekey: string; callback: ( token: string ) => void };

const REFRESH_MS = 100000;

let script: Promise<Grecaptcha3> | undefined;

function google( siteKey: string ): Promise<Grecaptcha3> {
	script ??= new Promise( ( resolve, reject ) => {
		const tag = document.createElement( 'script' );
		tag.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent( siteKey );
		tag.async = true;
		tag.onload = () => {
			const api = ( window as unknown as { grecaptcha?: Grecaptcha3 } ).grecaptcha;
			if ( api ) {
				api.ready( () => resolve( api ) );
			} else {
				reject( new Error( 'recaptcha3' ) );
			}
		};
		tag.onerror = () => reject( new Error( 'recaptcha3' ) );
		document.head.append( tag );
	} );
	return script;
}

const widgets: Array<() => void> = [];

const api = {
	render( _box: HTMLElement, options: Options ): number {
		let timer = 0;
		// A fresh answer now and before the last one expires; reset() starts over.
		const run = (): void => {
			clearTimeout( timer );
			timer = window.setTimeout( run, REFRESH_MS );
			void google( options.sitekey )
				.then( ( g ) => g.execute( options.sitekey, { action: 'submit' } ) )
				.then( options.callback, () => options.callback( '' ) );
		};
		run();
		return widgets.push( run ) - 1;
	},
	reset( id?: unknown ): void {
		widgets[ Number( id ) ]?.();
	},
};

const win = window as unknown as { ffxRecaptcha3?: typeof api; ffxRecaptcha3Ready?: () => void };
win.ffxRecaptcha3 = api;
win.ffxRecaptcha3Ready?.();

// A module, so its names stay its own.
export {};
