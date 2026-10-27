<?php
/**
 * Checks and normalizes the answers of one submitted entry.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Entry;

use Funnelforms\Domain\Form\InputMask;
use Funnelforms\Domain\Form\JsNumber;
use Funnelforms\Domain\Form\PhoneNumbers;

defined( 'ABSPATH' ) || exit;

/**
 * The browser checks the same rules for quick feedback; this class decides. Rules follow 3.x
 * where it had one (contact field checks in frontend/frontend.php), so a form behaves the same
 * after the switch to the new renderer.
 */
final class AnswerValidator {

	public const MAX_TEXT     = 10000;
	public const MAX_TEXTAREA = 65535;

	/**
	 * Stored values of the salutation choices; 3.x stored these German words in every language.
	 */
	public const SALUTATIONS = array(
		'male'    => 'Herr',
		'female'  => 'Frau',
		'diverse' => 'Divers',
		'company' => 'Firma',
	);

	/**
	 * Mail domains rejected by "business e-mail only", the list 3.x used.
	 */
	private const FREEMAIL = array( 'hotmail.com', 'gmail.com', 'yahoo.co', 'yahoo.com', 'mailinator.com', 'gmail.co.in', 'aol.com', 'yandex.com', 'msn.com', 'gawab.com', 'inbox.com', 'gmx.com', 'rediffmail.com', 'in.com', 'live.com', 'hotmail.co.uk', 'hotmail.fr', 'yahoo.fr', 'wanadoo.fr', 'comcast.net', 'yahoo.co.uk', 'yahoo.com.br', 'yahoo.co.in', 'free.fr', 'gmx.de', 'yandex.ru', 'ymail.com', 'libero.it', 'outlook.com', 'uol.com.br', 'bol.com.br', 'mail.ru', 'cox.net', 'hotmail.it', 'sbcglobal.net', 'sfr.fr', 'live.fr', 'verizon.net', 'live.co.uk', 'googlemail.com', 'yahoo.es', 'ig.com.br', 'live.nl', 'bigpond.com', 'terra.com.br', 'yahoo.it', 'neuf.fr', 'yahoo.de', 'rocketmail.com', 'att.net', 'laposte.net', 'facebook.com', 'bellsouth.net', 'yahoo.in', 'hotmail.es', 'charter.net', 'yahoo.ca', 'yahoo.com.au', 'rambler.ru', 'hotmail.de', 'tiscali.it', 'shaw.ca', 'yahoo.co.jp', 'outlook.de', 'web.de', 'sky.com', 'earthlink.net', 'optonline.net', 'freenet.de', 't-online.de', 'aliceadsl.fr', 'virgilio.it', 'home.nl', 'qq.com', 'telenet.be', 'me.com', 'yahoo.com.ar', 'tiscali.co.uk', 'yahoo.com.mx', 'gmx.net', 'mail.com', 'planet.nl', 'tin.it', 'live.it', 'ntlworld.com', 'arcor.de', 'yahoo.co.id', 'frontiernet.net', 'hetnet.nl', 'live.com.au', 'yahoo.com.sg', 'zonnet.nl', 'club-internet.fr', 'juno.com', 'optusnet.com.au', 'blueyonder.co.uk', 'bluewin.ch', 'skynet.be', 'sympatico.ca', 'windstream.net', 'mac.com', 'centurytel.net', 'chello.nl', 'live.ca', 'aim.com', 'bigpond.net.au' );

