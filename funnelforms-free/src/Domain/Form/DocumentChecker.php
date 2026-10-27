<?php
/**
 * Reference checks for form documents (the PHP twin of checkReferences in packages/form-schema).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * The JSON Schema checks the shape; this checks that ids are unique and that every reference
 * (start node, edge ends, condition fields and options, action nodes, calculation tokens) resolves.
 */
final class DocumentChecker {

	/**
	 * Fields that may be shown on the website: no contact details, files or free HTML.
	 */
	public const PUBLIC_FIELD_TYPES = array( 'step:choice', 'step:dropdown', 'step:text', 'step:textarea', 'step:slider', 'step:rating', 'step:number', 'step:date', 'step:time', 'contact:name', 'contact:text' );

	/**
	 * Problems found, empty when the document is consistent.
	 *
	 * @param array<string,mixed> $doc Form document (decoded as arrays).
	 * @return string[]
	 */
	public static function check( array $doc ): array {
		$errors  = array();
		$nodes   = array();
		$options = array();
		$types   = array();
		$shown   = array();

		foreach ( $doc['nodes'] ?? array() as $node ) {
			if ( isset( $nodes[ $node['id'] ] ) ) {
				$errors[] = 'duplicate node id ' . $node['id'];
			}
			$nodes[ $node['id'] ] = $node['type'];
			if ( 'end' === $node['type'] ) {
				continue;
			}
			foreach ( $node['fields'] ?? array() as $field ) {
				if ( isset( $options[ $field['id'] ] ) ) {
					$errors[] = 'duplicate field id ' . $field['id'];
				}
				$options[ $field['id'] ] = array();
				$types[ $field['id'] ]   = $node['type'] . ':' . $field['type'];
				if ( isset( $field['showWhen'] ) ) {
					$shown[ $field['id'] ] = $field['showWhen'];
				}
				if ( 'content' === $field['type'] && isset( $field['props']['loader'] ) && ( empty( $field['props']['autoAdvanceMs'] ) || ! empty( $field['props']['button']['show'] ) ) ) {
					$errors[] = 'field ' . $field['id'] . ' shows a loader but does not move on by itself';
				}
				// Imported documents may hold empty props as objects.
				$props     = (array) ( $field['props'] ?? array() );
				$countries = (array) ( $props['country'] ?? array() );
				$sms       = isset( $props['sms'] ) ? (array) $props['sms'] : null;
				if ( isset( $countries['default'] ) && array() !== (array) ( $countries['allowed'] ?? array() ) && ! in_array( $countries['default'], (array) $countries['allowed'], true ) ) {
					$errors[] = 'field ' . $field['id'] . ' starts with a country it does not allow';
				}
				if ( 'contact' === $node['type'] && ( 'phone_verification' === $field['type'] || ( 'phone' === $field['type'] && null !== $sms ) ) && '' === (string) ( $sms['connectionRef'] ?? '' ) ) {
					$errors[] = 'field ' . $field['id'] . ' confirms numbers by text message without an SMS connection';
				}
				foreach ( $field['options'] ?? array() as $option ) {
					$options[ $field['id'] ][ $option['id'] ] = true;
				}
				$item_ids = array();
				foreach ( 'repeat' === $field['type'] ? $field['props']['fields'] : array() as $item ) {
					if ( isset( $item_ids[ $item['id'] ] ) ) {
						$errors[] = 'duplicate field id ' . $item['id'] . ' in repeat group ' . $field['id'];
					}
					$item_ids[ $item['id'] ] = true;
				}
			}
		}

		if ( ! isset( $nodes[ $doc['start'] ?? '' ] ) ) {
			$errors[] = 'start node ' . ( $doc['start'] ?? '' ) . ' does not exist';
		}

		$errors = array_merge( $errors, self::check_experiments( $doc['experiments'] ?? array(), $nodes ) );

		// Fields are shown in the browser, which knows the answers but not the calculations.
		foreach ( $shown as $field_id => $condition ) {
			self::check_condition( $condition, 'field ' . $field_id, $options, $errors, array_column( $doc['calculations'] ?? array(), 'id' ), $doc['experiments'] ?? array() );
			if ( self::uses( $condition, 'calc' ) ) {
				$errors[] = 'field ' . $field_id . ' is shown by a calculation';
			}
			if ( self::uses( $condition, 'field', (string) $field_id ) ) {
				$errors[] = 'field ' . $field_id . ' is shown by its own answer';
			}
		}

		$edge_ids = array();
		foreach ( $doc['edges'] ?? array() as $edge ) {
			if ( isset( $edge_ids[ $edge['id'] ] ) ) {
				$errors[] = 'duplicate edge id ' . $edge['id'];
			}
			$edge_ids[ $edge['id'] ] = true;
			if ( ! isset( $nodes[ $edge['from'] ], $nodes[ $edge['to'] ] ) ) {
				$errors[] = 'edge ' . $edge['id'] . ' connects unknown nodes';
			} elseif ( 'end' === $nodes[ $edge['from'] ] ) {
				$errors[] = 'edge ' . $edge['id'] . ' leaves an end node';
			}
			if ( isset( $edge['when'] ) ) {
				self::check_condition( $edge['when'], 'edge ' . $edge['id'], $options, $errors, array_column( $doc['calculations'] ?? array(), 'id' ), $doc['experiments'] ?? array() );
			}
		}

		$calc_ids = array();
		foreach ( $doc['calculations'] ?? array() as $calc ) {
			if ( isset( $calc_ids[ $calc['id'] ] ) ) {
				$errors[] = 'duplicate calculation id ' . $calc['id'];
			}
			$calc_ids[ $calc['id'] ] = true;
		}

		$action_ids = array();
		foreach ( $doc['actions'] ?? array() as $action ) {
			if ( isset( $action_ids[ $action['id'] ] ) ) {
				$errors[] = 'duplicate action id ' . $action['id'];
			}
			$action_ids[ $action['id'] ] = true;
			if ( isset( $action['node'] ) && ! isset( $nodes[ $action['node'] ] ) ) {
				$errors[] = 'action ' . $action['id'] . ' refers to unknown node ' . $action['node'];
			}
			if ( isset( $action['when'] ) ) {
				self::check_condition( $action['when'], 'action ' . $action['id'], $options, $errors, array_column( $doc['calculations'] ?? array(), 'id' ), $doc['experiments'] ?? array() );
			}
		}

		$used = array();
		array_walk_recursive(
			$doc,
			static function ( $value ) use ( &$used ): void {
				if ( is_string( $value ) && preg_match_all( '/\{\{calc:([A-Za-z0-9_-]+)(?::text)?\}\}/', $value, $m ) ) {
					foreach ( $m[1] as $calc_id ) {
						$used[ $calc_id ] = true;
					}
				}
			}
		);
		foreach ( array_keys( $used ) as $calc_id ) {
			if ( ! isset( $calc_ids[ $calc_id ] ) ) {
				$errors[] = 'token refers to unknown calculation ' . $calc_id;
			}
		}
		foreach ( $doc['nodes'] ?? array() as $node ) {
			foreach ( 'step' === $node['type'] ? $node['fields'] ?? array() : array() as $field ) {
				foreach ( 'result' === $field['type'] ? $field['props']['lines'] ?? array() : array() as $line ) {
					foreach ( array_unique( array( $line['calculation'] ?? '', $line['to'] ?? $line['calculation'] ?? '' ) ) as $calc ) {
						if ( ! isset( $calc_ids[ $calc ] ) ) {
							$errors[] = 'field ' . $field['id'] . ' refers to unknown calculation ' . $calc;
						}
					}
				}
			}
		}
		foreach ( $doc['actions'] ?? array() as $action ) {
			$calc = $action['config']['valueCalculation'] ?? null;
			if ( in_array( $action['kind'], array( 'conversion', 'googleAds' ), true ) && null !== $calc && ! isset( $calc_ids[ $calc ] ) ) {
				$errors[] = 'action ' . $action['id'] . ' refers to unknown calculation ' . $calc;
			}
		}
		$optin = $doc['settings']['doubleOptIn']['field'] ?? null;
		if ( null !== $optin && 'contact:email' !== ( $types[ $optin ] ?? '' ) ) {
			$errors[] = 'double opt-in refers to unknown e-mail field ' . $optin;
		}
		$abandon = $doc['settings']['abandonment'] ?? null;
		if ( is_array( $abandon ) && 'contact:email' !== ( $types[ $abandon['field'] ?? '' ] ?? '' ) ) {
			$errors[] = 'abandonment refers to unknown e-mail field ' . ( $abandon['field'] ?? '' );
		}
		if ( is_array( $abandon ) && ( isset( $abandon['consentField'] ) || 'consent' === ( $abandon['basis'] ?? '' ) ) && ! in_array( $types[ $abandon['consentField'] ?? '' ] ?? '', array( 'contact:consent', 'contact:checkbox' ), true ) ) {
			$errors[] = 'abandonment refers to unknown consent field ' . ( $abandon['consentField'] ?? '' );
		}
		$shown = $doc['settings']['publicEntries'] ?? array();
		foreach ( $shown['fields'] ?? array() as $id ) {
			if ( ! in_array( $types[ $id ] ?? '', self::PUBLIC_FIELD_TYPES, true ) ) {
				$errors[] = 'public entries show unknown or unsuitable field ' . $id;
			}
		}
		if ( isset( $shown['consentField'] ) && 'contact:consent' !== ( $types[ $shown['consentField'] ] ?? '' ) ) {
			$errors[] = 'public entries refer to unknown consent field ' . $shown['consentField'];
		}
		$score = $doc['settings']['scoreCalculation'] ?? null;
		if ( null !== $score && ! isset( $calc_ids[ $score ] ) ) {
			$errors[] = 'score refers to unknown calculation ' . $score;
		}
		$lead_value = $doc['settings']['valueCalculation'] ?? null;
		if ( null !== $lead_value && ! isset( $calc_ids[ $lead_value ] ) ) {
			$errors[] = 'lead value refers to unknown calculation ' . $lead_value;
		}
		$quiz = $doc['settings']['quiz'] ?? null;
		if ( is_array( $quiz ) && ! isset( $calc_ids[ $quiz['calculation'] ?? '' ] ) ) {
			$errors[] = 'quiz refers to unknown calculation ' . ( $quiz['calculation'] ?? '' );
		}
		foreach ( is_array( $quiz ) ? $quiz['results'] ?? array() : array() as $result ) {
			if ( 'end' !== ( $nodes[ $result['node'] ?? '' ] ?? '' ) ) {
				$errors[] = 'quiz result is not an end node: ' . ( $result['node'] ?? '' );
			}
		}
		$errors = array_merge( $errors, self::check_payment( $doc, $calc_ids, $types, $nodes ) );
		$errors = array_merge( $errors, self::check_features( $doc, $types ) );

		return $errors;
	}

