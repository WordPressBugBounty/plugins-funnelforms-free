<?php
/**
 * Plugin Name:       Funnelforms Free – Multi Step Form, Contact Form & Lead Funnel Builder
 * Plugin URI:        https://funnelforms.io/
 * Description:       Multi-step forms and lead funnels with drag and drop: no limits on forms or entries, branching by answer, CSV export and import from other form plugins.
 * Version:           5.0.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            Funnelforms
 * Author URI:        https://funnelforms.io/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       funnelforms-free
 * Domain Path:       /languages
 *
 * @package Funnelforms
 */

// This file is the main file of the Free build (tools/build-free.sh); the core comes from plugin/src.
// It keeps the name of the 3.x main file, so the update from Funnelforms Free 3.x keeps it active.

defined( 'ABSPATH' ) || exit;

/**
 * Whether Funnelforms Pro is active on this site. Pro contains everything in Free and uses the
 * same forms and entries, so Free stands back while Pro runs.
 *
 * @return bool
 */
function funnelforms_free_pro_active() {
	if ( defined( 'FUNNELFORMS_VERSION' ) ) {
		return true;
	}
	$pro = 'Funnelforms-pro/Funnelforms-pro.php';
	if ( in_array( $pro, (array) get_option( 'active_plugins', array() ), true ) ) {
		return true;
	}
	if ( is_multisite() ) {
		$network = (array) get_site_option( 'active_sitewide_plugins', array() );
		return isset( $network[ $pro ] );
	}
	return false;
}

/**
 * Loads the core as Funnelforms Free. Runs on plugins_loaded, after every plugin file, so that
 * Funnelforms Pro wins whichever plugin WordPress loads first.
 */
function funnelforms_free_boot() {
	if ( defined( 'FUNNELFORMS_EDITION' ) ) {
		return;
	}
	if ( funnelforms_free_pro_active() ) {
		add_action( 'admin_notices', 'funnelforms_free_pro_notice' );
		return;
	}
	define( 'FUNNELFORMS_EDITION', 'free' );
	define( 'FUNNELFORMS_PLUGIN_FILE', __FILE__ );
	require_once __DIR__ . '/src/bootstrap.php';
	// The bootstrap stops on PHP versions the core does not support; then nothing else loads.
	if ( class_exists( '\Funnelforms\Edition\FreeSite' ) ) {
		\Funnelforms\Edition\FreeSite::register();
	}
}
add_action( 'plugins_loaded', 'funnelforms_free_boot', -100 );

/**
 * Loads the bundled catalog for the messages of this file, which also show while the core stands
 * back for Pro and so never loads its catalog. Translations from wordpress.org come first.
 */
function funnelforms_free_textdomain() {
	if ( is_textdomain_loaded( 'funnelforms-free' ) ) {
		return;
	}
	$locale = determine_locale();
	load_textdomain( 'funnelforms-free', __DIR__ . '/languages/funnelforms-free-' . $locale . '.mo', $locale );
}

/**
 * Tells administrators on the plugin list that Free is not needed next to Pro.
 */
function funnelforms_free_pro_notice() {
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( null === $screen || 'plugins' !== $screen->id || ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	funnelforms_free_textdomain();
	printf(
		'<div class="notice notice-info"><p>%s</p></div>',
		esc_html__( 'Funnelforms Pro is active and contains everything in Funnelforms Free, with the same forms and entries. You can deactivate and delete Funnelforms Free.', 'funnelforms-free' )
	);
}

/**
 * Activation: refused while Pro is active; otherwise the tables are created right away.
 */
function funnelforms_free_activate() {
	if ( funnelforms_free_pro_active() ) {
		funnelforms_free_textdomain();
		wp_die(
			esc_html__( 'Funnelforms Pro is active on this website and already contains everything in Funnelforms Free. Funnelforms Free was not activated.', 'funnelforms-free' ),
			esc_html__( 'Funnelforms Free', 'funnelforms-free' ),
			array( 'back_link' => true )
		);
	}
	funnelforms_free_boot();
	if ( class_exists( '\Funnelforms\Infrastructure\Database\Schema' ) ) {
		\Funnelforms\Infrastructure\Database\Schema::install();
	}
}
register_activation_hook( __FILE__, 'funnelforms_free_activate' );
