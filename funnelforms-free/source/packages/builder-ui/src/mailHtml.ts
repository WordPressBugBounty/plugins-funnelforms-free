/**
 * HTML of mail texts in the visual editor. Mails are HTML; with "Keep line breaks" (nl2br, the
 * 3.x default) the plugin turns line breaks into <br>, so the editor shows them as <br> and writes
 * none back. Whatever goes into the editor is cleaned first: it is rendered in the admin, and a
 * mail needs no scripts, frames or event handlers.
 */

const DROP = new Set( [ 'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT' ] );

/** Addresses a link or image may have: web, mail and phone links, and placeholders. */
export function safeUrl( url: string ): boolean {
	// Browsers skip control characters and spaces inside a scheme ("java\tscript:").
	const value = [ ...url ].filter( ( c ) => c.charCodeAt( 0 ) > 32 ).join( '' ).toLowerCase();
	return '' === value || value.startsWith( '{{' ) || /^(https?:|mailto:|tel:|#|\/)/.test( value ) || ! /^[a-z][a-z0-9+.-]*:/.test( value );
}

function clean( node: ParentNode ): void {
	for ( const child of [ ...node.children ] ) {
		if ( DROP.has( child.tagName.toUpperCase() ) ) {
			child.remove();
			continue;
		}
		for ( const attr of [ ...child.attributes ] ) {
			const name = attr.name.toLowerCase();
			if ( name.startsWith( 'on' ) || ( [ 'href', 'src', 'action', 'formaction', 'xlink:href', 'srcset' ].includes( name ) && ! safeUrl( attr.value ) ) ) {
				child.removeAttribute( attr.name );
			}
		}
		clean( child );
	}
}

/** HTML without scripts, frames, form controls, event handlers and script addresses. */
export function cleanHtml( html: string ): string {
	// The content of a template is inert: nothing in it loads or runs.
	const template = document.createElement( 'template' );
	template.innerHTML = html;
	clean( template.content );
	return template.innerHTML;
}

/** What the editor shows for a stored text. */
export function toVisual( value: string, nl2br: boolean ): string {
	return cleanHtml( nl2br ? value.replace( /\r?\n/g, '<br>' ) : value );
}

/** What is stored for the editor's HTML. */
export function fromVisual( html: string, nl2br: boolean ): string {
	const out = html.replace( /<br>$/, '' );
	return nl2br ? out.replace( /\r?\n/g, ' ' ) : out;
}

/** Escaped text, its line breaks as <br>: what a paste becomes. */
export function textToHtml( text: string ): string {
	return text.replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /\r?\n/g, '<br>' );
}
