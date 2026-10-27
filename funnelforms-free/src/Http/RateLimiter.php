<?php
/**
 * Fixed-window rate limit per visitor and form.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

defined( 'ABSPATH' ) || exit;

/**
 * Visitors are identified by a salted hash of the IP address only; the IP itself is not stored.
 * A window starts with the first hit and ends a fixed time later, however many hits follow, so a
 * visitor who reached the limit can go on once it is over. Proxy headers are ignored because
 * visitors can set them freely, unless the site names its reverse proxies or CDN with the filter
 * `funnelforms_trusted_proxies`: then the address the nearest trusted proxy saw counts
 * (X-Forwarded-For, read from the right). The filter `funnelforms_rate_limit` changes a limit.
 */
final class RateLimiter {

	/**
	 * Counts a hit and tells whether the limit is exceeded.
	 *
	 * @param string $bucket Name of the limit, e.g. "submit".
	 * @param string $scope  Form uid.
	 * @param int    $limit  Hits allowed per window.
	 * @param int    $window Window in seconds.
	 */
	public static function exceeded( string $bucket, string $scope, int $limit, int $window ): bool {
		/**
		 * Filters the hits one visitor (IP address) may make per window, e.g. for calculators
		 * whose visitors share an address.
		 *
		 * @param int    $limit  Hits per window.
		 * @param string $bucket Name of the limit: live, calc, submit, token …
		 * @param string $scope  Form uid, or "site".
		 */
		$limit = (int) apply_filters( 'funnelforms_rate_limit', $limit, $bucket, $scope );
		$key   = 'ffx_rl_' . substr( hash_hmac( 'sha256', $bucket . '|' . $scope . '|' . self::client_ip(), wp_salt( 'nonce' ) ), 0, 32 );
		$now   = time();
		$hits  = get_transient( $key );
		if ( ! is_array( $hits ) || (int) ( $hits['until'] ?? 0 ) <= $now ) {
			$hits = array(
				'n'     => 0,
				'until' => $now + $window,
			);
		}
		if ( (int) $hits['n'] >= $limit ) {
			return true;
		}
		$hits['n'] = (int) $hits['n'] + 1;
		// The expiry stays that of the window's start.
		set_transient( $key, $hits, max( 1, (int) $hits['until'] - $now ) );
		return false;
	}

	/**
	 * The visitor's IP address: that of the connection, or behind proxies the site trusts the one
	 * the nearest of them saw.
	 */
	public static function client_ip(): string {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		/**
		 * Filters the reverse proxies and CDN servers whose X-Forwarded-For header is trusted: IP
		 * addresses or ranges (CIDR, e.g. 10.0.0.0/8). Empty by default, as anybody can send the header.
		 *
		 * @param string[] $proxies Addresses and ranges.
		 */
		$proxies = array_filter( array_map( 'strval', (array) apply_filters( 'funnelforms_trusted_proxies', array() ) ) );
		if ( array() === $proxies || ! self::in( $ip, $proxies ) || ! isset( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
			return $ip;
		}
		$chain = array_map( 'trim', explode( ',', sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) ) );
		foreach ( array_reverse( $chain ) as $hop ) {
			if ( false === filter_var( $hop, FILTER_VALIDATE_IP ) ) {
				break;
			}
			if ( ! self::in( $hop, $proxies ) ) {
				return $hop;
			}
		}
		return $ip;
	}

	/**
	 * Whether an address is one of the addresses or ranges.
	 *
	 * @param string   $ip     IP address.
	 * @param string[] $ranges Addresses and CIDR ranges.
	 */
	private static function in( string $ip, array $ranges ): bool {
		$address = @inet_pton( $ip ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- false for anything that is no address.
		if ( false === $address ) {
			return false;
		}
		foreach ( $ranges as $range ) {
			[ $base, $bits ] = array_pad( explode( '/', trim( $range ), 2 ), 2, null );
			$net             = @inet_pton( (string) $base ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- as above.
			if ( false === $net || strlen( $net ) !== strlen( $address ) ) {
				continue;
			}
			$bits = null === $bits ? strlen( $net ) * 8 : max( 0, min( strlen( $net ) * 8, (int) $bits ) );
			$full = intdiv( $bits, 8 );
			$rest = $bits % 8;
			if ( substr( $address, 0, $full ) !== substr( $net, 0, $full ) ) {
				continue;
			}
			if ( 0 === $rest || ( ( ord( $address[ $full ] ) ^ ord( $net[ $full ] ) ) & ( 0xff << ( 8 - $rest ) ) & 0xff ) === 0 ) {
				return true;
			}
		}
		return false;
	}
}
