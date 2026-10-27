<?php
/**
 * Admin page of the entries (Funnelforms → Entries): the lead list of 5.0.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;
use Funnelforms\Edition\Edition;
use Funnelforms\Http\FileDownload;
use Funnelforms\Http\LeadStagesController;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Prints the mount point of the entries screen of the admin app (packages/builder-ui) and passes
 * it what the entries API does not answer: the forms to filter by, the export link and the
 * user's rights. The page sits next to the builder.
 */
final class EntriesPage {

	public const SLUG = 'funnelforms-entries';

	/**
	 * Hook suffix of the page, once it is registered.
	 *
	 * @var string|null
	 */
	private static ?string $hook = null;

	/**
	 * Registers the page.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ), 21 );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Adds the page below Funnelforms.
	 */
	public static function menu(): void {
		$title      = __( 'Entries', 'funnelforms-free' );
		$hook       = add_submenu_page( Menu::SLUG, $title, $title, FileDownload::capability(), self::SLUG, array( self::class, 'render' ), Menu::POSITIONS['entries'] );
		self::$hook = false === $hook ? null : $hook;
		// The app renders the frame of the other pages; their styles and calm chrome apply.
		Ui::screen( $hook );
	}

	/**
	 * Line below the title.
	 */
	public static function lead(): string {
		return __( 'Every entry of your forms in one place, as a table or as a board by lead status.', 'funnelforms-free' );
	}

	/**
	 * Loads the app on its page only.
	 *
	 * @param string $hook Hook suffix of the current admin page.
	 */
	public static function enqueue( string $hook ): void {
		if ( null === self::$hook || $hook !== self::$hook || ! BuilderPage::built() ) {
			return;
		}
		BuilderPage::load_app( self::config() );
	}

	/**
	 * What the entries screen gets.
	 *
	 * @return array<string, mixed>
	 */
	public static function config(): array {
		$forms = ( new FormRepository() )->search( array(), 'title', 1, 500 )['rows'];
		return array(
			'screen'     => 'entries',
			'root'       => esc_url_raw( rest_url() ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
			'userLocale' => get_user_locale(),
			'forms'      => array_map(
				static fn( array $form ): array => array(
					'id'    => (int) $form['id'],
					'title' => (string) $form['title'],
				),
				$forms
			),
			// The export link without filters; the app adds them. Null without the right to export.
			'exportUrl'  => current_user_can( EntriesExport::capability() ) ? EntriesExport::url() : null,
			'builderUrl' => current_user_can( Capabilities::EDIT_FORMS ) ? admin_url( 'admin.php?page=' . BuilderPage::SLUG ) : null,
			// The lead stages of the site, the columns of the board (Funnelforms Pro).
			'stages'     => Edition::is_pro() ? LeadStagesController::list() : null,
			'editStages' => Edition::is_pro() && LeadStagesController::may_change(),
			'user'       => array(
				'id'    => get_current_user_id(),
				// Administrators may delete the notes of others (the server checks again).
				'admin' => current_user_can( 'manage_options' ),
			),
		);
	}

	/**
	 * Prints the mount point.
	 */
	public static function render(): void {
		if ( ! BuilderPage::built() ) {
			Ui::open( array( 'title' => __( 'Entries', 'funnelforms-free' ) ) );
			echo '<div class="notice notice-error"><p>' . esc_html__( 'The form builder is missing from this copy of the plugin. Install the plugin from its ZIP file.', 'funnelforms-free' ) . '</p></div>';
			Ui::close();
			return;
		}
		echo '<noscript><div class="notice notice-error"><p>' . esc_html__( 'The list of entries needs JavaScript.', 'funnelforms-free' ) . '</p></div></noscript>';
		echo '<div id="funnelforms-builder">';
		Ui::placeholder( __( 'Entries', 'funnelforms-free' ), self::lead() );
		echo '</div>';
	}
}
