/**
 * Themes and global styles: a theme is a set of style tokens (colours, fonts, corners, buttons,
 * answer tiles, shadow, background) the form starts from; changing a token afterwards keeps the
 * theme's name but the tokens alone decide the look. The first twelve follow the themes of
 * Funnelforms 4, darkened where text on them would not reach WCAG AA; the others are made with
 * all design options, some for an industry. They use only fonts the plugin bundles or the
 * visitor already has (fonts.ts), so a theme never loads anything from elsewhere.
 */
import type { FormDocument } from '@funnelforms/form-schema';

export type StyleTokens = Record<string, string>;

/** The tokens every theme sets. */
export const THEME_TOKENS = [ 'color.primary', 'color.onPrimary', 'color.background', 'color.text', 'color.muted', 'color.border', 'color.error', 'font.family', 'radius.card', 'radius.input' ] as const;

/**
 * Tokens of the look a theme may set beyond those; applying a theme removes the ones it does not
 * set, so its look is complete. Sizes of text, alignment, transitions, the background image and
 * the custom CSS stay with the form.
 */
export const THEME_LOOK_TOKENS = [
	'color.heading',
	'color.button',
	'color.onButton',
	'color.back',
	'color.onBack',
	'color.option',
	'color.optionSelected',
	'color.icon',
	'color.progress',
	'color.progressTrack',
	'color.backgroundEnd',
	'background.angle',
	'font.heading',
	'font.weight.heading',
	'heading.case',
	'radius.button',
	'border.width',
	'border.style',
	'border.container',
	'shadow',
	'tile.shadow',
	'button.shadow',
	'space.gap',
] as const;

export type ThemeToken = ( typeof THEME_TOKENS )[ number ];

export type ThemeTokens = Record<ThemeToken, string>;

/** Light, dark or colourful: how the gallery groups the themes. */
export type ThemeGroup = 'light' | 'dark' | 'colourful';

export interface Theme {
	id: string;
	group: ThemeGroup;
	/** Made for an industry (the gallery's filter "Industries"). */
	industry?: boolean;
	tokens: ThemeTokens;
	/** Further tokens of the look (THEME_LOOK_TOKENS). */
	look?: StyleTokens;
}

/** What the runtime shows without tokens (runtime.css). */
export const RUNTIME_DEFAULTS: ThemeTokens = {
	'color.primary': '#6a30f5',
	'color.onPrimary': '#ffffff',
	'color.background': '#ffffff',
	'color.text': '#1d1b26',
	'color.muted': '#5f5b6b',
	'color.border': '#d9d6e3',
	'color.error': '#b42318',
	'font.family': 'inherit',
	'radius.card': '12',
	'radius.input': '8',
};

interface ThemeSpec {
	group: ThemeGroup;
	industry?: boolean;
	primary: string;
	background: string;
	text: string;
	muted: string;
	border: string;
	font: string;
	card: number;
	input: number;
	/** Base tokens other than the above (button text, error colour). */
	extra?: Partial<ThemeTokens>;
	look?: StyleTokens;
}

function theme( id: string, primary: string, background: string, text: string, muted: string, border: string, font: string, card: number, input: number, extra: Partial<ThemeTokens> = {}, group: ThemeGroup = 'light' ): Theme {
	return made( id, { group, primary, background, text, muted, border, font, card, input, extra } );
}

function made( id: string, s: ThemeSpec ): Theme {
	return {
		id,
		group: s.group,
		...( s.industry ? { industry: true } : {} ),
		tokens: {
			'color.primary': s.primary,
			'color.onPrimary': '#ffffff',
			'color.background': s.background,
			'color.text': s.text,
			'color.muted': s.muted,
			'color.border': s.border,
			'color.error': '#b42318',
			'font.family': s.font,
			'radius.card': String( s.card ),
			'radius.input': String( s.input ),
			...s.extra,
		},
		...( s.look ? { look: s.look } : {} ),
	};
}

