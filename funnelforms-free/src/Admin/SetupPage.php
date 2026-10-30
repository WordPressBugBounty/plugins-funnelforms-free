<?php
/**
 * The setup assistant (Funnelforms → Setup), full screen.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\BrandingImport;
use Funnelforms\Application\FormEditor;
use Funnelforms\Application\FormPreview;
use Funnelforms\Application\FormTemplates;
use Funnelforms\Application\License\License;
use Funnelforms\Application\Newsletter;
use Funnelforms\Application\PrivacyMode;
use Funnelforms\Application\SetupFlow;
use Funnelforms\Application\SiteDesign;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Edition\Edition;
use Funnelforms\Edition\FreeSite;
use Funnelforms\Frontend\LegacyPreview;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * A page of its own, without the WordPress menu, that leads through SetupFlow step by step. It
 * opens once for each administrator after the update or installation and can be resumed from the
 * overview. Each step is a form posted to admin-post.php; the import and the previews load
 * through admin-ajax.php.
 */
final class SetupPage {

	public const SLUG     = 'funnelforms-setup';
	public const ACTION   = 'funnelforms_setup';
	public const PROGRESS = 'funnelforms_setup_progress';
	public const PREVIEW  = 'funnelforms_setup_preview';
	public const BRANDING = 'funnelforms_setup_branding';

	/** User meta: the assistant opened by itself once. */
	public const SEEN = 'funnelforms_setup_seen';

	/** User meta: the sign-in at Funnelforms was started here, so it returns here. */
	public const AFTER_CONNECT = 'funnelforms_after_connect';

