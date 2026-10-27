<?php
/**
 * The page about Funnelforms Pro in Funnelforms Free, and the way to it.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Edition;

use Funnelforms\Admin\Ui;
use Funnelforms\Application\Capabilities;

defined( 'ABSPATH' ) || exit;

/**
 * Guideline 8 of wordpress.org forbids a plugin to install its premium version, so Free never
 * downloads Pro. The way is: plan and account on the Funnelforms account pages (a link, opened by
 * the person), back here, then the ZIP from the account goes through the upload of WordPress
 * itself (update.php?action=upload-plugin). Pro deactivates Free when it is activated and keeps
 * the forms and entries, which are the same tables.
 */
final class UpgradePage {

	/** Account pages of Funnelforms, where plans are bought and Pro is downloaded. */
	public const ACCOUNT_URL = 'https://account.funnelforms.io/konto';

	/** Main file of Funnelforms Pro, relative to the plugins folder. */
	public const PRO_PLUGIN = 'Funnelforms-pro/Funnelforms-pro.php';

	/**
	 * Where the plan is chosen. The checkout sends the person back to the install step here.
	 */
	public static function checkout_url(): string {
		return add_query_arg(
			array(
				'produkt' => 'pro',
				'von'     => 'free',
				'zurueck' => rawurlencode( self::install_url() ),
			),
			self::ACCOUNT_URL . '/kaufen'
		);
	}

	/**
	 * Where the account offers the ZIP of Funnelforms Pro. After a purchase the checkout leads there
	 * itself; its button "Back to WordPress" opens the install step.
	 */
	public static function downloads_url(): string {
		return add_query_arg( 'zurueck', rawurlencode( self::install_url() ), self::ACCOUNT_URL . '/downloads' );
	}

	/**
	 * The install step of this page.
	 */
	public static function install_url(): string {
		return admin_url( 'admin.php?page=' . FreeSite::SLUG . '&step=install' );
	}

	/**
	 * Whether Funnelforms Pro is in the plugins folder (and only waits to be activated).
	 */
	public static function pro_installed(): bool {
		return file_exists( WP_PLUGIN_DIR . '/' . self::PRO_PLUGIN );
	}

