<?php
/**
 * Decoder for the post_content format of Funnelforms 3.x.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Legacy;

defined( 'ABSPATH' ) || exit;

/**
 * Decodes af2_* post_content the same way 3.8.10 reads it.
 *
 * 3.x stores urlencode( serialize( array ) ). Versions before the 2.x migration stored JSON.
 * Objects are never instantiated (allowed_classes = false). Like af2_get_post_content(), slashes
 * are stripped recursively after decoding so the migrated text matches what 3.x displays.
 */
final class LegacyCodec {

	/**
	 * Notes about the last decode (e.g. a repaired serialization).
	 *
	 * @var string[]
	 */
	private array $notes = array();

	/**
	 * Decodes post_content into an array.
	 *
	 * @param string $post_content Raw post_content.
	 * @return array<mixed>|null Null when the content cannot be decoded.
	 */
	public function decode( string $post_content ): ?array {
		$this->notes = array();
		$raw         = trim( $post_content );
		if ( '' === $raw ) {
			return null;
		}

		if ( '{' === $raw[0] || '[' === $raw[0] ) {
			$json = json_decode( $raw, true );
			if ( is_array( $json ) ) {
				$this->notes[] = 'json_format';
				return self::strip_slashes_deep( $json );
			}
		}

		$serialized = urldecode( $raw );
		$value      = self::unserialize( $serialized );

		if ( null === $value ) {
			$repaired = self::repair_string_lengths( $serialized );
			if ( null !== $repaired ) {
				$value = self::unserialize( $repaired );
				if ( null !== $value ) {
					$this->notes[] = 'repaired_serialization';
				}
			}
		}

		return null === $value ? null : self::strip_slashes_deep( $value );
	}

	/**
	 * Notes about the last decode.
	 *
	 * @return string[]
	 */
	public function notes(): array {
		return $this->notes;
	}

	/**
	 * Unserializes without instantiating objects.
	 *
	 * @param string $data Serialized data.
	 * @return array<mixed>|null
	 */
	private static function unserialize( string $data ): ?array {
		if ( ! preg_match( '/^a:\d+:\{/', $data ) ) {
			return null;
		}
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_unserialize, WordPress.PHP.NoSilencedErrors.Discouraged -- Reading the 3.x storage format; objects are disabled and failures are expected for damaged rows.
		$value = @unserialize( $data, array( 'allowed_classes' => false ) );
		return is_array( $value ) ? $value : null;
	}

	/**
	 * Recomputes s:N:"…"; lengths that no longer match the byte length.
	 *
	 * Happens when a database or export tool changed the character encoding after 3.x saved the
	 * data. The scan walks the structure token by token: for each string it first trusts the
	 * declared length and only searches for the closing quote when that length is wrong.
	 *
	 * @param string $data Serialized data.
	 */
	public static function repair_string_lengths( string $data ): ?string {
		$out    = '';
		$offset = 0;
		$length = strlen( $data );

		while ( $offset < $length ) {
			if ( ! preg_match( '/s:(\d+):"/A', $data, $m, 0, $offset ) ) {
				$out .= $data[ $offset ];
				++$offset;
				continue;
			}

			$start    = $offset + strlen( $m[0] );
			$declared = (int) $m[1];

			if ( substr( $data, $start + $declared, 2 ) === '";' && self::is_value_boundary( $data, $start + $declared + 2 ) ) {
				$end = $start + $declared;
			} else {
				$end = self::find_string_end( $data, $start );
				if ( null === $end ) {
					return null;
				}
			}

			$value  = substr( $data, $start, $end - $start );
			$out   .= 's:' . strlen( $value ) . ':"' . $value . '";';
			$offset = $end + 2;
		}

		return $out;
	}

	/**
	 * Finds the closing quote of a string whose declared length is wrong.
	 *
	 * @param string $data  Serialized data.
	 * @param int    $start Offset of the first character of the string.
	 */
	private static function find_string_end( string $data, int $start ): ?int {
		$pos = $start;
		while ( false !== ( $pos = strpos( $data, '";', $pos ) ) ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.FoundInWhileCondition
			if ( self::is_value_boundary( $data, $pos + 2 ) ) {
				return $pos;
			}
			++$pos;
		}
		return null;
	}

	/**
	 * Whether a serialized token (or the end of an array) starts at $pos.
	 *
	 * @param string $data Serialized data.
	 * @param int    $pos  Offset.
	 */
	private static function is_value_boundary( string $data, int $pos ): bool {
		if ( $pos >= strlen( $data ) ) {
			return true;
		}
		return '}' === $data[ $pos ] || 1 === preg_match( '/(?:[sibd]:|a:\d+:\{|N;)/A', $data, $unused, 0, $pos );
	}

	/**
	 * Recursive stripslashes, like WordPress' stripslashes_deep().
	 *
	 * @param array<mixed> $value Decoded value.
	 * @return array<mixed>
	 */
	private static function strip_slashes_deep( array $value ): array {
		foreach ( $value as $key => $item ) {
			if ( is_array( $item ) ) {
				$value[ $key ] = self::strip_slashes_deep( $item );
			} elseif ( is_string( $item ) ) {
				$value[ $key ] = stripslashes( $item );
			}
		}
		return $value;
	}
}
