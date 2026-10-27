<?php
/**
 * Site settings of Funnelforms (Funnelforms → Settings).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;
use Funnelforms\Application\PrivacyMode;
use Funnelforms\Application\Retention;
use Funnelforms\Application\SpamCheck;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\TrackingCode;
use Funnelforms\Http\Captcha;
use Funnelforms\Integrations\Akismet;

defined( 'ABSPATH' ) || exit;

/**
 * Everything that applies to the whole website, in tabs: general, e-mail, entries and spam,
 * interfaces, rights, and backup and the way back to Funnelforms 3. Connections to CRM, newsletter
 * and other services are on the integrations page (Funnelforms → Integrations). The option groups keep the
 * names they had on the migration page, so saved values and the rights per option group stay as
 * they are.
 */
final class SettingsPage {

	public const SLUG = 'funnelforms-settings';

	/** Prefix of the option groups (the page's former slug). */
	public const GROUP = 'funnelforms-migration';

	/** Option groups (suffixes of GROUP) that users who manage the settings may save. */
	public const MANAGED_GROUPS = array( '', '_privacy', '_retention', '_embed', '_spam', '_spamrules' );

	private const CAPTCHA = 'funnelforms_captcha';

	/**
	 * Registers the page, its handlers and the sections it shows.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ), 30 );
		add_action( 'admin_post_' . self::CAPTCHA, array( self::class, 'handle_captcha' ) );
		MailDiagnostics::register();
		MailServerSection::register();
		TelemetrySection::register();
		RoleRights::register();
		if ( MigrationPage::way_back() ) {
			SafetySection::register();
		}
		$pro = Edition::pro( ProSettings::class );
		if ( null !== $pro ) {
			$pro::register();
		}
		add_action( 'admin_init', array( self::class, 'settings' ) );
		// Tracking code (option group _tracking) stays with administrators.
		foreach ( self::MANAGED_GROUPS as $group ) {
			add_filter( 'option_page_capability_' . self::GROUP . $group, static fn(): string => Capabilities::MANAGE_SETTINGS );
		}
	}

	/**
	 * Adds the page below Funnelforms.
	 */
	public static function menu(): void {
		$title = __( 'Settings', 'funnelforms-free' );
		$hook  = add_submenu_page( Menu::SLUG, $title, $title, Capabilities::MANAGE_SETTINGS, self::SLUG, array( self::class, 'render' ), Menu::POSITIONS['settings'] );
		Ui::screen( $hook );
	}

	/**
	 * Address of the page, on a tab.
	 *
	 * @param string $tab  Tab key.
	 * @param string $hash Anchor without #.
	 */
	public static function url( string $tab = 'general', string $hash = '' ): string {
		return admin_url( 'admin.php?page=' . self::SLUG . ( 'general' === $tab ? '' : '&tab=' . $tab ) ) . ( '' === $hash ? '' : '#' . $hash );
	}

	/**
	 * The tabs.
	 *
	 * @return array<string,array{label:string,icon:string}>
	 */
	public static function tabs(): array {
		$tabs = array(
			'general' => array(
				'label' => __( 'General', 'funnelforms-free' ),
				'icon'  => 'settings',
			),
			'mail'    => array(
				'label' => __( 'E-mail', 'funnelforms-free' ),
				'icon'  => 'mail',
			),
			'entries' => array(
				'label' => __( 'Entries and spam', 'funnelforms-free' ),
				'icon'  => 'shield',
			),
		);
		$pro  = Edition::pro( ProSettings::class );
		if ( null !== $pro ) {
			// Webhooks, access tokens and embedding come after entries and spam.
			$tabs += $pro::tabs();
		}
		// Rights per role change what other users may do: administrators only, as RoleRights saves them.
		if ( current_user_can( 'manage_options' ) ) {
			$tabs['rights'] = array(
				'label' => __( 'Rights', 'funnelforms-free' ),
				'icon'  => 'key',
			);
		}
		// Restore points hold every lead of 3.x: administrators only. Free has no way back to 3.x.
		if ( MigrationPage::way_back() && current_user_can( 'manage_options' ) ) {
			$tabs['safety'] = array(
				'label' => __( 'Backup and way back', 'funnelforms-free' ),
				'icon'  => 'history',
			);
		}
		return $tabs;
	}

