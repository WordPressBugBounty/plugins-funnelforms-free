<?php
/**
 * What the browser reports for server-side conversions: consent and advertising identifiers.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Entry;

defined( 'ABSPATH' ) || exit;

/**
 * The runtime reads the consent from the WP Consent API (wp_has_consent) that cookie banners such
 * as Complianz, CookieYes or Real Cookie Banner fill, and the first-party cookies of the pixels
 * (_fbp, _fbc, _ga, _ttp) plus click IDs in the address. Everything is checked against the
 * formats the platforms use; anything else is dropped. Stored with the entry only for forms with
 * conversion actions, and only what the visitor allowed: identifiers, IP address and user agent of
 * a category need a yes. No answer (no consent tool) counts as no in the EU privacy mode and as yes
 * in the global mode (Application\PrivacyMode); a no always counts.
 */
final class VisitorTracking {

	/** Consent category of each identifier. */
	private const CATEGORY = array(
		'fbp'        => 'marketing',
		'fbc'        => 'marketing',
		'gaClientId' => 'statistics',
		'ttp'        => 'marketing',
		'ttclid'     => 'marketing',
	);

	private const PATTERNS = array(
		'fbp'        => '/^fb\.[0-9]\.[0-9]{10,16}\.[0-9]{1,20}$/',
		'fbc'        => '/^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_-]{1,500}$/',
		'gaClientId' => '/^[0-9]{1,20}\.[0-9]{1,20}$/',
		'ttp'        => '/^[A-Za-z0-9_.-]{1,100}$/',
		'ttclid'     => '/^[A-Za-z0-9_.-]{1,500}$/',
	);

	/**
	 * Tracking data to keep, or null when the visitor allowed neither marketing nor statistics
	 * (the unrestricted privacy mode keeps it anyway).
	 *
	 * @param mixed  $input      tracking object of the submit: consent {marketing, statistics} and the identifiers.
	 * @param string $ip         IP address of the request.
	 * @param string $user_agent User agent of the request.
	 * @param bool   $eu         Whether the EU privacy mode applies (the site's option, never the browser's word).
	 * @param bool   $open       Whether the unrestricted privacy mode applies: everything is kept, whatever the visitor answered.
	 * @return array<string,mixed>|null
	 */
	public static function from_input( $input, string $ip, string $user_agent, bool $eu = true, bool $open = false ): ?array {
		$input   = is_array( $input ) ? $input : array();
		$consent = array();
		$allowed = array();
		foreach ( array( 'marketing', 'statistics' ) as $category ) {
			$value                = $input['consent'][ $category ] ?? null;
			$consent[ $category ] = is_bool( $value ) ? $value : null;
			$allowed[ $category ] = $open || ( $consent[ $category ] ?? ! $eu );
		}
		if ( ! $allowed['marketing'] && ! $allowed['statistics'] ) {
			return null;
		}
		$out = array( 'consent' => $consent );
		foreach ( self::PATTERNS as $key => $pattern ) {
			$value       = $allowed[ self::CATEGORY[ $key ] ] ? ( $input[ $key ] ?? '' ) : '';
			$out[ $key ] = is_string( $value ) && 1 === preg_match( $pattern, $value ) ? $value : '';
		}
		// Only Meta and TikTok (marketing) match by IP address and browser.
		$marketing        = $allowed['marketing'];
		$out['ip']        = $marketing && false !== filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '';
		$out['userAgent'] = $marketing ? mb_substr( $user_agent, 0, 512 ) : '';
		return $out;
	}
}
