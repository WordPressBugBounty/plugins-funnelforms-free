type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

/** Creates an element; false, null and undefined attributes are left out. */
export function h<K extends keyof HTMLElementTagNameMap>( tag: K, attrs: Attrs = {}, ...children: Child[] ): HTMLElementTagNameMap[ K ] {
	const el = document.createElement( tag );
	for ( const [ name, value ] of Object.entries( attrs ) ) {
		if ( value === false || value === null || value === undefined ) {
			continue;
		}
		el.setAttribute( name, value === true ? '' : String( value ) );
	}
	for ( const child of children ) {
		if ( child !== null && child !== undefined && child !== false ) {
			el.append( child );
		}
	}
	return el;
}

/**
 * Element with HTML that the plugin already sanitized (wp_kses in PublicDocument::from()). Only for
 * texts the plugin cleans; a text it does not clean is shown with h() or textOf() as text.
 */
export function trusted<K extends keyof HTMLElementTagNameMap>( tag: K, html: string, attrs: Attrs = {} ): HTMLElementTagNameMap[ K ] {
	const el = h( tag, attrs );
	el.innerHTML = html;
	return el;
}

/**
 * Plain text of HTML, for labels in summaries and texts shown as text. Parsed in a template, whose
 * content is inert: an <img onerror> in it never loads or runs, unlike in a detached element.
 */
export function textOf( html: string ): string {
	const template = document.createElement( 'template' );
	template.innerHTML = html;
	return ( template.content.textContent ?? '' ).trim();
}

/** HTML-escapes visitor input. */
export function escapeHtml( text: string ): string {
	return text.replace( /[&<>"']/g, ( c ) => `&#${ c.charCodeAt( 0 ) };` );
}

let counter = 0;
/** A document-unique id for labels and descriptions. */
export function uniqueId( prefix: string ): string {
	counter += 1;
	return `ffx-${ prefix }-${ counter }`;
}
