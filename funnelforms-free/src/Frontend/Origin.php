<?php
/**
 * Remembers on which page and from where a visit to the website began.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

use Funnelforms\Application\PrivacyMode;

defined( 'ABSPATH' ) || exit;

/**
 * Ads and newsletters often lead to another page than the one with the form. The form then saw
 * neither the UTM parameters nor the ad click id nor the search engine, and its lead counted as
 * "Your website". While this setting is on, a small script on every page (assets/runtime/origin.js,
 * packages/runtime/src/site-origin.ts) notes where the visit began, and a form on a later page
 * counts for that source: in the statistics and with the UTM values of its lead
 * (EntryConverter::campaign()).
 *
 * The script stores only the marketing parameters and the host of the referrer, in the
 * sessionStorage of the tab, and only while the visitor allowed statistics (cookie banner through
 * the WP Consent API or Borlabs Cookie, else the privacy mode). It sends nothing itself.
 */
final class Origin {

	public const OPTION = 'funnelforms_remember_origin';

	/** Script handle; with the prefix of the runtime, so Renderer::script_tag() keeps optimizers away from it. */
	public const HANDLE = Renderer::HANDLE . '-origin';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Whether the site remembers the origin of visits; on until someone switches it off.
	 */
	public static function enabled(): bool {
		return '0' !== (string) get_option( self::OPTION, '1' );
	}

	/**
	 * Saved value of the setting.
	 *
	 * @param mixed $value Submitted value.
	 */
	public static function sanitize( $value ): string {
		return empty( $value ) ? '0' : '1';
	}

	/**
	 * The script on every page of the website, while the setting is on.
	 */
	public static function enqueue(): void {
		if ( ! self::enabled() ) {
			return;
		}
		wp_enqueue_script(
			self::HANDLE,
			plugins_url( 'assets/runtime/origin.js', FUNNELFORMS_PLUGIN_FILE ),
			array(),
			FUNNELFORMS_ASSET_VERSION,
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
		// Without it the script keeps to the EU mode, as the forms do.
		if ( ! PrivacyMode::eu() ) {
			wp_add_inline_script( self::HANDLE, 'window.funnelformsOrigin=' . wp_json_encode( array( 'privacy' => PrivacyMode::current() ) ) . ';', 'before' );
		}
	}
}
