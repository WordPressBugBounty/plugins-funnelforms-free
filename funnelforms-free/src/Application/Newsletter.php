<?php
/**
 * Tips and news by email: the sign-up of the site's administrator in the setup assistant.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Application\Telemetry\Sender;
use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Optional and off until the administrator ticks the box. Nothing goes to Funnelforms before
 * that click (wordpress.org guideline 7): the consent text is built into the plugin, one per
 * language of the Brain, so the assistant can show it without a request. After the click the
 * site sends the address, the language and the version of the text that was shown; the Brain
 * answers 202 and sends a mail to confirm (double opt-in). When the Brain has a newer text
 * (409 text_veraltet), the site loads it right then and shows it; nothing more is sent until
 * the administrator ticks the box again. No retries, nothing in the background, and the site
 * keeps no address (the assistant keeps only that the sign-up went out). Both editions use the
 * same address of the Brain as the diagnostic data (Sender::base()). Contract:
 * docs/api/account.md.
 */
final class Newsletter {

	/** Path of the sign-up below the base address. */
	public const PATH = '/newsletter';

	/** Path of the current consent text below the base address. */
	public const TEXT_PATH = '/newsletter/text';

	/**
	 * Languages of the mailings: German sites and administrators get German mails, all others
	 * English (the Brain keeps the two lists apart).
	 */
	public const LANGUAGES = array( 'de', 'en' );

	/** Source of a sign-up at the Brain, per edition. */
	public const SOURCE_FREE = 'free_plugin';
	public const SOURCE_PRO  = 'pro_plugin';

	/**
	 * Version of the built-in consent text. A new wording at the Brain is a new version, so this
	 * changes together with TEXTS (from the Brain: apps/api/src/kunde/marketing/texte.ts).
	 */
	public const VERSION = 'newsletter-2026-11';

	/** The built-in consent text of VERSION, exactly as the Brain has it. Not translatable on purpose. */
	public const TEXTS = array(
		'de' => 'Ja, ich möchte E-Mails der Funnelforms LLC mit Produktneuigkeiten, Tipps und Angeboten erhalten. Meine Einwilligung kann ich jederzeit mit einem Klick auf den Abmeldelink in jeder Mail widerrufen. Mehr in der Datenschutzerklärung.',
		'en' => 'Yes, I want to receive emails from Funnelforms LLC with product news, tips and offers. I can withdraw my consent at any time with one click on the unsubscribe link in every email. More in the privacy policy.',
	);

	/** Words of the texts that link to the privacy policy. */
	private const PRIVACY_WORDS = array(
		'de' => 'Datenschutzerklärung',
		'en' => 'privacy policy',
	);

	/** Privacy policy of Funnelforms in German and in English. */
	private const PRIVACY_URLS = array(
		'de' => 'https://www.funnelforms.io/datenschutzerklarung',
		'en' => 'https://en.funnelforms.io/privacy-policy',
	);

	/** Transient: consent texts loaded after a 409, language => {version, text}. */
	public const FETCHED = 'funnelforms_newsletter_text';

	/** Result: the Brain took the sign-up and sends the mail to confirm. */
	public const SENT = 'sent';

	/** Result: the text shown is outdated; the current one is loaded and has to be ticked again. */
	public const STALE = 'stale';

	/** Result: no answer, or an error of the Brain. */
	public const FAILED = 'failed';

	/** Result: the address is not a valid e-mail address. */
	public const INVALID = 'invalid';

	private const TIMEOUT = 10;

	/**
	 * German when the administrator reads WordPress in German (their own language, else the
	 * site's), English for every other language. The consent text and the mails that follow
	 * are in the language the administrator read when they ticked the box.
	 */
	public static function language(): string {
		return 'de' === strtolower( (string) strtok( (string) get_user_locale(), '_' ) ) ? 'de' : 'en';
	}

	/**
	 * The consent text to show: the one loaded after a 409, else the built-in one.
	 *
	 * @param string $language Language of the Brain.
	 * @return array{version:string,text:string}
	 */
	public static function text( string $language ): array {
		$fetched = get_transient( self::FETCHED );
		$text    = is_array( $fetched ) && is_array( $fetched[ $language ] ?? null ) ? self::clean( $fetched[ $language ] ) : null;
		return $text ?? array(
			'version' => self::VERSION,
			'text'    => self::TEXTS[ 'de' === $language ? 'de' : 'en' ],
		);
	}

