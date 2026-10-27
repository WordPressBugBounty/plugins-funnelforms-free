<?php
/**
 * Imports forms of other form plugins as drafts.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import;

use Funnelforms\Application\FormEditor;
use Funnelforms\Compat\Import\Readers\ContactForm7;
use Funnelforms\Compat\Import\Readers\Elementor;
use Funnelforms\Compat\Import\Readers\FluentForms;
use Funnelforms\Compat\Import\Readers\Formidable;
use Funnelforms\Compat\Import\Readers\GravityForms;
use Funnelforms\Compat\Import\Readers\NinjaForms;
use Funnelforms\Compat\Import\Readers\WpForms;
use Funnelforms\Frontend\UiLocale;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Reads forms from an export file or from the other plugin's data on this site, turns them into
 * documents (DocumentBuilder) and creates each as a new draft form; nothing goes live. The other
 * plugin's data stays untouched. A form taken from this site is noted in the audit log
 * (form_imported with source and sourceId), so a second run skips it unless asked otherwise.
 */
final class Importer {

	/**
	 * Importer.
	 *
	 * @param FormEditor           $editor  Creates the forms.
	 * @param FormRepository       $forms   Forms and audit log.
	 * @param array<string,Reader> $readers Readers by key.
	 */
	public function __construct( private FormEditor $editor, private FormRepository $forms, private array $readers ) {}

	/**
	 * The importer with every reader.
	 */
	public static function create(): self {
		return new self( FormEditor::create(), new FormRepository(), self::default_readers() );
	}

	/**
	 * Every reader, by key.
	 *
	 * @return array<string,Reader>
	 */
	public static function default_readers(): array {
		$out = array();
		foreach ( array( new WpForms(), new GravityForms(), new NinjaForms(), new FluentForms(), new ContactForm7(), new Formidable(), new Elementor() ) as $reader ) {
			$out[ $reader->key() ] = $reader;
		}
		return $out;
	}

	/**
	 * Plugins with forms on this site, with the form each was imported to.
	 *
	 * @return array<int,array{source:string,label:string,forms:array<int,array{id:string,title:string,importedAs:?int}>}>
	 */
	public function sources(): array {
		$out = array();
		foreach ( $this->readers as $key => $reader ) {
			$forms = $reader->list_site();
			if ( array() === $forms ) {
				continue;
			}
			$done  = $this->imported( $key );
			$out[] = array(
				'source' => $key,
				'label'  => $reader->label(),
				'forms'  => array_map(
					static fn( array $f ): array => $f + array( 'importedAs' => $done[ $f['id'] ] ?? null ),
					$forms
				),
			);
		}
		return $out;
	}

	/**
	 * Imports the forms of an export file of another plugin.
	 *
	 * @param string $contents File contents.
	 * @return array{ok:bool,code?:string,source?:string,forms:array<int,array<string,mixed>>}
	 */
	public function import_file( string $contents ): array {
		if ( '' === $contents || strlen( $contents ) > FormEditor::MAX_IMPORT_BYTES ) {
			return self::error( 'file_too_large' );
		}
		foreach ( $this->readers as $key => $reader ) {
			if ( ! $reader->recognizes( $contents ) ) {
				continue;
			}
			$forms = $reader->parse_file( $contents );
			if ( array() === $forms ) {
				return self::error( 'no_forms' );
			}
			return array(
				'ok'     => true,
				'source' => $key,
				'forms'  => array_map( fn( ImportedForm $form ): array => $this->create_form( $form, false ), $forms ),
			);
		}
		return self::error( 'unknown_format' );
	}

