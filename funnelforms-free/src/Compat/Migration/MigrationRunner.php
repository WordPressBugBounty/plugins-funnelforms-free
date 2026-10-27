<?php
/**
 * Runs the migration in the background.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Plugin;

defined( 'ABSPATH' ) || exit;

/**
 * After the update from 3.x the full import starts on its own (filter
 * funnelforms_migration_autostart) and runs as a chain of short Action Scheduler jobs, falling
 * back to WP-Cron. Once complete, an hourly delta run keeps the copy in step with 3.x until the
 * forms are switched to the new renderer.
 *
 * Before the first import a restore point of the 3.x data is written (LegacyBackup); the import
 * starts once it is done. Sites that were migrated before restore points existed get one too.
 */
final class MigrationRunner {

	public const HOOK_STEP  = 'funnelforms_migration_step';
	public const HOOK_DELTA = 'funnelforms_migration_delta';
	public const GROUP      = 'funnelforms';

	private const LOCK_OPTION = 'ffx_migration_lock';
	private const LOCK_TTL    = 300;

	/**
	 * Registers the hooks.
	 */
	public static function register(): void {
		add_action( self::HOOK_STEP, array( self::class, 'run_step' ) );
		add_action( self::HOOK_DELTA, array( self::class, 'run_delta' ) );
		add_action( 'init', array( self::class, 'maybe_schedule' ), 20 );
		add_action( 'funnelforms_backup_done', array( self::class, 'after_backup' ), 10, 2 );
		MigrationLog::register();
		AutoRenderer::register();
	}

	/**
	 * A migrator for this site.
	 */
	public static function migrator(): Migrator {
		return new Migrator(
			new LegacyRepository(),
			new MigrationStore( SecretBox::for_site() ),
			array(
				'locale'     => get_locale(),
				'plugin_url' => '' !== Plugin::file() ? plugins_url( '', Plugin::file() ) : '',
				'no_nl2br'   => 'true' === get_option( 'af2_custom_system_no_nl2br' ),
				'timezone'   => wp_timezone_string(),
			)
		);
	}

	/**
	 * Starts the first import and keeps the delta job scheduled.
	 */
	public static function maybe_schedule(): void {
		$state = Migrator::state();
		if ( 'idle' === $state['status'] ) {
			/**
			 * Whether the import of the 3.x data starts on its own after the update.
			 *
			 * @param bool $autostart Default true.
			 */
			if ( apply_filters( 'funnelforms_migration_autostart', true ) && ( new LegacyRepository() )->has_data() ) {
				self::start( 'full' );
			}
			return;
		}
		if ( LegacyBackup::required() && 'idle' === LegacyBackup::state()['status'] && ( new LegacyRepository() )->has_data() ) {
			LegacyBackup::start( 'before_migration' );
		}
		if ( null !== $state['last_sync_at'] ) {
			self::schedule_delta();
		}
	}

	/**
	 * Once the restore point is written, the import it waited for begins.
	 *
	 * @param array<string,mixed> $backup The new backup.
	 * @param string              $then   What was to follow.
	 */
	public static function after_backup( array $backup, string $then ): void {
		unset( $backup );
		if ( 'migration' === $then && 'idle' === Migrator::state()['status'] ) {
			self::start( 'full' );
		}
	}

	/**
	 * Starts a run in the background.
	 *
	 * @param string $mode full or delta.
	 */
	public static function start( string $mode ): void {
		// The first import waits for a restore point. When none could be written, the import still
		// runs (it only reads 3.x), but no form goes live on the new renderer (FormRenderer).
		if ( 'full' === $mode && LegacyBackup::required() && null === LegacyBackup::latest() && 'failed' !== LegacyBackup::state()['status'] && ( new LegacyRepository() )->has_data() ) {
			LegacyBackup::start( 'before_migration', 'migration' );
			return;
		}
		if ( ! self::lock() ) {
			return;
		}
		try {
			self::migrator()->begin( $mode );
		} finally {
			self::unlock();
		}
		self::schedule_step();
	}

	/**
	 * Action: one time-boxed step, then the next one is queued.
	 */
	public static function run_step(): void {
		if ( ! self::lock() ) {
			// Another step is running; it queues the next one.
			return;
		}
		try {
			$state = self::migrator()->step();
		} finally {
			self::unlock();
		}
		if ( 'running' === $state['status'] ) {
			self::schedule_step();
		} else {
			self::schedule_delta();
		}
	}

	/**
	 * Action: hourly delta run.
	 */
	public static function run_delta(): void {
		if ( 'running' !== Migrator::state()['status'] ) {
			self::start( 'delta' );
		}
	}

	/**
	 * Queues the next step.
	 */
	private static function schedule_step(): void {
		if ( function_exists( 'as_enqueue_async_action' ) ) {
			if ( ! as_has_scheduled_action( self::HOOK_STEP, array(), self::GROUP ) ) {
				as_enqueue_async_action( self::HOOK_STEP, array(), self::GROUP );
			}
			return;
		}
		if ( ! wp_next_scheduled( self::HOOK_STEP ) ) {
			wp_schedule_single_event( time(), self::HOOK_STEP );
		}
	}

	/**
	 * Schedules the hourly delta run once.
	 */
	private static function schedule_delta(): void {
		if ( function_exists( 'as_schedule_recurring_action' ) ) {
			if ( ! as_has_scheduled_action( self::HOOK_DELTA, array(), self::GROUP ) ) {
				as_schedule_recurring_action( time() + HOUR_IN_SECONDS, HOUR_IN_SECONDS, self::HOOK_DELTA, array(), self::GROUP );
			}
			return;
		}
		if ( ! wp_next_scheduled( self::HOOK_DELTA ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', self::HOOK_DELTA );
		}
	}

	/**
	 * Removes all scheduled jobs (uninstall).
	 */
	public static function unschedule(): void {
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			as_unschedule_all_actions( self::HOOK_STEP, array(), self::GROUP );
			as_unschedule_all_actions( self::HOOK_DELTA, array(), self::GROUP );
		}
		wp_clear_scheduled_hook( self::HOOK_STEP );
		wp_clear_scheduled_hook( self::HOOK_DELTA );
	}

	/**
	 * Takes the run lock (one migration process at a time).
	 */
	public static function lock(): bool {
		if ( add_option( self::LOCK_OPTION, (string) time(), '', false ) ) {
			return true;
		}
		$since = (int) get_option( self::LOCK_OPTION, 0 );
		if ( time() - $since > self::LOCK_TTL ) {
			delete_option( self::LOCK_OPTION );
			return add_option( self::LOCK_OPTION, (string) time(), '', false );
		}
		return false;
	}

	/**
	 * Keeps the run lock of a long process alive.
	 */
	public static function touch_lock(): void {
		update_option( self::LOCK_OPTION, (string) time(), false );
	}

	/**
	 * Releases the run lock.
	 */
	public static function unlock(): void {
		delete_option( self::LOCK_OPTION );
	}
}
