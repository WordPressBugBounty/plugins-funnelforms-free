<?php
/**
 * Uninstall of Funnelforms Free.
 *
 * Funnelforms Pro uses the same tables, settings and jobs. While Pro is installed (active or
 * not), deleting Free removes nothing. Otherwise the uninstall of the core runs
 * (uninstall-core.php, the uninstall.php of plugin/ copied by tools/build-free.sh): it keeps the
 * 3.x data and drops the 5.0 tables only when the site opted in.
 *
 * @package Funnelforms
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

if ( file_exists( WP_PLUGIN_DIR . '/Funnelforms-pro/Funnelforms-pro.php' ) ) {
	return;
}

delete_option( 'funnelforms_free_switched' );
delete_option( 'funnelforms_free_stayed' );

define( 'FUNNELFORMS_UNINSTALL_FREE', true );
require __DIR__ . '/uninstall-core.php';
