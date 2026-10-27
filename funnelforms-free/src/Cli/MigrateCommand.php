<?php
/**
 * WP-CLI: wp funnelforms migration.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Cli;

use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\AutoRenderer;
use Funnelforms\Compat\Migration\MigrationReport;
use Funnelforms\Compat\Migration\MigrationRunner;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Compat\Migration\Migrator;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use WP_CLI;

defined( 'ABSPATH' ) || exit;

/**
 * Imports Funnelforms 3.x forms, leads and bookings into the 5.0 tables.
 */
final class MigrateCommand {

	/**
	 * Shows the state of the import and what it found.
	 *
	 * ## EXAMPLES
	 *
	 *     wp funnelforms migration status
	 *
	 * @param array<int,string>    $args       Positional arguments.
	 * @param array<string,string> $assoc_args Options.
	 */
	public function status( array $args, array $assoc_args ): void {
		$state = Migrator::state();
		WP_CLI::log( sprintf( 'Status: %s (%s run), phase %s', $state['status'], $state['mode'], Migrator::PHASES[ $state['phase'] ] ?? 'none' ) );
		WP_CLI::log( sprintf( 'Last completed sync: %s UTC', $state['last_sync_at'] ?? 'never' ) );

		$legacy = ( new LegacyRepository() )->counts();
		$done   = ( new MigrationStore( SecretBox::for_site() ) )->summary();
		$rows   = array();
		foreach ( array( LegacyRepository::FORM, LegacyRepository::LEAD, LegacyRepository::BOOKING, LegacyRepository::BOOKING_TYPE ) as $type ) {
			$row = array(
				'type'  => $type,
				'in_3x' => array_sum( $legacy[ $type ] ?? array() ),
			);
			foreach ( array( 'verified', 'needs_review', 'migrated', 'failed' ) as $status ) {
				$row[ $status ] = $done[ $type ][ $status ] ?? 0;
			}
			$rows[] = $row;
		}
		WP_CLI\Utils\format_items( $assoc_args['format'] ?? 'table', $rows, array( 'type', 'in_3x', 'verified', 'needs_review', 'migrated', 'failed' ) );

		// Whether everything arrived: what the migration page shows as "checked".
		$data = array();
		foreach ( MigrationReport::data() as $kind => $counts ) {
			$data[] = array( 'kind' => $kind ) + $counts + array( 'complete' => $counts['ok'] ? 'yes' : 'NO' );
		}
		WP_CLI::log( '' );
		WP_CLI\Utils\format_items( $assoc_args['format'] ?? 'table', $data, array( 'kind', 'legacy', 'copied', 'verified', 'review', 'failed', 'missing', 'pending', 'complete' ) );
		WP_CLI::log( sprintf( 'Checked forms move to the new renderer on their own: %s', AutoRenderer::enabled() ? 'on' : 'off' ) );
	}

	/**
	 * Runs the import in this process.
	 *
	 * ## OPTIONS
	 *
	 * [--mode=<mode>]
	 * : full imports everything again (unchanged items are skipped), delta only what changed.
	 * ---
	 * default: full
	 * options:
	 *   - full
	 *   - delta
	 * ---
	 *
	 * [--batch=<size>]
	 * : Posts per batch.
	 * ---
	 * default: 200
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp funnelforms migration run
	 *     wp funnelforms migration run --mode=delta
	 *
	 * @param array<int,string>    $args       Positional arguments.
	 * @param array<string,string> $assoc_args Options.
	 */
	public function run( array $args, array $assoc_args ): void {
		if ( ! MigrationRunner::lock() ) {
			WP_CLI::error( 'Another migration run is active. Try again in a few minutes.' );
		}
		try {
			$migrator = MigrationRunner::migrator();
			$state    = $migrator->begin( $assoc_args['mode'] ?? 'full' );
			$phase    = -1;
			while ( 'running' === $state['status'] ) {
				if ( $phase !== $state['phase'] ) {
					$phase = $state['phase'];
					WP_CLI::log( 'Phase: ' . ( Migrator::PHASES[ $phase ] ?? 'finishing' ) );
				}
				$state = $migrator->step( max( 1, (int) ( $assoc_args['batch'] ?? 200 ) ), 30.0 );
				MigrationRunner::touch_lock();
			}
		} finally {
			MigrationRunner::unlock();
		}
		$this->status( array(), array() );
		WP_CLI::success( 'Migration run complete.' );
	}