	/**
	 * Imports forms of another plugin on this site.
	 *
	 * @param string   $source Reader key.
	 * @param string[] $ids    Form ids from sources().
	 * @param bool     $again  Whether to import forms that were imported before once more.
	 * @return array{ok:bool,code?:string,source?:string,forms:array<int,array<string,mixed>>}
	 */
	public function import_site( string $source, array $ids, bool $again = false ): array {
		$reader = $this->readers[ $source ] ?? null;
		if ( null === $reader ) {
			return self::error( 'unknown_source' );
		}
		$done = $this->imported( $source );
		$out  = array();
		foreach ( array_unique( array_map( 'strval', $ids ) ) as $id ) {
			if ( ! $again && isset( $done[ $id ] ) ) {
				$out[] = array(
					'source'   => $source,
					'sourceId' => $id,
					'id'       => $done[ $id ],
					'skipped'  => 'already_imported',
				);
				continue;
			}
			$form = $reader->read_site( $id );
			if ( null !== $form ) {
				// The id on this site, also when the stored form names another one.
				$form->source_id = $id;
			}
			$out[] = null === $form ? array(
				'source'   => $source,
				'sourceId' => $id,
				'id'       => null,
				'skipped'  => 'not_found',
			) : $this->create_form( $form, true );
		}
		return array(
			'ok'     => true,
			'source' => $source,
			'forms'  => $out,
		);
	}

