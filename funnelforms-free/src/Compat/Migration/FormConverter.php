<?php
/**
 * Converts a 3.x form (af2_formular with its questions, contact forms and calculations) into a
 * form document of schema v1.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Domain\Form\JsNumber;

defined( 'ABSPATH' ) || exit;

/**
 * Pure converter. It never touches the database: posts are read through the $load callback and
 * credentials are returned as connections for the migrator to store encrypted.
 *
 * The behaviour reproduced here is documented in docs/migration/legacy-3x/. In short:
 *  - sections[0].contents[0] is the start; sections is the executable graph, all_entries only the canvas;
 *  - paths follow the 3.x browser algorithm (an exact answer match beats the default path, slider rules
 *    are checked so that the last matching rule wins, a later default path overrides earlier rules);
 *  - a contact form submits the entry; redirect, webhook and CRM nodes behind it become its end and its
 *    actions (only the last one of each kind ran in 3.x);
 *  - a redirect reached from a question leaves the form immediately without an entry.
 */
final class FormConverter {

	/**
	 * Bumped whenever the conversion changes; stored per migrated item.
	 */
	public const VERSION = 1;

	private const CRM_PROVIDERS = array( 'dealsnprojects', 'activecampaign', 'mailchimp', 'getresponse', 'pipedrive', 'hubspot', 'fincrm', 'hellohq', 'klicktipp' );

	private const OPERATORS = array(
		'<'  => 'lt',
		'<=' => 'lte',
		'>'  => 'gt',
		'>=' => 'gte',
		'='  => 'eq',
		'!=' => 'neq',
	);

	/**
	 * Loads a 3.x post: returns ['type' => post_type, 'content' => decoded array or null] or null.
	 *
	 * @var callable
	 */
	private $load;

	/**
	 * Context: locale (site locale), plugin_url, no_nl2br.
	 *
	 * @var array<string,mixed>
	 */
	private array $ctx;

	/**
	 * Document locale.
	 *
	 * @var string
	 */
	private string $locale = 'en_US';

	/**
	 * Language of buttons and messages; empty for the language of the page.
	 *
	 * @var string
	 */
	private string $ui_locale = '';

	/**
	 * Notes for the migration report.
	 *
	 * @var string[]
	 */
	private array $notes = array();

	/**
	 * Fatal problems.
	 *
	 * @var string[]
	 */
	private array $errors = array();

	/**
	 * Connections (credentials) found in the form, keyed by ref.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private array $connections = array();

	/**
	 * Referenced 3.x posts by type.
	 *
	 * @var array<string,int[]>
	 */
	private array $refs = array();

	/**
	 * Template converter.
	 *
	 * @var TemplateConverter
	 */
	private TemplateConverter $templates;

	/**
	 * Constructor.
	 *
	 * @param callable            $load Loads a 3.x post by ID.
	 * @param array<string,mixed> $ctx  locale: site locale (e.g. de_DE); plugin_url: URL of the plugin folder;
	 *                                  no_nl2br: the 3.x option af2_custom_system_no_nl2br was set.
	 */
	public function __construct( callable $load, array $ctx = array() ) {
		$this->load = $load;
		$this->ctx  = $ctx + array(
			'locale'     => 'en_US',
			'plugin_url' => '',
			'no_nl2br'   => false,
		);
	}

	/**
	 * Converts one form.
	 *
	 * @param int          $form_id Post ID of the af2_formular.
	 * @param array<mixed> $form    Decoded form content.
	 * @return array{ok:bool, document:?array<string,mixed>, notes:string[], errors:string[], connections:array<int,array<string,mixed>>, refs:array<string,int[]>}
	 */
	public function convert( int $form_id, array $form ): array {
		$this->notes       = array();
		$this->errors      = array();
		$this->connections = array();
		$this->refs        = array(
			'questions'     => array(),
			'contact_forms' => array(),
			'calculations'  => array(),
			'booking_types' => array(),
		);
		$this->templates   = new TemplateConverter();

		$fe_locale    = LegacyValue::str( $form['fe_locale'] ?? 'default' );
		$this->locale = ( '' !== $fe_locale && 'default' !== $fe_locale ) ? $fe_locale : $this->ctx['locale'];
		// "default" showed the buttons and messages in the language of the page (WPML, Polylang).
		$this->ui_locale = ( '' !== $fe_locale && 'default' !== $fe_locale ) ? $fe_locale : '';
		$answers_tag     = str_starts_with( $this->locale, 'de' ) ? '[ANTWORTEN]' : '[ANSWERS]';

		$sections = is_array( $form['sections'] ?? null ) ? array_values( $form['sections'] ) : array();
		if ( array() === $sections || ! is_array( $sections[0]['contents'] ?? null ) || array() === $sections[0]['contents'] ) {
			return $this->result( null, 'form_has_no_steps' );
		}

		// 1. Classify every graph node.
		$items = array();
		foreach ( $sections as $s => $section ) {
			$contents  = is_array( $section['contents'] ?? null ) ? array_values( $section['contents'] ) : array();
			$interface = false;
			foreach ( $contents as $c => $content ) {
				if ( is_array( $content ) ) {
					$item = $this->classify( $content );

					$items[ FieldIds::node( (int) $s, (int) $c ) ] = $item;
					if ( in_array( $item['kind'], array( 'webhook', 'crm' ), true ) ) {
						$interface = true;
					} elseif ( $interface && in_array( $item['kind'], array( 'question', 'contact' ), true ) ) {
						// 3.x removed interfaces from the browser's copy without re-pointing paths into
						// the nodes after them, so such paths led elsewhere there.
						$this->notes[] = 'interface_shifts_nodes_in_3x:' . FieldIds::node( (int) $s, (int) $c );
					}
				}
			}
		}
		if ( ! isset( $items['n0_0'] ) || ! in_array( $items['n0_0']['kind'], array( 'question', 'contact' ), true ) ) {
			return $this->result( null, 'start_is_not_a_question' );
		}

		// 2. Field ids: the first use of a question gets q<ID>, further uses q<ID>_<node>.
		$used_field_ids = array();

		$nodes        = array();
		$edges        = array();
		$actions      = array();
		$contact_keys = array();

		foreach ( $items as $node_id => $item ) {
			if ( 'question' === $item['kind'] ) {
				$base     = FieldIds::question( $item['post_id'] );
				$field_id = isset( $used_field_ids[ $base ] ) ? $base . '_' . $node_id : $base;

				$used_field_ids[ $base ] = true;

				$field = $this->field( $field_id, $base, $item['post_id'], $item['content'], $answers_tag );
				if ( null === $field ) {
					continue;
				}
				$node = array(
					'id'     => $node_id,
					'type'   => 'step',
					'fields' => array( $field ),
					'legacy' => array( 'questionId' => $item['post_id'] ),
				);
				$code = LegacyValue::str( $item['content']['tracking_code'] ?? '' );
				if ( '' !== trim( $code ) ) {
					$node['tracking'] = array( 'onShow' => $code );
				}
				$nodes[ $node_id ] = $node;
			} elseif ( 'contact' === $item['kind'] ) {
				$built                    = $this->contact_node( $node_id, $item['post_id'], $item['content'] );
				$nodes[ $node_id ]        = $built['node'];
				$contact_keys[ $node_id ] = $built['keys'];
			}
		}

		// 3. Paths.
		foreach ( $items as $node_id => $item ) {
			if ( ! isset( $nodes[ $node_id ] ) || ! in_array( $item['kind'], array( 'question', 'contact' ), true ) ) {
				continue;
			}
			$connections = $this->connections_of( $item['raw'], $sections );

			if ( 'contact' === $item['kind'] ) {
				$end     = $this->contact_end( $node_id, $item, $connections, $items, $form, $contact_keys[ $node_id ] );
				$nodes  += array( $end['node']['id'] => $end['node'] );
				$edges[] = array(
					'id'      => 'e_' . $node_id . '_end',
					'from'    => $node_id,
					'to'      => $end['node']['id'],
					'default' => true,
				);
				foreach ( $end['actions'] as $action ) {
					$actions[] = $action;
				}
				continue;
			}

			foreach ( $this->question_edges( $node_id, $nodes[ $node_id ]['fields'][0], $item, $connections, $items ) as $edge ) {
				$target = $edge['to'];
				if ( ! isset( $nodes[ $target ] ) && isset( $items[ $target ] ) && 'redirect' === $items[ $target ]['kind'] ) {
					$nodes[ $target ] = $this->question_redirect_end( $target, $items[ $target ], $answers_tag );
				}
				if ( isset( $nodes[ $target ] ) ) {
					$edges[] = $edge;
				}
			}
		}

		// 4. Mail actions per contact node and calculations.
		foreach ( $items as $node_id => $item ) {
			if ( 'contact' === $item['kind'] && isset( $nodes[ $node_id ] ) ) {
				foreach ( $this->mail_actions( $node_id, $item['content'], $contact_keys[ $node_id ] ) as $action ) {
					$actions[] = $action;
				}
			}
		}

		$calculations = $this->calculations();
		$this->notes  = array_values( array_unique( $this->notes ) );

		$document = array(
			'schemaVersion' => 1,
			'id'            => 'frm_' . $form_id,
			'title'         => LegacyValue::str( $form['name'] ?? '' ),
			'locales'       => array(
				'default'   => $this->locale,
				'available' => array( $this->locale ),
			),
			'start'         => 'n0_0',
			'nodes'         => array_values( $nodes ),
			'edges'         => $edges,
			'calculations'  => $calculations,
			'actions'       => $actions,
			'style'         => $this->style( $form ),
			'settings'      => $this->settings( $form ),
			'layout'        => $this->layout( $form ),
			'meta'          => array(
				'legacy' => array(
					'formId'          => $form_id,
					'migratorVersion' => self::VERSION,
					'notes'           => $this->notes,
				),
			),
		);

		return $this->result( $document );
	}

