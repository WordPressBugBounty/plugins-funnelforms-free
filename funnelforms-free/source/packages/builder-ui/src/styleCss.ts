/**
 * The CSS variables and classes of a form's style tokens, as the plugin writes them on the form's
 * element (Frontend\StyleTokens::css() and ::classes(); keep both the same, test/style-vectors.json
 * checks them against each other). The builder uses it to show a theme in the live preview while
 * the pointer rests on it, before anything is saved. Fonts other than those of fonts.ts and the
 * background image are left to the plugin.
 */
import { fontFamilyCss } from './fonts';
import type { StyleTokens } from './themes';

type Kind = 'color' | 'font' | 'px' | 'number' | 'name' | 'image';

const TOKENS: Array<[ string, string, Kind ]> = [
	[ 'color.primary', '--ffx-color-primary', 'color' ],
	[ 'color.onPrimary', '--ffx-color-on-primary', 'color' ],
	[ 'color.background', '--ffx-color-background', 'color' ],
	[ 'color.text', '--ffx-color-text', 'color' ],
	[ 'color.muted', '--ffx-color-muted', 'color' ],
	[ 'color.border', '--ffx-color-border', 'color' ],
	[ 'color.error', '--ffx-color-error', 'color' ],
	[ 'color.backgroundEnd', '--ffx-color-background-end', 'color' ],
	[ 'color.heading', '--ffx-color-heading', 'color' ],
	[ 'color.button', '--ffx-color-button', 'color' ],
	[ 'color.onButton', '--ffx-color-on-button', 'color' ],
	[ 'color.back', '--ffx-color-back', 'color' ],
	[ 'color.onBack', '--ffx-color-on-back', 'color' ],
	[ 'color.progress', '--ffx-color-progress', 'color' ],
	[ 'color.progressTrack', '--ffx-color-progress-track', 'color' ],
	[ 'color.option', '--ffx-color-option', 'color' ],
	[ 'color.optionSelected', '--ffx-color-option-selected', 'color' ],
	[ 'color.icon', '--ffx-color-icon', 'color' ],
	[ 'color.overlay', '--ffx-color-overlay', 'color' ],
	[ 'font.family', '--ffx-font-family', 'font' ],
	[ 'font.heading', '--ffx-font-heading', 'font' ],
	[ 'font.field', '--ffx-font-field', 'font' ],
	[ 'font.size', '--ffx-font-size', 'px' ],
	[ 'font.size.mobile', '--ffx-font-size-mobile', 'px' ],
	[ 'font.size.heading', '--ffx-font-size-heading', 'px' ],
	[ 'font.size.heading.mobile', '--ffx-font-size-heading-mobile', 'px' ],
	[ 'font.size.field', '--ffx-font-size-field', 'px' ],
	[ 'font.size.field.mobile', '--ffx-font-size-field-mobile', 'px' ],
	[ 'font.weight.heading', '--ffx-font-weight-heading', 'name' ],
	[ 'line.heading', '--ffx-line-heading', 'number' ],
	[ 'line.body', '--ffx-line-body', 'number' ],
	[ 'radius.card', '--ffx-radius-card', 'px' ],
	[ 'radius.input', '--ffx-radius-input', 'px' ],
	[ 'radius.button', '--ffx-radius-button', 'px' ],
	[ 'space.gap', '--ffx-gap', 'px' ],
	[ 'space.padding', '--ffx-padding', 'px' ],
	[ 'space.button', '--ffx-button-padding', 'px' ],
	[ 'size.icon', '--ffx-icon-size', 'px' ],
	[ 'size.icon.mobile', '--ffx-icon-size-mobile', 'px' ],
	[ 'border.width', '--ffx-border-width', 'px' ],
	[ 'border.style', '--ffx-border-style', 'name' ],
	[ 'border.container', '--ffx-container-border', 'name' ],
	[ 'shadow', '--ffx-shadow', 'name' ],
	[ 'tile.shadow', '--ffx-rest', 'name' ],
	[ 'button.shadow', '--ffx-button-shadow', 'name' ],
	[ 'animation', '--ffx-step-animation', 'name' ],
	[ 'align.text', '--ffx-text-align', 'name' ],
	[ 'button.align', '--ffx-button-align', 'name' ],
	[ 'background.angle', '--ffx-background-angle', 'number' ],
	[ 'background.image', '--ffx-background-image', 'image' ],
	[ 'background.size', '--ffx-background-size', 'name' ],
	[ 'background.position', '--ffx-background-position', 'name' ],
];

