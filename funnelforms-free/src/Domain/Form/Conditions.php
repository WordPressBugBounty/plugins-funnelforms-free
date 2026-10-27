<?php
/**
 * Evaluates edge conditions and finds the next node of a form document.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

/**
 * Answers are keyed by field id: a list of option ids for choice and dropdown fields, a list of
 * items for repeat groups, a string (or number) for everything else.
 */
final class Conditions {

	/**
	 * A repeat group (a list of items) counts as its number of items; other answers stay as they are.
	 *
	 * @param mixed $answer Answer.
	 * @return mixed
	 */
	public static function item_count( $answer ) {
		return is_array( $answer ) && isset( $answer[0] ) && is_array( $answer[0] ) ? count( $answer ) : $answer;
	}

	/**
	 * Whether a condition holds.
	 *
	 * @param array<string,mixed>  $condition Condition of schema v1.
	 * @param array<string,mixed>  $answers   Answers by field id.
	 * @param callable|null        $calc      Result of a calculation by id (float, or null for an error);
	 *                                        without it calculation conditions compare NaN.
	 * @param array<string,string> $variants Variants of A/B tests shown, by experiment id.
	 * @param array<string,mixed>  $context  For date conditions: today (YYYY-MM-DD; the site's
	 *                                       today without it) and formats (date format by field id).
	 */
	public static function holds( array $condition, array $answers, ?callable $calc = null, array $variants = array(), array $context = array() ): bool {
		if ( isset( $condition['all'] ) ) {
			foreach ( $condition['all'] as $c ) {
				if ( ! self::holds( $c, $answers, $calc, $variants, $context ) ) {
					return false;
				}
			}
			return true;
		}
		if ( isset( $condition['any'] ) ) {
			foreach ( $condition['any'] as $c ) {
				if ( self::holds( $c, $answers, $calc, $variants, $context ) ) {
					return true;
				}
			}
			return false;
		}

		if ( isset( $condition['calc'] ) ) {
			$result = null === $calc ? null : $calc( (string) $condition['calc'] );
			return self::compare( is_numeric( $result ) ? (float) $result : null, (string) $condition['op'], (float) $condition['value'] );
		}
		if ( isset( $condition['experiment'] ) ) {
			return ( $variants[ $condition['experiment'] ] ?? null ) === $condition['variant'];
		}

		$raw    = $answers[ $condition['field'] ] ?? null;
		$answer = self::item_count( $raw );
		$part   = isset( $condition['part'] ) ? (string) $condition['part'] : null;
		switch ( $condition['op'] ) {
			case 'selected':
				return is_array( $answer ) && in_array( $condition['value'], $answer, true );
			case 'selectedOnly':
				return is_array( $answer ) && array( $condition['value'] ) === array_values( $answer );
			case 'filled':
			case 'empty':
				return self::filled( null === $part ? $raw : self::part( $raw, $part ) ) === ( 'filled' === $condition['op'] );
			case 'equalsText':
			case 'notEqualsText':
			case 'contains':
			case 'notContains':
			case 'startsWith':
			case 'endsWith':
				return self::compare_text( null === $part ? self::answer_text( $answer ) : self::part( $raw, $part ), (string) $condition['op'], (string) $condition['value'] );
			case 'dateBefore':
			case 'dateAfter':
			case 'dateOn':
				$format = (string) ( $context['formats'][ $condition['field'] ] ?? 'dd.mm.yy' );
				$date   = self::iso_date( explode( self::RANGE_SEPARATOR, JsNumber::to_string( $answer ) )[0], $format );
				$day    = 'today' === $condition['value'] ? (string) ( $context['today'] ?? current_datetime()->format( 'Y-m-d' ) ) : (string) $condition['value'];
				$day    = self::shift_days( $day, (int) ( $condition['days'] ?? 0 ) );
				if ( '' === $date || '' === $day ) {
					return false;
				}
				return 'dateBefore' === $condition['op'] ? $date < $day : ( 'dateAfter' === $condition['op'] ? $date > $day : $date === $day );
		}

		if ( 'count' === ( $condition['number'] ?? 'float' ) ) {
			return self::compare( (float) self::count( $raw ), (string) $condition['op'], (float) $condition['value'] );
		}
		$text = JsNumber::to_string( $answer );
		return self::compare( 'int' === ( $condition['number'] ?? 'float' ) ? JsNumber::parse_int( $text ) : JsNumber::parse_float( $text ), (string) $condition['op'], (float) $condition['value'] );
	}

	/** Separator of the two dates of a period (AnswerValidator::RANGE_SEPARATOR). */
	private const RANGE_SEPARATOR = ' – ';

	/**
	 * How many answers were chosen: the length of a list (options, files, items), otherwise 1 when filled.
	 *
	 * @param mixed $answer Answer.
	 */
	private static function count( $answer ): int {
		if ( is_array( $answer ) && array_is_list( $answer ) ) {
			return count( $answer );
		}
		return self::filled( $answer ) ? 1 : 0;
	}