	/**
	 * Builds the result array.
	 *
	 * @param array<string,mixed>|null $document Document.
	 * @param string|null              $error    Fatal error.
	 * @return array{ok:bool, document:?array<string,mixed>, notes:string[], errors:string[], connections:array<int,array<string,mixed>>, refs:array<string,int[]>}
	 */
	private function result( ?array $document, ?string $error = null ): array {
		if ( null !== $error ) {
			$this->errors[] = $error;
		}
		foreach ( $this->refs as $type => $ids ) {
			$this->refs[ $type ] = array_values( array_unique( $ids ) );
		}
		return array(
			'ok'          => null !== $document && array() === $this->errors,
			'document'    => $document,
			'notes'       => array_values( array_unique( $this->notes ) ),
			'errors'      => $this->errors,
			'connections' => array_values( $this->connections ),
			'refs'        => $this->refs,
		);
	}

	/**
	 * Localized text.
	 *
	 * @param mixed $value 3.x text.
	 * @return array<string,string>
	 */
	private function text( $value ): array {
		return array( $this->locale => LegacyValue::str( $value ) );
	}

	/**
	 * Classifies a graph node like af2_check_data_type().
	 *
	 * @param array<mixed> $content sections[s].contents[c].
	 * @return array<string,mixed>
	 */
	private function classify( array $content ): array {
		$data = LegacyValue::str( $content['data'] ?? '' );
		$base = array(
			'raw'  => $content,
			'data' => $data,
		);

		if ( '' !== $data && ctype_digit( $data ) ) {
			$post = ( $this->load )( (int) $data );
			if ( null === $post || null === $post['content'] ) {
				$this->notes[] = 'missing_post:' . $data;
				return $base + array( 'kind' => 'missing' );
			}
			if ( 'af2_frage' === $post['type'] ) {
				$this->refs['questions'][] = (int) $data;
				return $base + array(
					'kind'    => 'question',
					'post_id' => (int) $data,
					'content' => $post['content'],
				);
			}
			if ( 'af2_kontaktformular' === $post['type'] ) {
				$this->refs['contact_forms'][] = (int) $data;
				return $base + array(
					'kind'    => 'contact',
					'post_id' => (int) $data,
					'content' => $post['content'],
				);
			}
			$this->notes[] = 'unexpected_post_type:' . $post['type'];
			return $base + array( 'kind' => 'missing' );
		}

		if ( str_contains( $data, 'redirect' ) ) {
			return $base + array(
				'kind'   => 'redirect',
				'url'    => (string) substr( $data, 9 ),
				'newtab' => LegacyValue::equals_true( $content['newtab'] ?? false ),
			);
		}
		if ( str_starts_with( $data, 'webhook:' ) ) {
			return $base + array(
				'kind' => 'webhook',
				'url'  => (string) substr( $data, 8 ),
			);
		}
		foreach ( self::CRM_PROVIDERS as $provider ) {
			if ( str_starts_with( $data, $provider . ':' ) ) {
				return $base + array(
					'kind'     => 'crm',
					'provider' => $provider,
					'mapping'  => is_array( $content['api_values'] ?? null ) ? $content['api_values'] : array(),
				);
			}
		}

		$this->notes[] = 'unknown_node';
		return $base + array( 'kind' => 'missing' );
	}

	/**
	 * Outgoing connections with resolved target node ids, in stored order.
	 *
	 * @param array<mixed>     $raw      Graph node.
	 * @param array<int,mixed> $sections All sections.
	 * @return array<int,array<string,mixed>>
	 */
	private function connections_of( array $raw, array $sections ): array {
		$out = array();
		foreach ( is_array( $raw['connections'] ?? null ) ? $raw['connections'] : array() as $conn ) {
			if ( ! is_array( $conn ) ) {
				continue;
			}
			$s = LegacyValue::number( $conn['to_section'] ?? null );
			$c = LegacyValue::number( $conn['to_content'] ?? null );
			if ( null === $s || null === $c || ! isset( $sections[ (int) $s ]['contents'][ (int) $c ] ) ) {
				$this->notes[] = 'connection_to_missing_node';
				continue;
			}
			// The browser received from = intval(from) (frontend.php, af2_get_form_data).
			$from = $conn['from'] ?? null;
			$from = is_array( $from ) ? (int) ( array() !== $from ) : ( is_scalar( $from ) ? intval( $from ) : 0 );
			// The browser treated null, false, 0 and "" (loose == '') as "no operator".
			$operator = $conn['operator'] ?? null;
			$operator = ( null === $operator || false === $operator || 0 === $operator || '' === $operator || array() === $operator ) ? '' : LegacyValue::str( $operator );
			$out[]    = array(
				'to'       => FieldIds::node( (int) $s, (int) $c ),
				'from'     => $from,
				'operator' => $operator,
				'number'   => LegacyValue::str( $conn['number'] ?? '' ),
			);
		}
		return $out;
	}

