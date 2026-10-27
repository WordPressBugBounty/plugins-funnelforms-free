<?php
/**
 * The design of a Funnelforms 4 form as style tokens.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Ff4;

defined( 'ABSPATH' ) || exit;

/**
 * Funnelforms 4 keeps the design in form_styles.style_data (type FormStyle in
 * src/components/form-editor/utils/styleUtils.ts of the SaaS). The tokens of 5.0 follow it
 * (Frontend\StyleTokens), so most values carry over one to one. Background images (5.0 takes an
 * attachment of the media library) and own uploaded fonts are noted instead.
 *
 * Pure PHP without WordPress.
 */
final class Ff4Style {

	/** Theme names of Funnelforms 4 and the theme of 5.0 made after each. */
	private const THEMES = array(
		'Default'         => 'funnelforms',
		'Corporate Blue'  => 'corporate',
		'Minimal Dark'    => 'dark',
		'Gradient Purple' => 'lavender',
		'Modern Green'    => 'green',
		'Creative Orange' => 'orange',
		'Elegant Serif'   => 'elegant',
		'Friendly Pink'   => 'pink',
		'Tech Blue'       => 'tech',
		'Bold Red'        => 'red',
		'Soft Pastel'     => 'pastel',
	);

	/** Colour of Funnelforms 4 => token. */
	private const COLORS = array(
		'primary'              => 'color.primary',
		'text'                 => 'color.text',
		'headings'             => 'color.heading',
		'descriptionText'      => 'color.muted',
		'border'               => 'color.border',
		'error'                => 'color.error',
		'nextButtonBackground' => 'color.button',
		'nextButtonText'       => 'color.onButton',
		'buttonText'           => 'color.onPrimary',
		'backButtonBackground' => 'color.back',
		'backButtonText'       => 'color.onBack',
		'progressFilled'       => 'color.progress',
		'progressBackground'   => 'color.progressTrack',
		'selectionIconColor'   => 'color.icon',
	);

	/** Sizes of Funnelforms 4 => token. */
	private const SIZES = array(
		'typography.bodySize'               => 'font.size',
		'typography.mobileBodySize'         => 'font.size.mobile',
		'typography.headingSize'            => 'font.size.heading',
		'typography.mobileHeadingSize'      => 'font.size.heading.mobile',
		'typography.formElementsSize'       => 'font.size.field',
		'typography.mobileFormElementsSize' => 'font.size.field.mobile',
		'typography.headingLineHeight'      => 'line.heading',
		'typography.bodyLineHeight'         => 'line.body',
		'spacing.answerSpacing'             => 'space.gap',
		'spacing.containerPadding'          => 'space.padding',
		'spacing.buttonPadding'             => 'space.button',
		'spacing.iconSize'                  => 'size.icon',
		'spacing.mobileIconSize'            => 'size.icon.mobile',
		'borders.borderWidth'               => 'border.width',
	);

	/** Step animations of Funnelforms 4. */
	private const ANIMATIONS = array(
		'none'        => 'none',
		'fade'        => 'fade',
		'fadeRight'   => 'fadeRight',
		'backInRight' => 'backInRight',
		'slideRight'  => 'slide',
	);

	/** Generic font names the site always has. */
	private const GENERIC = array( 'inherit', 'system-ui', 'sans-serif', 'serif', 'monospace', 'montserrat', 'poppins' );

