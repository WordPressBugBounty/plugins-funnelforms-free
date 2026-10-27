/**
 * A small drawing of a form in a style: a question, three answer tiles (the first chosen) and the
 * next button, in the style's colours, fonts, corners and shadows. The theme gallery and the
 * template gallery draw their cards with it; the variables (sampleVars) also colour a template's
 * thumbnail (NewForm.tsx).
 */
import React from 'react';
import { fontFamilyCss } from '../fonts';
import { effectiveTokens, type StyleTokens } from '../themes';
import { __ } from './i18n';

/** A token as a CSS value for the drawing; plain colours and lengths only. */
function css( value: string | undefined ): string | undefined {
	const v = ( value ?? '' ).trim();
	return '' === v || 'inherit' === v || /[;{}<>]|url\(/i.test( v ) ? undefined : v;
}

/** Corners at the drawing's scale. */
function corner( value: string | undefined, fallback: number ): string {
	const n = Number.parseFloat( value ?? '' );
	return `${ Math.min( 14, Math.round( ( Number.isFinite( n ) ? n : fallback ) / 2 ) ) }px`;
}

const TILE_SHADOW: Record<string, string> = {
	none: 'none',
	soft: '0 2px 6px -2px rgba(16,24,40,0.2)',
	lifted: '0 6px 12px -6px rgba(16,24,40,0.4)',
	hard: '2px 2px 0 var(--ffxs-text)',
};

const BUTTON_SHADOW: Record<string, string> = {
	none: 'none',
	glow: '0 5px 12px -4px var(--ffxs-button)',
	hard: '2px 2px 0 var(--ffxs-text)',
};

/** CSS variables (--ffxs-*) of a style for the drawing. */
export function sampleVars( tokens: StyleTokens ): React.CSSProperties {
	const t = effectiveTokens( tokens );
	const background = css( t[ 'color.background' ] );
	const end = css( t[ 'color.backgroundEnd' ] );
	const text = css( t[ 'color.text' ] );
	const primary = css( t[ 'color.primary' ] ) ?? '#6a30f5';
	const button = css( t[ 'color.button' ] ) ?? primary;
	const font = fontFamilyCss( t[ 'font.family' ] );
	const heading = t[ 'font.heading' ] ? fontFamilyCss( t[ 'font.heading' ] ) : '';
	const weight: Record<string, string> = { normal: '400', medium: '500', semibold: '600', bold: '700' };
	const vars: Record<string, string | undefined> = {
		'--ffxs-bg': background && end ? `linear-gradient(${ Number.parseFloat( t[ 'background.angle' ] ?? '' ) || 160 }deg, ${ background }, ${ end })` : background,
		'--ffxs-text': text,
		'--ffxs-muted': css( t[ 'color.muted' ] ),
		'--ffxs-heading': css( t[ 'color.heading' ] ) ?? text,
		'--ffxs-border': css( t[ 'color.border' ] ),
		'--ffxs-primary': primary,
		'--ffxs-on-primary': css( t[ 'color.onPrimary' ] ),
		'--ffxs-button': button,
		'--ffxs-on-button': css( t[ 'color.onButton' ] ) ?? css( t[ 'color.onPrimary' ] ),
		'--ffxs-option': css( t[ 'color.option' ] ) ?? background,
		'--ffxs-selected': css( t[ 'color.optionSelected' ] ),
		'--ffxs-icon': css( t[ 'color.icon' ] ) ?? primary,
		'--ffxs-progress': css( t[ 'color.progress' ] ) ?? primary,
		'--ffxs-radius': corner( t[ 'radius.card' ], 12 ),
		'--ffxs-radius-button': corner( t[ 'radius.button' ], 999 ),
		'--ffxs-font': 'inherit' === font || '' === font ? undefined : font,
		'--ffxs-font-heading': '' === heading || 'inherit' === heading ? undefined : heading,
		'--ffxs-weight': weight[ t[ 'font.weight.heading' ] ?? '' ],
		'--ffxs-case': 'upper' === t[ 'heading.case' ] ? 'uppercase' : undefined,
		'--ffxs-tracking': 'upper' === t[ 'heading.case' ] ? '0.05em' : undefined,
		'--ffxs-tile-shadow': TILE_SHADOW[ t[ 'tile.shadow' ] ?? '' ],
		'--ffxs-button-shadow': BUTTON_SHADOW[ t[ 'button.shadow' ] ?? '' ],
		'--ffxs-border-width': '0' === t[ 'border.width' ] || 'none' === t[ 'border.style' ] ? '0px' : Number( t[ 'border.width' ] ) >= 2 ? '1.5px' : undefined,
	};
	return Object.fromEntries( Object.entries( vars ).filter( ( [ , v ] ) => undefined !== v ) ) as React.CSSProperties;
}

/** The drawing; decorative, its card names the style. */
export function ThemeSample( { tokens }: { tokens: StyleTokens } ) {
	return (
		<span className="ffxb-sample" style={ sampleVars( tokens ) } aria-hidden="true">
			<span className="ffxb-sample__question">{ __( 'What do you need?', 'funnelforms-pro' ) }</span>
			<span className="ffxb-sample__tiles">
				{ [ 0, 1, 2 ].map( ( i ) => (
					<span key={ i } className={ 'ffxb-sample__tile' + ( 0 === i ? ' is-chosen' : '' ) }>
						<span className="ffxb-sample__icon" />
						<span className="ffxb-sample__label" />
					</span>
				) ) }
			</span>
			<span className="ffxb-sample__nav">
				<span className="ffxb-sample__progress">
					<span />
				</span>
				<span className="ffxb-sample__button">{ __( 'Next', 'funnelforms-pro' ) }</span>
			</span>
		</span>
	);
}