	/**
	 * The consent text as HTML, escaped, with the words about the privacy policy as its link
	 * (or a link after the text when it has no such words).
	 *
	 * @param string $text     Consent text.
	 * @param string $language Language of the Brain.
	 */
	public static function text_html( string $text, string $language ): string {
		$key   = 'de' === $language ? 'de' : 'en';
		$html  = esc_html( $text );
		$words = esc_html( self::PRIVACY_WORDS[ $key ] );
		$link  = '<a href="' . esc_url( self::PRIVACY_URLS[ $key ] ) . '" target="_blank" rel="noopener">';
		$at    = strpos( $html, $words );
		if ( false !== $at ) {
			return substr_replace( $html, $link . $words . '</a>', $at, strlen( $words ) );
		}
		return $html . ' ' . $link . esc_html__( 'Privacy policy', 'funnelforms-free' ) . '</a>';
	}

	/**
	 * Sends the sign-up. Only after the administrator ticked the box and clicked; the caller
	 * checks the capability and the nonce.
	 *
	 * @param string $email    Address.
	 * @param string $language Language of the Brain.
	 * @param string $version  Version of the consent text that was shown.
	 * @return string SENT, STALE, FAILED or INVALID.
	 */
	public static function sign_up( string $email, string $language, string $version ): string {
		if ( ! is_email( $email ) || strlen( $email ) > 254 ) {
			return self::INVALID;
		}
		$language = in_array( $language, self::LANGUAGES, true ) ? $language : 'en';
		$response = wp_remote_post(
			Sender::base() . self::PATH,
			array(
				'timeout' => self::TIMEOUT,
				'headers' => array(
					'Accept'       => 'application/json',
					'Content-Type' => 'application/json',
				),
				// Exactly these fields: the Brain checks the body strictly, and there is no tracking.
				// The source tells the Brain which edition the contact came from.
				'body'    => (string) wp_json_encode(
					array(
						'email'        => $email,
						'sprache'      => $language,
						'text_version' => $version,
						'einwilligung' => true,
						'quelle'       => Edition::is_free() ? self::SOURCE_FREE : self::SOURCE_PRO,
					)
				),
			)
		);
		if ( is_wp_error( $response ) ) {
			return self::FAILED;
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( $status >= 200 && $status < 300 ) {
			return self::SENT;
		}
		if ( 409 === $status ) {
			return null === self::fetch( $language ) ? self::FAILED : self::STALE;
		}
		return self::FAILED;
	}

	/**
	 * Loads the current consent text of a language (only after a 409, which follows a click)
	 * and keeps it for a day, so the assistant shows it.
	 *
	 * @param string $language Language of the Brain.
	 * @return array{version:string,text:string}|null Null without a valid answer.
	 */
	public static function fetch( string $language ): ?array {
		$response = wp_remote_get(
			add_query_arg( 'sprache', $language, Sender::base() . self::TEXT_PATH ),
			array(
				'timeout' => self::TIMEOUT,
				'headers' => array( 'Accept' => 'application/json' ),
			)
		);
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return null;
		}
		$answer = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$text   = is_array( $answer ) ? self::clean( $answer ) : null;
		// The hash proves the text arrived as the Brain stores it.
		if ( null === $text || ! is_string( $answer['sha256'] ?? null ) || ! hash_equals( hash( 'sha256', $text['text'] ), strtolower( $answer['sha256'] ) ) ) {
			return null;
		}
		$fetched              = get_transient( self::FETCHED );
		$fetched              = is_array( $fetched ) ? $fetched : array();
		$fetched[ $language ] = $text;
		set_transient( self::FETCHED, $fetched, DAY_IN_SECONDS );
		return $text;
	}

	/**
	 * A consent text with a plausible version, or null.
	 *
	 * @param array<string,mixed> $value Version and text.
	 * @return array{version:string,text:string}|null
	 */
	private static function clean( array $value ): ?array {
		$version = $value['version'] ?? null;
		$text    = $value['text'] ?? null;
		if ( ! is_string( $version ) || 1 !== preg_match( '/^[A-Za-z0-9._-]{1,60}$/', $version ) || ! is_string( $text ) || '' === trim( $text ) || strlen( $text ) > 2000 ) {
			return null;
		}
		return array(
			'version' => $version,
			'text'    => $text,
		);
	}
}
