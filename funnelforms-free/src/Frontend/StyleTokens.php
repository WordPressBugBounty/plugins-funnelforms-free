<?php
/**
 * The style tokens of a form as CSS variables, and the fonts they name.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

defined( 'ABSPATH' ) || exit;

/**
 * Turns the tokens of a form's style (Domain: document `style.tokens`) into CSS variables on the
 * form's element. Every token has a kind that decides which values it takes: colours, font
 * names, pixel sizes, plain numbers or a fixed list of names. Nothing else reaches the page,
 * so a token can never load a file or end the style attribute; the one image a form may show,
 * its background, is a media library attachment whose address the plugin looks up itself.
 */
final class StyleTokens {

	/**
	 * Token => [CSS variable, kind]. Kinds: color, font, px (a number of pixels, or a length as
	 * before), number, name (one of NAMED), image (an attachment ID).
	 */
	private const TOKENS = array(
		'color.primary'            => array( '--ffx-color-primary', 'color' ),
		'color.onPrimary'          => array( '--ffx-color-on-primary', 'color' ),
		'color.background'         => array( '--ffx-color-background', 'color' ),
		'color.text'               => array( '--ffx-color-text', 'color' ),
		'color.muted'              => array( '--ffx-color-muted', 'color' ),
		'color.border'             => array( '--ffx-color-border', 'color' ),
		'color.error'              => array( '--ffx-color-error', 'color' ),
		'color.backgroundEnd'      => array( '--ffx-color-background-end', 'color' ),
		'color.heading'            => array( '--ffx-color-heading', 'color' ),
		'color.button'             => array( '--ffx-color-button', 'color' ),
		'color.onButton'           => array( '--ffx-color-on-button', 'color' ),
		'color.back'               => array( '--ffx-color-back', 'color' ),
		'color.onBack'             => array( '--ffx-color-on-back', 'color' ),
		'color.progress'           => array( '--ffx-color-progress', 'color' ),
		'color.progressTrack'      => array( '--ffx-color-progress-track', 'color' ),
		'color.option'             => array( '--ffx-color-option', 'color' ),
		'color.optionSelected'     => array( '--ffx-color-option-selected', 'color' ),
		'color.icon'               => array( '--ffx-color-icon', 'color' ),
		'color.overlay'            => array( '--ffx-color-overlay', 'color' ),
		'font.family'              => array( '--ffx-font-family', 'font' ),
		'font.heading'             => array( '--ffx-font-heading', 'font' ),
		'font.field'               => array( '--ffx-font-field', 'font' ),
		'font.size'                => array( '--ffx-font-size', 'px' ),
		'font.size.mobile'         => array( '--ffx-font-size-mobile', 'px' ),
		'font.size.heading'        => array( '--ffx-font-size-heading', 'px' ),
		'font.size.heading.mobile' => array( '--ffx-font-size-heading-mobile', 'px' ),
		'font.size.field'          => array( '--ffx-font-size-field', 'px' ),
		'font.size.field.mobile'   => array( '--ffx-font-size-field-mobile', 'px' ),
		'font.weight.heading'      => array( '--ffx-font-weight-heading', 'name' ),
		'line.heading'             => array( '--ffx-line-heading', 'number' ),
		'line.body'                => array( '--ffx-line-body', 'number' ),
		'radius.card'              => array( '--ffx-radius-card', 'px' ),
		'radius.input'             => array( '--ffx-radius-input', 'px' ),
		'radius.button'            => array( '--ffx-radius-button', 'px' ),
		'space.gap'                => array( '--ffx-gap', 'px' ),
		'space.padding'            => array( '--ffx-padding', 'px' ),
		'space.button'             => array( '--ffx-button-padding', 'px' ),
		'size.icon'                => array( '--ffx-icon-size', 'px' ),
		'size.icon.mobile'         => array( '--ffx-icon-size-mobile', 'px' ),
		'border.width'             => array( '--ffx-border-width', 'px' ),
		'border.style'             => array( '--ffx-border-style', 'name' ),
		'border.container'         => array( '--ffx-container-border', 'name' ),
		'shadow'                   => array( '--ffx-shadow', 'name' ),
		'tile.shadow'              => array( '--ffx-rest', 'name' ),
		'button.shadow'            => array( '--ffx-button-shadow', 'name' ),
		'animation'                => array( '--ffx-step-animation', 'name' ),
		'align.text'               => array( '--ffx-text-align', 'name' ),
		'button.align'             => array( '--ffx-button-align', 'name' ),
		'background.angle'         => array( '--ffx-background-angle', 'number' ),
		'background.image'         => array( '--ffx-background-image', 'image' ),
		'background.size'          => array( '--ffx-background-size', 'name' ),
		'background.position'      => array( '--ffx-background-position', 'name' ),
	);

