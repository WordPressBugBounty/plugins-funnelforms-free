<?php
/**
 * Short-lived, signed tokens that allow one form submit.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

defined( 'ABSPATH' ) || exit;

/**
 * Pages with forms are often cached, so the HTML carries no nonce. The runtime asks for a token
 * when the visitor starts; the token is bound to the form, used once, and only accepted after a
 * few seconds (bots submit at once) and before it expires.
 */
final class SubmitToken {

	public const MIN_AGE = 3;
	public const MAX_AGE = 6 * HOUR_IN_SECONDS;

	/**
	 * Issues a token.
	 *
	 * @param string $form_uid Form uid.
	 * @param int    $now      Current time.
	 */
	public static function issue( string $form_uid, int $now ): string {
		$nonce = bin2hex( random_bytes( 12 ) );
		return 'v1.' . $now . '.' . $nonce . '.' . self::sign( $form_uid, $now, $nonce );
	}

	/**
	 * Checks a token and marks it as used.
	 *
	 * @param string $token    Token.
	 * @param string $form_uid Form uid.
	 * @param int    $now      Current time.
	 * @return ?string Error code, null when valid.
	 */
	public static function redeem( string $token, string $form_uid, int $now ): ?string {
		$error = self::check( $token, $form_uid, $now );
		if ( null !== $error ) {
			return $error;
		}
		$issued = (int) explode( '.', $token )[1];
		if ( $now - $issued < self::MIN_AGE ) {
			return 'too_fast';
		}
		set_transient( 'ffx_tok_' . explode( '.', $token )[2], 1, self::MAX_AGE );
		return null;
	}

	/**
	 * When a token was issued (the visitor's first interaction with the form); 0 for anything else.
	 * Only meaningful for a token check() accepted.
	 *
	 * @param string $token Token.
	 */
	public static function issued( string $token ): int {
		$parts = explode( '.', $token );
		return 4 === count( $parts ) && ctype_digit( $parts[1] ) ? (int) $parts[1] : 0;
	}

	/**
	 * Checks a token without using it up (uploads before the submit); the minimum age does not apply.
	 *
	 * @param string $token    Token.
	 * @param string $form_uid Form uid.
	 * @param int    $now      Current time.
	 * @return ?string Error code, null when valid.
	 */
	public static function check( string $token, string $form_uid, int $now ): ?string {
		$parts = explode( '.', $token );
		if ( 4 !== count( $parts ) || 'v1' !== $parts[0] || ! ctype_digit( $parts[1] ) || 1 !== preg_match( '/^[a-f0-9]{24}$/', $parts[2] ) ) {
			return 'token_invalid';
		}
		$issued = (int) $parts[1];
		if ( ! hash_equals( self::sign( $form_uid, $issued, $parts[2] ), $parts[3] ) ) {
			return 'token_invalid';
		}
		if ( $now - $issued > self::MAX_AGE ) {
			return 'token_expired';
		}
		if ( false !== get_transient( 'ffx_tok_' . $parts[2] ) ) {
			return 'token_used';
		}
		return null;
	}

	/**
	 * Signature of a token.
	 *
	 * @param string $form_uid Form uid.
	 * @param int    $issued   Issue time.
	 * @param string $nonce    Random part.
	 */
	private static function sign( string $form_uid, int $issued, string $nonce ): string {
		return hash_hmac( 'sha256', 'v1|' . $form_uid . '|' . $issued . '|' . $nonce, 'funnelforms-submit|' . wp_salt( 'nonce' ) );
	}
}
