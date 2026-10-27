<?php
/**
 * Tracking code of 3.x steps and contact forms.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

defined( 'ABSPATH' ) || exit;

/**
 * 3.x ran the code site owners attached to steps and the contact form (conversion pixels, gtag
 * calls) in the visitor's browser. The new renderer runs it only after an administrator who may
 * publish unfiltered HTML allowed it for the site; until then such forms stay on the 3.x renderer.
 */
final class TrackingCode {

	public const OPTION = 'funnelforms_allow_tracking_code';

	/**
	 * Whether the site allows tracking code.
	 */
	public static function allowed(): bool {
		return '1' === (string) get_option( self::OPTION, '0' );
	}

	/**
	 * Whether the document has tracking code.
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public static function used( array $document ): bool {
		foreach ( $document['nodes'] ?? array() as $node ) {
			if ( self::has( $node ) ) {
				return true;
			}
			foreach ( $node['fields'] ?? array() as $field ) {
				if ( self::has( $field ) ) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Adds the tracking code to the public document when the site allows it.
	 *
	 * @param array<string,mixed> $shown    Public document (same node and field order).
	 * @param array<string,mixed> $document Form document.
	 * @return array<string,mixed>
	 */
	public static function add( array $shown, array $document ): array {
		if ( ! self::allowed() ) {
			return $shown;
		}
		$code = array();
		foreach ( $document['nodes'] as $node ) {
			if ( self::has( $node ) ) {
				$code[ $node['id'] ] = $node['tracking'];
			}
			foreach ( $node['fields'] ?? array() as $field ) {
				if ( self::has( $field ) ) {
					$code[ $field['id'] ] = $field['tracking'];
				}
			}
		}
		foreach ( $shown['nodes'] as $n => $node ) {
			if ( isset( $code[ $node['id'] ] ) ) {
				$shown['nodes'][ $n ]['tracking'] = $code[ $node['id'] ];
			}
			foreach ( $node['fields'] ?? array() as $f => $field ) {
				if ( isset( $code[ $field['id'] ] ) ) {
					$shown['nodes'][ $n ]['fields'][ $f ]['tracking'] = $code[ $field['id'] ];
				}
			}
		}
		return $shown;
	}

	/**
	 * Saves the site setting; only users who may publish unfiltered HTML can turn it on.
	 *
	 * @param mixed $value Submitted value.
	 */
	public static function sanitize( $value ): string {
		if ( ! current_user_can( 'manage_options' ) || ! current_user_can( 'unfiltered_html' ) ) {
			return self::allowed() ? '1' : '0';
		}
		return empty( $value ) ? '0' : '1';
	}

	/**
	 * Whether a node or field carries tracking code.
	 *
	 * @param array<string,mixed> $item Node or field.
	 */
	private static function has( array $item ): bool {
		foreach ( (array) ( $item['tracking'] ?? array() ) as $code ) {
			if ( is_string( $code ) && '' !== trim( $code ) ) {
				return true;
			}
		}
		return false;
	}
}
