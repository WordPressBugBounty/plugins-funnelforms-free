<?php
/**
 * Checks a converted form against its 3.x source.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Domain\Form\Conditions;
use Funnelforms\Domain\Form\DocumentChecker;
use Funnelforms\Domain\Form\JsNumber;

defined( 'ABSPATH' ) || exit;

/**
 * Independent of FormConverter's logic, it
 *  - checks every reference in the document;
 *  - checks that every question and contact form of the 3.x graph became a node, with all fields;
 *  - replays the 3.x browser path finder (LegacyNavigator) for probe answers on every question and
 *    compares the target with the one the new edges choose;
 *  - computes every calculation with the 3.x evaluator (Matex) and the new expression tree for
 *    sample values and compares the results;
 *  - turns converter notes that mean "the form did not work fully in 3.x either" into review items.
 *
 * Result status: verified (switch to the new renderer automatically), needs_review (an admin should
 * look first; the legacy renderer stays) or failed (the document must not be used).
 */
final class FormVerifier {

	public const VERSION = 1;

	public const VERIFIED     = 'verified';
	public const NEEDS_REVIEW = 'needs_review';
	public const FAILED       = 'failed';

	/**
	 * Note prefixes that need an admin's attention.
	 */
	private const REVIEW_NOTES = array(
		'missing_post',
		'unexpected_post_type',
		'unknown_node',
		'unknown_question_type',
		'unknown_contact_field_type',
		'connection_to_missing_node',
		'dead_end_in_3x',
		'calculation_fails_in_3x',
		'missing_calculation',
		'booking_without_event_type',
		'interface_shifts_nodes_in_3x',
	);

	private const QUESTION_TYPES = array( 'af2_select', 'af2_multiselect', 'af2_dropdown', 'af2_textfeld', 'af2_textbereich', 'af2_datum', 'af2_slider', 'af2_content', 'af2_dateiupload', 'af2_adressfeld', 'af2_terminbuchung' );

	/**
	 * Loads a 3.x post (same callback as FormConverter).
	 *
	 * @var callable
	 */
	private $load;

	/**
	 * Constructor.
	 *
	 * @param callable $load Loads a 3.x post by ID: ['type' => post_type, 'content' => decoded array or null] or null.
	 */
	public function __construct( callable $load ) {
		$this->load = $load;
	}

	/**
	 * Verifies one conversion.
	 *
	 * @param array<mixed>        $form   Decoded 3.x form content.
	 * @param array<string,mixed> $result FormConverter::convert() result.
	 * @return array{status:string, checks:array<string,array{status:string, details:string[]}>}
	 */
	public function verify( array $form, array $result ): array {
		if ( empty( $result['ok'] ) || ! is_array( $result['document'] ?? null ) ) {
			return array(
				'status' => self::FAILED,
				'checks' => array(
					'conversion' => array(
						'status'  => self::FAILED,
						'details' => (array) ( $result['errors'] ?? array() ),
					),
				),
			);
		}
		// Normalise objects (empty props, tokens) to arrays.
		$doc = self::to_array( $result['document'] );

		$sections = is_array( $form['sections'] ?? null ) ? array_values( $form['sections'] ) : array();
		$nodes    = array();
		foreach ( $doc['nodes'] as $node ) {
			$nodes[ $node['id'] ] = $node;
		}

		$checks = array(
			'references'   => $this->check_references( $doc ),
			'nodes'        => $this->check_nodes( $sections, $nodes, $doc ),
			'navigation'   => $this->check_navigation( $sections, $nodes, $doc ),
			'calculations' => $this->check_calculations( $doc ),
			'notes'        => $this->check_notes( (array) ( $result['notes'] ?? array() ) ),
		);

		$status = self::VERIFIED;
		foreach ( $checks as $check ) {
			if ( self::FAILED === $check['status'] ) {
				$status = self::FAILED;
				break;
			}
			if ( self::NEEDS_REVIEW === $check['status'] ) {
				$status = self::NEEDS_REVIEW;
			}
		}

		return array(
			'status' => $status,
			'checks' => $checks,
		);
	}

	/**
	 * Objects (empty props, tokens) as arrays.
	 *
	 * @param mixed $value Value.
	 * @return mixed
	 */
	private static function to_array( $value ) {
		if ( is_object( $value ) ) {
			$value = get_object_vars( $value );
		}
		return is_array( $value ) ? array_map( array( self::class, 'to_array' ), $value ) : $value;
	}

	/**
	 * Builds a check result.
	 *
	 * @param string[] $details  Problems.
	 * @param string   $severity Status when there are problems.
	 * @return array{status:string, details:string[]}
	 */
	private static function check( array $details, string $severity ): array {
		return array(
			'status'  => array() === $details ? self::VERIFIED : $severity,
			'details' => array_values( $details ),
		);
	}

