<?php
/**
 * One validated submission of a form: the input for the entry, templates and actions.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Entry;

use Funnelforms\Domain\Form\Calculator;
use Funnelforms\Domain\Form\Conditions;
use Funnelforms\Domain\Form\Document;
use Funnelforms\Domain\Form\JsNumber;
use Funnelforms\Domain\Form\PhoneNumbers;
use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Built once when the visitor submits, and rebuilt from the stored entry when a background job
 * sends a mail or webhook later, so both see exactly the same values.
 */
final class Submission {

	/**
	 * Calculation results by calculation id.
	 *
	 * @var array<string,array{ok:bool,value:?float,formatted:string,error:?string}>
	 */
	public array $calculations = array();

	/**
	 * Variants of the A/B tests the visitor was shown, by experiment id.
	 *
	 * @var array<string,string>
	 */
	public array $variants = array();

	/**
	 * Payment of the entry (meta.payment), null without one.
	 *
	 * @var array<string,mixed>|null
	 */
	public ?array $payment = null;

	/**
	 * Lead analysis of the visit (meta.visit, VisitAnalytics), empty when unknown.
	 *
	 * @var array<string,mixed>
	 */
	public array $visit = array();

	/**
	 * Whether label() is filling in answers (a label inside an answer is not filled again).
	 *
	 * @var bool
	 */
	private bool $piping = false;

	/**
	 * Creates the submission.
	 *
	 * @param Document              $document   Form document of the revision that was shown.
	 * @param string                $locale     Locale of the texts.
	 * @param string[]              $nodes      Node ids on the path, in order.
	 * @param string[]              $fields     Step and contact field ids on the path, in order.
	 * @param string                $contact    Contact node that submitted.
	 * @param ?string               $end        End node after the contact node.
	 * @param array<string,mixed>   $answers    Normalized step answers by field id (answered fields only).
	 * @param array<string,mixed>   $contact_values Normalized contact values by field id.
	 * @param array<string,?string> $page       url, query and title of the page.
	 * @param int                   $entry_id   Entry ID once stored, 0 before.
	 * @param string                $created_at Creation time, UTC, Y-m-d H:i:s.
	 */
	public function __construct(
		public Document $document,
		public string $locale,
		public array $nodes,
		public array $fields,
		public string $contact,
		public ?string $end,
		public array $answers,
		public array $contact_values,
		public array $page,
		public int $entry_id = 0,
		public string $created_at = ''
	) {
		// Calculations are Funnelforms Pro; Free has none to compute.
		$calculator = Edition::pro( Calculator::class );
		if ( null === $calculator ) {
			return;
		}
		$values = $calculator::values( $document, $fields, $answers );
		foreach ( $document->calculations() as $id => $calc ) {
			$this->calculations[ $id ] = $calculator::compute( $calc, $values );
		}
	}

	/**
	 * Whether a condition holds for this entry: for its answers and contact values, the results of
	 * its calculations and the variants of the A/B tests it saw. Conditions of actions (`when`)
	 * are checked with it, so leads can go to the person responsible for them.
	 *
	 * @param array<string,mixed> $condition Condition of schema v1.
	 */
	public function meets( array $condition ): bool {
		return Conditions::holds(
			$condition,
			$this->answers + $this->contact_values,
			fn( string $id ): ?float => $this->calculations[ $id ]['value'] ?? null,
			$this->variants,
			array( 'formats' => Conditions::date_formats( $this->document->raw() ) )
		);
	}

