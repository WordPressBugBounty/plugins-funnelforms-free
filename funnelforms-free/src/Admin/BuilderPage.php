<?php
/**
 * Admin page of the form builder (Funnelforms → Form builder).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\AiForms;
use Funnelforms\Application\Capabilities;
use Funnelforms\Application\FormTemplates;
use Funnelforms\Application\PrivacyMode;
use Funnelforms\Application\SiteLogo;
use Funnelforms\Application\SpamCheck;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\ExternalEmbed;
use Funnelforms\Frontend\Icons;
use Funnelforms\Frontend\TrackingCode;
use Funnelforms\Frontend\UiLocale;
use Funnelforms\Http\Captcha;

defined( 'ABSPATH' ) || exit;

/**
 * Prints the mount point of the builder app (packages/builder-ui, built into assets/builder)
 * and passes it the REST root, a nonce and the default texts of new fields. The page sits in
 * the Funnelforms 3 menu; without that menu it gets a menu of its own.
 */
final class BuilderPage {

	public const SLUG    = 'funnelforms-builder';
	private const HANDLE = 'funnelforms-builder';

	/**
	 * Hook suffix of the page, once it is registered.
	 *
	 * @var string|null
	 */
	private static ?string $hook = null;

	/**
	 * Registers the page.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ), 20 );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
		add_filter( 'admin_body_class', array( self::class, 'body_class' ) );
	}

	/**
	 * Adds the page below Funnelforms.
	 */
	public static function menu(): void {
		$title      = __( 'Forms', 'funnelforms-free' );
		$hook       = add_submenu_page( Menu::SLUG, $title, $title, Capabilities::EDIT_FORMS, self::SLUG, array( self::class, 'render' ), Menu::POSITIONS['forms'] );
		self::$hook = false === $hook ? null : $hook;
		// The list of forms renders the frame of the other pages; their styles and calm chrome apply.
		Ui::screen( $hook );
	}

	/**
	 * Line below the title of the list of forms.
	 */
	public static function lead(): string {
		return __( 'Build your forms, publish them and see how each one performs.', 'funnelforms-free' );
	}

	/**
	 * Whether the built app is there (missing in a checkout before `pnpm build`).
	 */
	public static function built(): bool {
		return is_readable( FUNNELFORMS_PLUGIN_DIR . '/assets/builder/builder.js' );
	}

	/**
	 * Loads the app on its page only.
	 *
	 * @param string $hook Hook suffix of the current admin page.
	 */
	public static function enqueue( string $hook ): void {
		if ( null === self::$hook || $hook !== self::$hook || ! self::built() ) {
			return;
		}
		if ( current_user_can( 'upload_files' ) ) {
			// Images for answers, contents and backgrounds come from the media library.
			wp_enqueue_media();
		}
		self::load_app( self::config() );
	}

	/**
	 * Loads the admin app (the builder, or another screen of it such as the entries) with its
	 * settings.
	 *
	 * @param array<string, mixed> $config What the app gets in window.funnelformsBuilder.
	 */
	public static function load_app( array $config ): void {
		$url = plugins_url( 'assets/builder/', FUNNELFORMS_PLUGIN_FILE );
		wp_enqueue_style( self::HANDLE, $url . 'builder.css', array(), FUNNELFORMS_ASSET_VERSION );
		wp_enqueue_script( self::HANDLE, $url . 'builder.js', array( 'react', 'react-dom', 'wp-i18n' ), FUNNELFORMS_ASSET_VERSION, true );
		wp_set_script_translations( self::HANDLE, 'funnelforms-free', FUNNELFORMS_PLUGIN_DIR . '/languages' );
		wp_add_inline_script( self::HANDLE, 'window.funnelformsBuilder = ' . wp_json_encode( $config ) . ';', 'before' );
	}

