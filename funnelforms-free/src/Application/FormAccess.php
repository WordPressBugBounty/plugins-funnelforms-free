<?php
/**
 * Password, entry limit and time window of a form, checked on the server.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Infrastructure\Repository\EntryRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Document setting settings.access (all optional):
 *   password       {hash} from wp_hash_password(); the form's content is sent only after it
 *   maxEntries     the form closes after this many complete entries
 *   opensAt        ISO 8601 time from which the form takes entries
 *   closesAt       ISO 8601 time after which it no longer does
 *   closedMessage  text shown instead of the form while it is closed
 *   loginRequired  only visitors logged in to the website see and send the form
 *   loginMessage   text shown with the login link to everyone else
 * FF4 checked these in the browser only. Here the plugin checks them on every request, and a
 * visitor who entered the password gets an unlock key (signed, 12 hours) for the requests. On a
 * form for members the page gives logged-in visitors a key of their own (member_key()); it names
 * the user, and a password entered with it gives a key that names the user too.
 */
final class FormAccess {

	public const OPEN        = 'open';
	public const NOT_YET     = 'not_yet_open';
	public const ENDED       = 'ended';
	public const FULL        = 'full';
	private const UNLOCK_TTL = 12 * HOUR_IN_SECONDS;

	/**
	 * Settings of a document.
	 *
	 * @param array<string,mixed> $document Document.
	 * @return array<string,mixed>
	 */
	private static function settings( array $document ): array {
		$access = $document['settings']['access'] ?? array();
		return is_array( $access ) ? $access : array();
	}

	/**
	 * Whether the form takes entries now.
	 *
	 * @param int                 $form_id  Form ID.
	 * @param array<string,mixed> $document Document.
	 * @param int                 $now      Current time.
	 */
	public static function state( int $form_id, array $document, int $now ): string {
		$access = self::settings( $document );
		$opens  = isset( $access['opensAt'] ) ? strtotime( (string) $access['opensAt'] ) : false;
		$closes = isset( $access['closesAt'] ) ? strtotime( (string) $access['closesAt'] ) : false;
		if ( false !== $opens && $now < $opens ) {
			return self::NOT_YET;
		}
		if ( false !== $closes && $now >= $closes ) {
			return self::ENDED;
		}
		$max = $access['maxEntries'] ?? null;
		if ( is_int( $max ) && $max > 0 && ( new EntryRepository() )->count_complete( $form_id ) >= $max ) {
			return self::FULL;
		}
		return self::OPEN;
	}

	/**
	 * Text shown while the form is closed.
	 *
	 * @param array<string,mixed> $document Document.
	 * @param string              $locale   Locale.
	 */
	public static function closed_message( array $document, string $locale ): string {
		$text = self::settings( $document )['closedMessage'] ?? null;
		if ( is_array( $text ) ) {
			$default = (string) ( $document['locales']['default'] ?? '' );
			$value   = $text[ $locale ] ?? $text[ $default ] ?? reset( $text );
			if ( is_string( $value ) && '' !== trim( wp_strip_all_tags( $value ) ) ) {
				return $value;
			}
		}
		return esc_html__( 'This form is not taking any more entries.', 'funnelforms-free' );
	}

	/**
	 * Hash of the form password, or '' for forms without one.
	 *
	 * @param array<string,mixed> $document Document.
	 */
	private static function password_hash( array $document ): string {
		$hash = self::settings( $document )['password']['hash'] ?? '';
		return is_string( $hash ) ? $hash : '';
	}

	/**
	 * Whether the form needs a password.
	 *
	 * @param array<string,mixed> $document Document.
	 */
	public static function has_password( array $document ): bool {
		return '' !== self::password_hash( $document );
	}

	/**
	 * Whether only visitors logged in to the website may use the form.
	 *
	 * @param array<string,mixed> $document Document.
	 */
	public static function login_required( array $document ): bool {
		return true === ( self::settings( $document )['loginRequired'] ?? null );
	}

	/**
	 * Text for visitors who are not logged in to a form for members.
	 *
	 * @param array<string,mixed> $document Document.
	 * @param string              $locale   Locale.
	 */
	public static function login_message( array $document, string $locale ): string {
		$text = self::settings( $document )['loginMessage'] ?? null;
		if ( is_array( $text ) ) {
			$default = (string) ( $document['locales']['default'] ?? '' );
			$value   = $text[ $locale ] ?? $text[ $default ] ?? reset( $text );
			if ( is_string( $value ) && '' !== trim( wp_strip_all_tags( $value ) ) ) {
				return $value;
			}
		}
		return esc_html__( 'Please log in to use this form.', 'funnelforms-free' );
	}

