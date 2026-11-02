<?php
/**
 * Empties the page caches of the site when what visitors see of a form changed.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure;

defined( 'ABSPATH' ) || exit;

/**
 * Forms on the new renderer carry their document in the page (Frontend\Renderer), and Funnelforms 3
 * forms bring their own markup. A page cache keeps the page as it was: after publishing in the
 * builder, after a form moved to the new renderer or back, visitors still get the old form. The
 * server checks every entry against the form as it is now (SubmitEntry), so answers of the old
 * form are refused, or go to 3.x handlers that are no longer loaded. Either way the entry is lost.
 *
 * So whenever the shown form changes, the caches of the common cache plugins and hosts are emptied,
 * once per request, at its end. Sites with another cache hook into funnelforms_purge_page_cache.
 */
final class PageCache {

	/**
	 * Whether a purge is due at the end of this request.
	 *
	 * @var bool
	 */
	private static bool $due = false;

	/**
	 * Notes that what visitors see changed; the caches are emptied at the end of the request.
	 *
	 * @param string $reason publish, renderer or import.
	 */
	public static function changed( string $reason ): void {
		/**
		 * Whether Funnelforms empties the page caches when a form visitors see changed.
		 *
		 * @param bool   $purge  Default true.
		 * @param string $reason publish (builder), renderer (moved between 3.x and 5.0), import (3.x form imported again).
		 */
		if ( self::$due || ! apply_filters( 'funnelforms_purge_page_caches', true, $reason ) ) {
			return;
		}
		self::$due = true;
		if ( did_action( 'shutdown' ) ) {
			self::purge();
			return;
		}
		add_action( 'shutdown', array( self::class, 'purge' ), 0 );
	}

	/**
	 * Whether a purge waits for the end of the request (tests).
	 */
	public static function due(): bool {
		return self::$due;
	}

	/**
	 * Empties the caches. Each call is guarded, so a cache plugin that is missing or fails does not
	 * stop the others.
	 */
	public static function purge(): void {
		self::$due = false;
		$calls     = array(
			// WP Rocket.
			static fn() => function_exists( 'rocket_clean_domain' ) && rocket_clean_domain(),
			// W3 Total Cache.
			static fn() => function_exists( 'w3tc_flush_all' ) && w3tc_flush_all(),
			// WP Super Cache.
			static fn() => function_exists( 'wp_cache_clear_cache' ) && wp_cache_clear_cache(),
			// SiteGround Speed Optimizer.
			static fn() => function_exists( 'sg_cachepress_purge_cache' ) && sg_cachepress_purge_cache(),
			// WP Engine.
			static fn() => class_exists( 'WpeCommon' ) && method_exists( 'WpeCommon', 'purge_varnish_cache' ) && \WpeCommon::purge_varnish_cache(),
			// WP-Optimize.
			static fn() => function_exists( 'wpo_cache_flush' ) && wpo_cache_flush(),
			// Kinsta.
			static fn() => isset( $GLOBALS['kinsta_cache'] ) && is_object( $GLOBALS['kinsta_cache'] ) && isset( $GLOBALS['kinsta_cache']->kinsta_cache_purge ) && method_exists( $GLOBALS['kinsta_cache']->kinsta_cache_purge, 'purge_complete_caches' ) && $GLOBALS['kinsta_cache']->kinsta_cache_purge->purge_complete_caches(),
		);
		foreach ( $calls as $call ) {
			try {
				$call();
			} catch ( \Throwable $e ) {
				unset( $e );
			}
		}
		// Plugins that listen to an action: LiteSpeed Cache, WP Fastest Cache, Breeze, Cache Enabler,
		// Hummingbird, Nginx Helper.
		$actions = array( 'litespeed_purge_all', 'wpfc_clear_all_cache', 'breeze_clear_all_cache', 'cache_enabler_clear_complete_cache', 'wphb_clear_page_cache', 'rt_nginx_helper_purge_all' );
		foreach ( $actions as $action ) {
			if ( has_action( $action ) ) {
				try {
					do_action( $action ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.DynamicHooknameFound -- hooks of the cache plugins.
				} catch ( \Throwable $e ) {
					unset( $e );
				}
			}
		}

		/**
		 * After Funnelforms emptied the page caches it knows; for other caches of the site.
		 */
		do_action( 'funnelforms_purge_page_cache' );
	}
}
