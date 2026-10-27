<?php
/**
 * Read helpers for a form document of schema v1.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

/**
 * Indexes nodes, fields and calculations of one document. The document itself is a plain array
 * as stored in ffx_form_revisions.
 */
final class Document {

	/**
	 * Kinds of actions that run in the visitor's browser instead of the job queue.
	 */
	public const BROWSER_ACTIONS = array( 'googleAds' );

	/** Field types whose answers are uploaded files (references in the submit, rows in ffx_entry_files). */
	public const FILE_TYPES = array( 'file', 'signature' );

	/**
	 * Whether a field's answer is uploaded files.
	 *
	 * @param array<string,mixed> $field Field.
	 */
	public static function holds_files( array $field ): bool {
		return in_array( $field['type'] ?? '', self::FILE_TYPES, true );
	}

	/**
	 * Nodes by id.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private array $nodes = array();

	/**
	 * Fields of step and contact nodes by id.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private array $fields = array();

	/**
	 * Node id of each field.
	 *
	 * @var array<string,string>
	 */
	private array $field_node = array();

	/**
	 * Calculations by id.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private array $calculations = array();

	/**
	 * Indexes a document.
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public function __construct( private array $document ) {
		foreach ( $document['nodes'] ?? array() as $node ) {
			$this->nodes[ $node['id'] ] = $node;
			foreach ( $node['fields'] ?? array() as $field ) {
				$this->fields[ $field['id'] ]     = $field;
				$this->field_node[ $field['id'] ] = $node['id'];
			}
		}
		foreach ( $document['calculations'] ?? array() as $calc ) {
			$this->calculations[ $calc['id'] ] = $calc;
		}
	}

	/**
	 * The document array.
	 *
	 * @return array<string,mixed>
	 */
	public function raw(): array {
		return $this->document;
	}

	/**
	 * Id of the first node.
	 */
	public function start(): string {
		return (string) ( $this->document['start'] ?? '' );
	}

	/**
	 * Default locale of the texts.
	 */
	public function locale(): string {
		return (string) ( $this->document['locales']['default'] ?? '' );
	}

	/**
	 * A node by id.
	 *
	 * @param string $id Node id.
	 * @return array<string,mixed>|null
	 */
	public function node( string $id ): ?array {
		return $this->nodes[ $id ] ?? null;
	}

	/**
	 * All nodes by id.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public function nodes(): array {
		return $this->nodes;
	}

	/**
	 * A field by id.
	 *
	 * @param string $id Field id.
	 * @return array<string,mixed>|null
	 */
	public function field( string $id ): ?array {
		return $this->fields[ $id ] ?? null;
	}

	/**
	 * All step and contact fields by id.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public function fields(): array {
		return $this->fields;
	}

	/**
	 * A calculation by id.
	 *
	 * @param string $id Calculation id.
	 * @return array<string,mixed>|null
	 */
	public function calculation( string $id ): ?array {
		return $this->calculations[ $id ] ?? null;
	}

	/**
	 * All calculations by id.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public function calculations(): array {
		return $this->calculations;
	}

	/**
	 * Actions that run when an entry is submitted through a contact node.
	 *
	 * @param string $contact_node Contact node id.
	 * @return array<int,array<string,mixed>>
	 */
	public function submit_actions( string $contact_node ): array {
		$out = array();
		foreach ( $this->document['actions'] ?? array() as $action ) {
			if ( 'submit' === ( $action['on'] ?? '' ) && ! in_array( $action['kind'] ?? '', self::BROWSER_ACTIONS, true ) && ( ! isset( $action['node'] ) || $action['node'] === $contact_node ) ) {
				$out[] = $action;
			}
		}
		return $out;
	}

	/**
	 * Actions the browser runs after a submit through a contact node (Google Ads conversions);
	 * they are never queued.
	 *
	 * @param string $contact_node Contact node id.
	 * @return array<int,array<string,mixed>>
	 */
	public function browser_actions( string $contact_node ): array {
		$out = array();
		foreach ( $this->document['actions'] ?? array() as $action ) {
			if ( in_array( $action['kind'] ?? '', self::BROWSER_ACTIONS, true ) && ( ! isset( $action['node'] ) || $action['node'] === $contact_node ) ) {
				$out[] = $action;
			}
		}
		return $out;
	}

	/**
	 * Actions that wait for the payment of an entry sent through a contact node.
	 *
	 * @param string $contact_node Contact node id.
	 * @return array<int,array<string,mixed>>
	 */
	public function paid_actions( string $contact_node ): array {
		$out = array();
		foreach ( $this->document['actions'] ?? array() as $action ) {
			if ( 'paid' === ( $action['on'] ?? '' ) && ( ! isset( $action['node'] ) || $action['node'] === $contact_node ) ) {
				$out[] = $action;
			}
		}
		return $out;
	}

	/**
	 * An action by id.
	 *
	 * @param string $id Action id.
	 * @return array<string,mixed>|null
	 */
	public function action( string $id ): ?array {
		foreach ( $this->document['actions'] ?? array() as $action ) {
			if ( ( $action['id'] ?? '' ) === $id ) {
				return $action;
			}
		}
		return null;
	}

	/**
	 * Picks the text for a locale: the locale itself, then the document default, then the first one.
	 *
	 * @param mixed  $text   Text per locale.
	 * @param string $locale Wanted locale; empty for the document default.
	 */
	public function text( $text, string $locale = '' ): string {
		if ( ! is_array( $text ) || array() === $text ) {
			return '';
		}
		foreach ( array( $locale, $this->locale() ) as $candidate ) {
			if ( '' !== $candidate && isset( $text[ $candidate ] ) && is_string( $text[ $candidate ] ) ) {
				return $text[ $candidate ];
			}
		}
		$first = reset( $text );
		return is_string( $first ) ? $first : '';
	}
}
