<?php
/**
 * Changes of a form that need more than the right to edit forms.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

/**
 * Editing forms must not become a way around the other rights:
 *  - entries: where entries go and how long they stay (actions, entries shown on the website,
 *    payment, retention period, redirects at the end, which can carry the answers, and HTML
 *    whose links or images put answers into an address). Whoever changes these could send
 *    entries to themselves, so they need the right to see entries. Any change counts, removals
 *    included.
 *  - code: tracking code and scripts in content steps or HTML blocks run in visitors' browsers,
 *    and the form's own CSS can read and send what visitors type, so adding or changing them
 *    needs WordPress's unfiltered_html, as in posts. Removing them does not.
 * A form that was never published compares against nothing, so all of its actions and code
 * count as changes.
 */
final class SensitiveChanges {

	public const ENTRIES = 'entries';
	public const CODE    = 'code';

	/** Settings that decide where entries go and how long they stay. */
	private const ENTRY_SETTINGS = array( 'publicEntries', 'payment', 'retentionDays' );

	/**
	 * Kinds of sensitive changes from one document to the next.
	 *
	 * @param array<string,mixed>|null $before Published document, null for none.
	 * @param array<string,mixed>      $after  New document.
	 * @return string[] self::ENTRIES and/or self::CODE.
	 */
	public static function between( ?array $before, array $after ): array {
		$out = array();
		if ( self::canonical( self::entry_parts( $before ) ) !== self::canonical( self::entry_parts( $after ) ) ) {
			$out[] = self::ENTRIES;
		}
		$old = null === $before ? array() : self::code( $before );
		foreach ( self::code( $after ) as $key => $code ) {
			if ( ( $old[ $key ] ?? null ) !== $code ) {
				$out[] = self::CODE;
				break;
			}
		}
		return $out;
	}

	/**
	 * Actions and the entry settings of a document.
	 *
	 * @param array<string,mixed>|null $doc Document.
	 * @return array<string,mixed>
	 */
	private static function entry_parts( ?array $doc ): array {
		$out = array( 'actions' => array_values( (array) ( $doc['actions'] ?? array() ) ) );
		foreach ( self::ENTRY_SETTINGS as $key ) {
			$out[ $key ] = $doc['settings'][ $key ] ?? null;
		}
		$out['redirects'] = array();
		$out['links']     = array();
		foreach ( (array) ( $doc['nodes'] ?? array() ) as $node ) {
			$node_id = (string) ( $node['id'] ?? '' );
			if ( 'end' === ( $node['type'] ?? '' ) ) {
				$out['redirects'][ $node_id ] = $node['redirect'] ?? null;
				self::links( $out['links'], $node_id . '|success', $node['success']['text'] ?? array() );
			}
			foreach ( (array) ( $node['fields'] ?? array() ) as $field ) {
				self::links( $out['links'], $node_id . '|' . (string) ( $field['id'] ?? '' ), $field['props']['html'] ?? array() );
			}
		}
		return $out;
	}

	/**
	 * Collects HTML texts with placeholders inside attributes (href="…{{email}}").
	 *
	 * @param array<string,string> $out   Texts by location.
	 * @param string               $where Location.
	 * @param mixed                $texts Texts per language.
	 */
	private static function links( array &$out, string $where, $texts ): void {
		foreach ( (array) $texts as $locale => $text ) {
			if ( is_string( $text ) && 1 === preg_match( '/=\s*["\']?[^"\'>\s]*\{\{/', $text ) ) {
				$out[ $where . '|' . $locale ] = $text;
			}
		}
	}

	/**
	 * Tracking code, scripted HTML and custom CSS, keyed by where they are.
	 *
	 * @param array<string,mixed> $doc Document.
	 * @return array<string,string>
	 */
	private static function code( array $doc ): array {
		// CSS can show answers to another site (selectors on values, background images).
		$out = array( 'style|css' => (string) ( $doc['style']['css'] ?? '' ) );
		foreach ( (array) ( $doc['nodes'] ?? array() ) as $node ) {
			$node_id = (string) ( $node['id'] ?? '' );
			foreach ( (array) ( $node['tracking'] ?? array() ) as $when => $code ) {
				$out[ $node_id . '|tracking|' . $when ] = (string) $code;
			}
			foreach ( (array) ( $node['fields'] ?? array() ) as $field ) {
				$field_id = $node_id . '|' . (string) ( $field['id'] ?? '' );
				foreach ( (array) ( $field['tracking'] ?? array() ) as $when => $code ) {
					$out[ $field_id . '|tracking|' . $when ] = (string) $code;
				}
				if ( ! in_array( $field['type'] ?? '', array( 'content', 'html' ), true ) ) {
					continue;
				}
				foreach ( (array) ( $field['props']['html'] ?? array() ) as $locale => $text ) {
					if ( is_string( $text ) && RendererSupport::has_scripts( self::single( $text ) ) ) {
						$out[ $field_id . '|html|' . $locale ] = $text;
					}
				}
			}
		}
		return array_filter( $out, static fn( string $code ): bool => '' !== trim( $code ) );
	}

	/**
	 * A document with one content field, to ask RendererSupport about one text.
	 *
	 * @param string $html HTML.
	 * @return array<string,mixed>
	 */
	private static function single( string $html ): array {
		return array(
			'nodes' => array(
				array(
					'fields' => array(
						array(
							'type'  => 'content',
							'props' => array( 'html' => array( $html ) ),
						),
					),
				),
			),
		);
	}

	/**
	 * Comparable JSON.
	 *
	 * @param mixed $value Value.
	 */
	private static function canonical( $value ): string {
		return (string) json_encode( $value ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- also used without WordPress (unit tests).
	}
}
