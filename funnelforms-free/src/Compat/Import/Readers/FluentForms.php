<?php
/**
 * Fluent Forms.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

use Funnelforms\Compat\Import\ImportedForm;
use Funnelforms\Compat\Import\Reader;

defined( 'ABSPATH' ) || exit;

/**
 * Forms are rows of fluentform_forms with the fields as JSON {fields, submitButton, stepsWrapper};
 * settings and each e-mail notification are rows of fluentform_form_meta. The export is a JSON
 * list of those rows with their meta in "metas" or "form_meta"; Fluent's own templates use
 * {form, formSettings, notifications}. Fields are named by attributes.name, smart codes are
 * {inputs.name}, {all_data}, {wp.admin_email}.
 */
final class FluentForms implements Reader {

	private const TYPES = array(
		'input_name'          => 'name',
		'input_email'         => 'email',
		'input_text'          => 'text',
		'input_mask'          => 'text',
		'select_country'      => 'text',
		'textarea'            => 'textarea',
		'rich_text_input'     => 'textarea',
		'input_number'        => 'number',
		'phone'               => 'phone',
		'input_url'           => 'url',
		'input_date'          => 'date',
		'select'              => 'select',
		'input_radio'         => 'radio',
		'input_checkbox'      => 'checkbox',
		'terms_and_condition' => 'consent',
		'gdpr_agreement'      => 'consent',
		'custom_html'         => 'html',
		'section_break'       => 'html',
		'input_file'          => 'file',
		'input_image'         => 'file',
		'address'             => 'address',
		'ratings'             => 'rating',
		'rangeslider'         => 'slider',
		'net_promoter_score'  => 'slider',
		'input_hidden'        => 'hidden',
		'recaptcha'           => 'captcha',
		'hcaptcha'            => 'captcha',
		'turnstile'           => 'captcha',
		'form_step'           => 'page_break',
	);

	/**
	 * Smart codes this reader knows.
	 */
	private const TAG = '/\{((?:inputs?|wp|embed_post|submission|user|date)\.[^{}\s]+|all_data|all_data_without_hidden_fields|form_title)\}/i';

	/**
	 * Key.
	 */
	public function key(): string {
		return 'fluent-forms';
	}

	/**
	 * Name.
	 */
	public function label(): string {
		return 'Fluent Forms';
	}

