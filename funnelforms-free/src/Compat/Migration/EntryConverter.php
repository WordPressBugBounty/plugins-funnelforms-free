<?php
/**
 * Converts 3.x leads (af2_request) into ffx_entries rows.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

defined( 'ABSPATH' ) || exit;

/**
 * Pure converter: no WordPress calls, so it is unit-tested against all known lead shapes.
 *
 * Known shapes (see docs/migration/README.md):
 *  A  current: form_id, questions, contact_form, analyticsData, hidden_fields, calculationData
 *  B  2024 variants of A with missing keys (no post_title, no calculationData, question id 0)
 *  C  pre-2.0 JSON leads converted to arrays by the 3.x migration
 *  D  flat list [{id, title, answer}]
 *  E  undecodable content, or only ['dashboard_relevant' => 'not'] left after a statistics reset
 *  F  posts with a foreign status (another post overwritten through the 3.x partial-save bug)
 *
 * Nothing is dropped silently: every converted row keeps the decoded original under meta.legacy.raw,
 * and shapes E and F are returned as failures for the migration report.
 */
final class EntryConverter {

	public const DATA_VERSION = 1;

	/**
	 * Converts one lead.
	 *
	 * @param array<mixed>|null   $content    Decoded post_content, null when undecodable.
	 * @param array<string,mixed> $post     Row with ID, post_status, post_date, post_date_gmt, post_modified_gmt.
	 * @param array<int,int>      $form_map   Legacy form post ID => ffx_forms.id.
	 * @param array<int,string>   $field_map  Legacy question post ID => field id in the migrated form document.
	 * @param string              $site_timezone Site timezone for rows without a GMT date.
	 * @return array<string,mixed> Either ['ok' => true, 'row' => …, 'notes' => …] or ['ok' => false, 'reason' => …].
	 */
	public function convert( ?array $content, array $post, array $form_map, array $field_map, string $site_timezone ): array {
		$status = (string) ( $post['post_status'] ?? '' );
		$notes  = array();

		if ( null === $content ) {
			return array(
				'ok'     => false,
				'reason' => 'undecodable',
			);
		}
		if ( array( 'dashboard_relevant' ) === array_keys( $content ) ) {
			return array(
				'ok'     => false,
				'reason' => 'content_lost_in_3x_statistics_reset',
			);
		}

		$entry_status = self::map_status( $status );
		if ( null === $entry_status ) {
			return array(
				'ok'     => false,
				'reason' => 'unexpected_post_status',
				'detail' => $status,
			);
		}

		$shape = self::detect_shape( $content );
		if ( 'unknown' === $shape ) {
			return array(
				'ok'     => false,
				'reason' => 'unknown_shape',
			);
		}

		$legacy_form_id = isset( $content['form_id'] ) && is_numeric( $content['form_id'] ) ? (int) $content['form_id'] : null;
		$form_id        = null !== $legacy_form_id && isset( $form_map[ $legacy_form_id ] ) ? $form_map[ $legacy_form_id ] : null;
		if ( null !== $legacy_form_id && null === $form_id ) {
			$notes[] = 'form_missing';
		}

		$analytics = self::analytics( $content['analyticsData'] ?? array() );
		$answers   = 'flat' === $shape ? self::flat_answers( $content ) : self::answers( $content['questions'] ?? array(), $field_map );
		$contact   = self::contact( $content['contact_form'] ?? array() );
		$consent   = array();
		foreach ( $contact as $field ) {
			if ( 'checkbox_type' === $field['type'] ) {
				$consent[] = array(
					'fieldId' => $field['fieldId'],
					'checked' => 'true' === $field['value'],
				);
			}
		}

		$dates = self::dates( $post, $entry_status, $site_timezone );
		if ( $dates['approx'] ) {
			$notes[] = 'created_at_approximate';
		}

		$data = array(
			'version'      => self::DATA_VERSION,
			'answers'      => $answers,
			'contact'      => $contact,
			'hiddenFields' => is_array( $content['hidden_fields'] ?? null ) ? $content['hidden_fields'] : array(),
			'calculations' => self::calculations( $content['calculationData'] ?? array() ),
			'page'         => array(
				'title' => $analytics['post_title'] ?? null,
				'url'   => $analytics['url'] ?? null,
				'query' => $analytics['queryString'] ?? null,
			),
		);

		$legacy = array(
			'shape'  => $shape,
			'formId' => $legacy_form_id,
			'status' => $status,
			'raw'    => $content,
		);

		return array(
			'ok'    => true,
			'notes' => $notes,
			'row'   => array(
				'legacy_post_id'      => (int) $post['ID'],
				'legacy_form_post_id' => $legacy_form_id,
				'form_id'             => $form_id,
				'status'              => $entry_status,
				'locale'              => '',
				'created_at'          => $dates['created'],
				'completed_at'        => $dates['completed'],
				'source_url'          => $analytics['url'] ?? null,
				'utm'                 => self::utm( (string) ( $analytics['queryString'] ?? '' ) ),
				'data'                => $data,
				'consent'             => $consent,
				'meta'                => array( 'legacy' => $legacy ),
			),
		);
	}