	/**
	 * Checks the payment settings: what they refer to exists, and the mode has what it needs.
	 *
	 * @param array<string,mixed>  $doc      Form document.
	 * @param array<string,bool>   $calc_ids Calculation ids.
	 * @param array<string,string> $types    Field id => node type:field type.
	 * @param array<string,string> $nodes    Node id => type.
	 * @return string[]
	 */
	private static function check_payment( array $doc, array $calc_ids, array $types, array $nodes ): array {
		$errors  = array();
		$payment = $doc['settings']['payment'] ?? null;
		if ( ! is_array( $payment ) ) {
			foreach ( $doc['actions'] ?? array() as $action ) {
				if ( 'paid' === ( $action['on'] ?? '' ) ) {
					$errors[] = 'action ' . $action['id'] . ' waits for a payment but the form takes none';
				}
			}
			return $errors;
		}
		$calc = $payment['amount']['calculation'] ?? null;
		if ( null !== $calc && ! isset( $calc_ids[ $calc ] ) ) {
			$errors[] = 'payment refers to unknown calculation ' . $calc;
		}
		if ( isset( $payment['emailField'] ) && 'contact:email' !== ( $types[ $payment['emailField'] ] ?? '' ) ) {
			$errors[] = 'payment refers to unknown e-mail field ' . $payment['emailField'];
		}
		if ( isset( $payment['node'] ) && 'contact' !== ( $nodes[ $payment['node'] ] ?? '' ) ) {
			$errors[] = 'payment refers to unknown contact node ' . $payment['node'];
		}
		$mode = $payment['mode'] ?? '';
		if ( 'deposit' === $mode && ! isset( $payment['depositPercent'] ) ) {
			$errors[] = 'deposit payment needs depositPercent';
		}
		if ( 'subscription' === $mode && ! isset( $payment['interval'] ) ) {
			$errors[] = 'subscription payment needs an interval';
		}
		if ( 'subscription' === $mode && ! str_starts_with( (string) ( $payment['connection'] ?? '' ), 'stripe:' ) ) {
			$errors[] = 'subscription payment needs a Stripe connection';
		}
		return $errors;
	}

