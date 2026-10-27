<?php
/**
 * Phone numbers by country.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

/**
 * Phone fields with a country picker (props.country) store numbers in E.164 (+4915112345678).
 * The country data lies in assets/phone/countries.json (tools/phone/countries.mjs): calling code,
 * national prefix, lengths of national numbers, groups and, for countries that share a calling
 * code, the pattern of their numbers. The runtime (packages/runtime/src/phone.ts) applies the
 * same rules in the browser.
 */
final class PhoneNumbers {

	/**
	 * Country data by ISO code.
	 *
	 * @var array<string,array<int,mixed>>|null
	 */
	private static ?array $countries = null;

	/**
	 * Start of mobile numbers in countries whose area codes vary in length, so the groups of a
	 * mobile number would split their other numbers wrongly; those are shown ungrouped.
	 */
	private const MOBILE = array( 'DE' => '1[5-7]' );

	/**
	 * Country data by ISO code: calling code, national prefix, lengths, groups, example, pattern.
	 *
	 * @return array<string,array<int,mixed>>
	 */
	public static function countries(): array {
		if ( null === self::$countries ) {
			$json            = (string) file_get_contents( dirname( __DIR__, 3 ) . '/assets/phone/countries.json' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file of the plugin.
			$data            = json_decode( $json, true );
			self::$countries = is_array( $data['countries'] ?? null ) ? $data['countries'] : array();
		}
		return self::$countries;
	}

	/**
	 * Whether a field checks numbers per country (a phone field with a country picker, or one that
	 * is confirmed by text message).
	 *
	 * @param array<string,mixed> $field Step or contact field.
	 */
	public static function applies( array $field ): bool {
		return in_array( $field['type'] ?? '', array( 'phone', 'phone_verification' ), true ) && ( isset( ( (array) ( $field['props'] ?? array() ) )['country'] ) || self::confirms( $field ) );
	}

	/**
	 * Whether a document has fields that check numbers per country (also in repeat groups); those
	 * forms load the phone chunk of the runtime.
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public static function used( array $document ): bool {
		foreach ( (array) ( $document['nodes'] ?? array() ) as $node ) {
			foreach ( is_array( $node ) ? (array) ( $node['fields'] ?? array() ) : array() as $field ) {
				if ( ! is_array( $field ) ) {
					continue;
				}
				foreach ( array_merge( array( $field ), 'repeat' === ( $field['type'] ?? '' ) ? (array) ( $field['props']['fields'] ?? array() ) : array() ) as $one ) {
					if ( is_array( $one ) && self::applies( $one ) ) {
						return true;
					}
				}
			}
		}
		return false;
	}

	/**
	 * Whether a contact field is confirmed by text message: the 3.x type always, a phone field
	 * with props.sms.
	 *
	 * @param array<string,mixed> $field Contact field.
	 */
	public static function confirms( array $field ): bool {
		return 'phone_verification' === ( $field['type'] ?? '' ) || ( 'phone' === ( $field['type'] ?? '' ) && is_array( ( (array) ( $field['props'] ?? array() ) )['sms'] ?? null ) );
	}

	/**
	 * Countries a field accepts; empty for all.
	 *
	 * @param array<string,mixed> $field Field.
	 * @return string[]
	 */
	public static function allowed( array $field ): array {
		$countries = self::countries();
		return array_values( array_filter( array_map( 'strval', (array) ( $field['props']['country']['allowed'] ?? array() ) ), static fn( string $iso ): bool => isset( $countries[ $iso ] ) ) );
	}

	/**
	 * The country a field starts with: its own, else the region of the language (de_AT: AT), else
	 * the first allowed one. Mirrors startCountry() of the runtime, without the likely regions of
	 * bare languages, which PHP does not know (de is taken as DE, en as US).
	 *
	 * @param array<string,mixed> $field  Field.
	 * @param string              $locale Locale of the entry.
	 */
	public static function start_country( array $field, string $locale ): string {
		$allowed = self::allowed( $field );
		$fits    = static fn( string $iso ): bool => isset( self::countries()[ $iso ] ) && ( array() === $allowed || in_array( $iso, $allowed, true ) );
		$own     = (string) ( $field['props']['country']['default'] ?? '' );
		if ( $fits( $own ) ) {
			return $own;
		}
		$region = 1 === preg_match( '/^[a-z]{2,3}_([A-Z]{2})/', $locale, $m ) ? $m[1] : strtoupper( array( 'en' => 'us' )[ substr( $locale, 0, 2 ) ] ?? substr( $locale, 0, 2 ) );
		if ( $fits( $region ) ) {
			return $region;
		}
		return $allowed[0] ?? 'US';
	}

	/**
	 * Reads a number: with + or 00 the calling code names the country, otherwise it belongs to
	 * $fallback. Null when no country fits.
	 *
	 * @param string $text     Number as typed.
	 * @param string $fallback Country of national numbers.
	 * @return array{country:string,national:string}|null
	 */
	public static function parse( string $text, string $fallback ): ?array {
		$text   = trim( $text );
		$digits = (string) preg_replace( '/\D/', '', $text );
		if ( str_starts_with( $text, '+' ) || ( str_starts_with( $digits, '00' ) && ! str_starts_with( $text, '(' ) ) ) {
			if ( ! str_starts_with( $text, '+' ) ) {
				$digits = substr( $digits, 2 );
			}
			for ( $length = 1; $length <= 3; $length++ ) {
				$code = substr( $digits, 0, $length );
				$rest = (string) substr( $digits, $length );
				$iso  = self::country_of( $code, $rest );
				if ( null !== $iso ) {
					$national = self::without_prefix( $iso, $rest );
					return array(
						'country'  => $national === $rest ? $iso : ( self::country_of( $code, $national ) ?? $iso ),
						'national' => $national,
					);
				}
			}
			return null;
		}
		if ( ! isset( self::countries()[ $fallback ] ) ) {
			return null;
		}
		return array(
			'country'  => $fallback,
			'national' => self::without_prefix( $fallback, $digits ),
		);
	}

	/**
	 * Checks a number: null when it fits, else an error code.
	 *
	 * @param array{country:string,national:string} $number  Number.
	 * @param string[]                              $allowed Countries accepted; empty for all.
	 */
	public static function check( array $number, array $allowed = array() ): ?string {
		$country = self::countries()[ $number['country'] ] ?? null;
		if ( null === $country ) {
			return 'invalid_phone';
		}
		if ( array() !== $allowed && ! in_array( $number['country'], $allowed, true ) ) {
			return 'phone_country_not_allowed';
		}
		$lengths = (array) $country[2];
		$length  = strlen( $number['national'] );
		if ( $length < min( $lengths ) ) {
			return 'phone_too_short';
		}
		if ( $length > max( $lengths ) ) {
			return 'phone_too_long';
		}
		return in_array( $length, $lengths, true ) && ! ( '0' === $country[1] && str_starts_with( $number['national'], '0' ) ) ? null : 'invalid_phone';
	}

	/**
	 * The number in E.164.
	 *
	 * @param array{country:string,national:string} $number Number.
	 */
	public static function e164( array $number ): string {
		return '+' . ( self::countries()[ $number['country'] ][0] ?? '' ) . $number['national'];
	}

	/**
	 * Display of a number in E.164 for mails, entries and exports: +49 1512 3456789, a German
	 * landline without groups (+49 3012345678). Other text comes back as it is.
	 *
	 * @param string $e164 Number.
	 */
	public static function display( string $e164 ): string {
		$number = str_starts_with( $e164, '+' ) ? self::parse( $e164, '' ) : null;
		if ( null === $number ) {
			return $e164;
		}
		$country = self::countries()[ $number['country'] ];
		$mobile  = self::MOBILE[ $number['country'] ] ?? null;
		if ( null !== $mobile && 1 !== preg_match( '/^(?:' . $mobile . ')/', $number['national'] ) ) {
			return '+' . $country[0] . ' ' . $number['national'];
		}
		$groups = array_map( 'intval', explode( ' ', (string) $country[3] ) );
		$parts  = array();
		$at     = 0;
		foreach ( $groups as $i => $size ) {
			$part = count( $groups ) - 1 === $i ? substr( $number['national'], $at ) : substr( $number['national'], $at, $size );
			$at  += $size;
			if ( '' !== $part ) {
				$parts[] = $part;
			}
		}
		return trim( '+' . $country[0] . ' ' . implode( ' ', $parts ) );
	}

	/**
	 * Validates the answer of a phone field with country settings.
	 *
	 * @param array<string,mixed> $field  Field.
	 * @param string              $text   Trimmed, non-empty answer.
	 * @param string              $locale Locale of the entry, for national numbers.
	 * @return array{value:?string,error:?string} The number in E.164, or the error.
	 */
	public static function validate( array $field, string $text, string $locale = '' ): array {
		$number = self::parse( $text, self::start_country( $field, $locale ) );
		$error  = null === $number ? 'invalid_phone' : self::check( $number, self::allowed( $field ) );
		return null === $error && null !== $number
			? array(
				'value' => self::e164( $number ),
				'error' => null,
			)
			: array(
				'value' => null,
				'error' => $error ?? 'invalid_phone',
			);
	}

	/**
	 * The country of a national number after a calling code: the one whose numbers it fits, else
	 * the main one.
	 *
	 * @param string $code     Calling code.
	 * @param string $national National number.
	 */
	private static function country_of( string $code, string $national ): ?string {
		$main = null;
		foreach ( self::countries() as $iso => $entry ) {
			if ( $entry[0] !== $code ) {
				continue;
			}
			if ( ! isset( $entry[5] ) ) {
				$main ??= (string) $iso;
			} elseif ( '' !== $national && 1 === preg_match( '/^(?:' . $entry[5] . ')$/', $national ) ) {
				return (string) $iso;
			}
		}
		return $main;
	}

	/**
	 * Removes the national prefix typed before a national number (0151 …, +49 0151 …); see
	 * withoutPrefix() in the runtime.
	 *
	 * @param string $iso    Country.
	 * @param string $digits Digits.
	 */
	private static function without_prefix( string $iso, string $digits ): string {
		$country = self::countries()[ $iso ];
		$prefix  = (string) $country[1];
		if ( '' !== $prefix && str_starts_with( $digits, $prefix ) && strlen( $digits ) > strlen( $prefix ) ) {
			$rest = substr( $digits, strlen( $prefix ) );
			if ( '8' !== $prefix || in_array( strlen( $rest ), (array) $country[2], true ) || ! in_array( strlen( $digits ), (array) $country[2], true ) ) {
				return $rest;
			}
		}
		return $digits;
	}
}
