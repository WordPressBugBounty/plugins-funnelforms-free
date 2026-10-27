<?php
/**
 * WP-CLI: wp funnelforms import.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

/**
 * Imports forms of other form plugins as drafts.
 */
final class ImportCommand {

	/**
	 * Lists the forms of other plugins on this site.
	 *
	 * ## EXAMPLES
	 *
	 *     wp funnelforms import sources
	 *
	 * @param array<int,string> $args Positional arguments.
	 */
	public function sources( array $args ): void {
		unset( $args );
		$sources = Importer::create()->sources();
		if ( array() === $sources ) {
			WP_CLI::log( 'No forms of a supported plugin on this site.' );
			return;
		}
		foreach ( $sources as $source ) {
			WP_CLI::log( $source['label'] . ' (' . $source['source'] . ')' );
			foreach ( $source['forms'] as $form ) {
				WP_CLI::log( '  ' . $form['id'] . '  ' . $form['title'] . ( null !== $form['importedAs'] ? '  → form ' . $form['importedAs'] : '' ) );
			}
		}
	}

	/**
	 * Imports forms of a plugin on this site.
	 *
	 * ## OPTIONS
	 *
	 * <source>
	 * : wpforms, gravityforms, ninja-forms, fluent-forms, contact-form-7, formidable or elementor.
	 *
	 * [<id>...]
	 * : Ids from "wp funnelforms import sources". Without ids, every form of the plugin.
	 *
	 * [--again]
	 * : Also import forms that were imported before.
	 *
	 * ## EXAMPLES
	 *
	 *     wp funnelforms import site wpforms 12 15
	 *
	 * @param array<int,string>   $args       Positional arguments.
	 * @param array<string,mixed> $assoc_args Options.
	 */
	public function site( array $args, array $assoc_args ): void {
		$importer = Importer::create();
		$source   = (string) array_shift( $args );
		if ( array() === $args ) {
			foreach ( $importer->sources() as $found ) {
				if ( $found['source'] === $source ) {
					$args = array_column( $found['forms'], 'id' );
				}
			}
		}
		if ( array() === $args ) {
			WP_CLI::error( 'No forms found for ' . $source . '.' );
		}
		self::report( $importer->import_site( $source, $args, isset( $assoc_args['again'] ) ) );
	}

	/**
	 * Imports the forms of an export file.
	 *
	 * ## OPTIONS
	 *
	 * <file>
	 * : Export of WPForms (.json), Gravity Forms (.json), Ninja Forms (.nff), Fluent Forms (.json),
	 * Contact Form 7 (WordPress export .xml), Formidable (.xml) or an Elementor template (.json).
	 *
	 * ## EXAMPLES
	 *
	 *     wp funnelforms import file wpforms-form-export.json
	 *
	 * @param array<int,string> $args Positional arguments.
	 */
	public function file( array $args ): void {
		$path = (string) ( $args[0] ?? '' );
		if ( ! is_readable( $path ) ) {
			WP_CLI::error( 'Cannot read ' . $path . '.' );
		}
		self::report( Importer::create()->import_file( (string) file_get_contents( $path ) ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file named by the admin.
	}

	/**
	 * Prints the result of an import.
	 *
	 * @param array<string,mixed> $result Result.
	 */
	private static function report( array $result ): void {
		if ( ! $result['ok'] ) {
			WP_CLI::error( 'Import failed: ' . $result['code'] );
		}
		$created = 0;
		foreach ( $result['forms'] as $form ) {
			if ( isset( $form['skipped'] ) ) {
				WP_CLI::log( $form['sourceId'] . ': skipped (' . $form['skipped'] . ')' . ( null !== $form['id'] ? ', form ' . $form['id'] : '' ) );
				continue;
			}
			++$created;
			WP_CLI::log( $form['sourceId'] . ' → form ' . $form['id'] . ' "' . $form['title'] . '" (draft)' );
			foreach ( array_merge( $form['messages'], $form['problems'] ) as $line ) {
				WP_CLI::log( '    ' . $line );
			}
		}
		WP_CLI::success( $created . ' form(s) imported as drafts.' );
	}
}
