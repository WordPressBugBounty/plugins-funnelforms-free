<?php
/**
 * The Funnelforms admin menu.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;
use Funnelforms\Compat\Safety\Rollback;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Funnelforms 5 owns the menu "Funnelforms": Overview, Forms, Entries, Appointments,
 * Integrations, Settings, Recommend, Account and Support. The menu of Funnelforms 3 (two dozen pages, or only its license page while 3.x is
 * not activated) shrinks to one entry "Funnelforms 3" while a form still needs it and disappears
 * on its own once the imported forms run on Funnelforms 5 (no switch). Its pages stay reachable
 * by address, and its code is not touched.
 */
final class Menu {

	public const SLUG = 'funnelforms';

	/** Positions of the pages in the menu. */
	public const POSITIONS = array(
		'overview'     => 0,
		'forms'        => 1,
		'entries'      => 2,
		'bookings'     => 3,
		'stats'        => 4,
		'prediction'   => 5,
		'import_own'   => 6,
		'import'       => 7,
		'migration'    => 70,
		'integrations' => 75,
		'app'          => 77,
		'settings'     => 80,
		'refer'        => 85,
		'account'      => 90,
		'support'      => 91,
		'legacy'       => 99,
	);

	/**
	 * Slug of the Funnelforms 3 menu that was folded in, while it is reachable.
	 *
	 * @var string
	 */
	private static string $legacy = '';

	/**
	 * Hooks: the menu before the pages join it, the clean-up after everyone added theirs.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ), 9 );
		add_action( 'admin_menu', array( self::class, 'fold_legacy' ), 999 );
		add_filter( 'parent_file', array( self::class, 'parent_file' ) );
		add_filter( 'submenu_file', array( self::class, 'submenu_file' ) );
	}

	/**
	 * Adds the menu with its first page, the overview.
	 */
	public static function menu(): void {
		$title = __( 'Overview', 'funnelforms-free' );
		// Back on Funnelforms 3, its own menu returns; the names must tell the two apart.
		$name = Rollback::active() ? __( 'Funnelforms 5', 'funnelforms-free' ) : 'Funnelforms';
		$hook = add_menu_page( $name, $name, Capabilities::EDIT_FORMS, self::SLUG, array( OverviewPage::class, 'render' ), Ui::menu_icon(), 26 );
		Ui::screen( $hook );
		add_submenu_page( self::SLUG, $title, $title, Capabilities::EDIT_FORMS, self::SLUG, array( OverviewPage::class, 'render' ), self::POSITIONS['overview'] );
	}

	/**
	 * Takes the Funnelforms 3 menu out and leaves one entry that leads to it (or none, once it is
	 * hidden).
	 */
	public static function fold_legacy(): void {
		global $admin_page_hooks;
		self::$legacy = '';
		if ( Rollback::active() ) {
			// The old menu stays as it was, with one way forward added.
			$slug = defined( 'MAIN_MENU_SLUG' ) ? (string) constant( 'MAIN_MENU_SLUG' ) : '';
			if ( '' !== $slug && isset( $admin_page_hooks[ $slug ] ) ) {
				add_submenu_page( $slug, __( 'Back to Funnelforms 5', 'funnelforms-free' ), __( 'Back to Funnelforms 5', 'funnelforms-free' ), 'manage_options', SafetySection::url(), '', 999 );
			}
			return;
		}
		foreach ( array( 'MAIN_MENU_SLUG', 'LIZENZ_SLUG' ) as $constant ) {
			$slug = defined( $constant ) ? (string) constant( $constant ) : '';
			if ( '' === $slug || ! isset( $admin_page_hooks[ $slug ] ) ) {
				continue;
			}
			remove_menu_page( $slug );
			if ( '' === self::$legacy ) {
				self::$legacy = $slug;
			}
		}
		if ( '' !== self::$legacy && self::legacy_shown() ) {
			add_submenu_page( self::SLUG, __( 'Funnelforms 3', 'funnelforms-free' ), __( 'Funnelforms 3', 'funnelforms-free' ), 'manage_options', self::legacy_url(), '', self::POSITIONS['legacy'] );
		}
	}

	/**
	 * Whether the entry "Funnelforms 3" is shown: until the forms of Funnelforms 3 were imported,
	 * and afterwards while one of them still runs on 3.x (kept there, sent back, or back on
	 * Funnelforms 3 as a whole).
	 */
	public static function legacy_shown(): bool {
		$imported = ( new FormRepository() )->with_legacy_ids();
		if ( array() === $imported ) {
			return true;
		}
		foreach ( $imported as $row ) {
			if ( FormRepository::RENDERER_V5 !== $row['renderer'] ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Address of the Funnelforms 3 menu that was folded in; empty without one.
	 */
	public static function legacy_url(): string {
		return '' === self::$legacy ? '' : 'admin.php?page=' . self::$legacy;
	}

	/**
	 * Whether Funnelforms 3 brought a menu on this request.
	 */
	public static function has_legacy(): bool {
		return '' !== self::$legacy;
	}

	/**
	 * Keeps the Funnelforms menu open on the pages of Funnelforms 3 and on pages that are reached
	 * by address only (such as the migration report before the first run).
	 *
	 * @param string|null $parent_file Parent of the current page.
	 * @return string|null
	 */
	public static function parent_file( $parent_file ) {
		global $plugin_page;
		return self::on_legacy_page() || ( is_string( $plugin_page ) && str_starts_with( $plugin_page, 'funnelforms-' ) ) ? self::SLUG : $parent_file;
	}

	/**
	 * Marks "Funnelforms 3" as the current entry on its pages.
	 *
	 * @param string|null $submenu_file Current entry.
	 * @return string|null
	 */
	public static function submenu_file( $submenu_file ) {
		return self::on_legacy_page() && self::legacy_shown() ? self::legacy_url() : $submenu_file;
	}

	/**
	 * Whether the current page is one of Funnelforms 3.
	 */
	private static function on_legacy_page(): bool {
		global $plugin_page;
		return '' !== self::$legacy && is_string( $plugin_page ) && str_starts_with( $plugin_page, 'af2_' );
	}
}