	/**
	 * What the app gets: where the API is, the nonce, and the texts of new fields in the site's
	 * language (forms are usually in it; the editor may use another one).
	 *
	 * @return array<string, mixed>
	 */
	public static function config(): array {
		$site = FormTemplates::site_language();
		return array(
			'root'       => esc_url_raw( rest_url() ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
			'siteLocale' => $site,
			'siteLabels' => UiLocale::run( $site, array( self::class, 'labels' ) ),
			'userLocale' => get_user_locale(),
			// The icon set for the icon choice, loaded when it opens.
			'icons'      => Icons::url(),
			// The pages that import forms of other form plugins and Funnelforms files, linked from the list of forms.
			'importUrl'  => ImportPage::url(),
			'importOwn'  => ImportPage::funnelforms_url(),
			// Funnelforms Free or Pro, and which field types and features are Pro (Edition).
			'edition'    => Edition::catalog(),
			// EU or global; the EU mode locks the consent setting of conversions (PrivacyMode).
			'privacy'    => PrivacyMode::current(),
			// The embed code for websites outside WordPress (Funnelforms Pro).
			'embed'      => self::embed(),
			// What protects every form, and the captcha a form can do without (settings.captcha).
			'spam'       => array(
				'captcha'     => '' === Captcha::site_provider() ? null : Captcha::NAMES[ Captcha::site_provider() ],
				'protection'  => SpamCheck::protection(),
				'settingsUrl' => current_user_can( Capabilities::MANAGE_SETTINGS ) ? SettingsPage::url( 'entries', 'ffx-captcha' ) : null,
			),
			// Whether the site runs the custom code of forms, and where an administrator allows it (TrackingCode).
			'code'       => array(
				'allowed'     => TrackingCode::allowed(),
				'settingsUrl' => current_user_can( 'manage_options' ) ? SettingsPage::url( 'general', 'ffx-tracking' ) : null,
			),
			// The AI form builder (Funnelforms Pro): whether the license allows it; null in Funnelforms Free.
			'ai'         => self::ai(),
			// The site's logo, to pick colours from it in the design (Application\SiteLogo).
			'logo'       => SiteLogo::url(),
			// The recipient new mails to the owner start with.
			'ownerEmail' => (string) get_option( 'admin_email' ),
			// Where tools are connected, linked from the actions of a form (Funnelforms Pro).
			'connectUrl' => self::integrations_url(),
			// What the user may change beyond the form itself (the server checks again).
			'rights'     => array(
				'entries'  => current_user_can( Capabilities::VIEW_ENTRIES ),
				'code'     => current_user_can( 'unfiltered_html' ),
				'settings' => current_user_can( Capabilities::MANAGE_SETTINGS ),
			),
		);
	}

	/**
	 * Funnelforms → Integrations for users who may connect tools; null in Funnelforms Free and
	 * for everyone else.
	 */
	private static function integrations_url(): ?string {
		$page = Edition::pro( IntegrationsPage::class );
		return null !== $page && current_user_can( Capabilities::MANAGE_SETTINGS ) ? $page::url() : null;
	}

	/**
	 * Whether the AI form builder can be used, and where the license is connected; null in
	 * Funnelforms Free.
	 *
	 * @return array{ready:bool,accountUrl:string}|null
	 */
	private static function ai(): ?array {
		$ai = Edition::pro( AiForms::class );
		return null === $ai ? null : $ai::builder_config();
	}

	/**
	 * Loader, frame address and allowed websites of the embed code for other websites; null in
	 * Funnelforms Free.
	 *
	 * @return array<string,mixed>|null
	 */
	private static function embed(): ?array {
		$embed = Edition::pro( ExternalEmbed::class );
		return null === $embed ? null : $embed::builder_config();
	}

	/**
	 * Default texts of new fields in the current language (the keys of Labels in builder-ui).
	 *
	 * @return array<string, string>
	 */
	public static function labels(): array {
		return array(
			'question'     => __( 'New question', 'funnelforms-free' ),
			/* translators: %d: number of the answer. */
			'option'       => __( 'Option %d', 'funnelforms-free' ),
			'contactTitle' => __( 'Your contact details', 'funnelforms-free' ),
			'send'         => __( 'Send', 'funnelforms-free' ),
			'thanks'       => __( 'Thank you! We will get back to you soon.', 'funnelforms-free' ),
			'name'         => __( 'Name', 'funnelforms-free' ),
			'email'        => __( 'E-mail address', 'funnelforms-free' ),
			'phone'        => __( 'Phone number', 'funnelforms-free' ),
			'text'         => __( 'Your message', 'funnelforms-free' ),
			'consent'      => __( 'I agree to the privacy policy.', 'funnelforms-free' ),
			'salutation'   => __( 'Salutation', 'funnelforms-free' ),
			'dropzone'     => __( 'Drop files here or click to upload.', 'funnelforms-free' ),
			'add'          => __( 'Add', 'funnelforms-free' ),
			/* translators: %d: number of the item in a repeat group. */
			'item'         => __( 'Item %d', 'funnelforms-free' ),
			'clear'        => __( 'Clear', 'funnelforms-free' ),
			'typeName'     => __( 'Type your name instead', 'funnelforms-free' ),
			'next'         => __( 'Next', 'funnelforms-free' ),
			'quizResult'   => __( 'Your result', 'funnelforms-free' ),
			/* translators: 1: points of the visitor, 2: most points of the quiz (both filled in after sending). */
			'quizPoints'   => __( 'You scored %1$s of %2$s points.', 'funnelforms-free' ),
			/* translators: 1: questions answered right, 2: questions of the quiz (both filled in after sending). */
			'quizRight'    => __( 'You answered %1$s of %2$s questions right.', 'funnelforms-free' ),
			'newsletter'   => __( 'Yes, send me news by e-mail.', 'funnelforms-free' ),
			'liveResult'   => __( 'Your estimate', 'funnelforms-free' ),
			'liveTotal'    => __( 'Total', 'funnelforms-free' ),
		);
	}

	/**
	 * Marks the page so the builder can use the whole height (no admin footer).
	 *
	 * @param string $classes Body classes.
	 */
	public static function body_class( string $classes ): string {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( null !== self::$hook && null !== $screen && self::$hook === $screen->id ) {
			$classes .= ' ffxb-screen';
		}
		return $classes;
	}

	/**
	 * Prints the mount point.
	 */
	public static function render(): void {
		echo '<style>.ffxb-screen #wpfooter{display:none}.ffxb-screen #wpbody-content{padding-bottom:0}</style>';
		if ( ! self::built() ) {
			Ui::open( array( 'title' => __( 'Forms', 'funnelforms-free' ) ) );
			echo '<div class="notice notice-error"><p>' . esc_html__( 'The form builder is missing from this copy of the plugin. Install the plugin from its ZIP file.', 'funnelforms-free' ) . '</p></div>';
			Ui::close();
			return;
		}
		echo '<noscript><div class="notice notice-error"><p>' . esc_html__( 'The form builder needs JavaScript.', 'funnelforms-free' ) . '</p></div></noscript>';
		echo '<div id="funnelforms-builder">';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- which screen to show first, nothing changes.
		if ( empty( $_GET['form'] ) ) {
			Ui::placeholder( __( 'Forms', 'funnelforms-free' ), self::lead() );
		}
		echo '</div>';
	}
}