	/**
	 * Tokens that take a name, and the CSS of each name.
	 */
	private const NAMED = array(
		'shadow'              => array(
			'none'   => 'none',
			'soft'   => '0 1px 3px rgba(16,24,40,0.08),0 8px 24px rgba(16,24,40,0.08)',
			'medium' => '0 2px 6px rgba(16,24,40,0.08),0 12px 32px rgba(16,24,40,0.12)',
			'strong' => '0 4px 8px rgba(16,24,40,0.1),0 20px 48px rgba(16,24,40,0.18)',
		),
		// The resting shadow of answer tiles; hard: an offset shadow in the text colour.
		'tile.shadow'         => array(
			'none'   => 'none',
			'soft'   => '0 1px 2px rgb(16 24 40 / 0.06),0 10px 24px -10px rgb(16 24 40 / 0.18)',
			'lifted' => '0 2px 4px rgb(16 24 40 / 0.06),0 18px 36px -14px rgb(16 24 40 / 0.3)',
			'hard'   => '4px 4px 0 var(--ffx-color-text)',
		),
		// The main button's shadow (runtime-more.css, class ffx-bshadow).
		'button.shadow'       => array(
			'none' => 'none',
			'glow' => '0 10px 24px -8px color-mix(in srgb,var(--ffx-color-button,var(--ffx-color-primary)) 70%,transparent)',
			'hard' => '4px 4px 0 var(--ffx-color-text)',
		),
		'animation'           => array(
			'none'        => 'none',
			'fade'        => 'ffx-fade 0.3s ease-out',
			'slide'       => 'ffx-slide 0.3s ease-out',
			'fadeRight'   => 'ffx-fade-right 0.4s ease-out',
			'backInRight' => 'ffx-back-in-right 0.5s cubic-bezier(0.34,1.56,0.64,1)',
			'up'          => 'ffx-up 0.35s ease-out',
			'zoom'        => 'ffx-zoom 0.3s ease-out',
		),
		'font.weight.heading' => array(
			'normal'   => '400',
			'medium'   => '500',
			'semibold' => '600',
			'bold'     => '700',
		),
		'border.style'        => array(
			'solid'  => 'solid',
			'dashed' => 'dashed',
			'dotted' => 'dotted',
			'none'   => 'none',
		),
		'border.container'    => array(
			'on' => 'var(--ffx-border-width,1px) var(--ffx-border-style,solid) var(--ffx-color-border)',
		),
		'align.text'          => array(
			'left'   => 'left',
			'center' => 'center',
			'right'  => 'right',
		),
		'button.align'        => array(
			'apart'  => 'space-between',
			'center' => 'center',
			'end'    => 'flex-end',
			'full'   => 'stretch',
		),
		'background.size'     => array(
			'cover'   => 'cover',
			'contain' => 'contain',
			'auto'    => 'auto',
		),
		'background.position' => array(
			'center' => 'center',
			'top'    => 'top',
			'bottom' => 'bottom',
		),
	);

	/**
	 * Allowed range of the number tokens.
	 */
	private const NUMBERS = array(
		'line.heading'     => array( 1, 3 ),
		'line.body'        => array( 1, 3 ),
		'background.angle' => array( 0, 360 ),
	);