/** On dark backgrounds: dark text on the accent, a lighter red for errors. */
const DARK = { 'color.onPrimary': '#0b0b0f', 'color.error': '#fda29b' };

export const THEMES: Theme[] = [
	theme( 'funnelforms', '#6a30f5', '#ffffff', '#1d1b26', '#5f5b6b', '#d9d6e3', 'Montserrat', 12, 8 ),
	// Takes the font and text colour of the website; the form has no background of its own.
	theme( 'website', '#333333', 'transparent', 'inherit', 'inherit', '#c3c4c7', 'inherit', 8, 6 ),
	theme( 'corporate', '#2563eb', '#ffffff', '#1e293b', '#475569', '#cbd5e1', 'system-ui', 6, 6 ),
	theme( 'dark', '#a78bfa', '#1a1a1a', '#f8f9fa', '#a1a1aa', '#3f3f46', 'Montserrat', 4, 4, { 'color.onPrimary': '#121212', 'color.error': '#f97066' }, 'dark' ),
	theme( 'lavender', '#6a30f5', '#f8f7ff', '#2d2d2d', '#5b5670', '#d9d0ff', 'Poppins', 12, 10, {}, 'colourful' ),
	theme( 'green', '#047857', '#f6fdf9', '#1f2937', '#4b5563', '#a7f3d0', 'system-ui', 8, 8, {}, 'colourful' ),
	theme( 'orange', '#c2410c', '#fff7ed', '#292524', '#57534e', '#fed7aa', 'Poppins', 16, 12, {}, 'colourful' ),
	theme( 'elegant', '#4f46e5', '#ffffff', '#334155', '#475569', '#e2e8f0', 'serif', 6, 6 ),
	theme( 'pink', '#be185d', '#fdf2f8', '#374151', '#4b5563', '#fbcfe8', 'Poppins', 12, 12, {}, 'colourful' ),
	theme( 'tech', '#0369a1', '#f0f9ff', '#334155', '#475569', '#bae6fd', 'system-ui', 8, 8 ),
	theme( 'red', '#dc2626', '#ffffff', '#1f2937', '#4b5563', '#fecaca', 'Montserrat', 6, 6 ),
	theme( 'pastel', '#7c3aed', '#f5f3ff', '#374151', '#4b5563', '#ddd6fe', 'Poppins', 16, 16, {}, 'colourful' ),

	// Black on white, flat tiles, nothing that distracts.
	made( 'minimal', {
		group: 'light',
		primary: '#18181b',
		background: '#ffffff',
		text: '#18181b',
		muted: '#52525b',
		border: '#e4e4e7',
		font: 'system-ui',
		card: 10,
		input: 8,
		look: { 'color.optionSelected': '#f4f4f5', 'font.weight.heading': 'semibold', 'radius.button': '8', 'border.width': '1', 'tile.shadow': 'none', 'button.shadow': 'none', 'space.gap': '10' },
	} ),
	// Deep navy with a soft gradient and a periwinkle accent.
	made( 'midnight', {
		group: 'dark',
		primary: '#a5b4fc',
		background: '#0b1020',
		text: '#f1f5f9',
		muted: '#a3acc2',
		border: '#2b3352',
		font: 'sans-geometric',
		card: 16,
		input: 12,
		extra: DARK,
		look: { 'color.backgroundEnd': '#1a1f3d', 'background.angle': '160', 'color.option': '#151a33', 'color.optionSelected': '#232b55', 'color.progressTrack': '#2b3352', 'font.weight.heading': 'bold', 'radius.button': '12', 'border.width': '1', shadow: 'strong', 'button.shadow': 'glow' },
	} ),
	// See-through tiles on a violet to pink gradient.
	made( 'aurora', {
		group: 'colourful',
		primary: '#7c3aed',
		background: '#eef2ff',
		text: '#1e1b4b',
		muted: '#4b4a72',
		border: '#c7d2fe',
		font: 'Poppins',
		card: 18,
		input: 12,
		look: { 'color.backgroundEnd': '#fce7f3', 'background.angle': '135', 'color.option': 'rgba(255,255,255,0.7)', 'color.optionSelected': '#ffffff', 'color.icon': '#db2777', 'radius.button': '999', 'border.width': '1', shadow: 'medium', 'tile.shadow': 'lifted', 'button.shadow': 'glow' },
	} ),
	// Black outlines, hard shadows and a yellow button: impossible to overlook.
	made( 'brutal', {
		group: 'colourful',
		primary: '#111111',
		background: '#fffdf5',
		text: '#111111',
		muted: '#3f3f46',
		border: '#111111',
		font: 'sans-geometric',
		card: 0,
		input: 0,
		look: { 'color.option': '#ffffff', 'color.optionSelected': '#fde047', 'color.button': '#fde047', 'color.onButton': '#111111', 'color.icon': '#111111', 'color.progress': '#111111', 'color.progressTrack': '#e7e5e4', 'font.weight.heading': 'bold', 'heading.case': 'upper', 'radius.button': '0', 'border.width': '2', 'border.container': 'on', 'tile.shadow': 'hard', 'button.shadow': 'hard', 'space.gap': '16' },
	} ),
	// A magazine: serif headings on warm paper, thin lines.
	made( 'editorial', {
		group: 'light',
		primary: '#7a2e3b',
		background: '#fbf9f6',
		text: '#1f1d1a',
		muted: '#5c574f',
		border: '#e2dcd2',
		font: 'serif-classic',
		card: 4,
		input: 2,
		look: { 'font.heading': 'serif-modern', 'font.weight.heading': 'normal', 'color.optionSelected': '#f5ecea', 'color.icon': '#7a2e3b', 'radius.button': '2', 'border.width': '1', 'tile.shadow': 'none', 'button.shadow': 'none' },
	} ),
	// Round shapes and warm colours for a friendly tone.
	made( 'playful', {
		group: 'colourful',
		primary: '#be185d',
		background: '#fffaf0',
		text: '#3b1d2e',
		muted: '#5b4a5e',
		border: '#fbcfe8',
		font: 'rounded',
		card: 24,
		input: 16,
		look: { 'color.backgroundEnd': '#fff0f6', 'background.angle': '160', 'color.option': '#ffffff', 'color.optionSelected': '#fff1f7', 'color.icon': '#ea580c', 'font.weight.heading': 'bold', 'radius.button': '999', 'border.width': '2', 'tile.shadow': 'lifted', 'button.shadow': 'glow', 'space.gap': '14' },
	} ),
	// Olive and sand with a serif for headings: gardens, organic products, wellbeing.
	made( 'nature', {
		group: 'light',
		industry: true,
		primary: '#3f6212',
		background: '#f7f5ee',
		text: '#1c2a1a',
		muted: '#4d5a46',
		border: '#d9d3c0',
		font: 'sans-humanist',
		card: 14,
		input: 10,
		look: { 'font.heading': 'serif-classic', 'color.option': '#fffdf7', 'color.optionSelected': '#eef3e2', 'color.icon': '#4d7c0f', 'radius.button': '999', 'border.width': '1', 'tile.shadow': 'soft' },
	} ),
	// Gold on black with spaced capitals.
	made( 'gold', {
		group: 'dark',
		primary: '#d4af37',
		background: '#0f0e0c',
		text: '#f5f0e6',
		muted: '#b9b0a0',
		border: '#3a342a',
		font: 'sans-humanist',
		card: 2,
		input: 0,
		extra: { 'color.onPrimary': '#14110b', 'color.error': '#fda29b' },
		look: { 'color.backgroundEnd': '#1b1814', 'background.angle': '180', 'color.option': '#16140f', 'color.optionSelected': '#2a2416', 'color.icon': '#d4af37', 'font.heading': 'serif-modern', 'font.weight.heading': 'normal', 'heading.case': 'upper', 'radius.button': '0', 'border.width': '1', shadow: 'strong', 'button.shadow': 'none' },
	} ),
	// Clean white and teal: practices, care, pharmacies.
	made( 'clinic', {
		group: 'light',
		industry: true,
		primary: '#0e7490',
		background: '#ffffff',
		text: '#0f2a37',
		muted: '#4a6572',
		border: '#cfe3ea',
		font: 'system-ui',
		card: 12,
		input: 10,
		look: { 'color.option': '#f7fbfc', 'color.optionSelected': '#e6f6fa', 'color.icon': '#0e7490', 'color.progressTrack': '#e2eef2', 'radius.button': '10', 'border.width': '1', 'tile.shadow': 'none', shadow: 'soft' },
	} ),
	// Cyan light on a night-blue gradient, headings in a code font.
	made( 'neon', {
		group: 'dark',
		primary: '#22d3ee',
		background: '#05060f',
		text: '#e8ecff',
		muted: '#9aa3c7',
		border: '#262b52',
		font: 'system-ui',
		card: 10,
		input: 8,
		extra: DARK,
		look: { 'color.backgroundEnd': '#0c1030', 'background.angle': '160', 'color.option': '#0b0e24', 'color.optionSelected': '#0f2a3a', 'color.icon': '#22d3ee', 'color.progress': '#c084fc', 'color.progressTrack': '#262b52', 'font.heading': 'mono-code', 'font.weight.heading': 'bold', 'radius.button': '8', 'border.width': '1', shadow: 'strong', 'button.shadow': 'glow' },
	} ),
	// Navy, white and a touch of brass: estate agents, valuations, property.
	made( 'estate', {
		group: 'light',
		industry: true,
		primary: '#1f3a5f',
		background: '#ffffff',
		text: '#1b2430',
		muted: '#55606e',
		border: '#dfe3e8',
		font: 'sans-geometric',
		card: 6,
		input: 6,
		look: { 'font.heading': 'serif-classic', 'color.optionSelected': '#f1f4f8', 'color.icon': '#8a6a3b', 'radius.button': '6', 'border.width': '1', 'tile.shadow': 'soft', shadow: 'soft' },
	} ),
	// Amber and anthracite with strong capitals: trades and construction.
	made( 'craft', {
		group: 'light',
		industry: true,
		primary: '#b45309',
		background: '#fafaf9',
		text: '#1c1917',
		muted: '#57534e',
		border: '#d6d3d1',
		font: 'condensed',
		card: 4,
		input: 4,
		look: { 'color.option': '#ffffff', 'color.optionSelected': '#fef3c7', 'color.icon': '#b45309', 'color.button': '#1c1917', 'color.onButton': '#ffffff', 'font.weight.heading': 'bold', 'heading.case': 'upper', 'radius.button': '4', 'border.width': '2', 'tile.shadow': 'none', 'button.shadow': 'none' },
	} ),
	// Calm blue with a green button: banks, insurance, tax advice.
	made( 'trust', {
		group: 'light',
		industry: true,
		primary: '#0b5394',
		background: '#f8fafc',
		text: '#0f172a',
		muted: '#475569',
		border: '#cbd5e1',
		font: 'sans-humanist',
		card: 8,
		input: 6,
		look: { 'color.option': '#ffffff', 'color.optionSelected': '#eff6ff', 'color.icon': '#0b5394', 'color.button': '#047857', 'color.onButton': '#ffffff', 'color.progress': '#047857', 'radius.button': '6', 'border.width': '1', 'tile.shadow': 'soft', shadow: 'soft' },
	} ),
	// Blush and berry with a fine serif: salons, cosmetics, wellness.
	made( 'beauty', {
		group: 'light',
		industry: true,
		primary: '#9d174d',
		background: '#fdf8f6',
		text: '#3b2a2f',
		muted: '#6e5a60',
		border: '#ecd8d3',
		font: 'sans-humanist',
		card: 20,
		input: 14,
		look: { 'color.backgroundEnd': '#f9ece8', 'background.angle': '160', 'color.option': '#ffffff', 'color.optionSelected': '#fcecf2', 'color.icon': '#be185d', 'font.heading': 'serif-modern', 'font.weight.heading': 'normal', 'radius.button': '999', 'border.width': '1', 'tile.shadow': 'soft', shadow: 'soft' },
	} ),
	// Lime on black, condensed capitals: gyms, sports, coaching.
	made( 'fitness', {
		group: 'dark',
		industry: true,
		primary: '#a3e635',
		background: '#111111',
		text: '#fafafa',
		muted: '#a3a3a3',
		border: '#333333',
		font: 'condensed',
		card: 6,
		input: 6,
		extra: { 'color.onPrimary': '#111111', 'color.error': '#fda29b' },
		look: { 'color.option': '#1a1a1a', 'color.optionSelected': '#24301a', 'color.icon': '#a3e635', 'font.weight.heading': 'bold', 'heading.case': 'upper', 'radius.button': '6', 'border.width': '1', 'button.shadow': 'none' },
	} ),
	// Terracotta on cream with a classic serif: restaurants, catering, events.
	made( 'bistro', {
		group: 'light',
		industry: true,
		primary: '#9a3412',
		background: '#fbf6ee',
		text: '#2b1d14',
		muted: '#6b5444',
		border: '#e6d9c6',
		font: 'serif-classic',
		card: 10,
		input: 8,
		look: { 'color.option': '#fffcf7', 'color.optionSelected': '#f6e9dc', 'color.icon': '#9a3412', 'font.weight.heading': 'semibold', 'radius.button': '999', 'border.width': '1', 'tile.shadow': 'soft' },
	} ),
	// Sky blue and sun yellow: solar, heat pumps, energy advice. Tiles, button and progress in the sun's colour.
	made( 'solar', {
		group: 'colourful',
		industry: true,
		primary: '#1d4ed8',
		background: '#fffdf5',
		text: '#1c1917',
		muted: '#57534e',
		border: '#fde68a',
		font: 'Poppins',
		card: 14,
		input: 10,
		look: { 'color.backgroundEnd': '#eff6ff', 'background.angle': '160', 'color.option': '#ffffff', 'color.optionSelected': '#eff6ff', 'color.icon': '#d97706', 'color.button': '#f59e0b', 'color.onButton': '#1c1917', 'color.progress': '#f59e0b', 'font.weight.heading': 'bold', 'radius.button': '999', 'border.width': '1', 'tile.shadow': 'lifted', 'button.shadow': 'glow' },
	} ),
];

