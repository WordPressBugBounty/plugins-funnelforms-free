<?php
/**
 * Akismet as a spam check of entries, when the Akismet plugin is active with a key.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Integrations;

use Funnelforms\Application\PrivacyMode;
use Funnelforms\Application\SpamCheck;
use Funnelforms\Domain\Entry\Submission;

defined( 'ABSPATH' ) || exit;

/**
 * Uses the key of the Akismet plugin (Automattic); Funnelforms has no key of its own. Akismet is
 * a service of another provider, so it runs only after the site turned it on under Settings →
 * Entries and spam (SpamCheck::settings()['akismet']). It gets the name, the e-mail address and
 * the typed text of the entry, the page, the language, the user agent and the IP address; in the
 * EU privacy mode the IP address is shortened first (wp_privacy_anonymize_ip()). When Akismet
 * cannot be reached, the entry is taken as it is.
 *
 * "Not spam" in the entries list reports the entry to Akismet as a false positive (submit-ham),
 * with what was sent, which the spam entry keeps until then.
 */
final class Akismet {

	private const API = 'https://rest.akismet.com/1.1/';

	/**
	 * The key of the Akismet plugin, or '' when it is not active or has no key.
	 */
	public static function key(): string {
		$key = class_exists( '\Akismet' ) && is_callable( array( '\Akismet', 'get_api_key' ) ) ? (string) \Akismet::get_api_key() : '';
		/**
		 * The Akismet key Funnelforms uses; '' turns Akismet off.
		 *
		 * @param string $key Key of the Akismet plugin.
		 */
		return (string) apply_filters( 'funnelforms_akismet_key', $key );
	}

	/**
	 * Whether Akismet can be used: its plugin is active with a key.
	 */
	public static function available(): bool {
		return '' !== self::key();
	}

	/**
	 * Asks Akismet about a submission.
	 *
	 * @param Submission $s     Submission.
	 * @param string     $ip    Visitor's IP address.
	 * @param string     $agent Visitor's user agent.
	 * @return array<string,string>|null What was sent when Akismet says spam; null otherwise.
	 */
	public static function check( Submission $s, string $ip, string $agent ): ?array {
		$name = '';
		foreach ( $s->contact_fields() as $field ) {
			if ( 'name' === $field['type'] && is_string( $s->contact_values[ $field['id'] ] ?? null ) ) {
				$name = trim( $name . ' ' . $s->contact_values[ $field['id'] ] );
			}
		}
		$data = array(
			'blog'                 => home_url( '/' ),
			'user_ip'              => PrivacyMode::eu() ? (string) wp_privacy_anonymize_ip( $ip ) : $ip,
			'user_agent'           => substr( $agent, 0, 500 ),
			'permalink'            => (string) ( $s->page['url'] ?? '' ),
			'comment_type'         => 'contact-form',
			'comment_author'       => $name,
			'comment_author_email' => SpamCheck::emails( $s )[0] ?? '',
			'comment_content'      => SpamCheck::typed_text( $s ),
			'blog_lang'            => $s->locale,
			'blog_charset'         => 'UTF-8',
		);
		return 'true' === self::call( 'comment-check', $data ) ? $data : null;
	}

	/**
	 * Tells Akismet that an entry it called spam is none.
	 *
	 * @param array<string,string> $data What check() sent.
	 */
	public static function report_ham( array $data ): void {
		if ( self::available() && array() !== $data ) {
			self::call( 'submit-ham', $data );
		}
	}

	/**
	 * Calls the API; the answer's body, '' when it failed.
	 *
	 * @param string               $method comment-check or submit-ham.
	 * @param array<string,string> $data   Parameters.
	 */
	private static function call( string $method, array $data ): string {
		$result = wp_remote_post(
			self::API . $method,
			array(
				'timeout' => 5,
				'body'    => array( 'api_key' => self::key() ) + $data,
			)
		);
		return is_wp_error( $result ) || 200 !== (int) wp_remote_retrieve_response_code( $result ) ? '' : trim( (string) wp_remote_retrieve_body( $result ) );
	}
}
