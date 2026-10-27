<?php
/**
 * Reads 3.x values the way the 3.x frontend interpreted them.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

defined( 'ABSPATH' ) || exit;

/**
 * 3.x stored booleans as true, false, "true", "false", "1", "", "on" or not at all, and each
 * frontend check treated them differently. The migration reproduces the effective behaviour of
 * 3.8.10 per key (docs/migration/legacy-3x/field-inventory.md, section F.2), not the builder default.
 */
final class LegacyValue {

	/**
	 * Strict check (=== true): only a real boolean true is on.
	 *
	 * @param mixed $value Stored value.
	 */
	public static function strict_true( $value ): bool {
		return true === $value;
	}

	/**
	 * Loose string check (== 'true'): true and "true" are on.
	 *
	 * @param mixed $value Stored value.
	 */
	public static function equals_true( $value ): bool {
		return true === $value || 'true' === $value || ( is_string( $value ) && 'true' === strtolower( trim( $value ) ) );
	}

	/**
	 * Truthy check as in JavaScript: everything except false, "", 0, null and missing is on
	 * (so the string "false" is on, like in 3.x).
	 *
	 * @param mixed $value Stored value.
	 */
	public static function truthy( $value ): bool {
		return ! ( null === $value || false === $value || '' === $value || 0 === $value || '0' === $value );
	}

	/**
	 * "On unless explicitly false": missing counts as on; false and "false" turn it off.
	 *
	 * @param mixed $value Stored value (null when missing).
	 */
	public static function on_unless_false( $value ): bool {
		return ! ( false === $value || 'false' === $value );
	}

	/**
	 * Optional number.
	 *
	 * @param mixed $value Stored value.
	 */
	public static function number( $value ): ?float {
		if ( is_int( $value ) || is_float( $value ) ) {
			return (float) $value;
		}
		if ( is_string( $value ) && is_numeric( trim( $value ) ) ) {
			return (float) trim( $value );
		}
		return null;
	}

	/**
	 * Optional non-negative integer.
	 *
	 * @param mixed $value Stored value.
	 */
	public static function int( $value ): ?int {
		$number = self::number( $value );
		return null === $number ? null : max( 0, (int) $number );
	}

	/**
	 * String or empty string.
	 *
	 * @param mixed $value Stored value.
	 */
	public static function str( $value ): string {
		return is_scalar( $value ) ? (string) $value : '';
	}
}
