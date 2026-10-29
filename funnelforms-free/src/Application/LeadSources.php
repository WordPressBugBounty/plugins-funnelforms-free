<?php
/**
 * Where a lead came from: source, medium and campaign stored with the entry.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Compat\Migration\EntryConverter;
use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

/**
 * The statistics count views and sent forms per source from the events (FormStats); what happens to
 * a lead afterwards (won, its value) lives on the entry. So the entry keeps its source as well: the
 * source of its page view when the runtime reported one (it knows the referrer), else its UTM values
 * or ad click id (TrafficSources::detect()). Both editions store it, so Pro shows the history at
 * once. Nothing else of the addresses is kept.
 */
final class LeadSources {

	/** Entries the upgrade to schema version 23 fills in at most, newest first. */
	public const BACKFILL_LIMIT = 5000;

	/** Seconds the upgrade spends on it at most; it runs in the first request after the update. */
	public const BACKFILL_SECONDS = 5;

	/**
	 * Stores the source of a sent entry.
	 *
	 * @param int                                     $entry_id Entry ID; nothing happens without one.
	 * @param array{source:string,medium:string}|null $source   Source of the page view (FormStats::completed()).
	 * @param string                                  $query    Query string of the page the form was sent on.
	 */
	public static function note( int $entry_id, ?array $source, string $query ): void {
		if ( $entry_id <= 0 ) {
			return;
		}
		$found = self::of( $source, EntryConverter::utm( $query ) );
		if ( array( '', '', '' ) === array_values( $found ) ) {
			return;
		}
		global $wpdb;
		$wpdb->update( Schema::table( 'entries' ), $found, array( 'id' => $entry_id ), array( '%s', '%s', '%s' ), array( '%d' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- this plugin's table.
	}

	/**
	 * Source, medium and campaign of a lead.
	 *
	 * @param array{source:string,medium:string}|null $source Source of the page view, if the runtime reported one.
	 * @param array<string,string>                    $utm    UTM values and ad click ids of the page (EntryConverter::utm()).
	 * @return array{source:string,medium:string,campaign:string}
	 */
	public static function of( ?array $source, array $utm ): array {
		$detected = TrafficSources::detect( '', '?' . http_build_query( $utm ), array() ) ?? array();
		$campaign = (string) ( $detected['campaign'] ?? '' );
		if ( null !== $source && ( '' !== $source['source'] || '' !== $source['medium'] ) ) {
			return array(
				'source'   => $source['source'],
				'medium'   => $source['medium'],
				'campaign' => $campaign,
			);
		}
		return array(
			'source'   => (string) ( $detected['source'] ?? '' ),
			'medium'   => (string) ( $detected['medium'] ?? '' ),
			'campaign' => $campaign,
		);
	}

	/**
	 * Fills in the source of entries from before schema version 23 from their UTM values and ad
	 * click ids (the referrer of their page views is not known any more; those count without
	 * source). Newest first, at most BACKFILL_LIMIT and BACKFILL_SECONDS; older leads count without
	 * source.
	 *
	 * @return int Entries filled in.
	 */
	public static function backfill(): int {
		global $wpdb;
		$table = Schema::table( 'entries' );
		$done  = 0;
		$last  = PHP_INT_MAX;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery -- one-time upgrade of this plugin's table.
		$until = microtime( true ) + self::BACKFILL_SECONDS;
		while ( $done < self::BACKFILL_LIMIT && microtime( true ) < $until ) {
			$rows = (array) $wpdb->get_results( $wpdb->prepare( "SELECT id, utm FROM %i WHERE id < %d AND source = '' AND medium = '' AND utm IS NOT NULL AND utm NOT IN ('', '[]', '{}') ORDER BY id DESC LIMIT 500", $table, $last ), ARRAY_A );
			if ( array() === $rows ) {
				break;
			}
			foreach ( $rows as $row ) {
				$last = (int) $row['id'];
				$utm  = json_decode( (string) $row['utm'], true );
				$utm  = is_array( $utm ) ? array_filter( $utm, 'is_string' ) : array();
				$set  = self::of( null, $utm );
				if ( '' !== $set['source'] || '' !== $set['medium'] || '' !== $set['campaign'] ) {
					$wpdb->update( $table, $set, array( 'id' => $last ), array( '%s', '%s', '%s' ), array( '%d' ) );
					++$done;
				}
			}
		}
		// phpcs:enable WordPress.DB.DirectDatabaseQuery
		return $done;
	}
}
