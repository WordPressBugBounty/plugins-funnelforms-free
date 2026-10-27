<?php
/**
 * Reads forms and their revisions from the ffx_* tables.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Repository;

use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom tables of this plugin; rows are cached per request below.

/**
 * Forms are read on every page that shows one, so rows and documents are cached per request.
 */
final class FormRepository {

	public const RENDERER_LEGACY = 'legacy';
	public const RENDERER_V5     = 'v5';

	/** Note of revisions written by the 3.x import. */
	public const MIGRATION_NOTE = 'migration';

	/** Columns of a form row; the draft is read on its own (FormRepository::draft()). */
	private const COLUMNS = 'id, uid, legacy_post_id, title, status, schema_version, current_revision_id, locale_default, renderer, public_slug, category, draft_author, draft_updated_at, locked_by, locked_at, created_at, updated_at, draft IS NOT NULL AS has_draft';

	/**
	 * Rows by id.
	 *
	 * @var array<int,array<string,mixed>|null>
	 */
	private static array $rows = array();

	/**
	 * Decoded documents by revision id.
	 *
	 * @var array<int,array<string,mixed>|null>
	 */
	private static array $documents = array();

	/**
	 * A form by its public uid.
	 *
	 * @param string $uid Form uid.
	 * @return array<string,mixed>|null
	 */
	public function by_uid( string $uid ): ?array {
		global $wpdb;
		$id = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE uid = %s', Schema::table( 'forms' ), $uid ) );
		return null === $id ? null : $this->by_id( (int) $id );
	}

	/**
	 * The form with this address of its own page (/funnelforms/<slug>).
	 *
	 * @param string $slug Slug.
	 * @return array<string,mixed>|null
	 */
	public function by_slug( string $slug ): ?array {
		global $wpdb;
		$id = '' === $slug ? null : $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE public_slug = %s', Schema::table( 'forms' ), $slug ) );
		return null === $id ? null : $this->by_id( (int) $id );
	}

	/**
	 * The form that took over a 3.x form with this funnel link (post meta _public_slug), while it
	 * has no address of its own here. Without the 3.x code nothing else answers the old link.
	 *
	 * @param string $slug Slug.
	 * @return array<string,mixed>|null
	 */
	public function by_legacy_slug( string $slug ): ?array {
		global $wpdb;
		$post = '' === $slug ? null : $wpdb->get_var( $wpdb->prepare( 'SELECT post_id FROM %i WHERE meta_key = %s AND meta_value = %s ORDER BY post_id LIMIT 1', $wpdb->postmeta, '_public_slug', $slug ) );
		$form = null === $post ? null : $this->by_legacy_id( (int) $post );
		return null === $form || '' !== (string) ( $form['public_slug'] ?? '' ) ? null : $form;
	}

	/**
	 * Whether another form has this slug already: a form of this plugin, or a 3.x form with its
	 * funnel link (post meta _public_slug), which 3.x answers under the same address.
	 *
	 * @param string   $slug      Slug.
	 * @param int      $form_id   The form that wants it.
	 * @param int|null $legacy_id Its 3.x form post, whose own slug does not count.
	 */
	public function slug_taken( string $slug, int $form_id, ?int $legacy_id ): bool {
		global $wpdb;
		$form   = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE public_slug = %s AND id <> %d LIMIT 1', Schema::table( 'forms' ), $slug, $form_id ) );
		$legacy = $wpdb->get_var( $wpdb->prepare( 'SELECT post_id FROM %i WHERE meta_key = %s AND meta_value = %s AND post_id <> %d LIMIT 1', $wpdb->postmeta, '_public_slug', $slug, (int) $legacy_id ) );
		return null !== $form || null !== $legacy;
	}

	/**
	 * The form migrated from a 3.x form post.
	 *
	 * @param int $legacy_id 3.x form post ID.
	 * @return array<string,mixed>|null
	 */
	public function by_legacy_id( int $legacy_id ): ?array {
		global $wpdb;
		$id = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_post_id = %d', Schema::table( 'forms' ), $legacy_id ) );
		return null === $id ? null : $this->by_id( (int) $id );
	}

