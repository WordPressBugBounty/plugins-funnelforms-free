<?php
/**
 * What only the Free plugin does on a site.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Edition;

use Funnelforms\Admin\Menu;
use Funnelforms\Admin\Ui;
use Funnelforms\Application\Capabilities;
use Funnelforms\Application\FormRenderer;
use Funnelforms\Compat\Migration\AutoRenderer;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Compat\Migration\Migrator;
use Funnelforms\Frontend\Shortcode;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Registered by Funnelforms-free.php after the core. Pro has the 3.x code next to the new core,
 * so a migrated form keeps the 3.x renderer until someone switches it. Free has no 3.x code:
 *
 * - [funnelforms] and [anfrageformular2] are registered here, so a form that is not on the new
 *   renderer yet shows nothing to visitors (and a note to editors) instead of the shortcode text;
 * - once the import of the Free 3.x data is complete, every imported form goes to the new
 *   renderer on its own; forms the import could not verify stay off and are listed for the admin;
 * - a page under Funnelforms names what Funnelforms Pro adds. Other screens name a Pro feature
 *   only in its place, in one line with a link to that page (hint()); there are no notices about Pro;
 * - after 10 entries, one request for a review on wordpress.org (ReviewNotice).
 */
final class FreeSite {

	/** Admin page that names the Pro features. */
	public const SLUG = 'funnelforms-upgrade';

	/** The import (its last_sync_at) whose forms were switched. */
	public const SWITCHED_OPTION = 'funnelforms_free_switched';

	/** Forms that stayed off the new renderer after the last switch: form ID => blockers. */
	public const STAYED_OPTION = 'funnelforms_free_stayed';

	/**
	 * Registers the hooks.
	 */
	public static function register(): void {
		add_action( 'init', array( self::class, 'shortcodes' ), 1 );
		add_action( 'init', array( self::class, 'switch_migrated' ), 30 );
		if ( is_admin() ) {
			add_action( 'admin_menu', array( self::class, 'menu' ), 40 );
			add_action( 'admin_notices', array( self::class, 'notices' ) );
			ReviewNotice::register();
			add_filter( 'plugin_action_links_' . plugin_basename( FUNNELFORMS_PLUGIN_FILE ), array( self::class, 'action_links' ) );
		}
	}

	/**
	 * Registers the 3.x shortcodes. Shortcode::intercept() answers for forms on the new renderer
	 * before WordPress calls the handler.
	 */
	public static function shortcodes(): void {
		foreach ( Shortcode::TAGS as $tag ) {
			if ( ! shortcode_exists( $tag ) ) {
				add_shortcode( $tag, array( self::class, 'placeholder' ) );
			}
		}
	}

	/**
	 * Output for a form that is not on the new renderer yet: nothing for visitors, a note for
	 * people who edit forms.
	 *
	 * @param mixed $attr Attributes.
	 */
	public static function placeholder( $attr ): string {
		unset( $attr );
		if ( ! current_user_can( Capabilities::EDIT_FORMS ) ) {
			return '';
		}
		$text = 'running' === Migrator::state()['status']
			? __( 'Funnelforms is moving this form to version 5. It appears here once that is done. Only people who edit forms see this note.', 'funnelforms-free' )
			: __( 'This Funnelforms form is not shown: it is not published on version 5 yet. Open Funnelforms in the admin to see why. Only people who edit forms see this note.', 'funnelforms-free' );
		return '<p class="funnelforms-note">' . esc_html( $text ) . '</p>';
	}

	/**
	 * Puts the forms of a completed import on the new renderer, once per import. Forms left out in
	 * the setup assistant (pinned, AutoRenderer) stay where they are.
	 */
	public static function switch_migrated(): void {
		$state = Migrator::state();
		if ( 'done' !== $state['status'] || null === $state['last_sync_at'] ) {
			return;
		}
		$sync = (string) $state['last_sync_at'];
		if ( get_option( self::SWITCHED_OPTION ) === $sync ) {
			return;
		}
		$forms    = new FormRepository();
		$renderer = new FormRenderer( $forms, new MigrationStore( SecretBox::for_site() ) );
		$stayed   = array();
		$pinned   = AutoRenderer::pinned();
		foreach ( $forms->with_legacy_ids() as $row ) {
			if ( FormRepository::RENDERER_V5 === $row['renderer'] || in_array( (int) $row['id'], $pinned, true ) ) {
				continue;
			}
			$blockers = $renderer->switch_to( (int) $row['id'], FormRepository::RENDERER_V5 );
			if ( array() !== $blockers ) {
				$stayed[ (int) $row['id'] ] = $blockers;
			}
		}
		update_option( self::STAYED_OPTION, $stayed, false );
		update_option( self::SWITCHED_OPTION, $sync, false );
	}

