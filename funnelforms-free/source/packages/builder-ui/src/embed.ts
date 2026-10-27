/**
 * The codes of the embed workspace: the shortcode with the popup or corner button attributes of
 * Frontend\Shortcode (the same the block and the Elementor widget write), and the embed code for
 * websites outside WordPress (assets/embed/embed.js with a frame of the form, Frontend\ExternalEmbed).
 */

export type PopupTrigger = 'delay' | 'click' | 'scroll' | 'exit';
export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type WidgetAnimation = '' | 'pulse' | 'bounce' | 'shake';

export interface PopupSettings {
	trigger: PopupTrigger;
	/** Seconds until the popup opens. */
	delay: number;
	/** CSS class of the elements that open the popup on a click. */
	clickClass: string;
	/** Share of the page in percent scrolled before it opens. */
	scroll: number;
	/** Hours a popup that opened by itself stays closed after the visitor closed it. */
	pause: number;
}

export interface WidgetSettings {
	position: Corner;
	text: string;
	/** Colour of the button as #rrggbb; empty takes the form's colour. */
	color: string;
	animation: WidgetAnimation;
}

export interface FrameSettings {
	width: string;
	height: string;
	autoHeight: boolean;
}

/** Where the embed code for other websites comes from (BuilderPage, Pro only). */
export interface EmbedConfig {
	/** Address of assets/embed/embed.js. */
	script: string;
	/** Address of a form's frame page without the uid, ending in "=". */
	frame: string;
	/** Websites that may embed forms (Settings → Interfaces); empty: all. */
	domains: string[];
	/** The settings page with that list. */
	settingsUrl?: string;
}

export const DEFAULT_POPUP: PopupSettings = { trigger: 'delay', delay: 5, clickClass: 'funnelforms-open', scroll: 50, pause: 24 };
export const DEFAULT_WIDGET: WidgetSettings = { position: 'bottom-right', text: '', color: '', animation: '' };
export const DEFAULT_FRAME: FrameSettings = { width: '100%', height: '600px', autoHeight: true };

/** Units the frame accepts per side (embed.js checks the same). */
export const WIDTH_UNITS = [ '%', 'px', 'rem', 'vw' ];
export const HEIGHT_UNITS = [ 'px', '%', 'rem', 'vh' ];

/** A CSS length with one of these units ("100%", "600px"); a bare number counts as px. Null when invalid. */
export function cssSize( value: string, units: string[] ): string | null {
	const m = /^\s*(\d+(?:\.\d+)?)\s*([a-z%]*)\s*$/i.exec( value );
	if ( ! m || 0 === Number( m[ 1 ] ) ) {
		return null;
	}
	const unit = ( m[ 2 ] ?? '' ).toLowerCase() || 'px';
	return units.includes( unit ) ? `${ m[ 1 ] }${ unit }` : null;
}

/** A CSS class as sanitize_html_class() keeps it. */
export function cssClass( value: string ): string {
	return value.replace( /[^A-Za-z0-9_-]/g, '' );
}

/** Shortcode attribute values cannot hold quotes or brackets (Shortcode::display_attributes()). */
function attrValue( value: string | number ): string {
	return String( value ).replace( /["[\]]/g, '' );
}

/** The shortcode with more attributes before its closing bracket. */
export function withAttributes( shortcode: string, attrs: Array<[ string, string | number ]> ): string {
	const extra = attrs
		.filter( ( [ , v ] ) => '' !== String( v ) )
		.map( ( [ k, v ] ) => ` ${ k }="${ attrValue( v ) }"` )
		.join( '' );
	return shortcode.replace( /\]\s*$/, `${ extra }]` );
}

/**
 * Shortcode of a popup. A delay or a click uses the attributes of 3.x, so forms still on 3.x pop
 * up as well; scrolling and leaving the page need the new renderer.
 */
export function popupShortcode( shortcode: string, s: PopupSettings ): string {
	const pause = Math.max( 0, Math.round( s.pause ) );
	switch ( s.trigger ) {
		case 'delay':
			return withAttributes( shortcode, [
				[ 'popup_by_delay', 1 ],
				[ 'popup_delay', Math.round( Math.max( 0, s.delay ) * 1000 ) ],
				[ 'popup_pause', pause ],
			] );
		case 'click':
			return withAttributes( shortcode, [
				[ 'popup_by_click', 1 ],
				[ 'popup_click_class', cssClass( s.clickClass ) || DEFAULT_POPUP.clickClass ],
			] );
		case 'scroll':
			return withAttributes( shortcode, [
				[ 'popup', 'scroll' ],
				[ 'popup_scroll', Math.min( 100, Math.max( 1, Math.round( s.scroll ) ) ) ],
				[ 'popup_pause', pause ],
			] );
		case 'exit':
			return withAttributes( shortcode, [
				[ 'popup', 'exit' ],
				[ 'popup_pause', pause ],
			] );
	}
}

/** Shortcode of the button in a corner that opens the form. */
export function widgetShortcode( shortcode: string, s: WidgetSettings ): string {
	const color = /^#[0-9a-f]{6}$/i.test( s.color ) ? s.color.toLowerCase() : '';
	return withAttributes( shortcode, [
		[ 'widget', s.position ],
		[ 'widget_text', s.text.trim().slice( 0, 60 ) ],
		[ 'widget_color', color ],
		[ 'widget_animation', s.animation ],
	] );
}

function html( value: string ): string {
	return value.replace( /&/g, '&amp;' ).replace( /"/g, '&quot;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
}

/** Embed code for a website outside WordPress: a placeholder for the frame and the loader. */
export function frameCode( config: EmbedConfig, uid: string, title: string, s: FrameSettings ): string {
	const width = cssSize( s.width, WIDTH_UNITS ) ?? DEFAULT_FRAME.width;
	const height = cssSize( s.height, HEIGHT_UNITS ) ?? DEFAULT_FRAME.height;
	return [
		'<!-- Funnelforms -->',
		`<div class="funnelforms-embed" data-src="${ html( config.frame + encodeURIComponent( uid ) ) }" data-title="${ html( title ) }" data-width="${ width }" data-height="${ height }"${ s.autoHeight ? ' data-auto-height="true"' : '' }></div>`,
		`<script src="${ html( config.script ) }" async></script>`,
		'<!-- End Funnelforms -->',
	].join( '\n' );
}
