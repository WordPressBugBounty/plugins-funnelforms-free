<?php
/**
 * Creating, saving, publishing, importing and exporting forms for the builder.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Compat\Ff4\Ff4Converter;
use Funnelforms\Compat\Ff4\Ff4Export;
use Funnelforms\Compat\Ff4\Ff4Messages;
use Funnelforms\Compat\Legacy\LegacyCodec;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\FormConverter;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Domain\Form\BlankDocument;
use Funnelforms\Domain\Form\DocumentChecker;
use Funnelforms\Domain\Form\RendererSupport;
use Funnelforms\Domain\Form\SchemaValidator;
use Funnelforms\Domain\Form\SensitiveChanges;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\Icons;
use Funnelforms\Frontend\UiLocale;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\EventRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;
use Funnelforms\Plugin;

defined( 'ABSPATH' ) || exit;

/**
 * A form has at most one draft and a list of revisions; the current revision is what visitors
 * see. Saving changes the draft only; publishing checks the draft against the schema and the
 * document rules, writes it as a new revision and drops the draft. Documents travel as JSON
 * decoded with objects, so {} and [] stay apart.
 */
final class FormEditor {

	/** Seconds an edit lock holds without being renewed. */
	public const LOCK_TTL = 150;

	/** Largest document in bytes. */
	public const MAX_BYTES = 2097152;

	/** Largest import file in bytes. */
	public const MAX_IMPORT_BYTES = 10485760;

	/** Format name of the plugin's own export. */
	public const FORMAT = 'funnelforms-form';

	/**
	 * Creates the use case.
	 *
	 * @param FormRepository $forms     Forms.
	 * @param FormRenderer   $renderers Renderer switch.
	 */
	public function __construct( private FormRepository $forms, private FormRenderer $renderers ) {}

	/**
	 * The use case with its dependencies.
	 */
	public static function create(): self {
		$forms = new FormRepository();
		return new self( $forms, new FormRenderer( $forms, new MigrationStore( SecretBox::for_site() ) ) );
	}

	/**
	 * Creates a form. Without a document it starts with a contact step and an end.
	 *
	 * @param string      $title    Title.
	 * @param string      $category Category.
	 * @param object|null $document Document to start with (import, copy).
	 * @return int Form ID.
	 */
	public function new_form( string $title, string $category, ?object $document = null ): int {
		$locale = null !== $document && is_string( $document->locales->default ?? null ) ? (string) $document->locales->default : get_locale();
		return $this->forms->create(
			$title,
			$category,
			$locale,
			get_current_user_id(),
			static function ( int $id ) use ( $title, $locale, $document ): string {
				if ( null === $document ) {
					// Texts for visitors: in the site's language, not the editor's.
					$texts = UiLocale::run(
						$locale,
						static fn(): array => array(
							'contact' => __( 'Your contact details', 'funnelforms-free' ),
							'name'    => __( 'Name', 'funnelforms-free' ),
							'email'   => __( 'E-mail address', 'funnelforms-free' ),
							'send'    => __( 'Send', 'funnelforms-free' ),
							'thanks'  => __( 'Thank you! We will get back to you soon.', 'funnelforms-free' ),
							'subject' => __( 'New entry', 'funnelforms-free' ),
							'intro'   => __( 'You have a new entry:', 'funnelforms-free' ),
						)
					);
					// The owner hears of every entry from the start, at the site's address.
					return self::encode( BlankDocument::create( 'frm_' . $id, $title, $locale, $texts, (string) get_option( 'admin_email' ) ) );
				}
				$document        = clone $document;
				$document->id    = 'frm_' . $id;
				$document->title = $title;
				return self::encode( $document );
			}
		);
	}

	/**
	 * The document the builder edits: the draft, or the current revision when there is none.
	 *
	 * @param array<string,mixed> $form Form row.
	 */
	public function editing( array $form ): ?object {
		$json = $this->forms->draft( (int) $form['id'] );
		if ( null === $json && null !== $form['current_revision_id'] ) {
			$json = $this->forms->document_json( (int) $form['current_revision_id'] );
		}
		return null === $json ? null : self::decode( $json );
	}

	/**
	 * What keeps a document from being published: schema errors first, then the document rules.
	 *
	 * @param object $document Document.
	 * @return string[]
	 */
	public static function problems( object $document ): array {
		$errors = ( new SchemaValidator() )->validate( $document );
		if ( array() !== $errors ) {
			return $errors;
		}
		$doc      = (array) json_decode( self::encode( $document ), true );
		$bookings = Edition::pro( Bookings::class );
		return array_values( array_unique( array_merge( DocumentChecker::check( $doc ), RendererSupport::problems( $doc ), null === $bookings ? array() : $bookings::create()->problems( $doc ), Edition::problems( $doc ) ) ) );
	}