	/**
	 * Maps a 3.x post status.
	 *
	 * @param string $status post_status.
	 */
	private static function map_status( string $status ): ?string {
		switch ( $status ) {
			case 'privat':
				return 'complete';
			case 'draft':
				return 'partial';
			case 'trash':
				return 'trash';
			default:
				return null;
		}
	}

	/**
	 * Detects which lead shape the content has.
	 *
	 * @param array<mixed> $content Decoded lead.
	 */
	private static function detect_shape( array $content ): string {
		if ( isset( $content['form_id'] ) || isset( $content['questions'] ) || isset( $content['contact_form'] ) ) {
			return isset( $content['analyticsData'] ) ? 'current' : 'partial_or_2024';
		}
		if ( array_is_list( $content ) && array() !== $content && is_array( $content[0] ) && array_key_exists( 'answer', $content[0] ) ) {
			return 'flat';
		}
		return 'unknown';
	}

	/**
	 * Normalizes question answers.
	 *
	 * @param mixed             $questions Legacy questions (sparse array).
	 * @param array<int,string> $field_map Legacy question ID => field id.
	 * @return array<int,array<string,mixed>>
	 */
	private static function answers( $questions, array $field_map ): array {
		if ( ! is_array( $questions ) ) {
			return array();
		}
		$out = array();
		foreach ( $questions as $q ) {
			if ( ! is_array( $q ) ) {
				continue;
			}
			$legacy_id = isset( $q['id'] ) && is_numeric( $q['id'] ) ? (int) $q['id'] : 0;
			$value     = $q['antwort'] ?? null;
			$answer    = array(
				'legacyQuestionId' => $legacy_id > 0 ? $legacy_id : null,
				'fieldId'          => $legacy_id > 0 && isset( $field_map[ $legacy_id ] ) ? $field_map[ $legacy_id ] : null,
				'label'            => is_string( $q['frage'] ?? null ) ? $q['frage'] : '',
				'value'            => $value,
			);
			if ( array_key_exists( 'hidden_field', $q ) ) {
				$answer['hiddenField'] = $q['hidden_field'];
			}
			if ( array_key_exists( 'file_upload_public', $q ) ) {
				$answer['filesPublic'] = 'true' === $q['file_upload_public'] || true === $q['file_upload_public'];
			}
			$out[] = $answer;
		}
		return $out;
	}

	/**
	 * Flat list leads [{id, title, answer}].
	 *
	 * @param array<mixed> $content Decoded lead.
	 * @return array<int,array<string,mixed>>
	 */
	private static function flat_answers( array $content ): array {
		$out = array();
		foreach ( $content as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			$out[] = array(
				'legacyQuestionId' => isset( $item['id'] ) && is_numeric( $item['id'] ) ? (int) $item['id'] : null,
				'fieldId'          => null,
				'label'            => (string) ( $item['title'] ?? '' ),
				'value'            => $item['answer'] ?? null,
			);
		}
		return $out;
	}

