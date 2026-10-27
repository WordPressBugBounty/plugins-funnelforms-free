<?php
/**
 * Colours and fonts of a website, read from its HTML and CSS.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

/**
 * Reads what a website shows: the theme colour of its meta tags, the colour variables of its
 * theme or page builder (WordPress presets, Elementor globals, the palettes of Astra, Kadence and
 * GeneratePress, --primary and the like), the colours and font of body, buttons, links and
 * headings, and how often each colour is used. Values that name a variable (var(--x)) are read
 * through it. The result is a suggestion for the builder with how sure it is; the user picks what
 * the form takes.
 */
final class Branding {

	/** Colours offered to choose from. */
	public const MAX_COLORS = 10;

	/** Fonts offered to choose from. */
	public const MAX_FONTS = 5;

	/**
	 * Evidence for the accent colour (from names, buttons and links, not from how often a colour
	 * is used) from which the suggestion counts as sure, and from which as likely.
	 */
	public const SURE = 30;

	public const LIKELY = 10;

	private const GENERIC = array( 'inherit', 'initial', 'unset', 'revert', 'serif', 'sans-serif', 'cursive', 'fantasy', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'emoji', 'math' );

	/**
	 * Colours WordPress, themes and page builders define on every site whether it uses them or
	 * not: the default palette and button of the block editor, Elementor's default globals and
	 * button, the defaults of Hello Elementor, Divi, Astra, Kadence and GeneratePress. They are
	 * never the brand by being used, a button in one of them is a theme's default, and named as
	 * the accent they make the suggestion less sure.
	 */
	public const DEFAULTS = array( '#abb8c3', '#f78da7', '#cf2e2e', '#ff6900', '#fcb900', '#7bdcb5', '#00d084', '#8ed1fc', '#0693e3', '#9b51e0', '#32373c', '#6ec1e4', '#54595f', '#7a7a7a', '#61ce70', '#69727d', '#cc3366', '#2ea3f2', '#046bd2', '#0170b9', '#2b6cb0', '#1e73be', '#55555e' );

	/**
	 * Colours and fonts of a page.
	 *
	 * @param string        $html The page.
	 * @param array<string> $css  Its linked stylesheets.
	 * @return array{colors:list<string>,roles:array{primary?:string,text?:string,background?:string},fonts:list<string>,confidence:string}
	 *         confidence: high, medium or low (see SURE and LIKELY).
	 */
	public static function analyse( string $html, array $css ): array {
		$found = array(
			'roles' => array(
				'primary'    => array(),
				'text'       => array(),
				'background' => array(),
			),
			// Points for the accent colour from names, buttons and links.
			'named' => array(),
			'uses'  => array(),
			'fonts' => array(),
		);

		foreach ( self::tags( $html, 'meta' ) as $meta ) {
			$name  = strtolower( self::attr( $meta, 'name' ) ?? '' );
			$color = self::color( self::attr( $meta, 'content' ) ?? '' );
			if ( null !== $color && in_array( $name, array( 'theme-color', 'msapplication-tilecolor' ), true ) ) {
				// Browsers tint their bar with it; light or grey ones are usually the page.
				if ( self::colourful( $color ) ) {
					self::accent( $found, $color, 'theme-color' === $name ? 35 : 15 );
				} else {
					self::add( $found['roles']['background'], $color, 10 );
				}
			}
		}
		foreach ( self::tags( $html, 'link' ) as $link ) {
			foreach ( self::font_service_families( html_entity_decode( self::attr( $link, 'href' ) ?? '', ENT_QUOTES ) ) as $family ) {
				self::add( $found['fonts'], $family, 15 );
			}
		}

		$sheets = array();
		if ( preg_match_all( '#<style\b[^>]*>(.*?)</style>#is', $html, $m ) ) {
			$sheets = $m[1];
		}
		foreach ( self::tags( $html, '(?:body|html)' ) as $tag ) {
			$style = self::attr( $tag, 'style' );
			if ( null !== $style && 1 === preg_match( '/^<(body|html)/i', $tag, $t ) ) {
				$sheets[] = strtolower( $t[1] ) . '{' . html_entity_decode( $style, ENT_QUOTES ) . '}';
			}
		}
		$sheets = array_map( static fn( $sheet ): string => (string) preg_replace( '#/\*.*?\*/#s', '', (string) $sheet ), array_merge( $sheets, $css ) );
		// The variables first, so declarations that name one can be read through it.
		$variables = array();
		foreach ( $sheets as $sheet ) {
			foreach ( self::rules( $sheet ) as [ $selectors, $declarations ] ) {
				$root = self::is_root( $selectors );
				foreach ( $declarations as [ $property, $value ] ) {
					if ( str_starts_with( $property, '--' ) && ( $root || ! isset( $variables[ $property ] ) ) ) {
						$variables[ $property ] = $value;
					}
				}
			}
		}
		foreach ( $sheets as $sheet ) {
			self::sheet( $sheet, $variables, $found );
		}

		// The accent colour, when nothing names it: the colourful colour used most.
		foreach ( $found['uses'] as $color => $count ) {
			if ( self::colourful( (string) $color ) && ! in_array( (string) $color, self::DEFAULTS, true ) ) {
				self::add( $found['roles']['primary'], (string) $color, min( 30, $count ) );
			}
		}

		$picked     = array();
		$candidates = array();
		foreach ( $found['roles'] as $role => $scores ) {
			arsort( $scores );
			$best = array_key_first( $scores );
			if ( null !== $best ) {
				$picked[ $role ] = (string) $best;
			}
			$candidates = array_merge( $candidates, array_map( 'strval', array_keys( $scores ) ) );
		}
		$uses = $found['uses'];
		arsort( $uses );
		$colors = array();
		// The picks first, then what else has a role, then what is used most; never the colours
		// every WordPress site defines.
		foreach ( array_merge( array_values( $picked ), $candidates, array_map( 'strval', array_keys( $uses ) ) ) as $color ) {
			if ( count( $colors ) < self::MAX_COLORS && ! self::near_any( $color, $colors ) && ( in_array( $color, $picked, true ) || ! in_array( $color, self::DEFAULTS, true ) ) ) {
				$colors[] = $color;
			}
		}
		$fonts = $found['fonts'];
		arsort( $fonts );
		return array(
			'colors'     => $colors,
			'roles'      => $picked,
			'fonts'      => array_slice( array_map( 'strval', array_keys( $fonts ) ), 0, self::MAX_FONTS ),
			'confidence' => self::confidence( $picked, $found['named'] ),
		);
	}