	/**
	 * The document of a form and what the import changed, without storing anything.
	 *
	 * @param ImportedForm $form Form.
	 * @return array{document:array<string,mixed>,notes:string[]}
	 */
	public static function build( ImportedForm $form ): array {
		$locale = get_locale();
		$texts  = UiLocale::run(
			$locale,
			static fn(): array => array(
				'contact' => __( 'Your contact details', 'funnelforms-free' ),
				'send'    => __( 'Send', 'funnelforms-free' ),
				'thanks'  => __( 'Thank you! We will get back to you soon.', 'funnelforms-free' ),
				'next'    => __( 'Next', 'funnelforms-free' ),
			)
		);
		$texts += array(
			'admin_email' => (string) get_option( 'admin_email' ),
			'site_title'  => wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES ),
			'site_url'    => home_url( '/' ),
		);
		return ( new DocumentBuilder( $locale, $texts ) )->build( $form );
	}

	/**
	 * Creates the draft form of an imported form and describes it.
	 *
	 * @param ImportedForm $form   Form.
	 * @param bool         $record Whether to remember it as imported from this site.
	 * @return array<string,mixed>
	 */
	private function create_form( ImportedForm $form, bool $record ): array {
		$built    = self::build( $form );
		$json     = FormEditor::encode( $built['document'] );
		$document = FormEditor::decode( $json );
		$base     = array(
			'source'   => $form->source,
			'sourceId' => $form->source_id,
		);
		if ( null === $document || strlen( $json ) > FormEditor::MAX_BYTES ) {
			return $base + array(
				'id'      => null,
				'skipped' => 'document_too_large',
			);
		}
		$title = trim( wp_strip_all_tags( $form->title ) );
		$title = '' !== $title ? mb_substr( $title, 0, 255 ) : sprintf(
			/* translators: 1: name of a form plugin, 2: id of the form there */
			__( '%1$s form %2$s', 'funnelforms-free' ),
			$this->readers[ $form->source ]->label(),
			$form->source_id
		);
		$id = $this->editor->new_form( $title, '', $document );
		$this->forms->audit( 'form_imported', $id, $record ? $base : array( 'source' => $form->source ) );
		return $base + array(
			'id'       => $id,
			'title'    => $title,
			'problems' => FormEditor::problems( $document ),
			'notes'    => $built['notes'],
			'messages' => array_values( array_unique( array_map( array( self::class, 'describe' ), $built['notes'] ) ) ),
		);
	}

	/**
	 * Form ids of a plugin on this site that were imported, with the form they became, as long as
	 * that form still exists.
	 *
	 * @param string $source Reader key.
	 * @return array<string,int>
	 */
	private function imported( string $source ): array {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT object_id, details FROM %i WHERE action = 'form_imported' AND details LIKE %s ORDER BY id", Schema::table( 'audit_log' ), '%' . $wpdb->esc_like( '"source":"' . $source . '","sourceId":' ) . '%' ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$out  = array();
		foreach ( is_array( $rows ) ? $rows : array() as $row ) {
			$details = json_decode( (string) $row['details'], true );
			if ( is_array( $details ) && null !== $this->forms->by_id( (int) $row['object_id'] ) ) {
				$out[ (string) ( $details['sourceId'] ?? '' ) ] = (int) $row['object_id'];
			}
		}
		return $out;
	}

	/**
	 * A note of the import in words.
	 *
	 * @param string $note Code with details after ":".
	 */
	public static function describe( string $note ): string {
		$parts  = explode( ':', $note, 2 );
		$detail = $parts[1] ?? '';
		switch ( $parts[0] ) {
			case 'field_type_not_imported':
				$type = explode( ':', $detail, 2 );
				/* translators: 1: label of a field, 2: its type in the other plugin */
				return sprintf( __( 'Field "%1$s" (%2$s) has no counterpart and was left out.', 'funnelforms-free' ), $type[1] ?? '', $type[0] );
			case 'conditional_logic_not_imported':
				/* translators: %s: label of a field */
				return sprintf( __( 'Conditions of "%s" were not taken over; it is always shown. Rebuild them with branches.', 'funnelforms-free' ), $detail );
			case 'hidden_field_not_imported':
				/* translators: %s: label of a field */
				return sprintf( __( 'Hidden field "%s" was left out; use URL parameters or tracking instead.', 'funnelforms-free' ), $detail );
			case 'captcha_not_imported':
				return __( 'The CAPTCHA was left out; add one to the contact step or set up the site-wide captcha (Turnstile or hCaptcha).', 'funnelforms-free' );
			case 'admin_only_field_not_imported':
				/* translators: %s: label of a field */
				return sprintf( __( 'Field "%s" was only visible to administrators and was left out.', 'funnelforms-free' ), $detail );
			case 'no_contact_fields':
				return __( 'The form had no contact fields; add them to the contact step before publishing.', 'funnelforms-free' );
			case 'fields_moved_before_contact_step':
				return __( 'Questions that are no contact data are asked in a step before the contact step.', 'funnelforms-free' );
			case 'choice_without_options':
				/* translators: %s: label of a field */
				return sprintf( __( 'Choice "%s" had no options; replace its placeholder option.', 'funnelforms-free' ), $detail );
			case 'template_field_not_imported':
			case 'template_tag_not_imported':
				/* translators: %s: placeholder in an e-mail or message */
				return sprintf( __( 'Placeholder %s in an e-mail or message has no counterpart and was removed.', 'funnelforms-free' ), $detail );
			case 'notification_conditions_not_imported':
			case 'action_conditions_not_imported':
				return __( 'An e-mail or action was sent only under conditions; it is now always sent.', 'funnelforms-free' );
			case 'notification_routing_not_imported':
				return __( 'Recipients chosen by rules (routing) were not taken over; the e-mail goes to the admin address.', 'funnelforms-free' );
			case 'notification_not_on_submit_skipped':
				return __( 'An e-mail that was not sent on submission was left out.', 'funnelforms-free' );
			case 'action_not_imported':
				/* translators: %s: name of an action in the other plugin */
				return sprintf( __( 'Action "%s" was not taken over; set it up again under actions.', 'funnelforms-free' ), $detail );
			case 'only_first_confirmation_imported':
			case 'only_default_confirmation_imported':
				return __( 'Only one confirmation was taken over; others depended on conditions.', 'funnelforms-free' );
			case 'success_message_replaced_by_redirect':
				return __( 'The form redirected after the success message; only the redirect was kept.', 'funnelforms-free' );
			case 'confirmation_page_not_found':
			case 'redirect_without_address':
				return __( 'The page shown after sending was not found; the form shows a thank-you text.', 'funnelforms-free' );
			case 'field_outside_layout':
				/* translators: %s: key of a field */
				return sprintf( __( 'Field "%s" was not placed on a page and was added at the end.', 'funnelforms-free' ), $detail );
			case 'date_time_imported_as_date':
				/* translators: %s: label of a field */
				return sprintf( __( 'Field "%s" asked for date and time; it asks for the date now.', 'funnelforms-free' ), $detail );
		}
		return $note;
	}

	/**
	 * Failed import.
	 *
	 * @param string $code Error code.
	 * @return array{ok:bool,code:string,forms:array<int,array<string,mixed>>}
	 */
	private static function error( string $code ): array {
		return array(
			'ok'    => false,
			'code'  => $code,
			'forms' => array(),
		);
	}
}
