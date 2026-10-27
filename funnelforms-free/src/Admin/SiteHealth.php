<?php
/**
 * Funnelforms in Tools → Site Health: checks and the support information.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\PrivacyMode;
use Funnelforms\Application\Telemetry\Consent;
use Funnelforms\Compat\Legacy\LegacyCode;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\ExternalEmbed;
use Funnelforms\Frontend\TrackingCode;
use Funnelforms\Http\Captcha;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- counts over this plugin's tables, fresh on purpose.

/**
 * Two checks: deliveries that failed in the last seven days, and background jobs that wait for
 * more than an hour (WP-Cron or Action Scheduler not running). The support information lists
 * versions and settings, never entry content or secrets, so admins can copy it into a ticket.
 */
final class SiteHealth {

	/**
	 * Registers the hooks.
	 */
	public static function register(): void {
		add_filter( 'site_status_tests', array( self::class, 'tests' ) );
		add_filter( 'debug_information', array( self::class, 'information' ) );
	}

	/**
	 * Adds the checks.
	 *
	 * @param array<string,mixed> $tests Tests.
	 * @return array<string,mixed>
	 */
	public static function tests( $tests ) {
		$tests['direct']['funnelforms_deliveries'] = array(
			'label' => __( 'Funnelforms deliveries', 'funnelforms-free' ),
			'test'  => array( self::class, 'deliveries' ),
		);
		$tests['direct']['funnelforms_jobs']       = array(
			'label' => __( 'Funnelforms background jobs', 'funnelforms-free' ),
			'test'  => array( self::class, 'jobs' ),
		);
		return $tests;
	}

