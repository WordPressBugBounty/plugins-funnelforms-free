<?php
/**
 * Queues the mails and webhooks of new entries.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Actions;

use Funnelforms\Infrastructure\Repository\EntryRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Each action becomes a row in ffx_jobs_log and an Action Scheduler job, so a slow mail server or
 * webhook receiver never delays the visitor and failed deliveries are retried and visible.
 */
class ActionQueue {

	public const HOOK  = 'funnelforms_run_action';
	public const GROUP = 'funnelforms';

	/**
	 * Creates the queue.
	 *
	 * @param EntryRepository $entries Entries.
	 */
	public function __construct( private EntryRepository $entries ) {}

	/**
	 * Registers the job hook.
	 */
	public static function register(): void {
		add_action( self::HOOK, array( self::class, 'run' ) );
	}

	/**
	 * Job callback.
	 *
	 * @param int|string $job_id Job ID.
	 */
	public static function run( $job_id ): void {
		ActionRunner::create()->run( (int) $job_id );
	}

	/**
	 * Adds one job per action.
	 *
	 * @param int                            $entry_id Entry ID.
	 * @param array<int,array<string,mixed>> $actions  Actions of the document.
	 */
	public function enqueue( int $entry_id, array $actions ): void {
		foreach ( $actions as $action ) {
			$job_id = $this->entries->add_job( $entry_id, (string) $action['id'] );
			if ( $job_id > 0 ) {
				static::schedule( $job_id, 0 );
			}
		}
	}

	/**
	 * Adds one job that runs later (appointment reminders).
	 *
	 * @param int    $entry_id Entry ID.
	 * @param string $channel  Job channel.
	 * @param int    $delay    Seconds from now.
	 */
	public function later( int $entry_id, string $channel, int $delay ): void {
		// The job counts as waiting from when it is due (Site Health warns about jobs that wait long).
		$job_id = $this->entries->add_job( $entry_id, $channel, gmdate( 'Y-m-d H:i:s', time() + max( 0, $delay ) ) );
		if ( $job_id > 0 ) {
			static::schedule( $job_id, max( 0, $delay ) );
		}
	}

	/**
	 * Schedules a job run.
	 *
	 * @param int $job_id Job ID.
	 * @param int $delay  Seconds from now.
	 */
	public static function schedule( int $job_id, int $delay ): void {
		if ( function_exists( 'as_schedule_single_action' ) ) {
			as_schedule_single_action( time() + $delay, self::HOOK, array( $job_id ), self::GROUP );
			return;
		}
		wp_schedule_single_event( time() + $delay, self::HOOK, array( $job_id ) );
	}
}
