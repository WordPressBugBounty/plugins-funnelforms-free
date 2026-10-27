<?php
/**
 * Encryption for stored credentials.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Crypto;

defined( 'ABSPATH' ) || exit;

/**
 * Encrypts secrets (API keys, SMTP passwords, calendar tokens) with libsodium.
 *
 * Key: the constant FFX_SECRET_KEY from wp-config.php when defined, otherwise a key derived from
 * the WordPress salts. Changing the salts without FFX_SECRET_KEY makes stored secrets unreadable;
 * the admin then asks to reconnect the affected integrations.
 */
final class SecretBox {

	private const PREFIX = 'ffx1:';

	/**
	 * Raw 32-byte key.
	 *
	 * @var string
	 */
	private string $key;

	/**
	 * Constructor.
	 *
	 * @param string $key_material Any string with enough entropy; it is hashed to 32 bytes.
	 */
	public function __construct( string $key_material ) {
		$this->key = sodium_crypto_generichash( $key_material, '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES );
	}

	/**
	 * Instance with the site key.
	 */
	public static function for_site(): self {
		if ( defined( 'FFX_SECRET_KEY' ) && is_string( FFX_SECRET_KEY ) && strlen( FFX_SECRET_KEY ) >= 32 ) {
			return new self( FFX_SECRET_KEY );
		}
		return new self( 'funnelforms-secretbox|' . wp_salt( 'auth' ) . '|' . wp_salt( 'secure_auth' ) );
	}

	/**
	 * Encrypts a string.
	 *
	 * @param string $plaintext Secret.
	 */
	public function encrypt( string $plaintext ): string {
		$nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
		$box   = sodium_crypto_secretbox( $plaintext, $nonce, $this->key );
		return self::PREFIX . sodium_bin2base64( $nonce . $box, SODIUM_BASE64_VARIANT_ORIGINAL );
	}

	/**
	 * Decrypts a string produced by encrypt().
	 *
	 * @param string $ciphertext Encrypted value.
	 * @return string|null Null when the value is damaged or the key changed.
	 */
	public function decrypt( string $ciphertext ): ?string {
		if ( ! str_starts_with( $ciphertext, self::PREFIX ) ) {
			return null;
		}
		try {
			$raw = sodium_base642bin( substr( $ciphertext, strlen( self::PREFIX ) ), SODIUM_BASE64_VARIANT_ORIGINAL );
		} catch ( \SodiumException $e ) {
			return null;
		}
		if ( strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
			return null;
		}
		$nonce = substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
		$plain = sodium_crypto_secretbox_open( substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ), $nonce, $this->key );
		return false === $plain ? null : $plain;
	}
}
