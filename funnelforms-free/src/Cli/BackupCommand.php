<?php
/**
 * WP-CLI: restore points of the Funnelforms 3 data and the way back.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Cli;

use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Compat\Safety\LegacyCheck;
use Funnelforms\Compat\Safety\LegacyRestore;
use Funnelforms\Compat\Safety\Rollback;
use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Restore points of the Funnelforms 3 data, and the switch between Funnelforms 3 and 5.
 */
final class BackupCommand {

	/**
	 * Lists the restore points.
	 *
	 * @subcommand list
	 */
	public function list_(): void {
		$rows = array();
		foreach ( LegacyBackup::all() as $backup ) {
			$rows[] = array(
				'id'      => $backup['id'],
				'created' => $backup['created_at'],
				'reason'  => $backup['reason'],
				'forms'   => (int) ( $backup['counts']['af2_formular'] ?? 0 ),
				'leads'   => (int) ( $backup['counts']['af2_request'] ?? 0 ),
				'bytes'   => $backup['bytes'],
				'age'     => LegacyBackup::age_days( $backup ) . 'd',
				'ok'      => '' === LegacyBackup::problem( $backup ) ? 'yes' : LegacyBackup::problem( $backup ),
				'enc'     => LegacyBackup::encrypted( $backup ) ? 'yes' : 'no',
				'file'    => LegacyBackup::path( $backup ),
			);
		}
		\WP_CLI\Utils\format_items( 'table', $rows, array( 'id', 'created', 'reason', 'forms', 'leads', 'bytes', 'age', 'ok', 'enc', 'file' ) );
		$retired = LegacyBackup::retired();
		if ( null !== $retired ) {
			\WP_CLI::log( sprintf( 'All restore points were deleted on %s UTC (%s); none is required any more.', $retired['at'], 'age' === $retired['why'] ? 'move complete, too old' : 'on request' ) );
		}
		\WP_CLI::log( sprintf( 'Move complete: %s. Restore points older than %d days go once it is.', LegacyBackup::migration_verified() ? 'yes' : 'no', LegacyBackup::max_age() ) );
	}

	/**
	 * Compares the Funnelforms 3 data with a restore point. Only reads.
	 *
	 * ## OPTIONS
	 *
	 * <id>
	 * : ID of the restore point.
	 *
	 * @param string[] $args Arguments.
	 */
	public function check( array $args ): void {
		$state = LegacyCheck::run_now( $args[0] );
		if ( 'done' !== $state['status'] ) {
			\WP_CLI::error( 'Check failed: ' . (string) $state['error'] );
		}
		$totals = LegacyCheck::totals( $state );
		\WP_CLI::success( sprintf( 'Checked: %d rows missing, %d changed since the restore point.', $totals['missing'], $totals['changed'] ) );
	}

	/**
	 * Deletes restore points: all of them, or with --expired only those that are too old once the
	 * move is complete.
	 *
	 * ## OPTIONS
	 *
	 * [--expired]
	 * : Only the ones older than the allowed age, once the move is complete.
	 *
	 * [--yes]
	 * : Do not ask.
	 *
	 * @param string[]             $args  Arguments.
	 * @param array<string,string> $assoc Options.
	 */
	public function delete( array $args, array $assoc ): void {
		unset( $args );
		if ( isset( $assoc['expired'] ) ) {
			\WP_CLI::success( sprintf( '%d restore points deleted.', LegacyBackup::expire() ) );
			return;
		}
		\WP_CLI::confirm( 'Delete all restore points of the Funnelforms 3 data?', $assoc );
		$count = LegacyBackup::delete_all();
		if ( null === $count ) {
			\WP_CLI::error( 'A restore point is being written, checked or restored right now.' );
		}
		\WP_CLI::success( sprintf( '%d restore points deleted.', $count ) );
	}

	/**
	 * Writes a restore point now.
	 */
	public function create(): void {
		$backup = LegacyBackup::run_now( 'manual' );
		if ( null === $backup ) {
			\WP_CLI::error( 'The restore point could not be written: ' . (string) LegacyBackup::state()['error'] );
		}
		\WP_CLI::success( sprintf( 'Restore point %s written (%s).', $backup['id'], LegacyBackup::path( $backup ) ) );
	}

	/**
	 * Puts the Funnelforms 3 data back to a restore point; a restore point of the current state is
	 * written first. Rows that came in later stay.
	 *
	 * ## OPTIONS
	 *
	 * <id>
	 * : ID of the restore point.
	 *
	 * [--yes]
	 * : Do not ask.
	 *
	 * @param string[]             $args  Arguments.
	 * @param array<string,string> $assoc Options.
	 */
	public function restore( array $args, array $assoc ): void {
		\WP_CLI::confirm( 'Restore the Funnelforms 3 data from ' . $args[0] . '?', $assoc );
		$state = LegacyRestore::run_now( $args[0] );
		if ( 'done' !== $state['status'] ) {
			\WP_CLI::error( 'Restore failed: ' . (string) $state['error'] );
		}
		\WP_CLI::success( sprintf( 'Restored: %d rows put back, %d changed back, %d unchanged, %d left alone.', $state['counts']['restored'], $state['counts']['updated'], $state['counts']['unchanged'], $state['counts']['conflicts'] ) );
	}

	/**
	 * Goes back to Funnelforms 3, or forward to Funnelforms 5.
	 *
	 * ## OPTIONS
	 *
	 * <version>
	 * : 3 or 5.
	 * ---
	 * options:
	 *   - 3
	 *   - 5
	 * ---
	 *
	 * [--form=<id>]
	 * : Only this form goes back to Funnelforms 3 (ID in Funnelforms 5).
	 *
	 * @param string[]             $args  Arguments.
	 * @param array<string,string> $assoc Options.
	 */
	public function mode( array $args, array $assoc = array() ): void {
		// Free does not include Funnelforms 3, so its forms would only disappear.
		if ( '3' === $args[0] && Edition::is_free() ) {
			\WP_CLI::error( 'Funnelforms Free has no way back to Funnelforms 3: it does not include Funnelforms 3.' );
		}
		if ( '3' === $args[0] && isset( $assoc['form'] ) ) {
			$result = Rollback::form_to_legacy( (int) $assoc['form'] );
			if ( ! $result['ok'] ) {
				\WP_CLI::error( 'The form could not go back: ' . (string) $result['code'] );
			}
			\WP_CLI::success( sprintf( '"%s" runs on Funnelforms 3 again and stays there.', $result['title'] ) );
			return;
		}
		if ( '3' === $args[0] ) {
			\WP_CLI::success( sprintf( '%d forms run on Funnelforms 3 again.', Rollback::to_legacy() ) );
			return;
		}
		$result = Rollback::to_v5();
		\WP_CLI::success( sprintf( '%d forms run on Funnelforms 5 again, %d stay on Funnelforms 3.', $result['switched'], count( $result['stayed'] ) ) );
	}
}
