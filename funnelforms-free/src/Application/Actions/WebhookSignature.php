<?php
/**
 * Signature of outgoing webhooks.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Actions;

defined( 'ABSPATH' ) || exit;

/**
 * Every webhook carries three headers, so receivers can check that it comes from this site, is
 * fresh and is handled once:
 *
 *   X-Funnelforms-Timestamp  Unix time of the sending
 *   X-Funnelforms-Signature  v1=<hex HMAC-SHA256 of "<timestamp>.<body>" with the site's webhook secret>
 *   X-Funnelforms-Delivery   ID of the delivery; the same for retries of one delivery
 *
 * The body stays the 3.x payload, so receivers that do not check keep working. The secret is
 * created on first use (option funnelforms_webhook_secret) and shown to admins.
 */
final class WebhookSignature {

	public const OPTION = 'funnelforms_webhook_secret';

	/**
	 * The site's webhook secret.
	 */
	public static function secret(): string {
		$secret = (string) get_option( self::OPTION, '' );
		if ( '' === $secret ) {
			$secret = 'whsec_' . wp_generate_password( 40, false );
			add_option( self::OPTION, $secret, '', false );
			$secret = (string) get_option( self::OPTION, $secret );
		}
		return $secret;
	}

	/**
	 * Replaces the secret; receivers need the new one.
	 */
	public static function rotate(): string {
		update_option( self::OPTION, 'whsec_' . wp_generate_password( 40, false ), false );
		return self::secret();
	}

	/**
	 * Headers for a body.
	 *
	 * @param string $body     JSON body.
	 * @param int    $delivery Delivery (job) ID.
	 * @param int    $now      Current time.
	 * @return array<string,string>
	 */
	public static function headers( string $body, int $delivery, int $now ): array {
		return array(
			'X-Funnelforms-Timestamp' => (string) $now,
			'X-Funnelforms-Signature' => 'v1=' . hash_hmac( 'sha256', $now . '.' . $body, self::secret() ),
			'X-Funnelforms-Delivery'  => (string) $delivery,
		);
	}
}