	/**
	 * What Free and Pro have, by area. A row is a label and, for each edition, true, false or a
	 * short text.
	 *
	 * @return array<int,array{title:string,icon:string,rows:array<int,array{0:string,1:bool|string,2:bool|string}>}>
	 */
	public static function comparison(): array {
		$names     = Edition::labels();
		$pro       = static function ( array $keys ) use ( $names ): array {
			$rows = array();
			foreach ( $keys as $key ) {
				$rows[] = array( $names[ $key ], false, true );
			}
			return $rows;
		};
		$unlimited = __( 'Unlimited', 'funnelforms-free' );
		return array(
			array(
				'title' => __( 'Builder and questions', 'funnelforms-free' ),
				'icon'  => 'layers',
				'rows'  => array_merge(
					array(
						array( __( 'Forms, steps, fields and entries', 'funnelforms-free' ), $unlimited, $unlimited ),
						array( __( 'Canvas builder with several fields per step', 'funnelforms-free' ), true, true ),
						array( __( 'Choice with icons or images, dropdown, text, e-mail, phone, web address, number, date, time and rating', 'funnelforms-free' ), true, true ),
						array( __( 'Contact step with consent and spam protection', 'funnelforms-free' ), true, true ),
						array( __( 'Templates', 'funnelforms-free' ), true, true ),
					),
					$pro( array( 'field:booking', 'field:file', 'field:address', 'field:signature', 'field:slider', 'field:repeat', 'contact_field:phone_verification', 'contact_field:html' ) )
				),
			),
			array(
				'title' => __( 'Logic and calculations', 'funnelforms-free' ),
				'icon'  => 'branch',
				'rows'  => array_merge(
					array( array( __( 'Branching by answer', 'funnelforms-free' ), true, true ) ),
					$pro( array( 'conditions', 'calculations', 'field:result', 'quiz', 'lead_scoring', 'lead_value', 'hidden_fields', 'variables' ) )
				),
			),
			array(
				'title' => __( 'After sending', 'funnelforms-free' ),
				'icon'  => 'mail',
				'rows'  => array_merge(
					array(
						array( __( 'Notification to you and confirmation to the lead', 'funnelforms-free' ), true, true ),
						array( __( 'Thank-you page, downloads or redirect', 'funnelforms-free' ), true, true ),
						array( __( 'Designed mails in the colour of the form, with your logo', 'funnelforms-free' ), true, true ),
					),
					$pro( array( 'multiple_mails', 'conditional_actions', 'pdf', 'payment', 'double_opt_in', 'abandonment', 'action:crm', 'action:webhook', 'action:chat', 'action:sms', 'action:whatsapp', 'action:conversion', 'action:googleAds' ) )
				),
			),
			array(
				'title' => __( 'Entries and figures', 'funnelforms-free' ),
				'icon'  => 'chart',
				'rows'  => array_merge(
					array(
						array( __( 'Entries with search and CSV export', 'funnelforms-free' ), true, true ),
						array( __( 'Spam folder, captcha and Akismet', 'funnelforms-free' ), true, true ),
						array( __( 'Blocklists for words, e-mail domains and IP addresses', 'funnelforms-free' ), false, true ),
						array( __( 'Statistics with conversion and drop-off per step', 'funnelforms-free' ), true, true ),
						array( __( 'Figures of each step on the canvas', 'funnelforms-free' ), true, true ),
						array( __( 'Lead status, tags, assignment and notes', 'funnelforms-free' ), false, true ),
						array( __( 'Board of the entries by lead status', 'funnelforms-free' ), false, true ),
						array( __( 'Send an entry again to its actions', 'funnelforms-free' ), false, true ),
						array( __( 'Export for Excel', 'funnelforms-free' ), false, true ),
						array( __( 'Analytics of each form with sources and campaigns', 'funnelforms-free' ), false, true ),
						array( __( 'Analytics mode on the canvas with paths, the strongest way and drop-off per field', 'funnelforms-free' ), false, true ),
						array( __( 'Export of the statistics', 'funnelforms-free' ), false, true ),
					),
					$pro( array( 'partial_entries', 'experiments', 'public_entries' ) )
				),
			),
			array(
				'title' => __( 'On your website', 'funnelforms-free' ),
				'icon'  => 'globe',
				'rows'  => array_merge(
					array(
						array( __( 'Shortcode, block, Elementor widget and funnel page', 'funnelforms-free' ), true, true ),
						array( __( 'Themes, colours and fonts', 'funnelforms-free' ), true, true ),
						array( __( 'Saved styles and import of your branding', 'funnelforms-free' ), false, true ),
						array( __( 'Popups and widgets', 'funnelforms-free' ), false, true ),
					),
					$pro( array( 'multilingual', 'save_progress', 'access', 'time_limit', 'custom_css' ) )
				),
			),
			array(
				'title' => __( 'Help', 'funnelforms-free' ),
				'icon'  => 'lifebuoy',
				'rows'  => array(
					array( __( 'Help center and support forum', 'funnelforms-free' ), true, true ),
					array( __( 'Support by ticket', 'funnelforms-free' ), false, true ),
				),
			),
		);
	}

