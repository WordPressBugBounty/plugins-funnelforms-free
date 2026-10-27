<?php
/**
 * Counts of sent entries for the statistics (table ffx_entries).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Repository;

use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom table of this plugin; counts are fresh on purpose.
// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- the conditions are built from fixed SQL and placeholders, then prepared.

/**
 * An entry counts when it is complete, at the time it was sent (completed_at; created_at for
 * entries without one, such as some imported from 3.x). The condition is written so that the
 * index (status, completed_at, created_at) and its form variant find the rows; a COALESCE()
 * would read the whole table. Only counts leave this class, and the sample of meta and data for
 * averages is read in batches and never returned as a whole.
 */
final class EntryFigures {

	/** When an entry was sent. */
	private const SENT_AT = 'COALESCE(completed_at, created_at)';

	/**
	 * Which entries count: of one form (or all, with 0), sent in the period, only those the new
	 * renderer stored when asked. Written out with placeholders (where()) so no SQL is built from
	 * variables; MySQL drops the conditions a 0 switches off, so the indexes still apply.
	 */
	private const WHERE = "( %d = 0 OR form_id = %d ) AND status = 'complete' AND ((completed_at >= %s AND completed_at < %s) OR (completed_at IS NULL AND created_at >= %s AND created_at < %s)) AND ( %d = 0 OR meta LIKE %s )";

	/** Rows of meta and data read at once for the averages. */
	private const BATCH = 500;

	/**
	 * Sent entries per form and day.
	 *
	 * @param int|null $form_id Form ID, null for every form.
	 * @param string   $from    Start (UTC, inclusive).
	 * @param string   $to      End (UTC, exclusive).
	 * @param int      $offset  Seconds to add for the site's days.
	 * @param bool     $v5      Only entries the new renderer stored (not imported from 3.x).
	 * @return array<int,array{form_id: string, day: string, n: string}>
	 */
	public function daily( ?int $form_id, string $from, string $to, int $offset, bool $v5 = false ): array {
		global $wpdb;
		$where = $this->where( $form_id, $from, $to, $v5 );
		return (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT form_id, DATE(DATE_ADD(' . self::SENT_AT . ', INTERVAL %d SECOND)) AS day, COUNT(*) AS n FROM %i WHERE ' . self::WHERE . ' GROUP BY form_id, day', array_merge( array( $offset, Schema::table( 'entries' ) ), $where ) ),
			ARRAY_A
		);
	}