	/**
	 * References.
	 *
	 * @param array<string,mixed> $doc Document.
	 * @return array{status:string, details:string[]}
	 */
	private function check_references( array $doc ): array {
		return self::check( DocumentChecker::check( $doc ), self::FAILED );
	}

	/**
	 * Every question and contact form became a node with its fields; every contact node submits.
	 *
	 * @param array<int,mixed>    $sections 3.x sections.
	 * @param array<string,array> $nodes    Document nodes by id.
	 * @param array<string,mixed> $doc      Document.
	 * @return array{status:string, details:string[]}
	 */
	private function check_nodes( array $sections, array $nodes, array $doc ): array {
		$details = array();
		$fail    = false;
		foreach ( $this->graph( $sections ) as $node_id => $item ) {
			if ( null === $item['post'] ) {
				continue;
			}
			$node = $nodes[ $node_id ] ?? null;
			if ( 'af2_frage' === $item['post']['type'] ) {
				if ( null === $node || 'step' !== $node['type'] || ( $node['fields'][0]['legacy']['questionId'] ?? null ) !== $item['post_id'] ) {
					$details[] = 'question ' . $item['post_id'] . ' at ' . $node_id . ' has no step';
					// Only an unknown question type may be left out (the converter notes it).
					$fail = $fail || in_array( $item['post']['content']['typ'] ?? '', self::QUESTION_TYPES, true );
					continue;
				}
				$required = $this->required_of( $item['post']['content'] );
				if ( null !== $required && $required !== $node['fields'][0]['required'] ) {
					$details[] = 'required flag of question ' . $item['post_id'] . ' differs';
					$fail      = true;
				}
			} elseif ( 'af2_kontaktformular' === $item['post']['type'] ) {
				if ( null === $node || 'contact' !== $node['type'] ) {
					$details[] = 'contact form ' . $item['post_id'] . ' at ' . $node_id . ' has no node';
					$fail      = true;
					continue;
				}
				$count = 0;
				foreach ( is_array( $item['post']['content']['questions'] ?? null ) ? $item['post']['content']['questions'] : array() as $q ) {
					$count += is_array( $q ) ? 1 : 0;
				}
				if ( count( $node['fields'] ) !== $count ) {
					$details[] = 'contact form ' . $item['post_id'] . ' has ' . $count . ' fields, node ' . count( $node['fields'] );
				}
				if ( ! isset( $nodes[ $node_id . '_end' ] ) ) {
					$details[] = 'contact form ' . $item['post_id'] . ' has no end';
					$fail      = true;
				}
				$has_mail = false;
				foreach ( $doc['actions'] as $action ) {
					$has_mail = $has_mail || ( 'email' === $action['kind'] && ( $action['node'] ?? null ) === $node_id );
				}
				if ( ! $has_mail ) {
					$details[] = 'contact form ' . $item['post_id'] . ' sends no mail';
					$fail      = true;
				}
			}
		}
		return self::check( $details, $fail ? self::FAILED : self::NEEDS_REVIEW );
	}

	/**
	 * Required flag as the 3.x browser enforced it, where it is unambiguous.
	 *
	 * @param array<mixed> $q Question content.
	 */
	private function required_of( array $q ): ?bool {
		switch ( $q['typ'] ?? '' ) {
			case 'af2_select':
			case 'af2_dropdown':
			case 'af2_slider':
			case 'af2_terminbuchung':
				return true;
			case 'af2_content':
				return false;
			case 'af2_textfeld':
				return LegacyValue::equals_true( $q['textfield_mandatory'] ?? false );
			case 'af2_textbereich':
				return LegacyValue::equals_true( $q['textarea_mandatory'] ?? false );
			case 'af2_dateiupload':
				return LegacyValue::equals_true( $q['fileupload_mandatory'] ?? false );
		}
		return null;
	}

	/**
	 * Replays the 3.x path finder for probe answers on every question.
	 *
	 * @param array<int,mixed>    $sections 3.x sections.
	 * @param array<string,array> $nodes    Document nodes by id.
	 * @param array<string,mixed> $doc      Document.
	 * @return array{status:string, details:string[]}
	 */
	private function check_navigation( array $sections, array $nodes, array $doc ): array {
		$graph   = $this->graph( $sections );
		$details = array();
		foreach ( $graph as $node_id => $item ) {
			if ( null === $item['post'] || 'af2_frage' !== $item['post']['type'] || ! isset( $nodes[ $node_id ]['fields'][0] ) ) {
				continue;
			}
			$field = $nodes[ $node_id ]['fields'][0];
			foreach ( $this->probes( $item['post']['content'], $field, $item['raw'] ) as $probe ) {
				list( $label, $from, $answer ) = $probe;

				$target = LegacyNavigator::find_new( is_array( $item['raw']['connections'] ?? null ) ? $item['raw']['connections'] : array(), $from );
				$legacy = 'hang';
				if ( null !== $target ) {
					$id = 'n' . $target[0] . '_' . $target[1];
					if ( isset( $graph[ $id ] ) && in_array( $graph[ $id ]['kind'], array( 'element', 'redirect' ), true ) ) {
						$legacy = $id;
					}
				}
				$new = Conditions::next( $doc, $node_id, array( $field['id'] => $answer ) ) ?? 'hang';
				if ( $new !== $legacy ) {
					$details[] = $node_id . ' answer ' . $label . ': 3.x went to ' . $legacy . ', now ' . $new;
				}
			}
		}
		return self::check( $details, self::NEEDS_REVIEW );
	}

