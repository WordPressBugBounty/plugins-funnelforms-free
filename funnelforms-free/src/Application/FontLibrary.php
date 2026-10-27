<?php
/**
 * Fonts uploaded for forms, hosted on the site.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

defined( 'ABSPATH' ) || exit;

/**
 * The fonts sit in uploads/af2_fonts, the folder of Funnelforms 3, so forms of both versions see
 * the same fonts (Frontend\FormFont loads them). Only font files are accepted: the extension,
 * the first bytes and the size are checked, and the name is reduced to letters, digits,
 * spaces, "_" and "-".
 */
final class FontLibrary {

	/**
	 * Largest font file, in bytes (FormFont embeds fonts up to this size in the preview).
	 */
	public const MAX_BYTES = 2 * MB_IN_BYTES;

	/**
	 * First bytes of each font format.
	 */
	private const MAGIC = array(
		'ttf'   => array( "\x00\x01\x00\x00", 'true' ),
		'otf'   => array( 'OTTO' ),
		'woff'  => array( 'wOFF' ),
		'woff2' => array( 'wOF2' ),
	);

	/**
	 * The folder of the fonts.
	 */
	public static function dir(): string {
		return wp_upload_dir( null, false )['basedir'] . '/af2_fonts';
	}

	/**
	 * Fonts in the folder, by name.
	 *
	 * @return array<int,array{file:string,family:string,size:int}>
	 */
	public static function all(): array {
		$out   = array();
		$files = is_dir( self::dir() ) ? (array) scandir( self::dir() ) : array();
		foreach ( $files as $file ) {
			$file = (string) $file;
			if ( 1 === preg_match( '/^([A-Za-z0-9 _-]{1,60})\.(ttf|otf|woff2?)$/i', $file, $m ) && is_file( self::dir() . '/' . $file ) ) {
				$out[] = array(
					'file'   => $file,
					'family' => trim( $m[1] ),
					'size'   => (int) filesize( self::dir() . '/' . $file ),
				);
			}
		}
		usort( $out, static fn( array $a, array $b ): int => strcasecmp( $a['file'], $b['file'] ) );
		return $out;
	}

	/**
	 * Stores an uploaded font.
	 *
	 * @param array<string,mixed> $file     One entry of $_FILES (name, tmp_name, error, size).
	 * @param bool                $uploaded True for a real HTTP upload; false for a local file (tests).
	 * @return array{file:string,family:string,size:int}|string The font, or an error code:
	 *         upload_failed, font_too_large, not_a_font.
	 */
	public static function add( array $file, bool $uploaded ) {
		$tmp = (string) ( $file['tmp_name'] ?? '' );
		if ( UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) || ! is_file( $tmp ) || ( $uploaded && ! is_uploaded_file( $tmp ) ) ) {
			return in_array( (int) ( $file['error'] ?? 0 ), array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) ? 'font_too_large' : 'upload_failed';
		}
		if ( filesize( $tmp ) > self::MAX_BYTES ) {
			return 'font_too_large';
		}
		$ext = strtolower( pathinfo( (string) ( $file['name'] ?? '' ), PATHINFO_EXTENSION ) );
		if ( ! isset( self::MAGIC[ $ext ] ) || ! self::starts_with_any( $tmp, self::MAGIC[ $ext ] ) ) {
			return 'not_a_font';
		}
		$name = trim( (string) preg_replace( '/[^A-Za-z0-9 _-]+/', '-', pathinfo( (string) $file['name'], PATHINFO_FILENAME ) ), ' -' );
		$name = '' === $name ? 'Font' : substr( $name, 0, 50 );
		wp_mkdir_p( self::dir() );
		$target = $name . '.' . $ext;
		$i      = 1;
		while ( file_exists( self::dir() . '/' . $target ) ) {
			$target = $name . ' ' . ( ++$i ) . '.' . $ext;
		}
		if ( ! class_exists( '\WP_Filesystem_Direct' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-base.php';
			require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-direct.php';
		}
		if ( ! ( new \WP_Filesystem_Direct( null ) )->copy( $tmp, self::dir() . '/' . $target, false, defined( 'FS_CHMOD_FILE' ) ? FS_CHMOD_FILE : 0644 ) ) {
			return 'upload_failed';
		}
		return array(
			'file'   => $target,
			'family' => trim( pathinfo( $target, PATHINFO_FILENAME ) ),
			'size'   => (int) filesize( self::dir() . '/' . $target ),
		);
	}

	/**
	 * Whether a file starts with one of the given byte strings.
	 *
	 * @param string   $path   File.
	 * @param string[] $starts Byte strings.
	 */
	private static function starts_with_any( string $path, array $starts ): bool {
		$head = (string) file_get_contents( $path, false, null, 0, 4 ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- the first bytes of a local file.
		foreach ( $starts as $start ) {
			if ( str_starts_with( $head, $start ) ) {
				return true;
			}
		}
		return false;
	}
}
