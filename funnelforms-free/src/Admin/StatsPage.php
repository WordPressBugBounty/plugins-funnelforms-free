<?php
/**
 * Statistics of all forms: views, entries, conversion, sources, times and where visitors leave.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\SetupFlow;
use Funnelforms\Application\StatsOverview;
use Funnelforms\Application\StatsPeriod;
use Funnelforms\Edition\Edition;
use Funnelforms\Edition\FreeSite;
use Funnelforms\Http\FileDownload;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * One page for the figures of every form together, for 7, 30 or 90 days or own days, each figure
 * compared with the period before. With ?form=<id> the page shows the analytics of that form
 * (FormStatsPage); the table here leads there. The figures can be downloaded as CSV (StatsExport).
 *
 * The analytics of one form, sources and channels (StatsSources) and the export are Funnelforms
 * Pro. Funnelforms Free names them in their place (FreeSite::hint()); with ?form=<id> it shows the
 * figures of that form (views, starts, entries, where visitors leave) on this page, not in the
 * editor, through the figures screen of the admin app.
 */
final class StatsPage {

	public const SLUG = 'funnelforms-stats';

	/** Action of the CSV download (admin-post.php, StatsExport). */
	public const EXPORT = 'funnelforms_export_stats';

	/**
	 * Hook suffix of the page.
	 *
	 * @var string|null
	 */
	private static ?string $hook = null;

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ), 20 );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
		$export = Edition::pro( StatsExport::class );
		if ( null !== $export ) {
			$export::register();
		} else {
			add_action( 'admin_post_' . self::EXPORT, array( self::class, 'export_refused' ) );
		}
	}

	/**
	 * Funnelforms Free: the download of the statistics is Pro.
	 */
	public static function export_refused(): void {
		wp_die( esc_html__( 'The export of the statistics comes with Funnelforms Pro.', 'funnelforms-free' ), 403 );
	}

	/**
	 * Adds the page below Funnelforms; who may see entries may see their figures.
	 */
	public static function menu(): void {
		$title = __( 'Statistics', 'funnelforms-free' );
		$hook  = add_submenu_page( Menu::SLUG, $title, $title, FileDownload::capability(), self::SLUG, array( self::class, 'render' ), Menu::POSITIONS['stats'] );
		Ui::screen( $hook );
		self::$hook = false === $hook ? null : $hook;
	}

	/**
	 * Funnelforms Free: loads the figures screen of the admin app for the page of one form.
	 *
	 * @param string $hook Hook suffix of the current admin page.
	 */
	public static function enqueue( string $hook ): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a view, nothing changes.
		if ( null === self::$hook || $hook !== self::$hook || ! isset( $_GET['form'] ) || self::per_form() || ! BuilderPage::built() ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a view, nothing changes.
		BuilderPage::load_app( self::form_config( absint( $_GET['form'] ) ) );
	}

	/**
	 * What the figures screen of one form gets (Funnelforms Free).
	 *
	 * @param int $form_id Form ID.
	 * @return array<string, mixed>
	 */
	public static function form_config( int $form_id ): array {
		$form = ( new FormRepository() )->by_id( $form_id );
		return array(
			'screen'     => 'form-stats',
			'root'       => esc_url_raw( rest_url() ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
			'userLocale' => get_user_locale(),
			'formId'     => $form_id,
			'published'  => null !== $form && null !== $form['current_revision_id'] && 'trashed' !== $form['status'],
			// "Show on the canvas" opens the editor with the figures on its steps.
			'canvasUrl'  => add_query_arg(
				array(
					'form'    => $form_id,
					'figures' => 1,
				),
				admin_url( 'admin.php?page=' . BuilderPage::SLUG )
			),
		);
	}

	/**
	 * Address of the page.
	 *
	 * @param int                      $days  Period in days.
	 * @param array<string,string|int> $query Other query arguments (a period from StatsPeriod::query()).
	 */
	public static function url( int $days = 30, array $query = array() ): string {
		$url = admin_url( 'admin.php?page=' . self::SLUG );
		if ( StatsPeriod::DEFAULT_DAYS !== $days ) {
			$query = array( 'period' => $days ) + $query;
		}
		return array() === $query ? $url : add_query_arg( $query, $url );
	}

	/**
	 * Address of the analytics of one form.
	 *
	 * @param int                      $form_id Form ID.
	 * @param array<string,string|int> $query   Period (StatsPeriod::query()).
	 */
	public static function form_url( int $form_id, array $query = array() ): string {
		return add_query_arg( array( 'form' => $form_id ) + $query, admin_url( 'admin.php?page=' . self::SLUG ) );
	}

	/**
	 * Where the table and the drop-offs lead for one form: its page on this page, in both editions
	 * (the analytics in Funnelforms Pro, the figures in Funnelforms Free).
	 *
	 * @param int                      $form_id Form ID.
	 * @param array<string,string|int> $query   Period (StatsPeriod::query()).
	 * @param string                   $hash    Anchor without #.
	 */
	public static function figures_url( int $form_id, array $query = array(), string $hash = '' ): string {
		return self::form_url( $form_id, $query ) . ( '' === $hash ? '' : '#' . $hash );
	}

	/**
	 * Whether this edition has the analytics of one form (Funnelforms Pro).
	 */
	public static function per_form(): bool {
		return null !== Edition::pro( FormStatsPage::class );
	}

	/**
	 * Renders the page, or the analytics of one form.
	 */
	public static function render(): void {
		if ( ! current_user_can( FileDownload::capability() ) ) {
			return;
		}
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- a view, nothing changes.
		$now    = time();
		$query  = wp_unslash( $_GET );
		$period = StatsPeriod::from_query( is_array( $query ) ? $query : array(), $now );
		$wrong  = ( isset( $_GET['from'] ) || isset( $_GET['to'] ) ) && null !== $period->preset;
		if ( isset( $_GET['form'] ) ) {
			$page = Edition::pro( FormStatsPage::class );
			if ( null === $page ) {
				self::free_form( absint( $_GET['form'] ) );
				return;
			}
			$page::render( absint( $_GET['form'] ), $period, $wrong, $now );
			return;
		}
		// phpcs:enable

		$report = StatsOverview::for_period( $period );
		$totals = $report['totals'];
		$before = $report['before'];
		$days   = $period->days;
		// "On Funnelforms 5" only means something where forms came from Funnelforms 3.
		$update = 'update' === SetupFlow::state()['path'];

		Ui::open(
			array(
				'title'   => __( 'Statistics', 'funnelforms-free' ),
				'lead'    => __( 'Views, entries and where visitors come from and leave, over all your forms.', 'funnelforms-free' ),
				'actions' => StatsUi::periods( $period, array( 'page' => self::SLUG ), $now ),
			)
		);
		self::wrong_period( $wrong );
		$export = Edition::pro( StatsExport::class );
		StatsUi::range_bar( $period, null === $export ? self::pro_export() : $export::buttons( $period, null ) );

		if ( $report['legacy'] > 0 ) {
			echo '<div class="ffx-notice ffx-notice--info ffx-section"><p>';
			/* translators: %d: number of forms. */
			echo esc_html( sprintf( _n( '%d form still runs on Funnelforms 3. Its entries count here; views and drop-offs are measured once it runs on Funnelforms 5.', '%d forms still run on Funnelforms 3. Their entries count here; views and drop-offs are measured once they run on Funnelforms 5.', $report['legacy'], 'funnelforms-free' ), $report['legacy'] ) );
			echo '</p></div>';
		}
		?>
		<div class="ffx-grid ffx-section ffx-stats-kpis">
			<?php
			StatsUi::kpi( 'eye', __( 'Views', 'funnelforms-free' ), number_format_i18n( $totals['views'] ), self::trend( $totals['views'], $before['views'], $days ), StatsUi::direction( $totals['views'], $before['views'] ) );
			StatsUi::kpi( 'activity', __( 'Started', 'funnelforms-free' ), number_format_i18n( $totals['starts'] ), self::trend( $totals['starts'], $before['starts'], $days ), StatsUi::direction( $totals['starts'], $before['starts'] ) );
			StatsUi::kpi( 'inbox', __( 'Entries', 'funnelforms-free' ), number_format_i18n( $totals['entries'] ), self::trend( $totals['entries'], $before['entries'], $days ), StatsUi::direction( $totals['entries'], $before['entries'] ) );
			StatsUi::kpi( 'chart', __( 'Conversion rate', 'funnelforms-free' ), StatsUi::percent( $totals['rate'] ), self::points( $totals['rate'], $before['rate'], $days ), null === $totals['rate'] || null === $before['rate'] ? '' : StatsUi::direction( (int) round( 1000 * $totals['rate'] ), (int) round( 1000 * $before['rate'] ) ) );
			?>
		</div>

		<div class="ffx-split ffx-section">
			<section class="ffx-card">
				<div class="ffx-card__head">
					<h2><?php esc_html_e( 'Views and entries', 'funnelforms-free' ); ?></h2>
					<?php self::legend( true ); ?>
				</div>
				<?php self::chart( $report['daily'], true ); ?>
			</section>

			<section class="ffx-card">
				<div class="ffx-card__head">
					<h2><?php esc_html_e( 'From view to entry', 'funnelforms-free' ); ?></h2>
				</div>
				<?php if ( $totals['views'] > 0 ) : ?>
					<?php
					self::funnel(
						array(
							array( __( 'Views', 'funnelforms-free' ), $totals['views'], $before['views'] ),
							array( __( 'Started', 'funnelforms-free' ), $totals['starts'], $before['starts'] ),
							array( __( 'Sent', 'funnelforms-free' ), $totals['tracked'], $before['tracked'] ),
						)
					);
					?>
					<p class="ffx-small ffx-muted"><?php echo esc_html( $update ? __( 'Counted once per visit, for forms on Funnelforms 5.', 'funnelforms-free' ) : __( 'Counted once per visit.', 'funnelforms-free' ) ); ?></p>
				<?php else : ?>
					<p class="ffx-muted"><?php echo esc_html( $update ? __( 'No views in this period yet. Views are counted for published forms on Funnelforms 5, once per visit and without cookies.', 'funnelforms-free' ) : __( 'No views in this period yet. Views of published forms are counted once per visit and without cookies.', 'funnelforms-free' ) ); ?></p>
				<?php endif; ?>
			</section>
		</div>

		<section class="ffx-card ffx-card--flush ffx-section">
			<div class="ffx-card__head ffx-stats-head">
				<h2><?php esc_html_e( 'Forms compared', 'funnelforms-free' ); ?></h2>
				<?php echo Ui::button( __( 'All forms', 'funnelforms-free' ), admin_url( 'admin.php?page=' . BuilderPage::SLUG ), 'ghost', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
			</div>
			<?php self::table( $report['forms'], $period ); ?>
		</section>

		<div class="ffx-grid ffx-grid--2 ffx-section">
			<section class="ffx-card">
				<div class="ffx-card__head">
					<h2><?php esc_html_e( 'Where visitors come from', 'funnelforms-free' ); ?></h2>
				</div>
				<?php
				$sources = Edition::pro( StatsSources::class );
				if ( null === $sources ) {
					echo FreeSite::hint( __( 'Sources, channels and campaigns come with Funnelforms Pro. They are counted already, so Pro shows them at once.', 'funnelforms-free' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in hint().
				} else {
					$sources::render( $report['sources'], $report['sources_before'], $report['channels'], $totals['views'], 6 );
				}
				?>
			</section>
			<section class="ffx-card">
				<div class="ffx-card__head">
					<h2><?php esc_html_e( 'When entries come in', 'funnelforms-free' ); ?></h2>
				</div>
				<?php StatsUi::heatmap( $report['hours'] ); ?>
			</section>
		</div>

		<div class="ffx-grid ffx-grid--2 ffx-section">
			<section class="ffx-card">
				<div class="ffx-card__head">
					<h2><?php esc_html_e( 'Where visitors leave', 'funnelforms-free' ); ?></h2>
				</div>
				<?php self::leaks( $report['leaks'], $period ); ?>
			</section>
			<section class="ffx-card">
				<div class="ffx-card__head">
					<h2><?php esc_html_e( 'Entries by device', 'funnelforms-free' ); ?></h2>
				</div>
				<?php self::devices( $report['devices'], $report['devices_before'] ); ?>
			</section>
		</div>
		<?php
		StatsUi::privacy();
		Ui::close();
	}

	/**
	 * Funnelforms Free: the figures of one form on this page (views, starts, entries, conversion,
	 * where visitors leave, through the figures screen of the admin app, which also names what the
	 * analytics of Pro add).
	 *
	 * @param int $form_id Form ID.
	 */
	private static function free_form( int $form_id ): void {
		$form  = ( new FormRepository() )->by_id( $form_id );
		$title = null === $form ? '' : ( '' !== (string) $form['title'] ? (string) $form['title'] : __( '(no title)', 'funnelforms-free' ) );
		Ui::open(
			array(
				'title' => __( 'Statistics', 'funnelforms-free' ),
				'head'  => false,
			)
		);
		?>
		<div class="ffx-page__head ffx-formstats__head">
			<div>
				<a class="ffx-back" href="<?php echo esc_url( self::url() ); ?>"><?php echo Ui::icon( 'back' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'All forms', 'funnelforms-free' ); ?></span></a>
				<h1><?php echo esc_html( '' !== $title ? $title : __( 'Statistics', 'funnelforms-free' ) ); ?></h1>
			</div>
			<?php if ( null !== $form ) : ?>
				<?php echo Ui::button( __( 'Open in editor', 'funnelforms-free' ), add_query_arg( 'form', $form_id, admin_url( 'admin.php?page=' . BuilderPage::SLUG ) ), 'secondary', 'form' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
			<?php endif; ?>
		</div>
		<hr class="wp-header-end" hidden>
		<?php if ( null === $form ) : ?>
			<section class="ffx-card ffx-section"><div class="ffx-empty"><span class="ffx-empty__mark"><?php echo Ui::icon( 'chart' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span><h2><?php esc_html_e( 'Form not found', 'funnelforms-free' ); ?></h2><p><?php esc_html_e( 'The form may have been deleted.', 'funnelforms-free' ); ?></p></div></section>
		<?php elseif ( ! BuilderPage::built() ) : ?>
			<div class="notice notice-error"><p><?php esc_html_e( 'The form builder is missing from this copy of the plugin. Install the plugin from its ZIP file.', 'funnelforms-free' ); ?></p></div>
		<?php else : ?>
			<div id="funnelforms-builder" class="ffx-section"></div>
		<?php endif; ?>
		<?php
		Ui::close();
	}

	/**
	 * Funnelforms Free: the export button leads to the page about Pro.
	 */
	private static function pro_export(): string {
		return '<a class="ffx-btn" href="' . esc_url( FreeSite::url() ) . '" title="' . esc_attr__( 'The export of the statistics comes with Funnelforms Pro.', 'funnelforms-free' ) . '">' . Ui::icon( 'download' ) . '<span>' . esc_html__( 'Export', 'funnelforms-free' ) . '</span>' . Ui::badge( __( 'Pro', 'funnelforms-free' ), 'info' ) . '</a>';
	}

	/**
	 * A notice when the days asked for are no valid period.
	 *
	 * @param bool $wrong Whether they were not.
	 */
	public static function wrong_period( bool $wrong ): void {
		if ( $wrong ) {
			/* translators: %d: number of days. */
			echo '<div class="ffx-notice ffx-notice--warning ffx-section"><p>' . esc_html( sprintf( __( 'Those days are no valid period, so the last 30 days are shown. Pick up to %d days that end today at the latest.', 'funnelforms-free' ), StatsPeriod::MAX_DAYS ) ) . '</p></div>';
		}
	}

	/**
	 * Change against the period before, in words.
	 *
	 * @param int $now    This period.
	 * @param int $before Period before.
	 * @param int $days   Length of the period.
	 */
	public static function trend( int $now, int $before, int $days ): string {
		if ( 0 === $before ) {
			return __( 'No figures before', 'funnelforms-free' );
		}
		/* translators: 1: change in percent with sign, e.g. +12 %; 2: number of days. */
		return sprintf( __( '%1$s against the %2$d days before', 'funnelforms-free' ), StatsUi::change( $now, $before ), $days );
	}

	/**
	 * Change of a rate against the period before, in percentage points.
	 *
	 * @param float|null $now    This period.
	 * @param float|null $before Period before.
	 * @param int        $days   Length of the period.
	 */
	public static function points( ?float $now, ?float $before, int $days ): string {
		if ( null === $now || null === $before ) {
			return __( 'Entries per view', 'funnelforms-free' );
		}
		$change = round( 100 * ( $now - $before ), 1 );
		/* translators: 1: change in percentage points with sign, e.g. +1.5; 2: number of days. */
		return sprintf( __( '%1$s points against the %2$d days before', 'funnelforms-free' ), ( $change > 0 ? '+' : '' ) . number_format_i18n( $change, 1 ), $days );
	}

	/**
	 * The legend of the chart.
	 *
	 * @param bool $previous With the entries of the period before.
	 */
	public static function legend( bool $previous = false ): void {
		?>
		<span class="ffx-legend">
			<span class="ffx-legend__item ffx-legend__item--views"><?php esc_html_e( 'Views', 'funnelforms-free' ); ?></span>
			<span class="ffx-legend__item ffx-legend__item--entries"><?php esc_html_e( 'Entries', 'funnelforms-free' ); ?></span>
			<?php if ( $previous ) : ?>
				<span class="ffx-legend__item ffx-legend__item--previous"><?php esc_html_e( 'Entries before', 'funnelforms-free' ); ?></span>
			<?php endif; ?>
		</span>
		<?php
	}

	/**
	 * Views as an area and entries as bars, per day, on one scale; with $previous the entries of
	 * the period before as a dashed line, day by day.
	 *
	 * @param list<array{date:string,views:int,entries:int,previous?:int}> $daily    Days.
	 * @param bool                                                         $previous Draw the period before.
	 */
	public static function chart( array $daily, bool $previous = false ): void {
		$count = count( $daily );
		$max   = max( 1, ...array_map( static fn( array $d ): int => max( $d['views'], $d['entries'], $previous ? (int) ( $d['previous'] ?? 0 ) : 0 ), $daily ) );
		$width = 10 * $count;
		$top   = static fn( int $n ): string => number_format( 100 - 92 * $n / $max, 2, '.', '' );
		$area  = 'M0,100';
		$line  = '';
		$bars  = '';
		$hits  = '';
		$wide  = $count > 120 ? 8 : 6;
		foreach ( $daily as $i => $day ) {
			$x     = 10 * $i + 5;
			$area .= ' L' . $x . ',' . $top( $day['views'] );
			$line .= ( '' === $line ? 'M' : ' L' ) . $x . ',' . $top( (int) ( $day['previous'] ?? 0 ) );
			if ( $day['entries'] > 0 ) {
				$bars .= '<rect class="ffx-chart__bar" x="' . ( $x - $wide / 2 ) . '" y="' . $top( $day['entries'] ) . '" width="' . $wide . '" height="' . number_format( 92 * $day['entries'] / $max, 2, '.', '' ) . '" rx="1.5"/>';
			}
			$date = wp_date( get_option( 'date_format' ), (int) strtotime( $day['date'] . ' 12:00:00' ) );
			if ( $previous ) {
				/* translators: 1: date; 2: views; 3: entries; 4: entries on the same day of the period before. */
				$label = sprintf( __( '%1$s: %2$s views, %3$s entries (before: %4$s)', 'funnelforms-free' ), $date, number_format_i18n( $day['views'] ), number_format_i18n( $day['entries'] ), number_format_i18n( (int) ( $day['previous'] ?? 0 ) ) );
			} else {
				/* translators: 1: date; 2: views; 3: entries. */
				$label = sprintf( __( '%1$s: %2$s views, %3$s entries', 'funnelforms-free' ), $date, number_format_i18n( $day['views'] ), number_format_i18n( $day['entries'] ) );
			}
			$hits .= '<rect class="ffx-chart__hit" x="' . ( 10 * $i ) . '" y="0" width="10" height="100"><title>' . esc_html( $label ) . '</title></rect>';
		}
		$area .= ' L' . $width . ',' . $top( $daily[ $count - 1 ]['views'] ?? 0 ) . ' L' . $width . ',100 Z';
		$total = array_sum( array_column( $daily, 'entries' ) ) + array_sum( array_column( $daily, 'views' ) );
		$first = $daily[0]['date'] ?? '';
		$last  = $daily[ $count - 1 ]['date'] ?? '';
		$mid   = $daily[ intdiv( $count, 2 ) ]['date'] ?? '';
		/* translators: short date below charts, PHP date format, e.g. "j M" or "M j". */
		$format = __( 'M j', 'funnelforms-free' );
		$date   = static fn( string $day ): string => wp_date( $format, (int) strtotime( $day . ' 12:00:00' ) );
		?>
		<div class="ffx-chart<?php echo 0 === $total ? ' is-empty' : ''; ?>">
			<span class="ffx-chart__max"><?php echo esc_html( number_format_i18n( $max ) ); ?></span>
			<svg viewBox="0 0 <?php echo (int) $width; ?> 100" preserveAspectRatio="none" role="img" aria-label="<?php esc_attr_e( 'Views and entries per day', 'funnelforms-free' ); ?>">
				<line class="ffx-chart__grid" x1="0" x2="<?php echo (int) $width; ?>" y1="8" y2="8"/>
				<line class="ffx-chart__grid" x1="0" x2="<?php echo (int) $width; ?>" y1="54" y2="54"/>
				<path class="ffx-chart__area" d="<?php echo esc_attr( $area ); ?>"/>
				<?php echo $bars; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- numbers built here. ?>
				<?php if ( $previous && '' !== $line ) : ?>
					<path class="ffx-chart__previous" d="<?php echo esc_attr( $line ); ?>"/>
				<?php endif; ?>
				<?php echo $hits; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- numbers built here; the titles are escaped. ?>
			</svg>
			<?php if ( 0 === $total ) : ?>
				<p class="ffx-chart__empty"><?php esc_html_e( 'No views or entries in this period yet.', 'funnelforms-free' ); ?></p>
			<?php endif; ?>
			<div class="ffx-chart__axis">
				<span><?php echo esc_html( $date( $first ) ); ?></span>
				<span><?php echo esc_html( $date( $mid ) ); ?></span>
				<span><?php echo esc_html( $date( $last ) ); ?></span>
			</div>
		</div>
		<?php
	}

	/**
	 * Steps from view to entry as bars, with the share of the first and the change.
	 *
	 * @param list<array{0:string,1:int,2?:int}> $steps Label, count and count before.
	 */
	public static function funnel( array $steps ): void {
		$first = max( 1, $steps[0][1] );
		echo '<ol class="ffx-funnel">';
		foreach ( $steps as $step ) {
			$share = min( 1, $step[1] / $first );
			$delta = isset( $step[2] ) ? StatsUi::delta( StatsUi::change( $step[1], $step[2] ), StatsUi::direction( $step[1], $step[2] ), false, __( 'Against the period before', 'funnelforms-free' ) ) : '';
			printf(
				'<li><span class="ffx-funnel__label">%1$s</span><span class="ffx-funnel__value">%2$s <small>%3$s</small>%5$s</span><span class="ffx-funnel__bar"><span style="width:%4$s%%"></span></span></li>',
				esc_html( $step[0] ),
				esc_html( number_format_i18n( $step[1] ) ),
				esc_html( StatsUi::percent( $share ) ),
				esc_attr( number_format( 100 * $share, 1, '.', '' ) ),
				$delta // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in delta().
			);
		}
		echo '</ol>';
	}

	/**
	 * The forms with their figures; drafts without any figures are left out.
	 *
	 * @param list<array<string,mixed>> $forms  Forms.
	 * @param StatsPeriod               $period Period.
	 */
	private static function table( array $forms, StatsPeriod $period ): void {
		$forms = array_values( array_filter( $forms, static fn( array $f ): bool => 'published' === $f['status'] || $f['views'] + $f['entries'] + $f['entries_before'] > 0 ) );
		if ( array() === $forms ) {
			echo '<div class="ffx-empty"><span class="ffx-empty__mark">' . Ui::icon( 'form' ) . '</span><h2>' . esc_html__( 'No published forms yet', 'funnelforms-free' ) . '</h2><p>' . esc_html__( 'Publish a form and its figures show up here.', 'funnelforms-free' ) . '</p></div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
			return;
		}
		$against  = __( 'Against the period before', 'funnelforms-free' );
		$per_form = self::per_form();
		?>
		<div class="ffx-table-wrap">
			<table class="ffx-table ffx-stats-table">
				<thead>
					<tr>
						<th scope="col"><?php esc_html_e( 'Form', 'funnelforms-free' ); ?></th>
						<th scope="col" class="num"><?php esc_html_e( 'Views', 'funnelforms-free' ); ?></th>
						<th scope="col" class="num"><?php esc_html_e( 'Started', 'funnelforms-free' ); ?></th>
						<th scope="col" class="num"><?php esc_html_e( 'Entries', 'funnelforms-free' ); ?></th>
						<th scope="col" class="num"><?php esc_html_e( 'Conversion', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Entries per day', 'funnelforms-free' ); ?></th>
						<?php if ( $per_form ) : ?>
							<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Analytics', 'funnelforms-free' ); ?></span></th>
						<?php endif; ?>
					</tr>
				</thead>
				<tbody>
					<?php foreach ( $forms as $form ) : ?>
						<?php
						$title = '' !== $form['title'] ? $form['title'] : __( '(no title)', 'funnelforms-free' );
						// Every form leads to its own page here, also forms on Funnelforms 3 or not yet published.
						$url = self::figures_url( $form['id'], $period->query() );
						?>
						<tr>
							<th scope="row">
								<a class="ffx-stats-table__form" href="<?php echo esc_url( $url ); ?>"><?php echo esc_html( $title ); ?></a>
								<?php echo $form['v5'] ? '' : Ui::badge( __( 'Funnelforms 3', 'funnelforms-free' ), 'info' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge(). ?>
							</th>
							<td class="num">
								<?php if ( $form['v5'] ) : ?>
									<?php echo esc_html( number_format_i18n( $form['views'] ) ); ?>
									<?php echo StatsUi::delta( StatsUi::change( $form['views'], $form['views_before'] ), StatsUi::direction( $form['views'], $form['views_before'] ), false, $against ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in delta(). ?>
								<?php else : ?>
									–
								<?php endif; ?>
							</td>
							<td class="num"><?php echo $form['v5'] ? esc_html( number_format_i18n( $form['starts'] ) ) : '–'; ?></td>
							<td class="num">
								<?php echo esc_html( number_format_i18n( $form['entries'] ) ); ?>
								<?php echo StatsUi::delta( StatsUi::change( $form['entries'], $form['entries_before'] ), StatsUi::direction( $form['entries'], $form['entries_before'] ), false, $against ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in delta(). ?>
							</td>
							<td class="num">
								<?php echo esc_html( StatsUi::percent( $form['rate'] ) ); ?>
								<?php echo StatsUi::delta( StatsUi::points( $form['rate'], $form['rate_before'] ), StatsUi::direction( $form['rate'], $form['rate_before'] ), false, $against ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in delta(). ?>
							</td>
							<td><?php self::spark( $form['series'] ); ?></td>
							<?php if ( $per_form ) : ?>
								<td class="ffx-stats-table__go">
									<?php /* translators: %s: form title. */ ?>
									<a href="<?php echo esc_url( $url ); ?>" aria-label="<?php echo esc_attr( sprintf( __( 'Analytics of %s', 'funnelforms-free' ), $title ) ); ?>"><?php echo Ui::icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></a>
								</td>
							<?php endif; ?>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
		<?php
	}

	/**
	 * Entries per day as small bars.
	 *
	 * @param int[] $series Entries per day.
	 */
	private static function spark( array $series ): void {
		$count = count( $series );
		$max   = max( 1, ...$series );
		$bars  = '';
		$step  = $count > 120 ? 2 : 4;
		foreach ( $series as $i => $n ) {
			$height = $n > 0 ? max( 2, 22 * $n / $max ) : 1;
			$bars  .= '<rect x="' . ( $step * $i ) . '" y="' . number_format( 24 - $height, 2, '.', '' ) . '" width="' . ( $step - 1 ) . '" height="' . number_format( $height, 2, '.', '' ) . '"' . ( $n > 0 ? '' : ' class="is-zero"' ) . '/>';
		}
		echo '<svg class="ffx-spark" viewBox="0 0 ' . (int) ( $step * $count ) . ' 24" preserveAspectRatio="none" aria-hidden="true">' . $bars . '</svg>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- numbers built here.
	}

	/**
	 * The steps where most visitors left.
	 *
	 * @param list<array<string,mixed>> $leaks  Steps.
	 * @param StatsPeriod               $period Period.
	 */
	private static function leaks( array $leaks, StatsPeriod $period ): void {
		if ( array() === $leaks ) {
			/* translators: %d: number of page views. */
			echo '<p class="ffx-muted">' . esc_html( sprintf( __( 'Not enough visits yet to tell. A step shows up here once at least %d visits reached it.', 'funnelforms-free' ), StatsOverview::MIN_REACHED ) ) . '</p>';
			return;
		}
		echo '<ol class="ffx-leaks">';
		foreach ( $leaks as $leak ) {
			printf(
				'<li><a class="ffx-leaks__step" href="%1$s">%2$s</a><span class="ffx-leaks__form">%3$s</span><span class="ffx-leaks__figure">%4$s</span><span class="ffx-funnel__bar ffx-funnel__bar--warn"><span style="width:%5$s%%"></span></span></li>',
				esc_url( self::figures_url( $leak['form'], $period->query(), 'ffx-steps' ) ),
				esc_html( '' !== $leak['title'] ? $leak['title'] : __( 'Step without a title', 'funnelforms-free' ) ),
				esc_html( $leak['form_title'] ),
				/* translators: 1: visits that left; 2: visits that reached the step; 3: share in percent. */
				esc_html( sprintf( __( '%1$s of %2$s left here (%3$s)', 'funnelforms-free' ), number_format_i18n( $leak['left'] ), number_format_i18n( $leak['reached'] ), StatsUi::percent( $leak['rate'] ) ) ),
				esc_attr( number_format( 100 * $leak['rate'], 1, '.', '' ) )
			);
		}
		echo '</ol>';
	}

	/**
	 * Entries by device kind, with the change of each share.
	 *
	 * @param array{desktop:int,tablet:int,mobile:int} $devices Counts.
	 * @param array{desktop:int,tablet:int,mobile:int} $before  Counts of the period before.
	 */
	public static function devices( array $devices, array $before ): void {
		$total = array_sum( $devices );
		if ( 0 === $total ) {
			echo '<p class="ffx-muted">' . esc_html__( 'No entries with a known device in this period yet.', 'funnelforms-free' ) . '</p>';
			return;
		}
		$earlier = array_sum( $before );
		$names   = array(
			'mobile'  => array( __( 'Mobile', 'funnelforms-free' ), 'phone' ),
			'desktop' => array( __( 'Desktop', 'funnelforms-free' ), 'monitor' ),
			'tablet'  => array( __( 'Tablet', 'funnelforms-free' ), 'tablet' ),
		);
		echo '<ul class="ffx-devices">';
		foreach ( $names as $key => $name ) {
			$share = $devices[ $key ] / $total;
			$old   = $earlier > 0 ? $before[ $key ] / $earlier : null;
			printf(
				'<li><span class="ffx-kpi__icon">%1$s</span><span class="ffx-devices__label">%2$s</span><span class="ffx-devices__value">%3$s <small>%4$s</small>%6$s</span><span class="ffx-funnel__bar"><span style="width:%5$s%%"></span></span></li>',
				Ui::icon( $name[1] ), // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
				esc_html( $name[0] ),
				esc_html( StatsUi::percent( $share ) ),
				esc_html( number_format_i18n( $devices[ $key ] ) ),
				esc_attr( number_format( 100 * $share, 1, '.', '' ) ),
				StatsUi::delta( StatsUi::points( $share, $old ), '', false, __( 'Share against the period before', 'funnelforms-free' ) ) // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in delta().
			);
		}
		echo '</ul>';
	}
}
