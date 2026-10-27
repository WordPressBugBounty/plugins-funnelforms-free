<?php
/**
 * Translates 3.x calculation formulas into the expression tree of form schema v1.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Domain\Form\Calculator;
use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Parser that mirrors the evaluator bundled with 3.x (vendor/matex/Evaluator.php) exactly, so the
 * migrated expression computes the same numbers:
 *
 *  - spaces are removed and the formula is lowercased before parsing;
 *  - "*", "/", "^" and "%" share one precedence level and are evaluated left to right
 *    (so 2*3^2 = 36, unlike ordinary maths);
 *  - "+" and "-" form the lower level, also left to right; any run of leading signs is a unary sign;
 *  - parsing stops silently at the first character it cannot use ("2,5*3" evaluates to 2), and the
 *    unused rest is reported;
 *  - [123] refers to the answer of question post 123 (substituted as text in 3.x).
 *
 * Output nodes: {"num": float}, {"var": key}, {"neg": node}, {"op": "+|-|*|/|^|%", "args": [a, b]}.
 * The tree makes the evaluation order explicit, so the new evaluator needs no precedence rules.
 */
final class LegacyFormula {

	/**
	 * Normalized formula text.
	 *
	 * @var string
	 */
	private string $text = '';

	/**
	 * Parser position.
	 *
	 * @var int
	 */
	private int $pos = 0;

	/**
	 * Question post IDs referenced by the formula.
	 *
	 * @var int[]
	 */
	private array $refs = array();

	/**
	 * Translates a formula.
	 *
	 * @param string   $formula 3.x formula, e.g. "([651] + [652]) * 1.19".
	 * @param callable $key_for Maps a question post ID to the variable key in the new document.
	 * @return array{ok:bool, expression?:array<string,mixed>, ignored?:string, refs?:int[], error?:string}
	 */
	public function translate( string $formula, callable $key_for ): array {
		if ( substr_count( $formula, '(' ) !== substr_count( $formula, ')' ) ) {
			return array(
				'ok'    => false,
				'error' => 'unmatched_brackets',
			);
		}
		if ( str_contains( $formula, '"' ) ) {
			return array(
				'ok'    => false,
				'error' => 'string_literals_not_supported',
			);
		}

		$this->text = str_replace( ' ', '', strtolower( $formula ) );
		$this->pos  = 0;
		$this->refs = array();

		try {
			$tree = $this->calculate( $key_for );
		} catch ( \UnexpectedValueException $e ) {
			return array(
				'ok'    => false,
				'error' => $e->getMessage(),
			);
		}

		return array(
			'ok'         => true,
			'expression' => $tree,
			'ignored'    => (string) substr( $this->text, $this->pos ),
			'refs'       => array_values( array_unique( $this->refs ) ),
		);
	}

	/**
	 * Lower precedence level: + and -.
	 *
	 * @param callable $key_for Key mapper.
	 * @return array<string,mixed>
	 */
	private function calculate( callable $key_for ): array {
		$value = $this->sub_term( $key_for );
		while ( in_array( $this->peek(), array( '+', '-' ), true ) ) {
			$op = $this->peek();
			++$this->pos;
			$value = array(
				'op'   => $op,
				'args' => array( $value, $this->sub_term( $key_for ) ),
			);
		}
		return $value;
	}

	/**
	 * Higher precedence level: * / ^ %, left to right.
	 *
	 * @param callable $key_for Key mapper.
	 * @return array<string,mixed>
	 */
	private function sub_term( callable $key_for ): array {
		$value = $this->term( $key_for );
		while ( in_array( $this->peek(), array( '*', '/', '^', '%' ), true ) ) {
			$op = $this->peek();
			++$this->pos;
			$value = array(
				'op'   => $op,
				'args' => array( $value, $this->term( $key_for ) ),
			);
		}
		return $value;
	}

	/**
	 * Signed number, variable or bracketed expression.
	 *
	 * @param callable $key_for Key mapper.
	 * @return array<string,mixed>
	 * @throws \UnexpectedValueException On syntax errors that also fail in 3.x.
	 */
	private function term( callable $key_for ): array {
		$negative = false;
		while ( in_array( $this->peek(), array( '-', '+' ), true ) ) {
			if ( '-' === $this->peek() ) {
				$negative = ! $negative;
			}
			++$this->pos;
		}

		if ( '(' === $this->peek() ) {
			++$this->pos;
			$value = $this->calculate( $key_for );
			if ( ')' !== $this->peek() ) {
				throw new \UnexpectedValueException( 'syntax_error' );
			}
			++$this->pos;
			if ( ! in_array( $this->peek(), array( '', '+', '-', '/', '*', '^', '%', ')' ), true ) ) {
				throw new \UnexpectedValueException( 'syntax_error' );
			}
			return $negative ? array( 'neg' => $value ) : $value;
		}

		if ( 1 === preg_match( '/\[(\d+)\]/A', $this->text, $m, 0, $this->pos ) ) {
			$this->pos   += strlen( $m[0] );
			$this->refs[] = (int) $m[1];
			$value        = array( 'var' => (string) $key_for( (int) $m[1] ) );
			return $negative ? array( 'neg' => $value ) : $value;
		}

		if ( 1 !== preg_match( '/[a-z0-9._]+/A', $this->text, $m, 0, $this->pos ) ) {
			throw new \UnexpectedValueException( 'syntax_error' );
		}
		$this->pos += strlen( $m[0] );
		if ( '(' === $this->peek() ) {
			throw new \UnexpectedValueException( 'unknown_function' );
		}
		if ( ! is_numeric( $m[0] ) ) {
			throw new \UnexpectedValueException( 'unknown_variable' );
		}
		$value = array( 'num' => (float) $m[0] );
		return $negative ? array( 'neg' => $value ) : $value;
	}

	/**
	 * Current character or ''.
	 */
	private function peek(): string {
		return $this->text[ $this->pos ] ?? '';
	}

	/**
	 * Evaluates a translated expression (used by the migration checks and the tests).
	 *
	 * @param array<string,mixed>     $node   Expression node.
	 * @param array<string,float|int> $values Variable values; missing ones count as 0 like in 3.x.
	 * @return float
	 * @throws \RuntimeException In Funnelforms Free, which has no calculations; Calculator throws
	 *                           \DivisionByZeroError on division by zero (3.x fails as well).
	 */
	public static function evaluate( array $node, array $values ): float {
		$calculator = Edition::pro( Calculator::class );
		if ( null === $calculator ) {
			throw new \RuntimeException( 'Calculations are part of Funnelforms Pro.' );
		}
		return $calculator::evaluate( $node, $values );
	}
}
