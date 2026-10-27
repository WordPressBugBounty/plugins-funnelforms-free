<?php
/**
 * How often the Funnelforms admin pages are opened, for the diagnostic report.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Telemetry;

defined( 'ABSPATH' ) || exit;

/**
 * One counter per admin page and one for the analysis mode of the builder, in an option. They
 * count only while diagnostics are on, never who opened a page, and start again at zero after
 * each report the Brain took.
 */
final class AdminUsage {

	public const OPTION = 'funnelforms_diagnostics_usage';

	/** Action the builder's analysis mode fires (through its route) each time it is opened. */
	public const ANALYTICS_MODE = 'funnelforms_analytics_mode_opened';

	/** Page slugs that count, with their key in the report. */
	public const PAGES = array(
		'funnelforms'              => 'overview',
		'funnelforms-builder'      => 'builder',
		'funnelforms-entries'      => 'entries',
		'funnelforms-appointments' => 'appointments',
		'funnelforms-stats'        => 'stats',
		'funnelforms-import'       => 'import',
		'funnelforms-migration'    => 'migration',
		'funnelforms-integrations' => 'integrations',
		'funnelforms-settings'     => 'settings',
		'funnelforms-account'      => 'account',
		'funnelforms-support'      => 'support',
		'funnelforms-upgrade'      => 'upgrade',
	);

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'count_page' ), 30 );
		add_action( self::ANALYTICS_MODE, array( self::class, 'count_analytics_mode' ) );
	}

	/**
	 * Counts the current admin page when it is one of Funnelforms (the pages of Funnelforms 3 as
	 * one key, legacy).
	 */
	public static function count_page(): void {
		global $pagenow;
		if ( 'admin.php' !== $pagenow || wp_doing_ajax() || ! isset( $_GET['page'] ) || 'GET' !== strtoupper( sanitize_key( wp_unslash( $_SERVER['REQUEST_METHOD'] ?? '' ) ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended, WordPress.Security.ValidatedSanitizedInput.InputNotValidated -- counted only.
			return;
		}
		$key = self::key( sanitize_key( wp_unslash( $_GET['page'] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- counted only.
		if ( '' !== $key && Consent::enabled() ) {
			self::bump( 'pages', $key );
		}
	}

	/**
	 * Counts one opening of the analysis mode.
	 */
	public static function count_analytics_mode(): void {
		if ( Consent::enabled() ) {
			self::bump( 'builder_analytics_mode', '' );
		}
	}

	/**
	 * The key of a page slug in the report; empty for pages that are not Funnelforms'.
	 *
	 * @param string $page Slug.
	 */
	public static function key( string $page ): string {
		if ( isset( self::PAGES[ $page ] ) ) {
			return self::PAGES[ $page ];
		}
		if ( 'funnelforms-import-funnelforms' === $page ) {
			// Both imports count as the import.
			return 'import';
		}
		return str_starts_with( $page, 'af2_' ) ? 'legacy' : '';
	}

	/**
	 * The counters since the last report.
	 *
	 * @return array{pages:array<string,int>,builder_analytics_mode:int}
	 */
	public static function counts(): array {
		$stored = get_option( self::OPTION, array() );
		$stored = is_array( $stored ) ? $stored : array();
		$pages  = array();
		foreach ( (array) ( $stored['pages'] ?? array() ) as $key => $n ) {
			if ( in_array( $key, self::PAGES, true ) || 'legacy' === $key ) {
				$pages[ (string) $key ] = max( 0, (int) $n );
			}
		}
		return array(
			'pages'                  => $pages,
			'builder_analytics_mode' => max( 0, (int) ( $stored['builder_analytics_mode'] ?? 0 ) ),
		);
	}

	/**
	 * Starts the counters again at zero.
	 */
	public static function reset(): void {
		delete_option( self::OPTION );
	}

	/**
	 * Adds one to a counter.
	 *
	 * @param string $counter pages or builder_analytics_mode.
	 * @param string $key     Page key for pages.
	 */
	private static function bump( string $counter, string $key ): void {
		$counts = self::counts();
		if ( 'pages' === $counter ) {
			$counts['pages'][ $key ] = ( $counts['pages'][ $key ] ?? 0 ) + 1;
		} else {
			++$counts['builder_analytics_mode'];
		}
		update_option( self::OPTION, $counts, false );
	}
}