	/**
	 * Forms that stayed off the new renderer, still there and still off.
	 *
	 * @return array<int,string[]> Form ID => blockers.
	 */
	public static function stayed(): array {
		$stayed = get_option( self::STAYED_OPTION, array() );
		$stayed = is_array( $stayed ) ? $stayed : array();
		// Forms left out in the setup assistant are not shown either: Free has no Funnelforms 3 code.
		foreach ( AutoRenderer::pinned() as $id ) {
			$stayed[ $id ] = $stayed[ $id ] ?? array( 'left_out' );
		}
		if ( array() === $stayed ) {
			return array();
		}
		$forms = new FormRepository();
		$out   = array();
		foreach ( $stayed as $id => $blockers ) {
			$form = $forms->by_id( (int) $id );
			if ( null !== $form && FormRepository::RENDERER_V5 !== $form['renderer'] ) {
				$out[ (int) $id ] = array_map( 'strval', (array) $blockers );
			}
		}
		return $out;
	}

	/**
	 * Address of the page about Pro.
	 */
	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	/**
	 * One line in place of a Pro feature: the Pro badge, what the feature is and a link to the
	 * page about Pro, like the Pro badge and link of the builder.
	 *
	 * @param string $text What comes with Pro, one sentence.
	 */
	public static function hint( string $text ): string {
		return '<p class="ffx-muted ffx-pro-hint">' . Ui::badge( __( 'Pro', 'funnelforms-free' ), 'info' ) . ' ' . esc_html( $text ) . ' <a href="' . esc_url( self::url() ) . '">' . esc_html__( 'More about Funnelforms Pro', 'funnelforms-free' ) . '</a></p>';
	}

	/**
	 * Adds the page about Pro, last in the Funnelforms menu.
	 */
	public static function menu(): void {
		$hook = add_submenu_page(
			Menu::SLUG,
			__( 'Funnelforms Pro', 'funnelforms-free' ),
			__( 'Pro features', 'funnelforms-free' ),
			Capabilities::EDIT_FORMS,
			self::SLUG,
			array( self::class, 'render' ),
			Menu::POSITIONS['support']
		);
		Ui::screen( $hook );
	}

	/**
	 * The page about Pro (UpgradePage).
	 */
	public static function render(): void {
		UpgradePage::render();
	}

	/**
	 * Notices about the move to version 5, on the Funnelforms pages and the plugin list.
	 */
	public static function notices(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( null === $screen || ! current_user_can( Capabilities::MANAGE_SETTINGS ) || ( 'plugins' !== $screen->id && ! str_contains( (string) $screen->id, 'funnelforms' ) ) ) {
			return;
		}
		if ( 'running' === Migrator::state()['status'] ) {
			printf(
				'<div class="notice notice-info"><p>%s</p></div>',
				esc_html__( 'Funnelforms is moving your forms and entries to version 5. Your forms appear on your website again as soon as that is done.', 'funnelforms-free' )
			);
			return;
		}
		$stayed = self::stayed();
		if ( array() === $stayed ) {
			return;
		}
		printf(
			'<div class="notice notice-warning"><p>%1$s <a href="%2$s">%3$s</a></p></div>',
			esc_html(
				sprintf(
					/* translators: %d: number of forms. */
					_n( '%d form from Funnelforms 3 is not shown on your website yet, because it needs a look after the move to version 5.', '%d forms from Funnelforms 3 are not shown on your website yet, because they need a look after the move to version 5.', count( $stayed ), 'funnelforms-free' ),
					count( $stayed )
				)
			),
			esc_url( admin_url( 'admin.php?page=funnelforms-migration' ) ),
			esc_html__( 'Show the forms', 'funnelforms-free' )
		);
	}

	/**
	 * Adds a link to the Pro page in the plugin list.
	 *
	 * @param string[] $links Links of the plugin row.
	 * @return string[]
	 */
	public static function action_links( $links ): array {
		$links   = is_array( $links ) ? $links : array();
		$links[] = '<a href="' . esc_url( self::url() ) . '">' . esc_html__( 'Pro features', 'funnelforms-free' ) . '</a>';
		return $links;
	}
}