export function findTheme( id: string | undefined ): Theme | undefined {
	return THEMES.find( ( t ) => t.id === id );
}

/** All tokens of a theme: the base and the look. */
export function themeStyle( t: Theme ): StyleTokens {
	return { ...t.tokens, ...t.look };
}

/** The tokens in effect: the form's over the runtime's defaults. */
export function effectiveTokens( tokens: StyleTokens ): ThemeTokens & StyleTokens {
	return { ...RUNTIME_DEFAULTS, ...tokens };
}

const OWNED: readonly string[] = [ ...THEME_TOKENS, ...THEME_LOOK_TOKENS ];

/** Whether tokens were changed after the theme was applied. */
export function changedFromTheme( doc: FormDocument ): boolean {
	const t = findTheme( doc.style.theme );
	if ( ! t ) {
		return false;
	}
	const style = themeStyle( t );
	return OWNED.some( ( key ) => ( doc.style.tokens[ key ] ?? '' ) !== ( style[ key ] ?? '' ) );
}

/** The form's tokens with a theme applied: the theme's replace all it owns (THEME_TOKENS, THEME_LOOK_TOKENS). */
export function withTheme( tokens: StyleTokens, t: Theme ): StyleTokens {
	const kept = Object.entries( tokens ).filter( ( [ key ] ) => ! OWNED.includes( key ) );
	return { ...Object.fromEntries( kept ), ...themeStyle( t ) };
}

