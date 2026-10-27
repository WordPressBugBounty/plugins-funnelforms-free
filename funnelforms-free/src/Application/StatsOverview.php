<?php
/**
 * Figures of all forms together, for the statistics page and the overview.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Domain\Form\Document;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\EntryFigures;
use Funnelforms\Infrastructure\Repository\EventRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Views and starts come from the events of forms on the new renderer (FormStats); entries are the
 * complete entries of every form, also those of forms still on Funnelforms 3. The conversion rate
 * counts only forms that report views, so entries of 3.x forms do not inflate it.
 *
 * In Funnelforms Pro the report also holds sources and channels (SourceFigures); Funnelforms Free
 * records them as well, but leaves them out of the report.
 */
final class StatsOverview {

	/** Periods the page offers, in days. */
	public const PERIODS = StatsPeriod::PRESETS;

	/** Forms with the most views whose steps are searched for the biggest drop-offs. */
	public const LEAK_FORMS = 8;

	/** Steps reached by fewer page views are left out of the drop-offs; too few to tell. */
	public const MIN_REACHED = 10;

	/**
	 * Reports of this request, by period.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private static array $cache = array();

	/**
	 * The figures of the last $days days (today included) and of the days before.
	 *
	 * @param int $days Length of the period in days.
	 * @param int $now  Time.
	 * @return array<string,mixed>
	 */
	public static function report( int $days, int $now ): array {
		return self::for_period( StatsPeriod::last( $days, $now ) );
	}

	/**
	 * Forgets the reports of this request (tests).
	 */
	public static function flush(): void {
		self::$cache = array();
	}

	/**
	 * The figures of a period and of the period of the same length before it.
	 *
	 * @param StatsPeriod $period Period.
	 * @return array<string,mixed>
	 */
	public static function for_period( StatsPeriod $period ): array {
		global $wpdb;
		$key = $period->from . '|' . $period->to;
		if ( isset( self::$cache[ $key ] ) ) {
			return self::$cache[ $key ];
		}
		$previous = $period->previous();
		$from     = $period->from;
		$start    = $previous->start();
		$middle   = $period->start();
		$end      = $period->end();
		$offset   = $period->offset();
		$figures  = new EntryFigures();
		$events   = new EventRepository();

		$counts  = $events->daily_all( $start, $end, $offset );
		$entries = $figures->daily( null, $start, $end, $offset );
		$forms   = (array) $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- this plugin's table, fresh on purpose.
			$wpdb->prepare( 'SELECT id, title, status, renderer, current_revision_id FROM %i WHERE status <> %s', Schema::table( 'forms' ), 'trashed' ),
			ARRAY_A
		);

		$daily = array();
		$index = array();
		$dates = $period->dates();
		foreach ( $dates as $day ) {
			$daily[ $day ] = array(
				'date'     => $day,
				'views'    => 0,
				'entries'  => 0,
				'previous' => 0,
			);
		}
		foreach ( $previous->dates() as $i => $day ) {
			$index[ $day ] = $dates[ $i ];
		}
		$blank = array(
			'views'          => 0,
			'starts'         => 0,
			'entries'        => 0,
			'views_before'   => 0,
			'starts_before'  => 0,
			'entries_before' => 0,
		);
		$per   = array();
		foreach ( $counts as $row ) {
			$id                      = (int) $row['form_id'];
			$per[ $id ]              = $per[ $id ] ?? $blank;
			$key_now                 = 'view' === $row['event'] ? 'views' : 'starts';
			$now_period              = (string) $row['day'] >= $from;
			$key_now                .= $now_period ? '' : '_before';
			$per[ $id ][ $key_now ] += (int) $row['n'];
			if ( $now_period && 'views' === $key_now && isset( $daily[ $row['day'] ] ) ) {
				$daily[ $row['day'] ]['views'] += (int) $row['n'];
			}
		}
		$spark = array();
		foreach ( $entries as $row ) {
			$id         = (int) $row['form_id'];
			$per[ $id ] = $per[ $id ] ?? $blank;
			if ( (string) $row['day'] >= $from ) {
				$per[ $id ]['entries'] += (int) $row['n'];
				if ( isset( $daily[ $row['day'] ] ) ) {
					$daily[ $row['day'] ]['entries'] += (int) $row['n'];
					$spark[ $id ][ $row['day'] ]      = (int) $row['n'];
				}
			} else {
				$per[ $id ]['entries_before'] += (int) $row['n'];
				if ( isset( $index[ $row['day'] ] ) ) {
					$daily[ $index[ $row['day'] ] ]['previous'] += (int) $row['n'];
				}
			}
		}