	/**
	 * Paths of a question, following the 3.x browser algorithm (af2FindNew in frontend.js).
	 *
	 * 3.x walks the rows in stored order and the last row that fires decides:
	 *  - an exact row (no operator, from >= 0) fires when the answer equals `from`;
	 *  - an operator row (slider rules) fires when its comparison holds;
	 *  - a default row (from = -1) fires only when no exact row before it has matched.
	 * The edges below list the same decision first-match: rows from last to first, and at the last
	 * default row the combinations in which an earlier exact match makes that default inactive.
	 *
	 * @param string                         $node_id     Node id.
	 * @param array<string,mixed>            $field       Field of the node.
	 * @param array<string,mixed>            $item        Classified node.
	 * @param array<int,array<string,mixed>> $connections Resolved connections.
	 * @param array<string,array>            $items       All classified nodes.
	 * @return array<int,array<string,mixed>>
	 */
	private function question_edges( string $node_id, array $field, array $item, array $connections, array $items ): array {
		$typ = LegacyValue::str( $item['content']['typ'] ?? '' );

		$rows = array();
		foreach ( $connections as $conn ) {
			$target_kind = $items[ $conn['to'] ]['kind'] ?? 'missing';
			if ( in_array( $target_kind, array( 'webhook', 'crm' ), true ) ) {
				$this->notes[] = 'integration_after_question_ignored_as_in_3x';
				continue;
			}
			if ( 'missing' === $target_kind ) {
				continue;
			}
			$rows[] = $conn;
		}

		// Answer index => option ids that send it. A dropdown sends the index of the last option with
		// the chosen label, so an earlier option with a duplicate label sends the later index.
		$option_ids = array();
		$last_index = array();
		foreach ( $field['options'] ?? array() as $i => $option ) {
			$last_index[ 'af2_dropdown' === $typ ? implode( '', $option['label'] ) : (string) $i ] = $i;
		}
		foreach ( $field['options'] ?? array() as $i => $option ) {
			$option_ids[ $last_index[ 'af2_dropdown' === $typ ? implode( '', $option['label'] ) : (string) $i ] ][] = $option['id'];
		}

		// Condition of each row: array = condition, null = always, false = never.
		$kinds = array();
		$conds = array();
		foreach ( $rows as $pos => $conn ) {
			if ( '' !== $conn['operator'] ) {
				$kinds[ $pos ] = 'operator';
				$conds[ $pos ] = $this->operator_condition( $typ, $field, $conn, $option_ids );
				if ( false === $conds[ $pos ] ) {
					$this->notes[] = 'rule_never_matches_in_3x';
				}
			} elseif ( -1 === $conn['from'] ) {
				$kinds[ $pos ] = 'default';
				$conds[ $pos ] = null;
			} else {
				$kinds[ $pos ] = 'exact';
				$conds[ $pos ] = $this->exact_condition( $typ, $field, $conn['from'], $option_ids ) ?? false;
				if ( false === $conds[ $pos ] ) {
					$this->notes[] = 'unreachable_path_dropped';
				}
			}
		}

		$emitted = array();
		$emit    = function ( int $pos, ?array $when, bool $is_default = false ) use ( &$emitted, $rows ): bool {
			$edge = array( 'to' => $rows[ $pos ]['to'] );
			if ( null !== $when ) {
				$edge['when'] = $when;
			}
			if ( $is_default ) {
				$edge['default'] = true;
			}
			$emitted[] = array( $pos, $edge );
			return null === $when;
		};

		for ( $i = count( $rows ) - 1; $i >= 0; $i-- ) {
			if ( false === $conds[ $i ] ) {
				continue;
			}
			if ( 'default' !== $kinds[ $i ] ) {
				if ( $emit( $i, $conds[ $i ] ) ) {
					break;
				}
				continue;
			}
			for ( $q = $i - 1; $q >= 0; $q-- ) {
				if ( 'exact' !== $kinds[ $q ] || false === $conds[ $q ] ) {
					continue;
				}
				for ( $o = $i - 1; $o > $q; $o-- ) {
					if ( 'operator' !== $kinds[ $o ] || false === $conds[ $o ] ) {
						continue;
					}
					$emit( $o, null === $conds[ $o ] ? $conds[ $q ] : array( 'all' => array( $conds[ $q ], $conds[ $o ] ) ) );
					$this->notes[] = 'rule_after_exact_match_in_3x';
				}
				$emit( $q, $conds[ $q ] );
			}
			$emit( $i, null, true );
			break;
		}
		foreach ( $kinds as $pos => $kind ) {
			if ( 'operator' === $kind && false !== $conds[ $pos ] && ! in_array( $pos, array_column( $emitted, 0 ), true ) ) {
				$this->notes[] = 'rule_overridden_by_later_default_in_3x';
			}
		}

		$edges = array();
		foreach ( self::readable_order( $emitted ) as $index => $edge ) {
			$edges[] = array(
				'id'   => 'e_' . $node_id . '_' . $index,
				'from' => $node_id,
			) + $edge;
		}
		if ( array() === $edges ) {
			$this->notes[] = 'dead_end_in_3x:' . $node_id;
		}
		return $edges;
	}

	/**
	 * Puts runs of mutually exclusive edges (one answer each, as drawn per answer in the builder) back
	 * into their stored order. Within such a run at most one edge can hold, so the order is free.
	 *
	 * @param array<int,array{0:int,1:array<string,mixed>}> $emitted Row position and edge, in check order.
	 * @return array<int,array<string,mixed>>
	 */
	private static function readable_order( array $emitted ): array {
		$out = array();
		$run = array();
		$key = null;
		$set = array();

		$flush = static function () use ( &$out, &$run ): void {
			usort(
				$run,
				static function ( array $a, array $b ): int {
					return $a[0] <=> $b[0];
				}
			);
			foreach ( $run as $entry ) {
				$out[] = $entry[1];
			}
			$run = array();
		};

		foreach ( $emitted as $entry ) {
			$values = self::exclusive_values( $entry[1]['when'] ?? null );
			if ( null === $values ) {
				$flush();
				$key   = null;
				$set   = array();
				$out[] = $entry[1];
				continue;
			}
			if ( $values['key'] !== $key || array() !== array_intersect( $values['values'], $set ) ) {
				$flush();
				$key = $values['key'];
				$set = array();
			}
			$set   = array_merge( $set, $values['values'] );
			$run[] = $entry;
		}
		$flush();
		return $out;
	}

	/**
	 * For a condition that holds for one fixed set of answers: a key for its kind and the answers.
	 *
	 * @param array<string,mixed>|null $when Condition.
	 * @return array{key:string, values:string[]}|null
	 */
	private static function exclusive_values( ?array $when ): ?array {
		if ( null === $when ) {
			return null;
		}
		$list = isset( $when['any'] ) ? $when['any'] : array( $when );
		$key  = null;
		$vals = array();
		foreach ( $list as $c ) {
			if ( ! isset( $c['op'] ) || ! in_array( $c['op'], array( 'selected', 'selectedOnly', 'equalsText' ), true ) ) {
				return null;
			}
			$k = $c['field'] . ':' . $c['op'];
			if ( null !== $key && $k !== $key ) {
				return null;
			}
			$key    = $k;
			$vals[] = (string) $c['value'];
		}
		return null === $key ? null : array(
			'key'    => $key,
			'values' => $vals,
		);
	}