	/**
	 * Whether a condition has a rule with this key (calc, field), optionally with this value.
	 *
	 * @param array<string,mixed> $condition Condition.
	 * @param string              $key       Key of the rule.
	 * @param string|null         $value     Value the key must have.
	 */
	private static function uses( array $condition, string $key, ?string $value = null ): bool {
		foreach ( array( 'all', 'any' ) as $group ) {
			if ( isset( $condition[ $group ] ) ) {
				foreach ( $condition[ $group ] as $c ) {
					if ( self::uses( $c, $key, $value ) ) {
						return true;
					}
				}
				return false;
			}
		}
		return isset( $condition[ $key ] ) && ( null === $value || $value === $condition[ $key ] );
	}

	/**
	 * Checks the fields and options a condition refers to.
	 *
	 * @param array<string,mixed>              $condition Condition.
	 * @param string                           $owner     What has the condition, e.g. "edge e1" or "field q1".
	 * @param array<string,array<string,bool>> $options   Field id => option ids.
	 * @param string[]                         $errors    Collected problems.
	 * @param string[]                         $calc_ids  Calculation ids of the document.
	 * @param array<int,array<string,mixed>>   $experiments A/B tests of the document.
	 */
	private static function check_condition( array $condition, string $owner, array $options, array &$errors, array $calc_ids, array $experiments ): void {
		foreach ( array( 'all', 'any' ) as $group ) {
			if ( isset( $condition[ $group ] ) ) {
				foreach ( $condition[ $group ] as $c ) {
					self::check_condition( $c, $owner, $options, $errors, $calc_ids, $experiments );
				}
				return;
			}
		}
		if ( isset( $condition['experiment'] ) ) {
			$finder     = Edition::pro( Experiments::class );
			$experiment = null === $finder ? null : $finder::find( array( 'experiments' => $experiments ), (string) $condition['experiment'] );
			if ( null === $experiment ) {
				$errors[] = $owner . ' refers to unknown experiment ' . $condition['experiment'];
			} elseif ( ! in_array( $condition['variant'], array_column( $experiment['variants'], 'id' ), true ) ) {
				$errors[] = $owner . ' refers to unknown variant ' . $condition['variant'] . ' of experiment ' . $condition['experiment'];
			}
			return;
		}
		if ( isset( $condition['calc'] ) ) {
			if ( ! in_array( $condition['calc'], $calc_ids, true ) ) {
				$errors[] = $owner . ' refers to unknown calculation ' . $condition['calc'];
			}
			return;
		}
		if ( ! isset( $options[ $condition['field'] ] ) ) {
			$errors[] = $owner . ' refers to unknown field ' . $condition['field'];
		} elseif ( in_array( $condition['op'], array( 'selected', 'selectedOnly' ), true ) && ! isset( $options[ $condition['field'] ][ $condition['value'] ] ) ) {
			$errors[] = $owner . ' refers to unknown option ' . $condition['value'];
		}
	}

