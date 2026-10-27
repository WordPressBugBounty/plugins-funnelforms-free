<?php
/**
 * Follows the path a visitor takes through a form document.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * The server never trusts the path the browser reports: it walks the document again with the
 * submitted answers, so answers to steps the visitor left by going back are ignored and an entry
 * can only reach a contact node the edges lead to. Calculation conditions use the answers on the
 * path so far, like the results computed for the entry.
 */
final class Walker {

	/**
	 * Walks from the start node until a contact or end node. Fields hidden by their showWhen are
	 * left out of the fields on the path, and their answers count nowhere: not for paths, not for
	 * calculations. Paths use the answers given on the way so far, as in the browser.
	 *
	 * @param Document             $document Document.
	 * @param array<string,mixed>  $answers  Answers by field id.
	 * @param array<string,string> $variants Variants of A/B tests shown (Experiments::resolve()).
	 * @return array{nodes:string[],fields:string[],contact:?string,end:?string,error:?string}
	 */
	public static function walk( Document $document, array $answers, array $variants = array() ): array {
		$out   = array(
			'nodes'   => array(),
			'fields'  => array(),
			'contact' => null,
			'end'     => null,
			'error'   => null,
		);
		$raw   = $document->raw();
		$ab    = Edition::pro( Experiments::class );
		$id    = null === $ab ? (string) ( $raw['start'] ?? '' ) : $ab::start( $raw, $variants );
		$steps = array();
		$given = array();
		while ( true ) {
			$node = $document->node( $id );
			if ( null === $node ) {
				$out['error'] = 'unknown_node';
				return $out;
			}
			if ( in_array( $id, $out['nodes'], true ) ) {
				// Answers do not change while walking, so a node seen twice means an endless loop.
				$out['error'] = 'loop';
				return $out;
			}
			$out['nodes'][] = $id;

			if ( 'end' === $node['type'] ) {
				$out['end'] = $id;
				return $out;
			}
			if ( 'contact' === $node['type'] ) {
				foreach ( $node['fields'] as $field ) {
					$out['fields'][] = $field['id'];
				}
				$out['contact'] = $id;
				$out['end']     = Conditions::next( $raw, $id, $given, self::calculation( $document, $out['fields'], $given ), $variants );
				return $out;
			}
			$steps[]       = $node['fields'] ?? array();
			$shown         = Conditions::shown( $steps, $answers, $variants );
			$out['fields'] = $shown['fields'];
			$given         = $shown['answers'];
			$next          = Conditions::next( $raw, $id, $given, self::calculation( $document, $out['fields'], $given ), $variants );
			if ( null === $next ) {
				$out['error'] = 'dead_end';
				return $out;
			}
			$id = $next;
		}
	}

	/**
	 * Result of a calculation by id over the given fields; null when it fails or does not exist.
	 *
	 * @param Document            $document  Document.
	 * @param string[]            $field_ids Fields on the path so far.
	 * @param array<string,mixed> $answers   Answers by field id.
	 * @return callable(string):?float
	 */
	public static function calculation( Document $document, array $field_ids, array $answers ): callable {
		$values = null;
		return static function ( string $id ) use ( $document, $field_ids, $answers, &$values ): ?float {
			$calc       = $document->calculation( $id );
			$calculator = Edition::pro( Calculator::class );
			if ( null === $calc || null === $calculator ) {
				return null;
			}
			$values = $values ?? $calculator::values( $document, $field_ids, $answers );
			return $calculator::compute( $calc, $values )['value'];
		};
	}
}
