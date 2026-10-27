<?php
/**
 * Formidable Forms (Lite and Pro).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

use Funnelforms\Compat\Import\ImportedForm;
use Funnelforms\Compat\Import\Reader;

defined( 'ABSPATH' ) || exit;

/**
 * Forms are rows of frm_forms with their fields in frm_fields (options PHP-serialized); e-mails and
 * the confirmation are posts of type frm_form_actions (menu_order = form id, post_excerpt = kind,
 * post_content = JSON). The export (Tools > Import/Export) is XML: <form> with <field> elements and
 * the actions as <view>, arrays as JSON. Since 3.06 the export leaves out field options with
 * default values. Shortcodes name fields by id or key ([12], [email]), [default-message] is all
 * answers.
 */
final class Formidable implements Reader {

	private const TYPES = array(
		'text'     => 'text',
		'textarea' => 'textarea',
		'rte'      => 'textarea',
		'email'    => 'email',
		'url'      => 'url',
		'website'  => 'url',
		'number'   => 'number',
		'phone'    => 'phone',
		'name'     => 'name',
		'checkbox' => 'checkbox',
		'radio'    => 'radio',
		'select'   => 'select',
		'html'     => 'html',
		'divider'  => 'html',
		'hidden'   => 'hidden',
		'captcha'  => 'captcha',
		'gdpr'     => 'consent',
		'toggle'   => 'consent',
		'file'     => 'file',
		'date'     => 'date',
		'time'     => 'time',
		'scale'    => 'slider',
		'range'    => 'slider',
		'star'     => 'rating',
		'address'  => 'address',
		'break'    => 'page_break',
	);

	/**
	 * Field types without a value to take over.
	 */
	private const SKIPPED = array( 'submit', 'end_divider', 'user_id', 'summary' );

	/**
	 * Key.
	 */
	public function key(): string {
		return 'formidable';
	}

	/**
	 * Name.
	 */
	public function label(): string {
		return 'Formidable Forms';
	}

	/**
	 * Whether a file is a Formidable export.
	 *
	 * @param string $contents File contents.
	 */
	public function recognizes( string $contents ): bool {
		return false !== strpos( $contents, '<form_key>' ) && false !== strpos( $contents, '<channel>' ) && null !== Values::xml( $contents );
	}

	/**
	 * Forms of an export.
	 *
	 * @param string $contents File contents.
	 * @return ImportedForm[]
	 */
	public function parse_file( string $contents ): array {
		$doc = Values::xml( $contents );
		if ( null === $doc ) {
			return array();
		}
		$actions = array();
		foreach ( $doc->view ?? array() as $view ) {
			if ( 'frm_form_actions' === (string) $view->post_type ) {
				$actions[ (string) $view->menu_order ][] = array(
					'type'    => (string) $view->excerpt,
					'status'  => (string) $view->status,
					'content' => (string) $view->content,
				);
			}
		}
		$out = array();
		foreach ( $doc->form ?? array() as $form ) {
			if ( (int) $form->parent_form_id > 0 ) {
				continue;
			}
			$fields = array();
			foreach ( $form->field as $field ) {
				$fields[] = array(
					'id'            => (string) $field->id,
					'field_key'     => (string) $field->field_key,
					'name'          => (string) $field->name,
					'description'   => (string) $field->description,
					'type'          => (string) $field->type,
					'default_value' => (string) $field->default_value,
					'field_order'   => (string) $field->field_order,
					'required'      => (string) $field->required,
					'options'       => (string) $field->options,
					'field_options' => (string) $field->field_options,
				);
			}
			$out[] = self::form( (string) $form->id, (string) $form->name, (string) $form->options, $fields, $actions[ (string) $form->id ] ?? array() );
		}
		return $out;
	}

