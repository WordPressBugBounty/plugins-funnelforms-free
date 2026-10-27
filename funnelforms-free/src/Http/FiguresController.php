<?php
/**
 * REST routes of the key figures on the lists of forms and entries.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Application\Capabilities;
use Funnelforms\Application\LeadStages;
use Funnelforms\Application\StatsOverview;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\EntryRepository;

defined( 'ABSPATH' ) || exit;

/**
 *   GET stats/forms     forms per status, and (with the entries capability) views, entries and
 *                       conversion of the last 30 days, in total and per form, as the statistics
 *                       page counts them (StatsOverview)
 *   GET stats/entries   counts for the head of the entries list: open entries, unread ones,
 *                       those since the moments given (today, week, previous) and per lead status;
 *                       parameter form narrows them to one form
 *
 * The moments come from the browser, so the figures match the period filter of the list, which
 * counts in the editor's time zone.
 */
final class FiguresController {

	/** Days the figures of the forms cover. */
	public const DAYS = 30;

	/**
	 * Registers the routes.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Route definitions.
	 */
	public static function routes(): void {
		register_rest_route(
			FormsController::NAMESPACE,
			'/stats/forms',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'forms' ),
				'permission_callback' => static fn(): bool => current_user_can( Capabilities::EDIT_FORMS ),
			)
		);
		$moment = array(
			'type'   => 'string',
			'format' => 'date-time',
		);
		register_rest_route(
			FormsController::NAMESPACE,
			'/stats/entries',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'entries' ),
				'permission_callback' => array( EntriesController::class, 'allowed' ),
				'args'                => array(
					'form'     => array(
						'type'    => 'integer',
						'minimum' => 1,
					),
					'today'    => $moment + array( 'description' => 'Start of today; counted as today.' ),
					'week'     => $moment + array( 'description' => 'Start of the last 7 days; counted as week.' ),
					'previous' => $moment + array( 'description' => 'Start of the 7 days before; entries from it to week are counted as previous.' ),
				),
			)
		);
	}

	/**
	 * GET stats/forms.
	 */
	public static function forms(): \WP_REST_Response {
		return new \WP_REST_Response( self::form_figures( time(), current_user_can( FileDownload::capability() ) ), 200 );
	}

	/**
	 * Forms per status and, when asked for, the figures of the last 30 days.
	 *
	 * @param int  $now     Time.
	 * @param bool $figures With views, entries and conversion.
	 * @return array{forms:array<string,int>,figures:array<string,mixed>|null}
	 */
	public static function form_figures( int $now, bool $figures ): array {
		global $wpdb;
		$counts = array(
			'total'     => 0,
			'published' => 0,
			'draft'     => 0,
			'trashed'   => 0,
		);
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- counts of this plugin's table, fresh on purpose.
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT status, COUNT(*) AS n FROM %i GROUP BY status', Schema::table( 'forms' ) ), ARRAY_A ) as $row ) {
			if ( isset( $counts[ $row['status'] ] ) ) {
				$counts[ $row['status'] ] = (int) $row['n'];
			}
		}
		$counts['total'] = $counts['published'] + $counts['draft'];
		if ( ! $figures ) {
			return array(
				'forms'   => $counts,
				'figures' => null,
			);
		}
		$report = StatsOverview::report( self::DAYS, $now );
		$forms  = array();
		foreach ( $report['forms'] as $form ) {
			$forms[ (string) $form['id'] ] = array(
				'views'    => (int) $form['views'],
				'entries'  => (int) $form['entries'],
				'rate'     => $form['rate'],
				'measured' => (bool) $form['v5'],
				'series'   => array_map( 'intval', $form['series'] ),
			);
		}
		return array(
			'forms'   => $counts,
			'figures' => array(
				'days'          => self::DAYS,
				'views'         => (int) $report['totals']['views'],
				'entries'       => (int) $report['totals']['entries'],
				'rate'          => $report['totals']['rate'],
				'viewsBefore'   => (int) $report['before']['views'],
				'entriesBefore' => (int) $report['before']['entries'],
				'rateBefore'    => $report['before']['rate'],
				'forms'         => (object) $forms,
			),
		);
	}

	/**
	 * GET stats/entries.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function entries( \WP_REST_Request $request ): \WP_REST_Response {
		$moments = array();
		foreach ( array( 'today', 'week', 'previous' ) as $key ) {
			$value           = null === $request[ $key ] ? false : strtotime( (string) $request[ $key ] );
			$moments[ $key ] = false === $value ? null : gmdate( 'Y-m-d H:i:s', $value );
		}
		return new \WP_REST_Response( self::entry_figures( null === $request['form'] ? null : (int) $request['form'], $moments ), 200 );
	}

	/**
	 * Counts over the open (not archived) entries, as the list filters them, and the number of
	 * entries in the spam folder.
	 *
	 * @param int|null                  $form    Form ID, or null for all forms.
	 * @param array<string,string|null> $moments today, week and previous as UTC times (Y-m-d H:i:s), or null.
	 * @return array<string,mixed>
	 */
	public static function entry_figures( ?int $form, array $moments ): array {
		global $wpdb;
		$far   = '9999-12-31 23:59:59';
		$today = $moments['today'] ?? null;
		$week  = $moments['week'] ?? null;
		$prev  = $moments['previous'] ?? null;
		$form  = $form ?? 0;
		$row   = (array) $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- counts of this plugin's table, fresh on purpose.
			$wpdb->prepare(
				"SELECT COUNT(*) AS total, SUM(is_read = 0) AS unread, SUM(created_at >= %s) AS today, SUM(created_at >= %s) AS week, SUM(created_at >= %s AND created_at < %s) AS previous FROM %i WHERE is_archived = 0 AND status NOT IN ('spam', 'abandoned') AND (%d = 0 OR form_id = %d)",
				$today ?? $far,
				$week ?? $far,
				$prev ?? $far,
				$week ?? $far,
				Schema::table( 'entries' ),
				$form,
				$form
			),
			ARRAY_A
		);
		// Per lead stage of the site (LeadStages), in its order.
		$leads = array_fill_keys( LeadStages::keys(), 0 );
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT lead_status, COUNT(*) AS n FROM %i WHERE is_archived = 0 AND status NOT IN ('spam', 'abandoned') AND (%d = 0 OR form_id = %d) GROUP BY lead_status", Schema::table( 'entries' ), $form, $form ), ARRAY_A ) as $stage ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- as above.
			if ( isset( $leads[ $stage['lead_status'] ] ) ) {
				$leads[ $stage['lead_status'] ] = (int) $stage['n'];
			}
		}
		return array(
			'total'    => (int) ( $row['total'] ?? 0 ),
			'unread'   => (int) ( $row['unread'] ?? 0 ),
			'today'    => null === $today ? null : (int) ( $row['today'] ?? 0 ),
			'week'     => null === $week ? null : (int) ( $row['week'] ?? 0 ),
			'previous' => null === $prev || null === $week ? null : (int) ( $row['previous'] ?? 0 ),
			'leads'    => $leads,
			// Entries in the spam folder, for its tab.
			'spam'     => ( new EntryRepository() )->count_spam( $form ),
		);
	}
}
