<?php
/**
 * Recognises an export of Funnelforms 4 (the online version) and lists its forms.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Ff4;

defined( 'ABSPATH' ) || exit;

/**
 * The export of Funnelforms 4 (docs/import/funnelforms-4.md): JSON with `format`
 * "funnelforms4-export", `version` 1 and `forms`, a list of form snapshots. A snapshot is what
 * the SaaS stores for its history (RPC create_form_snapshot, `version` 1): the rows of `form`,
 * `fields`, `settings`, `styles`, `logic_nodes`, `logic_edges`, `logic_actions` and
 * `appointment_bookings`, plus the row of `notifications`. A single snapshot without the
 * wrapper (as stored in form_snapshots.snapshot_data) is read as well.
 *
 * Pure PHP without WordPress.
 */
final class Ff4Export {

	public const FORMAT = 'funnelforms4-export';

	public const VERSION = 1;

	/** Most forms one file may hold. */
	public const MAX_FORMS = 200;

	/**
	 * Whether decoded JSON is an export (or a snapshot) of Funnelforms 4.
	 *
	 * @param mixed $data Decoded JSON (objects or arrays).
	 */
	public static function recognizes( $data ): bool {
		$data = self::arrays( $data );
		if ( ! is_array( $data ) ) {
			return false;
		}
		if ( self::FORMAT === ( $data['format'] ?? null ) ) {
			return true;
		}
		return self::is_snapshot( $data );
	}

	/**
	 * The forms of an export: each a snapshot as arrays. Null when the data is no export of a
	 * version this plugin reads.
	 *
	 * @param mixed $data Decoded JSON (objects or arrays).
	 * @return array<int,array<string,mixed>>|null
	 */
	public static function forms( $data ): ?array {
		$data = self::arrays( $data );
		if ( ! is_array( $data ) ) {
			return null;
		}
		if ( self::is_snapshot( $data ) ) {
			return array( $data );
		}
		if ( self::FORMAT !== ( $data['format'] ?? null ) || self::VERSION !== (int) ( $data['version'] ?? 0 ) || ! is_array( $data['forms'] ?? null ) ) {
			return null;
		}
		$out = array();
		foreach ( $data['forms'] as $form ) {
			if ( is_array( $form ) && self::is_snapshot( $form ) ) {
				$out[] = $form;
			}
			if ( count( $out ) >= self::MAX_FORMS ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * Whether an array is one form snapshot: a form row with an id and the list of fields.
	 *
	 * @param array<string,mixed> $data Data.
	 */
	private static function is_snapshot( array $data ): bool {
		return is_array( $data['form'] ?? null ) && isset( $data['form']['id'] ) && is_array( $data['fields'] ?? null ) && array_key_exists( 'logic_nodes', $data );
	}

	/**
	 * Objects as arrays.
	 *
	 * @param mixed $data Data.
	 * @return mixed
	 */
	private static function arrays( $data ) {
		return is_object( $data ) ? json_decode( (string) json_encode( $data ), true ) : $data; // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- runs without WordPress in unit tests.
	}
}