	/**
	 * Validates the answer of a step field.
	 *
	 * @param array<string,mixed> $field  Field.
	 * @param mixed               $answer Submitted answer; null when missing.
	 * @param string              $locale Locale of the entry: the country of national phone numbers.
	 * @return array{value:mixed,error:?string} Value is null when the field stays unanswered.
	 */
	public static function step_field( array $field, $answer, string $locale = '' ): array {
		$required = ! empty( $field['required'] );
		switch ( $field['type'] ) {
			case 'content':
			case 'result':
				return self::ok( null );

			case 'choice':
			case 'dropdown':
				$ids = self::string_list( $answer );
				if ( null === $ids ) {
					return self::error( 'invalid_option' );
				}
				$known  = array_column( $field['options'] ?? array(), 'id' );
				$chosen = array_values( array_filter( $known, static fn( $id ) => in_array( $id, $ids, true ) ) );
				if ( count( $chosen ) !== count( array_unique( $ids ) ) ) {
					return self::error( 'invalid_option' );
				}
				$multiple = ! empty( $field['props']['multiple'] );
				if ( ! $multiple && count( $chosen ) > 1 ) {
					return self::error( 'invalid_option' );
				}
				if ( array() === $chosen ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				// Limits of multiple choices; an optional question may stay empty.
				if ( $multiple && isset( $field['props']['minChoices'] ) && count( $chosen ) < (int) $field['props']['minChoices'] ) {
					return self::error( 'too_few_choices' );
				}
				if ( $multiple && isset( $field['props']['maxChoices'] ) && count( $chosen ) > (int) $field['props']['maxChoices'] ) {
					return self::error( 'too_many_choices' );
				}
				return self::ok( $chosen );

			case 'text':
			case 'textarea':
				if ( null !== $answer && ! is_string( $answer ) ) {
					return self::error( 'invalid_format' );
				}
				$text = str_replace( array( "\r\n", "\r" ), "\n", (string) $answer );
				if ( 'text' === $field['type'] ) {
					$text = str_replace( "\n", ' ', $text );
				}
				if ( '' === trim( $text ) ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				$length = mb_strlen( trim( $text ), 'UTF-8' );
				$props  = $field['props'] ?? array();
				if ( $length > ( 'text' === $field['type'] ? self::MAX_TEXT : self::MAX_TEXTAREA ) || ( isset( $props['maxLength'] ) && $props['maxLength'] > 0 && $length > (int) $props['maxLength'] ) ) {
					return self::error( 'too_long' );
				}
				if ( isset( $props['minLength'] ) && $length < (int) $props['minLength'] ) {
					return self::error( 'too_short' );
				}
				$restrict = $props['restrict'] ?? null;
				if ( ( 'letters' === $restrict && preg_match( '/\d/', $text ) ) || ( 'digits' === $restrict && preg_match( '/\D/', $text ) ) || ( 'birthday' === $restrict && ! self::is_date( $text, 'dd.mm.yy' ) ) ) {
					return self::error( 'invalid_format' );
				}
				return self::ok( $text );

			case 'date':
				if ( null !== $answer && ! is_string( $answer ) ) {
					return self::error( 'invalid_format' );
				}
				$text = trim( (string) $answer );
				if ( '' === $text ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				return self::date( $field['props'] ?? array(), $text );

			case 'file':
			case 'signature':
				// References of uploads (Application\UploadFile); SubmitEntry checks that they exist.
				// A signature is one PNG the runtime uploads.
				$refs = null === $answer ? array() : self::string_list( $answer );
				if ( null === $refs ) {
					return self::error( 'invalid_file' );
				}
				$refs = array_values( array_unique( $refs ) );
				foreach ( $refs as $ref ) {
					if ( 1 !== preg_match( '/^[a-f0-9]{32}$/', $ref ) ) {
						return self::error( 'invalid_file' );
					}
				}
				if ( array() === $refs ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				if ( count( $refs ) > ( 'signature' === $field['type'] ? 1 : max( 1, (int) ( $field['props']['maxFiles'] ?? 1 ) ) ) ) {
					return self::error( 'too_many_files' );
				}
				return self::ok( $refs );

			case 'address':
				return self::address( $field, $answer );

			case 'repeat':
				return self::repeat( $field, $answer, $locale );

			case 'slider':
				if ( null === $answer || '' === $answer || array() === $answer ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				$props = $field['props'];
				if ( ! empty( $props['range'] ) ) {
					return self::slider_range( $props, $answer );
				}
				if ( ! is_int( $answer ) && ! is_float( $answer ) && ! ( is_string( $answer ) && is_numeric( $answer ) ) ) {
					return self::error( 'invalid_format' );
				}
				$number = (float) $answer;
				if ( $number < (float) $props['min'] || $number > (float) $props['max'] ) {
					return self::error( 'out_of_range' );
				}
				return self::ok( self::whole( $number ) );

			case 'email':
			case 'phone':
			case 'url':
				if ( null !== $answer && ! is_string( $answer ) ) {
					return self::error( 'invalid_format' );
				}
				$text = trim( str_replace( array( "\r", "\n" ), ' ', (string) $answer ) );
				if ( '' === $text ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				if ( strlen( $text ) > 2000 ) {
					return self::error( 'too_long' );
				}
				if ( PhoneNumbers::applies( $field ) ) {
					// With a country picker: checked per country and stored in E.164.
					return PhoneNumbers::validate( $field, $text, $locale );
				}
				return self::typed_text( $field['type'], $field['props'] ?? array(), $text );

			case 'number':
				return self::number( $field, $answer );

			case 'time':
				if ( null === $answer || '' === $answer ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				if ( ! is_string( $answer ) || 1 !== preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', $answer ) ) {
					return self::error( 'invalid_time' );
				}
				$props = $field['props'] ?? array();
				if ( ( isset( $props['min'] ) && $answer < $props['min'] ) || ( isset( $props['max'] ) && $answer > $props['max'] ) ) {
					return self::error( 'out_of_range' );
				}
				return self::ok( $answer );

			case 'booking':
				// A start time in UTC and one of the type's durations; whether it is free is
				// checked when booking (Application\Bookings).
				if ( null === $answer || '' === $answer || array() === $answer ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				if ( ! is_array( $answer ) || ! is_string( $answer['start'] ?? null ) || 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/', $answer['start'] ) || ! is_int( $answer['duration'] ?? null ) || $answer['duration'] < 5 || $answer['duration'] > 720 ) {
					return self::error( 'invalid_booking' );
				}
				return self::ok(
					array(
						'start'    => $answer['start'],
						'duration' => $answer['duration'],
					)
				);

			case 'rating':
				if ( null === $answer || '' === $answer ) {
					return $required ? self::error( 'required' ) : self::ok( null );
				}
				if ( ! is_int( $answer ) && ! ( is_string( $answer ) && 1 === preg_match( '/^\d{1,2}$/', $answer ) ) ) {
					return self::error( 'invalid_format' );
				}
				$props = $field['props'] ?? array();
				$value = (int) $answer;
				if ( $value < (int) ( $props['min'] ?? 1 ) || $value > (int) ( $props['max'] ?? 5 ) ) {
					return self::error( 'out_of_range' );
				}
				return self::ok( $value );
		}
		return self::error( 'unsupported' );
	}

	/**
	 * Repeat group: a list of items, each an object of sub-field id to answer. Items left empty are
	 * dropped; each sub-field is checked like a field of its own. A required group needs at least
	 * one item and minItems; an optional one may stay empty, or needs minItems as well.
	 *
	 * @param array<string,mixed> $field  Field.
	 * @param mixed               $answer Answer.
	 * @param string              $locale Locale of the entry.
	 * @return array{value:mixed,error:?string}
	 */
	private static function repeat( array $field, $answer, string $locale ): array {
		if ( null === $answer || '' === $answer ) {
			$answer = array();
		}
		if ( ! is_array( $answer ) || ! array_is_list( $answer ) ) {
			return self::error( 'invalid_format' );
		}
		$props  = $field['props'] ?? array();
		$fields = (array) ( $props['fields'] ?? array() );
		$known  = array_flip( array_map( 'strval', array_column( $fields, 'id' ) ) );
		$items  = array();
		foreach ( $answer as $row ) {
			if ( ! is_array( $row ) || array() !== array_diff_key( $row, $known ) ) {
				return self::error( 'invalid_format' );
			}
			if ( ! self::filled( $row ) ) {
				continue;
			}
			$item = array();
			foreach ( $fields as $sub ) {
				$result = self::step_field( $sub, $row[ $sub['id'] ] ?? null, $locale );
				if ( null !== $result['error'] ) {
					return $result;
				}
				if ( null !== $result['value'] ) {
					$item[ $sub['id'] ] = $result['value'];
				}
			}
			$items[] = $item;
		}
		$min = (int) ( $props['minItems'] ?? 0 );
		if ( array() === $items ) {
			return ! empty( $field['required'] ) ? self::error( 'required' ) : self::ok( null );
		}
		if ( count( $items ) < $min ) {
			return self::error( 'too_few_items' );
		}
		if ( count( $items ) > max( 1, (int) ( $props['maxItems'] ?? 1 ) ) ) {
			return self::error( 'too_many_items' );
		}
		return self::ok( $items );
	}

	/**
	 * Whether an item of a repeat group has any answer.
	 *
	 * @param array<mixed> $row Answers by sub-field id.
	 */
	private static function filled( array $row ): bool {
		foreach ( $row as $value ) {
			if ( is_array( $value ) ? array() !== $value : ( null !== $value && '' !== trim( (string) ( is_scalar( $value ) ? $value : '' ) ) ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * E-mail address, phone number or web address of a step field.
	 *
	 * @param string              $type  email, phone or url.
	 * @param array<string,mixed> $props Field props.
	 * @param string              $text  Trimmed, non-empty value.
	 * @return array{value:mixed,error:?string}
	 */
	private static function typed_text( string $type, array $props, string $text ): array {
		if ( 'email' === $type ) {
			return self::check_contact_text( 'email', $props, true, $text );
		}
		if ( 'phone' === $type ) {
			$digits = strlen( (string) preg_replace( '/\D/', '', $text ) );
			return 1 === preg_match( '/^\+?[\d\s().\/-]+$/', $text ) && $digits >= 7 && $digits <= 20 ? self::ok( $text ) : self::error( 'invalid_phone' );
		}
		if ( 1 !== preg_match( '#^[a-z][a-z0-9+.-]*://#i', $text ) ) {
			$text = 'https://' . $text;
		}
		// This class runs without WordPress in unit tests; PHP 8 parses URLs the same way.
		$scheme = strtolower( (string) parse_url( $text, PHP_URL_SCHEME ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url
		$host   = (string) parse_url( $text, PHP_URL_HOST ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url
		if ( ! in_array( $scheme, array( 'http', 'https' ), true ) || false === filter_var( $text, FILTER_VALIDATE_URL ) || ! str_contains( $host, '.' ) ) {
			return self::error( 'invalid_url' );
		}
		return self::ok( $text );
	}

	/**
	 * Number field: a number within min and max; a decimal comma is read as a point.
	 *
	 * @param array<string,mixed> $field  Field.
	 * @param mixed               $answer Answer.
	 * @return array{value:mixed,error:?string}
	 */
	private static function number( array $field, $answer ): array {
		if ( null === $answer || '' === $answer ) {
			return ! empty( $field['required'] ) ? self::error( 'required' ) : self::ok( null );
		}
		if ( is_string( $answer ) ) {
			$answer = trim( $answer );
			if ( 1 === preg_match( '/^-?\d+,\d+$/', $answer ) ) {
				$answer = str_replace( ',', '.', $answer );
			}
		}
		if ( ! is_int( $answer ) && ! is_float( $answer ) && ! ( is_string( $answer ) && is_numeric( $answer ) && 1 !== preg_match( '/[^\d.eE+-]/', $answer ) ) ) {
			return self::error( 'invalid_format' );
		}
		$number = (float) $answer;
		$props  = $field['props'] ?? array();
		if ( ! is_finite( $number ) || abs( $number ) >= 1e15 ) {
			return self::error( 'invalid_format' );
		}
		if ( ( isset( $props['min'] ) && $number < (float) $props['min'] ) || ( isset( $props['max'] ) && $number > (float) $props['max'] ) ) {
			return self::error( 'out_of_range' );
		}
		return self::ok( floor( $number ) === $number ? (int) $number : $number );
	}

	/**
	 * Validates the value of a contact field.
	 *
	 * @param array<string,mixed> $field  Contact field.
	 * @param mixed               $answer Submitted value; null when missing.
	 * @param string              $locale Locale of the entry: the country of national phone numbers.
	 * @return array{value:mixed,error:?string}
	 */
	public static function contact_field( array $field, $answer, string $locale = '' ): array {
		$required = ! empty( $field['required'] );
		$props    = $field['props'] ?? array();
		switch ( $field['type'] ) {
			case 'html':
				return self::ok( null );

			case 'captcha':
				// Answer of the reCAPTCHA widget; SubmitEntry has it checked by Google and never stores it.
				if ( ! is_string( $answer ) || '' === $answer || strlen( $answer ) > 4000 ) {
					return self::error( 'required' );
				}
				return self::ok( $answer );

			case 'consent':
			case 'checkbox':
				$checked = true === $answer || 'true' === $answer || '1' === $answer || 1 === $answer;
				return $required && ! $checked ? self::error( 'required' ) : self::ok( $checked );

			case 'select':
				if ( null === $answer || '' === $answer ) {
					return $required ? self::error( 'required' ) : self::ok( '' );
				}
				$ids = array_column( (array) ( $props['options'] ?? array() ), 'id' );
				return is_string( $answer ) && in_array( $answer, $ids, true ) ? self::ok( $answer ) : self::error( 'invalid_option' );

			case 'textarea':
				if ( null !== $answer && ! is_string( $answer ) ) {
					return self::error( 'invalid_format' );
				}
				$text = trim( str_replace( array( "\r\n", "\r" ), "\n", (string) $answer ) );
				if ( '' === $text ) {
					return $required ? self::error( 'required' ) : self::ok( '' );
				}
				$length = mb_strlen( $text, 'UTF-8' );
				return $length > self::MAX_TEXT || ( ! empty( $props['maxLength'] ) && $length > (int) $props['maxLength'] ) ? self::error( 'too_long' ) : self::ok( $text );

			case 'salutation':
				if ( null === $answer || '' === $answer ) {
					return $required ? self::error( 'required' ) : self::ok( '' );
				}
				$allowed = array_filter( (array) ( $props['allow'] ?? array() ) );
				if ( ! is_string( $answer ) || ! isset( self::SALUTATIONS[ $answer ] ) || ! isset( $allowed[ $answer ] ) ) {
					return self::error( 'invalid_option' );
				}
				return self::ok( self::SALUTATIONS[ $answer ] );

			case 'name':
			case 'email':
			case 'phone':
			case 'phone_verification':
			case 'text':
				if ( null !== $answer && ! is_string( $answer ) ) {
					return self::error( 'invalid_format' );
				}
				$text = trim( str_replace( array( "\r", "\n" ), ' ', (string) $answer ) );
				if ( '' === $text ) {
					return $required ? self::error( 'required' ) : self::ok( '' );
				}
				if ( mb_strlen( $text, 'UTF-8' ) > self::MAX_TEXT ) {
					return self::error( 'too_long' );
				}
				if ( PhoneNumbers::applies( $field ) ) {
					// With a country picker or a confirmation by text message: per country, in E.164.
					return PhoneNumbers::validate( $field, $text, $locale );
				}
				return self::check_contact_text( $field['type'], $props, $required, $text );
		}
		return self::error( 'unsupported' );
	}

	/**
	 * Type rules of the text-like contact fields.
	 *
	 * @param string              $type     Field type.
	 * @param array<string,mixed> $props    Field props.
	 * @param bool                $required Required.
	 * @param string              $text     Trimmed, non-empty value.
	 * @return array{value:mixed,error:?string}
	 */
	private static function check_contact_text( string $type, array $props, bool $required, string $text ): array {
		if ( 'email' === $type ) {
			if ( false === filter_var( $text, FILTER_VALIDATE_EMAIL ) ) {
				return self::error( 'invalid_email' );
			}
			$domain = strtolower( substr( (string) strrchr( $text, '@' ), 1 ) );
			if ( ! empty( $props['b2bOnly'] ) && in_array( $domain, self::FREEMAIL, true ) ) {
				return self::error( 'business_email_required' );
			}
		}
		if ( 'phone' === $type && $required ) {
			// 3.x counted the digits only for required phone fields.
			$digits = strlen( (string) preg_replace( '/\D/', '', $text ) );
			if ( $digits < 7 || $digits > 20 ) {
				return self::error( 'invalid_phone' );
			}
		}
		if ( 'text' === $type ) {
			$length = mb_strlen( $text, 'UTF-8' );
			if ( ( isset( $props['minLength'] ) && $length < (int) $props['minLength'] ) || ( isset( $props['maxLength'] ) && $props['maxLength'] > 0 && $length > (int) $props['maxLength'] ) ) {
				return self::error( 'invalid_length' );
			}
			if ( 'number' === ( $props['inputType'] ?? 'text' ) && null === JsNumber::parse_float( $text ) ) {
				return self::error( 'invalid_format' );
			}
			$mask = (string) ( $props['mask'] ?? '' );
			if ( InputMask::supported( $mask ) && ! InputMask::matches( $mask, $text ) ) {
				return self::error( 'invalid_format' );
			}
			if ( isset( $props['pattern'] ) && '' !== trim( (string) $props['pattern'] ) ) {
				// Same semantics as the HTML pattern attribute; a broken pattern fails open as in 3.x.
				$result = @preg_match( '/^(?:' . str_replace( '/', '\/', (string) $props['pattern'] ) . ')$/u', $text ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- admin-authored pattern, checked at save time.
				if ( 0 === $result ) {
					return self::error( 'invalid_format' );
				}
			}
		}
		return self::ok( $text );
	}

	/**
	 * Address field: one line ("address") or street, number, ZIP code, city and country, as the
	 * field shows them. The value is the text 3.x stored: "Street 1, 12345 City, Country".
	 *
	 * @param array<string,mixed> $field  Address field.
	 * @param mixed               $answer Submitted parts; null when missing.
	 * @return array{value:mixed,error:?string}
	 */
	private static function address( array $field, $answer ): array {
		$props = $field['props'] ?? array();
		$keys  = ! empty( $props['combined'] ) ? array( 'address' ) : array_merge( array( 'street', 'number', 'zip', 'city' ), ! empty( $props['showCountry'] ) ? array( 'country' ) : array() );
		if ( null !== $answer && ! is_array( $answer ) ) {
			return self::error( 'invalid_format' );
		}
		$parts = array();
		foreach ( $keys as $key ) {
			$part = $answer[ $key ] ?? '';
			if ( ! is_string( $part ) ) {
				return self::error( 'invalid_format' );
			}
			$part = trim( str_replace( array( "\r", "\n" ), ' ', $part ) );
			if ( mb_strlen( $part, 'UTF-8' ) > 200 ) {
				return self::error( 'too_long' );
			}
			$parts[ $key ] = $part;
		}
		if ( '' === implode( '', $parts ) ) {
			return ! empty( $field['required'] ) ? self::error( 'required' ) : self::ok( null );
		}
		if ( ! empty( $field['required'] ) && in_array( '', $parts, true ) ) {
			return self::error( 'incomplete_address' );
		}
		if ( isset( $parts['address'] ) ) {
			return self::ok( $parts['address'] );
		}
		$lines = array(
			trim( $parts['street'] . ' ' . $parts['number'] ),
			trim( $parts['zip'] . ' ' . $parts['city'] ),
			$parts['country'] ?? '',
		);
		return self::ok( implode( ', ', array_filter( $lines, static fn( string $line ): bool => '' !== $line ) ) );
	}

	/**
	 * Whether a text is a valid date in a format of dd, mm and yy (four-digit year) with separators.
	 *
	 * @param string $text   Text.
	 * @param string $format Format.
	 */
	public static function is_date( string $text, string $format ): bool {
		$parts = preg_split( '/(dd|mm|yy)/', $format, -1, PREG_SPLIT_DELIM_CAPTURE );
		$regex = '';
		$order = array();
		foreach ( (array) $parts as $part ) {
			if ( 'dd' === $part || 'mm' === $part ) {
				$regex  .= '(\d{1,2})';
				$order[] = $part;
			} elseif ( 'yy' === $part ) {
				$regex  .= '(\d{4})';
				$order[] = $part;
			} else {
				$regex .= preg_quote( $part, '/' );
			}
		}
		if ( 3 !== count( array_unique( $order ) ) || 1 !== preg_match( '/^' . $regex . '$/', $text, $m ) ) {
			return false;
		}
		$values = array_combine( $order, array_map( 'intval', array_slice( $m, 1 ) ) );
		return checkdate( $values['mm'], $values['dd'], $values['yy'] );
	}

	/**
	 * Separator of the two values of a period or range: dates, and the numbers of a range slider in texts.
	 */
	public const RANGE_SEPARATOR = ' – ';

	/**
	 * A date, or a period of two dates, in the field's format and within its limits. Today is the
	 * site's today; a day either way is allowed for visitors in other time zones.
	 *
	 * @param array<string,mixed> $props Props of the date field.
	 * @param string              $text  Answer.
	 * @return array{value:mixed,error:?string}
	 */
	private static function date( array $props, string $text ): array {
		$format = (string) ( $props['format'] ?? 'dd.mm.yy' );
		$parts  = ! empty( $props['range'] ) ? explode( self::RANGE_SEPARATOR, $text ) : array( $text );
		if ( ! empty( $props['range'] ) && 2 !== count( $parts ) ) {
			return self::error( 'invalid_date' );
		}
		$earliest = isset( $props['min'] ) ? (string) $props['min'] : '';
		$latest   = isset( $props['max'] ) ? (string) $props['max'] : '';
		if ( 'future' === ( $props['allow'] ?? '' ) ) {
			$earliest = max( $earliest, current_datetime()->modify( '-1 day' )->format( 'Y-m-d' ) );
		} elseif ( 'past' === ( $props['allow'] ?? '' ) ) {
			$day    = current_datetime()->modify( '+1 day' )->format( 'Y-m-d' );
			$latest = '' === $latest ? $day : min( $latest, $day );
		}
		$iso = array();
		foreach ( $parts as $part ) {
			$part = trim( $part );
			if ( ! self::is_date( $part, $format ) ) {
				return self::error( 'invalid_date' );
			}
			$date = self::iso_date( $part, $format );
			if ( ( '' !== $earliest && $date < $earliest ) || ( '' !== $latest && $date > $latest ) ) {
				return self::error( 'date_out_of_range' );
			}
			$iso[] = $date;
		}
		if ( 2 === count( $iso ) && $iso[1] < $iso[0] ) {
			return self::error( 'invalid_range' );
		}
		return self::ok( implode( self::RANGE_SEPARATOR, array_map( 'trim', $parts ) ) );
	}

	/**
	 * The ISO date (YYYY-MM-DD) of a date in the field's format; is_date() must hold.
	 *
	 * @param string $text   Date.
	 * @param string $format Format with dd, mm, yy.
	 */
	public static function iso_date( string $text, string $format ): string {
		preg_match_all( '/dd|mm|yy/', $format, $order );
		preg_match_all( '/\d+/', $text, $numbers );
		$values = array_combine( $order[0], array_map( 'intval', array_slice( $numbers[0], 0, 3 ) ) );
		return sprintf( '%04d-%02d-%02d', $values['yy'], $values['mm'], $values['dd'] );
	}

	/**
	 * Two numbers of a range slider within its limits, the smaller first.
	 *
	 * @param array<string,mixed> $props  Props of the slider.
	 * @param mixed               $answer Answer.
	 * @return array{value:mixed,error:?string}
	 */
	private static function slider_range( array $props, $answer ): array {
		if ( ! is_array( $answer ) || 2 !== count( $answer ) || ! array_is_list( $answer ) ) {
			return self::error( 'invalid_format' );
		}
		$out = array();
		foreach ( $answer as $value ) {
			if ( ! is_int( $value ) && ! is_float( $value ) && ! ( is_string( $value ) && is_numeric( $value ) ) ) {
				return self::error( 'invalid_format' );
			}
			$number = (float) $value;
			if ( $number < (float) $props['min'] || $number > (float) $props['max'] ) {
				return self::error( 'out_of_range' );
			}
			$out[] = self::whole( $number );
		}
		return $out[0] > $out[1] ? self::error( 'invalid_range' ) : self::ok( $out );
	}

	/**
	 * Whole numbers as int, like JSON numbers in the browser.
	 *
	 * @param float $number Number.
	 * @return int|float
	 */
	private static function whole( float $number ) {
		return floor( $number ) === $number && abs( $number ) < 1e15 ? (int) $number : $number;
	}

	/**
	 * A list of strings, or null when the value has another shape.
	 *
	 * @param mixed $value Value.
	 * @return string[]|null
	 */
	private static function string_list( $value ): ?array {
		if ( null === $value ) {
			return array();
		}
		if ( is_string( $value ) ) {
			return '' === $value ? array() : array( $value );
		}
		if ( ! is_array( $value ) || ! array_is_list( $value ) ) {
			return null;
		}
		foreach ( $value as $item ) {
			if ( ! is_string( $item ) ) {
				return null;
			}
		}
		return $value;
	}

	/**
	 * A valid value.
	 *
	 * @param mixed $value Value.
	 * @return array{value:mixed,error:?string}
	 */
	private static function ok( $value ): array {
		return array(
			'value' => $value,
			'error' => null,
		);
	}

	/**
	 * An invalid value.
	 *
	 * @param string $code Error code.
	 * @return array{value:mixed,error:?string}
	 */
	private static function error( string $code ): array {
		return array(
			'value' => null,
			'error' => $code,
		);
	}
}