	/**
	 * Style of the document and settings it decides (heading, progress bar), with notes.
	 *
	 * @param array<string,mixed> $data Style data of Funnelforms 4.
	 * @param string              $css  Own CSS of the form (form_settings.advanced.customCss).
	 * @return array{style:array<string,mixed>,progress:array{show:bool,percent:bool},heading:string,notes:string[]}
	 */
	public static function convert( array $data, string $css ): array {
		$tokens = array();
		$notes  = array();
		$colors = is_array( $data['colors'] ?? null ) ? $data['colors'] : array();

		foreach ( self::COLORS as $from => $token ) {
			$color = self::color( $colors[ $from ] ?? null );
			if ( null !== $color ) {
				$tokens[ $token ] = $color;
			}
		}
		$option = self::color( $colors['selectionBackgroundColor'] ?? null ) ?? self::color( $colors['secondary'] ?? null );
		if ( null !== $option ) {
			$tokens['color.option'] = $option;
		}

		$background = is_array( $data['backgrounds'] ?? null ) ? $data['backgrounds'] : array();
		$stops      = is_array( $background['gradientColors'] ?? null ) ? array_values( $background['gradientColors'] ) : array();
		switch ( $background['type'] ?? 'color' ) {
			case 'transparent':
				$tokens['color.background'] = 'transparent';
				break;
			case 'gradient':
				$from = self::color( $stops[0] ?? null );
				$to   = self::color( $stops[ count( $stops ) - 1 ] ?? null );
				if ( null !== $from ) {
					$tokens['color.background'] = $from;
				}
				if ( null !== $to ) {
					$tokens['color.backgroundEnd'] = $to;
				}
				$tokens['background.angle'] = (string) self::angle( (string) ( $background['gradientDirection'] ?? '' ) );
				break;
			case 'image':
				$notes[] = 'ff4_background_image_not_imported';
				// The colour behind the image still counts.
				$from = self::color( $stops[0] ?? null );
				if ( null !== $from ) {
					$tokens['color.background'] = $from;
				}
				break;
			default:
				$color = self::color( $stops[0] ?? null );
				if ( null !== $color ) {
					$opacity = $background['colorOpacity'] ?? 1;
					if ( is_numeric( $opacity ) && $opacity < 1 && 1 === preg_match( '/^#([0-9a-f]{6})$/i', $color, $m ) ) {
						$color = sprintf( 'rgba(%d,%d,%d,%s)', hexdec( substr( $m[1], 0, 2 ) ), hexdec( substr( $m[1], 2, 2 ) ), hexdec( substr( $m[1], 4, 2 ) ), (string) round( max( 0, (float) $opacity ), 2 ) );
					}
					$tokens['color.background'] = $color;
				}
		}

		$typography = is_array( $data['typography'] ?? null ) ? $data['typography'] : array();
		foreach ( array(
			'bodyFont'         => 'font.family',
			'headingFont'      => 'font.heading',
			'formElementsFont' => 'font.field',
		) as $from => $token ) {
			$font = self::font( $typography[ $from ] ?? null );
			if ( null === $font ) {
				continue;
			}
			$tokens[ $token ] = $font;
			if ( ! in_array( strtolower( $font ), self::GENERIC, true ) ) {
				$notes[] = 'ff4_font:' . $font;
			}
		}
		$weight = (string) ( $typography['fontWeight'] ?? '' );
		if ( in_array( $weight, array( 'normal', 'medium', 'bold' ), true ) ) {
			$tokens['font.weight.heading'] = $weight;
		}
		if ( ! empty( $data['customFont']['enabled'] ) ) {
			$notes[] = 'ff4_custom_font_not_imported:' . self::plain( (string) ( $data['customFont']['name'] ?? '' ) );
		}

		foreach ( self::SIZES as $path => $token ) {
			[ $group, $key ] = explode( '.', $path, 2 );
			$value           = $data[ $group ][ $key ] ?? null;
			if ( is_numeric( $value ) && $value >= 0 ) {
				$tokens[ $token ] = (string) ( 0 + $value );
			}
		}

		$borders = is_array( $data['borders'] ?? null ) ? $data['borders'] : array();
		if ( is_numeric( $borders['borderRadius'] ?? null ) ) {
			$radius                  = (string) max( 0, (int) $borders['borderRadius'] );
			$tokens['radius.card']   = $radius;
			$tokens['radius.input']  = $radius;
			$tokens['radius.button'] = $radius;
		}
		if ( in_array( $borders['borderStyle'] ?? '', array( 'solid', 'dashed', 'dotted', 'none' ), true ) ) {
			$tokens['border.style'] = (string) $borders['borderStyle'];
		}
		if ( ! empty( $borders['applyToContainer'] ) ) {
			$tokens['border.container'] = 'on';
		}
		if ( is_array( $borders['shadow'] ?? null ) ) {
			$tokens['shadow'] = ! empty( $borders['shadow']['enable'] ) ? 'soft' : 'none';
		}

		$animation = (string) ( $data['animation']['animationType'] ?? '' );
		if ( isset( self::ANIMATIONS[ $animation ] ) ) {
			$tokens['animation'] = self::ANIMATIONS[ $animation ];
		}

		$style = array(
			'preset' => 'default',
			'tokens' => $tokens,
		);
		$theme = self::THEMES[ (string) ( $data['themeName'] ?? '' ) ] ?? null;
		if ( null !== $theme ) {
			$style['theme'] = $theme;
		}
		$css = trim( str_ireplace( '</style', '', $css ) );
		if ( '' !== $css ) {
			$style['css'] = mb_substr( $css, 0, 20000 );
		}

		$display = is_array( $data['display'] ?? null ) ? $data['display'] : array();
		$header  = is_array( $data['header'] ?? null ) ? $data['header'] : array();
		return array(
			'style'    => $style,
			'progress' => array(
				'show'    => empty( $display['hideProgressBar'] ),
				'percent' => empty( $display['hidePercentageAndSteps'] ),
			),
			'heading'  => ! empty( $header['enabled'] ) ? self::plain( (string) ( $header['text'] ?? '' ) ) : '',
			'notes'    => $notes,
		);
	}

	/**
	 * A colour the tokens accept, or null.
	 *
	 * @param mixed $value Value.
	 */
	private static function color( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = trim( $value );
		return 1 === preg_match( '/^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([0-9.,%\s\/]{1,60}\)|[a-zA-Z]{3,20})$/', $value ) ? $value : null;
	}

	/**
	 * The first family of a font stack ("Inter, sans-serif" is Inter).
	 *
	 * @param mixed $value Value.
	 */
	private static function font( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$family = trim( explode( ',', $value )[0], " \t\"'" );
		return 1 === preg_match( '/^[A-Za-z0-9 _-]{1,60}$/', $family ) ? $family : null;
	}

	/**
	 * Degrees of a CSS gradient direction ("to bottom right" is 135).
	 *
	 * @param string $direction Direction.
	 */
	private static function angle( string $direction ): int {
		$direction = strtolower( trim( $direction ) );
		if ( 1 === preg_match( '/^(-?\d+(\.\d+)?)deg$/', $direction, $m ) ) {
			return ( (int) round( (float) $m[1] ) % 360 + 360 ) % 360;
		}
		$angles = array(
			'to top'          => 0,
			'to top right'    => 45,
			'to right top'    => 45,
			'to right'        => 90,
			'to bottom right' => 135,
			'to right bottom' => 135,
			'to bottom'       => 180,
			'to bottom left'  => 225,
			'to left bottom'  => 225,
			'to left'         => 270,
			'to top left'     => 315,
			'to left top'     => 315,
		);
		return $angles[ $direction ] ?? 180;
	}

	/**
	 * Text without markup.
	 *
	 * @param string $text Text.
	 */
	private static function plain( string $text ): string {
		return trim( html_entity_decode( strip_tags( $text ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- runs without WordPress in unit tests.
	}
}
