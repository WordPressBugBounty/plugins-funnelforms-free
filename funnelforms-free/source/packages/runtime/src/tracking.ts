import { allowed } from './consent';

/**
 * Tracking code the site owner attached to steps and the contact step in 3.x (conversion pixels,
 * gtag calls). The plugin sends it only when the owner allowed it on the site; it runs once per
 * step and page view, in a hidden box of the form, and only where marketing is allowed (allowed()).
 */
export function runCode( box: HTMLElement, code: string | undefined ): void {
	if ( ! code || ! code.trim() || ! allowed( 'marketing' ) ) {
		return;
	}
	// 3.x ran the after-submit code with eval(), so plain JavaScript without tags is common.
	const html = /<[a-z!/]/i.test( code ) ? code : `<script>${ code }</script>`;
	const template = document.createElement( 'template' );
	template.innerHTML = html;
	activateScripts( template.content );
	box.append( template.content );
}

/**
 * Scripts parsed from HTML (innerHTML) never run; copies made with createElement run once they are
 * in the page. The plugin sends scripts in content only when the site allows them.
 */
export function activateScripts( root: ParentNode ): void {
	root.querySelectorAll( 'script' ).forEach( ( old ) => {
		const script = document.createElement( 'script' );
		for ( const attr of [ ...old.attributes ] ) {
			script.setAttribute( attr.name, attr.value );
		}
		script.text = old.text;
		old.replaceWith( script );
	} );
}