const NAMED: Record<string, Record<string, string>> = {
	shadow: {
		none: 'none',
		soft: '0 1px 3px rgba(16,24,40,0.08),0 8px 24px rgba(16,24,40,0.08)',
		medium: '0 2px 6px rgba(16,24,40,0.08),0 12px 32px rgba(16,24,40,0.12)',
		strong: '0 4px 8px rgba(16,24,40,0.1),0 20px 48px rgba(16,24,40,0.18)',
	},
	'tile.shadow': {
		none: 'none',
		soft: '0 1px 2px rgb(16 24 40 / 0.06),0 10px 24px -10px rgb(16 24 40 / 0.18)',
		lifted: '0 2px 4px rgb(16 24 40 / 0.06),0 18px 36px -14px rgb(16 24 40 / 0.3)',
		hard: '4px 4px 0 var(--ffx-color-text)',
	},
	'button.shadow': {
		none: 'none',
		glow: '0 10px 24px -8px color-mix(in srgb,var(--ffx-color-button,var(--ffx-color-primary)) 70%,transparent)',
		hard: '4px 4px 0 var(--ffx-color-text)',
	},
	animation: {
		none: 'none',
		fade: 'ffx-fade 0.3s ease-out',
		slide: 'ffx-slide 0.3s ease-out',
		fadeRight: 'ffx-fade-right 0.4s ease-out',
		backInRight: 'ffx-back-in-right 0.5s cubic-bezier(0.34,1.56,0.64,1)',
		up: 'ffx-up 0.35s ease-out',
		zoom: 'ffx-zoom 0.3s ease-out',
	},
	'font.weight.heading': { normal: '400', medium: '500', semibold: '600', bold: '700' },
	'border.style': { solid: 'solid', dashed: 'dashed', dotted: 'dotted', none: 'none' },
	'border.container': { on: 'var(--ffx-border-width,1px) var(--ffx-border-style,solid) var(--ffx-color-border)' },
	'align.text': { left: 'left', center: 'center', right: 'right' },
	'button.align': { apart: 'space-between', center: 'center', end: 'flex-end', full: 'stretch' },
	'background.size': { cover: 'cover', contain: 'contain', auto: 'auto' },
	'background.position': { center: 'center', top: 'top', bottom: 'bottom' },
};

const NUMBERS: Record<string, [ number, number ]> = { 'line.heading': [ 1, 3 ], 'line.body': [ 1, 3 ], 'background.angle': [ 0, 360 ] };

/** A number as PHP writes a float in a string (no trailing zeros). */
function phpNumber( n: number ): string {
	return String( Number.isInteger( n ) ? n : Number( n.toPrecision( 14 ) ) );
}

function value( token: string, kind: Kind, raw: string ): string {
	let v = raw;
	switch ( kind ) {
		case 'name':
			return NAMED[ token ]?.[ v ] ?? '';
		case 'image':
			// The plugin looks up the attachment's address; the preview keeps the one it has.
			return '';
		case 'font':
			v = fontFamilyCss( v );
			break;
		case 'number': {
			if ( ! /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test( v ) ) {
				return '';
			}
			const [ min, max ] = NUMBERS[ token ] ?? [ 0, 0 ];
			const n = phpNumber( Math.max( min, Math.min( max, Number( v ) ) ) );
			return 'background.angle' === token ? n + 'deg' : n;
		}
		case 'color':
			if ( ! /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([0-9.,%\s/]{1,60}\)|[a-zA-Z]{3,20})$/.test( v ) ) {
				return '';
			}
			break;
	}
	if ( '' === v || ! /^[#a-zA-Z0-9(),.%\s'"/-]{1,100}$/.test( v ) || /(url|image|image-set|element|expression)\s*\(/i.test( v ) ) {
		return '';
	}
	if ( 'px' === kind && /^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/.test( v ) ) {
		v = phpNumber( Math.max( 0, Math.min( 400, Number( v ) ) ) ) + 'px';
	}
	return v;
}

function clamp( raw: string | undefined, min: number, max: number, fallback: number ): string {
	const n = Number.parseInt( raw ?? '', 10 );
	return ( /^\s*-?\d+(\.\d+)?\s*$/.test( raw ?? '' ) && Number.isFinite( n ) ? Math.max( min, Math.min( max, n ) ) : fallback ) + 'px';
}

type Rgb = [ number, number, number ];

function rgb( color: string ): Rgb | null {
	let c = color;
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec( c );
	if ( short ) {
		c = '#' + short[ 1 ] + short[ 1 ] + short[ 2 ] + short[ 2 ] + short[ 3 ] + short[ 3 ];
	}
	const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec( c );
	if ( long ) {
		return [ parseInt( long[ 1 ] ?? '0', 16 ), parseInt( long[ 2 ] ?? '0', 16 ), parseInt( long[ 3 ] ?? '0', 16 ) ];
	}
	const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec( c );
	return fn ? [ Math.min( 255, Number( fn[ 1 ] ) ), Math.min( 255, Number( fn[ 2 ] ) ), Math.min( 255, Number( fn[ 3 ] ) ) ] : null;
}