	/**
	 * A form by id.
	 *
	 * @param int $id Form ID.
	 * @return array<string,mixed>|null
	 */
	public function by_id( int $id ): ?array {
		global $wpdb;
		if ( ! array_key_exists( $id, self::$rows ) ) {
			$row               = $wpdb->get_row( $wpdb->prepare( 'SELECT ' . self::COLUMNS . ' FROM %i WHERE id = %d', Schema::table( 'forms' ), $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- column list is a constant.
			self::$rows[ $id ] = is_array( $row ) ? $row : null;
		}
		return self::$rows[ $id ];
	}

	/**
	 * Forms imported from 3.x (which the shortcode addresses by their 3.x ID), by title.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function with_legacy_ids(): array {
		global $wpdb;
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, legacy_post_id, title, renderer, status FROM %i WHERE legacy_post_id IS NOT NULL ORDER BY title ASC, id ASC', Schema::table( 'forms' ) ), ARRAY_A );
	}

	/**
	 * Published forms made in the builder (no 3.x ID; the shortcode addresses them by uid), by title.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function made_in_builder(): array {
		global $wpdb;
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, uid, title FROM %i WHERE legacy_post_id IS NULL AND status = %s ORDER BY title ASC, id ASC', Schema::table( 'forms' ), 'published' ), ARRAY_A );
	}

	/**
	 * IDs of published forms whose current revision may have A/B tests.
	 *
	 * @return int[]
	 */
	public function with_experiments(): array {
		global $wpdb;
		return array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( 'SELECT f.id FROM %i f JOIN %i r ON r.id = f.current_revision_id WHERE f.status = %s AND r.document LIKE %s ORDER BY f.id ASC', Schema::table( 'forms' ), Schema::table( 'form_revisions' ), 'published', '%' . $wpdb->esc_like( '"experiments"' ) . '%' ) ) );
	}

	/**
	 * Document of a revision.
	 *
	 * @param int $revision_id Revision ID.
	 * @return array<string,mixed>|null
	 */
	public function document( int $revision_id ): ?array {
		global $wpdb;
		if ( ! array_key_exists( $revision_id, self::$documents ) ) {
			$json = $wpdb->get_var( $wpdb->prepare( 'SELECT document FROM %i WHERE id = %d', Schema::table( 'form_revisions' ), $revision_id ) );
			$doc  = is_string( $json ) ? json_decode( $json, true ) : null;

			self::$documents[ $revision_id ] = is_array( $doc ) ? $doc : null;
		}
		return self::$documents[ $revision_id ];
	}

	/**
	 * Switches the renderer of a form and writes an audit entry.
	 *
	 * @param int    $form_id  Form ID.
	 * @param string $renderer self::RENDERER_LEGACY or self::RENDERER_V5.
	 * @param string $reason   Why (shown in the audit log).
	 */
	public function set_renderer( int $form_id, string $renderer, string $reason ): void {
		global $wpdb;
		$wpdb->update(
			Schema::table( 'forms' ),
			array(
				'renderer'   => $renderer,
				'updated_at' => gmdate( 'Y-m-d H:i:s' ),
			),
			array( 'id' => $form_id )
		);
		$wpdb->insert(
			Schema::table( 'audit_log' ),
			array(
				'actor_id'    => get_current_user_id(),
				'action'      => 'form_renderer',
				'object_type' => 'form',
				'object_id'   => (string) $form_id,
				'details'     => wp_json_encode(
					array(
						'renderer' => $renderer,
						'reason'   => $reason,
					)
				),
				'created_at'  => gmdate( 'Y-m-d H:i:s' ),
			)
		);
		unset( self::$rows[ $form_id ] );
	}

