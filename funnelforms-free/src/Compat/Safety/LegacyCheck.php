<?php
/**
 * Compares the Funnelforms 3 data with a restore point.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Safety;

use Funnelforms\Compat\Legacy\LegacyRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- compares the rows exactly as stored, on purpose without caches.

/**
 * Reads a restore point row by row and looks each row up as it is now: still there and the same,
 * changed since, missing, or its ID taken by something that is not Funnelforms 3 data. Only reads.
 *
 * Missing rows are what a damaged Funnelforms 3 installation shows (deleted forms, questions,
 * leads or settings); a restore brings back exactly the missing and changed rows. Rows that came
 * in after the restore point are not part of it and are not counted. Runs in short steps, so the
 * page can show its progress on large sites.
 */
final class LegacyCheck {

	public const STATE = 'funnelforms_legacy_check';

	/** Rows looked up per query. */
	private const BATCH = 200;

	/**
	 * State: status idle, running, done or failed, with the counts per kind of row.
	 *
	 * @return array{status:string,backup:string,offset:int,rows:int,total:int,counts:array<string,array<string,int>>,started:string,finished:string,error:string}
	 */
	public static function state(): array {
		$state           = get_option( self::STATE, array() );
		$state           = ( is_array( $state ) ? $state : array() ) + array(
			'status'   => 'idle',
			'backup'   => '',
			'offset'   => 0,
			'rows'     => 0,
			'total'    => 0,
			'counts'   => array(),
			'started'  => '',
			'finished' => '',
			'error'    => '',
		);
		$state['counts'] = (array) $state['counts'];
		return $state;
	}

	/**
	 * Starts a check against a restore point.
	 *
	 * @param string $id Backup ID.
	 * @return string Empty when started, else an error code.
	 */
	public static function start( string $id ): string {
		$backup = LegacyBackup::find( $id );
		if ( null === $backup ) {
			return 'backup_not_found';
		}
		$problem = LegacyBackup::problem( $backup );
		if ( '' !== $problem ) {
			return 'locked' === $problem ? 'backup_locked' : 'backup_damaged';
		}
		update_option(
			self::STATE,
			array(
				'status'   => 'running',
				'backup'   => $id,
				'offset'   => 0,
				'rows'     => 0,
				'total'    => LegacyBackup::rows_total( $backup ),
				'counts'   => array(),
				'started'  => gmdate( 'Y-m-d H:i:s' ),
				'finished' => '',
				'error'    => '',
			),
			false
		);
		return '';
	}

	/**
	 * Compares for a few seconds.
	 *
	 * @param float $seconds Time budget.
	 * @return array<string,mixed> State.
	 */
	public static function step( float $seconds = 4.0 ): array {
		if ( ! LegacyBackup::lock( 'funnelforms_check_lock' ) ) {
			return self::state();
		}
		try {
			return self::compare( $seconds );
		} finally {
			LegacyBackup::unlock( 'funnelforms_check_lock' );
		}
	}

	/**
	 * Compares the whole restore point now (WP-CLI, tests).
	 *
	 * @param string $id Backup ID.
	 * @return array<string,mixed> State.
	 */
	public static function run_now( string $id ): array {
		$error = self::start( $id );
		if ( '' !== $error ) {
			return array(
				'status' => 'failed',
				'error'  => $error,
			) + self::state();
		}
		do {
			$state = self::step( 30.0 );
		} while ( 'running' === $state['status'] );
		return $state;
	}

	/**
	 * Totals over all kinds of rows.
	 *
	 * @param array<string,mixed> $state State.
	 * @return array{same:int,changed:int,missing:int,other:int}
	 */
	public static function totals( array $state ): array {
		$out = array(
			'same'    => 0,
			'changed' => 0,
			'missing' => 0,
			'other'   => 0,
		);
		foreach ( (array) $state['counts'] as $counts ) {
			foreach ( $out as $key => $value ) {
				$out[ $key ] = $value + (int) ( $counts[ $key ] ?? 0 );
			}
		}
		return $out;
	}

	/**
	 * Compares for a few seconds, under the lock.
	 *
	 * @param float $seconds Time budget.
	 * @return array<string,mixed> State.
	 */
	private static function compare( float $seconds ): array {
		$state = self::state();
		if ( 'running' !== $state['status'] ) {
			return $state;
		}
		$backup = LegacyBackup::find( (string) $state['backup'] );
		if ( null === $backup || ! is_readable( LegacyBackup::path( $backup ) ) ) {
			$state['status'] = 'failed';
			$state['error']  = 'backup_not_found';
			update_option( self::STATE, $state, false );
			return $state;
		}
		$until = microtime( true ) + $seconds;
		$batch = array();
		$done  = true;
		foreach ( LegacyBackup::rows( $backup, (int) $state['offset'] ) as $row ) {
			if ( in_array( $row['t'], array( 'post', 'meta', 'option' ), true ) ) {
				$batch[] = $row;
			}
			if ( count( $batch ) >= self::BATCH || 'end' === $row['t'] ) {
				self::batch( $batch, $state );
				$batch           = array();
				$state['offset'] = $row['next'];
				if ( microtime( true ) >= $until && 'end' !== $row['t'] ) {
					$done = false;
					break;
				}
			}
		}
		if ( array() !== $batch ) {
			self::batch( $batch, $state );
		}
		if ( $done ) {
			$state['status']   = 'done';
			$state['finished'] = gmdate( 'Y-m-d H:i:s' );

			/**
			 * After the Funnelforms 3 data was compared with a restore point.
			 *
			 * @param array<string,mixed> $backup Backup.
			 * @param array<string,mixed> $state  Result with the counts per kind of row.
			 */
			do_action( 'funnelforms_legacy_check_done', $backup, $state );
		}
		update_option( self::STATE, $state, false );
		return $state;
	}