	/**
	 * Whether an answer holds something: text other than spaces, a number, a list or address with content.
	 *
	 * @param mixed $answer Answer.
	 */
	private static function filled( $answer ): bool {
		if ( null === $answer ) {
			return false;
		}
		if ( is_array( $answer ) ) {
			if ( array_is_list( $answer ) ) {
				return array() !== $answer;
			}
			foreach ( $answer as $value ) {
				if ( self::filled( $value ) ) {
					return true;
				}
			}
			return false;
		}
		return '' !== trim( JsNumber::to_string( $answer ) );
	}

	/**
	 * A part of an address answer, as text.
	 *
	 * @param mixed  $answer Answer.
	 * @param string $part   Part.
	 */
	private static function part( $answer, string $part ): string {
		$value = is_array( $answer ) && ! array_is_list( $answer ) ? ( $answer[ $part ] ?? null ) : null;
		return is_string( $value ) || is_int( $value ) || is_float( $value ) ? JsNumber::to_string( $value ) : '';
	}

	/**
	 * An answer as text; an address as its filled parts joined by commas.
	 *
	 * @param mixed $answer Answer.
	 */
	private static function answer_text( $answer ): string {
		if ( is_array( $answer ) && array() !== $answer && ! array_is_list( $answer ) ) {
			$parts = array_map( static fn( $p ): string => trim( JsNumber::to_string( $p ) ), array_values( $answer ) );
			return implode( ', ', array_filter( $parts, static fn( string $p ): bool => '' !== $p ) );
		}
		return JsNumber::to_string( $answer );
	}

	/**
	 * Compares texts: equalsText and notEqualsText exactly, the others without case and outer spaces.
	 *
	 * @param string $text  Answer.
	 * @param string $op    Operator.
	 * @param string $value Value of the condition.
	 */
	private static function compare_text( string $text, string $op, string $value ): bool {
		if ( 'equalsText' === $op ) {
			return $text === $value;
		}
		if ( 'notEqualsText' === $op ) {
			return $text !== $value;
		}
		$haystack = mb_strtolower( trim( $text ) );
		$needle   = mb_strtolower( trim( $value ) );
		switch ( $op ) {
			case 'contains':
				return str_contains( $haystack, $needle );
			case 'notContains':
				return ! str_contains( $haystack, $needle );
			case 'startsWith':
				return str_starts_with( $haystack, $needle );
			case 'endsWith':
				return str_ends_with( $haystack, $needle );
		}
		return false;
	}

	/**
	 * YYYY-MM-DD of a date in a format of dd, mm and yy (four-digit year); empty when it is none.
	 *
	 * @param string $text   Date.
	 * @param string $format Format.
	 */
	public static function iso_date( string $text, string $format ): string {
		$parts = preg_split( '/(dd|mm|yy)/', $format, -1, PREG_SPLIT_DELIM_CAPTURE );
		$order = array();
		$regex = '';
		foreach ( false === $parts ? array() : $parts as $part ) {
			if ( 'dd' === $part || 'mm' === $part || 'yy' === $part ) {
				$order[] = $part;
				$regex  .= 'yy' === $part ? '(\\d{4})' : '(\\d{1,2})';
			} else {
				$regex .= preg_quote( $part, '/' );
			}
		}
		if ( 3 !== count( $order ) || 3 !== count( array_unique( $order ) ) || 1 !== preg_match( '/^' . $regex . '$/', trim( $text ), $m ) ) {
			return '';
		}
		$values = array_combine( $order, array_map( 'intval', array_slice( $m, 1 ) ) );
		return checkdate( $values['mm'], $values['dd'], $values['yy'] ) ? sprintf( '%04d-%02d-%02d', $values['yy'], $values['mm'], $values['dd'] ) : '';
	}

	/**
	 * YYYY-MM-DD moved by a number of days; empty for anything but such a date.
	 *
	 * @param string $iso  Date.
	 * @param int    $days Days.
	 */
	private static function shift_days( string $iso, int $days ): string {
		if ( 1 !== preg_match( '/^(\\d{4})-(\\d{2})-(\\d{2})$/', $iso, $m ) ) {
			return '';
		}
		$date = gmmktime( 0, 0, 0, (int) $m[2], (int) $m[3] + $days, (int) $m[1] );
		return gmdate( 'Y-m-d', $date );
	}

	/**
	 * Compares a number; null stands for NaN, for which every comparison is false and "not equal" true.
	 *
	 * @param float|null $number Number.
	 * @param string     $op     lt, lte, gt, gte, eq or neq.
	 * @param float      $value  Value of the condition.
	 */
	private static function compare( ?float $number, string $op, float $value ): bool {
		if ( null === $number ) {
			return 'neq' === $op;
		}
		switch ( $op ) {
			case 'lt':
				return $number < $value;
			case 'lte':
				return $number <= $value;
			case 'gt':
				return $number > $value;
			case 'gte':
				return $number >= $value;
			case 'eq':
				return $number === $value;
			case 'neq':
				return $number !== $value;
		}
		return false;
	}

