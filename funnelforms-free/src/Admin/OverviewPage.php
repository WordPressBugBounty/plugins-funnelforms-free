<?php
/**
 * Start page of Funnelforms (Funnelforms → Overview).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;
use Funnelforms\Http\FileDownload;
use Funnelforms\Application\License\License;
use Funnelforms\Application\SetupFlow;
use Funnelforms\Application\StatsOverview;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\Migrator;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Greets, shows what is left to set up, the figures of the last 30 days, the latest entries and
 * the forms. Entries show their form and time only, never what visitors entered.
 */
final class OverviewPage {

	/** Days the figures cover. */
	public const DAYS = 30;

	/**
	 * Steps of the setup, each with whether it is done and where to do it.
	 *
	 * @return list<array{key:string,label:string,done:bool,url:string}>
	 */
	public static function steps(): array {
		$steps   = array();
		$account = Edition::pro( AccountPage::class );
		$license = Edition::pro( License::class );
		if ( null !== $account && null !== $license && current_user_can( $account::CAPABILITY ) ) {
			$steps[] = array(
				'key'   => 'account',
				'label' => __( 'Connect your Funnelforms account', 'funnelforms-free' ),
				'done'  => in_array( $license::state()['status'], array( 'active', 'grace' ), true ),
				'url'   => $account::url(),
			);
		}
		if ( current_user_can( Capabilities::MANAGE_SETTINGS ) && ( new LegacyRepository() )->has_data() ) {
			$steps[] = array(
				'key'   => 'import',
				'label' => __( 'Bring over your forms from Funnelforms 3', 'funnelforms-free' ),
				'done'  => null !== Migrator::state()['last_sync_at'],
				'url'   => MigrationPage::url(),
			);
		}
		$stats   = self::stats();
		$steps[] = array(
			'key'   => 'form',
			'label' => __( 'Publish a form', 'funnelforms-free' ),
			'done'  => $stats['published'] > 0,
			'url'   => admin_url( 'admin.php?page=' . BuilderPage::SLUG ),
		);
		$steps[] = array(
			'key'   => 'website',
			'label' => __( 'Show it on your website', 'funnelforms-free' ),
			'done'  => self::shown_on_website(),
			'url'   => admin_url( 'admin.php?page=' . BuilderPage::SLUG ),
		);
		$steps[] = array(
			'key'   => 'entry',
			'label' => __( 'Receive the first entry', 'funnelforms-free' ),
			'done'  => $stats['entries_total'] > 0,
			'url'   => admin_url( 'admin.php?page=' . EntriesPage::SLUG ),
		);
		return $steps;
	}