/** Applies a theme: its tokens replace the form's colours, fonts, corners, buttons, tiles and shadow. */
export function applyTheme( doc: FormDocument, id: string ): void {
	const t = findTheme( id );
	if ( ! t ) {
		return;
	}
	doc.style.tokens = withTheme( doc.style.tokens, t );
	doc.style.theme = id;
}

/** Applies a saved style: its tokens replace all of the form's tokens. */
export function applySavedStyle( doc: FormDocument, tokens: StyleTokens ): void {
	doc.style.tokens = { ...tokens };
	delete doc.style.theme;
}

/**
 * Sets one token; empty removes it (the runtime's default applies). A new accent colour also
 * sets the button text to white or black, whichever is easier to read on it.
 */
export function setStyleToken( doc: FormDocument, key: string, value: string | null ): void {
	const v = ( value ?? '' ).trim();
	if ( '' === v ) {
		doc.style.tokens = Object.fromEntries( Object.entries( doc.style.tokens ).filter( ( [ k ] ) => k !== key ) );
		return;
	}
	doc.style.tokens[ key ] = v;
	const textOn: Record<string, string> = { 'color.primary': 'color.onPrimary', 'color.button': 'color.onButton', 'color.back': 'color.onBack' };
	const text = textOn[ key ];
	if ( text && parseColor( v ) ) {
		doc.style.tokens[ text ] = readableOn( v );
	}
}

