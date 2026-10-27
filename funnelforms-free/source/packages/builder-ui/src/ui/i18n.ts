/**
 * Texts of the builder through WordPress's i18n (wp.i18n), with the plugin's text domain.
 * tools/i18n.py finds the calls of __() with the plugin's text domain and writes the JSON catalogs.
 */
interface WpI18n {
	__( text: string, domain: string ): string;
	sprintf( format: string, ...args: Array<string | number> ): string;
}

const wpI18n = (): WpI18n | undefined => ( globalThis as { wp?: { i18n?: WpI18n } } ).wp?.i18n;

export function __( text: string, domain: 'funnelforms-pro' ): string {
	return wpI18n()?.__( text, domain ) ?? text;
}

/**
 * Replaces %s and %d in order, and %1$s, %2$d … by position (translations may reorder them);
 * %% is a percent sign.
 */
export function sprintf( format: string, ...args: Array<string | number> ): string {
	let i = 0;
	return format.replace( /%(?:(\d+)\$)?([sd%])/g, ( _match, position: string | undefined, type: string ) => {
		if ( '%' === type ) {
			return '%';
		}
		const value = undefined === position ? args[ i++ ] : args[ Number( position ) - 1 ];
		return String( value ?? '' );
	} );
}