function luminance( [ r, g, b ]: Rgb ): number {
	const c = ( n: number ): number => ( n / 255 <= 0.04045 ? n / 255 / 12.92 : ( ( n / 255 + 0.055 ) / 1.055 ) ** 2.4 );
	return 0.2126 * c( r ) + 0.7152 * c( g ) + 0.0722 * c( b );
}

/** The border of fields and answer cards, 3:1 against the background (StyleTokens::field_border()). */
export function fieldBorder( tokens: StyleTokens ): string {
	const color = ( token: string, fallback: string ): Rgb | null => {
		const v = ( tokens[ token ] ?? '' ).trim().toLowerCase();
		return rgb( '' === v ? fallback : v );
	};
	const backgrounds = [ color( 'color.background', '#ffffff' ), color( 'color.backgroundEnd', '' ) ].filter( ( c ): c is Rgb => null !== c );
	const border = color( 'color.border', '#d9d6e3' );
	if ( null === border || null === color( 'color.background', '#ffffff' ) ) {
		return '';
	}
	const darkest = Math.min( ...backgrounds.map( luminance ) );
	const text = color( 'color.text', '#1d1b26' ) ?? ( darkest < 0.18 ? [ 255, 255, 255 ] : [ 0, 0, 0 ] );
	let mix: Rgb = border;
	for ( let share = 0; share <= 20; share++ ) {
		mix = border.map( ( b, i ) => phpRound( b + ( ( text[ i ] ?? 0 ) - b ) * share / 20 ) ) as Rgb;
		const lum = luminance( mix );
		const worst = Math.min( ...backgrounds.map( ( bg ) => ( Math.max( lum, luminance( bg ) ) + 0.05 ) / ( Math.min( lum, luminance( bg ) ) + 0.05 ) ) );
		if ( worst >= 3.1 ) {
			break;
		}
	}
	return '#' + mix.map( ( n ) => n.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}

/** round() of PHP: halves away from zero. */
function phpRound( n: number ): number {
	return Math.sign( n ) * Math.round( Math.abs( n ) );
}

/** The CSS variables of the tokens, for the style attribute of the form (StyleTokens::css()). */
export function styleCss( tokens: StyleTokens ): string {
	let out = '';
	for ( const [ token, variable, kind ] of TOKENS ) {
		const raw = ( tokens[ token ] ?? '' ).trim();
		const v = '' === raw ? '' : value( token, kind, raw );
		if ( '' !== v ) {
			out += variable + ':' + v + ';';
		}
	}
	const align = tokens[ 'button.align' ] ?? '';
	if ( [ 'center', 'end', 'full' ].includes( align ) ) {
		out += '--ffx-next-margin:0;' + ( 'full' === align ? '--ffx-button-flex:1 1 0;' : '' );
	}
	if ( 'custom' === tokens.shadow ) {
		const shadowColor = value( 'shadow.color', 'color', ( tokens[ 'shadow.color' ] ?? '' ).trim() );
		out +=
			'--ffx-shadow:' +
			( '1' === tokens[ 'shadow.inset' ] ? 'inset ' : '' ) +
			[ clamp( tokens[ 'shadow.x' ], -40, 40, 0 ), clamp( tokens[ 'shadow.y' ], -40, 40, 8 ), clamp( tokens[ 'shadow.blur' ], 0, 80, 24 ), clamp( tokens[ 'shadow.spread' ], -40, 40, 0 ) ].join( ' ' ) +
			' ' +
			( '' !== shadowColor ? shadowColor : 'rgba(16,24,40,0.12)' ) +
			';';
	}
	const line = fieldBorder( tokens );
	return out + ( '' !== line ? '--ffx-color-field-border:' + line + ';' : '' );
}

/** Classes of the form's element that follow from the tokens (StyleTokens::classes()). */
export function styleClasses( tokens: StyleTokens ): string {
	const background = ( tokens[ 'color.background' ] ?? '' ).trim().toLowerCase();
	const solid = '' === background || ( /^(#([0-9a-f]{3}){1,2}|(rgb|hsl)\([^/]*\)|(rgb|hsl)a?\(.*,\s*1(\.0+)?\s*\)|[a-z]+)$/.test( background ) && ! [ 'transparent', 'inherit', 'initial', 'unset', 'currentcolor' ].includes( background ) );
	const dark = rgb( background );
	const align = tokens[ 'button.align' ] ?? '';
	return (
		( solid ? ' ffx-sticky' : '' ) +
		( [ 'center', 'end', 'full' ].includes( align ) ? ' ffx-stack' : '' ) +
		( null !== dark && luminance( dark ) < 0.18 ? ' ffx-dark' : '' ) +
		( undefined !== NAMED[ 'button.shadow' ]?.[ tokens[ 'button.shadow' ] ?? '' ] ? ' ffx-bshadow' : '' ) +
		( 'upper' === tokens[ 'heading.case' ] ? ' ffx-upper' : '' )
	);
}
