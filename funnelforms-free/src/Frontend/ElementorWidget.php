<?php
/**
 * Elementor widget "Funnelforms".
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

use Elementor\Controls_Manager;
use Elementor\Widget_Base;
use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Shows a form like [funnelforms id="…"], inline or as a popup (after a delay or on a click on
 * elements with a CSS class, the shortcode's 3.x popup attributes). Only loaded by Elementor
 * (Frontend\Elementor). In the editor, forms on the new renderer are previewed live but cannot be
 * used, and a popup is shown inline; forms on 3.x show a placeholder.
 */
final class ElementorWidget extends Widget_Base {

	public const NAME = 'funnelforms';

	/**
	 * Widget name; also in Elementor's hook frontend/element_ready/funnelforms.default.
	 */
	public function get_name() {
		return self::NAME;
	}

	/**
	 * Title in the widget panel.
	 */
	public function get_title() {
		return 'Funnelforms';
	}

	/**
	 * Icon in the widget panel.
	 */
	public function get_icon() {
		return 'eicon-form-horizontal';
	}

	/**
	 * Panel category.
	 *
	 * @return string[]
	 */
	public function get_categories() {
		return array( 'general' );
	}

	/**
	 * Search words in the panel.
	 *
	 * @return string[]
	 */
	public function get_keywords() {
		return array( 'form', 'funnel', 'lead', 'popup', 'anfrageformular' );
	}

	/**
	 * Settings: form, display (inline, popup after a delay, on a click, after scrolling, on exit
	 * intent, or a button in a corner) and their values.
	 */
	protected function register_controls() {
		$this->start_controls_section(
			'section_form',
			array(
				'label' => __( 'Form', 'funnelforms-free' ),
				'tab'   => Controls_Manager::TAB_CONTENT,
			)
		);
		$options = array( '' => __( 'Choose a form', 'funnelforms-free' ) );
		foreach ( FormBlock::forms() as $form ) {
			$options[ $form['key'] ] = $form['title'];
		}
		$this->add_control(
			'form_id',
			array(
				'label'   => __( 'Form', 'funnelforms-free' ),
				'type'    => Controls_Manager::SELECT,
				'options' => $options,
				'default' => '',
			)
		);
		if ( Edition::is_free() ) {
			// Popups and the corner button are Funnelforms Pro; Free shows the form in the page.
			$this->end_controls_section();
			return;
		}
		$this->add_control(
			'display',
			array(
				'label'   => __( 'Display', 'funnelforms-free' ),
				'type'    => Controls_Manager::SELECT,
				'options' => array(
					'inline' => __( 'In the page', 'funnelforms-free' ),
					'delay'  => __( 'Popup after a delay', 'funnelforms-free' ),
					'click'  => __( 'Popup on a click', 'funnelforms-free' ),
					'scroll' => __( 'Popup after scrolling', 'funnelforms-free' ),
					'exit'   => __( 'Popup when the visitor is about to leave', 'funnelforms-free' ),
					'widget' => __( 'Button in a corner of the page', 'funnelforms-free' ),
				),
				'default' => 'inline',
			)
		);
		$this->add_control(
			'popup_delay',
			array(
				'label'     => __( 'Delay (seconds)', 'funnelforms-free' ),
				'type'      => Controls_Manager::NUMBER,
				'min'       => 0,
				'step'      => 0.5,
				'default'   => 5,
				'condition' => array( 'display' => 'delay' ),
			)
		);
		$this->add_control(
			'popup_click_class',
			array(
				'label'       => __( 'CSS class of the buttons or links', 'funnelforms-free' ),
				'type'        => Controls_Manager::TEXT,
				'placeholder' => 'open-form',
				'description' => __( 'Give buttons or links this CSS class; a click on them opens the form.', 'funnelforms-free' ),
				'condition'   => array( 'display' => 'click' ),
			)
		);
		$this->add_control(
			'popup_scroll',
			array(
				'label'     => __( 'Opens after this share of the page (%)', 'funnelforms-free' ),
				'type'      => Controls_Manager::NUMBER,
				'min'       => 1,
				'max'       => 100,
				'default'   => 50,
				'condition' => array( 'display' => 'scroll' ),
			)
		);
		$this->add_control(
			'popup_pause',
			array(
				'label'       => __( 'Do not show again for (hours)', 'funnelforms-free' ),
				'type'        => Controls_Manager::NUMBER,
				'min'         => 0,
				'description' => __( 'After the visitor closed the popup. 0 shows it on every page view. After an entry it stays closed for 30 days.', 'funnelforms-free' ),
				'condition'   => array( 'display' => array( 'delay', 'scroll', 'exit' ) ),
			)
		);
		$this->add_control(
			'widget_position',
			array(
				'label'     => __( 'Corner', 'funnelforms-free' ),
				'type'      => Controls_Manager::SELECT,
				'options'   => self::corners(),
				'default'   => 'bottom-right',
				'condition' => array( 'display' => 'widget' ),
			)
		);
		$this->add_control(
			'widget_text',
			array(
				'label'       => __( 'Text of the button', 'funnelforms-free' ),
				'type'        => Controls_Manager::TEXT,
				'placeholder' => __( 'Get in touch', 'funnelforms-free' ),
				'condition'   => array( 'display' => 'widget' ),
			)
		);
		$this->add_control(
			'widget_color',
			array(
				'label'       => __( 'Colour of the button', 'funnelforms-free' ),
				'type'        => Controls_Manager::COLOR,
				'description' => __( 'Empty for the accent colour of the form.', 'funnelforms-free' ),
				'condition'   => array( 'display' => 'widget' ),
			)
		);
		$this->add_control(
			'widget_animation',
			array(
				'label'     => __( 'Animation', 'funnelforms-free' ),
				'type'      => Controls_Manager::SELECT,
				'options'   => self::animations(),
				'default'   => '',
				'condition' => array( 'display' => 'widget' ),
			)
		);
		$this->end_controls_section();
	}

