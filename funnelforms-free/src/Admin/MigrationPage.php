<?php
/**
 * The move from Funnelforms 3 (Funnelforms → Migration).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;
use Funnelforms\Application\FormRenderer;
use Funnelforms\Application\LeadMirror;
use Funnelforms\Application\SetupFlow;
use Funnelforms\Compat\Migration\AutoRenderer;
use Funnelforms\Compat\Migration\FormVerifier;
use Funnelforms\Compat\Migration\MigrationLog;
use Funnelforms\Compat\Migration\MigrationReport;
use Funnelforms\Compat\Migration\MigrationRunner;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Compat\Migration\Migrator;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Compat\Safety\LegacyCheck;
use Funnelforms\Compat\Safety\Rollback;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\LegacyPreview;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Shows at a glance what was copied from Funnelforms 3, what was checked and where each form runs;
 * every form with its check, a comparison of old and new and its own way back; the restore point
 * and the way back of the whole site (SafetySection); and a log of everything that happened.
 * Shows counts, form titles and technical findings only, never lead content.
 */
final class MigrationPage {

	private const SLUG     = 'funnelforms-migration';
	private const ACTION   = 'funnelforms_migration_start';
	private const RENDERER = 'funnelforms_form_renderer';
	private const ALL      = 'funnelforms_form_renderer_all';
	private const REIMPORT = 'funnelforms_migration_reimport';
	private const AUTO     = 'funnelforms_auto_renderer';
	public const PROGRESS  = 'funnelforms_migration_progress';

	/**
	 * Registers the page and its handlers.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ), 30 );
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle_start' ) );
		add_action( 'admin_post_' . self::RENDERER, array( self::class, 'handle_renderer' ) );
		add_action( 'admin_post_' . self::ALL, array( self::class, 'handle_renderer_all' ) );
		add_action( 'admin_post_' . self::REIMPORT, array( self::class, 'handle_reimport' ) );
		if ( self::way_back() ) {
			add_action( 'admin_post_' . self::AUTO, array( self::class, 'handle_auto' ) );
		}
		add_action( 'wp_ajax_' . self::PROGRESS, array( self::class, 'ajax_progress' ) );
	}

	/**
	 * Adds the page below Funnelforms; in the menu once a migration ran, by address before.
	 */
	public static function menu(): void {
		$title  = __( 'Migration', 'funnelforms-free' );
		$parent = 'idle' === Migrator::state()['status'] && null === Migrator::state()['last_sync_at'] ? '' : Menu::SLUG;
		$hook   = add_submenu_page( $parent, $title, $title, Capabilities::MANAGE_SETTINGS, self::SLUG, array( self::class, 'render' ), Menu::POSITIONS['migration'] );
		Ui::screen( $hook );
		if ( is_string( $hook ) ) {
			add_action( 'load-' . $hook, array( self::class, 'title' ) );
		}
	}

	/**
	 * Sets the title of the page for the browser and the admin header.
	 */
	public static function title(): void {
		global $title;
		$title = __( 'Migration', 'funnelforms-free' ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- WordPress finds no title for a page outside the menu.
	}

	/**
	 * Address of the page.
	 *
	 * @param array<string,string|int> $args Query arguments (tab, form, view …).
	 */
	public static function url( array $args = array() ): string {
		return add_query_arg( $args, admin_url( 'admin.php?page=' . self::SLUG ) );
	}

	/*
	 * Handlers.
	 */

	/**
	 * Starts a full run.
	 */
	public static function handle_start(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::ACTION );
		if ( 'running' === Migrator::state()['status'] ) {
			wp_safe_redirect( self::url( array( 'done' => 'busy' ) ) );
			exit;
		}
		MigrationRunner::start( 'full' );
		wp_safe_redirect( self::url( array( 'done' => 'started' ) ) );
		exit;
	}

