<?php
/**
 * Sends the admin mail and the autoresponder of an entry.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Actions;

use Funnelforms\Application\EntryPdf;
use Funnelforms\Domain\Entry\Submission;
use Funnelforms\Domain\Entry\Templates;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Files\PrivateStorage;
use Funnelforms\Infrastructure\Repository\ConnectionRepository;
use Funnelforms\Infrastructure\Repository\FileRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Mails go through wp_mail, so mail plugins keep working, and through the site's mail server when
 * one is set (MailServer). A form whose 3.x contact form used its own SMTP server keeps it: the
 * connection is applied to PHPMailer for this one mail only.
 */
class Mailer {

	/**
	 * Uploaded files are attached to the admin mail only up to this total size, as in 3.x.
	 */
	public const MAX_ATTACHMENTS_MB = 10;

	/**
	 * Creates the mailer.
	 *
	 * @param ConnectionRepository $connections Connections.
	 * @param FileRepository|null  $files       Uploaded files, for attachments.
	 */
	public function __construct( private ConnectionRepository $connections, private ?FileRepository $files = null ) {}

	/**
	 * Sends one mail.
	 *
	 * @param array<string,mixed> $config       Email config of the action.
	 * @param Submission          $s            Submission.
	 * @param bool                $attach_files Attach the uploaded files (admin mail in 3.x). With
	 *                                          attachPdf in the config the entry's PDF is attached too.
	 * @return ?string Error code, null when sent; "no_recipient" when there is nobody to send to.
	 */
	public function send( array $config, Submission $s, bool $attach_files = false ): ?string {
		$text = fn( string $key, string $mode ) => Templates::render( $s->document->text( $config[ $key ] ?? array(), $s->locale ), $s, $mode );

		$to = self::addresses( $text( 'to', Templates::TEXT ) );
		if ( array() === $to ) {
			return 'no_recipient';
		}
		$headers   = array( 'Content-Type: text/html; charset=UTF-8' );
		$from      = self::addresses( $text( 'from', Templates::TEXT ) );
		$from_name = str_replace( array( '"', '<', '>' ), '', $text( 'fromName', Templates::TEXT ) );
		if ( array() !== $from ) {
			$headers[] = 'From: ' . ( '' !== $from_name ? '"' . $from_name . '" ' : '' ) . '<' . $from[0] . '>';
		}
		foreach ( array(
			'Reply-To' => 'replyTo',
			'Cc'       => 'cc',
			'Bcc'      => 'bcc',
		) as $header => $key ) {
			foreach ( self::addresses( $text( $key, Templates::TEXT ) ) as $address ) {
				$headers[] = $header . ': ' . $address;
			}
		}

		$designed = 'branded' === ( $config['layout'] ?? '' );
		$body     = $text( 'body', $designed ? Templates::CARD : Templates::HTML );
		if ( ! empty( $config['nl2br'] ) ) {
			$body = nl2br( $body );
		}
		$attachments = $attach_files ? $this->attachments( $s ) : array();
		if ( null === $attachments ) {
			$attachments = array();
			$body       .= '<br><br>' . esc_html__( 'The files were not sent as e-mail attachments due to the file size!', 'funnelforms-free' );
		}
		$fixed = self::local_file( (string) ( $config['attachmentUrl'] ?? '' ) );
		if ( null !== $fixed ) {
			$attachments[] = $fixed;
		}
		if ( $designed ) {
			$body = MailLayout::wrap( $body, $s, $attach_files );
		}
		$pdf = empty( $config['attachPdf'] ) ? null : $this->pdf( $s, $attach_files );
		if ( null !== $pdf ) {
			$attachments[ $pdf['name'] ] = $pdf['path'];
		}

		$smtp = null;
		if ( 'smtp' === ( $config['transport']['type'] ?? '' ) ) {
			$connection = $this->connections->by_ref( (string) ( $config['transport']['connectionRef'] ?? '' ) );
			if ( null === $connection || ! isset( $connection['secret']['password'] ) ) {
				return 'smtp_connection_missing';
			}
			$smtp = static function ( $phpmailer ) use ( $connection ): void {
				$phpmailer->isSMTP();
				$phpmailer->Host       = (string) $connection['config']['host']; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
				$phpmailer->Port       = (int) $connection['config']['port']; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
				$phpmailer->SMTPAuth   = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
				$phpmailer->Username   = (string) $connection['config']['username']; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
				$phpmailer->Password   = (string) $connection['secret']['password']; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
				$phpmailer->SMTPSecure = 'tls' === ( $connection['config']['encryption'] ?? 'ssl' ) ? 'tls' : 'ssl'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
			};
			add_action( 'phpmailer_init', $smtp );
		}

		$mail = static fn() => wp_mail( $to, $text( 'subject', Templates::TEXT ), $body, $headers, $attachments );
		// The form's own SMTP connection (3.x) comes first; otherwise the site's mail server, if set.
		[ $sent, $message ] = null === $smtp ? MailServer::send( $mail ) : MailError::capture( $mail );

		if ( null !== $smtp ) {
			remove_action( 'phpmailer_init', $smtp );
		}
		if ( null !== $pdf ) {
			wp_delete_file( $pdf['path'] );
		}
		return $sent ? null : MailError::job_error( $message );
	}

