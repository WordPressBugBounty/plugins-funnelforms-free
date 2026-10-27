<?php
/**
 * The site's own mail server for the mails of Funnelforms (SMTP).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Actions;

use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\ConnectionRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Funnelforms → Settings → E-mail: the mails of Funnelforms (notifications, confirmations, opt-in,
 * reminders) go through the SMTP server of the site's mail provider instead of the way
 * WordPress sends mails. Other mails of the site stay as they are. The server is applied to
 * PHPMailer for one mail at a time, after mail plugins, and still through wp_mail(), so filters and
 * logging plugins keep seeing the mail.
 *
 * Providers check that the sender belongs to the account: a sender of another domain becomes the
 * reply-to address and the mail goes out from the address set here. When the server cannot be
 * reached or refuses the login, the mail goes out the WordPress way instead (unless switched off),
 * and the settings show the problem.
 */
final class MailServer {

	public const REF  = 'site:mailserver';
	public const TYPE = 'mailserver';

	/** Latest problem with the server: time and MailError code, never addresses. */
	public const FAILURE = 'funnelforms_mailserver_failure';

	public const ENCRYPTIONS = array( 'tls', 'ssl', 'none' );

	/**
	 * Known providers: name, server, port, encryption, user name when it is fixed.
	 *
	 * @var array<string,array{name:string,host:string,port:int,encryption:string,username?:string}>
	 */
	public const PROVIDERS = array(
		'custom'    => array(
			'name'       => '',
			'host'       => '',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'gmail'     => array(
			'name'       => 'Gmail / Google Workspace',
			'host'       => 'smtp.gmail.com',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'microsoft' => array(
			'name'       => 'Microsoft 365 / Outlook',
			'host'       => 'smtp.office365.com',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'ionos'     => array(
			'name'       => 'IONOS',
			'host'       => 'smtp.ionos.de',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'strato'    => array(
			'name'       => 'STRATO',
			'host'       => 'smtp.strato.de',
			'port'       => 465,
			'encryption' => 'ssl',
		),
		'allinkl'   => array(
			'name'       => 'ALL-INKL.COM',
			'host'       => '',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'hetzner'   => array(
			'name'       => 'Hetzner',
			'host'       => 'mail.your-server.de',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'zoho'      => array(
			'name'       => 'Zoho Mail',
			'host'       => 'smtp.zoho.eu',
			'port'       => 465,
			'encryption' => 'ssl',
		),
		'brevo'     => array(
			'name'       => 'Brevo',
			'host'       => 'smtp-relay.brevo.com',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'sendgrid'  => array(
			'name'       => 'SendGrid',
			'host'       => 'smtp.sendgrid.net',
			'port'       => 587,
			'encryption' => 'tls',
			'username'   => 'apikey',
		),
		'mailgun'   => array(
			'name'       => 'Mailgun',
			'host'       => 'smtp.eu.mailgun.org',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'ses'       => array(
			'name'       => 'Amazon SES',
			'host'       => 'email-smtp.eu-central-1.amazonaws.com', // phpcs:ignore PluginCheck.CodeAnalysis.Offloading.OffloadedContent -- SMTP server the site owner picks, nothing is loaded from it.
			'port'       => 587,
			'encryption' => 'tls',
		),
		'postmark'  => array(
			'name'       => 'Postmark',
			'host'       => 'smtp.postmarkapp.com',
			'port'       => 587,
			'encryption' => 'tls',
		),
		'mailjet'   => array(
			'name'       => 'Mailjet',
			'host'       => 'in-v3.mailjet.com',
			'port'       => 587,
			'encryption' => 'tls',
		),
	);

	/**
	 * Where to find the access data of a provider.
	 *
	 * @param string $provider Key of PROVIDERS.
	 */
	public static function hint( string $provider ): string {
		switch ( $provider ) {
			case 'gmail':
				return __( 'User name: your full e-mail address. Password: an app password of your Google account (needs 2-step verification), not your normal password.', 'funnelforms-free' );
			case 'microsoft':
				return __( 'User name and password of the mailbox. SMTP sign-in (SMTP AUTH) must be allowed for the mailbox in the Microsoft 365 admin center.', 'funnelforms-free' );
			case 'allinkl':
				return __( 'Enter the server shown for your mailbox in the KAS (for example w0123456.kasserver.com), and the user name and password of the mailbox.', 'funnelforms-free' );
			case 'brevo':
				return __( 'User name and password: the SMTP login and an SMTP key under SMTP & API in Brevo.', 'funnelforms-free' );
			case 'sendgrid':
				return __( 'User name: apikey. Password: an API key with the right "Mail Send".', 'funnelforms-free' );
			case 'mailgun':
				return __( 'The SMTP user and password of your domain in Mailgun. For accounts in the US region the server is smtp.mailgun.org.', 'funnelforms-free' );
			case 'ses':
				return __( 'The SMTP credentials of Amazon SES, not your AWS access key. Change the region in the server name if your account uses another one.', 'funnelforms-free' );
			case 'postmark':
				return __( 'User name and password: both the API token of your Postmark server.', 'funnelforms-free' );
			case 'mailjet':
				return __( 'User name: the API key. Password: the secret key.', 'funnelforms-free' );
			case 'custom':
				return __( 'Server, port and encryption are in the help of your mail provider or host, often under "SMTP" or "e-mail program".', 'funnelforms-free' );
			default:
				return __( 'User name and password of the mailbox, usually your full e-mail address and its password.', 'funnelforms-free' );
		}
	}

	/**
	 * The stored server, with the password; empty when none is set up.
	 *
	 * @return array{type?:string,config?:array<string,mixed>,secret?:array<string,mixed>}
	 */
	public static function settings(): array {
		return self::repository()->by_ref( self::REF ) ?? array();
	}

	/**
	 * Whether Funnelforms sends its mails through the server.
	 */
	public static function active(): bool {
		return null !== self::usable();
	}

	/**
	 * Server name of the active server, for texts.
	 */
	public static function host(): string {
		return (string) ( self::usable()['config']['host'] ?? '' );
	}

	/**
	 * Saves the server. An empty password keeps the stored one; switched off, the data stay for
	 * the next time.
	 *
	 * @param array<string,mixed> $input enabled, provider, host, port, encryption, username, password,
	 *                                   fromEmail, fromName, fallback.
	 */
	public static function save( array $input ): void {
		$current  = self::settings();
		$provider = (string) ( $input['provider'] ?? 'custom' );
		$provider = isset( self::PROVIDERS[ $provider ] ) ? $provider : 'custom';
		$preset   = self::PROVIDERS[ $provider ];
		$host     = strtolower( trim( (string) ( $input['host'] ?? '' ) ) );
		$host     = 1 === preg_match( '/^[a-z0-9.-]{1,253}$/', $host ) ? $host : $preset['host'];
		$port     = (int) ( $input['port'] ?? 0 );
		$port     = $port > 0 && $port <= 65535 ? $port : $preset['port'];
		$secure   = (string) ( $input['encryption'] ?? '' );
		$username = trim( (string) ( $input['username'] ?? '' ) );
		$password = (string) ( $input['password'] ?? '' );
		if ( '' === $password ) {
			$password = (string) ( $current['secret']['password'] ?? '' );
		}
		$from = sanitize_email( (string) ( $input['fromEmail'] ?? '' ) );
		self::repository()->save(
			array(
				'ref'    => self::REF,
				'type'   => self::TYPE,
				'label'  => $host,
				'config' => array(
					'enabled'    => ! empty( $input['enabled'] ),
					'provider'   => $provider,
					'host'       => $host,
					'port'       => $port,
					'encryption' => in_array( $secure, self::ENCRYPTIONS, true ) ? $secure : $preset['encryption'],
					'username'   => $preset['username'] ?? $username,
					'fromEmail'  => is_email( $from ) ? $from : '',
					'fromName'   => trim( str_replace( array( '"', '<', '>' ), '', sanitize_text_field( (string) ( $input['fromName'] ?? '' ) ) ) ),
					'fallback'   => ! empty( $input['fallback'] ),
				),
				'secret' => array( 'password' => $password ),
			)
		);
		delete_option( self::FAILURE );
	}

	/**
	 * Removes the server.
	 */
	public static function delete(): void {
		self::repository()->delete( self::REF );
		delete_option( self::FAILURE );
	}

	/**
	 * Sends a mail of Funnelforms: through the server when one is active, else as WordPress does.
	 *
	 * @param callable(): bool $send     Calls wp_mail().
	 * @param bool|null        $fallback Send the WordPress way when the server fails; null: as set.
	 * @return array{0: bool, 1: string} Whether it was sent, and the error message (MailError::capture).
	 */
	public static function send( callable $send, ?bool $fallback = null ): array {
		$server = self::usable();
		if ( null === $server ) {
			return MailError::capture( $send );
		}
		$apply = static function ( $phpmailer ) use ( $server ): void {
			self::configure( $phpmailer, $server );
		};
		// After mail plugins (default priority), so this server wins for the mails of Funnelforms.
		add_action( 'phpmailer_init', $apply, PHP_INT_MAX );
		try {
			[ $sent, $message ] = MailError::capture( $send );
		} finally {
			remove_action( 'phpmailer_init', $apply, PHP_INT_MAX );
			// wp_mail() reuses its PHPMailer and resets neither: the next mail must not take them along.
			if ( isset( $GLOBALS['phpmailer'] ) && is_object( $GLOBALS['phpmailer'] ) ) {
				$GLOBALS['phpmailer']->Sender   = ''; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
				$GLOBALS['phpmailer']->Password = ''; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
			}
		}
		if ( $sent ) {
			return array( $sent, $message );
		}
		$code = MailError::code( $message );
		update_option(
			self::FAILURE,
			array(
				'time' => time(),
				'code' => $code,
			),
			false
		);
		// Only when the server took nothing: neither reached nor signed in. A refused recipient
		// would be refused the other way too.
		$fallback = $fallback ?? ! empty( $server['config']['fallback'] );
		if ( $fallback && in_array( $code, array( MailError::SMTP_CONNECT, MailError::SMTP_AUTH ), true ) ) {
			return MailError::capture( $send );
		}
		return array( $sent, $message );
	}

	/**
	 * Latest problem with the server, while it is active.
	 *
	 * @return array{time:int,code:string}|null
	 */
	public static function failure(): ?array {
		$failure = get_option( self::FAILURE );
		if ( ! is_array( $failure ) || ! isset( $failure['time'], $failure['code'] ) ) {
			return null;
		}
		return array(
			'time' => (int) $failure['time'],
			'code' => (string) $failure['code'],
		);
	}

	/**
	 * Points PHPMailer at the server.
	 *
	 * @param object              $phpmailer PHPMailer of wp_mail().
	 * @param array<string,mixed> $server    Stored server.
	 */
	public static function configure( object $phpmailer, array $server ): void {
		// phpcs:disable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- PHPMailer API.
		$config   = $server['config'];
		$secure   = (string) ( $config['encryption'] ?? 'tls' );
		$username = (string) ( $config['username'] ?? '' );
		$phpmailer->isSMTP();
		$phpmailer->Host        = (string) $config['host'];
		$phpmailer->Port        = (int) $config['port'];
		$phpmailer->SMTPSecure  = 'none' === $secure ? '' : $secure;
		$phpmailer->SMTPAutoTLS = 'none' !== $secure;
		$phpmailer->SMTPAuth    = '' !== $username;
		$phpmailer->Username    = $username;
		$phpmailer->Password    = (string) ( $server['secret']['password'] ?? '' );
		$phpmailer->Timeout     = 15;

		$from = (string) ( $config['fromEmail'] ?? '' );
		if ( '' === $from && is_email( $username ) ) {
			$from = $username;
		}
		if ( '' === $from ) {
			return;
		}
		$name     = (string) $phpmailer->FromName;
		$original = (string) $phpmailer->From;
		$default  = '' === $original || str_starts_with( strtolower( $original ), 'wordpress@' );
		if ( '' === $name || 'WordPress' === $name ) {
			$name = (string) ( $config['fromName'] ?? '' );
			$name = '' === $name ? wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES ) : $name;
		}
		if ( ! $default && self::domain( $original ) === self::domain( $from ) ) {
			$phpmailer->FromName = $name;
			$phpmailer->Sender   = $original;
			return;
		}
		if ( ! $default && array() === $phpmailer->getReplyToAddresses() ) {
			$phpmailer->addReplyTo( $original, $name );
		}
		$phpmailer->setFrom( $from, $name, false );
		$phpmailer->Sender = $from;
		// phpcs:enable WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
	}

	/**
	 * The server when it is switched on and complete.
	 *
	 * @return array{type:string,config:array<string,mixed>,secret:array<string,mixed>}|null
	 */
	private static function usable(): ?array {
		$server = self::settings();
		if ( empty( $server['config']['enabled'] ) || '' === (string) ( $server['config']['host'] ?? '' ) ) {
			return null;
		}
		if ( '' !== (string) ( $server['config']['username'] ?? '' ) && '' === (string) ( $server['secret']['password'] ?? '' ) ) {
			return null;
		}
		return $server;
	}

	/**
	 * Domain of an address, lower case.
	 *
	 * @param string $address Address.
	 */
	private static function domain( string $address ): string {
		$at = strrpos( $address, '@' );
		return false === $at ? '' : strtolower( substr( $address, $at + 1 ) );
	}

	/**
	 * Connections with the site key.
	 */
	private static function repository(): ConnectionRepository {
		return new ConnectionRepository( SecretBox::for_site() );
	}
}