	/**
	 * Sent entries per device kind (desktop, tablet, mobile; empty when unknown).
	 *
	 * @param int|null $form_id Form ID, null for every form.
	 * @param string   $from    Start (UTC, inclusive).
	 * @param string   $to      End (UTC, exclusive).
	 * @param bool     $v5      Only entries the new renderer stored.
	 * @return array{desktop:int,tablet:int,mobile:int}
	 */
	public function devices( ?int $form_id, string $from, string $to, bool $v5 = false ): array {
		global $wpdb;
		$where = $this->where( $form_id, $from, $to, $v5 );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT device, COUNT(*) AS n FROM %i WHERE ' . self::WHERE . ' GROUP BY device', array_merge( array( Schema::table( 'entries' ) ), $where ) ),
			ARRAY_A
		);
		$out   = array(
			'desktop' => 0,
			'tablet'  => 0,
			'mobile'  => 0,
		);
		foreach ( $rows as $row ) {
			if ( isset( $out[ $row['device'] ] ) ) {
				$out[ $row['device'] ] = (int) $row['n'];
			}
		}
		return $out;
	}

	/**
	 * Sent entries per weekday and hour of the site's time.
	 *
	 * @param int|null $form_id Form ID, null for every form.
	 * @param string   $from    Start (UTC, inclusive).
	 * @param string   $to      End (UTC, exclusive).
	 * @param int      $offset  Seconds to add for the site's time.
	 * @param bool     $v5      Only entries the new renderer stored.
	 * @return array<int,array<int,int>> Weekday (0 Sunday to 6 Saturday) => hour (0 to 23) => count.
	 */
	public function hours( ?int $form_id, string $from, string $to, int $offset, bool $v5 = false ): array {
		global $wpdb;
		$where = $this->where( $form_id, $from, $to, $v5 );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT DAYOFWEEK(DATE_ADD(' . self::SENT_AT . ', INTERVAL %d SECOND)) AS wd, HOUR(DATE_ADD(' . self::SENT_AT . ', INTERVAL %d SECOND)) AS h, COUNT(*) AS n FROM %i WHERE ' . self::WHERE . ' GROUP BY wd, h', array_merge( array( $offset, $offset, Schema::table( 'entries' ) ), $where ) ),
			ARRAY_A
		);
		$out   = array_fill( 0, 7, array_fill( 0, 24, 0 ) );
		foreach ( $rows as $row ) {
			$out[ ( (int) $row['wd'] + 6 ) % 7 ][ (int) $row['h'] ] = (int) $row['n'];
		}
		return $out;
	}

	/**
	 * Hands meta and data of the latest sent entries of the new renderer to a callback, newest
	 * first, a batch at a time.
	 *
	 * @param int      $form_id  Form ID.
	 * @param string   $from     Start (UTC, inclusive).
	 * @param string   $to       End (UTC, exclusive).
	 * @param int      $limit    Most entries.
	 * @param callable $callback Gets meta and data, decoded (arrays).
	 * @param bool     $data     Read data as well (else it is empty).
	 * @return int Entries handed over.
	 */
	public function each( int $form_id, string $from, string $to, int $limit, callable $callback, bool $data = true ): int {
		global $wpdb;
		$where = $this->where( $form_id, $from, $to, true );
		$last  = PHP_INT_MAX;
		$seen  = 0;
		while ( $seen < $limit ) {
			$rows = (array) $wpdb->get_results(
				$wpdb->prepare( 'SELECT id, meta' . ( $data ? ', data' : '' ) . ' FROM %i WHERE ' . self::WHERE . ' AND id < %d ORDER BY id DESC LIMIT %d', array_merge( array( Schema::table( 'entries' ) ), $where, array( $last, min( self::BATCH, $limit - $seen ) ) ) ),
				ARRAY_A
			);
			foreach ( $rows as $row ) {
				$meta = json_decode( (string) $row['meta'], true );
				$more = json_decode( (string) ( $row['data'] ?? '' ), true );
				$callback( is_array( $meta ) ? $meta : array(), is_array( $more ) ? $more : array() );
				$last = (int) $row['id'];
				++$seen;
			}
			if ( count( $rows ) < self::BATCH ) {
				break;
			}
		}
		return $seen;
	}

	/**
	 * Lead values of sent entries per variant of an A/B test: how many had one, their sum and the
	 * sum of their squares (for the spread). Only the sums leave this method.
	 *
	 * @param int    $form_id    Form ID.
	 * @param string $experiment Test id.
	 * @param string $from       Start (UTC, inclusive).
	 * @param string $to         End (UTC, exclusive).
	 * @return array<string,array{n: int, sum: float, squares: float}>
	 */
	public function lead_values( int $form_id, string $experiment, string $from, string $to ): array {
		global $wpdb;
		$where = $this->where( $form_id, $from, $to, true );
		$like  = '%' . $wpdb->esc_like( '"' . $experiment . '":' ) . '%';
		$out   = array();
		$last  = PHP_INT_MAX;
		do {
			$rows  = (array) $wpdb->get_results(
				$wpdb->prepare( 'SELECT id, meta, lead_value FROM %i WHERE ' . self::WHERE . ' AND lead_value IS NOT NULL AND meta LIKE %s AND id < %d ORDER BY id DESC LIMIT %d', array_merge( array( Schema::table( 'entries' ) ), $where, array( $like, $last, self::BATCH ) ) ),
				ARRAY_A
			);
			$count = count( $rows );
			foreach ( $rows as $row ) {
				$last    = (int) $row['id'];
				$meta    = json_decode( (string) $row['meta'], true );
				$variant = is_array( $meta ) ? ( $meta['v5']['variants'][ $experiment ] ?? null ) : null;
				if ( ! is_string( $variant ) ) {
					continue;
				}
				$value           = (float) $row['lead_value'];
				$out[ $variant ] = $out[ $variant ] ?? array(
					'n'       => 0,
					'sum'     => 0.0,
					'squares' => 0.0,
				);
				++$out[ $variant ]['n'];
				$out[ $variant ]['sum']     += $value;
				$out[ $variant ]['squares'] += $value * $value;
			}
		} while ( self::BATCH === $count );
		return $out;
	}

	/**
	 * The values of WHERE for sent entries of a period.
	 *
	 * @param int|null $form_id Form ID, null for every form.
	 * @param string   $from    Start (UTC, inclusive).
	 * @param string   $to      End (UTC, exclusive).
	 * @param bool     $v5      Only entries the new renderer stored.
	 * @return list<int|string>
	 */
	private function where( ?int $form_id, string $from, string $to, bool $v5 ): array {
		global $wpdb;
		// Imported leads have no views; their meta holds "legacy" instead.
		return array( null === $form_id ? 0 : 1, (int) $form_id, $from, $to, $from, $to, $v5 ? 1 : 0, '%' . $wpdb->esc_like( '"v5":' ) . '%' );
	}
}