	/**
	 * Forms for the admin list, newest change first or by title.
	 *
	 * @param array<string,mixed> $filter search, status (one status; all but trashed when empty), category.
	 * @param string              $order  updated or title.
	 * @param int                 $page   Page from 1.
	 * @param int                 $per    Rows per page.
	 * @return array{rows:array<int,array<string,mixed>>,total:int}
	 */
	public function search( array $filter, string $order, int $page, int $per ): array {
		global $wpdb;
		$table    = Schema::table( 'forms' );
		$status   = (string) ( $filter['status'] ?? '' );
		$filtered = isset( $filter['category'] ) ? 1 : 0;
		$category = (string) ( $filter['category'] ?? '' );
		$search   = (string) ( $filter['search'] ?? '' );
		$like     = '%' . $wpdb->esc_like( $search ) . '%';
		$offset   = ( $page - 1 ) * $per;
		// Fixed queries: a filter that is not set turns its condition off through its own placeholder.
		$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE ( ( %s = '' AND status <> 'trashed' ) OR status = %s ) AND ( %d = 0 OR category = %s ) AND ( %s = '' OR title LIKE %s )", $table, $status, $status, $filtered, $category, $search, $like ) );
		if ( 'title' === $order ) {
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, uid, legacy_post_id, title, status, schema_version, current_revision_id, locale_default, renderer, public_slug, category, draft_author, draft_updated_at, locked_by, locked_at, created_at, updated_at, draft IS NOT NULL AS has_draft FROM %i WHERE ( ( %s = '' AND status <> 'trashed' ) OR status = %s ) AND ( %d = 0 OR category = %s ) AND ( %s = '' OR title LIKE %s ) ORDER BY title ASC, id ASC LIMIT %d OFFSET %d", $table, $status, $status, $filtered, $category, $search, $like, $per, $offset ), ARRAY_A );
		} else {
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, uid, legacy_post_id, title, status, schema_version, current_revision_id, locale_default, renderer, public_slug, category, draft_author, draft_updated_at, locked_by, locked_at, created_at, updated_at, draft IS NOT NULL AS has_draft FROM %i WHERE ( ( %s = '' AND status <> 'trashed' ) OR status = %s ) AND ( %d = 0 OR category = %s ) AND ( %s = '' OR title LIKE %s ) ORDER BY updated_at DESC, id DESC LIMIT %d OFFSET %d", $table, $status, $status, $filtered, $category, $search, $like, $per, $offset ), ARRAY_A );
		}
		return array(
			'rows'  => (array) $rows,
			'total' => $total,
		);
	}