	/**
	 * The CSS variables of the tokens, for the style attribute of the form.
	 *
	 * @param array<string,mixed> $tokens Tokens.
	 */
	public static function css( array $tokens ): string {
		$out = '';
		foreach ( self::TOKENS as $token => [ $variable, $kind ] ) {
			$raw   = isset( $tokens[ $token ] ) && is_scalar( $tokens[ $token ] ) ? trim( (string) $tokens[ $token ] ) : '';
			$value = '' === $raw ? '' : self::value( $token, $kind, $raw );
			if ( '' !== $value ) {
				$out .= $variable . ':' . $value . ';';
			}
		}
		$out  .= self::width( $tokens );
		$align = $tokens['button.align'] ?? '';
		if ( in_array( $align, array( 'center', 'end', 'full' ), true ) ) {
			$out .= '--ffx-next-margin:0;' . ( 'full' === $align ? '--ffx-button-flex:1 1 0;' : '' );
		}
		if ( 'custom' === ( $tokens['shadow'] ?? '' ) ) {
			$out .= '--ffx-shadow:' . self::shadow( $tokens ) . ';';
		}
		$line = self::field_border( $tokens );
		return $out . ( '' !== $line ? '--ffx-color-field-border:' . $line . ';' : '' );
	}

	/**
	 * The width of the whole form (token form.width): full fills the space the form is placed in,
	 * a number of pixels (320 to 1600) is the widest it gets; without it the stylesheet's 960 px.
	 * Narrower screens always make the form narrower.
	 *
	 * @param array<string,mixed> $tokens Tokens.
	 */
	private static function width( array $tokens ): string {
		$raw = is_scalar( $tokens['form.width'] ?? null ) ? trim( (string) $tokens['form.width'] ) : '';
		if ( 'full' === $raw ) {
			return '--ffx-max-width:none;';
		}
		return 1 === preg_match( '/^\d{1,5}$/', $raw ) ? '--ffx-max-width:' . max( 320, min( 1600, (int) $raw ) ) . 'px;' : '';
	}

	/**
	 * The border colour of fields and answer cards: the border token, mixed towards the text
	 * colour just enough to stand out 3:1 against the background (WCAG 1.4.11), so a field can be
	 * seen by its outline; separators keep the light border colour. '' when the background is not
	 * a plain colour (the form's stylesheet then mixes the border with the text colour itself).
	 *
	 * @param array<string,mixed> $tokens Tokens.
	 */
	public static function field_border( array $tokens ): string {
		$color       = static function ( string $token, string $fallback ) use ( $tokens ): ?array {
			$value = is_scalar( $tokens[ $token ] ?? null ) ? strtolower( trim( (string) $tokens[ $token ] ) ) : '';
			return self::rgb( '' === $value ? $fallback : $value );
		};
		$backgrounds = array_filter( array( $color( 'color.background', '#ffffff' ), $color( 'color.backgroundEnd', '' ) ) );
		$border      = $color( 'color.border', '#d9d6e3' );
		if ( null === $border || null === $color( 'color.background', '#ffffff' ) ) {
			return '';
		}
		$darkest = min( array_map( array( self::class, 'luminance' ), $backgrounds ) );
		$text    = $color( 'color.text', '#1d1b26' ) ?? ( $darkest < 0.18 ? array( 255, 255, 255 ) : array( 0, 0, 0 ) );
		for ( $share = 0; $share <= 20; $share++ ) {
			$mix   = array_map( static fn( $b, $t ) => (int) round( $b + ( $t - $b ) * $share / 20 ), $border, $text );
			$lum   = self::luminance( $mix );
			$worst = min( array_map( static fn( array $bg ) => ( max( $lum, self::luminance( $bg ) ) + 0.05 ) / ( min( $lum, self::luminance( $bg ) ) + 0.05 ), $backgrounds ) );
			if ( $worst >= 3.1 ) {
				break;
			}
		}
		return vsprintf( '#%02x%02x%02x', $mix );
	}

