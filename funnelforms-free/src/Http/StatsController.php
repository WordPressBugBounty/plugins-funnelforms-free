<?php
/**
 * REST route of the form statistics.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Application\Abandonment;
use Funnelforms\Application\FormAnalytics;
use Funnelforms\Application\FormStats;
use Funnelforms\Application\StatsPeriod;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 *   GET stats/<form id>   views, starts, sent forms and conversion rate per day, and per step how
 *                         many visitors reached it and how many left there; parameters from and to
 *                         (days in the site's time zone, default the last 30 days); detail=full adds
 *                         the period before, sources, campaigns, weekday and hour, times, numbers,
 *                         calculations and quiz points, the ways between nodes, fields that stop
 *                         visitors, and visitors and devices of the extended level (FormAnalytics,
 *                         Funnelforms Pro; Free answers 403 pro_feature);
 *                         view=canvas: the builder opened its analytics mode with this request,
 *                         counted through the action funnelforms_analytics_mode_opened
 *
 * Needs the entries capability (FileDownload::capability()). See FormStats for what is counted.
 */
final class StatsController {

	/**
	 * Longest period of one request, in days.
	 */
	private const MAX_DAYS = 400;

	/**
	 * Registers the route.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Route definition.
	 */
	public static function routes(): void {
		$day = array(
			'type'    => 'string',
			'pattern' => '^\d{4}-\d{2}-\d{2}$',
		);
		register_rest_route(
			FormsController::NAMESPACE,
			'/stats/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'show' ),
				'permission_callback' => array( EntriesController::class, 'allowed' ),
				'args'                => array(
					'from'   => $day,
					'to'     => $day,
					'detail' => array(
						'type' => 'string',
						'enum' => array( 'basic', 'full' ),
					),
					'view'   => array(
						'type' => 'string',
						'enum' => array( 'canvas' ),
					),
				),
			)
		);
	}

	/**
	 * GET stats/<id>.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function show( \WP_REST_Request $request ): \WP_REST_Response {
		$forms = new FormRepository();
		$form  = $forms->by_id( (int) $request['id'] );
		if ( null === $form || null === $form['current_revision_id'] ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'form_not_found',
					'message' => __( 'Form not found.', 'funnelforms-free' ),
				),
				404
			);
		}
		$to   = (string) ( $request['to'] ?? '' );
		$to   = '' !== $to ? $to : wp_date( 'Y-m-d' );
		$from = (string) ( $request['from'] ?? '' );
		$from = '' !== $from ? $from : gmdate( 'Y-m-d', (int) strtotime( $to . ' -29 days' ) );
		$days = ( strtotime( $to ) - strtotime( $from ) ) / DAY_IN_SECONDS;
		if ( false === strtotime( $from ) || false === strtotime( $to ) || $days < 0 || $days >= self::MAX_DAYS ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'invalid_period',
					'message' => __( 'The period is not valid.', 'funnelforms-free' ),
				),
				400
			);
		}
		$full      = 'full' === ( $request['detail'] ?? '' );
		$analytics = Edition::pro( FormAnalytics::class );
		if ( $full && null === $analytics ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'pro_feature',
					'message' => __( 'The analytics of one form come with Funnelforms Pro.', 'funnelforms-free' ),
				),
				403
			);
		}
		$document = (array) $forms->document( (int) $form['current_revision_id'] );
		if ( 'canvas' === ( $request['view'] ?? '' ) ) {
			/**
			 * Fires when the builder opens the analytics mode of the canvas, once per opening; the
			 * user passed the permission check of the route.
			 */
			do_action( 'funnelforms_analytics_mode_opened' );
		}
		if ( $full && null !== $analytics ) {
			$period = StatsPeriod::custom( $from, $to, time() );
			if ( null === $period ) {
				return new \WP_REST_Response(
					array(
						'code'    => 'invalid_period',
						'message' => __( 'The period is not valid.', 'funnelforms-free' ),
					),
					400
				);
			}
			return new \WP_REST_Response( $analytics::report( $form, $document, $period ), 200 );
		}
		$report  = FormStats::report( $form, $document, $from, $to );
		$abandon = Edition::pro( Abandonment::class );
		if ( null !== $abandon && null !== $abandon::settings( $document ) ) {
			// Reminders to visitors who left: how many came back (days of the site's time zone).
			$report['abandonment'] = $abandon::figures( (int) $form['id'], get_gmt_from_date( $from . ' 00:00:00' ), get_gmt_from_date( gmdate( 'Y-m-d', (int) strtotime( $to . ' +1 day' ) ) . ' 00:00:00' ) );
		}
		return new \WP_REST_Response( $report, 200 );
	}
}