/** A colour with opacity (0–100 %) as rgba(); null when the colour is not a plain one. */
export function withAlpha( color: string, percent: number ): string | null {
	const rgb = parseColor( color );
	if ( ! rgb ) {
		return null;
	}
	const a = Math.max( 0, Math.min( 100, Math.round( percent ) ) ) / 100;
	return `rgba(${ rgb.join( ',' ) },${ a })`;
}

/** Colour and opacity (0–100 %) of #rrggbb, #rrggbbaa or rgb()/rgba(); null for anything else. */
export function splitAlpha( value: string ): { hex: string; percent: number } | null {
	const v = value.trim().toLowerCase();
	const eight = /^#([0-9a-f]{6})([0-9a-f]{2})$/.exec( v );
	if ( eight ) {
		return { hex: '#' + ( eight[ 1 ] ?? '' ), percent: Math.round( ( parseInt( eight[ 2 ] ?? 'ff', 16 ) / 255 ) * 100 ) };
	}
	const fn = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec( v );
	if ( fn ) {
		const hex = '#' + [ fn[ 1 ], fn[ 2 ], fn[ 3 ] ].map( ( n ) => Math.min( 255, Number( n ) ).toString( 16 ).padStart( 2, '0' ) ).join( '' );
		return { hex, percent: undefined === fn[ 4 ] ? 100 : Math.round( Math.min( 1, Number( fn[ 4 ] ) ) * 100 ) };
	}
	const hex = toHex( v );
	return hex ? { hex, percent: 100 } : null;
}