	/**
	 * Lists the forms with their verification result.
	 *
	 * ## OPTIONS
	 *
	 * [--status=<status>]
	 * : Only forms with this result (verified, needs_review, failed).
	 *
	 * [--format=<format>]
	 * : table, json or csv.
	 * ---
	 * default: table
	 * ---
	 *
	 * @param array<int,string>    $args       Positional arguments.
	 * @param array<string,string> $assoc_args Options.
	 */
	public function report( array $args, array $assoc_args ): void {
		$rows = array();
		foreach ( MigrationReport::forms() as $form ) {
			if ( isset( $assoc_args['status'] ) && $assoc_args['status'] !== $form['check'] ) {
				continue;
			}
			$problems = array();
			foreach ( $form['checks'] as $name => $check ) {
				foreach ( (array) ( $check['details'] ?? array() ) as $detail ) {
					$problems[] = $name . ': ' . $detail;
				}
			}
			$rows[] = array(
				'legacy_id' => $form['legacy_id'],
				'form_id'   => $form['id'],
				'status'    => $form['check'],
				'state'     => $form['state'] . ( $form['pinned'] ? ' (kept on 3)' : '' ) . ( $form['auto'] ? ' (moved on its own)' : '' ),
				'renderer'  => $form['renderer'],
				'blockers'  => implode( ', ', $form['blockers'] ),
				'problems'  => implode( ' | ', $problems ),
				'notes'     => implode( ', ', $form['notes'] ),
			);
		}
		WP_CLI\Utils\format_items( $assoc_args['format'] ?? 'table', $rows, array( 'legacy_id', 'form_id', 'status', 'state', 'renderer', 'blockers', 'problems', 'notes' ) );
	}

	/**
	 * Imports one Funnelforms 3 form again and checks it again; a version changed in the form
	 * builder is kept.
	 *
	 * ## OPTIONS
	 *
	 * <legacy_id>
	 * : ID of the form in Funnelforms 3.
	 *
	 * ## EXAMPLES
	 *
	 *     wp funnelforms migration reimport 635
	 *
	 * @param array<int,string> $args Positional arguments.
	 */
	public function reimport( array $args ): void {
		if ( 'running' === Migrator::state()['status'] || ! MigrationRunner::lock() ) {
			WP_CLI::error( 'Another migration run is active. Try again in a few minutes.' );
		}
		try {
			$status = MigrationRunner::migrator()->reimport_form( (int) $args[0] );
		} finally {
			MigrationRunner::unlock();
		}
		if ( 'not_found' === $status ) {
			WP_CLI::error( 'There is no Funnelforms 3 form with this ID.' );
		}
		$moved = AutoRenderer::apply();
		WP_CLI::success( sprintf( 'Imported again: %s.%s', $status, $moved > 0 ? ' It runs on the new renderer now.' : '' ) );
	}

	/**
	 * Switches the automatic move of checked forms to the new renderer on or off. Off puts back
	 * on Funnelforms 3 exactly the forms it moved.
	 *
	 * ## OPTIONS
	 *
	 * <state>
	 * : on or off.
	 * ---
	 * options:
	 *   - on
	 *   - off
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp funnelforms migration auto off
	 *
	 * @param array<int,string> $args Positional arguments.
	 */
	public function auto( array $args ): void {
		$on    = 'on' === $args[0];
		$count = AutoRenderer::set( $on );
		$wait  = AutoRenderer::waiting();
		WP_CLI::success(
			$on
				? sprintf( 'On. %d forms moved to the new renderer.%s', $count, '' !== $wait && 'off' !== $wait ? ' Waiting: ' . $wait . '.' : '' )
				: sprintf( 'Off. %d forms are back on Funnelforms 3.', $count )
		);
	}
}
