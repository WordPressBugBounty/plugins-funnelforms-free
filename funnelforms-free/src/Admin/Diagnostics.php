<?php
/**
 * Diagnostics for support: one JSON file with what support needs to look into a problem, and the
 * log of important admin actions.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;
use Funnelforms\Application\PrivacyMode;
use Funnelforms\Application\Telemetry\Consent;
use Funnelforms\Domain\Form\DocumentChecker;
use Funnelforms\Domain\Form\RendererSupport;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\ExternalEmbed;
use Funnelforms\Frontend\TrackingCode;
use Funnelforms\Http\Captcha;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- counts over this plugin's tables, fresh on purpose.

/**
 * The report holds versions, settings, counts, error codes and the shape of the forms. It never
 * holds entry content, contact data, labels of connections or secrets; e-mail addresses in error
 * messages of mail servers are replaced.
 */
final class Diagnostics {

	public const ACTION = 'funnelforms_diagnostics';

	/** Version of the report's format. */
	public const FORMAT = 1;

	private const AUDIT_ROWS = 50;

	/** Forms in the report, at most (the Brain takes no more). */
	public const FORMS_MAX = 1000;

	/**
	 * Registers the hooks.
	 */
	public static function register(): void {
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle_download' ) );
	}

	/**
	 * Sends the report as a file.
	 */
	public static function handle_download(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			wp_die( esc_html__( 'You may not download the diagnostics.', 'funnelforms-free' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION );
		nocache_headers();
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="' . self::filename( time() ) . '"' );
		echo wp_json_encode( self::report(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		exit;
	}

	/**
	 * Name of the file: the site's host and the time.
	 *
	 * @param int $now Time.
	 */
	public static function filename( int $now ): string {
		$host = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		return 'funnelforms-diagnostics-' . sanitize_file_name( '' !== $host ? $host : 'site' ) . '-' . gmdate( 'Ymd-Hi', $now ) . '.json';
	}

	/**
	 * The report.
	 *
	 * @return array<string,mixed>
	 */
	public static function report(): array {
		return array(
			'format'      => self::FORMAT,
			'generated'   => gmdate( 'c' ),
			'site'        => self::site(),
			'funnelforms' => self::plugin(),
			// The Brain takes at most 1000 forms.
			'forms'       => array_slice( self::forms(), 0, self::FORMS_MAX ),
			'entries'     => self::entries(),
			'deliveries'  => self::deliveries(),
			'connections' => self::connections(),
			'migration'   => self::counts( 'migration_items', 'status' ),
			'checks'      => array_map(
				static fn( array $r ): array => array(
					'test'   => $r['test'],
					'status' => $r['status'],
					'label'  => $r['label'],
				),
				array( SiteHealth::deliveries(), SiteHealth::jobs() )
			),
			'audit'       => array_map(
				static fn( array $row ): array => array(
					'time'   => $row['created_at'],
					'action' => $row['action'],
					'object' => $row['object_type'] . ( '' !== $row['object_id'] ? ':' . $row['object_id'] : '' ),
					'user'   => (int) $row['actor_id'],
				),
				self::audit( self::AUDIT_ROWS )
			),
		);
	}

	/**
	 * The few facts the ticket form shows of the diagnostics: versions, forms and failed
	 * deliveries of the last 30 days.
	 *
	 * @return array{WordPress:string,php:string,funnelforms:string,forms:int,failed:int}
	 */
	public static function summary(): array {
		global $wpdb;
		return array(
			'wordpress'   => (string) get_bloginfo( 'version' ),
			'php'         => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
			'funnelforms' => (string) FUNNELFORMS_VERSION,
			'forms'       => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE status <> 'trashed'", Schema::table( 'forms' ) ) ),
			'failed'      => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM %i WHERE status = 'failed' AND updated_at >= %s", Schema::table( 'jobs_log' ), gmdate( 'Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS ) ) ),
		);
	}

	/**
	 * WordPress, PHP, server, theme and plugins.
	 *
	 * @return array<string,mixed>
	 */
	private static function site(): array {
		global $wpdb;
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$active  = (array) get_option( 'active_plugins', array() );
		$plugins = array();
		foreach ( get_plugins() as $file => $plugin ) {
			if ( in_array( $file, $active, true ) || is_plugin_active_for_network( $file ) ) {
				$plugins[] = $plugin['Name'] . ' ' . $plugin['Version'];
			}
		}
		$theme = wp_get_theme();
		return array(
			'url'          => home_url(),
			'wordpress'    => get_bloginfo( 'version' ),
			'php'          => PHP_VERSION,
			'database'     => $wpdb->db_server_info(),
			'multisite'    => is_multisite(),
			'locale'       => get_locale(),
			'timezone'     => wp_timezone_string(),
			'memoryLimit'  => (string) ini_get( 'memory_limit' ),
			'debug'        => defined( 'WP_DEBUG' ) && WP_DEBUG,
			'objectCache'  => wp_using_ext_object_cache(),
			'cronDisabled' => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
			'theme'        => $theme->get( 'Name' ) . ' ' . $theme->get( 'Version' ),
			'plugins'      => $plugins,
		);
	}

	/**
	 * Version and settings of Funnelforms.
	 *
	 * @return array<string,mixed>
	 */
	private static function plugin(): array {
		$runtime = dirname( FUNNELFORMS_PLUGIN_FILE ) . '/assets/runtime/runtime.js';
		$captcha = Captcha::site();
		$embed   = Edition::pro( ExternalEmbed::class );
		return array(
			'version'         => (string) FUNNELFORMS_VERSION,
			'databaseVersion' => (string) get_option( Schema::VERSION_OPTION, '' ),
			'runtimeBuilt'    => is_readable( $runtime ) && filesize( $runtime ) > 0,
			'backgroundJobs'  => function_exists( 'as_schedule_single_action' ) ? 'Action Scheduler' : 'WP-Cron',
			'captcha'         => (string) ( $captcha['type'] ?? '' ),
			'privacyMode'     => PrivacyMode::current(),
			'trackingCode'    => TrackingCode::allowed(),
			'embedDomains'    => null === $embed ? 0 : count( $embed::domains() ),
			'diagnosticData'  => Consent::enabled(),
		);
	}

	/**
	 * Every form with its shape and what keeps it from the new renderer, without its texts.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	private static function forms(): array {
		global $wpdb;
		$rows  = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, title, status, renderer, legacy_post_id, current_revision_id, updated_at FROM %i ORDER BY id', Schema::table( 'forms' ) ), ARRAY_A );
		$forms = new FormRepository();
		$out   = array();
		foreach ( $rows as $row ) {
			$document = null === $row['current_revision_id'] ? null : $forms->document( (int) $row['current_revision_id'] );
			$form     = array(
				'id'        => (int) $row['id'],
				'title'     => (string) $row['title'],
				'status'    => (string) $row['status'],
				'renderer'  => (string) $row['renderer'],
				'legacy'    => null !== $row['legacy_post_id'],
				'published' => null !== $document,
				'updated'   => (string) $row['updated_at'],
			);
			if ( null !== $document ) {
				$nodes = (array) ( $document['nodes'] ?? array() );
				$form += array(
					'locales'  => (array) ( $document['locales']['available'] ?? array() ),
					'nodes'    => array_count_values( array_map( static fn( $n ): string => (string) ( $n['type'] ?? '' ), $nodes ) ),
					'fields'   => self::field_types( $nodes ),
					'actions'  => array_values( array_map( static fn( $a ): string => (string) ( $a['kind'] ?? '' ), (array) ( $document['actions'] ?? array() ) ) ),
					'problems' => array_values( array_merge( RendererSupport::problems( $document ), DocumentChecker::check( $document ) ) ),
				);
			}
			$out[] = $form;
		}
		return $out;
	}

	/**
	 * How often each field type occurs in the nodes.
	 *
	 * @param array<int|string,mixed> $nodes Nodes of a document.
	 * @return array<string,int>
	 */
	private static function field_types( array $nodes ): array {
		$out = array();
		foreach ( $nodes as $node ) {
			foreach ( (array) ( $node['fields'] ?? array() ) as $field ) {
				$type         = (string) ( $field['type'] ?? '' );
				$out[ $type ] = ( $out[ $type ] ?? 0 ) + 1;
			}
		}
		return $out;
	}

	/**
	 * Numbers of entries, never their content.
	 *
	 * @return array<string,int>
	 */
	private static function entries(): array {
		global $wpdb;
		$table = Schema::table( 'entries' );
		$since = static fn( int $days ): int => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE created_at >= %s', $table, gmdate( 'Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS ) ) );
		return array(
			'total'      => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table ) ),
			'last7Days'  => $since( 7 ),
			'last30Days' => $since( 30 ),
		) + array_map( 'intval', self::counts( 'entries', 'status' ) );
	}

	/**
	 * Deliveries of the last 30 days by status, their error codes and the latest ones.
	 *
	 * @return array<string,mixed>
	 */
	private static function deliveries(): array {
		global $wpdb;
		$rows   = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT status, last_error, COUNT(*) AS n FROM %i WHERE updated_at >= %s GROUP BY status, last_error',
				Schema::table( 'jobs_log' ),
				gmdate( 'Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS )
			),
			ARRAY_A
		);
		$status = array();
		$errors = array();
		foreach ( $rows as $row ) {
			$status[ $row['status'] ] = ( $status[ $row['status'] ] ?? 0 ) + (int) $row['n'];
			if ( 'failed' === $row['status'] ) {
				$errors[ self::redact( (string) $row['last_error'] ) ] = (int) $row['n'];
			}
		}
		arsort( $errors );
		return array(
			'last30Days' => $status,
			'failed'     => $errors,
			'latest'     => array_map(
				static fn( array $d ): array => array(
					'time'     => $d['time'],
					'kind'     => $d['kind'],
					'status'   => $d['status'],
					'attempts' => $d['attempts'],
					'error'    => self::redact( $d['error'] ),
				),
				MailDiagnostics::recent( 20 )
			),
		);
	}

	/**
	 * Connections by type; their labels and keys stay out.
	 *
	 * @return array<string,int>
	 */
	private static function connections(): array {
		return array_map( 'intval', self::counts( 'connections', 'type' ) );
	}

	/**
	 * Rows of a table counted by a column.
	 *
	 * @param string $table  Short table name.
	 * @param string $column Column.
	 * @return array<string,int>
	 */
	private static function counts( string $table, string $column ): array {
		global $wpdb;
		$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT %i AS k, COUNT(*) AS n FROM %i GROUP BY %i', $column, Schema::table( $table ), $column ), ARRAY_A );
		$out  = array();
		foreach ( $rows as $row ) {
			$out[ (string) $row['k'] ] = (int) $row['n'];
		}
		return $out;
	}

	/**
	 * The latest admin actions, newest first.
	 *
	 * @param int $limit Rows.
	 * @return array<int,array<string,mixed>>
	 */
	public static function audit( int $limit ): array {
		global $wpdb;
		return (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT id, actor_id, action, object_type, object_id, created_at FROM %i ORDER BY id DESC LIMIT %d', Schema::table( 'audit_log' ), $limit ),
			ARRAY_A
		);
	}

	/**
	 * An error message without e-mail addresses (mail servers quote them).
	 *
	 * @param string $message Message.
	 */
	public static function redact( string $message ): string {
		return (string) preg_replace( '/[^\s<>"\'(),;:]+@[^\s<>"\'(),;:]+\.[a-z]{2,}/i', '[e-mail]', $message );
	}

	/**
	 * The diagnostics card of the Support page: what the file holds, the download and the latest
	 * admin actions (folded).
	 */
	public static function render(): void {
		$rows    = self::audit( 20 );
		$summary = self::summary();
		$check   = Ui::icon( 'check' );
		?>
		<div class="ffx-card__head ffx-diag__head">
			<div>
				<h2 id="ffx-support"><?php esc_html_e( 'Diagnostics', 'funnelforms-free' ); ?></h2>
				<p><?php esc_html_e( 'The diagnostics file holds versions, settings, numbers of entries and deliveries, error codes and the structure of your forms, so support can look into a problem. It holds no entries, contact data or keys. Attach it to your support request.', 'funnelforms-free' ); ?></p>
			</div>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline-form">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
				<input type="hidden" name="_wpnonce" value="<?php echo esc_attr( wp_create_nonce( self::ACTION ) ); ?>">
				<button type="submit" class="ffx-btn"><?php echo Ui::icon( 'download' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Download diagnostics', 'funnelforms-free' ); ?></span></button>
			</form>
		</div>
		<ul class="ffx-facts ffx-facts--small ffx-diag__facts">
			<li><?php echo $check; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php echo esc_html( 'WordPress ' . $summary['wordpress'] . ' · PHP ' . $summary['php'] . ' · Funnelforms ' . $summary['funnelforms'] ); ?></span></li>
			<li><?php echo $check; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span>
				<?php
				/* translators: %s: number of forms. */
				echo esc_html( sprintf( _n( '%s form', '%s forms', $summary['forms'], 'funnelforms-free' ), number_format_i18n( $summary['forms'] ) ) );
				?>
			</span></li>
			<li><?php echo $check; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span>
				<?php
				/* translators: %s: number of failed deliveries. */
				echo esc_html( sprintf( _n( '%s failed delivery in 30 days', '%s failed deliveries in 30 days', $summary['failed'], 'funnelforms-free' ), number_format_i18n( $summary['failed'] ) ) );
				?>
			</span></li>
		</ul>
		<details class="ffx-more ffx-diag__log">
			<summary><?php esc_html_e( 'Latest admin actions', 'funnelforms-free' ); ?></summary>
			<?php if ( array() === $rows ) : ?>
				<p class="ffx-muted"><?php esc_html_e( 'No admin actions recorded yet.', 'funnelforms-free' ); ?></p>
			<?php else : ?>
				<div class="ffx-table-wrap">
					<table class="widefat striped">
						<thead>
							<tr>
								<th scope="col"><?php esc_html_e( 'Time', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'Action', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'Concerns', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'By', 'funnelforms-free' ); ?></th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $rows as $row ) : ?>
								<?php $user = (int) $row['actor_id'] > 0 ? get_userdata( (int) $row['actor_id'] ) : false; ?>
								<tr>
									<td><?php echo esc_html( get_date_from_gmt( (string) $row['created_at'], get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) ) ); ?></td>
									<td><?php echo esc_html( self::action_label( (string) $row['action'] ) ); ?></td>
									<td><code><?php echo esc_html( $row['object_type'] . ( '' !== $row['object_id'] ? ' ' . $row['object_id'] : '' ) ); ?></code></td>
									<td><?php echo esc_html( $user ? $user->display_name : __( 'System', 'funnelforms-free' ) ); ?></td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
				</div>
			<?php endif; ?>
		</details>
		<?php
	}

	/**
	 * Readable name of an admin action; unknown ones keep their code.
	 *
	 * @param string $action Code.
	 */
	public static function action_label( string $action ): string {
		$labels = array(
			'form_created'                      => __( 'Form created', 'funnelforms-free' ),
			'form_from_template'                => __( 'Form created from a template', 'funnelforms-free' ),
			'form_imported'                     => __( 'Form imported', 'funnelforms-free' ),
			'form_published'                    => __( 'Form published', 'funnelforms-free' ),
			'form_status'                       => __( 'Form status changed', 'funnelforms-free' ),
			'form_deleted'                      => __( 'Form deleted', 'funnelforms-free' ),
			'form_revision_restored'            => __( 'Form version restored', 'funnelforms-free' ),
			'form_lock_taken'                   => __( 'Form editing taken over', 'funnelforms-free' ),
			'connection_created'                => __( 'Connection added', 'funnelforms-free' ),
			'connection_updated'                => __( 'Connection changed', 'funnelforms-free' ),
			'connection_deleted'                => __( 'Connection removed', 'funnelforms-free' ),
			'api_token_created'                 => __( 'API token created', 'funnelforms-free' ),
			'api_token_revoked'                 => __( 'API token revoked', 'funnelforms-free' ),
			'app_paired'                        => __( 'App connected', 'funnelforms-free' ),
			'app_revoked'                       => __( 'App disconnected', 'funnelforms-free' ),
			'webhook_secret_rotated'            => __( 'Webhook secret renewed', 'funnelforms-free' ),
			'entries_exported'                  => __( 'Entries exported', 'funnelforms-free' ),
			'entries_erased'                    => __( 'Entries erased on request', 'funnelforms-free' ),
			'entries_expired'                   => __( 'Old entries deleted', 'funnelforms-free' ),
			'entry_deleted'                     => __( 'Entry deleted', 'funnelforms-free' ),
			'entry_assigned'                    => __( 'Entry assigned', 'funnelforms-free' ),
			'role_capabilities_changed'         => __( 'Rights of a role changed', 'funnelforms-free' ),
			'migration_started'                 => __( 'Migration started', 'funnelforms-free' ),
			'migration_finished'                => __( 'Migration finished', 'funnelforms-free' ),
			'entry_pdf_downloaded'              => __( 'Entry downloaded as PDF', 'funnelforms-free' ),
			'entry_published'                   => __( 'Entry shown on the website', 'funnelforms-free' ),
			'entry_unpublished'                 => __( 'Entry hidden on the website', 'funnelforms-free' ),
			'support_access_created'            => __( 'Support access granted', 'funnelforms-free' ),
			'support_access_used'               => __( 'Support logged in', 'funnelforms-free' ),
			'support_access_revoked'            => __( 'Support access ended', 'funnelforms-free' ),
			'support_access_expired'            => __( 'Support access ran out', 'funnelforms-free' ),
			'support_ticket_sent'               => __( 'Support ticket sent', 'funnelforms-free' ),
			'support_ticket_answered'           => __( 'Answered a support ticket', 'funnelforms-free' ),
			'support_ticket_closed'             => __( 'Support ticket closed', 'funnelforms-free' ),
			'license_connected'                 => __( 'Website connected with Funnelforms', 'funnelforms-free' ),
			'license_activated_with_code'       => __( 'Website activated with a code', 'funnelforms-free' ),
			'license_activated_with_legacy_key' => __( 'Website activated with the license key of Funnelforms 3', 'funnelforms-free' ),
			'license_disconnected'              => __( 'Website disconnected from Funnelforms', 'funnelforms-free' ),
			'license_disconnected_remotely'     => __( 'Funnelforms no longer knows this website', 'funnelforms-free' ),
		);
		return $labels[ $action ] ?? $action;
	}
}
