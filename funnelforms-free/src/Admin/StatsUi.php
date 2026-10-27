<?php
/**
 * Parts of the statistics pages: period choice, key figures, changes, bars and the week grid.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\StatsPeriod;
use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Shared by the page of all forms (StatsPage) and the page of one form (FormStatsPage). Every
 * method escapes what it prints; figures are counts and shares only.
 */
final class StatsUi {

	/**
	 * The period choice: 7, 30 and 90 days, and own days in a small form that sends them by GET.
	 *
	 * @param StatsPeriod          $period Current period.
	 * @param array<string,string> $keep   Query arguments to keep (page, form).
	 * @param int                  $now    Time.
	 */
	public static function periods( StatsPeriod $period, array $keep, int $now ): string {
		$base = add_query_arg( $keep, admin_url( 'admin.php' ) );
		$out  = '<div class="ffx-periods-wrap"><nav class="ffx-periods" aria-label="' . esc_attr__( 'Period', 'funnelforms-free' ) . '">';
		foreach ( StatsPeriod::PRESETS as $days ) {
			$url = StatsPeriod::DEFAULT_DAYS === $days ? $base : add_query_arg( 'period', $days, $base );
			/* translators: %d: number of days. */
			$out .= '<a href="' . esc_url( $url ) . '"' . ( $period->preset === $days ? ' aria-current="page"' : '' ) . '>' . esc_html( sprintf( __( '%d days', 'funnelforms-free' ), $days ) ) . '</a>';
		}
		$custom = null === $period->preset;
		$out   .= '</nav><details class="ffx-range"' . ( $custom ? ' data-current' : '' ) . '>';
		$out   .= '<summary' . ( $custom ? ' aria-current="true"' : '' ) . '>' . Ui::icon( 'calendar' ) . '<span>' . esc_html( $custom ? self::range( $period ) : __( 'Custom', 'funnelforms-free' ) ) . '</span></summary>';
		$out   .= '<form class="ffx-range__form" method="get" action="' . esc_url( admin_url( 'admin.php' ) ) . '">';
		foreach ( $keep as $name => $value ) {
			$out .= '<input type="hidden" name="' . esc_attr( $name ) . '" value="' . esc_attr( $value ) . '">';
		}
		$today = wp_date( 'Y-m-d', $now );
		$min   = StatsPeriod::shift( $today, 1 - StatsPeriod::MAX_DAYS );
		foreach ( array(
			'from' => array( __( 'First day', 'funnelforms-free' ), $period->from ),
			'to'   => array( __( 'Last day', 'funnelforms-free' ), $period->to ),
		) as $name => $field ) {
			$out .= '<label><span>' . esc_html( $field[0] ) . '</span><input type="date" name="' . esc_attr( $name ) . '" value="' . esc_attr( $field[1] ) . '" min="' . esc_attr( $min ) . '" max="' . esc_attr( $today ) . '" required></label>';
		}
		/* translators: %d: number of days. */
		$out .= '<p class="ffx-small ffx-muted">' . esc_html( sprintf( __( 'Up to %d days, compared with the same number of days before.', 'funnelforms-free' ), StatsPeriod::MAX_DAYS ) ) . '</p>';
		$out .= '<button type="submit" class="ffx-btn ffx-btn--primary">' . esc_html__( 'Show', 'funnelforms-free' ) . '</button>';
		return $out . '</form></details></div>';
	}

	/**
	 * A period as dates, e.g. "Sep 20 – Oct 19, 2026".
	 *
	 * @param StatsPeriod $period Period.
	 */
	public static function range( StatsPeriod $period ): string {
		$at = static fn( string $day ): int => (int) strtotime( $day . ' 12:00:00' );
		/* translators: short date with year, PHP date format, e.g. "j M Y" or "M j, Y". */
		$long = __( 'M j, Y', 'funnelforms-free' );
		if ( $period->from === $period->to ) {
			return wp_date( $long, $at( $period->from ) );
		}
		/* translators: short date below charts, PHP date format, e.g. "j M" or "M j". */
		$short = __( 'M j', 'funnelforms-free' );
		$first = wp_date( substr( $period->from, 0, 4 ) === substr( $period->to, 0, 4 ) ? $short : $long, $at( $period->from ) );
		/* translators: 1: first day, 2: last day of a period. */
		return sprintf( __( '%1$s – %2$s', 'funnelforms-free' ), $first, wp_date( $long, $at( $period->to ) ) );
	}

