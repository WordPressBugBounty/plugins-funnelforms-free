<?php
/**
 * Second line of spam protection: the spam folder and what decides an entry goes there.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Domain\Entry\Submission;
use Funnelforms\Edition\Edition;
use Funnelforms\Http\Captcha;
use Funnelforms\Integrations\Akismet;

defined( 'ABSPATH' ) || exit;

/**
 * The first line rejects what cannot be a person: a forged, reused or too young token, a failed
 * captcha, too many entries from one visitor. Signals that can be wrong about people do not
 * reject but put the entry into the spam folder (status spam), where nothing is lost: a filled
 * honeypot (browsers sometimes fill it), a fill time below the site's minimum, a low reCAPTCHA v3
 * score, Akismet, and the blocklists of Funnelforms Pro (SpamRules) set to "spam". A spam entry
 * runs no action, integration or conversion and counts in no figure; "Not spam" in the entries
 * list runs what was held back (SubmitEntry::release_spam()). The daily job deletes spam after
 * the site's days (default 30).
 *
 * Site settings in the option funnelforms_spam: spamDays, minSeconds (0: only the token's three
 * seconds), hourly (most entries per visitor and hour across the site, 0: off) and akismet
 * (opt-in, since it sends entries to Automattic).
 */
final class SpamCheck {

	public const OPTION = 'funnelforms_spam';

	/** Signals that put an entry into the spam folder; the entries list names them. */
	public const REASONS = array( 'honeypot', 'too_fast', 'captcha_score', 'akismet', 'rule_words', 'rule_email', 'rule_ip', 'rule_disposable' );

	/**
	 * The site's settings with their defaults.
	 *
	 * @return array{spamDays:int,minSeconds:int,hourly:int,akismet:bool}
	 */
	public static function settings(): array {
		return self::sanitize( get_option( self::OPTION, array() ) );
	}

	/**
	 * Saved value of the settings.
	 *
	 * @param mixed $value Submitted value.
	 * @return array{spamDays:int,minSeconds:int,hourly:int,akismet:bool}
	 */
	public static function sanitize( $value ): array {
		$value = is_array( $value ) ? $value : array();
		$int   = static fn( string $key, int $fallback, int $max ): int => isset( $value[ $key ] ) && is_numeric( $value[ $key ] ) ? max( 0, min( $max, (int) $value[ $key ] ) ) : $fallback;
		return array(
			'spamDays'   => $int( 'spamDays', 30, 365 ),
			'minSeconds' => $int( 'minSeconds', 0, 600 ),
			'hourly'     => $int( 'hourly', 0, 1000 ),
			'akismet'    => ! empty( $value['akismet'] ) && '0' !== $value['akismet'],
		);
	}

	/**
	 * Decides about a checked submission.
	 *
	 * @param Submission $s       Submission.
	 * @param string[]   $signals Reasons found before (honeypot, too_fast, captcha_score).
	 * @param string     $ip      Visitor's IP address.
	 * @param string     $agent   Visitor's user agent.
	 * @return array{verdict:string,reasons:string[],akismet?:array<string,string>} verdict ok, spam or reject.
	 */
	public static function judge( Submission $s, array $signals, string $ip, string $agent ): array {
		$reasons = array_values( array_intersect( self::REASONS, $signals ) );
		$verdict = array() === $reasons ? 'ok' : 'spam';
		$rules   = Edition::pro( SpamRules::class );
		$hit     = null === $rules ? null : $rules::match( $s, $ip );
		if ( null !== $hit ) {
			$reasons = array_values( array_unique( array_merge( $reasons, $hit['reasons'] ) ) );
			$verdict = 'reject' === $hit['action'] ? 'reject' : 'spam';
		}
		$out = array();
		if ( 'ok' === $verdict && self::settings()['akismet'] && Akismet::available() ) {
			$sent = Akismet::check( $s, $ip, $agent );
			if ( null !== $sent ) {
				$verdict   = 'spam';
				$reasons[] = 'akismet';
				// Kept with the spam entry only, to tell Akismet if it was wrong ("Not spam").
				$out['akismet'] = $sent;
			}
		}
		/**
		 * The verdict about an entry before it is stored.
		 *
		 * @param array      $verdict verdict (ok, spam or reject) and reasons.
		 * @param Submission $s       Submission.
		 */
		$filtered = apply_filters(
			'funnelforms_spam_verdict',
			array(
				'verdict' => $verdict,
				'reasons' => $reasons,
			),
			$s
		);
		$verdict  = is_array( $filtered ) && in_array( $filtered['verdict'] ?? '', array( 'ok', 'spam', 'reject' ), true ) ? (string) $filtered['verdict'] : $verdict;
		$reasons  = is_array( $filtered ) && is_array( $filtered['reasons'] ?? null ) ? array_values( array_map( 'strval', $filtered['reasons'] ) ) : $reasons;
		return array(
			'verdict' => $verdict,
			'reasons' => $reasons,
		) + $out;
	}

	/**
	 * The e-mail addresses of a submission (contact fields and step fields of type email).
	 *
	 * @param Submission $s Submission.
	 * @return string[] Lower case.
	 */
	public static function emails( Submission $s ): array {
		$out = array();
		foreach ( $s->contact_values + $s->answers as $field_id => $value ) {
			$field = $s->document->field( (string) $field_id );
			if ( 'email' === ( $field['type'] ?? '' ) && is_string( $value ) && '' !== $value ) {
				$out[] = strtolower( trim( $value ) );
			}
		}
		return $out;
	}

	/**
	 * The text the visitor typed: text fields of the steps and the contact step, without e-mail
	 * addresses and phone numbers.
	 *
	 * @param Submission $s Submission.
	 */
	public static function typed_text( Submission $s ): string {
		$out = array();
		foreach ( $s->contact_values + $s->answers as $field_id => $value ) {
			$field = $s->document->field( (string) $field_id );
			if ( in_array( $field['type'] ?? '', array( 'text', 'textarea', 'name', 'url' ), true ) && is_string( $value ) && '' !== trim( $value ) ) {
				$out[] = trim( $value );
			}
		}
		return implode( "\n", $out );
	}

	/**
	 * The protection that applies to the forms of the site now, as names for people.
	 *
	 * @return string[]
	 */
	public static function protection(): array {
		$settings = self::settings();
		$out      = array(
			__( 'Hidden field', 'funnelforms-free' ),
			$settings['minSeconds'] > 0
				/* translators: %d: seconds */
				? sprintf( __( 'Time check (at least %d seconds)', 'funnelforms-free' ), $settings['minSeconds'] )
				: __( 'Time check', 'funnelforms-free' ),
			__( 'Entries per visitor limited', 'funnelforms-free' ),
		);
		$provider = Captcha::site_provider();
		if ( '' !== $provider ) {
			$out[] = Captcha::NAMES[ $provider ];
		}
		if ( $settings['akismet'] && Akismet::available() ) {
			$out[] = 'Akismet';
		}
		$rules = Edition::pro( SpamRules::class );
		if ( null !== $rules && $rules::active() ) {
			$out[] = __( 'Blocklists', 'funnelforms-free' );
		}
		return $out;
	}
}