	/**
	 * Categories in use, sorted.
	 *
	 * @return string[]
	 */
	public function categories(): array {
		global $wpdb;
		return array_map( 'strval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT category FROM %i WHERE category <> '' AND status <> 'trashed' ORDER BY category ASC", Schema::table( 'forms' ) ) ) );
	}

	/**
	 * Number of entries per form, without the spam folder and visitors who left (status abandoned).
	 *
	 * @param int[] $ids Form IDs.
	 * @return array<int,int>
	 */
	public function entry_counts( array $ids ): array {
		global $wpdb;
		$ids = array_values( array_unique( array_map( 'intval', $ids ) ) );
		if ( array() === $ids ) {
			return array();
		}
		$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT form_id, COUNT(*) AS n FROM %i WHERE form_id IN (' . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ") AND status NOT IN ('spam', 'abandoned') GROUP BY form_id", array_merge( array( Schema::table( 'entries' ) ), $ids ) ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- placeholders only.
		$out  = array_fill_keys( $ids, 0 );
		foreach ( $rows as $row ) {
			$out[ (int) $row['form_id'] ] = (int) $row['n'];
		}
		return $out;
	}

	/**
	 * Creates a form without a published version; its document is the draft.
	 *
	 * @param string               $title    Title.
	 * @param string               $category Category.
	 * @param string               $locale   Default language.
	 * @param int                  $author   User ID.
	 * @param callable(int):string $draft Builds the draft JSON from the new form ID.
	 */
	public function create( string $title, string $category, string $locale, int $author, callable $draft ): int {
		global $wpdb;
		$now = gmdate( 'Y-m-d H:i:s' );
		$wpdb->insert(
			Schema::table( 'forms' ),
			array(
				'uid'              => wp_generate_uuid4(),
				'title'            => $title,
				'status'           => 'draft',
				'schema_version'   => 1,
				'locale_default'   => $locale,
				'renderer'         => self::RENDERER_V5,
				'category'         => $category,
				'draft_author'     => $author,
				'draft_updated_at' => $now,
				'created_at'       => $now,
				'updated_at'       => $now,
			)
		);
		$id = (int) $wpdb->insert_id;
		$wpdb->update( Schema::table( 'forms' ), array( 'draft' => $draft( $id ) ), array( 'id' => $id ) );
		return $id;
	}

	/**
	 * JSON of the draft, null when there is none.
	 *
	 * @param int $form_id Form ID.
	 */
	public function draft( int $form_id ): ?string {
		global $wpdb;
		$json = $wpdb->get_var( $wpdb->prepare( 'SELECT draft FROM %i WHERE id = %d', Schema::table( 'forms' ), $form_id ) );
		return is_string( $json ) ? $json : null;
	}

	/**
	 * JSON of a revision's document.
	 *
	 * @param int $revision_id Revision ID.
	 */
	public function document_json( int $revision_id ): ?string {
		global $wpdb;
		$json = $wpdb->get_var( $wpdb->prepare( 'SELECT document FROM %i WHERE id = %d', Schema::table( 'form_revisions' ), $revision_id ) );
		return is_string( $json ) ? $json : null;
	}

	/**
	 * Stores the draft; a form that was never published takes over its title.
	 *
	 * @param int         $form_id Form ID.
	 * @param string|null $json    Draft JSON, null to drop it.
	 * @param int         $author  User ID.
	 * @param string|null $title   Title of the draft.
	 */
	public function save_draft( int $form_id, ?string $json, int $author, ?string $title = null ): void {
		global $wpdb;
		$now  = gmdate( 'Y-m-d H:i:s' );
		$data = array(
			'draft'            => $json,
			'draft_author'     => null === $json ? 0 : $author,
			'draft_updated_at' => null === $json ? null : $now,
			'updated_at'       => $now,
		);
		$form = $this->by_id( $form_id );
		if ( null !== $title && null !== $form && null === $form['current_revision_id'] ) {
			$data['title'] = $title;
		}
		$wpdb->update( Schema::table( 'forms' ), $data, array( 'id' => $form_id ) );
		unset( self::$rows[ $form_id ] );
	}

	/**
	 * Publishes a document: a new revision becomes the current one and the draft is dropped.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $json    Document JSON.
	 * @param string $title   Title of the document.
	 * @param int    $author  User ID.
	 * @param string $note    Note of the revision.
	 * @return int Revision ID.
	 */
	public function publish( int $form_id, string $json, string $title, int $author, string $note ): int {
		global $wpdb;
		$now = gmdate( 'Y-m-d H:i:s' );
		$wpdb->insert(
			Schema::table( 'form_revisions' ),
			array(
				'form_id'        => $form_id,
				'schema_version' => 1,
				'document'       => $json,
				'author_id'      => $author,
				'note'           => $note,
				'created_at'     => $now,
			)
		);
		$revision = (int) $wpdb->insert_id;
		$wpdb->update(
			Schema::table( 'forms' ),
			array(
				'current_revision_id' => $revision,
				'title'               => $title,
				'status'              => 'published',
				'draft'               => null,
				'draft_author'        => 0,
				'draft_updated_at'    => null,
				'updated_at'          => $now,
			),
			array( 'id' => $form_id )
		);
		unset( self::$rows[ $form_id ], self::$documents[ $revision ] );
		return $revision;
	}

	/**
	 * Revisions of a form, newest first, without their documents.
	 *
	 * @param int $form_id Form ID.
	 * @param int $limit   Most rows.
	 * @return array<int,array<string,mixed>>
	 */
	public function revisions( int $form_id, int $limit ): array {
		global $wpdb;
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, author_id, note, created_at, LENGTH(document) AS size FROM %i WHERE form_id = %d ORDER BY id DESC LIMIT %d', Schema::table( 'form_revisions' ), $form_id, $limit ), ARRAY_A );
	}

	/**
	 * One revision of a form, with its document JSON.
	 *
	 * @param int $form_id     Form ID.
	 * @param int $revision_id Revision ID.
	 * @return array<string,mixed>|null
	 */
	public function revision( int $form_id, int $revision_id ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT id, author_id, note, created_at, document FROM %i WHERE id = %d AND form_id = %d', Schema::table( 'form_revisions' ), $revision_id, $form_id ), ARRAY_A );
		return is_array( $row ) ? $row : null;
	}

	/**
	 * Whether the current version of a form was made in the builder rather than by the 3.x import.
	 *
	 * @param array<string,mixed> $form Form row.
	 */
	public function edited( array $form ): bool {
		global $wpdb;
		if ( null === $form['current_revision_id'] ) {
			return false;
		}
		$note = $wpdb->get_var( $wpdb->prepare( 'SELECT note FROM %i WHERE id = %d', Schema::table( 'form_revisions' ), (int) $form['current_revision_id'] ) );
		return self::MIGRATION_NOTE !== $note;
	}

	/**
	 * Takes the edit lock of a form: when it is free, held by the user or older than $ttl
	 * seconds, or always with $force.
	 *
	 * @param int  $form_id Form ID.
	 * @param int  $user    User ID.
	 * @param int  $ttl     Seconds a lock holds without being renewed.
	 * @param bool $force   Take it over from someone else.
	 * @return int Holder of the lock afterwards (the user when taken).
	 */
	public function lock( int $form_id, int $user, int $ttl, bool $force ): int {
		global $wpdb;
		$now     = gmdate( 'Y-m-d H:i:s' );
		$expired = gmdate( 'Y-m-d H:i:s', time() - $ttl );
		$table   = Schema::table( 'forms' );
		if ( $force ) {
			$wpdb->query( $wpdb->prepare( 'UPDATE %i SET locked_by = %d, locked_at = %s WHERE id = %d', $table, $user, $now, $form_id ) );
		} else {
			$wpdb->query( $wpdb->prepare( 'UPDATE %i SET locked_by = %d, locked_at = %s WHERE id = %d AND ( locked_by = 0 OR locked_by = %d OR locked_at IS NULL OR locked_at < %s )', $table, $user, $now, $form_id, $user, $expired ) );
		}
		unset( self::$rows[ $form_id ] );
		return $this->holder( $form_id, $ttl );
	}

	/**
	 * Who holds the edit lock now; 0 when nobody does.
	 *
	 * @param int $form_id Form ID.
	 * @param int $ttl     Seconds a lock holds without being renewed.
	 */
	public function holder( int $form_id, int $ttl ): int {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT locked_by, locked_at FROM %i WHERE id = %d', Schema::table( 'forms' ), $form_id ), ARRAY_A );
		if ( ! is_array( $row ) || 0 === (int) $row['locked_by'] || null === $row['locked_at'] || strtotime( $row['locked_at'] . ' UTC' ) < time() - $ttl ) {
			return 0;
		}
		return (int) $row['locked_by'];
	}

	/**
	 * Gives up the user's lock.
	 *
	 * @param int $form_id Form ID.
	 * @param int $user    User ID.
	 */
	public function unlock( int $form_id, int $user ): void {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'UPDATE %i SET locked_by = 0, locked_at = NULL WHERE id = %d AND locked_by = %d', Schema::table( 'forms' ), $form_id, $user ) );
		unset( self::$rows[ $form_id ] );
	}