type Rgb = [ number, number, number ];

/** RGB of #rgb, #rrggbb and opaque rgb()/rgba(); null for anything else (inherit, transparent). */
export function parseColor( value: string ): Rgb | null {
	const v = value.trim().toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec( v );
	if ( short ) {
		const [ , r = '', g = '', b = '' ] = short;
		return [ parseInt( r + r, 16 ), parseInt( g + g, 16 ), parseInt( b + b, 16 ) ];
	}
	const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec( v );
	if ( long ) {
		const [ , r = '', g = '', b = '' ] = long;
		return [ parseInt( r, 16 ), parseInt( g, 16 ), parseInt( b, 16 ) ];
	}
	const fn = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec( v );
	if ( fn && ( undefined === fn[ 4 ] || 1 <= Number( fn[ 4 ] ) ) ) {
		const [ , r = '', g = '', b = '' ] = fn;
		return [ Math.min( 255, Number( r ) ), Math.min( 255, Number( g ) ), Math.min( 255, Number( b ) ) ];
	}
	return null;
}

/** The colour as #rrggbb, for colour pickers; null when it is not a plain colour. */
export function toHex( value: string ): string | null {
	const rgb = parseColor( value );
	return rgb ? '#' + rgb.map( ( n ) => n.toString( 16 ).padStart( 2, '0' ) ).join( '' ) : null;
}

