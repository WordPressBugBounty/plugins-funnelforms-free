<?php
/**
 * What went wrong when wp_mail() failed, as a code without addresses.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Actions;

defined( 'ABSPATH' ) || exit;

/**
 * PHPMailer's messages name addresses, so the delivery log keeps only a code derived from them.
 * Mail plugins that replace wp_mail() report their own texts; those end up as "other".
 */
final class MailError {

	public const SMTP_CONNECT    = 'smtp_connect';
	public const SMTP_AUTH       = 'smtp_auth';
	public const MAIL_FUNCTION   = 'mail_function';
	public const INVALID_ADDRESS = 'invalid_address';
	public const REJECTED        = 'rejected';
	public const OTHER           = 'other';

	/**
	 * Message parts of PHPMailer per code (WordPress keeps PHPMailer's English messages).
	 */
	private const PATTERNS = array(
		self::SMTP_AUTH       => '/could not authenticate|authentication/i',
		self::SMTP_CONNECT    => '/connect\(\) failed|could not connect|failed to connect|connection (refused|timed out)/i',
		self::MAIL_FUNCTION   => '/could not instantiate mail function/i',
		self::INVALID_ADDRESS => '/invalid address|at least one recipient/i',
		self::REJECTED        => '/data not accepted|recipients failed|not accepted|sender address rejected|relay/i',
	);

	/**
	 * Code of a wp_mail_failed message.
	 *
	 * @param string $message Error message.
	 */
	public static function code( string $message ): string {
		foreach ( self::PATTERNS as $code => $pattern ) {
			if ( 1 === preg_match( $pattern, $message ) ) {
				return $code;
			}
		}
		return self::OTHER;
	}

	/**
	 * Sends a mail through wp_mail() and reports why it failed.
	 *
	 * @param callable(): bool $send Calls wp_mail().
	 * @return array{0: bool, 1: string} Whether it was sent, and the error message.
	 */
	public static function capture( callable $send ): array {
		$message = '';
		$catch   = static function ( $error ) use ( &$message ): void {
			$message = is_wp_error( $error ) ? $error->get_error_message() : '';
		};
		add_action( 'wp_mail_failed', $catch );
		try {
			$sent = (bool) $send();
		} finally {
			remove_action( 'wp_mail_failed', $catch );
		}
		return array( $sent, $message );
	}

	/**
	 * Error code of the delivery log; an invalid address will not get better by retrying.
	 *
	 * @param string $message Error message.
	 */
	public static function job_error( string $message ): string {
		$code = self::code( $message );
		return ( self::INVALID_ADDRESS === $code ? 'permanent:' : '' ) . 'wp_mail_failed:' . $code;
	}
}
