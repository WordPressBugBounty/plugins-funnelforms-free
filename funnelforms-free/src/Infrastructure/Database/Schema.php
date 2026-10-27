<?php
/**
 * Custom tables of Funnelforms Pro 5.0.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Database;

defined( 'ABSPATH' ) || exit;

/**
 * Creates and upgrades the ffx_* tables with dbDelta.
 *
 * JSON is stored in LONGTEXT columns because the JSON column type is not available on every
 * MySQL/MariaDB version that WordPress supports. dbDelta needs one column per line and two spaces
 * after PRIMARY KEY.
 *
 * The statistics count by time over all forms: events by event and time (with form and session,
 * so the counts come from the index alone), complete entries by the time they were sent.
 *
 * experiment_results keeps the figures of each A/B test as they were when it ended, so the history
 * stays right when variants or steps are deleted later.
 */
final class Schema {

	public const VERSION        = 22;
	public const VERSION_OPTION = 'ffx_db_version';

	/**
	 * WP-Cron jobs of features that were taken out again (the form watch and the page watch of the
	 * 5.0 development versions); the upgrade to version 20 unschedules them.
	 */
	public const RETIRED_HOOKS = array( 'funnelforms_watch', 'funnelforms_page_watch' );

	/** Options of those features, deleted with them. */
	public const RETIRED_OPTIONS = array( 'funnelforms_watch', 'funnelforms_watch_state', 'funnelforms_page_watch', 'funnelforms_page_watch_pages', 'funnelforms_page_watch_sms', 'funnelforms_page_watch_texts', 'funnelforms_page_watch_state' );

	/**
	 * Table names without the WordPress prefix.
	 */
	public const TABLES = array(
		'forms',
		'form_revisions',
		'entries',
		'entry_files',
		'entry_notes',
		'events',
		'bookings',
		'booking_types',
		'calendar_connections',
		'connections',
		'jobs_log',
		'audit_log',
		'migration_items',
		'app_devices',
		'api_tokens',
		'saved_progress',
		'experiment_results',
	);

	/**
	 * Full table name with the site prefix.
	 *
	 * @param string $name Short name, e.g. 'forms'.
	 */
	public static function table( string $name ): string {
		global $wpdb;
		return $wpdb->prefix . 'ffx_' . $name;
	}

	/**
	 * Runs dbDelta when the stored schema version is older than the code.
	 */
	public static function maybe_upgrade(): void {
		$from = (int) get_option( self::VERSION_OPTION, 0 );
		if ( $from >= self::VERSION ) {
			return;
		}
		self::install();
		if ( $from > 0 && $from < 16 ) {
			self::rename_renderer();
		}
		if ( $from > 0 && $from < 20 ) {
			self::retire();
		}
	}

	/**
	 * Removes the jobs and options of features that were taken out again, so no mail of theirs
	 * goes out after the update.
	 */
	public static function retire(): void {
		foreach ( self::RETIRED_HOOKS as $hook ) {
			wp_clear_scheduled_hook( $hook );
		}
		foreach ( self::RETIRED_OPTIONS as $option ) {
			delete_option( $option );
		}
	}