	/**
	 * Condition for an exact row.
	 *
	 * @param string              $typ        3.x question type.
	 * @param array<string,mixed> $field     Field.
	 * @param int                 $from       Row id.
	 * @param array<int,string[]> $option_ids Option ids by sent answer index.
	 * @return array<string,mixed>|null Null when the row can never match.
	 */
	private function exact_condition( string $typ, array $field, int $from, array $option_ids ): ?array {
		switch ( $typ ) {
			case 'af2_select':
			case 'af2_dropdown':
				return isset( $option_ids[ $from ] ) ? self::any_selected( $field['id'], $option_ids[ $from ] ) : null;
			case 'af2_multiselect':
				// 3.x compares String(['2']) === "2": only a selection of exactly this one answer matches.
				return isset( $option_ids[ $from ] ) ? array(
					'field' => $field['id'],
					'op'    => 'selectedOnly',
					'value' => $option_ids[ $from ][0],
				) : null;
			case 'af2_slider':
			case 'af2_textfeld':
				return array(
					'field' => $field['id'],
					'op'    => 'equalsText',
					'value' => (string) $from,
				);
			default:
				return null;
		}
	}

	/**
	 * Condition for an operator row (slider rules). 3.x compares parseInt(answer) with parseInt(number).
	 *
	 * @param string              $typ        3.x question type.
	 * @param array<string,mixed> $field      Field.
	 * @param array<string,mixed> $conn       Connection.
	 * @param array<int,string[]> $option_ids Option ids by sent answer index.
	 * @return array<string,mixed>|null|false Null: always matches; false: never matches.
	 */
	private function operator_condition( string $typ, array $field, array $conn, array $option_ids ) {
		$op = self::OPERATORS[ $conn['operator'] ] ?? null;
		if ( null === $op ) {
			return false;
		}
		$parsed = JsNumber::parse_int( $conn['number'] );
		if ( null === $parsed ) {
			// parseInt("") is NaN: every comparison is false except "!=".
			return 'neq' === $op ? null : false;
		}
		$number = abs( $parsed ) < PHP_INT_MAX ? (int) $parsed : $parsed;

		if ( in_array( $typ, array( 'af2_select', 'af2_dropdown' ), true ) ) {
			// The answer is the option index: list the matching options.
			$ids = array();
			foreach ( $option_ids as $i => $ids_of_index ) {
				if ( self::compare( $i, $op, $number ) ) {
					array_push( $ids, ...$ids_of_index );
				}
			}
			return array() === $ids ? false : self::any_selected( $field['id'], $ids );
		}
		if ( in_array( $typ, array( 'af2_slider', 'af2_textfeld' ), true ) ) {
			return array(
				'field'  => $field['id'],
				'op'     => $op,
				'value'  => $number,
				'number' => 'int',
			);
		}
		return false;
	}

	/**
	 * Condition "one of these options is selected".
	 *
	 * @param string   $field_id Field id.
	 * @param string[] $ids      Option ids, at least one.
	 * @return array<string,mixed>
	 */
	private static function any_selected( string $field_id, array $ids ): array {
		$list = array();
		foreach ( $ids as $id ) {
			$list[] = array(
				'field' => $field_id,
				'op'    => 'selected',
				'value' => $id,
			);
		}
		return 1 === count( $list ) ? $list[0] : array( 'any' => $list );
	}

	/**
	 * Integer comparison.
	 *
	 * @param int       $a  Left.
	 * @param string    $op Operator.
	 * @param int|float $b Right.
	 */
	private static function compare( int $a, string $op, $b ): bool {
		switch ( $op ) {
			case 'lt':
				return $a < $b;
			case 'lte':
				return $a <= $b;
			case 'gt':
				return $a > $b;
			case 'gte':
				return $a >= $b;
			case 'eq':
				return (float) $a === (float) $b;
			default:
				return (float) $a !== (float) $b;
		}
	}

	/**
	 * End node for a redirect reached from a question: leaves at once, no entry is created.
	 *
	 * @param string              $node_id     Node id.
	 * @param array<string,mixed> $item        Classified redirect node.
	 * @param string              $answers_tag Answers tag of the form language.
	 * @return array<string,mixed>
	 */
	private function question_redirect_end( string $node_id, array $item, string $answers_tag ): array {
		return array(
			'id'       => $node_id,
			'type'     => 'end',
			'success'  => null,
			'redirect' => array(
				'url'     => $this->text( $this->templates->question_redirect( $item['url'], $answers_tag ) ),
				'newTab'  => $item['newtab'],
				'delayMs' => 0,
				'params'  => array(),
			),
		);
	}

	/**
	 * End node and integration actions behind a contact form.
	 *
	 * @param string                         $node_id      Contact node id.
	 * @param array<string,mixed>            $item         Classified contact node.
	 * @param array<int,array<string,mixed>> $connections  Resolved connections.
	 * @param array<string,array>            $items        All classified nodes.
	 * @param array<mixed>                   $form         Form content.
	 * @param array<string,string>           $field_keys   3.x contact field id => key.
	 * @return array{node:array<string,mixed>, actions:array<int,array<string,mixed>>}
	 */
	private function contact_end( string $node_id, array $item, array $connections, array $items, array $form, array $field_keys ): array {
		$redirect = null;
		$webhook  = null;
		$crm      = array();
		foreach ( $connections as $conn ) {
			$target = $items[ $conn['to'] ] ?? array( 'kind' => 'missing' );
			switch ( $target['kind'] ) {
				case 'redirect':
					if ( str_contains( $target['data'], 'redirect:' ) ) {
						if ( null !== $redirect ) {
							$this->notes[] = 'only_last_redirect_ran_in_3x';
						}
						$redirect = $target;
					}
					break;
				case 'webhook':
					if ( null !== $webhook ) {
						$this->notes[] = 'only_last_webhook_ran_in_3x';
					}
					$webhook = $target;
					break;
				case 'crm':
					$crm[ $target['provider'] ] = $target;
					break;
				default:
					$this->notes[] = 'node_after_contact_form_ignored_as_in_3x';
			}
		}

		$show  = LegacyValue::on_unless_false( $form['showSuccessScreen'] ?? null );
		$image = LegacyValue::str( $form['success_image'] ?? '' );
		if ( str_contains( $image, 'res/images/success_standard' ) && '' !== $this->ctx['plugin_url'] ) {
			$image = rtrim( $this->ctx['plugin_url'], '/' ) . '/res/images/success_standard.png';
		}
		$success = array(
			'show' => $show,
			'text' => $this->text( $form['success_text'] ?? '' ),
		);
		if ( '' !== $image ) {
			$success['image'] = $image;
		}

		$redirect_out = null;
		if ( null !== $redirect ) {
			$params = array();
			foreach ( is_array( $item['content']['redirect_params'] ?? null ) ? $item['content']['redirect_params'] : array() as $param ) {
				if ( is_array( $param ) ) {
					$params[] = array(
						'name'  => LegacyValue::str( $param['text'] ?? '' ),
						'value' => $this->text( $this->templates->redirect_param( LegacyValue::str( $param['field'] ?? '' ), $field_keys ) ),
					);
				}
			}
			$redirect_out = array(
				'url'     => $this->text( $redirect['url'] ),
				'newTab'  => $redirect['newtab'],
				'delayMs' => 2000,
				'params'  => $params,
			);
		}

		$actions = array();
		if ( null !== $webhook ) {
			$actions[] = array(
				'id'     => 'a_' . $node_id . '_webhook',
				'on'     => 'submit',
				'node'   => $node_id,
				'kind'   => 'webhook',
				'config' => array( 'url' => $webhook['url'] ),
			);
		}
		foreach ( $crm as $provider => $target ) {
			$actions[] = array(
				'id'     => 'a_' . $node_id . '_' . $provider,
				'on'     => 'submit',
				'node'   => $node_id,
				'kind'   => 'crm',
				'config' => array(
					'provider'      => $provider,
					'connectionRef' => 'legacy:' . $provider,
					'mapping'       => $target['mapping'],
				),
			);
		}

		return array(
			'node'    => array(
				'id'       => $node_id . '_end',
				'type'     => 'end',
				'success'  => $success,
				'redirect' => $redirect_out,
			),
			'actions' => $actions,
		);
	}