	/**
	 * Stores the draft. Drafts may be unfinished; the answer lists what publishing would refuse.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param object              $document Document.
	 * @return array{problems:string[],missingRights:string[]}
	 */
	public function save_draft( array $form, object $document ): array {
		$document = ( new SchemaValidator() )->repair( $document );
		$this->forms->save_draft( (int) $form['id'], self::encode( $document ), get_current_user_id(), is_string( $document->title ?? null ) ? (string) $document->title : null );
		return array(
			'problems'      => self::problems( $document ),
			'missingRights' => $this->missing_rights( $form, $document ),
		);
	}

	/**
	 * Capabilities the current user lacks to publish the document (SensitiveChanges).
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param object              $document Document.
	 * @return string[]
	 */
	public function missing_rights( array $form, object $document ): array {
		$before = null === $form['current_revision_id'] ? null : $this->forms->document( (int) $form['current_revision_id'] );
		$after  = (array) json_decode( self::encode( $document ), true );
		$out    = array();
		foreach ( SensitiveChanges::between( $before, $after ) as $kind ) {
			$cap = SensitiveChanges::ENTRIES === $kind ? Capabilities::VIEW_ENTRIES : 'unfiltered_html';
			if ( ! current_user_can( $cap ) ) {
				$out[] = $cap;
			}
		}
		return $out;
	}

	/**
	 * Publishes the draft.
	 *
	 * @param array<string,mixed> $form Form row.
	 * @param string              $note Note of the revision.
	 * @return array<string,mixed> ok; on failure code (no_draft, invalid_document,
	 *                             missing_rights) with problems or missingRights; on success
	 *                             revision, renderer, warnings (why the new renderer cannot
	 *                             show it yet) and experiments (the dates of the A/B tests,
	 *                             ExperimentSchedule::stamp()).
	 */
	public function publish( array $form, string $note ): array {
		$json = $this->forms->draft( (int) $form['id'] );
		if ( null === $json ) {
			return array(
				'ok'   => false,
				'code' => 'no_draft',
			);
		}
		$document = self::decode( $json );
		$problems = null === $document ? array( '/: must be object' ) : self::problems( $document );
		if ( array() !== $problems ) {
			return array(
				'ok'       => false,
				'code'     => 'invalid_document',
				'problems' => $problems,
			);
		}
		$missing = $this->missing_rights( $form, $document );
		if ( array() !== $missing ) {
			return array(
				'ok'            => false,
				'code'          => 'missing_rights',
				'missingRights' => $missing,
			);
		}
		$schedule = Edition::pro( ExperimentSchedule::class );
		$before   = null === $form['current_revision_id'] ? null : $this->forms->document( (int) $form['current_revision_id'] );
		if ( null !== $schedule ) {
			$schedule::stamp( $document, $before, $schedule::today() );
		}
		$revision = $this->forms->publish( (int) $form['id'], self::encode( $document ), (string) $document->title, get_current_user_id(), '' !== $note ? $note : 'builder' );
		if ( null !== $schedule ) {
			$schedule::record_ended( (int) $form['id'], $document, $before, $schedule::today(), new EventRepository() );
		}
		$this->forms->audit(
			'form_published',
			(int) $form['id'],
			array(
				'revision' => $revision,
				'note'     => $note,
			)
		);
		$warnings = $this->go_live( (int) $form['id'] );
		$form     = (array) $this->forms->by_id( (int) $form['id'] );
		return array(
			'ok'          => true,
			'revision'    => $revision,
			'renderer'    => (string) $form['renderer'],
			'warnings'    => $warnings,
			'experiments' => null === $schedule ? array() : $schedule::fields( $document ),
		);
	}

	/**
	 * After publishing: forms from 3.x move to the new renderer, since the 3.x renderer does not
	 * know the builder's version; where that is not possible yet they stay on 3.x and the answer
	 * says why. Forms made in the builder only have the new renderer.
	 *
	 * @param int $form_id Form ID.
	 * @return string[]
	 */
	private function go_live( int $form_id ): array {
		FormRepository::flush();
		$form = (array) $this->forms->by_id( $form_id );
		if ( null === $form['legacy_post_id'] ) {
			return $this->renderers->blockers( $form );
		}
		if ( FormRepository::RENDERER_V5 === $form['renderer'] ) {
			$this->renderers->recheck( $form_id );
			return $this->renderers->blockers( $form );
		}
		return $this->renderers->switch_to( $form_id, FormRepository::RENDERER_V5 );
	}