	/**
	 * A/B tests: unique ids, existing start nodes and winner, a weight to draw by.
	 *
	 * @param array<int,array<string,mixed>> $experiments A/B tests.
	 * @param array<string,string>           $nodes       Node id => type.
	 * @return string[]
	 */
	private static function check_experiments( array $experiments, array $nodes ): array {
		$errors   = array();
		$ids      = array();
		$starting = '';
		foreach ( $experiments as $experiment ) {
			if ( isset( $ids[ $experiment['id'] ] ) ) {
				$errors[] = 'duplicate experiment id ' . $experiment['id'];
			}
			$ids[ $experiment['id'] ] = true;
			$variant_ids              = array();
			$weighted                 = false;
			$starts                   = false;
			foreach ( $experiment['variants'] as $variant ) {
				if ( isset( $variant_ids[ $variant['id'] ] ) ) {
					$errors[] = 'duplicate variant id ' . $variant['id'] . ' in experiment ' . $experiment['id'];
				}
				$variant_ids[ $variant['id'] ] = true;
				$weighted                      = $weighted || $variant['weight'] > 0;
				if ( isset( $variant['start'] ) ) {
					$starts = true;
					if ( 'end' === ( $nodes[ $variant['start'] ] ?? 'end' ) ) {
						$errors[] = 'experiment ' . $experiment['id'] . ' starts variant ' . $variant['id'] . ' at unknown node ' . $variant['start'];
					}
				}
			}
			if ( isset( $experiment['winner'] ) && ! isset( $variant_ids[ $experiment['winner'] ] ) ) {
				$errors[] = 'experiment ' . $experiment['id'] . ' has no variant ' . $experiment['winner'];
			}
			if ( isset( $experiment['suggested'] ) && ! isset( $variant_ids[ $experiment['suggested'] ] ) ) {
				$errors[] = 'experiment ' . $experiment['id'] . ' has no variant ' . $experiment['suggested'];
			}
			if ( 'running' === $experiment['status'] && ! $weighted ) {
				$errors[] = 'experiment ' . $experiment['id'] . ' has no variant with a weight';
			}
			if ( $starts ) {
				if ( '' !== $starting ) {
					$errors[] = 'experiments ' . $starting . ' and ' . $experiment['id'] . ' both set start nodes';
				}
				$starting = '' === $starting ? (string) $experiment['id'] : $starting;
			}
		}
		return $errors;
	}

