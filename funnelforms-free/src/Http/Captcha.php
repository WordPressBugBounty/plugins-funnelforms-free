<?php
/**
 * Captchas of contact steps: Google reCAPTCHA (v2 checkbox) of 3.x forms, and Cloudflare Turnstile,
 * hCaptcha or Google reCAPTCHA (v2 checkbox or invisible v3) as spam protection for all forms of the site.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\ConnectionRepository;

defined( 'ABSPATH' ) || exit;

/**
 * 3.x only disabled the submit button until the box was ticked and never asked Google whether the
 * answer was valid. The new renderer checks every answer with the provider before it stores the
 * entry.
 *
 * The site-wide protection is the connection site:captcha (Funnelforms → Settings). While it
 * is set, every contact step without a captcha of its own gets one (with_site_captcha()), so the
 * runtime, the answer checks and the verification treat it like a captcha field of the form. A
 * form can do without it (settings.captcha false); captcha fields placed in the builder have no
 * connection of their own and use the site's.
 *
 * reCAPTCHA v3 shows nothing: its answer carries a score from 0 (bot) to 1 (human). A score
 * below the threshold of the site does not reject the entry but puts it into the spam folder
 * (check() answers 'low'), because the score can be wrong about people.
 */
final class Captcha {

	public const SITE_REF   = 'site:captcha';
	public const SITE_FIELD = 'ffx_site_captcha';

	/** Verification endpoint per connection type; all take secret, response and remoteip. */
	public const PROVIDERS = array(
		'recaptcha'  => 'https://www.google.com/recaptcha/api/siteverify',
		'turnstile'  => 'https://challenges.cloudflare.com/turnstile/v0/siteverify', // phpcs:ignore PluginCheck.CodeAnalysis.Offloading.OffloadedContent -- Server-side verification endpoint, nothing is loaded in the browser.
		'hcaptcha'   => 'https://api.hcaptcha.com/siteverify',
		'recaptcha3' => 'https://www.google.com/recaptcha/api/siteverify',
	);

	/** Providers of the site-wide protection, in the order the settings show them. */
	public const SITE_PROVIDERS = array( 'turnstile', 'hcaptcha', 'recaptcha', 'recaptcha3' );

	/** Score below which reCAPTCHA v3 answers go to the spam folder, unless the site sets another. */
	public const THRESHOLD = 0.5;

	/** Names of the providers (brands, not translated). */
	public const NAMES = array(
		'turnstile'  => 'Cloudflare Turnstile',
		'hcaptcha'   => 'hCaptcha',
		'recaptcha'  => 'Google reCAPTCHA v2',
		'recaptcha3' => 'Google reCAPTCHA v3',
	);

	/**
	 * Site key of a captcha field (public), or null when its connection is missing or incomplete.
	 *
	 * @param array<string,mixed> $field Contact field of type captcha.
	 */
	public static function site_key( array $field ): ?string {
		$connection = self::connection( $field );
		return self::usable( $connection ) ? (string) $connection['config']['siteKey'] : null;
	}

	/**
	 * Provider of a captcha field (connection type), for the runtime.
	 *
	 * @param array<string,mixed> $field Contact field of type captcha.
	 */
	public static function provider( array $field ): string {
		$type = (string) ( self::connection( $field )['type'] ?? '' );
		return isset( self::PROVIDERS[ $type ] ) ? $type : 'recaptcha';
	}

	/**
	 * Whether a connection has a known provider, a site key and a secret.
	 *
	 * @param array<string,mixed> $connection Connection.
	 */
	private static function usable( array $connection ): bool {
		return isset( self::PROVIDERS[ (string) ( $connection['type'] ?? '' ) ] )
			&& '' !== (string) ( $connection['config']['siteKey'] ?? '' )
			&& '' !== (string) ( $connection['secret']['secret'] ?? '' );
	}

