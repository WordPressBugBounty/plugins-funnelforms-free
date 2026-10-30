<?php
/**
 * Uninstall: removes the Funnelforms Pro 5 data only when the site opted in.
 *
 * The Funnelforms 3 data (posts and options) is left alone. The 5.0 tables hold copies of leads,
 * so they are dropped only when the option ffx_delete_data_on_uninstall is set.
 *
 * @package Funnelforms
 */

defined( 'ABSPATH' ) || exit;
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

// Temporary support users and their role end with the plugin.
require_once ABSPATH . 'wp-admin/includes/user.php';
$funnelforms_support_users = get_users(
	array(
		'meta_key' => 'funnelforms_support_expires', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- once, on uninstall.
		'fields'   => 'ID',
	)
);
foreach ( $funnelforms_support_users as $funnelforms_support_user ) {
	wp_delete_user( (int) $funnelforms_support_user );
}
remove_role( 'funnelforms_support' );
// The connection to the Funnelforms account (encrypted site token and secret).
delete_option( 'funnelforms_license' );
delete_option( 'funnelforms_license_legacy' );
delete_option( 'funnelforms_license_legacy_since' );
delete_option( 'funnelforms_license_account_last' );
// What the Brain last said about the analyses of the Predictive AI.
delete_transient( 'funnelforms_prediction_quota' );
delete_site_transient( 'funnelforms_update' );
delete_site_transient( 'funnelforms_update_renewed' );
delete_site_option( 'funnelforms_update_channel' );
delete_option( 'funnelforms_support_login_used' );
delete_option( 'funnelforms_support_pending_ends' );
// The notices of Funnelforms and which of them each user hid.
delete_option( 'funnelforms_notices' );
delete_metadata( 'user', 0, 'funnelforms_notices_dismissed', '', true );
// Jobs only Pro runs.
foreach ( array( 'funnelforms_support_cleanup', 'funnelforms_license_renew', 'funnelforms_license_legacy', 'funnelforms_payments_reconcile', 'funnelforms_notices_fetch' ) as $funnelforms_hook ) {
	wp_unschedule_hook( $funnelforms_hook );
}

// Funnelforms Free uses the same tables, settings and jobs. While it is installed, deleting Pro
// removes only what belongs to Pro (above). Free's uninstall.php runs this file as well.
if ( ! defined( 'FUNNELFORMS_UNINSTALL_FREE' ) && file_exists( WP_PLUGIN_DIR . '/funnelforms-free/Funnelforms-free.php' ) ) {
	return;
}

// wp_unschedule_hook() also removes events scheduled with arguments (the jobs of the action queue).
foreach ( array( 'funnelforms_migration_step', 'funnelforms_migration_delta', 'funnelforms_backup_step', 'funnelforms_restore_step', 'funnelforms_run_action', 'funnelforms_cleanup_uploads', 'funnelforms_retention', 'funnelforms_watch', 'funnelforms_page_watch', 'funnelforms_support_cleanup', 'funnelforms_license_renew', 'funnelforms_license_legacy', 'funnelforms_payments_reconcile', 'funnelforms_diagnostics_send', 'funnelforms_diagnostics_forget' ) as $funnelforms_hook ) {
	wp_unschedule_hook( $funnelforms_hook );
}
if ( function_exists( 'as_unschedule_all_actions' ) ) {
	as_unschedule_all_actions( 'funnelforms_migration_step', array(), 'funnelforms' );
	as_unschedule_all_actions( 'funnelforms_migration_delta', array(), 'funnelforms' );
	as_unschedule_all_actions( 'funnelforms_backup_step', array(), 'funnelforms' );
	as_unschedule_all_actions( 'funnelforms_restore_step', array(), 'funnelforms' );
	as_unschedule_all_actions( 'funnelforms_run_action', array(), 'funnelforms' );
}

// Rights given to roles on the Funnelforms page.
foreach ( wp_roles()->role_objects as $funnelforms_role ) {
	foreach ( array( 'funnelforms_edit_forms', 'funnelforms_view_entries', 'funnelforms_export_entries', 'funnelforms_manage_settings' ) as $funnelforms_cap ) {
		$funnelforms_role->remove_cap( $funnelforms_cap );
	}
}

