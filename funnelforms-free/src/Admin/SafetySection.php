<?php
/**
 * Restore points and the way back to Funnelforms 3 (Funnelforms → Migration → Way back).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\SupportAccess;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Compat\Safety\LegacyCheck;
use Funnelforms\Compat\Safety\LegacyRestore;
use Funnelforms\Compat\Safety\Rollback;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * For administrators only: the restore points hold every 3.x lead.
 *
 * Every step that changes something asks first on a page of its own that says what happens to
 * which data, shows its progress while it runs and ends with a report. Going back never deletes:
 * entries that came in on Funnelforms 5 stay there (and, with the lead list on, in Funnelforms 3
 * too), builder changes are kept for the way forward, and a restore only puts back what is missing
 * or changed, after saving the state it replaces.
 */
final class SafetySection {

	public const BACKUP    = 'funnelforms_backup_create';
	public const DOWNLOAD  = 'funnelforms_backup_download';
	public const RESTORE   = 'funnelforms_backup_restore';
	public const CHECK     = 'funnelforms_backup_check';
	public const MODE      = 'funnelforms_mode';
	public const FORM_BACK = 'funnelforms_form_back';
	public const DELETE    = 'funnelforms_backup_delete';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'admin_post_' . self::BACKUP, array( self::class, 'handle_backup' ) );
		add_action( 'admin_post_' . self::DOWNLOAD, array( self::class, 'handle_download' ) );
		add_action( 'admin_post_' . self::RESTORE, array( self::class, 'handle_restore' ) );
		add_action( 'admin_post_' . self::CHECK, array( self::class, 'handle_check' ) );
		add_action( 'admin_post_' . self::MODE, array( self::class, 'handle_mode' ) );
		add_action( 'admin_post_' . self::FORM_BACK, array( self::class, 'handle_form_back' ) );
		add_action( 'admin_post_' . self::DELETE, array( self::class, 'handle_delete' ) );
		add_action( 'admin_notices', array( self::class, 'notice' ) );
	}

	/**
	 * Address of the way back (the tab of the migration page).
	 *
	 * @param array<string,string|int> $args Query arguments.
	 */
	public static function url( array $args = array() ): string {
		return MigrationPage::url( array( 'tab' => 'wayback' ) + $args );
	}

	/**
	 * Address of a step of the way back (asks first, runs, reports).
	 *
	 * @param string                   $view back, restore, check, restoring, delete or result.
	 * @param array<string,string|int> $args Query arguments.
	 */
	public static function view_url( string $view, array $args = array() ): string {
		return MigrationPage::url( array( 'view' => $view ) + $args );
	}

	/*
	 * Handlers.
	 */

	/**
	 * Writes a restore point now.
	 */
	public static function handle_backup(): void {
		self::check( self::BACKUP );
		$started = LegacyBackup::start( 'manual' );
		$args    = $started ? array( 'done' => 'backup' ) : array( 'error' => LegacyBackup::running() ? 'busy' : (string) LegacyBackup::state()['error'] );
		wp_safe_redirect( self::back( $args ) . '#ffx-backups' );
		exit;
	}

	/**
	 * Where the button was: the tab on the settings page or the way back of the migration page.
	 *
	 * @param array<string,string> $args Query arguments.
	 */
	public static function back( array $args ): string {
		$from = (string) wp_get_referer();
		if ( str_contains( $from, 'page=' . SettingsPage::SLUG ) ) {
			return add_query_arg( $args, SettingsPage::url( 'safety' ) );
		}
		return self::url( $args );
	}

	/**
	 * Sends a restore point as a readable file: on the server its rows are encrypted with the key
	 * of the site, which would make the administrator's own copy useless anywhere else.
	 */
	public static function handle_download(): void {
		self::check( self::DOWNLOAD );
		if ( ! self::may_download() ) {
			wp_die( esc_html__( 'The support access cannot download restore points: they hold the leads of the site.', 'funnelforms-free' ), 403 );
		}
		$backup = LegacyBackup::find( isset( $_GET['backup'] ) ? sanitize_key( wp_unslash( $_GET['backup'] ) ) : '' ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- checked above.
		if ( null === $backup || '' !== LegacyBackup::problem( $backup ) ) {
			wp_die( esc_html( self::error_label( null === $backup ? 'backup_not_found' : ( 'locked' === LegacyBackup::problem( $backup ) ? 'backup_locked' : 'backup_damaged' ) ) ), 404 );
		}
		$name = 'funnelforms3-restore-point-' . gmdate( 'Y-m-d-His', (int) strtotime( (string) $backup['created_at'] . ' UTC' ) ) . '.jsonl.gz';
		nocache_headers();
		header( 'Content-Type: application/gzip' );
		header( 'Content-Disposition: attachment; filename="' . $name . '"' );
		header( 'X-Content-Type-Options: nosniff' );
		LegacyBackup::export(
			$backup,
			static function ( string $chunk ): void {
				echo $chunk; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary file data.
			}
		);
		exit;
	}

	/**
	 * Deletes every restore point, after the confirmation.
	 */
	public static function handle_delete(): void {
		self::check( self::DELETE );
		if ( empty( $_POST['confirm'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
			wp_safe_redirect( self::view_url( 'delete', array( 'error' => 'not_confirmed' ) ) );
			exit;
		}
		$count = LegacyBackup::delete_all();
		if ( null === $count ) {
			wp_safe_redirect( self::view_url( 'delete', array( 'error' => 'busy' ) ) );
			exit;
		}
		wp_safe_redirect(
			self::view_url(
				'result',
				array(
					'what'  => 'deleted',
					'count' => $count,
				)
			)
		);
		exit;
	}

	/**
	 * Restores the 3.x data from a restore point, after the confirmation.
	 */
	public static function handle_restore(): void {
		self::check( self::RESTORE );
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		$id      = isset( $_POST['backup'] ) ? sanitize_key( wp_unslash( $_POST['backup'] ) ) : '';
		$confirm = ! empty( $_POST['confirm'] );
		// phpcs:enable WordPress.Security.NonceVerification.Missing
		$error = $confirm ? LegacyRestore::start( $id ) : 'not_confirmed';
		if ( '' === $error ) {
			wp_safe_redirect( self::view_url( 'restoring', array( 'backup' => $id ) ) );
			exit;
		}
		wp_safe_redirect(
			self::view_url(
				'restore',
				array(
					'backup' => $id,
					'error'  => $error,
				)
			)
		);
		exit;
	}

	/**
	 * Compares the 3.x data with a restore point (only reads).
	 */
	public static function handle_check(): void {
		self::check( self::CHECK );
		$id    = isset( $_POST['backup'] ) ? sanitize_key( wp_unslash( $_POST['backup'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		$error = LegacyCheck::start( $id );
		wp_safe_redirect( '' === $error ? self::view_url( 'check', array( 'backup' => $id ) ) : self::url( array( 'error' => $error ) ) );
		exit;
	}

	/**
	 * Goes back to Funnelforms 3 with every form, or forward to Funnelforms 5 again.
	 */
	public static function handle_mode(): void {
		self::check( self::MODE );
		$to = isset( $_POST['to'] ) ? sanitize_key( wp_unslash( $_POST['to'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		if ( 'legacy' === $to ) {
			$moved = Rollback::to_legacy();
			wp_safe_redirect(
				self::view_url(
					'result',
					array(
						'what'  => 'back',
						'forms' => $moved,
					)
				)
			);
			exit;
		}
		$result = Rollback::to_v5();
		wp_safe_redirect(
			self::view_url(
				'result',
				array(
					'what'   => 'forward',
					'forms'  => $result['switched'],
					'stayed' => count( $result['stayed'] ),
				)
			)
		);
		exit;
	}

	/**
	 * Puts one form back on Funnelforms 3.
	 */
	public static function handle_form_back(): void {
		$form_id = isset( $_POST['form'] ) ? absint( $_POST['form'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked next.
		self::check( self::FORM_BACK . '_' . $form_id );
		$result = Rollback::form_to_legacy( $form_id );
		wp_safe_redirect(
			$result['ok'] ? self::view_url(
				'result',
				array(
					'what' => 'form_back',
					'form' => $form_id,
				)
			) : MigrationPage::url( array( 'tab' => 'forms' ) )
		);
		exit;
	}

	/**
	 * AJAX (through MigrationPage): moves a job on and says how far it is.
	 *
	 * @param string $job check, restore or backup.
	 * @return array{status:string,percent:int,text:string}
	 */
	public static function drive( string $job ): array {
		switch ( $job ) {
			case 'check':
				return self::check_progress( LegacyCheck::step( 3.0 ) );
			case 'restore':
				$state = LegacyRestore::state();
				if ( 'backing_up' === $state['status'] ) {
					LegacyBackup::step( 3.0 );
				} elseif ( 'running' === $state['status'] ) {
					LegacyRestore::step( 3.0 );
				}
				return self::restore_progress( LegacyRestore::state() );
			case 'backup':
				if ( LegacyBackup::running() ) {
					LegacyBackup::step( 3.0 );
				}
				return self::backup_progress( LegacyBackup::state() );
		}
		return array(
			'status'  => 'failed',
			'percent' => 0,
			'text'    => '',
		);
	}

	/**
	 * Progress of a check.
	 *
	 * @param array<string,mixed> $state LegacyCheck::state().
	 * @return array{status:string,percent:int,text:string}
	 */
	private static function check_progress( array $state ): array {
		$total = max( 1, (int) $state['total'] );
		return array(
			'status'  => 'running' === $state['status'] ? 'running' : ( 'done' === $state['status'] ? 'done' : 'failed' ),
			'percent' => 'done' === $state['status'] ? 100 : (int) min( 99, round( 100 * (int) $state['rows'] / $total ) ),
			'text'    => 'failed' === $state['status'] ? self::error_label( (string) $state['error'] ) : sprintf(
				/* translators: 1: rows compared, 2: all rows. */
				__( 'Comparing … %1$s of %2$s rows', 'funnelforms-free' ),
				number_format_i18n( (int) $state['rows'] ),
				number_format_i18n( (int) $state['total'] )
			),
		);
	}

	/**
	 * Progress of a restore: first the restore point of the state now, then the restore.
	 *
	 * @param array<string,mixed> $state LegacyRestore::state().
	 * @return array{status:string,percent:int,text:string}
	 */
	private static function restore_progress( array $state ): array {
		$backup = LegacyBackup::find( (string) $state['backup'] );
		$total  = max( 1, null === $backup ? 1 : LegacyBackup::rows_total( $backup ) );
		return match ( (string) $state['status'] ) {
			'backing_up' => array(
				'status'  => 'running',
				'percent' => 10,
				'text'    => __( 'Saving the current state first, so this restore can be undone too …', 'funnelforms-free' ),
			),
			'running'    => array(
				'status'  => 'running',
				'percent' => (int) min( 99, 20 + round( 80 * (int) $state['rows'] / $total ) ),
				/* translators: 1: rows looked at, 2: all rows. */
				'text'    => sprintf( __( 'Restoring … %1$s of %2$s rows looked at', 'funnelforms-free' ), number_format_i18n( (int) $state['rows'] ), number_format_i18n( $total ) ),
			),
			'done'       => array(
				'status'  => 'done',
				'percent' => 100,
				'text'    => __( 'Done.', 'funnelforms-free' ),
			),
			default      => array(
				'status'  => 'failed',
				'percent' => 0,
				'text'    => self::error_label( (string) $state['error'] ),
			),
		};
	}

	/**
	 * Progress of a restore point being written.
	 *
	 * @param array<string,mixed> $state LegacyBackup::state().
	 * @return array{status:string,percent:int,text:string}
	 */
	private static function backup_progress( array $state ): array {
		if ( 'running' !== $state['status'] ) {
			return array(
				'status'  => 'failed' === $state['status'] ? 'failed' : 'done',
				'percent' => 100,
				'text'    => 'failed' === $state['status'] ? self::error_label( (string) $state['error'] ) : __( 'Done.', 'funnelforms-free' ),
			);
		}
		// The last restore point is a good guess for the size of this one.
		$latest  = LegacyBackup::latest();
		$guess   = null === $latest ? 0 : LegacyBackup::rows_total( $latest );
		$written = (int) array_sum( array_map( 'intval', (array) $state['counts'] ) );
		$percent = $guess > 0 ? (int) min( 95, round( 100 * $written / $guess ) ) : ( 'options' === $state['phase'] ? 90 : 40 );
		return array(
			'status'  => 'running',
			'percent' => $percent,
			/* translators: %s: number of rows. */
			'text'    => sprintf( __( 'Saving a restore point … %s rows so far', 'funnelforms-free' ), number_format_i18n( $written ) ),
		);
	}

	/*
	 * Notice.
	 */

	/**
	 * While Funnelforms 3 is back: a note on its pages and on the Funnelforms pages, with the way
	 * forward.
	 */
	public static function notice(): void {
		global $plugin_page;
		if ( ! Rollback::active() || ! current_user_can( 'manage_options' ) || ! is_string( $plugin_page ) ) {
			return;
		}
		if ( ! str_starts_with( $plugin_page, 'af2_' ) && ! str_starts_with( $plugin_page, Menu::SLUG ) ) {
			return;
		}
		echo '<div class="notice notice-info"><p>';
		echo esc_html__( 'Your forms run on Funnelforms 3 again. The data of Funnelforms 3 is unchanged.', 'funnelforms-free' ) . ' ';
		echo '<a href="' . esc_url( self::url() ) . '">' . esc_html__( 'Back to Funnelforms 5', 'funnelforms-free' ) . '</a>';
		echo '</p></div>';
	}

	/*
	 * The way back tab.
	 */

	/**
	 * Renders the way back where it is embedded outside the migration page (Settings).
	 */
	public static function render(): void {
		if ( current_user_can( 'manage_options' ) ) {
			self::render_cards();
			// Moves a running restore point or check on and shows its progress, as on the migration page.
			MigrationPage::scripts();
		}
	}

	/**
	 * The tab: back to Funnelforms 3 or forward again, the restore point, its check, all restore
	 * points.
	 */
	public static function render_cards(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		self::messages();
		echo '<div class="ffx-mig-wayback">';
		self::render_way_back();
		self::render_restore_point();
		self::render_backups();
		echo '</div>';
	}

	/**
	 * Results of the last action on the tab.
	 */
	private static function messages(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- display only.
		$done  = isset( $_GET['done'] ) ? sanitize_key( wp_unslash( $_GET['done'] ) ) : '';
		$error = isset( $_GET['error'] ) ? sanitize_key( wp_unslash( $_GET['error'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Recommended
		if ( 'backup' === $done ) {
			echo '<div class="notice notice-success" role="status"><p>' . esc_html__( 'The restore point is being written. This page shows when it is done.', 'funnelforms-free' ) . '</p></div>';
		}
		if ( '' !== $error ) {
			echo '<div class="notice notice-error" role="alert"><p>' . esc_html( self::error_label( $error ) ) . '</p></div>';
		}
	}

	/**
	 * Card: back to Funnelforms 3, or forward again.
	 */
	private static function render_way_back(): void {
		$active = Rollback::active();
		$impact = Rollback::impact();
		?>
		<section class="ffx-card ffx-wayback<?php echo $active ? ' is-active' : ''; ?>" id="ffx-way-back" aria-labelledby="ffx-way-back-title">
			<div class="ffx-card__head">
				<div>
					<h2 id="ffx-way-back-title"><?php echo $active ? esc_html__( 'You are on Funnelforms 3 again', 'funnelforms-free' ) : esc_html__( 'Back to Funnelforms 3 with one click', 'funnelforms-free' ); ?></h2>
					<p>
						<?php
						if ( $active ) {
							$since = Rollback::record()['since'];
							echo esc_html(
								'' === $since ? __( 'Your forms from Funnelforms 3 run on Funnelforms 3. One click brings them back to Funnelforms 5.', 'funnelforms-free' )
								/* translators: %s: date and time. */
								: sprintf( __( 'Since %s your forms from Funnelforms 3 run on Funnelforms 3. One click brings them back to Funnelforms 5.', 'funnelforms-free' ), self::date( $since ) )
							);
						} else {
							esc_html_e( 'If something does not work as before, your forms go back to Funnelforms 3, all at once or one by one. The data of Funnelforms 3 was never changed, so everything is where it was. One more click brings you forward again.', 'funnelforms-free' );
						}
						?>
					</p>
				</div>
				<?php echo Ui::badge( $active ? __( 'Funnelforms 3 active', 'funnelforms-free' ) : __( 'Funnelforms 5 active', 'funnelforms-free' ), $active ? 'warning' : 'success' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in Ui. ?>
			</div>
			<ul class="ffx-facts">
				<?php
				if ( $active ) {
					$count = count( Rollback::record()['forms'] );
					/* translators: %d: number of forms. */
					self::fact( sprintf( _n( '%d form goes back to Funnelforms 5 when you go forward', '%d forms go back to Funnelforms 5 when you go forward', $count, 'funnelforms-free' ), $count ) );
					self::fact( __( 'The copy in Funnelforms 5 keeps in step with Funnelforms 3 every hour, so new leads are there too', 'funnelforms-free' ) );
				} else {
					/* translators: %d: number of forms. */
					self::fact( sprintf( _n( '%d form from Funnelforms 3 runs on Funnelforms 5', '%d forms from Funnelforms 3 run on Funnelforms 5', $impact['forms'], 'funnelforms-free' ), $impact['forms'] ) );
				}
				self::impact_facts( $impact );
				?>
			</ul>
			<div class="ffx-hero__actions">
				<?php
				if ( $active ) {
					self::forward_button();
				} elseif ( $impact['forms'] > 0 ) {
					echo Ui::button( __( 'All forms back to Funnelforms 3', 'funnelforms-free' ), self::view_url( 'back' ), 'secondary', 'undo' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
					$one = MigrationPage::url(
						array(
							'tab'  => 'forms',
							'show' => 'v5',
						)
					);
					echo Ui::button( __( 'Choose one form', 'funnelforms-free' ), $one, 'ghost', 'form' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
				} else {
					echo '<p class="ffx-muted">' . esc_html__( 'No form from Funnelforms 3 runs on Funnelforms 5 at the moment, so there is nothing to take back.', 'funnelforms-free' ) . '</p>';
				}
				?>
			</div>
		</section>
		<?php
	}

	/**
	 * What going back means for the data, as facts.
	 *
	 * @param array<string,mixed> $impact Rollback::impact().
	 */
	private static function impact_facts( array $impact ): void {
		if ( $impact['new_entries'] > 0 ) {
			self::fact(
				$impact['mirror']
					/* translators: 1: entries, 2: of those, in the Funnelforms 3 lead list. */
					? sprintf( _n( '%1$s entry came in on Funnelforms 5: it stays in Funnelforms 5 → Entries, and %2$s of them are in the Funnelforms 3 lead list too', '%1$s entries came in on Funnelforms 5: they stay in Funnelforms 5 → Entries, and %2$s of them are in the Funnelforms 3 lead list too', $impact['new_entries'], 'funnelforms-free' ), number_format_i18n( $impact['new_entries'] ), number_format_i18n( $impact['mirrored'] ) )
					/* translators: %s: number of entries. */
					: sprintf( _n( '%s entry came in on Funnelforms 5: it stays in Funnelforms 5 → Entries', '%s entries came in on Funnelforms 5: they stay in Funnelforms 5 → Entries', $impact['new_entries'], 'funnelforms-free' ), number_format_i18n( $impact['new_entries'] ) )
			);
		}
		if ( $impact['edited'] > 0 ) {
			/* translators: %d: number of forms. */
			self::fact( sprintf( _n( '%d form was changed in the form builder: the change is kept for the way forward', '%d forms were changed in the form builder: the changes are kept for the way forward', $impact['edited'], 'funnelforms-free' ), $impact['edited'] ) );
		}
		if ( $impact['own_forms'] > 0 ) {
			/* translators: %d: number of forms. */
			self::fact( sprintf( _n( '%d form made in Funnelforms 5 keeps running, it has no Funnelforms 3 version', '%d forms made in Funnelforms 5 keep running, they have no Funnelforms 3 version', $impact['own_forms'], 'funnelforms-free' ), $impact['own_forms'] ) );
		}
		self::fact( __( 'Nothing is deleted: leads, appointments and settings of both versions stay where they are', 'funnelforms-free' ) );
	}

	/**
	 * One fact with a check mark.
	 *
	 * @param string $text Text.
	 */
	private static function fact( string $text ): void {
		echo '<li>' . Ui::icon( 'check' ) . '<span>' . esc_html( $text ) . '</span></li>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
	}

	/**
	 * Button: forward to Funnelforms 5 again.
	 */
	public static function forward_button(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::MODE ); ?>">
			<input type="hidden" name="to" value="v5">
			<?php wp_nonce_field( self::MODE ); ?>
			<button type="submit" class="ffx-btn ffx-btn--primary"><?php echo Ui::icon( 'rocket' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Back to Funnelforms 5', 'funnelforms-free' ); ?></span></button>
		</form>
		<?php
	}

	/**
	 * Card: the restore point the way back relies on, and whether Funnelforms 3 still matches it.
	 */
	private static function render_restore_point(): void {
		$backup = LegacyBackup::latest();
		$first  = LegacyBackup::all()[0] ?? null;
		$check  = LegacyCheck::state();
		$busy   = self::busy();
		?>
		<section class="ffx-card ffx-section" id="ffx-restore-point" aria-labelledby="ffx-restore-point-title">
			<div class="ffx-card__head">
				<div>
					<h2 id="ffx-restore-point-title"><?php esc_html_e( 'Your restore point', 'funnelforms-free' ); ?></h2>
					<p><?php esc_html_e( 'A copy of all your Funnelforms 3 data, exactly as it is stored. If the data of Funnelforms 3 gets damaged, for example by another plugin or a mistake in the database, the restore point brings it back.', 'funnelforms-free' ); ?></p>
					<p class="ffx-muted"><?php esc_html_e( 'It holds the forms, questions, contact forms, leads, appointments and settings of Funnelforms 3. What you build in Funnelforms 5 is not in it: the form builder keeps every published version of a form under Versions.', 'funnelforms-free' ); ?></p>
				</div>
			</div>
			<?php if ( null === $backup && null !== LegacyBackup::retired() ) : ?>
				<p class="ffx-mig-status is-ok"><?php echo esc_html( self::retired_text() ); ?></p>
			<?php elseif ( null === $backup ) : ?>
				<p class="ffx-mig-status is-warn"><?php esc_html_e( 'There is no restore point yet. Funnelforms writes one before it copies your data; you can also create one below.', 'funnelforms-free' ); ?></p>
			<?php else : ?>
				<?php self::details( $backup ); ?>
				<?php if ( null !== $first && $first['id'] !== $backup['id'] ) : ?>
					<p class="ffx-muted ffx-small">
						<?php
						/* translators: %s: date and time. */
						echo esc_html( sprintf( __( 'The very first restore point, from %s before the move, is kept as well.', 'funnelforms-free' ), self::date( (string) $first['created_at'] ) ) );
						?>
					</p>
				<?php endif; ?>
				<?php self::check_summary( $check ); ?>
				<div class="ffx-hero__actions">
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline">
						<input type="hidden" name="action" value="<?php echo esc_attr( self::CHECK ); ?>">
						<input type="hidden" name="backup" value="<?php echo esc_attr( (string) $backup['id'] ); ?>">
						<?php wp_nonce_field( self::CHECK ); ?>
						<button type="submit" class="ffx-btn" <?php disabled( $busy ); ?>><?php echo Ui::icon( 'shield' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Check Funnelforms 3 against it', 'funnelforms-free' ); ?></span></button>
					</form>
					<?php echo Ui::button( __( 'Restore', 'funnelforms-free' ), self::view_url( 'restore', array( 'backup' => (string) $backup['id'] ) ), 'ghost', 'history' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
					<?php if ( self::may_download() ) : ?>
						<?php echo Ui::button( __( 'Download', 'funnelforms-free' ), self::download_url( $backup ), 'ghost', 'download' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
					<?php endif; ?>
				</div>
			<?php endif; ?>
		</section>
		<?php
	}

	/**
	 * When, why, what and how big a restore point is.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	private static function details( array $backup ): void {
		?>
		<dl class="ffx-mig-point">
			<div><dt><?php esc_html_e( 'Created', 'funnelforms-free' ); ?></dt><dd><?php echo esc_html( self::date( (string) $backup['created_at'] ) ); ?> <span class="ffx-muted"><?php echo esc_html( self::age( $backup ) ); ?></span></dd></div>
			<div><dt><?php esc_html_e( 'Occasion', 'funnelforms-free' ); ?></dt><dd><?php echo esc_html( self::reason_label( (string) $backup['reason'] ) ); ?></dd></div>
			<div><dt><?php esc_html_e( 'Size', 'funnelforms-free' ); ?></dt><dd><?php echo esc_html( size_format( (int) $backup['bytes'] ) ); ?></dd></div>
			<div><dt><?php esc_html_e( 'State', 'funnelforms-free' ); ?></dt><dd><?php echo self::state_badge( $backup, __( 'Complete and unchanged', 'funnelforms-free' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in Ui. ?></dd></div>
		</dl>
		<ul class="ffx-mig-contents" aria-label="<?php esc_attr_e( 'Content', 'funnelforms-free' ); ?>">
			<?php foreach ( self::contents( $backup ) as $kind => $count ) : ?>
				<li><strong><?php echo esc_html( number_format_i18n( $count ) ); ?></strong><span><?php echo esc_html( MigrationTexts::row_kind( $kind ) ); ?></span></li>
			<?php endforeach; ?>
		</ul>
		<?php
	}

	/**
	 * Rows of a restore point per kind, the ones people know first.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @return array<string,int>
	 */
	private static function contents( array $backup ): array {
		$counts = array_map( 'intval', (array) $backup['counts'] );
		$out    = array();
		foreach ( array( LegacyRepository::FORM, LegacyRepository::QUESTION, LegacyRepository::CONTACT_FORM, LegacyRepository::CALCULATION, LegacyRepository::LEAD, LegacyRepository::BOOKING, LegacyRepository::BOOKING_TYPE, 'options' ) as $kind ) {
			if ( ! empty( $counts[ $kind ] ) || in_array( $kind, array( LegacyRepository::FORM, LegacyRepository::LEAD ), true ) ) {
				$out[ $kind ] = (int) ( $counts[ $kind ] ?? 0 );
			}
		}
		return $out;
	}

	/**
	 * The last check of the 3.x data, in one line.
	 *
	 * @param array<string,mixed> $check LegacyCheck::state().
	 */
	private static function check_summary( array $check ): void {
		if ( 'running' === $check['status'] ) {
			echo '<p class="ffx-mig-status is-info">' . esc_html__( 'The check is running.', 'funnelforms-free' ) . ' <a href="' . esc_url( self::view_url( 'check', array( 'backup' => (string) $check['backup'] ) ) ) . '">' . esc_html__( 'Show progress', 'funnelforms-free' ) . '</a></p>';
			return;
		}
		if ( 'done' !== $check['status'] ) {
			return;
		}
		$totals = LegacyCheck::totals( $check );
		$report = self::view_url(
			'result',
			array(
				'what'   => 'check',
				'backup' => (string) $check['backup'],
			)
		);
		if ( 0 === $totals['missing'] && 0 === $totals['changed'] ) {
			/* translators: %s: date and time. */
			echo '<p class="ffx-mig-status is-ok">' . esc_html( sprintf( __( 'Checked %s: everything of the restore point is still there, unchanged.', 'funnelforms-free' ), self::date( (string) $check['finished'] ) ) ) . '</p>';
			return;
		}
		echo '<p class="ffx-mig-status ' . ( $totals['missing'] > 0 ? 'is-warn' : 'is-info' ) . '">' . esc_html(
			sprintf(
				/* translators: 1: date and time, 2: rows missing, 3: rows changed. */
				__( 'Checked %1$s: %2$s rows are missing and %3$s were changed since the restore point.', 'funnelforms-free' ),
				self::date( (string) $check['finished'] ),
				number_format_i18n( $totals['missing'] ),
				number_format_i18n( $totals['changed'] )
			)
		) . ' <a href="' . esc_url( $report ) . '">' . esc_html__( 'See the report', 'funnelforms-free' ) . '</a></p>';
	}

	/**
	 * Card: every restore point.
	 */
	private static function render_backups(): void {
		$busy    = self::busy();
		$backups = array_reverse( LegacyBackup::all() );
		$failed  = LegacyBackup::state();
		$restore = LegacyRestore::state();
		?>
		<section class="ffx-card ffx-section" id="ffx-backups" aria-labelledby="ffx-backups-title">
			<div class="ffx-card__head">
				<div>
					<h2 id="ffx-backups-title"><?php esc_html_e( 'All restore points', 'funnelforms-free' ); ?></h2>
					<p><?php esc_html_e( 'Funnelforms writes one before the move to Funnelforms 5 and before every restore, and keeps the first one and the newest one. A restore puts back what was changed or deleted and keeps everything that came in later.', 'funnelforms-free' ); ?></p>
				</div>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="<?php echo esc_attr( self::BACKUP ); ?>">
					<?php wp_nonce_field( self::BACKUP ); ?>
					<button type="submit" class="ffx-btn" <?php disabled( $busy ); ?>><?php echo Ui::icon( 'database' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Create a restore point', 'funnelforms-free' ); ?></span></button>
				</form>
			</div>
			<?php
			if ( LegacyBackup::running() && 'backing_up' !== $restore['status'] ) {
				MigrationPage::job( 'backup', self::backup_progress( LegacyBackup::state() ) );
			} elseif ( in_array( $restore['status'], array( 'backing_up', 'running' ), true ) ) {
				echo '<p class="ffx-mig-status is-info">' . esc_html__( 'A restore is running.', 'funnelforms-free' ) . ' <a href="' . esc_url( self::view_url( 'restoring', array( 'backup' => (string) $restore['backup'] ) ) ) . '">' . esc_html__( 'Show progress', 'funnelforms-free' ) . '</a></p>';
			}
			if ( 'failed' === $failed['status'] ) {
				echo '<div class="notice notice-error inline"><p>' . esc_html( self::error_label( (string) $failed['error'] ) ) . '</p></div>';
			}
			?>
			<?php self::storage( $backups ); ?>
			<?php if ( array() === $backups ) : ?>
				<p class="ffx-muted"><?php echo esc_html( null === LegacyBackup::retired() ? __( 'There is no restore point yet.', 'funnelforms-free' ) : self::retired_text() ); ?></p>
			<?php else : ?>
				<div class="ffx-table-wrap">
					<table class="ffx-table ffx-mig-table ffx-mig-points">
						<thead>
							<tr>
								<th scope="col"><?php esc_html_e( 'Created', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'Occasion', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'Content', 'funnelforms-free' ); ?></th>
								<th scope="col"><?php esc_html_e( 'Check', 'funnelforms-free' ); ?></th>
								<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Actions', 'funnelforms-free' ); ?></span></th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $backups as $backup ) : ?>
								<?php self::row( $backup ); ?>
							<?php endforeach; ?>
						</tbody>
					</table>
				</div>
				<div class="ffx-hero__actions">
					<?php echo Ui::button( __( 'Delete restore points', 'funnelforms-free' ), self::view_url( 'delete' ), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
				</div>
			<?php endif; ?>
		</section>
		<?php
	}

	/**
	 * Where the restore points are, how they are protected and how long they stay.
	 *
	 * @param list<array<string,mixed>> $backups Backups.
	 */
	private static function storage( array $backups ): void {
		$encrypted = array() === $backups || LegacyBackup::encrypted( $backups[0] );
		foreach ( $backups as $backup ) {
			$encrypted = $encrypted && LegacyBackup::encrypted( $backup );
		}
		$days = LegacyBackup::max_age();
		?>
		<dl class="ffx-mig-point ffx-mig-storage">
			<div><dt><?php esc_html_e( 'Kept in', 'funnelforms-free' ); ?></dt><dd><code><?php echo esc_html( LegacyBackup::where() ); ?></code></dd></div>
			<div><dt><?php esc_html_e( 'Protection', 'funnelforms-free' ); ?></dt><dd>
				<?php
				echo esc_html(
					$encrypted
						? __( 'No access from the web. The files are encrypted with the key of your site, so a copy is of no use elsewhere.', 'funnelforms-free' )
						: __( 'No access from the web. Older restore points are not encrypted yet; new ones are.', 'funnelforms-free' )
				);
				?>
			</dd></div>
			<div><dt><?php esc_html_e( 'Kept for', 'funnelforms-free' ); ?></dt><dd>
				<?php
				echo esc_html(
					LegacyBackup::migration_verified()
						/* translators: %d: number of days. */
						? sprintf( _n( 'Your move is complete: restore points are deleted on their own once they are older than %d day.', 'Your move is complete: restore points are deleted on their own once they are older than %d days.', $days, 'funnelforms-free' ), $days )
						/* translators: %d: number of days. */
						: sprintf( _n( 'Until your move is complete. After that, restore points are deleted on their own once they are older than %d day.', 'Until your move is complete. After that, restore points are deleted on their own once they are older than %d days.', $days, 'funnelforms-free' ), $days )
				);
				?>
			</dd></div>
		</dl>
		<?php
	}

	/**
	 * How old a restore point is, in words.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	private static function age( array $backup ): string {
		$days = LegacyBackup::age_days( $backup );
		/* translators: %d: number of days. */
		return 0 === $days ? __( '(today)', 'funnelforms-free' ) : sprintf( _n( '(%d day old)', '(%d days old)', $days, 'funnelforms-free' ), $days );
	}

	/**
	 * Badge with the state of a restore point.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @param string              $ok     Label when it can be used.
	 */
	private static function state_badge( array $backup, string $ok ): string {
		return match ( LegacyBackup::problem( $backup ) ) {
			''       => Ui::badge( $ok, 'success' ),
			'locked' => Ui::badge( __( 'Cannot be read: the key of the site changed', 'funnelforms-free' ), 'warning' ),
			default  => Ui::badge( __( 'Damaged or missing', 'funnelforms-free' ), 'danger' ),
		};
	}

	/**
	 * When and why all restore points were deleted.
	 */
	private static function retired_text(): string {
		$retired = LegacyBackup::retired();
		if ( null === $retired ) {
			return '';
		}
		return 'age' === $retired['why']
			/* translators: %s: date. */
			? sprintf( __( 'Your move is complete, so the restore points were deleted on %s, as planned. The data of Funnelforms 3 is still there, and the way back keeps working.', 'funnelforms-free' ), self::date( $retired['at'], false ) )
			/* translators: %s: date. */
			: sprintf( __( 'You deleted the restore points on %s. The data of Funnelforms 3 is still there, and the way back keeps working.', 'funnelforms-free' ), self::date( $retired['at'], false ) );
	}

	/**
	 * One restore point.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	private static function row( array $backup ): void {
		$counts     = (array) $backup['counts'];
		$ok         = '' === LegacyBackup::problem( $backup );
		$form_count = (int) ( $counts[ LegacyRepository::FORM ] ?? 0 );
		$lead_count = (int) ( $counts[ LegacyRepository::LEAD ] ?? 0 );
		?>
		<tr>
			<td><?php echo esc_html( self::date( (string) $backup['created_at'] ) ); ?><br><span class="ffx-muted ffx-small"><?php echo esc_html( self::age( $backup ) ); ?></span></td>
			<td><?php echo esc_html( self::reason_label( (string) $backup['reason'] ) ); ?></td>
			<td>
				<?php
				/* translators: %d: number of forms. */
				echo esc_html( sprintf( _n( '%d form', '%d forms', $form_count, 'funnelforms-free' ), $form_count ) ) . ', ';
				/* translators: %d: number of leads. */
				echo esc_html( sprintf( _n( '%d lead', '%d leads', $lead_count, 'funnelforms-free' ), $lead_count ) ) . ', ';
				echo esc_html( size_format( (int) $backup['bytes'] ) );
				?>
			</td>
			<td><?php echo self::state_badge( $backup, __( 'Complete', 'funnelforms-free' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in Ui. ?></td>
			<td class="ffx-table__actions">
				<?php if ( $ok ) : ?>
					<?php if ( self::may_download() ) : ?>
						<a class="ffx-btn ffx-btn--sm ffx-btn--ghost" href="<?php echo esc_url( self::download_url( $backup ) ); ?>"><?php echo Ui::icon( 'download' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Download', 'funnelforms-free' ); ?></span></a>
					<?php endif; ?>
					<a class="ffx-btn ffx-btn--sm ffx-btn--ghost" href="<?php echo esc_url( self::view_url( 'restore', array( 'backup' => (string) $backup['id'] ) ) ); ?>"><?php echo Ui::icon( 'history' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Restore', 'funnelforms-free' ); ?></span></a>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/*
	 * Steps: ask first, run, report.
	 */

	/**
	 * One step of the way back on a page of its own.
	 *
	 * @param string $view back, restore, check, restoring or result.
	 */
	public static function render_view( string $view ): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- navigation only.
		$form   = isset( $_GET['form'] ) ? absint( $_GET['form'] ) : 0;
		$backup = isset( $_GET['backup'] ) ? sanitize_key( wp_unslash( $_GET['backup'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Recommended
		echo '<p class="ffx-mig-back"><a href="' . esc_url( self::url() ) . '">' . Ui::icon( 'back' ) . '<span>' . esc_html__( 'Way back', 'funnelforms-free' ) . '</span></a></p>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
		echo '<div class="ffx-mig ffx-mig-step">';
		if ( 'back' === $view && $form > 0 ) {
			self::view_form_back( $form );
		} elseif ( 'back' === $view ) {
			self::view_back();
		} elseif ( 'restore' === $view ) {
			self::view_restore( $backup );
		} elseif ( 'check' === $view ) {
			self::view_check( $backup );
		} elseif ( 'restoring' === $view ) {
			self::view_restoring();
		} elseif ( 'delete' === $view ) {
			self::view_delete();
		} elseif ( 'result' === $view ) {
			self::view_result();
		} else {
			self::view_missing();
		}
		echo '</div>';
	}

	/**
	 * Asks before every form goes back.
	 */
	private static function view_back(): void {
		$impact = Rollback::impact();
		if ( Rollback::active() ) {
			self::step_head( 'undo', __( 'You are on Funnelforms 3 already', 'funnelforms-free' ), __( 'Your forms from Funnelforms 3 run on Funnelforms 3. Go forward again whenever you like.', 'funnelforms-free' ) );
			echo '<div class="ffx-hero__actions">';
			self::forward_button();
			echo '</div>';
			return;
		}
		self::step_head( 'undo', __( 'All forms back to Funnelforms 3?', 'funnelforms-free' ), __( 'Your visitors see the Funnelforms 3 version of every form again, and the menu of Funnelforms 3 comes back. You can go forward again with one click.', 'funnelforms-free' ) );
		?>
		<div class="ffx-split">
			<section class="ffx-card" aria-labelledby="ffx-step-happens">
				<h3 id="ffx-step-happens"><?php esc_html_e( 'What happens', 'funnelforms-free' ); ?></h3>
				<ul class="ffx-facts">
					<?php
					/* translators: %d: number of forms. */
					self::fact( sprintf( _n( '%d form switches back to Funnelforms 3', '%d forms switch back to Funnelforms 3', $impact['forms'], 'funnelforms-free' ), $impact['forms'] ) );
					self::fact( __( 'Pages and shortcodes stay as they are: they show the Funnelforms 3 version', 'funnelforms-free' ) );
					self::fact( __( 'The menu of Funnelforms 3 is back, with all its forms, leads and settings', 'funnelforms-free' ) );
					self::fact( __( 'New leads in Funnelforms 3 are copied to Funnelforms 5 every hour, so nothing is missing when you go forward', 'funnelforms-free' ) );
					?>
				</ul>
			</section>
			<section class="ffx-card" aria-labelledby="ffx-step-data">
				<h3 id="ffx-step-data"><?php esc_html_e( 'Your data', 'funnelforms-free' ); ?></h3>
				<ul class="ffx-facts">
					<?php self::impact_facts( $impact ); ?>
				</ul>
			</section>
		</div>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-mig-confirm">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::MODE ); ?>">
			<input type="hidden" name="to" value="legacy">
			<?php wp_nonce_field( self::MODE ); ?>
			<button type="submit" class="ffx-btn ffx-btn--primary ffx-btn--lg"><?php echo Ui::icon( 'undo' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Yes, back to Funnelforms 3', 'funnelforms-free' ); ?></span></button>
			<?php echo Ui::button( __( 'Cancel', 'funnelforms-free' ), self::url(), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
		</form>
		<?php
	}

	/**
	 * Asks before one form goes back.
	 *
	 * @param int $form_id Form ID.
	 */
	private static function view_form_back( int $form_id ): void {
		$form = ( new FormRepository() )->by_id( $form_id );
		if ( null === $form || null === $form['legacy_post_id'] ) {
			self::view_missing();
			return;
		}
		$title  = '' !== (string) $form['title'] ? (string) $form['title'] : __( '(no title)', 'funnelforms-free' );
		$impact = Rollback::form_impact( $form );
		$back   = self::form_url( $form_id );
		if ( 0 === $impact['on_v5'] ) {
			/* translators: %s: form title. */
			self::step_head( 'undo', sprintf( __( '"%s" runs on Funnelforms 3', 'funnelforms-free' ), $title ), __( 'This form already shows its Funnelforms 3 version, so there is nothing to take back.', 'funnelforms-free' ) );
			echo '<div class="ffx-hero__actions">' . Ui::button( __( 'To the form', 'funnelforms-free' ), $back, 'secondary', 'arrow' ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
			return;
		}
		/* translators: %s: form title. */
		self::step_head( 'undo', sprintf( __( 'Put "%s" back on Funnelforms 3?', 'funnelforms-free' ), $title ), __( 'Only this form switches back; all other forms stay where they are. You can move it to Funnelforms 5 again at any time.', 'funnelforms-free' ) );
		?>
		<section class="ffx-card" aria-labelledby="ffx-step-data">
			<h3 id="ffx-step-data"><?php esc_html_e( 'What happens to its data', 'funnelforms-free' ); ?></h3>
			<ul class="ffx-facts">
				<?php
				self::fact( __( 'Visitors see the Funnelforms 3 version of the form again, on the same pages', 'funnelforms-free' ) );
				/* translators: %s: number of leads. */
				self::fact( sprintf( __( '%s leads from Funnelforms 3 stay in both versions', 'funnelforms-free' ), number_format_i18n( $impact['from3'] ) ) );
				if ( $impact['new_entries'] > 0 ) {
					self::fact(
						MigrationPage::mirrors()
							/* translators: 1: entries, 2: of those, in the Funnelforms 3 lead list. */
							? sprintf( __( '%1$s entries that came in on Funnelforms 5 stay in Funnelforms 5 → Entries; %2$s of them are in the Funnelforms 3 lead list too', 'funnelforms-free' ), number_format_i18n( $impact['new_entries'] ), number_format_i18n( $impact['mirrored'] ) )
							/* translators: %s: number of entries. */
							: sprintf( __( '%s entries that came in on Funnelforms 5 stay in Funnelforms 5 → Entries', 'funnelforms-free' ), number_format_i18n( $impact['new_entries'] ) )
					);
				}
				if ( $impact['edited'] > 0 ) {
					self::fact( __( 'Your changes in the form builder are kept and come back when the form moves again', 'funnelforms-free' ) );
				}
				self::fact( __( 'Nothing is deleted', 'funnelforms-free' ) );
				?>
			</ul>
		</section>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-mig-confirm">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::FORM_BACK ); ?>">
			<input type="hidden" name="form" value="<?php echo esc_attr( (string) $form_id ); ?>">
			<?php wp_nonce_field( self::FORM_BACK . '_' . $form_id ); ?>
			<button type="submit" class="ffx-btn ffx-btn--primary ffx-btn--lg"><?php echo Ui::icon( 'undo' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Yes, put this form back', 'funnelforms-free' ); ?></span></button>
			<?php echo Ui::button( __( 'Cancel', 'funnelforms-free' ), $back, 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
		</form>
		<?php
	}

	/**
	 * Asks before a restore, with what it will change: the 3.x data is compared with the restore
	 * point first (this only reads).
	 *
	 * @param string $id Backup ID.
	 */
	private static function view_restore( string $id ): void {
		$backup = LegacyBackup::find( $id );
		if ( null === $backup ) {
			self::view_missing();
			return;
		}
		$error = isset( $_GET['error'] ) ? sanitize_key( wp_unslash( $_GET['error'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		/* translators: %s: date and time. */
		self::step_head( 'history', sprintf( __( 'Restore the state of %s?', 'funnelforms-free' ), self::date( (string) $backup['created_at'] ) ), __( 'The data of Funnelforms 3 gets the state of this restore point back: what is missing is put back and what was changed is changed back. Everything that came in later stays.', 'funnelforms-free' ) );
		if ( '' !== $error ) {
			echo '<div class="notice notice-error inline" role="alert"><p>' . esc_html( self::error_label( $error ) ) . '</p></div>';
		}
		$problem = LegacyBackup::problem( $backup );
		if ( '' !== $problem ) {
			echo '<p class="ffx-mig-status is-warn">' . esc_html( self::error_label( 'locked' === $problem ? 'backup_locked' : 'backup_damaged' ) ) . '</p>';
			return;
		}
		echo '<section class="ffx-card">';
		self::details( $backup );
		echo '</section>';

		// What the restore would change. The comparison only reads; it starts here and runs in steps.
		$check = LegacyCheck::state();
		$fresh = $check['backup'] === $id && ( 'running' === $check['status'] || ( 'done' === $check['status'] && strtotime( $check['finished'] . ' UTC' ) > time() - 10 * MINUTE_IN_SECONDS ) );
		if ( ! $fresh && '' === LegacyCheck::start( $id ) ) {
			$check = LegacyCheck::state();
		}
		?>
		<section class="ffx-card ffx-section" aria-labelledby="ffx-step-preview">
			<h3 id="ffx-step-preview"><?php esc_html_e( 'What the restore changes', 'funnelforms-free' ); ?></h3>
			<?php
			if ( 'running' === $check['status'] ) {
				MigrationPage::job( 'check', self::check_progress( $check ) );
			} elseif ( 'done' === $check['status'] ) {
				self::check_table( $check, true );
			}
			?>
		</section>
		<section class="ffx-card ffx-section" aria-labelledby="ffx-step-safe">
			<h3 id="ffx-step-safe"><?php esc_html_e( 'To be safe', 'funnelforms-free' ); ?></h3>
			<ul class="ffx-facts">
				<?php
				self::fact( __( 'First a new restore point of the state now is written, so the restore can be undone too', 'funnelforms-free' ) );
				self::fact( __( 'Nothing is deleted: leads and forms that came in after the restore point stay', 'funnelforms-free' ) );
				self::fact( __( 'Funnelforms 5 is not touched; it takes over the restored data with its next copy', 'funnelforms-free' ) );
				?>
			</ul>
		</section>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-mig-confirm">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::RESTORE ); ?>">
			<input type="hidden" name="backup" value="<?php echo esc_attr( $id ); ?>">
			<?php wp_nonce_field( self::RESTORE ); ?>
			<label class="ffx-check"><input type="checkbox" name="confirm" value="1" required> <?php esc_html_e( 'Yes, restore this state', 'funnelforms-free' ); ?></label>
			<button type="submit" class="ffx-btn ffx-btn--danger ffx-btn--lg" <?php disabled( self::busy() ); ?>><?php echo Ui::icon( 'history' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Restore now', 'funnelforms-free' ); ?></span></button>
			<?php echo Ui::button( __( 'Cancel', 'funnelforms-free' ), self::url(), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
		</form>
		<?php
	}

	/**
	 * Asks before every restore point is deleted.
	 */
	private static function view_delete(): void {
		$backups = LegacyBackup::all();
		if ( array() === $backups ) {
			self::step_head( 'database', __( 'There are no restore points', 'funnelforms-free' ), null === LegacyBackup::retired() ? __( 'There is nothing to delete.', 'funnelforms-free' ) : self::retired_text() );
			echo '<div class="ffx-hero__actions">' . Ui::button( __( 'Way back', 'funnelforms-free' ), self::url(), 'secondary', 'back' ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
			return;
		}
		$error = isset( $_GET['error'] ) ? sanitize_key( wp_unslash( $_GET['error'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		$bytes = (int) array_sum( array_map( static fn( array $backup ): int => (int) $backup['bytes'], $backups ) );
		self::step_head( 'database', __( 'Delete all restore points?', 'funnelforms-free' ), __( 'The restore points are copies of your Funnelforms 3 data, with its leads and API keys. Delete them once you no longer need to put Funnelforms 3 back to an earlier state.', 'funnelforms-free' ) );
		if ( '' !== $error ) {
			echo '<div class="notice notice-error inline" role="alert"><p>' . esc_html( self::error_label( $error ) ) . '</p></div>';
		}
		?>
		<div class="ffx-split">
			<section class="ffx-card" aria-labelledby="ffx-step-happens">
				<h3 id="ffx-step-happens"><?php esc_html_e( 'What is deleted', 'funnelforms-free' ); ?></h3>
				<ul class="ffx-facts">
					<?php
					/* translators: 1: number of restore points, 2: size, 3: folder. */
					self::fact( sprintf( _n( '%1$s restore point (%2$s) in %3$s', '%1$s restore points (%2$s) in %3$s', count( $backups ), 'funnelforms-free' ), number_format_i18n( count( $backups ) ), size_format( $bytes ), LegacyBackup::where() ) );
					self::fact( __( 'A restore to an earlier state is no longer possible', 'funnelforms-free' ) );
					self::fact( __( 'Funnelforms does not write new ones on its own any more; you can still create one by hand', 'funnelforms-free' ) );
					?>
				</ul>
			</section>
			<section class="ffx-card" aria-labelledby="ffx-step-data">
				<h3 id="ffx-step-data"><?php esc_html_e( 'What stays', 'funnelforms-free' ); ?></h3>
				<ul class="ffx-facts">
					<?php
					self::fact( __( 'All data of Funnelforms 3 and Funnelforms 5: forms, leads, appointments and settings', 'funnelforms-free' ) );
					self::fact( __( 'The way back to Funnelforms 3, for all forms or one by one', 'funnelforms-free' ) );
					?>
				</ul>
			</section>
		</div>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-mig-confirm">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::DELETE ); ?>">
			<?php wp_nonce_field( self::DELETE ); ?>
			<label class="ffx-check"><input type="checkbox" name="confirm" value="1" required> <?php esc_html_e( 'Yes, delete all restore points', 'funnelforms-free' ); ?></label>
			<button type="submit" class="ffx-btn ffx-btn--danger ffx-btn--lg" <?php disabled( LegacyBackup::busy() ); ?>><span><?php esc_html_e( 'Delete now', 'funnelforms-free' ); ?></span></button>
			<?php echo Ui::button( __( 'Cancel', 'funnelforms-free' ), self::url(), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
		</form>
		<?php
	}

	/**
	 * Progress of a check against a restore point; the report follows when it is done.
	 *
	 * @param string $id Backup ID.
	 */
	private static function view_check( string $id ): void {
		$check = LegacyCheck::state();
		if ( $check['backup'] !== $id || 'idle' === $check['status'] ) {
			self::view_missing();
			return;
		}
		if ( 'running' !== $check['status'] ) {
			self::result_check();
			return;
		}
		$report = self::view_url(
			'result',
			array(
				'what'   => 'check',
				'backup' => $id,
			)
		);
		self::step_head( 'shield', __( 'Checking the Funnelforms 3 data', 'funnelforms-free' ), __( 'Every form, question, lead and setting of the restore point is looked up as it is now. This only reads; nothing is changed.', 'funnelforms-free' ) );
		echo '<section class="ffx-card" data-ffx-next="' . esc_url( $report ) . '">';
		MigrationPage::job( 'check', self::check_progress( $check ) );
		echo '</section>';
	}

	/**
	 * Progress of a restore; the report follows when it is done.
	 */
	private static function view_restoring(): void {
		$state  = LegacyRestore::state();
		$report = self::view_url( 'result', array( 'what' => 'restore' ) );
		self::step_head( 'history', __( 'Restoring your Funnelforms 3 data', 'funnelforms-free' ), __( 'You can leave this page; the restore goes on in the background.', 'funnelforms-free' ) );
		echo '<section class="ffx-card" data-ffx-next="' . esc_url( $report ) . '">';
		MigrationPage::job( 'restore', self::restore_progress( $state ) );
		echo '</section>';
	}

	/**
	 * The report after a step.
	 */
	private static function view_result(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- display only.
		$what   = isset( $_GET['what'] ) ? sanitize_key( wp_unslash( $_GET['what'] ) ) : '';
		$forms  = isset( $_GET['forms'] ) ? absint( $_GET['forms'] ) : 0;
		$stayed = isset( $_GET['stayed'] ) ? absint( $_GET['stayed'] ) : 0;
		$form   = isset( $_GET['form'] ) ? absint( $_GET['form'] ) : 0;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended
		switch ( $what ) {
			case 'back':
				/* translators: %d: number of forms. */
				self::step_head( 'check', __( 'You are on Funnelforms 3 again', 'funnelforms-free' ), sprintf( _n( '%d form runs on Funnelforms 3 again, and its menu is back.', '%d forms run on Funnelforms 3 again, and their menu is back.', $forms, 'funnelforms-free' ), $forms ), 'success' );
				echo '<section class="ffx-card"><ul class="ffx-facts">';
				self::fact( __( 'The data of Funnelforms 3 is unchanged', 'funnelforms-free' ) );
				self::fact( __( 'Entries from Funnelforms 5 are still in Funnelforms 5 → Entries', 'funnelforms-free' ) );
				self::fact( __( 'New leads in Funnelforms 3 keep being copied to Funnelforms 5', 'funnelforms-free' ) );
				echo '</ul><div class="ffx-hero__actions">';
				self::forward_button();
				$legacy = defined( 'MAIN_MENU_SLUG' ) ? (string) constant( 'MAIN_MENU_SLUG' ) : '';
				if ( '' !== $legacy ) {
					echo Ui::button( __( 'Open Funnelforms 3', 'funnelforms-free' ), admin_url( 'admin.php?page=' . $legacy ), 'ghost', 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
				}
				echo '</div></section>';
				return;
			case 'forward':
				/* translators: %d: number of forms. */
				self::step_head( 'rocket', __( 'Welcome back on Funnelforms 5', 'funnelforms-free' ), sprintf( _n( '%d form runs on Funnelforms 5 again.', '%d forms run on Funnelforms 5 again.', $forms, 'funnelforms-free' ), $forms ), 'success' );
				if ( $stayed > 0 ) {
					/* translators: %d: number of forms. */
					echo '<p class="ffx-mig-status is-warn">' . esc_html( sprintf( _n( '%d form stays on Funnelforms 3 for now; the migration report says why.', '%d forms stay on Funnelforms 3 for now; the migration report says why.', $stayed, 'funnelforms-free' ), $stayed ) ) . '</p>';
				}
				echo '<div class="ffx-hero__actions">' . Ui::button( __( 'See all forms', 'funnelforms-free' ), MigrationPage::url( array( 'tab' => 'forms' ) ), 'primary', 'arrow' ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
				return;
			case 'form_back':
				$row   = ( new FormRepository() )->by_id( $form );
				$title = null === $row || '' === (string) $row['title'] ? __( '(no title)', 'funnelforms-free' ) : (string) $row['title'];
				/* translators: %s: form title. */
				self::step_head( 'check', sprintf( __( '"%s" runs on Funnelforms 3 again', 'funnelforms-free' ), $title ), __( 'Visitors see its Funnelforms 3 version again. Its entries stay where they are, and its version in the form builder is kept.', 'funnelforms-free' ), 'success' );
				echo '<div class="ffx-hero__actions">' . Ui::button( __( 'To the form', 'funnelforms-free' ), self::form_url( $form ), 'primary', 'arrow' ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
				return;
			case 'deleted':
				$count = isset( $_GET['count'] ) ? absint( $_GET['count'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
				/* translators: %s: number of restore points. */
				self::step_head( 'check', __( 'Restore points deleted', 'funnelforms-free' ), sprintf( _n( '%s restore point was deleted. The data of Funnelforms 3 and Funnelforms 5 is untouched, and the way back keeps working.', '%s restore points were deleted. The data of Funnelforms 3 and Funnelforms 5 is untouched, and the way back keeps working.', $count, 'funnelforms-free' ), number_format_i18n( $count ) ), 'success' );
				echo '<div class="ffx-hero__actions">' . Ui::button( __( 'Way back', 'funnelforms-free' ), self::url(), 'primary', 'arrow' ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
				return;
			case 'restore':
				self::result_restore();
				return;
			case 'check':
				self::result_check();
				return;
		}
		self::view_missing();
	}

	/**
	 * Report of the last restore.
	 */
	private static function result_restore(): void {
		$state = LegacyRestore::state();
		if ( 'failed' === $state['status'] ) {
			self::step_head( 'history', __( 'The restore did not finish', 'funnelforms-free' ), self::error_label( (string) $state['error'] ), 'danger' );
			echo '<p class="ffx-muted">' . esc_html__( 'Nothing was deleted. Rows already put back stay put back; you can start the restore again.', 'funnelforms-free' ) . '</p>';
			return;
		}
		if ( 'done' !== $state['status'] ) {
			self::view_restoring();
			return;
		}
		$c = (array) $state['counts'];
		self::step_head( 'check', __( 'Your Funnelforms 3 data is restored', 'funnelforms-free' ), __( 'Funnelforms 5 takes over the restored data with its next copy, within the hour.', 'funnelforms-free' ), 'success' );
		?>
		<section class="ffx-card">
			<ul class="ffx-mig-figures">
				<li><strong><?php echo esc_html( number_format_i18n( (int) ( $c['restored'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'rows put back', 'funnelforms-free' ); ?></span></li>
				<li><strong><?php echo esc_html( number_format_i18n( (int) ( $c['updated'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'rows changed back', 'funnelforms-free' ); ?></span></li>
				<li><strong><?php echo esc_html( number_format_i18n( (int) ( $c['unchanged'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'rows were fine', 'funnelforms-free' ); ?></span></li>
				<li><strong><?php echo esc_html( number_format_i18n( (int) ( $c['conflicts'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'rows left alone (their place is used by other data)', 'funnelforms-free' ); ?></span></li>
			</ul>
			<?php if ( '' !== (string) $state['finished'] ) : ?>
				<?php /* translators: %s: date and time. */ ?>
				<p class="ffx-muted ffx-small"><?php echo esc_html( sprintf( __( 'Finished %s. A restore point of the state before was written first; you find it under All restore points.', 'funnelforms-free' ), self::date( (string) $state['finished'] ) ) ); ?></p>
			<?php endif; ?>
			<div class="ffx-hero__actions">
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="ffx-inline">
					<input type="hidden" name="action" value="<?php echo esc_attr( self::CHECK ); ?>">
					<input type="hidden" name="backup" value="<?php echo esc_attr( (string) $state['backup'] ); ?>">
					<?php wp_nonce_field( self::CHECK ); ?>
					<button type="submit" class="ffx-btn ffx-btn--primary"><?php echo Ui::icon( 'shield' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?><span><?php esc_html_e( 'Check the result', 'funnelforms-free' ); ?></span></button>
				</form>
				<?php echo Ui::button( __( 'Way back', 'funnelforms-free' ), self::url(), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button(). ?>
			</div>
		</section>
		<?php
	}

	/**
	 * Report of the last check.
	 */
	private static function result_check(): void {
		$check = LegacyCheck::state();
		if ( 'running' === $check['status'] ) {
			self::view_check( (string) $check['backup'] );
			return;
		}
		if ( 'done' !== $check['status'] ) {
			self::step_head( 'shield', __( 'The check did not finish', 'funnelforms-free' ), self::error_label( (string) $check['error'] ), 'danger' );
			return;
		}
		$totals = LegacyCheck::totals( $check );
		$backup = LegacyBackup::find( (string) $check['backup'] );
		$when   = null === $backup ? '' : self::date( (string) $backup['created_at'] );
		if ( 0 === $totals['missing'] && 0 === $totals['changed'] ) {
			/* translators: %s: date and time. */
			self::step_head( 'shield', __( 'Your Funnelforms 3 data is complete', 'funnelforms-free' ), sprintf( __( 'Everything of the restore point of %s is still there, unchanged. There is nothing to restore.', 'funnelforms-free' ), $when ), 'success' );
		} elseif ( 0 === $totals['missing'] ) {
			/* translators: %s: date and time. */
			self::step_head( 'shield', __( 'Your Funnelforms 3 data is complete', 'funnelforms-free' ), sprintf( __( 'Nothing of the restore point of %s is missing. Some rows were changed since, which is normal while Funnelforms 3 is in use (for example lead status or counters).', 'funnelforms-free' ), $when ), 'info' );
		} else {
			/* translators: %s: date and time. */
			self::step_head( 'shield', __( 'Some Funnelforms 3 data is missing', 'funnelforms-free' ), sprintf( __( 'Rows of the restore point of %s are no longer there. If you did not delete them on purpose, restore them: only what is missing or changed is put back.', 'funnelforms-free' ), $when ), 'warning' );
		}
		?>
		<section class="ffx-card">
			<?php self::check_table( $check, false ); ?>
			<div class="ffx-hero__actions">
				<?php
				if ( null !== $backup && $totals['missing'] + $totals['changed'] > 0 ) {
					echo Ui::button( __( 'Restore what is missing', 'funnelforms-free' ), self::view_url( 'restore', array( 'backup' => (string) $backup['id'] ) ), $totals['missing'] > 0 ? 'primary' : 'secondary', 'history' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
				}
				echo Ui::button( __( 'Way back', 'funnelforms-free' ), self::url(), 'ghost' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
				?>
			</div>
		</section>
		<?php
	}

	/**
	 * The result of a check per kind of data.
	 *
	 * @param array<string,mixed> $check   LegacyCheck::state().
	 * @param bool                $preview Whether it previews a restore (says what would happen).
	 */
	private static function check_table( array $check, bool $preview ): void {
		$totals = LegacyCheck::totals( $check );
		if ( $preview ) {
			echo '<p>' . esc_html(
				0 === $totals['missing'] + $totals['changed']
					? __( 'Everything of the restore point is still there, unchanged: the restore would change nothing.', 'funnelforms-free' )
					: sprintf(
						/* translators: 1: rows put back, 2: rows changed back. */
						__( 'The restore puts back %1$s missing rows and changes back %2$s changed rows.', 'funnelforms-free' ),
						number_format_i18n( $totals['missing'] ),
						number_format_i18n( $totals['changed'] )
					)
			) . '</p>';
		}
		$counts = (array) $check['counts'];
		uksort( $counts, static fn( $a, $b ): int => array( in_array( $a, array( 'meta', 'options', 'other' ), true ), (string) $a ) <=> array( in_array( $b, array( 'meta', 'options', 'other' ), true ), (string) $b ) );
		?>
		<div class="ffx-table-wrap">
			<table class="ffx-table ffx-mig-checktable">
				<thead>
					<tr>
						<th scope="col"><?php esc_html_e( 'Data', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Unchanged', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Changed', 'funnelforms-free' ); ?></th>
						<th scope="col"><?php esc_html_e( 'Missing', 'funnelforms-free' ); ?></th>
					</tr>
				</thead>
				<tbody>
					<?php foreach ( $counts as $kind => $c ) : ?>
						<tr>
							<th scope="row"><?php echo esc_html( MigrationTexts::row_kind( (string) $kind ) ); ?></th>
							<td><?php echo esc_html( number_format_i18n( (int) ( $c['same'] ?? 0 ) ) ); ?></td>
							<td><?php echo esc_html( number_format_i18n( (int) ( $c['changed'] ?? 0 ) ) ); ?></td>
							<td class="<?php echo (int) ( $c['missing'] ?? 0 ) > 0 ? 'is-warn' : ''; ?>"><?php echo esc_html( number_format_i18n( (int) ( $c['missing'] ?? 0 ) ) ); ?></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
		<?php if ( $totals['other'] > 0 ) : ?>
			<p class="ffx-muted ffx-small">
				<?php
				/* translators: %s: number of rows. */
				echo esc_html( sprintf( __( '%s rows are left alone: their place in the database now holds other data, which is never overwritten.', 'funnelforms-free' ), number_format_i18n( $totals['other'] ) ) );
				?>
			</p>
		<?php endif; ?>
		<?php
	}

	/**
	 * When a step cannot be shown (an old link).
	 */
	private static function view_missing(): void {
		self::step_head( 'history', __( 'Nothing to do here', 'funnelforms-free' ), __( 'This step is no longer available, for example because it already finished.', 'funnelforms-free' ) );
		echo '<div class="ffx-hero__actions">' . Ui::button( __( 'Way back', 'funnelforms-free' ), self::url(), 'primary', 'arrow' ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button().
	}

	/**
	 * Heading of a step.
	 *
	 * @param string $icon  Icon.
	 * @param string $title Title.
	 * @param string $text  Text.
	 * @param string $tone  neutral, success, info, warning or danger.
	 */
	private static function step_head( string $icon, string $title, string $text, string $tone = 'neutral' ): void {
		?>
		<header class="ffx-mig-step__head is-<?php echo esc_attr( $tone ); ?>">
			<span class="ffx-mig-step__icon"><?php echo Ui::icon( $icon ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
			<div>
				<h2><?php echo esc_html( $title ); ?></h2>
				<p><?php echo esc_html( $text ); ?></p>
			</div>
		</header>
		<?php
	}

	/*
	 * Helpers.
	 */

	/**
	 * Whether a restore point is being written or restored.
	 */
	private static function busy(): bool {
		return LegacyBackup::running() || in_array( LegacyRestore::state()['status'], array( 'backing_up', 'running' ), true );
	}

	/**
	 * Address of a form on the migration page.
	 *
	 * @param int $form_id Form ID.
	 */
	private static function form_url( int $form_id ): string {
		return MigrationPage::url(
			array(
				'tab'  => 'forms',
				'form' => $form_id,
			)
		);
	}

	/**
	 * Whether the current user may take a restore point off the site. The support access may
	 * check and restore, but the leads in a restore point stay on the site (DSGVO).
	 */
	public static function may_download(): bool {
		$support = Edition::pro( SupportAccess::class );
		return current_user_can( 'manage_options' ) && ( null === $support || ! $support::is_support( get_current_user_id() ) );
	}

	/**
	 * Address that downloads a restore point.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	private static function download_url( array $backup ): string {
		return wp_nonce_url(
			add_query_arg(
				array(
					'action' => self::DOWNLOAD,
					'backup' => (string) $backup['id'],
				),
				admin_url( 'admin-post.php' )
			),
			self::DOWNLOAD
		);
	}

	/**
	 * Readable occasion of a restore point.
	 *
	 * @param string $reason Reason code.
	 */
	public static function reason_label( string $reason ): string {
		return match ( $reason ) {
			'before_migration' => __( 'Before the move to Funnelforms 5', 'funnelforms-free' ),
			'before_restore'   => __( 'Before a restore', 'funnelforms-free' ),
			default            => __( 'Created by hand', 'funnelforms-free' ),
		};
	}

	/**
	 * Readable error.
	 *
	 * @param string $code Error code.
	 */
	public static function error_label( string $code ): string {
		return match ( $code ) {
			'backup_not_found' => __( 'This restore point is no longer there.', 'funnelforms-free' ),
			'backup_damaged'   => __( 'This restore point is damaged; it was not used.', 'funnelforms-free' ),
			'backup_locked'    => __( 'This restore point cannot be read: the key of the site changed since it was written (FFX_SECRET_KEY or the salts in wp-config.php). Put the old key back to use it.', 'funnelforms-free' ),
			'busy'             => __( 'A restore point is being written, checked or restored right now. Try again in a moment.', 'funnelforms-free' ),
			'not_confirmed'    => __( 'Please confirm the restore.', 'funnelforms-free' ),
			'not_writable'     => __( 'The restore point could not be written: the uploads folder is not writable. Forms from Funnelforms 3 stay on Funnelforms 3 until a restore point exists.', 'funnelforms-free' ),
			'backup_failed'    => __( 'The restore did not start: the restore point of the current state could not be written first. Make sure the uploads folder is writable.', 'funnelforms-free' ),
			default            => __( 'The restore point could not be written. Forms from Funnelforms 3 stay on Funnelforms 3 until a restore point exists.', 'funnelforms-free' ),
		};
	}

	/**
	 * A stored UTC time in the site's time zone.
	 *
	 * @param string $utc       Y-m-d H:i:s in UTC.
	 * @param bool   $with_time Whether to add the time of day.
	 */
	public static function date( string $utc, bool $with_time = true ): string {
		$time = '' === $utc ? false : strtotime( $utc . ' UTC' );
		if ( false === $time ) {
			return $utc;
		}
		$format = (string) get_option( 'date_format' ) . ( $with_time ? ' ' . get_option( 'time_format' ) : '' );
		return (string) wp_date( $format, $time );
	}

	/**
	 * Rights and nonce of an action.
	 *
	 * @param string $action Action.
	 */
	private static function check( string $action ): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( $action );
	}
}
