<?php
/**
 * Download of uploaded files.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Application\Capabilities;

use Funnelforms\Infrastructure\Files\PrivateStorage;
use Funnelforms\Infrastructure\Repository\FileRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Files are served by admin-post.php?action=funnelforms_file&file=<id>&token=<token>, so the
 * WordPress login cookie works for links in mails (REST requests need a nonce for that).
 *
 * - Users with the entries capability (default funnelforms_view_entries, see
 *   Application\Capabilities; filter funnelforms_entries_capability) can always download.
 * - Files of fields set to "public" can be downloaded with the token until expires_at
 *   (3.x links never expired; the lifetime is set by funnelforms_public_file_link_days).
 * - Everyone else is sent to the login.
 */
final class FileDownload {

	public const ACTION = 'funnelforms_file';

	/**
	 * Registers the handlers.
	 */
	public static function register(): void {
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle' ) );
		add_action( 'admin_post_nopriv_' . self::ACTION, array( self::class, 'handle' ) );
	}

	/**
	 * Capability that grants access to entries and their files.
	 */
	public static function capability(): string {
		/**
		 * Capability needed to see entries and download their files.
		 *
		 * @param string $capability Capability.
		 */
		return (string) apply_filters( 'funnelforms_entries_capability', Capabilities::VIEW_ENTRIES );
	}

	/**
	 * Days a public download link works after the submit.
	 */
	public static function public_link_days(): int {
		/**
		 * Days the download links of files in "public" upload fields work (mails, webhooks).
		 *
		 * @param int $days Days; 30 by default.
		 */
		return max( 1, (int) apply_filters( 'funnelforms_public_file_link_days', 30 ) );
	}

	/**
	 * Download link of a file.
	 *
	 * @param int $id File ID.
	 */
	public static function url( int $id ): string {
		return add_query_arg(
			array(
				'action' => self::ACTION,
				'file'   => $id,
				'token'  => self::token( $id ),
			),
			admin_url( 'admin-post.php' )
		);
	}

	/**
	 * Token of a file; derived from its ID with a site secret, so links can be rebuilt for every mail.
	 *
	 * @param int $id File ID.
	 */
	public static function token( int $id ): string {
		return substr( hash_hmac( 'sha256', 'ffx-file|' . $id, wp_salt( 'auth' ) ), 0, 40 );
	}

	/**
	 * Whether a request may download the file.
	 *
	 * @param array<string,mixed> $file  File row.
	 * @param string              $token Token from the link.
	 * @param int                 $now   Current time.
	 */
	public static function allowed( array $file, string $token, int $now ): bool {
		if ( FileRepository::ATTACHED !== $file['status'] ) {
			return false;
		}
		if ( current_user_can( self::capability() ) ) {
			return true;
		}
		return 'public' === $file['visibility']
			&& '' !== $token
			&& hash_equals( self::token( (int) $file['id'] ), $token )
			&& null !== $file['expires_at']
			&& strtotime( $file['expires_at'] . ' UTC' ) > $now;
	}

	/**
	 * Handles the request.
	 */
	public static function handle(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- links in mails carry a file token instead of a nonce; downloading changes nothing.
		$id    = isset( $_GET['file'] ) ? absint( $_GET['file'] ) : 0;
		$token = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : '';
		// phpcs:enable

		$file = 0 === $id ? null : ( new FileRepository() )->find( $id );
		if ( null === $file || ! self::allowed( $file, $token, time() ) ) {
			if ( ! is_user_logged_in() ) {
				auth_redirect();
			}
			wp_die( esc_html__( 'This file is not available.', 'funnelforms-free' ), '', array( 'response' => null === $file ? 404 : 403 ) );
		}

		$path = PrivateStorage::absolute( (string) $file['path'] );
		if ( null === $path || ! is_readable( $path ) ) {
			wp_die( esc_html__( 'This file is not available.', 'funnelforms-free' ), '', array( 'response' => 404 ) );
		}
		self::send( $path, (string) $file['original_name'], (string) $file['mime_type'] );
	}

	/**
	 * Streams the file as a download.
	 *
	 * @param string $path Absolute path.
	 * @param string $name Original file name.
	 * @param string $mime MIME type checked at upload.
	 */
	private static function send( string $path, string $name, string $mime ): void {
		$name = sanitize_file_name( '' !== $name ? $name : 'file' );
		nocache_headers();
		header( 'Content-Type: ' . ( '' !== $mime ? $mime : 'application/octet-stream' ) );
		header( 'Content-Disposition: attachment; filename="' . str_replace( '"', '', $name ) . '"; filename*=UTF-8\'\'' . rawurlencode( $name ) );
		header( 'Content-Length: ' . (string) filesize( $path ) );
		header( 'X-Content-Type-Options: nosniff' );
		header( "Content-Security-Policy: default-src 'none'; sandbox" );
		while ( ob_get_level() > 0 ) {
			ob_end_clean();
		}
		readfile( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- streams large files without loading them into memory.
		exit;
	}
}