	/**
	 * The 3.x graph: node id => raw content, kind and loaded post.
	 *
	 * @param array<int,mixed> $sections 3.x sections.
	 * @return array<string,array{raw:array<mixed>, kind:string, post_id:int, post:?array<string,mixed>}>
	 */
	private function graph( array $sections ): array {
		$graph = array();
		foreach ( $sections as $s => $section ) {
			$contents = is_array( $section['contents'] ?? null ) ? array_values( $section['contents'] ) : array();
			foreach ( $contents as $c => $content ) {
				if ( ! is_array( $content ) ) {
					continue;
				}
				$data = LegacyValue::str( $content['data'] ?? '' );
				$post = null;
				$kind = 'interface';
				if ( '' !== $data && is_numeric( $data ) ) {
					$post = ( $this->load )( (int) $data );
					$kind = null !== $post && null !== $post['content'] && in_array( $post['type'], array( 'af2_frage', 'af2_kontaktformular' ), true ) ? 'element' : 'broken';
					if ( 'element' !== $kind ) {
						$post = null;
					}
				} elseif ( str_contains( $data, 'redirect' ) ) {
					$kind = 'redirect';
				}
				$graph[ 'n' . $s . '_' . $c ] = array(
					'raw'     => $content,
					'kind'    => $kind,
					'post_id' => (int) $data,
					'post'    => $post,
				);
			}
		}
		return $graph;
	}

	/**
	 * Probe answers: [label, value the 3.x browser passed as `from`, answer for the new field].
	 *
	 * @param array<mixed>        $q     Question content.
	 * @param array<string,mixed> $field New field.
	 * @param array<mixed>        $raw   Graph node (connections).
	 * @return array<int,array{0:string,1:mixed,2:mixed}>
	 */
	private function probes( array $q, array $field, array $raw ): array {
		$probes  = array();
		$numbers = array();
		foreach ( is_array( $raw['connections'] ?? null ) ? $raw['connections'] : array() as $conn ) {
			if ( is_array( $conn ) ) {
				foreach ( array( $conn['from'] ?? null, $conn['number'] ?? null ) as $n ) {
					$parsed = JsNumber::parse_int( JsNumber::to_string( $n ) );
					if ( null !== $parsed ) {
						array_push( $numbers, $parsed - 1, $parsed, $parsed + 1 );
					}
				}
			}
		}

		switch ( $q['typ'] ?? '' ) {
			case 'af2_select':
			case 'af2_dropdown':
				$list   = array_values( is_array( $q[ 'af2_select' === $q['typ'] ? 'answers' : 'dropdown_options' ] ?? null ) ? $q[ 'af2_select' === $q['typ'] ? 'answers' : 'dropdown_options' ] : array() );
				$labels = array();
				foreach ( $list as $i => $option ) {
					$labels[ $i ] = is_array( $option ) ? LegacyValue::str( $option['label'] ?? '' ) : null;
				}
				foreach ( $list as $i => $option ) {
					if ( ! is_array( $option ) ) {
						continue;
					}
					$from = $i;
					if ( 'af2_dropdown' === $q['typ'] ) {
						// The browser sent the index of the last option with the same label.
						$from = (int) max( array_keys( $labels, $labels[ $i ], true ) );
					}
					$probes[] = array( 'option ' . $i, $from, array( FieldIds::option( $field['id'], $i ) ) );
				}
				break;

			case 'af2_multiselect':
				$count    = count( is_array( $q['answers'] ?? null ) ? $q['answers'] : array() );
				$probes[] = array( 'none', '', array() );
				for ( $i = 0; $i < $count; $i++ ) {
					$probes[] = array( 'only ' . $i, array( (string) $i ), array( FieldIds::option( $field['id'], $i ) ) );
				}
				if ( $count > 1 ) {
					$probes[] = array( '0 and ' . ( $count - 1 ), array( '0', (string) ( $count - 1 ) ), array( FieldIds::option( $field['id'], 0 ), FieldIds::option( $field['id'], $count - 1 ) ) );
				}
				break;

			case 'af2_slider':
				$props  = $field['props'];
				$values = array_merge( array( $props['min'], $props['max'], $props['start'], ( $props['min'] + $props['max'] ) / 2 ), $numbers );
				foreach ( array_unique( array_map( array( JsNumber::class, 'to_string' ), array_map( 'floatval', $values ) ) ) as $value ) {
					$probes[] = array( '"' . $value . '"', $value, $value );
				}
				break;

			case 'af2_textfeld':
				$values = array_merge( array( '', 'abc', ' 7', '3.9' ), array_map( array( JsNumber::class, 'to_string' ), $numbers ) );
				foreach ( array_unique( $values ) as $value ) {
					$probes[] = array( '"' . $value . '"', $value, $value );
				}
				break;

			case 'af2_dateiupload':
				$probes[] = array( 'no file', 0, '' );
				$probes[] = array( 'one file', array( '12' ), '' );
				break;

			case 'af2_terminbuchung':
				$probes[] = array(
					'appointment',
					array(
						'id'   => 1,
						'date' => '01/02/2030',
					),
					'',
				);
				break;

			default:
				$probes[] = array( 'empty', '', '' );
				$probes[] = array( 'text', 'x', 'x' );
		}
		return $probes;
	}

