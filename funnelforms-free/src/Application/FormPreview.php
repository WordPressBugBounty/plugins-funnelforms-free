<?php
/**
 * Preview of a form in the builder: the draft as visitors would see it, as a test run.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Frontend\Renderer;
use Funnelforms\Http\FormsController;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * The builder shows the preview in a sandboxed frame (no cookies, an origin of its own), so a
 * draft cannot act in the editor's session. Its requests carry a signed token instead: form (or
 * template), user and expiry, signed with the site's auth salt. Each request checks that the user may
 * still edit the form. Nothing of a test run is stored or sent; see Http\PreviewController.
 */
final class FormPreview {

	public const TTL = 2 * HOUR_IN_SECONDS;

	/**
	 * Constructor.
	 *
	 * @param FormRepository $forms Forms.
	 */
	public function __construct( private FormRepository $forms ) {}

	/**
	 * Token of a preview: "<form ID or template id>-<user>-<expiry>-<signature>".
	 *
	 * @param int|string $subject Form ID, or the id of a template (FormTemplates).
	 * @param int        $user_id User who opened the preview.
	 * @param int        $now     Current time.
	 */
	public static function token( int|string $subject, int $user_id, int $now ): string {
		$payload = $subject . '-' . $user_id . '-' . ( $now + self::TTL );
		return $payload . '-' . self::sign( $payload );
	}

	/**
	 * Form and document of a valid token; null when it is forged or expired, the user may no
	 * longer edit forms, or the form is gone. A template stands in as a form with ID 0.
	 *
	 * @param string $token Token.
	 * @param int    $now   Current time.
	 * @return array{form:array<string,mixed>,document:array<string,mixed>}|null
	 */
	public function check( string $token, int $now ): ?array {
		if ( 1 !== preg_match( '/^([0-9a-z]+)-(\d+)-(\d+)-([0-9a-f]{64})$/', $token, $m ) ) {
			return null;
		}
		if ( ! hash_equals( self::sign( $m[1] . '-' . $m[2] . '-' . $m[3] ), $m[4] ) || (int) $m[3] < $now ) {
			return null;
		}
		if ( ! user_can( (int) $m[2], Capabilities::EDIT_FORMS ) ) {
			return null;
		}
		if ( ! ctype_digit( $m[1] ) ) {
			$document = FormTemplates::preview_document( $m[1] );
			return null === $document ? null : array(
				'form'     => self::template_form( $m[1], (string) $document->title ),
				'document' => self::without_captchas( (array) json_decode( FormEditor::encode( $document ), true ) ),
			);
		}
		$form = $this->forms->by_id( (int) $m[1] );
		if ( null === $form || 'trashed' === $form['status'] ) {
			return null;
		}
		$document = $this->document( $form );
		return null === $document ? null : array(
			'form'     => $form,
			'document' => $document,
		);
	}

	/**
	 * The page of the preview frame, or what keeps the draft from being shown.
	 *
	 * @param array<string,mixed> $form    Form row.
	 * @param int                 $user_id Current user.
	 * @param int                 $now     Current time.
	 * @param string              $locale  Language to show, when the form has it; empty as on the website.
	 * @return array{ok:true,html:string}|array{ok:false,problems:string[]}|null Null without a document.
	 */
	public function page( array $form, int $user_id, int $now, string $locale = '' ): ?array {
		$editing = FormEditor::create()->editing( $form );
		if ( null === $editing ) {
			return null;
		}
		$problems = FormEditor::problems( $editing );
		if ( array() !== $problems ) {
			return array(
				'ok'       => false,
				'problems' => $problems,
			);
		}
		return array(
			'ok'   => true,
			'html' => self::html( $form, self::without_captchas( (array) json_decode( FormEditor::encode( $editing ), true ) ), self::token( (int) $form['id'], $user_id, $now ), $locale ),
		);
	}

	/**
	 * The page of the preview frame for a form shown with another document (the setup assistant
	 * shows the new look before it is saved).
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param object              $document Document to show.
	 * @param int                 $user_id  Current user.
	 * @param int                 $now      Current time.
	 * @return array{ok:true,html:string}|array{ok:false,problems:string[]}
	 */
	public static function page_with( array $form, object $document, int $user_id, int $now ): array {
		$problems = FormEditor::problems( $document );
		if ( array() !== $problems ) {
			return array(
				'ok'       => false,
				'problems' => $problems,
			);
		}
		return array(
			'ok'   => true,
			'html' => self::html( $form, self::without_captchas( (array) json_decode( FormEditor::encode( $document ), true ) ), self::token( (int) $form['id'], $user_id, $now ) ),
		);
	}

	/**
	 * The page of the preview frame for a template; null without the template.
	 *
	 * @param string $id      Template id.
	 * @param int    $user_id Current user.
	 * @param int    $now     Current time.
	 * @param string $locale  Language of the template; the site's without.
	 */
	public static function template_page( string $id, int $user_id, int $now, string $locale = '' ): ?string {
		$document = FormTemplates::document( $id, $locale );
		if ( null === $document ) {
			return null;
		}
		return self::html( self::template_form( $id, (string) $document->title ), self::without_captchas( (array) json_decode( FormEditor::encode( $document ), true ) ), self::token( FormTemplates::preview_id( $id, $locale ), $user_id, $now ) );
	}

