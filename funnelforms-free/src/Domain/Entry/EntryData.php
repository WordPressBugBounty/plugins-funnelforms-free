<?php
/**
 * Builds the ffx_entries row of a submission.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Entry;

use Funnelforms\Compat\Migration\EntryConverter;
use Funnelforms\Domain\Form\Document;
use Funnelforms\Domain\Form\PhoneNumbers;

defined( 'ABSPATH' ) || exit;

/**
 * Entries from the new runtime use the same `data` layout as entries imported from 3.x
 * (EntryConverter), so lists, exports and integrations treat both alike. meta.v5 keeps the
 * normalized answers so background jobs can rebuild the submission.
 */
final class EntryData {

	/**
	 * Columns of the entry row (without id, uid and form_id).
	 *
	 * @param Submission $s           Submission.
	 * @param int        $revision_id Revision the visitor saw.
	 * @return array<string,mixed>
	 */
	public static function row( Submission $s, int $revision_id ): array {
		$answers = array();
		$hidden  = array();
		foreach ( $s->answered_step_fields() as $field ) {
			$answer = array(
				'fieldId'          => $field['id'],
				'legacyQuestionId' => $field['legacy']['questionId'] ?? null,
				'label'            => $s->label( $field ),
				'value'            => self::value( $s, $field ),
			);
			if ( in_array( $field['type'], array( 'choice', 'dropdown' ), true ) ) {
				$answer['optionIds'] = array_column( $s->chosen_options( $field ), 'id' );
			}
			if ( '' !== $s->unit( $field ) ) {
				// The value stays the number for integrations; lists, exports and the PDF show this.
				$answer['display'] = $s->display_with_unit( $field );
			}
			if ( Document::holds_files( $field ) ) {
				$answer['fileIds'] = array_column( $s->files( $field ), 'id' );
			}
			if ( 'repeat' === $field['type'] ) {
				$answer['items'] = array_column( $s->items( $field ), 'answers' );
			}
			if ( PhoneNumbers::applies( $field ) ) {
				// The value shows the number grouped; integrations and exports also get it in E.164.
				$answer['e164'] = $s->answers[ $field['id'] ];
			}
			if ( 'booking' === $field['type'] && is_array( $s->answers[ $field['id'] ] ?? null ) ) {
				$answer['booking'] = array_intersect_key( $s->answers[ $field['id'] ], array_flip( array( 'start', 'end', 'duration', 'timezone', 'title', 'type' ) ) );
			}
			$hidden_values = $s->hidden_values( $field );
			if ( array() !== $hidden_values ) {
				$answer['hiddenField']         = empty( $field['props']['multiple'] ) ? $hidden_values[0] : $hidden_values;
				$hidden[ $s->label( $field ) ] = $answer['hiddenField'];
			}
			$answers[] = $answer;
		}

		$contact = array();
		$consent = array();
		foreach ( $s->contact_fields() as $field ) {
			$item = array(
				'fieldId'       => $field['id'],
				'legacyFieldId' => $field['key'],
				'label'         => $s->label( $field ),
				'type'          => $field['type'],
				'value'         => $s->contact_display( $field ),
			);
			if ( PhoneNumbers::applies( $field ) && '' !== (string) ( $s->contact_values[ $field['id'] ] ?? '' ) ) {
				$item['e164'] = (string) $s->contact_values[ $field['id'] ];
			}
			$contact[] = $item;
			if ( 'consent' === $field['type'] ) {
				$consent[] = array(
					'fieldId' => $field['id'],
					'checked' => true === ( $s->contact_values[ $field['id'] ] ?? false ),
					'text'    => wp_strip_all_tags( $s->document->text( $field['props']['html'] ?? $field['label'], $s->locale ) ),
				);
			}
		}

		$calculations = array();
		foreach ( $s->calculations as $id => $result ) {
			$calc           = $s->document->calculation( $id );
			$calculations[] = array(
				'calculationId'       => $id,
				'legacyCalculationId' => $calc['legacy']['calculationId'] ?? null,
				'title'               => (string) ( $calc['label'] ?? '' ),
				'value'               => $result['value'],
				'formatted'           => $result['formatted'],
				'error'               => $result['error'],
			);
		}

		return array(
			'status'       => 'complete',
			'locale'       => $s->locale,
			'created_at'   => $s->created_at,
			'completed_at' => $s->created_at,
			'source_url'   => $s->page['url'] ?? null,
			'utm'          => EntryConverter::utm( (string) ( $s->page['query'] ?? '' ) ),
			'data'         => array(
				'version'      => EntryConverter::DATA_VERSION,
				'answers'      => $answers,
				'contact'      => $contact,
				'hiddenFields' => $hidden,
				'calculations' => $calculations,
				'page'         => array(
					'title' => $s->page['title'] ?? null,
					'url'   => $s->page['url'] ?? null,
					'query' => $s->page['query'] ?? null,
				),
			),
			'consent'      => $consent,
			'score'        => self::score( $s ),
			'lead_value'   => self::lead_value( $s ),
			'meta'         => array(
				'v5' => array(
					'revisionId' => $revision_id,
					'contact'    => $s->contact,
					'end'        => $s->end,
					'nodes'      => $s->nodes,
					'fields'     => $s->fields,
					'answers'    => (object) $s->answers,
					'contactRaw' => (object) $s->contact_values,
				) + ( array() === $s->variants ? array() : array( 'variants' => $s->variants ) ),
			),
		);
	}