	/**
	 * Sends a mail the plugin wrote itself (appointment invitations), through wp_mail and the site's
	 * mail server.
	 *
	 * @param string[]             $to          Recipients.
	 * @param string               $subject     Subject.
	 * @param string               $html        Body (HTML, escaped by the caller).
	 * @param array<string,string> $attachments File paths by the name the recipient sees.
	 * @return ?string Error code, null when sent.
	 */
	public function deliver( array $to, string $subject, string $html, array $attachments = array() ): ?string {
		if ( array() === $to ) {
			return 'no_recipient';
		}
		[ $sent, $message ] = MailServer::send( static fn() => wp_mail( $to, $subject, $html, array( 'Content-Type: text/html; charset=UTF-8' ), $attachments ) );
		return $sent ? null : MailError::job_error( $message );
	}

	/**
	 * Writes the PDF of the entry to a temporary file; null when that fails, and in Funnelforms
	 * Free, which has no PDF.
	 *
	 * @param Submission $s     Submission.
	 * @param bool       $admin Admin mail (texts in the site's language) or autoresponder (the visitor's).
	 * @return array{name:string,path:string}|null File name for the recipient and path.
	 */
	private function pdf( Submission $s, bool $admin ): ?array {
		$writer = Edition::pro( EntryPdf::class );
		if ( null === $writer ) {
			return null;
		}
		if ( ! function_exists( 'wp_tempnam' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		$path = wp_tempnam( 'funnelforms-entry.pdf' );
		if ( '' === $path ) {
			return null;
		}
		$written = file_put_contents( $path, ( new $writer( $this->files ) )->for_submission( $s, $admin ? '' : $s->locale ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- temporary file of this request.
		return false === $written ? null : array(
			'name' => $writer::file_name( $writer::title( $s ), $s->entry_id ),
			'path' => $path,
		);
	}

	/**
	 * Uploaded files of the entry by file name, for wp_mail; null when they are too large together.
	 *
	 * @param Submission $s Submission.
	 * @return array<string,string>|null
	 */
	private function attachments( Submission $s ): ?array {
		if ( null === $this->files ) {
			return array();
		}
		$out   = array();
		$total = 0;
		foreach ( $s->answered_step_fields() as $field ) {
			foreach ( $s->files( $field ) as $file ) {
				$row  = $this->files->find( $file['id'] );
				$path = null === $row ? null : PrivateStorage::absolute( (string) $row['path'] );
				if ( null === $path || ! is_readable( $path ) ) {
					continue;
				}
				$total += (int) $row['size'];
				$name   = sanitize_file_name( (string) $row['original_name'] );
				// Same name twice: keep both.
				$out[ isset( $out[ $name ] ) ? $row['id'] . '-' . $name : $name ] = $path;
			}
		}
		return $total > self::MAX_ATTACHMENTS_MB * MB_IN_BYTES ? null : $out;
	}

	/**
	 * Local path of a file in the media library given by its URL (autoresponder attachment of 3.x).
	 * 3.x mapped the URL to any path below wp-content; here only files inside the uploads folder
	 * are attached, and remote URLs are never fetched.
	 *
	 * @param string $url File URL.
	 */
	public static function local_file( string $url ): ?string {
		if ( '' === $url ) {
			return null;
		}
		$uploads = wp_upload_dir( null, false );
		$path    = null;
		$id      = attachment_url_to_postid( $url );
		if ( $id > 0 ) {
			$path = get_attached_file( $id );
		} else {
			// Sites that moved domain: match on the part below the uploads folder.
			$marker = '/' . trim( (string) wp_parse_url( $uploads['baseurl'], PHP_URL_PATH ), '/' ) . '/';
			$at     = strpos( (string) wp_parse_url( $url, PHP_URL_PATH ), $marker );
			if ( false !== $at ) {
				$path = $uploads['basedir'] . '/' . rawurldecode( substr( (string) wp_parse_url( $url, PHP_URL_PATH ), $at + strlen( $marker ) ) );
			}
		}
		$real = is_string( $path ) ? realpath( $path ) : false;
		$base = realpath( $uploads['basedir'] );
		if ( false === $real || false === $base || ! str_starts_with( $real, $base . DIRECTORY_SEPARATOR ) || ! is_file( $real ) ) {
			return null;
		}
		return $real;
	}

	/**
	 * Valid addresses of a comma or semicolon separated list.
	 *
	 * @param string $addresses Addresses.
	 * @return string[]
	 */
	public static function addresses( string $addresses ): array {
		$out = array();
		foreach ( preg_split( '/[,;]/', $addresses ) as $part ) {
			$address = sanitize_email( trim( (string) $part ) );
			if ( '' !== $address && is_email( $address ) ) {
				$out[] = $address;
			}
		}
		return $out;
	}
}