	/**
	 * Corners of the widget button, with their names.
	 *
	 * @return array<string,string>
	 */
	public static function corners(): array {
		return array(
			'bottom-right' => __( 'Bottom right', 'funnelforms-free' ),
			'bottom-left'  => __( 'Bottom left', 'funnelforms-free' ),
			'top-right'    => __( 'Top right', 'funnelforms-free' ),
			'top-left'     => __( 'Top left', 'funnelforms-free' ),
		);
	}

	/**
	 * Animations of the widget button, with their names.
	 *
	 * @return array<string,string>
	 */
	public static function animations(): array {
		return array(
			''       => __( 'None', 'funnelforms-free' ),
			'pulse'  => __( 'Pulse', 'funnelforms-free' ),
			'bounce' => __( 'Bounce', 'funnelforms-free' ),
			'shake'  => __( 'Shake', 'funnelforms-free' ),
		);
	}

	/**
	 * Output.
	 */
	protected function render() {
		$settings = (array) $this->get_settings_for_display();
		$key      = (string) ( $settings['form_id'] ?? '' );
		if ( '' === FormBlock::attribute( $key ) ) {
			return;
		}
		if ( Elementor::editing() ) {
			$placeholder = FormBlock::placeholder( $key );
			// Inert: visible, but no test entries from the editor.
			echo '<div class="ffx-block-preview" inert>' . ( $placeholder ?? do_shortcode( '[funnelforms ' . FormBlock::attribute( $key ) . ']' ) ) . '</div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- markup of the renderer.
			self::preview_assets();
			return;
		}
		echo do_shortcode( self::shortcode( $key, $settings ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- markup of the renderer.
	}

	/**
	 * The shortcode for the settings.
	 *
	 * @param string              $key      Form key: 3.x ID or uid (FormBlock::forms()).
	 * @param array<string,mixed> $settings Widget settings.
	 */
	public static function shortcode( string $key, array $settings ): string {
		return '[funnelforms ' . FormBlock::attribute( $key ) . Shortcode::display_attributes( $settings ) . ']';
	}

	/**
	 * The editor renders a changed widget without loading the page again; the runtime then starts
	 * the form through Elementor's element_ready hook.
	 */
	private static function preview_assets(): void {
		Renderer::enqueue();
		if ( str_contains( implode( '', (array) wp_scripts()->get_data( Renderer::HANDLE, 'after' ) ), 'element_ready' ) ) {
			return;
		}
		wp_add_inline_script(
			Renderer::HANDLE,
			'(function(){function f(){window.elementorFrontend.hooks.addAction("frontend/element_ready/' . self::NAME . '.default",function(s){window.funnelforms&&window.funnelforms.mount(s[0]);});}'
			. 'if(window.elementorFrontend&&window.elementorFrontend.hooks){f();}else if(window.jQuery){window.jQuery(window).on("elementor/frontend/init",f);}})();'
		);
		wp_add_inline_style( Renderer::HANDLE, '.ffx-block-preview{pointer-events:none}.ffx-block-placeholder{margin:0;padding:1.5rem;border:1px dashed currentColor;border-radius:8px;opacity:.75}' );
	}
}