	/**
	 * The document with the site-wide captcha in every contact step that has no captcha. A form
	 * set to do without (settings.captcha false) gets none, and loses the captcha fields that would
	 * use the site's; so do forms while the site has none, so visitors can still send them.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return array<string,mixed>
	 */
	public static function with_site_captcha( array $document ): array {
		$site = self::usable( self::site() ) && false !== ( $document['settings']['captcha'] ?? true );
		foreach ( $document['nodes'] as $n => $node ) {
			if ( 'contact' !== $node['type'] ) {
				continue;
			}
			$fields = array_values(
				array_filter(
					$node['fields'],
					static fn( array $field ): bool => 'captcha' !== $field['type'] || $site || '' !== (string) ( $field['props']['connectionRef'] ?? '' )
				)
			);
			if ( $site && ! in_array( 'captcha', array_column( $fields, 'type' ), true ) ) {
				$fields[] = array(
					'id'       => self::SITE_FIELD,
					'type'     => 'captcha',
					'key'      => 'captcha',
					'label'    => array(),
					'required' => true,
					'props'    => array( 'connectionRef' => self::SITE_REF ),
				);
			}
			$document['nodes'][ $n ]['fields'] = $fields;
		}
		return $document;
	}

	/**
	 * The site-wide protection: provider, site key and secret, or an empty array.
	 *
	 * @return array<string,mixed>
	 */
	public static function site(): array {
		return ( new ConnectionRepository( SecretBox::for_site() ) )->by_ref( self::SITE_REF ) ?? array();
	}

	/**
	 * Saves the site-wide protection; an empty provider removes it, an empty secret keeps the
	 * stored one of the same provider.
	 *
	 * @param string     $provider  One of SITE_PROVIDERS, or ''.
	 * @param string     $site_key  Site key.
	 * @param string     $secret    Secret key.
	 * @param float|null $threshold reCAPTCHA v3: lowest score that counts as a person.
	 */
	public static function save_site( string $provider, string $site_key, string $secret, ?float $threshold = null ): void {
		$connections = new ConnectionRepository( SecretBox::for_site() );
		if ( ! in_array( $provider, self::SITE_PROVIDERS, true ) ) {
			$connections->delete( self::SITE_REF );
			return;
		}
		$current = self::site();
		if ( '' === $secret && ( $current['type'] ?? '' ) === $provider ) {
			$secret = (string) ( $current['secret']['secret'] ?? '' );
		}
		$config = array( 'siteKey' => $site_key );
		if ( 'recaptcha3' === $provider ) {
			$config['threshold'] = self::threshold_value( $threshold ?? ( $current['config']['threshold'] ?? self::THRESHOLD ) );
		}
		$connections->save(
			array(
				'ref'    => self::SITE_REF,
				'type'   => $provider,
				'label'  => self::NAMES[ $provider ],
				'config' => $config,
				'secret' => array( 'secret' => $secret ),
			)
		);
	}

	/**
	 * A threshold between 0.1 and 0.9 in steps of 0.1.
	 *
	 * @param mixed $value Submitted value.
	 */
	public static function threshold_value( $value ): float {
		return is_numeric( $value ) ? max( 0.1, min( 0.9, round( (float) $value, 1 ) ) ) : self::THRESHOLD;
	}

	/**
	 * Provider of the site-wide protection while it is usable, else ''.
	 */
	public static function site_provider(): string {
		$site = self::site();
		return self::usable( $site ) ? (string) $site['type'] : '';
	}

