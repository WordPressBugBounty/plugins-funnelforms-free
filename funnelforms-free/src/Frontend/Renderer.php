<?php
/**
 * Outputs a form for the new runtime.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

use Funnelforms\Application\FormAccess;
use Funnelforms\Application\PrivacyMode;
use Funnelforms\Compat\Multilingual;
use Funnelforms\Domain\Form\Conditions;
use Funnelforms\Domain\Form\PhoneNumbers;
use Funnelforms\Domain\Form\PublicDocument;
use Funnelforms\Edition\Edition;
use Funnelforms\Http\Captcha;

defined( 'ABSPATH' ) || exit;

/**
 * The HTML is a container plus the public document as inline JSON, so it can be cached with the
 * page. The runtime script (packages/runtime) builds the form inside the container.
 */
final class Renderer {

	public const HANDLE = 'funnelforms-runtime';

	/** Font Awesome 5, for answers of forms from 3.x that show its icons. */
	public const ICON_FONT = 'funnelforms-icon-font';

	/**
	 * Largest custom CSS of a form, in bytes.
	 */
	public const MAX_CSS = 20000;

	/**
	 * Font rules (@font-face) and custom CSS already printed on this page, by hash or form.
	 *
	 * @var array<string,bool>
	 */
	private static array $printed = array();

	/**
	 * Whether the built runtime is present (it is missing in a source checkout without a build).
	 */
	public static function available(): bool {
		return is_readable( FUNNELFORMS_PLUGIN_DIR . '/assets/runtime/runtime.js' );
	}

	/**
	 * HTML of one form: the form, a password prompt, or the closed message.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Form document.
	 * @param array<string,mixed> $popup    Popup of the shortcode (Shortcode::popup()); empty inline.
	 */
	public static function render( array $form, array $document, array $popup = array() ): string {
		self::enqueue( self::needs_more( $document, $popup ), self::chunks( $document ) );
		if ( self::icon_font( $document ) ) {
			wp_enqueue_style( self::ICON_FONT, self::icon_font_url(), array(), '5.15.4' );
		}
		$locale   = self::locale( $document );
		$document = self::localize( $form, $document, $locale );
		return UiLocale::run( $locale, static fn() => self::html( $form, $document, $popup, $locale ) );
	}

	/**
	 * HTML of one form, with the texts in the form's language.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Form document.
	 * @param array<string,mixed> $popup    Popup of the shortcode.
	 * @param string              $locale   Interface locale.
	 */
	private static function html( array $form, array $document, array $popup, string $locale ): string {
		// A visitor back from paying sees the end of the funnel, in the page and even when the form closed since.
		$paying = null !== self::payment_return( (int) $form['id'] );
		$attrs  = sprintf(
			'data-ffx-form="%1$s" style="%2$s"%3$s%4$s',
			esc_attr( $form['uid'] ),
			esc_attr( self::style( (array) ( $document['style']['tokens'] ?? array() ) ) ),
			self::lang( $locale ) . ( empty( $document['settings']['rtl'] ) ? '' : ' dir="rtl"' ),
			self::popup_attributes( $paying ? array() : $popup ) . ( self::needs_more( $document, $popup ) ? ' data-ffx-more' : '' ) . self::chunk_attribute( $document )
		);
		$class  = StyleTokens::classes( (array) ( $document['style']['tokens'] ?? array() ) );
		if ( ! $paying && FormAccess::OPEN !== FormAccess::state( (int) $form['id'], $document, time() ) ) {
			// A closed form does not pop up by itself; opened by a click it says why.
			if ( in_array( $popup['mode'] ?? '', array( 'delay', 'scroll', 'exit' ), true ) ) {
				return '';
			}
			return self::font_style( $document ) . self::custom_css( $form, $document ) . sprintf(
				'<div class="ffx-form ffx-closed%3$s" %1$s><div class="ffx-shell"><div class="ffx-card"><div class="ffx-closed-message">%2$s</div></div></div></div>',
				$attrs,
				wp_kses_post( FormAccess::closed_message( $document, $locale ) ),
				esc_attr( $class )
			);
		}
		// A form for members: a login link for everyone else, a key of their own for members.
		$member = '';
		if ( ! $paying && FormAccess::login_required( $document ) ) {
			if ( ! is_user_logged_in() ) {
				return self::font_style( $document ) . self::custom_css( $form, $document ) . sprintf(
					'<div class="ffx-form ffx-closed ffx-login" %1$s><div class="ffx-shell"><div class="ffx-card"><div class="ffx-closed-message">%2$s<p><a class="ffx-button ffx-button-primary" href="%3$s">%4$s</a></p></div></div></div></div>',
					$attrs,
					wp_kses_post( FormAccess::login_message( $document, $locale ) ),
					esc_url( wp_login_url( self::current_url() ) ),
					esc_html__( 'Log in', 'funnelforms-free' )
				);
			}
			$member = FormAccess::member_key( (string) $form['uid'], get_current_user_id(), time() );
		}
		$config = ! $paying && FormAccess::has_password( $document )
			? array(
				'uid'      => $form['uid'],
				'endpoint' => self::endpoint( $form ),
				'locale'   => $locale,
				'strings'  => self::strings(),
				'locked'   => true,
			)
			: self::config( $form, $document );
		if ( '' !== $member ) {
			$config['unlock'] = $member;
		}
		$json = wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE );

