<?php
/**
 * Re-implementation of the 3.x browser path finder (af2FindNew in res/frontend/scripts/frontend.js).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Domain\Form\JsNumber;

defined( 'ABSPATH' ) || exit;

/**
 * Kept deliberately close to the JavaScript so that the verifier compares the migrated edges
 * with what visitors actually experienced, independent of how FormConverter builds the edges.
 */
final class LegacyNavigator {

	/**
	 * The target of a question's connections for the value the browser passed as `from`.
	 *
	 * @param array<int,mixed> $connections Raw stored connections of the node.
	 * @param mixed            $from        int (answer index), string, list of strings or array (object).
	 * @return array{0:int,1:int}|null [section, content], or null when the funnel would hang.
	 */
	public static function find_new( array $connections, $from ): ?array {
		$target = null;
		$found  = false;
		foreach ( $connections as $el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}
			// The server sent from, to_section and to_content through intval().
			$el_from  = self::intval( $el['from'] ?? null );
			$operator = $el['operator'] ?? null;
			$to       = array( self::intval( $el['to_section'] ?? null ), self::intval( $el['to_content'] ?? null ) );

			if ( self::loosely_empty( $operator ) ) {
				if ( -1 === $el_from ) {
					if ( ! $found ) {
						$target = $to;
					}
				} elseif ( ( is_int( $from ) && $el_from === $from ) || JsNumber::to_string( $from ) === (string) $el_from ) {
					$target = $to;
					$found  = true;
				}
				continue;
			}

			$a = JsNumber::parse_int( JsNumber::to_string( $from ) );
			$b = JsNumber::parse_int( JsNumber::to_string( $el['number'] ?? null ) );
			switch ( $operator ) {
				case '<':
					$hit = null !== $a && null !== $b && $a < $b;
					break;
				case '<=':
					$hit = null !== $a && null !== $b && $a <= $b;
					break;
				case '>':
					$hit = null !== $a && null !== $b && $a > $b;
					break;
				case '>=':
					$hit = null !== $a && null !== $b && $a >= $b;
					break;
				case '=':
					$hit = null !== $a && null !== $b && $a === $b;
					break;
				case '!=':
					$hit = null === $a || null === $b || $a !== $b;
					break;
				default:
					$hit = false;
			}
			if ( $hit ) {
				$target = $to;
			}
		}
		return $target;
	}

	/**
	 * PHP intval() as applied by the 3.x server.
	 *
	 * @param mixed $value Value.
	 */
	private static function intval( $value ): int {
		if ( is_array( $value ) ) {
			return array() === $value ? 0 : 1;
		}
		return is_scalar( $value ) ? intval( $value ) : 0;
	}

	/**
	 * JavaScript `value == null || value == ''`.
	 *
	 * @param mixed $value Value.
	 */
	private static function loosely_empty( $value ): bool {
		return null === $value || false === $value || '' === $value || 0 === $value || 0.0 === $value || array() === $value;
	}
}
