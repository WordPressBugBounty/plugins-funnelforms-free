<?php
/**
 * Reads the leads export of Funnelforms 4 and converts each lead into an entry row.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Ff4;

use Funnelforms\Compat\Migration\EntryConverter;

defined( 'ABSPATH' ) || exit;

/**
 * The leads export of Funnelforms 4 (docs/import/funnelforms-4.md): JSON with `format`
 * "funnelforms4-responses", `version` 1, `forms` (id and title of each form) and `responses`, rows
 * of form_responses with `form_id`, `created_at`, `submission_timestamp`, `completed`,
 * `completion_time`, `status`, `device_type`, `entry_url`, `referrer`, `traffic_source`, `utm` and
 * `response_data` (without IP address, user agent and location, which the export leaves out).
 *
 * The column response_data has one entry per answer: key = field id, value {value, question, field_type};
 * a field asked in several steps has one entry per step, keyed by the logic node, with `field_id`
 * and `node_id`; the fields of the contact form are keys "field-…" ({value, question|label}), in
 * older leads one entry "submit" (or the contact field's id) holding them.
 *
 * The converter finds each answer's field in the imported form (Ff4Converter keeps the ids and
 * keys of Funnelforms 4), so the entry knows its fields; answers whose field is gone keep their
 * question as label. Files and signatures are listed for copying; the decoded lead stays under
 * meta.ff4.raw, so nothing is lost.
 *
 * Pure PHP without WordPress.
 */
final class Ff4Responses {

	public const FORMAT = 'funnelforms4-responses';

	public const VERSION = 1;

	/** Most leads one file may hold. */
	public const MAX_RESPONSES = 20000;

	/** Prefix of the uid of an imported lead; the uid makes a second import skip it. */
	public const UID_PREFIX = 'ff4-';

	/** Keys of an answer entry that describe it; the rest of an aggregate are contact fields. */
	private const DESCRIPTION = array( 'value', 'question', 'label', 'field_type', 'required', 'placeholder', 'options', 'timestamp', 'settings', 'field_id', 'node_id' );

	/** Field types without an answer. */
	private const NO_ANSWER = array( 'html', 'media', 'loading' );