	/**
	 * Looks up one batch of rows.
	 *
	 * @param list<array{t:string,r:array<string,mixed>}> $rows  Rows of the backup.
	 * @param array<string,mixed>                         $state State, updated.
	 */
	private static function batch( array $rows, array &$state ): void {
		global $wpdb;
		$by = array(
			'post'   => array(),
			'meta'   => array(),
			'option' => array(),
		);
		foreach ( $rows as $row ) {
			$by[ $row['t'] ][] = $row['r'];
		}
		if ( array() !== $by['post'] ) {
			$ids = array_map( static fn( array $r ): int => (int) $r['ID'], $by['post'] );
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- one placeholder per ID.
			$now = self::keyed( (array) $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$wpdb->posts} WHERE ID IN (" . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ')', $ids ), ARRAY_A ), 'ID' );
			foreach ( $by['post'] as $row ) {
				$current = $now[ (int) $row['ID'] ] ?? null;
				$type    = in_array( $row['post_type'] ?? '', LegacyRepository::ALL_TYPES, true ) ? (string) $row['post_type'] : 'other';
				self::count( $state, $type, self::verdict( $row, $current, null === $current || $current['post_type'] === $row['post_type'] ) );
			}
		}
		if ( array() !== $by['meta'] ) {
			$ids = array_map( static fn( array $r ): int => (int) $r['meta_id'], $by['meta'] );
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- one placeholder per ID.
			$now = self::keyed( (array) $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$wpdb->postmeta} WHERE meta_id IN (" . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ')', $ids ), ARRAY_A ), 'meta_id' );
			foreach ( $by['meta'] as $row ) {
				$current = $now[ (int) $row['meta_id'] ] ?? null;
				self::count( $state, 'meta', self::verdict( $row, $current, null === $current || (int) $current['post_id'] === (int) $row['post_id'] ) );
			}
		}
		if ( array() !== $by['option'] ) {
			$names = array_map( static fn( array $r ): string => (string) $r['option_name'], $by['option'] );
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- one placeholder per name.
			$now = self::keyed( (array) $wpdb->get_results( $wpdb->prepare( "SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name IN (" . implode( ', ', array_fill( 0, count( $names ), '%s' ) ) . ')', $names ), ARRAY_A ), 'option_name' );
			foreach ( $by['option'] as $row ) {
				$current = $now[ (string) $row['option_name'] ] ?? null;
				$verdict = null === $current ? 'missing' : ( (string) $current['option_value'] === (string) $row['option_value'] ? 'same' : 'changed' );
				self::count( $state, 'options', $verdict );
			}
		}
		$state['rows'] = (int) $state['rows'] + count( $rows );
	}

	/**
	 * Rows by a column.
	 *
	 * @param array<int,array<string,mixed>> $rows   Rows.
	 * @param string                         $column Column.
	 * @return array<int|string,array<string,mixed>>
	 */
	private static function keyed( array $rows, string $column ): array {
		$out = array();
		foreach ( $rows as $row ) {
			$out[ $row[ $column ] ] = $row;
		}
		return $out;
	}

	/**
	 * Whether a row is the same, changed, missing, or its ID now belongs to something else.
	 *
	 * @param array<string,mixed>      $row     Row of the backup.
	 * @param array<string,mixed>|null $current Row now.
	 * @param bool                     $ours    Whether the row now is still the same object.
	 */
	private static function verdict( array $row, ?array $current, bool $ours ): string {
		if ( null === $current ) {
			return 'missing';
		}
		if ( ! $ours ) {
			return 'other';
		}
		$row = array_intersect_key( $row, $current );
		return array_diff_assoc( array_map( 'strval', $row ), array_map( 'strval', array_intersect_key( $current, $row ) ) ) === array() ? 'same' : 'changed';
	}

	/**
	 * Counts one verdict.
	 *
	 * @param array<string,mixed> $state   State, updated.
	 * @param string              $kind    Post type, meta or options.
	 * @param string              $verdict same, changed, missing or other.
	 */
	private static function count( array &$state, string $kind, string $verdict ): void {
		$state['counts'][ $kind ][ $verdict ] = (int) ( $state['counts'][ $kind ][ $verdict ] ?? 0 ) + 1;
	}
}