	/**
	 * How sure the suggestion is: high when the accent colour is named as such (a variable, the
	 * site's buttons, the theme colour) and text or background were found too; medium when there
	 * is some evidence or the accent is a default of WordPress or a page builder; low when the
	 * accent is only the colour used most, or none was found.
	 *
	 * @param array<string,string> $picked The suggestion per role.
	 * @param array<string,int>    $named  Evidence per colour.
	 */
	public static function confidence( array $picked, array $named ): string {
		$primary  = $picked['primary'] ?? null;
		$evidence = null === $primary ? 0 : ( $named[ $primary ] ?? 0 );
		if ( $evidence >= self::SURE && ! in_array( $primary, self::DEFAULTS, true ) && ( isset( $picked['text'] ) || isset( $picked['background'] ) ) ) {
			return 'high';
		}
		return $evidence >= self::LIKELY ? 'medium' : 'low';
	}

	/**
	 * A colour as #rrggbb: hex (#rgb, #rrggbb, opaque #rgba and #rrggbbaa), opaque rgb()/rgba()
	 * and hsl()/hsla(); null for anything else.
	 *
	 * @param string $value CSS value.
	 */
	public static function color( string $value ): ?string {
		$v = strtolower( trim( $value ) );
		if ( 1 === preg_match( '/^#([0-9a-f]{3,8})$/', $v, $m ) ) {
			$hex = $m[1];
			if ( 3 === strlen( $hex ) || 4 === strlen( $hex ) ) {
				if ( 4 === strlen( $hex ) && 'f' !== $hex[3] ) {
					return null;
				}
				$hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
			} elseif ( 8 === strlen( $hex ) ) {
				if ( 'ff' !== substr( $hex, 6 ) ) {
					return null;
				}
				$hex = substr( $hex, 0, 6 );
			} elseif ( 6 !== strlen( $hex ) ) {
				return null;
			}
			return '#' . $hex;
		}
		if ( 1 === preg_match( '/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,\/]\s*([\d.]+)(%?)\s*)?\)$/', $v, $m ) ) {
			if ( ! self::opaque( $m[4] ?? '', $m[5] ?? '' ) ) {
				return null;
			}
			return sprintf( '#%02x%02x%02x', min( 255, (int) $m[1] ), min( 255, (int) $m[2] ), min( 255, (int) $m[3] ) );
		}
		if ( 1 === preg_match( '/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,\/]\s*([\d.]+)(%?)\s*)?\)$/', $v, $m ) ) {
			if ( ! self::opaque( $m[4] ?? '', $m[5] ?? '' ) ) {
				return null;
			}
			$h = fmod( (float) $m[1], 360 ) / 360;
			$s = min( 100, (float) $m[2] ) / 100;
			$l = min( 100, (float) $m[3] ) / 100;
			$q = $l < 0.5 ? $l * ( 1 + $s ) : $l + $s - $l * $s;
			$p = 2 * $l - $q;
			return sprintf( '#%02x%02x%02x', self::hue( $p, $q, $h + 1 / 3 ), self::hue( $p, $q, $h ), self::hue( $p, $q, $h - 1 / 3 ) );
		}
		return null;
	}

