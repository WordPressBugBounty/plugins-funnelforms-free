<?php
/**
 * Elementor Pro form widget.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

use Funnelforms\Compat\Import\ImportedForm;
use Funnelforms\Compat\Import\Reader;

defined( 'ABSPATH' ) || exit;

/**
 * A form is a widget of type form inside a page, template or popup: post meta _elementor_data
 * holds the elements as JSON, nested by "elements". A template export is JSON {title, content}.
 * Elementor stores only settings that differ from the control default: a field without field_type
 * is a text field, a widget without submit_actions sends the e-mail. Fields are named by custom_id,
 * mail texts use [field id="..."] and [all-fields].
 */
final class Elementor implements Reader {

	private const TYPES = array(
		'text'         => 'text',
		'email'        => 'email',
		'textarea'     => 'textarea',
		'url'          => 'url',
		'tel'          => 'phone',
		'radio'        => 'radio',
		'select'       => 'select',
		'checkbox'     => 'checkbox',
		'acceptance'   => 'consent',
		'number'       => 'number',
		'date'         => 'date',
		'time'         => 'time',
		'upload'       => 'file',
		'html'         => 'html',
		'hidden'       => 'hidden',
		'recaptcha'    => 'captcha',
		'recaptcha_v3' => 'captcha',
		'step'         => 'page_break',
	);

	/**
	 * Key.
	 */
	public function key(): string {
		return 'elementor';
	}

	/**
	 * Name.
	 */
	public function label(): string {
		return 'Elementor Pro';
	}

	/**
	 * Whether a file holds an Elementor form widget.
	 *
	 * @param string $contents File contents.
	 */
	public function recognizes( string $contents ): bool {
		return false !== strpos( $contents, '"widgetType"' ) && array() !== self::widgets( self::elements( Values::json( $contents ) ) );
	}

	/**
	 * Form widgets of a template export or of _elementor_data.
	 *
	 * @param string $contents File contents.
	 * @return ImportedForm[]
	 */
	public function parse_file( string $contents ): array {
		$data  = Values::json( $contents );
		$title = is_array( $data ) ? Values::str( $data['title'] ?? '' ) : '';
		$out   = array();
		foreach ( self::widgets( self::elements( $data ) ) as $widget ) {
			$out[] = self::form( Values::str( $widget['id'] ?? '' ), $widget['settings'] ?? array(), $title );
		}
		return $out;
	}

	/**
	 * Form widgets on this site, as "<post id>:<element id>".
	 *
	 * @return array<int,array{id:string,title:string}>
	 */
	public function list_site(): array {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT p.ID, p.post_title, m.meta_value FROM %i m JOIN %i p ON p.ID = m.post_id WHERE m.meta_key = '_elementor_data' AND ( m.meta_value LIKE %s OR m.meta_value LIKE %s ) AND p.post_status NOT IN ('trash', 'auto-draft', 'inherit') ORDER BY p.ID", $wpdb->postmeta, $wpdb->posts, '%' . $wpdb->esc_like( '"widgetType":"form"' ) . '%', '%' . $wpdb->esc_like( '"widgetType": "form"' ) . '%' ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.SlowDBQuery
		$out  = array();
		foreach ( is_array( $rows ) ? $rows : array() as $row ) {
			foreach ( self::widgets( self::elements( json_decode( (string) $row['meta_value'], true ) ) ) as $widget ) {
				$name  = Values::str( $widget['settings']['form_name'] ?? '' );
				$out[] = array(
					'id'    => $row['ID'] . ':' . Values::str( $widget['id'] ?? '' ),
					'title' => (string) $row['post_title'] . ( '' !== $name ? ' – ' . $name : '' ),
				);
			}
		}
		return $out;
	}

	/**
	 * A form widget on this site.
	 *
	 * @param string $id "<post id>:<element id>".
	 */
	public function read_site( string $id ): ?ImportedForm {
		list( $post_id, $element ) = array_pad( explode( ':', $id, 2 ), 2, '' );
		$data                      = get_post_meta( (int) $post_id, '_elementor_data', true );
		$data                      = is_string( $data ) ? json_decode( $data, true ) : $data;
		foreach ( self::widgets( self::elements( $data ) ) as $widget ) {
			if ( Values::str( $widget['id'] ?? '' ) === $element ) {
				return self::form( $id, $widget['settings'] ?? array(), get_the_title( (int) $post_id ) );
			}
		}
		return null;
	}

	/**
	 * The elements of a template export or of _elementor_data.
	 *
	 * @param mixed $data Decoded JSON.
	 * @return array<int,mixed>
	 */
	private static function elements( $data ): array {
		if ( ! is_array( $data ) ) {
			return array();
		}
		return array_is_list( $data ) ? $data : Values::items( $data['content'] ?? array() );
	}