	/**
	 * Development versions called the new renderer v4; the release is Funnelforms Pro 5.0
	 * (Funnelforms 4 is the SaaS), so forms and the meta of their entries say v5.
	 */
	private static function rename_renderer(): void {
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery -- one-time upgrade of this plugin's tables.
		$wpdb->query( $wpdb->prepare( 'UPDATE %i SET renderer = %s WHERE renderer = %s', self::table( 'forms' ), 'v5', 'v4' ) );
		$wpdb->query( $wpdb->prepare( 'UPDATE %i SET meta = REPLACE(meta, %s, %s) WHERE meta LIKE %s', self::table( 'entries' ), '"v4":{', '"v5":{', '%' . $wpdb->esc_like( '"v4":{' ) . '%' ) );
		// phpcs:enable WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * Creates or updates all tables.
	 */
	public static function install(): void {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( self::sql() );
		update_option( self::VERSION_OPTION, self::VERSION, true );
	}

	/**
	 * Returns the CREATE TABLE statements.
	 *
	 * @return string[]
	 */
	public static function sql(): array {
		global $wpdb;
		$c = $wpdb->get_charset_collate();
		$t = array();
		foreach ( self::TABLES as $name ) {
			$t[ $name ] = self::table( $name );
		}

		return array(
			"CREATE TABLE {$t['forms']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  uid varchar(40) NOT NULL,
  legacy_post_id bigint(20) unsigned DEFAULT NULL,
  title varchar(255) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'draft',
  schema_version smallint(5) unsigned NOT NULL DEFAULT 1,
  current_revision_id bigint(20) unsigned DEFAULT NULL,
  locale_default varchar(20) NOT NULL DEFAULT '',
  renderer varchar(20) NOT NULL DEFAULT 'legacy',
  public_slug varchar(200) DEFAULT NULL,
  category varchar(100) NOT NULL DEFAULT '',
  draft longtext DEFAULT NULL,
  draft_author bigint(20) unsigned NOT NULL DEFAULT 0,
  draft_updated_at datetime DEFAULT NULL,
  locked_by bigint(20) unsigned NOT NULL DEFAULT 0,
  locked_at datetime DEFAULT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY uid (uid),
  UNIQUE KEY legacy_post_id (legacy_post_id),
  KEY status (status),
  KEY category (category),
  KEY public_slug (public_slug(191))
) $c;",
			"CREATE TABLE {$t['form_revisions']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  form_id bigint(20) unsigned NOT NULL,
  schema_version smallint(5) unsigned NOT NULL DEFAULT 1,
  document longtext NOT NULL,
  author_id bigint(20) unsigned NOT NULL DEFAULT 0,
  note varchar(255) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY form_id (form_id)
) $c;",
			"CREATE TABLE {$t['entries']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  uid varchar(40) NOT NULL,
  form_id bigint(20) unsigned DEFAULT NULL,
  legacy_post_id bigint(20) unsigned DEFAULT NULL,
  legacy_form_post_id bigint(20) unsigned DEFAULT NULL,
  status varchar(20) NOT NULL DEFAULT 'complete',
  is_read tinyint(1) NOT NULL DEFAULT 0,
  is_archived tinyint(1) NOT NULL DEFAULT 0,
  lead_status varchar(20) NOT NULL DEFAULT 'new',
  tags varchar(1000) NOT NULL DEFAULT '',
  assigned_to bigint(20) unsigned DEFAULT NULL,
  locale varchar(20) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  completed_at datetime DEFAULT NULL,
  source_url text,
  utm longtext,
  data longtext NOT NULL,
  consent longtext,
  meta longtext,
  draft_hash char(64) DEFAULT NULL,
  score decimal(20,4) DEFAULT NULL,
  lead_value decimal(20,4) DEFAULT NULL,
  optin_status varchar(10) NOT NULL DEFAULT '',
  optin_hash char(64) DEFAULT NULL,
  optin_at datetime DEFAULT NULL,
  is_public tinyint(1) NOT NULL DEFAULT 0,
  payment_status varchar(10) NOT NULL DEFAULT '',
  device varchar(10) NOT NULL DEFAULT '',
  PRIMARY KEY  (id),
  UNIQUE KEY uid (uid),
  UNIQUE KEY legacy_post_id (legacy_post_id),
  KEY draft_hash (draft_hash),
  KEY optin_hash (optin_hash),
  KEY form_status_created (form_id,status,created_at),
  KEY form_public_created (form_id,is_public,created_at),
  KEY form_payment_created (form_id,payment_status,created_at),
  KEY form_device (form_id,device),
  KEY status_completed (status,completed_at,created_at),
  KEY form_status_completed (form_id,status,completed_at,created_at),
  KEY lead_status (lead_status),
  KEY lead_value (lead_value),
  KEY assigned_to (assigned_to),
  KEY created_at (created_at)
) $c;",
			"CREATE TABLE {$t['entry_notes']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  entry_id bigint(20) unsigned NOT NULL,
  user_id bigint(20) unsigned NOT NULL DEFAULT 0,
  note text NOT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY entry_id (entry_id)
) $c;",
			"CREATE TABLE {$t['entry_files']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  entry_id bigint(20) unsigned NOT NULL DEFAULT 0,
  form_id bigint(20) unsigned NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'attached',
  ref_hash char(64) DEFAULT NULL,
  field_id varchar(64) NOT NULL DEFAULT '',
  attachment_id bigint(20) unsigned DEFAULT NULL,
  path text,
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL DEFAULT '',
  size bigint(20) unsigned NOT NULL DEFAULT 0,
  visibility varchar(20) NOT NULL DEFAULT 'private',
  token_hash char(64) DEFAULT NULL,
  expires_at datetime DEFAULT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY entry_id (entry_id),
  KEY token_hash (token_hash),
  KEY ref_hash (ref_hash),
  KEY status_created (status,created_at)
) $c;",
			"CREATE TABLE {$t['events']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  form_id bigint(20) unsigned NOT NULL,
  session_hash char(64) NOT NULL DEFAULT '',
  step varchar(80) NOT NULL DEFAULT '',
  event varchar(32) NOT NULL,
  variant varchar(80) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY form_event_created (form_id,event,created_at),
  KEY event_created (event,created_at,form_id,session_hash),
  KEY form_session (form_id,session_hash)
) $c;",
			"CREATE TABLE {$t['bookings']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  entry_id bigint(20) unsigned DEFAULT NULL,
  legacy_post_id bigint(20) unsigned DEFAULT NULL,
  event_type_id varchar(64) NOT NULL DEFAULT '',
  resource_id varchar(64) NOT NULL DEFAULT '',
  starts_at datetime NOT NULL,
  ends_at datetime NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'UTC',
  status varchar(20) NOT NULL DEFAULT 'confirmed',
  external_event_id varchar(255) NOT NULL DEFAULT '',
  data longtext,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY resource_slot (resource_id,starts_at),
  UNIQUE KEY legacy_post_id (legacy_post_id),
  KEY entry_id (entry_id)
) $c;",
			"CREATE TABLE {$t['booking_types']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  legacy_post_id bigint(20) unsigned DEFAULT NULL,
  title varchar(255) NOT NULL DEFAULT '',
  config longtext,
  calendar_connection_id bigint(20) unsigned DEFAULT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY legacy_post_id (legacy_post_id)
) $c;",
			"CREATE TABLE {$t['calendar_connections']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  provider varchar(32) NOT NULL,
  account_label varchar(255) NOT NULL DEFAULT '',
  secret longtext,
  scopes text,
  status varchar(20) NOT NULL DEFAULT 'active',
  last_sync_at datetime DEFAULT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY provider (provider)
) $c;",
			"CREATE TABLE {$t['connections']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  type varchar(64) NOT NULL,
  label varchar(255) NOT NULL DEFAULT '',
  config longtext,
  secret longtext,
  ref varchar(191) NOT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY type (type),
  UNIQUE KEY ref (ref)
) $c;",
			"CREATE TABLE {$t['jobs_log']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  entry_id bigint(20) unsigned DEFAULT NULL,
  channel varchar(64) NOT NULL,
  status varchar(20) NOT NULL,
  attempts smallint(5) unsigned NOT NULL DEFAULT 0,
  last_error text,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY entry_id (entry_id),
  KEY status (status)
) $c;",
			"CREATE TABLE {$t['audit_log']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  actor_id bigint(20) unsigned NOT NULL DEFAULT 0,
  action varchar(64) NOT NULL,
  object_type varchar(32) NOT NULL DEFAULT '',
  object_id varchar(64) NOT NULL DEFAULT '',
  details longtext,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY object (object_type,object_id),
  KEY created_at (created_at)
) $c;",
			"CREATE TABLE {$t['migration_items']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  legacy_post_id bigint(20) unsigned NOT NULL,
  legacy_type varchar(32) NOT NULL,
  target_type varchar(32) NOT NULL DEFAULT '',
  target_id bigint(20) unsigned DEFAULT NULL,
  status varchar(20) NOT NULL,
  migrator_version smallint(5) unsigned NOT NULL,
  source_hash char(64) NOT NULL DEFAULT '',
  checks longtext,
  notes longtext,
  migrated_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY legacy (legacy_type,legacy_post_id),
  KEY status (status)
) $c;",
			"CREATE TABLE {$t['app_devices']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL,
  name varchar(100) NOT NULL DEFAULT '',
  platform varchar(20) NOT NULL DEFAULT '',
  token_hash char(64) NOT NULL,
  created_at datetime NOT NULL,
  last_seen_at datetime DEFAULT NULL,
  revoked_at datetime DEFAULT NULL,
  push_token varchar(255) NOT NULL DEFAULT '',
  push_platform varchar(10) NOT NULL DEFAULT '',
  push_locale varchar(20) NOT NULL DEFAULT '',
  PRIMARY KEY  (id),
  KEY user_id (user_id)
) $c;",
			"CREATE TABLE {$t['api_tokens']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL,
  name varchar(100) NOT NULL DEFAULT '',
  token_hash char(64) NOT NULL,
  created_at datetime NOT NULL,
  last_used_at datetime DEFAULT NULL,
  revoked_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY user_id (user_id)
) $c;",
			"CREATE TABLE {$t['saved_progress']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  form_id bigint(20) unsigned NOT NULL,
  key_hash char(64) NOT NULL,
  answers longtext NOT NULL,
  locale varchar(20) NOT NULL DEFAULT '',
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  expires_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY key_hash (key_hash),
  KEY expires_at (expires_at)
) $c;",
			"CREATE TABLE {$t['experiment_results']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  form_id bigint(20) unsigned NOT NULL,
  experiment varchar(80) NOT NULL,
  name varchar(255) NOT NULL DEFAULT '',
  kind varchar(20) NOT NULL DEFAULT 'steps',
  goal varchar(20) NOT NULL DEFAULT 'complete',
  started_on date DEFAULT NULL,
  ended_on date NOT NULL,
  ended_by varchar(20) NOT NULL DEFAULT 'user',
  outcome varchar(20) NOT NULL DEFAULT '',
  winner varchar(80) NOT NULL DEFAULT '',
  variants longtext NOT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY form_ended (form_id,ended_on)
) $c;",
		);
	}
}
