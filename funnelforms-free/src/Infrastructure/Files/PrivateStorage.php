<?php
/**
 * Storage for files visitors upload.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Files;

defined( 'ABSPATH' ) || exit;

/**
 * Uploads go to uploads/funnelforms-private/<year>/<month>/<random name without extension>.
 * The folder denies web access (.htaccess, web.config, index.php); on servers that ignore those
 * files (nginx) the random 128-bit names keep files unguessable, and without an extension they
 * are never run or rendered. Files are only served through Http\FileDownload.
 *
 * Hosts can move the folder outside the web root with the filter funnelforms_private_upload_dir.
 */
final class PrivateStorage {

	/**
	 * Absolute path of the storage folder, without trailing slash.
	 */
	public static function base(): string {
		$default = trailingslashit( wp_upload_dir( null, false )['basedir'] ) . 'funnelforms-private';
		/**
		 * Folder for files visitors upload; best outside the web root.
		 *
		 * @param string $dir Absolute path.
		 */
		return untrailingslashit( (string) apply_filters( 'funnelforms_private_upload_dir', $default ) );
	}

	/**
	 * Absolute path of a stored file, or null for paths that leave the folder.
	 *
	 * @param string $relative Path relative to the folder, as stored in ffx_entry_files.path.
	 */
	public static function absolute( string $relative ): ?string {
		if ( 1 !== preg_match( '#^\d{4}/\d{2}/[a-f0-9]{32}$#', $relative ) ) {
			return null;
		}
		return self::base() . '/' . $relative;
	}

	/**
	 * Moves an uploaded file into the folder after the WordPress type and extension checks.
	 *
	 * @param array<string,mixed>  $file     One entry of $_FILES (name, type, tmp_name, error, size).
	 * @param array<string,string> $mimes    Allowed types, extension pattern => MIME type.
	 * @param bool                 $uploaded True for a real HTTP upload; false for a local file (tests, imports).
	 * @return array{path:string,type:string}|\WP_Error Relative path and checked MIME type.
	 */
	public static function store( array $file, array $mimes, bool $uploaded ) {
		self::protect();
		$sub    = gmdate( 'Y/m' );
		$base   = self::base();
		$random = bin2hex( random_bytes( 16 ) );
		$dirs   = static function ( array $dirs ) use ( $base, $sub ): array {
			return array(
				'path'    => $base . '/' . $sub,
				'url'     => '',
				'subdir'  => '/' . $sub,
				'basedir' => $base,
				'baseurl' => '',
				'error'   => false,
			) + $dirs;
		};

		if ( ! function_exists( 'wp_handle_upload' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		add_filter( 'upload_dir', $dirs, PHP_INT_MAX );
		$overrides = array(
			'test_form'                => false,
			'mimes'                    => $mimes,
			'unique_filename_callback' => static fn(): string => $random,
		);
		$result    = $uploaded ? wp_handle_upload( $file, $overrides ) : wp_handle_sideload( $file, $overrides );
		remove_filter( 'upload_dir', $dirs, PHP_INT_MAX );

		if ( isset( $result['error'] ) ) {
			return new \WP_Error( 'upload_failed', (string) $result['error'] );
		}
		$path = $sub . '/' . $random;
		if ( ! isset( $result['file'] ) || wp_normalize_path( (string) $result['file'] ) !== wp_normalize_path( $base . '/' . $path ) ) {
			// Another plugin moved or renamed the file; it is outside our control then.
			return new \WP_Error( 'upload_failed', 'file_moved' );
		}
		return array(
			'path' => $path,
			'type' => (string) $result['type'],
		);
	}

	/**
	 * Deletes a stored file.
	 *
	 * @param string $relative Relative path.
	 */
	public static function delete( string $relative ): void {
		$path = self::absolute( $relative );
		if ( null !== $path && file_exists( $path ) ) {
			wp_delete_file( $path );
		}
	}

	/**
	 * Creates the folder with files that deny web access.
	 */
	public static function protect(): void {
		self::protect_dir( self::base() );
	}

	/**
	 * Creates a folder with files that deny web access.
	 *
	 * @param string $base Absolute path without trailing slash.
	 */
	public static function protect_dir( string $base ): void {
		if ( file_exists( $base . '/.htaccess' ) ) {
			return;
		}
		wp_mkdir_p( $base );
		if ( ! class_exists( '\WP_Filesystem_Direct' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-base.php';
			require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-direct.php';
		}
		$fs = new \WP_Filesystem_Direct( null );
		// WP_Filesystem() defines FS_CHMOD_FILE; this code may run before it was ever called.
		$mode = defined( 'FS_CHMOD_FILE' ) ? FS_CHMOD_FILE : ( ( fileperms( ABSPATH . 'index.php' ) & 0777 ) | 0644 );
		$fs->put_contents( $base . '/.htaccess', "# Funnelforms: files here are served only through WordPress.\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n", $mode );
		$fs->put_contents( $base . '/web.config', "<?xml version=\"1.0\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n", $mode );
		$fs->put_contents( $base . '/index.php', "<?php\n// Silence is golden.\n", $mode );
	}
}