	/**
	 * Form widgets among elements and their children.
	 *
	 * @param array<int,mixed> $elements Elements.
	 * @return array<int,array<string,mixed>>
	 */
	private static function widgets( array $elements ): array {
		$out = array();
		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) ) {
				continue;
			}
			if ( 'form' === ( $element['widgetType'] ?? '' ) && is_array( $element['settings'] ?? null ) ) {
				$out[] = $element;
			}
			$out = array_merge( $out, self::widgets( Values::items( $element['elements'] ?? array() ) ) );
		}
		return $out;
	}

	/**
	 * One form widget.
	 *
	 * @param string              $id       Id.
	 * @param array<string,mixed> $settings Widget settings.
	 * @param string              $page     Title of the page or template.
	 */
	public static function form( string $id, array $settings, string $page ): ImportedForm {
		$notes  = array();
		$fields = array();
		foreach ( Values::items( $settings['form_fields'] ?? array() ) as $index => $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}
			$el   = Values::str( $field['field_type'] ?? '' );
			$el   = '' !== $el ? $el : 'text';
			$type = self::TYPES[ $el ] ?? null;
			if ( 'honeypot' === $el ) {
				continue;
			}
			if ( null === $type ) {
				$notes[] = 'field_type_not_imported:' . $el . ':' . Values::str( $field['field_label'] ?? '' );
				continue;
			}
			$custom = Values::str( $field['custom_id'] ?? '' );
			$custom = '' !== $custom ? $custom : Values::str( $field['_id'] ?? 'field_' . $index );
			if ( 'page_break' === $type ) {
				if ( array() !== $fields ) {
					$fields[] = array(
						'id'    => $custom,
						'type'  => 'page_break',
						'label' => Values::str( $field['field_label'] ?? '' ),
					);
				}
				continue;
			}
			$options = array();
			foreach ( preg_split( '/\r\n|\r|\n/', Values::str( $field['field_options'] ?? '' ) ) as $line ) {
				if ( '' === trim( (string) $line ) ) {
					continue;
				}
				$parts     = explode( '|', (string) $line, 2 );
				$options[] = array(
					'label' => $parts[0],
					'value' => $parts[1] ?? $parts[0],
				);
			}
			$label = Values::str( $field['field_label'] ?? '' );
			$item  = array(
				'id'          => $custom,
				'type'        => $type,
				'label'       => '' !== $label ? $label : Values::str( $field['placeholder'] ?? '' ),
				'required'    => Values::flag( $field['required'] ?? '' ),
				'placeholder' => Values::str( $field['placeholder'] ?? '' ),
				'default'     => Values::str( $field['field_value'] ?? '' ),
				'options'     => $options,
				'multiple'    => Values::flag( $field['allow_multiple'] ?? '' ),
			);
			if ( 'html' === $el ) {
				$item['html'] = Values::str( $field['field_html'] ?? '' );
			} elseif ( 'acceptance' === $el ) {
				$text          = Values::str( $field['acceptance_text'] ?? '' );
				$item['label'] = '' !== $text ? $text : $item['label'];
				$item['html']  = $text;
			} elseif ( 'number' === $el ) {
				foreach ( array(
					'min' => 'field_min',
					'max' => 'field_max',
				) as $limit => $setting ) {
					if ( is_numeric( $field[ $setting ] ?? null ) ) {
						$item[ $limit ] = $field[ $setting ];
					}
				}
			}
			$fields[] = $item;
		}

		$actions       = is_array( $settings['submit_actions'] ?? null ) ? $settings['submit_actions'] : array( 'email' );
		$unknown       = array();
		$notifications = array();
		foreach ( array(
			'email'  => '',
			'email2' => '_2',
		) as $action => $suffix ) {
			if ( ! in_array( $action, $actions, true ) ) {
				continue;
			}
			$value           = static fn( string $key, string $fallback = '' ): string => '' !== Values::str( $settings[ $key . $suffix ] ?? '' ) ? Values::str( $settings[ $key . $suffix ] ) : $fallback;
			$body            = self::tags( $value( 'email_content', '[all-fields]' ), $unknown );
			$notifications[] = array(
				'to'        => self::tags( $value( 'email_to', '' === $suffix ? '{{admin_email}}' : '' ), $unknown ),
				'cc'        => self::tags( $value( 'email_to_cc' ), $unknown ),
				'bcc'       => self::tags( $value( 'email_to_bcc' ), $unknown ),
				'subject'   => self::tags( $value( 'email_subject', '{{form:title}}' ), $unknown ),
				'from_name' => self::tags( $value( 'email_from_name', '{{site_title}}' ), $unknown ),
				'from'      => self::tags( $value( 'email_from' ), $unknown ),
				'reply_to'  => self::tags( $value( 'email_reply_to' ), $unknown ),
				'body'      => 'plain' === $value( 'email_content_type' ) ? str_replace( array( '<', '>' ), array( '&lt;', '&gt;' ), $body ) : $body,
			);
		}
		foreach ( array_diff( $actions, array( 'email', 'email2', 'redirect' ) ) as $action ) {
			$notes[] = 'action_not_imported:' . Values::str( $action );
		}

		$confirmation = null;
		if ( in_array( 'redirect', $actions, true ) && '' !== Values::str( $settings['redirect_to'] ?? '' ) ) {
			$confirmation = array(
				'type' => 'redirect',
				'url'  => self::tags( Values::str( $settings['redirect_to'] ), $unknown ),
			);
		} elseif ( '' !== Values::str( $settings['custom_messages'] ?? '' ) && '' !== Values::str( $settings['success_message'] ?? '' ) ) {
			$confirmation = array(
				'type'    => 'message',
				'message' => Values::str( $settings['success_message'] ),
			);
		}
		foreach ( array_unique( $unknown ) as $tag ) {
			$notes[] = 'template_tag_not_imported:' . $tag;
		}

		$name = Values::str( $settings['form_name'] ?? '' );
		return new ImportedForm(
			'elementor',
			$id,
			'' !== $name && 'New Form' !== $name ? $name : ( '' !== $page ? $page : $name ),
			$fields,
			$notifications,
			$confirmation,
			Values::str( $settings['button_text'] ?? '' ),
			$notes
		);
	}

	/**
	 * Shortcodes to builder tokens.
	 *
	 * @param string   $text    Text.
	 * @param string[] $unknown Unknown shortcodes.
	 */
	private static function tags( string $text, array &$unknown ): string {
		return Values::tokens(
			$text,
			'/\[(all-fields|field\s+id=["\']([^"\']*)["\'])\]/',
			static fn( array $m ): string => 'all-fields' === $m[1] ? '{{answers}}' : '{{src:' . $m[2] . '}}',
			$unknown
		);
	}
}