	/**
	 * Whether a file is a Fluent Forms export.
	 *
	 * @param string $contents File contents.
	 */
	public function recognizes( string $contents ): bool {
		$data = Values::json( $contents );
		$form = is_array( $data ) && array_is_list( $data ) ? ( $data[0] ?? null ) : $data;
		if ( ! is_array( $form ) ) {
			return false;
		}
		$fields = self::decoded( $form['form_fields'] ?? $form['form'] ?? null );
		return is_array( $fields ) && isset( $fields['fields'] ) && ( isset( $fields['submitButton'] ) || isset( $form['formSettings'] ) || isset( $form['metas'] ) || isset( $form['form_meta'] ) );
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
			if ( ! is_array( $form ) ) {
				continue;
			}
			$fields = self::decoded( $form['form_fields'] ?? $form['form'] ?? null );
			if ( ! is_array( $fields ) ) {
				continue;
			}
			$settings      = self::decoded( $form['formSettings'] ?? null );
			$notifications = array();
			if ( isset( $form['notifications'] ) ) {
				$list          = self::decoded( $form['notifications'] );
				$notifications = is_array( $list ) && isset( $list['sendTo'] ) ? array( $list ) : Values::items( $list );
			}
			foreach ( Values::items( $form['metas'] ?? $form['form_meta'] ?? array() ) as $meta ) {
				$key = is_array( $meta ) ? Values::str( $meta['meta_key'] ?? '' ) : '';
				if ( 'formSettings' === $key && ! is_array( $settings ) ) {
					$settings = self::decoded( $meta['value'] ?? null );
				} elseif ( 'notifications' === $key ) {
					$notifications[] = self::decoded( $meta['value'] ?? null );
				}
			}
			$out[] = self::form( Values::str( $form['id'] ?? '' ), Values::str( $form['title'] ?? '' ), $fields, is_array( $settings ) ? $settings : array(), $notifications );
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
		$table = $wpdb->prefix . 'fluentform_forms';
		if ( ! Values::table_exists( $table ) ) {
			return array();
		}
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT id, title FROM %i ORDER BY id', $table ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return array_map(
			static fn( array $r ): array => array(
				'id'    => (string) $r['id'],
				'title' => (string) $r['title'],
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
		if ( ! Values::table_exists( $wpdb->prefix . 'fluentform_forms' ) ) {
			return null;
		}
		$row    = $wpdb->get_row( $wpdb->prepare( 'SELECT id, title, form_fields FROM %i WHERE id = %d', $wpdb->prefix . 'fluentform_forms', (int) $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$fields = is_array( $row ) ? self::decoded( $row['form_fields'] ) : null;
		if ( ! is_array( $fields ) ) {
			return null;
		}
		$metas         = $wpdb->get_results( $wpdb->prepare( "SELECT meta_key, value FROM %i WHERE form_id = %d AND meta_key IN ('formSettings', 'notifications') ORDER BY id", $wpdb->prefix . 'fluentform_form_meta', (int) $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.SlowDBQuery
		$settings      = array();
		$notifications = array();
		foreach ( is_array( $metas ) ? $metas : array() as $meta ) {
			if ( 'formSettings' === $meta['meta_key'] ) {
				$settings = self::decoded( $meta['value'] );
			} else {
				$notifications[] = self::decoded( $meta['value'] );
			}
		}
		return self::form( (string) $row['id'], (string) $row['title'], $fields, is_array( $settings ) ? $settings : array(), $notifications );
	}

	/**
	 * A value that may be a JSON string.
	 *
	 * @param mixed $value Value.
	 * @return mixed
	 */
	private static function decoded( $value ) {
		return is_string( $value ) ? Values::json( $value ) : $value;
	}

	/**
	 * One form.
	 *
	 * @param string              $id            Id.
	 * @param string              $title         Title.
	 * @param array<string,mixed> $form_fields   Fields, submit button and steps.
	 * @param array<string,mixed> $settings      formSettings.
	 * @param array<int,mixed>    $notifications Notifications.
	 */
	public static function form( string $id, string $title, array $form_fields, array $settings, array $notifications ): ImportedForm {
		$notes  = array();
		$fields = array();
		$titles = Values::items( $form_fields['stepsWrapper']['stepStart']['settings']['step_titles'] ?? array() );
		$step   = 0;
		foreach ( self::flatten( Values::items( $form_fields['fields'] ?? array() ) ) as $field ) {
			$element = Values::str( $field['element'] ?? '' );
			$type    = self::TYPES[ $element ] ?? null;
			if ( null === $type ) {
				if ( ! in_array( $element, array( 'shortcode', 'action_hook', 'custom_submit_button', 'save_progress_button' ), true ) ) {
					$notes[] = 'field_type_not_imported:' . $element . ':' . Values::str( $field['settings']['label'] ?? '' );
				}
				continue;
			}
			if ( 'page_break' === $type ) {
				++$step;
				$fields[] = array(
					'id'    => 'step_' . $step,
					'type'  => 'page_break',
					'label' => Values::str( $titles[ $step ] ?? '' ),
				);
				continue;
			}
			$item = self::field( $field, $type, $notes );
			if ( null !== $item ) {
				$fields[] = $item;
			}
		}

		$unknown = array();
		$mails   = array();
		foreach ( $notifications as $mail ) {
			if ( ! is_array( $mail ) || ! Values::flag( $mail['enabled'] ?? false ) ) {
				continue;
			}
			$send_to = is_array( $mail['sendTo'] ?? null ) ? $mail['sendTo'] : array();
			switch ( Values::str( $send_to['type'] ?? 'email' ) ) {
				case 'field':
					$to = '{{src:' . Values::str( $send_to['field'] ?? '' ) . '}}';
					break;
				case 'routing':
					$notes[] = 'notification_routing_not_imported';
					$to      = '{{admin_email}}';
					break;
				default:
					$to = self::tags( Values::str( $send_to['email'] ?? '' ), $unknown );
			}
			if ( self::has_conditions( $mail['conditionals'] ?? null ) ) {
				$notes[] = 'notification_conditions_not_imported';
			}
			$mails[] = array(
				'to'        => $to,
				'bcc'       => self::tags( Values::str( $mail['bcc'] ?? '' ), $unknown ),
				'cc'        => self::tags( Values::str( $mail['cc'] ?? '' ), $unknown ),
				'subject'   => self::tags( Values::str( $mail['subject'] ?? '' ), $unknown ),
				'from_name' => self::tags( Values::str( $mail['fromName'] ?? '' ), $unknown ),
				'from'      => self::tags( Values::str( $mail['fromEmail'] ?? '' ), $unknown ),
				'reply_to'  => self::tags( Values::str( $mail['replyTo'] ?? '' ), $unknown ),
				'body'      => self::tags( Values::str( $mail['message'] ?? '' ), $unknown ),
			);
		}

		$confirmation = null;
		$confirm      = is_array( $settings['confirmation'] ?? null ) ? $settings['confirmation'] : array();
		switch ( Values::str( $confirm['redirectTo'] ?? 'samePage' ) ) {
			case 'customUrl':
				$confirmation = array(
					'type' => 'redirect',
					'url'  => self::tags( Values::str( $confirm['customUrl'] ?? '' ), $unknown ),
				);
				break;
			case 'customPage':
				$confirmation = Site::page_confirmation( $confirm['customPage'] ?? 0, $notes );
				break;
			default:
				$confirmation = array(
					'type'    => 'message',
					'message' => self::tags( Values::str( $confirm['messageToShow'] ?? '' ), $unknown ),
				);
		}
		foreach ( array_unique( $unknown ) as $tag ) {
			$notes[] = 'template_tag_not_imported:' . $tag;
		}

		return new ImportedForm(
			'fluent-forms',
			$id,
			$title,
			$fields,
			$mails,
			$confirmation,
			Values::str( $form_fields['submitButton']['settings']['button_ui']['text'] ?? '' ),
			$notes
		);
	}

	/**
	 * Fields with the columns of containers in reading order.
	 *
	 * @param array<int,mixed> $fields Fields.
	 * @return array<int,array<string,mixed>>
	 */
	private static function flatten( array $fields ): array {
		$out = array();
		foreach ( $fields as $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}
			if ( 'container' === Values::str( $field['element'] ?? '' ) ) {
				foreach ( Values::items( $field['columns'] ?? array() ) as $column ) {
					$out = array_merge( $out, self::flatten( Values::items( is_array( $column ) ? ( $column['fields'] ?? array() ) : array() ) ) );
				}
				continue;
			}
			$out[] = $field;
		}
		return $out;
	}

	/**
	 * One field in the common shape.
	 *
	 * @param array<string,mixed> $field   Element.
	 * @param string              $type    Imported type.
	 * @param string[]            $notes   Notes (added to).
	 * @return array<string,mixed>|null
	 */
	private static function field( array $field, string $type, array &$notes ): ?array {
		$element    = Values::str( $field['element'] ?? '' );
		$attributes = is_array( $field['attributes'] ?? null ) ? $field['attributes'] : array();
		$settings   = is_array( $field['settings'] ?? null ) ? $field['settings'] : array();
		$label      = Values::str( $settings['label'] ?? '' );
		$required   = self::required( $settings );

		if ( 'input_name' === $element ) {
			$parts = array();
			foreach ( is_array( $field['fields'] ?? null ) ? $field['fields'] : array() as $part => $sub ) {
				if ( is_array( $sub ) && Values::flag( $sub['settings']['visible'] ?? true ) ) {
					$parts[ $part ] = $sub;
				}
			}
			if ( array( 'first_name' ) === array_keys( $parts ) || array( 'last_name' ) === array_keys( $parts ) ) {
				$type = (string) array_key_first( $parts );
			}
			$labels   = array_filter( array_map( static fn( array $sub ): string => Values::str( $sub['settings']['label'] ?? '' ), $parts ) );
			$admin    = Values::str( $settings['admin_field_label'] ?? '' );
			$label    = '' !== $label ? $label : ( 'name' === $type && '' !== $admin ? $admin : implode( ' / ', $labels ) );
			$required = $required || array() !== array_filter( $parts, array( self::class, 'required_part' ) );
		}

		$options = array();
		$advance = Values::items( $settings['advanced_options'] ?? array() );
		if ( array() !== $advance ) {
			foreach ( $advance as $option ) {
				if ( is_array( $option ) ) {
					$text      = Values::str( $option['label'] ?? '' );
					$value     = Values::str( $option['value'] ?? '' );
					$options[] = array(
						'label' => $text,
						'value' => '' !== $value ? $value : $text,
					);
				}
			}
		} elseif ( is_array( $field['options'] ?? null ) ) {
			foreach ( $field['options'] as $value => $text ) {
				$options[] = array(
					'label' => Values::str( $text ),
					'value' => (string) $value,
				);
			}
		}

		$default = $attributes['value'] ?? '';
		$item    = array(
			'id'          => Values::str( $attributes['name'] ?? '' ),
			'type'        => $type,
			'label'       => $label,
			'required'    => $required,
			'placeholder' => Values::str( $attributes['placeholder'] ?? $settings['placeholder'] ?? '' ),
			'description' => Values::str( $settings['help_message'] ?? '' ),
			'default'     => is_array( $default ) ? implode( ',', array_map( array( Values::class, 'str' ), $default ) ) : Values::str( $default ),
			'options'     => 'rating' === $type ? array() : $options,
			'multiple'    => Values::flag( $attributes['multiple'] ?? false ),
			'conditional' => self::has_conditions( $settings['conditional_logics'] ?? null ),
		);
		switch ( $element ) {
			case 'custom_html':
				$item['html'] = Values::str( $settings['html_codes'] ?? '' );
				break;
			case 'section_break':
				$item['html'] = ( '' !== $label ? '<h3>' . $label . '</h3>' : '' ) . Values::str( $settings['description'] ?? '' );
				break;
			case 'terms_and_condition':
			case 'gdpr_agreement':
				$item['label'] = Values::str( $settings['tnc_html'] ?? $label );
				$item['html']  = Values::str( $settings['tnc_html'] ?? '' );
				break;
			case 'input_date':
				if ( ! preg_match( '/[dDjlNSwzWFmMntLoYy]/', Values::str( $settings['date_format'] ?? 'd/m/Y' ) ) ) {
					$item['type'] = 'time';
				} elseif ( Values::flag( $settings['is_time_enabled'] ?? false ) && preg_match( '/[HhGgi]/', Values::str( $settings['date_format'] ?? '' ) ) ) {
					$notes[] = 'date_time_imported_as_date:' . $label;
				}
				break;
			case 'ratings':
				$item['max'] = max( 1, count( $options ) );
				break;
			case 'net_promoter_score':
				$item['min'] = 0;
				$item['max'] = 10;
				break;
		}
		if ( in_array( $type, array( 'number', 'slider' ), true ) ) {
			$rules = is_array( $settings['validation_rules'] ?? null ) ? $settings['validation_rules'] : array();
			foreach ( array( 'min', 'max' ) as $limit ) {
				$value = $attributes[ $limit ] ?? $rules[ $limit ]['value'] ?? null;
				if ( is_numeric( $value ) ) {
					$item[ $limit ] = $value;
				}
			}
			if ( is_numeric( $settings['number_step'] ?? null ) ) {
				$item['step'] = $settings['number_step'];
			}
		}
		return $item;
	}

	/**
	 * Whether the validation rules require a value.
	 *
	 * @param array<string,mixed> $settings Settings.
	 */
	private static function required( array $settings ): bool {
		$rules = $settings['validation_rules'] ?? null;
		return is_array( $rules ) && is_array( $rules['required'] ?? null ) && Values::flag( $rules['required']['value'] ?? false );
	}

	/**
	 * Whether a part of a name field is required.
	 *
	 * @param array<string,mixed> $part Sub-field.
	 */
	private static function required_part( array $part ): bool {
		return is_array( $part['settings'] ?? null ) && self::required( $part['settings'] );
	}

	/**
	 * Whether conditional logic is switched on with at least one rule (the builder stores empty ones).
	 *
	 * @param mixed $logic conditional_logics or conditionals.
	 */
	private static function has_conditions( $logic ): bool {
		if ( ! is_array( $logic ) || ! Values::flag( $logic['status'] ?? false ) ) {
			return false;
		}
		$rules = Values::items( $logic['conditions'] ?? array() );
		foreach ( Values::items( $logic['condition_groups'] ?? array() ) as $group ) {
			$rules = array_merge( $rules, Values::items( is_array( $group ) ? ( $group['rules'] ?? array() ) : array() ) );
		}
		foreach ( $rules as $rule ) {
			if ( is_array( $rule ) && '' !== Values::str( $rule['field'] ?? '' ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Smart codes to builder tokens.
	 *
	 * @param string   $text    Text.
	 * @param string[] $unknown Unknown codes.
	 */
	private static function tags( string $text, array &$unknown ): string {
		return Values::tokens(
			$text,
			self::TAG,
			static function ( array $m ): ?string {
				$tag = strtolower( $m[1] );
				switch ( $tag ) {
					case 'all_data':
					case 'all_data_without_hidden_fields':
						return '{{answers}}';
					case 'wp.admin_email':
						return '{{admin_email}}';
					case 'wp.site_title':
						return '{{site_title}}';
					case 'embed_post.permalink':
					case 'wp.url':
						return '{{page:url}}';
					case 'embed_post.post_title':
						return '{{page:title}}';
					case 'form_title':
						return '{{form:title}}';
					case 'submission.id':
					case 'submission.serial_number':
						return '{{entry:id}}';
					case 'submission.created_at':
						return '{{entry:date}}';
				}
				if ( str_starts_with( $tag, 'date.' ) ) {
					return '{{entry:date}}';
				}
				if ( preg_match( '/^inputs?\.(.+)$/i', $m[1], $field ) ) {
					return '{{src:' . $field[1] . '}}';
				}
				return null;
			},
			$unknown
		);
	}
}
