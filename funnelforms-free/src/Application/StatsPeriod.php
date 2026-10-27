<?php
/**
 * A period of the statistics: days of the site's time zone, and the period before it.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

defined( 'ABSPATH' ) || exit;

/**
 * The last 7, 30 or 90 days up to today, or any days the user picks (at most MAX_DAYS, the time
 * events are kept). Every figure is compared with the period of the same length just before.
 */
final class StatsPeriod {

	/** Periods offered with one click, in days. */
	public const PRESETS = array( 7, 30, 90 );

	/** The period shown when none is asked for. */
	public const DEFAULT_DAYS = 30;

	/** Longest period: events are kept no longer. */
	public const MAX_DAYS = FormStats::KEEP_DAYS;

	/**
	 * First day, Y-m-d in the site's time zone.
	 *
	 * @var string
	 */
	public string $from;

	/**
	 * Last day, Y-m-d in the site's time zone.
	 *
	 * @var string
	 */
	public string $to;

	/**
	 * Number of days.
	 *
	 * @var int
	 */
	public int $days;

	/**
	 * The preset in days when the period is one (ends today), else null.
	 *
	 * @var int|null
	 */
	public ?int $preset;

	/**
	 * A period of whole days.
	 *
	 * @param string   $from   First day (Y-m-d).
	 * @param string   $to     Last day (Y-m-d).
	 * @param int|null $preset Preset it stands for.
	 */
	private function __construct( string $from, string $to, ?int $preset ) {
		$this->from   = $from;
		$this->to     = $to;
		$this->days   = self::between( $from, $to ) + 1;
		$this->preset = $preset;
	}

	/**
	 * The last $days days, today included.
	 *
	 * @param int $days Days.
	 * @param int $now  Time.
	 */
	public static function last( int $days, int $now ): self {
		$days = max( 1, min( self::MAX_DAYS, $days ) );
		$to   = wp_date( 'Y-m-d', $now );
		return new self( self::shift( $to, 1 - $days ), $to, in_array( $days, self::PRESETS, true ) ? $days : null );
	}

	/**
	 * Days the user picked; null when they are no valid period (wrong format, the wrong way round,
	 * longer than MAX_DAYS or in the future).
	 *
	 * @param string $from First day (Y-m-d).
	 * @param string $to   Last day (Y-m-d).
	 * @param int    $now  Time.
	 */
	public static function custom( string $from, string $to, int $now ): ?self {
		if ( ! self::is_day( $from ) || ! self::is_day( $to ) || $from > $to || $to > wp_date( 'Y-m-d', $now ) || self::between( $from, $to ) >= self::MAX_DAYS ) {
			return null;
		}
		return new self( $from, $to, null );
	}

	/**
	 * The period a request asks for: period=7|30|90, or from and to; else the default.
	 *
	 * @param array<string,mixed> $query Query arguments.
	 * @param int                 $now   Time.
	 */
	public static function from_query( array $query, int $now ): self {
		$from = is_string( $query['from'] ?? null ) ? sanitize_text_field( $query['from'] ) : '';
		$to   = is_string( $query['to'] ?? null ) ? sanitize_text_field( $query['to'] ) : '';
		if ( '' !== $from && '' !== $to ) {
			$custom = self::custom( $from, $to, $now );
			if ( null !== $custom ) {
				return $custom;
			}
		}
		$days = is_scalar( $query['period'] ?? null ) ? absint( $query['period'] ) : 0;
		return self::last( in_array( $days, self::PRESETS, true ) ? $days : self::DEFAULT_DAYS, $now );
	}

	/**
	 * The period of the same length just before.
	 */
	public function previous(): self {
		return new self( self::shift( $this->from, -$this->days ), self::shift( $this->from, -1 ), null );
	}

	/**
	 * Query arguments that ask for this period again (none for the default).
	 *
	 * @return array<string,string|int>
	 */
	public function query(): array {
		if ( null !== $this->preset ) {
			return self::DEFAULT_DAYS === $this->preset ? array() : array( 'period' => $this->preset );
		}
		return array(
			'from' => $this->from,
			'to'   => $this->to,
		);
	}

	/**
	 * Start in UTC (Y-m-d H:i:s, inclusive).
	 */
	public function start(): string {
		return get_gmt_from_date( $this->from . ' 00:00:00' );
	}

	/**
	 * End in UTC (Y-m-d H:i:s, exclusive).
	 */
	public function end(): string {
		return get_gmt_from_date( self::shift( $this->to, 1 ) . ' 00:00:00' );
	}

	/**
	 * Seconds to add to UTC times for the site's days (the offset on the last day).
	 */
	public function offset(): int {
		return (int) wp_timezone()->getOffset( new \DateTimeImmutable( $this->to . ' 12:00:00', wp_timezone() ) );
	}

	/**
	 * Every day of the period, Y-m-d.
	 *
	 * @return list<string>
	 */
	public function dates(): array {
		$out = array();
		for ( $i = 0; $i < $this->days; $i++ ) {
			$out[] = self::shift( $this->from, $i );
		}
		return $out;
	}

	/**
	 * A day some days later (or earlier).
	 *
	 * @param string $day  Day (Y-m-d).
	 * @param int    $days Days to add.
	 */
	public static function shift( string $day, int $days ): string {
		return gmdate( 'Y-m-d', (int) strtotime( $day . ' 12:00:00 UTC' ) + $days * DAY_IN_SECONDS );
	}

	/**
	 * Days from one day to another.
	 *
	 * @param string $from Day (Y-m-d).
	 * @param string $to   Day (Y-m-d).
	 */
	private static function between( string $from, string $to ): int {
		return (int) round( ( strtotime( $to . ' 12:00:00 UTC' ) - strtotime( $from . ' 12:00:00 UTC' ) ) / DAY_IN_SECONDS );
	}

	/**
	 * Whether a text is a real day (Y-m-d).
	 *
	 * @param string $day Text.
	 */
	private static function is_day( string $day ): bool {
		if ( 1 !== preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $day, $m ) ) {
			return false;
		}
		return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) && (int) $m[1] >= 2000;
	}
}
