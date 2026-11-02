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
 * Each action becomes a row in ffx_jobs_log and an Action Scheduler job, so failed deliveries are
 * retried and visible.
 *
 * The first attempt runs in the same request, once the answer is out (deliver_now()), as 3.x sent
 * its mails right away: a queue that only WP-Cron works off leaves the mails and webhooks of every
 * entry waiting where WP-Cron is off (DISABLE_WP_CRON without a server cron job), its loopback
 * request is blocked or the site has few visits. Since 5.0.0 such sites stored every entry but
 * sent nothing. Where PHP can end the answer early (PHP-FPM, LiteSpeed) the visitor does not wait
 * for the mail server; otherwise the wait is the one 3.x had. The job scheduled as well is the
 * safety net: it runs later and does nothing when the first attempt was sent.
 */
class ActionQueue {

	public const HOOK  = 'funnelforms_run_action';
	public const GROUP = 'funnelforms';

	/** Seconds until the safety net runs a job whose first attempt is made in this request. */
	public const SAFETY_NET = 300;

	/**
	 * Jobs of this request whose first attempt runs once the answer is out.
	 *
	 * @var int[]
	 */
	private static array $now = array();

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
		$at_once = self::at_once();
		foreach ( $actions as $action ) {
			$job_id = $this->entries->add_job( $entry_id, (string) $action['id'] );
			if ( $job_id <= 0 ) {
				continue;
			}
			static::schedule( $job_id, $at_once ? self::SAFETY_NET : 0 );
			if ( $at_once ) {
				self::$now[] = $job_id;
			}
		}
		if ( $at_once && array() !== self::$now && false === has_action( 'shutdown', array( self::class, 'deliver_now' ) ) ) {
			// After WordPress sent the answer (wp_ob_end_flush_all at priority 1).
			add_action( 'shutdown', array( self::class, 'deliver_now' ), 100 );
		}
	}

	/**
	 * Whether the jobs of new entries get their first attempt in the same request.
	 */
	public static function at_once(): bool {
		/**
		 * Whether mails, webhooks and the other actions of a new entry are delivered in the request
		 * that stored it, after the answer (default), or only by WP-Cron or Action Scheduler.
		 *
		 * @param bool $at_once Default true.
		 */
		return (bool) apply_filters( 'funnelforms_deliver_at_once', true );
	}

	/**
	 * Jobs waiting for their first attempt in this request.
	 *
	 * @return int[]
	 */
	public static function pending(): array {
		return self::$now;
	}

	/**
	 * Runs the jobs of this request (shutdown). The answer is ended first where PHP can do that,
	 * so the visitor does not wait for the mail server or a webhook.
	 */
	public static function deliver_now(): void {
		$jobs      = self::$now;
		self::$now = array();
		if ( array() === $jobs ) {
			return;
		}
		ignore_user_abort( true );
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			fastcgi_finish_request();
		} elseif ( function_exists( 'litespeed_finish_request' ) ) {
			litespeed_finish_request();
		}
		foreach ( $jobs as $job_id ) {
			try {
				ActionRunner::create()->run( $job_id );
			} catch ( \Throwable $e ) {
				// The safety net tries again; one broken action must not keep the others back.
				unset( $e );
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
