<?php
/**
 * Files uploaded through the new runtime.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Repository;

use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom table of this plugin; rows change with every upload.

/**
 * A file is "pending" from its upload until the entry is submitted, then "attached" to the entry.
 * The browser only knows a random reference; the table keeps its SHA-256 hash.
 */
final class FileRepository {

	public const PENDING  = 'pending';
	public const ATTACHED = 'attached';

	/**
	 * Hash of an upload reference.
	 *
	 * @param string $ref Reference handed to the browser.
	 */
	public static function hash( string $ref ): string {
		return hash( 'sha256', $ref );
	}

	/**
	 * Stores a pending upload.
	 *
	 * @param array<string,mixed> $row form_id, field_id, ref_hash, path, original_name, mime_type, size, visibility.
	 * @return int File ID, 0 on failure.
	 */
	public function add_pending( array $row ): int {
		global $wpdb;
		$ok = $wpdb->insert(
			Schema::table( 'entry_files' ),
			$row + array(
				'entry_id'   => 0,
				'status'     => self::PENDING,
				'created_at' => gmdate( 'Y-m-d H:i:s' ),
			)
		);
		return false === $ok ? 0 : (int) $wpdb->insert_id;
	}

	/**
	 * Pending uploads of one field by their references, in the given order; unknown ones are left out.
	 *
	 * @param int      $form_id  Form ID.
	 * @param string   $field_id Field id.
	 * @param string[] $refs     References.
	 * @param string   $since    Oldest creation time accepted (UTC, Y-m-d H:i:s).
	 * @return array<int,array<string,mixed>>
	 */
	public function pending( int $form_id, string $field_id, array $refs, string $since ): array {
		global $wpdb;
		$out = array();
		foreach ( $refs as $ref ) {
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE ref_hash = %s AND status = %s AND form_id = %d AND field_id = %s AND created_at >= %s',
					Schema::table( 'entry_files' ),
					self::hash( $ref ),
					self::PENDING,
					$form_id,
					$field_id,
					$since
				),
				ARRAY_A
			);
			if ( is_array( $row ) ) {
				$out[] = $row;
			}
		}
		return $out;
	}

	/**
	 * Number of pending uploads of a form created since a time, to cap uploads per form.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $since   UTC time.
	 */
	public function count_pending( int $form_id, string $since ): int {
		global $wpdb;
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE status = %s AND form_id = %d AND created_at >= %s', Schema::table( 'entry_files' ), self::PENDING, $form_id, $since ) );
	}

	/**
	 * Attaches pending uploads to an entry; the reference stops working.
	 *
	 * @param int[]   $ids        File IDs.
	 * @param int     $entry_id   Entry ID.
	 * @param ?string $expires_at End of the public download link (UTC), null for none.
	 */
	public function attach( array $ids, int $entry_id, ?string $expires_at ): void {
		global $wpdb;
		foreach ( $ids as $id ) {
			$wpdb->update(
				Schema::table( 'entry_files' ),
				array(
					'entry_id'   => $entry_id,
					'status'     => self::ATTACHED,
					'ref_hash'   => null,
					'expires_at' => $expires_at,
				),
				array(
					'id'     => (int) $id,
					'status' => self::PENDING,
				)
			);
		}
	}

	/**
	 * A file row.
	 *
	 * @param int $id File ID.
	 * @return array<string,mixed>|null
	 */
	public function find( int $id ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', Schema::table( 'entry_files' ), $id ), ARRAY_A );
		return is_array( $row ) ? $row : null;
	}

	/**
	 * Attached files of an entry.
	 *
	 * @param int $entry_id Entry ID.
	 * @return array<int,array<string,mixed>>
	 */
	public function for_entry( int $entry_id ): array {
		global $wpdb;
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE entry_id = %d AND status = %s ORDER BY id ASC', Schema::table( 'entry_files' ), $entry_id, self::ATTACHED ), ARRAY_A );
	}

	/**
	 * Pending uploads older than a time (never submitted).
	 *
	 * @param string $before UTC time.
	 * @param int    $limit  Rows per batch.
	 * @return array<int,array<string,mixed>>
	 */
	public function abandoned( string $before, int $limit ): array {
		global $wpdb;
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE status = %s AND created_at < %s ORDER BY id ASC LIMIT %d', Schema::table( 'entry_files' ), self::PENDING, $before, $limit ), ARRAY_A );
	}

	/**
	 * Deletes a file row.
	 *
	 * @param int $id File ID.
	 */
	public function delete( int $id ): void {
		global $wpdb;
		$wpdb->delete( Schema::table( 'entry_files' ), array( 'id' => $id ) );
	}
}