	/**
	 * Whether a published page of this website shows a form (shortcode, block or Elementor widget).
	 */
	private static function shown_on_website(): bool {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a search in post content, fresh on purpose.
		$id = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT p.ID FROM %i p LEFT JOIN %i m ON m.post_id = p.ID AND m.meta_key = '_elementor_data' WHERE p.post_status = 'publish' AND ( p.post_content LIKE %s OR p.post_content LIKE %s OR p.post_content LIKE %s OR m.meta_value LIKE %s ) LIMIT 1",
				$wpdb->posts,
				$wpdb->postmeta,
				'%' . $wpdb->esc_like( '[funnelforms' ) . '%',
				'%' . $wpdb->esc_like( '[anfrageformular2' ) . '%',
				'%' . $wpdb->esc_like( '<!-- wp:funnelforms/form' ) . '%',
				'%' . $wpdb->esc_like( '"widgetType":"funnelforms"' ) . '%'
			)
		);
		return null !== $id;
	}

	/**
	 * Figures for the page.
	 *
	 * @return array{forms:int,published:int,entries_total:int,entries:int,entries_before:int,views:int,rate:float|null}
	 */
	public static function stats(): array {
		global $wpdb;
		$since  = gmdate( 'Y-m-d H:i:s', time() - self::DAYS * DAY_IN_SECONDS );
		$before = gmdate( 'Y-m-d H:i:s', time() - 2 * self::DAYS * DAY_IN_SECONDS );
		// phpcs:disable WordPress.DB.DirectDatabaseQuery -- counts of this plugin's tables, fresh on purpose.
		$forms   = $wpdb->get_row( $wpdb->prepare( "SELECT COUNT(*) AS total, SUM(status = 'published') AS published FROM %i WHERE status <> 'trashed'", Schema::table( 'forms' ) ), ARRAY_A );
		$entries = $wpdb->get_row(
			$wpdb->prepare( 'SELECT COUNT(*) AS total, SUM(created_at >= %s) AS recent, SUM(created_at >= %s AND created_at < %s) AS before_ FROM %i WHERE status = %s', $since, $before, $since, Schema::table( 'entries' ), 'complete' ),
			ARRAY_A
		);
		$views   = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT form_id, session_hash) FROM %i WHERE event = 'view' AND created_at >= %s", Schema::table( 'events' ), $since ) );
		// phpcs:enable
		$recent = (int) ( $entries['recent'] ?? 0 );
		return array(
			'forms'          => (int) ( $forms['total'] ?? 0 ),
			'published'      => (int) ( $forms['published'] ?? 0 ),
			'entries_total'  => (int) ( $entries['total'] ?? 0 ),
			'entries'        => $recent,
			'entries_before' => (int) ( $entries['before_'] ?? 0 ),
			'views'          => $views,
			'rate'           => $views > 0 ? min( 1.0, $recent / $views ) : null,
		);
	}

	/**
	 * Latest complete entries: id, form title and time.
	 *
	 * @param int $limit How many.
	 * @return list<array{id:int,form:string,created_at:string}>
	 */
	public static function latest( int $limit = 5 ): array {
		global $wpdb;
		$rows = (array) $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- as above.
			$wpdb->prepare(
				'SELECT e.id, e.created_at, f.title FROM %i e LEFT JOIN %i f ON f.id = e.form_id WHERE e.status = %s ORDER BY e.created_at DESC, e.id DESC LIMIT %d',
				Schema::table( 'entries' ),
				Schema::table( 'forms' ),
				'complete',
				$limit
			),
			ARRAY_A
		);
		return array_map(
			static fn( array $row ): array => array(
				'id'         => (int) $row['id'],
				'form'       => (string) ( $row['title'] ?? '' ),
				'created_at' => (string) $row['created_at'],
			),
			$rows
		);
	}

	/**
	 * Renders the page.
	 */
	public static function render(): void {
		if ( ! current_user_can( Capabilities::EDIT_FORMS ) ) {
			return;
		}
		$user     = wp_get_current_user();
		$steps    = self::steps();
		$done     = count( array_filter( array_column( $steps, 'done' ) ) );
		$next     = current( array_filter( $steps, static fn( array $step ): bool => ! $step['done'] ) );
		$stats    = self::stats();
		$builder  = admin_url( 'admin.php?page=' . BuilderPage::SLUG );
		$entries  = admin_url( 'admin.php?page=' . EntriesPage::SLUG );
		$can_read = current_user_can( FileDownload::capability() );
		$forms    = ( new FormRepository() )->search( array(), 'updated', 1, 5 )['rows'];
		$counts   = ( new FormRepository() )->entry_counts( array_map( 'intval', array_column( $forms, 'id' ) ) );
		$name     = '' !== $user->first_name ? $user->first_name : $user->display_name;
		$setup    = current_user_can( 'manage_options' ) && SetupFlow::open();
		Ui::open(
			array(
				'title'   => __( 'Overview', 'funnelforms-free' ),
				'head'    => false,
				'actions' => Ui::button( __( 'New form', 'funnelforms-free' ), $builder, 'primary', 'plus' ),
			)
		);
		?>
		<section class="ffx-hero">
			<div>
				<span class="ffx-hero__eyebrow"><?php echo Ui::icon( 'sparkles' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?> <?php echo esc_html( Edition::is_free() ? 'Funnelforms Free 5' : 'Funnelforms Pro 5' ); ?></span>
				<?php /* translators: %s: first name of the user. */ ?>
				<h1><?php echo esc_html( sprintf( __( 'Hello %s', 'funnelforms-free' ), $name ) ); ?></h1>
				<p>
					<?php
					echo esc_html(
						false === $next
							? __( 'Everything is set up. Here is how your forms are doing.', 'funnelforms-free' )
							: ( 'update' === SetupFlow::state()['path']
								? __( 'A few steps, and your forms run on Funnelforms 5: faster, accessible and in the look of your brand.', 'funnelforms-free' )
								// A new installation has no forms of Funnelforms 3 to move.
								: __( 'A few steps, and your first form is live: fast, accessible and in the look of your brand.', 'funnelforms-free' ) )
					);
					?>
				</p>
				<div class="ffx-hero__actions">
					<?php
					if ( $setup ) {
						$label = 'welcome' === SetupFlow::state()['step'] ? __( 'Start the setup', 'funnelforms-free' ) : __( 'Continue the setup', 'funnelforms-free' );
						echo Ui::button( $label, SetupPage::url(), 'primary', 'sparkles' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
					} elseif ( false !== $next ) {
						echo Ui::button( $next['label'], $next['url'], 'primary', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
					}
					echo Ui::button( __( 'Open forms', 'funnelforms-free' ), $builder, false === $next && ! $setup ? 'primary' : 'secondary', 'form' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
					if ( $can_read ) {
						echo Ui::button( __( 'View entries', 'funnelforms-free' ), $entries, 'ghost', 'inbox' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
					}
					// Pro has its support page with the help center in the menu; Free links both here.
					if ( Edition::is_free() ) {
						echo Ui::external_button( __( 'Help center', 'funnelforms-free' ), Ui::help_center_url(), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in external_button().
						echo Ui::external_button( __( 'Support forum', 'funnelforms-free' ), Ui::support_url(), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in external_button().
					}
					?>
				</div>
			</div>
			<aside class="ffx-hero__aside ffx-card" aria-labelledby="ffx-setup-title">
				<div class="ffx-card__head">
					<h2 id="ffx-setup-title"><?php esc_html_e( 'Setup', 'funnelforms-free' ); ?></h2>
					<?php /* translators: 1: steps done, 2: all steps. */ ?>
					<span class="ffx-muted ffx-small"><?php echo esc_html( sprintf( __( '%1$d of %2$d', 'funnelforms-free' ), $done, count( $steps ) ) ); ?></span>
				</div>
				<div class="ffx-progress" role="progressbar" aria-valuemin="0" aria-valuemax="<?php echo esc_attr( (string) count( $steps ) ); ?>" aria-valuenow="<?php echo esc_attr( (string) $done ); ?>"><span style="width:<?php echo esc_attr( (string) round( 100 * $done / max( 1, count( $steps ) ) ) ); ?>%"></span></div>
				<ul class="ffx-checklist">
					<?php foreach ( $steps as $step ) : ?>
						<li class="<?php echo $step['done'] ? 'is-done' : ''; ?>" data-step="<?php echo esc_attr( $step['key'] ); ?>">
							<span class="ffx-checklist__dot"><?php echo $step['done'] ? Ui::icon( 'check' ) : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
							<?php if ( $step['done'] ) : ?>
								<span class="ffx-checklist__label"><?php echo esc_html( $step['label'] ); ?></span>
							<?php else : ?>
								<a class="ffx-checklist__label" href="<?php echo esc_url( $step['url'] ); ?>"><?php echo esc_html( $step['label'] ); ?></a>
							<?php endif; ?>
						</li>
					<?php endforeach; ?>
				</ul>
			</aside>
		</section>

		<?php
		// Who may see entries gets the figures as the statistics page and the forms list count them.
		$report = $can_read ? StatsOverview::report( self::DAYS, time() ) : null;
		if ( null !== $report ) {
			$stats = array(
				'views'          => (int) $report['totals']['views'],
				'entries'        => (int) $report['totals']['entries'],
				'entries_before' => (int) $report['before']['entries'],
				'rate'           => $report['totals']['rate'],
			) + $stats;
		}
		?>
		<div class="ffx-grid ffx-section">
			<?php
			self::kpi(
				'form',
				__( 'Forms', 'funnelforms-free' ),
				number_format_i18n( $stats['forms'] ),
				/* translators: %s: number of published forms. */
				sprintf( _n( '%s published', '%s published', $stats['published'], 'funnelforms-free' ), number_format_i18n( $stats['published'] ) )
			);
			self::kpi( 'eye', __( 'Views', 'funnelforms-free' ), number_format_i18n( $stats['views'] ), __( 'Last 30 days, once per visit', 'funnelforms-free' ) );
			self::kpi( 'inbox', __( 'Entries', 'funnelforms-free' ), number_format_i18n( $stats['entries'] ), self::trend( $stats['entries'], $stats['entries_before'] ) );
			self::kpi( 'chart', __( 'Conversion rate', 'funnelforms-free' ), null === $stats['rate'] ? '–' : number_format_i18n( 100 * $stats['rate'], 1 ) . ' %', __( 'Entries per view, last 30 days', 'funnelforms-free' ) );
			?>
		</div>

		<?php if ( null !== $report ) : ?>
			<div class="ffx-split ffx-section">
				<section class="ffx-card">
					<div class="ffx-card__head">
						<h2><?php esc_html_e( 'Views and entries', 'funnelforms-free' ); ?></h2>
						<?php echo Ui::button( __( 'Statistics', 'funnelforms-free' ), StatsPage::url(), 'ghost', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
					</div>
					<?php StatsPage::chart( $report['daily'] ); ?>
				</section>
				<section class="ffx-card">
					<div class="ffx-card__head">
						<h2><?php esc_html_e( 'Best forms', 'funnelforms-free' ); ?></h2>
					</div>
					<?php $best = array_slice( array_filter( $report['forms'], static fn( array $f ): bool => $f['entries'] > 0 ), 0, 4 ); ?>
					<?php if ( array() === $best ) : ?>
						<p class="ffx-muted"><?php esc_html_e( 'Forms with the most entries of the last 30 days show up here.', 'funnelforms-free' ); ?></p>
					<?php else : ?>
						<ul class="ffx-rows">
							<?php foreach ( $best as $form ) : ?>
								<li>
									<span class="ffx-rows__main">
										<a class="ffx-rows__title" href="<?php echo esc_url( StatsPage::figures_url( $form['id'] ) ); ?>"><?php echo esc_html( '' !== $form['title'] ? $form['title'] : __( '(no title)', 'funnelforms-free' ) ); ?></a>
										<?php /* translators: %s: share in percent. */ ?>
										<span class="ffx-rows__meta"><?php echo esc_html( null === $form['rate'] ? __( 'Conversion not measured', 'funnelforms-free' ) : sprintf( __( 'Conversion %s', 'funnelforms-free' ), number_format_i18n( 100 * $form['rate'], 1 ) . ' %' ) ); ?></span>
									</span>
									<?php /* translators: %s: number of entries. */ ?>
									<strong class="ffx-rows__figure"><?php echo esc_html( sprintf( _n( '%s entry', '%s entries', $form['entries'], 'funnelforms-free' ), number_format_i18n( $form['entries'] ) ) ); ?></strong>
								</li>
							<?php endforeach; ?>
						</ul>
					<?php endif; ?>
				</section>
			</div>
		<?php endif; ?>

		<div class="ffx-grid ffx-grid--2 ffx-section">
			<?php if ( $can_read ) : ?>
				<section class="ffx-card">
					<div class="ffx-card__head">
						<h2><?php esc_html_e( 'Latest entries', 'funnelforms-free' ); ?></h2>
						<?php echo Ui::button( __( 'All entries', 'funnelforms-free' ), $entries, 'ghost', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
					</div>
					<?php $latest = self::latest(); ?>
					<?php if ( array() === $latest ) : ?>
						<div class="ffx-empty">
							<span class="ffx-empty__mark"><?php echo Ui::icon( 'inbox' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
							<h2><?php esc_html_e( 'No entries yet', 'funnelforms-free' ); ?></h2>
							<p><?php esc_html_e( 'As soon as visitors send a form, their entries show up here.', 'funnelforms-free' ); ?></p>
						</div>
					<?php else : ?>
						<ul class="ffx-rows">
							<?php foreach ( $latest as $entry ) : ?>
								<li>
									<span class="ffx-avatar"><?php echo Ui::icon( 'inbox' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
									<span class="ffx-rows__main">
										<a class="ffx-rows__title" href="<?php echo esc_url( add_query_arg( 'entry', $entry['id'], $entries ) ); ?>"><?php echo esc_html( '' !== $entry['form'] ? $entry['form'] : __( 'Deleted form', 'funnelforms-free' ) ); ?></a>
										<?php /* translators: %s: time since the entry came in, e.g. 5 minutes. */ ?>
										<span class="ffx-rows__meta"><?php echo esc_html( sprintf( __( '%s ago', 'funnelforms-free' ), human_time_diff( (int) strtotime( $entry['created_at'] . ' UTC' ) ) ) ); ?></span>
									</span>
								</li>
							<?php endforeach; ?>
						</ul>
					<?php endif; ?>
				</section>
			<?php endif; ?>

			<section class="ffx-card">
				<div class="ffx-card__head">
					<h2><?php esc_html_e( 'Your forms', 'funnelforms-free' ); ?></h2>
					<?php echo Ui::button( __( 'All forms', 'funnelforms-free' ), $builder, 'ghost', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
				</div>
				<?php if ( array() === $forms ) : ?>
					<div class="ffx-empty">
						<span class="ffx-empty__mark"><?php echo Ui::icon( 'form' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
						<h2><?php esc_html_e( 'Your first form', 'funnelforms-free' ); ?></h2>
						<p><?php esc_html_e( 'Start from a template or a blank form.', 'funnelforms-free' ); ?></p>
						<?php echo Ui::button( __( 'New form', 'funnelforms-free' ), $builder, 'primary', 'plus' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
					</div>
				<?php else : ?>
					<ul class="ffx-rows">
						<?php foreach ( $forms as $form ) : ?>
							<?php $count = $counts[ (int) $form['id'] ] ?? 0; ?>
							<li>
								<span class="ffx-avatar"><?php echo Ui::icon( 'form' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
								<span class="ffx-rows__main">
									<a class="ffx-rows__title" href="<?php echo esc_url( add_query_arg( 'form', (int) $form['id'], $builder ) ); ?>"><?php echo esc_html( '' !== (string) $form['title'] ? (string) $form['title'] : __( '(no title)', 'funnelforms-free' ) ); ?></a>
									<?php /* translators: %s: number of entries. */ ?>
									<span class="ffx-rows__meta"><?php echo esc_html( sprintf( _n( '%s entry', '%s entries', $count, 'funnelforms-free' ), number_format_i18n( $count ) ) ); ?></span>
								</span>
								<?php
								$v5    = FormRepository::RENDERER_V5 === $form['renderer'];
								$badge = 'published' === $form['status']
									? ( $v5 ? Ui::badge( __( 'Live', 'funnelforms-free' ), 'success' ) : ( Edition::is_free() ? Ui::badge( __( 'Not shown yet', 'funnelforms-free' ), 'warning' ) : Ui::badge( __( 'Live on Funnelforms 3', 'funnelforms-free' ), 'info' ) ) )
									: Ui::badge( __( 'Draft', 'funnelforms-free' ) );
								echo $badge; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in badge().
								?>
							</li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>
			</section>
		</div>
		<?php
		Ui::close();
	}

	/**
	 * A key figure.
	 *
	 * @param string $icon  Icon name.
	 * @param string $label Label.
	 * @param string $value Value.
	 * @param string $hint  Line below.
	 */
	private static function kpi( string $icon, string $label, string $value, string $hint ): void {
		?>
		<div class="ffx-card ffx-kpi">
			<span class="ffx-kpi__label"><span class="ffx-kpi__icon"><?php echo Ui::icon( $icon ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span><?php echo esc_html( $label ); ?></span>
			<span class="ffx-kpi__value"><?php echo esc_html( $value ); ?></span>
			<span class="ffx-kpi__hint"><?php echo esc_html( $hint ); ?></span>
		</div>
		<?php
	}

	/**
	 * Change against the 30 days before, in words.
	 *
	 * @param int $now    This period.
	 * @param int $before Period before.
	 */
	public static function trend( int $now, int $before ): string {
		if ( 0 === $before ) {
			return __( 'Last 30 days', 'funnelforms-free' );
		}
		$change = (int) round( 100 * ( $now - $before ) / $before );
		/* translators: %s: change in percent with sign, e.g. +12 %. */
		return sprintf( __( '%s against the 30 days before', 'funnelforms-free' ), ( $change > 0 ? '+' : '' ) . number_format_i18n( $change ) . ' %' );
	}
}
