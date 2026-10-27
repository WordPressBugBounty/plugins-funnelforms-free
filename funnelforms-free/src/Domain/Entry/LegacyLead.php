<?php
/**
 * The 3.x lead structure, for receivers that were built against 3.x.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Entry;

use Funnelforms\Domain\Form\Document;

defined( 'ABSPATH' ) || exit;

/**
 * Webhooks and redirect parameters of 3.x carried the lead as "zapier_json" (frontend/frontend.php
 * af2_create_answers_json, af2_create_cf_json, af2_executeWebhook). Existing receivers parse that
 * shape, so forms switched to the new renderer send it unchanged, quirks included: question titles
 * pass through addslashes, multiple choices are joined with ";", textarea line breaks become <br>.
 */
final class LegacyLead {

	private const CONTACT_TYPES = array(
		'salutation' => 'salutation_type',
		'name'       => 'text_type_name',
		'email'      => 'text_type_mail',
		'phone'      => 'text_type_phone',
		'text'       => 'text_type_plain',
		'consent'    => 'checkbox_type',
		'checkbox'   => 'checkbox_type',
		'select'     => 'text_type_plain',
		'textarea'   => 'text_type_plain',
	);

	/**
	 * The zapier_json of 3.x.
	 *
	 * @param Submission $s Submission.
	 * @return array<string,mixed>
	 */
	public static function zapier_json( Submission $s ): array {
		$legacy_form = $s->document->raw()['meta']['legacy']['formId'] ?? null;
		$json        = array(
			'form_id'         => null !== $legacy_form ? (string) $legacy_form : (string) ( $s->document->raw()['id'] ?? '' ),
			'questions'       => array(),
			'contact_form'    => array(),
			'questions_by_id' => array(),
			'hidden_fields'   => array(),
		);

		// z counts every node on the path before the contact node; content steps take a number but no entry.
		$z = -1;
		foreach ( $s->nodes as $node_id ) {
			if ( $node_id === $s->contact ) {
				break;
			}
			$node = $s->document->node( $node_id );
			foreach ( $node['fields'] ?? array() as $field ) {
				++$z;
				if ( in_array( $field['type'], array( 'content', 'result' ), true ) ) {
					continue;
				}
				$frage    = addslashes( $s->label( $field ) );
				$question = array(
					'id'      => $field['legacy']['questionId'] ?? $field['id'],
					'frage'   => $frage,
					'antwort' => self::antwort( $s, $field ),
				);
				if ( Document::holds_files( $field ) ) {
					$question['file_upload_public'] = 'public' === ( $field['props']['visibility'] ?? '' ) ? 'true' : 'false';
				}
				$hidden = $s->hidden_values( $field );
				if ( array() !== $hidden ) {
					$question['hidden_field']        = empty( $field['props']['multiple'] ) ? $hidden[0] : $hidden;
					$json['hidden_fields'][ $frage ] = $question['hidden_field'];
				}
				$json['questions'][ $z ] = $question;
				// 3.x filled questions_by_id[z] with the last value of the question (a bug kept for receivers).
				$json['questions_by_id'][ $z ] = end( $question );
			}
		}

		foreach ( $s->contact_fields() as $field ) {
			$json['contact_form'][] = array(
				'id'    => $field['key'],
				'label' => $s->document->text( $field['label'], $s->locale ),
				'input' => trim( $s->contact_display( $field ) ),
				'typ'   => self::CONTACT_TYPES[ $field['type'] ] ?? $field['type'],
			);
		}

		$json['analyticsData']   = array(
			array(
				'id'    => 'queryString',
				'value' => (string) ( $s->page['query'] ?? '' ),
			),
			array(
				'id'    => 'url',
				'value' => (string) ( $s->page['url'] ?? '' ),
			),
			array(
				'id'    => 'post_title',
				'value' => (string) ( $s->page['title'] ?? '' ),
			),
		);
		$json['calculationData'] = self::calculation_data( $s );
		return $json;
	}