	/**
	 * The node that follows $node_id: the first edge (in document order) whose condition holds,
	 * otherwise the default edge. Null when no edge applies.
	 *
	 * @param array<string,mixed>  $document Form document.
	 * @param string               $node_id  Current node.
	 * @param array<string,mixed>  $answers  Answers by field id.
	 * @param callable|null        $calc     Result of a calculation by id, see holds().
	 * @param array<string,string> $variants Variants of A/B tests shown, by experiment id.
	 */
	public static function next( array $document, string $node_id, array $answers, ?callable $calc = null, array $variants = array() ): ?string {
		$context  = array( 'formats' => self::date_formats( $document ) );
		$fallback = null;
		foreach ( $document['edges'] as $edge ) {
			if ( $edge['from'] !== $node_id ) {
				continue;
			}
			if ( ! empty( $edge['default'] ) ) {
				$fallback = $fallback ?? $edge['to'];
				continue;
			}
			if ( ! isset( $edge['when'] ) || self::holds( $edge['when'], $answers, $calc, $variants, $context ) ) {
				return $edge['to'];
			}
		}
		return $fallback;
	}

	/**
	 * The fields of steps that visitors see, in order, and the answers that count. A field with
	 * showWhen is shown only while its condition holds for the answers of the shown fields before
	 * it: on earlier steps and above it in its step. Hidden fields are not asked, so their answers
	 * are left out. Mirrors shownAnswers() in packages/form-core.
	 *
	 * @param array<int,array<int,array<string,mixed>>> $steps    Fields of each step, in order.
	 * @param array<string,mixed>                       $answers  Answers by field id.
	 * @param array<string,string>                      $variants Variants of A/B tests shown, by experiment id.
	 * @param string|null                               $today    YYYY-MM-DD; the site's today without it.
	 * @return array{fields:string[],answers:array<string,mixed>}
	 */
	public static function shown( array $steps, array $answers, array $variants = array(), ?string $today = null ): array {
		$context = array(
			'formats' => self::date_formats(
				array(
					'nodes' => array_map(
						static fn( array $fields ): array => array(
							'type'   => 'step',
							'fields' => $fields,
						),
						$steps
					),
				)
			),
		);
		if ( null !== $today ) {
			$context['today'] = $today;
		}
		$out = array(
			'fields'  => array(),
			'answers' => array(),
		);
		foreach ( $steps as $fields ) {
			foreach ( $fields as $field ) {
				if ( isset( $field['showWhen'] ) && ! self::holds( $field['showWhen'], $out['answers'], null, $variants, $context ) ) {
					continue;
				}
				$out['fields'][] = (string) $field['id'];
				if ( array_key_exists( $field['id'], $answers ) && null !== $answers[ $field['id'] ] ) {
					$out['answers'][ $field['id'] ] = $answers[ $field['id'] ];
				}
			}
		}
		return $out;
	}

	/**
	 * Whether an edge or a shown field compares a date with today, so the browser needs the site's
	 * time zone.
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public static function uses_today( array $document ): bool {
		$today = static function ( array $condition ) use ( &$today ): bool {
			foreach ( array( 'all', 'any' ) as $group ) {
				if ( isset( $condition[ $group ] ) ) {
					return array() !== array_filter( $condition[ $group ], $today );
				}
			}
			return in_array( $condition['op'] ?? '', array( 'dateBefore', 'dateAfter', 'dateOn' ), true ) && 'today' === ( $condition['value'] ?? '' );
		};
		foreach ( $document['edges'] ?? array() as $edge ) {
			if ( isset( $edge['when'] ) && $today( $edge['when'] ) ) {
				return true;
			}
		}
		foreach ( $document['nodes'] ?? array() as $node ) {
			foreach ( 'step' === ( $node['type'] ?? '' ) ? $node['fields'] : array() as $field ) {
				if ( isset( $field['showWhen'] ) && $today( $field['showWhen'] ) ) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * The format of each date field of the steps, by field id.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return array<string,string>
	 */
	public static function date_formats( array $document ): array {
		$formats = array();
		foreach ( $document['nodes'] ?? array() as $node ) {
			if ( 'step' !== ( $node['type'] ?? '' ) ) {
				continue;
			}
			foreach ( $node['fields'] ?? array() as $field ) {
				if ( 'date' === ( $field['type'] ?? '' ) ) {
					$formats[ $field['id'] ] = (string) ( $field['props']['format'] ?? 'dd.mm.yy' );
				}
			}
		}
		return $formats;
	}
}