	/**
	 * Failed deliveries of the last seven days.
	 *
	 * @return array<string,mixed>
	 */
	public static function deliveries(): array {
		global $wpdb;
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT last_error, COUNT(*) AS n FROM %i WHERE status = %s AND updated_at >= %s GROUP BY last_error ORDER BY n DESC',
				Schema::table( 'jobs_log' ),
				'failed',
				gmdate( 'Y-m-d H:i:s', time() - WEEK_IN_SECONDS )
			),
			ARRAY_A
		);
		$count = array_sum( array_map( 'intval', array_column( $rows, 'n' ) ) );
		if ( 0 === $count ) {
			return self::result( 'funnelforms_deliveries', 'good', __( 'Funnelforms delivered all mails, webhooks and CRM transfers of the last seven days', 'funnelforms-free' ), '' );
		}
		$errors = array();
		foreach ( array_slice( $rows, 0, 5 ) as $row ) {
			$errors[] = sprintf( '<li><code>%s</code>: %d</li>', esc_html( (string) $row['last_error'] ), (int) $row['n'] );
		}
		return self::result(
			'funnelforms_deliveries',
			'recommended',
			/* translators: %d: number of deliveries */
			sprintf( _n( '%d Funnelforms delivery failed in the last seven days', '%d Funnelforms deliveries failed in the last seven days', $count, 'funnelforms-free' ), $count ),
			'<p>' . esc_html__( 'Mails, webhooks or CRM transfers of some entries did not arrive after three attempts. The entries themselves are stored. Check the receivers and send the entries again from the entry.', 'funnelforms-free' ) . '</p><ul>' . implode( '', $errors ) . '</ul>'
		);
	}

	/**
	 * Jobs that wait too long.
	 *
	 * @return array<string,mixed>
	 */
	public static function jobs(): array {
		global $wpdb;
		$waiting = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE status IN (%s, %s) AND updated_at < %s',
				Schema::table( 'jobs_log' ),
				'queued',
				'retrying',
				gmdate( 'Y-m-d H:i:s', time() - HOUR_IN_SECONDS )
			)
		);
		if ( 0 === $waiting ) {
			return self::result( 'funnelforms_jobs', 'good', __( 'Funnelforms background jobs run', 'funnelforms-free' ), '' );
		}
		return self::result(
			'funnelforms_jobs',
			'critical',
			/* translators: %d: number of jobs */
			sprintf( _n( '%d Funnelforms delivery has been waiting for more than an hour', '%d Funnelforms deliveries have been waiting for more than an hour', $waiting, 'funnelforms-free' ), $waiting ),
			'<p>' . esc_html__( 'Mails, webhooks and CRM transfers run in the background through WP-Cron or Action Scheduler. When they wait this long, WP-Cron is probably turned off (DISABLE_WP_CRON) without a server cron job, or the site gets too few visits. Set up a server cron job for wp-cron.php.', 'funnelforms-free' ) . '</p>'
		);
	}

	/**
	 * Section in the support information.
	 *
	 * @param array<string,mixed> $info Sections.
	 * @return array<string,mixed>
	 */
	public static function information( $info ) {
		global $wpdb;
		$forms   = Schema::table( 'forms' );
		$v5      = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE renderer = %s', $forms, FormRepository::RENDERER_V5 ) );
		$all     = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $forms ) );
		$captcha = Captcha::site();
		$runtime = dirname( FUNNELFORMS_PLUGIN_FILE ) . '/assets/runtime/runtime.js';
		$embed   = Edition::pro( ExternalEmbed::class );
		$fields  = array(
			'version'          => array(
				'label' => __( 'Version', 'funnelforms-free' ),
				'value' => (string) FUNNELFORMS_VERSION,
			),
			'db_version'       => array(
				'label' => __( 'Database version', 'funnelforms-free' ),
				'value' => (string) get_option( Schema::VERSION_OPTION, '' ),
			),
			'runtime'          => array(
				'label' => __( 'New renderer built', 'funnelforms-free' ),
				'value' => is_readable( $runtime ) && filesize( $runtime ) > 0 ? __( 'Yes', 'funnelforms-free' ) : __( 'No', 'funnelforms-free' ),
				'debug' => is_readable( $runtime ) && filesize( $runtime ) > 0,
			),
			'forms'            => array(
				'label' => __( 'Forms on the new renderer', 'funnelforms-free' ),
				/* translators: 1: forms on the new renderer, 2: all forms */
				'value' => sprintf( __( '%1$d of %2$d', 'funnelforms-free' ), $v5, $all ),
			),
			'legacy_code'      => array(
				'label' => __( 'Code of Funnelforms 3 loaded', 'funnelforms-free' ),
				'value' => self::legacy_code(),
				'debug' => LegacyCode::needed() ? LegacyCode::reason() : 'no',
			),
			'action_scheduler' => array(
				'label' => __( 'Background jobs', 'funnelforms-free' ),
				'value' => function_exists( 'as_schedule_single_action' ) ? 'Action Scheduler' : 'WP-Cron',
			),
			'captcha'          => array(
				'label' => __( 'Spam protection', 'funnelforms-free' ),
				'value' => (string) ( $captcha['type'] ?? __( 'None', 'funnelforms-free' ) ),
			),
			'privacy_mode'     => array(
				'label' => __( 'Privacy mode', 'funnelforms-free' ),
				'value' => PrivacyMode::eu() ? __( 'EU (GDPR)', 'funnelforms-free' ) : ( PrivacyMode::open() ? __( 'Unrestricted (at your own risk)', 'funnelforms-free' ) : __( 'Global (opt-out)', 'funnelforms-free' ) ),
				'debug' => PrivacyMode::current(),
			),
			'tracking'         => array(
				'label' => __( 'Tracking code allowed', 'funnelforms-free' ),
				'value' => TrackingCode::allowed() ? __( 'Yes', 'funnelforms-free' ) : __( 'No', 'funnelforms-free' ),
				'debug' => TrackingCode::allowed(),
			),
			'embed_domains'    => null === $embed ? null : array(
				'label' => __( 'Websites that may embed forms', 'funnelforms-free' ),
				'value' => array() === $embed::domains() ? __( 'Any', 'funnelforms-free' ) : implode( ', ', $embed::domains() ),
			),
			'diagnostics'      => array(
				'label' => __( 'Diagnostic data for Funnelforms', 'funnelforms-free' ),
				'value' => Consent::enabled() ? __( 'On', 'funnelforms-free' ) : __( 'Off', 'funnelforms-free' ),
				'debug' => Consent::enabled(),
			),
		);
		// Embedding on other websites is Funnelforms Pro.
		$fields              = array_filter( $fields );
		$info['funnelforms'] = array(
			'label'  => 'Funnelforms',
			'fields' => $fields,
		);
		return $info;
	}

	/**
	 * Whether the code of Funnelforms 3 is loaded, and why.
	 */
	private static function legacy_code(): string {
		if ( ! LegacyCode::needed() ) {
			return __( 'No', 'funnelforms-free' );
		}
		$reasons = array(
			'rollback'   => __( 'Yes, the site went back to Funnelforms 3', 'funnelforms-free' ),
			'connection' => __( 'Yes, a connection of Funnelforms 3 (app, Zapier or Make) is set up', 'funnelforms-free' ),
			'forms'      => __( 'Yes, forms still run on Funnelforms 3', 'funnelforms-free' ),
		);
		return $reasons[ LegacyCode::reason() ] ?? __( 'Yes', 'funnelforms-free' );
	}

	/**
	 * A check result.
	 *
	 * @param string $test        Test ID.
	 * @param string $status      good, recommended or critical.
	 * @param string $label       Headline.
	 * @param string $description HTML.
	 * @return array<string,mixed>
	 */
	private static function result( string $test, string $status, string $label, string $description ): array {
		return array(
			'label'       => $label,
			'status'      => $status,
			'badge'       => array(
				'label' => 'Funnelforms',
				'color' => 'good' === $status ? 'blue' : 'orange',
			),
			'description' => $description,
			'actions'     => '',
			'test'        => $test,
		);
	}
}