	/**
	 * Checks calculations that use functions and each other, personality quizzes and coupons.
	 *
	 * @param array<string,mixed>  $doc   Form document.
	 * @param array<string,string> $types Field id => node type:field type.
	 * @return string[]
	 */
	private static function check_features( array $doc, array $types ): array {
		$errors     = array();
		$calcs      = array();
		$calculator = Edition::pro( Calculator::class );
		// Funnelforms Free has no calculations; Edition::problems() names them as a Pro feature.
		$calculations = null === $calculator ? array() : (array) ( $doc['calculations'] ?? array() );
		foreach ( $calculations as $calc ) {
			$calcs[ (string) $calc['id'] ] = $calculator::refs( (array) $calc['expression'] );
		}
		foreach ( $calculations as $calc ) {
			foreach ( $calcs[ $calc['id'] ] as $ref ) {
				if ( ! isset( $calcs[ $ref ] ) ) {
					$errors[] = 'calculation ' . $calc['id'] . ' refers to unknown calculation ' . $ref;
				}
			}
			if ( self::uses_itself( (string) $calc['id'], $calcs ) ) {
				$errors[] = 'calculation ' . $calc['id'] . ' uses itself';
			}
			foreach ( self::calls( (array) $calc['expression'] ) as $call ) {
				[ $least, $most ] = $calculator::FUNCTIONS[ $call[0] ];
				// lookup takes pairs of limit and value between the number and the value for anything above.
				if ( $call[1] < $least || $call[1] > $most || ( 'lookup' === $call[0] && 0 !== $call[1] % 2 ) ) {
					$errors[] = 'calculation ' . $calc['id'] . ' calls ' . $call[0] . ' with ' . $call[1] . ' arguments';
				}
			}
		}
		$quiz = $doc['settings']['quiz'] ?? null;
		if ( is_array( $quiz ) && 'personality' === ( $quiz['kind'] ?? '' ) ) {
			$categories = array_column( (array) ( $quiz['categories'] ?? array() ), 'id' );
			if ( count( $categories ) !== count( array_unique( $categories ) ) ) {
				$errors[] = 'quiz has duplicate categories';
			}
			foreach ( $quiz['results'] ?? array() as $result ) {
				if ( ! in_array( $result['category'] ?? '', $categories, true ) ) {
					$errors[] = 'quiz result ' . ( $result['node'] ?? '' ) . ' has no category of the quiz';
				}
			}
		}
		$payment = $doc['settings']['payment'] ?? null;
		if ( is_array( $payment ) ) {
			$field = $payment['couponField'] ?? null;
			if ( null !== $field && ! in_array( $types[ $field ] ?? '', array( 'step:text', 'contact:text' ), true ) ) {
				$errors[] = 'payment refers to unknown coupon field ' . $field;
			}
			$codes = array_map( 'strtolower', array_column( (array) ( $payment['coupons'] ?? array() ), 'code' ) );
			if ( count( $codes ) !== count( array_unique( $codes ) ) ) {
				$errors[] = 'payment has duplicate coupon codes';
			}
			foreach ( (array) ( $payment['coupons'] ?? array() ) as $coupon ) {
				if ( isset( $coupon['percent'] ) === isset( $coupon['amount'] ) ) {
					$errors[] = 'coupon ' . $coupon['code'] . ' needs either percent or amount';
				}
			}
		}
		return $errors;
	}