	/**
	 * Whether an alpha value is opaque (missing counts as opaque).
	 *
	 * @param string $alpha   Number.
	 * @param string $percent "%" when it is a percentage.
	 */
	private static function opaque( string $alpha, string $percent ): bool {
		return '' === $alpha || (float) $alpha >= ( '%' === $percent ? 100 : 1 );
	}

	/**
	 * One channel of an HSL colour (0–255).
	 *
	 * @param float $p Lower bound.
	 * @param float $q Upper bound.
	 * @param float $t Hue of the channel.
	 */
	private static function hue( float $p, float $q, float $t ): int {
		$t = $t < 0 ? $t + 1 : ( $t > 1 ? $t - 1 : $t );
		if ( $t < 1 / 6 ) {
			$v = $p + ( $q - $p ) * 6 * $t;
		} elseif ( $t < 1 / 2 ) {
			$v = $q;
		} elseif ( $t < 2 / 3 ) {
			$v = $p + ( $q - $p ) * ( 2 / 3 - $t ) * 6;
		} else {
			$v = $p;
		}
		return (int) round( $v * 255 );
	}

	/**
	 * The rules of a stylesheet: selectors (lower case) and declarations (property, value without
	 * !important). Rules inside @media and @supports count like the others.
	 *
	 * @param string $css Without comments.
	 * @return list<array{list<string>,list<array{string,string}>}>
	 */
	private static function rules( string $css ): array {
		if ( ! preg_match_all( '/([^{}]+)\{([^{}]*)\}/', $css, $rules, PREG_SET_ORDER ) ) {
			return array();
		}
		$out = array();
		foreach ( $rules as $rule ) {
			$declarations = array();
			foreach ( explode( ';', $rule[2] ) as $declaration ) {
				$parts = explode( ':', $declaration, 2 );
				if ( 2 === count( $parts ) ) {
					$declarations[] = array( strtolower( trim( $parts[0] ) ), trim( str_ireplace( '!important', '', $parts[1] ) ) );
				}
			}
			$out[] = array( self::selectors( $rule[1] ), $declarations );
		}
		return $out;
	}

	/**
	 * Selectors of a rule, split at the commas outside of parentheses.
	 *
	 * @param string $text Selector list.
	 * @return list<string>
	 */
	private static function selectors( string $text ): array {
		$out   = array();
		$depth = 0;
		$part  = '';
		foreach ( str_split( strtolower( $text ) ) as $char ) {
			$depth += '(' === $char ? 1 : ( ')' === $char ? -1 : 0 );
			if ( ',' === $char && $depth <= 0 ) {
				$out[] = trim( $part );
				$part  = '';
				continue;
			}
			$part .= $char;
		}
		$out[] = trim( $part );
		return array_values( array_filter( $out, static fn( string $s ): bool => '' !== $s ) );
	}

	/**
	 * Whether a rule styles the whole page: html, body (with classes), :root and the kit of
	 * Elementor, which sits on body.
	 *
	 * @param array<string> $selectors Selectors.
	 */
	private static function is_root( array $selectors ): bool {
		return (bool) preg_grep( '/^(html|:root|html body|body(\.[\w-]+)*|(:root\s*)?:where\(body\)|\.elementor-kit-\d+)$/', $selectors );
	}