	/**
	 * Copies a form (its draft, or its current version) into a new form without entries.
	 *
	 * @param array<string,mixed> $form Form row.
	 * @return int|null New form ID, null when the form has no document.
	 */
	public function duplicate( array $form ): ?int {
		$document = $this->editing( $form );
		if ( null === $document ) {
			return null;
		}
		/* translators: %s: title of the copied form */
		$id = $this->new_form( sprintf( __( '%s (copy)', 'funnelforms-free' ), (string) $form['title'] ), (string) $form['category'], $document );
		$this->forms->audit( 'form_created', $id, array( 'copyOf' => (int) $form['id'] ) );
		return $id;
	}

	/**
	 * The plugin's own export of a form.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param object              $document Document.
	 * @return array<string,mixed>
	 */
	public static function export( array $form, object $document ): array {
		return array(
			'format'     => self::FORMAT,
			'version'    => 1,
			'exportedAt' => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'title'      => (string) $form['title'],
			'category'   => (string) $form['category'],
			'document'   => $document,
		);
	}

	/**
	 * Imports a file: an export of this plugin (JSON), an export of Funnelforms 4 (JSON) or a 3.x
	 * export (ZIP with af2_export.txt). Every form becomes a new form with its document as the
	 * draft; nothing goes live.
	 *
	 * @param string $path File.
	 * @return array{ok:bool,code?:string,forms:array<int,array<string,mixed>>}
	 */
	public function import_file( string $path ): array {
		$size = (int) filesize( $path );
		if ( $size <= 0 || $size > self::MAX_IMPORT_BYTES ) {
			return self::import_error( 'file_too_large' );
		}
		$head = (string) file_get_contents( $path, false, null, 0, 4 ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- uploaded file.
		if ( "PK\x03\x04" === $head ) {
			return $this->import_legacy_zip( $path );
		}
		$data = json_decode( (string) file_get_contents( $path ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- uploaded file.
		if ( is_object( $data ) && Ff4Export::recognizes( $data ) ) {
			return $this->import_ff4( $data );
		}
		return is_object( $data ) ? $this->import_export( $data ) : self::import_error( 'unknown_format' );
	}

	/**
	 * Imports an export of Funnelforms 4, the online version (docs/import/funnelforms-4.md):
	 * each form with its logic, contact form, thank-you page, e-mails, webhooks and design.
	 * Appointment fields get a booking type of their own (Pro). Entries stay in Funnelforms 4.
	 *
	 * @param object $data Decoded export.
	 * @return array{ok:bool,code?:string,forms:array<int,array<string,mixed>>}
	 */
	public function import_ff4( object $data ): array {
		$forms = Ff4Export::forms( $data );
		if ( null === $forms ) {
			return self::import_error( 'unknown_format' );
		}
		if ( array() === $forms ) {
			return self::import_error( 'no_forms' );
		}
		$converter = new Ff4Converter(
			array(
				'locale' => get_locale(),
				'icons'  => array_keys( Icons::all() ),
				'texts'  => static fn( string $locale ): array => UiLocale::run(
					$locale,
					static fn(): array => array(
						'contact'    => __( 'Your contact details', 'funnelforms-free' ),
						'send'       => __( 'Send', 'funnelforms-free' ),
						'thanks'     => __( 'Thank you! We will get back to you soon.', 'funnelforms-free' ),
						'next'       => __( 'Next', 'funnelforms-free' ),
						'salutation' => __( 'Salutation', 'funnelforms-free' ),
						'name'       => __( 'Name', 'funnelforms-free' ),
						'email'      => __( 'E-mail address', 'funnelforms-free' ),
						'subject'    => __( 'New entry', 'funnelforms-free' ) . ': {{form:title}}',
						'clear'      => __( 'Clear', 'funnelforms-free' ),
						'type'       => __( 'Type your name instead', 'funnelforms-free' ),
					)
				),
			)
		);
		$bookings  = Edition::pro( Bookings::class );
		$out       = array();
		foreach ( $forms as $snapshot ) {
			$result = $converter->convert( $snapshot );
			if ( ! $result['ok'] ) {
				$out[] = array(
					'sourceId' => $result['sourceId'],
					'title'    => $result['title'],
					'id'       => null,
					'errors'   => $result['errors'],
				);
				continue;
			}
			$document = $result['document'];
			$notes    = $result['notes'];
			foreach ( $result['bookings'] as $booking ) {
				$ref = null === $bookings ? '' : $bookings::imported_type( '' !== $booking['title'] ? self::clean( $booking['title'], 190 ) : $result['title'], $booking['config'] );
				if ( '' === $ref ) {
					$notes[] = 'ff4_booking_type_not_created';
					continue;
				}
				foreach ( $document['nodes'] as $n => $node ) {
					foreach ( $node['fields'] ?? array() as $f => $field ) {
						if ( $booking['field'] === $field['id'] ) {
							$document['nodes'][ $n ]['fields'][ $f ]['props']['bookingTypeRef'] = $ref;
						}
					}
				}
			}
			$encoded = self::encode( $document );
			if ( strlen( $encoded ) > self::MAX_BYTES ) {
				$out[] = array(
					'sourceId' => $result['sourceId'],
					'title'    => $result['title'],
					'id'       => null,
					'errors'   => array( 'document_too_large' ),
				);
				continue;
			}
			$document = self::decode( $encoded );
			$notes    = array_values( array_unique( $notes ) );
			if ( null !== $document ) {
				$document->meta->import->notes = $notes;
				$out[]                         = array(
					'sourceId' => $result['sourceId'],
					'source'   => 'ff4',
				) + $this->imported( self::clean( $result['title'], 255 ), '', $document, $notes ) + array( 'messages' => Ff4Messages::describe_all( $notes ) );
			}
		}
		return array(
			'ok'    => true,
			'forms' => $out,
		);
	}

	/**
	 * Imports an export of this plugin.
	 *
	 * @param object $data Decoded export.
	 * @return array{ok:bool,code?:string,forms:array<int,array<string,mixed>>}
	 */
	public function import_export( object $data ): array {
		if ( self::FORMAT !== ( $data->format ?? null ) || 1 !== ( $data->version ?? null ) || ! is_object( $data->document ?? null ) ) {
			return self::import_error( 'unknown_format' );
		}
		if ( strlen( self::encode( $data->document ) ) > self::MAX_BYTES ) {
			return self::import_error( 'document_too_large' );
		}
		$title = is_string( $data->title ?? null ) && '' !== trim( $data->title ) ? $data->title : (string) ( $data->document->title ?? '' );
		return array(
			'ok'    => true,
			'forms' => array( $this->imported( self::clean( $title, 255 ), self::clean( (string) ( $data->category ?? '' ), 100 ), $data->document, array() ) ),
		);
	}

	/**
	 * Imports a 3.x export: each form with its questions and contact forms, converted as by the
	 * 3.x import. Calculations are not part of 3.x exports; connections (CRM, SMTP) stay behind,
	 * since they belong to the other site; images keep their addresses.
	 *
	 * @param string $path ZIP file.
	 * @return array{ok:bool,code?:string,forms:array<int,array<string,mixed>>}
	 */
	public function import_legacy_zip( string $path ): array {
		$read = self::legacy_documents( $path );
		if ( ! $read['ok'] ) {
			return $read;
		}
		$out = array();
		foreach ( $read['forms'] as $form ) {
			if ( null === $form['document'] ) {
				$out[] = array(
					'legacyId' => $form['legacyId'],
					'id'       => null,
					'errors'   => $form['errors'],
				);
				continue;
			}
			$out[] = array( 'legacyId' => $form['legacyId'] ) + $this->imported( self::clean( (string) $form['document']->title, 255 ), '', $form['document'], $form['notes'] );
		}
		return array(
			'ok'    => true,
			'forms' => $out,
		);
	}

	/**
	 * The forms of a 3.x export, converted to documents (nothing is stored).
	 *
	 * @param string $path ZIP file.
	 * @return array{ok:bool,code?:string,forms:array<int,array{legacyId:int,document:?object,notes:string[],errors:string[]}>}
	 */
	public static function legacy_documents( string $path ): array {
		if ( ! class_exists( \ZipArchive::class ) ) {
			return self::import_error( 'zip_unavailable' );
		}
		$zip = new \ZipArchive();
		if ( true !== $zip->open( $path, \ZipArchive::RDONLY ) ) {
			return self::import_error( 'unknown_format' );
		}
		$stat = $zip->statName( 'af2_export.txt' );
		$raw  = is_array( $stat ) && $stat['size'] <= 4 * self::MAX_IMPORT_BYTES ? $zip->getFromName( 'af2_export.txt' ) : false;
		$zip->close();
		if ( ! is_string( $raw ) ) {
			return self::import_error( 'unknown_format' );
		}
		// The 3.x export: urlencode(serialize(list of {id, post_type, post_content})).
		$items = @unserialize( urldecode( $raw ), array( 'allowed_classes' => array( 'stdClass' ) ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_unserialize, WordPress.PHP.NoSilencedErrors.Discouraged -- 3.x format, objects limited to stdClass.
		if ( ! is_array( $items ) ) {
			return self::import_error( 'unknown_format' );
		}
		$posts = array();
		$forms = array();
		$codec = new LegacyCodec();
		foreach ( $items as $item ) {
			if ( ! $item instanceof \stdClass || ! is_numeric( $item->id ?? null ) || ! in_array( $item->post_type ?? null, LegacyRepository::ALL_TYPES, true ) ) {
				continue;
			}
			$raw_content              = (string) ( $item->post_content ?? '' );
			$posts[ (int) $item->id ] = array(
				'type'    => (string) $item->post_type,
				'content' => $codec->decode( $raw_content ),
				'raw'     => $raw_content,
			);
			if ( LegacyRepository::FORM === $item->post_type ) {
				$forms[] = (int) $item->id;
			}
		}
		if ( array() === $forms ) {
			return self::import_error( 'no_forms' );
		}
		$converter = new FormConverter(
			static fn( int $id ): ?array => $posts[ $id ] ?? null,
			array(
				'locale'     => get_locale(),
				'plugin_url' => '' !== Plugin::file() ? plugins_url( '', Plugin::file() ) : '',
				'no_nl2br'   => 'true' === get_option( 'af2_custom_system_no_nl2br' ),
			)
		);
		$out       = array();
		foreach ( $forms as $legacy_id ) {
			$content = $posts[ $legacy_id ]['content'];
			$result  = is_array( $content ) ? $converter->convert( $legacy_id, $content ) : null;
			if ( null === $result || ! $result['ok'] ) {
				$out[] = array(
					'legacyId' => $legacy_id,
					'document' => null,
					'notes'    => array(),
					'errors'   => null === $result ? array( 'undecodable' ) : $result['errors'],
				);
				continue;
			}
			$document = self::decode( self::encode( $result['document'] ) );
			// The form is new here: it is not the 3.x form of this site.
			unset( $document->meta->legacy );
			$notes = $result['notes'];
			if ( array() !== $result['connections'] ) {
				$notes[] = 'connections_not_imported';
			}
			$out[] = array(
				'legacyId' => $legacy_id,
				'document' => $document,
				'notes'    => $notes,
				'errors'   => array(),
			);
		}
		return array(
			'ok'    => true,
			'forms' => $out,
		);
	}

	/**
	 * Creates an imported form and describes it.
	 *
	 * @param string   $title    Title.
	 * @param string   $category Category.
	 * @param object   $document Document.
	 * @param string[] $notes    Notes of the conversion.
	 * @return array<string,mixed>
	 */
	private function imported( string $title, string $category, object $document, array $notes ): array {
		$id = $this->new_form( '' !== $title ? $title : __( 'Imported form', 'funnelforms-free' ), $category, $document );
		$this->forms->audit( 'form_imported', $id );
		$saved = $this->editing( (array) $this->forms->by_id( $id ) );
		return array(
			'id'       => $id,
			'title'    => (string) ( $this->forms->by_id( $id )['title'] ?? '' ),
			'problems' => null === $saved ? array() : self::problems( $saved ),
			'notes'    => $notes,
		);
	}

	/**
	 * Failed import.
	 *
	 * @param string $code Error code.
	 * @return array{ok:bool,code:string,forms:array<int,array<string,mixed>>}
	 */
	private static function import_error( string $code ): array {
		return array(
			'ok'    => false,
			'code'  => $code,
			'forms' => array(),
		);
	}

	/**
	 * One line of text, at most $max characters.
	 *
	 * @param string $text Text.
	 * @param int    $max  Characters.
	 */
	public static function clean( string $text, int $max ): string {
		return mb_substr( sanitize_text_field( $text ), 0, $max );
	}

	/**
	 * JSON of a document.
	 *
	 * @param mixed $document Document (objects or arrays).
	 */
	public static function encode( $document ): string {
		return (string) wp_json_encode( $document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	}

	/**
	 * A document decoded with objects; null when the JSON is no object. Empty arrays where the
	 * schema wants objects become objects again (older documents were stored from arrays).
	 *
	 * @param string $json JSON.
	 */
	public static function decode( string $json ): ?object {
		$value = json_decode( $json );
		return is_object( $value ) ? ( new SchemaValidator() )->repair( $value ) : null;
	}
}