	/**
	 * Field of a question.
	 *
	 * @param string       $id      Field id.
	 * @param string       $key     Variable key (shared by all uses of the question).
	 * @param int          $post_id Question post ID.
	 * @param array<mixed> $q       Question content.
	 * @param string       $answers_tag Answers tag of the form language.
	 * @return array<string,mixed>|null
	 */
	private function field( string $id, string $key, int $post_id, array $q, string $answers_tag ): ?array {
		$typ  = LegacyValue::str( $q['typ'] ?? '' );
		$base = array(
			'id'          => $id,
			'key'         => $key,
			'label'       => $this->text( $q['name'] ?? '' ),
			'description' => $this->text( $q['description'] ?? '' ),
			'legacy'      => array( 'questionId' => $post_id ),
		);
		if ( LegacyValue::equals_true( $q['error'] ?? false ) ) {
			$this->notes[] = 'question_saved_with_errors_in_3x:' . $post_id;
		}

		switch ( $typ ) {
			case 'af2_select':
			case 'af2_multiselect':
				$multiple = 'af2_multiselect' === $typ;
				$props    = array(
					'multiple'  => $multiple,
					'layout'    => array(
						'desktop' => in_array( $q['desktop_layout'] ?? '', array( 'grid', 'list', 'list2' ), true ) ? $q['desktop_layout'] : 'grid',
						'mobile'  => in_array( $q['mobile_layout'] ?? '', array( 'grid', 'list' ), true ) ? $q['mobile_layout'] : 'list',
					),
					'hideIcons' => LegacyValue::equals_true( $q['hide_icons'] ?? false ),
				);
				if ( $multiple ) {
					$auto = LegacyValue::int( $q['condition'] ?? null );
					if ( null !== $auto && $auto > 1 ) {
						$props['autoAdvanceAt'] = $auto;
					}
					if ( array_key_exists( 'multiselect_mandatory', $q ) ) {
						$required = LegacyValue::equals_true( $q['multiselect_mandatory'] );
					} elseif ( array_key_exists( 'multiselect_optional', $q ) ) {
						$required = ! LegacyValue::equals_true( $q['multiselect_optional'] );
					} else {
						$required = true;
					}
				} else {
					$required = true;
				}
				return $base + array(
					'type'     => 'choice',
					'required' => $required,
					'options'  => $this->choice_options( $id, $q['answers'] ?? array() ),
					'props'    => $props,
				);

			case 'af2_dropdown':
				$options = array();
				foreach ( array_values( is_array( $q['dropdown_options'] ?? null ) ? $q['dropdown_options'] : array() ) as $i => $opt ) {
					if ( ! is_array( $opt ) ) {
						continue;
					}
					$label  = LegacyValue::str( $opt['label'] ?? '' );
					$value  = LegacyValue::str( $opt['value'] ?? '' );
					$option = array(
						'id'    => FieldIds::option( $id, $i ),
						'label' => $this->text( $label ),
						'value' => '' !== $value ? $value : $label,
					);
					$calc   = LegacyValue::number( $opt['calculation_value'] ?? null );
					if ( null !== $calc ) {
						$option['calcValue'] = $calc;
					}
					$options[] = $option;
				}
				return $base + array(
					'type'     => 'dropdown',
					'required' => true,
					'options'  => $options,
					'props'    => new \stdClass(),
				);

			case 'af2_textfeld':
			case 'af2_textbereich':
				$is_text = 'af2_textfeld' === $typ;
				$props   = array( 'placeholder' => $this->text( $q[ $is_text ? 'textfeld' : 'textarea' ] ?? '' ) );
				$min     = LegacyValue::int( $q['min_length'] ?? null );
				$max     = LegacyValue::int( $q['max_length'] ?? null );
				if ( null !== $min ) {
					$props['minLength'] = $min;
				}
				if ( null !== $max ) {
					$props['maxLength'] = $max;
				}
				if ( $is_text ) {
					if ( LegacyValue::equals_true( $q['text_only_text'] ?? false ) ) {
						$props['restrict'] = 'letters';
					} elseif ( LegacyValue::equals_true( $q['text_only_numbers'] ?? false ) ) {
						$props['restrict'] = 'digits';
					} elseif ( LegacyValue::equals_true( $q['text_birthday'] ?? false ) ) {
						$props['restrict'] = 'birthday';
					}
				}
				return $base + array(
					'type'     => $is_text ? 'text' : 'textarea',
					'required' => LegacyValue::equals_true( $q[ $is_text ? 'textfield_mandatory' : 'textarea_mandatory' ] ?? false ),
					'props'    => $props,
				);

			case 'af2_datum':
				$format = LegacyValue::str( $q['datum_format'] ?? '' );
				return $base + array(
					'type'     => 'date',
					'required' => LegacyValue::on_unless_false( $q['datemandatory'] ?? null ),
					'props'    => array(
						'placeholder' => $this->text( $q['datum'] ?? '' ),
						'format'      => '' !== $format ? $format : 'dd.mm.yy',
					),
				);

			case 'af2_slider':
				$min   = LegacyValue::number( $q['min'] ?? null ) ?? 0.0;
				$max   = LegacyValue::number( $q['max'] ?? null ) ?? 100.0;
				$props = array(
					'min'                => $min,
					'max'                => $max,
					'step'               => LegacyValue::number( $q['step'] ?? null ) ?? 1.0,
					'start'              => LegacyValue::number( $q['start'] ?? null ) ?? $min,
					'unit'               => array(
						'text'     => $this->text( $q['label'] ?? '' ),
						'position' => LegacyValue::equals_true( $q['lab'] ?? false ) ? 'before' : 'after',
					),
					'thousandsSeparator' => LegacyValue::equals_true( $q['thousand'] ?? true ),
					'manualInput'        => array(
						'enabled' => LegacyValue::equals_true( $q['manual'] ?? false ),
						'label'   => $this->text( $q['text_manual'] ?? '' ),
					),
				);
				$image = LegacyValue::str( $q['slider_image'] ?? '' );
				if ( '' !== $image ) {
					$props['media'] = array(
						'kind'  => str_contains( $image, 'https:' ) ? 'image' : 'icon',
						'value' => $image,
					);
				}
				return $base + array(
					'type'     => 'slider',
					'required' => true,
					'props'    => $props,
				);

			case 'af2_content':
				$props = array(
					'html'   => $this->text( $this->templates->content( LegacyValue::str( $q['content_area'] ?? '' ), $answers_tag ) ),
					'button' => array(
						'show'  => LegacyValue::equals_true( $q['content_button'] ?? false ),
						'label' => $this->text( $q['content_button_text'] ?? '' ),
					),
				);
				$wait  = LegacyValue::int( $q['content_wait'] ?? null );
				if ( null !== $wait && $wait > 0 ) {
					$props['autoAdvanceMs'] = $wait;
				}
				return $base + array(
					'type'     => 'content',
					'required' => false,
					'props'    => $props,
				);

			case 'af2_dateiupload':
				$denied = array();
				foreach ( is_array( $q['restrictedFiles'] ?? null ) ? $q['restrictedFiles'] : array() as $mime ) {
					if ( is_string( $mime ) && '' !== $mime ) {
						$denied[] = $mime;
					}
				}
				return $base + array(
					'type'     => 'file',
					'required' => LegacyValue::equals_true( $q['fileupload_mandatory'] ?? false ),
					'props'    => array(
						'dropzoneText'    => $this->text( $q['fileupload_desc'] ?? '' ),
						'maxSizeMb'       => LegacyValue::number( $q['fileupload_max_size'] ?? null ) ?? 10.0,
						'maxFiles'        => LegacyValue::int( $q['fileupload_max_count'] ?? null ) ?? 1,
						'deniedMimeTypes' => $denied,
						'visibility'      => LegacyValue::equals_true( $q['fileupload_public'] ?? false ) ? 'public' : 'private',
					),
				);

			case 'af2_adressfeld':
				$start = is_array( $q['startposition'] ?? null ) ? $q['startposition'] : array();
				$loc   = is_array( $start['loc'] ?? null ) ? $start['loc'] : array();
				$zoom  = LegacyValue::int( $q['zoomlevel'] ?? null ) ?? 8;
				return $base + array(
					'type'     => 'address',
					'required' => LegacyValue::on_unless_false( $q['mapmandatory'] ?? null ),
					'props'    => array(
						'zoom'               => max( 1, min( 22, $zoom ) ),
						'start'              => array(
							'name' => LegacyValue::str( $start['name'] ?? '' ),
							'lat'  => LegacyValue::number( $loc['lat'] ?? null ) ?? 51.165691,
							'lng'  => LegacyValue::number( $loc['lng'] ?? null ) ?? 10.451526,
						),
						'combined'           => LegacyValue::truthy( $q['combined_adress'] ?? false ),
						'showCountry'        => LegacyValue::truthy( $q['show_country_field'] ?? true ),
						'placesAutocomplete' => LegacyValue::truthy( $q['enable_google'] ?? true ),
					),
				);

			case 'af2_terminbuchung':
				$event = LegacyValue::int( $q['terminbuchungsid'] ?? null );
				if ( null === $event || 0 === $event ) {
					$this->notes[] = 'booking_without_event_type:' . $post_id;
				} else {
					$this->refs['booking_types'][] = $event;
				}
				return $base + array(
					'type'     => 'booking',
					'required' => true,
					'props'    => array( 'bookingTypeRef' => 'legacy:' . (int) $event ),
				);
		}

		$this->notes[] = 'unknown_question_type:' . $typ;
		return null;
	}