	/**
	 * The page: the install step after the purchase, otherwise what Pro adds.
	 */
	public static function render(): void {
		if ( ! current_user_can( Capabilities::EDIT_FORMS ) ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- only picks the view.
		$install = isset( $_GET['step'] ) && 'install' === sanitize_key( wp_unslash( $_GET['step'] ) );
		Ui::open(
			array(
				'title' => __( 'Funnelforms Pro', 'funnelforms-free' ),
				'head'  => false,
			)
		);
		echo '<div class="ffx-pro">';
		if ( $install ) {
			self::install();
		} else {
			self::hero();
			self::highlights();
			self::table();
			self::steps();
			self::help();
		}
		echo '</div>';
		Ui::close();
	}

	/**
	 * Top of the page: what Pro is, and the way to it.
	 */
	private static function hero(): void {
		?>
		<section class="ffx-hero ffx-pro__hero">
			<div>
				<span class="ffx-hero__eyebrow"><?php echo Ui::icon( 'sparkles' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?> Funnelforms Pro</span>
				<h1><?php esc_html_e( 'Funnels that book, calculate and get paid', 'funnelforms-free' ); ?></h1>
				<p><?php esc_html_e( 'Funnelforms Free has no limits on forms, steps, fields or entries. Funnelforms Pro adds appointment booking, payments, calculations, integrations and much more, for the same forms.', 'funnelforms-free' ); ?></p>
				<div class="ffx-hero__actions">
					<?php self::upgrade_button( 'lg' ); ?>
					<?php echo Ui::button( __( 'Compare Free and Pro', 'funnelforms-free' ), '#ffx-pro-compare', 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
				</div>
				<p class="ffx-pro__note">
					<?php echo Ui::icon( 'shield' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?>
					<span><?php esc_html_e( 'Your forms, entries and settings stay as they are.', 'funnelforms-free' ); ?></span>
				</p>
			</div>
			<aside class="ffx-hero__aside ffx-card ffx-pro__plans" aria-labelledby="ffx-pro-plans-title">
				<h2 id="ffx-pro-plans-title"><?php esc_html_e( 'Your edition', 'funnelforms-free' ); ?></h2>
				<div class="ffx-pro__plan">
					<span class="ffx-pro__plan-name">Free</span>
					<?php echo Ui::badge( __( 'Active', 'funnelforms-free' ), 'success' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge(). ?>
				</div>
				<p class="ffx-small"><?php esc_html_e( 'Unlimited forms and entries, branching, confirmation mail and CSV export.', 'funnelforms-free' ); ?></p>
				<div class="ffx-pro__plan ffx-pro__plan--pro">
					<span class="ffx-pro__plan-name">Pro</span>
					<span class="ffx-pro__tag"><?php esc_html_e( 'Pro', 'funnelforms-free' ); ?></span>
				</div>
				<p class="ffx-small"><?php esc_html_e( 'Everything in Free, plus every Pro feature, updates and support by ticket.', 'funnelforms-free' ); ?></p>
				<?php if ( self::pro_installed() ) : ?>
					<?php self::activate_button(); ?>
				<?php else : ?>
					<a class="ffx-small" href="<?php echo esc_url( self::install_url() ); ?>"><?php esc_html_e( 'Already bought Pro? Install it', 'funnelforms-free' ); ?></a>
				<?php endif; ?>
			</aside>
		</section>
		<?php
	}

	/**
	 * Six things only Pro does, as cards.
	 */
	private static function highlights(): void {
		$cards = array(
			array( 'calendar', __( 'Appointment booking', 'funnelforms-free' ), __( 'Leads book a time in the form. Google, Microsoft and iCloud calendars, opening hours, buffers and reminders.', 'funnelforms-free' ) ),
			array( 'card', __( 'Payments', 'funnelforms-free' ), __( 'Take payments and deposits with Stripe and PayPal right in the funnel, with coupons.', 'funnelforms-free' ) ),
			array( 'calculator', __( 'Calculations and quizzes', 'funnelforms-free' ), __( 'Price calculators, scores and results that change with every answer.', 'funnelforms-free' ) ),
			array( 'link', __( 'Integrations', 'funnelforms-free' ), __( 'Send leads to your CRM and newsletter tool, by webhook, to Slack, Teams, SMS or WhatsApp.', 'funnelforms-free' ) ),
			array( 'activity', __( 'A/B tests and conversions', 'funnelforms-free' ), __( 'Test two designs against each other and report conversions to Google Ads and Meta from the server.', 'funnelforms-free' ) ),
			array( 'globe', __( 'Every language', 'funnelforms-free' ), __( 'One form in several languages, save and continue later, password and time limit.', 'funnelforms-free' ) ),
		);
		?>
		<section class="ffx-section" aria-labelledby="ffx-pro-highlights">
			<h2 id="ffx-pro-highlights" class="ffx-pro__title"><?php esc_html_e( 'What Pro adds', 'funnelforms-free' ); ?></h2>
			<div class="ffx-grid ffx-pro__cards">
				<?php foreach ( $cards as $card ) : ?>
					<article class="ffx-card ffx-pro__card">
						<span class="ffx-pro__icon"><?php echo Ui::icon( $card[0] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
						<span class="ffx-pro__tag"><?php esc_html_e( 'Pro', 'funnelforms-free' ); ?></span>
						<h3><?php echo esc_html( $card[1] ); ?></h3>
						<p><?php echo esc_html( $card[2] ); ?></p>
					</article>
				<?php endforeach; ?>
			</div>
		</section>
		<?php
	}

	/**
	 * Free and Pro side by side.
	 */
	private static function table(): void {
		?>
		<section class="ffx-section" id="ffx-pro-compare" aria-labelledby="ffx-pro-compare-title">
			<h2 id="ffx-pro-compare-title" class="ffx-pro__title"><?php esc_html_e( 'Free and Pro compared', 'funnelforms-free' ); ?></h2>
			<div class="ffx-card ffx-card--flush">
				<table class="ffx-pro__table">
					<thead>
						<tr>
							<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Feature', 'funnelforms-free' ); ?></span></th>
							<th scope="col" class="ffx-pro__col">Free</th>
							<th scope="col" class="ffx-pro__col ffx-pro__col--pro">Pro</th>
						</tr>
					</thead>
					<?php foreach ( self::comparison() as $group ) : ?>
						<tbody>
							<tr class="ffx-pro__group">
								<th scope="colgroup" colspan="3"><?php echo Ui::icon( $group['icon'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php echo esc_html( $group['title'] ); ?></span></th>
							</tr>
							<?php foreach ( $group['rows'] as $row ) : ?>
								<tr class="<?php echo esc_attr( true === $row[1] || is_string( $row[1] ) ? '' : 'is-pro' ); ?>">
									<th scope="row"><?php echo esc_html( $row[0] ); ?></th>
									<td class="ffx-pro__col"><?php self::cell( $row[1] ); ?></td>
									<td class="ffx-pro__col ffx-pro__col--pro"><?php self::cell( $row[2] ); ?></td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					<?php endforeach; ?>
				</table>
			</div>
			<div class="ffx-pro__cta">
				<p><?php esc_html_e( 'Pro uses the forms you build in Free. Nothing has to be built again.', 'funnelforms-free' ); ?></p>
				<?php self::upgrade_button(); ?>
			</div>
		</section>
		<?php
	}

	/**
	 * One cell of the table.
	 *
	 * @param bool|string $value Has it, has it not, or a short text.
	 */
	private static function cell( $value ): void {
		if ( is_string( $value ) ) {
			echo '<span class="ffx-pro__text">' . esc_html( $value ) . '</span>';
			return;
		}
		printf(
			'<span class="ffx-pro__mark%1$s">%2$s<span class="screen-reader-text">%3$s</span></span>',
			$value ? ' is-yes' : '',
			$value ? Ui::icon( 'check' ) : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
			esc_html( $value ? __( 'Included', 'funnelforms-free' ) : __( 'Not included', 'funnelforms-free' ) )
		);
	}

	/**
	 * The three steps to Pro.
	 */
	private static function steps(): void {
		$steps = array(
			array( 'user', __( 'Choose a plan', 'funnelforms-free' ), __( 'Pick your plan and create your Funnelforms account. Payment is on the secure checkout page.', 'funnelforms-free' ) ),
			array( 'download', __( 'Install Pro', 'funnelforms-free' ), __( 'After paying, you download Funnelforms Pro in your account, come back here and upload it in one step.', 'funnelforms-free' ) ),
			array( 'rocket', __( 'Activate it', 'funnelforms-free' ), __( 'Pro takes over from Free with all your forms and entries. Then connect your account for updates.', 'funnelforms-free' ) ),
		);
		?>
		<section class="ffx-section" aria-labelledby="ffx-pro-steps-title">
			<h2 id="ffx-pro-steps-title" class="ffx-pro__title"><?php esc_html_e( 'Upgrade in three steps', 'funnelforms-free' ); ?></h2>
			<ol class="ffx-grid ffx-pro__steps">
				<?php foreach ( $steps as $step ) : ?>
					<li class="ffx-card">
						<span class="ffx-pro__icon"><?php echo Ui::icon( $step[0] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
						<h3><?php echo esc_html( $step[1] ); ?></h3>
						<p><?php echo esc_html( $step[2] ); ?></p>
					</li>
				<?php endforeach; ?>
			</ol>
		</section>
		<?php
	}

	/**
	 * Where questions go.
	 */
	private static function help(): void {
		?>
		<section class="ffx-card ffx-section ffx-pro__help">
			<div>
				<h2><?php esc_html_e( 'Help', 'funnelforms-free' ); ?></h2>
				<p><?php esc_html_e( 'Guides for every step are in the help center. Questions about Funnelforms Free are answered in the support forum on wordpress.org.', 'funnelforms-free' ); ?></p>
			</div>
			<div class="ffx-actions">
				<?php echo Ui::external_button( __( 'Help center', 'funnelforms-free' ), Ui::help_center_url() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in external_button(). ?>
				<?php echo Ui::external_button( __( 'Support forum', 'funnelforms-free' ), Ui::FREE_SUPPORT_URL, 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in external_button(). ?>
			</div>
		</section>
		<?php
	}

	/**
	 * After the purchase: download, upload, activate.
	 */
	private static function install(): void {
		$installed  = self::pro_installed();
		$can_upload = current_user_can( 'upload_plugins' );
		?>
		<section class="ffx-hero ffx-pro__hero">
			<div>
				<span class="ffx-hero__eyebrow"><?php echo Ui::icon( 'rocket' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?> Funnelforms Pro</span>
				<h1><?php esc_html_e( 'Install Funnelforms Pro', 'funnelforms-free' ); ?></h1>
				<p><?php esc_html_e( 'Thank you for choosing Pro. Upload the file from your account and activate Pro, and your forms have every Pro feature. Your forms and entries stay as they are.', 'funnelforms-free' ); ?></p>
			</div>
		</section>
		<ol class="ffx-pro__install">
			<li class="ffx-card<?php echo $installed ? ' is-done' : ''; ?>">
				<span class="ffx-pro__num" aria-hidden="true">1</span>
				<div>
					<h2><?php esc_html_e( 'Download Funnelforms Pro', 'funnelforms-free' ); ?></h2>
					<p><?php esc_html_e( 'After the purchase, your account offers the ZIP file of Funnelforms Pro under Downloads. If you have it already, go on with step 2. Keep the file as it is, do not unpack it.', 'funnelforms-free' ); ?></p>
					<?php echo Ui::external_button( __( 'Open downloads in my account', 'funnelforms-free' ), self::downloads_url() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in external_button(). ?>
				</div>
			</li>
			<li class="ffx-card<?php echo $installed ? ' is-done' : ''; ?>">
				<span class="ffx-pro__num" aria-hidden="true">2</span>
				<div>
					<h2><?php esc_html_e( 'Upload it here', 'funnelforms-free' ); ?></h2>
					<?php if ( $installed ) : ?>
						<p><?php esc_html_e( 'Funnelforms Pro is installed.', 'funnelforms-free' ); ?></p>
					<?php elseif ( $can_upload ) : ?>
						<p><?php esc_html_e( 'Choose the ZIP file. WordPress installs it like any plugin you upload.', 'funnelforms-free' ); ?></p>
						<form class="ffx-pro__upload" method="post" enctype="multipart/form-data" action="<?php echo esc_url( self_admin_url( 'update.php?action=upload-plugin' ) ); ?>">
							<?php wp_nonce_field( 'plugin-upload' ); ?>
							<label class="screen-reader-text" for="ffx-pro-zip"><?php esc_html_e( 'ZIP file of Funnelforms Pro', 'funnelforms-free' ); ?></label>
							<input type="file" id="ffx-pro-zip" name="pluginzip" accept=".zip" required>
							<button type="submit" class="ffx-btn ffx-btn--primary"><?php echo Ui::icon( 'download' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Install Pro', 'funnelforms-free' ); ?></span></button>
						</form>
					<?php else : ?>
						<p><?php esc_html_e( 'Only an administrator can upload plugins on this website. Send the ZIP file to them.', 'funnelforms-free' ); ?></p>
					<?php endif; ?>
				</div>
			</li>
			<li class="ffx-card">
				<span class="ffx-pro__num" aria-hidden="true">3</span>
				<div>
					<h2><?php esc_html_e( 'Activate Pro and connect your account', 'funnelforms-free' ); ?></h2>
					<p><?php esc_html_e( 'When you activate Pro, it takes over from Free: same forms, same entries, same settings. Then connect your account under Funnelforms → Account for updates and support.', 'funnelforms-free' ); ?></p>
					<?php
					if ( $installed ) {
						self::activate_button();
					}
					?>
				</div>
			</li>
		</ol>
		<p class="ffx-pro__back">
			<?php echo Ui::button( __( 'Back to the Pro features', 'funnelforms-free' ), admin_url( 'admin.php?page=' . FreeSite::SLUG ), 'ghost', 'back' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
			<?php echo Ui::external_button( __( 'No plan yet? Choose one', 'funnelforms-free' ), self::checkout_url(), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in external_button(). ?>
		</p>
		<?php
	}

	/**
	 * The button to the plans.
	 *
	 * @param string $size lg or empty.
	 */
	private static function upgrade_button( string $size = '' ): void {
		printf(
			'<a class="ffx-btn ffx-btn--primary%1$s" href="%2$s" target="_blank" rel="noopener">%3$s<span>%4$s</span><span class="screen-reader-text"> %5$s</span></a>',
			'' === $size ? '' : ' ffx-btn--' . esc_attr( $size ),
			esc_url( self::checkout_url() ),
			Ui::icon( 'sparkles' ), // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
			esc_html__( 'Upgrade to Pro', 'funnelforms-free' ),
			esc_html__( '(opens in a new tab)', 'funnelforms-free' )
		);
	}

	/**
	 * Activates the installed Pro through the plugin screen of WordPress.
	 */
	private static function activate_button(): void {
		if ( ! current_user_can( 'activate_plugin', self::PRO_PLUGIN ) ) {
			return;
		}
		$url = wp_nonce_url( self_admin_url( 'plugins.php?action=activate&plugin=' . rawurlencode( self::PRO_PLUGIN ) ), 'activate-plugin_' . self::PRO_PLUGIN );
		echo Ui::button( __( 'Activate Funnelforms Pro', 'funnelforms-free' ), $url, 'primary', 'rocket' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
	}
}