		$rows   = array();
		$legacy = 0;
		foreach ( $forms as $form ) {
			$id     = (int) $form['id'];
			$counts = $per[ $id ] ?? $blank;
			$v5     = FormRepository::RENDERER_V5 === $form['renderer'];
			if ( ! $v5 && 'published' === $form['status'] ) {
				++$legacy;
			}
			$series = array();
			foreach ( array_keys( $daily ) as $day ) {
				$series[] = $spark[ $id ][ $day ] ?? 0;
			}
			$rows[] = array(
				'id'          => $id,
				'title'       => (string) $form['title'],
				'status'      => (string) $form['status'],
				'v5'          => $v5,
				'revision'    => null === $form['current_revision_id'] ? null : (int) $form['current_revision_id'],
				'rate'        => $counts['views'] > 0 ? min( 1.0, $counts['entries'] / $counts['views'] ) : null,
				'rate_before' => $counts['views_before'] > 0 ? min( 1.0, $counts['entries_before'] / $counts['views_before'] ) : null,
				'series'      => $series,
			) + $counts;
		}
		usort(
			$rows,
			static fn( array $a, array $b ): int => array( $b['entries'], $b['views'], $a['title'] ) <=> array( $a['entries'], $a['views'], $b['title'] )
		);

		$sum    = static function ( string $key, bool $tracked = false ) use ( $rows ): int {
			$total = 0;
			foreach ( $rows as $row ) {
				if ( ! $tracked || $row[ str_ends_with( $key, '_before' ) ? 'views_before' : 'views' ] > 0 ) {
					$total += (int) $row[ $key ];
				}
			}
			return $total;
		};
		$totals = array(
			'views'   => $sum( 'views' ),
			'starts'  => $sum( 'starts' ),
			'entries' => $sum( 'entries' ),
		);
		$before = array(
			'views'   => $sum( 'views_before' ),
			'starts'  => $sum( 'starts_before' ),
			'entries' => $sum( 'entries_before' ),
		);
		// Entries of forms that are gone still count in the totals.
		$ids = array_column( $rows, 'id' );
		foreach ( $per as $id => $counts ) {
			if ( ! in_array( $id, $ids, true ) ) {
				$totals['entries'] += $counts['entries'];
				$before['entries'] += $counts['entries_before'];
			}
		}
		$totals['tracked'] = min( $totals['views'], $sum( 'entries', true ) );
		$totals['rate']    = $totals['views'] > 0 ? $totals['tracked'] / $totals['views'] : null;
		$before['tracked'] = min( $before['views'], $sum( 'entries_before', true ) );
		$before['rate']    = $before['views'] > 0 ? $before['tracked'] / $before['views'] : null;

		$report  = array(
			'days'           => $period->days,
			'from'           => $period->from,
			'to'             => $period->to,
			'previous'       => array(
				'from' => $previous->from,
				'to'   => $previous->to,
			),
			'totals'         => $totals,
			'before'         => $before,
			'daily'          => array_values( $daily ),
			'forms'          => $rows,
			'devices'        => $figures->devices( null, $middle, $end ),
			'devices_before' => $figures->devices( null, $start, $middle ),
			'hours'          => $figures->hours( null, $middle, $end, $offset ),
			'leaks'          => self::leaks( $rows, $middle, $end ),
			'legacy'         => $legacy,
		);
		$sources = Edition::pro( SourceFigures::class );
		if ( null !== $sources ) {
			$report += $sources::overview( $start, $middle, $end, $totals['views'], $before['views'] );
		}

		self::$cache[ $key ] = $report;
		return $report;
	}

	/**
	 * The steps where most visitors left, over the forms with the most views.
	 *
	 * @param array<int,array<string,mixed>> $rows  Forms with their figures.
	 * @param string                         $start Start (UTC, inclusive).
	 * @param string                         $end   End (UTC, exclusive).
	 * @return list<array{form:int,form_title:string,step:string,title:string,reached:int,left:int,rate:float}>
	 */
	private static function leaks( array $rows, string $start, string $end ): array {
		$candidates = array_filter( $rows, static fn( array $row ): bool => $row['v5'] && null !== $row['revision'] && $row['views'] > 0 );
		usort( $candidates, static fn( array $a, array $b ): int => $b['views'] <=> $a['views'] );
		$events = new EventRepository();
		$forms  = new FormRepository();
		$out    = array();
		foreach ( array_slice( $candidates, 0, self::LEAK_FORMS ) as $row ) {
			$document = $forms->document( (int) $row['revision'] );
			if ( null === $document ) {
				continue;
			}
			foreach ( FormStats::steps( new Document( $document ), $events->steps( (int) $row['id'], $start, $end ) ) as $step ) {
				if ( $step['reached'] < self::MIN_REACHED || $step['left'] < 1 ) {
					continue;
				}
				$out[] = array(
					'form'       => (int) $row['id'],
					'form_title' => (string) $row['title'],
					'step'       => (string) $step['id'],
					'title'      => (string) $step['title'],
					'reached'    => (int) $step['reached'],
					'left'       => (int) $step['left'],
					'rate'       => $step['left'] / $step['reached'],
				);
			}
		}
		usort( $out, static fn( array $a, array $b ): int => array( $b['left'], $b['rate'] ) <=> array( $a['left'], $a['rate'] ) );
		return array_slice( $out, 0, 5 );
	}
}