	/**
	 * Options of a choice question.
	 *
	 * @param string $field_id Field id.
	 * @param mixed  $answers  3.x answers.
	 * @return array<int,array<string,mixed>>
	 */
	private function choice_options( string $field_id, $answers ): array {
		$options = array();
		foreach ( array_values( is_array( $answers ) ? $answers : array() ) as $i => $answer ) {
			if ( ! is_array( $answer ) ) {
				continue;
			}
			$label  = LegacyValue::str( $answer['text'] ?? '' );
			$option = array(
				'id'    => FieldIds::option( $field_id, $i ),
				'label' => $this->text( $label ),
				'value' => $label,
			);
			$img    = LegacyValue::str( $answer['img'] ?? '' );
			if ( '' !== $img ) {
				$option['media'] = array(
					'kind'  => str_starts_with( $img, 'http' ) ? 'image' : 'icon',
					'value' => $img,
				);
			}
			$calc = LegacyValue::number( $answer['calculation_value'] ?? null );
			if ( null !== $calc ) {
				$option['calcValue'] = $calc;
			}
			$hidden = LegacyValue::str( $answer['hidden_field'] ?? '' );
			if ( '' !== $hidden ) {
				$option['hiddenValue'] = $hidden;
			}
			$options[] = $option;
		}
		return $options;
	}