	/** Ad click ids kept with the UTM values (as EntryConverter::utm()). */
	private const CLICK_IDS = array( 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid' );

	/** Largest signature taken from a data address, in bytes of the address. */
	private const MAX_DATA_URL = 2 * 1024 * 1024;

	/**
	 * Fields of the form by id, by key and by step, with their position.
	 *
	 * @var array{id:array<string,array<string,mixed>>,key:array<string,array<string,mixed>>,step:array<string,array<string,mixed>>}
	 */
	private array $index = array(
		'id'   => array(),
		'key'  => array(),
		'step' => array(),
	);

	/**
	 * Language of the labels of the form.
	 *
	 * @var string
	 */
	private string $locale = '';

	/**
	 * The imported form the leads belong to (its document as arrays), or null when it is not known.
	 *
	 * @param array<string,mixed>|null $document Document.
	 */
	public function __construct( ?array $document ) {
		if ( null === $document ) {
			return;
		}
		$this->locale = (string) ( $document['settings']['locale'] ?? '' );
		$position     = 0;
		foreach ( is_array( $document['nodes'] ?? null ) ? $document['nodes'] : array() as $node ) {
			if ( ! is_array( $node ) || ! is_array( $node['fields'] ?? null ) ) {
				continue;
			}
			$contact = 'contact' === ( $node['type'] ?? '' );
			foreach ( $node['fields'] as $i => $field ) {
				if ( ! is_array( $field ) || ! is_string( $field['id'] ?? null ) ) {
					continue;
				}
				$field['_position']                  = $position++;
				$field['_contact']                   = $contact;
				$this->index['id'][ $field['id'] ] ??= $field;
				if ( is_string( $field['key'] ?? null ) && '' !== $field['key'] ) {
					$this->index['key'][ $field['key'] ] ??= $field;
				}
				if ( 0 === $i && is_string( $node['id'] ?? null ) ) {
					$this->index['step'][ $node['id'] ] = $field;
				}
			}
		}
	}

	/**
	 * Whether decoded JSON is a leads export of Funnelforms 4.
	 *
	 * @param mixed $data Decoded JSON (objects or arrays).
	 */
	public static function recognizes( $data ): bool {
		$data = self::arrays( $data );
		return is_array( $data ) && self::FORMAT === ( $data['format'] ?? null );
	}

	/**
	 * The leads of an export grouped by form: form id => title and leads. Null when the data is no
	 * export of a version this plugin reads.
	 *
	 * @param mixed $data Decoded JSON (objects or arrays).
	 * @return array<string,array{title:string,responses:array<int,array<string,mixed>>}>|null
	 */
	public static function forms( $data ): ?array {
		$data = self::arrays( $data );
		if ( ! is_array( $data ) || self::FORMAT !== ( $data['format'] ?? null ) || self::VERSION !== (int) ( $data['version'] ?? 0 ) || ! is_array( $data['responses'] ?? null ) ) {
			return null;
		}
		$out = array();
		foreach ( is_array( $data['forms'] ?? null ) ? $data['forms'] : array() as $form ) {
			if ( is_array( $form ) && is_string( $form['id'] ?? null ) && '' !== $form['id'] ) {
				$out[ $form['id'] ] = array(
					'title'     => is_string( $form['title'] ?? null ) ? $form['title'] : '',
					'responses' => array(),
				);
			}
		}
		$count = 0;
		foreach ( $data['responses'] as $response ) {
			if ( ! is_array( $response ) || ! is_string( $response['id'] ?? null ) || ! is_string( $response['form_id'] ?? null ) || '' === $response['form_id'] ) {
				continue;
			}
			$out[ $response['form_id'] ]              ??= array(
				'title'     => '',
				'responses' => array(),
			);
			$out[ $response['form_id'] ]['responses'][] = $response;
			if ( ++$count >= self::MAX_RESPONSES ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * Uid of the entry of a lead: the same for the same lead in every import.
	 *
	 * @param string $response_id Id of the lead in Funnelforms 4.
	 */
	public static function uid( string $response_id ): string {
		return self::UID_PREFIX . substr( (string) preg_replace( '/[^A-Za-z0-9-]+/', '', $response_id ), 0, 36 );
	}

	/**
	 * The entry of a lead.
	 *
	 * The row holds the columns of ffx_entries (without id, uid and form_id); files lists per answer (index in
	 * data.answers), the addresses of its files to copy; an answer keeps the addresses as value
	 * until they are copied.
	 *
	 * @param array<string,mixed> $response Lead (a row of the export).
	 * @return array{row:array<string,mixed>,files:array<int,string[]>}
	 */
	public function convert( array $response ): array {
		$raw     = is_array( $response['response_data'] ?? null ) ? $response['response_data'] : array();
		$answers = array();
		$contact = array();
		$consent = array();
		$files   = array();
		$order   = array();
		$seen    = 0;

		foreach ( $raw as $key => $entry ) {
			$key   = (string) $key;
			$entry = self::entry( $entry );
			$type  = is_string( $entry['field_type'] ?? null ) ? $entry['field_type'] : '';
			if ( in_array( $type, self::NO_ANSWER, true ) ) {
				continue;
			}
			$field = $this->field( $key, $entry );
			if ( 'submit' === $key || 'submit' === $type || null !== $this->aggregate( $entry ) ) {
				foreach ( $this->aggregate( $entry ) ?? array() as $sub_key => $sub ) {
					$item         = $this->contact_item( (string) $sub_key, $sub, $this->field( (string) $sub_key, $sub ) );
					$order['c'][] = array( $item['position'], $seen++ );
					$contact[]    = $item['item'];
					$consent      = array_merge( $consent, $item['consent'] );
				}
				continue;
			}
			if ( str_starts_with( $key, 'field-' ) || 'privacy' === $key || ( null !== $field && $field['_contact'] ) ) {
				$item         = $this->contact_item( $key, $entry, $field );
				$order['c'][] = array( $item['position'], $seen++ );
				$contact[]    = $item['item'];
				$consent      = array_merge( $consent, $item['consent'] );
				continue;
			}
			$value  = self::value( $entry['value'] ?? null, $type );
			$answer = array(
				'fieldId' => null === $field ? null : $field['id'],
				'label'   => $this->label( $entry, $field, $key ),
				'value'   => $value['value'],
			);
			if ( null !== $value['display'] ) {
				$answer['display'] = $value['display'];
			}
			$order['a'][] = array( null === $field ? PHP_INT_MAX : $field['_position'], $seen++ );
			$answers[]    = array(
				'answer' => $answer,
				'files'  => $value['files'],
			);
		}

		// Answers and contact fields in the order of the form; unknown ones after, as they came.
		$answers = self::sorted( $answers, $order['a'] ?? array() );
		$contact = self::sorted( $contact, $order['c'] ?? array() );
		$list    = array();
		foreach ( $answers as $i => $answer ) {
			$list[] = $answer['answer'];
			if ( array() !== $answer['files'] ) {
				$files[ $i ] = $answer['files'];
			}
		}

		$completed = ! empty( $response['completed'] ) || ( ! array_key_exists( 'completed', $response ) && '' !== (string) ( $response['submission_timestamp'] ?? '' ) );
		$created   = self::utc( $response['created_at'] ?? null ) ?? gmdate( 'Y-m-d H:i:s' );
		$submitted = self::utc( $response['submission_timestamp'] ?? null ) ?? $created;
		$url       = self::address( $response['entry_url'] ?? null );
		$query     = self::query( $url );
		$utm       = self::utm( $response['utm'] ?? null ) + EntryConverter::utm( $query );
		$device    = strtolower( (string) ( $response['device_type'] ?? '' ) );
		$device    = in_array( $device, array( 'desktop', 'tablet', 'mobile' ), true ) ? $device : '';
		$seconds   = is_numeric( $response['completion_time'] ?? null ) && $response['completion_time'] > 0 ? (int) round( (float) $response['completion_time'] ) : null;
		$referrer  = self::address( $response['referrer'] ?? null );

		return array(
			'row'   => array(
				'status'       => $completed ? 'complete' : 'partial',
				'is_archived'  => 'archived' === ( $response['status'] ?? '' ) ? 1 : 0,
				'locale'       => $this->locale,
				'created_at'   => $created,
				'completed_at' => $completed ? $submitted : null,
				'source_url'   => '' === $url ? null : $url,
				'utm'          => $utm,
				'device'       => $device,
				'data'         => array(
					'version'      => EntryConverter::DATA_VERSION,
					'answers'      => $list,
					'contact'      => $contact,
					'hiddenFields' => array(),
					'calculations' => array(),
					'page'         => array(
						'title' => null,
						'url'   => '' === $url ? null : $url,
						'query' => '' === $query ? null : $query,
					),
				),
				'consent'      => $consent,
				'meta'         => array(
					'ff4'   => array(
						'responseId'    => (string) ( $response['id'] ?? '' ),
						'formId'        => (string) ( $response['form_id'] ?? '' ),
						'trafficSource' => is_string( $response['traffic_source'] ?? null ) ? $response['traffic_source'] : null,
						'raw'           => $raw,
					),
					'visit' => array(
						'device'   => $device,
						'browser'  => '',
						'os'       => '',
						'referrer' => (string) preg_replace( '/[?#].*$/s', '', $referrer ),
						'seconds'  => $seconds,
						'steps'    => array(),
					),
				),
			),
			'files' => $files,
		);
	}

	/**
	 * The referrer and the page of a lead, for the source of the entry (LeadSources).
	 *
	 * @param array<string,mixed> $response Lead.
	 * @return array{referrer:string,query:string}
	 */
	public static function origin( array $response ): array {
		$url = self::address( $response['entry_url'] ?? null );
		$utm = self::utm( $response['utm'] ?? null ) + EntryConverter::utm( self::query( $url ) );
		return array(
			'referrer' => self::address( $response['referrer'] ?? null ),
			'query'    => '' === $url && array() === $utm ? '' : '?' . http_build_query( $utm ),
		);
	}

	/**
	 * The field of an answer in the imported form.
	 *
	 * @param string              $key   Key in response_data.
	 * @param array<string,mixed> $entry Entry.
	 * @return array<string,mixed>|null
	 */
	private function field( string $key, $entry ): ?array {
		$entry = is_array( $entry ) ? $entry : array();
		if ( is_string( $entry['node_id'] ?? null ) && isset( $this->index['step'][ 's_' . self::id( $entry['node_id'] ) ] ) ) {
			return $this->index['step'][ 's_' . self::id( $entry['node_id'] ) ];
		}
		if ( isset( $this->index['step'][ 's_' . self::id( $key ) ] ) ) {
			return $this->index['step'][ 's_' . self::id( $key ) ];
		}
		if ( is_string( $entry['field_id'] ?? null ) && isset( $this->index['id'][ self::id( $entry['field_id'] ) ] ) ) {
			return $this->index['id'][ self::id( $entry['field_id'] ) ];
		}
		return $this->index['key'][ $key ] ?? $this->index['id'][ self::id( $key ) ] ?? null;
	}

	/**
	 * Fields of a contact form saved as one entry (older leads), or null when the entry is none.
	 *
	 * @param array<string,mixed> $entry Entry.
	 * @return array<string,mixed>|null
	 */
	private function aggregate( array $entry ): ?array {
		$inner = is_array( $entry['value'] ?? null ) && ! array_is_list( $entry['value'] ) ? $entry['value'] : $entry;
		$out   = array();
		foreach ( $inner as $key => $sub ) {
			if ( ! in_array( $key, self::DESCRIPTION, true ) && str_starts_with( (string) $key, 'field-' ) ) {
				$out[ $key ] = is_array( $sub ) && ! array_is_list( $sub ) ? $sub : array( 'value' => $sub );
			}
		}
		return array() === $out ? null : $out;
	}

	/**
	 * A field of the contact form.
	 *
	 * @param string                   $key   Key.
	 * @param array<string,mixed>      $entry Entry.
	 * @param array<string,mixed>|null $field Field of the imported form.
	 * @return array{item:array<string,mixed>,consent:array<int,array<string,mixed>>,position:int}
	 */
	private function contact_item( string $key, array $entry, ?array $field ): array {
		$value   = self::value( $entry['value'] ?? null, (string) ( $entry['field_type'] ?? '' ) );
		$type    = null === $field ? (string) ( $entry['field_type'] ?? '' ) : (string) ( $field['type'] ?? '' );
		$item    = array(
			'fieldId'       => null === $field ? null : $field['id'],
			'legacyFieldId' => $key,
			'label'         => $this->label( $entry, $field, $key ),
			'type'          => $type,
			'value'         => $value['display'] ?? $value['value'],
		);
		$consent = array();
		if ( null !== $field && 'consent' === $type ) {
			$html      = is_array( $field['props']['html'] ?? null ) ? (string) ( $field['props']['html'][ $this->locale ] ?? reset( $field['props']['html'] ) ) : '';
			$consent[] = array(
				'fieldId' => $field['id'],
				'checked' => true === $entry['value'] || in_array( $entry['value'] ?? null, array( 'true', '1', 1, 'on', 'yes' ), true ),
				'text'    => trim( (string) preg_replace( '/\s+/', ' ', strip_tags( $html ) ) ), // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- runs without WordPress in unit tests.
			);
		}
		return array(
			'item'     => $item,
			'consent'  => $consent,
			'position' => null === $field ? PHP_INT_MAX : (int) $field['_position'],
		);
	}

	/**
	 * Label of an answer: the question as the visitor saw it, else the field's.
	 *
	 * @param array<string,mixed>      $entry Entry.
	 * @param array<string,mixed>|null $field Field.
	 * @param string                   $key   Key.
	 */
	private function label( array $entry, ?array $field, string $key ): string {
		foreach ( array( 'question', 'label' ) as $name ) {
			if ( is_string( $entry[ $name ] ?? null ) && '' !== trim( $entry[ $name ] ) && $entry[ $name ] !== $key ) {
				return trim( strip_tags( $entry[ $name ] ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- runs without WordPress in unit tests.
			}
		}
		if ( null !== $field && is_array( $field['label'] ?? null ) ) {
			$label = (string) ( $field['label'][ $this->locale ] ?? reset( $field['label'] ) );
			if ( '' !== $label ) {
				return $label;
			}
		}
		return $key;
	}

	/**
	 * A value as entries store it, a text to show instead (bookings, addresses), and the files in it.
	 *
	 * @param mixed  $value Value.
	 * @param string $type  Field type of Funnelforms 4.
	 * @return array{value:mixed,display:?string,files:string[]}
	 */
	public static function value( $value, string $type ): array {
		$files = self::files( $value );
		if ( array() !== $files ) {
			return array(
				'value'   => $files,
				'display' => null,
				'files'   => $files,
			);
		}
		if ( is_array( $value ) && ! array_is_list( $value ) ) {
			if ( 'booking' === $type || isset( $value['date'], $value['time'] ) ) {
				$text = trim( (string) ( $value['date'] ?? '' ) . ' ' . (string) ( $value['time'] ?? '' ) );
				if ( is_numeric( $value['duration'] ?? null ) ) {
					$text .= ', ' . ( 0 + $value['duration'] ) . ' ' . ( 'hours' === ( $value['durationUnit'] ?? '' ) ? 'h' : 'min' );
				}
				return array(
					'value'   => $text,
					'display' => null,
					'files'   => array(),
				);
			}
			if ( is_string( $value['formatted'] ?? null ) && '' !== trim( $value['formatted'] ) ) {
				$text = trim( $value['formatted'] );
			} else {
				$city = trim( (string) ( $value['postalCode'] ?? '' ) . ' ' . (string) ( $value['city'] ?? '' ) );
				$text = implode( ', ', array_filter( array_map( 'strval', array( $value['street'] ?? '', $city, $value['state'] ?? '', $value['country'] ?? '' ) ), static fn( string $part ): bool => '' !== trim( $part ) ) );
			}
			if ( '' === $text ) {
				$text = (string) json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- runs without WordPress in unit tests.
			}
			return array(
				'value'   => $text,
				'display' => null,
				'files'   => array(),
			);
		}
		if ( is_array( $value ) ) {
			$list = array();
			foreach ( $value as $item ) {
				$list[] = is_scalar( $item ) ? ( is_bool( $item ) ? $item : (string) $item ) : (string) json_encode( $item, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- runs without WordPress in unit tests.
			}
			return array(
				'value'   => $list,
				'display' => null,
				'files'   => array(),
			);
		}
		return array(
			'value'   => is_scalar( $value ) || null === $value ? $value : null,
			'display' => null,
			'files'   => array(),
		);
	}

	/**
	 * Files in a value: addresses in the storage of Funnelforms 4 and signatures as data address.
	 * A value with anything else is no file value.
	 *
	 * @param mixed $value Value.
	 * @return string[]
	 */
	private static function files( $value ): array {
		$found = array();
		$all   = true;
		$walk  = static function ( $item ) use ( &$walk, &$found, &$all ): void {
			if ( is_string( $item ) ) {
				if ( Ff4Media::is_storage_url( $item ) || ( str_starts_with( $item, 'data:image/png;base64,' ) && strlen( $item ) <= self::MAX_DATA_URL ) ) {
					$found[] = $item;
				} else {
					$all = false;
				}
				return;
			}
			if ( is_array( $item ) && ! array_is_list( $item ) && ( isset( $item['url'] ) || isset( $item['files'] ) ) ) {
				$walk( $item['url'] ?? $item['files'] );
				return;
			}
			if ( is_array( $item ) && array_is_list( $item ) && array() !== $item ) {
				foreach ( $item as $one ) {
					$walk( $one );
				}
				return;
			}
			$all = false;
		};
		$walk( $value );
		return $all ? array_values( array_unique( $found ) ) : array();
	}

	/**
	 * Name of a copied file: the name in the address without the id Funnelforms 4 added.
	 *
	 * @param string $source Address or data address.
	 */
	public static function file_name( string $source ): string {
		if ( str_starts_with( $source, 'data:' ) ) {
			return 'signature.png';
		}
		$path = (string) parse_url( $source, PHP_URL_PATH ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- pure class.
		$name = rawurldecode( basename( $path ) );
		// "Angebot-<uuid>.pdf" as the form saved it.
		$name = (string) preg_replace( '/-?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[A-Za-z0-9]+$|$)/i', '', $name );
		return '' === $name || str_starts_with( $name, '.' ) ? 'file' . $name : $name;
	}

	/**
	 * UTM values and ad click ids the export took from the page view.
	 *
	 * @param mixed $utm Map.
	 * @return array<string,string>
	 */
	private static function utm( $utm ): array {
		$out = array();
		foreach ( is_array( $utm ) ? $utm : array() as $key => $value ) {
			$key = (string) $key;
			if ( is_scalar( $value ) && '' !== (string) $value && ( str_starts_with( $key, 'utm_' ) || in_array( $key, self::CLICK_IDS, true ) ) ) {
				$out[ $key ] = mb_substr( (string) $value, 0, 200 );
			}
		}
		return $out;
	}

	/**
	 * An address, or '' for anything else.
	 *
	 * @param mixed $url Address.
	 */
	private static function address( $url ): string {
		$url = is_string( $url ) ? trim( $url ) : '';
		return 1 === preg_match( '#^https?://[^\s<>"]+$#i', $url ) ? mb_substr( $url, 0, 2000 ) : '';
	}

	/**
	 * A time of Funnelforms 4 (ISO 8601) in UTC as MySQL stores it.
	 *
	 * @param mixed $time Time.
	 */
	private static function utc( $time ): ?string {
		if ( ! is_string( $time ) || '' === trim( $time ) ) {
			return null;
		}
		try {
			return ( new \DateTimeImmutable( $time, new \DateTimeZone( 'UTC' ) ) )->setTimezone( new \DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' );
		} catch ( \Exception $e ) {
			return null;
		}
	}

	/**
	 * An entry of response_data with its value under "value" (older leads kept the bare value).
	 *
	 * @param mixed $entry Entry.
	 * @return array<string,mixed>
	 */
	private static function entry( $entry ): array {
		if ( is_array( $entry ) && ! array_is_list( $entry ) && array() !== array_intersect( array_map( 'strval', array_keys( $entry ) ), array( 'value', 'question', 'label', 'field_type' ) ) ) {
			return $entry;
		}
		if ( is_array( $entry ) && ! array_is_list( $entry ) && array() !== preg_grep( '/^field-/', array_map( 'strval', array_keys( $entry ) ) ) ) {
			return $entry;
		}
		return array( 'value' => $entry );
	}

	/**
	 * Query of an address without '?'.
	 *
	 * @param string $url Address.
	 */
	private static function query( string $url ): string {
		return '' === $url ? '' : (string) parse_url( $url, PHP_URL_QUERY ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- pure class.
	}

	/**
	 * Id of a field or node as Ff4Converter makes it.
	 *
	 * @param string $source Id in Funnelforms 4.
	 */
	private static function id( string $source ): string {
		return substr( (string) preg_replace( '/[^A-Za-z0-9_-]+/', '_', $source ), 0, 72 );
	}

	/**
	 * Items sorted by position, then as they came.
	 *
	 * @param array<int,mixed>              $items Items.
	 * @param array<int,array{0:int,1:int}> $order Position and arrival of each item.
	 * @return array<int,mixed>
	 */
	private static function sorted( array $items, array $order ): array {
		$keys = array_keys( $items );
		usort( $keys, static fn( int $a, int $b ): int => $order[ $a ] <=> $order[ $b ] );
		return array_map( static fn( int $i ) => $items[ $i ], $keys );
	}

	/**
	 * Decoded JSON as arrays.
	 *
	 * @param mixed $data Data.
	 * @return mixed
	 */
	private static function arrays( $data ) {
		return is_object( $data ) ? json_decode( (string) json_encode( $data ), true ) : $data; // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- runs without WordPress in unit tests.
	}
}
