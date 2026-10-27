<?php
/**
 * What happened in the move from Funnelforms 3, when and by whom.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Compat\Safety\LegacyCheck;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- the audit log of this plugin, fresh on purpose.

/**
 * Writes the steps of the move into the audit log (restore points, restores, checks, the way back
 * and forward) and reads them back as a timeline, together with the import runs and the forms
 * that changed renderer. Details hold counts and codes, never personal data.
 */
final class MigrationLog {

	/** Actions shown in the timeline. */
	public const ACTIONS = array( 'migration_started', 'migration_finished', 'migration_entries_removed', 'migration_removal_held', 'migration_form_reimported', 'form_renderer', 'backup_written', 'backup_failed', 'backups_deleted', 'restore_started', 'restore_done', 'legacy_check', 'rollback', 'rollforward' );

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'funnelforms_backup_done', array( self::class, 'backup_done' ), 20, 2 );
		add_action( 'funnelforms_backup_failed', array( self::class, 'backup_failed' ), 10, 2 );
		add_action( 'funnelforms_restore_started', array( self::class, 'restore_started' ) );
		add_action( 'funnelforms_restore_done', array( self::class, 'restore_done' ), 10, 2 );
		add_action( 'funnelforms_legacy_check_done', array( self::class, 'check_done' ), 10, 2 );
		add_action( 'funnelforms_rollback', array( self::class, 'rollback' ) );
		add_action( 'funnelforms_rollforward', array( self::class, 'rollforward' ) );
		add_action( 'funnelforms_backups_deleted', array( self::class, 'backups_deleted' ), 10, 2 );
	}

	/**
	 * Restore points were deleted.
	 *
	 * @param int    $count Restore points deleted.
	 * @param string $why   age or admin.
	 */
	public static function backups_deleted( int $count, string $why ): void {
		self::write(
			'backups_deleted',
			'backup',
			'',
			array(
				'count' => $count,
				'why'   => $why,
			)
		);
	}

	/**
	 * A restore point was written.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @param string              $then   What follows.
	 */
	public static function backup_done( array $backup, string $then ): void {
		unset( $then );
		$counts = (array) $backup['counts'];
		self::write(
			'backup_written',
			'backup',
			(string) $backup['id'],
			array(
				'reason' => (string) $backup['reason'],
				'bytes'  => (int) $backup['bytes'],
				'forms'  => (int) ( $counts['af2_formular'] ?? 0 ),
				'leads'  => (int) ( $counts['af2_request'] ?? 0 ),
			)
		);
	}

	/**
	 * A restore point could not be written.
	 *
	 * @param string $error  Error code.
	 * @param string $reason Occasion.
	 */
	public static function backup_failed( string $error, string $reason ): void {
		self::write(
			'backup_failed',
			'backup',
			'',
			array(
				'error'  => $error,
				'reason' => $reason,
			)
		);
	}

	/**
	 * A restore was started.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	public static function restore_started( array $backup ): void {
		self::write( 'restore_started', 'backup', (string) $backup['id'], array( 'created_at' => (string) $backup['created_at'] ) );
	}

	/**
	 * A restore is done.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @param array<string,int>   $counts Counts.
	 */
	public static function restore_done( array $backup, array $counts ): void {
		self::write( 'restore_done', 'backup', (string) $backup['id'], array_map( 'intval', $counts ) + array( 'created_at' => (string) $backup['created_at'] ) );
	}

	/**
	 * The Funnelforms 3 data was compared with a restore point.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @param array<string,mixed> $state  Result.
	 */
	public static function check_done( array $backup, array $state ): void {
		self::write( 'legacy_check', 'backup', (string) $backup['id'], LegacyCheck::totals( $state ) + array( 'created_at' => (string) $backup['created_at'] ) );
	}

	/**
	 * The site went back to Funnelforms 3.
	 *
	 * @param int[] $forms Forms on the 3.x renderer again.
	 */
	public static function rollback( array $forms ): void {
		self::write( 'rollback', 'site', '', array( 'forms' => count( $forms ) ) );
	}

	/**
	 * The site went forward to Funnelforms 5 again.
	 *
	 * @param array{switched:int,stayed:array<int,string[]>} $result Result.
	 */
	public static function rollforward( array $result ): void {
		self::write(
			'rollforward',
			'site',
			'',
			array(
				'switched' => (int) $result['switched'],
				'stayed'   => count( $result['stayed'] ),
			)
		);
	}

	/**
	 * The timeline, newest first. Forms that changed renderer in one go (all at once, the way back)
	 * are one event.
	 *
	 * @param int $limit Events at most.
	 * @return list<array{action:string,at:string,actor:int,object:string,details:array<string,mixed>,count:int}>
	 */
	public static function timeline( int $limit = 50 ): array {
		global $wpdb;
		$in = implode( ', ', array_fill( 0, count( self::ACTIONS ), '%s' ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- one placeholder per action.
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT action, object_id, actor_id, details, created_at FROM %i WHERE action IN ({$in}) ORDER BY id DESC LIMIT %d",
				array_merge( array( Schema::table( 'audit_log' ) ), self::ACTIONS, array( $limit * 20 ) )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		$out = array();
		foreach ( $rows as $row ) {
			$details = (array) json_decode( (string) $row['details'], true );
			$event   = array(
				'action'  => (string) $row['action'],
				'at'      => (string) $row['created_at'],
				'actor'   => (int) $row['actor_id'],
				'object'  => (string) $row['object_id'],
				'details' => $details,
				'count'   => 1,
			);
			// The forms of the way back are told by that event itself.
			if ( 'form_renderer' === $event['action'] && 'rollback' === ( $details['reason'] ?? '' ) ) {
				continue;
			}
			$last = count( $out ) - 1;
			if ( 'form_renderer' === $event['action'] && $last >= 0 && self::same_switch( $out[ $last ], $event ) ) {
				++$out[ $last ]['count'];
				continue;
			}
			$out[] = $event;
			if ( count( $out ) > $limit ) {
				break;
			}
		}
		return array_slice( $out, 0, $limit );
	}

	/**
	 * Whether two renderer changes belong to one action (same direction, reason and person, within
	 * two minutes).
	 *
	 * @param array<string,mixed> $a Newer event.
	 * @param array<string,mixed> $b Older event.
	 */
	private static function same_switch( array $a, array $b ): bool {
		return 'form_renderer' === $a['action']
			&& ( $a['details']['renderer'] ?? '' ) === ( $b['details']['renderer'] ?? '' )
			&& ( $a['details']['reason'] ?? '' ) === ( $b['details']['reason'] ?? '' )
			&& $a['actor'] === $b['actor']
			&& abs( strtotime( $a['at'] . ' UTC' ) - strtotime( $b['at'] . ' UTC' ) ) <= 120;
	}

	/**
	 * Restore points that were written before this log existed, as events.
	 *
	 * @param list<array<string,mixed>> $events Events of timeline().
	 * @return list<array<string,mixed>> Events with the missing restore points, newest first.
	 */
	public static function with_backups( array $events ): array {
		$logged = array();
		foreach ( $events as $event ) {
			if ( 'backup_written' === $event['action'] ) {
				$logged[ $event['object'] ] = true;
			}
		}
		$oldest = array() === $events ? '' : (string) end( $events )['at'];
		foreach ( LegacyBackup::all() as $backup ) {
			if ( isset( $logged[ (string) $backup['id'] ] ) || ( '' !== $oldest && count( $events ) >= 50 && $backup['created_at'] < $oldest ) ) {
				continue;
			}
			$events[] = array(
				'action'  => 'backup_written',
				'at'      => (string) $backup['created_at'],
				'actor'   => 0,
				'object'  => (string) $backup['id'],
				'details' => array(
					'reason' => (string) $backup['reason'],
					'bytes'  => (int) $backup['bytes'],
					'forms'  => (int) ( $backup['counts']['af2_formular'] ?? 0 ),
					'leads'  => (int) ( $backup['counts']['af2_request'] ?? 0 ),
				),
				'count'   => 1,
			);
		}
		usort( $events, static fn( array $a, array $b ): int => strcmp( $b['at'], $a['at'] ) );
		return $events;
	}

	/**
	 * Writes one event.
	 *
	 * @param string              $action      Action.
	 * @param string              $object_type Object type.
	 * @param string              $object_id   Object ID.
	 * @param array<string,mixed> $details     Counts and codes.
	 */
	private static function write( string $action, string $object_type, string $object_id, array $details ): void {
		( new MigrationStore( SecretBox::for_site() ) )->audit( $action, $object_type, $object_id, $details );
	}
}