	/**
	 * Changes columns of the form row (title, category, status).
	 *
	 * @param int                  $form_id Form ID.
	 * @param array<string,string> $data    Columns.
	 */
	public function update( int $form_id, array $data ): void {
		global $wpdb;
		$data['updated_at'] = gmdate( 'Y-m-d H:i:s' );
		$wpdb->update( Schema::table( 'forms' ), $data, array( 'id' => $form_id ) );
		unset( self::$rows[ $form_id ] );
	}

	/**
	 * Deletes a form, its revisions and the results of its A/B tests.
	 *
	 * @param int $form_id Form ID.
	 */
	public function delete( int $form_id ): void {
		global $wpdb;
		$wpdb->delete( Schema::table( 'form_revisions' ), array( 'form_id' => $form_id ) );
		$wpdb->delete( Schema::table( 'experiment_results' ), array( 'form_id' => $form_id ) );
		$wpdb->delete( Schema::table( 'forms' ), array( 'id' => $form_id ) );
		unset( self::$rows[ $form_id ] );
	}

	/**
	 * Writes an audit entry about a form. Details must not hold personal data.
	 *
	 * @param string              $action  Action.
	 * @param int                 $form_id Form ID.
	 * @param array<string,mixed> $details Details.
	 */
	public function audit( string $action, int $form_id, array $details = array() ): void {
		global $wpdb;
		$wpdb->insert(
			Schema::table( 'audit_log' ),
			array(
				'actor_id'    => get_current_user_id(),
				'action'      => $action,
				'object_type' => 'form',
				'object_id'   => (string) $form_id,
				'details'     => wp_json_encode( $details ),
				'created_at'  => gmdate( 'Y-m-d H:i:s' ),
			)
		);
	}

	/**
	 * Forgets cached rows (tests and long-running jobs).
	 */
	public static function flush(): void {
		self::$rows      = array();
		self::$documents = array();
	}
}
