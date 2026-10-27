<?php
/**
 * Writes entries and their delivery log.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Repository;

use Funnelforms\Application\LeadStages;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Files\PrivateStorage;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom tables of this plugin; entries change too often to cache.

/**
 * Entries of the new runtime and the jobs that deliver them (mails, webhooks).
 */
final class EntryRepository {

	private const JSON_COLUMNS = array( 'utm', 'data', 'consent', 'meta' );

	/**
	 * The lead stages of 5.0 (column lead_status). Sites rename, add and delete stages; the stages
	 * they have now are Application\LeadStages.
	 */
	public const LEAD_STATUSES = array( 'new', 'contacted', 'won', 'lost' );

	/** States of the payment of an entry (column payment_status). */
	public const PAYMENT_STATUSES = array( 'open', 'pending', 'paid', 'failed', 'canceled', 'refunded', 'disputed' );

	/** Most tags on one entry. */
	public const MAX_TAGS = 20;

	/** Longest tag, in characters. */
	public const MAX_TAG_LENGTH = 40;

	/**
	 * Stores a new entry.
	 *
	 * @param int                 $form_id Form ID.
	 * @param int|null            $legacy_form_id 3.x form post ID of a migrated form.
	 * @param array<string,mixed> $row     Columns from EntryData::row().
	 * @return int Entry ID, 0 on failure.
	 */
	public function insert( int $form_id, ?int $legacy_form_id, array $row ): int {
		global $wpdb;
		foreach ( self::JSON_COLUMNS as $column ) {
			$row[ $column ] = (string) wp_json_encode( $row[ $column ] ?? null, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		}
		$row['uid']                 = wp_generate_uuid4();
		$row['form_id']             = $form_id;
		$row['legacy_form_post_id'] = $legacy_form_id;
		$ok                         = $wpdb->insert( Schema::table( 'entries' ), $row );
		return false === $ok ? 0 : (int) $wpdb->insert_id;
	}

	/**
	 * Saves the answers so far of a visitor who has not submitted yet (forms that keep incomplete
	 * entries). The draft key the browser holds finds the row again; its hash is stored.
	 *
	 * @param int                 $form_id        Form ID.
	 * @param int|null            $legacy_form_id 3.x form post ID of a migrated form.
	 * @param string              $draft_hash     Hash of the draft key.
	 * @param array<string,mixed> $row            Columns from EntryData::row().
	 * @return int Entry ID, 0 on failure.
	 */
	public function save_partial( int $form_id, ?int $legacy_form_id, string $draft_hash, array $row ): int {
		global $wpdb;
		$row['status']       = 'partial';
		$row['completed_at'] = null;
		$id                  = $this->draft( $form_id, $draft_hash );
		if ( 0 === $id ) {
			$row['draft_hash'] = $draft_hash;
			return $this->insert( $form_id, $legacy_form_id, $row );
		}
		if ( 'abandoned' === $this->status( $id ) ) {
			// The visitor gave an address already (Application\Abandonment): that row keeps it.
			return $id;
		}
		unset( $row['created_at'] );
		foreach ( self::JSON_COLUMNS as $column ) {
			$row[ $column ] = (string) wp_json_encode( $row[ $column ] ?? null, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		}
		return false === $wpdb->update( Schema::table( 'entries' ), $row, array( 'id' => $id ) ) ? 0 : $id;
	}

	/**
	 * Turns the incomplete entry of a draft into the submitted entry, as 3.x did.
	 *
	 * @param int                 $form_id    Form ID.
	 * @param string              $draft_hash Hash of the draft key.
	 * @param array<string,mixed> $row        Columns from EntryData::row().
	 * @return int Entry ID, 0 when there is no such draft.
	 */
	public function complete_partial( int $form_id, string $draft_hash, array $row ): int {
		global $wpdb;
		$id = $this->draft( $form_id, $draft_hash );
		if ( 0 === $id || 'partial' !== $this->status( $id ) ) {
			return 0;
		}
		foreach ( self::JSON_COLUMNS as $column ) {
			$row[ $column ] = (string) wp_json_encode( $row[ $column ] ?? null, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		}
		$row['draft_hash'] = null;
		return false === $wpdb->update( Schema::table( 'entries' ), $row, array( 'id' => $id ) ) ? 0 : $id;
	}

	/**
	 * ID of the incomplete or abandoned entry of a draft, 0 if there is none.
	 *
	 * @param int    $form_id    Form ID.
	 * @param string $draft_hash Hash of the draft key.
	 */
	public function draft( int $form_id, string $draft_hash ): int {
		global $wpdb;
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE draft_hash = %s AND form_id = %d AND status IN (%s, %s)', Schema::table( 'entries' ), $draft_hash, $form_id, 'partial', 'abandoned' ) );
	}

	/**
	 * Status of an entry (complete, partial, abandoned), empty when there is none.
	 *
	 * @param int $id Entry ID.
	 */
	public function status( int $id ): string {
		global $wpdb;
		return (string) $wpdb->get_var( $wpdb->prepare( 'SELECT status FROM %i WHERE id = %d', Schema::table( 'entries' ), $id ) );
	}

	/**
	 * Replaces the columns of an entry (an abandoned entry while the visitor is still on the form,
	 * or when it is sent at last). JSON columns are encoded here.
	 *
	 * @param int                 $id  Entry ID.
	 * @param array<string,mixed> $row Columns.
	 */
	public function replace( int $id, array $row ): bool {
		global $wpdb;
		foreach ( self::JSON_COLUMNS as $column ) {
			if ( array_key_exists( $column, $row ) ) {
				$row[ $column ] = (string) wp_json_encode( $row[ $column ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
			}
		}
		return false !== $wpdb->update( Schema::table( 'entries' ), $row, array( 'id' => $id ) );
	}

	/**
	 * Abandoned entries of a form whose contact data holds an address, newest first.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $email   Address, compared without case.
	 * @param string $optout  Hash of the address that entries keep once it asked for no reminders.
	 * @param string $since   Earliest creation time, UTC (Y-m-d H:i:s).
	 * @return array<int,array<string,mixed>> Entries with decoded JSON columns.
	 */
	public function abandoned_with( int $form_id, string $email, string $optout, string $since ): array {
		global $wpdb;
		$email = strtolower( trim( $email ) );
		if ( '' === $email ) {
			return array();
		}
		// The LIKE only narrows the search; the caller compares the decoded values.
		$ids = (array) $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE form_id = %d AND status = %s AND created_at >= %s AND (data LIKE %s OR meta LIKE %s) ORDER BY id DESC LIMIT 20', Schema::table( 'entries' ), $form_id, 'abandoned', $since, '%' . $wpdb->esc_like( $email ) . '%', '%' . $wpdb->esc_like( '"optout":"' . $optout . '"' ) . '%' ) );
		$out = array();
		foreach ( $ids as $id ) {
			$entry = $this->find( (int) $id );
			if ( null !== $entry ) {
				$out[] = $entry;
			}
		}
		return $out;
	}

	/**
	 * Abandoned entries created before a time, oldest first.
	 *
	 * @param string $before UTC time (Y-m-d H:i:s).
	 * @param int    $limit  Most rows.
	 * @return array<int,array<string,mixed>> Entries with decoded JSON columns.
	 */
	public function abandoned_before( string $before, int $limit ): array {
		global $wpdb;
		$ids = (array) $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE status = %s AND created_at < %s ORDER BY id ASC LIMIT %d', Schema::table( 'entries' ), 'abandoned', $before, $limit ) );
		return array_values( array_filter( array_map( fn( $id ) => $this->find( (int) $id ), $ids ) ) );
	}

	/**
	 * An entry with decoded JSON columns.
	 *
	 * @param int $id Entry ID.
	 * @return array<string,mixed>|null
	 */
	public function find( int $id ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', Schema::table( 'entries' ), $id ), ARRAY_A );
		if ( ! is_array( $row ) ) {
			return null;
		}
		foreach ( self::JSON_COLUMNS as $column ) {
			$row[ $column ] = is_string( $row[ $column ] ) ? json_decode( $row[ $column ], true ) : null;
		}
		return $row;
	}

	/**
	 * Adds a queued delivery job.
	 *
	 * @param int         $entry_id  Entry ID.
	 * @param string      $action_id Action id of the form document.
	 * @param string|null $due       When a later job is due, UTC (Y-m-d H:i:s); its row counts as updated then.
	 * @return int Job ID.
	 */
	public function add_job( int $entry_id, string $action_id, ?string $due = null ): int {
		global $wpdb;
		$now = gmdate( 'Y-m-d H:i:s' );
		$wpdb->insert(
			Schema::table( 'jobs_log' ),
			array(
				'entry_id'   => $entry_id,
				'channel'    => substr( $action_id, 0, 64 ),
				'status'     => 'queued',
				'attempts'   => 0,
				'created_at' => $now,
				'updated_at' => $due ?? $now,
			)
		);
		return (int) $wpdb->insert_id;
	}

	/**
	 * A delivery job.
	 *
	 * @param int $id Job ID.
	 * @return array<string,mixed>|null
	 */
	public function job( int $id ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', Schema::table( 'jobs_log' ), $id ), ARRAY_A );
		return is_array( $row ) ? $row : null;
	}

	/**
	 * Records the outcome of one delivery attempt.
	 *
	 * @param int     $id     Job ID.
	 * @param string  $status queued, sent, failed or skipped.
	 * @param int     $attempts Attempts so far.
	 * @param ?string $error  Error text; never contains visitor data.
	 */
	public function update_job( int $id, string $status, int $attempts, ?string $error ): void {
		global $wpdb;
		$wpdb->update(
			Schema::table( 'jobs_log' ),
			array(
				'status'     => $status,
				'attempts'   => $attempts,
				'last_error' => $error,
				'updated_at' => gmdate( 'Y-m-d H:i:s' ),
			),
			array( 'id' => $id )
		);
	}

	/**
	 * Jobs of an entry.
	 *
	 * @param int $entry_id Entry ID.
	 * @return array<int,array<string,mixed>>
	 */
	public function jobs( int $entry_id ): array {
		global $wpdb;
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE entry_id = %d ORDER BY id ASC', Schema::table( 'jobs_log' ), $entry_id ), ARRAY_A );
	}

	/**
	 * Marks an entry as waiting for the confirmation of its e-mail address (double opt-in).
	 *
	 * @param int    $id   Entry ID.
	 * @param string $hash SHA-256 of the confirmation token.
	 */
	public function await_optin( int $id, string $hash ): void {
		global $wpdb;
		$wpdb->update(
			Schema::table( 'entries' ),
			array(
				'optin_status' => 'pending',
				'optin_hash'   => $hash,
			),
			array( 'id' => $id )
		);
	}

	/**
	 * The entry of a confirmation token, by its hash.
	 *
	 * @param string $hash SHA-256 of the token.
	 * @return array<string,mixed>|null Entry with decoded JSON columns.
	 */
	public function by_optin_hash( string $hash ): ?array {
		global $wpdb;
		$id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE optin_hash = %s', Schema::table( 'entries' ), $hash ) );
		return $id > 0 ? $this->find( $id ) : null;
	}

	/**
	 * Confirms a waiting entry; false when it was not waiting (confirmed before, or never).
	 *
	 * @param int    $id  Entry ID.
	 * @param string $now UTC time.
	 */
	public function confirm_optin( int $id, string $now ): bool {
		global $wpdb;
		return 1 === (int) $wpdb->query( $wpdb->prepare( 'UPDATE %i SET optin_status = %s, optin_at = %s WHERE id = %d AND optin_status = %s', Schema::table( 'entries' ), 'confirmed', $now, $id, 'pending' ) );
	}

	/**
	 * Changes the payment of an entry, only while its status is still the one the caller saw, so
	 * that of two requests at once (webhook and return of the visitor) only one moves it on.
	 *
	 * @param int                 $id      Entry ID.
	 * @param string              $from    Payment status the caller saw ('' for none yet).
	 * @param array<string,mixed> $payment Payment (meta.payment) with its new status.
	 * @return bool Whether the entry changed.
	 */
	public function set_payment( int $id, string $from, array $payment ): bool {
		global $wpdb;
		$entry = $this->find( $id );
		if ( null === $entry || $from !== (string) $entry['payment_status'] ) {
			return false;
		}
		$meta            = is_array( $entry['meta'] ) ? $entry['meta'] : array();
		$meta['payment'] = $payment;
		return 1 === (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET payment_status = %s, meta = %s WHERE id = %d AND payment_status = %s',
				Schema::table( 'entries' ),
				(string) $payment['status'],
				(string) wp_json_encode( $meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
				$id,
				$from
			)
		);
	}

	/**
	 * Replaces the answers and meta of an entry (an appointment moved to another time).
	 *
	 * @param int                 $id   Entry ID.
	 * @param array<string,mixed> $data Data column.
	 * @param array<string,mixed> $meta Meta column.
	 */
	public function update_answers( int $id, array $data, array $meta ): void {
		global $wpdb;
		$wpdb->update(
			Schema::table( 'entries' ),
			array(
				'data' => (string) wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
				'meta' => (string) wp_json_encode( $meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
			),
			array( 'id' => $id )
		);
	}

	/**
	 * Moves an entry out of the spam folder: it becomes a complete entry, sent when it was sent.
	 *
	 * @param int                 $id   Entry ID.
	 * @param array<string,mixed> $meta Meta column without the spam verdict.
	 * @return bool Whether it was in the spam folder (false when someone else moved it already).
	 */
	public function release_spam( int $id, array $meta ): bool {
		global $wpdb;
		return 1 === (int) $wpdb->query( $wpdb->prepare( 'UPDATE %i SET status = %s, meta = %s WHERE id = %d AND status = %s', Schema::table( 'entries' ), 'complete', (string) wp_json_encode( $meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ), $id, 'spam' ) );
	}

	/**
	 * Entries in the spam folder since before a time, oldest first.
	 *
	 * @param string $before UTC time (Y-m-d H:i:s).
	 * @param int    $limit  Rows per batch.
	 * @return int[] Entry IDs.
	 */
	public function spam_before( string $before, int $limit ): array {
		global $wpdb;
		return array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE status = %s AND created_at < %s ORDER BY id ASC LIMIT %d', Schema::table( 'entries' ), 'spam', $before, $limit ) ) );
	}

	/**
	 * Number of entries in the spam folder.
	 *
	 * @param int $form_id Form ID; 0 for all forms.
	 */
	public function count_spam( int $form_id = 0 ): int {
		global $wpdb;
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE status = %s AND ( %d = 0 OR form_id = %d )', Schema::table( 'entries' ), 'spam', $form_id, $form_id ) );
	}

	/**
	 * Number of complete entries of a form.
	 *
	 * @param int $form_id Form ID.
	 */
	public function count_complete( int $form_id ): int {
		global $wpdb;
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE form_id = %d AND status = %s', Schema::table( 'entries' ), $form_id, 'complete' ) );
	}

	/**
	 * A page of entries, newest first, and how many match. Entries in the spam folder and abandoned
	 * ones only come with the filter status spam or abandoned; not_status is a comma-separated list.
	 * sort "value" or "score" puts the highest lead value or score first (entries without one last),
	 * newest first among equal ones.
	 *
	 * @param array{form_id?:int,status?:string,not_status?:string,lead_status?:string,read?:bool,archived?:bool,search?:string,after?:string,before?:string,since_id?:int,tag?:string,assigned_to?:int,min_score?:float,optin?:string,optin_not?:string,public?:bool,payment?:string,device?:string,sort?:string} $filter Filters; times in UTC (Y-m-d H:i:s); since_id: only newer entries; assigned_to 0: nobody.
	 * @param int                                                                                                                                                                                                                                                                                                  $page     Page, from 1.
	 * @param int                                                                                                                                                                                                                                                                                                  $per_page Rows per page.
	 * @return array{rows:array<int,array<string,mixed>>,total:int} Entries with decoded JSON columns.
	 */
	public function search( array $filter, int $page, int $per_page ): array {
		global $wpdb;
		// Every filter has a switch and a value, in the order of the conditions of the query; a filter
		// that is not set turns its condition off, so the query is a fixed text.
		$args = array( Schema::table( 'entries' ) );
		if ( ! isset( $filter['status'] ) ) {
			// Spam and visitors who left without sending (Abandonment) only on request.
			$filter['not_status'] = 'spam,abandoned';
		}
		foreach ( array( 'form_id', 'status', 'not_status', 'lead_status', 'optin', 'optin_not', 'read', 'archived', 'public', 'payment', 'device', 'after', 'before', 'since_id', 'assigned_to', 'min_score' ) as $key ) {
			$value = $filter[ $key ] ?? null;
			// An unused time still has to be a valid time: MySQL refuses to compare a DATETIME with 0.
			$unset = in_array( $key, array( 'after', 'before' ), true ) ? '1970-01-01 00:00:00' : 0;
			array_push( $args, null === $value ? 0 : 1, is_bool( $value ) ? (int) $value : ( $value ?? $unset ) );
		}
		$search = trim( (string) ( $filter['search'] ?? '' ) );
		$tag    = self::tags( array( (string) ( $filter['tag'] ?? '' ) ) );
		array_push( $args, '' === $search ? 0 : 1, '%' . $wpdb->esc_like( $search ) . '%', array() === $tag ? 0 : 1, '%' . $wpdb->esc_like( ',' . ( $tag[0] ?? '' ) . ',' ) . '%' );
		$total = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE ( %d = 0 OR form_id = %d ) AND ( %d = 0 OR status = %s ) AND ( %d = 0 OR FIND_IN_SET( status, %s ) = 0 ) AND ( %d = 0 OR lead_status = %s ) AND ( %d = 0 OR optin_status = %s ) AND ( %d = 0 OR optin_status <> %s ) AND ( %d = 0 OR is_read = %d ) AND ( %d = 0 OR is_archived = %d ) AND ( %d = 0 OR is_public = %d ) AND ( %d = 0 OR payment_status = %s ) AND ( %d = 0 OR device = %s ) AND ( %d = 0 OR created_at >= %s ) AND ( %d = 0 OR created_at < %s ) AND ( %d = 0 OR id > %d ) AND ( %d = 0 OR COALESCE(assigned_to, 0) = %d ) AND ( %d = 0 OR score >= %f ) AND ( %d = 0 OR data LIKE %s ) AND ( %d = 0 OR tags LIKE %s )', $args ) ); // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- the replacements are one array, built above in the order of the placeholders.
		$sort  = array_search(
			$filter['sort'] ?? '',
			array(
				1 => 'value',
				2 => 'score',
			),
			true
		);
		$args  = array_merge( $args, array( (int) $sort, (int) $sort, (int) $sort, (int) $sort, $per_page, max( 0, $page - 1 ) * $per_page ) );
		$ids   = $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE ( %d = 0 OR form_id = %d ) AND ( %d = 0 OR status = %s ) AND ( %d = 0 OR FIND_IN_SET( status, %s ) = 0 ) AND ( %d = 0 OR lead_status = %s ) AND ( %d = 0 OR optin_status = %s ) AND ( %d = 0 OR optin_status <> %s ) AND ( %d = 0 OR is_read = %d ) AND ( %d = 0 OR is_archived = %d ) AND ( %d = 0 OR is_public = %d ) AND ( %d = 0 OR payment_status = %s ) AND ( %d = 0 OR device = %s ) AND ( %d = 0 OR created_at >= %s ) AND ( %d = 0 OR created_at < %s ) AND ( %d = 0 OR id > %d ) AND ( %d = 0 OR COALESCE(assigned_to, 0) = %d ) AND ( %d = 0 OR score >= %f ) AND ( %d = 0 OR data LIKE %s ) AND ( %d = 0 OR tags LIKE %s ) ORDER BY CASE WHEN %d = 1 THEN lead_value IS NULL END, CASE WHEN %d = 1 THEN lead_value END DESC, CASE WHEN %d = 2 THEN score IS NULL END, CASE WHEN %d = 2 THEN score END DESC, created_at DESC, id DESC LIMIT %d OFFSET %d', $args ) ); // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- the replacements are one array, built above in the order of the placeholders.
		$rows  = array();
		foreach ( (array) $ids as $id ) {
			$row = $this->find( (int) $id );
			if ( null !== $row ) {
				$rows[] = $row;
			}
		}
		return array(
			'rows'  => $rows,
			'total' => $total,
		);
	}

	/**
	 * Changes what an admin manages on an entry.
	 *
	 * @param int                                                                                                        $id      Entry ID.
	 * @param array{is_read?:bool,is_archived?:bool,is_public?:bool,lead_status?:string,tags?:string[],assigned_to?:int} $changes Changes; assigned_to 0 clears.
	 */
	public function update_flags( int $id, array $changes ): void {
		global $wpdb;
		$values = array();
		if ( isset( $changes['is_read'] ) ) {
			$values['is_read'] = $changes['is_read'] ? 1 : 0;
		}
		if ( isset( $changes['is_archived'] ) ) {
			$values['is_archived'] = $changes['is_archived'] ? 1 : 0;
		}
		if ( isset( $changes['is_public'] ) ) {
			$values['is_public'] = $changes['is_public'] ? 1 : 0;
		}
		if ( isset( $changes['lead_status'] ) && LeadStages::exists( $changes['lead_status'] ) ) {
			$values['lead_status'] = $changes['lead_status'];
		}
		if ( isset( $changes['tags'] ) ) {
			$tags           = self::tags( $changes['tags'] );
			$values['tags'] = array() === $tags ? '' : ',' . implode( ',', $tags ) . ',';
		}
		if ( array_key_exists( 'assigned_to', $changes ) ) {
			$values['assigned_to'] = 0 < (int) $changes['assigned_to'] ? (int) $changes['assigned_to'] : null;
		}
		if ( array() !== $values ) {
			$wpdb->update( Schema::table( 'entries' ), $values, array( 'id' => $id ) );
		}
	}

	/**
	 * Tags as stored: lower case, without commas and surrounding spaces, each once, at most
	 * MAX_TAGS of at most MAX_TAG_LENGTH characters.
	 *
	 * @param array<int,mixed> $tags Tags as entered.
	 * @return string[]
	 */
	public static function tags( array $tags ): array {
		$out = array();
		foreach ( $tags as $tag ) {
			if ( ! is_scalar( $tag ) ) {
				continue;
			}
			$tag = trim( (string) preg_replace( '/\s+/u', ' ', str_replace( ',', ' ', sanitize_text_field( (string) $tag ) ) ) );
			$tag = trim( mb_substr( mb_strtolower( $tag ), 0, self::MAX_TAG_LENGTH ) );
			if ( '' !== $tag && ! in_array( $tag, $out, true ) ) {
				$out[] = $tag;
			}
		}
		return array_slice( $out, 0, self::MAX_TAGS );
	}

	/**
	 * Tags of a stored entry.
	 *
	 * @param array<string,mixed> $entry Entry row.
	 * @return string[]
	 */
	public static function entry_tags( array $entry ): array {
		return array_values( array_filter( explode( ',', (string) ( $entry['tags'] ?? '' ) ), 'strlen' ) );
	}

	/**
	 * Tags in use, with how many entries carry each, most used first.
	 *
	 * @param int $limit Most tags.
	 * @return array<string,int>
	 */
	public function tag_counts( int $limit = 200 ): array {
		global $wpdb;
		$counts = array();
		$after  = 0;
		do {
			$rows = (array) $wpdb->get_results( $wpdb->prepare( "SELECT id, tags FROM %i WHERE id > %d AND tags <> '' ORDER BY id ASC LIMIT 500", Schema::table( 'entries' ), $after ), ARRAY_A );
			foreach ( $rows as $row ) {
				$after = (int) $row['id'];
				foreach ( self::entry_tags( $row ) as $tag ) {
					$counts[ $tag ] = ( $counts[ $tag ] ?? 0 ) + 1;
				}
			}
			$more = 500 === count( $rows );
		} while ( $more );
		$tags = array_map( 'strval', array_keys( $counts ) );
		usort(
			$tags,
			static function ( string $a, string $b ) use ( $counts ): int {
				$order = $counts[ $b ] <=> $counts[ $a ];
				return 0 !== $order ? $order : strcmp( $a, $b );
			}
		);
		$out = array();
		foreach ( array_slice( $tags, 0, $limit ) as $tag ) {
			$out[ $tag ] = $counts[ $tag ];
		}
		return $out;
	}

	/**
	 * Adds an internal note to an entry.
	 *
	 * @param int    $entry_id Entry ID.
	 * @param int    $user_id  Author.
	 * @param string $text     Note.
	 * @return int Note ID, 0 on failure.
	 */
	public function add_note( int $entry_id, int $user_id, string $text ): int {
		global $wpdb;
		$ok = $wpdb->insert(
			Schema::table( 'entry_notes' ),
			array(
				'entry_id'   => $entry_id,
				'user_id'    => $user_id,
				'note'       => $text,
				'created_at' => gmdate( 'Y-m-d H:i:s' ),
			)
		);
		return false === $ok ? 0 : (int) $wpdb->insert_id;
	}

	/**
	 * Notes of an entry, oldest first.
	 *
	 * @param int $entry_id Entry ID.
	 * @return array<int,array<string,mixed>>
	 */
	public function notes( int $entry_id ): array {
		global $wpdb;
		return (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE entry_id = %d ORDER BY id ASC', Schema::table( 'entry_notes' ), $entry_id ), ARRAY_A );
	}

	/**
	 * A note of an entry.
	 *
	 * @param int $entry_id Entry ID.
	 * @param int $id       Note ID.
	 * @return array<string,mixed>|null
	 */
	public function note( int $entry_id, int $id ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d AND entry_id = %d', Schema::table( 'entry_notes' ), $id, $entry_id ), ARRAY_A );
		return is_array( $row ) ? $row : null;
	}

	/**
	 * Deletes a note.
	 *
	 * @param int $id Note ID.
	 */
	public function delete_note( int $id ): void {
		global $wpdb;
		$wpdb->delete( Schema::table( 'entry_notes' ), array( 'id' => $id ) );
	}

	/**
	 * Entries created before a time, oldest first.
	 *
	 * @param int|null $form_id Form ID; null for entries without a form.
	 * @param string   $before  UTC time (Y-m-d H:i:s).
	 * @param int      $limit   Rows per batch.
	 * @return int[] Entry IDs.
	 */
	public function created_before( ?int $form_id, string $before, int $limit ): array {
		global $wpdb;
		$table = Schema::table( 'entries' );
		$ids   = null === $form_id
			? $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE form_id IS NULL AND created_at < %s ORDER BY id ASC LIMIT %d', $table, $before, $limit ) )
			: $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE form_id = %d AND created_at < %s ORDER BY id ASC LIMIT %d', $table, $form_id, $before, $limit ) );
		return array_map( 'intval', (array) $ids );
	}

	/**
	 * Entries whose contact data holds a value (e-mail address of a privacy request), oldest first.
	 *
	 * @param string $value Value, compared without case.
	 * @param int    $limit Rows per page.
	 * @param int    $after Last entry ID of the previous page.
	 * @return array<int,array<string,mixed>> Entries with decoded JSON columns.
	 */
	public function with_contact_value( string $value, int $limit, int $after = 0 ): array {
		global $wpdb;
		$value = strtolower( trim( $value ) );
		if ( '' === $value ) {
			return array();
		}
		$found = array();
		$more  = true;
		// The LIKE only narrows the search; each candidate is checked on its decoded contact data.
		while ( $more ) {
			$ids = array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE id > %d AND data LIKE %s ORDER BY id ASC LIMIT %d', Schema::table( 'entries' ), $after, '%' . $wpdb->esc_like( $value ) . '%', $limit ) ) );
			if ( array() === $ids ) {
				break;
			}
			foreach ( $ids as $id ) {
				$after = $id;
				$entry = $this->find( $id );
				if ( null !== $entry && self::has_contact_value( $entry, $value ) ) {
					$found[] = $entry;
					if ( count( $found ) >= $limit ) {
						break;
					}
				}
			}
			$more = count( $found ) < $limit;
		}
		return $found;
	}

	/**
	 * Whether a contact field of an entry holds the value.
	 *
	 * @param array<string,mixed> $entry Entry with decoded data.
	 * @param string              $value Lower-case value.
	 */
	private static function has_contact_value( array $entry, string $value ): bool {
		foreach ( (array) ( $entry['data']['contact'] ?? array() ) as $field ) {
			if ( is_array( $field ) && is_scalar( $field['value'] ?? null ) && strtolower( trim( (string) $field['value'] ) ) === $value ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Deletes an entry with its files, notes, delivery log and bookings. Files of entries imported from
	 * 3.x stay where 3.x keeps them (uploads/af2); only their rows go.
	 *
	 * @param int  $id                   Entry ID.
	 * @param bool $keep_future_bookings Keep bookings that have not ended yet, unlinked from the entry.
	 */
	public function delete( int $id, bool $keep_future_bookings = false ): void {
		global $wpdb;
		$files    = Schema::table( 'entry_files' );
		$bookings = Schema::table( 'bookings' );
		$imported = null !== $wpdb->get_var( $wpdb->prepare( 'SELECT legacy_post_id FROM %i WHERE id = %d', Schema::table( 'entries' ), $id ) );
		if ( ! $imported ) {
			foreach ( (array) $wpdb->get_col( $wpdb->prepare( 'SELECT path FROM %i WHERE entry_id = %d', $files, $id ) ) as $path ) {
				if ( is_string( $path ) && '' !== $path ) {
					PrivateStorage::delete( $path );
				}
			}
		}
		$wpdb->delete( $files, array( 'entry_id' => $id ) );
		$wpdb->delete( Schema::table( 'jobs_log' ), array( 'entry_id' => $id ) );
		$wpdb->delete( Schema::table( 'entry_notes' ), array( 'entry_id' => $id ) );
		if ( $keep_future_bookings ) {
			$wpdb->query( $wpdb->prepare( 'UPDATE %i SET entry_id = NULL WHERE entry_id = %d AND ends_at >= %s', $bookings, $id, gmdate( 'Y-m-d H:i:s' ) ) );
		}
		$wpdb->delete( $bookings, array( 'entry_id' => $id ) );
		$wpdb->delete( Schema::table( 'entries' ), array( 'id' => $id ) );
	}

	/**
	 * Entries whose payment has one of these statuses, created since a time, oldest first.
	 *
	 * @param string[] $statuses Payment statuses.
	 * @param string   $since    Earliest creation time, UTC (Y-m-d H:i:s).
	 * @param int      $limit    Most entries.
	 * @return array<int,array<string,mixed>>
	 */
	public function with_payment_status( array $statuses, string $since, int $limit ): array {
		global $wpdb;
		if ( array() === $statuses ) {
			return array();
		}
		$in  = implode( ', ', array_fill( 0, count( $statuses ), '%s' ) );
		$ids = $wpdb->get_col( $wpdb->prepare( "SELECT id FROM %i WHERE payment_status IN ({$in}) AND created_at >= %s ORDER BY created_at ASC LIMIT %d", Schema::table( 'entries' ), ...array_merge( $statuses, array( $since, $limit ) ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- one placeholder per status.
		return array_values( array_filter( array_map( fn( $id ) => $this->find( (int) $id ), (array) $ids ) ) );
	}
}
