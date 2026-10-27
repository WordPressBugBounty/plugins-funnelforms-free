<?php
/**
 * Writes migrated data into the ffx_* tables.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\ConnectionRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom tables of this plugin.

/**
 * Every write is keyed on the legacy post ID (or the connection ref), so running the migration
 * again updates rows instead of duplicating them.
 */
class MigrationStore {

	/**
	 * Item status of a 3.x lead whose copy was deleted on purpose.
	 */
	public const REMOVED = 'removed';

	/**
	 * Encrypts credentials.
	 *
	 * @var SecretBox
	 */
	private SecretBox $box;

	/**
	 * Constructor.
	 *
	 * @param SecretBox $box Encryption for credentials.
	 */
	public function __construct( SecretBox $box ) {
		$this->box = $box;
	}

	/**
	 * Current UTC time for datetime columns.
	 */
	private static function now(): string {
		return gmdate( 'Y-m-d H:i:s' );
	}

	/**
	 * JSON for longtext columns.
	 *
	 * @param mixed $value Value.
	 */
	private static function json( $value ): string {
		return (string) wp_json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	}

	/**
	 * Migration record of a legacy post.
	 *
	 * @param string $type     Legacy post type.
	 * @param int    $legacy_id Legacy post ID.
	 * @return array<string,mixed>|null
	 */
	public function item( string $type, int $legacy_id ): ?array {
		global $wpdb;
		$table = Schema::table( 'migration_items' );
		$row   = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE legacy_type = %s AND legacy_post_id = %d', $table, $type, $legacy_id ), ARRAY_A );
		return is_array( $row ) ? $row : null;
	}

	/**
	 * Records the outcome for one legacy post.
	 *
	 * @param string              $type        Legacy post type.
	 * @param int                 $legacy_id   Legacy post ID.
	 * @param string              $target_type Target table.
	 * @param int|null            $target_id   Target row.
	 * @param string              $status      migrated, verified, needs_review, failed or skipped.
	 * @param int                 $version     Migrator version.
	 * @param string              $hash        Source hash.
	 * @param array<string,mixed> $checks      Verification.
	 * @param string[]            $notes       Notes.
	 */
	public function record( string $type, int $legacy_id, string $target_type, ?int $target_id, string $status, int $version, string $hash, array $checks, array $notes ): void {
		global $wpdb;
		$table  = Schema::table( 'migration_items' );
		$values = array(
			'target_type'      => $target_type,
			'target_id'        => $target_id,
			'status'           => $status,
			'migrator_version' => $version,
			'source_hash'      => $hash,
			'checks'           => self::json( $checks ),
			'notes'            => self::json( array_values( $notes ) ),
			'migrated_at'      => self::now(),
		);
		$id     = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_type = %s AND legacy_post_id = %d', $table, $type, $legacy_id ) );
		if ( null !== $id ) {
			$wpdb->update( $table, $values, array( 'id' => (int) $id ) );
			return;
		}
		$wpdb->insert(
			$table,
			$values + array(
				'legacy_type'    => $type,
				'legacy_post_id' => $legacy_id,
			)
		);
	}

	/**
	 * Marks the copy of a 3.x lead as deleted on purpose (retention or a privacy request), so later
	 * runs do not import the lead again.
	 *
	 * @param int    $legacy_id Legacy lead ID.
	 * @param string $reason    retention or privacy_erasure.
	 */
	public function mark_removed( int $legacy_id, string $reason ): void {
		global $wpdb;
		$wpdb->update(
			Schema::table( 'migration_items' ),
			array(
				'target_id'   => null,
				'status'      => self::REMOVED,
				'notes'       => self::json( array( $reason ) ),
				'migrated_at' => self::now(),
			),
			array(
				'legacy_type'    => LegacyRepository::LEAD,
				'legacy_post_id' => $legacy_id,
			)
		);
	}

	/**
	 * Removes the record of a legacy post.
	 *
	 * @param string $type      Legacy post type.
	 * @param int    $legacy_id Legacy post ID.
	 */
	public function forget( string $type, int $legacy_id ): void {
		global $wpdb;
		$wpdb->delete(
			Schema::table( 'migration_items' ),
			array(
				'legacy_type'    => $type,
				'legacy_post_id' => $legacy_id,
			)
		);
	}