	/**
	 * Contact form values.
	 *
	 * @param mixed $contact Legacy contact_form list.
	 * @return array<int,array<string,mixed>>
	 */
	private static function contact( $contact ): array {
		if ( ! is_array( $contact ) ) {
			return array();
		}
		$out = array();
		foreach ( $contact as $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}
			$legacy_id = (string) ( $field['id'] ?? '' );
			$out[]     = array(
				'fieldId'       => FieldIds::contact( $legacy_id ),
				'legacyFieldId' => $legacy_id,
				'label'         => is_string( $field['label'] ?? null ) ? $field['label'] : '',
				'type'          => (string) ( $field['typ'] ?? '' ),
				'value'         => $field['input'] ?? '',
			);
		}
		return $out;
	}

	/**
	 * Analytics list [{id, value}] as a map.
	 *
	 * @param mixed $analytics analyticsData.
	 * @return array<string,string>
	 */
	private static function analytics( $analytics ): array {
		$out = array();
		if ( ! is_array( $analytics ) ) {
			return $out;
		}
		foreach ( $analytics as $item ) {
			if ( is_array( $item ) && isset( $item['id'] ) && is_scalar( $item['value'] ?? null ) ) {
				$out[ (string) $item['id'] ] = (string) $item['value'];
			}
		}
		return $out;
	}

	/**
	 * Calculation results.
	 *
	 * @param mixed $calculations calculationData map.
	 * @return array<int,array<string,mixed>>
	 */
	private static function calculations( $calculations ): array {
		$out = array();
		if ( ! is_array( $calculations ) ) {
			return $out;
		}
		foreach ( $calculations as $id => $calc ) {
			if ( is_array( $calc ) ) {
				$out[] = array(
					'legacyCalculationId' => is_numeric( $id ) ? (int) $id : null,
					'title'               => (string) ( $calc['title'] ?? '' ),
					'value'               => $calc['value'] ?? null,
				);
			}
		}
		return $out;
	}

	/**
	 * Marketing parameters from the page query string. The raw query stays in data.page.query.
	 *
	 * @param string $query Query string without '?'.
	 * @return array<string,string>
	 */
	public static function utm( string $query ): array {
		if ( '' === $query ) {
			return array();
		}
		parse_str( ltrim( $query, '?' ), $params );
		$out = array();
		foreach ( $params as $key => $value ) {
			$key = (string) $key;
			if ( is_string( $value ) && ( str_starts_with( $key, 'utm_' ) || in_array( $key, array( 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid' ), true ) ) ) {
				$out[ $key ] = $value;
			}
		}
		return $out;
	}

	/**
	 * Timestamps in UTC (Y-m-d H:i:s).
	 *
	 * Complete leads: post_date_gmt is the submission time. Partial leads: WordPress keeps
	 * post_date_gmt at zero for drafts and resets post_date on every step, so the last activity
	 * (post_modified_gmt) is the best available value; it is flagged as approximate.
	 *
	 * @param array<string,mixed> $post          Post row.
	 * @param string              $entry_status  Mapped status.
	 * @param string              $site_timezone Timezone string for local dates.
	 * @return array{created:string, completed:?string, approx:bool}
	 */
	private static function dates( array $post, string $entry_status, string $site_timezone ): array {
		$zero  = '0000-00-00 00:00:00';
		$gmt   = (string) ( $post['post_date_gmt'] ?? $zero );
		$local = (string) ( $post['post_date'] ?? $zero );

		if ( 'partial' === $entry_status ) {
			$modified = (string) ( $post['post_modified_gmt'] ?? $zero );
			$created  = $zero !== $modified ? $modified : self::local_to_utc( $local, $site_timezone );
			return array(
				'created'   => $created,
				'completed' => null,
				'approx'    => true,
			);
		}

		$created = $zero !== $gmt ? $gmt : self::local_to_utc( $local, $site_timezone );
		return array(
			'created'   => $created,
			'completed' => 'complete' === $entry_status ? $created : null,
			'approx'    => false,
		);
	}

	/**
	 * Converts a site-local MySQL date to UTC.
	 *
	 * @param string $local    Local date.
	 * @param string $timezone Timezone string or offset like +02:00.
	 */
	private static function local_to_utc( string $local, string $timezone ): string {
		try {
			$tz   = new \DateTimeZone( '' !== $timezone ? $timezone : 'UTC' );
			$date = new \DateTimeImmutable( $local, $tz );
			return $date->setTimezone( new \DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' );
		} catch ( \Exception $e ) {
			return $local;
		}
	}
}