	/**
	 * Step fields on the path in order, without content fields.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function answered_step_fields(): array {
		$out = array();
		foreach ( $this->fields as $field_id ) {
			$field = $this->document->field( $field_id );
			if ( null !== $field && ! $this->is_contact_field( $field_id ) && ! in_array( $field['type'], array( 'content', 'result' ), true ) ) {
				$out[] = $field;
			}
		}
		return $out;
	}

	/**
	 * Contact fields of the submitting contact node, without HTML blocks.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function contact_fields(): array {
		$node = $this->document->node( $this->contact );
		$out  = array();
		foreach ( $node['fields'] ?? array() as $field ) {
			if ( 'html' !== $field['type'] && 'captcha' !== $field['type'] ) {
				$out[] = $field;
			}
		}
		return $out;
	}

	/**
	 * Whether a field belongs to the contact node.
	 *
	 * @param string $field_id Field id.
	 */
	public function is_contact_field( string $field_id ): bool {
		$node = $this->document->node( $this->contact );
		foreach ( $node['fields'] ?? array() as $field ) {
			if ( $field['id'] === $field_id ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Label of a field as plain text.
	 *
	 * @param array<string,mixed> $field Field.
	 */
	public function label( array $field ): string {
		$label = trim( html_entity_decode( wp_strip_all_tags( $this->document->text( $field['label'] ?? array(), $this->locale ) ), ENT_QUOTES, 'UTF-8' ) );
		if ( '' === $label && in_array( $field['type'] ?? '', array( 'checkbox', 'consent' ), true ) ) {
			// A checkbox often has its text and no label: "Yes, send me tips …" instead of an empty name.
			$text  = trim( (string) preg_replace( '/\s+/u', ' ', html_entity_decode( wp_strip_all_tags( $this->document->text( (array) ( $field['props']['html'] ?? array() ), $this->locale ) ), ENT_QUOTES, 'UTF-8' ) ) );
			$label = mb_strlen( $text ) > 60 ? rtrim( mb_substr( $text, 0, 59 ) ) . '…' : $text;
		}
		if ( ! str_contains( $label, '{{' ) || $this->piping ) {
			return $label;
		}
		// Answers in questions ("Hello {{field:name}}") as the visitor saw them.
		$this->piping = true;
		$label        = (string) preg_replace_callback( '/\{\{\s*field:([^}\s]+)\s*\}\}/', fn( array $m ): string => (string) $this->value_by_key( $m[1] ), $label );
		$this->piping = false;
		return $label;
	}

	/**
	 * The chosen options of a choice or dropdown field.
	 *
	 * @param array<string,mixed> $field Field.
	 * @return array<int,array<string,mixed>>
	 */
	public function chosen_options( array $field ): array {
		$ids = (array) ( $this->answers[ $field['id'] ] ?? array() );
		return array_values( array_filter( $field['options'] ?? array(), static fn( $o ) => in_array( $o['id'], $ids, true ) ) );
	}

	/**
	 * Uploaded files of a file field: id, name and size of each.
	 *
	 * @param array<string,mixed> $field Field.
	 * @return array<int,array{id:int,name:string,size:int}>
	 */
	public function files( array $field ): array {
		if ( ! Document::holds_files( $field ) ) {
			return array();
		}
		$out = array();
		foreach ( (array) ( $this->answers[ $field['id'] ] ?? array() ) as $file ) {
			if ( is_array( $file ) && isset( $file['id'] ) ) {
				$out[] = array(
					'id'   => (int) $file['id'],
					'name' => (string) ( $file['name'] ?? '' ),
					'size' => (int) ( $file['size'] ?? 0 ),
				);
			}
		}
		return $out;
	}

	/**
	 * Download links of the files of a file field.
	 *
	 * @param array<string,mixed> $field Field.
	 * @return string[]
	 */
	public function file_links( array $field ): array {
		return array_map( static fn( array $file ): string => \Funnelforms\Http\FileDownload::url( $file['id'] ), $this->files( $field ) );
	}

	/**
	 * Visible text of an option.
	 *
	 * @param array<string,mixed> $option Option.
	 */
	public function option_label( array $option ): string {
		return trim( html_entity_decode( wp_strip_all_tags( $this->document->text( $option['label'] ?? array(), $this->locale ) ), ENT_QUOTES, 'UTF-8' ) );
	}

	/**
	 * Answer of a step field as text, the way 3.x showed it in mails and leads.
	 *
	 * @param array<string,mixed> $field     Field.
	 * @param string              $separator Separator between several chosen options.
	 */
	public function display( array $field, string $separator = "\n" ): string {
		if ( ! array_key_exists( $field['id'], $this->answers ) ) {
			return '';
		}
		switch ( $field['type'] ) {
			case 'file':
			case 'signature':
				return implode( $separator, array_column( $this->files( $field ), 'name' ) );
			case 'choice':
				return implode( $separator, array_map( array( $this, 'option_label' ), $this->chosen_options( $field ) ) );
			case 'dropdown':
				// 3.x stored and mailed the option value; dropdowns of 5.0 show the label, as choices do.
				if ( ! isset( $field['legacy']['questionId'] ) ) {
					return implode( $separator, array_map( array( $this, 'option_label' ), $this->chosen_options( $field ) ) );
				}
				return implode( $separator, array_map( 'strval', array_column( $this->chosen_options( $field ), 'value' ) ) );
			case 'booking':
				// Stored with the readable time when it was booked (Application\Bookings::answer).
				$booking = (array) $this->answers[ $field['id'] ];
				return (string) ( $booking['text'] ?? $booking['start'] ?? '' );
			case 'slider':
				// A range slider answers [from, to].
				if ( is_array( $this->answers[ $field['id'] ] ) ) {
					return implode( AnswerValidator::RANGE_SEPARATOR, array_map( array( JsNumber::class, 'to_string' ), $this->answers[ $field['id'] ] ) );
				}
				break;
			case 'rating':
				// A scale with own texts: "Good (4)".
				$answer = $this->answers[ $field['id'] ];
				if ( 'labels' === ( $field['props']['show'] ?? '' ) && is_numeric( $answer ) ) {
					$text = trim( wp_strip_all_tags( $this->document->text( $field['props']['labels'][ (int) $answer - (int) ( $field['props']['min'] ?? 1 ) ] ?? array(), $this->locale ) ) );
					if ( '' !== $text ) {
						return $text . ' (' . JsNumber::to_string( $answer ) . ')';
					}
				}
				break;
			case 'repeat':
				// One item per line, or separated by semicolons in one line.
				return implode( "\n" === $separator ? "\n" : '; ', array_map( array( $this, 'item_text' ), $this->items( $field ) ) );
			case 'phone':
				// Stored in E.164, shown grouped: +49 1512 3456789.
				if ( PhoneNumbers::applies( $field ) ) {
					return PhoneNumbers::display( (string) $this->answers[ $field['id'] ] );
				}
				break;
		}
		return JsNumber::to_string( $this->answers[ $field['id'] ] );
	}

	/**
	 * Answer of a step field as text for people (mails, entries, CSV, PDF, the end page): like
	 * display(), the numbers of sliders and number fields with their unit ("100 m²", "10 m² – 20 m²").
	 *
	 * @param array<string,mixed> $field     Field.
	 * @param string              $separator Separator between several chosen options.
	 */
	public function display_with_unit( array $field, string $separator = "\n" ): string {
		$text  = $this->display( $field, $separator );
		$unit  = $this->unit( $field );
		$group = 'slider' === $field['type'] && ! empty( $field['props']['thousandsSeparator'] );
		if ( '' === $text || ( '' === $unit && ! $group ) ) {
			return $text;
		}
		$before = 'before' === ( $field['props']['unit']['position'] ?? 'after' );
		$parts  = is_array( $this->answers[ $field['id'] ] ?? null ) ? explode( AnswerValidator::RANGE_SEPARATOR, $text ) : array( $text );
		if ( $group ) {
			// As the slider showed it: "4.000 kWh", not "4000 kWh".
			$parts = array_map( static fn( string $n ): string => self::grouped( $n, (string) ( $field['props']['separator'] ?? '.' ) ), $parts );
		}
		if ( '' === $unit ) {
			return implode( AnswerValidator::RANGE_SEPARATOR, $parts );
		}
		return implode( AnswerValidator::RANGE_SEPARATOR, array_map( static fn( string $n ): string => $before ? $unit . ' ' . $n : $n . ' ' . $unit, $parts ) );
	}

	/**
	 * A number with thousands separators the way the slider of the runtime shows it (fields.ts sliderText):
	 * "1.234,5" with ".", "1,234.5" with ",".
	 *
	 * @param string $number    Number as JsNumber::to_string() writes it.
	 * @param string $separator Thousands separator.
	 */
	private static function grouped( string $number, string $separator ): string {
		if ( ! preg_match( '/^(-?)(\d+)(?:\.(\d+))?$/', $number, $m ) ) {
			return $number;
		}
		$decimal = ',' === $separator ? '.' : ',';
		return $m[1] . preg_replace( '/\B(?=(\d{3})+(?!\d))/', $separator, $m[2] ) . ( isset( $m[3] ) ? $decimal . $m[3] : '' );
	}

	/**
	 * Unit of a slider or number field as plain text; empty without one.
	 *
	 * @param array<string,mixed> $field Field.
	 */
	public function unit( array $field ): string {
		if ( ! in_array( $field['type'] ?? '', array( 'slider', 'number' ), true ) || ! is_array( $field['props']['unit'] ?? null ) ) {
			return '';
		}
		return trim( html_entity_decode( wp_strip_all_tags( $this->document->text( (array) ( $field['props']['unit']['text'] ?? array() ), $this->locale ) ), ENT_QUOTES, 'UTF-8' ) );
	}

	/**
	 * The first appointment booked with the entry (Application\Bookings::answer); null without.
	 *
	 * @return array<string,mixed>|null
	 */
	public function booking(): ?array {
		foreach ( $this->fields as $field_id ) {
			$field = $this->document->field( $field_id );
			if ( null !== $field && 'booking' === $field['type'] && is_array( $this->answers[ $field_id ] ?? null ) && isset( $this->answers[ $field_id ]['date'] ) ) {
				return $this->answers[ $field_id ];
			}
		}
		return null;
	}

	/**
	 * Items of a repeat group: heading and the answered sub-fields of each, as text.
	 *
	 * @param array<string,mixed> $field Repeat group.
	 * @return array<int,array{heading:string,answers:array<int,array{fieldId:string,label:string,value:string}>}>
	 */
	public function items( array $field ): array {
		if ( 'repeat' !== $field['type'] ) {
			return array();
		}
		$heading = $this->label( array( 'label' => $field['props']['itemLabel'] ?? array() ) );
		$out     = array();
		foreach ( array_values( (array) ( $this->answers[ $field['id'] ] ?? array() ) ) as $i => $item ) {
			$answers = array();
			foreach ( $field['props']['fields'] ?? array() as $sub ) {
				if ( ! is_array( $item ) || ! array_key_exists( $sub['id'], $item ) ) {
					continue;
				}
				$value = $item[ $sub['id'] ];
				if ( 'dropdown' === $sub['type'] ) {
					$chosen = array_values( array_filter( $sub['options'] ?? array(), static fn( $o ) => in_array( $o['id'], (array) $value, true ) ) );
					$value  = array() === $chosen ? '' : $this->option_label( $chosen[0] );
				} elseif ( is_string( $value ) && PhoneNumbers::applies( $sub ) ) {
					$value = PhoneNumbers::display( $value );
				}
				$answers[] = array(
					'fieldId' => (string) $sub['id'],
					'label'   => $this->label( $sub ),
					'value'   => \Funnelforms\Domain\Form\JsNumber::to_string( $value ),
				);
			}
			$out[] = array(
				'heading' => '' === $heading ? ( $i + 1 ) . '.' : ( str_contains( $heading, '%d' ) ? str_replace( '%d', (string) ( $i + 1 ), $heading ) : $heading . ' ' . ( $i + 1 ) ),
				'answers' => $answers,
			);
		}
		return $out;
	}

	/**
	 * One item of a repeat group in one line: "Person 1: Name: Ada, Age: 30".
	 *
	 * @param array{heading:string,answers:array<int,array{label:string,value:string}>} $item Item.
	 */
	private function item_text( array $item ): string {
		$pairs = array_map( static fn( array $a ): string => ( '' === $a['label'] ? '' : $a['label'] . ': ' ) . $a['value'], $item['answers'] );
		return $item['heading'] . ( str_ends_with( $item['heading'], '.' ) ? ' ' : ': ' ) . implode( ', ', $pairs );
	}

	/**
	 * Hidden values of the chosen options of a choice field.
	 *
	 * @param array<string,mixed> $field Field.
	 * @return string[]
	 */
	public function hidden_values( array $field ): array {
		if ( 'choice' !== $field['type'] ) {
			return array();
		}
		$out = array();
		foreach ( $this->chosen_options( $field ) as $option ) {
			if ( isset( $option['hiddenValue'] ) && '' !== trim( (string) $option['hiddenValue'] ) ) {
				$out[] = (string) $option['hiddenValue'];
			}
		}
		return $out;
	}

	/**
	 * Value of a contact field as text: consent as "true"/"false" as in 3.x, boxes to tick as
	 * yes or no, a choice from a list as its label.
	 *
	 * @param array<string,mixed> $field Contact field.
	 */
	public function contact_display( array $field ): string {
		$value = $this->contact_values[ $field['id'] ] ?? null;
		switch ( $field['type'] ) {
			case 'consent':
				return true === $value ? 'true' : 'false';
			case 'checkbox':
				return true === $value ? __( 'Yes', 'funnelforms-free' ) : __( 'No', 'funnelforms-free' );
			case 'select':
				foreach ( (array) ( $field['props']['options'] ?? array() ) as $option ) {
					if ( ( $option['id'] ?? null ) === $value ) {
						return $this->option_label( $option );
					}
				}
				return '';
		}
		if ( is_string( $value ) && PhoneNumbers::applies( $field ) ) {
			return PhoneNumbers::display( $value );
		}
		return is_scalar( $value ) ? (string) $value : '';
	}

	/**
	 * Text of a field addressed by its key: contact fields first, then the last step field on the path.
	 *
	 * @param string $key Field key.
	 */
	public function value_by_key( string $key ): ?string {
		foreach ( $this->contact_fields() as $field ) {
			if ( $field['key'] === $key ) {
				return $this->contact_display( $field );
			}
		}
		$found = null;
		foreach ( $this->answered_step_fields() as $field ) {
			if ( $field['key'] === $key ) {
				$found = $this->display( $field, ', ' );
			}
		}
		return $found;
	}
}
