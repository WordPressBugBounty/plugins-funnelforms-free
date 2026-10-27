<?php
/**
 * Bootstrap for the Funnelforms Pro 5.0 core.
 *
 * This file must stay parseable on old PHP versions: it only checks the
 * environment and then loads the PHP 8.1 code.
 *
 * @package Funnelforms
 */

defined( 'ABSPATH' ) || exit;

// Pro is being activated while Funnelforms Free runs: Free has loaded the core in this request
// already. Pro's activation deactivates Free, and the next request loads the core from Pro.
if ( defined( 'FUNNELFORMS_VERSION' ) ) {
	return;
}

define( 'FUNNELFORMS_VERSION', '5.0.0' );
define( 'FUNNELFORMS_MIN_PHP', '8.1' );
// Funnelforms Free defines the main file (and FUNNELFORMS_EDITION) before it loads this file.
defined( 'FUNNELFORMS_PLUGIN_FILE' ) || define( 'FUNNELFORMS_PLUGIN_FILE', dirname( __DIR__ ) . '/Funnelforms-pro.php' );
define( 'FUNNELFORMS_PLUGIN_DIR', dirname( __DIR__ ) );
// Version of the scripts and styles in their addresses. A development build keeps its version
// number while its files change, so the build time joins it and browsers load the new files.
define(
	'FUNNELFORMS_ASSET_VERSION',
	false === strpos( FUNNELFORMS_VERSION, '-dev' ) ? FUNNELFORMS_VERSION : FUNNELFORMS_VERSION . '.' . max( (int) @filemtime( FUNNELFORMS_PLUGIN_DIR . '/assets/builder/builder.js' ), (int) @filemtime( FUNNELFORMS_PLUGIN_DIR . '/assets/runtime/runtime.js' ) ) // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- A missing file only means no build time.
);

if ( version_compare( PHP_VERSION, FUNNELFORMS_MIN_PHP, '<' ) ) {
	// The 3.x code keeps running; the admin is told why 5.0 features are missing.
	add_action(
		'admin_notices',
		static function () {
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}
			printf(
				'<div class="notice notice-error"><p>%s</p></div>',
				esc_html(
					sprintf(
						/* translators: 1: name of the plugin (Funnelforms Pro or Funnelforms Free), 2: required PHP version, 3: current PHP version. */
						__( '%1$s 5 needs PHP %2$s or newer. This website runs PHP %3$s. Please ask your hosting provider to update PHP.', 'funnelforms-free' ),
						defined( 'FUNNELFORMS_EDITION' ) && 'free' === FUNNELFORMS_EDITION ? 'Funnelforms Free' : 'Funnelforms Pro',
						FUNNELFORMS_MIN_PHP,
						PHP_VERSION
					)
				)
			);
		}
	);
	return;
}

spl_autoload_register(
	static function ( $class_name ) {
		if ( 0 !== strpos( $class_name, 'Funnelforms\\' ) ) {
			return;
		}
		$relative = str_replace( '\\', '/', substr( $class_name, strlen( 'Funnelforms\\' ) ) );
		$file     = __DIR__ . '/' . $relative . '.php';
		if ( is_readable( $file ) ) {
			require_once $file;
		}
	}
);

// Action Scheduler runs the migration in batches. It is bundled through Composer in release builds;
// WooCommerce and other plugins may already provide it, in which case it loads only once.
$funnelforms_action_scheduler = FUNNELFORMS_PLUGIN_DIR . '/lib/woocommerce/action-scheduler/action-scheduler.php';
if ( is_readable( $funnelforms_action_scheduler ) ) {
	require_once $funnelforms_action_scheduler;
}
unset( $funnelforms_action_scheduler );

\Funnelforms\Plugin::boot( FUNNELFORMS_PLUGIN_FILE );