	/**
	 * The rules of a stylesheet.
	 *
	 * @param string                                                                                                                                                                   $css       Without comments.
	 * @param array<string,string>                                                                                                                                                     $variables Custom properties of the page.
	 * @param array{roles:array{primary:array<string,int>,text:array<string,int>,background:array<string,int>},named:array<string,int>,uses:array<string,int>,fonts:array<string,int>} $found Scores so far.
	 */
	private static function sheet( string $css, array $variables, array &$found ): void {
		if ( preg_match_all( '/@import\s+(?:url\()?\s*["\']?([^"\')\s;]+)/i', $css, $imports ) ) {
			foreach ( $imports[1] as $url ) {
				foreach ( self::font_service_families( $url ) as $family ) {
					self::add( $found['fonts'], $family, 15 );
				}
			}
		}
		foreach ( self::rules( $css ) as [ $selectors, $declarations ] ) {
			// Hover, focus and similar states, outlined buttons and the colour classes WordPress
			// defines for every colour of the palette say nothing about the brand.
			$plain = array_values( array_filter( $selectors, static fn( string $s ): bool => 1 !== preg_match( '/:(hover|focus|focus-visible|focus-within|active|disabled|visited)\b|::|is-style-outline|\.has-[\w-]+-(color|background-color|border-color)\b/', $s ) ) );
			if ( array() === $plain ) {
				continue;
			}
			$root = self::is_root( $plain );
			// Buttons of WordPress, Elementor, Divi, Astra, Kadence and GenerateBlocks count more than a plain <button>.
			$element = (bool) preg_grep( '/(wp-element-button|wp-block-button__link|elementor-button|et_pb_button|ast-button|ast-custom-button|kb-button|gb-button)\b/', $plain );
			$button  = $element || (bool) preg_grep( '/(^|[\s>.(])(button|btn)\b|type=["\']?submit/', $plain );
			$link    = (bool) preg_grep( '/(^|[\s>(])a(:link|:where\(.*\))?\)?$/', $plain );
			$heading = (bool) preg_grep( '/(^|[\s>(])h[1-3]\)?$/', $plain );
			foreach ( $declarations as [ $property, $value ] ) {
				$value = self::resolve( $value, $variables );
				if ( str_starts_with( $property, '--' ) ) {
					self::variable( $property, $value, $found );
					continue;
				}
				if ( 'font-family' === $property ) {
					$family = self::first_family( $value );
					if ( null !== $family ) {
						self::add( $found['fonts'], $family, $root ? 20 : ( $heading ? 8 : 1 ) );
					}
					continue;
				}
				$colors = self::colors_in( $value );
				foreach ( $colors as $color ) {
					$found['uses'][ $color ] = ( $found['uses'][ $color ] ?? 0 ) + 1;
				}
				$first = $colors[0] ?? null;
				if ( null === $first ) {
					continue;
				}
				$background = in_array( $property, array( 'background', 'background-color' ), true );
				// What body shows counts more than what a variable's name suggests.
				if ( $root && 'color' === $property ) {
					self::add( $found['roles']['text'], $first, 35 );
				} elseif ( $root && $background ) {
					self::add( $found['roles']['background'], $first, 35 );
				} elseif ( $button && $background && ! self::light( $first ) ) {
					self::accent( $found, $first, $element && ! in_array( $first, self::DEFAULTS, true ) ? 45 : 6 );
				} elseif ( $button && in_array( $property, array( 'color', 'border-color' ), true ) && self::colourful( $first ) ) {
					// A colourful text or border on a button: an outlined button in the accent colour.
					self::accent( $found, $first, 'color' === $property ? 8 : 4 );
				} elseif ( $link && 'color' === $property && self::colourful( $first ) ) {
					self::accent( $found, $first, 3 );
				}
			}
		}
	}

	/**
	 * A value with the variables it names replaced by theirs (var(--x, fallback)), three levels deep.
	 *
	 * @param string               $value     Value.
	 * @param array<string,string> $variables Custom properties.
	 */
	private static function resolve( string $value, array $variables ): string {
		$depth = 0;
		while ( $depth++ < 3 && str_contains( $value, 'var(' ) ) {
			$value = (string) preg_replace_callback(
				'/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/',
				static fn( array $m ): string => $variables[ strtolower( $m[1] ) ] ?? trim( $m[2] ?? '' ),
				$value
			);
		}
		return $value;
	}

