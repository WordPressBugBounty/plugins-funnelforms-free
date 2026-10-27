<?php
/**
 * Diagnostic data for Funnelforms: the card under Settings → General and the block of the setup
 * assistant.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Telemetry\Consent;
use Funnelforms\Application\Telemetry\Report;
use Funnelforms\Application\Telemetry\Sender;

defined( 'ABSPATH' ) || exit;

/**
 * The same fields in both places: the main choice (a toggle in the settings, off by default; yes or
 * no without a preselection in the assistant, so it is a choice someone made) and, only while it
 * is yes, the industry and the toggle for the site's address. The report a site would send now is shown as
 * it is, escaped, in a folded block. Only administrators (manage_options) change the choice or
 * send a report, because it sends data of the site to Funnelforms.
 */
final class TelemetrySection {

	public const SAVE = 'funnelforms_diagnostics_save';
	public const SEND = 'funnelforms_diagnostics_send_now';

	/** Anchor of the card. */
	public const ANCHOR = 'ffx-diagnostic-data';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'admin_post_' . self::SAVE, array( self::class, 'handle_save' ) );
		add_action( 'admin_post_' . self::SEND, array( self::class, 'handle_send' ) );
	}

	/**
	 * Saves the card.
	 */
	public static function handle_save(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::SAVE );
		$choice = Consent::submitted( wp_unslash( $_POST ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- each field is checked in submitted().
		Consent::apply( $choice['enabled'], $choice['site_url'], $choice['industry'] );
		wp_safe_redirect( add_query_arg( 'saved', 'diagnostics', SettingsPage::url( 'general', self::ANCHOR ) ) );
		exit;
	}

	/**
	 * Sends the report now.
	 */
	public static function handle_send(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::SEND );
		$status = Sender::send();
		wp_safe_redirect( add_query_arg( 'diagnostics', '' === $status ? 'off' : $status, SettingsPage::url( 'general', self::ANCHOR ) ) );
		exit;
	}

	/**
	 * The card under Settings → General.
	 */
	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$settings = Consent::get();
		SettingsPage::card( __( 'Diagnostic data', 'funnelforms-free' ), self::description(), self::ANCHOR );
		self::message();
		?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-diagnostics">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::SAVE ); ?>">
				<?php wp_nonce_field( self::SAVE ); ?>
				<?php self::fields( $settings, 'ffx-diagnostics' ); ?>
				<?php SettingsPage::save_row(); ?>
			</form>
			<?php if ( Consent::enabled() ) : ?>
				<div class="ffx-inline ffx-diagnostics__status">
					<span>
						<?php
						echo esc_html(
							'' === $settings['last_sent_at']
								? __( 'Last sent: not yet', 'funnelforms-free' )
								/* translators: %s: date and time. */
								: sprintf( __( 'Last sent: %s', 'funnelforms-free' ), get_date_from_gmt( $settings['last_sent_at'], get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) ) )
						);
						?>
					</span>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline-form">
						<input type="hidden" name="action" value="<?php echo esc_attr( self::SEND ); ?>">
						<?php wp_nonce_field( self::SEND ); ?>
						<button type="submit" class="ffx-btn ffx-btn--sm"><?php echo Ui::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Send now', 'funnelforms-free' ); ?></span></button>
					</form>
				</div>
			<?php endif; ?>
			<?php self::preview( $settings ); ?>
		</section>
		<?php
	}

	/**
	 * The block of the setup assistant, on the step "Region, language and privacy": yes or no,
	 * nothing chosen until the site has sent diagnostic data before.
	 *
	 * @param array<string,mixed> $choices Choices of the assistant; diagnostics null while nobody chose.
	 */
	public static function setup_group( array $choices ): void {
		$chosen   = $choices['diagnostics'] ?? null;
		$settings = array(
			'enabled'  => true === $chosen,
			'site_url' => ! empty( $choices['diagnostics_url'] ),
			'industry' => (string) ( $choices['diagnostics_industry'] ?? '' ),
		) + Consent::get();
		?>
		<fieldset class="ffx-setup__group ffx-diagnostics">
			<legend><?php esc_html_e( 'Help improve Funnelforms', 'funnelforms-free' ); ?></legend>
			<p class="ffx-setup__hint"><?php esc_html_e( 'May the plugin send diagnostic data to Funnelforms once a week? It holds no content and no data about your visitors.', 'funnelforms-free' ); ?></p>
			<div class="ffx-setup__options-row">
				<?php
				self::answer( '1', true === $chosen, __( 'Yes, send diagnostic data', 'funnelforms-free' ), __( 'Helps us find errors and see which features matter.', 'funnelforms-free' ) );
				self::answer( '0', false === $chosen, __( 'No, send nothing', 'funnelforms-free' ), __( 'Nothing goes to Funnelforms. You can change this later under Settings.', 'funnelforms-free' ) );
				?>
			</div>
			<?php self::more( $settings, 'ffx-setup-diagnostics' ); ?>
			<p class="ffx-setup__hint"><?php echo esc_html( self::description() ); ?></p>
			<?php self::preview( $settings ); ?>
		</fieldset>
		<?php
	}

	/**
	 * One answer of the assistant's question, as an option tile.
	 *
	 * @param string $value   1 or 0.
	 * @param bool   $checked Chosen.
	 * @param string $title   Title.
	 * @param string $text    Text below.
	 */
	private static function answer( string $value, bool $checked, string $title, string $text ): void {
		?>
		<label class="ffx-setup__option">
			<input type="radio" name="diagnostics" value="<?php echo esc_attr( $value ); ?>" <?php checked( $checked ); ?> required>
			<span class="ffx-setup__icon"><?php echo Ui::icon( '1' === $value ? 'chart' : 'shield' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<span class="ffx-setup__option-text"><strong><?php echo esc_html( $title ); ?></strong><span><?php echo esc_html( $text ); ?></span></span>
		</label>
		<?php
	}

	/**
	 * What the report holds and what happens when it is turned off.
	 */
	public static function description(): string {
		return __( 'Once a week the plugin sends a report with the plugin, WordPress and PHP versions, server environment, features and question types in use, counts (forms, entries, views), drop-off per question type and the times entries come in. It never sends texts, answers, entries, email or IP addresses of your visitors, form IDs or page addresses. The report carries a random installation ID that is not linked to your license. Funnelforms keeps reports for 13 months. If you turn this off, sending stops and the reports of the current installation ID are deleted; reports under an earlier ID end after the 13 months.', 'funnelforms-free' );
	}

	/**
	 * The main toggle and, below it while it is on, the industry and the address toggle. The
	 * stylesheet hides the second part while the main toggle is off; the server ignores it then.
	 *
	 * @param array<string,mixed> $settings Settings to show (keys of Consent::get()).
	 * @param string              $id       Prefix of the element IDs.
	 */
	private static function fields( array $settings, string $id ): void {
		?>
		<label class="ffx-toggle">
			<input type="checkbox" name="diagnostics" value="1" <?php checked( ! empty( $settings['enabled'] ) ); ?>>
			<span class="ffx-toggle__text"><?php esc_html_e( 'Send diagnostic data to Funnelforms (no content and no data about your visitors)', 'funnelforms-free' ); ?></span>
		</label>
		<?php
		self::more( $settings, $id );
	}

	/**
	 * The industry and the address toggle, shown while the main choice is yes.
	 *
	 * @param array<string,mixed> $settings Settings to show (keys of Consent::get()).
	 * @param string              $id       Prefix of the element IDs.
	 */
	private static function more( array $settings, string $id ): void {
		$labels = Consent::industry_labels();
		?>
		<div class="ffx-diagnostics__more">
			<p class="ffx-field">
				<label for="<?php echo esc_attr( $id . '-industry' ); ?>"><?php esc_html_e( 'Industry (optional)', 'funnelforms-free' ); ?></label>
				<select id="<?php echo esc_attr( $id . '-industry' ); ?>" name="diagnostics_industry">
					<?php foreach ( $labels as $key => $label ) : ?>
						<option value="<?php echo esc_attr( (string) $key ); ?>" <?php selected( (string) ( $settings['industry'] ?? '' ), (string) $key ); ?>><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select>
			</p>
			<label class="ffx-toggle">
				<input type="checkbox" name="diagnostics_url" value="1" <?php checked( ! empty( $settings['enabled'] ) && ! empty( $settings['site_url'] ) ); ?>>
				<span class="ffx-toggle__text"><?php esc_html_e( 'Include this website\'s address. Funnelforms can then match the report to your website, for example to help with errors.', 'funnelforms-free' ); ?></span>
			</label>
		</div>
		<?php
	}

	/**
	 * The report this site would send now, as JSON in a folded block.
	 *
	 * @param array<string,mixed> $settings Settings the report is made with.
	 */
	private static function preview( array $settings ): void {
		$report = Report::build( Consent::clean( $settings ), time() );
		?>
		<details class="ffx-more ffx-diagnostics__report">
			<summary><?php esc_html_e( 'View report', 'funnelforms-free' ); ?></summary>
			<?php if ( '' === $report['install_id'] ) : ?>
				<p class="ffx-muted"><?php esc_html_e( 'The installation ID is created when you turn this on.', 'funnelforms-free' ); ?></p>
			<?php endif; ?>
			<pre class="ffx-diagnostics__json" tabindex="0"><?php echo esc_html( Report::pretty( $report ) ); ?></pre>
		</details>
		<?php
	}

	/**
	 * The notice after saving or sending.
	 */
	private static function message(): void {
		$code = isset( $_GET['diagnostics'] ) ? sanitize_key( wp_unslash( $_GET['diagnostics'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		$text = match ( $code ) {
			Consent::SENT    => array( 'success', __( 'The report was sent.', 'funnelforms-free' ) ),
			Consent::FAILED  => array( 'warning', __( 'The report could not be sent. The next weekly report tries again.', 'funnelforms-free' ) ),
			Consent::RENEWED => array( 'warning', __( 'Funnelforms did not recognise this installation. It gets a new installation ID with the next report.', 'funnelforms-free' ) ),
			Consent::STOPPED => array( 'warning', __( 'Funnelforms takes no more reports from this website, so sending diagnostic data was turned off.', 'funnelforms-free' ) ),
			default          => null,
		};
		if ( null === $text && Consent::STOPPED === Consent::get()['last_status'] && ! Consent::enabled() ) {
			$text = array( 'warning', __( 'Funnelforms takes no more reports from this website, so sending diagnostic data was turned off.', 'funnelforms-free' ) );
		}
		if ( null !== $text ) {
			echo '<div class="notice notice-' . esc_attr( $text[0] ) . ' inline"><p>' . esc_html( $text[1] ) . '</p></div>';
		}
	}
}
