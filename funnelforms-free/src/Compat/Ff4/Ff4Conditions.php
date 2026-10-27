<?php
/**
 * Conditions of paths in Funnelforms 4, as conditions of the form document.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Ff4;

defined( 'ABSPATH' ) || exit;

/**
 * In Funnelforms 4 a path (logic edge) holds at most one condition on the answer of the step it
 * leaves (src/lib/form/logic/evaluateCondition.ts of the SaaS). The SaaS runtime tries the paths
 * with a condition in their order and then the first path without one; the document does the same
 * with its edges and the default edge.
 *
 * Conditions are taken over as they were meant. Where the SaaS runtime never matched (operators
 * it did not know: not_contains, is_empty, is_not_empty), the path now works; the converter notes
 * it. Conditions on ranges (two-handle sliders, periods of dates) and on the region of an address
 * have no counterpart and return null.
 *
 * Pure PHP without WordPress.
 */
final class Ff4Conditions {

	/** Text operators of Funnelforms 4 and their counterpart. */
	private const TEXT = array(
		'equals'       => 'equalsText',
		'equal'        => 'equalsText',
		'not_equals'   => 'notEqualsText',
		'contains'     => 'contains',
		'not_contains' => 'notContains',
		'starts_with'  => 'startsWith',
		'ends_with'    => 'endsWith',
		'is_empty'     => 'empty',
		'is_not_empty' => 'filled',
	);

	/** Operators the SaaS runtime did not know, so their paths were never taken there. */
	public const NEVER_MATCHED_IN_FF4 = array( 'not_contains', 'is_empty', 'is_not_empty', 'not_between' );

	/** Number operators. */
	private const NUMBER = array(
		'less'    => 'lt',
		'equal'   => 'eq',
		'equals'  => 'eq',
		'greater' => 'gt',
	);

	/** Parts of an address. */
	private const PARTS = array(
		'country'     => 'country',
		'city'        => 'city',
		'postal_code' => 'zip',
	);

	/**
	 * The condition of a path, or null when it has no counterpart.
	 *
	 * @param array<string,mixed> $condition Condition of the edge in Funnelforms 4.
	 * @param array<string,mixed> $field     The new field the step asks (id, type, options).
	 * @param string              $ff4_type  Type of the field in Funnelforms 4.
	 * @return array<string,mixed>|null
	 */
	public static function map( array $condition, array $field, string $ff4_type ): ?array {
		$id       = (string) $field['id'];
		$operator = (string) ( $condition['operator'] ?? '' );
		$type     = (string) ( $condition['type'] ?? '' );

		// A path from one answer of a choice (handle "-option-<n>").
		if ( '' === $operator && isset( $condition['optionIndex'] ) && is_numeric( $condition['optionIndex'] ) ) {
			$option = self::option( $field, (int) $condition['optionIndex'] );
			return null === $option ? null : array(
				'field' => $id,
				'op'    => 'selected',
				'value' => $option,
			);
		}

		if ( in_array( $type, array( 'multi_selection', 'dropdown' ), true ) ) {
			return self::selection( $condition, $field );
		}
		if ( in_array( $type, array( 'country', 'region', 'city', 'postal_code' ), true ) ) {
			return self::address( $condition, $id, $type );
		}
		if ( 'text' === $type ) {
			return self::text( $condition, $id, null );
		}
		if ( 'simple_date' === $type ) {
			return self::date( $condition, $id );
		}
		if ( in_array( $type, array( 'slider', 'scale' ), true ) || ( '' === $type && in_array( $ff4_type, array( 'slider', 'scale' ), true ) ) ) {
			return self::number( $condition, $id );
		}
		// range_slider, date_range and anything unknown.
		return null;
	}

	/**
	 * Whether the runtime of Funnelforms 4 never took a path with this condition.
	 *
	 * @param array<string,mixed> $condition Condition.
	 */
	public static function never_matched_in_ff4( array $condition ): bool {
		return in_array( (string) ( $condition['operator'] ?? '' ), self::NEVER_MATCHED_IN_FF4, true );
	}

	/**
	 * Id of the option at a position.
	 *
	 * @param array<string,mixed> $field Field.
	 * @param int                 $index Position from 0.
	 */
	private static function option( array $field, int $index ): ?string {
		$options = is_array( $field['options'] ?? null ) ? array_values( $field['options'] ) : array();
		return isset( $options[ $index ]['id'] ) ? (string) $options[ $index ]['id'] : null;
	}