	/**
	 * A custom property: colours and fonts its name gives a role (WordPress presets, Elementor
	 * globals, the global palettes of Astra and Kadence, --primary, --brand-color, --text-color
	 * and the like).
	 *
	 * @param string                                                                                                                                                                   $name  Property.
	 * @param string                                                                                                                                                                   $value Value, its variables read.
	 * @param array{roles:array{primary:array<string,int>,text:array<string,int>,background:array<string,int>},named:array<string,int>,uses:array<string,int>,fonts:array<string,int>} $found Scores so far.
	 */
	private static function variable( string $name, string $value, array &$found ): void {
		if ( str_contains( $name, 'font-family' ) ) {
			$family = self::first_family( $value );
			if ( null !== $family ) {
				self::add( $found['fonts'], $family, preg_match( '/(primary|body|base|text)/', $name ) ? 10 : 4 );
			}
			return;
		}
		$color = self::color( $value );
		if ( null === $color ) {
			return;
		}
		// Palettes numbered by their themes: Astra (--ast-global-color-0 the brand, -3 the text)
		// and Kadence (--global-palette1 the accent, 4 the text, 8 and 9 the backgrounds).
		$numbered = array(
			'--ast-global-color-0' => array( 'primary', 40 ),
			'--ast-global-color-2' => array( 'text', 10 ),
			'--ast-global-color-3' => array( 'text', 30 ),
			'--ast-global-color-4' => array( 'background', 12 ),
			'--ast-global-color-5' => array( 'background', 10 ),
			'--global-palette1'    => array( 'primary', 40 ),
			'--global-palette3'    => array( 'text', 10 ),
			'--global-palette4'    => array( 'text', 30 ),
			'--global-palette8'    => array( 'background', 12 ),
			'--global-palette9'    => array( 'background', 12 ),
		);
		if ( isset( $numbered[ $name ] ) ) {
			[ $role, $points ] = $numbered[ $name ];
			if ( 'primary' === $role ) {
				self::accent( $found, $color, $points );
			} else {
				self::add( $found['roles'][ $role ], $color, $points );
			}
			return;
		}
		if ( preg_match( '/(hover|focus|active|light|dark|shadow|border|secondary|tertiary|muted|alt\b|gradient|vivid|pale|luminous)/', $name ) ) {
			return;
		}
		if ( preg_match( '/(primary|brand)(-colou?r)?$/', $name ) ) {
			self::accent( $found, $color, 40 );
		} elseif ( preg_match( '/accent(-?1)?(-colou?r)?$/', $name ) ) {
			self::accent( $found, $color, 30 );
		} elseif ( preg_match( '/accent-?[2-9]$/', $name ) ) {
			self::accent( $found, $color, 4 );
		} elseif ( preg_match( '/(-text|foreground|contrast|body-color|font-color|text-color)$/', $name ) ) {
			self::add( $found['roles']['text'], $color, 30 );
		} elseif ( preg_match( '/(background|-base|-bg|body-bg)$/', $name ) ) {
			self::add( $found['roles']['background'], $color, 30 );
		}
	}

	/**
	 * Evidence for an accent colour.
	 *
	 * @param array{roles:array{primary:array<string,int>,text:array<string,int>,background:array<string,int>},named:array<string,int>,uses:array<string,int>,fonts:array<string,int>} $found  Scores so far.
	 * @param string                                                                                                                                                                   $color  #rrggbb.
	 * @param int                                                                                                                                                                      $points Points.
	 */
	private static function accent( array &$found, string $color, int $points ): void {
		self::add( $found['roles']['primary'], $color, $points );
		self::add( $found['named'], $color, $points );
	}

	/**
	 * The first family of a font-family value that is a font of its own (not generic, an icon font,
	 * a system font stack or a variable).
	 *
	 * @param string $value Value.
	 */
	public static function first_family( string $value ): ?string {
		// A stack of system fonts (-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto …) is no brand font.
		if ( 1 === preg_match( '/^\s*["\']?(-apple-system|blinkmacsystemfont|system-ui)\b/i', $value ) ) {
			return null;
		}
		foreach ( explode( ',', $value ) as $part ) {
			$family = trim( trim( $part ), '"\' ' );
			if ( '' === $family || str_contains( $family, 'var(' ) || in_array( strtolower( $family ), self::GENERIC, true ) ) {
				continue;
			}
			if ( preg_match( '/(icon|awesome|dashicons|glyph|eicons|material symbols|fa-|swiper|etmodules)/i', $family ) || 1 !== preg_match( '/^[A-Za-z0-9 _-]{1,60}$/', $family ) ) {
				return null;
			}
			return $family;
		}
		return null;
	}