	/**
	 * Stored answer value: like 3.x leads (option label, list of labels, dropdown value of 3.x forms, raw text).
	 *
	 * @param Submission          $s     Submission.
	 * @param array<string,mixed> $field Field.
	 * @return mixed
	 */
	private static function value( Submission $s, array $field ) {
		if ( 'choice' === $field['type'] && ! empty( $field['props']['multiple'] ) ) {
			return array_map( array( $s, 'option_label' ), $s->chosen_options( $field ) );
		}
		if ( 'dropdown' === $field['type'] && ! empty( $field['props']['multiple'] ) ) {
			// 3.x stored the values; dropdowns of 5.0 the labels, as choices.
			return isset( $field['legacy']['questionId'] ) ? array_map( 'strval', array_column( $s->chosen_options( $field ), 'value' ) ) : array_map( array( $s, 'option_label' ), $s->chosen_options( $field ) );
		}
		if ( Document::holds_files( $field ) ) {
			return array_column( $s->files( $field ), 'name' );
		}
		if ( in_array( $field['type'], array( 'slider', 'number', 'rating' ), true ) ) {
			return $s->answers[ $field['id'] ] ?? null;
		}
		return array_key_exists( $field['id'], $s->answers ) ? $s->display( $field ) : null;
	}

	/**
	 * Rebuilds the submission of a stored entry.
	 *
	 * @param array<string,mixed>               $row      Entry row with decoded data and meta.
	 * @param \Funnelforms\Domain\Form\Document $document Document of meta.v5.revisionId.
	 */
	public static function submission( array $row, \Funnelforms\Domain\Form\Document $document ): Submission {
		$v5 = (array) ( $row['meta']['v5'] ?? array() );
		$s  = new Submission(
			$document,
			(string) $row['locale'],
			(array) ( $v5['nodes'] ?? array() ),
			(array) ( $v5['fields'] ?? array() ),
			(string) ( $v5['contact'] ?? '' ),
			isset( $v5['end'] ) ? (string) $v5['end'] : null,
			(array) ( $v5['answers'] ?? array() ),
			(array) ( $v5['contactRaw'] ?? array() ),
			(array) ( $row['data']['page'] ?? array() ),
			(int) $row['id'],
			(string) $row['created_at']
		);
		if ( is_array( $row['meta']['payment'] ?? null ) ) {
			$s->payment = $row['meta']['payment'];
		}
		if ( is_array( $row['meta']['visit'] ?? null ) ) {
			$s->visit = $row['meta']['visit'];
		}
		return $s;
	}

	/**
	 * Score of the entry: the result of the calculation the form names in settings.scoreCalculation
	 * (lead scoring, quizzes); null without one, on errors and for numbers the column cannot hold.
	 *
	 * @param Submission $s Submission.
	 */
	public static function score( Submission $s ): ?float {
		$id    = (string) ( $s->document->raw()['settings']['scoreCalculation'] ?? '' );
		$value = $s->calculations[ $id ]['value'] ?? null;
		return null === $value || abs( $value ) >= 1e15 ? null : round( $value, 4 );
	}

	/**
	 * Lead value of the entry (Funnelforms Pro): the estimated order value, the result of the
	 * calculation the form names in settings.valueCalculation; null like score().
	 *
	 * @param Submission $s Submission.
	 */
	public static function lead_value( Submission $s ): ?float {
		$id    = (string) ( $s->document->raw()['settings']['valueCalculation'] ?? '' );
		$value = '' === $id ? null : ( $s->calculations[ $id ]['value'] ?? null );
		return null === $value || abs( $value ) >= 1e15 ? null : round( $value, 4 );
	}
}
