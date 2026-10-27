<?php
/**
 * REST routes of the builder: forms, drafts, revisions, locks, import and export.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Application\Capabilities;
use Funnelforms\Application\FontLibrary;
use Funnelforms\Application\GoogleFonts;
use Funnelforms\Application\FormEditor;
use Funnelforms\Application\FormPreview;
use Funnelforms\Application\FormTemplates;
use Funnelforms\Application\StyleLibrary;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\ConnectionRepository;
use Funnelforms\Frontend\FunnelPage;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Routes under funnelforms/v1, for users with the right to edit forms:
 *   GET    admin/forms                         list (search, status, category, orderby, page, perPage)
 *   POST   admin/forms                         new form (title, category) with a contact step
 *   GET    admin/forms/<id>                    the form with the document the builder edits
 *   PATCH  admin/forms/<id>                    category, status (published, draft, trashed)
 *   DELETE admin/forms/<id>                    to the trash; force deletes a trashed form
 *   PUT    admin/forms/<id>/draft              saves the draft (document)
 *   DELETE admin/forms/<id>/draft              drops the draft
 *   POST   admin/forms/<id>/publish            publishes the draft (note)
 *   GET    admin/forms/<id>/revisions          published versions
 *   GET    admin/forms/<id>/revisions/<rev>    one version with its document
 *   POST   admin/forms/<id>/revisions/<rev>/restore  makes a version the draft
 *   POST   admin/forms/<id>/duplicate          copy without entries
 *   POST   admin/forms/<id>/lock               takes or renews the edit lock (force)
 *   DELETE admin/forms/<id>/lock               gives it up
 *   GET    admin/forms/<id>/export             JSON export (revision: draft or current)
 *   GET    admin/forms/<id>/preview            page of the preview frame (Application\FormPreview)
 *   GET    admin/forms/templates               templates for new forms (Application\FormTemplates)
 *   GET    admin/forms/templates/<id>/preview  page of the preview frame for a template
 *   POST   admin/forms/templates/<id>          new draft form from a template
 *   POST   admin/forms/import                  file: own export (JSON) or 3.x export (ZIP)
 * Changing the draft, publishing and restoring need the edit lock; a free lock is taken on the
 * way. Publishing changes of actions or entry settings also needs the right to see entries, and
 * tracking code or scripts need unfiltered_html (Domain\Form\SensitiveChanges). See
 * docs/api/forms.md.
 */
final class FormsAdminController {

	private const BASE = '/admin/forms';
	private const ID   = '/(?P<id>\d+)';