	/**
	 * Classes of the form's element that follow from the tokens: ffx-sticky where the form has a
	 * solid background, so the bottom bar can stay at the bottom of a phone's screen above the
	 * steps; ffx-stack where the buttons sit together, so the progress goes above them; ffx-dark
	 * where the background is dark, so the browser draws its own controls (date picker, check
	 * boxes, scroll bars) for a dark page; ffx-bshadow where the main button has a shadow of its
	 * own and ffx-upper where headings are in capitals (both in runtime-more.css, see
	 * Renderer::needs_more()).
	 *
	 * @param array<string,mixed> $tokens Tokens.
	 */
	public static function classes( array $tokens ): string {
		$background = is_scalar( $tokens['color.background'] ?? null ) ? strtolower( trim( (string) $tokens['color.background'] ) ) : '';
		$solid      = '' === $background || ( 1 === preg_match( '/^(#([0-9a-f]{3}){1,2}|(rgb|hsl)\([^\/]*\)|(rgb|hsl)a?\(.*,\s*1(\.0+)?\s*\)|[a-z]+)$/', $background ) && ! in_array( $background, array( 'transparent', 'inherit', 'initial', 'unset', 'currentcolor' ), true ) );
		$align      = $tokens['button.align'] ?? '';
		$button     = is_scalar( $tokens['button.shadow'] ?? null ) ? (string) $tokens['button.shadow'] : '';
		return ( $solid ? ' ffx-sticky' : '' ) . ( in_array( $align, array( 'center', 'end', 'full' ), true ) ? ' ffx-stack' : '' ) . ( self::dark( $background ) ? ' ffx-dark' : '' )
			. ( isset( self::NAMED['button.shadow'][ $button ] ) ? ' ffx-bshadow' : '' ) . ( 'upper' === ( $tokens['heading.case'] ?? '' ) ? ' ffx-upper' : '' );
	}

	/**
	 * Whether a colour is dark (relative luminance below that of a mid grey); colours rgb() does
	 * not read count as light.
	 *
	 * @param string $color Colour, lower case.
	 */
	private static function dark( string $color ): bool {
		$rgb = self::rgb( $color );
		return null !== $rgb && self::luminance( $rgb ) < 0.18;
	}

	/**
	 * Red, green and blue of a colour written as #rgb, #rrggbb or rgb()/rgba(); null otherwise.
	 *
	 * @param string $color Colour, lower case.
	 * @return array{0:int,1:int,2:int}|null
	 */
	private static function rgb( string $color ): ?array {
		if ( 1 === preg_match( '/^#([0-9a-f]{3})$/', $color, $m ) ) {
			$color = '#' . $m[1][0] . $m[1][0] . $m[1][1] . $m[1][1] . $m[1][2] . $m[1][2];
		}
		if ( 1 === preg_match( '/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/', $color, $m ) ) {
			return array( (int) hexdec( $m[1] ), (int) hexdec( $m[2] ), (int) hexdec( $m[3] ) );
		}
		if ( 1 === preg_match( '/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/', $color, $m ) ) {
			return array( min( 255, (int) $m[1] ), min( 255, (int) $m[2] ), min( 255, (int) $m[3] ) );
		}
		return null;
	}

	/**
	 * Relative luminance (WCAG) of a colour.
	 *
	 * @param array{0:int,1:int,2:int} $rgb Red, green, blue.
	 */
	private static function luminance( array $rgb ): float {
		$lum = 0.0;
		foreach ( array( 0.2126, 0.7152, 0.0722 ) as $i => $weight ) {
			$c    = $rgb[ $i ] / 255;
			$lum += $weight * ( $c <= 0.04045 ? $c / 12.92 : ( ( $c + 0.055 ) / 1.055 ) ** 2.4 );
		}
		return $lum;
	}