		// $json has <, >, &, ' and " escaped as \u sequences, so it cannot end the script element.
		return self::font_style( $document ) . self::custom_css( $form, $document ) . sprintf(
			'<div class="ffx-form%4$s" %1$s><script type="application/json" class="ffx-form-data">%2$s</script><noscript><p>%3$s</p></noscript></div>',
			$attrs,
			$json,
			esc_html__( 'This form needs JavaScript. Please enable JavaScript in your browser.', 'funnelforms-free' ),
			esc_attr( $class )
		);
	}

	/**
	 * Address of the page being shown, to come back to after logging in.
	 */
	private static function current_url(): string {
		$path = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- esc_url_raw() cleans it.
		return home_url( '/' === substr( $path, 0, 1 ) ? $path : '/' );
	}

	/**
	 * Attributes of a popup form: hidden on the page, opened by the runtime.
	 *
	 * @param array<string,mixed> $popup Popup.
	 */
	private static function popup_attributes( array $popup ): string {
		$mode = (string) ( $popup['mode'] ?? '' );
		if ( '' === $mode ) {
			return '';
		}
		$data = array( 'popup' => $mode );
		switch ( $mode ) {
			case 'click':
				$data['popup-click'] = (string) ( $popup['class'] ?? '' );
				break;
			case 'widget':
				$data['widget']           = (string) ( $popup['position'] ?? 'bottom-right' );
				$data['widget-text']      = '' !== (string) ( $popup['text'] ?? '' ) ? (string) $popup['text'] : __( 'Get in touch', 'funnelforms-free' );
				$data['widget-color']     = (string) ( $popup['color'] ?? '' );
				$data['widget-animation'] = (string) ( $popup['animation'] ?? '' );
				break;
			case 'delay':
				$data['popup-delay'] = (string) (int) ( $popup['delay'] ?? 0 );
				break;
			case 'scroll':
				$data['popup-scroll'] = (string) (int) ( $popup['scroll'] ?? 50 );
				break;
		}
		if ( ! empty( $popup['pause'] ) ) {
			$data['popup-pause'] = (string) (int) $popup['pause'];
		}
		$data['popup-close'] = __( 'Close', 'funnelforms-free' );
		$out                 = ' hidden';
		foreach ( $data as $key => $value ) {
			if ( '' !== $value ) {
				$out .= sprintf( ' data-ffx-%s="%s"', $key, esc_attr( $value ) );
			}
		}
		return $out;
	}

	/**
	 * What the runtime needs to show a form (the public document, never private settings).
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Form document.
	 * @return array<string,mixed>
	 */
	public static function config( array $form, array $document ): array {
		$locale   = self::locale( $document );
		$document = self::localize( $form, $document, $locale );
		$config   = array(
			'uid'      => $form['uid'],
			'endpoint' => self::endpoint( $form ),
			'locale'   => $locale,
			'strings'  => UiLocale::run( $locale, static fn() => self::strings( $document ) ),
			'document' => TrackingCode::add( self::with_site_keys( PublicDocument::from( $document, TrackingCode::allowed() ), $document ), $document ),
		);
		$maps     = Edition::pro( GoogleMaps::class );
		if ( null !== $maps && $maps::needed( $document ) ) {
			$config['mapsKey'] = $maps::key();
		}
		if ( Conditions::uses_today( $document ) ) {
			$config['timeZone'] = wp_timezone_string();
		}
		// Without the field the runtime keeps to the EU mode.
		if ( ! PrivacyMode::eu() ) {
			$config['privacy'] = PrivacyMode::current();
		}
		$icons = Icons::used( $document );
		if ( array() !== $icons ) {
			$config['icons'] = $icons;
		}
		$payment = self::payment_return( (int) $form['id'] );
		if ( null !== $payment ) {
			$config['payment'] = $payment;
		}
		return $config;
	}

	/**
	 * Container of a form for the builder's preview: the document as given (usually the draft),
	 * with the API of the preview, no tracking code and no password prompt.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Document to show.
	 * @param string              $endpoint REST base of the preview (Http\PreviewController).
	 * @param string              $wanted   Language to show when the form has it; empty as on the website.
	 */
	public static function preview( array $form, array $document, string $endpoint, string $wanted = '' ): string {
		$locale   = self::locale( $document, $wanted );
		$document = self::localize( $form, $document, $locale );
		$config   = array(
			'uid'      => $form['uid'],
			'endpoint' => $endpoint,
			'locale'   => $locale,
			'strings'  => UiLocale::run( $locale, static fn() => self::strings() + self::phone_strings( $document ) ),
			'document' => self::with_site_keys( PublicDocument::from( $document, false ), $document ),
			'preview'  => true,
		);
		$maps     = Edition::pro( GoogleMaps::class );
		if ( null !== $maps && $maps::needed( $document ) ) {
			$config['mapsKey'] = $maps::key();
		}
		if ( Conditions::uses_today( $document ) ) {
			$config['timeZone'] = wp_timezone_string();
		}
		// Without the field the runtime keeps to the EU mode.
		if ( ! PrivacyMode::eu() ) {
			$config['privacy'] = PrivacyMode::current();
		}
		$icons = Icons::used( $document );
		if ( array() !== $icons ) {
			$config['icons'] = $icons;
		}
		$font = implode( '', StyleTokens::font_rules( (array) ( $document['style']['tokens'] ?? array() ), true ) );
		return ( '' !== $font ? '<style>' . $font . '</style>' : '' ) . self::custom_css( $form, $document ) . sprintf(
			'<div class="ffx-form%5$s" data-ffx-form="%1$s" style="%2$s"%3$s><script type="application/json" class="ffx-form-data">%4$s</script></div>',
			esc_attr( $form['uid'] ),
			esc_attr( self::style( (array) ( $document['style']['tokens'] ?? array() ) ) ),
			self::lang( $locale ) . ( empty( $document['settings']['rtl'] ) ? '' : ' dir="rtl"' ) . ( self::needs_more( $document ) ? ' data-ffx-more' : '' ) . self::chunk_attribute( $document ),
			wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE ),
			esc_attr( StyleTokens::classes( (array) ( $document['style']['tokens'] ?? array() ) ) )
		);
	}

	/**
	 * REST base of a form.
	 *
	 * @param array<string,mixed> $form Form row.
	 */
	private static function endpoint( array $form ): string {
		return esc_url_raw( rest_url( 'funnelforms/v1/forms/' . $form['uid'] ) );
	}

	/**
	 * Locale of a form on this page. A form in several languages takes the page's language (or
	 * another variant of it) where it has it; otherwise the interface locale of the document
	 * counts, and empty there means the language of the page, which WPML, Polylang or the
	 * visitor's own choice set, as the 3.x setting "default" did.
	 *
	 * A language the visitor chose (`ffx_lang` in the address, from the language choice of the
	 * form) or the preview asks for comes first, when the form has it.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @param string|null         $wanted   Language asked for; null for the visitor's choice in the address.
	 */
	public static function locale( array $document, ?string $wanted = null ): string {
		$page      = determine_locale();
		$available = (array) ( $document['locales']['available'] ?? array() );
		if ( null === $wanted ) {
			// A choice of language only, like a WPML language parameter; nothing is changed.
			$wanted = isset( $_GET['ffx_lang'] ) && is_string( $_GET['ffx_lang'] ) ? sanitize_key( wp_unslash( $_GET['ffx_lang'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		}
		foreach ( $available as $candidate ) {
			if ( '' !== $wanted && strtolower( (string) $candidate ) === strtolower( $wanted ) ) {
				return (string) $candidate;
			}
		}
		// Forms in several languages follow the page where they have its language (WPML, Polylang).
		if ( count( $available ) > 1 ) {
			$language = strtok( $page, '_' );
			foreach ( array( $page, $language ) as $wanted ) {
				foreach ( $available as $candidate ) {
					if ( $candidate === $wanted || ( $wanted === $language && strtok( (string) $candidate, '_' ) === $language ) ) {
						return (string) $candidate;
					}
				}
			}
		}
		$locale = (string) ( $document['settings']['uiLocale'] ?? $document['locales']['default'] );
		return '' !== $locale ? $locale : $page;
	}

	/**
	 * Adds the public site key and the provider to captcha fields (the connection itself stays private).
	 *
	 * @param array<string,mixed> $shown    Public document.
	 * @param array<string,mixed> $document Form document.
	 * @return array<string,mixed>
	 */
	private static function with_site_keys( array $shown, array $document ): array {
		$keys = array();
		foreach ( $document['nodes'] as $node ) {
			foreach ( 'contact' === $node['type'] ? $node['fields'] : array() as $field ) {
				if ( 'captcha' === $field['type'] ) {
					$keys[ $field['id'] ] = array(
						'siteKey'  => Captcha::site_key( $field ),
						'provider' => Captcha::provider( $field ),
					);
					if ( 'recaptcha3' === $keys[ $field['id'] ]['provider'] ) {
						// The invisible reCAPTCHA runs from a chunk of the runtime that only these forms load. The
						// runtime appends the query of the providers (?onload=…); the chunk ignores it, ver only
						// has to change with the version.
						$keys[ $field['id'] ]['src'] = self::chunk_url( 'recaptcha3' );
					}
				}
			}
		}
		foreach ( $shown['nodes'] as $n => $node ) {
			foreach ( 'contact' === $node['type'] ? $node['fields'] : array() as $f => $field ) {
				if ( isset( $keys[ $field['id'] ] ) ) {
					$shown['nodes'][ $n ]['fields'][ $f ]['props'] = $keys[ $field['id'] ] + (array) $shown['nodes'][ $n ]['fields'][ $f ]['props'];
				}
			}
		}
		return $shown;
	}

	/**
	 * Whether a form shows icons of Font Awesome (a 3.x form with the icon font switched on).
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public static function icon_font( array $document ): bool {
		return ! empty( $document['settings']['iconFont'] );
	}

	/**
	 * Address of the Font Awesome stylesheet.
	 */
	public static function icon_font_url(): string {
		return plugins_url( 'assets/icons/fontawesome.css', FUNNELFORMS_PLUGIN_FILE );
	}

	/**
	 * The lang attribute of a form in the given locale (de_DE_formal: de-DE), so screen readers
	 * read a form in another language than the page with the right voice (WCAG 3.1.2).
	 *
	 * @param string $locale Locale of the form's texts.
	 */
	public static function lang( string $locale ): string {
		$tag = str_replace( '_', '-', (string) preg_replace( '/_formal$/', '', $locale ) );
		return 1 === preg_match( '/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/', $tag ) ? ' lang="' . esc_attr( $tag ) . '"' : '';
	}

	/**
	 * Whether a form needs the second style sheet (runtime-more.css): popups, and forms with field
	 * types or features not every form has, such as dropdowns with a search box or several answers,
	 * the theme options of a shadow on the main button and headings in capitals, and headings in a
	 * content block or thank-you text.
	 * The runtime's styles.ts loads it for forms marked so.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @param array<string,mixed> $popup    Popup of the shortcode; empty inline.
	 */
	public static function needs_more( array $document, array $popup = array() ): bool {
		if ( '' !== (string) ( $popup['mode'] ?? '' ) || 1 === preg_match( '/"type":"(booking|address|file|signature|repeat|rating|result|slider|salutation)"|"(loader|quiz|timeLimit|range|confetti)"|"(languageSwitch|saveProgress)":true|"downloads":\[\{|"kind":"video"|"(button\.shadow|heading\.case)":"|"abandonment":\{|<h[1-6][ >]/i', (string) wp_json_encode( $document ) ) ) {
			return true;
		}
		foreach ( (array) ( $document['nodes'] ?? array() ) as $node ) {
			foreach ( is_array( $node ) ? (array) ( $node['fields'] ?? array() ) : array() as $field ) {
				if ( is_array( $field ) && 'dropdown' === ( $field['type'] ?? '' ) && ( ! empty( $field['props']['search'] ) || ! empty( $field['props']['multiple'] ) ) ) {
					return true;
				}
			}
		}
		return PhoneNumbers::used( $document );
	}

	/**
	 * The scripts of features a form has, beside runtime.js (packages/runtime/src/chunks, each
	 * runtime-<name>.js): live (live results, Pro), phone (phone fields with a country picker or
	 * a confirmation by text message), abandon (reminders, Pro) and the Pro field types address,
	 * booking and repeat, whose controls lie in a chunk of the same name (fields.ts later()). The
	 * plugin enqueues them (enqueue()) and marks the form with them (chunk_attribute()), so the
	 * runtime adds them where a form is shown otherwise.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return string[]
	 */
	public static function chunks( array $document ): array {
		$pro   = Edition::is_pro();
		$types = $pro ? self::step_field_types( $document ) : array();
		return array_keys(
			array_filter(
				array(
					'live'    => self::needs_live( $document ),
					'phone'   => PhoneNumbers::used( $document ),
					// Reminders to visitors who leave (Funnelforms Pro, Application\Abandonment).
					'abandon' => $pro && ! empty( $document['settings']['abandonment']['field'] ),
					'address' => in_array( 'address', $types, true ),
					'booking' => in_array( 'booking', $types, true ),
					'repeat'  => in_array( 'repeat', $types, true ),
				)
			)
		);
	}

	/**
	 * The types of the fields of a form's steps.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return string[]
	 */
	private static function step_field_types( array $document ): array {
		$types = array();
		foreach ( (array) ( $document['nodes'] ?? array() ) as $node ) {
			if ( is_array( $node ) && 'step' === ( $node['type'] ?? '' ) ) {
				foreach ( (array) ( $node['fields'] ?? array() ) as $field ) {
					$types[] = is_array( $field ) ? (string) ( $field['type'] ?? '' ) : '';
				}
			}
		}
		return array_values( array_unique( $types ) );
	}

	/**
	 * The chunks of a form as an attribute for the runtime: data-ffx-chunks="live phone".
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public static function chunk_attribute( array $document ): string {
		$chunks = self::chunks( $document );
		return array() === $chunks ? '' : ' data-ffx-chunks="' . esc_attr( implode( ' ', $chunks ) ) . '"';
	}

	/**
	 * Address of a chunk of the runtime, with the version: runtime-<name>.js.
	 *
	 * @param string $name Chunk, such as phone or recaptcha3.
	 */
	public static function chunk_url( string $name ): string {
		return plugins_url( 'assets/runtime/runtime-' . $name . '.js', FUNNELFORMS_PLUGIN_FILE ) . '?ver=' . rawurlencode( (string) FUNNELFORMS_ASSET_VERSION );
	}

	/**
	 * Whether a form updates calculation results while the visitor answers (Funnelforms Pro): it
	 * has a live result (ResultField), or a step that shows a result ({{calc:…}}) next to a
	 * question. The runtime then loads runtime-live.js for it (chunks()).
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public static function needs_live( array $document ): bool {
		if ( ! Edition::is_pro() ) {
			return false;
		}
		foreach ( (array) ( $document['nodes'] ?? array() ) as $node ) {
			$fields = is_array( $node ) && 'step' === ( $node['type'] ?? '' ) ? (array) ( $node['fields'] ?? array() ) : array();
			$types  = array_column( $fields, 'type' );
			if ( in_array( 'result', $types, true ) || ( array() !== array_diff( $types, array( 'content' ) ) && str_contains( (string) wp_json_encode( $fields ), '{{calc:' ) ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Registers and enqueues the runtime script and style.
	 *
	 * @param bool     $more Also the style of the field types not every form has.
	 * @param string[] $chunks Also these scripts of features (chunks()).
	 */
	public static function enqueue( bool $more = false, array $chunks = array() ): void {
		$url  = plugins_url( 'assets/runtime/', FUNNELFORMS_PLUGIN_FILE );
		$args = array(
			'in_footer' => true,
			'strategy'  => 'defer',
		);
		wp_enqueue_style( self::HANDLE, $url . 'runtime.css', array(), FUNNELFORMS_ASSET_VERSION );
		if ( $more ) {
			wp_enqueue_style( self::HANDLE . '-more', $url . 'runtime-more.css', array( self::HANDLE ), FUNNELFORMS_ASSET_VERSION );
		}
		wp_enqueue_script( self::HANDLE, $url . 'runtime.js', array(), FUNNELFORMS_ASSET_VERSION, $args );
		foreach ( $chunks as $name ) {
			// WordPress gives it the id funnelforms-runtime-<name>-js, by which the runtime knows it is there.
			wp_enqueue_script( self::HANDLE . '-' . $name, $url . 'runtime-' . $name . '.js', array( self::HANDLE ), FUNNELFORMS_ASSET_VERSION, $args );
		}
	}

	/**
	 * Keeps optimization and consent plugins from delaying or rewriting the runtime.
	 *
	 * @param string $tag    Script tag.
	 * @param string $handle Handle.
	 */
	public static function script_tag( string $tag, string $handle ): string {
		if ( self::HANDLE !== $handle && ! str_starts_with( $handle, self::HANDLE . '-' ) ) {
			return $tag;
		}
		return str_replace( '<script ', '<script data-no-optimize="1" data-cfasync="false" data-no-defer="1" ', $tag );
	}

	/**
	 * The @font-face rules of the form's fonts, each once per page.
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	private static function font_style( array $document ): string {
		$out = '';
		foreach ( StyleTokens::font_rules( (array) ( $document['style']['tokens'] ?? array() ) ) as $css ) {
			$key = md5( $css );
			if ( ! isset( self::$printed[ $key ] ) ) {
				self::$printed[ $key ] = true;
				$out                  .= $css;
			}
		}
		return '' === $out ? '' : '<style>' . $out . '</style>';
	}

	/**
	 * The document in the visitor's language (forms in several languages are Funnelforms Pro).
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Form document.
	 * @param string              $locale   Language of the visitor.
	 * @return array<string,mixed>
	 */
	private static function localize( array $form, array $document, string $locale ): array {
		$multilingual = Edition::pro( Multilingual::class );
		return null === $multilingual ? $document : $multilingual::localize( $form, $document, $locale );
	}

	/**
	 * The payment a visitor is back from, for this form (payments are Funnelforms Pro).
	 *
	 * @param int $form_id Form ID.
	 * @return array<string,mixed>|null
	 */
	private static function payment_return( int $form_id ): ?array {
		$payments = Edition::pro( PaymentReturn::class );
		return null === $payments ? null : $payments::for_form( $form_id );
	}

	/**
	 * The form's own CSS (style.css), once per form and page. Only users with unfiltered_html may
	 * add or change it (Domain\Form\SensitiveChanges); "<" is escaped so it cannot end the element.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Form document.
	 */
	private static function custom_css( array $form, array $document ): string {
		$css = trim( (string) ( $document['style']['css'] ?? '' ) );
		$key = 'css:' . $form['uid'];
		// Custom CSS is Pro; Free shows the form in its theme without it.
		if ( '' === $css || isset( self::$printed[ $key ] ) || Edition::is_free() ) {
			return '';
		}
		self::$printed[ $key ] = true;
		return '<style class="ffx-custom-css">' . str_replace( array( '<', "\0" ), array( '\3c ', '' ), substr( $css, 0, self::MAX_CSS ) ) . '</style>';
	}

	/**
	 * CSS variables of the form's style tokens.
	 *
	 * @param array<string,mixed> $tokens Tokens.
	 */
	private static function style( array $tokens ): string {
		return StyleTokens::css( $tokens );
	}

	/**
	 * Interface texts of the runtime, translated by WordPress.
	 *
	 * @param array<string,mixed> $document Form document; a form for members without a password
	 *                                      asks to reload the page only.
	 * @return array<string,string>
	 */
	private static function strings( array $document = array() ): array {
		$unlock = FormAccess::login_required( $document ) && ! FormAccess::has_password( $document )
			? __( 'Please reload the page to send the form.', 'funnelforms-free' )
			: __( 'Please reload the page and enter the password again.', 'funnelforms-free' );
		return array(
			'next'                    => __( 'Next', 'funnelforms-free' ),
			'back'                    => __( 'Back', 'funnelforms-free' ),
			'submit'                  => __( 'Send', 'funnelforms-free' ),
			'sending'                 => __( 'Sending…', 'funnelforms-free' ),
			'progress'                => __( 'Progress', 'funnelforms-free' ),
			/* translators: 1: number of the current step, 2: number of steps. */
			'step_of'                 => __( 'Step %1$d of %2$d', 'funnelforms-free' ),
			'language'                => __( 'Language', 'funnelforms-free' ),
			'choose'                  => __( 'Please choose', 'funnelforms-free' ),
			'search'                  => __( 'Search', 'funnelforms-free' ),
			'no_matches'              => __( 'No matches', 'funnelforms-free' ),
			'quizRight'               => __( 'Right!', 'funnelforms-free' ),
			/* translators: %s: the right answers of a quiz question */
			'quizWrong'               => __( 'Not quite. The right answer: %s', 'funnelforms-free' ),
			'salutation_male'         => __( 'Mr.', 'funnelforms-free' ),
			'salutation_female'       => __( 'Ms.', 'funnelforms-free' ),
			'salutation_diverse'      => __( 'Diverse', 'funnelforms-free' ),
			'salutation_company'      => __( 'Company', 'funnelforms-free' ),
			'required'                => __( 'This field is required.', 'funnelforms-free' ),
			'invalid_option'          => __( 'Please choose one of the options.', 'funnelforms-free' ),
			/* translators: %d: smallest number of options. */
			'too_few_choices'         => __( 'Please choose at least %d options.', 'funnelforms-free' ),
			/* translators: %d: largest number of options. */
			'too_many_choices'        => __( 'Please choose at most %d options.', 'funnelforms-free' ),
			'invalid_format'          => __( 'The format is not valid.', 'funnelforms-free' ),
			'invalid_date'            => __( 'Please enter a valid date.', 'funnelforms-free' ),
			'date_out_of_range'       => __( 'Please choose a date in the allowed period.', 'funnelforms-free' ),
			'invalid_range'           => __( 'The end must not be before the start.', 'funnelforms-free' ),
			'date_from'               => __( 'From', 'funnelforms-free' ),
			'date_to'                 => _x( 'To', 'end of a date range', 'funnelforms-free' ),
			'invalid_email'           => __( 'The e-mail address is not valid.', 'funnelforms-free' ),
			'business_email_required' => __( 'Please enter a business e-mail address.', 'funnelforms-free' ),
			'invalid_phone'           => __( 'The phone number is not valid.', 'funnelforms-free' ),
			'invalid_length'          => __( 'The text does not have the required length.', 'funnelforms-free' ),
			'too_short'               => __( 'The text is too short.', 'funnelforms-free' ),
			'too_long'                => __( 'The text is too long.', 'funnelforms-free' ),
			'out_of_range'            => __( 'The value is outside the allowed range.', 'funnelforms-free' ),
			'invalid_url'             => __( 'The web address is not valid.', 'funnelforms-free' ),
			'invalid_time'            => __( 'Please enter a valid time.', 'funnelforms-free' ),
			/* translators: 1: chosen rating, 2: highest rating. */
			'rating_value'            => __( '%1$s of %2$s', 'funnelforms-free' ),
			'clear_signature'         => __( 'Clear', 'funnelforms-free' ),
			'type_signature'          => __( 'Or type your name', 'funnelforms-free' ),
			'upload_signature'        => __( 'Or upload a picture of your signature', 'funnelforms-free' ),
			'add_item'                => __( 'Add another', 'funnelforms-free' ),
			/* translators: %d: number of the entry in a repeat group. */
			'remove_item'             => __( 'Remove entry %d', 'funnelforms-free' ),
			/* translators: %d: smallest number of entries. */
			'too_few_items'           => __( 'Please fill in at least %d entries.', 'funnelforms-free' ),
			'too_many_items'          => __( 'Too many entries.', 'funnelforms-free' ),
			'save_progress'           => __( 'Save and continue later', 'funnelforms-free' ),
			'progress_saved'          => __( 'Your answers are saved. Continue later with this link:', 'funnelforms-free' ),
			'resume_link'             => __( 'Link to continue', 'funnelforms-free' ),
			'copy_link'               => __( 'Copy link', 'funnelforms-free' ),
			'link_copied'             => __( 'Copied', 'funnelforms-free' ),
			'nothing_to_save'         => __( 'Please answer at least one question first.', 'funnelforms-free' ),
			'progress_not_found'      => __( 'This link has expired or is not valid. Please start again.', 'funnelforms-free' ),
			/* translators: %s: error code, e.g. rate_limited. */
			'error'                   => __( 'The form could not be sent (%s). Please try again.', 'funnelforms-free' ),
			'rate_limited'            => __( 'Too many attempts. Please wait a few minutes and try again.', 'funnelforms-free' ),
			'calc_error'              => __( 'An error occurred in the calculation!', 'funnelforms-free' ),
			/* translators: %s: a price or other result, e.g. "1,200 €". */
			'live_from'               => __( 'from %s', 'funnelforms-free' ),
			'live_locked'             => __( 'Your result is ready. We will show it to you in full after your contact details.', 'funnelforms-free' ),
			'video_load'              => __( 'Load video', 'funnelforms-free' ),
			/* translators: %s: YouTube or Vimeo. */
			'video_note'              => __( 'The video is loaded from %s only when you click. Its privacy policy applies then.', 'funnelforms-free' ),
			'choose_files'            => __( 'Drop files here or click to choose', 'funnelforms-free' ),
			'uploading'               => __( 'Uploading…', 'funnelforms-free' ),
			/* translators: %s: file name. */
			'remove_file'             => __( 'Remove %s', 'funnelforms-free' ),
			'file_too_large'          => __( 'The file is too large.', 'funnelforms-free' ),
			'file_type_not_allowed'   => __( 'This file type is not allowed.', 'funnelforms-free' ),
			'too_many_files'          => __( 'Too many files.', 'funnelforms-free' ),
			'too_many_uploads'        => __( 'Too many uploads. Please try again later.', 'funnelforms-free' ),
			'upload_failed'           => __( 'The file could not be uploaded.', 'funnelforms-free' ),
			'booking_duration'        => __( 'Duration', 'funnelforms-free' ),
			'booking_prev_month'      => __( 'Previous month', 'funnelforms-free' ),
			'booking_next_month'      => __( 'Next month', 'funnelforms-free' ),
			'booking_loading'         => __( 'Loading free times…', 'funnelforms-free' ),
			'booking_no_times'        => __( 'No free times this month.', 'funnelforms-free' ),
			'booking_none'            => __( 'No appointments can be booked at the moment.', 'funnelforms-free' ),
			/* translators: %s: time zone, e.g. Europe/Berlin. */
			'booking_timezone'        => __( 'Times in your time zone (%s)', 'funnelforms-free' ),
			/* translators: %s: date, time and duration of the appointment. */
			'booking_selected'        => __( 'Your appointment: %s', 'funnelforms-free' ),
			'booking_unavailable'     => __( 'The free times could not be loaded. Please try again later.', 'funnelforms-free' ),
			'slot_taken'              => __( 'This time has just been booked. Please choose another one.', 'funnelforms-free' ),
			'invalid_booking'         => __( 'Please choose a time.', 'funnelforms-free' ),
			'captcha_failed'          => __( 'Please confirm that you are not a robot.', 'funnelforms-free' ),
			'invalid_file'            => __( 'The file is no longer available. Please upload it again.', 'funnelforms-free' ),
			'incomplete_address'      => __( 'Please fill in the complete address.', 'funnelforms-free' ),
			'address'                 => __( 'Address', 'funnelforms-free' ),
			'street'                  => __( 'Street', 'funnelforms-free' ),
			'street_number'           => __( 'No.', 'funnelforms-free' ),
			'postcode'                => __( 'Postcode', 'funnelforms-free' ),
			'city'                    => __( 'City', 'funnelforms-free' ),
			'country'                 => __( 'Country', 'funnelforms-free' ),
			'use_location'            => __( 'Use my location', 'funnelforms-free' ),
			'location_failed'         => __( 'Your location could not be found. Please enter the address.', 'funnelforms-free' ),
			'password_intro'          => __( 'This form is protected by a password.', 'funnelforms-free' ),
			'password'                => __( 'Password', 'funnelforms-free' ),
			'unlock'                  => __( 'Open form', 'funnelforms-free' ),
			'wrong_password'          => __( 'The password is not correct.', 'funnelforms-free' ),
			'form_closed'             => __( 'This form is not taking any more entries.', 'funnelforms-free' ),
			/* translators: %s: time left, e.g. 4:05 */
			'time_left'               => __( 'Time left: %s', 'funnelforms-free' ),
			'time_up'                 => __( 'The time for this form is up. Your answers can no longer be sent.', 'funnelforms-free' ),
			/* translators: %s: time left, such as 0:20. */
			'time_warning'            => __( 'Only %s left.', 'funnelforms-free' ),
			'more_time'               => __( 'More time', 'funnelforms-free' ),
			'pause'                   => __( 'Pause', 'funnelforms-free' ),
			'required_mark'           => __( 'Required', 'funnelforms-free' ),
			'required_note'           => __( 'Fields marked with * are required.', 'funnelforms-free' ),
			'load_maps'               => __( 'Load Google Maps to suggest addresses', 'funnelforms-free' ),
			/* translators: %s: company of the spam protection, such as Google or Cloudflare. */
			'load_captcha'            => __( 'Load spam protection from %s to send the form', 'funnelforms-free' ),
			'unlock_required'         => $unlock,
			'embed_not_allowed'       => __( 'This form cannot be used on this website.', 'funnelforms-free' ),
			'payment_redirect'        => __( 'Taking you to the payment page…', 'funnelforms-free' ),
			'payment_open'            => __( 'The payment was not completed. Your answers are saved; you can pay now.', 'funnelforms-free' ),
			'payment_failed'          => __( 'The payment did not go through. Please try again, perhaps with another payment method.', 'funnelforms-free' ),
			'payment_refunded'        => __( 'This payment was refunded.', 'funnelforms-free' ),
			'payment_retry'           => __( 'Pay now', 'funnelforms-free' ),
			'payment_unavailable'     => __( 'The payment could not be started. Please try again later.', 'funnelforms-free' ),
			/* translators: %s: web address. */
			'preview_redirect'        => __( 'Visitors are now sent to %s.', 'funnelforms-free' ),
			/* translators: %d: seconds until the next page opens. */
			'redirect_countdown'      => __( 'You will be forwarded in %d seconds.', 'funnelforms-free' ),
			'redirect_countdown_one'  => __( 'You will be forwarded in 1 second.', 'funnelforms-free' ),
			'redirect_now'            => __( 'Go now', 'funnelforms-free' ),
			'your_answers'            => __( 'Your answers', 'funnelforms-free' ),
			'preview_unavailable'     => __( 'This is not available in the preview.', 'funnelforms-free' ),
		) + self::phone_strings( $document ) + ( empty( $document['settings']['abandonment'] ) ? array() : array(
			// Reminders to visitors who leave (runtime-abandon.js).
			'abandon_notice' => __( 'If you leave without sending, we will e-mail you one reminder with a link back to your answers.', 'funnelforms-free' ),
			'abandon_optout' => __( 'Don\'t remind me', 'funnelforms-free' ),
			'abandon_off'    => __( 'OK, you will not get a reminder.', 'funnelforms-free' ),
		) );
	}

	/**
	 * Texts of the phone chunk, only for forms that load it.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return array<string,string>
	 */
	private static function phone_strings( array $document ): array {
		if ( ! PhoneNumbers::used( $document ) ) {
			return array();
		}
		return array(
			/* translators: %s: name of the country chosen for a phone number. */
			'phone_country'             => __( 'Country code: %s', 'funnelforms-free' ),
			'phone_search'              => __( 'Search country or code', 'funnelforms-free' ),
			'phone_countries'           => __( 'Countries', 'funnelforms-free' ),
			/* translators: %d: number of countries found. */
			'phone_results'             => __( '%d countries', 'funnelforms-free' ),
			'phone_too_short'           => __( 'The phone number is too short.', 'funnelforms-free' ),
			'phone_too_long'            => __( 'The phone number is too long.', 'funnelforms-free' ),
			'phone_country_not_allowed' => __( 'Phone numbers from this country are not accepted.', 'funnelforms-free' ),
			'phone_not_confirmed'       => __( 'Please confirm your phone number with the code.', 'funnelforms-free' ),
			'sms_send'                  => __( 'Send code', 'funnelforms-free' ),
			'sms_confirm'               => __( 'Confirm', 'funnelforms-free' ),
			'sms_resend'                => __( 'Send a new code', 'funnelforms-free' ),
			/* translators: %d: seconds until a new code can be sent. */
			'sms_resend_in'             => __( 'New code in %d s', 'funnelforms-free' ),
			'sms_change'                => __( 'Change number', 'funnelforms-free' ),
			'sms_code'                  => __( 'Code from the text message', 'funnelforms-free' ),
			'sms_notice'                => __( 'We will text you a code to confirm your number.', 'funnelforms-free' ),
			'sms_preview'               => __( 'In the preview no text message is sent; any six digits confirm.', 'funnelforms-free' ),
			/* translators: %s: the phone number the code was sent to. */
			'sms_sent'                  => __( 'We sent a code to %s.', 'funnelforms-free' ),
			'sms_confirmed'             => __( 'Number confirmed.', 'funnelforms-free' ),
			'sms_failed'                => __( 'The text message could not be sent. Please check the number or try again later.', 'funnelforms-free' ),
			'sms_unavailable'           => __( 'Phone numbers cannot be confirmed at the moment.', 'funnelforms-free' ),
			'code_invalid'              => __( 'The code is not correct or has expired.', 'funnelforms-free' ),
		);
	}
}