	/**
	 * The line below the heading: the period, what it is compared with, and the page's buttons.
	 *
	 * @param StatsPeriod $period  Period.
	 * @param string      $actions HTML of buttons (escaped by the caller).
	 */
	public static function range_bar( StatsPeriod $period, string $actions ): void {
		echo '<div class="ffx-statsbar ffx-section"><p class="ffx-statsbar__range">' . Ui::icon( 'calendar' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
		echo '<strong>' . esc_html( self::range( $period ) ) . '</strong>';
		/* translators: %s: the period before, e.g. "Aug 21 – Sep 19, 2026". */
		echo '<span>' . esc_html( sprintf( __( 'compared with %s', 'funnelforms-free' ), self::range( $period->previous() ) ) ) . '</span></p>';
		echo '<div class="ffx-statsbar__actions">' . $actions . '</div></div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped by the caller.
	}

	/**
	 * A key figure with its change.
	 *
	 * @param string $icon      Icon name.
	 * @param string $label     Label.
	 * @param string $value     Value.
	 * @param string $hint      Line below.
	 * @param string $direction up, down or empty; good or bad is the caller's choice of up and down.
	 */
	public static function kpi( string $icon, string $label, string $value, string $hint, string $direction ): void {
		?>
		<div class="ffx-card ffx-kpi">
			<span class="ffx-kpi__label"><span class="ffx-kpi__icon"><?php echo Ui::icon( $icon ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span><?php echo esc_html( $label ); ?></span>
			<span class="ffx-kpi__value"><?php echo esc_html( $value ); ?></span>
			<span class="ffx-kpi__hint<?php echo '' === $direction ? '' : ' is-' . esc_attr( $direction ); ?>"><?php echo esc_html( $hint ); ?></span>
		</div>
		<?php
	}

	/**
	 * Whether a figure went up or down.
	 *
	 * @param float|int|null $now    This period.
	 * @param float|int|null $before Period before.
	 */
	public static function direction( $now, $before ): string {
		if ( null === $now || null === $before || 0 == $before || $now == $before ) { // phpcs:ignore Universal.Operators.StrictComparisons -- int or float.
			return '';
		}
		return $now > $before ? 'up' : 'down';
	}

	/**
	 * Relative change against the period before, e.g. "+12 %"; empty without figures before.
	 *
	 * @param float|int|null $now    This period.
	 * @param float|int|null $before Period before.
	 */
	public static function change( $now, $before ): string {
		if ( null === $now || null === $before || 0 == $before ) { // phpcs:ignore Universal.Operators.StrictComparisons -- int or float.
			return '';
		}
		$change = (int) round( 100 * ( $now - $before ) / $before );
		return ( $change > 0 ? '+' : '' ) . number_format_i18n( $change ) . ' %';
	}

	/**
	 * Change of a share in percentage points, e.g. "+1.5 pts"; empty without both shares.
	 *
	 * @param float|null $now    This period.
	 * @param float|null $before Period before.
	 */
	public static function points( ?float $now, ?float $before ): string {
		if ( null === $now || null === $before ) {
			return '';
		}
		$change = round( 100 * ( $now - $before ), 1 );
		/* translators: %s: change in percentage points with sign, e.g. +1.5. */
		return sprintf( __( '%s pts', 'funnelforms-free' ), ( $change > 0 ? '+' : '' ) . number_format_i18n( $change, 1 ) );
	}

	/**
	 * A small coloured change, for tables and lists; nothing without figures before.
	 *
	 * @param string $text          Change from change() or points().
	 * @param string $direction     up or down.
	 * @param bool   $lower_better  A fall is good (drop-off, time).
	 * @param string $title         Tooltip.
	 */
	public static function delta( string $text, string $direction, bool $lower_better = false, string $title = '' ): string {
		if ( '' === $text ) {
			return '';
		}
		$good = '' === $direction ? '' : ( ( 'up' === $direction ) !== $lower_better ? ' is-good' : ' is-bad' );
		return '<span class="ffx-delta' . $good . '"' . ( '' === $title ? '' : ' title="' . esc_attr( $title ) . '"' ) . '>' . esc_html( $text ) . '</span>';
	}

	/**
	 * A share as percent with one decimal.
	 *
	 * @param float|null $share Share from 0 to 1.
	 */
	public static function percent( ?float $share ): string {
		return null === $share ? '–' : number_format_i18n( 100 * $share, 1 ) . ' %';
	}

	/**
	 * Seconds for people.
	 *
	 * @param int|float|null $seconds Seconds.
	 */
	public static function duration( $seconds ): string {
		if ( null === $seconds ) {
			return '–';
		}
		$seconds = max( 0, (int) round( (float) $seconds ) );
		if ( $seconds < 60 ) {
			/* translators: %d: seconds. */
			return sprintf( __( '%d s', 'funnelforms-free' ), $seconds );
		}
		if ( $seconds < 3600 ) {
			/* translators: 1: minutes, 2: seconds with two digits; a time like 1:05 min. */
			return sprintf( __( '%1$d:%2$s min', 'funnelforms-free' ), intdiv( $seconds, 60 ), sprintf( '%02d', $seconds % 60 ) );
		}
		/* translators: 1: hours, 2: minutes with two digits; a time like 1:05 h. */
		return sprintf( __( '%1$d:%2$s h', 'funnelforms-free' ), intdiv( $seconds, 3600 ), sprintf( '%02d', intdiv( $seconds % 3600, 60 ) ) );
	}

	/**
	 * A round time span, short: "30 s", "5 min", "2 h".
	 *
	 * @param int $seconds Seconds.
	 */
	public static function span( int $seconds ): string {
		if ( $seconds < 60 ) {
			/* translators: %d: seconds. */
			return sprintf( __( '%d s', 'funnelforms-free' ), $seconds );
		}
		if ( $seconds < 3600 ) {
			/* translators: %s: minutes. */
			return sprintf( __( '%s min', 'funnelforms-free' ), self::number( $seconds / 60 ) );
		}
		/* translators: %s: hours. */
		return sprintf( __( '%s h', 'funnelforms-free' ), self::number( $seconds / 3600 ) );
	}

	/**
	 * A short number for axis labels: 15k, 1.2M. With $scale the unit follows the larger of both,
	 * so the labels of one axis share it.
	 *
	 * @param float $value Value.
	 * @param float $scale Largest value of the axis.
	 */
	public static function compact( float $value, float $scale = 0.0 ): string {
		$size = max( abs( $value ), abs( $scale ) );
		if ( $size >= 1000000 ) {
			/* translators: %s: number of millions, e.g. 1.5 for 1,500,000. */
			return sprintf( __( '%sM', 'funnelforms-free' ), self::number( $value / 1000000 ) );
		}
		if ( $size >= 10000 ) {
			/* translators: %s: number of thousands, e.g. 15 for 15,000. */
			return sprintf( __( '%sk', 'funnelforms-free' ), self::number( $value / 1000, $size >= 100000 ? 0 : 1 ) );
		}
		return self::number( $value );
	}

	/**
	 * Columns of a histogram from a spread (FormAnalytics): one label per class, in one unit.
	 *
	 * @param list<array{from:float,to:float,n:int}> $spread Classes.
	 * @return list<array{label:string,n:int}>
	 */
	public static function spread( array $spread ): array {
		$scale = array() === $spread ? 0.0 : max( array_map( 'abs', array_merge( array_column( $spread, 'from' ), array_column( $spread, 'to' ) ) ) );
		return array_map(
			static fn( array $c ): array => array(
				'label' => $c['from'] === $c['to'] ? self::compact( $c['from'], $scale ) : self::compact( $c['from'], $scale ) . '–' . self::compact( $c['to'], $scale ),
				'n'     => $c['n'],
			),
			$spread
		);
	}

	/**
	 * A number for people with up to $decimals decimals, trailing zeros cut.
	 *
	 * @param float|int $value    Value.
	 * @param int       $decimals Most decimals.
	 */
	public static function number( $value, int $decimals = 1 ): string {
		$size     = abs( (float) $value );
		$decimals = $size >= 1000 ? 0 : ( $size >= 100 ? min( 1, $decimals ) : $decimals );
		$value    = round( (float) $value, $decimals );
		return number_format_i18n( $value, floor( $value ) === $value ? 0 : $decimals );
	}

	/**
	 * Horizontal bars with a label, a value and a line below.
	 *
	 * @param list<array{label:string,value:string,share:float,note?:string,warn?:bool,html?:string}> $rows Rows; html is escaped by the caller.
	 * @param string                                                                                  $extra Extra class.
	 */
	public static function bars( array $rows, string $extra = '' ): void {
		echo '<ul class="ffx-bars' . ( '' === $extra ? '' : ' ' . esc_attr( $extra ) ) . '">';
		foreach ( $rows as $row ) {
			printf(
				'<li><span class="ffx-bars__label">%1$s</span><span class="ffx-bars__value">%2$s%3$s</span><span class="ffx-funnel__bar%4$s"><span style="width:%5$s%%"></span></span>%6$s</li>',
				esc_html( $row['label'] ),
				esc_html( $row['value'] ),
				$row['html'] ?? '', // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped by the caller.
				empty( $row['warn'] ) ? '' : ' ffx-funnel__bar--warn',
				esc_attr( number_format( 100 * max( 0.0, min( 1.0, $row['share'] ) ), 1, '.', '' ) ),
				isset( $row['note'] ) && '' !== $row['note'] ? '<span class="ffx-bars__note">' . esc_html( $row['note'] ) . '</span>' : ''
			);
		}
		echo '</ul>';
	}

	/**
	 * Upright bars of a distribution, with the label of each below.
	 *
	 * @param list<array{label:string,n:int}> $columns Columns.
	 * @param string                          $label   What the chart shows, for screen readers.
	 */
	public static function histogram( array $columns, string $label ): void {
		$max = max( 1, ...array_column( $columns, 'n' ) );
		echo '<div class="ffx-histo" role="img" aria-label="' . esc_attr( $label ) . '" style="--ffx-columns:' . (int) count( $columns ) . '">';
		foreach ( $columns as $column ) {
			/* translators: 1: class of values, 2: count. */
			$title = sprintf( __( '%1$s: %2$s', 'funnelforms-free' ), $column['label'], number_format_i18n( $column['n'] ) );
			printf(
				'<span class="ffx-histo__col" title="%1$s"><span class="ffx-histo__n">%2$s</span><span class="ffx-histo__bar%3$s" style="height:%4$s%%"></span><span class="ffx-histo__label">%5$s</span></span>',
				esc_attr( $title ),
				esc_html( number_format_i18n( $column['n'] ) ),
				0 === $column['n'] ? ' is-zero' : '',
				esc_attr( number_format( 100 * $column['n'] / $max, 1, '.', '' ) ),
				esc_html( $column['label'] )
			);
		}
		echo '</div>';
	}

	/**
	 * Entries per weekday and hour as a grid; the week starts on the site's first day.
	 *
	 * @param array<int,array<int,int>> $hours Weekday (0 Sunday) => hour => count.
	 */
	public static function heatmap( array $hours ): void {
		global $wp_locale;
		$total = 0;
		$max   = 0;
		foreach ( $hours as $row ) {
			foreach ( $row as $n ) {
				$total += $n;
				$max    = max( $max, $n );
			}
		}
		if ( 0 === $total ) {
			echo '<p class="ffx-muted">' . esc_html__( 'No entries in this period yet.', 'funnelforms-free' ) . '</p>';
			return;
		}
		$first = (int) get_option( 'start_of_week', 1 );
		$days  = array();
		for ( $i = 0; $i < 7; $i++ ) {
			$days[] = ( $first + $i ) % 7;
		}
		$by_day  = array_map( 'array_sum', $hours );
		$by_hour = array();
		for ( $h = 0; $h < 24; $h++ ) {
			$by_hour[ $h ] = array_sum( array_column( $hours, $h ) );
		}
		$top_day  = (int) array_search( max( $by_day ), $by_day, true );
		$top_hour = (int) array_search( max( $by_hour ), $by_hour, true );
		echo '<p class="ffx-heat__summary">';
		/* translators: 1: weekday, 2: hour from, 3: hour to (both 0 to 24). */
		echo esc_html( sprintf( __( 'Most entries come in on %1$s and between %2$d and %3$d o’clock.', 'funnelforms-free' ), $wp_locale->get_weekday( $top_day ), $top_hour, $top_hour + 1 ) );
		echo '</p><div class="ffx-table-wrap"><table class="ffx-heat"><caption class="screen-reader-text">' . esc_html__( 'Entries per weekday and hour', 'funnelforms-free' ) . '</caption><thead><tr><td></td>';
		for ( $h = 0; $h < 24; $h++ ) {
			echo '<th scope="col"><span' . ( 0 === $h % 3 ? '' : ' class="screen-reader-text"' ) . '>' . esc_html( (string) $h ) . '</span></th>';
		}
		echo '<th scope="col" class="ffx-heat__sum">' . esc_html__( 'Total', 'funnelforms-free' ) . '</th></tr></thead><tbody>';
		foreach ( $days as $day ) {
			echo '<tr><th scope="row"><abbr title="' . esc_attr( $wp_locale->get_weekday( $day ) ) . '">' . esc_html( $wp_locale->get_weekday_abbrev( $wp_locale->get_weekday( $day ) ) ) . '</abbr></th>';
			for ( $h = 0; $h < 24; $h++ ) {
				$n     = $hours[ $day ][ $h ] ?? 0;
				$level = 0 === $n ? 0 : (int) ceil( 4 * $n / $max );
				/* translators: 1: weekday, 2: hour from, 3: hour to, 4: entries. */
				$title = sprintf( __( '%1$s, %2$d–%3$d o’clock: %4$s entries', 'funnelforms-free' ), $wp_locale->get_weekday( $day ), $h, $h + 1, number_format_i18n( $n ) );
				echo '<td class="is-l' . (int) $level . '" title="' . esc_attr( $title ) . '"><span class="screen-reader-text">' . esc_html( number_format_i18n( $n ) ) . '</span></td>';
			}
			echo '<td class="ffx-heat__sum">' . esc_html( number_format_i18n( $by_day[ $day ] ) ) . '</td></tr>';
		}
		echo '</tbody></table></div>';
		echo '<div class="ffx-heat__legend" aria-hidden="true"><span>' . esc_html__( 'Fewer', 'funnelforms-free' ) . '</span>';
		for ( $l = 0; $l <= 4; $l++ ) {
			echo '<i class="is-l' . (int) $l . '"></i>';
		}
		echo '<span>' . esc_html__( 'More', 'funnelforms-free' ) . '</span></div>';
	}

	/**
	 * What the statistics record, in a few lines (also the answer to "is this allowed?").
	 */
	public static function privacy(): void {
		?>
		<details class="ffx-card ffx-section ffx-privacy">
			<summary><span class="ffx-kpi__icon"><?php echo Ui::icon( 'shield' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span><span><?php esc_html_e( 'What the statistics record', 'funnelforms-free' ); ?></span></summary>
			<ul>
				<li><?php esc_html_e( 'Per page view: that the form was seen and started, which steps were shown and the step before each, which fields stopped the visitor because their check failed, which options of choice questions were picked (their ids, never typed text) and the variant of an A/B test.', 'funnelforms-free' ); ?></li>
				<li><?php esc_html_e( 'Where the visitor came from: the domain of a search engine, social network or website (never the page or its query) or utm_source, utm_medium and utm_campaign of the page address. Values that look like an e-mail address are dropped.', 'funnelforms-free' ); ?></li>
				<li><?php esc_html_e( 'A page view is known only by a random number the browser forgets when the page closes; the plugin stores a keyed hash of it. No cookies, no IP address, no user agent, no external service.', 'funnelforms-free' ); ?></li>
				<?php if ( Edition::is_pro() ) : ?>
					<li><?php esc_html_e( 'Only where the visitor allowed statistics (EU mode: a yes in the consent tool; global mode: no objection and no Global Privacy Control): the fields filled in, the device class from the window width, and a random visitor id the browser keeps in local storage (ffx_vid) for 180 days, stored here only as a keyed hash. The figures say how many page views they rest on.', 'funnelforms-free' ); ?></li>
				<?php endif; ?>
				<li><?php esc_html_e( 'Times, devices, numbers and calculation results come from the entries themselves and are shown only as counts and averages of at least three entries. Events are deleted after 400 days.', 'funnelforms-free' ); ?></li>
			</ul>
		</details>
		<?php
	}
}