	/**
	 * A whole page with the runtime and the form, for the frame.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Document.
	 * @param string              $token    Preview token.
	 * @param string              $locale   Language to show, when the form has it.
	 */
	private static function html( array $form, array $document, string $token, string $locale = '' ): string {
		$endpoint = esc_url_raw( rest_url( FormsController::NAMESPACE . '/preview/' . $token ) );
		$assets   = plugins_url( 'assets/runtime/', FUNNELFORMS_PLUGIN_FILE );
		$version  = rawurlencode( (string) FUNNELFORMS_ASSET_VERSION );
		return '<!doctype html><html lang="' . esc_attr( str_replace( '_', '-', Renderer::locale( $document, $locale ) ) ) . '"><head><meta charset="utf-8">'
			. '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">'
			. '<title>' . esc_html( (string) $form['title'] ) . '</title>'
			// A page of its own for the frame, outside the WordPress page that enqueues assets.
			. '<link rel="stylesheet" href="' . esc_url( $assets . 'runtime.css?ver=' . $version ) . '">' // phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedStylesheet
			. ( Renderer::icon_font( $document ) ? '<link rel="stylesheet" href="' . esc_url( Renderer::icon_font_url() ) . '">' : '' ) // phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedStylesheet
			// On the website the form takes the theme's font; the frame has no theme.
			. '<style>body{margin:0;padding:32px 16px;background:#fff;color:#1d1b26;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}</style></head><body>'
			. Renderer::preview( $form, $document, $endpoint, $locale )
			// Before the runtime, so no message of the builder is missed.
			. self::frame_script( $assets . 'runtime-more.css?ver=' . $version )
			. '<script src="' . esc_url( $assets . 'runtime.js?ver=' . $version ) . '"></script>' // phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript
			// The scripts of features the draft has (live results, phone fields), at once.
			. implode( '', array_map( static fn( string $name ): string => '<script id="funnelforms-runtime-' . $name . '-js" src="' . esc_url( Renderer::chunk_url( $name ) ) . '"></script>', Renderer::chunks( $document ) ) ) // phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript
			. '</body></html>';
	}

	/**
	 * Script of the frame (assets/admin/preview-frame.js), inline as the frame has no origin of
	 * the site, and only in the preview, never on the website. It hears only the builder's window:
	 * the style of tokens not saved yet, such as a theme the pointer rests on (Workspaces.tsx,
	 * LivePreview: the form's style attribute, keeping the background image, and the classes
	 * that follow from the tokens), and the design mode, in which a click picks a part of the form
	 * to style (LiveDesign.tsx).
	 *
	 * @param string $more Address of runtime-more.css, for button shadows and capital headings.
	 */
	private static function frame_script( string $more ): string {
		$file   = FUNNELFORMS_PLUGIN_DIR . '/assets/admin/preview-frame.js';
		$script = is_readable( $file ) ? (string) file_get_contents( $file ) : ''; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- A file of the plugin.
		return '' === $script ? '' : '<script data-ffx-more="' . esc_url( $more ) . '">' . str_ireplace( '</script', '<\\/script', $script ) . '</script>';
	}

	/**
	 * What stands in for the form row of a template.
	 *
	 * @param string $id    Template id.
	 * @param string $title Title.
	 * @return array<string,mixed>
	 */
	private static function template_form( string $id, string $title ): array {
		return array(
			'id'                  => 0,
			'uid'                 => 'template-' . $id,
			'title'               => $title,
			'status'              => 'draft',
			'legacy_post_id'      => null,
			'current_revision_id' => null,
		);
	}

	/**
	 * The document the builder edits, as an array, without captchas (a test run needs none).
	 *
	 * @param array<string,mixed> $form Form row.
	 * @return array<string,mixed>|null
	 */
	private function document( array $form ): ?array {
		$editing = FormEditor::create()->editing( $form );
		return null === $editing ? null : self::without_captchas( (array) json_decode( FormEditor::encode( $editing ), true ) );
	}

	/**
	 * The document without captcha fields.
	 *
	 * @param array<string,mixed> $document Document.
	 * @return array<string,mixed>
	 */
	private static function without_captchas( array $document ): array {
		foreach ( (array) ( $document['nodes'] ?? array() ) as $n => $node ) {
			if ( 'contact' === ( $node['type'] ?? '' ) ) {
				$document['nodes'][ $n ]['fields'] = array_values( array_filter( (array) $node['fields'], static fn( $field ): bool => 'captcha' !== ( $field['type'] ?? '' ) ) );
			}
		}
		return $document;
	}

	/**
	 * Signature of a token's payload.
	 *
	 * @param string $payload Form, user and expiry.
	 */
	private static function sign( string $payload ): string {
		return hash_hmac( 'sha256', 'funnelforms-preview|' . $payload, wp_salt( 'auth' ) );
	}
}