	/**
	 * Whether a calculation uses itself, directly or through others.
	 *
	 * @param string              $id    Calculation id.
	 * @param array<string,array> $calcs Refs by calculation id.
	 */
	private static function uses_itself( string $id, array $calcs ): bool {
		$seen = array();
		$todo = $calcs[ $id ] ?? array();
		while ( array() !== $todo ) {
			$ref = (string) array_pop( $todo );
			if ( $ref === $id ) {
				return true;
			}
			if ( isset( $seen[ $ref ] ) ) {
				continue;
			}
			$seen[ $ref ] = true;
			$todo         = array_merge( $todo, $calcs[ $ref ] ?? array() );
		}
		return false;
	}

	/**
	 * Functions an expression calls, with their number of arguments.
	 *
	 * @param array<string,mixed> $node Expression node.
	 * @return array<int,array{0:string,1:int}>
	 */
	private static function calls( array $node ): array {
		$out = isset( $node['fn'] ) ? array( array( (string) $node['fn'], count( (array) $node['args'] ) ) ) : array();
		foreach ( array_merge( isset( $node['neg'] ) ? array( $node['neg'] ) : array(), (array) ( $node['args'] ?? array() ) ) as $child ) {
			if ( is_array( $child ) ) {
				$out = array_merge( $out, self::calls( $child ) );
			}
		}
		return $out;
	}
}
