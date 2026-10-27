<?php
/**
 * Time limit of a form: minutes from the start in which the visitor must send it.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

defined( 'ABSPATH' ) || exit;

/**
 * The first token request of a visit starts the clock. Its answer carries a signed stamp of the
 * start, which the runtime sends with later token requests (a token is used once) and with the
 * entry, so a new token does not restart the time. A new page view starts a new visit.
 */
final class TimeLimit {

	/** Seconds allowed on top of the limit for the request on its way. */
	public const GRACE = 30;

	/**
	 * Seconds of the form's time limit, 0 without one.
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public static function seconds( array $document ): int {
		$minutes = (int) ( $document['settings']['timeLimit']['minutes'] ?? 0 );
		return $minutes > 0 ? min( $minutes, 1440 ) * MINUTE_IN_SECONDS : 0;
	}

	/**
	 * Signed stamp of the start of a visit. A visit gets more time once; the stamp says whether it
	 * had it ("<start>.x.<signature>").
	 *
	 * @param string $form_uid Form uid.
	 * @param int    $started  Start time.
	 * @param bool   $extended Whether the visitor already had more time.
	 */
	public static function stamp( string $form_uid, int $started, bool $extended = false ): string {
		return $started . ( $extended ? '.x' : '' ) . '.' . self::sign( $form_uid, $started, $extended );
	}

	/**
	 * Whether a valid stamp of this form says the visitor already had more time.
	 *
	 * @param string $stamp    Stamp from the runtime.
	 * @param string $form_uid Form uid.
	 */
	public static function extended( string $stamp, string $form_uid ): bool {
		return 3 === count( explode( '.', $stamp ) ) && null !== self::started( $stamp, $form_uid );
	}

	/**
	 * Start time from a stamp, or null when the stamp is missing or not this form's.
	 *
	 * @param string $stamp    Stamp from the runtime.
	 * @param string $form_uid Form uid.
	 */
	public static function started( string $stamp, string $form_uid ): ?int {
		$parts    = explode( '.', $stamp );
		$extended = 3 === count( $parts ) && 'x' === $parts[1];
		if ( ( 2 !== count( $parts ) && ! $extended ) || ! ctype_digit( $parts[0] ) || ! hash_equals( self::sign( $form_uid, (int) $parts[0], $extended ), (string) end( $parts ) ) ) {
			return null;
		}
		return (int) $parts[0];
	}

	/**
	 * Signature of a stamp.
	 *
	 * @param string $form_uid Form uid.
	 * @param int    $started  Start time.
	 * @param bool   $extended Whether the visitor already had more time.
	 */
	private static function sign( string $form_uid, int $started, bool $extended = false ): string {
		return hash_hmac( 'sha256', 'started|' . $form_uid . '|' . $started . ( $extended ? '|x' : '' ), 'funnelforms-time|' . wp_salt( 'nonce' ) );
	}
}
