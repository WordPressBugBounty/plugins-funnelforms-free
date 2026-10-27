<?php
/**
 * REST API for importing forms of other form plugins.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import;

use Funnelforms\Application\Capabilities;
use Funnelforms\Http\FormsController;

defined( 'ABSPATH' ) || exit;

/**
 * Routes under funnelforms/v1, for users with the right to edit forms:
 *
 *   GET  admin/import/sources  plugins with forms on this site (Importer::sources())
 *   POST admin/import/file     export file of another plugin (multipart "file", or the raw body)
 *   POST admin/import/site     source, ids (list), again (bool): forms of a plugin on this site
 *
 * Each imported form becomes a draft; the answer lists id, title, problems (what keeps it from
 * being published), notes (codes) and messages (the notes in words).
 */
final class ImportController {

	/**
	 * Registers the routes.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Whether the user may edit forms.
	 */
	public static function allowed(): bool {
		return current_user_can( Capabilities::EDIT_FORMS );
	}

	/**
	 * Route definitions.
	 */
	public static function routes(): void {
		$ns = FormsController::NAMESPACE;
		register_rest_route(
			$ns,
			'/admin/import/sources',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'sources' ),
				'permission_callback' => array( self::class, 'allowed' ),
			)
		);
		register_rest_route(
			$ns,
			'/admin/import/file',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'file' ),
				'permission_callback' => array( self::class, 'allowed' ),
			)
		);
		register_rest_route(
			$ns,
			'/admin/import/site',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'site' ),
				'permission_callback' => array( self::class, 'allowed' ),
				'args'                => array(
					'source' => array(
						'type'     => 'string',
						'required' => true,
						'enum'     => array_keys( Importer::default_readers() ),
					),
					'ids'    => array(
						'type'     => 'array',
						'required' => true,
						'minItems' => 1,
						'maxItems' => 200,
						'items'    => array(
							'type'    => 'string',
							'pattern' => '^[0-9]+(:[0-9a-z]+)?$',
						),
					),
					'again'  => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);
	}

	/**
	 * GET admin/import/sources.
	 */
	public static function sources(): \WP_REST_Response {
		return new \WP_REST_Response( Importer::create()->sources(), 200 );
	}

	/**
	 * POST admin/import/file.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function file( \WP_REST_Request $request ): \WP_REST_Response {
		$files = $request->get_file_params();
		$file  = is_array( $files['file'] ?? null ) ? $files['file'] : null;
		if ( null !== $file ) {
			$path = UPLOAD_ERR_OK === ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) && is_string( $file['tmp_name'] ?? null ) && is_file( $file['tmp_name'] ) ? $file['tmp_name'] : null;
			if ( null === $path ) {
				return self::error( 'upload_failed', 400 );
			}
			if ( (int) filesize( $path ) > \Funnelforms\Application\FormEditor::MAX_IMPORT_BYTES ) {
				return self::error( 'file_too_large', 400 );
			}
			$contents = (string) file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- uploaded file.
		} else {
			$contents = $request->get_body();
		}
		$result = Importer::create()->import_file( $contents );
		if ( ! $result['ok'] && 'unknown_format' === $result['code'] && self::funnelforms_file( $contents ) ) {
			// A file of Funnelforms itself belongs to the other import.
			return self::error( 'funnelforms_file', 400 );
		}
		return $result['ok'] ? self::done( $result ) : self::error( (string) $result['code'], 400 );
	}

	/**
	 * Whether a file is an export of Funnelforms: a form file of 5.0, an export of Funnelforms 4
	 * or a ZIP (the exports of Funnelforms 3 are ZIP files; no other plugin's export is one).
	 *
	 * @param string $contents File contents.
	 */
	public static function funnelforms_file( string $contents ): bool {
		if ( str_starts_with( $contents, "PK\x03\x04" ) ) {
			return true;
		}
		$data = json_decode( $contents );
		return is_object( $data ) && ( \Funnelforms\Application\FormEditor::FORMAT === ( $data->format ?? null ) || \Funnelforms\Compat\Ff4\Ff4Export::recognizes( $data ) );
	}

	/**
	 * POST admin/import/site.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function site( \WP_REST_Request $request ): \WP_REST_Response {
		$result = Importer::create()->import_site( (string) $request['source'], (array) $request['ids'], (bool) $request['again'] );
		return $result['ok'] ? self::done( $result ) : self::error( (string) $result['code'], 400 );
	}

	/**
	 * Answer of an import: 201 when a form was created, else 200.
	 *
	 * @param array<string,mixed> $result Result.
	 */
	private static function done( array $result ): \WP_REST_Response {
		$created = array_filter( $result['forms'], static fn( array $f ): bool => ! isset( $f['skipped'] ) );
		return new \WP_REST_Response(
			array(
				'source' => $result['source'],
				'forms'  => $result['forms'],
			),
			array() === $created ? 200 : 201
		);
	}

	/**
	 * Error answer.
	 *
	 * @param string $code   Code.
	 * @param int    $status HTTP status.
	 */
	private static function error( string $code, int $status ): \WP_REST_Response {
		$messages = array(
			'file_too_large'   => __( 'The file is too large.', 'funnelforms-free' ),
			'no_forms'         => __( 'The file holds no forms.', 'funnelforms-free' ),
			'upload_failed'    => __( 'The file could not be uploaded.', 'funnelforms-free' ),
			'unknown_source'   => __( 'This form plugin is not supported.', 'funnelforms-free' ),
			'funnelforms_file' => __( 'This is an export of Funnelforms. Upload it under Funnelforms → Import Funnelforms.', 'funnelforms-free' ),
			'unknown_format'   => __( 'The file is no export of a supported form plugin (WPForms, Gravity Forms, Ninja Forms, Fluent Forms, Contact Form 7, Formidable Forms, Elementor Pro).', 'funnelforms-free' ),
		);
		return new \WP_REST_Response(
			array(
				'code'    => $code,
				'message' => $messages[ $code ] ?? $messages['unknown_format'],
			),
			$status
		);
	}
}