	/**
	 * Contact node.
	 *
	 * @param string       $node_id Node id.
	 * @param int          $post_id Contact form post ID.
	 * @param array<mixed> $cf      Contact form content.
	 * @return array{node:array<string,mixed>, keys:array<string,string>}
	 */
	private function contact_node( string $node_id, int $post_id, array $cf ): array {
		$types  = array(
			'salutation_type'              => 'salutation',
			'text_type_name'               => 'name',
			'text_type_mail'               => 'email',
			'text_type_phone'              => 'phone',
			'text_type_phone_verification' => 'phone_verification',
			'text_type_plain'              => 'text',
			'checkbox_type'                => 'consent',
			'google_recaptcha'             => 'captcha',
			'html_content'                 => 'html',
		);
		$fields = array();
		$keys   = array();
		$seen   = array();

		foreach ( is_array( $cf['questions'] ?? null ) ? $cf['questions'] : array() as $q ) {
			if ( ! is_array( $q ) ) {
				continue;
			}
			$typ = LegacyValue::str( $q['typ'] ?? '' );
			if ( ! isset( $types[ $typ ] ) ) {
				$this->notes[] = 'unknown_contact_field_type:' . $typ;
				continue;
			}
			$legacy_id = LegacyValue::str( $q['id'] ?? '' );
			$id        = FieldIds::contact( $legacy_id );
			if ( isset( $seen[ $id ] ) ) {
				$id .= '_' . count( $fields );
			}
			$seen[ $id ] = true;
			if ( 'html' !== $types[ $typ ] && '' !== $legacy_id ) {
				$keys[ $legacy_id ] = '' !== $legacy_id ? $legacy_id : $id;
			}

			$props = array();
			switch ( $typ ) {
				case 'salutation_type':
					$props['allow'] = array(
						'male'    => LegacyValue::on_unless_false( $q['allowSalutationMale'] ?? null ),
						'female'  => LegacyValue::on_unless_false( $q['allowSalutationFemale'] ?? null ),
						'diverse' => LegacyValue::on_unless_false( $q['allowSalutationDivers'] ?? null ),
						'company' => LegacyValue::on_unless_false( $q['allowSalutationCompany'] ?? null ),
					);
					break;
				case 'text_type_mail':
					$props['b2bOnly'] = LegacyValue::equals_true( $q['b2bMailValidation'] ?? false );
					break;
				case 'text_type_plain':
					foreach ( array( 'minLength', 'maxLength' ) as $k ) {
						$v = LegacyValue::int( $q[ $k ] ?? null );
						if ( null !== $v ) {
							$props[ $k ] = $v;
						}
					}
					$props['inputType'] = 'number' === ( $q['inputType'] ?? '' ) ? 'number' : 'text';
					foreach ( array( 'pattern', 'mask' ) as $k ) {
						$v = LegacyValue::str( $q[ $k ] ?? '' );
						if ( '' !== $v ) {
							$props[ $k ] = $v;
						}
					}
					break;
				case 'checkbox_type':
					$props['html'] = $this->text( $q['text'] ?? '' );
					break;
				case 'google_recaptcha':
					$secret = LegacyValue::str( $q['site_secret'] ?? '' );
					$ref    = 'legacy:recaptcha:' . substr( hash( 'sha256', LegacyValue::str( $q['site_key'] ?? '' ) ), 0, 16 );

					$this->connections[ $ref ] = array(
						'ref'    => $ref,
						'type'   => 'recaptcha',
						'label'  => 'Google reCAPTCHA',
						'config' => array( 'siteKey' => LegacyValue::str( $q['site_key'] ?? '' ) ),
						'secret' => array( 'secret' => $secret ),
					);
					$props['connectionRef']    = $ref;
					break;
				case 'html_content':
					$props['html'] = $this->text( $q['html_content'] ?? '' );
					break;
				case 'text_type_phone_verification':
					$props['sms'] = array(
						'sender'        => LegacyValue::str( $cf['smsSender'] ?? '' ),
						'text'          => $this->text( str_ireplace( '[CODE]', '{{code}}', LegacyValue::str( $cf['smsText'] ?? '' ) ) ),
						'connectionRef' => 'legacy:messagebird',
					);
					break;
			}
			if ( in_array( $typ, array( 'text_type_name', 'text_type_mail', 'text_type_phone', 'text_type_plain' ), true ) ) {
				$props['placeholder'] = $this->text( $q['placeholder'] ?? '' );
			}
			$icon = LegacyValue::str( $q['icon'] ?? '' );
			if ( '' !== $icon ) {
				$props['icon'] = $icon;
			}
			$props['prefillFromQuery'] = $legacy_id;

			$fields[] = array(
				'id'       => $id,
				'type'     => $types[ $typ ],
				'key'      => '' !== $legacy_id ? $legacy_id : $id,
				'label'    => $this->text( $q['label'] ?? '' ),
				'required' => 'text_type_phone_verification' === $typ || LegacyValue::equals_true( $q['required'] ?? false ),
				'props'    => $props,
			);
		}

		$node     = array(
			'id'            => $node_id,
			'type'          => 'contact',
			'title'         => $this->text( $cf['cftitle'] ?? ( $cf['title'] ?? '' ) ),
			'description'   => $this->text( $cf['description'] ?? '' ),
			'submitLabel'   => $this->text( $cf['send_button'] ?? '' ),
			'fields'        => $fields,
			'showBottomBar' => LegacyValue::on_unless_false( $cf['show_bottombar'] ?? null ),
			'legacy'        => array( 'contactFormId' => $post_id ),
		);
		$tracking = array();
		if ( '' !== trim( LegacyValue::str( $cf['tracking_code'] ?? '' ) ) ) {
			$tracking['onShow'] = LegacyValue::str( $cf['tracking_code'] );
		}
		if ( '' !== trim( LegacyValue::str( $cf['tracking_code_after'] ?? '' ) ) ) {
			$tracking['afterSubmit'] = LegacyValue::str( $cf['tracking_code_after'] );
		}
		if ( array() !== $tracking ) {
			$node['tracking'] = $tracking;
		}

		return array(
			'node' => $node,
			'keys' => $keys,
		);
	}

	/**
	 * Admin mail and autoresponder of a contact form.
	 *
	 * @param string               $node_id    Contact node id.
	 * @param array<mixed>         $cf         Contact form content.
	 * @param array<string,string> $field_keys 3.x contact field id => key.
	 * @return array<int,array<string,mixed>>
	 */
	private function mail_actions( string $node_id, array $cf, array $field_keys ): array {
		$transport = array( 'type' => 'wp_mail' );
		$smtp      = array(
			'host'     => LegacyValue::str( $cf['smtp_host'] ?? '' ),
			'username' => LegacyValue::str( $cf['smtp_username'] ?? '' ),
			'password' => LegacyValue::str( $cf['smtp_password'] ?? '' ),
			'port'     => LegacyValue::str( $cf['smtp_port'] ?? '' ),
			'type'     => LegacyValue::str( $cf['smtp_type'] ?? '' ),
		);
		$use_smtp  = LegacyValue::equals_true( $cf['use_smtp'] ?? false );
		// 3.x used SMTP only when all five values were set.
		if ( $use_smtp && '' !== $smtp['host'] && '' !== $smtp['username'] && '' !== $smtp['password'] && '' !== $smtp['port'] && '' !== $smtp['type'] ) {
			$ref = 'legacy:smtp:' . substr( hash( 'sha256', strtolower( $smtp['host'] . '|' . $smtp['username'] . '|' . $smtp['port'] ) ), 0, 16 );

			$this->connections[ $ref ] = array(
				'ref'    => $ref,
				'type'   => 'smtp',
				'label'  => $smtp['username'] . ' @ ' . $smtp['host'],
				'config' => array(
					'host'       => $smtp['host'],
					'port'       => (int) $smtp['port'],
					'username'   => $smtp['username'],
					'encryption' => 'tls' === strtolower( $smtp['type'] ) ? 'tls' : 'ssl',
				),
				'secret' => array( 'password' => $smtp['password'] ),
			);
			$transport                 = array(
				'type'          => 'smtp',
				'connectionRef' => $ref,
			);
		} elseif ( $use_smtp ) {
			$this->notes[] = 'smtp_enabled_but_incomplete_used_wp_mail_in_3x';
		}

		$nl2br   = ! $this->ctx['no_nl2br'];
		$headers = array(
			'from'     => $this->text( $this->templates->header( LegacyValue::str( $cf['mailfrom'] ?? '' ), $field_keys ) ),
			'fromName' => $this->text( $this->templates->header( LegacyValue::str( $cf['mailfrom_name'] ?? '' ), $field_keys ) ),
		);

		$actions   = array();
		$actions[] = array(
			'id'     => 'a_' . $node_id . '_mail',
			'on'     => 'submit',
			'node'   => $node_id,
			'kind'   => 'email',
			'config' => $headers + array(
				'to'        => $this->text( $cf['mailto'] ?? '' ),
				'cc'        => $this->text( $cf['mailcc'] ?? '' ),
				'bcc'       => $this->text( $cf['mailbcc'] ?? '' ),
				'replyTo'   => $this->text( $this->templates->header( LegacyValue::str( $cf['mail_replyto'] ?? '' ), $field_keys ) ),
				'subject'   => $this->text( $this->templates->header( LegacyValue::str( $cf['mailsubject'] ?? '' ), $field_keys ) ),
				'body'      => $this->text( $this->templates->mail( LegacyValue::str( $cf['mailtext'] ?? '' ), $field_keys, true ) ),
				'nl2br'     => $nl2br,
				'transport' => $transport,
			),
		);

		$autoresponder = LegacyValue::equals_true( $cf['use_autorespond'] ?? false );
		$recipient     = trim( LegacyValue::str( $cf['autoresponder_field'] ?? '' ), '[] ' );
		if ( $autoresponder && '' !== $recipient ) {
			$config = $headers + array(
				'to'             => $this->text( '{{field:' . $recipient . '}}' ),
				'cc'             => $this->text( '' ),
				'bcc'            => $this->text( '' ),
				'replyTo'        => $this->text( '' ),
				'subject'        => $this->text( $this->templates->header( LegacyValue::str( $cf['autoresponder_subject'] ?? '' ), $field_keys ) ),
				'body'           => $this->text( $this->templates->mail( LegacyValue::str( $cf['autoresponder_nachricht'] ?? '' ), $field_keys, false ) ),
				'nl2br'          => $nl2br,
				'transport'      => $transport,
				'recipientField' => FieldIds::contact( $recipient ),
			);
			$attach = LegacyValue::str( $cf['attachment_url'] ?? '' );
			if ( '' !== $attach ) {
				$config['attachmentUrl'] = $attach;
			}
			$actions[] = array(
				'id'     => 'a_' . $node_id . '_autoresponder',
				'on'     => 'submit',
				'node'   => $node_id,
				'kind'   => 'autoresponder',
				'config' => $config,
			);
		} elseif ( $autoresponder ) {
			$this->notes[] = 'autoresponder_enabled_without_recipient';
		}

		return $actions;
	}