	/**
	 * Key of a logged-in visitor for a form for members (signed, 12 hours). It does not open a
	 * password; with it, the password gives a key that also names the user.
	 *
	 * @param string $uid     Form uid.
	 * @param int    $user_id User ID.
	 * @param int    $now     Current time.
	 */
	public static function member_key( string $uid, int $user_id, int $now ): string {
		$expires = $now + self::UNLOCK_TTL;
		return $expires . '.' . $user_id . '.' . self::sign( $uid, '', $expires, $user_id );
	}

	/**
	 * The user of a valid member key, 0 for none.
	 *
	 * @param string $uid Form uid.
	 * @param string $key Key of the request.
	 * @param int    $now Current time.
	 */
	public static function member( string $uid, string $key, int $now ): int {
		$parts = self::parts( $key, $now );
		return null !== $parts && $parts['user'] > 0 && false !== get_userdata( $parts['user'] ) && hash_equals( self::sign( $uid, '', $parts['expires'], $parts['user'] ), $parts['signature'] ) ? $parts['user'] : 0;
	}

	/**
	 * Unlock key for a correct password, null otherwise.
	 *
	 * @param string              $uid      Form uid.
	 * @param array<string,mixed> $document Document.
	 * @param string              $password Entered password.
	 * @param int                 $now      Current time.
	 * @param int                 $user_id  User of a form for members (from member()); 0 otherwise.
	 */
	public static function unlock( string $uid, array $document, string $password, int $now, int $user_id = 0 ): ?string {
		$hash = self::password_hash( $document );
		// WordPress hashes the trimmed password (bcrypt hashes since 6.8), so spaces around it never count.
		$password = trim( $password );
		if ( '' === $hash || '' === $password || ! wp_check_password( $password, $hash ) ) {
			return null;
		}
		$expires = $now + self::UNLOCK_TTL;
		return $user_id > 0 ? $expires . '.' . $user_id . '.' . self::sign( $uid, $hash, $expires, $user_id ) : $expires . '.' . self::sign( $uid, $hash, $expires );
	}

	/**
	 * Whether a request may use the form: always for open forms; with a password, a valid unlock
	 * key; for members, a key that names an existing user. Changing the password invalidates
	 * earlier keys.
	 *
	 * @param string              $uid      Form uid.
	 * @param array<string,mixed> $document Document.
	 * @param string              $key      Unlock key of the request.
	 * @param int                 $now      Current time.
	 */
	public static function unlocked( string $uid, array $document, string $key, int $now ): bool {
		$hash  = self::password_hash( $document );
		$login = self::login_required( $document );
		if ( '' === $hash && ! $login ) {
			return true;
		}
		$parts = self::parts( $key, $now );
		if ( null === $parts || ( $login && ( $parts['user'] <= 0 || false === get_userdata( $parts['user'] ) ) ) ) {
			return false;
		}
		return hash_equals( self::sign( $uid, $hash, $parts['expires'], $parts['user'] ), $parts['signature'] );
	}

	/**
	 * Expiry, user (0 for none) and signature of a key that has not expired.
	 *
	 * @param string $key Key.
	 * @param int    $now Current time.
	 * @return array{expires:int,user:int,signature:string}|null
	 */
	private static function parts( string $key, int $now ): ?array {
		$parts = explode( '.', $key );
		if ( 3 === count( $parts ) && ctype_digit( $parts[1] ) ) {
			[ $expires, $user, $signature ] = $parts;
		} elseif ( 2 === count( $parts ) ) {
			[ $expires, $signature ] = $parts;
			$user                    = '0';
		} else {
			return null;
		}
		if ( ! ctype_digit( $expires ) || (int) $expires < $now ) {
			return null;
		}
		return array(
			'expires'   => (int) $expires,
			'user'      => (int) $user,
			'signature' => $signature,
		);
	}

	/**
	 * Signature of a key.
	 *
	 * @param string $uid     Form uid.
	 * @param string $hash    Password hash ('' for member keys).
	 * @param int    $expires Expiry.
	 * @param int    $user_id User the key is for (0: anyone with the password).
	 */
	private static function sign( string $uid, string $hash, int $expires, int $user_id = 0 ): string {
		return hash_hmac( 'sha256', $uid . '|' . $expires . '|' . ( $user_id > 0 ? 'u' . $user_id . '|' : '' ) . $hash, wp_salt( 'auth' ) );
	}
}
