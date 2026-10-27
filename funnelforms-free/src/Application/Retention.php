<?php
/**
 * Deletes entries after the retention period.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\EntryRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom tables of this plugin.

/**
 * Daily job. A form's own period (document setting retentionDays) wins; otherwise the site's
 * period applies (option funnelforms_retention_days, 0 keeps entries). Until that option is saved
 * once, the 3.x setting "auto delete leads" counts, so a site keeps the rule it had.
 *
 * Entries in the spam folder go after the site's spam days (SpamCheck), 30 unless set otherwise.
 *
 * Deleted with an entry: its files, delivery log and bookings that have ended. Copies of 3.x leads
 * are marked so the migration does not import them again; files of 3.x leads stay in uploads/af2.
 */
final class Retention {

	public const HOOK   = 'funnelforms_retention';
	public const OPTION = 'funnelforms_retention_days';

	/** Period of a new site: entries are not kept for ever unless someone chooses so. */
	public const NEW_SITE_DAYS = 365;

	private const BATCH = 200;

	/**
	 * Registers the job.
	 */
	public static function register(): void {
		add_action( self::HOOK, array( self::class, 'run' ) );
		add_action( 'init', array( self::class, 'schedule' ) );
	}

	/**
	 * Schedules the daily run once.
	 */
	public static function schedule(): void {
		if ( false === wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::HOOK );
		}
	}

	/**
	 * On activation, gives a site without any forms or entries yet the period of a new site. Sites
	 * with 3.x or 5.0 data keep their rule, so nobody loses leads by updating.
	 */
	public static function seed(): void {
		global $wpdb;
		if ( null !== get_option( self::OPTION, null ) ) {
			return;
		}
		$legacy = $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM %i WHERE post_type IN (%s, %s) LIMIT 1', $wpdb->posts, 'af2_formular', 'af2_request' ) );
		$forms  = $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM %i LIMIT 1', Schema::table( 'forms' ) ) );
		if ( null === $legacy && null === $forms ) {
			add_option( self::OPTION, self::NEW_SITE_DAYS );
		}
	}

	/**
	 * Saved value of the site's period in days.
	 *
	 * @param mixed $value Submitted value.
	 */
	public static function sanitize( $value ): int {
		return max( 0, min( 36500, (int) $value ) );
	}

	/**
	 * Cut-off of the site's period: entries created before it are deleted. Null keeps entries.
	 *
	 * @param int $now Current time.
	 */
	public static function site_cutoff( int $now ): ?string {
		$days = get_option( self::OPTION, null );
		if ( null !== $days && false !== $days ) {
			$days = (int) $days;
			return $days > 0 ? gmdate( 'Y-m-d H:i:s', $now - $days * DAY_IN_SECONDS ) : null;
		}
		// The 3.x setting (AF2_Cron_Handler::auto_delete_leads), read only.
		if ( ! get_option( 'af2_auto_delete_leads_enabled' ) ) {
			return null;
		}
		$threshold = json_decode( (string) get_option( 'af2_auto_delete_leads_threshold', '' ), true );
		$value     = (int) ( $threshold['value'] ?? 0 );
		$unit      = (string) ( $threshold['unit'] ?? '' );
		if ( $value < 1 || ! in_array( $unit, array( 'day', 'week', 'month', 'year' ), true ) ) {
			return null;
		}
		return ( new \DateTimeImmutable( '@' . $now ) )->modify( "-{$value} {$unit}" )->format( 'Y-m-d H:i:s' );
	}

	/**
	 * The site's period in days as it applies now: the saved option, else the 3.x setting
	 * (rounded to days), else 0 (entries are kept). Shown by the setup assistant.
	 */
	public static function site_days(): int {
		$days = get_option( self::OPTION, null );
		if ( null !== $days && false !== $days ) {
			return self::sanitize( $days );
		}
		if ( ! get_option( 'af2_auto_delete_leads_enabled' ) ) {
			return 0;
		}
		$threshold = json_decode( (string) get_option( 'af2_auto_delete_leads_threshold', '' ), true );
		$value     = (int) ( $threshold['value'] ?? 0 );
		$unit      = (string) ( $threshold['unit'] ?? '' );
		$per_unit  = array(
			'day'   => 1,
			'week'  => 7,
			'month' => 30,
			'year'  => 365,
		);
		return $value < 1 || ! isset( $per_unit[ $unit ] ) ? 0 : self::sanitize( $value * $per_unit[ $unit ] );
	}

	/**
	 * Cut-off of a form.
	 *
	 * @param array<string,mixed>|null $document Current document of the form.
	 * @param string|null              $site     Cut-off of the site.
	 * @param int                      $now      Current time.
	 */
	public static function form_cutoff( ?array $document, ?string $site, int $now ): ?string {
		$days = $document['settings']['retentionDays'] ?? null;
		return is_int( $days ) && $days > 0 ? gmdate( 'Y-m-d H:i:s', $now - $days * DAY_IN_SECONDS ) : $site;
	}

	/**
	 * Deletes expired entries.
	 *
	 * @param int|null $now Current time (tests).
	 * @return int Number of deleted entries.
	 */
	public static function run( $now = null ): int {
		global $wpdb;
		$now     = is_int( $now ) ? $now : time();
		$site    = self::site_cutoff( $now );
		$forms   = new FormRepository();
		$entries = new EntryRepository();
		$store   = new MigrationStore( SecretBox::for_site() );
		$deleted = array();

		$cutoffs = array();
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, current_revision_id FROM %i', Schema::table( 'forms' ) ), ARRAY_A ) as $form ) {
			$document                     = null === $form['current_revision_id'] ? null : $forms->document( (int) $form['current_revision_id'] );
			$cutoffs[ (int) $form['id'] ] = self::form_cutoff( $document, $site, $now );
		}
		$cutoffs[0] = $site;

		foreach ( $cutoffs as $form_id => $cutoff ) {
			if ( null === $cutoff ) {
				continue;
			}
			do {
				$ids = $entries->created_before( 0 === $form_id ? null : $form_id, $cutoff, self::BATCH );
				foreach ( $ids as $id ) {
					$legacy = $wpdb->get_var( $wpdb->prepare( 'SELECT legacy_post_id FROM %i WHERE id = %d', Schema::table( 'entries' ), $id ) );
					$entries->delete( $id, true );
					if ( null !== $legacy ) {
						LeadMirror::entry_deleted( (int) $legacy, 'retention' );
					}
					$deleted[ $form_id ] = ( $deleted[ $form_id ] ?? 0 ) + 1;
				}
				$more = count( $ids ) === self::BATCH;
			} while ( $more );
		}

		foreach ( $deleted as $form_id => $count ) {
			$store->audit( 'entries_expired', 'form', (string) $form_id, array( 'count' => $count ) );
		}
		$spam = self::purge_spam( $entries, $now );
		if ( $spam > 0 ) {
			$store->audit( 'spam_expired', 'entry', '', array( 'count' => $spam ) );
		}
		FormStats::purge( $now );
		return array_sum( $deleted ) + $spam;
	}

	/**
	 * Deletes the entries of the spam folder after the site's days (SpamCheck, default 30; 0
	 * keeps them).
	 *
	 * @param EntryRepository $entries Entries.
	 * @param int             $now     Current time.
	 * @return int Number of deleted entries.
	 */
	private static function purge_spam( EntryRepository $entries, int $now ): int {
		$days = SpamCheck::settings()['spamDays'];
		if ( $days < 1 ) {
			return 0;
		}
		$count = 0;
		do {
			$ids  = $entries->spam_before( gmdate( 'Y-m-d H:i:s', $now - $days * DAY_IN_SECONDS ), self::BATCH );
			$more = count( $ids ) === self::BATCH;
			foreach ( $ids as $id ) {
				$entries->delete( $id );
				++$count;
			}
		} while ( $more );
		return $count;
	}
}