	/**
	 * Connection types forms use: mail servers, chat, SMS, WhatsApp, conversion platforms (actions)
	 * and payment providers.
	 */
	private const FORM_CONNECTIONS = array( 'smtp', 'slack', 'teams', 'twilio', 'bird', 'whatsapp', 'meta', 'ga4', 'tiktok', 'stripe', 'paypal', 'mollie' );

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
		$allowed = array( self::class, 'allowed' );
		$route   = static function ( string $path, string $methods, string $callback, array $args = array() ) use ( $allowed ): void {
			register_rest_route(
				FormsController::NAMESPACE,
				self::BASE . $path,
				array(
					'methods'             => $methods,
					'callback'            => array( self::class, $callback ),
					'permission_callback' => $allowed,
					'args'                => $args,
				)
			);
		};
		$text    = static fn( int $max, bool $required = false ): array => array(
			'type'      => 'string',
			'maxLength' => $max,
			'required'  => $required,
		);
		$flag    = array(
			'type'    => 'boolean',
			'default' => false,
		);
		$route(
			'',
			'GET',
			'index',
			array(
				'search'   => $text( 200 ),
				'status'   => array(
					'type' => 'string',
					'enum' => array( 'published', 'draft', 'trashed' ),
				),
				'category' => $text( 100 ),
				'orderby'  => array(
					'type'    => 'string',
					'enum'    => array( 'updated', 'title' ),
					'default' => 'updated',
				),
				'page'     => array(
					'type'    => 'integer',
					'minimum' => 1,
					'default' => 1,
				),
				'perPage'  => array(
					'type'    => 'integer',
					'minimum' => 1,
					'maximum' => 100,
					'default' => 20,
				),
			)
		);
		$route(
			'',
			'POST',
			'create',
			array(
				'title'    => $text( 255, true ),
				'category' => $text( 100 ),
			)
		);
		$route( self::ID, 'GET', 'show' );
		$route(
			self::ID,
			'PATCH',
			'update',
			array(
				'category'   => $text( 100 ),
				'status'     => array(
					'type' => 'string',
					'enum' => array( 'published', 'draft', 'trashed' ),
				),
				'publicSlug' => array(
					'type'        => 'string',
					'maxLength'   => 200,
					'description' => 'Address of the form\'s own page, /funnelforms/<slug>: letters, digits and dashes (cleaned like a post slug); empty removes it.',
				),
			)
		);
		$route( self::ID, 'DELETE', 'delete', array( 'force' => $flag ) );
		$route(
			self::ID . '/draft',
			'PUT',
			'save_draft',
			array(
				'document' => array(
					'type'     => 'object',
					'required' => true,
				),
			)
		);
		$route( self::ID . '/draft', 'DELETE', 'drop_draft' );
		$route( self::ID . '/publish', 'POST', 'publish', array( 'note' => $text( 255 ) ) );
		$route( self::ID . '/revisions', 'GET', 'revisions' );
		$route( self::ID . '/revisions/(?P<rev>\d+)', 'GET', 'revision' );
		$route( self::ID . '/revisions/(?P<rev>\d+)/restore', 'POST', 'restore' );
		$route( self::ID . '/duplicate', 'POST', 'duplicate' );
		$route( self::ID . '/lock', 'POST', 'lock', array( 'force' => $flag ) );
		$route( self::ID . '/lock', 'DELETE', 'unlock' );
		$route(
			self::ID . '/export',
			'GET',
			'export',
			array(
				'revision' => array(
					'type'    => 'string',
					'enum'    => array( 'draft', 'current' ),
					'default' => 'draft',
				),
			)
		);
		$route(
			self::ID . '/preview',
			'GET',
			'preview',
			array(
				'locale' => array(
					'type'    => 'string',
					'pattern' => '^([a-z]{2,3}(_[A-Za-z0-9]+)*)?$',
					'default' => '',
				),
			)
		);
		$route( '/templates', 'GET', 'templates' );
		$route( '/templates/(?P<template>[a-z]+)/preview', 'GET', 'template_preview' );
		$route( '/templates/(?P<template>[a-z]+)', 'POST', 'from_template' );
		$route( '/import', 'POST', 'import' );
		$route( '/styles', 'GET', 'styles' );
		$route(
			'/styles',
			'POST',
			'save_style',
			array(
				'name'   => $text( 60, true ),
				'tokens' => array(
					'type'     => 'object',
					'required' => true,
				),
			)
		);
		$route( '/styles/(?P<style>st_[0-9a-f]{12})', 'DELETE', 'delete_style' );
		$route( '/connections', 'GET', 'connections' );
		$route( '/password-hash', 'POST', 'password_hash', array( 'password' => $text( 200, true ) ) );
		$route( '/fonts', 'GET', 'fonts' );
		$route( '/fonts', 'POST', 'upload_font' );
		$route( '/fonts/google', 'GET', 'google_fonts' );
		$route( '/fonts/google', 'POST', 'install_google_font', array( 'family' => $text( 60, true ) ) );
		$route( '/fonts/google', 'DELETE', 'remove_google_font', array( 'family' => $text( 60, true ) ) );
		$pro = Edition::pro( FormsAdminProController::class );
		if ( null !== $pro ) {
			$pro::routes( $text, $flag );
		}
	}

	/**
	 * GET admin/forms.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function index( \WP_REST_Request $request ): \WP_REST_Response {
		$forms  = new FormRepository();
		$filter = array(
			'search' => (string) ( $request['search'] ?? '' ),
			'status' => (string) ( $request['status'] ?? '' ),
		);
		if ( null !== $request['category'] ) {
			$filter['category'] = (string) $request['category'];
		}
		$per    = (int) $request['perPage'];
		$result = $forms->search( $filter, (string) $request['orderby'], (int) $request['page'], $per );
		$counts = current_user_can( Capabilities::VIEW_ENTRIES ) ? $forms->entry_counts( array_column( $result['rows'], 'id' ) ) : null;
		$rows   = array();
		foreach ( $result['rows'] as $row ) {
			$rows[] = self::summary( $row, null === $counts ? null : ( $counts[ (int) $row['id'] ] ?? 0 ) );
		}
		$response = new \WP_REST_Response(
			array(
				'forms'      => $rows,
				'total'      => $result['total'],
				'categories' => $forms->categories(),
			),
			200
		);
		$response->header( 'X-WP-Total', (string) $result['total'] );
		$response->header( 'X-WP-TotalPages', (string) max( 1, (int) ceil( $result['total'] / $per ) ) );
		return $response;
	}

	/**
	 * POST admin/forms.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function create( \WP_REST_Request $request ): \WP_REST_Response {
		$title = FormEditor::clean( (string) $request['title'], 255 );
		if ( '' === $title ) {
			return self::error( 'title_missing', __( 'The form needs a title.', 'funnelforms-free' ), 400 );
		}
		$forms = new FormRepository();
		$id    = FormEditor::create()->new_form( $title, FormEditor::clean( (string) ( $request['category'] ?? '' ), 100 ) );
		$forms->audit( 'form_created', $id );
		return self::detail( (array) $forms->by_id( $id ), 201 );
	}

	/**
	 * GET admin/forms/styles: the styles saved on this site.
	 */
	public static function styles(): \WP_REST_Response {
		return new \WP_REST_Response( array( 'styles' => StyleLibrary::all() ), 200 );
	}

	/**
	 * POST admin/forms/styles: saves a style.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function save_style( \WP_REST_Request $request ): \WP_REST_Response {
		$name = trim( (string) $request['name'] );
		if ( '' === $name ) {
			return self::error( 'name_missing', __( 'Please give the style a name.', 'funnelforms-free' ), 400 );
		}
		$style = StyleLibrary::add( $name, $request['tokens'] );
		if ( null === $style ) {
			/* translators: %d: most saved styles */
			return self::error( 'styles_full', sprintf( __( 'A site can keep %d styles. Delete one first.', 'funnelforms-free' ), StyleLibrary::MAX ), 409 );
		}
		return new \WP_REST_Response( $style, 201 );
	}

	/**
	 * DELETE admin/forms/styles/<style>.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function delete_style( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! StyleLibrary::delete( (string) $request['style'] ) ) {
			return self::error( 'not_found', __( 'The style does not exist.', 'funnelforms-free' ), 404 );
		}
		return new \WP_REST_Response( null, 204 );
	}

	/**
	 * GET admin/forms/connections: the connections actions can use, by name only (ref, type,
	 * label), so whoever edits forms can pick one without seeing its credentials.
	 */
	public static function connections(): \WP_REST_Response {
		$repository = new ConnectionRepository( SecretBox::for_site() );
		$pro        = Edition::pro( FormsAdminProController::class );
		// Funnelforms Free sends mails only; the other connections are for actions and payments of Pro.
		$rows = $repository->of_types( null === $pro ? array( 'smtp' ) : self::FORM_CONNECTIONS );
		$out  = array();
		foreach ( $rows as $row ) {
			$out[] = array(
				'ref'   => (string) $row['ref'],
				'type'  => (string) $row['type'],
				'label' => (string) $row['label'],
			) + ( null === $pro ? array() : $pro::connection_details( $row, $repository ) );
		}
		return new \WP_REST_Response( array( 'connections' => $out ), 200 );
	}

	/**
	 * POST admin/forms/password-hash: the hash of a form password for settings.access.password.
	 * The builder keeps only the hash in the document; the password itself is never stored.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function password_hash( \WP_REST_Request $request ): \WP_REST_Response {
		// Trimmed like FormAccess::unlock() does with what visitors type.
		$password = trim( (string) $request['password'] );
		if ( '' === $password ) {
			return self::error( 'password_missing', __( 'Please enter a password.', 'funnelforms-free' ), 400 );
		}
		return new \WP_REST_Response( array( 'hash' => wp_hash_password( $password ) ), 200 );
	}

	/**
	 * GET admin/forms/fonts: fonts uploaded on this site, and the Google Fonts downloaded to it.
	 */
	public static function fonts(): \WP_REST_Response {
		$google = array();
		foreach ( GoogleFonts::installed() as $family => $font ) {
			$google[] = array(
				'family'   => (string) $family,
				'category' => (string) ( $font['category'] ?? 'sans-serif' ),
			);
		}
		return new \WP_REST_Response(
			array(
				'fonts'  => FontLibrary::all(),
				'google' => $google,
			),
			200
		);
	}

	/**
	 * GET admin/forms/fonts/google: the Google Fonts that can be downloaded to the site.
	 */
	public static function google_fonts(): \WP_REST_Response {
		return new \WP_REST_Response( array( 'fonts' => GoogleFonts::catalog() ), 200 );
	}

	/**
	 * POST admin/forms/fonts/google: downloads a Google Font to the site; it writes files to the
	 * uploads folder, so it needs the right to upload files too.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function install_google_font( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! current_user_can( 'upload_files' ) ) {
			return self::error( 'forbidden', __( 'You may not upload files.', 'funnelforms-free' ), 403 );
		}
		$result = GoogleFonts::install( (string) $request['family'], get_current_user_id() );
		$errors = array(
			'unknown_font'    => array( __( 'This font is not in the list.', 'funnelforms-free' ), 404 ),
			'rate_limited'    => array( __( 'You have added many fonts in the last hour. Try again later.', 'funnelforms-free' ), 429 ),
			'download_failed' => array( __( 'The font could not be downloaded. Try again later.', 'funnelforms-free' ), 502 ),
		);
		if ( is_string( $result ) ) {
			return self::error( $result, $errors[ $result ][0], $errors[ $result ][1] );
		}
		return new \WP_REST_Response( $result, 201 );
	}

	/**
	 * DELETE admin/forms/fonts/google: removes a downloaded Google Font.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function remove_google_font( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! current_user_can( 'upload_files' ) ) {
			return self::error( 'forbidden', __( 'You may not upload files.', 'funnelforms-free' ), 403 );
		}
		if ( ! GoogleFonts::remove( (string) $request['family'] ) ) {
			return self::error( 'not_found', __( 'This font is not on the site.', 'funnelforms-free' ), 404 );
		}
		return new \WP_REST_Response( null, 204 );
	}

	/**
	 * POST admin/forms/fonts: uploads a font (field "file"); needs the right to upload files too.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function upload_font( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! current_user_can( 'upload_files' ) ) {
			return self::error( 'forbidden', __( 'You may not upload files.', 'funnelforms-free' ), 403 );
		}
		$file   = $request->get_file_params()['file'] ?? null;
		$result = is_array( $file ) && ! is_array( $file['name'] ?? null ) ? FontLibrary::add( $file, true ) : 'upload_failed';
		if ( is_string( $result ) ) {
			$messages = array(
				/* translators: %d: size in MB */
				'font_too_large' => sprintf( __( 'Fonts can have up to %d MB.', 'funnelforms-free' ), (int) ( FontLibrary::MAX_BYTES / MB_IN_BYTES ) ),
				'not_a_font'     => __( 'This is not a font file (TTF, OTF, WOFF or WOFF2).', 'funnelforms-free' ),
			);
			return self::error( $result, $messages[ $result ] ?? __( 'The file could not be uploaded.', 'funnelforms-free' ), 'font_too_large' === $result ? 413 : 400 );
		}
		return new \WP_REST_Response( $result, 201 );
	}

	/**
	 * GET admin/forms/templates: the templates with the first question in the language of the
	 * form (?locale=, the site's without), the languages to choose from and the icons they show.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function templates( \WP_REST_Request $request ): \WP_REST_Response {
		$locale    = FormTemplates::language( (string) $request->get_param( 'locale' ) );
		$templates = FormTemplates::all( $locale );
		return new \WP_REST_Response(
			array(
				'goals'      => FormTemplates::GOALS,
				'categories' => FormTemplates::CATEGORIES,
				'languages'  => array_values( array_unique( array_merge( array( FormTemplates::language() ), FormTemplates::LANGUAGES ) ) ),
				'locale'     => $locale,
				'templates'  => $templates,
				'icons'      => FormTemplates::icons( $templates ),
				'industry'   => FormTemplates::site_category(),
			),
			200
		);
	}

	/**
	 * GET admin/forms/templates/<template>/preview.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function template_preview( \WP_REST_Request $request ): \WP_REST_Response {
		if ( FormTemplates::needs_pro( (string) $request['template'] ) ) {
			return self::pro_template( (string) $request['template'] );
		}
		$html = FormPreview::template_page( (string) $request['template'], get_current_user_id(), time(), (string) $request->get_param( 'locale' ) );
		if ( null === $html ) {
			return self::error( 'not_found', __( 'Template not found.', 'funnelforms-free' ), 404 );
		}
		$response = new \WP_REST_Response( array( 'html' => $html ), 200 );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * POST admin/forms/templates/<template>: a new draft form from the template.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function from_template( \WP_REST_Request $request ): \WP_REST_Response {
		if ( FormTemplates::needs_pro( (string) $request['template'] ) ) {
			return self::pro_template( (string) $request['template'] );
		}
		$id = FormTemplates::create( (string) $request['template'], (string) $request->get_param( 'locale' ) );
		if ( null === $id ) {
			return self::error( 'not_found', __( 'Template not found.', 'funnelforms-free' ), 404 );
		}
		return self::detail( (array) ( new FormRepository() )->by_id( $id ), 201 );
	}

	/**
	 * The answer for a template of Funnelforms Pro in Funnelforms Free: it exists, but makes no form.
	 *
	 * @param string $id Template id.
	 */
	private static function pro_template( string $id ): \WP_REST_Response {
		return self::error(
			'pro_template',
			/* translators: %s: name of the template */
			sprintf( __( 'The template “%s” needs Funnelforms Pro. Upgrade to Funnelforms Pro to use it.', 'funnelforms-free' ), FormTemplates::title( $id ) ),
			403
		);
	}

	/**
	 * GET admin/forms/<id>.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function show( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		return null === $form ? self::not_found() : self::detail( $form, 200 );
	}

	/**
	 * PATCH admin/forms/<id>.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function update( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		$data = array();
		if ( null !== $request['category'] ) {
			$data['category'] = FormEditor::clean( (string) $request['category'], 100 );
		}
		if ( null !== $request['publicSlug'] ) {
			$slug = FunnelPage::clean( (string) $request['publicSlug'] );
			if ( '' !== $slug && ( new FormRepository() )->slug_taken( $slug, (int) $form['id'], null === $form['legacy_post_id'] ? null : (int) $form['legacy_post_id'] ) ) {
				return self::error( 'slug_taken', __( 'Another form has this address already.', 'funnelforms-free' ), 409 );
			}
			$data['public_slug'] = '' === $slug ? null : $slug;
		}
		$status = (string) ( $request['status'] ?? '' );
		if ( '' !== $status && $status !== $form['status'] ) {
			if ( 'published' === $status && null === $form['current_revision_id'] ) {
				return self::error( 'not_published_yet', __( 'Publish the form first.', 'funnelforms-free' ), 409 );
			}
			$data['status'] = $status;
		}
		if ( array() !== $data ) {
			$forms = new FormRepository();
			$forms->update( (int) $form['id'], $data );
			if ( isset( $data['status'] ) ) {
				$forms->audit(
					'form_status',
					(int) $form['id'],
					array(
						'from' => $form['status'],
						'to'   => $status,
					)
				);
			}
			$form = (array) $forms->by_id( (int) $form['id'] );
		}
		return self::detail( $form, 200 );
	}

	/**
	 * DELETE admin/forms/<id>.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function delete( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		$forms = new FormRepository();
		if ( ! $request['force'] || 'trashed' !== $form['status'] ) {
			$forms->update( (int) $form['id'], array( 'status' => 'trashed' ) );
			$forms->audit( 'form_status', (int) $form['id'], array( 'to' => 'trashed' ) );
			return self::detail( (array) $forms->by_id( (int) $form['id'] ), 200 );
		}
		if ( null !== $form['legacy_post_id'] ) {
			return self::error( 'legacy_form', __( 'Forms imported from Funnelforms 3 stay as long as their 3.x form exists.', 'funnelforms-free' ), 409 );
		}
		if ( ( $forms->entry_counts( array( (int) $form['id'] ) )[ (int) $form['id'] ] ?? 0 ) > 0 ) {
			return self::error( 'has_entries', __( 'The form has entries. Delete them first.', 'funnelforms-free' ), 409 );
		}
		$forms->delete( (int) $form['id'] );
		$forms->audit( 'form_deleted', (int) $form['id'], array( 'title' => (string) $form['title'] ) );
		return new \WP_REST_Response(
			array(
				'deleted' => true,
				'id'      => (int) $form['id'],
			),
			200
		);
	}

	/**
	 * PUT admin/forms/<id>/draft.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function save_draft( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		$locked = self::locked( $form );
		if ( null !== $locked ) {
			return $locked;
		}
		if ( strlen( $request->get_body() ) > FormEditor::MAX_BYTES + 1024 ) {
			return self::error( 'document_too_large', __( 'The form is too large.', 'funnelforms-free' ), 413 );
		}
		// The raw body, decoded with objects: the parsed parameters would turn {} into [].
		$body     = json_decode( $request->get_body() );
		$document = is_object( $body ) && is_object( $body->document ?? null ) ? $body->document : null;
		if ( null === $document ) {
			return self::error( 'invalid_document', __( 'The document must be a JSON object.', 'funnelforms-free' ), 400 );
		}
		$result = FormEditor::create()->save_draft( $form, $document );
		return new \WP_REST_Response( array( 'saved' => true ) + $result + array( 'form' => self::summary( (array) ( new FormRepository() )->by_id( (int) $form['id'] ), null ) ), 200 );
	}

	/**
	 * DELETE admin/forms/<id>/draft.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function drop_draft( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		if ( null === $form['current_revision_id'] ) {
			return self::error( 'not_published_yet', __( 'The form has only its draft. Move it to the trash instead.', 'funnelforms-free' ), 409 );
		}
		$locked = self::locked( $form );
		if ( null !== $locked ) {
			return $locked;
		}
		$forms = new FormRepository();
		$forms->save_draft( (int) $form['id'], null, get_current_user_id() );
		return self::detail( (array) $forms->by_id( (int) $form['id'] ), 200 );
	}

	/**
	 * POST admin/forms/<id>/publish.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function publish( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		if ( 'trashed' === $form['status'] ) {
			return self::error( 'trashed', __( 'Restore the form from the trash first.', 'funnelforms-free' ), 409 );
		}
		$locked = self::locked( $form );
		if ( null !== $locked ) {
			return $locked;
		}
		$result = FormEditor::create()->publish( $form, FormEditor::clean( (string) ( $request['note'] ?? '' ), 255 ) );
		if ( ! $result['ok'] ) {
			$messages             = array(
				'no_draft'         => array( __( 'There are no changes to publish.', 'funnelforms-free' ), 409 ),
				'invalid_document' => array( __( 'The form has problems and cannot be published.', 'funnelforms-free' ), 422 ),
				'missing_rights'   => array( __( 'You may not publish these changes.', 'funnelforms-free' ), 403 ),
			);
			[ $message, $status ] = $messages[ $result['code'] ];
			$extra                = array_diff_key( $result, array_flip( array( 'ok', 'code' ) ) );
			return new \WP_REST_Response(
				array(
					'code'    => $result['code'],
					'message' => $message,
				) + $extra,
				$status
			);
		}
		return new \WP_REST_Response(
			array(
				'published'   => true,
				'revision'    => $result['revision'],
				'renderer'    => $result['renderer'],
				'warnings'    => $result['warnings'],
				'experiments' => (object) $result['experiments'],
				'form'        => self::summary( (array) ( new FormRepository() )->by_id( (int) $form['id'] ), null ),
			),
			200
		);
	}

	/**
	 * GET admin/forms/<id>/revisions.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function revisions( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		$out = array();
		foreach ( ( new FormRepository() )->revisions( (int) $form['id'], 100 ) as $row ) {
			$out[] = self::revision_out( $row, $form );
		}
		return new \WP_REST_Response( $out, 200 );
	}

	/**
	 * GET admin/forms/<id>/revisions/<rev>.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function revision( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		$row  = null === $form ? null : ( new FormRepository() )->revision( (int) $form['id'], (int) $request['rev'] );
		if ( null === $row ) {
			return self::not_found();
		}
		return new \WP_REST_Response( self::revision_out( $row, $form ) + array( 'document' => FormEditor::decode( (string) $row['document'] ) ), 200 );
	}

	/**
	 * POST admin/forms/<id>/revisions/<rev>/restore.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function restore( \WP_REST_Request $request ): \WP_REST_Response {
		$form  = self::form( $request );
		$forms = new FormRepository();
		$row   = null === $form ? null : $forms->revision( (int) $form['id'], (int) $request['rev'] );
		if ( null === $row ) {
			return self::not_found();
		}
		$locked = self::locked( $form );
		if ( null !== $locked ) {
			return $locked;
		}
		$document = FormEditor::decode( (string) $row['document'] );
		$forms->save_draft( (int) $form['id'], (string) $row['document'], get_current_user_id(), is_string( $document->title ?? null ) ? (string) $document->title : null );
		$forms->audit( 'form_revision_restored', (int) $form['id'], array( 'revision' => (int) $row['id'] ) );
		return self::detail( (array) $forms->by_id( (int) $form['id'] ), 200 );
	}

	/**
	 * POST admin/forms/<id>/duplicate.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function duplicate( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		$id   = null === $form ? null : FormEditor::create()->duplicate( $form );
		if ( null === $id ) {
			return self::not_found();
		}
		return self::detail( (array) ( new FormRepository() )->by_id( $id ), 201 );
	}

	/**
	 * POST admin/forms/<id>/lock.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function lock( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		$forms  = new FormRepository();
		$before = $forms->holder( (int) $form['id'], FormEditor::LOCK_TTL );
		$holder = $forms->lock( (int) $form['id'], get_current_user_id(), FormEditor::LOCK_TTL, (bool) $request['force'] );
		if ( get_current_user_id() !== $holder ) {
			return self::lock_error( $holder );
		}
		if ( 0 !== $before && $before !== $holder ) {
			$forms->audit( 'form_lock_taken', (int) $form['id'], array( 'from' => $before ) );
		}
		return new \WP_REST_Response(
			array(
				'locked'    => true,
				'expiresIn' => FormEditor::LOCK_TTL,
			),
			200
		);
	}

	/**
	 * DELETE admin/forms/<id>/lock.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function unlock( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		( new FormRepository() )->unlock( (int) $form['id'], get_current_user_id() );
		return new \WP_REST_Response( array( 'locked' => false ), 200 );
	}

	/**
	 * GET admin/forms/<id>/export.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function export( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form ) {
			return self::not_found();
		}
		$forms    = new FormRepository();
		$document = 'current' === $request['revision']
			? ( null === $form['current_revision_id'] ? null : FormEditor::decode( (string) $forms->document_json( (int) $form['current_revision_id'] ) ) )
			: FormEditor::create()->editing( $form );
		if ( null === $document ) {
			return self::not_found();
		}
		$response = new \WP_REST_Response( FormEditor::export( $form, $document ), 200 );
		$name     = sanitize_file_name( ( '' !== (string) $form['title'] ? (string) $form['title'] : 'form' ) . '.funnelforms.json' );
		$response->header( 'Content-Disposition', 'attachment; filename="' . $name . '"' );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * GET admin/forms/<id>/preview: the page of the preview frame, from the draft, in `locale` when
	 * the form has it; 409 with the problems while the draft cannot be shown.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function preview( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( $request );
		if ( null === $form || 'trashed' === $form['status'] ) {
			return self::not_found();
		}
		$page = ( new FormPreview( new FormRepository() ) )->page( $form, get_current_user_id(), time(), (string) $request['locale'] );
		if ( null === $page ) {
			return self::not_found();
		}
		if ( ! $page['ok'] ) {
			return new \WP_REST_Response(
				array(
					'code'     => 'not_ready',
					'message'  => __( 'Fix the problems of the form to see the preview.', 'funnelforms-free' ),
					'problems' => $page['problems'],
				),
				409
			);
		}
		$response = new \WP_REST_Response( array( 'html' => $page['html'] ), 200 );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * POST admin/forms/import: a file upload (multipart field "file") or the export as JSON body.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function import( \WP_REST_Request $request ): \WP_REST_Response {
		$editor = FormEditor::create();
		$files  = $request->get_file_params();
		$file   = is_array( $files['file'] ?? null ) ? $files['file'] : null;
		if ( null !== $file ) {
			$result = UPLOAD_ERR_OK === ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) && is_string( $file['tmp_name'] ?? null ) && is_file( $file['tmp_name'] )
				? $editor->import_file( $file['tmp_name'] )
				: array(
					'ok'    => false,
					'code'  => 'upload_failed',
					'forms' => array(),
				);
		} else {
			$body   = json_decode( $request->get_body() );
			$result = is_object( $body ) && strlen( $request->get_body() ) <= FormEditor::MAX_IMPORT_BYTES ? $editor->import_export( $body ) : array(
				'ok'    => false,
				'code'  => 'unknown_format',
				'forms' => array(),
			);
		}
		if ( ! $result['ok'] ) {
			$messages = array(
				'file_too_large'     => __( 'The file is too large.', 'funnelforms-free' ),
				'document_too_large' => __( 'The form is too large.', 'funnelforms-free' ),
				'zip_unavailable'    => __( 'This server cannot open ZIP files (PHP extension zip).', 'funnelforms-free' ),
				'no_forms'           => __( 'The file holds no forms.', 'funnelforms-free' ),
				'upload_failed'      => __( 'The file could not be uploaded.', 'funnelforms-free' ),
			);
			return self::error( $result['code'], $messages[ $result['code'] ] ?? __( 'The file is no Funnelforms export.', 'funnelforms-free' ), 400 );
		}
		return new \WP_REST_Response( array( 'forms' => $result['forms'] ), 201 );
	}

	/**
	 * The form of the request.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return array<string,mixed>|null
	 */
	private static function form( \WP_REST_Request $request ): ?array {
		return ( new FormRepository() )->by_id( (int) $request['id'] );
	}

	/**
	 * Takes the edit lock when it is free; an error answer when someone else holds it.
	 *
	 * @param array<string,mixed> $form Form row.
	 */
	private static function locked( array $form ): ?\WP_REST_Response {
		$holder = ( new FormRepository() )->lock( (int) $form['id'], get_current_user_id(), FormEditor::LOCK_TTL, false );
		return get_current_user_id() === $holder ? null : self::lock_error( $holder );
	}

	/**
	 * 409: someone else edits the form.
	 *
	 * @param int $holder User holding the lock.
	 */
	private static function lock_error( int $holder ): \WP_REST_Response {
		return new \WP_REST_Response(
			array(
				'code'     => 'locked',
				'message'  => __( 'Someone else is editing this form.', 'funnelforms-free' ),
				'lockedBy' => self::user( $holder ),
			),
			409
		);
	}

	/**
	 * A form for lists.
	 *
	 * @param array<string,mixed> $row     Form row.
	 * @param int|null            $entries Number of entries, null when the user may not see them.
	 * @return array<string,mixed>
	 */
	private static function summary( array $row, ?int $entries ): array {
		$holder = ( new FormRepository() )->holder( (int) $row['id'], FormEditor::LOCK_TTL );
		// A 3.x form keeps the funnel link it had there (3.x answers it) until one is set here.
		$slug = (string) ( $row['public_slug'] ?? '' );
		if ( '' === $slug && null !== $row['legacy_post_id'] ) {
			$slug = (string) get_post_meta( (int) $row['legacy_post_id'], '_public_slug', true );
		}
		return array(
			'id'              => (int) $row['id'],
			'uid'             => (string) $row['uid'],
			'title'           => (string) $row['title'],
			'category'        => (string) $row['category'],
			'status'          => (string) $row['status'],
			'renderer'        => (string) $row['renderer'],
			'legacyId'        => null === $row['legacy_post_id'] ? null : (int) $row['legacy_post_id'],
			'currentRevision' => null === $row['current_revision_id'] ? null : (int) $row['current_revision_id'],
			'hasDraft'        => (bool) (int) $row['has_draft'],
			'draftUpdatedAt'  => self::time( $row['draft_updated_at'] ),
			'draftAuthor'     => (bool) (int) $row['has_draft'] ? self::user( (int) $row['draft_author'] ) : null,
			'lockedBy'        => 0 === $holder ? null : self::user( $holder ),
			'entries'         => $entries,
			'shortcode'       => null === $row['legacy_post_id'] ? '[funnelforms uid="' . $row['uid'] . '"]' : '[funnelforms id="' . (int) $row['legacy_post_id'] . '"]',
			'publicSlug'      => $slug,
			'publicUrl'       => '' === $slug ? null : FunnelPage::url( $slug ),
			// The address that reaches WordPress on every server, for the hint when the other one does not.
			'publicFallback'  => '' === $slug ? null : FunnelPage::fallback_url( $slug ),
			'createdAt'       => self::time( $row['created_at'] ),
			'updatedAt'       => self::time( $row['updated_at'] ),
		);
	}

	/**
	 * A form with the document the builder edits.
	 *
	 * @param array<string,mixed> $form   Form row.
	 * @param int                 $status HTTP status.
	 */
	public static function detail( array $form, int $status ): \WP_REST_Response {
		$entries = current_user_can( Capabilities::VIEW_ENTRIES ) ? ( ( new FormRepository() )->entry_counts( array( (int) $form['id'] ) )[ (int) $form['id'] ] ?? 0 ) : null;
		return new \WP_REST_Response(
			self::summary( $form, $entries ) + array(
				'document' => FormEditor::create()->editing( $form ),
				'lockTtl'  => FormEditor::LOCK_TTL,
			),
			$status
		);
	}

	/**
	 * A revision for the answer.
	 *
	 * @param array<string,mixed> $row  Revision row.
	 * @param array<string,mixed> $form Form row.
	 * @return array<string,mixed>
	 */
	private static function revision_out( array $row, array $form ): array {
		return array(
			'id'        => (int) $row['id'],
			'current'   => (int) $row['id'] === (int) $form['current_revision_id'],
			'note'      => (string) $row['note'],
			'author'    => 0 === (int) $row['author_id'] ? null : self::user( (int) $row['author_id'] ),
			'createdAt' => self::time( $row['created_at'] ),
		);
	}

	/**
	 * ID and name of a user.
	 *
	 * @param int $id User ID.
	 * @return array{id:int,name:string}
	 */
	private static function user( int $id ): array {
		$user = get_userdata( $id );
		return array(
			'id'   => $id,
			'name' => false === $user ? '' : (string) $user->display_name,
		);
	}

	/**
	 * UTC time in ISO 8601.
	 *
	 * @param mixed $time MySQL time (UTC).
	 */
	private static function time( $time ): ?string {
		return is_string( $time ) && '' !== $time ? gmdate( 'Y-m-d\TH:i:s\Z', (int) strtotime( $time . ' UTC' ) ) : null;
	}

	/**
	 * 404 answer.
	 */
	private static function not_found(): \WP_REST_Response {
		return self::error( 'not_found', __( 'Form not found.', 'funnelforms-free' ), 404 );
	}

	/**
	 * Error answer.
	 *
	 * @param string $code    Code.
	 * @param string $message Message.
	 * @param int    $status  HTTP status.
	 */
	public static function error( string $code, string $message, int $status ): \WP_REST_Response {
		return new \WP_REST_Response(
			array(
				'code'    => $code,
				'message' => $message,
			),
			$status
		);
	}
}
