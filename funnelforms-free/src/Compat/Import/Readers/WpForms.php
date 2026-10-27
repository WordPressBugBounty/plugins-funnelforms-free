<?php
/**
 * WPForms (Lite and Pro).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

use Funnelforms\Compat\Import\ImportedForm;
use Funnelforms\Compat\Import\Reader;

defined( 'ABSPATH' ) || exit;

/**
 * Forms are posts of type wpforms with the whole form as JSON in post_content; the export
 * (Tools > Export) is a JSON list of those objects. fields, choices and notifications may be a JSON
 * list or object (PHP arrays with keys from 1). Smart tags: {field_id="3"}, {all_fields},
 * {admin_email}, {page_url}, {page_title}, {entry_id}, {form_name}, {date …}.
 */
final class WpForms implements Reader {

	private const TYPES = array(
		'name'               => 'name',
		'email'              => 'email',
		'phone'              => 'phone',
		'text'               => 'text',
		'textarea'           => 'textarea',
		'richtext'           => 'textarea',
		'number'             => 'number',
		'url'                => 'url',
		'select'             => 'select',
		'radio'              => 'radio',
		'checkbox'           => 'checkbox',
		'gdpr-checkbox'      => 'consent',
		'html'               => 'html',
		'content'            => 'html',
		'divider'            => 'html',
		'file-upload'        => 'file',
		'address'            => 'address',
		'rating'             => 'rating',
		'number-slider'      => 'slider',
		'hidden'             => 'hidden',
		'captcha'            => 'captcha',
		'pagebreak'          => 'page_break',
		'net_promoter_score' => 'slider',
	);

	/**
	 * Key.
	 */
	public function key(): string {
		return 'wpforms';
	}

	/**
	 * Name.
	 */
	public function label(): string {
		return 'WPForms';
	}

	/**
	 * Whether a file is a WPForms export.
	 *
	 * @param string $contents File contents.
	 */
	public function recognizes( string $contents ): bool {
		$data = Values::json( $contents );
		$form = is_array( $data ) && array_is_list( $data ) ? ( $data[0] ?? null ) : $data;
		return is_array( $form ) && isset( $form['fields'], $form['settings'] ) && array_key_exists( 'field_id', $form );
	}

	/**
	 * Forms of an export.
	 *
	 * @param string $contents File contents.
	 * @return ImportedForm[]
	 */
	public function parse_file( string $contents ): array {
		$data  = Values::json( $contents );
		$forms = is_array( $data ) && array_is_list( $data ) ? $data : array( $data );
		$out   = array();
		foreach ( $forms as $form ) {
			if ( is_array( $form ) && isset( $form['fields'] ) ) {
				$out[] = self::form( $form );
			}
		}
		return $out;
	}