	/**
	 * Checks keys before visitors meet them: whether the site key has the form of the provider's
	 * keys (a swapped site key and secret is the usual mistake), and whether the provider knows
	 * the secret. The provider is asked with a made-up answer, which it refuses for that reason
	 * only when the secret is right.
	 *
	 * @param string $provider One of SITE_PROVIDERS.
	 * @param string $site_key Site key.
	 * @param string $secret   Secret key.
	 * @return string ok, site_key (does not look like one of the provider), secret (unknown to the
	 *                provider) or unreachable.
	 */
	public static function test_keys( string $provider, string $site_key, string $secret ): string {
		$patterns = array(
			'turnstile'  => '/^[0-3]x[A-Za-z0-9_-]{8,}$/',
			'hcaptcha'   => '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
			'recaptcha'  => '/^6L[A-Za-z0-9_-]{30,}$/',
			'recaptcha3' => '/^6L[A-Za-z0-9_-]{30,}$/',
		);
		if ( ! isset( $patterns[ $provider ] ) || 1 !== preg_match( $patterns[ $provider ], $site_key ) ) {
			return 'site_key';
		}
		$result = wp_remote_post(
			self::PROVIDERS[ $provider ],
			array(
				'timeout' => 10,
				'body'    => array(
					'secret'   => $secret,
					'response' => 'funnelforms-key-test',
				),
			)
		);
		if ( is_wp_error( $result ) ) {
			return 'unreachable';
		}
		$data  = json_decode( (string) wp_remote_retrieve_body( $result ), true );
		$codes = is_array( $data ) ? array_map( 'strval', (array) ( $data['error-codes'] ?? array() ) ) : null;
		if ( null === $codes ) {
			return 'unreachable';
		}
		// Test secrets of the providers accept every answer; real ones refuse the made-up one.
		return array() !== array_intersect( $codes, array( 'invalid-input-secret', 'missing-input-secret', 'invalid-keys', 'sitekey-secret-mismatch' ) ) ? 'secret' : 'ok';
	}

	/**
	 * Asks the provider whether the answer of the widget is valid.
	 *
	 * @param array<string,mixed> $field    Contact field of type captcha.
	 * @param string              $response Answer of the widget (token).
	 */
	public static function verify( array $field, string $response ): bool {
		return 'failed' !== self::check( $field, $response );
	}

	/**
	 * Asks the provider about the answer of the widget.
	 *
	 * @param array<string,mixed> $field    Contact field of type captcha.
	 * @param string              $response Answer of the widget (token).
	 * @return string ok, failed (invalid answer or provider unreachable), or low (reCAPTCHA v3:
	 *                a valid answer whose score is below the threshold).
	 */
	public static function check( array $field, string $response ): string {
		$connection = self::connection( $field );
		if ( ! self::usable( $connection ) || '' === $response ) {
			return 'failed';
		}
		$secret = (string) $connection['secret']['secret'];
		$body   = array(
			'secret'   => $secret,
			'response' => $response,
		);
		if ( isset( $_SERVER['REMOTE_ADDR'] ) ) {
			$body['remoteip'] = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
		}
		$result = wp_remote_post(
			self::PROVIDERS[ $connection['type'] ],
			array(
				'timeout' => 10,
				'body'    => $body,
			)
		);
		if ( is_wp_error( $result ) || 200 !== (int) wp_remote_retrieve_response_code( $result ) ) {
			return 'failed';
		}
		$data = json_decode( (string) wp_remote_retrieve_body( $result ), true );
		if ( ! is_array( $data ) || true !== ( $data['success'] ?? false ) ) {
			return 'failed';
		}
		if ( 'recaptcha3' === $connection['type'] && isset( $data['score'] ) && (float) $data['score'] < self::threshold_value( $connection['config']['threshold'] ?? self::THRESHOLD ) ) {
			return 'low';
		}
		return 'ok';
	}

	/**
	 * Connection of a captcha field.
	 *
	 * @param array<string,mixed> $field Contact field.
	 * @return array<string,mixed>
	 */
	private static function connection( array $field ): array {
		// A captcha field placed in the builder uses the site's protection.
		$ref = (string) ( $field['props']['connectionRef'] ?? '' );
		return ( new ConnectionRepository( SecretBox::for_site() ) )->by_ref( '' === $ref ? self::SITE_REF : $ref ) ?? array();
	}
}
