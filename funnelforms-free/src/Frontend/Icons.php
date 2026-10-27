<?php
/**
 * Lucide icons (ISC license) of answers and contact fields.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

defined( 'ABSPATH' ) || exit;

/**
 * The set lies in assets/icons/lucide.json (tools/icons.py writes it from the lucide-static
 * package). Documents store only the name of an icon: answers as media of kind "lucide", contact
 * fields as props.icon "lucide:<name>". A form gets the icons it uses with its configuration, as
 * SVG markup built here from the set, so no visitor loads the whole set and nothing from the
 * document becomes markup.
 */
final class Icons {

	public const FILE      = 'assets/icons/lucide.json';
	public const PREFIX    = 'lucide:';
	private const SHAPES   = array( 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse' );
	private const GEOMETRY = '/^(d|c[xy]|r[xy]?|[xy][12]?|width|height|points|fill)$/';

	/**
	 * Elements by icon name, once read.
	 *
	 * @var array<string,array<int,array{0:string,1:array<string,string>}>>|null
	 */
	private static ?array $set = null;

	/** Address of the set, for the builder's icon choice. */
	public static function url(): string {
		return add_query_arg( 'ver', FUNNELFORMS_ASSET_VERSION, plugins_url( self::FILE, FUNNELFORMS_PLUGIN_FILE ) );
	}

	/**
	 * The whole set.
	 *
	 * @return array<string,array<int,array{0:string,1:array<string,string>}>>
	 */
	public static function all(): array {
		if ( null === self::$set ) {
			$path      = dirname( __DIR__, 2 ) . '/' . self::FILE;
			$data      = is_readable( $path ) ? json_decode( (string) file_get_contents( $path ), true ) : null; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file of the plugin.
			self::$set = is_array( $data ) && is_array( $data['icons'] ?? null ) ? $data['icons'] : array();
		}
		return self::$set;
	}

	/**
	 * Names of the icons a document uses.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return array<int,string>
	 */
	public static function names( array $document ): array {
		$names = array();
		foreach ( (array) ( $document['nodes'] ?? array() ) as $node ) {
			foreach ( (array) ( $node['fields'] ?? array() ) as $field ) {
				foreach ( (array) ( $field['options'] ?? array() ) as $option ) {
					if ( 'lucide' === ( $option['media']['kind'] ?? null ) && is_string( $option['media']['value'] ?? null ) ) {
						$names[] = $option['media']['value'];
					}
				}
				$icon = $field['props']['icon'] ?? null;
				if ( 'contact' === ( $node['type'] ?? '' ) && is_string( $icon ) && str_starts_with( $icon, self::PREFIX ) ) {
					$names[] = substr( $icon, strlen( self::PREFIX ) );
				}
			}
		}
		return array_values( array_unique( $names ) );
	}

	/**
	 * SVG markup of the icons a document uses, for the runtime; names the set lacks are left out.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return array<string,string>
	 */
	public static function used( array $document ): array {
		$names = self::names( $document );
		return array() === $names ? array() : array_map( array( self::class, 'svg' ), array_intersect_key( self::all(), array_flip( $names ) ) );
	}

	/**
	 * An icon as SVG in the text colour: only shapes and their geometry, every value escaped.
	 *
	 * @param array<int,mixed> $elements Elements of the icon.
	 */
	public static function svg( array $elements ): string {
		$out = '';
		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) || ! in_array( $element[0] ?? null, self::SHAPES, true ) ) {
				continue;
			}
			$attributes = '';
			foreach ( (array) ( $element[1] ?? array() ) as $name => $value ) {
				if ( is_string( $name ) && preg_match( self::GEOMETRY, $name ) && is_scalar( $value ) ) {
					$attributes .= sprintf( ' %s="%s"', $name, esc_attr( (string) $value ) );
				}
			}
			$out .= '<' . $element[0] . $attributes . '/>';
		}
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' . $out . '</svg>';
	}
}