	/**
	 * Moves one form to Funnelforms 5. The way back of one form asks first (SafetySection).
	 */
	public static function handle_renderer(): void {
		if ( ! current_user_can( Capabilities::EDIT_FORMS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		$form_id = isset( $_POST['form'] ) ? absint( $_POST['form'] ) : 0;
		check_admin_referer( self::RENDERER . '_' . $form_id );
		$blockers = self::renderers()->switch_to( $form_id, FormRepository::RENDERER_V5 );
		if ( array() === $blockers ) {
			AutoRenderer::unpin( $form_id );
		}
		wp_safe_redirect(
			self::url(
				array(
					'tab'  => 'forms',
					'form' => $form_id,
					'done' => array() === $blockers ? 'switched' : 'blocked',
				)
			)
		);
		exit;
	}

	/**
	 * Moves every form that can to Funnelforms 5 at once; after a way back, the forms that ran
	 * there before.
	 */
	public static function handle_renderer_all(): void {
		if ( ! current_user_can( Capabilities::EDIT_FORMS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::ALL );
		if ( Rollback::active() && current_user_can( 'manage_options' ) ) {
			$result = Rollback::to_v5();
			$result = array(
				'switched' => $result['switched'],
				'stayed'   => count( $result['stayed'] ),
			);
		} else {
			$result = self::renderers()->switch_all( FormRepository::RENDERER_V5 );
		}
		// Moved by hand: forms kept on Funnelforms 3 before are no longer kept there.
		$forms = new FormRepository();
		foreach ( AutoRenderer::pinned() as $id ) {
			if ( FormRepository::RENDERER_V5 === ( $forms->by_id( $id )['renderer'] ?? '' ) ) {
				AutoRenderer::unpin( $id );
			}
		}
		wp_safe_redirect(
			self::url(
				array(
					'tab'      => 'forms',
					'done'     => 'all_v5',
					'switched' => $result['switched'],
					'stayed'   => $result['stayed'],
				)
			)
		);
		exit;
	}

	/**
	 * Imports one form again and checks it again.
	 */
	public static function handle_reimport(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		$legacy_id = isset( $_POST['legacy'] ) ? absint( $_POST['legacy'] ) : 0;
		check_admin_referer( self::REIMPORT . '_' . $legacy_id );
		$status = 'busy';
		if ( 'running' !== Migrator::state()['status'] && MigrationRunner::lock() ) {
			try {
				$status = MigrationRunner::migrator()->reimport_form( $legacy_id );
			} finally {
				MigrationRunner::unlock();
			}
			AutoRenderer::apply();
		}
		$form = ( new FormRepository() )->by_legacy_id( $legacy_id );
		wp_safe_redirect(
			self::url(
				array(
					'tab'    => 'forms',
					'form'   => (int) ( $form['id'] ?? 0 ),
					'legacy' => $legacy_id,
					'done'   => 'reimported',
					'status' => $status,
				)
			)
		);
		exit;
	}

	/**
	 * Saves whether checked forms move to the new renderer on their own.
	 */
	public static function handle_auto(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::AUTO );
		$on    = ! empty( $_POST['auto'] );
		$count = AutoRenderer::set( $on );
		wp_safe_redirect(
			self::url(
				array(
					'tab'      => 'forms',
					'done'     => $on ? 'auto_on' : 'auto_off',
					'switched' => $count,
				)
			)
		);
		exit;
	}

	/**
	 * AJAX: moves a long job on (import, check, restore, restore point) and answers with its
	 * progress.
	 */
	public static function ajax_progress(): void {
		check_ajax_referer( self::PROGRESS );
		$job = isset( $_GET['job'] ) ? sanitize_key( wp_unslash( $_GET['job'] ) ) : '';
		if ( ! current_user_can( 'import' === $job ? Capabilities::MANAGE_SETTINGS : 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}
		wp_send_json_success( 'import' === $job ? self::import_progress( SetupFlow::drive() ) : SafetySection::drive( $job ) );
	}

	/**
	 * Progress of the restore point and the import.
	 *
	 * @param array<string,mixed> $status SetupFlow::import_status().
	 * @return array{status:string,percent:int,text:string}
	 */
	private static function import_progress( array $status ): array {
		$steps = count( Migrator::PHASES ) + 1;
		$done  = 'backup' === $status['phase'] ? 0 : 1 + (int) $status['import']['phase'];
		$texts = array(
			'connections'   => __( 'Copying connections …', 'funnelforms-free' ),
			'booking_types' => __( 'Copying appointment types …', 'funnelforms-free' ),
			'forms'         => __( 'Copying and checking forms …', 'funnelforms-free' ),
			'entries'       => __( 'Copying leads …', 'funnelforms-free' ),
			'bookings'      => __( 'Copying appointments …', 'funnelforms-free' ),
		);
		$text  = match ( $status['phase'] ) {
			'backup' => __( 'Saving a restore point of Funnelforms 3 …', 'funnelforms-free' ),
			'failed' => SafetySection::error_label( (string) $status['backup']['error'] ),
			'done'   => __( 'Done.', 'funnelforms-free' ),
			default  => $texts[ Migrator::PHASES[ (int) $status['import']['phase'] ] ?? '' ] ?? __( 'Copying …', 'funnelforms-free' ),
		};
		return array(
			'status'  => in_array( $status['phase'], array( 'done', 'failed' ), true ) ? $status['phase'] : 'running',
			'percent' => 'done' === $status['phase'] ? 100 : (int) round( 100 * min( $done, $steps ) / $steps ),
			'text'    => $text,
		);
	}

	/**
	 * The renderer use case.
	 */
	private static function renderers(): FormRenderer {
		return new FormRenderer( new FormRepository(), new MigrationStore( SecretBox::for_site() ) );
	}

	/**
	 * Short reason why a form stays on the 3.x renderer.
	 *
	 * @param string $code Blocker code.
	 */
	public static function blocker_label( string $code ): string {
		if ( str_starts_with( $code, 'pro feature ' ) ) {
			$feature = substr( $code, 12 );
			return Edition::labels()[ $feature ] ?? $feature;
		}
		$parts  = explode( ':', $code );
		$labels = array(
			'needs_review'               => __( 'the comparison found differences', 'funnelforms-free' ),
			'not_verified'               => __( 'the migration check did not pass', 'funnelforms-free' ),
			'runtime_not_built'          => __( 'the new renderer is missing in this build', 'funnelforms-free' ),
			'no_document'                => __( 'the form was not imported', 'funnelforms-free' ),
			'no_backup'                  => __( 'there is no restore point of the Funnelforms 3 data yet', 'funnelforms-free' ),
			'rollback_active'            => __( 'the site went back to Funnelforms 3', 'funnelforms-free' ),
			'tracking_code_not_allowed'  => __( 'tracking code is not allowed on this site', 'funnelforms-free' ),
			'script_in_content'          => __( 'scripts in content are not allowed on this site', 'funnelforms-free' ),
			'input_mask'                 => __( 'an input mask Funnelforms 5 does not know', 'funnelforms-free' ),
			'captcha_not_configured'     => __( 'the keys of the captcha are missing', 'funnelforms-free' ),
			'google_maps_key_missing'    => __( 'Google Maps key for address suggestions is missing', 'funnelforms-free' ),
			'sms_not_configured'         => __( 'a phone field confirmed by text message has no SMS connection', 'funnelforms-free' ),
			'booking_type_missing'       => __( 'the appointment type of a booking question is missing', 'funnelforms-free' ),
			'booking_calendar_reconnect' => __( 'the Cronofy calendar connection of an appointment type is gone; connect the calendar again and set up the appointment type again', 'funnelforms-free' ),
			/* translators: %s: technical name of a field type, e.g. file. */
			'field_type'                 => __( 'field type %s', 'funnelforms-free' ),
			/* translators: %s: technical name of an integration, e.g. crm:hubspot. */
			'action'                     => __( 'integration %s', 'funnelforms-free' ),
		);
		$label  = $labels[ $parts[0] ] ?? $code;
		return str_contains( $label, '%s' ) ? sprintf( $label, implode( ':', array_slice( $parts, 1 ) ) ) : $label;
	}

	/*
	 * Page.
	 */

	/**
	 * Renders the page.
	 */
	public static function render(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			return;
		}
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- navigation only.
		$view = isset( $_GET['view'] ) ? sanitize_key( wp_unslash( $_GET['view'] ) ) : '';
		$tab  = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'overview';
		$form = isset( $_GET['form'] ) ? absint( $_GET['form'] ) : 0;
		$old  = isset( $_GET['legacy'] ) ? absint( $_GET['legacy'] ) : 0;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended
		self::scripts();
		if ( '' !== $view && self::way_back() && current_user_can( 'manage_options' ) ) {
			Ui::open(
				array(
					'title'  => __( 'Migration', 'funnelforms-free' ),
					'head'   => false,
					'narrow' => true,
				)
			);
			SafetySection::render_view( $view );
			Ui::close();
			return;
		}
		$tabs = self::tabs();
		$tab  = isset( $tabs[ $tab ] ) ? $tab : 'overview';
		Ui::open(
			array(
				'title'   => __( 'Migration', 'funnelforms-free' ),
				'lead'    => self::way_back() ? __( 'Your forms, leads and appointments from Funnelforms 3, copied into Funnelforms 5 and checked. Funnelforms 3 stays untouched, so you can go back at any time.', 'funnelforms-free' ) : __( 'Your forms and leads from Funnelforms 3, copied into Funnelforms 5 and checked. The data of Funnelforms 3 stays untouched.', 'funnelforms-free' ),
				'actions' => self::way_back() && current_user_can( 'manage_options' ) ? Ui::button( __( 'Way back', 'funnelforms-free' ), self::url( array( 'tab' => 'wayback' ) ), 'ghost', 'undo' ) : '',
			)
		);
		self::messages();
		Ui::tabs( $tabs, $tab, self::url() );
		echo '<div class="ffx-mig">';
		if ( 'forms' === $tab && ( $form > 0 || $old > 0 ) ) {
			self::render_form( $form, $old );
		} elseif ( 'forms' === $tab ) {
			self::render_forms();
		} elseif ( 'wayback' === $tab ) {
			SafetySection::render_cards();
		} elseif ( 'log' === $tab ) {
			self::render_log( 100 );
		} else {
			self::render_overview();
		}
		echo '</div>';
		Ui::close();
	}

	/**
	 * The tabs.
	 *
	 * @return array<string,array{label:string,icon:string}>
	 */
	private static function tabs(): array {
		$tabs = array(
			'overview' => array(
				'label' => __( 'Overview', 'funnelforms-free' ),
				'icon'  => 'home',
			),
			'forms'    => array(
				'label' => __( 'Forms', 'funnelforms-free' ),
				'icon'  => 'form',
			),
		);
		if ( self::way_back() && current_user_can( 'manage_options' ) ) {
			$tabs['wayback'] = array(
				'label' => __( 'Way back', 'funnelforms-free' ),
				'icon'  => 'undo',
			);
		}
		$tabs['log'] = array(
			'label' => __( 'Log', 'funnelforms-free' ),
			'icon'  => 'history',
		);
		return $tabs;
	}

	/**
	 * Script of the page: progress of long jobs and the comparison of old and new. The way back on
	 * the settings page loads it too.
	 */
	public static function scripts(): void {
		wp_enqueue_script( 'funnelforms-migration', plugins_url( 'assets/admin/migration.js', FUNNELFORMS_PLUGIN_FILE ), array(), FUNNELFORMS_ASSET_VERSION, true );
		wp_localize_script(
			'funnelforms-migration',
			'funnelformsMigration',
			array(
				'ajax'     => admin_url( 'admin-ajax.php' ),
				'progress' => wp_create_nonce( self::PROGRESS ),
				'preview'  => wp_create_nonce( SetupPage::PREVIEW ),
				'texts'    => array(
					'loading' => __( 'Loading the preview …', 'funnelforms-free' ),
					'failed'  => __( 'The progress could not be loaded. It goes on in the background; reload the page in a moment.', 'funnelforms-free' ),
				),
			)
		);
	}

	/**
	 * Results of the last action.
	 */
	private static function messages(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- display only.
		$done     = isset( $_GET['done'] ) ? sanitize_key( wp_unslash( $_GET['done'] ) ) : '';
		$switched = isset( $_GET['switched'] ) ? absint( $_GET['switched'] ) : 0;
		$stayed   = isset( $_GET['stayed'] ) ? absint( $_GET['stayed'] ) : 0;
		$status   = isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Recommended
		$notice = static function ( string $tone, string $text ): void {
			echo '<div class="notice notice-' . esc_attr( $tone ) . '" role="status"><p>' . esc_html( $text ) . '</p></div>';
		};
		switch ( $done ) {
			case 'started':
				$notice( 'success', __( 'The copy has started. It runs in the background; this page shows its progress.', 'funnelforms-free' ) );
				break;
			case 'busy':
				$notice( 'warning', __( 'A copy is running right now. Try again in a moment.', 'funnelforms-free' ) );
				break;
			case 'switched':
				$notice( 'success', __( 'The form runs on Funnelforms 5 now. Your pages and shortcodes stay as they are.', 'funnelforms-free' ) );
				break;
			case 'blocked':
				$notice( 'error', __( 'The form cannot move yet. Below you see why and how to fix it.', 'funnelforms-free' ) );
				break;
			case 'all_v5':
				/* translators: %d: number of forms. */
				$text = sprintf( _n( '%d form runs on Funnelforms 5 now.', '%d forms run on Funnelforms 5 now.', $switched, 'funnelforms-free' ), $switched );
				if ( $stayed > 0 ) {
					/* translators: %d: number of forms. */
					$text .= ' ' . sprintf( _n( '%d form stays on Funnelforms 3 for now; the table shows why.', '%d forms stay on Funnelforms 3 for now; the table shows why.', $stayed, 'funnelforms-free' ), $stayed );
				}
				$notice( 'success', $text );
				break;
			case 'auto_on':
				$notice(
					'success',
					0 === $switched ? __( 'Saved. Checked forms now move to Funnelforms 5 on their own.', 'funnelforms-free' )
					/* translators: %d: number of forms. */
					: sprintf( _n( 'Saved. %d checked form moved to Funnelforms 5.', 'Saved. %d checked forms moved to Funnelforms 5.', $switched, 'funnelforms-free' ), $switched )
				);
				break;
			case 'auto_off':
				$notice(
					'success',
					0 === $switched ? __( 'Saved. Forms only move to Funnelforms 5 when you move them.', 'funnelforms-free' )
					/* translators: %d: number of forms. */
					: sprintf( _n( 'Saved. %d form that had moved on its own runs on Funnelforms 3 again.', 'Saved. %d forms that had moved on their own run on Funnelforms 3 again.', $switched, 'funnelforms-free' ), $switched )
				);
				break;
			case 'reimported':
				$text = match ( $status ) {
					FormVerifier::VERIFIED     => __( 'Imported again and checked: the form behaves exactly as in Funnelforms 3.', 'funnelforms-free' ),
					FormVerifier::NEEDS_REVIEW => __( 'Imported again. The comparison still finds differences; they are listed below.', 'funnelforms-free' ),
					'busy'                     => __( 'A copy is running right now. Try again in a moment.', 'funnelforms-free' ),
					'not_found'                => __( 'This form no longer exists in Funnelforms 3, so it cannot be imported again. Its copy in Funnelforms 5 stays.', 'funnelforms-free' ),
					default                    => __( 'Imported again, but the form could not be copied. It keeps running on Funnelforms 3.', 'funnelforms-free' ),
				};
				$notice( FormVerifier::VERIFIED === $status ? 'success' : 'warning', $text );
				break;
		}
	}

	/*
	 * Overview.
	 */

	/**
	 * Tab: everything at a glance.
	 */
	private static function render_overview(): void {
		$state   = Migrator::state();
		$data    = MigrationReport::data();
		$forms   = MigrationReport::forms();
		$files   = MigrationReport::files();
		$new     = MigrationReport::new_entries();
		$by      = array_count_values( array_column( $forms, 'state' ) );
		$on_v5   = (int) ( $by['v5'] ?? 0 );
		$total   = count( $forms );
		$running = 'running' === $state['status'] || LegacyBackup::running();
		self::hero( $state, $data, $by, $total, $running );
		/**
		 * Fires below the state of the move on the migration overview. Pro shows here the
		 * appointment types from 3.x that lost their Cronofy calendar (CronofyNotice).
		 */
		do_action( 'funnelforms_migration_overview_top' );
		?>
		<div class="ffx-grid ffx-mig-kpis ffx-section">
			<?php
			$f = $data['forms'];
			self::kpi(
				'form',
				MigrationTexts::kind( 'forms' ),
				number_format_i18n( $f['legacy'] ),
				/* translators: 1: forms checked, 2: forms to look at. */
				0 === $f['review'] + $f['failed'] + $f['pending'] ? __( 'All copied and checked', 'funnelforms-free' ) : sprintf( __( '%1$s checked, %2$s to look at', 'funnelforms-free' ), number_format_i18n( $f['verified'] ), number_format_i18n( $f['review'] + $f['failed'] + $f['pending'] ) ),
				0 === $f['failed'] + $f['missing'] + $f['pending'] && 0 === $f['review'] ? 'ok' : 'warn'
			);
			foreach ( array( 'leads', 'bookings' ) as $kind ) {
				$k = $data[ $kind ];
				self::kpi( 'leads' === $kind ? 'inbox' : 'calendar', MigrationTexts::kind( $kind ), number_format_i18n( $k['legacy'] - $k['mirror'] ), self::accounted( $k ), $k['ok'] ? 'ok' : 'warn' );
			}
			self::kpi(
				'download',
				MigrationTexts::kind( 'files' ),
				number_format_i18n( $files['total'] ),
				$files['found'] === $files['checked'] ? __( 'All found in the uploads folder', 'funnelforms-free' ) : sprintf(
					/* translators: %s: number of files. */
					_n( '%s file is missing in the uploads folder', '%s files are missing in the uploads folder', $files['checked'] - $files['found'], 'funnelforms-free' ),
					number_format_i18n( $files['checked'] - $files['found'] )
				),
				$files['found'] === $files['checked'] ? 'ok' : 'warn'
			);
			?>
		</div>

		<div class="ffx-split ffx-section">
			<section class="ffx-card" aria-labelledby="ffx-mig-data">
				<div class="ffx-card__head">
					<div>
						<h2 id="ffx-mig-data"><?php esc_html_e( 'What was copied and checked', 'funnelforms-free' ); ?></h2>
						<p><?php esc_html_e( 'Every piece of Funnelforms 3 data is accounted for: copied, checked, or with a reason why not.', 'funnelforms-free' ); ?></p>
					</div>
				</div>
				<?php self::data_rows( $data, $files, $new ); ?>
			</section>
			<section class="ffx-card" aria-labelledby="ffx-mig-where">
				<div class="ffx-card__head">
					<h2 id="ffx-mig-where"><?php esc_html_e( 'Where your forms run', 'funnelforms-free' ); ?></h2>
				</div>
				<?php self::where( $by, $total ); ?>
				<p class="ffx-mig-where__auto"><?php echo esc_html( self::auto_sentence() ); ?></p>
				<div class="ffx-mig-where__actions">
					<?php if ( ( (int) ( $by['ready'] ?? 0 ) > 0 || Rollback::active() ) && current_user_can( Capabilities::EDIT_FORMS ) ) : ?>
						<?php self::all_v5_button( 'primary' ); ?>
					<?php endif; ?>
					<?php echo Ui::button( __( 'See all forms', 'funnelforms-free' ), self::url( array( 'tab' => 'forms' ) ), $on_v5 === $total ? 'secondary' : 'ghost', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
				</div>
			</section>
		</div>

		<?php self::attention( $forms, $data, $files ); ?>

		<section class="ffx-card ffx-section" aria-labelledby="ffx-mig-latest">
			<div class="ffx-card__head">
				<h2 id="ffx-mig-latest"><?php esc_html_e( 'Latest activity', 'funnelforms-free' ); ?></h2>
				<?php echo Ui::button( __( 'Full log', 'funnelforms-free' ), self::url( array( 'tab' => 'log' ) ), 'ghost', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
			</div>
			<?php self::timeline( MigrationLog::with_backups( MigrationLog::timeline( 5 ) ), 5 ); ?>
		</section>
		<?php
	}

	/**
	 * The state of the move in one sentence, with the next step and the share of forms on 5.
	 *
	 * @param array<string,mixed>               $state   Migrator::state().
	 * @param array<string,array<string,mixed>> $data    MigrationReport::data().
	 * @param array<string,int>                 $by      Forms per state.
	 * @param int                               $total   Forms from Funnelforms 3.
	 * @param bool                              $running Whether a copy or restore point runs.
	 */
	private static function hero( array $state, array $data, array $by, int $total, bool $running ): void {
		$on_v5    = (int) ( $by['v5'] ?? 0 );
		$attn     = (int) ( $by['review'] ?? 0 ) + (int) ( $by['stays'] ?? 0 );
		$all_data = $data['leads']['ok'] && $data['bookings']['ok'] && $data['booking_types']['ok'];
		$rollback = Rollback::active();
		if ( $running ) {
			$tone  = 'running';
			$title = __( 'Your data is being copied', 'funnelforms-free' );
			$text  = __( 'Funnelforms saves a restore point and copies your forms, leads and appointments. You can leave this page; it goes on in the background.', 'funnelforms-free' );
		} elseif ( null === $state['last_sync_at'] ) {
			$tone  = 'idle';
			$title = __( 'Your data has not been copied yet', 'funnelforms-free' );
			$text  = __( 'Start the copy: Funnelforms saves a restore point first and then copies everything. Funnelforms 3 keeps running meanwhile.', 'funnelforms-free' );
		} elseif ( $rollback ) {
			$tone  = 'rollback';
			$title = __( 'Your forms run on Funnelforms 3 again', 'funnelforms-free' );
			$text  = __( 'Nothing was lost: the copy in Funnelforms 5 keeps in step with Funnelforms 3 every hour. One click takes you forward again.', 'funnelforms-free' );
		} elseif ( $total > 0 && $on_v5 === $total && $all_data ) {
			$tone  = 'done';
			$title = __( 'Your move is complete', 'funnelforms-free' );
			$text  = __( 'Every form runs on Funnelforms 5, and every lead, appointment and file is accounted for. Funnelforms 3 stays as it was, together with the restore point.', 'funnelforms-free' );
		} elseif ( $attn > 0 ) {
			$tone = 'attention';
			/* translators: %d: number of forms. */
			$title = sprintf( _n( 'Copied and checked: %d form needs a look', 'Copied and checked: %d forms need a look', $attn, 'funnelforms-free' ), $attn );
			$text  = __( 'All your data is in Funnelforms 5. Forms that need a look keep running on Funnelforms 3 until you move them, so your visitors notice nothing.', 'funnelforms-free' );
		} else {
			$tone  = 'ready';
			$title = __( 'Copied and checked', 'funnelforms-free' );
			$text  = __( 'Every form behaves exactly as in Funnelforms 3. Move them to Funnelforms 5 when you are ready; you can come back at any time.', 'funnelforms-free' );
		}
		$share = $total > 0 ? $on_v5 / $total : 0;
		?>
		<section class="ffx-mig-hero is-<?php echo esc_attr( $tone ); ?>">
			<div class="ffx-mig-hero__main">
				<span class="ffx-hero__eyebrow"><?php echo Ui::icon( 'sparkles' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><?php esc_html_e( 'Funnelforms 3 → Funnelforms 5', 'funnelforms-free' ); ?></span>
				<h2><?php echo esc_html( $title ); ?></h2>
				<p><?php echo esc_html( $text ); ?></p>
				<?php if ( $running ) : ?>
					<?php self::job( 'import', self::import_progress( SetupFlow::import_status() ) ); ?>
				<?php endif; ?>
				<div class="ffx-hero__actions">
					<?php
					if ( $rollback && current_user_can( 'manage_options' ) ) {
						SafetySection::forward_button();
					} elseif ( 'ready' === $tone || ( 'attention' === $tone && (int) ( $by['ready'] ?? 0 ) > 0 ) ) {
						if ( current_user_can( Capabilities::EDIT_FORMS ) ) {
							self::all_v5_button( 'primary' );
						}
					} elseif ( 'attention' === $tone ) {
						echo Ui::button( __( 'See what needs a look', 'funnelforms-free' ), '#ffx-mig-attention', 'primary', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
					}
					if ( ! $running ) {
						self::start_button( null === $state['last_sync_at'] ? 'primary' : 'ghost' );
					}
					?>
				</div>
				<?php if ( null !== $state['last_sync_at'] && ! $running ) : ?>
					<?php /* translators: %s: date and time. */ ?>
					<p class="ffx-mig-hero__meta"><?php echo esc_html( sprintf( __( 'Last copy: %s. New and changed data of Funnelforms 3 follows every hour.', 'funnelforms-free' ), SafetySection::date( (string) $state['last_sync_at'] ) ) ); ?></p>
				<?php endif; ?>
			</div>
			<div class="ffx-mig-ring" style="--share:<?php echo esc_attr( number_format( 100 * $share, 1, '.', '' ) ); ?>" role="img" aria-label="<?php /* translators: 1: forms on Funnelforms 5, 2: all forms. */ echo esc_attr( sprintf( __( '%1$d of %2$d forms run on Funnelforms 5', 'funnelforms-free' ), $on_v5, $total ) ); ?>">
				<div class="ffx-mig-ring__inner">
					<strong><?php echo esc_html( number_format_i18n( $on_v5 ) ); ?><small>/<?php echo esc_html( number_format_i18n( $total ) ); ?></small></strong>
					<span><?php esc_html_e( 'forms on Funnelforms 5', 'funnelforms-free' ); ?></span>
				</div>
			</div>
		</section>
		<?php
	}

	/**
	 * A key figure with a status line.
	 *
	 * @param string $icon   Icon.
	 * @param string $label  Label.
	 * @param string $value  Value.
	 * @param string $hint   Status line.
	 * @param string $status ok or warn.
	 */
	private static function kpi( string $icon, string $label, string $value, string $hint, string $status ): void {
		?>
		<div class="ffx-card ffx-kpi">
			<span class="ffx-kpi__label"><span class="ffx-kpi__icon"><?php echo Ui::icon( $icon ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span><?php echo esc_html( $label ); ?></span>
			<span class="ffx-kpi__value"><?php echo esc_html( $value ); ?></span>
			<span class="ffx-mig-status is-<?php echo esc_attr( $status ); ?>"><?php echo esc_html( $hint ); ?></span>
		</div>
		<?php
	}

	/**
	 * Whether every 3.x item of a kind is accounted for, in words.
	 *
	 * @param array<string,mixed> $k MigrationReport::data() of one kind.
	 */
	private static function accounted( array $k ): string {
		if ( 0 === (int) $k['legacy'] ) {
			return __( 'None in Funnelforms 3', 'funnelforms-free' );
		}
		if ( $k['ok'] ) {
			return __( 'All copied and accounted for', 'funnelforms-free' );
		}
		$parts = array();
		if ( $k['pending'] > 0 ) {
			/* translators: %s: number of items. */
			$parts[] = sprintf( __( '%s follow with the next copy', 'funnelforms-free' ), number_format_i18n( $k['pending'] ) );
		}
		if ( $k['failed'] + $k['missing'] > 0 ) {
			/* translators: %s: number of items. */
			$parts[] = sprintf( __( '%s could not be copied', 'funnelforms-free' ), number_format_i18n( $k['failed'] + $k['missing'] ) );
		}
		return implode( ', ', $parts );
	}

	/**
	 * One row per kind of data, with a bar of what was copied.
	 *
	 * @param array<string,array<string,mixed>> $data  MigrationReport::data().
	 * @param array<string,int>                 $files MigrationReport::files().
	 * @param array<string,int>                 $fresh MigrationReport::new_entries().
	 */
	private static function data_rows( array $data, array $files, array $fresh ): void {
		$icons = array(
			'forms'         => 'form',
			'leads'         => 'inbox',
			'bookings'      => 'calendar',
			'booking_types' => 'layers',
		);
		echo '<ul class="ffx-mig-data">';
		foreach ( $data as $kind => $k ) {
			$from3 = (int) $k['legacy'] - (int) $k['mirror'];
			$done  = (int) $k['copied'] + (int) $k['removed'];
			$share = $from3 > 0 ? min( 1, $done / $from3 ) : 1;
			$tone  = $k['ok'] ? ( 'forms' === $kind && $k['review'] > 0 ? 'warning' : 'success' ) : ( $k['failed'] + $k['missing'] > 0 ? 'danger' : 'warning' );
			$meta  = array();
			/* translators: %s: number of items. */
			$meta[] = sprintf( __( '%s in Funnelforms 3', 'funnelforms-free' ), number_format_i18n( $from3 ) );
			/* translators: %s: number of items. */
			$meta[] = sprintf( __( '%s copied', 'funnelforms-free' ), number_format_i18n( (int) $k['copied'] ) );
			if ( 'forms' === $kind ) {
				/* translators: %s: number of forms. */
				$meta[] = sprintf( __( '%s checked identical', 'funnelforms-free' ), number_format_i18n( (int) $k['verified'] ) );
			}
			if ( $k['removed'] > 0 ) {
				/* translators: %s: number of leads. */
				$meta[] = sprintf( __( '%s deleted on purpose in Funnelforms 5', 'funnelforms-free' ), number_format_i18n( (int) $k['removed'] ) );
			}
			?>
			<li>
				<span class="ffx-avatar"><?php echo Ui::icon( $icons[ $kind ] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
				<span class="ffx-mig-data__main">
					<span class="ffx-mig-data__title"><?php echo esc_html( MigrationTexts::kind( $kind ) ); ?></span>
					<span class="ffx-mig-data__meta"><?php echo esc_html( implode( ' · ', $meta ) ); ?></span>
					<span class="ffx-mig-bar is-<?php echo esc_attr( $tone ); ?>"><span style="width:<?php echo esc_attr( number_format( 100 * $share, 1, '.', '' ) ); ?>%"></span></span>
					<?php if ( 'leads' === $kind && $fresh['imported_forms'] + $fresh['own_forms'] > 0 ) : ?>
						<span class="ffx-mig-data__note">
							<?php
							$n = $fresh['imported_forms'] + $fresh['own_forms'];
							echo esc_html(
								sprintf(
									/* translators: 1: entries that came in on Funnelforms 5, 2: of those, also in the Funnelforms 3 lead list. */
									_n( 'Plus %1$s entry that came in on Funnelforms 5 (%2$s of them also in the Funnelforms 3 lead list).', 'Plus %1$s entries that came in on Funnelforms 5 (%2$s of them also in the Funnelforms 3 lead list).', $n, 'funnelforms-free' ),
									number_format_i18n( $n ),
									number_format_i18n( $fresh['mirrored'] )
								)
							);
							?>
						</span>
					<?php endif; ?>
				</span>
				<?php echo Ui::badge( self::kind_label( $k, 'forms' === $kind ), $tone ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge(). ?>
			</li>
			<?php
		}
		$missing = $files['checked'] - $files['found'];
		?>
		<li>
			<span class="ffx-avatar"><?php echo Ui::icon( 'download' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<span class="ffx-mig-data__main">
				<span class="ffx-mig-data__title"><?php echo esc_html( MigrationTexts::kind( 'files' ) ); ?></span>
				<?php /* translators: %s: number of files. */ ?>
				<span class="ffx-mig-data__meta"><?php echo esc_html( sprintf( _n( '%s file of leads. It stays in the uploads folder of Funnelforms 3; Funnelforms 5 links to it.', '%s files of leads. They stay in the uploads folder of Funnelforms 3; Funnelforms 5 links to them.', $files['total'], 'funnelforms-free' ), number_format_i18n( $files['total'] ) ) ); ?></span>
				<span class="ffx-mig-bar is-<?php echo 0 === $missing ? 'success' : 'warning'; ?>"><span style="width:<?php echo esc_attr( $files['checked'] > 0 ? number_format( 100 * $files['found'] / $files['checked'], 1, '.', '' ) : '100' ); ?>%"></span></span>
			</span>
			<?php echo 0 === $missing ? Ui::badge( __( 'All found', 'funnelforms-free' ), 'success' ) : Ui::badge( __( 'Files missing', 'funnelforms-free' ), 'warning' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge(). ?>
		</li>
		</ul>
		<?php
	}

	/**
	 * Badge text of a kind of data.
	 *
	 * @param array<string,mixed> $k     MigrationReport::data() of one kind.
	 * @param bool                $forms Whether these are forms (they are checked, not only copied).
	 */
	private static function kind_label( array $k, bool $forms ): string {
		if ( $k['failed'] + $k['missing'] > 0 ) {
			return __( 'Not all copied', 'funnelforms-free' );
		}
		if ( $k['pending'] > 0 ) {
			return __( 'Follows soon', 'funnelforms-free' );
		}
		if ( $forms && $k['review'] > 0 ) {
			return __( 'Some need a look', 'funnelforms-free' );
		}
		return $forms ? __( 'Checked', 'funnelforms-free' ) : __( 'Complete', 'funnelforms-free' );
	}

	/**
	 * The forms by where they run, as one bar.
	 *
	 * @param array<string,int> $by    Forms per state.
	 * @param int               $total All forms.
	 */
	private static function where( array $by, int $total ): void {
		$parts = array(
			'v5'     => array( __( 'On Funnelforms 5', 'funnelforms-free' ), __( 'Your visitors see the new forms.', 'funnelforms-free' ) ),
			'ready'  => array( __( 'Ready to move', 'funnelforms-free' ), __( 'Checked identical; still on Funnelforms 3.', 'funnelforms-free' ) ),
			'review' => array( __( 'Please have a look', 'funnelforms-free' ), __( 'Differences found; still on Funnelforms 3.', 'funnelforms-free' ) ),
			'stays'  => array( __( 'Stays on Funnelforms 3', 'funnelforms-free' ), __( 'Something is missing for Funnelforms 5.', 'funnelforms-free' ) ),
		);
		if ( 0 === $total ) {
			echo '<p class="ffx-muted">' . esc_html__( 'No forms from Funnelforms 3 yet.', 'funnelforms-free' ) . '</p>';
			return;
		}
		echo '<div class="ffx-mig-stack" aria-hidden="true">';
		foreach ( array_keys( $parts ) as $key ) {
			$n = (int) ( $by[ $key ] ?? 0 );
			if ( $n > 0 ) {
				echo '<span class="is-' . esc_attr( $key ) . '" style="flex-grow:' . esc_attr( (string) $n ) . '"></span>';
			}
		}
		echo '</div><ul class="ffx-mig-legend">';
		foreach ( $parts as $key => $part ) {
			$n = (int) ( $by[ $key ] ?? 0 );
			printf(
				'<li class="is-%1$s"><a href="%2$s"><span class="ffx-mig-legend__dot"></span><span class="ffx-mig-legend__text"><strong>%3$s</strong><small>%4$s</small></span><span class="ffx-mig-legend__n">%5$s</span></a></li>',
				esc_attr( $key ),
				esc_url(
					self::url(
						array(
							'tab'  => 'forms',
							'show' => $key,
						)
					)
				),
				esc_html( $part[0] ),
				esc_html( $part[1] ),
				esc_html( number_format_i18n( $n ) )
			);
		}
		echo '</ul>';
	}

	/**
	 * What needs attention: reasons that keep forms on 3, grouped, and data that is not complete.
	 *
	 * @param list<array<string,mixed>>         $forms MigrationReport::forms().
	 * @param array<string,array<string,mixed>> $data  MigrationReport::data().
	 * @param array<string,int>                 $files MigrationReport::files().
	 */
	private static function attention( array $forms, array $data, array $files ): void {
		$groups = array();
		foreach ( $forms as $form ) {
			if ( 'v5' === $form['state'] ) {
				continue;
			}
			foreach ( $form['blockers'] as $code ) {
				$groups[ (string) $code ][] = $form;
			}
		}
		// Differences first: they are the ones only a person can decide.
		uksort( $groups, static fn( $a, $b ): int => array( 'needs_review' !== $a, (string) $a ) <=> array( 'needs_review' !== $b, (string) $b ) );
		$items = array();
		foreach ( $groups as $code => $group ) {
			$code    = (string) $code;
			$explain = MigrationTexts::blocker( $code, (int) $group[0]['id'] );
			if ( in_array( $code, array( 'needs_review', 'not_verified', 'no_document' ), true ) ) {
				// These are solved form by form, on the form's own page.
				$explain['link'] = 1 === count( $group ) ? __( 'See the details', 'funnelforms-free' ) : __( 'Show these forms', 'funnelforms-free' );
				$explain['url']  = 1 === count( $group ) ? self::form_url( $group[0] ) : self::url(
					array(
						'tab'  => 'forms',
						'show' => 'needs_review' === $code ? 'review' : 'stays',
					)
				);
			}
			$explain['forms'] = $group;
			$items[]          = $explain;
		}
		$leads = $data['leads'];
		if ( $leads['pending'] > 0 ) {
			$items[] = array(
				'title' => __( 'New leads are waiting to be copied', 'funnelforms-free' ),
				/* translators: %s: number of leads. */
				'text'  => sprintf( _n( '%s lead came in on Funnelforms 3 after the last copy.', '%s leads came in on Funnelforms 3 after the last copy.', $leads['pending'], 'funnelforms-free' ), number_format_i18n( $leads['pending'] ) ),
				'fix'   => __( 'They follow on their own within the hour. To copy them now, run the copy again.', 'funnelforms-free' ),
				'link'  => '',
				'url'   => '',
				'forms' => array(),
				'start' => true,
			);
		}
		if ( $leads['failed'] + $leads['missing'] + $data['bookings']['failed'] + $data['bookings']['missing'] > 0 ) {
			$items[] = array(
				'title' => __( 'Some leads or appointments could not be copied', 'funnelforms-free' ),
				'text'  => __( 'Funnelforms 3 stored them in a way that could not be read. They are still in Funnelforms 3, unchanged, and stay visible there.', 'funnelforms-free' ),
				'fix'   => __( 'Send us a support request; the diagnosis tells us which ones, without their content.', 'funnelforms-free' ),
				'link'  => Edition::is_free() ? __( 'Support forum', 'funnelforms-free' ) : __( 'Contact support', 'funnelforms-free' ),
				'url'   => Ui::support_url(),
				'forms' => array(),
			);
		}
		$held = get_option( Migrator::HELD, array() );
		if ( is_array( $held ) && ! empty( $held['count'] ) ) {
			$items[] = array(
				'title' => __( 'Copies kept to be safe', 'funnelforms-free' ),
				/* translators: %s: number of leads. */
				'text'  => sprintf( __( '%s leads vanished from Funnelforms 3 at once. That looks more like damage than a clean-up, so their copies in Funnelforms 5 were kept.', 'funnelforms-free' ), number_format_i18n( (int) $held['count'] ) ),
				'fix'   => self::way_back() ? __( 'Check the Funnelforms 3 data against the restore point. If the leads were deleted on purpose, delete them in Funnelforms 5 too.', 'funnelforms-free' ) : __( 'If the leads were deleted on purpose, delete them in Funnelforms 5 too.', 'funnelforms-free' ),
				'link'  => self::way_back() ? __( 'Go to the way back', 'funnelforms-free' ) : '',
				'url'   => self::way_back() ? self::url( array( 'tab' => 'wayback' ) ) : '',
				'forms' => array(),
			);
		}
		if ( $files['checked'] > $files['found'] ) {
			$items[] = array(
				'title' => __( 'Files are missing in the uploads folder', 'funnelforms-free' ),
				'text'  => __( 'Some leads point to files that are no longer in wp-content/uploads/af2. They were missing in Funnelforms 3 too; the migration does not move or delete files.', 'funnelforms-free' ),
				'fix'   => __( 'If you have a backup of the uploads folder, put the files back there.', 'funnelforms-free' ),
				'link'  => '',
				'url'   => '',
				'forms' => array(),
			);
		}
		if ( array() === $items ) {
			return;
		}
		?>
		<section class="ffx-card ffx-section" id="ffx-mig-attention" aria-labelledby="ffx-mig-attention-title">
			<div class="ffx-card__head">
				<div>
					<h2 id="ffx-mig-attention-title"><?php esc_html_e( 'What needs your attention', 'funnelforms-free' ); ?></h2>
					<p><?php esc_html_e( 'Nothing here puts your data at risk. It only keeps forms on Funnelforms 3 until it is solved.', 'funnelforms-free' ); ?></p>
				</div>
			</div>
			<ul class="ffx-mig-problems">
				<?php foreach ( $items as $item ) : ?>
					<li><?php self::problem( $item ); ?></li>
				<?php endforeach; ?>
			</ul>
		</section>
		<?php
	}

	/**
	 * One problem: what, why, how to fix it, and the forms it concerns.
	 *
	 * @param array<string,mixed> $item title, text, fix, link, url, forms, start, details.
	 */
	private static function problem( array $item ): void {
		$forms = (array) ( $item['forms'] ?? array() );
		?>
		<span class="ffx-mig-problems__icon"><?php echo Ui::icon( 'bell' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
		<div class="ffx-mig-problems__body">
			<h3><?php echo esc_html( (string) $item['title'] ); ?></h3>
			<p><?php echo esc_html( (string) $item['text'] ); ?></p>
			<?php if ( ! empty( $item['details'] ) ) : ?>
				<h4 class="ffx-mig-problems__found"><?php esc_html_e( 'What was found:', 'funnelforms-free' ); ?></h4>
				<ul class="ffx-mig-problems__details">
					<?php foreach ( (array) $item['details'] as $line ) : ?>
						<li><?php echo esc_html( (string) $line ); ?></li>
					<?php endforeach; ?>
				</ul>
			<?php endif; ?>
			<p class="ffx-mig-fix"><strong><?php esc_html_e( 'How to fix it:', 'funnelforms-free' ); ?></strong> <?php echo esc_html( (string) $item['fix'] ); ?></p>
			<?php if ( array() !== $forms ) : ?>
				<ul class="ffx-mig-chips">
					<?php foreach ( array_slice( $forms, 0, 8 ) as $form ) : ?>
						<li><a href="<?php echo esc_url( self::form_url( $form ) ); ?>"><?php echo esc_html( self::title_of( $form ) ); ?></a></li>
					<?php endforeach; ?>
					<?php if ( count( $forms ) > 8 ) : ?>
						<?php /* translators: %d: number of further forms. */ ?>
						<li><span><?php echo esc_html( sprintf( __( 'and %d more', 'funnelforms-free' ), count( $forms ) - 8 ) ); ?></span></li>
					<?php endif; ?>
				</ul>
			<?php endif; ?>
		</div>
		<div class="ffx-mig-problems__action">
			<?php
			if ( ! empty( $item['start'] ) ) {
				self::start_button( 'secondary' );
			} elseif ( '' !== (string) $item['url'] ) {
				echo Ui::button( (string) $item['link'], (string) $item['url'], 'secondary', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
			}
			?>
		</div>
		<?php
	}

	/*
	 * Forms.
	 */

	/**
	 * Tab: every form from Funnelforms 3.
	 */
	private static function render_forms(): void {
		$forms = MigrationReport::forms();
		$by    = array_count_values( array_column( $forms, 'state' ) );
		$show  = isset( $_GET['show'] ) ? sanitize_key( wp_unslash( $_GET['show'] ) ) : 'all'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- filter only.
		$shows = array(
			'all'    => array( __( 'All', 'funnelforms-free' ), count( $forms ) ),
			'v5'     => array( __( 'On Funnelforms 5', 'funnelforms-free' ), (int) ( $by['v5'] ?? 0 ) ),
			'ready'  => array( __( 'Ready to move', 'funnelforms-free' ), (int) ( $by['ready'] ?? 0 ) ),
			'review' => array( __( 'Please have a look', 'funnelforms-free' ), (int) ( $by['review'] ?? 0 ) ),
			'stays'  => array( __( 'Stays on Funnelforms 3', 'funnelforms-free' ), (int) ( $by['stays'] ?? 0 ) ),
		);
		$show  = isset( $shows[ $show ] ) ? $show : 'all';
		$list  = 'all' === $show ? $forms : array_values( array_filter( $forms, static fn( array $f ): bool => $f['state'] === $show ) );
		if ( self::way_back() ) {
			self::auto_setting();
		}
		?>
		<section class="ffx-card ffx-card--flush">
			<div class="ffx-mig-toolbar">
				<nav class="ffx-mig-filter" aria-label="<?php esc_attr_e( 'Show', 'funnelforms-free' ); ?>">
					<?php foreach ( $shows as $key => $label ) : ?>
						<?php
						if ( 0 === $label[1] && 'all' !== $key && $key !== $show ) {
							continue;
						}
						?>
						<a href="<?php echo esc_url( self::url( array( 'tab' => 'forms' ) + ( 'all' === $key ? array() : array( 'show' => $key ) ) ) ); ?>"<?php echo $key === $show ? ' aria-current="page"' : ''; ?>><?php echo esc_html( $label[0] ); ?> <span><?php echo esc_html( number_format_i18n( $label[1] ) ); ?></span></a>
					<?php endforeach; ?>
				</nav>
				<div class="ffx-mig-toolbar__actions">
					<?php if ( current_user_can( Capabilities::EDIT_FORMS ) && ( (int) ( $by['ready'] ?? 0 ) > 0 || Rollback::active() ) ) : ?>
						<?php self::all_v5_button( 'primary' ); ?>
					<?php endif; ?>
					<?php if ( self::way_back() && current_user_can( 'manage_options' ) && (int) ( $by['v5'] ?? 0 ) > 0 ) : ?>
						<?php echo Ui::button( __( 'All forms back to Funnelforms 3', 'funnelforms-free' ), self::url( array( 'view' => 'back' ) ), 'ghost', 'undo' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
					<?php endif; ?>
				</div>
			</div>
			<?php if ( array() === $list ) : ?>
				<div class="ffx-empty">
					<span class="ffx-empty__mark"><?php echo Ui::icon( 'form' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
					<h2><?php echo esc_html( array() === $forms ? __( 'No forms from Funnelforms 3 yet', 'funnelforms-free' ) : __( 'No forms here', 'funnelforms-free' ) ); ?></h2>
					<p><?php echo esc_html( array() === $forms ? __( 'Once the copy has run, every form of Funnelforms 3 shows up here with its check.', 'funnelforms-free' ) : __( 'Choose another filter above.', 'funnelforms-free' ) ); ?></p>
				</div>
			<?php else : ?>
				<div class="ffx-table-wrap">
					<table class="ffx-table ffx-mig-table">
						<thead>
							<tr>
								<th scope="col"><?php esc_html_e( 'Form', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'Check', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'Leads', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'Runs on', 'funnelforms-free' ); ?></th>
								<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Actions', 'funnelforms-free' ); ?></span></th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $list as $form ) : ?>
								<?php self::form_row( $form ); ?>
							<?php endforeach; ?>
						</tbody>
					</table>
				</div>
			<?php endif; ?>
		</section>
		<?php
	}

	/**
	 * One row of the forms table.
	 *
	 * @param array<string,mixed> $form MigrationReport::forms() row.
	 */
	private static function form_row( array $form ): void {
		$on_v5 = 'v5' === $form['state'];
		?>
		<tr class="is-<?php echo esc_attr( (string) $form['state'] ); ?>">
			<td>
				<a class="ffx-mig-table__title" href="<?php echo esc_url( self::form_url( $form ) ); ?>"><?php echo esc_html( self::title_of( $form ) ); ?></a>
				<span class="ffx-mig-table__meta">
					<?php
					/* translators: %d: ID of the form in Funnelforms 3. */
					echo esc_html( sprintf( __( 'No. %d in Funnelforms 3', 'funnelforms-free' ), (int) $form['legacy_id'] ) );
					if ( '' !== $form['migrated_at'] ) {
						/* translators: %s: date. */
						echo ' · ' . esc_html( sprintf( __( 'copied %s', 'funnelforms-free' ), SafetySection::date( (string) $form['migrated_at'], false ) ) );
					}
					$note = self::auto_note( $form );
					if ( '' !== $note ) {
						echo ' · ' . esc_html( $note );
					}
					?>
				</span>
				<?php if ( in_array( $form['state'], array( 'review', 'stays' ), true ) ) : ?>
					<span class="ffx-mig-table__why"><?php echo esc_html( MigrationTexts::why( $form ) ); ?></span>
				<?php endif; ?>
			</td>
			<td><?php echo MigrationTexts::check_badge( (string) $form['check'], array() !== $form['blockers'] && FormVerifier::FAILED === $form['check'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge(). ?></td>
			<td class="ffx-mig-table__leads">
				<?php self::lead_counts( $form['entries'] ); ?>
			</td>
			<td><?php echo $on_v5 ? Ui::badge( __( 'Funnelforms 5', 'funnelforms-free' ), 'success' ) : Ui::badge( __( 'Funnelforms 3', 'funnelforms-free' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge(). ?></td>
			<td class="ffx-table__actions">
				<?php self::form_actions( $form, true ); ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Leads of a form: copied from 3 and new on 5.
	 *
	 * @param array{from3:int,new:int,mirrored:int} $entries Counts.
	 */
	private static function lead_counts( array $entries ): void {
		/* translators: %s: number of leads. */
		echo '<span>' . esc_html( sprintf( __( '%s from Funnelforms 3', 'funnelforms-free' ), number_format_i18n( $entries['from3'] ) ) ) . '</span>';
		if ( $entries['new'] > 0 ) {
			/* translators: %s: number of entries. */
			echo '<small>' . esc_html( sprintf( __( '+ %s new on Funnelforms 5', 'funnelforms-free' ), number_format_i18n( $entries['new'] ) ) ) . '</small>';
		}
	}

	/**
	 * Buttons of a form: move it to 5 or back to 3, details.
	 *
	 * @param array<string,mixed> $form    MigrationReport::forms() row.
	 * @param bool                $compact In the table.
	 */
	private static function form_actions( array $form, bool $compact ): void {
		$size = $compact ? ' ffx-btn--sm' : '';
		if ( 'v5' === $form['state'] && self::way_back() && current_user_can( 'manage_options' ) ) {
			echo '<a class="ffx-btn ffx-btn--ghost' . esc_attr( $size ) . '" href="' . esc_url(
				self::url(
					array(
						'view' => 'back',
						'form' => (int) $form['id'],
					)
				)
			) . '">' . Ui::icon( 'undo' ) . '<span>' . esc_html__( 'Back to Funnelforms 3', 'funnelforms-free' ) . '</span></a>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
		} elseif ( 'review' === $form['state'] && ! $compact && $form['in_3x'] && self::way_back() && current_user_can( 'manage_options' ) ) {
			echo Ui::button( __( 'Compare old and new', 'funnelforms-free' ), '#ffx-mig-compare', 'primary', 'eye' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
		} elseif ( 'ready' === $form['state'] && current_user_can( Capabilities::EDIT_FORMS ) ) {
			?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::RENDERER ); ?>">
				<input type="hidden" name="form" value="<?php echo esc_attr( (string) $form['id'] ); ?>">
				<?php wp_nonce_field( self::RENDERER . '_' . $form['id'] ); ?>
				<button type="submit" class="ffx-btn ffx-btn--primary<?php echo esc_attr( $size ); ?>"><?php echo Ui::icon( 'rocket' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php echo esc_html( _x( 'Move to Funnelforms 5', 'button that moves one form', 'funnelforms-free' ) ); ?></span></button>
			</form>
			<?php
		}
		if ( $compact ) {
			echo '<a class="ffx-btn ffx-btn--ghost ffx-btn--sm" href="' . esc_url( self::form_url( $form ) ) . '"><span>' . esc_html__( 'Details', 'funnelforms-free' ) . '</span></a>';
		}
	}

	/**
	 * One form: its check, what keeps it on 3, its leads, old and new side by side.
	 *
	 * @param int $form_id   Form ID.
	 * @param int $legacy_id 3.x form ID (for forms that were not copied).
	 */
	private static function render_form( int $form_id, int $legacy_id ): void {
		$form = MigrationReport::form( $form_id, $form_id > 0 ? 0 : $legacy_id );
		echo '<p class="ffx-mig-back"><a href="' . esc_url( self::url( array( 'tab' => 'forms' ) ) ) . '">' . Ui::icon( 'back' ) . '<span>' . esc_html__( 'All forms', 'funnelforms-free' ) . '</span></a></p>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
		if ( null === $form ) {
			echo '<div class="ffx-card ffx-empty"><h2>' . esc_html__( 'This form is not part of the migration.', 'funnelforms-free' ) . '</h2></div>';
			return;
		}
		$on_v5   = 'v5' === $form['state'];
		$builder = add_query_arg( 'form', (int) $form['id'], admin_url( 'admin.php?page=' . BuilderPage::SLUG ) );
		?>
		<section class="ffx-card ffx-mig-head">
			<div class="ffx-mig-head__main">
				<h2><?php echo esc_html( self::title_of( $form ) ); ?></h2>
				<div class="ffx-mig-head__badges">
					<?php echo MigrationTexts::check_badge( (string) $form['check'], array() !== $form['blockers'] && FormVerifier::FAILED === $form['check'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge(). ?>
					<?php echo $on_v5 ? Ui::badge( __( 'Runs on Funnelforms 5', 'funnelforms-free' ), 'success' ) : Ui::badge( __( 'Runs on Funnelforms 3', 'funnelforms-free' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge(). ?>
				</div>
				<p class="ffx-muted ffx-small">
					<?php
					/* translators: %d: ID of the form in Funnelforms 3. */
					echo esc_html( sprintf( __( 'No. %d in Funnelforms 3', 'funnelforms-free' ), (int) $form['legacy_id'] ) );
					if ( '' !== $form['migrated_at'] ) {
						/* translators: %s: date and time. */
						echo ' · ' . esc_html( sprintf( __( 'last copied %s', 'funnelforms-free' ), SafetySection::date( (string) $form['migrated_at'] ) ) );
					}
					$note = self::auto_note( $form );
					if ( '' !== $note ) {
						echo ' · ' . esc_html( $note );
					}
					?>
				</p>
			</div>
			<div class="ffx-mig-head__actions">
				<?php self::form_actions( $form, false ); ?>
				<?php if ( $form['id'] > 0 && current_user_can( Capabilities::EDIT_FORMS ) ) : ?>
					<?php echo Ui::button( __( 'Open in the form builder', 'funnelforms-free' ), $builder, 'secondary', 'layers' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
				<?php endif; ?>
				<?php if ( $form['in_3x'] ) : ?>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline">
						<input type="hidden" name="action" value="<?php echo esc_attr( self::REIMPORT ); ?>">
						<input type="hidden" name="legacy" value="<?php echo esc_attr( (string) $form['legacy_id'] ); ?>">
						<?php wp_nonce_field( self::REIMPORT . '_' . $form['legacy_id'] ); ?>
						<button type="submit" class="ffx-btn ffx-btn--ghost"><?php echo Ui::icon( 'history' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Import again', 'funnelforms-free' ); ?></span></button>
					</form>
				<?php endif; ?>
			</div>
		</section>

		<?php if ( array() !== $form['blockers'] ) : ?>
			<section class="ffx-card ffx-section" id="problems" aria-labelledby="ffx-mig-blockers">
				<div class="ffx-card__head">
					<div>
						<h2 id="ffx-mig-blockers"><?php echo 'review' === $form['state'] ? esc_html__( 'Please have a look before it moves', 'funnelforms-free' ) : esc_html__( 'Why it stays on Funnelforms 3 for now', 'funnelforms-free' ); ?></h2>
						<p><?php esc_html_e( 'Your visitors keep seeing the Funnelforms 3 version until this is solved.', 'funnelforms-free' ); ?></p>
					</div>
				</div>
				<ul class="ffx-mig-problems">
					<?php foreach ( $form['blockers'] as $code ) : ?>
						<?php
						$item = MigrationTexts::blocker( (string) $code, (int) $form['id'] );
						if ( 'needs_review' === $code ) {
							$item['details'] = MigrationTexts::findings( (array) $form['checks'] );
						}
						?>
						<li><?php self::problem( $item ); ?></li>
					<?php endforeach; ?>
				</ul>
			</section>
		<?php endif; ?>

		<div class="ffx-split ffx-section">
			<section class="ffx-card" aria-labelledby="ffx-mig-check">
				<div class="ffx-card__head">
					<div>
						<h2 id="ffx-mig-check"><?php esc_html_e( 'The check', 'funnelforms-free' ); ?></h2>
						<p><?php esc_html_e( 'Funnelforms played every path and calculation of the form in Funnelforms 3 and in Funnelforms 5 and compared them.', 'funnelforms-free' ); ?></p>
					</div>
				</div>
				<?php self::checks( $form ); ?>
			</section>
			<section class="ffx-card" aria-labelledby="ffx-mig-leads">
				<div class="ffx-card__head">
					<h2 id="ffx-mig-leads"><?php esc_html_e( 'Leads of this form', 'funnelforms-free' ); ?></h2>
				</div>
				<ul class="ffx-mig-figures">
					<li><strong><?php echo esc_html( number_format_i18n( $form['entries']['from3'] ) ); ?></strong><span><?php esc_html_e( 'copied from Funnelforms 3', 'funnelforms-free' ); ?></span></li>
					<li><strong><?php echo esc_html( number_format_i18n( $form['entries']['new'] ) ); ?></strong><span><?php esc_html_e( 'came in on Funnelforms 5', 'funnelforms-free' ); ?></span></li>
				</ul>
				<p class="ffx-muted ffx-small">
					<?php
					if ( $form['entries']['new'] > 0 ) {
						echo esc_html(
							sprintf(
								/* translators: %s: number of entries. */
								__( '%s of the new entries are in the Funnelforms 3 lead list too, so nothing is missing there if you go back.', 'funnelforms-free' ),
								number_format_i18n( $form['entries']['mirrored'] )
							)
						) . ' ';
					}
					esc_html_e( 'All leads are in Funnelforms 5 → Entries. Funnelforms 3 keeps its own leads unchanged.', 'funnelforms-free' );
					?>
				</p>
				<?php if ( ! $form['in_3x'] ) : ?>
					<p class="ffx-mig-status is-warn"><?php esc_html_e( 'The form was deleted in Funnelforms 3. Its copy in Funnelforms 5 stays.', 'funnelforms-free' ); ?></p>
				<?php endif; ?>
			</section>
		</div>

		<?php if ( $form['id'] > 0 && $form['in_3x'] && self::way_back() && current_user_can( 'manage_options' ) ) : ?>
			<section class="ffx-card ffx-card--flush ffx-section ffx-setup__compare ffx-mig-compare" data-ffx-compare aria-labelledby="ffx-mig-compare">
				<div class="ffx-mig-compare__head">
					<div>
						<h2 id="ffx-mig-compare"><?php esc_html_e( 'Old and new side by side', 'funnelforms-free' ); ?></h2>
						<p class="ffx-muted"><?php esc_html_e( 'Try both: what you enter in the previews is not saved and no e-mail is sent.', 'funnelforms-free' ); ?></p>
					</div>
					<div class="ffx-setup__devices" role="group" aria-label="<?php esc_attr_e( 'Device', 'funnelforms-free' ); ?>">
						<button type="button" class="is-active" data-device="desktop" aria-pressed="true"><?php echo Ui::icon( 'monitor' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Desktop', 'funnelforms-free' ); ?></span></button>
						<button type="button" data-device="phone" aria-pressed="false"><?php echo Ui::icon( 'phone' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Phone', 'funnelforms-free' ); ?></span></button>
					</div>
				</div>
				<div class="ffx-setup__frames">
					<figure>
						<figcaption><?php esc_html_e( 'Funnelforms 3', 'funnelforms-free' ); ?></figcaption>
						<div class="ffx-setup__frame is-tall"><iframe title="<?php esc_attr_e( 'Today (Funnelforms 3)', 'funnelforms-free' ); ?>" data-src="<?php echo esc_url( LegacyPreview::url( (int) $form['legacy_id'] ) ); ?>" loading="lazy"></iframe></div>
					</figure>
					<figure>
						<figcaption><?php esc_html_e( 'Funnelforms 5', 'funnelforms-free' ); ?></figcaption>
						<div class="ffx-setup__frame is-tall"><iframe title="<?php esc_attr_e( 'New (Funnelforms 5)', 'funnelforms-free' ); ?>" data-form="<?php echo esc_attr( (string) $form['id'] ); ?>" sandbox="allow-scripts allow-forms"></iframe></div>
					</figure>
				</div>
			</section>
		<?php endif; ?>
		<?php
	}

	/**
	 * The five checks of a form with their findings.
	 *
	 * @param array<string,mixed> $form MigrationReport::forms() row.
	 */
	private static function checks( array $form ): void {
		if ( 'edited' === $form['check'] ) {
			echo '<p class="ffx-mig-status is-ok">' . esc_html__( 'The form was changed and published in the Funnelforms 5 builder. From then on the published version counts, not the comparison with Funnelforms 3.', 'funnelforms-free' ) . '</p>';
		}
		if ( array() === $form['checks'] ) {
			echo '<p class="ffx-mig-status is-warn">' . esc_html__( 'The form could not be read, so there was nothing to compare.', 'funnelforms-free' ) . '</p>';
			$errors = array_filter( (array) $form['notes'] );
			if ( array() !== $errors ) {
				echo '<details class="ffx-mig-tech"><summary>' . esc_html__( 'Technical details for support', 'funnelforms-free' ) . '</summary><code>' . esc_html( implode( "\n", $errors ) ) . '</code></details>';
			}
			return;
		}
		echo '<ul class="ffx-mig-checks">';
		foreach ( MigrationTexts::checks() as $name => $label ) {
			$check   = (array) ( $form['checks'][ $name ] ?? array() );
			$details = array_map( 'strval', (array) ( $check['details'] ?? array() ) );
			$ok      = array() === $details;
			echo '<li class="' . ( $ok ? 'is-ok' : 'is-warn' ) . '"><span class="ffx-mig-checks__dot">' . ( $ok ? Ui::icon( 'check' ) : '!' ) . '</span><div><strong>' . esc_html( $label ) . '</strong>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
			if ( ! $ok ) {
				$readable = array_values( array_unique( array_map( static fn( string $d ): string => MigrationTexts::finding( $name, $d ), $details ) ) );
				echo '<ul>';
				foreach ( $readable as $line ) {
					echo '<li>' . esc_html( $line ) . '</li>';
				}
				echo '</ul><details class="ffx-mig-tech"><summary>' . esc_html__( 'Technical details for support', 'funnelforms-free' ) . '</summary><code>' . esc_html( implode( "\n", array_slice( $details, 0, 20 ) ) ) . '</code></details>';
			}
			echo '</div></li>';
		}
		echo '</ul>';
	}

	/*
	 * Log.
	 */

	/**
	 * Tab: everything that happened.
	 *
	 * @param int $limit Events.
	 */
	private static function render_log( int $limit ): void {
		?>
		<section class="ffx-card">
			<div class="ffx-card__head">
				<div>
					<h2><?php esc_html_e( 'What happened when', 'funnelforms-free' ); ?></h2>
					<p><?php esc_html_e( 'Every copy, check, restore point and switch between Funnelforms 3 and 5, newest first.', 'funnelforms-free' ); ?></p>
				</div>
			</div>
			<?php self::timeline( MigrationLog::with_backups( MigrationLog::timeline( $limit ) ), $limit ); ?>
		</section>
		<?php
	}

	/**
	 * A timeline, by day.
	 *
	 * @param list<array<string,mixed>> $events Events, newest first.
	 * @param int                       $limit  Events at most.
	 */
	public static function timeline( array $events, int $limit ): void {
		$events = array_slice( $events, 0, $limit );
		if ( array() === $events ) {
			echo '<p class="ffx-muted">' . esc_html__( 'Nothing has happened yet.', 'funnelforms-free' ) . '</p>';
			return;
		}
		$day = '';
		echo '<ol class="ffx-mig-timeline">';
		foreach ( $events as $event ) {
			$time = (int) strtotime( (string) $event['at'] . ' UTC' );
			$date = wp_date( (string) get_option( 'date_format' ), $time );
			if ( $date !== $day ) {
				$day = (string) $date;
				echo '<li class="ffx-mig-timeline__day">' . esc_html( $day ) . '</li>';
			}
			$line = MigrationTexts::event( $event );
			?>
			<li class="ffx-mig-timeline__event is-<?php echo esc_attr( $line['tone'] ); ?>">
				<span class="ffx-mig-timeline__icon"><?php echo Ui::icon( $line['icon'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
				<div class="ffx-mig-timeline__body">
					<strong><?php echo esc_html( $line['title'] ); ?></strong>
					<?php if ( '' !== $line['text'] ) : ?>
						<span><?php echo esc_html( $line['text'] ); ?></span>
					<?php endif; ?>
				</div>
				<span class="ffx-mig-timeline__meta"><?php echo esc_html( wp_date( (string) get_option( 'time_format' ), $time ) ); ?><small><?php echo esc_html( MigrationTexts::actor( (int) $event['actor'] ) ); ?></small></span>
			</li>
			<?php
		}
		echo '</ol>';
	}

	/*
	 * Parts.
	 */

	/**
	 * A job that runs in steps, with its progress; the script moves it on.
	 *
	 * @param string                                       $job      import, check, restore or backup.
	 * @param array{status:string,percent:int,text:string} $progress Progress now.
	 */
	public static function job( string $job, array $progress ): void {
		?>
		<div class="ffx-mig-job" data-ffx-job="<?php echo esc_attr( $job ); ?>" role="status" aria-live="polite">
			<div class="ffx-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?php echo esc_attr( (string) $progress['percent'] ); ?>"><span data-ffx-bar style="width:<?php echo esc_attr( (string) max( 3, $progress['percent'] ) ); ?>%"></span></div>
			<p data-ffx-job-text><?php echo esc_html( $progress['text'] ); ?></p>
		</div>
		<?php
	}

	/**
	 * Button: run the copy again.
	 *
	 * @param string $kind primary, secondary or ghost.
	 */
	private static function start_button( string $kind ): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			return;
		}
		$label = null === Migrator::state()['last_sync_at'] ? __( 'Start the copy', 'funnelforms-free' ) : __( 'Copy again now', 'funnelforms-free' );
		?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
			<?php wp_nonce_field( self::ACTION ); ?>
			<button type="submit" class="ffx-btn<?php echo 'secondary' === $kind ? '' : esc_attr( ' ffx-btn--' . $kind ); ?>"><?php echo Ui::icon( 'history' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php echo esc_html( $label ); ?></span></button>
		</form>
		<?php
	}

	/**
	 * Button: every form that can, to Funnelforms 5.
	 *
	 * @param string $kind primary or secondary.
	 */
	private static function all_v5_button( string $kind ): void {
		$label = Rollback::active() && current_user_can( 'manage_options' ) ? __( 'Back to Funnelforms 5', 'funnelforms-free' ) : __( 'Move all checked forms to Funnelforms 5', 'funnelforms-free' );
		?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ALL ); ?>">
			<?php wp_nonce_field( self::ALL ); ?>
			<button type="submit" class="ffx-btn<?php echo 'primary' === $kind ? ' ffx-btn--primary' : ''; ?>"><?php echo Ui::icon( 'rocket' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php echo esc_html( $label ); ?></span></button>
		</form>
		<?php
	}

	/**
	 * Whether the site can go back to Funnelforms 3. Only Funnelforms Pro ships the code of 3.x;
	 * in Funnelforms Free the import only leads forward.
	 */
	public static function way_back(): bool {
		return Edition::is_pro();
	}

	/**
	 * The automatic move to Funnelforms 5 in one plain sentence.
	 */
	public static function auto_sentence(): string {
		if ( ! self::way_back() ) {
			return __( 'Forms whose check passed run on Funnelforms 5 on their own, because it works with keyboard and screen readers.', 'funnelforms-free' );
		}
		if ( ! AutoRenderer::enabled() ) {
			return __( 'Forms move to Funnelforms 5 only when you move them.', 'funnelforms-free' );
		}
		return __( 'Forms whose check passed run on Funnelforms 5 on their own, because it works with keyboard and screen readers; you can send any form back to Funnelforms 3 on its own page.', 'funnelforms-free' );
	}

	/**
	 * Whether a form moved on its own or was kept on Funnelforms 3, in a few words.
	 *
	 * @param array<string,mixed> $form MigrationReport::forms() row.
	 */
	private static function auto_note( array $form ): string {
		if ( ! empty( $form['pinned'] ) && 'v5' !== $form['state'] ) {
			return __( 'kept on Funnelforms 3 by you', 'funnelforms-free' );
		}
		if ( ! empty( $form['auto'] ) && 'v5' === $form['state'] ) {
			return __( 'moved on its own after the check', 'funnelforms-free' );
		}
		return '';
	}

	/**
	 * The setting: checked forms move to Funnelforms 5 on their own.
	 */
	private static function auto_setting(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			return;
		}
		$on      = AutoRenderer::enabled();
		$waiting = AutoRenderer::waiting();
		?>
		<section class="ffx-card ffx-mig-auto" aria-labelledby="ffx-mig-auto-title">
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::AUTO ); ?>">
				<?php wp_nonce_field( self::AUTO ); ?>
				<label class="ffx-mig-auto__switch">
					<input type="checkbox" name="auto" value="1" <?php checked( $on ); ?>>
					<span>
						<strong id="ffx-mig-auto-title"><?php esc_html_e( 'Use the new renderer for all checked forms', 'funnelforms-free' ); ?></strong>
						<small><?php esc_html_e( 'Forms whose check passed run on Funnelforms 5 on their own, because it works with keyboard and screen readers. A form you send back to Funnelforms 3 stays there.', 'funnelforms-free' ); ?></small>
					</span>
				</label>
				<button type="submit" class="ffx-btn ffx-btn--sm"><?php esc_html_e( 'Save', 'funnelforms-free' ); ?></button>
			</form>
			<?php if ( $on && 'assistant' === $waiting ) : ?>
				<p class="ffx-mig-status is-info"><?php esc_html_e( 'Waits while the setup assistant is open: there you choose the forms yourself.', 'funnelforms-free' ); ?></p>
			<?php elseif ( $on && 'rollback' === $waiting ) : ?>
				<p class="ffx-mig-status is-info"><?php esc_html_e( 'Paused while your forms run on Funnelforms 3 again.', 'funnelforms-free' ); ?></p>
			<?php endif; ?>
		</section>
		<?php
	}

	/**
	 * Address of a form's details.
	 *
	 * @param array<string,mixed> $form MigrationReport::forms() row.
	 */
	public static function form_url( array $form ): string {
		return self::url(
			array( 'tab' => 'forms' ) + ( (int) $form['id'] > 0 ? array( 'form' => (int) $form['id'] ) : array( 'legacy' => (int) $form['legacy_id'] ) )
		);
	}

	/**
	 * Title of a form, with a stand-in when it has none.
	 *
	 * @param array<string,mixed> $form MigrationReport::forms() row.
	 */
	public static function title_of( array $form ): string {
		if ( '' !== (string) $form['title'] ) {
			return (string) $form['title'];
		}
		/* translators: %d: ID of the form in Funnelforms 3. */
		return sprintf( __( 'Form no. %d (no title)', 'funnelforms-free' ), (int) $form['legacy_id'] );
	}

	/**
	 * Whether entries of moved forms also reach the Funnelforms 3 lead list.
	 */
	public static function mirrors(): bool {
		return LeadMirror::enabled();
	}
}