	/**
	 * Which options are chosen, or how many.
	 *
	 * @param array<string,mixed> $condition Condition.
	 * @param array<string,mixed> $field     Field.
	 * @return array<string,mixed>|null
	 */
	private static function selection( array $condition, array $field ): ?array {
		$id = (string) $field['id'];
		if ( 'count' === ( $condition['operator'] ?? '' ) ) {
			$op = self::NUMBER[ (string) ( $condition['countOperator'] ?? '' ) ] ?? null;
			if ( null === $op || ! is_numeric( $condition['countValue'] ?? null ) ) {
				return null;
			}
			return array(
				'field'  => $id,
				'op'     => $op,
				'value'  => 0 + $condition['countValue'],
				'number' => 'count',
			);
		}
		if ( 'exact_match' !== ( $condition['operator'] ?? '' ) || ! is_array( $condition['selectedOptions'] ?? null ) ) {
			return null;
		}
		$chosen = array();
		foreach ( $condition['selectedOptions'] as $index ) {
			$option = is_numeric( $index ) ? self::option( $field, (int) $index ) : null;
			if ( null === $option ) {
				return null;
			}
			$chosen[ $option ] = true;
		}
		$chosen = array_keys( $chosen );
		if ( array() === $chosen ) {
			return array(
				'field' => $id,
				'op'    => 'empty',
			);
		}
		$multiple = ! empty( $field['props']['multiple'] );
		if ( 1 === count( $chosen ) ) {
			return array(
				'field' => $id,
				'op'    => $multiple ? 'selectedOnly' : 'selected',
				'value' => $chosen[0],
			);
		}
		$all = array();
		foreach ( $chosen as $option ) {
			$all[] = array(
				'field' => $id,
				'op'    => 'selected',
				'value' => $option,
			);
		}
		$all[] = array(
			'field'  => $id,
			'op'     => 'eq',
			'value'  => count( $chosen ),
			'number' => 'count',
		);
		return array( 'all' => $all );
	}

	/**
	 * A part of an address.
	 *
	 * @param array<string,mixed> $condition Condition.
	 * @param string              $id        Field id.
	 * @param string              $type      Part in Funnelforms 4.
	 * @return array<string,mixed>|null
	 */
	private static function address( array $condition, string $id, string $type ): ?array {
		$part = self::PARTS[ $type ] ?? null;
		if ( null === $part || 'range' === ( $condition['operator'] ?? '' ) ) {
			return null;
		}
		return self::text( $condition, $id, $part );
	}

	/**
	 * A text comparison.
	 *
	 * @param array<string,mixed> $condition Condition.
	 * @param string              $id        Field id.
	 * @param string|null         $part      Part of an address.
	 * @return array<string,mixed>|null
	 */
	private static function text( array $condition, string $id, ?string $part ): ?array {
		$op = self::TEXT[ (string) ( $condition['operator'] ?? '' ) ] ?? null;
		if ( null === $op ) {
			return null;
		}
		$out = array(
			'field' => $id,
			'op'    => $op,
		);
		if ( ! in_array( $op, array( 'empty', 'filled' ), true ) ) {
			$value = $condition['value'] ?? '';
			if ( ! is_scalar( $value ) ) {
				return null;
			}
			$out['value'] = (string) $value;
		}
		if ( null !== $part ) {
			$out['part'] = $part;
		}
		return $out;
	}

	/**
	 * A number (slider, scale).
	 *
	 * @param array<string,mixed> $condition Condition.
	 * @param string              $id        Field id.
	 * @return array<string,mixed>|null
	 */
	private static function number( array $condition, string $id ): ?array {
		$op = self::NUMBER[ (string) ( $condition['operator'] ?? '' ) ] ?? null;
		if ( null === $op || ! is_numeric( $condition['value'] ?? null ) ) {
			return null;
		}
		return array(
			'field' => $id,
			'op'    => $op,
			'value' => 0 + $condition['value'],
		);
	}

	/**
	 * A date: on, not on, before, after, between two days, or within a number of days from today.
	 *
	 * @param array<string,mixed> $condition Condition.
	 * @param string              $id        Field id.
	 * @return array<string,mixed>|null
	 */
	private static function date( array $condition, string $id ): ?array {
		$operator = (string) ( $condition['operator'] ?? '' );
		$day      = fn( string $op, string $value, int $days = 0 ): array => array(
			'field' => $id,
			'op'    => $op,
			'value' => $value,
		) + ( 0 !== $days ? array( 'days' => $days ) : array() );
		if ( 'within_period' === $operator ) {
			// The SaaS counted the days between the answer and now, in both directions, and ignored the unit.
			$n = $condition['periodValue'] ?? null;
			if ( ! is_numeric( $n ) || $n < 0 ) {
				return null;
			}
			$n = (int) $n;
			return array(
				'all' => array(
					$day( 'dateAfter', 'today', -( $n + 1 ) ),
					$day( 'dateBefore', 'today', $n + 1 ),
				),
			);
		}
		$value = self::day( $condition['value'] ?? null );
		if ( null === $value ) {
			return null;
		}
		switch ( $operator ) {
			case 'equals':
			case 'equal':
				return $day( 'dateOn', $value );
			case 'not_equals':
				return array( 'any' => array( $day( 'dateBefore', $value ), $day( 'dateAfter', $value ) ) );
			case 'before':
				return $day( 'dateBefore', $value );
			case 'after':
				return $day( 'dateAfter', $value );
			case 'between':
				$to = self::day( $condition['secondValue'] ?? null );
				if ( null === $to ) {
					return null;
				}
				return array(
					'all' => array(
						array( 'any' => array( $day( 'dateAfter', $value ), $day( 'dateOn', $value ) ) ),
						array( 'any' => array( $day( 'dateBefore', $to ), $day( 'dateOn', $to ) ) ),
					),
				);
		}
		return null;
	}

	/**
	 * A day as YYYY-MM-DD from an ISO date or time.
	 *
	 * @param mixed $value Value.
	 */
	private static function day( $value ): ?string {
		if ( ! is_string( $value ) || 1 !== preg_match( '/^(\d{4}-\d{2}-\d{2})/', $value, $m ) ) {
			return null;
		}
		return $m[1];
	}
}
