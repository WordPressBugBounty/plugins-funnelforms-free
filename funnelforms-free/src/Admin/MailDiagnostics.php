<?php
/**
 * Mail check on the Funnelforms page: a test mail and the latest deliveries.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Actions\MailError;
use Funnelforms\Application\Actions\MailServer;
use Funnelforms\Application\Capabilities;
use Funnelforms\Application\DoubleOptIn;
use Funnelforms\Domain\Form\Document;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\EntryRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- reads this plugin's delivery log, fresh on purpose.

/**
 * Most "the form sends no mails" tickets come down to the site's mail setup. The test mail goes
 * the same way as the mails of the forms (wp_mail with the site's mail plugin) and says why it
 * failed. The delivery log lists the latest mails, webhooks and CRM transfers with their outcome,
 * without recipients or entry content.
 */
final class MailDiagnostics {

	public const ACTION  = 'funnelforms_test_mail';
	private const RESULT = 'funnelforms_test_mail_';
	private const RECENT = 20;

	/**
	 * Registers the handler of the test mail.
	 */
	public static function register(): void {
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle_test' ) );
	}

	/**
	 * Sends the test mail to the current administrator and keeps the outcome for the page.
	 */
	public static function handle_test(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::ACTION );
		self::test();
		wp_safe_redirect( add_query_arg( 'mailtest', '1', SettingsPage::url( 'mail', 'ffx-mail' ) ) );
		exit;
	}

	/**
	 * Sends the test mail to the current user and keeps the outcome for notice().
	 */
	public static function test(): void {
		$to = (string) wp_get_current_user()->user_email;
		set_transient( self::RESULT . get_current_user_id(), self::send_test( $to ) + array( 'to' => $to ), 10 * MINUTE_IN_SECONDS );
	}

	/**
	 * Sends a test mail. Through the site's mail server it does not fall back to WordPress, so the
	 * outcome is the server's.
	 *
	 * @param string $to Address.
	 * @return array{sent: bool, code: string, message: string}
	 */
	public static function send_test( string $to ): array {
		/* translators: %s: site title. */
		$subject = sprintf( __( '[%s] Funnelforms test mail', 'funnelforms-free' ), wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES ) );
		$body    = __( 'This mail took the same way as the mails of your forms. If it arrived, WordPress can send mails; check the spam folder for mails of your forms, and the addresses in the forms.', 'funnelforms-free' );

		[ $sent, $message ] = MailServer::send( static fn() => wp_mail( $to, $subject, $body ), false );
		return array(
			'sent'    => $sent,
			'code'    => $sent ? '' : MailError::code( $message ),
			'message' => $sent ? '' : wp_strip_all_tags( $message ),
		);
	}

	/**
	 * How Funnelforms sends mails.
	 */
	public static function transport(): string {
		if ( MailServer::active() ) {
			/* translators: %s: name of the SMTP server, e.g. smtp.gmail.com. */
			return sprintf( __( 'Funnelforms sends its mails through the SMTP server %s (Settings → E-mail).', 'funnelforms-free' ), MailServer::host() );
		}
		return self::wordpress_transport();
	}

	/**
	 * How WordPress sends mails on this site.
	 */
	public static function wordpress_transport(): string {
		if ( has_filter( 'pre_wp_mail' ) || has_action( 'phpmailer_init' ) ) {
			return __( 'A mail plugin sends the mails of this site, or changes how they are sent.', 'funnelforms-free' );
		}
		return __( 'This site sends mails with the mail function of the server. Such mails often land in spam or get lost; a mail plugin that sends through the SMTP server of your mail provider is more reliable.', 'funnelforms-free' );
	}

	/**
	 * What to do about a failed mail.
	 *
	 * @param string $code MailError code.
	 */
	public static function hint( string $code ): string {
		switch ( $code ) {
			case MailError::SMTP_CONNECT:
				return __( 'The SMTP server could not be reached. Check host, port and encryption, and ask your host whether outgoing SMTP connections are allowed.', 'funnelforms-free' );
			case MailError::SMTP_AUTH:
				return __( 'The SMTP server refused the user name or password.', 'funnelforms-free' );
			case MailError::MAIL_FUNCTION:
				return __( 'The server cannot send mails with PHP. Use a mail plugin with the SMTP server of your mail provider.', 'funnelforms-free' );
			case MailError::INVALID_ADDRESS:
				return __( 'An address of the mail is not valid. Check the recipient and the sender in the mail settings of the form.', 'funnelforms-free' );
			case MailError::REJECTED:
				return __( 'The mail server refused the mail, often because the sender address does not belong to the domain of the server. Use a sender address of your own domain.', 'funnelforms-free' );
			default:
				return __( 'The mail could not be sent.', 'funnelforms-free' );
		}
	}

	/**
	 * Latest deliveries, newest first.
	 *
	 * @param int $limit Rows.
	 * @return array<int,array{id: int, time: string, form: string, kind: string, status: string, attempts: int, error: string}>
	 */
	public static function recent( int $limit = self::RECENT ): array {
		global $wpdb;
		$rows    = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT j.id, j.entry_id, j.channel, j.status, j.attempts, j.last_error, j.updated_at, f.title FROM %i j LEFT JOIN %i e ON e.id = j.entry_id LEFT JOIN %i f ON f.id = e.form_id ORDER BY j.updated_at DESC, j.id DESC LIMIT %d',
				Schema::table( 'jobs_log' ),
				Schema::table( 'entries' ),
				Schema::table( 'forms' ),
				$limit
			),
			ARRAY_A
		);
		$entries = new EntryRepository();
		$forms   = new FormRepository();
		$out     = array();
		$optin   = Edition::pro( DoubleOptIn::class );
		foreach ( $rows as $row ) {
			$entry    = $entries->find( (int) $row['entry_id'] );
			$revision = (int) ( $entry['meta']['v5']['revisionId'] ?? 0 );
			$document = $revision > 0 ? $forms->document( $revision ) : null;
			$action   = null === $document ? null : ( new Document( $document ) )->action( (string) $row['channel'] );
			$action   = null !== $optin && $optin::JOB === $row['channel'] ? array( 'kind' => 'optin' ) : $action;
			$out[]    = array(
				'id'       => (int) $row['id'],
				'time'     => (string) $row['updated_at'],
				'form'     => (string) ( $row['title'] ?? '' ),
				'kind'     => self::kind_label( $action ),
				'status'   => (string) $row['status'],
				'attempts' => (int) $row['attempts'],
				'error'    => (string) $row['last_error'],
			);
		}
		return $out;
	}

	/**
	 * Readable kind of an action.
	 *
	 * @param array<string,mixed>|null $action Action of the form document.
	 */
	private static function kind_label( ?array $action ): string {
		switch ( $action['kind'] ?? '' ) {
			case 'email':
				return __( 'Notification mail', 'funnelforms-free' );
			case 'autoresponder':
				return __( 'Autoresponder', 'funnelforms-free' );
			case 'webhook':
				return __( 'Webhook', 'funnelforms-free' );
			case 'sms':
				return 'SMS';
			case 'whatsapp':
				return 'WhatsApp';
			case 'conversion':
				$platforms = array(
					'meta'   => 'Meta Conversions API',
					'ga4'    => 'Google Analytics 4',
					'tiktok' => 'TikTok Events API',
				);
				return $platforms[ $action['config']['platform'] ?? '' ] ?? '–';
			case 'optin':
				return __( 'Double opt-in mail', 'funnelforms-free' );
			case 'chat':
				return 'teams' === ( $action['config']['service'] ?? '' ) ? 'Microsoft Teams' : 'Slack';
			case 'crm':
				/* translators: %s: name of the CRM, e.g. hubspot. */
				return sprintf( __( 'CRM: %s', 'funnelforms-free' ), (string) ( $action['config']['provider'] ?? '' ) );
			default:
				return '–';
		}
	}

	/**
	 * Readable status of a delivery.
	 *
	 * @param string $status Job status.
	 */
	private static function status_label( string $status ): string {
		$labels = array(
			'queued'   => __( 'Waiting', 'funnelforms-free' ),
			'retrying' => __( 'Trying again', 'funnelforms-free' ),
			'sent'     => __( 'Sent', 'funnelforms-free' ),
			'skipped'  => __( 'Skipped', 'funnelforms-free' ),
			'failed'   => __( 'Failed', 'funnelforms-free' ),
		);
		return $labels[ $status ] ?? $status;
	}

	/**
	 * Explanation of a delivery error, for mails; the code itself for the rest.
	 *
	 * @param string $error Error of the delivery log.
	 */
	private static function error_text( string $error ): string {
		if ( 1 === preg_match( '/wp_mail_failed:([a-z_]+)$/', $error, $m ) ) {
			return self::hint( $m[1] );
		}
		if ( 'no_recipient' === $error ) {
			return __( 'The mail has no recipient; the field with the address was empty.', 'funnelforms-free' );
		}
		if ( 'condition_not_met' === $error ) {
			return __( 'Not sent on purpose: the condition of this action did not hold for the entry.', 'funnelforms-free' );
		}
		return $error;
	}

	/**
	 * Outcome of the latest test mail of the current user, once.
	 */
	public static function notice(): void {
		$result = get_transient( self::RESULT . get_current_user_id() );
		if ( ! is_array( $result ) ) {
			return;
		}
		delete_transient( self::RESULT . get_current_user_id() );
		?>
		<?php if ( $result['sent'] ) : ?>
			<div class="notice notice-success inline"><p>
				<?php
				/* translators: %s: e-mail address. */
				printf( esc_html__( 'The test mail was handed over to the mail system for %s. If it does not arrive within a few minutes, look in the spam folder.', 'funnelforms-free' ), esc_html( (string) $result['to'] ) );
				?>
			</p></div>
		<?php else : ?>
			<div class="notice notice-error inline">
				<p><strong><?php echo esc_html( self::hint( (string) $result['code'] ) ); ?></strong></p>
				<?php if ( '' !== $result['message'] ) : ?>
					<p><?php esc_html_e( 'Message of the mail system:', 'funnelforms-free' ); ?> <code><?php echo esc_html( (string) $result['message'] ); ?></code></p>
				<?php endif; ?>
			</div>
		<?php endif; ?>
		<?php
	}

	/**
	 * The section on the Funnelforms page.
	 */
	public static function render(): void {
		$recent = self::recent();
		?>
		<h2 id="ffx-mail"><?php esc_html_e( 'Mails and deliveries', 'funnelforms-free' ); ?></h2>
		<?php
		if ( isset( $_GET['mailtest'] ) && '1' === $_GET['mailtest'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
			self::notice();
		}
		?>
		<p><?php echo esc_html( self::transport() ); ?></p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
			<?php wp_nonce_field( self::ACTION ); ?>
			<?php submit_button( __( 'Send a test mail to me', 'funnelforms-free' ), 'secondary', 'submit', false ); ?>
		</form>
		<?php if ( array() !== $recent ) : ?>
			<p><?php esc_html_e( 'Latest deliveries of forms on the new renderer. Failed ones are tried again up to three times; an entry can be sent again from the entry.', 'funnelforms-free' ); ?></p>
			<table class="widefat striped" style="max-width:72rem">
				<thead>
					<tr>
						<th scope="col"><?php esc_html_e( 'Time (UTC)', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Form', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Delivery', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Status', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Attempts', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Problem', 'funnelforms-free' ); ?></th>
					</tr>
				</thead>
				<tbody>
					<?php foreach ( $recent as $row ) : ?>
						<tr>
							<td><?php echo esc_html( $row['time'] ); ?></td>
							<td><?php echo esc_html( $row['form'] ); ?></td>
							<td><?php echo esc_html( $row['kind'] ); ?></td>
							<td><?php echo esc_html( self::status_label( $row['status'] ) ); ?></td>
							<td><?php echo esc_html( (string) $row['attempts'] ); ?></td>
							<td><?php echo esc_html( self::error_text( $row['error'] ) ); ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>
		<?php
	}
}
