<?php
/**
 * Admin pages for importing forms: Funnelforms → Import Funnelforms and Funnelforms → Import from
 * other plugins.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;
use Funnelforms\Application\FormEditor;

defined( 'ABSPATH' ) || exit;

/**
 * Two pages, so each import has one clear name, in the menu, on the forms page and on the page:
 *
 * - Import Funnelforms (FUNNELFORMS_SLUG): export files of Funnelforms, a form file of 5.0 (.json),
 *   an export of Funnelforms 4 (.json) or of Funnelforms 3 (.zip), through admin/forms/import
 *   (FormEditor::import_file()).
 * - Import from other plugins (SLUG, the address the import always had): forms of Contact Form 7,
 *   WPForms and the others on this site or from their export files, through admin/import/*
 *   (Compat\Import\ImportController).
 *
 * Both print the frame of the Funnelforms pages and the mount point of their screen of the admin
 * app (packages/builder-ui).
 */
final class ImportPage {

	public const SLUG = 'funnelforms-import';

	public const FUNNELFORMS_SLUG = 'funnelforms-import-funnelforms';

	/**
	 * Hook suffix of the page of other plugins, once it is registered.
	 *
	 * @var string|null
	 */
	private static ?string $hook = null;

	/**
	 * Hook suffix of the page of Funnelforms files, once it is registered.
	 *
	 * @var string|null
	 */
	private static ?string $own_hook = null;

	/**
	 * Registers the page.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ), 22 );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Adds the pages below Funnelforms.
	 */
	public static function menu(): void {
		$own            = self::funnelforms_title();
		$hook           = add_submenu_page( Menu::SLUG, $own, $own, Capabilities::EDIT_FORMS, self::FUNNELFORMS_SLUG, array( self::class, 'render_funnelforms' ), Menu::POSITIONS['import_own'] );
		self::$own_hook = false === $hook ? null : $hook;
		Ui::screen( $hook );
		$title      = self::plugins_title();
		$hook       = add_submenu_page( Menu::SLUG, $title, $title, Capabilities::EDIT_FORMS, self::SLUG, array( self::class, 'render' ), Menu::POSITIONS['import'] );
		self::$hook = false === $hook ? null : $hook;
		Ui::screen( $hook );
	}

	/**
	 * Name of the import of Funnelforms files, the same in the menu, on the forms page and on its page.
	 */
	public static function funnelforms_title(): string {
		return __( 'Import Funnelforms', 'funnelforms-free' );
	}

	/**
	 * What the import of Funnelforms files takes.
	 */
	public static function funnelforms_lead(): string {
		return __( 'Forms exported from Funnelforms: a form file of Funnelforms 5 (.json), an export of the online version Funnelforms 4 (.json) or an export of Funnelforms 3 (.zip). Each form becomes a draft; nothing goes live.', 'funnelforms-free' );
	}

	/**
	 * Name of the import of other form plugins, the same in the menu, on the forms page and on its page.
	 */
	public static function plugins_title(): string {
		return __( 'Import from other plugins', 'funnelforms-free' );
	}

	/**
	 * What the import of other form plugins takes.
	 */
	public static function plugins_lead(): string {
		return __( 'Forms of Contact Form 7, WPForms, Gravity Forms, Ninja Forms, Fluent Forms, Formidable Forms and Elementor Pro, on this website or from their export files. Each form becomes a draft; nothing goes live, and the other plugin stays as it is.', 'funnelforms-free' );
	}

	/**
	 * Address of the import of other form plugins.
	 */
	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	/**
	 * Address of the import of Funnelforms files.
	 */
	public static function funnelforms_url(): string {
		return admin_url( 'admin.php?page=' . self::FUNNELFORMS_SLUG );
	}

	/**
	 * Loads the app on its page only.
	 *
	 * @param string $hook Hook suffix of the current admin page.
	 */
	public static function enqueue( string $hook ): void {
		if ( '' === $hook || ! BuilderPage::built() ) {
			return;
		}
		if ( $hook === self::$hook ) {
			BuilderPage::load_app( self::config() );
		} elseif ( $hook === self::$own_hook ) {
			BuilderPage::load_app( self::config( 'import-funnelforms' ) );
		}
	}

	/**
	 * What an import screen gets: import (other plugins) or import-funnelforms.
	 *
	 * @param string $screen Screen of the app.
	 * @return array<string, mixed>
	 */
	public static function config( string $screen = 'import' ): array {
		return array(
			'screen'     => 'import-funnelforms' === $screen ? $screen : 'import',
			'root'       => esc_url_raw( rest_url() ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
			'userLocale' => get_user_locale(),
			'builderUrl' => admin_url( 'admin.php?page=' . BuilderPage::SLUG ),
			'maxBytes'   => FormEditor::MAX_IMPORT_BYTES,
			// Each import points to the other one for files it does not take.
			'importUrl'  => self::url(),
			'importOwn'  => self::funnelforms_url(),
		);
	}

	/**
	 * Renders the page.
	 */
	public static function render(): void {
		if ( ! current_user_can( Capabilities::EDIT_FORMS ) ) {
			return;
		}
		self::page( self::plugins_title(), self::plugins_lead() );
	}

	/**
	 * Renders the page of Funnelforms files.
	 */
	public static function render_funnelforms(): void {
		if ( ! current_user_can( Capabilities::EDIT_FORMS ) ) {
			return;
		}
		self::page( self::funnelforms_title(), self::funnelforms_lead() );
	}

	/**
	 * The frame of a page with the mount point of its screen.
	 *
	 * @param string $title Title.
	 * @param string $lead  Line below the title.
	 */
	private static function page( string $title, string $lead ): void {
		Ui::open(
			array(
				'title' => $title,
				'lead'  => $lead,
			)
		);
		if ( ! BuilderPage::built() ) {
			echo '<div class="notice notice-error"><p>' . esc_html__( 'The form builder is missing from this copy of the plugin. Install the plugin from its ZIP file.', 'funnelforms-free' ) . '</p></div>';
		} else {
			echo '<div id="funnelforms-builder"></div>';
			echo '<noscript><div class="notice notice-error"><p>' . esc_html__( 'The import needs JavaScript.', 'funnelforms-free' ) . '</p></div></noscript>';
		}
		Ui::close();
	}
}
