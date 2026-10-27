<?php
/**
 * How Funnelforms sends its mails (Settings → E-mail): WordPress or the SMTP server of a provider.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Actions\MailServer;
use Funnelforms\Application\Capabilities;

defined( 'ABSPATH' ) || exit;

/**
 * Known providers fill in server, port and encryption (assets/admin/mail.js; without the script
 * the server takes the provider's values for empty fields). "Save and send test mail" sends the
 * test through the server only, so a wrong password shows up here and not in a lost notification.
 */
final class MailServerSection {

	public const ACTION = 'funnelforms_mail_server';

	/**
	 * Registers the handler of the form.
	 */
	public static function register(): void {
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle' ) );
	}

	/**
	 * Saves the server, removes it, or saves it and sends a test mail.
	 */
	public static function handle(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::ACTION );
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		$field = static fn( string $key ): string => isset( $_POST[ $key ] ) ? trim( sanitize_text_field( wp_unslash( $_POST[ $key ] ) ) ) : '';
		if ( '' !== $field( 'remove' ) ) {
			MailServer::delete();
			wp_safe_redirect( add_query_arg( 'saved', 'mail', SettingsPage::url( 'mail', 'ffx-mail-server' ) ) );
			exit;
		}
		MailServer::save(
			array(
				'enabled'    => '1' === $field( 'enabled' ),
				'provider'   => $field( 'provider' ),
				'host'       => $field( 'host' ),
				'port'       => $field( 'port' ),
				'encryption' => $field( 'encryption' ),
				'username'   => $field( 'username' ),
				// Passwords may hold any character; only line breaks are taken out.
				'password'   => isset( $_POST['password'] ) ? str_replace( array( "\r", "\n" ), '', (string) wp_unslash( $_POST['password'] ) ) : '', // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- a password, stored encrypted and never shown.
				'fromEmail'  => $field( 'from_email' ),
				'fromName'   => $field( 'from_name' ),
				'fallback'   => '1' === $field( 'fallback' ),
			)
		);
		// phpcs:enable WordPress.Security.NonceVerification.Missing
		if ( '' !== $field( 'test' ) ) {
			MailDiagnostics::test();
			wp_safe_redirect( add_query_arg( 'mailtest', 'server', SettingsPage::url( 'mail', 'ffx-mail-server' ) ) );
			exit;
		}
		wp_safe_redirect( add_query_arg( 'saved', 'mail', SettingsPage::url( 'mail', 'ffx-mail-server' ) ) );
		exit;
	}

	/**
	 * The card.
	 */
	public static function render(): void {
		wp_enqueue_script( 'funnelforms-mail', plugins_url( 'assets/admin/mail.js', FUNNELFORMS_PLUGIN_FILE ), array(), FUNNELFORMS_ASSET_VERSION, true );
		$server   = MailServer::settings();
		$config   = $server['config'] ?? array();
		$stored   = array() !== $server;
		$enabled  = ! empty( $config['enabled'] );
		$provider = (string) ( $config['provider'] ?? 'custom' );
		$provider = isset( MailServer::PROVIDERS[ $provider ] ) ? $provider : 'custom';
		$preset   = MailServer::PROVIDERS[ $provider ];
		$failure  = $enabled ? MailServer::failure() : null;
		$test     = isset( $_GET['mailtest'] ) && 'server' === $_GET['mailtest']; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.

		SettingsPage::card( __( 'Sending e-mails', 'funnelforms-free' ), __( 'How Funnelforms sends its mails: notifications, confirmations to visitors, opt-in mails and reminders. Through the SMTP server of your mail provider they arrive more reliably and land less often in spam. Other mails of your website stay as they are.', 'funnelforms-free' ), 'ffx-mail-server' );
		if ( $test ) {
			MailDiagnostics::notice();
		}
		if ( null !== $failure && ! $test ) {
			?>
			<div class="notice notice-warning inline">
				<p><strong>
					<?php
					/* translators: %s: date and time. */
					printf( esc_html__( 'The SMTP server failed on %s.', 'funnelforms-free' ), esc_html( wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $failure['time'] ) ) );
					?>
				</strong> <?php echo esc_html( MailDiagnostics::hint( $failure['code'] ) ); ?></p>
				<?php if ( ! empty( $config['fallback'] ) && in_array( $failure['code'], array( 'smtp_connect', 'smtp_auth' ), true ) ) : ?>
					<p><?php esc_html_e( 'The mail went out through WordPress instead. Check the data below and send a test mail.', 'funnelforms-free' ); ?></p>
				<?php endif; ?>
			</div>
			<?php
		}
		?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-mailserver">
				<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
				<?php wp_nonce_field( self::ACTION ); ?>
				<fieldset>
					<legend class="ffx-field__label"><?php esc_html_e( 'Send through', 'funnelforms-free' ); ?></legend>
					<label class="ffx-option">
						<input type="radio" name="enabled" value="0" <?php checked( ! $enabled ); ?>>
						<span>
							<strong><?php esc_html_e( 'WordPress', 'funnelforms-free' ); ?></strong>
							<small><?php echo esc_html( MailDiagnostics::wordpress_transport() ); ?></small>
						</span>
					</label>
					<label class="ffx-option">
						<input type="radio" name="enabled" value="1" <?php checked( $enabled ); ?>>
						<span>
							<strong><?php esc_html_e( 'SMTP server of my mail provider', 'funnelforms-free' ); ?></strong>
							<small><?php esc_html_e( 'Recommended. Works with Gmail, Microsoft 365, IONOS, STRATO, Brevo and every other provider.', 'funnelforms-free' ); ?></small>
						</span>
					</label>
				</fieldset>
				<div class="ffx-mailserver__fields">
					<p class="ffx-field ffx-mailserver__provider">
						<label for="ffx-mail-provider"><?php esc_html_e( 'Mail provider', 'funnelforms-free' ); ?></label>
						<select id="ffx-mail-provider" name="provider" data-ffx-mail-provider>
							<?php foreach ( MailServer::PROVIDERS as $key => $item ) : ?>
								<option value="<?php echo esc_attr( $key ); ?>" data-host="<?php echo esc_attr( $item['host'] ); ?>" data-port="<?php echo esc_attr( (string) $item['port'] ); ?>" data-encryption="<?php echo esc_attr( $item['encryption'] ); ?>" data-username="<?php echo esc_attr( $item['username'] ?? '' ); ?>" data-hint="<?php echo esc_attr( MailServer::hint( $key ) ); ?>" <?php selected( $provider, $key ); ?>><?php echo esc_html( 'custom' === $key ? __( 'Other provider', 'funnelforms-free' ) : $item['name'] ); ?></option>
							<?php endforeach; ?>
						</select>
						<small data-ffx-mail-hint><?php echo esc_html( MailServer::hint( $provider ) ); ?></small>
					</p>
					<div class="ffx-grid">
						<p class="ffx-field">
							<label for="ffx-mail-host"><?php esc_html_e( 'SMTP server', 'funnelforms-free' ); ?></label>
							<input type="text" class="code" id="ffx-mail-host" name="host" value="<?php echo esc_attr( (string) ( $config['host'] ?? $preset['host'] ) ); ?>" autocomplete="off" spellcheck="false" placeholder="smtp.example.com">
						</p>
						<p class="ffx-field">
							<label for="ffx-mail-port"><?php esc_html_e( 'Port', 'funnelforms-free' ); ?></label>
							<input type="number" min="1" max="65535" class="small-text" id="ffx-mail-port" name="port" value="<?php echo esc_attr( (string) ( $config['port'] ?? $preset['port'] ) ); ?>">
						</p>
						<p class="ffx-field">
							<label for="ffx-mail-encryption"><?php esc_html_e( 'Encryption', 'funnelforms-free' ); ?></label>
							<select id="ffx-mail-encryption" name="encryption">
								<?php
								$encryptions = array(
									'tls'  => __( 'TLS (STARTTLS, usually port 587)', 'funnelforms-free' ),
									'ssl'  => __( 'SSL (usually port 465)', 'funnelforms-free' ),
									'none' => __( 'None (not recommended)', 'funnelforms-free' ),
								);
								foreach ( $encryptions as $value => $label ) :
									?>
									<option value="<?php echo esc_attr( $value ); ?>" <?php selected( (string) ( $config['encryption'] ?? $preset['encryption'] ), $value ); ?>><?php echo esc_html( $label ); ?></option>
								<?php endforeach; ?>
							</select>
						</p>
						<p class="ffx-field">
							<label for="ffx-mail-username"><?php esc_html_e( 'User name', 'funnelforms-free' ); ?></label>
							<input type="text" class="code" id="ffx-mail-username" name="username" value="<?php echo esc_attr( (string) ( $config['username'] ?? ( $preset['username'] ?? '' ) ) ); ?>" autocomplete="off" spellcheck="false">
						</p>
						<p class="ffx-field">
							<label for="ffx-mail-password"><?php esc_html_e( 'Password', 'funnelforms-free' ); ?></label>
							<input type="password" class="code" id="ffx-mail-password" name="password" value="" autocomplete="new-password" placeholder="<?php echo esc_attr( '' !== (string) ( $server['secret']['password'] ?? '' ) ? __( 'Saved; leave empty to keep it', 'funnelforms-free' ) : '' ); ?>">
							<small><?php esc_html_e( 'Stored encrypted.', 'funnelforms-free' ); ?></small>
						</p>
						<p class="ffx-field">
							<label for="ffx-mail-from"><?php esc_html_e( 'Sender address', 'funnelforms-free' ); ?></label>
							<input type="email" id="ffx-mail-from" name="from_email" value="<?php echo esc_attr( (string) ( $config['fromEmail'] ?? '' ) ); ?>" autocomplete="off" placeholder="<?php esc_attr_e( 'The user name, if it is an address', 'funnelforms-free' ); ?>">
							<small><?php esc_html_e( 'An address of this account. When a form sets a sender of another domain, that address becomes the reply-to address, so replies still reach it.', 'funnelforms-free' ); ?></small>
						</p>
						<p class="ffx-field">
							<label for="ffx-mail-from-name"><?php esc_html_e( 'Sender name', 'funnelforms-free' ); ?></label>
							<input type="text" id="ffx-mail-from-name" name="from_name" value="<?php echo esc_attr( (string) ( $config['fromName'] ?? '' ) ); ?>" placeholder="<?php echo esc_attr( wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES ) ); ?>">
							<small><?php esc_html_e( 'For mails whose form sets no sender name.', 'funnelforms-free' ); ?></small>
						</p>
					</div>
					<input type="hidden" name="fallback" value="0">
					<label class="ffx-toggle">
						<input type="checkbox" name="fallback" value="1" <?php checked( ! $stored || ! empty( $config['fallback'] ) ); ?>>
						<span class="ffx-toggle__text"><?php esc_html_e( 'If the server cannot be reached or refuses the password, send through WordPress instead', 'funnelforms-free' ); ?></span>
					</label>
					<p class="description"><?php esc_html_e( 'So no notification gets lost while the server is down. This page shows when it happened.', 'funnelforms-free' ); ?></p>
				</div>
				<div class="ffx-card__save">
					<?php submit_button( __( 'Save', 'funnelforms-free' ), 'secondary', 'submit', false ); ?>
					<?php submit_button( __( 'Save and send test mail', 'funnelforms-free' ), 'secondary', 'test', false ); ?>
					<?php if ( $stored ) : ?>
						<?php submit_button( __( 'Remove server', 'funnelforms-free' ), 'secondary ffx-mailserver__remove', 'remove', false ); ?>
					<?php endif; ?>
				</div>
			</form>
		</section>
		<?php
	}
}
