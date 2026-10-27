<?php
/**
 * Restores the Funnelforms 3 data from a backup.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Safety;

use Funnelforms\Application\LeadMirror;
use Funnelforms\Compat\Legacy\LegacyRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- writes the rows back exactly as the backup holds them.

/**
 * Puts the 3.x data back to the state of a backup: rows that are missing come back with their
 * IDs, rows that changed get their former values. Nothing that is newer than the backup is
 * deleted (leads that came in later stay). A row whose ID is taken by something that is not 3.x
 * data is left alone and counted as a conflict.
 *
 * Before it writes anything, a new backup of the current state is made, so a restore can be
 * undone too. Runs in short steps like the backup.
 */
final class LegacyRestore {

	public const HOOK  = 'funnelforms_restore_step';
	public const STATE = 'funnelforms_restore_state';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( self::HOOK, array( self::class, 'run_step' ) );
		add_action( 'funnelforms_backup_done', array( self::class, 'after_backup' ), 10, 2 );
	}

	/**
	 * State: status idle, backing_up, running, done or failed, with the counts.
	 *
	 * @return array<string,mixed>
	 */
	public static function state(): array {
		$state = get_option( self::STATE, array() );
		return ( is_array( $state ) ? $state : array() ) + array(
			'status'   => 'idle',
			'backup'   => '',
			'offset'   => 0,
			'rows'     => 0,
			'started'  => '',
			'finished' => '',
			'counts'   => array(
				'restored'  => 0,
				'updated'   => 0,
				'unchanged' => 0,
				'conflicts' => 0,
			),
			'error'    => '',
		);
	}

	/**
	 * Starts restoring a backup: first a backup of the state now, then the restore.
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
		if ( in_array( self::state()['status'], array( 'backing_up', 'running' ), true ) || LegacyBackup::running() ) {
			return 'busy';
		}
		update_option(
			self::STATE,
			array(
				'status'  => 'backing_up',
				'backup'  => $id,
				'started' => gmdate( 'Y-m-d H:i:s' ),
			) + self::defaults(),
			false
		);
		if ( ! LegacyBackup::start( 'before_restore', 'restore:' . $id ) ) {
			update_option(
				self::STATE,
				array(
					'status' => 'failed',
					'error'  => 'backup_failed',
				) + self::state(),
				false
			);
			return 'backup_failed';
		}

		/**
		 * After a restore of the Funnelforms 3 data was started (its safety backup is written first).
		 *
		 * @param array<string,mixed> $backup Backup that is restored.
		 */
		do_action( 'funnelforms_restore_started', $backup );
		return '';
	}

	/**
	 * Once the safety backup is written, the restore begins.
	 *
	 * @param array<string,mixed> $backup The new backup.
	 * @param string              $then   What was to follow.
	 */
	public static function after_backup( array $backup, string $then ): void {
		unset( $backup );
		if ( ! str_starts_with( $then, 'restore:' ) || 'backing_up' !== self::state()['status'] ) {
			return;
		}
		update_option( self::STATE, array( 'status' => 'running' ) + self::state(), false );
		self::schedule();
	}

	/**
	 * Action: one step, then the next one.
	 */
	public static function run_step(): void {
		if ( 'running' === self::step()['status'] ) {
			self::schedule();
		}
	}

	/**
	 * Restores for a few seconds.
	 *
	 * @param float $seconds Time budget.
	 * @return array<string,mixed> State.
	 */
	public static function step( float $seconds = 8.0 ): array {
		if ( ! LegacyBackup::lock( 'funnelforms_restore_lock' ) ) {
			return self::state();
		}
		try {
			return self::apply( $seconds );
		} finally {
			LegacyBackup::unlock( 'funnelforms_restore_lock' );
		}
	}

	/**
	 * Restores for a few seconds, under the lock.
	 *
	 * @param float $seconds Time budget.
	 * @return array<string,mixed> State.
	 */
	private static function apply( float $seconds ): array {
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
		$until  = microtime( true ) + $seconds;
		$done   = true;
		$erased = array_flip( LeadMirror::erased() );
		foreach ( LegacyBackup::rows( $backup, (int) $state['offset'] ) as $row ) {
			// Leads erased on a privacy request stay erased.
			$post   = (int) ( $row['r']['ID'] ?? $row['r']['post_id'] ?? 0 );
			$result = in_array( $row['t'], array( 'post', 'meta' ), true ) && isset( $erased[ $post ] ) ? 'conflicts' : match ( $row['t'] ) {
				'post'   => self::post( $row['r'] ),
				'meta'   => self::meta( $row['r'] ),
				'option' => self::option( $row['r'] ),
				default  => '',
			};
			if ( '' !== $result ) {
				$state['counts'][ $result ] = (int) ( $state['counts'][ $result ] ?? 0 ) + 1;
			}
			$state['offset'] = $row['next'];
			$state['rows']   = (int) $state['rows'] + 1;
			if ( microtime( true ) >= $until ) {
				$done = false;
				break;
			}
		}
		if ( $done ) {
			$state['status']   = 'done';
			$state['finished'] = gmdate( 'Y-m-d H:i:s' );
			wp_cache_flush();
			/**
			 * After the Funnelforms 3 data was restored from a backup.
			 *
			 * @param array<string,mixed> $backup Backup.
			 * @param array<string,int>   $counts Restored, updated, unchanged and conflicting rows.
			 */
			do_action( 'funnelforms_restore_done', $backup, $state['counts'] );
		}
		update_option( self::STATE, $state, false );
		return $state;
	}

	/**
	 * Restores the whole backup now (WP-CLI, tests).
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
		while ( LegacyBackup::running() ) {
			LegacyBackup::step( 30.0 );
		}
		do {
			$state = self::step( 30.0 );
		} while ( 'running' === $state['status'] );
		return $state;
	}

	/**
	 * Puts a post back.
	 *
	 * @param array<string,mixed> $row Row of wp_posts.
	 * @return string restored, updated, unchanged or conflicts.
	 */
	private static function post( array $row ): string {
		global $wpdb;
		if ( ! in_array( $row['post_type'] ?? '', LegacyRepository::ALL_TYPES, true ) ) {
			return 'conflicts';
		}
		$id  = (int) $row['ID'];
		$now = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->posts} WHERE ID = %d", $id ), ARRAY_A );
		$row = array_intersect_key( $row, self::columns( $wpdb->posts ) );
		if ( null === $now ) {
			$wpdb->insert( $wpdb->posts, $row );
			clean_post_cache( $id );
			return 'restored';
		}
		if ( $now['post_type'] !== $row['post_type'] ) {
			return 'conflicts';
		}
		if ( array_diff_assoc( array_map( 'strval', $row ), array_map( 'strval', $now ) ) === array() ) {
			return 'unchanged';
		}
		$wpdb->update( $wpdb->posts, $row, array( 'ID' => $id ) );
		clean_post_cache( $id );
		return 'updated';
	}

	/**
	 * Puts a meta row back.
	 *
	 * @param array<string,mixed> $row Row of wp_postmeta.
	 * @return string restored, updated, unchanged or conflicts.
	 */
	private static function meta( array $row ): string {
		global $wpdb;
		$now = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->postmeta} WHERE meta_id = %d", (int) $row['meta_id'] ), ARRAY_A );
		$row = array_intersect_key( $row, self::columns( $wpdb->postmeta ) );
		if ( null === $now ) {
			$wpdb->insert( $wpdb->postmeta, $row );
			wp_cache_delete( (int) $row['post_id'], 'post_meta' );
			return 'restored';
		}
		if ( (int) $now['post_id'] !== (int) $row['post_id'] ) {
			return 'conflicts';
		}
		if ( (string) $now['meta_key'] === (string) $row['meta_key'] && (string) $now['meta_value'] === (string) $row['meta_value'] ) {
			return 'unchanged';
		}
		$wpdb->update( $wpdb->postmeta, $row, array( 'meta_id' => (int) $row['meta_id'] ) );
		wp_cache_delete( (int) $row['post_id'], 'post_meta' );
		return 'updated';
	}

	/**
	 * Puts an option back, with its stored (serialized) value.
	 *
	 * @param array<string,mixed> $row option_name, option_value, autoload.
	 * @return string restored, updated or unchanged.
	 */
	private static function option( array $row ): string {
		global $wpdb;
		$name = (string) $row['option_name'];
		if ( ! str_starts_with( $name, 'af2_' ) && ! in_array( $name, LegacyBackup::OPTIONS, true ) ) {
			return 'conflicts';
		}
		// get_var() cannot tell an empty value from a missing row.
		$now = $wpdb->get_row( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $name ), ARRAY_A );
		if ( null === $now ) {
			$wpdb->insert(
				$wpdb->options,
				array(
					'option_name'  => $name,
					'option_value' => (string) $row['option_value'],
					'autoload'     => (string) ( $row['autoload'] ?? 'yes' ),
				)
			);
			$result = 'restored';
		} elseif ( (string) $now['option_value'] === (string) $row['option_value'] ) {
			return 'unchanged';
		} else {
			$wpdb->update( $wpdb->options, array( 'option_value' => (string) $row['option_value'] ), array( 'option_name' => $name ) );
			$result = 'updated';
		}
		wp_cache_delete( $name, 'options' );
		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
		return $result;
	}

	/**
	 * Columns of a table.
	 *
	 * @param string $table Table.
	 * @return array<string,true>
	 */
	private static function columns( string $table ): array {
		static $cache = array();
		if ( ! isset( $cache[ $table ] ) ) {
			$cache[ $table ] = array_fill_keys( (array) $GLOBALS['wpdb']->get_col( "SHOW COLUMNS FROM `{$table}`" ), true ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name of WordPress.
		}
		return $cache[ $table ];
	}

	/**
	 * Fresh state values.
	 *
	 * @return array<string,mixed>
	 */
	private static function defaults(): array {
		return array(
			'offset'   => 0,
			'rows'     => 0,
			'finished' => '',
			'counts'   => array(
				'restored'  => 0,
				'updated'   => 0,
				'unchanged' => 0,
				'conflicts' => 0,
			),
			'error'    => '',
		);
	}

	/**
	 * Queues the next step.
	 */
	private static function schedule(): void {
		if ( function_exists( 'as_enqueue_async_action' ) ) {
			if ( ! as_has_scheduled_action( self::HOOK, array(), 'funnelforms' ) ) {
				as_enqueue_async_action( self::HOOK, array(), 'funnelforms' );
			}
			return;
		}
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_single_event( time(), self::HOOK );
		}
	}
}