	/**
	 * Forms on this site.
	 *
	 * @return array<int,array{id:string,title:string}>
	 */
	public function list_site(): array {
		$posts = get_posts(
			array(
				'post_type'      => 'wpforms',
				'post_status'    => array( 'publish', 'draft', 'private' ),
				'posts_per_page' => 500, // phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_posts_per_page -- one admin list of another plugin's forms.
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);
		return array_map(
			static fn( \WP_Post $p ): array => array(
				'id'    => (string) $p->ID,
				'title' => $p->post_title,
			),
			$posts
		);
	}

	/**
	 * A form on this site.
	 *
	 * @param string $id Post id.
	 */
	public function read_site( string $id ): ?ImportedForm {
		$post = get_post( (int) $id );
		if ( ! $post instanceof \WP_Post || 'wpforms' !== $post->post_type ) {
			return null;
		}
		$form = json_decode( $post->post_content, true );
		if ( ! is_array( $form ) ) {
			return null;
		}
		$form['id'] = $post->ID;
		if ( '' === Values::str( $form['settings']['form_title'] ?? '' ) ) {
			$form['settings']['form_title'] = $post->post_title;
		}
		return self::form( $form );
	}

	/**
	 * One form object.
	 *
	 * @param array<string,mixed> $form Form.
	 */
	public static function form( array $form ): ImportedForm {
		$notes    = array();
		$settings = is_array( $form['settings'] ?? null ) ? $form['settings'] : array();
		$fields   = array();
		foreach ( Values::items( $form['fields'] ?? array() ) as $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}
			$wp   = Values::str( $field['type'] ?? '' );
			$type = self::TYPES[ $wp ] ?? null;
			if ( null === $type ) {
				$notes[] = 'field_type_not_imported:' . $wp . ':' . Values::str( $field['label'] ?? '' );
				continue;
			}
			if ( 'page_break' === $type && 'top' === Values::str( $field['position'] ?? '' ) ) {
				continue;
			}
			$options = array();
			foreach ( Values::items( $field['choices'] ?? array() ) as $choice ) {
				if ( is_array( $choice ) ) {
					$label     = Values::str( $choice['label'] ?? '' );
					$options[] = array(
						'label' => $label,
						'value' => Values::flag( $field['show_values'] ?? '' ) && '' !== Values::str( $choice['value'] ?? '' ) ? Values::str( $choice['value'] ) : $label,
					);
				}
			}
			$placeholder = Values::str( $field['placeholder'] ?? '' );
			if ( 'name' === $wp ) {
				$placeholder = trim( Values::str( $field['simple_placeholder'] ?? '' ) . ' ' . ( 'simple' === Values::str( $field['format'] ?? 'first-last' ) ? '' : Values::str( $field['first_placeholder'] ?? '' ) . ' ' . Values::str( $field['last_placeholder'] ?? '' ) ) );
			}
			$item = array(
				'id'          => Values::str( $field['id'] ?? '' ),
				'type'        => $type,
				'label'       => 'gdpr-checkbox' === $wp ? self::consent_text( $field, $options ) : Values::str( $field['label'] ?? '' ),
				'required'    => Values::flag( $field['required'] ?? '' ),
				'placeholder' => $placeholder,
				'description' => Values::str( $field['description'] ?? '' ),
				'default'     => Values::str( $field['default_value'] ?? '' ),
				'options'     => $options,
				'multiple'    => Values::flag( $field['multiple'] ?? '' ),
				'conditional' => Values::flag( $field['conditional_logic'] ?? '' ),
			);
			if ( 'html' === $type ) {
				$item['html'] = 'divider' === $wp ? '<h3>' . Values::str( $field['label'] ?? '' ) . '</h3>' : Values::str( $field['code'] ?? $field['content'] ?? '' );
			}
			foreach ( array( 'min', 'max', 'step' ) as $limit ) {
				if ( isset( $field[ $limit ] ) && is_numeric( $field[ $limit ] ) ) {
					$item[ $limit ] = $field[ $limit ];
				}
			}
			if ( 'number-slider' === $wp ) {
				$item['default'] = Values::str( $field['default_value'] ?? '' );
			}
			if ( 'net_promoter_score' === $wp ) {
				$item['min'] = 0;
				$item['max'] = 10;
			}
			if ( 'rating' === $wp && isset( $field['scale'] ) ) {
				$item['max'] = $field['scale'];
			}
			$fields[] = $item;
		}

		$unknown       = array();
		$notifications = array();
		if ( '0' !== Values::str( $settings['notification_enable'] ?? '1' ) ) {
			foreach ( Values::items( $settings['notifications'] ?? array() ) as $mail ) {
				if ( ! is_array( $mail ) ) {
					continue;
				}
				$notifications[] = array(
					'to'        => self::tags( Values::str( $mail['email'] ?? '' ), $unknown ),
					'cc'        => self::tags( Values::str( $mail['carboncopy'] ?? '' ), $unknown ),
					'subject'   => self::tags( Values::str( $mail['subject'] ?? '' ), $unknown ),
					'from_name' => self::tags( Values::str( $mail['sender_name'] ?? '' ), $unknown ),
					'from'      => self::tags( Values::str( $mail['sender_address'] ?? '' ), $unknown ),
					'reply_to'  => self::tags( Values::str( $mail['replyto'] ?? '' ), $unknown ),
					'body'      => self::tags( Values::str( $mail['message'] ?? '' ), $unknown ),
				);
				if ( Values::flag( $mail['conditional_logic'] ?? '' ) ) {
					$notes[] = 'notification_conditions_not_imported';
				}
			}
		}

		$confirmation  = null;
		$confirmations = Values::items( $settings['confirmations'] ?? array() );
		$first         = is_array( $confirmations[0] ?? null ) ? $confirmations[0] : array(
			'type'     => $settings['confirmation_type'] ?? 'message',
			'message'  => $settings['confirmation_message'] ?? '',
			'page'     => $settings['confirmation_page'] ?? '',
			'redirect' => $settings['confirmation_redirect'] ?? '',
		);
		if ( count( $confirmations ) > 1 ) {
			$notes[] = 'only_first_confirmation_imported';
		}
		switch ( Values::str( $first['type'] ?? 'message' ) ) {
			case 'redirect':
				$confirmation = array(
					'type' => 'redirect',
					'url'  => self::tags( Values::str( $first['redirect'] ?? '' ), $unknown ),
				);
				break;
			case 'page':
				$confirmation = Site::page_confirmation( $first['page'] ?? 0, $notes );
				break;
			default:
				$confirmation = array(
					'type'    => 'message',
					'message' => self::tags( Values::str( $first['message'] ?? '' ), $unknown ),
				);
		}
		foreach ( array_unique( $unknown ) as $tag ) {
			$notes[] = 'template_tag_not_imported:' . $tag;
		}

		return new ImportedForm(
			'wpforms',
			Values::str( $form['id'] ?? '' ),
			Values::str( $settings['form_title'] ?? '' ),
			$fields,
			$notifications,
			$confirmation,
			Values::str( $settings['submit_text'] ?? '' ),
			$notes
		);
	}

	/**
	 * The text of a GDPR box: its label, or its single choice.
	 *
	 * @param array<string,mixed>            $field   Field.
	 * @param array<int,array<string,mixed>> $options Choices.
	 */
	private static function consent_text( array $field, array $options ): string {
		$choice = Values::str( $options[0]['label'] ?? '' );
		return '' !== $choice ? $choice : Values::str( $field['label'] ?? '' );
	}

	/**
	 * Smart tags to builder tokens.
	 *
	 * @param string   $text    Text.
	 * @param string[] $unknown Unknown tags.
	 */
	private static function tags( string $text, array &$unknown ): string {
		return Values::tokens(
			$text,
			'/\{([a-z_]+)(?:="([^"]*)"|\s+[a-z_]+="[^"]*")?\}/i',
			static function ( array $m ): ?string {
				switch ( strtolower( $m[1] ) ) {
					case 'field_id':
					case 'field_value_id':
					case 'field_html_id':
						return '{{src:' . ( $m[2] ?? '' ) . '}}';
					case 'all_fields':
						return '{{answers}}';
					case 'admin_email':
						return '{{admin_email}}';
					case 'site_name':
						return '{{site_title}}';
					case 'page_url':
					case 'url_referer':
						return '{{page:url}}';
					case 'page_title':
						return '{{page:title}}';
					case 'entry_id':
						return '{{entry:id}}';
					case 'form_name':
						return '{{form:title}}';
					case 'date':
						return '{{entry:date}}';
				}
				return null;
			},
			$unknown
		);
	}
}
