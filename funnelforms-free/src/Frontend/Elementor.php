<?php
/**
 * Elementor: the widget "Funnelforms".
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

defined( 'ABSPATH' ) || exit;

/**
 * Registers the widget once Elementor asks for widgets, so nothing loads without Elementor.
 */
final class Elementor {

	/**
	 * Registers the hooks.
	 */
	public static function register(): void {
		add_action( 'elementor/widgets/register', array( self::class, 'widgets' ) );
	}

	/**
	 * Adds the widget.
	 *
	 * @param object $widgets Elementor's widgets manager.
	 */
	public static function widgets( $widgets ): void {
		$widgets->register( new ElementorWidget() );
	}

	/**
	 * Whether Elementor renders for its editor (the editor's preview), where forms are not used.
	 */
	public static function editing(): bool {
		if ( ! class_exists( '\Elementor\Plugin' ) || ! isset( \Elementor\Plugin::$instance ) ) {
			return false;
		}
		$elementor = \Elementor\Plugin::$instance;
		return ( isset( $elementor->editor ) && $elementor->editor->is_edit_mode() )
			|| ( isset( $elementor->preview ) && $elementor->preview->is_preview_mode() );
	}
}
