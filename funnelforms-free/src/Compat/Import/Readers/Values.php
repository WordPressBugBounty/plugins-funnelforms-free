<?php
/**
 * Helpers for the readers.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

defined( 'ABSPATH' ) || exit;

/**
 * Normalises what other plugins store in many shapes.
 */
final class Values {

	/**
	 * A flag stored as "1", 1, true, "true", "on", "yes" or "checked".
	 *
	 * @param mixed $value Value.
	 */
	public static function flag( $value ): bool {
		if ( is_bool( $value ) ) {
			return $value;
		}
		return in_array( strtolower( trim( is_scalar( $value ) ? (string) $value : '' ) ), array( '1', 'true', 'on', 'yes', 'checked' ), true );
	}

	/**
	 * Text of a scalar, else empty.
	 *
	 * @param mixed $value Value.
	 */
	public static function str( $value ): string {
		return is_scalar( $value ) ? (string) $value : '';
	}

	/**
	 * A PHP array that JSON wrote as list or object, as list (in the order of the keys).
	 *
	 * @param mixed $value Value.
	 * @return array<int,mixed>
	 */
	public static function items( $value ): array {
		return is_array( $value ) ? array_values( $value ) : array();
	}

	/**
	 * A decoded JSON value, or null.
	 *
	 * @param string $json JSON.
	 * @return mixed
	 */
	public static function json( string $json ) {
		$json = (string) preg_replace( '/^\xEF\xBB\xBF/', '', trim( $json ) );
		return json_decode( $json, true );
	}

	/**
	 * Stored PHP-serialized data, without creating objects. Strings that are not serialized come
	 * back as they are.
	 *
	 * @param mixed $value Value.
	 * @return mixed
	 */
	public static function unserialized( $value ) {
		if ( ! is_string( $value ) || ! preg_match( '/^(a|s|i|d|b):[0-9:]/', $value ) ) {
			return $value;
		}
		$data = @unserialize( $value, array( 'allowed_classes' => false ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.PHP.DiscouragedPHPFunctions.serialize_unserialize -- data of another plugin; no classes are created.
		return false === $data && 'b:0;' !== $value ? $value : $data;
	}

	/**
	 * Replaces tokens of another plugin by the builder's: a callback gets each match and returns
	 * the replacement, or null for an unknown tag, which is removed and counted in $unknown.
	 *
	 * @param string   $text    Text.
	 * @param string   $pattern Pattern of a tag.
	 * @param callable $map     Replacement of a match: string, or null.
	 * @param string[] $unknown Unknown tags (added to).
	 */
	public static function tokens( string $text, string $pattern, callable $map, array &$unknown ): string {
		return (string) preg_replace_callback(
			$pattern,
			static function ( array $m ) use ( $map, &$unknown ): string {
				$out = $map( $m );
				if ( null === $out ) {
					$unknown[] = $m[0];
					return '';
				}
				return $out;
			},
			$text
		);
	}

	/**
	 * An XML document without network access or entity expansion, or null.
	 *
	 * @param string $xml XML.
	 */
	public static function xml( string $xml ): ?\SimpleXMLElement {
		if ( ! function_exists( 'simplexml_load_string' ) || false === strpos( $xml, '<' ) ) {
			return null;
		}
		$previous = libxml_use_internal_errors( true );
		$doc      = simplexml_load_string( trim( (string) preg_replace( '/^\xEF\xBB\xBF/', '', $xml ) ), \SimpleXMLElement::class, LIBXML_NONET | LIBXML_NOCDATA | LIBXML_PARSEHUGE );
		libxml_clear_errors();
		libxml_use_internal_errors( $previous );
		return false === $doc ? null : $doc;
	}

	/**
	 * Posts of one type in a WordPress export (WXR): title, id, content and meta.
	 *
	 * @param \SimpleXMLElement $doc  Export.
	 * @param string            $type Post type.
	 * @return array<int,array{id:string,title:string,content:string,meta:array<string,mixed>}>
	 */
	public static function wxr_posts( \SimpleXMLElement $doc, string $type ): array {
		$out = array();
		$ns  = $doc->getNamespaces( true );
		foreach ( $doc->channel->item ?? array() as $item ) {
			$wp = $item->children( $ns['wp'] ?? 'http://wordpress.org/export/1.2/' );
			if ( (string) $wp->post_type !== $type ) {
				continue;
			}
			$meta = array();
			foreach ( $wp->postmeta as $row ) {
				$meta[ (string) $row->meta_key ] = self::unserialized( (string) $row->meta_value );
			}
			$content = isset( $ns['content'] ) ? (string) $item->children( $ns['content'] )->encoded : '';
			$out[]   = array(
				'id'      => (string) $wp->post_id,
				'title'   => (string) $item->title,
				'content' => $content,
				'meta'    => $meta,
			);
		}
		return $out;
	}

	/**
	 * Whether a table of another plugin exists (SHOW TABLES misses temporary tables).
	 *
	 * @param string $table Table with prefix.
	 */
	public static function table_exists( string $table ): bool {
		global $wpdb;
		$quiet = $wpdb->suppress_errors( true );
		$found = false !== $wpdb->query( $wpdb->prepare( 'SELECT 1 FROM %i LIMIT 0', $table ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$wpdb->suppress_errors( $quiet );
		return $found;
	}
}
