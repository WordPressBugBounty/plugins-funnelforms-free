<?php
/**
 * Styles saved in the builder, to give other forms the same look.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

defined( 'ABSPATH' ) || exit;

/**
 * A saved style is a name and the style tokens of a form (colours, font, sizes; never its CSS,
 * which needs more rights than editing forms). They belong to the site, so everyone who edits
 * forms sees the same list. Stored in one option that is not autoloaded.
 */
final class StyleLibrary {

	public const OPTION = 'funnelforms_styles';

	/**
	 * Most saved styles per site.
	 */
	public const MAX = 50;

	/**
	 * The saved styles, newest first.
	 *
	 * @return array<int,array{id:string,name:string,tokens:array<string,string>,createdAt:string}>
	 */
	public static function all(): array {
		$styles = get_option( self::OPTION, array() );
		return is_array( $styles ) ? array_values( array_filter( $styles, 'is_array' ) ) : array();
	}

	/**
	 * Saves a style.
	 *
	 * @param string $name   Name.
	 * @param mixed  $tokens Style tokens (token => value).
	 * @return array{id:string,name:string,tokens:array<string,string>,createdAt:string}|null Null when the library is full.
	 */
	public static function add( string $name, $tokens ): ?array {
		$styles = self::all();
		if ( count( $styles ) >= self::MAX ) {
			return null;
		}
		$style = array(
			'id'        => 'st_' . bin2hex( random_bytes( 6 ) ),
			'name'      => sanitize_text_field( $name ),
			'tokens'    => self::tokens( $tokens ),
			'createdAt' => gmdate( 'c' ),
		);
		array_unshift( $styles, $style );
		update_option( self::OPTION, $styles, false );
		return $style;
	}

	/**
	 * Deletes a style.
	 *
	 * @param string $id Style id.
	 * @return bool Whether it existed.
	 */
	public static function delete( string $id ): bool {
		$styles = self::all();
		$kept   = array_values( array_filter( $styles, static fn( array $style ): bool => ( $style['id'] ?? '' ) !== $id ) );
		if ( count( $kept ) === count( $styles ) ) {
			return false;
		}
		update_option( self::OPTION, $kept, false );
		return true;
	}

	/**
	 * Tokens as the renderer reads them: short names, short string values. The renderer checks
	 * the values again when it prints them.
	 *
	 * @param mixed $tokens Tokens.
	 * @return array<string,string>
	 */
	private static function tokens( $tokens ): array {
		$out = array();
		foreach ( is_array( $tokens ) || is_object( $tokens ) ? (array) $tokens : array() as $key => $value ) {
			if ( is_string( $key ) && 1 === preg_match( '/^[a-z][a-zA-Z.]{0,40}$/', $key ) && is_scalar( $value ) && strlen( (string) $value ) <= 100 ) {
				$out[ $key ] = (string) $value;
			}
		}
		return $out;
	}
}