function channel( n: number ): number {
	const c = n / 255;
	return c <= 0.03928 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4;
}

function luminance( [ r, g, b ]: Rgb ): number {
	return 0.2126 * channel( r ) + 0.7152 * channel( g ) + 0.0722 * channel( b );
}

/** WCAG contrast ratio of two colours; null when one is not a plain colour. */
export function contrast( a: string, b: string ): number | null {
	const x = parseColor( a );
	const y = parseColor( b );
	if ( ! x || ! y ) {
		return null;
	}
	const lx = luminance( x );
	const ly = luminance( y );
	return ( Math.max( lx, ly ) + 0.05 ) / ( Math.min( lx, ly ) + 0.05 );
}

/** White or near-black, whichever reads better on the colour. */
export function readableOn( color: string ): string {
	return ( contrast( '#ffffff', color ) ?? 0 ) >= ( contrast( '#1a1a1a', color ) ?? 0 ) ? '#ffffff' : '#1a1a1a';
}

export interface ContrastProblem {
	/** text: questions and answers; muted: hints; heading: questions; button: text on the accent or button colour; back: text on the back button. */
	pair: 'text' | 'muted' | 'heading' | 'button' | 'back';
	ratio: number;
}

/** Text that is hard to read with these tokens (below WCAG AA, 4.5:1). */
export function contrastProblems( tokens: StyleTokens ): ContrastProblem[] {
	const t = effectiveTokens( tokens );
	const pairs: Array<[ ContrastProblem[ 'pair' ], string, string ]> = [
		[ 'text', t[ 'color.text' ], t[ 'color.background' ] ],
		[ 'muted', t[ 'color.muted' ], t[ 'color.background' ] ],
		[ 'heading', t[ 'color.heading' ] ?? '', t[ 'color.background' ] ],
		[ 'button', t[ 'color.onButton' ] ?? t[ 'color.onPrimary' ], t[ 'color.button' ] ?? t[ 'color.primary' ] ],
		[ 'back', t[ 'color.onBack' ] ?? '', t[ 'color.back' ] ?? '' ],
	];
	const out: ContrastProblem[] = [];
	for ( const [ pair, a, b ] of pairs ) {
		const ratio = contrast( a, b );
		if ( null !== ratio && ratio < 4.5 ) {
			out.push( { pair, ratio } );
		}
	}
	return out;
}

/** What the form takes from a website: a colour per role and the font; null keeps the form's. */
export interface BrandingPicks {
	primary: string | null;
	text: string | null;
	background: string | null;
	font: string | null;
}

/** Applies colours and font taken from a website; a new accent colour also sets the button text. */
export function applyBranding( doc: FormDocument, picks: BrandingPicks ): void {
	const tokens: Array<[ string, string | null ]> = [
		[ 'color.primary', picks.primary ],
		[ 'color.text', picks.text ],
		[ 'color.background', picks.background ],
		[ 'font.family', picks.font ],
	];
	for ( const [ key, value ] of tokens ) {
		if ( value ) {
			setStyleToken( doc, key, value );
		}
	}
}