	/**
	 * Legacy IDs recorded for a type.
	 *
	 * @param string $type Legacy post type.
	 * @return int[]
	 */
	public function recorded_ids( string $type ): array {
		global $wpdb;
		$table = Schema::table( 'migration_items' );
		return array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( 'SELECT legacy_post_id FROM %i WHERE legacy_type = %s', $table, $type ) ) );
	}

	/**
	 * Highest legacy ID recorded for a type.
	 *
	 * @param string $type Legacy post type.
	 */
	public function max_recorded_id( string $type ): int {
		global $wpdb;
		$table = Schema::table( 'migration_items' );
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(legacy_post_id) FROM %i WHERE legacy_type = %s', $table, $type ) );
	}

	/**
	 * Number of records per type and status.
	 *
	 * @return array<string,array<string,int>>
	 */
	public function summary(): array {
		global $wpdb;
		$table = Schema::table( 'migration_items' );
		$out   = array();
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT legacy_type, status, COUNT(*) AS n FROM %i GROUP BY legacy_type, status', $table ), ARRAY_A ) as $row ) {
			$out[ $row['legacy_type'] ][ $row['status'] ] = (int) $row['n'];
		}
		return $out;
	}

	/**
	 * Records of one type, problems first, with the form title (for the report).
	 *
	 * @param string $type  Legacy post type.
	 * @param int    $limit Maximum rows.
	 * @return array<int,array<string,mixed>>
	 */
	public function items( string $type, int $limit = 500 ): array {
		global $wpdb;
		$table = Schema::table( 'migration_items' );
		$forms = Schema::table( 'forms' );
		return (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT m.*, f.title FROM %i m LEFT JOIN %i f ON m.target_type = 'form' AND f.id = m.target_id WHERE m.legacy_type = %s ORDER BY FIELD(m.status, 'failed', 'needs_review') DESC, m.legacy_post_id ASC LIMIT %d",
				$table,
				$forms,
				$type,
				$limit
			),
			ARRAY_A
		);
	}

	/**
	 * Stores a connection (credentials encrypted), keyed on its ref.
	 *
	 * @param array{ref:string,type:string,label:string,config:array<string,mixed>,secret:array<string,mixed>} $connection Connection.
	 * @return int Row ID.
	 */
	public function upsert_connection( array $connection ): int {
		return ( new ConnectionRepository( $this->box ) )->save( $connection );
	}

	/**
	 * Stores a migrated form and, when the document changed, a new revision.
	 *
	 * The renderer stays "legacy": the form keeps running on the 3.x code until it is switched.
	 *
	 * @param int                 $legacy_id Legacy form ID.
	 * @param string              $title     Title.
	 * @param string              $locale    Default locale.
	 * @param array<string,mixed> $document  Form document.
	 * @return int Form ID.
	 */
	public function upsert_form( int $legacy_id, string $title, string $locale, array $document ): int {
		global $wpdb;
		$forms     = Schema::table( 'forms' );
		$revisions = Schema::table( 'form_revisions' );
		$now       = self::now();
		$json      = self::json( $document );

		$form = $wpdb->get_row( $wpdb->prepare( 'SELECT id, current_revision_id FROM %i WHERE legacy_post_id = %d', $forms, $legacy_id ), ARRAY_A );
		if ( ! is_array( $form ) ) {
			$wpdb->insert(
				$forms,
				array(
					'uid'            => wp_generate_uuid4(),
					'legacy_post_id' => $legacy_id,
					'title'          => $title,
					'status'         => 'published',
					'schema_version' => 1,
					'locale_default' => $locale,
					'renderer'       => 'legacy',
					'created_at'     => $now,
					'updated_at'     => $now,
				)
			);
			$form = array(
				'id'                  => (int) $wpdb->insert_id,
				'current_revision_id' => null,
			);
		}
		$form_id = (int) $form['id'];

		if ( $this->builder_owned( $legacy_id ) ) {
			return $form_id;
		}
		$current = null === $form['current_revision_id'] ? null : $wpdb->get_var( $wpdb->prepare( 'SELECT document FROM %i WHERE id = %d', $revisions, $form['current_revision_id'] ) );
		$update  = array(
			'title'          => $title,
			'locale_default' => $locale,
			'updated_at'     => $now,
		);
		if ( $current !== $json ) {
			$wpdb->insert(
				$revisions,
				array(
					'form_id'        => $form_id,
					'schema_version' => 1,
					'document'       => $json,
					'author_id'      => 0,
					'note'           => FormRepository::MIGRATION_NOTE,
					'created_at'     => $now,
				)
			);
			$update['current_revision_id'] = (int) $wpdb->insert_id;
		}
		$wpdb->update( $forms, $update, array( 'id' => $form_id ) );
		return $form_id;
	}

	/**
	 * Whether the form imported from a 3.x form was changed in the builder since: then the import
	 * keeps the builder's version and no longer follows changes of the 3.x form.
	 *
	 * @param int $legacy_id 3.x form post ID.
	 */
	public function builder_owned( int $legacy_id ): bool {
		global $wpdb;
		$note = $wpdb->get_var( $wpdb->prepare( 'SELECT r.note FROM %i f JOIN %i r ON r.id = f.current_revision_id WHERE f.legacy_post_id = %d', Schema::table( 'forms' ), Schema::table( 'form_revisions' ), $legacy_id ) );
		return null !== $note && FormRepository::MIGRATION_NOTE !== $note;
	}

	/**
	 * Legacy form ID => ffx_forms.id.
	 *
	 * @return array<int,int>
	 */
	public function form_map(): array {
		global $wpdb;
		$table = Schema::table( 'forms' );
		$map   = array();
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, legacy_post_id FROM %i WHERE legacy_post_id IS NOT NULL', $table ), ARRAY_A ) as $row ) {
			$map[ (int) $row['legacy_post_id'] ] = (int) $row['id'];
		}
		return $map;
	}

	/**
	 * Stores a migrated entry.
	 *
	 * @param array<string,mixed> $row EntryConverter row.
	 * @return int Entry ID.
	 */
	public function upsert_entry( array $row ): int {
		global $wpdb;
		$table  = Schema::table( 'entries' );
		$values = array(
			'form_id'             => $row['form_id'],
			'legacy_form_post_id' => $row['legacy_form_post_id'],
			'status'              => $row['status'],
			'locale'              => $row['locale'],
			'created_at'          => $row['created_at'],
			'completed_at'        => $row['completed_at'],
			'source_url'          => $row['source_url'],
			'utm'                 => self::json( $row['utm'] ),
			'data'                => self::json( $row['data'] ),
			'consent'             => self::json( $row['consent'] ),
			'meta'                => self::json( $row['meta'] ),
		);
		$id     = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_post_id = %d', $table, $row['legacy_post_id'] ) );
		if ( null !== $id ) {
			$wpdb->update( $table, $values, array( 'id' => (int) $id ) );
			return (int) $id;
		}
		$wpdb->insert(
			$table,
			$values + array(
				'uid'            => wp_generate_uuid4(),
				'legacy_post_id' => $row['legacy_post_id'],
				// 3.x had no read state; old leads count as read.
				'is_read'        => 1,
			)
		);
		return (int) $wpdb->insert_id;
	}

	/**
	 * Replaces the file rows of an entry.
	 *
	 * @param int                            $entry_id Entry ID.
	 * @param array<int,array<string,mixed>> $files    Rows without entry_id.
	 */
	public function replace_entry_files( int $entry_id, array $files ): void {
		global $wpdb;
		$table = Schema::table( 'entry_files' );
		$wpdb->delete( $table, array( 'entry_id' => $entry_id ) );
		foreach ( $files as $file ) {
			$wpdb->insert(
				$table,
				$file + array(
					'entry_id'   => $entry_id,
					'created_at' => self::now(),
				)
			);
		}
	}

	/**
	 * Deletes a migrated entry with its file rows and notes (the 3.x lead was deleted).
	 *
	 * @param int $legacy_id Legacy lead ID.
	 * @return bool Whether an entry existed.
	 */
	public function delete_entry( int $legacy_id ): bool {
		global $wpdb;
		$table = Schema::table( 'entries' );
		$id    = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_post_id = %d', $table, $legacy_id ) );
		if ( null === $id ) {
			return false;
		}
		$wpdb->delete( Schema::table( 'entry_files' ), array( 'entry_id' => (int) $id ) );
		$wpdb->delete( Schema::table( 'entry_notes' ), array( 'entry_id' => (int) $id ) );
		$wpdb->update( Schema::table( 'bookings' ), array( 'entry_id' => null ), array( 'entry_id' => (int) $id ) );
		$wpdb->delete( $table, array( 'id' => (int) $id ) );
		return true;
	}

	/**
	 * Legacy lead ID => entry ID for the given leads.
	 *
	 * @param int[] $legacy_ids Legacy lead IDs.
	 * @return array<int,int>
	 */
	public function entry_ids( array $legacy_ids ): array {
		global $wpdb;
		$legacy_ids = array_values( array_filter( array_map( 'intval', $legacy_ids ) ) );
		if ( array() === $legacy_ids ) {
			return array();
		}
		$table = Schema::table( 'entries' );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, legacy_post_id FROM %i WHERE legacy_post_id IN (' . implode( ', ', array_fill( 0, count( $legacy_ids ), '%d' ) ) . ')',
				array_merge( array( $table ), $legacy_ids )
			),
			ARRAY_A
		);
		$map   = array();
		foreach ( $rows as $row ) {
			$map[ (int) $row['legacy_post_id'] ] = (int) $row['id'];
		}
		return $map;
	}

	/**
	 * Stores a booking type and its calendar connection.
	 *
	 * @param int                      $legacy_id Legacy event type ID.
	 * @param string                   $title     Title.
	 * @param array<string,mixed>      $config    Configuration without credentials.
	 * @param array<string,mixed>|null $calendar  ['provider','label','secret'] or null.
	 * @return int Booking type ID.
	 */
	public function upsert_booking_type( int $legacy_id, string $title, array $config, ?array $calendar ): int {
		global $wpdb;
		$table = Schema::table( 'booking_types' );
		$now   = self::now();
		$row   = $wpdb->get_row( $wpdb->prepare( 'SELECT id, calendar_connection_id FROM %i WHERE legacy_post_id = %d', $table, $legacy_id ), ARRAY_A );

		$calendar_id = is_array( $row ) && null !== $row['calendar_connection_id'] ? (int) $row['calendar_connection_id'] : null;
		$calendars   = Schema::table( 'calendar_connections' );
		if ( null !== $calendar ) {
			$values = array(
				'provider'      => $calendar['provider'],
				'account_label' => $calendar['label'],
				'secret'        => $this->box->encrypt( self::json( $calendar['secret'] ) ),
				'status'        => $calendar['status'],
			);
			if ( null === $calendar_id ) {
				$wpdb->insert( $calendars, $values + array( 'created_at' => $now ) );
				$calendar_id = (int) $wpdb->insert_id;
			} else {
				$wpdb->update( $calendars, $values, array( 'id' => $calendar_id ) );
			}
		} elseif ( null !== $calendar_id ) {
			// The calendar was disconnected in 3.x.
			$wpdb->delete( $calendars, array( 'id' => $calendar_id ) );
			$calendar_id = null;
		}

		$values = array(
			'title'                  => $title,
			'config'                 => self::json( $config ),
			'calendar_connection_id' => $calendar_id,
			'updated_at'             => $now,
		);
		if ( is_array( $row ) ) {
			$wpdb->update( $table, $values, array( 'id' => (int) $row['id'] ) );
			return (int) $row['id'];
		}
		$wpdb->insert(
			$table,
			$values + array(
				'legacy_post_id' => $legacy_id,
				'created_at'     => $now,
			)
		);
		return (int) $wpdb->insert_id;
	}

	/**
	 * Legacy event type ID => booking type ID.
	 *
	 * @return array<int,int>
	 */
	public function booking_type_map(): array {
		global $wpdb;
		$table = Schema::table( 'booking_types' );
		$map   = array();
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, legacy_post_id FROM %i WHERE legacy_post_id IS NOT NULL', $table ), ARRAY_A ) as $row ) {
			$map[ (int) $row['legacy_post_id'] ] = (int) $row['id'];
		}
		return $map;
	}

	/**
	 * Stores a booking.
	 *
	 * @param array<string,mixed> $row Booking row with legacy_post_id.
	 * @return int Booking ID.
	 */
	public function upsert_booking( array $row ): int {
		global $wpdb;
		$table = Schema::table( 'bookings' );
		$row   = array( 'data' => self::json( $row['data'] ) ) + $row;
		$id    = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_post_id = %d', $table, $row['legacy_post_id'] ) );
		if ( null !== $id ) {
			$wpdb->update( $table, $row, array( 'id' => (int) $id ) );
			return (int) $id;
		}
		$wpdb->insert( $table, $row + array( 'created_at' => self::now() ) );
		return (int) $wpdb->insert_id;
	}

	/**
	 * Writes an audit record. Details must not hold personal data.
	 *
	 * @param string              $action      Action.
	 * @param string              $object_type Object type.
	 * @param string              $object_id   Object ID.
	 * @param array<string,mixed> $details     Details.
	 */
	public function audit( string $action, string $object_type, string $object_id, array $details = array() ): void {
		global $wpdb;
		$wpdb->insert(
			Schema::table( 'audit_log' ),
			array(
				'actor_id'    => get_current_user_id(),
				'action'      => $action,
				'object_type' => $object_type,
				'object_id'   => $object_id,
				'details'     => self::json( $details ),
				'created_at'  => self::now(),
			),
			// WordPress formats any column named object_id as a number unless told otherwise.
			array( '%d', '%s', '%s', '%s', '%s', '%s' )
		);
	}
}