	/**
	 * The @font-face rules of the fonts the tokens name.
	 *
	 * @param array<string,mixed> $tokens Tokens.
	 * @param bool                $embed  Files as data URLs (FormFont::resolve()).
	 * @return list<string>
	 */
	public static function font_rules( array $tokens, bool $embed = false ): array {
		$rules = array();
		foreach ( array( 'font.family', 'font.heading', 'font.field' ) as $token ) {
			$css = FormFont::resolve( is_scalar( $tokens[ $token ] ?? null ) ? (string) $tokens[ $token ] : '', $embed )['css'];
			if ( '' !== $css && ! in_array( $css, $rules, true ) ) {
				$rules[] = $css;
			}
		}
		return $rules;
	}

	/**
	 * The CSS value of one token, or '' when the value does not fit its kind.
	 *
	 * @param string $token Token.
	 * @param string $kind  Kind.
	 * @param string $value Value as stored.
	 */
	private static function value( string $token, string $kind, string $value ): string {
		switch ( $kind ) {
			case 'name':
				return self::NAMED[ $token ][ $value ] ?? '';
			case 'image':
				return self::image( $value );
			case 'font':
				$value = FormFont::resolve( $value )['family'];
				break;
			case 'number':
				if ( ! is_numeric( $value ) ) {
					return '';
				}
				[ $min, $max ] = self::NUMBERS[ $token ];
				$number        = max( $min, min( $max, (float) $value ) );
				return 'background.angle' === $token ? $number . 'deg' : (string) $number;
			case 'color':
				if ( 1 !== preg_match( '/^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([0-9.,%\s\/]{1,60}\)|[a-zA-Z]{3,20})$/', $value ) ) {
					return '';
				}
				break;
		}
		// Colours, lengths and font names only; no url() or other image functions.
		if ( '' === $value || 1 !== preg_match( '/^[#a-zA-Z0-9(),.%\s\'"\/-]{1,100}$/', $value ) || 1 === preg_match( '/(url|image|image-set|element|expression)\s*\(/i', $value ) ) {
			return '';
		}
		if ( 'px' === $kind && is_numeric( $value ) ) {
			$value = max( 0, min( 400, (float) $value ) ) . 'px';
		}
		return $value;
	}

	/**
	 * The address of a background image: an image of the media library, by its ID.
	 *
	 * @param string $value Attachment ID.
	 */
	private static function image( string $value ): string {
		if ( 1 !== preg_match( '/^[1-9][0-9]{0,18}$/', $value ) || ! wp_attachment_is_image( (int) $value ) ) {
			return '';
		}
		$url = wp_get_attachment_image_url( (int) $value, 'full' );
		return is_string( $url ) && '' !== $url ? 'url("' . esc_url( $url ) . '")' : '';
	}

	/**
	 * A shadow from its parts: shadow.x, shadow.y, shadow.blur, shadow.spread (pixels),
	 * shadow.color and shadow.inset ("1").
	 *
	 * @param array<string,mixed> $tokens Tokens.
	 */
	private static function shadow( array $tokens ): string {
		$px    = static function ( string $key, int $min, int $max, int $fallback ) use ( $tokens ): string {
			$value = $tokens[ $key ] ?? '';
			return ( is_numeric( $value ) ? max( $min, min( $max, (int) $value ) ) : $fallback ) . 'px';
		};
		$color = self::value( 'shadow.color', 'color', is_scalar( $tokens['shadow.color'] ?? null ) ? trim( (string) $tokens['shadow.color'] ) : '' );
		return ( '1' === ( $tokens['shadow.inset'] ?? '' ) ? 'inset ' : '' )
			. $px( 'shadow.x', -40, 40, 0 ) . ' ' . $px( 'shadow.y', -40, 40, 8 ) . ' '
			. $px( 'shadow.blur', 0, 80, 24 ) . ' ' . $px( 'shadow.spread', -40, 40, 0 ) . ' '
			. ( '' !== $color ? $color : 'rgba(16,24,40,0.12)' );
	}
}