	/**
	 * Families of a Google Fonts or Bunny Fonts stylesheet address (the families are in it).
	 *
	 * @param string $url Address.
	 * @return list<string>
	 */
	private static function font_service_families( string $url ): array {
		if ( 1 !== preg_match( '#^(?:https?:)?//(fonts\.googleapis\.com|fonts\.bunny\.net)/#i', $url ) ) {
			return array();
		}
		$out = array();
		// Several family parameters (css2) or one with families separated by | (css).
		if ( preg_match_all( '/[?&]family=([^&]+)/', $url, $m ) ) {
			foreach ( $m[1] as $param ) {
				foreach ( explode( '|', urldecode( $param ) ) as $spec ) {
					$family = trim( explode( ':', $spec )[0] );
					if ( 1 === preg_match( '/^[A-Za-z0-9 _-]{1,60}$/', $family ) ) {
						$out[] = $family;
					}
				}
			}
		}
		return $out;
	}

	/**
	 * Colours in a declaration's value.
	 *
	 * @param string $value Value.
	 * @return list<string>
	 */
	private static function colors_in( string $value ): array {
		if ( ! preg_match_all( '/#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/i', $value, $m ) ) {
			return array();
		}
		return array_values( array_filter( array_map( array( self::class, 'color' ), $m[0] ) ) );
	}

	/**
	 * Opening tags of an element.
	 *
	 * @param string $html Page.
	 * @param string $name Element (a regular expression).
	 * @return list<string>
	 */
	private static function tags( string $html, string $name ): array {
		return preg_match_all( '#<' . $name . '\b[^>]*>#i', $html, $m ) ? $m[0] : array();
	}

	/**
	 * An attribute of an opening tag; null when it has none.
	 *
	 * @param string $tag  Tag.
	 * @param string $name Attribute.
	 */
	private static function attr( string $tag, string $name ): ?string {
		if ( 1 !== preg_match( '/\s' . preg_quote( $name, '/' ) . '\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', $tag, $m ) ) {
			return null;
		}
		return $m[3] ?? ( '' !== ( $m[2] ?? '' ) ? $m[2] : $m[1] );
	}

	/**
	 * Adds to a score.
	 *
	 * @param array<string,int> $scores Scores.
	 * @param string            $key    Colour or font.
	 * @param int               $points Points.
	 */
	private static function add( array &$scores, string $key, int $points ): void {
		$scores[ $key ] = ( $scores[ $key ] ?? 0 ) + $points;
	}

	/**
	 * Red, green and blue of #rrggbb.
	 *
	 * @param string $color Colour.
	 * @return array{int,int,int}
	 */
	private static function rgb( string $color ): array {
		return array( (int) hexdec( substr( $color, 1, 2 ) ), (int) hexdec( substr( $color, 3, 2 ) ), (int) hexdec( substr( $color, 5, 2 ) ) );
	}

	/**
	 * Whether a colour is a colour rather than white, black or grey.
	 *
	 * @param string $color #rrggbb.
	 */
	public static function colourful( string $color ): bool {
		[ $r, $g, $b ] = self::rgb( $color );
		$max           = max( $r, $g, $b );
		$min           = min( $r, $g, $b );
		$lightness     = ( $max + $min ) / 510;
		if ( $max === $min || $lightness < 0.12 || $lightness > 0.92 ) {
			return false;
		}
		$saturation = ( $max - $min ) / 255 / ( 1 - abs( 2 * $lightness - 1 ) );
		return $saturation > 0.25;
	}

	/**
	 * Whether a colour is near white (a button with it is not the accent).
	 *
	 * @param string $color #rrggbb.
	 */
	public static function light( string $color ): bool {
		[ $r, $g, $b ] = self::rgb( $color );
		return min( $r, $g, $b ) > 225;
	}

	/**
	 * Whether a colour is hard to tell from one of a list.
	 *
	 * @param string        $color  #rrggbb.
	 * @param array<string> $others Colours.
	 */
	public static function near_any( string $color, array $others ): bool {
		[ $r, $g, $b ] = self::rgb( $color );
		foreach ( $others as $other ) {
			[ $x, $y, $z ] = self::rgb( $other );
			if ( sqrt( ( $r - $x ) ** 2 + ( $g - $y ) ** 2 + ( $b - $z ) ** 2 ) < 16 ) {
				return true;
			}
		}
		return false;
	}
}