delete_option( 'funnelforms_legacy_ui' );
delete_option( 'funnelforms_mailserver_failure' );
// Restore points stay in uploads/funnelforms-backups with their list, so a reinstall finds them (unless the data is to go, below).
foreach ( array( 'funnelforms_backup_state', 'funnelforms_backup_lock', 'funnelforms_restore_state', 'funnelforms_restore_lock', 'funnelforms_legacy_check', 'funnelforms_check_lock' ) as $funnelforms_option ) {
	delete_option( $funnelforms_option );
}
foreach ( array( 'funnelforms_setup_seen', 'funnelforms_after_connect' ) as $funnelforms_meta ) {
	delete_metadata( 'user', 0, $funnelforms_meta, '', true );
}

// Diagnostic data end with the plugin: the Brain is asked to delete the reports of this
// installation (without waiting for its answer), then the choice, the identity and the counters go.
require_once __DIR__ . '/src/Infrastructure/Crypto/SecretBox.php';
require_once __DIR__ . '/src/Application/Telemetry/Consent.php';
require_once __DIR__ . '/src/Application/Telemetry/Sender.php';
\Funnelforms\Application\Telemetry\Sender::forget_on_uninstall();
foreach ( array( 'funnelforms_diagnostics', 'funnelforms_diagnostics_usage', 'funnelforms_installed' ) as $funnelforms_option ) {
	delete_option( $funnelforms_option );
}

if ( '1' !== (string) get_option( 'ffx_delete_data_on_uninstall', '0' ) ) {
	return;
}

global $wpdb;
foreach ( array( 'forms', 'form_revisions', 'entries', 'entry_files', 'entry_notes', 'events', 'bookings', 'booking_types', 'calendar_connections', 'connections', 'jobs_log', 'audit_log', 'migration_items', 'app_devices', 'api_tokens', 'saved_progress', 'experiment_results' ) as $funnelforms_table ) {
	$wpdb->query( 'DROP TABLE IF EXISTS `' . esc_sql( $wpdb->prefix . 'ffx_' . $funnelforms_table ) . '`' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- fixed table names.
}
// Files visitors uploaded through the new runtime (default folder; a filtered folder is left to its owner).
$funnelforms_uploads = trailingslashit( wp_upload_dir( null, false )['basedir'] ) . 'funnelforms-private';
if ( is_dir( $funnelforms_uploads ) ) {
	require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-base.php';
	require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-direct.php';
	( new WP_Filesystem_Direct( null ) )->rmdir( $funnelforms_uploads, true );
}
// Google Fonts downloaded by 5.0 (fonts uploaded in uploads/af2_fonts itself are shared with 3.x and stay).
$funnelforms_google = trailingslashit( wp_upload_dir( null, false )['basedir'] ) . 'af2_fonts/google';
if ( is_dir( $funnelforms_google ) ) {
	require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-base.php';
	require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-direct.php';
	( new WP_Filesystem_Direct( null ) )->rmdir( $funnelforms_google, true );
}
// Restore points of the Funnelforms 3 data: they hold its leads and API keys.
$funnelforms_backups = trailingslashit( wp_upload_dir( null, false )['basedir'] ) . 'funnelforms-backups';
if ( is_dir( $funnelforms_backups ) ) {
	require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-base.php';
	require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-direct.php';
	( new WP_Filesystem_Direct( null ) )->rmdir( $funnelforms_backups, true );
}
foreach ( array( 'ffx_db_version', 'ffx_migration_state', 'ffx_migration_lock', 'ffx_delete_data_on_uninstall', 'funnelforms_google_maps_key', 'funnelforms_allow_tracking_code', 'funnelforms_retention_days', 'funnelforms_embed_domains', 'funnelforms_webhook_secret', 'funnelforms_watch', 'funnelforms_watch_state', 'funnelforms_page_watch', 'funnelforms_page_watch_pages', 'funnelforms_page_watch_sms', 'funnelforms_page_watch_texts', 'funnelforms_page_watch_state', 'funnelforms_styles', 'funnelforms_lead_stages', 'funnelforms_google_fonts', 'funnelforms_mode', 'funnelforms_rollback', 'funnelforms_setup', 'funnelforms_migration_held', 'funnelforms_auto_renderer', 'funnelforms_auto_renderer_forms', 'funnelforms_renderer_pinned', 'funnelforms_backups', 'funnelforms_backups_retired' ) as $funnelforms_option ) {
	delete_option( $funnelforms_option );
}
// The last prediction of each form (Predictive AI, Pro).
$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'funnelforms_prediction_' ) . '%' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- once, on uninstall.