	/**
	 * Body of the webhook POST, as af2_executeWebhook built it.
	 *
	 * @param Submission $s Submission.
	 * @return array<string,mixed>
	 */
	public static function webhook_payload( Submission $s ): array {
		$json = self::zapier_json( $s );
		$out  = array(
			'form_id'               => $json['form_id'],
			'lead_id'               => $s->entry_id,
			'lead_timestamp'        => '' === $s->created_at ? '' : get_date_from_gmt( $s->created_at ),
			'analytics_data'        => array(
				'query_string' => $json['analyticsData'][0]['value'],
				'url'          => $json['analyticsData'][1]['value'],
			),
			'all_question_data'     => '',
			'all_questions_by_id'   => array(),
			'all_contact_form_data' => '',
		);
		foreach ( $json['questions'] as $q ) {
			$out['questions'][ $q['frage'] ]        = $q['antwort'];
			$out['all_question_data']              .= $q['frage'] . "\n" . self::flat( $q['antwort'] ) . "\n\n";
			$out['all_questions_by_id'][ $q['id'] ] = array(
				'question'     => $q['frage'],
				'answer'       => $q['antwort'],
				'hidden_field' => $q['hidden_field'] ?? null,
			);
		}
		foreach ( $json['contact_form'] as $cf ) {
			$out['contact_form'][ $cf['id'] ] = $cf['input'];
			$out['all_contact_form_data']    .= $cf['id'] . "\n" . $cf['input'] . "\n\n";
		}
		$out['hidden_fields']   = $json['hidden_fields'];
		$out['calculationData'] = $json['calculationData'];
		// Forms with a lead value (settings.valueCalculation, 5.0) send it along; 3.x had none.
		if ( isset( $s->document->raw()['settings']['valueCalculation'] ) ) {
			$out['lead_value'] = EntryData::lead_value( $s );
		}
		return $out;
	}

	/**
	 * Answer of one question in zapier_json.
	 *
	 * @param Submission          $s     Submission.
	 * @param array<string,mixed> $field Field.
	 * @return mixed
	 */
	private static function antwort( Submission $s, array $field ) {
		switch ( $field['type'] ) {
			case 'file':
			case 'signature':
				// 3.x sent the list of file URLs.
				return $s->file_links( $field );
			case 'choice':
				return $s->display( $field, ';' );
			case 'textarea':
				return str_replace( "\n", '<br>', $s->display( $field ) );
		}
		return $s->display( $field );
	}

	/**
	 * Calculation results of 3.x: only calculations used in the admin mail text, unformatted.
	 *
	 * @param Submission $s Submission.
	 * @return array<string,array{title:string,value:mixed}>
	 */
	private static function calculation_data( Submission $s ): array {
		$used = '';
		foreach ( $s->document->submit_actions( $s->contact ) as $action ) {
			if ( 'email' === $action['kind'] ) {
				$used .= wp_json_encode( $action['config']['body'] ?? array() );
			}
		}
		$out = array();
		foreach ( $s->calculations as $id => $result ) {
			if ( ! str_contains( $used, '{{calc:' . $id . '}}' ) ) {
				continue;
			}
			$calc = $s->document->calculation( $id );
			$key  = (string) ( $calc['legacy']['calculationId'] ?? $id );

			$out[ $key ] = array(
				'title' => (string) ( $calc['label'] ?? '' ),
				'value' => $result['ok'] ? $result['value'] : __( 'An error occurred in the calculation!', 'funnelforms-free' ),
			);
		}
		return $out;
	}

	/**
	 * Text of an answer for the flat text fields.
	 *
	 * @param mixed $value Answer.
	 */
	private static function flat( $value ): string {
		return is_array( $value ) ? implode( ', ', array_map( 'strval', $value ) ) : (string) $value;
	}
}
