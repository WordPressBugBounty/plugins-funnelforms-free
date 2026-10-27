<?php
/**
 * Block "Funnelforms" for the block editor.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Shows a form like the shortcode [funnelforms id="…"] does, so 3.x forms and forms on the new
 * renderer both work. The editor shows forms on the new renderer live (not clickable) and a
 * placeholder for forms that still run on 3.x, whose scripts only load on the page.
 */
final class FormBlock {

	public const NAME   = 'funnelforms/form';
	public const SCRIPT = 'funnelforms-form-block';

	/**
	 * Registers the hooks.
	 */
	public static function register(): void {
		add_action( 'init', array( self::class, 'register_block' ) );
		add_action( 'enqueue_block_assets', array( self::class, 'editor_assets' ) );
	}

	/**
	 * Registers the editor script and the block.
	 */
	public static function register_block(): void {
		$dir = dirname( FUNNELFORMS_PLUGIN_FILE ) . '/blocks/form';
		wp_register_script(
			self::SCRIPT,
			plugins_url( 'blocks/form/editor.js', FUNNELFORMS_PLUGIN_FILE ),
			array( 'wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-server-side-render', 'wp-i18n' ),
			FUNNELFORMS_ASSET_VERSION,
			true
		);
		wp_set_script_translations( self::SCRIPT, 'funnelforms-free', dirname( FUNNELFORMS_PLUGIN_FILE ) . '/languages' );
		register_block_type( $dir, array( 'render_callback' => array( self::class, 'render' ) ) );
	}

	/**
	 * The forms to choose from, and the runtime inside the editor canvas for the live preview.
	 */
	public static function editor_assets(): void {
		if ( ! is_admin() || ! current_user_can( 'edit_posts' ) ) {
			return;
		}
		if ( wp_script_is( self::SCRIPT, 'registered' ) && ! wp_scripts()->get_data( self::SCRIPT, 'before' ) ) {
			wp_add_inline_script(
				self::SCRIPT,
				'window.funnelformsBlock = ' . wp_json_encode(
					array(
						'forms'  => self::forms(),
						'popups' => Edition::is_pro(),
					)
				) . ';',
				'before'
			);
		}
		Renderer::enqueue();
		wp_add_inline_style( Renderer::HANDLE, '.ffx-block-preview{pointer-events:none}.ffx-block-placeholder{margin:0;padding:1.5rem;border:1px dashed currentColor;border-radius:8px;opacity:.75}' );
	}

	/**
	 * Forms for the block: key (the 3.x ID, the shortcode's id, or the uid of forms made in the
	 * builder), title and whether the new renderer shows it.
	 *
	 * @return array<int,array{key:string,title:string,live:bool}>
	 */
	public static function forms(): array {
		$out   = array();
		$forms = new FormRepository();
		foreach ( $forms->with_legacy_ids() as $form ) {
			if ( 'trashed' === $form['status'] ) {
				continue;
			}
			$out[] = array(
				'key'   => (string) (int) $form['legacy_post_id'],
				'title' => '' === (string) $form['title'] ? '#' . $form['legacy_post_id'] : (string) $form['title'],
				'live'  => FormRepository::RENDERER_V5 === $form['renderer'],
			);
		}
		foreach ( $forms->made_in_builder() as $form ) {
			$out[] = array(
				'key'   => (string) $form['uid'],
				'title' => (string) $form['title'],
				'live'  => true,
			);
		}
		return $out;
	}

	/**
	 * The shortcode attribute for a form key: id="…" for 3.x IDs, uid="…" for forms made in the
	 * builder; empty for anything else.
	 *
	 * @param string $key Form key (FormBlock::forms()).
	 */
	public static function attribute( string $key ): string {
		if ( 1 === preg_match( '/^[1-9]\d*$/', $key ) ) {
			return sprintf( 'id="%d"', (int) $key );
		}
		if ( 1 === preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $key ) ) {
			return sprintf( 'uid="%s"', $key );
		}
		return '';
	}

	/**
	 * What an editor shows for a form that still runs on 3.x, whose scripts only load on the page;
	 * null for forms on the new renderer, which editors preview live.
	 *
	 * @param string $key Form key: 3.x ID, or uid of a form made in the builder.
	 */
	public static function placeholder( string $key ): ?string {
		if ( str_starts_with( self::attribute( $key ), 'uid=' ) ) {
			return null;
		}
		$id   = (int) $key;
		$form = ( new FormRepository() )->by_legacy_id( $id );
		if ( null !== $form && FormRepository::RENDERER_V5 === $form['renderer'] ) {
			return null;
		}
		return sprintf(
			'<p class="ffx-block-placeholder">%s</p>',
			esc_html(
				sprintf(
					/* translators: %s: form title */
					__( 'Form "%s" runs on Funnelforms 3. It is shown on the page.', 'funnelforms-free' ),
					null === $form || '' === (string) $form['title'] ? '#' . $id : (string) $form['title']
				)
			)
		);
	}

	/**
	 * Output of the block.
	 *
	 * @param array<string,mixed> $attributes Block attributes.
	 */
	public static function render( $attributes ): string {
		$uid       = (string) ( $attributes['formUid'] ?? '' );
		$key       = '' !== $uid ? $uid : (string) (int) ( $attributes['formId'] ?? 0 );
		$attribute = self::attribute( $key );
		if ( '' === $attribute ) {
			return '';
		}
		if ( ! empty( $attributes['editorPreview'] ) && current_user_can( 'edit_posts' ) ) {
			$placeholder = self::placeholder( $key );
			if ( null !== $placeholder ) {
				return sprintf( '<div %s>%s</div>', get_block_wrapper_attributes(), $placeholder );
			}
		}
		$display = array(
			'display'           => $attributes['display'] ?? 'inline',
			'popup_delay'       => $attributes['popupDelay'] ?? 5,
			'popup_click_class' => $attributes['popupClickClass'] ?? '',
			'popup_scroll'      => $attributes['popupScroll'] ?? 50,
			'widget_position'   => $attributes['widgetPosition'] ?? 'bottom-right',
			'widget_text'       => $attributes['widgetText'] ?? '',
			'widget_color'      => $attributes['widgetColor'] ?? '',
			'widget_animation'  => $attributes['widgetAnimation'] ?? '',
		);
		if ( isset( $attributes['popupPause'] ) && $attributes['popupPause'] >= 0 ) {
			$display['popup_pause'] = $attributes['popupPause'];
		}
		// The editor previews the form itself, never a popup over the editor.
		$popup = empty( $attributes['editorPreview'] ) ? Shortcode::display_attributes( $display ) : '';
		return sprintf( '<div %s>%s</div>', get_block_wrapper_attributes(), do_shortcode( '[funnelforms ' . $attribute . $popup . ']' ) );
	}
}