	/** The languages of the templates (FormTemplates::LANGUAGES), each in its own language. */
	private const LANGUAGE_NAMES = array(
		'de_DE'        => 'Deutsch (du)',
		'de_DE_formal' => 'Deutsch (Sie)',
		'en_US'        => 'English',
		'es_ES'        => 'Español',
		'fr_FR'        => 'Français',
		'it_IT'        => 'Italiano',
	);

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ), 40 );
		add_action( 'admin_init', array( self::class, 'maybe_render' ), 1 );
		add_action( 'admin_init', array( self::class, 'maybe_redirect' ), 20 );
		add_action( 'admin_notices', array( self::class, 'notice' ) );
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle' ) );
		add_action( 'wp_ajax_' . self::PROGRESS, array( self::class, 'ajax_progress' ) );
		add_action( 'wp_ajax_' . self::PREVIEW, array( self::class, 'ajax_preview' ) );
		if ( null !== Edition::pro( BrandingImport::class ) ) {
			add_action( 'wp_ajax_' . self::BRANDING, array( self::class, 'ajax_branding' ) );
		}
	}

	/**
	 * Registers the address (no menu entry; the overview leads here).
	 */
	public static function menu(): void {
		add_submenu_page( '', __( 'Set up Funnelforms', 'funnelforms-free' ), '', 'manage_options', self::SLUG, '__return_null' );
	}

	/**
	 * Address of the assistant.
	 */
	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	/**
	 * The assistant is mandatory. While it is open, every Funnelforms page (the menu pages and the
	 * pages of Funnelforms 3) leads to it. The dashboard and the plugin list open it once per
	 * administrator, as a first hint. Nothing else is held back: not the rest of wp-admin, not
	 * AJAX, REST, cron or WP-CLI, and not users who may not run the assistant themselves.
	 * While Funnelforms Pro is locked for want of a license (Edition::locked()), the lock screen
	 * comes first: the website is connected on the account page, then the assistant opens.
	 */
	public static function maybe_redirect(): void {
		global $pagenow;
		if ( wp_doing_ajax() || wp_doing_cron() || defined( 'REST_REQUEST' ) || is_network_admin() || ! current_user_can( 'manage_options' ) || 'GET' !== strtoupper( sanitize_key( wp_unslash( $_SERVER['REQUEST_METHOD'] ?? '' ) ) ) || isset( $_GET['activate-multi'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended, WordPress.Security.ValidatedSanitizedInput.InputNotValidated -- compared only.
			return;
		}
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- navigation only.
		// A Funnelforms page always leads to the assistant; the dashboard and the plugin list only once.
		// The page about Pro is left out: the checkout sends people back to it to install Pro.
		// So is the form the assistant made, when it could not publish it and the builder shows why.
		$form = isset( $_GET['form'] ) ? absint( $_GET['form'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- navigation only.
		$own  = BuilderPage::SLUG === $page && $form > 0 && (int) ( SetupFlow::state()['form_id'] ?? 0 ) === $form;
		$must = 'admin.php' === $pagenow && ! $own && ! in_array( $page, array( self::SLUG, FreeSite::SLUG ), true ) && ( str_starts_with( $page, 'funnelforms' ) || str_starts_with( $page, 'af2_' ) );
		$once = in_array( $pagenow, array( 'index.php', 'plugins.php' ), true ) && '' === (string) get_user_meta( get_current_user_id(), self::SEEN, true );
		if ( ! ( $must || $once ) || ! SetupFlow::open() || Edition::locked() ) {
			return;
		}
		update_user_meta( get_current_user_id(), self::SEEN, gmdate( 'Y-m-d H:i:s' ) );
		wp_safe_redirect( self::url() );
		exit;
	}

	/**
	 * Reminder that the setup still has to be finished, on the dashboard, the plugin list and the
	 * Funnelforms pages only; it goes away by itself once the setup is done (guideline 11 of
	 * wordpress.org: no notices across all of wp-admin that cannot be closed).
	 */
	public static function notice(): void {
		if ( ! current_user_can( 'manage_options' ) || ! SetupFlow::open() || Edition::locked() ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( null === $screen || ( ! in_array( $screen->id, array( 'dashboard', 'plugins' ), true ) && ! str_contains( (string) $screen->id, 'funnelforms' ) ) ) {
			return;
		}
		printf(
			'<div class="notice notice-warning"><p><strong>Funnelforms:</strong> %1$s <a class="button button-primary" href="%2$s">%3$s</a></p></div>',
			esc_html__( 'The setup is not finished yet. Funnelforms is ready to use once you have been through it.', 'funnelforms-free' ),
			esc_url( self::url() ),
			esc_html( 'welcome' === SetupFlow::state()['step'] ? __( 'Start the setup', 'funnelforms-free' ) : __( 'Continue the setup', 'funnelforms-free' ) )
		);
	}

	/**
	 * Shows the assistant as a page of its own; while Funnelforms Pro is locked, its page shows the
	 * lock screen instead (License\LicenseLock).
	 */
	public static function maybe_render(): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- navigation only.
		if ( wp_doing_ajax() || ! isset( $_GET['page'] ) || self::SLUG !== $_GET['page'] || ! current_user_can( 'manage_options' ) || Edition::locked() ) {
			return;
		}
		update_user_meta( get_current_user_id(), self::SEEN, gmdate( 'Y-m-d H:i:s' ) );
		nocache_headers();
		self::render();
		exit;
	}

	/*
	 * Handlers.
	 */

	/**
	 * A step was sent.
	 */
	public static function handle(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::ACTION );
		// phpcs:disable WordPress.Security.NonceVerification -- checked above.
		$do    = isset( $_REQUEST['do'] ) ? sanitize_key( wp_unslash( $_REQUEST['do'] ) ) : 'next';
		$state = SetupFlow::state();
		$steps = SetupFlow::steps( $state['path'] );
		$step  = $state['step'];
		$error = '';
		// Tips and news by email: only with the ticked box and a click forward (or "Sign up").
		$news = in_array( $do, array( 'next', 'newsletter' ), true ) ? self::sign_up( $state ) : '';
		switch ( $do ) {
			case 'newsletter':
				break;
			case 'later':
				// The dashboard, not a Funnelforms page: those lead back here while the assistant is open.
				wp_safe_redirect( admin_url( 'index.php' ) );
				exit;
			case 'back':
				$step = SetupFlow::neighbour( $state['path'], $step, -1 );
				break;
			case 'goto':
				$target = isset( $_REQUEST['step'] ) ? sanitize_key( wp_unslash( $_REQUEST['step'] ) ) : '';
				if ( in_array( $target, $steps, true ) && array_search( $target, $steps, true ) < array_search( $step, $steps, true ) ) {
					$step = $target;
				}
				break;
			case 'retry_backup':
				LegacyBackup::start( 'before_migration', 'migration' );
				break;
			case 'connect':
				$license = Edition::pro( License::class );
				$account = Edition::pro( AccountPage::class );
				if ( null === $license || null === $account ) {
					break;
				}
				update_user_meta( get_current_user_id(), self::AFTER_CONNECT, 'setup' );
				wp_redirect( $license::connect_url( admin_url( 'admin-post.php?action=' . $account::BACK ) ) ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- the Brain's own address.
				exit;
			default:
				if ( 'region' === $state['step'] ) {
					$error = self::next_region( $state, $news );
				} else {
					$error = 'update' === $state['path'] ? self::next_update( $state ) : self::next_new( $state );
				}
				// The last step stays when a sign-up just went out or needs another look, so it shows how it went.
				if ( 'done' === $step && '' === $error && '' === $news ) {
					SetupFlow::save( array( 'status' => 'done' ) );
					wp_safe_redirect( admin_url( 'admin.php?page=' . Menu::SLUG ) );
					exit;
				}
				$state = SetupFlow::state();
				$step  = '' === $error ? SetupFlow::neighbour( $state['path'], $state['step'], 1 ) : $state['step'];
				// The last step links to Funnelforms pages, so the assistant counts as finished by then.
				if ( 'done' === $step ) {
					SetupFlow::save( array( 'status' => 'done' ) );
				}
		}
		// phpcs:enable WordPress.Security.NonceVerification
		SetupFlow::save( array( 'step' => $step ) );
		$url = '' === $news ? self::url() : add_query_arg( 'newsletter', $news, self::url() );
		wp_safe_redirect( '' === $error ? $url : add_query_arg( 'error', $error, $url ) );
		exit;
	}

	/**
	 * Sends the sign-up for tips and news by email when its box was ticked, once per site.
	 *
	 * @param array<string,mixed> $state State.
	 * @return string Newsletter::SENT, STALE, FAILED or INVALID; empty when nothing was sent.
	 */
	private static function sign_up( array $state ): string {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked in handle().
		if ( ! empty( $state['newsletter'] ) || empty( $_POST['newsletter'] ) ) {
			return '';
		}
		$email    = isset( $_POST['newsletter_email'] ) ? sanitize_email( wp_unslash( $_POST['newsletter_email'] ) ) : '';
		$language = isset( $_POST['newsletter_language'] ) ? sanitize_key( wp_unslash( $_POST['newsletter_language'] ) ) : '';
		$language = in_array( $language, Newsletter::LANGUAGES, true ) ? $language : Newsletter::language();
		$version  = isset( $_POST['newsletter_version'] ) ? sanitize_text_field( wp_unslash( $_POST['newsletter_version'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Missing
		if ( 1 !== preg_match( '/^[A-Za-z0-9._-]{1,60}$/', $version ) ) {
			$version = Newsletter::text( $language )['version'];
		}
		$result = Newsletter::sign_up( $email, $language, $version );
		if ( Newsletter::SENT === $result ) {
			SetupFlow::save( array( 'newsletter' => true ) );
		}
		return $result;
	}

	/**
	 * Completes the step "Region, language and privacy" of both paths: the privacy mode and the
	 * language of new forms apply right away, the choice about diagnostic data starts on "Go
	 * live". Diagnostic data and the newsletter each need an answer; a yes to the newsletter
	 * holds the step until the sign-up went out.
	 *
	 * @param array<string,mixed> $state State before the step.
	 * @param string              $news  What the sign-up sent with the step gave (sign_up()).
	 * @return string Error code; empty when the step is done.
	 */
	private static function next_region( array $state, string $news ): string {
		$post     = wp_unslash( $_POST ); // phpcs:ignore WordPress.Security.NonceVerification.Missing,WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- checked in handle(); each field is checked in SetupFlow and Consent.
		$region   = SetupFlow::region_choice( $post );
		$answered = in_array( $post['diagnostics'] ?? null, array( '0', '1' ), true );
		SetupFlow::apply_region( $region );
		SetupFlow::save( array( 'choices' => $region + ( $answered ? SetupFlow::diagnostics_choice( $post ) : array() ) + $state['choices'] ) );
		if ( ! $answered ) {
			return 'no_diagnostics';
		}
		if ( empty( $state['newsletter'] ) ) {
			$answer = $post['newsletter'] ?? null;
			if ( ! in_array( $answer, array( '0', '1' ), true ) ) {
				return 'no_newsletter';
			}
			// The note of the sign-up (newsletter=…) says what went wrong.
			if ( '1' === $answer && Newsletter::SENT !== $news ) {
				return 'newsletter';
			}
		}
		return '';
	}

	/**
	 * Completes a step of the update path.
	 *
	 * @param array<string,mixed> $state State.
	 * @return string Error code; empty when the step is done.
	 */
	private static function next_update( array $state ): string {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked in handle().
		switch ( $state['step'] ) {
			case 'import':
				return 'done' === SetupFlow::import_status()['phase'] ? '' : 'import_running';
			case 'keep':
				$forms = isset( $_POST['forms'] ) ? sanitize_key( wp_unslash( $_POST['forms'] ) ) : 'verified';
				$look  = isset( $_POST['look'] ) ? sanitize_key( wp_unslash( $_POST['look'] ) ) : 'classic';
				SetupFlow::save(
					array(
						'choices' => array(
							'forms'     => in_array( $forms, array( 'verified', 'pick' ), true ) ? $forms : 'verified',
							'picked'    => array_map( 'absint', (array) wp_unslash( $_POST['picked'] ?? array() ) ), // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- absint.
							'look'      => 'new' === $look ? 'new' : 'classic',
							'rejected'  => array(),
							'retention' => SetupFlow::clean_retention( wp_unslash( $_POST['retention'] ?? null ), 'update' ), // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- checked against the offered values.
						) + $state['choices'],
					)
				);
				return 'pick' === $forms && empty( $_POST['picked'] ) ? 'nothing_picked' : '';
			case 'preview':
				$approved = array_map( 'absint', (array) wp_unslash( $_POST['approved'] ?? array() ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- absint.
				$rejected = array_values( array_diff( SetupFlow::chosen( $state['choices'] ), $approved ) );
				SetupFlow::save( array( 'choices' => array( 'rejected' => $rejected ) + $state['choices'] ) );
				return '';
			case 'live':
				SetupFlow::save( array( 'result' => SetupFlow::go_live_update( $state['choices'] ) ) );
				return '';
			default:
				return '';
		}
		// phpcs:enable WordPress.Security.NonceVerification.Missing
	}

	/**
	 * Completes a step of the new installation.
	 *
	 * @param array<string,mixed> $state State.
	 * @return string Error code; empty when the step is done.
	 */
	private static function next_new( array $state ): string {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked in handle().
		switch ( $state['step'] ) {
			case 'goal':
				$template = isset( $_POST['template'] ) ? sanitize_key( wp_unslash( $_POST['template'] ) ) : '';
				if ( ! FormTemplates::exists( $template ) ) {
					return 'no_template';
				}
				$forms = new FormRepository();
				$form  = 0 === $state['form_id'] ? null : $forms->by_id( $state['form_id'] );
				if ( null !== $form && $template === $state['choices']['template'] ) {
					return '';
				}
				// A form the assistant made and nobody published gives way to the new choice.
				if ( null !== $form && null === $form['current_revision_id'] ) {
					$forms->delete( (int) $form['id'] );
				}
				$form_id = SetupFlow::first_form( $template, (string) $state['choices']['email'] );
				if ( null === $form_id ) {
					return 'no_template';
				}
				$goal = isset( $_POST['goal'] ) ? sanitize_key( wp_unslash( $_POST['goal'] ) ) : '';
				SetupFlow::save(
					array(
						'form_id' => $form_id,
						'choices' => array(
							'template' => $template,
							'goal'     => in_array( $goal, FormTemplates::GOALS, true ) ? $goal : '',
						) + $state['choices'],
					)
				);
				return '';
			case 'brand':
				$color = isset( $_POST['color'] ) ? (string) sanitize_hex_color( wp_unslash( $_POST['color'] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitize_hex_color.
				$color = '' === $color ? '#6A30F5' : $color;
				$font  = isset( $_POST['font'] ) ? FormEditor::clean( sanitize_text_field( wp_unslash( $_POST['font'] ) ), 60 ) : '';
				SetupFlow::brand( $state['form_id'], $color, $font );
				SetupFlow::save(
					array(
						'choices' => array(
							'color' => $color,
							'font'  => $font,
						) + $state['choices'],
					)
				);
				return '';
			case 'live':
				$email = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
				if ( ! is_email( $email ) ) {
					return 'invalid_email';
				}
				$place  = isset( $_POST['place'] ) ? sanitize_key( wp_unslash( $_POST['place'] ) ) : 'page';
				$title  = isset( $_POST['page_title'] ) ? FormEditor::clean( sanitize_text_field( wp_unslash( $_POST['page_title'] ) ), 120 ) : '';
				$result = SetupFlow::publish_first( $state['form_id'], $email, 'page' === $place ? ( '' === $title ? __( 'Request', 'funnelforms-free' ) : $title ) : '' );
				$days   = SetupFlow::clean_retention( wp_unslash( $_POST['retention'] ?? null ), 'new' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- checked against the offered values.
				if ( $result['ok'] ) {
					SetupFlow::apply_retention( $days );
					SetupFlow::apply_diagnostics( $state['choices'] );
				}
				SetupFlow::save(
					array(
						'result'  => $result,
						'choices' => array(
							'email'     => $email,
							'retention' => $days,
						) + $state['choices'],
					)
				);
				return $result['ok'] ? '' : 'publish_failed';
			default:
				return '';
		}
		// phpcs:enable WordPress.Security.NonceVerification.Missing
	}

	/**
	 * AJAX: moves the restore point and the import on and answers with the progress.
	 */
	public static function ajax_progress(): void {
		check_ajax_referer( self::PROGRESS );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}
		$status = SetupFlow::drive();
		ob_start();
		self::progress( $status );
		wp_send_json_success(
			array(
				'phase' => $status['phase'],
				'html'  => (string) ob_get_clean(),
			)
		);
	}

	/**
	 * AJAX: the preview page of a form, in the new look when asked.
	 */
	public static function ajax_preview(): void {
		check_ajax_referer( self::PREVIEW );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}
		$form = ( new FormRepository() )->by_id( isset( $_GET['form'] ) ? absint( $_GET['form'] ) : 0 );
		$doc  = null === $form ? null : FormEditor::create()->editing( $form );
		if ( null === $form || null === $doc ) {
			wp_send_json_error( array( 'message' => __( 'This form has no version to show yet.', 'funnelforms-free' ) ), 404 );
		}
		if ( isset( $_GET['look'] ) && 'new' === $_GET['look'] ) {
			$doc->style = SetupFlow::new_look( $doc->style ?? null );
		}
		$page = FormPreview::page_with( $form, $doc, get_current_user_id(), time() );
		if ( ! $page['ok'] ) {
			wp_send_json_error( array( 'message' => __( 'Fix the problems of the form to see the preview.', 'funnelforms-free' ) ), 409 );
		}
		wp_send_json_success( array( 'html' => $page['html'] ) );
	}

	/**
	 * AJAX: colours and fonts of the own website: what its theme and page builder are set to
	 * (SiteDesign, without a request); when that is unsure, what its start page shows.
	 */
	public static function ajax_branding(): void {
		check_ajax_referer( self::BRANDING );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( null, 403 );
		}
		$design = Edition::pro( SiteDesign::class );
		$found  = null === $design ? 'unavailable' : $design::read();
		$import = Edition::pro( BrandingImport::class );
		if ( null !== $import && ( is_string( $found ) || 'low' === $found['confidence'] ) ) {
			$page  = $import::run( home_url( '/' ), get_current_user_id() );
			$found = is_array( $page ) && ( is_string( $found ) || 'low' !== $page['confidence'] ) ? $page : $found;
		}
		if ( is_string( $found ) || array() === $found['colors'] ) {
			wp_send_json_error( array( 'message' => __( 'The colours of your website could not be read. Pick them by hand.', 'funnelforms-free' ) ) );
		}
		wp_send_json_success(
			array(
				'colors' => array_values( array_filter( array_map( 'sanitize_hex_color', $found['colors'] ) ) ),
				'fonts'  => array_values( array_unique( array_column( $found['fonts'], 'family' ) ) ),
			)
		);
	}

	/*
	 * Page.
	 */

	/**
	 * The whole page.
	 */
	private static function render(): void {
		$state = SetupFlow::state();
		$steps = SetupFlow::steps( $state['path'] );
		$index = (int) array_search( $state['step'], $steps, true );
		$names = self::step_names( $state['path'] );
		Ui::styles();
		wp_enqueue_script( 'funnelforms-setup', plugins_url( 'assets/admin/setup.js', FUNNELFORMS_PLUGIN_FILE ), array(), FUNNELFORMS_ASSET_VERSION, true );
		wp_localize_script(
			'funnelforms-setup',
			'funnelformsSetup',
			array(
				'ajax'     => admin_url( 'admin-ajax.php' ),
				'progress' => wp_create_nonce( self::PROGRESS ),
				'preview'  => wp_create_nonce( self::PREVIEW ),
				'branding' => wp_create_nonce( self::BRANDING ),
				'texts'    => array(
					'loading' => __( 'Loading the preview …', 'funnelforms-free' ),
					'copied'  => __( 'Copied', 'funnelforms-free' ),
					'reading' => __( 'Reading your website …', 'funnelforms-free' ),
				),
			)
		);
		?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?php esc_html_e( 'Set up Funnelforms', 'funnelforms-free' ); ?></title>
		<?php wp_print_styles( array( Ui::HANDLE ) ); ?>
</head>
<body class="ffx-setup-body">
<div class="ffx-app ffx-setup">
	<aside class="ffx-setup__side">
		<div class="ffx-setup__brand">
			<span class="ffx-top__mark"><?php echo Ui::mark(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<span>Funnelforms</span>
		</div>
		<p class="ffx-setup__path"><?php echo esc_html( 'update' === $state['path'] ? __( 'Move to Funnelforms 5', 'funnelforms-free' ) : __( 'Your first form', 'funnelforms-free' ) ); ?></p>
		<ol class="ffx-setup__steps">
			<?php foreach ( $steps as $i => $step ) : ?>
				<?php
				$class = $i < $index ? 'is-done' : ( $i === $index ? 'is-current' : '' );
				$mark  = $i < $index ? Ui::icon( 'check' ) : esc_html( (string) ( $i + 1 ) );
				?>
				<li class="<?php echo esc_attr( $class ); ?>"<?php echo $i === $index ? ' aria-current="step"' : ''; ?>>
					<span class="ffx-setup__dot"><?php echo $mark; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG or escaped number. ?></span>
					<?php if ( $i < $index && 'done' !== $state['step'] ) : ?>
						<a href="<?php echo esc_url( self::action_url( 'goto', $step ) ); ?>"><?php echo esc_html( $names[ $step ] ); ?></a>
					<?php else : ?>
						<span><?php echo esc_html( $names[ $step ] ); ?></span>
					<?php endif; ?>
				</li>
			<?php endforeach; ?>
		</ol>
		<div class="ffx-setup__side-foot">
			<?php if ( 'update' === $state['path'] ) : ?>
				<p class="ffx-setup__safe"><?php echo Ui::icon( 'shield' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php echo MigrationPage::way_back() ? esc_html__( 'Your Funnelforms 3 data stays untouched. One click takes you back at any time.', 'funnelforms-free' ) : esc_html__( 'Your Funnelforms 3 data stays untouched.', 'funnelforms-free' ); ?></span></p>
			<?php endif; ?>
			<?php if ( 'done' !== $state['step'] ) : ?>
				<div class="ffx-setup__links">
					<a class="ffx-setup__later" href="<?php echo esc_url( self::action_url( 'later' ) ); ?>"><?php esc_html_e( 'Continue later', 'funnelforms-free' ); ?></a>
				</div>
			<?php endif; ?>
		</div>
	</aside>
	<main class="ffx-setup__main">
		<form class="ffx-setup__form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
			<?php wp_nonce_field( self::ACTION ); ?>
			<div class="ffx-setup__inner">
				<?php if ( 'done' !== $state['step'] ) : ?>
					<?php /* translators: 1: number of the step, 2: number of steps. */ ?>
					<p class="ffx-setup__count"><?php echo esc_html( sprintf( __( 'Step %1$d of %2$d', 'funnelforms-free' ), $index + 1, count( $steps ) ) ); ?></p>
				<?php endif; ?>
				<?php self::error(); ?>
				<?php self::{ 'step_' . $state['path'] . '_' . $state['step'] }( $state ); ?>
			</div>
			<footer class="ffx-setup__nav">
				<?php if ( $index > 0 && 'done' !== $state['step'] ) : ?>
					<button type="submit" name="do" value="back" class="ffx-btn ffx-btn--ghost" formnovalidate><?php echo Ui::icon( 'back' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Back', 'funnelforms-free' ); ?></span></button>
				<?php else : ?>
					<span></span>
				<?php endif; ?>
				<?php self::next_button( $state ); ?>
			</footer>
		</form>
	</main>
</div>
		<?php wp_print_scripts( array( 'funnelforms-setup' ) ); ?>
</body>
</html>
		<?php
	}

	/**
	 * Names of the steps.
	 *
	 * @param string $path Path.
	 * @return array<string,string>
	 */
	public static function step_names( string $path ): array {
		if ( 'update' === $path ) {
			return array(
				'welcome' => __( 'Welcome', 'funnelforms-free' ),
				'region'  => __( 'Region, language and privacy', 'funnelforms-free' ),
				'import'  => __( 'Bring over your data', 'funnelforms-free' ),
				'keep'    => __( 'What to keep', 'funnelforms-free' ),
				'preview' => __( 'Compare', 'funnelforms-free' ),
				'live'    => __( 'Go live', 'funnelforms-free' ),
				'done'    => __( 'Done', 'funnelforms-free' ),
			);
		}
		return array(
			'welcome' => __( 'Welcome', 'funnelforms-free' ),
			'intro'   => __( 'How Funnelforms works', 'funnelforms-free' ),
			'region'  => __( 'Region, language and privacy', 'funnelforms-free' ),
			'account' => __( 'Your account', 'funnelforms-free' ),
			'goal'    => __( 'Your goal', 'funnelforms-free' ),
			'brand'   => __( 'Your brand', 'funnelforms-free' ),
			'preview' => __( 'Preview', 'funnelforms-free' ),
			'live'    => __( 'Go live', 'funnelforms-free' ),
			'done'    => __( 'Done', 'funnelforms-free' ),
		);
	}

	/**
	 * Address of an action without a form (links in the side bar).
	 *
	 * @param string $action Action.
	 * @param string $step   Target step.
	 */
	private static function action_url( string $action, string $step = '' ): string {
		$args = array(
			'action' => self::ACTION,
			'do'     => $action,
		);
		if ( '' !== $step ) {
			$args['step'] = $step;
		}
		return wp_nonce_url( add_query_arg( $args, admin_url( 'admin-post.php' ) ), self::ACTION );
	}

	/**
	 * The main button of a step.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function next_button( array $state ): void {
		$labels   = array(
			'update:welcome' => __( 'Let\'s start', 'funnelforms-free' ),
			'update:live'    => __( 'Go live now', 'funnelforms-free' ),
			'update:done'    => __( 'Go to the overview', 'funnelforms-free' ),
			'new:welcome'    => __( 'Let\'s start', 'funnelforms-free' ),
			'new:account'    => 'active' === self::license()['status'] ? __( 'Continue', 'funnelforms-free' ) : __( 'Skip for now', 'funnelforms-free' ),
			'new:goal'       => __( 'Use this template', 'funnelforms-free' ),
			'new:live'       => __( 'Publish', 'funnelforms-free' ),
			'new:done'       => __( 'Go to the overview', 'funnelforms-free' ),
		);
		$key      = $state['path'] . ':' . $state['step'];
		$label    = $labels[ $key ] ?? __( 'Continue', 'funnelforms-free' );
		$disabled = 'update:import' === $key && 'done' !== SetupFlow::import_status()['phase'];
		$kind     = 'new:account' === $key && 'active' !== self::license()['status'] ? 'ffx-btn' : 'ffx-btn ffx-btn--primary ffx-btn--lg';
		?>
		<button type="submit" name="do" value="next" class="<?php echo esc_attr( $kind ); ?>" data-ffx-next <?php disabled( $disabled ); ?>><span><?php echo esc_html( $label ); ?></span><?php echo Ui::icon( in_array( $key, array( 'update:live', 'new:live' ), true ) ? 'rocket' : 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></button>
		<?php
	}

	/**
	 * The message of a failed step.
	 */
	private static function error(): void {
		$code = isset( $_GET['error'] ) ? sanitize_key( wp_unslash( $_GET['error'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		$text = match ( $code ) {
			'import_running' => __( 'The import is still running. It goes on by itself; this page shows when it is done.', 'funnelforms-free' ),
			'nothing_picked' => __( 'Pick at least one form, or choose "All checked forms".', 'funnelforms-free' ),
			'no_template'    => __( 'Please pick a template.', 'funnelforms-free' ),
			'invalid_email'  => __( 'Please enter a valid e-mail address for the notifications.', 'funnelforms-free' ),
			'no_diagnostics' => __( 'Please choose whether the plugin may send diagnostic data.', 'funnelforms-free' ),
			'no_newsletter'  => __( 'Please choose whether you want tips and news by email.', 'funnelforms-free' ),
			'publish_failed' => __( 'The form could not be published. Open it in the form builder; it shows what is missing.', 'funnelforms-free' ),
			default          => '',
		};
		$license = isset( $_GET['license'] ) ? sanitize_key( wp_unslash( $_GET['license'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		$account = Edition::pro( AccountPage::class );
		$message = '' === $license || null === $account ? null : $account::message( $license );
		if ( null !== $message ) {
			echo '<div class="ffx-setup__note is-' . esc_attr( $message[0] ) . '" role="status">' . esc_html( $message[1] ) . '</div>';
		}
		// A sign-up sent with the step before; the step "Region, language and privacy" tells it itself.
		$news = isset( $_GET['newsletter'] ) ? sanitize_key( wp_unslash( $_GET['newsletter'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		if ( Newsletter::SENT === $news && 'region' !== SetupFlow::state()['step'] && SetupFlow::state()['newsletter'] ) {
			echo '<div class="ffx-setup__note is-success" role="status">' . esc_html__( 'Please confirm the email we sent you.', 'funnelforms-free' ) . '</div>';
		}
		if ( '' !== $text ) {
			$form = 'publish_failed' === $code ? (int) ( SetupFlow::state()['form_id'] ?? 0 ) : 0;
			$open = $form > 0 ? ' ' . Ui::button( __( 'Open the form builder', 'funnelforms-free' ), add_query_arg( 'form', $form, admin_url( 'admin.php?page=' . BuilderPage::SLUG ) ), 'ghost' ) : '';
			echo '<div class="ffx-setup__note is-error" role="alert">' . esc_html( $text ) . $open . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
		}
	}

	/**
	 * Heading of a step.
	 *
	 * @param string $title Title.
	 * @param string $lead  Text below.
	 */
	private static function head( string $title, string $lead = '' ): void {
		echo '<h1 class="ffx-setup__title">' . esc_html( $title ) . '</h1>';
		if ( '' !== $lead ) {
			echo '<p class="ffx-setup__lead">' . esc_html( $lead ) . '</p>';
		}
	}

	/**
	 * A tile with an icon, a title and a text.
	 *
	 * @param string $icon  Icon.
	 * @param string $title Title.
	 * @param string $text  Text.
	 * @param string $badge Small label above the title.
	 * @param string $art   Drawing above the tile: build, embed or answer; empty for none.
	 */
	private static function tile( string $icon, string $title, string $text, string $badge = '', string $art = '' ): void {
		?>
		<div class="ffx-setup__tile<?php echo '' !== $art ? ' has-art' : ''; ?>">
			<?php if ( '' !== $art ) : ?>
				<?php self::art( $art ); ?>
			<?php endif; ?>
			<span class="ffx-setup__icon"><?php echo Ui::icon( $icon ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<?php if ( '' !== $badge ) : ?>
				<span class="ffx-setup__badge"><?php echo esc_html( $badge ); ?></span>
			<?php endif; ?>
			<h3><?php echo esc_html( $title ); ?></h3>
			<p><?php echo esc_html( $text ); ?></p>
		</div>
		<?php
	}

	/**
	 * A small drawing of what a tile explains (decoration only).
	 *
	 * @param string $kind build, embed or answer.
	 */
	private static function art( string $kind ): void {
		echo '<div class="ffx-setup__art is-' . esc_attr( $kind ) . '" aria-hidden="true">';
		if ( 'build' === $kind ) {
			echo '<span class="is-on"></span><span></span><span class="is-on"></span><b></b>';
		} elseif ( 'embed' === $kind ) {
			echo '<i><em></em><em></em><em></em></i><span><strong>[funnelforms]</strong></span>';
		} else {
			echo '<span><em></em></span><span><em></em></span><span><em></em></span><b><i style="height:40%"></i><i style="height:70%"></i><i style="height:55%"></i><i style="height:90%"></i></b>';
		}
		echo '</div>';
	}

	/**
	 * Both paths: region, language and privacy.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function region( array $state ): void {
		$choices = $state['choices'];
		self::head( __( 'Region, language and privacy', 'funnelforms-free' ), __( 'A few basics for all your forms. You can change each of them later under Settings.', 'funnelforms-free' ) );
		?>
		<fieldset class="ffx-setup__group">
			<legend><?php esc_html_e( 'Where are most of your visitors?', 'funnelforms-free' ); ?></legend>
			<div class="ffx-setup__options-row">
				<?php
				self::option( 'privacy', PrivacyMode::EU, PrivacyMode::EU === $choices['privacy'], __( 'In Europe', 'funnelforms-free' ), __( 'EU, EEA, Switzerland or the UK. Tracking, identifiers and services of other providers run only with the visitor\'s consent (GDPR).', 'funnelforms-free' ), 'shield' );
				self::option( 'privacy', PrivacyMode::GLOBAL, PrivacyMode::GLOBAL === $choices['privacy'], __( 'Outside Europe', 'funnelforms-free' ), __( 'Without a cookie banner, consent counts as given. A refusal in the cookie banner and Global Privacy Control are still respected.', 'funnelforms-free' ), 'globe' );
				?>
			</div>
			<p class="ffx-setup__hint"><?php esc_html_e( 'This sets the privacy mode of all forms. If some visitors come from Europe, choose Europe.', 'funnelforms-free' ); ?></p>
		</fieldset>
		<fieldset class="ffx-setup__group">
			<legend><?php esc_html_e( 'Language of your forms', 'funnelforms-free' ); ?></legend>
			<label class="ffx-setup__label" for="ffx-setup-language"><?php esc_html_e( 'New forms and templates start in', 'funnelforms-free' ); ?></label>
			<select id="ffx-setup-language" name="language">
				<?php /* translators: %s: language code of WordPress, such as de_DE. */ ?>
				<option value="" <?php selected( $choices['language'], '' ); ?>><?php echo esc_html( sprintf( __( 'Language of the website (%s)', 'funnelforms-free' ), get_locale() ) ); ?></option>
				<?php foreach ( self::LANGUAGE_NAMES as $locale => $name ) : ?>
					<option value="<?php echo esc_attr( $locale ); ?>" lang="<?php echo esc_attr( substr( $locale, 0, 2 ) ); ?>" <?php selected( $choices['language'], $locale ); ?>><?php echo esc_html( $name ); ?></option>
				<?php endforeach; ?>
			</select>
			<p class="ffx-setup__hint"><?php esc_html_e( 'Buttons, messages and the texts of the templates come in this language. Each form can use another one or several.', 'funnelforms-free' ); ?></p>
		</fieldset>
		<?php
		TelemetrySection::setup_group( $choices );
		self::newsletter( $state );
	}

	/**
	 * Update: region, language and privacy.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_update_region( array $state ): void {
		self::region( $state );
	}

	/**
	 * New: region, language and privacy.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_region( array $state ): void {
		self::region( $state );
	}

	/*
	 * Steps of the update.
	 */

	/**
	 * Update: welcome.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_update_welcome( array $state ): void {
		unset( $state );
		$user = wp_get_current_user();
		$name = '' !== $user->first_name ? $user->first_name : $user->display_name;
		/* translators: %s: first name. */
		self::head( sprintf( __( 'Welcome to Funnelforms 5, %s', 'funnelforms-free' ), $name ), __( 'In a few steps your forms move to Funnelforms 5. You decide what to keep and see every form before it goes live.', 'funnelforms-free' ) );
		echo '<div class="ffx-setup__tiles">';
		self::tile( 'layers', __( 'A new form builder', 'funnelforms-free' ), __( 'Steps, answers and logic on one canvas, with a live preview for desktop and phone.', 'funnelforms-free' ) );
		self::tile( 'rocket', __( 'Faster forms', 'funnelforms-free' ), __( 'A lighter runtime that loads quickly, works without jQuery and is accessible.', 'funnelforms-free' ) );
		self::tile( 'chart', __( 'Clear figures', 'funnelforms-free' ), __( 'Views, entries and completion rate of every form at a glance.', 'funnelforms-free' ) );
		echo '</div>';
		?>
		<div class="ffx-setup__promise">
			<span class="ffx-setup__icon is-success"><?php echo Ui::icon( 'shield' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<div>
				<h3><?php esc_html_e( 'Nothing gets lost', 'funnelforms-free' ); ?></h3>
				<ul>
					<li><?php esc_html_e( 'Before anything else, Funnelforms saves a restore point of all your Funnelforms 3 data.', 'funnelforms-free' ); ?></li>
					<li><?php esc_html_e( 'Your forms, questions, leads and settings in Funnelforms 3 are only read, never changed.', 'funnelforms-free' ); ?></li>
					<li><?php echo MigrationPage::way_back() ? esc_html__( 'Shortcodes and pages stay as they are. One click takes you back to Funnelforms 3.', 'funnelforms-free' ) : esc_html__( 'Shortcodes and pages stay as they are.', 'funnelforms-free' ); ?></li>
				</ul>
			</div>
		</div>
		<?php
	}

	/**
	 * Update: restore point and import.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_update_import( array $state ): void {
		unset( $state );
		$status = SetupFlow::import_status();
		self::head( __( 'Bring over your data', 'funnelforms-free' ), __( 'Funnelforms saves a restore point, then copies your forms, entries, appointments and connections. Your Funnelforms 3 data is only read.', 'funnelforms-free' ) );
		?>
		<div class="ffx-setup__card" data-ffx-progress="<?php echo esc_attr( $status['phase'] ); ?>">
			<?php self::progress( $status ); ?>
		</div>
		<?php
		if ( 'done' === $status['phase'] ) {
			self::results( SetupFlow::imported_forms() );
		}
	}

	/**
	 * The list of what is being saved and copied.
	 *
	 * @param array<string,mixed> $status SetupFlow::import_status().
	 */
	private static function progress( array $status ): void {
		$rows    = array(
			array( 'backup', __( 'Restore point of Funnelforms 3', 'funnelforms-free' ) ),
			array( 'connections', __( 'Connections (e-mail, CRM, webhooks)', 'funnelforms-free' ) ),
			array( 'booking_types', __( 'Appointment types', 'funnelforms-free' ) ),
			array( 'forms', __( 'Forms', 'funnelforms-free' ) ),
			array( 'entries', __( 'Entries', 'funnelforms-free' ) ),
			array( 'bookings', __( 'Appointments', 'funnelforms-free' ) ),
		);
		$summary = $status['summary'];
		$counts  = array(
			'forms'   => array_sum( (array) ( $summary['af2_formular'] ?? array() ) ),
			'entries' => array_sum( (array) ( $summary['af2_request'] ?? array() ) ),
		);
		echo '<ol class="ffx-setup__progress">';
		foreach ( $rows as $i => $row ) {
			if ( 'backup' === $row[0] ) {
				$state = 'backup' === $status['phase'] ? 'running' : ( 'failed' === $status['phase'] ? 'failed' : ( '' !== $status['backup']['id'] || ! LegacyBackup::required() ? 'done' : 'waiting' ) );
				$note  = 'done' === $state && '' !== $status['backup']['id'] ? __( 'Saved and checked', 'funnelforms-free' ) : '';
			} else {
				$position = $i - 1;
				$state    = 'done' === $status['phase'] || $status['import']['phase'] > $position ? 'done' : ( 'import' === $status['phase'] && $status['import']['phase'] === $position && 'running' === $status['import']['status'] ? 'running' : 'waiting' );
				/* translators: %d: number of items copied. */
				$note = isset( $counts[ $row[0] ] ) && $counts[ $row[0] ] > 0 ? sprintf( _n( '%d copied', '%d copied', $counts[ $row[0] ], 'funnelforms-free' ), $counts[ $row[0] ] ) : '';
			}
			$icon = 'done' === $state ? Ui::icon( 'check' ) : '';
			echo '<li class="is-' . esc_attr( $state ) . '"><span class="ffx-setup__dot">' . $icon . '</span><span>' . esc_html( $row[1] ) . '</span><small>' . esc_html( $note ) . '</small></li>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
		}
		echo '</ol>';
		if ( 'failed' === $status['phase'] ) {
			?>
			<div class="ffx-setup__note is-error" role="alert">
				<p><?php esc_html_e( 'The restore point could not be written, so nothing goes live yet. Make sure the uploads folder of WordPress is writable, then try again.', 'funnelforms-free' ); ?></p>
				<a class="ffx-btn" href="<?php echo esc_url( self::action_url( 'retry_backup' ) ); ?>"><?php esc_html_e( 'Try again', 'funnelforms-free' ); ?></a>
			</div>
			<?php
		}
	}

	/**
	 * Result of the import per form: how many are ready, need a look or stay on Funnelforms 3,
	 * and for each form why, in words.
	 *
	 * @param list<array<string,mixed>> $forms SetupFlow::imported_forms().
	 */
	private static function results( array $forms ): void {
		$by     = array_count_values( array_column( $forms, 'state' ) );
		$ready  = (int) ( $by['ready'] ?? 0 );
		$review = (int) ( $by['review'] ?? 0 );
		$stay   = (int) ( $by['stays'] ?? 0 );
		?>
		<div class="ffx-setup__stats">
			<div class="is-success"><strong><?php echo esc_html( (string) $ready ); ?></strong><span><?php esc_html_e( 'checked and ready', 'funnelforms-free' ); ?></span></div>
			<div class="is-warning"><strong><?php echo esc_html( (string) $review ); ?></strong><span><?php esc_html_e( 'please have a look', 'funnelforms-free' ); ?></span></div>
			<div><strong><?php echo esc_html( (string) $stay ); ?></strong><span><?php esc_html_e( 'stay on Funnelforms 3 for now', 'funnelforms-free' ); ?></span></div>
		</div>
		<?php if ( $review > 0 ) : ?>
			<div class="ffx-setup__note is-warning">
				<p>
					<?php
					/* translators: %d: number of forms. */
					echo esc_html( sprintf( _n( 'For %d form the comparison found differences. It stays on Funnelforms 3 until you had a look, so your visitors notice nothing. Below you see what was found.', 'For %d forms the comparison found differences. They stay on Funnelforms 3 until you had a look, so your visitors notice nothing. Below you see what was found.', $review, 'funnelforms-free' ), $review ) );
					?>
				</p>
			</div>
		<?php endif; ?>
		<ul class="ffx-setup__forms">
			<?php foreach ( $forms as $form ) : ?>
				<li class="is-<?php echo esc_attr( (string) $form['state'] ); ?>">
					<span class="ffx-setup__form-title"><?php echo esc_html( '' !== $form['title'] ? $form['title'] : __( '(no title)', 'funnelforms-free' ) ); ?></span>
					<?php echo self::check_badge( $form ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in Ui. ?>
					<?php self::reasons( $form ); ?>
				</li>
			<?php endforeach; ?>
		</ul>
		<?php
	}

	/**
	 * Why a form needs a look or stays on Funnelforms 3, with the way to its details.
	 *
	 * @param array<string,mixed> $form Form of SetupFlow::imported_forms().
	 */
	private static function reasons( array $form ): void {
		if ( 'review' === $form['state'] ) {
			$lines = MigrationTexts::findings( (array) $form['checks'] );
			if ( array() === $lines ) {
				$lines = array( MigrationTexts::blocker( 'needs_review' )['title'] );
			}
		} elseif ( 'stays' === $form['state'] ) {
			$lines = array_values( array_unique( array_map( static fn( string $code ): string => MigrationTexts::blocker( $code, (int) $form['id'] )['title'], (array) $form['blockers'] ) ) );
		} else {
			return;
		}
		$more = count( $lines ) - 3;
		echo '<ul class="ffx-setup__reasons">';
		foreach ( array_slice( $lines, 0, 3 ) as $line ) {
			echo '<li>' . esc_html( $line ) . '</li>';
		}
		echo '</ul>';
		$label = 'review' === $form['state'] ? __( 'Compare and see what to do', 'funnelforms-free' ) : __( 'See why and what to do', 'funnelforms-free' );
		if ( $more > 0 ) {
			/* translators: %d: number of further findings. */
			$label = sprintf( _n( '%d more finding, compare and see what to do', '%d more findings, compare and see what to do', $more, 'funnelforms-free' ), $more );
		}
		if ( SetupFlow::open() ) {
			return;
			// Funnelforms pages lead back to the assistant while it is open.
		}
		echo '<a class="ffx-setup__reasons-link" href="' . esc_url( MigrationPage::form_url( $form ) ) . '" target="_blank" rel="noopener">' . esc_html( $label ) . '<span class="screen-reader-text"> ' . esc_html__( '(opens in a new tab)', 'funnelforms-free' ) . '</span></a>';
	}

	/**
	 * Label of the check of a form.
	 *
	 * @param array<string,mixed> $form Form of SetupFlow::imported_forms().
	 */
	private static function check_badge( array $form ): string {
		return MigrationTexts::state_badge( (string) $form['state'], (string) $form['check'] );
	}

	/**
	 * A choice as a card with a radio button.
	 *
	 * @param string $name    Field name.
	 * @param string $value   Value.
	 * @param bool   $checked Checked.
	 * @param string $title   Title.
	 * @param string $text    Text.
	 * @param string $icon    Icon.
	 */
	private static function option( string $name, string $value, bool $checked, string $title, string $text, string $icon = '' ): void {
		?>
		<label class="ffx-setup__option">
			<input type="radio" name="<?php echo esc_attr( $name ); ?>" value="<?php echo esc_attr( $value ); ?>" <?php checked( $checked ); ?>>
			<?php if ( '' !== $icon ) : ?>
				<span class="ffx-setup__icon"><?php echo Ui::icon( $icon ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<?php endif; ?>
			<span class="ffx-setup__option-text"><strong><?php echo esc_html( $title ); ?></strong><span><?php echo esc_html( $text ); ?></span></span>
		</label>
		<?php
	}

	/**
	 * Update: what to keep.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_update_keep( array $state ): void {
		$choices = $state['choices'];
		$forms   = SetupFlow::imported_forms();
		$ready   = count( SetupFlow::chosen( array( 'forms' => 'verified' ) + $choices ) );
		self::head( __( 'What to keep', 'funnelforms-free' ), __( 'A few questions, then you see each form before anything goes live.', 'funnelforms-free' ) );
		?>
		<fieldset class="ffx-setup__group">
			<legend><?php esc_html_e( 'Which forms move to Funnelforms 5?', 'funnelforms-free' ); ?></legend>
			<?php
			/* translators: %d: number of forms. */
			self::option( 'forms', 'verified', 'verified' === $choices['forms'], __( 'All checked forms', 'funnelforms-free' ), sprintf( _n( '%d form passed every check and can move right away.', '%d forms passed every check and can move right away.', $ready, 'funnelforms-free' ), $ready ), 'check' );
			self::option( 'forms', 'pick', 'pick' === $choices['forms'], __( 'Let me pick', 'funnelforms-free' ), __( 'Choose the forms one by one; the others stay on Funnelforms 3.', 'funnelforms-free' ), 'form' );
			?>
			<p class="ffx-setup__hint">
				<?php echo MigrationPage::way_back() ? esc_html__( 'Forms that passed the checks move on their own. You can send each form back to Funnelforms 3 individually, in the comparison next and later under Funnelforms → Migration.', 'funnelforms-free' ) : esc_html__( 'Forms that passed the checks move on their own. In the comparison next you can leave out single forms.', 'funnelforms-free' ); ?>
			</p>
			<div class="ffx-setup__pick" data-ffx-pick>
				<?php foreach ( $forms as $form ) : ?>
					<?php $possible = array() === $form['blockers'] && 'failed' !== $form['check']; ?>
					<label class="ffx-setup__check<?php echo $possible ? '' : ' is-disabled'; ?>">
						<input type="checkbox" name="picked[]" value="<?php echo esc_attr( (string) $form['id'] ); ?>" <?php checked( in_array( $form['id'], array_map( 'intval', (array) $choices['picked'] ), true ) ); ?> <?php disabled( ! $possible ); ?>>
						<span><?php echo esc_html( '' !== $form['title'] ? $form['title'] : __( '(no title)', 'funnelforms-free' ) ); ?></span>
						<?php echo self::check_badge( $form ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in Ui. ?>
					</label>
				<?php endforeach; ?>
			</div>
			<?php if ( in_array( 'review', array_column( $forms, 'state' ), true ) ) : ?>
				<p class="ffx-setup__hint">
					<?php esc_html_e( 'Forms marked "Please have a look" stay on Funnelforms 3 for now. After the setup, Funnelforms → Migration shows what the comparison found and how to move them.', 'funnelforms-free' ); ?>
				</p>
			<?php endif; ?>
		</fieldset>
		<fieldset class="ffx-setup__group">
			<legend><?php esc_html_e( 'How should your forms look?', 'funnelforms-free' ); ?></legend>
			<div class="ffx-setup__options-row">
				<?php
				self::option( 'look', 'classic', 'classic' === $choices['look'], __( 'As before', 'funnelforms-free' ), __( 'Colours, fonts and sizes of Funnelforms 3, exactly as your visitors know them.', 'funnelforms-free' ), 'history' );
				self::option( 'look', 'new', 'new' === $choices['look'], __( 'The new Funnelforms design', 'funnelforms-free' ), __( 'Calmer, more modern and made for phones, with your main colour and font.', 'funnelforms-free' ), 'sparkles' );
				?>
			</div>
		</fieldset>
		<?php self::retention_group( 'update', (int) $choices['retention'] ); ?>
		<fieldset class="ffx-setup__group">
			<legend><?php esc_html_e( 'Connections', 'funnelforms-free' ); ?></legend>
			<?php self::connections(); ?>
		</fieldset>
		<?php
	}

	/**
	 * The question how long entries are kept, with the periods SetupFlow offers.
	 *
	 * @param string $path    update or new.
	 * @param int    $current Preselected period in days.
	 */
	private static function retention_group( string $path, int $current ): void {
		?>
		<fieldset class="ffx-setup__group">
			<legend><?php esc_html_e( 'How long should entries be kept?', 'funnelforms-free' ); ?></legend>
			<div class="ffx-setup__options-row">
				<?php
				foreach ( SetupFlow::retention_options( $path ) as $days ) {
					self::option( 'retention', (string) $days, $current === $days, self::retention_title( $days ), 0 === $days ? __( 'Entries stay until you delete them.', 'funnelforms-free' ) : '', 0 === $days ? 'inbox' : 'calendar' );
				}
				?>
			</div>
			<p class="ffx-setup__hint">
				<?php echo 'update' === $path ? esc_html__( 'Older entries are deleted automatically, with their uploaded files. Your current setting is preselected, so nothing changes unless you change it.', 'funnelforms-free' ) : esc_html__( 'Older entries are deleted automatically, with their uploaded files. You can change this later under Settings.', 'funnelforms-free' ); ?>
			</p>
		</fieldset>
		<?php
	}

	/**
	 * Name of a period for deleting entries.
	 *
	 * @param int $days Days; 0 keeps entries.
	 */
	private static function retention_title( int $days ): string {
		switch ( $days ) {
			case 0:
				return __( 'Never', 'funnelforms-free' );
			case 180:
				return __( '6 months', 'funnelforms-free' );
			case 365:
				return __( '12 months', 'funnelforms-free' );
			case 730:
				return __( '24 months', 'funnelforms-free' );
			default:
				/* translators: %d: number of days. */
				return sprintf( _n( '%d day', '%d days', $days, 'funnelforms-free' ), $days );
		}
	}

	/**
	 * One sentence on how long entries are kept.
	 *
	 * @param int $days Days; 0 keeps entries.
	 */
	private static function retention_fact( int $days ): string {
		if ( 0 === $days ) {
			return __( 'Entries are never deleted automatically', 'funnelforms-free' );
		}
		/* translators: %s: period, such as "12 months" or "365 days". */
		return sprintf( __( 'Entries are kept for %s, then deleted automatically', 'funnelforms-free' ), self::retention_title( $days ) );
	}

	/**
	 * Tips and news by email, on the step "Region, language and privacy": yes or no without a
	 * preselection, the consent text of Funnelforms with the yes, and the address while yes is
	 * chosen. The sign-up goes out with the step (Newsletter); once sent, the step only says so.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function newsletter( array $state ): void {
		$code = isset( $_GET['newsletter'] ) ? sanitize_key( wp_unslash( $_GET['newsletter'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		if ( ! empty( $state['newsletter'] ) ) {
			echo '<div class="ffx-setup__note is-success" role="status">' . esc_html__( 'Please confirm the email we sent you.', 'funnelforms-free' ) . '</div>';
			return;
		}
		$language = Newsletter::language();
		$text     = Newsletter::text( $language );
		$user     = wp_get_current_user();
		$email    = '' !== (string) $user->user_email ? (string) $user->user_email : (string) get_option( 'admin_email' );
		$note     = match ( $code ) {
			Newsletter::STALE   => array( 'warning', __( 'Funnelforms has changed the text below. Please read it and choose again.', 'funnelforms-free' ) ),
			Newsletter::FAILED  => array( 'error', __( 'The sign-up could not be sent. Please try again later, or choose "No" for now.', 'funnelforms-free' ) ),
			Newsletter::INVALID => array( 'error', __( 'Please enter a valid e-mail address for the tips and news.', 'funnelforms-free' ) ),
			default             => null,
		};
		?>
		<fieldset class="ffx-setup__group ffx-newsletter">
			<legend><?php esc_html_e( 'Tips and news by email', 'funnelforms-free' ); ?></legend>
			<?php if ( null !== $note ) : ?>
				<div class="ffx-setup__note is-<?php echo esc_attr( $note[0] ); ?>" role="alert"><?php echo esc_html( $note[1] ); ?></div>
			<?php endif; ?>
			<input type="hidden" name="newsletter_language" value="<?php echo esc_attr( $language ); ?>">
			<input type="hidden" name="newsletter_version" value="<?php echo esc_attr( $text['version'] ); ?>">
			<div class="ffx-setup__options-row">
				<label class="ffx-setup__option">
					<input type="radio" name="newsletter" value="1" required>
					<span class="ffx-setup__icon"><?php echo Ui::icon( 'mail' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
					<span class="ffx-setup__option-text"><strong><?php esc_html_e( 'Yes, sign me up', 'funnelforms-free' ); ?></strong><span lang="<?php echo esc_attr( 'de' === $language ? 'de' : 'en' ); ?>"><?php echo Newsletter::text_html( $text['text'], $language ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in text_html(). ?></span></span>
				</label>
				<label class="ffx-setup__option">
					<input type="radio" name="newsletter" value="0" required>
					<span class="ffx-setup__icon"><?php echo Ui::icon( 'shield' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
					<span class="ffx-setup__option-text"><strong><?php esc_html_e( 'No, thanks', 'funnelforms-free' ); ?></strong><span><?php esc_html_e( 'Nothing goes to Funnelforms.', 'funnelforms-free' ); ?></span></span>
				</label>
			</div>
			<div class="ffx-newsletter__more">
				<label class="ffx-setup__label" for="ffx-setup-newsletter-email"><?php esc_html_e( 'Your e-mail address', 'funnelforms-free' ); ?></label>
				<input type="email" id="ffx-setup-newsletter-email" name="newsletter_email" class="regular-text" value="<?php echo esc_attr( $email ); ?>" maxlength="254" autocomplete="email">
				<p class="ffx-setup__hint"><?php esc_html_e( 'You then get an email to confirm the sign-up.', 'funnelforms-free' ); ?></p>
			</div>
		</fieldset>
		<?php
	}

	/**
	 * The connections that came over from 3.x.
	 */
	private static function connections(): void {
		global $wpdb;
		$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT type, label FROM %i WHERE ref LIKE %s ORDER BY type', Schema::table( 'connections' ), 'legacy:%' ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a short list for display.
		if ( array() === $rows ) {
			echo '<p class="ffx-setup__hint">' . esc_html__( 'Funnelforms 3 had no connections to other services. E-mails to you and your visitors are part of each form and come along.', 'funnelforms-free' ) . '</p>';
			return;
		}
		echo '<ul class="ffx-setup__chips">';
		foreach ( $rows as $row ) {
			echo '<li>' . Ui::icon( 'link' ) . esc_html( '' !== (string) $row['label'] ? (string) $row['label'] : (string) $row['type'] ) . '</li>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
		}
		echo '</ul>';
		echo '<p class="ffx-setup__hint">' . esc_html__( 'All connections and e-mails come along and stay active, with their keys encrypted. You can change them in each form.', 'funnelforms-free' ) . '</p>';
	}

	/**
	 * Update: compare old and new.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_update_preview( array $state ): void {
		$chosen = SetupFlow::chosen( $state['choices'] );
		$forms  = array_values( array_filter( SetupFlow::imported_forms(), static fn( array $f ): bool => in_array( $f['id'], $chosen, true ) ) );
		self::head( __( 'Compare old and new', 'funnelforms-free' ), __( 'Each form as your visitors see it today and on Funnelforms 5. Untick a form to keep it on Funnelforms 3 for now.', 'funnelforms-free' ) );
		if ( array() === $forms ) {
			echo '<div class="ffx-setup__card ffx-setup__empty">' . esc_html__( 'No form moves now, so there is nothing to compare. Continue to finish the setup.', 'funnelforms-free' ) . '</div>';
			return;
		}
		$rejected = array_map( 'intval', (array) ( $state['choices']['rejected'] ?? array() ) );
		foreach ( $forms as $i => $form ) {
			?>
			<details class="ffx-setup__compare" data-ffx-compare <?php echo 0 === $i ? 'open' : ''; ?>>
				<summary>
					<label class="ffx-setup__approve">
						<input type="checkbox" name="approved[]" value="<?php echo esc_attr( (string) $form['id'] ); ?>" <?php checked( ! in_array( $form['id'], $rejected, true ) ); ?>>
						<span class="screen-reader-text"><?php esc_html_e( 'Move this form', 'funnelforms-free' ); ?></span>
					</label>
					<span class="ffx-setup__form-title"><?php echo esc_html( '' !== $form['title'] ? $form['title'] : __( '(no title)', 'funnelforms-free' ) ); ?></span>
					<?php echo self::check_badge( $form ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in Ui. ?>
				</summary>
				<div class="ffx-setup__devices" role="group" aria-label="<?php esc_attr_e( 'Device', 'funnelforms-free' ); ?>">
					<button type="button" class="is-active" data-device="desktop"><?php echo Ui::icon( 'monitor' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Desktop', 'funnelforms-free' ); ?></span></button>
					<button type="button" data-device="phone"><?php echo Ui::icon( 'phone' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Phone', 'funnelforms-free' ); ?></span></button>
				</div>
				<div class="ffx-setup__frames">
					<?php if ( MigrationPage::way_back() ) : ?>
						<figure>
							<figcaption><?php esc_html_e( 'Today (Funnelforms 3)', 'funnelforms-free' ); ?></figcaption>
							<div class="ffx-setup__frame"><iframe title="<?php esc_attr_e( 'Today (Funnelforms 3)', 'funnelforms-free' ); ?>" data-src="<?php echo esc_url( LegacyPreview::url( (int) $form['legacy_id'] ) ); ?>" loading="lazy"></iframe></div>
						</figure>
					<?php endif; ?>
					<figure>
						<figcaption><?php esc_html_e( 'New (Funnelforms 5)', 'funnelforms-free' ); ?></figcaption>
						<div class="ffx-setup__frame"><iframe title="<?php esc_attr_e( 'New (Funnelforms 5)', 'funnelforms-free' ); ?>" data-form="<?php echo esc_attr( (string) $form['id'] ); ?>" data-look="<?php echo esc_attr( (string) $state['choices']['look'] ); ?>" sandbox="allow-scripts allow-forms"></iframe></div>
					</figure>
				</div>
			</details>
			<?php
		}
		echo '<p class="ffx-setup__hint">' . esc_html__( 'The new preview is a test run: what you enter is not saved and no e-mail is sent.', 'funnelforms-free' ) . '</p>';
	}

	/**
	 * Update: summary and go live.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_update_live( array $state ): void {
		$choices  = $state['choices'];
		$rejected = array_map( 'intval', (array) ( $choices['rejected'] ?? array() ) );
		$moving   = count( array_diff( SetupFlow::chosen( $choices ), $rejected ) );
		$all      = count( SetupFlow::imported_forms() );
		self::head( __( 'Ready to go live', 'funnelforms-free' ), __( 'One click, and the chosen forms run on Funnelforms 5. Your pages and shortcodes stay as they are.', 'funnelforms-free' ) );
		?>
		<div class="ffx-setup__card">
			<ul class="ffx-facts">
				<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?>
					<?php
					/* translators: %d: number of forms. */
					echo esc_html( sprintf( _n( '%d form moves to Funnelforms 5', '%d forms move to Funnelforms 5', $moving, 'funnelforms-free' ), $moving ) );
					?>
				</li>
				<?php if ( $all - $moving > 0 ) : ?>
					<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?>
						<?php
						$stay = $all - $moving;
						/* translators: %d: number of forms. */
						echo esc_html( sprintf( _n( '%d form stays on Funnelforms 3 for now', '%d forms stay on Funnelforms 3 for now', $stay, 'funnelforms-free' ), $stay ) );
						?>
					</li>
				<?php endif; ?>
				<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><?php echo esc_html( 'new' === $choices['look'] ? __( 'Look: the new Funnelforms design', 'funnelforms-free' ) : __( 'Look: as before', 'funnelforms-free' ) ); ?></li>
				<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><?php esc_html_e( 'Entries, connections and e-mails come along', 'funnelforms-free' ); ?></li>
				<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><?php echo esc_html( self::retention_fact( (int) $choices['retention'] ) ); ?></li>
				<?php if ( ! empty( $choices['diagnostics'] ) ) : ?>
					<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><?php esc_html_e( 'Diagnostic data go to Funnelforms once a week', 'funnelforms-free' ); ?></li>
				<?php endif; ?>
				<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><?php esc_html_e( 'The old interface is hidden once no form needs it', 'funnelforms-free' ); ?></li>
			</ul>
		</div>
		<?php if ( MigrationPage::way_back() ) : ?>
			<div class="ffx-setup__promise">
				<span class="ffx-setup__icon is-success"><?php echo Ui::icon( 'undo' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
				<div>
					<h3><?php esc_html_e( 'You can always go back', 'funnelforms-free' ); ?></h3>
					<p><?php esc_html_e( 'Under Funnelforms → Migration → Way back, one click puts all forms back on Funnelforms 3, with the old menu, or just one form. Nothing is deleted, and the restore point stays there too.', 'funnelforms-free' ); ?></p>
				</div>
			</div>
		<?php endif; ?>
		<?php
	}

	/**
	 * Update: done.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_update_done( array $state ): void {
		$result   = $state['result'] + array(
			'switched'   => 0,
			'stayed'     => array(),
			'old_hidden' => false,
		);
		$switched = (int) $result['switched'];
		echo '<div class="ffx-setup__done-mark">' . Ui::icon( 'check' ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
		self::head(
			__( 'Welcome to Funnelforms 5', 'funnelforms-free' ),
			/* translators: %d: number of forms. */
			sprintf( _n( '%d form runs on Funnelforms 5 now. Your pages and shortcodes stay as they were.', '%d forms run on Funnelforms 5 now. Your pages and shortcodes stay as they were.', $switched, 'funnelforms-free' ), $switched )
		);
		?>
		<div class="ffx-setup__card">
			<ul class="ffx-facts">
				<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><?php esc_html_e( 'The restore point of Funnelforms 3 is kept.', 'funnelforms-free' ); ?></li>
				<?php if ( ! empty( $result['old_hidden'] ) ) : ?>
					<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><?php esc_html_e( 'The pages of Funnelforms 3 are hidden; their data stays.', 'funnelforms-free' ); ?></li>
				<?php endif; ?>
				<?php if ( MigrationPage::way_back() ) : ?>
					<li><?php echo Ui::icon( 'check' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?>
						<span><?php esc_html_e( 'Something not right? One click takes you back to Funnelforms 3:', 'funnelforms-free' ); ?> <a href="<?php echo esc_url( SafetySection::url() ); ?>"><?php esc_html_e( 'Migration → Way back', 'funnelforms-free' ); ?></a></span>
					</li>
				<?php endif; ?>
			</ul>
		</div>
		<?php
		$left = array_values( array_filter( SetupFlow::imported_forms(), static fn( array $f ): bool => FormRepository::RENDERER_V5 !== $f['renderer'] ) );
		if ( array() !== $left ) {
			echo '<div class="ffx-setup__card"><h3>' . esc_html__( 'Still on Funnelforms 3 for now', 'funnelforms-free' ) . '</h3><ul class="ffx-setup__forms">';
			foreach ( $left as $form ) {
				echo '<li class="is-' . esc_attr( (string) $form['state'] ) . '"><span class="ffx-setup__form-title">' . esc_html( '' !== $form['title'] ? $form['title'] : __( '(no title)', 'funnelforms-free' ) ) . '</span>' . self::check_badge( $form ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in Ui.
				self::reasons( $form );
				echo '</li>';
			}
			echo '</ul></div>';
		}
		echo '<h2 class="ffx-setup__subtitle">' . esc_html__( 'Next steps', 'funnelforms-free' ) . '</h2><div class="ffx-setup__tiles">';
		self::link_tile( 'layers', __( 'Open the form builder', 'funnelforms-free' ), __( 'Change texts, logic and design of your forms.', 'funnelforms-free' ), admin_url( 'admin.php?page=' . BuilderPage::SLUG ) );
		self::link_tile( 'inbox', __( 'See your entries', 'funnelforms-free' ), __( 'All leads of Funnelforms 3 and 5 in one list.', 'funnelforms-free' ), admin_url( 'admin.php?page=' . EntriesPage::SLUG ) );
		$account = Edition::pro( AccountPage::class );
		if ( null !== $account && ! in_array( self::license()['status'], array( 'active', 'grace' ), true ) ) {
			self::link_tile( 'user', __( 'Connect your account', 'funnelforms-free' ), __( 'For updates, support and the Pro services.', 'funnelforms-free' ), $account::url() );
		} else {
			self::link_tile( 'history', __( 'Migration', 'funnelforms-free' ), ( MigrationPage::way_back() ? __( 'Every form with its check, your leads and appointments, and the way back.', 'funnelforms-free' ) : __( 'Every form with its check and your leads.', 'funnelforms-free' ) ), MigrationPage::url() );
		}
		echo '</div>';
	}

	/**
	 * State of the connection to the Funnelforms account; status "none" in Funnelforms Free.
	 *
	 * @return array<string,mixed>
	 */
	private static function license(): array {
		$license = Edition::pro( License::class );
		return null === $license ? array(
			'status' => 'none',
			'claims' => array(),
		) : $license::state();
	}

	/**
	 * A tile that is a link.
	 *
	 * @param string $icon  Icon.
	 * @param string $title Title.
	 * @param string $text  Text.
	 * @param string $url   Address.
	 */
	private static function link_tile( string $icon, string $title, string $text, string $url ): void {
		?>
		<a class="ffx-setup__tile is-link" href="<?php echo esc_url( $url ); ?>">
			<span class="ffx-setup__icon"><?php echo Ui::icon( $icon ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<h3><?php echo esc_html( $title ); ?> <?php echo Ui::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></h3>
			<p><?php echo esc_html( $text ); ?></p>
		</a>
		<?php
	}

	/*
	 * Steps of a new installation.
	 */

	/**
	 * New: welcome.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_welcome( array $state ): void {
		unset( $state );
		$user = wp_get_current_user();
		$name = '' !== $user->first_name ? $user->first_name : $user->display_name;
		/* translators: %s: first name. */
		self::head( sprintf( __( 'Welcome to Funnelforms, %s', 'funnelforms-free' ), $name ), __( 'In about five minutes your first form is live: made from a template, in the colours of your brand, on a page of your website.', 'funnelforms-free' ) );
		?>
		<ol class="ffx-setup__timeline">
			<li><span>1</span><div><strong><?php esc_html_e( 'Learn the basics', 'funnelforms-free' ); ?></strong><p><?php esc_html_e( 'How a form is built, put on your website and answered.', 'funnelforms-free' ); ?></p></div></li>
			<li><span>2</span><div><strong><?php esc_html_e( 'Pick a template', 'funnelforms-free' ); ?></strong><p><?php esc_html_e( 'Ready-made forms for requests, consultations and applications.', 'funnelforms-free' ); ?></p></div></li>
			<li><span>3</span><div><strong><?php esc_html_e( 'Add your brand', 'funnelforms-free' ); ?></strong><p><?php esc_html_e( 'Your colour and font, read from your website if you like.', 'funnelforms-free' ); ?></p></div></li>
			<li><span>4</span><div><strong><?php esc_html_e( 'Go live', 'funnelforms-free' ); ?></strong><p><?php esc_html_e( 'On a new page or wherever you paste the shortcode.', 'funnelforms-free' ); ?></p></div></li>
		</ol>
		<?php
	}

	/**
	 * New: how Funnelforms works.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_intro( array $state ): void {
		unset( $state );
		self::head( __( 'How Funnelforms works', 'funnelforms-free' ), __( 'Three things to know. Everything else you find out as you go.', 'funnelforms-free' ) );
		echo '<div class="ffx-setup__tiles is-steps">';
		self::tile( 'layers', __( 'Build', 'funnelforms-free' ), __( 'A form is a path of steps. Each step asks one question with answers as tiles, fields or sliders. Logic decides which step comes next, so every visitor gets the questions that fit.', 'funnelforms-free' ), '1', 'build' );
		self::tile( 'globe', __( 'Embed', 'funnelforms-free' ), __( 'Put the form on any page with its shortcode, the block or the Elementor widget, as a popup, or on a page of its own. It adapts to phones by itself.', 'funnelforms-free' ), '2', 'embed' );
		self::tile( 'inbox', __( 'Handle entries', 'funnelforms-free' ), __( 'Each entry lands in Entries and in your inbox. Statistics show how many visitors start, finish or leave, step by step.', 'funnelforms-free' ), '3', 'answer' );
		echo '</div>';
	}

	/**
	 * New: account.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_account( array $state ): void {
		unset( $state );
		$license = self::license();
		$active  = in_array( $license['status'], array( 'active', 'grace' ), true );
		self::head( __( 'Connect your Funnelforms account', 'funnelforms-free' ), __( 'The connection brings updates, support from our team and the Pro services. Your forms work without it too.', 'funnelforms-free' ) );
		?>
		<div class="ffx-setup__card ffx-setup__account<?php echo $active ? ' is-active' : ''; ?>">
			<span class="ffx-setup__icon<?php echo $active ? ' is-success' : ''; ?>"><?php echo Ui::icon( $active ? 'check' : 'user' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<div>
				<?php if ( $active ) : ?>
					<h3><?php esc_html_e( 'This website is connected', 'funnelforms-free' ); ?></h3>
					<p><?php echo esc_html( (string) ( $license['claims']['plan'] ?? '' ) ); ?></p>
				<?php else : ?>
					<h3><?php esc_html_e( 'Sign in once, done', 'funnelforms-free' ); ?></h3>
					<p><?php esc_html_e( 'You sign in at Funnelforms and come straight back here. No key to copy.', 'funnelforms-free' ); ?></p>
					<button type="submit" class="ffx-btn ffx-btn--primary" name="do" value="connect" formnovalidate><?php echo Ui::icon( 'link' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Connect with Funnelforms', 'funnelforms-free' ); ?></span></button>
				<?php endif; ?>
			</div>
		</div>
		<?php
	}

	/**
	 * New: goal and template.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_goal( array $state ): void {
		$choices = $state['choices'];
		// Funnelforms Free lists the templates of Funnelforms Pro only in the gallery, locked.
		$templates = array_filter( FormTemplates::all(), static fn( array $template ): bool => ! $template['pro'] );
		$goal      = '' !== $choices['goal'] ? $choices['goal'] : 'quote';
		$goals     = array(
			'quote'        => array( 'form', __( 'Requests and quotes', 'funnelforms-free' ), __( 'Visitors describe what they need, you send a fitting offer.', 'funnelforms-free' ) ),
			'consultation' => array( 'calendar', __( 'Consultations', 'funnelforms-free' ), __( 'Qualify interested people and win appointments.', 'funnelforms-free' ) ),
			'application'  => array( 'user', __( 'Applications', 'funnelforms-free' ), __( 'Short applications instead of long cover letters.', 'funnelforms-free' ) ),
		);
		self::head( __( 'What is your first form for?', 'funnelforms-free' ), __( 'Pick a goal and a template. Every text can be changed later.', 'funnelforms-free' ) );
		?>
		<div class="ffx-setup__options-row is-three">
			<?php foreach ( $goals as $key => $item ) : ?>
				<?php self::option( 'goal', $key, $goal === $key, $item[1], $item[2], $item[0] ); ?>
			<?php endforeach; ?>
		</div>
		<p class="ffx-setup__label"><?php esc_html_e( 'Template', 'funnelforms-free' ); ?></p>
		<div class="ffx-setup__templates" data-ffx-templates>
			<?php foreach ( $templates as $template ) : ?>
				<label class="ffx-setup__template" data-goal="<?php echo esc_attr( $template['goal'] ); ?>">
					<input type="radio" name="template" value="<?php echo esc_attr( $template['id'] ); ?>" <?php checked( $choices['template'], $template['id'] ); ?> required>
					<strong><?php echo esc_html( $template['title'] ); ?></strong>
					<?php /* translators: %d: number of steps. */ ?>
					<small><?php echo esc_html( sprintf( _n( '%d step', '%d steps', $template['steps'], 'funnelforms-free' ), $template['steps'] ) ); ?></small>
					<span><?php echo esc_html( $template['firstQuestion'] ); ?></span>
				</label>
			<?php endforeach; ?>
		</div>
		<?php
	}

	/**
	 * New: brand.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_brand( array $state ): void {
		$choices = $state['choices'];
		$color   = (string) ( sanitize_hex_color( (string) $choices['color'] ) ?? '#6A30F5' );
		$fonts   = array(
			''           => __( 'Font of your website', 'funnelforms-free' ),
			'Inter'      => 'Inter',
			'Montserrat' => 'Montserrat',
			'Poppins'    => 'Poppins',
			'Lato'       => 'Lato',
			'Open Sans'  => 'Open Sans',
			'Roboto'     => 'Roboto',
		);
		self::head( __( 'Your brand', 'funnelforms-free' ), __( 'Your main colour and font. Funnelforms derives everything else from them.', 'funnelforms-free' ) );
		?>
		<div class="ffx-setup__brand-grid">
			<div class="ffx-setup__card">
				<label class="ffx-setup__label" for="ffx-setup-color"><?php esc_html_e( 'Main colour', 'funnelforms-free' ); ?></label>
				<div class="ffx-setup__color">
					<input type="color" id="ffx-setup-color" name="color" value="<?php echo esc_attr( $color ); ?>" data-ffx-color>
					<code data-ffx-color-code><?php echo esc_html( strtoupper( $color ) ); ?></code>
				</div>
				<div class="ffx-setup__swatches" data-ffx-swatches>
					<?php foreach ( array( '#6A30F5', '#2563EB', '#0F9D58', '#E8590C', '#D6336C', '#0F0B1E' ) as $swatch ) : ?>
						<button type="button" style="--swatch:<?php echo esc_attr( $swatch ); ?>" data-color="<?php echo esc_attr( $swatch ); ?>"><span class="screen-reader-text"><?php echo esc_html( $swatch ); ?></span></button>
					<?php endforeach; ?>
				</div>
				<?php if ( null !== Edition::pro( BrandingImport::class ) ) : ?>
				<button type="button" class="ffx-btn ffx-btn--sm" data-ffx-branding><?php echo Ui::icon( 'palette' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Use the colours of my website', 'funnelforms-free' ); ?></span></button>
				<p class="ffx-setup__hint" data-ffx-branding-note></p>
				<?php endif; ?>
				<label class="ffx-setup__label" for="ffx-setup-font"><?php esc_html_e( 'Font', 'funnelforms-free' ); ?></label>
				<select id="ffx-setup-font" name="font" data-ffx-font>
					<?php foreach ( $fonts as $value => $label ) : ?>
						<option value="<?php echo esc_attr( $value ); ?>" <?php selected( $choices['font'], $value ); ?>><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select>
			</div>
			<div class="ffx-setup__mock" style="--brand:<?php echo esc_attr( $color ); ?>" data-ffx-mock aria-hidden="true">
				<div class="ffx-setup__mock-bar"><span></span></div>
				<p class="ffx-setup__mock-q"><?php esc_html_e( 'What can we do for you?', 'funnelforms-free' ); ?></p>
				<div class="ffx-setup__mock-answers">
					<span class="is-selected"><?php esc_html_e( 'Get a quote', 'funnelforms-free' ); ?></span>
					<span><?php esc_html_e( 'Book a consultation', 'funnelforms-free' ); ?></span>
				</div>
				<span class="ffx-setup__mock-button"><?php esc_html_e( 'Next', 'funnelforms-free' ); ?></span>
			</div>
		</div>
		<?php
	}

	/**
	 * New: preview.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_preview( array $state ): void {
		self::head( __( 'Your form', 'funnelforms-free' ), __( 'Try it as your visitors will. What you enter here is not saved.', 'funnelforms-free' ) );
		?>
		<div class="ffx-setup__compare is-single" data-ffx-compare>
			<div class="ffx-setup__devices" role="group" aria-label="<?php esc_attr_e( 'Device', 'funnelforms-free' ); ?>">
				<button type="button" class="is-active" data-device="desktop"><?php echo Ui::icon( 'monitor' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Desktop', 'funnelforms-free' ); ?></span></button>
				<button type="button" data-device="phone"><?php echo Ui::icon( 'phone' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Phone', 'funnelforms-free' ); ?></span></button>
			</div>
			<div class="ffx-setup__frames">
				<figure>
					<div class="ffx-setup__frame is-tall"><iframe title="<?php esc_attr_e( 'Your form', 'funnelforms-free' ); ?>" data-form="<?php echo esc_attr( (string) $state['form_id'] ); ?>" data-look="" sandbox="allow-scripts allow-forms"></iframe></div>
				</figure>
			</div>
		</div>
		<?php
	}

	/**
	 * New: go live.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_live( array $state ): void {
		$form  = ( new FormRepository() )->by_id( $state['form_id'] );
		$title = null === $form ? '' : (string) $form['title'];
		self::head( __( 'Put your form on your website', 'funnelforms-free' ), __( 'Choose where it appears and who gets the entries.', 'funnelforms-free' ) );
		?>
		<fieldset class="ffx-setup__group">
			<legend><?php esc_html_e( 'Where should the form appear?', 'funnelforms-free' ); ?></legend>
			<div class="ffx-setup__options-row">
				<?php
				self::option( 'place', 'page', true, __( 'On a new page', 'funnelforms-free' ), __( 'Funnelforms creates and publishes the page for you.', 'funnelforms-free' ), 'globe' );
				self::option( 'place', 'code', false, __( 'I place it myself', 'funnelforms-free' ), __( 'You get the shortcode for any page, post or builder.', 'funnelforms-free' ), 'code' );
				?>
			</div>
			<div data-ffx-page-title>
				<label class="ffx-setup__label" for="ffx-setup-page"><?php esc_html_e( 'Title of the page', 'funnelforms-free' ); ?></label>
				<input type="text" id="ffx-setup-page" name="page_title" class="regular-text" value="<?php echo esc_attr( $title ); ?>" maxlength="120">
			</div>
		</fieldset>
		<?php self::retention_group( 'new', (int) $state['choices']['retention'] ); ?>
		<fieldset class="ffx-setup__group">
			<legend><?php esc_html_e( 'Who gets the entries?', 'funnelforms-free' ); ?></legend>
			<label class="ffx-setup__label" for="ffx-setup-email"><?php esc_html_e( 'E-mail address for notifications', 'funnelforms-free' ); ?></label>
			<input type="email" id="ffx-setup-email" name="email" class="regular-text" value="<?php echo esc_attr( (string) $state['choices']['email'] ); ?>" required>
			<p class="ffx-setup__hint"><?php esc_html_e( 'Every entry is also kept under Funnelforms → Entries.', 'funnelforms-free' ); ?></p>
		</fieldset>
		<?php
	}

	/**
	 * New: done.
	 *
	 * @param array<string,mixed> $state State.
	 */
	private static function step_new_done( array $state ): void {
		$result = $state['result'];
		echo '<div class="ffx-setup__done-mark">' . Ui::icon( 'check' ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
		self::head( __( 'Your form is live', 'funnelforms-free' ), __( 'Visitors can send it now. Each entry reaches your inbox and Funnelforms → Entries.', 'funnelforms-free' ) );
		?>
		<div class="ffx-setup__card ffx-setup__share">
			<?php if ( ! empty( $result['page_url'] ) ) : ?>
				<a class="ffx-btn ffx-btn--primary" href="<?php echo esc_url( (string) $result['page_url'] ); ?>" target="_blank" rel="noopener"><?php echo Ui::icon( 'external' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'View the page', 'funnelforms-free' ); ?></span></a>
			<?php endif; ?>
			<?php if ( ! empty( $result['shortcode'] ) ) : ?>
				<label class="ffx-setup__label" for="ffx-setup-code"><?php esc_html_e( 'Shortcode for other pages', 'funnelforms-free' ); ?></label>
				<div class="ffx-inline">
					<input type="text" id="ffx-setup-code" class="regular-text code" value="<?php echo esc_attr( (string) $result['shortcode'] ); ?>" readonly>
					<button type="button" class="ffx-btn ffx-btn--sm" data-ffx-copy="#ffx-setup-code"><?php echo Ui::icon( 'copy' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Copy', 'funnelforms-free' ); ?></span></button>
				</div>
			<?php endif; ?>
		</div>
		<h2 class="ffx-setup__subtitle"><?php esc_html_e( 'Next steps', 'funnelforms-free' ); ?></h2>
		<div class="ffx-setup__tiles">
			<?php
			self::link_tile( 'layers', __( 'Refine your form', 'funnelforms-free' ), __( 'Texts, steps, logic and design in the form builder.', 'funnelforms-free' ), add_query_arg( 'form', (string) $state['form_id'], admin_url( 'admin.php?page=' . BuilderPage::SLUG ) ) );
			self::link_tile( 'bell', __( 'Test an entry', 'funnelforms-free' ), __( 'Send the form once yourself and see what arrives.', 'funnelforms-free' ), ! empty( $result['page_url'] ) ? (string) $result['page_url'] : admin_url( 'admin.php?page=' . EntriesPage::SLUG ) );
			self::link_tile( 'chart', __( 'Watch your figures', 'funnelforms-free' ), __( 'Views, entries and completion rate on the overview.', 'funnelforms-free' ), admin_url( 'admin.php?page=' . Menu::SLUG ) );
			?>
		</div>
		<?php
	}
}