	/**
	 * Calculations: 3.x evaluator and new expression tree for sample values.
	 *
	 * @param array<string,mixed> $doc Document.
	 * @return array{status:string, details:string[]}
	 */
	private function check_calculations( array $doc ): array {
		$details = array();
		if ( array() === $doc['calculations'] ) {
			return self::check( $details, self::NEEDS_REVIEW );
		}
		if ( ! class_exists( '\Matex\Evaluator' ) ) {
			require_once dirname( __DIR__, 3 ) . '/vendor/matex/Evaluator.php';
		}
		foreach ( $doc['calculations'] as $calc ) {
			$formula = $calc['legacy']['formula'] ?? null;
			if ( null === $formula || isset( $calc['legacy']['error'] ) ) {
				continue;
			}
			preg_match_all( '/\[(\d+)\]/', $formula, $m );
			$ids = array_values( array_unique( array_map( 'intval', $m[1] ) ) );
			foreach ( array( 0.0, 1.0, 1.5, 1000.0 ) as $factor ) {
				$values = array();
				$text   = $formula;
				foreach ( $ids as $i => $id ) {
					$value                               = 0.0 === $factor ? 0.0 : ( $i + 1 ) * $factor + ( 1.5 === $factor ? 0.25 : 0 );
					$values[ FieldIds::question( $id ) ] = $value;

					$text = str_replace( '[' . $id . ']', JsNumber::to_string( $value ), $text );
				}
				$legacy = self::run(
					static function () use ( $text ) {
						return ( new \Matex\Evaluator() )->execute( $text );
					}
				);
				$new    = self::run(
					static function () use ( $calc, $values ) {
						return LegacyFormula::evaluate( $calc['expression'], $values );
					}
				);
				$same   = is_float( $legacy ) && is_float( $new )
					? ( $legacy === $new || abs( $legacy - $new ) <= 1e-9 * max( 1.0, abs( $legacy ) ) || ( is_nan( $legacy ) && is_nan( $new ) ) )
					: $legacy === $new;
				if ( ! $same ) {
					$shown = array();
					foreach ( $values as $key => $value ) {
						$shown[] = $key . '=' . JsNumber::to_string( $value );
					}
					$details[] = $calc['id'] . ' with ' . implode( ', ', $shown ) . ': 3.x ' . self::show( $legacy ) . ', now ' . self::show( $new );
				}
			}
		}
		return self::check( $details, self::NEEDS_REVIEW );
	}

	/**
	 * Runs a computation; returns a float or 'error'.
	 *
	 * @param callable $computation Computation.
	 * @return float|string
	 */
	private static function run( callable $computation ) {
		try {
			$value = $computation();
			return is_numeric( $value ) ? (float) $value : 'error';
		} catch ( \Throwable $e ) {
			return 'error';
		}
	}

	/**
	 * Printable result.
	 *
	 * @param float|string $value Result.
	 */
	private static function show( $value ): string {
		return is_float( $value ) ? JsNumber::to_string( $value ) : $value;
	}

	/**
	 * Converter notes that need review.
	 *
	 * @param string[] $notes Notes.
	 * @return array{status:string, details:string[]}
	 */
	private function check_notes( array $notes ): array {
		$details = array();
		foreach ( $notes as $note ) {
			$prefix = explode( ':', $note, 2 )[0];
			if ( in_array( $prefix, self::REVIEW_NOTES, true ) ) {
				$details[] = $note;
			}
		}
		return self::check( $details, self::NEEDS_REVIEW );
	}
}
