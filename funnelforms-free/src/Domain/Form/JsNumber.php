<?php
/**
 * Number parsing with the semantics of JavaScript's parseInt() and parseFloat().
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

/**
 * Forms branch on numbers typed or chosen by visitors, and the browser and the server must agree
 * on how a text becomes a number. Null stands for NaN.
 */
final class JsNumber {

	/**
	 * Like parseInt(text): leading whitespace, optional sign, then digits ("0x" for hex); the rest is ignored.
	 *
	 * @param string $text Text.
	 */
	public static function parse_int( string $text ): ?float {
		$text = ltrim( $text, " \t\n\r\x0B\f\u{00A0}\u{FEFF}" );
		if ( 1 === preg_match( '/^([+-]?)0[xX]([0-9a-fA-F]+)/', $text, $m ) ) {
			$value = (float) hexdec( $m[2] );
			return '-' === $m[1] ? -$value : $value;
		}
		if ( 1 === preg_match( '/^[+-]?\d+/', $text, $m ) ) {
			return (float) $m[0];
		}
		return null;
	}

	/**
	 * Like parseFloat(text).
	 *
	 * @param string $text Text.
	 */
	public static function parse_float( string $text ): ?float {
		$text = ltrim( $text, " \t\n\r\x0B\f\u{00A0}\u{FEFF}" );
		if ( 1 === preg_match( '/^([+-]?)Infinity/', $text, $m ) ) {
			return '-' === $m[1] ? -INF : INF;
		}
		if ( 1 === preg_match( '/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/', $text, $m ) ) {
			return (float) $m[0];
		}
		return null;
	}

	/**
	 * JavaScript String(value) for the values a form answer can hold.
	 *
	 * @param mixed $value Answer.
	 */
	public static function to_string( $value ): string {
		if ( is_array( $value ) ) {
			if ( array_is_list( $value ) ) {
				return implode( ',', array_map( array( self::class, 'to_string' ), $value ) );
			}
			return '[object Object]';
		}
		if ( is_bool( $value ) ) {
			return $value ? 'true' : 'false';
		}
		if ( is_float( $value ) ) {
			if ( is_nan( $value ) ) {
				return 'NaN';
			}
			if ( floor( $value ) === $value && abs( $value ) < 1e21 ) {
				return number_format( $value, 0, '.', '' );
			}
			return (string) $value;
		}
		return null === $value ? '' : (string) $value;
	}
}