	/**
	 * Forms on this site.
	 *
	 * @return array<int,array{id:string,title:string}>
	 */
	public function list_site(): array {
		global $wpdb;
		$table = $wpdb->prefix . 'frm_forms';
		if ( ! Values::table_exists( $table ) ) {
			return array();
		}
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, name FROM %i WHERE (parent_form_id IS NULL OR parent_form_id = 0) AND is_template = 0 AND status <> 'trash' ORDER BY id", $table ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return array_map(
			static fn( array $r ): array => array(
				'id'    => (string) $r['id'],
				'title' => (string) $r['name'],
			),
			is_array( $rows ) ? $rows : array()
		);
	}

	/**
	 * A form on this site.
	 *
	 * @param string $id Form id.
	 */
	public function read_site( string $id ): ?ImportedForm {
		global $wpdb;
		if ( ! Values::table_exists( $wpdb->prefix . 'frm_forms' ) ) {
			return null;
		}
		$form = $wpdb->get_row( $wpdb->prepare( 'SELECT id, name, options FROM %i WHERE id = %d', $wpdb->prefix . 'frm_forms', (int) $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( ! is_array( $form ) ) {
			return null;
		}
		$fields  = $wpdb->get_results( $wpdb->prepare( 'SELECT id, field_key, name, description, type, default_value, field_order, required, options, field_options FROM %i WHERE form_id = %d ORDER BY field_order, id', $wpdb->prefix . 'frm_fields', (int) $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$actions = array();
		foreach ( get_posts(
			array(
				'post_type'      => 'frm_form_actions',
				'post_status'    => array( 'publish', 'draft' ),
				'menu_order'     => (int) $id,
				'posts_per_page' => 100,
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		) as $post ) {
			$actions[] = array(
				'type'    => $post->post_excerpt,
				'status'  => $post->post_status,
				'content' => $post->post_content,
			);
		}
		return self::form( (string) $form['id'], (string) $form['name'], $form['options'], is_array( $fields ) ? $fields : array(), $actions );
	}

	/**
	 * A stored array: JSON in the export, PHP-serialized on the site.
	 *
	 * @param mixed $value Value.
	 * @return mixed
	 */
	private static function decode( $value ) {
		if ( ! is_string( $value ) ) {
			return $value;
		}
		$trimmed = trim( $value );
		if ( '' !== $trimmed && ( '[' === $trimmed[0] || '{' === $trimmed[0] ) ) {
			$json = json_decode( $trimmed, true );
			if ( null !== $json ) {
				return $json;
			}
		}
		return Values::unserialized( $value );
	}

	/**
	 * One form.
	 *
	 * @param string                         $id      Id.
	 * @param string                         $title   Title.
	 * @param mixed                          $options Form options.
	 * @param array<int,array<string,mixed>> $rows    Fields as stored.
	 * @param array<int,array<string,mixed>> $actions Actions: type, status, content.
	 */
	public static function form( string $id, string $title, $options, array $rows, array $actions ): ImportedForm {
		$notes   = array();
		$options = self::decode( $options );
		$options = is_array( $options ) ? $options : array();
		usort( $rows, static fn( array $a, array $b ): int => (int) $a['field_order'] <=> (int) $b['field_order'] );
		$ids = array();
		foreach ( $rows as $row ) {
			$ids[ (string) $row['field_key'] ] = (string) $row['id'];
		}
		$titles = is_array( $options['rootline_titles'] ?? null ) ? $options['rootline_titles'] : array();

		$fields = array();
		foreach ( $rows as $row ) {
			$frm = (string) $row['type'];
			if ( in_array( $frm, self::SKIPPED, true ) ) {
				continue;
			}
			$type = self::TYPES[ $frm ] ?? null;
			if ( null === $type ) {
				$notes[] = 'field_type_not_imported:' . $frm . ':' . (string) $row['name'];
				continue;
			}
			$settings = self::decode( $row['field_options'] );
			$settings = is_array( $settings ) ? $settings : array();
			if ( 'page_break' === $type ) {
				$fields[] = array(
					'id'    => (string) $row['id'],
					'type'  => 'page_break',
					'label' => Values::str( $titles[ (string) $row['id'] ] ?? '' ),
				);
				continue;
			}
			$fields[] = self::field( $row, $type, $settings );
		}

		$unknown       = array();
		$notifications = array();
		$on_submit     = null;
		foreach ( $actions as $action ) {
			if ( 'publish' !== (string) $action['status'] ) {
				continue;
			}
			$settings = self::decode( $action['content'] );
			$settings = is_array( $settings ) ? $settings : array();
			if ( self::has_conditions( $settings['conditions'] ?? null ) ) {
				$notes[] = 'action_conditions_not_imported:' . (string) $action['type'];
			}
			switch ( (string) $action['type'] ) {
				case 'email':
					if ( ! in_array( 'create', Values::items( $settings['event'] ?? array( 'create' ) ), true ) ) {
						$notes[] = 'notification_not_on_submit_skipped';
						break;
					}
					$from = Values::str( $settings['from'] ?? '' );
					$name = '';
					if ( preg_match( '/^(.*)<([^>]+)>\s*$/', $from, $s ) ) {
						$name = trim( $s[1] );
						$from = trim( $s[2] );
					}
					$subject         = Values::str( $settings['email_subject'] ?? '' );
					$notifications[] = array(
						'to'        => self::tags( Values::str( $settings['email_to'] ?? '[admin_email]' ), $ids, $unknown ),
						'cc'        => self::tags( Values::str( $settings['cc'] ?? '' ), $ids, $unknown ),
						'bcc'       => self::tags( Values::str( $settings['bcc'] ?? '' ), $ids, $unknown ),
						'subject'   => '' !== $subject ? self::tags( $subject, $ids, $unknown ) : '{{form:title}}',
						'from_name' => self::tags( $name, $ids, $unknown ),
						'from'      => self::tags( $from, $ids, $unknown ),
						'reply_to'  => self::tags( Values::str( $settings['reply_to'] ?? '' ), $ids, $unknown ),
						'body'      => self::tags( Values::str( $settings['email_message'] ?? '[default-message]' ), $ids, $unknown ),
					);
					break;
				case 'on_submit':
					$on_submit = $on_submit ?? $settings;
					break;
				default:
					$notes[] = 'action_not_imported:' . (string) $action['type'];
			}
		}

		// Since 6.0 an on_submit action holds what older forms keep in their options.
		$success      = $on_submit ?? $options;
		$confirmation = null;
		switch ( Values::str( $success['success_action'] ?? 'message' ) ) {
			case 'redirect':
				$confirmation = array(
					'type' => 'redirect',
					'url'  => self::tags( Values::str( $success['success_url'] ?? '' ), $ids, $unknown ),
				);
				break;
			case 'page':
				$confirmation = Site::page_confirmation( $success['success_page_id'] ?? 0, $notes );
				break;
			default:
				$message      = Values::str( $success['success_msg'] ?? '' );
				$confirmation = '' !== $message ? array(
					'type'    => 'message',
					'message' => self::tags( $message, $ids, $unknown ),
				) : null;
		}
		foreach ( array_unique( $unknown ) as $tag ) {
			$notes[] = 'template_tag_not_imported:' . $tag;
		}

		return new ImportedForm(
			'formidable',
			$id,
			$title,
			$fields,
			$notifications,
			$confirmation,
			Values::str( $options['submit_value'] ?? '' ),
			$notes
		);
	}

	/**
	 * One field in the common shape.
	 *
	 * @param array<string,mixed> $row      Field row.
	 * @param string              $type     Imported type.
	 * @param array<string,mixed> $settings field_options.
	 * @return array<string,mixed>
	 */
	private static function field( array $row, string $type, array $settings ): array {
		$frm      = (string) $row['type'];
		$separate = Values::flag( $settings['separate_value'] ?? false );
		$options  = array();
		foreach ( Values::items( self::decode( $row['options'] ) ) as $option ) {
			$label = is_array( $option ) ? Values::str( $option['label'] ?? '' ) : Values::str( $option );
			$value = is_array( $option ) && $separate ? Values::str( $option['value'] ?? '' ) : $label;
			if ( '' === $label && '' === $value ) {
				continue;
			}
			$options[] = array(
				'label' => $label,
				'value' => '' !== $value ? $value : $label,
			);
		}
		$default = self::decode( $row['default_value'] );
		$item    = array(
			'id'          => (string) $row['id'],
			'type'        => $type,
			'label'       => (string) $row['name'],
			'required'    => Values::flag( $row['required'] ),
			'placeholder' => is_string( $settings['placeholder'] ?? null ) ? $settings['placeholder'] : '',
			'description' => 'html' === $frm ? '' : (string) $row['description'],
			'default'     => is_array( $default ) ? implode( ',', array_filter( array_map( array( Values::class, 'str' ), $default ) ) ) : Values::str( $default ),
			'options'     => $options,
			'multiple'    => Values::flag( $settings['multiple'] ?? false ),
			'conditional' => array() !== array_filter( Values::items( $settings['hide_field'] ?? array() ), static fn( $f ): bool => '' !== Values::str( $f ) ),
		);
		switch ( $frm ) {
			case 'html':
				$item['html'] = (string) $row['description'];
				break;
			case 'divider':
				$item['html'] = '<h3>' . (string) $row['name'] . '</h3>' . ( '' !== (string) $row['description'] ? '<p>' . (string) $row['description'] . '</p>' : '' );
				break;
			case 'gdpr':
				$item['label'] = Values::str( $settings['gdpr_agreement_text'] ?? '' );
				$item['label'] = '' !== $item['label'] ? $item['label'] : (string) $row['name'];
				$item['html']  = $item['label'];
				break;
			case 'star':
				$item['max'] = is_numeric( $settings['maxnum'] ?? null ) ? $settings['maxnum'] : 5;
				break;
		}
		if ( in_array( $type, array( 'number', 'slider' ), true ) ) {
			foreach ( array(
				'min'  => 'minnum',
				'max'  => 'maxnum',
				'step' => 'step',
			) as $limit => $setting ) {
				if ( is_numeric( $settings[ $setting ] ?? null ) ) {
					$item[ $limit ] = $settings[ $setting ];
				}
			}
		}
		return $item;
	}

	/**
	 * Whether an action only runs under conditions: numbered rules with a field.
	 *
	 * @param mixed $conditions conditions.
	 */
	private static function has_conditions( $conditions ): bool {
		if ( ! is_array( $conditions ) ) {
			return false;
		}
		foreach ( $conditions as $key => $rule ) {
			if ( is_numeric( $key ) && is_array( $rule ) && '' !== Values::str( $rule['hide_field'] ?? '' ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Shortcodes to builder tokens. Fields are named by id or key; an unknown one stays as it is.
	 *
	 * @param string               $text    Text.
	 * @param array<string,string> $ids     Field id by key.
	 * @param string[]             $unknown Unknown shortcodes.
	 */
	private static function tags( string $text, array $ids, array &$unknown ): string {
		$known = array_flip( $ids );
		return Values::tokens(
			$text,
			'/\[([a-zA-Z0-9_-]+)(?:\s[^\]]*)?\]/',
			static function ( array $m ) use ( $ids, $known ): ?string {
				switch ( $m[1] ) {
					case 'default-message':
					case 'default_message':
					case 'default-html':
					case 'default-plain':
						return '{{answers}}';
					case 'admin_email':
						return '{{admin_email}}';
					case 'sitename':
						return '{{site_title}}';
					case 'siteurl':
						return '{{site_url}}';
					case 'form_name':
						return '{{form:title}}';
					case 'id':
						return '{{entry:id}}';
					case 'created-at':
					case 'created_at':
						return '{{entry:date}}';
				}
				if ( isset( $known[ $m[1] ] ) ) {
					return '{{src:' . $m[1] . '}}';
				}
				if ( isset( $ids[ $m[1] ] ) ) {
					return '{{src:' . $ids[ $m[1] ] . '}}';
				}
				return ctype_digit( $m[1] ) ? null : $m[0];
			},
			$unknown
		);
	}
}
