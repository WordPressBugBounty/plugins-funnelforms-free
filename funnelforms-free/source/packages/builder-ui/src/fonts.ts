/**
 * Fonts a form can name without a file: the generic families and font stacks of fonts most
 * devices already have (Frontend\FormFont::STACKS, keep both the same), and the CSS family the
 * plugin writes for a font token, so the builder can draw a theme in its fonts.
 */

/** Font stacks by name: a look of its own without loading a font (each under 100 characters). */
export const FONT_STACKS: Record<string, string> = {
	'serif-classic': '"Iowan Old Style","Palatino Linotype",Palatino,"URW Palladio L",P052,Georgia,serif',
	'serif-modern': 'Didot,"Bodoni MT","Noto Serif Display","Big Caslon",Georgia,serif',
	'sans-humanist': 'Seravek,"Gill Sans Nova",Ubuntu,Calibri,"DejaVu Sans",source-sans-pro,sans-serif',
	'sans-geometric': 'Avenir,"Avenir Next","Century Gothic",Corbel,"URW Gothic",source-sans-pro,sans-serif',
	rounded: 'ui-rounded,"Hiragino Maru Gothic ProN",Quicksand,Comfortaa,"Arial Rounded MT",Calibri,sans-serif',
	slab: 'Rockwell,"Rockwell Nova","Roboto Slab","DejaVu Serif","Sitka Small",serif',
	condensed: 'Bahnschrift,"DIN Alternate","Franklin Gothic Medium","Nimbus Sans Narrow",sans-serif',
	'mono-code': 'ui-monospace,"Cascadia Code","Source Code Pro",Menlo,Consolas,"DejaVu Sans Mono",monospace',
};

const GENERIC = [ 'inherit', 'serif', 'sans-serif', 'cursive', 'fantasy', 'monospace', 'system-ui' ];

/** Fonts the plugin bundles (plugin/fonts). */
export const BUNDLED_FONTS = [ 'Montserrat', 'Poppins' ];

/** The CSS font-family of a font token, as Frontend\FormFont::resolve() writes it; '' when unusable. */
export function fontFamilyCss( value: string ): string {
	const v = value.trim();
	if ( GENERIC.includes( v.toLowerCase() ) ) {
		return v.toLowerCase();
	}
	const stack = FONT_STACKS[ v ];
	if ( stack ) {
		return stack;
	}
	const bundled = BUNDLED_FONTS.find( ( f ) => f.toLowerCase() === v.toLowerCase() );
	if ( bundled ) {
		return `"${ bundled }", sans-serif`;
	}
	const file = /^([A-Za-z0-9 _-]{1,60})\.(ttf|otf|woff2?)$/i.exec( v );
	if ( file ) {
		return `"${ ( file[ 1 ] ?? '' ).trim() }", sans-serif`;
	}
	return /^[A-Za-z0-9 _-]{1,60}$/.test( v ) ? `"${ v }", sans-serif` : '';
}