	/**
	 * Calculations referenced by content steps and mails.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	private function calculations(): array {
		$out        = array();
		$translator = new LegacyFormula();
		foreach ( $this->templates->calculations() as $calc_id ) {
			$this->refs['calculations'][] = $calc_id;

			$post = ( $this->load )( $calc_id );
			if ( null === $post || null === $post['content'] || 'af2_calculations' !== $post['type'] ) {
				$this->notes[] = 'missing_calculation:' . $calc_id;
				continue;
			}
			$c       = $post['content'];
			$formula = LegacyValue::str( $c['calculate_formula'] ?? '' );
			$result  = $translator->translate(
				$formula,
				static function ( int $question_id ): string {
					return FieldIds::question( $question_id );
				}
			);
			$legacy  = array(
				'calculationId' => $calc_id,
				'formula'       => $formula,
			);
			if ( ! $result['ok'] ) {
				// 3.x showed its calculation error text; the runtime does the same for legacy.error.
				$this->notes[]   = 'calculation_fails_in_3x:' . $calc_id . ':' . $result['error'];
				$legacy['error'] = $result['error'];
				$result          = array(
					'expression' => array( 'num' => 0 ),
					'ignored'    => '',
				);
			}
			if ( '' !== $result['ignored'] ) {
				$legacy['ignored'] = $result['ignored'];
				$this->notes[]     = 'calculation_rest_ignored_in_3x:' . $calc_id;
			}
			$decimals = LegacyValue::int( $c['formula_decimal_count'] ?? null );
			$out[]    = array(
				'id'         => 'calc' . $calc_id,
				'label'      => LegacyValue::str( $c['title'] ?? '' ),
				'expression' => $result['expression'],
				'format'     => array(
					'decimals'           => null === $decimals ? 2 : min( 10, $decimals ),
					'decimalSeparator'   => array_key_exists( 'formula_decimal_separator', $c ) ? LegacyValue::str( $c['formula_decimal_separator'] ) : '.',
					'thousandsSeparator' => array_key_exists( 'formula_thousands_separator', $c ) ? LegacyValue::str( $c['formula_thousands_separator'] ) : ',',
				),
				'legacy'     => $legacy,
			);
		}
		return $out;
	}

	/**
	 * Style: the 3.x values are kept and drive the "classic" preset.
	 *
	 * @param array<mixed> $form Form content.
	 * @return array<string,mixed>
	 */
	private function style( array $form ): array {
		$legacy = array();
		foreach ( is_array( $form['styling'] ?? null ) ? $form['styling'] : array() as $key => $value ) {
			if ( is_scalar( $value ) ) {
				$legacy[ (string) $key ] = (string) $value;
			}
		}
		$tokens = array();
		$map    = array(
			'color.primary'    => 'form_button_background_color',
			'color.background' => 'form_background_color',
			'color.text'       => 'form_question_heading_color',
			'color.border'     => 'form_border_color',
			'font.family'      => 'global_font',
			'radius.card'      => 'form_answer_card_border_radius',
			'radius.input'     => 'form_text_input_border_radius',
		);
		foreach ( $map as $token => $key ) {
			if ( isset( $legacy[ $key ] ) && '' !== $legacy[ $key ] ) {
				$tokens[ $token ] = $legacy[ $key ];
			}
		}
		$style = array(
			'preset' => 'classic',
			'tokens' => (object) $tokens,
		);
		if ( array() !== $legacy ) {
			$style['legacy'] = $legacy;
		}
		return $style;
	}

	/**
	 * Settings with the effective 3.x defaults.
	 *
	 * @param array<mixed> $form Form content.
	 * @return array<string,mixed>
	 */
	private function settings( array $form ): array {
		$styling  = is_array( $form['styling'] ?? null ) ? $form['styling'] : array();
		$settings = array(
			'uiLocale'           => $this->ui_locale,
			'progressBar'        => array( 'show' => ! LegacyValue::strict_true( $form['hide_progress_bar'] ?? null ) ),
			'loadingAnimation'   => LegacyValue::strict_true( $form['showLoading'] ?? null ),
			'scrollToTop'        => array(
				'desktop' => LegacyValue::equals_true( $form['activateScrollToAnchorDesktop'] ?? false ),
				'mobile'  => LegacyValue::on_unless_false( $form['activateScrollToAnchor'] ?? null ),
			),
			'rtl'                => LegacyValue::truthy( $form['rtl_layout'] ?? '' ),
			'autoHeight'         => LegacyValue::equals_true( $form['adjust_containersize'] ?? false ),
			'iconFont'           => LegacyValue::truthy( $form['showFontAwesome'] ?? false ),
			'savePartialEntries' => LegacyValue::equals_true( $form['dsgvo'] ?? false ),
		);
		foreach ( array(
			'prevLabel' => 'global_prev_text',
			'nextLabel' => 'global_next_text',
			'heading'   => 'fe_title',
		) as $key => $legacy_key ) {
			$value = LegacyValue::str( $styling[ $legacy_key ] ?? '' );
			if ( '' !== $value ) {
				$settings[ $key ] = $this->text( $value );
			}
		}
		return $settings;
	}

	/**
	 * Canvas positions from all_entries.
	 *
	 * @param array<mixed> $form Form content.
	 * @return array<string,mixed>
	 */
	private function layout( array $form ): array {
		$nodes = array();
		foreach ( is_array( $form['all_entries'] ?? null ) ? $form['all_entries'] : array() as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$s = LegacyValue::number( $entry['section'] ?? null );
			$c = LegacyValue::number( $entry['content'] ?? null );
			$x = LegacyValue::number( $entry['translationX'] ?? null );
			$y = LegacyValue::number( $entry['translationY'] ?? null );
			if ( null === $s || null === $c || null === $x || null === $y ) {
				continue;
			}
			$nodes[ FieldIds::node( (int) $s, (int) $c ) ] = array(
				'x' => round( $x, 2 ),
				'y' => round( $y, 2 ),
			);
		}
		return array( 'nodes' => (object) $nodes );
	}
}