	/**
	 * Registers the site settings.
	 */
	public static function settings(): void {
		register_setting(
			self::GROUP . '_tracking',
			TrackingCode::OPTION,
			array(
				'type'              => 'string',
				'sanitize_callback' => array( TrackingCode::class, 'sanitize' ),
				'default'           => '0',
			)
		);
		register_setting(
			self::GROUP . '_privacy',
			PrivacyMode::OPTION,
			array(
				'type'              => 'string',
				'sanitize_callback' => array( PrivacyMode::class, 'save' ),
				'default'           => PrivacyMode::EU,
			)
		);
		register_setting(
			self::GROUP . '_retention',
			Retention::OPTION,
			array(
				'type'              => 'integer',
				'sanitize_callback' => array( Retention::class, 'sanitize' ),
				'default'           => 0,
			)
		);
		register_setting(
			self::GROUP . '_spam',
			SpamCheck::OPTION,
			array(
				'type'              => 'object',
				'sanitize_callback' => array( SpamCheck::class, 'sanitize' ),
				'default'           => array(),
			)
		);
		$pro = Edition::pro( ProSettings::class );
		if ( null !== $pro ) {
			$pro::settings();
		}
	}

	/**
	 * Saves the site-wide captcha; "Save and test keys" checks them with the provider afterwards.
	 */
	public static function handle_captcha(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::CAPTCHA );
		$field    = static fn( string $key ): string => isset( $_POST[ $key ] ) ? trim( sanitize_text_field( wp_unslash( $_POST[ $key ] ) ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$provider = $field( 'provider' );
		$site_key = $field( 'site_key' );
		if ( '' !== $provider && '' === $site_key ) {
			$provider = '';
		}
		Captcha::save_site( $provider, $site_key, $field( 'secret' ), '' === $field( 'threshold' ) ? null : Captcha::threshold_value( $field( 'threshold' ) ) );
		$args = array( 'saved' => 'captcha' );
		$site = Captcha::site();
		if ( '' !== $field( 'test' ) && '' !== $provider ) {
			$args['test'] = Captcha::test_keys( $provider, $site_key, (string) ( $site['secret']['secret'] ?? '' ) );
		}
		wp_safe_redirect( add_query_arg( $args, self::url( 'entries', 'ffx-captcha' ) ) );
		exit;
	}

	/**
	 * Renders the page.
	 */
	public static function render(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			return;
		}
		$pro   = Edition::pro( ProSettings::class );
		$tabs  = self::tabs();
		$tab   = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'general'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		$tab   = isset( $tabs[ $tab ] ) ? $tab : 'general';
		$saved = isset( $_GET['saved'] ) || isset( $_GET['settings-updated'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		Ui::open(
			array(
				'title' => __( 'Settings', 'funnelforms-free' ),
				'lead'  => __( 'What applies to every form on this website.', 'funnelforms-free' ),
			)
		);
		Ui::tabs( $tabs, $tab, admin_url( 'admin.php?page=' . self::SLUG ) );
		// A setting that refused the value says why (the unrestricted privacy mode without its confirmation).
		$refused = $saved ? get_settings_errors( PrivacyMode::OPTION ) : array();
		foreach ( $refused as $error ) {
			echo '<div class="notice notice-error"><p>' . esc_html( $error['message'] ) . '</p></div>';
		}
		if ( $saved && array() === $refused ) {
			echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'Saved.', 'funnelforms-free' ) . '</p></div>';
		}
		echo '<div class="ffx-stack">';
		switch ( $tab ) {
			case 'entries':
				self::render_captcha();
				self::render_spam();
				if ( null !== $pro ) {
					$pro::render_spam_rules();
				}
				self::render_retention();
				break;
			case 'mail':
				MailServerSection::render();
				echo '<div class="ffx-card">';
				MailDiagnostics::render();
				echo '</div>';
				break;
			case 'interfaces':
				if ( null !== $pro ) {
					$pro::render();
				}
				break;
			case 'rights':
				echo '<div class="ffx-card">';
				RoleRights::render();
				echo '</div>';
				break;
			case 'safety':
				SafetySection::render();
				break;
			default:
				self::render_privacy();
				if ( null !== $pro ) {
					$pro::render_maps();
				}
				self::render_tracking();
				TelemetrySection::render();
		}
		echo '</div>';
		self::save_bar();
		Ui::close();
	}

	/**
	 * The save button of a section, on its own line at the end of the section. Once a field of its
	 * form changes, the button stands out and a bar at the bottom of the window offers it too
	 * (assets/admin/settings.js).
	 *
	 * @param string $label Label of the button; empty is "Save".
	 */
	public static function save_row( string $label = '' ): void {
		echo '<div class="ffx-card__save">';
		submit_button( '' === $label ? __( 'Save', 'funnelforms-free' ) : $label, 'secondary', 'submit', false );
		echo '</div>';
	}

	/**
	 * The bar with the save button of a changed section (assets/admin/settings.js); without the
	 * script each section keeps its own button.
	 */
	private static function save_bar(): void {
		wp_enqueue_script( 'funnelforms-settings', plugins_url( 'assets/admin/settings.js', FUNNELFORMS_PLUGIN_FILE ), array(), FUNNELFORMS_ASSET_VERSION, true );
		wp_localize_script(
			'funnelforms-settings',
			'funnelformsSettings',
			array(
				/* translators: %s: name of a section of the settings, such as "Privacy mode". */
				'changed' => __( 'Unsaved changes in "%s"', 'funnelforms-free' ),
				/* translators: %s: names of the other sections with changes. */
				'others'  => __( 'Each section is saved on its own. Your changes in %s will be lost. Save anyway?', 'funnelforms-free' ),
				'save'    => __( 'Save', 'funnelforms-free' ),
				'undo'    => __( 'Discard', 'funnelforms-free' ),
			)
		);
	}

	/**
	 * Opens a card with its heading and description.
	 *
	 * @param string $title       Heading.
	 * @param string $description Text below the heading.
	 * @param string $id          Anchor.
	 */
	public static function card( string $title, string $description, string $id = '' ): void {
		?>
		<section class="ffx-card"<?php echo '' === $id ? '' : ' id="' . esc_attr( $id ) . '"'; ?>>
			<div class="ffx-card__head">
				<div>
					<h2><?php echo esc_html( $title ); ?></h2>
					<p><?php echo esc_html( $description ); ?></p>
				</div>
			</div>
		<?php
	}

	/**
	 * EU (consent first), global (opt-out) or unrestricted privacy mode.
	 */
	private static function render_privacy(): void {
		$mode     = PrivacyMode::current();
		$may_open = PrivacyMode::open() || current_user_can( 'manage_options' );
		$modes    = array(
			PrivacyMode::EU     => array( __( 'EU (GDPR), recommended', 'funnelforms-free' ), __( 'Tracking, identifiers and services of other providers only with the visitor\'s consent.', 'funnelforms-free' ) ),
			PrivacyMode::GLOBAL => array( __( 'Global (opt-out)', 'funnelforms-free' ), __( 'Without a consent tool, consent counts as given for tracking code, Google Maps and captchas. Conversions to Meta, TikTok and GA4 still need a yes in the cookie banner. A refusal and Global Privacy Control are respected. Only for websites without visitors from the EU.', 'funnelforms-free' ) ),
			PrivacyMode::OPEN   => array( __( 'Unrestricted (at your own risk)', 'funnelforms-free' ), __( 'Funnelforms loads tracking codes, sends conversions to Meta, TikTok, Google Analytics and Google Ads, loads maps and captchas without consent and stores full IP addresses, for every visitor.', 'funnelforms-free' ) ),
		);
		self::card( __( 'Privacy mode', 'funnelforms-free' ), __( 'How every form handles consent for conversions, tracking code, Google Maps and captchas. Consent comes from your cookie banner through the WP Consent API.', 'funnelforms-free' ), 'ffx-privacy' );
		?>
			<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
				<?php settings_fields( self::GROUP . '_privacy' ); ?>
				<fieldset>
					<legend class="screen-reader-text"><?php esc_html_e( 'Privacy mode', 'funnelforms-free' ); ?></legend>
					<?php foreach ( $modes as $value => list( $label, $hint ) ) : ?>
						<label class="ffx-option<?php echo PrivacyMode::OPEN === $value ? ' ffx-option--risk' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( PrivacyMode::OPTION ); ?>" value="<?php echo esc_attr( $value ); ?>" <?php checked( $mode, $value ); ?> <?php disabled( PrivacyMode::OPEN === $value && ! $may_open ); ?>>
							<span><strong><?php echo esc_html( $label ); ?></strong><small><?php echo esc_html( $hint ); ?></small></span>
						</label>
					<?php endforeach; ?>
					<div class="ffx-risk-note">
						<p><strong><?php esc_html_e( 'Your own liability', 'funnelforms-free' ); ?></strong> <?php esc_html_e( 'In the EU, the EEA, Switzerland and the UK the unrestricted mode is usually not permitted because consent is required. As the website operator you are responsible for making sure this setting is lawful for your visitors (Terms § 7). Funnelforms accepts no liability for it.', 'funnelforms-free' ); ?></p>
						<p><?php esc_html_e( 'In this mode Funnelforms also ignores a no in the cookie banner and Global Privacy Control. If your website offers visitors a way to decline, that choice is therefore misleading; this is not permitted in the EU, in California and in other US states.', 'funnelforms-free' ); ?></p>
						<?php if ( PrivacyMode::open() ) : ?>
							<p><?php echo esc_html( self::open_confirmation() ); ?></p>
						<?php elseif ( ! $may_open ) : ?>
							<p><?php esc_html_e( 'Only an administrator can switch on the unrestricted mode.', 'funnelforms-free' ); ?></p>
						<?php else : ?>
							<label class="ffx-check">
								<input type="checkbox" name="<?php echo esc_attr( PrivacyMode::CONFIRM ); ?>" value="1">
								<span><?php esc_html_e( 'I have checked that this setting is lawful for my website and take responsibility for it.', 'funnelforms-free' ); ?></span>
							</label>
						<?php endif; ?>
					</div>
				</fieldset>
				<?php self::save_row(); ?>
			</form>
		</section>
		<?php
	}

	/**
	 * Who confirmed the unrestricted mode and when, as a line for the settings page.
	 */
	private static function open_confirmation(): string {
		$confirmed = PrivacyMode::confirmed();
		if ( null === $confirmed ) {
			return __( 'The unrestricted mode is on.', 'funnelforms-free' );
		}
		$user = get_userdata( $confirmed['user'] );
		$when = wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), (int) strtotime( $confirmed['at'] . ' UTC' ) );
		/* translators: 1: user name, 2: date and time. */
		return sprintf( __( 'The unrestricted mode is on, confirmed by %1$s on %2$s.', 'funnelforms-free' ), $user ? $user->display_name : __( 'a deleted user', 'funnelforms-free' ), (string) $when );
	}

	/**
	 * Tracking code and scripts in content.
	 */
	private static function render_tracking(): void {
		self::card( __( 'Tracking code', 'funnelforms-free' ), __( 'Custom JavaScript on the contact step and after sending, such as conversion pixels, and the scripts in content steps run in visitors\' browsers only if you allow it here. Forms from Funnelforms 3 with such code stay on Funnelforms 3 until then. Only administrators who may publish unfiltered HTML can change this.', 'funnelforms-free' ), 'ffx-tracking' );
		?>
			<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
				<?php settings_fields( self::GROUP . '_tracking' ); ?>
				<label class="ffx-toggle">
					<input type="checkbox" name="<?php echo esc_attr( TrackingCode::OPTION ); ?>" value="1" <?php checked( TrackingCode::allowed() ); ?> <?php disabled( ! current_user_can( 'manage_options' ) || ! current_user_can( 'unfiltered_html' ) ); ?>>
					<span class="ffx-toggle__text"><?php esc_html_e( 'Run the tracking code and the scripts in the content of my forms', 'funnelforms-free' ); ?></span>
				</label>
				<?php self::save_row(); ?>
			</form>
		</section>
		<?php
	}

	/**
	 * Days after which entries are deleted.
	 */
	private static function render_retention(): void {
		self::card( __( 'Deleting entries', 'funnelforms-free' ), __( 'Entries older than this are deleted every day, with their uploaded files. 0 keeps entries. Until you save a value here, the setting "Automatically delete leads" of Funnelforms 3 applies.', 'funnelforms-free' ) );
		?>
			<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
				<?php settings_fields( self::GROUP . '_retention' ); ?>
				<label class="ffx-field__label" for="ffx-retention"><?php esc_html_e( 'Delete entries after (days)', 'funnelforms-free' ); ?></label>
				<input type="number" min="0" max="36500" step="1" class="small-text" id="ffx-retention" name="<?php echo esc_attr( Retention::OPTION ); ?>" value="<?php echo esc_attr( (string) Retention::site_days() ); ?>">
				<?php self::save_row(); ?>
			</form>
		</section>
		<?php
	}

	/**
	 * What protects the forms now, and the captcha service for every form.
	 */
	private static function render_captcha(): void {
		$captcha  = Captcha::site();
		$current  = (string) ( $captcha['type'] ?? '' );
		$test     = isset( $_GET['test'] ) ? sanitize_key( wp_unslash( $_GET['test'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		$services = array(
			''           => array( __( 'None', 'funnelforms-free' ), __( 'Only the checks that are always on.', 'funnelforms-free' ), '' ),
			'turnstile'  => array( Captcha::NAMES['turnstile'], __( 'Free and mostly invisible: visitors rarely solve a puzzle. Recommended.', 'funnelforms-free' ), 'https://dash.cloudflare.com/?to=/:account/turnstile' ), // phpcs:ignore PluginCheck.CodeAnalysis.Offloading.OffloadedContent -- link to the provider's dashboard, nothing is loaded from it.
			'hcaptcha'   => array( Captcha::NAMES['hcaptcha'], __( 'Focused on privacy; sometimes asks for a puzzle.', 'funnelforms-free' ), 'https://dashboard.hcaptcha.com/sites' ),
			'recaptcha'  => array( Captcha::NAMES['recaptcha'], __( 'The box "I\'m not a robot".', 'funnelforms-free' ), 'https://www.google.com/recaptcha/admin/create' ),
			'recaptcha3' => array( Captcha::NAMES['recaptcha3'], __( 'Invisible: Google rates each visitor. Entries with a low score go into the spam folder instead of being refused.', 'funnelforms-free' ), 'https://www.google.com/recaptcha/admin/create' ),
		);
		$results  = array(
			'ok'          => array( 'success', __( 'The keys work: the provider knows the secret key, and the site key has the right form. Open a form to see the captcha.', 'funnelforms-free' ) ),
			'site_key'    => array( 'error', __( 'The site key does not look like a key of this service. Did you swap the site key and the secret key, or pick another service?', 'funnelforms-free' ) ),
			'secret'      => array( 'error', __( 'The service does not know this secret key. Copy it again from the service\'s dashboard.', 'funnelforms-free' ) ),
			'unreachable' => array( 'warning', __( 'The service could not be reached to test the keys. Try again later.', 'funnelforms-free' ) ),
		);
		self::card( __( 'Spam protection', 'funnelforms-free' ), __( 'Every form already checks a hidden field, the time to fill it in and the number of entries per visitor. A captcha adds a check by a specialised service in the contact step of every form; you can switch it off per form in the form\'s settings. Its script loads on the contact step after the visitor\'s consent; mention it in your privacy policy.', 'funnelforms-free' ), 'ffx-captcha' );
		?>
			<p class="ffx-protection">
				<strong><?php esc_html_e( 'Your forms are protected by:', 'funnelforms-free' ); ?></strong>
				<?php
				foreach ( SpamCheck::protection() as $name ) {
					echo Ui::badge( $name, 'success' ) . ' '; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge().
				}
				?>
			</p>
			<?php if ( isset( $results[ $test ] ) ) : ?>
				<div class="notice notice-<?php echo esc_attr( $results[ $test ][0] ); ?> inline"><p><?php echo esc_html( $results[ $test ][1] ); ?></p></div>
			<?php endif; ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-captcha">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::CAPTCHA ); ?>">
				<?php wp_nonce_field( self::CAPTCHA ); ?>
				<fieldset>
					<legend class="ffx-field__label"><?php esc_html_e( 'Captcha', 'funnelforms-free' ); ?></legend>
					<?php foreach ( $services as $value => list( $name, $hint, $keys ) ) : ?>
						<label class="ffx-option">
							<input type="radio" name="provider" value="<?php echo esc_attr( $value ); ?>" <?php checked( $current, $value ); ?>>
							<span>
								<strong><?php echo esc_html( $name ); ?></strong>
								<small>
									<?php echo esc_html( $hint ); ?>
									<?php if ( '' !== $keys ) : ?>
										<a href="<?php echo esc_url( $keys ); ?>" target="_blank" rel="noopener noreferrer"><?php esc_html_e( 'Get keys', 'funnelforms-free' ); ?><span class="screen-reader-text"> <?php esc_html_e( '(opens in a new tab)', 'funnelforms-free' ); ?></span></a>
									<?php endif; ?>
								</small>
							</span>
						</label>
					<?php endforeach; ?>
				</fieldset>
				<div class="ffx-grid ffx-captcha__keys">
					<p class="ffx-field">
						<label for="ffx-captcha-site-key"><?php esc_html_e( 'Site key', 'funnelforms-free' ); ?></label>
						<input type="text" class="code" id="ffx-captcha-site-key" name="site_key" value="<?php echo esc_attr( (string) ( $captcha['config']['siteKey'] ?? '' ) ); ?>" autocomplete="off">
					</p>
					<p class="ffx-field">
						<label for="ffx-captcha-secret"><?php esc_html_e( 'Secret key', 'funnelforms-free' ); ?></label>
						<input type="password" class="code" id="ffx-captcha-secret" name="secret" value="" autocomplete="new-password" placeholder="<?php echo esc_attr( '' !== (string) ( $captcha['secret']['secret'] ?? '' ) ? __( 'Saved; leave empty to keep it', 'funnelforms-free' ) : '' ); ?>">
					</p>
					<p class="ffx-field ffx-captcha__threshold">
						<label for="ffx-captcha-threshold"><?php esc_html_e( 'Lowest score of a person (reCAPTCHA v3)', 'funnelforms-free' ); ?></label>
						<input type="number" min="0.1" max="0.9" step="0.1" class="small-text" id="ffx-captcha-threshold" name="threshold" value="<?php echo esc_attr( (string) Captcha::threshold_value( $captcha['config']['threshold'] ?? Captcha::THRESHOLD ) ); ?>">
						<small><?php esc_html_e( 'Google rates visitors from 0.0 (bot) to 1.0 (person). Entries below this go into the spam folder. 0.5 suits most websites.', 'funnelforms-free' ); ?></small>
					</p>
				</div>
				<div class="ffx-card__save">
					<?php submit_button( __( 'Save', 'funnelforms-free' ), 'secondary', 'submit', false ); ?>
					<?php submit_button( __( 'Save and test keys', 'funnelforms-free' ), 'secondary', 'test', false ); ?>
				</div>
			</form>
		</section>
		<?php
	}

	/**
	 * The spam folder, Akismet and the limits of the checks that are always on.
	 */
	private static function render_spam(): void {
		$settings = SpamCheck::settings();
		$name     = SpamCheck::OPTION;
		$akismet  = Akismet::available();
		self::card( __( 'Spam folder', 'funnelforms-free' ), __( 'Entries that look like spam but could come from a person are not refused: they go into the spam folder of the entries. There they send no mail and run no action, integration or conversion, and they count in no statistics. "Not spam" takes an entry back and sends what was held back.', 'funnelforms-free' ), 'ffx-spam' );
		?>
			<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
				<?php settings_fields( self::GROUP . '_spam' ); ?>
				<div class="ffx-grid">
					<p class="ffx-field">
						<label for="ffx-spam-days"><?php esc_html_e( 'Delete spam after (days)', 'funnelforms-free' ); ?></label>
						<input type="number" min="0" max="365" step="1" class="small-text" id="ffx-spam-days" name="<?php echo esc_attr( $name ); ?>[spamDays]" value="<?php echo esc_attr( (string) $settings['spamDays'] ); ?>">
						<small><?php esc_html_e( '0 keeps spam until you delete it.', 'funnelforms-free' ); ?></small>
					</p>
					<p class="ffx-field">
						<label for="ffx-spam-seconds"><?php esc_html_e( 'Shortest time to fill in a form (seconds)', 'funnelforms-free' ); ?></label>
						<input type="number" min="0" max="600" step="1" class="small-text" id="ffx-spam-seconds" name="<?php echo esc_attr( $name ); ?>[minSeconds]" value="<?php echo esc_attr( (string) $settings['minSeconds'] ); ?>">
						<small><?php esc_html_e( 'Faster entries go into the spam folder. 0 only refuses the ones sent within 3 seconds.', 'funnelforms-free' ); ?></small>
					</p>
					<p class="ffx-field">
						<label for="ffx-spam-hourly"><?php esc_html_e( 'Most entries per visitor and hour', 'funnelforms-free' ); ?></label>
						<input type="number" min="0" max="1000" step="1" class="small-text" id="ffx-spam-hourly" name="<?php echo esc_attr( $name ); ?>[hourly]" value="<?php echo esc_attr( (string) $settings['hourly'] ); ?>">
						<small><?php esc_html_e( 'Across all forms, by IP address. 0: only the standard limit of 10 entries per form in 10 minutes.', 'funnelforms-free' ); ?></small>
					</p>
				</div>
				<input type="hidden" name="<?php echo esc_attr( $name ); ?>[akismet]" value="0">
				<label class="ffx-toggle">
					<input type="checkbox" name="<?php echo esc_attr( $name ); ?>[akismet]" value="1" <?php checked( $settings['akismet'] ); ?> <?php disabled( ! $akismet && ! $settings['akismet'] ); ?>>
					<span class="ffx-toggle__text"><?php esc_html_e( 'Check entries with Akismet', 'funnelforms-free' ); ?></span>
				</label>
				<p class="description">
					<?php
					echo esc_html(
						$akismet
							? __( 'Uses the key of your Akismet plugin. Name, e-mail address, typed text, page, language, browser and IP address of each entry go to Automattic (USA) for the check; in the EU privacy mode the IP address is shortened first. Mention Akismet in your privacy policy.', 'funnelforms-free' )
							: __( 'Install the Akismet plugin and connect it with a key to use it here.', 'funnelforms-free' )
					);
					?>
				</p>
				<?php self::save_row(); ?>
			</form>
		</section>
		<?php
	}
}
