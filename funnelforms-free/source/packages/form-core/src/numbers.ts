/**
 * Number semantics of the browser, mirrored by JsNumber in the plugin (plugin/src/Domain/Form).
 * NaN results are kept as NaN; comparisons with NaN are false except "not equal".
 */

/** String(value) for the values an answer can hold. */
export function toText( value: unknown ): string {
	if ( value === null || value === undefined ) {
		return '';
	}
	if ( Array.isArray( value ) ) {
		return value.map( toText ).join( ',' );
	}
	return String( value );
}

/** parseInt(text) without a radix, as 3.x used it ("0x" reads hex). */
export function toInt( value: unknown ): number {
	return parseInt( toText( value ) );
}

/** parseFloat(text). */
export function toFloat( value: unknown ): number {
	return parseFloat( toText( value ) );
}
