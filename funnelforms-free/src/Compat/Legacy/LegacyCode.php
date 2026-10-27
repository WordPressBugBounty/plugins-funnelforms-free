<?php
/**
 * Decides whether the Funnelforms 3 code is loaded at all.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Legacy;

use Funnelforms\Compat\Safety\Rollback;
use Funnelforms\Edition\FreeSite;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Funnelforms Pro 5.0 still ships the 3.x code, but a site needs it only for what 5.0 does not
 * do itself yet. Everything else of it (its routes, AJAX handlers, admin pages and calls to the
 * old servers) is not loaded, so it can do no harm. The 3.x code is loaded when:
 *
 * - the site went back to Funnelforms 3 (Rollback), so 3.x is in charge again;
 * - a 3.x form is not on the new renderer: not imported yet, its check failed, something keeps
 *   it on 3.x, or someone sent it back (this covers a site right after the update, too);
 * - a form of the old KI generator exists (shortcode funnelforms_openai, never imported);
 * - the Funnelforms app is paired or a Zapier or Make password is set: these use the 3.x routes.
 *
 * Funnelforms-pro.php asks before it loads the 3.x files. When they stay out, the 3.x shortcodes
 * are still registered, so forms on the new renderer show up through Shortcode::intercept().
 */
final class LegacyCode {

	/** Options of 3.x connections that use its REST routes. */
	public const CONNECTIONS = array( 'af2_registered_app_code', 'af2_zapier_pw', 'af2_make_pw' );

	/** Post types whose forms only the 3.x code can show. */
	public const FORM_TYPES = array( LegacyRepository::FORM, 'af2_ai_formular' );

	/**
	 * The decision of this request.
	 *
	 * @var bool|null
	 */
	private static ?bool $needed = null;

	/**
	 * Whether the 3.x code has to be loaded on this request.
	 */
	public static function needed(): bool {
		if ( null === self::$needed ) {
			self::$needed = self::decide();
		}

		/**
		 * Whether the Funnelforms 3 code is loaded. Only a must-use plugin can change this, since
		 * the decision is made while Funnelforms loads.
		 *
		 * @param bool $needed What the site needs.
		 */
		return (bool) apply_filters( 'funnelforms_load_legacy', self::$needed );
	}

	/**
	 * Forgets the decision (tests).
	 */
	public static function reset(): void {
		self::$needed = null;
	}

	/**
	 * Called instead of loading the 3.x code.
	 */
	public static function skip(): void {
		add_action( 'init', array( FreeSite::class, 'shortcodes' ), 1 );
	}

	/**
	 * Why the 3.x code is needed, or an empty string.
	 *
	 * @return string rollback, forms, connection or ''.
	 */
	public static function reason(): string {
		if ( Rollback::active() ) {
			return 'rollback';
		}
		foreach ( self::CONNECTIONS as $option ) {
			if ( '' !== trim( (string) get_option( $option, '' ) ) ) {
				return 'connection';
			}
		}
		return self::legacy_forms() > 0 ? 'forms' : '';
	}

	/**
	 * 3.x forms that only the 3.x code can show.
	 */
	public static function legacy_forms(): int {
		global $wpdb;
		$types = implode( ', ', array_fill( 0, count( self::FORM_TYPES ), '%s' ) );
		$args  = array_merge( array( $wpdb->posts ), self::FORM_TYPES );
		// Before the 5.0 tables exist, every 3.x form still runs on 3.x.
		if ( '' === (string) get_option( Schema::VERSION_OPTION, '' ) ) {
			return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE post_type IN ({$types}) AND post_status NOT IN ('trash', 'auto-draft')", $args ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- placeholders for the fixed post types; asked once per request.
		}
		$args[] = Schema::table( 'forms' );
		$args[] = FormRepository::RENDERER_V5;
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i p WHERE p.post_type IN ({$types}) AND p.post_status NOT IN ('trash', 'auto-draft') AND NOT EXISTS ( SELECT 1 FROM %i f WHERE f.legacy_post_id = p.ID AND f.renderer = %s )", $args ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- placeholders for the fixed post types; asked once per request.
	}

	/**
	 * The decision itself.
	 */
	private static function decide(): bool {
		return '' !== self::reason();
	}
}
