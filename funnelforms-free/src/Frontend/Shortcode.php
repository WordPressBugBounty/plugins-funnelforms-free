<?php
/**
 * Lets the 3.x shortcodes show forms that were switched to the new renderer.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

use Funnelforms\Application\Capabilities;
use Funnelforms\Application\SubmitEntry;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * [funnelforms id="…"] and [anfrageformular2 id="…"] stay registered by the 3.x code. Before
 * WordPress runs them, this filter checks whether the migrated form uses the new renderer and
 * answers instead; otherwise the 3.x handler runs as before. Forms made in the builder have no
 * 3.x ID and are addressed by their uid: [funnelforms uid="…"]. Builder previews of 3.x keep
 * using the 3.x renderer.
 */
final class Shortcode {

	public const TAGS = array( 'funnelforms', 'anfrageformular2' );

	/** Corners of the widget button. */
	public const CORNERS = array( 'bottom-right', 'bottom-left', 'top-right', 'top-left' );

	/**
	 * Registers the filters.
	 */
	public static function register(): void {
		add_filter( 'pre_do_shortcode_tag', array( self::class, 'intercept' ), 10, 3 );
		add_filter( 'script_loader_tag', array( Renderer::class, 'script_tag' ), 10, 2 );
	}

	/**
	 * Short-circuits the 3.x shortcode for forms on the new renderer.
	 *
	 * @param false|string $output Output so far; false lets WordPress run the shortcode.
	 * @param string       $tag    Shortcode tag.
	 * @param mixed        $attr   Attributes.
	 * @return false|string
	 */
	public static function intercept( $output, string $tag, $attr ) {
		if ( false !== $output || ! in_array( $tag, self::TAGS, true ) || ! is_array( $attr ) ) {
			return $output;
		}
		$forms = new FormRepository();
		$uid   = strtolower( trim( (string) ( $attr['uid'] ?? '' ) ) );
		if ( '' !== $uid ) {
			// Only the new renderer knows these forms: never hand them to the 3.x handler.
			$form     = 1 === preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $uid ) ? $forms->by_uid( $uid ) : null;
			$document = null === $form || ! Renderer::available() ? null : SubmitEntry::shown_document( $forms, $form );
			// People who edit forms get a note instead of an empty place.
			return null === $document ? self::not_shown() : Renderer::render( $form, $document, self::popup( $attr ) );
		}
		$legacy_id = isset( $attr['id'] ) && is_numeric( $attr['id'] ) ? (int) $attr['id'] : 0;
		if ( $legacy_id <= 0 || self::uses_legacy_features( $attr ) || ! Renderer::available() ) {
			return $output;
		}
		$form = $forms->by_legacy_id( $legacy_id );
		if ( null === $form ) {
			return $output;
		}
		$document = SubmitEntry::shown_document( $forms, $form );
		return null === $document ? $output : Renderer::render( $form, $document, self::popup( $attr ) );
	}

	/**
	 * Output for a form of this plugin that is not shown (not published, deleted, or using a
	 * feature this edition does not have): nothing for visitors, a note for people who edit forms.
	 */
	private static function not_shown(): string {
		if ( ! current_user_can( Capabilities::EDIT_FORMS ) ) {
			return '';
		}
		return '<p class="funnelforms-note">' . esc_html__( 'This Funnelforms form is not shown here. Open it in Funnelforms to see why. Only people who edit forms see this note.', 'funnelforms-free' ) . '</p>';
	}

	/**
	 * Attributes the new renderer does not handle yet (the builder preview of 3.x).
	 *
	 * @param array<string,mixed> $attr Attributes.
	 */
	private static function uses_legacy_features( array $attr ): bool {
		return self::on( $attr, 'preview' );
	}

	/**
	 * Popup of the attributes. 3.x: popup_by_delay with popup_delay (ms) wins over popup_by_click
	 * with popup_click_class. 5.0: popup="delay|click|scroll|exit" with popup_delay,
	 * popup_click_class, popup_scroll (share of the page in percent) and popup_pause (hours a popup
	 * that opens by itself stays closed after the visitor closed it), or widget="bottom-right"
	 * (a button in that corner) with widget_text, widget_color and widget_animation.
	 *
	 * @param array<string,mixed> $attr Attributes.
	 * @return array<string,mixed> Empty for a form in the page.
	 */
	public static function popup( array $attr ): array {
		if ( Edition::is_free() ) {
			// Popups and the corner button are Funnelforms Pro; Free shows the form in the page.
			return array();
		}
		$mode   = self::on( $attr, 'popup_by_delay' ) ? 'delay' : ( self::on( $attr, 'popup_by_click' ) ? 'click' : strtolower( trim( (string) ( $attr['popup'] ?? '' ) ) ) );
		$pause  = max( 0, min( 8760, (int) ( $attr['popup_pause'] ?? ( in_array( $mode, array( 'scroll', 'exit' ), true ) ? 24 : 0 ) ) ) );
		$corner = strtolower( trim( (string) ( $attr['widget'] ?? '' ) ) );
		if ( '' !== $corner ) {
			$color = sanitize_hex_color( (string) ( $attr['widget_color'] ?? '' ) );
			return array(
				'mode'      => 'widget',
				'position'  => in_array( $corner, self::CORNERS, true ) ? $corner : 'bottom-right',
				'text'      => mb_substr( sanitize_text_field( (string) ( $attr['widget_text'] ?? '' ) ), 0, 60 ),
				'color'     => null === $color ? '' : $color,
				'animation' => in_array( $attr['widget_animation'] ?? '', array( 'pulse', 'bounce', 'shake' ), true ) ? (string) $attr['widget_animation'] : '',
			);
		}
		switch ( $mode ) {
			case 'delay':
				return array(
					'mode'  => 'delay',
					'delay' => max( 0, (int) ( $attr['popup_delay'] ?? 0 ) ),
					'pause' => $pause,
				);
			case 'click':
				$class = sanitize_html_class( (string) ( $attr['popup_click_class'] ?? '' ) );
				return '' === $class ? array() : array(
					'mode'  => 'click',
					'class' => $class,
				);
			case 'scroll':
				return array(
					'mode'   => 'scroll',
					'scroll' => max( 1, min( 100, (int) ( $attr['popup_scroll'] ?? 50 ) ) ),
					'pause'  => $pause,
				);
			case 'exit':
				return array(
					'mode'  => 'exit',
					'pause' => $pause,
				);
		}
		return array();
	}

	/**
	 * Shortcode attributes for the display settings of the block and the Elementor widget: display
	 * (inline, delay, click, scroll, exit, widget), popup_delay (seconds), popup_click_class,
	 * popup_scroll, popup_pause, widget_position, widget_text, widget_color, widget_animation.
	 * Scrolling, exit intent and the corner button need the new renderer; 3.x shows those inline.
	 *
	 * @param array<string,mixed> $settings Settings.
	 */
	public static function display_attributes( array $settings ): string {
		$display = (string) ( $settings['display'] ?? 'inline' );
		$attr    = array();
		switch ( $display ) {
			case 'delay':
				// The 3.x attributes, so forms still on 3.x pop up as well.
				$attr = array(
					'popup_by_delay' => 1,
					'popup_delay'    => (int) round( max( 0.0, (float) ( $settings['popup_delay'] ?? 0 ) ) * 1000 ),
				);
				break;
			case 'click':
				$class = sanitize_html_class( (string) ( $settings['popup_click_class'] ?? '' ) );
				$attr  = '' === $class ? array() : array(
					'popup_by_click'    => 1,
					'popup_click_class' => $class,
				);
				break;
			case 'scroll':
				$attr = array(
					'popup'        => 'scroll',
					'popup_scroll' => max( 1, min( 100, (int) ( $settings['popup_scroll'] ?? 50 ) ) ),
				);
				break;
			case 'exit':
				$attr = array( 'popup' => 'exit' );
				break;
			case 'widget':
				$attr = array(
					'widget'           => in_array( $settings['widget_position'] ?? '', self::CORNERS, true ) ? (string) $settings['widget_position'] : 'bottom-right',
					'widget_text'      => (string) ( $settings['widget_text'] ?? '' ),
					'widget_color'     => (string) ( sanitize_hex_color( (string) ( $settings['widget_color'] ?? '' ) ) ?? '' ),
					'widget_animation' => (string) ( $settings['widget_animation'] ?? '' ),
				);
				break;
		}
		if ( in_array( $display, array( 'delay', 'scroll', 'exit' ), true ) && isset( $settings['popup_pause'] ) && '' !== (string) $settings['popup_pause'] ) {
			$attr['popup_pause'] = max( 0, (int) $settings['popup_pause'] );
		}
		$out = '';
		foreach ( array_filter( $attr, static fn( $v ) => '' !== (string) $v ) as $key => $value ) {
			// Shortcode attribute values cannot hold quotes or brackets.
			$out .= sprintf( ' %s="%s"', $key, str_replace( array( '"', '[', ']' ), '', (string) $value ) );
		}
		return $out;
	}

	/**
	 * Whether a yes/no attribute is set ("1", "true", …; not "", "0" or "false").
	 *
	 * @param array<string,mixed> $attr Attributes.
	 * @param string              $key  Attribute.
	 */
	private static function on( array $attr, string $key ): bool {
		return isset( $attr[ $key ] ) && ! in_array( strtolower( trim( (string) $attr[ $key ] ) ), array( '', '0', 'false' ), true );
	}
}
