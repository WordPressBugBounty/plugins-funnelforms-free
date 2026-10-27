<?php
/**
 * Ninja Forms 3.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

use Funnelforms\Compat\Import\ImportedForm;
use Funnelforms\Compat\Import\Reader;

defined( 'ABSPATH' ) || exit;

/**
 * The export (.nff) is JSON {settings, fields, actions}; fields carry no database id, so merge
 * tags and the layout name them by key ({field:email}). Ninja Forms passes every exported string
 * through utf8_encode, which encodes UTF-8 twice ("GrÃ¶ÃŸe"); exports of 2.9 and early 3.0 are
 * base64 of PHP-serialized data. On the site the form lives in nf3_forms, nf3_fields and
 * nf3_actions with their *_meta tables. Pages come from the Multi-Part add-on
 * (settings.formContentData parts), conditions from the Conditional Logic add-on.
 */
final class NinjaForms implements Reader {

	private const TYPES = array(
		'textbox'         => 'text',
		'address'         => 'text',
		'address2'        => 'text',
		'city'            => 'text',
		'zip'             => 'text',
		'textarea'        => 'textarea',
		'email'           => 'email',
		'phone'           => 'phone',
		'number'          => 'number',
		'date'            => 'date',
		'firstname'       => 'first_name',
		'lastname'        => 'last_name',
		'listselect'      => 'select',
		'listmultiselect' => 'select',
		'liststate'       => 'select',
		'listcountry'     => 'select',
		'listradio'       => 'radio',
		'listimage'       => 'radio',
		'listcheckbox'    => 'checkbox',
		'checkbox'        => 'consent',
		'terms'           => 'consent',
		'hidden'          => 'hidden',
		'html'            => 'html',
		'hr'              => 'html',
		'starrating'      => 'rating',
		'recaptcha'       => 'captcha',
		'recaptcha_v3'    => 'captcha',
		'hcaptcha'        => 'captcha',
		'turnstile'       => 'captcha',
		'spam'            => 'captcha',
	);

	/**
	 * Field types that only steer the form, without a value to take over.
	 */
	private const SKIPPED = array( 'submit', 'button', 'note', 'confirm', 'passwordconfirm' );

	/**
	 * Merge tag groups that a tag may start with.
	 */
	private const TAG = '/\{(fields_table|all_fields_table|(?:field|wp|system|other|form|submission|querystring|user|post):[^{}\s]+)\}/i';

	/**
	 * Key.
	 */
	public function key(): string {
		return 'ninja-forms';
	}

	/**
	 * Name.
	 */
	public function label(): string {
		return 'Ninja Forms';
	}

	/**
	 * Whether a file is a Ninja Forms export.
	 *
	 * @param string $contents File contents.
	 */
	public function recognizes( string $contents ): bool {
		$data = self::decode_file( $contents );
		return is_array( $data ) && is_array( $data['settings'] ?? null ) && array_key_exists( 'actions', $data ) && array_key_exists( 'fields', $data );
	}

	/**
	 * The form of an export (one per file).
	 *
	 * @param string $contents File contents.
	 * @return ImportedForm[]
	 */
	public function parse_file( string $contents ): array {
		$data = self::decode_file( $contents );
		if ( ! is_array( $data ) || ! is_array( $data['settings'] ?? null ) ) {
			return array();
		}
		return array( self::form( self::fix_encoding( $data ), '' ) );
	}

	/**
	 * Forms on this site.
	 *
	 * @return array<int,array{id:string,title:string}>
	 */
	public function list_site(): array {
		global $wpdb;
		$table = $wpdb->prefix . 'nf3_forms';
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
		if ( ! Values::table_exists( $wpdb->prefix . 'nf3_forms' ) ) {
			return null;
		}
		$form = $wpdb->get_row( $wpdb->prepare( 'SELECT id, title FROM %i WHERE id = %d', $wpdb->prefix . 'nf3_forms', (int) $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( ! is_array( $form ) ) {
			return null;
		}
		$settings          = self::meta( 'nf3_form_meta', array( (int) $form['id'] ) )[ (int) $form['id'] ] ?? array();
		$settings['title'] = Values::str( $settings['title'] ?? '' ) !== '' ? $settings['title'] : $form['title'];
		return self::form(
			array(
				'settings' => $settings,
				'fields'   => self::children( 'nf3_fields', (int) $form['id'] ),
				'actions'  => self::children( 'nf3_actions', (int) $form['id'] ),
			),
			(string) $form['id']
		);
	}

	/**
	 * Fields or actions of a form with their settings.
	 *
	 * @param string $table nf3_fields or nf3_actions.
	 * @param int    $form  Form id.
	 * @return array<int,array<string,mixed>>
	 */
	private static function children( string $table, int $form ): array {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE parent_id = %d ORDER BY id', $wpdb->prefix . $table, $form ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( ! is_array( $rows ) || array() === $rows ) {
			return array();
		}
		$meta = self::meta( 'nf3_fields' === $table ? 'nf3_field_meta' : 'nf3_action_meta', array_map( 'intval', array_column( $rows, 'id' ) ) );
		$out  = array();
		foreach ( $rows as $row ) {
			$out[] = ( $meta[ (int) $row['id'] ] ?? array() ) + array_filter( $row, static fn( $v ): bool => null !== $v );
		}
		return $out;
	}

	/**
	 * Settings of rows in a meta table, by row id.
	 *
	 * @param string $table Meta table without prefix.
	 * @param int[]  $ids   Row ids.
	 * @return array<int,array<string,mixed>>
	 */
	private static function meta( string $table, array $ids ): array {
		global $wpdb;
		if ( array() === $ids ) {
			return array();
		}
		$in   = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT parent_id, `key`, value FROM %i WHERE parent_id IN ($in)", array_merge( array( $wpdb->prefix . $table ), $ids ) ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $in holds only %d placeholders.
		$out  = array();
		foreach ( is_array( $rows ) ? $rows : array() as $row ) {
			$out[ (int) $row['parent_id'] ][ (string) $row['key'] ] = Values::unserialized( $row['value'] );
		}
		return $out;
	}

	/**
	 * JSON, also with text around it, or base64 of PHP-serialized data (older exports).
	 *
	 * @param string $contents File contents.
	 * @return mixed
	 */
	private static function decode_file( string $contents ) {
		$contents = trim( (string) preg_replace( '/^\xEF\xBB\xBF/', '', $contents ) );
		$data     = Values::json( $contents );
		if ( null === $data && false !== strpos( $contents, '{' ) ) {
			$data = Values::json( substr( $contents, (int) strpos( $contents, '{' ), (int) strrpos( $contents, '}' ) - (int) strpos( $contents, '{' ) + 1 ) );
		}
		if ( null === $data && preg_match( '/^[A-Za-z0-9+\/=\s]+$/', $contents ) ) {
			$plain = base64_decode( $contents, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- format of old Ninja Forms exports.
			$data  = false === $plain ? null : Values::unserialized( $plain );
		}
		return $data;
	}

	/**
	 * Undoes the double UTF-8 encoding of an export. A string only changes when it is made of
	 * characters up to U+00FF that decode to valid UTF-8, which text written in UTF-8 never is.
	 *
	 * @param mixed $value Value.
	 * @return mixed
	 */
	private static function fix_encoding( $value ) {
		if ( is_array( $value ) ) {
			return array_map( array( self::class, 'fix_encoding' ), $value );
		}
		if ( ! is_string( $value ) || ! preg_match( '/[\x80-\xFF]/', $value ) || preg_match( '/[^\x{0}-\x{FF}]/u', $value ) || ! function_exists( 'mb_convert_encoding' ) ) {
			return $value;
		}
		$once = mb_convert_encoding( $value, 'ISO-8859-1', 'UTF-8' );
		return is_string( $once ) && mb_check_encoding( $once, 'UTF-8' ) ? $once : $value;
	}

	/**
	 * One form.
	 *
	 * @param array<string,mixed> $data Settings, fields and actions.
	 * @param string              $id   Id on the site, empty for a file.
	 */
	public static function form( array $data, string $id ): ImportedForm {
		$notes    = array();
		$settings = $data['settings'];
		$raw      = Values::items( $data['fields'] ?? array() );
		if ( array() === $raw ) {
			$raw = Values::items( $settings['fieldContentsData'] ?? array() );
		}
		$by_key = array();
		foreach ( $raw as $index => $field ) {
			if ( is_array( $field ) ) {
				$key            = Values::str( $field['key'] ?? '' );
				$key            = '' !== $key ? $key : 'field_' . $index;
				$by_key[ $key ] = array( 'key' => $key ) + $field;
			}
		}
		uasort( $by_key, static fn( array $a, array $b ): int => (int) ( $a['order'] ?? 0 ) <=> (int) ( $b['order'] ?? 0 ) );

		$conditional = array();
		foreach ( Values::items( $settings['conditions'] ?? array() ) as $condition ) {
			foreach ( array( 'then', 'else' ) as $branch ) {
				foreach ( Values::items( is_array( $condition ) ? ( $condition[ $branch ] ?? array() ) : array() ) as $effect ) {
					if ( is_array( $effect ) ) {
						$conditional[ Values::str( $effect['key'] ?? '' ) ] = true;
					}
				}
			}
		}

		$fields = array();
		$submit = '';
		$parts  = self::parts( $settings['formContentData'] ?? null );
		$seen   = array();
		foreach ( null === $parts ? array( array( 'keys' => array_keys( $by_key ) ) ) : $parts as $index => $part ) {
			if ( $index > 0 ) {
				$fields[] = array(
					'id'    => 'part_' . $index,
					'type'  => 'page_break',
					'label' => Values::str( $part['title'] ?? '' ),
				);
			}
			if ( isset( $conditional[ Values::str( $part['key'] ?? '' ) ] ) ) {
				$notes[] = 'conditional_logic_not_imported:' . Values::str( $part['title'] ?? '' );
			}
			foreach ( $part['keys'] as $key ) {
				if ( ! isset( $by_key[ $key ] ) || isset( $seen[ $key ] ) ) {
					continue;
				}
				$seen[ $key ] = true;
				$field        = self::field( $by_key[ $key ], isset( $conditional[ $key ] ), $notes );
				if ( 'submit' === Values::str( $by_key[ $key ]['type'] ?? '' ) ) {
					$submit = Values::str( $by_key[ $key ]['label'] ?? '' );
				}
				if ( null !== $field ) {
					$fields[] = $field;
				}
			}
		}
		foreach ( array_diff_key( $by_key, $seen ) as $key => $field ) {
			if ( null !== $parts && 'hidden' !== Values::str( $field['type'] ?? '' ) && 'submit' !== Values::str( $field['type'] ?? '' ) ) {
				$notes[] = 'field_outside_layout:' . $key;
			}
			$item = self::field( $field, isset( $conditional[ $key ] ), $notes );
			if ( 'submit' === Values::str( $field['type'] ?? '' ) ) {
				$submit = Values::str( $field['label'] ?? '' );
			}
			if ( null !== $item ) {
				$fields[] = $item;
			}
		}

		$unknown       = array();
		$notifications = array();
		$message       = null;
		$redirect      = null;
		foreach ( Values::items( $data['actions'] ?? array() ) as $action ) {
			if ( ! is_array( $action ) || ! Values::flag( $action['active'] ?? '1' ) ) {
				continue;
			}
			$type = Values::str( $action['type'] ?? '' );
			if ( in_array( $type, array( 'email', 'successmessage', 'redirect' ), true ) && self::has_conditions( $action ) ) {
				$notes[] = 'action_conditions_not_imported:' . Values::str( $action['label'] ?? $type );
			}
			switch ( $type ) {
				case 'email':
					$to              = $action['to'] ?? '';
					$notifications[] = array(
						'to'        => self::tags( is_array( $to ) ? implode( ',', array_map( array( Values::class, 'str' ), $to ) ) : Values::str( $to ), $unknown ),
						'cc'        => self::tags( Values::str( $action['cc'] ?? '' ), $unknown ),
						'bcc'       => self::tags( Values::str( $action['bcc'] ?? '' ), $unknown ),
						'subject'   => self::tags( self::first( $action, 'email_subject', 'subject' ), $unknown ),
						'from_name' => self::tags( Values::str( $action['from_name'] ?? '' ), $unknown ),
						'from'      => self::tags( Values::str( $action['from_address'] ?? '' ), $unknown ),
						'reply_to'  => self::tags( Values::str( $action['reply_to'] ?? '' ), $unknown ),
						'body'      => self::tags( self::first( $action, 'email_message', 'message' ), $unknown ),
					);
					break;
				case 'successmessage':
					$message = $message ?? self::tags( self::first( $action, 'success_msg', 'message' ), $unknown );
					break;
				case 'redirect':
					$redirect = $redirect ?? self::tags( Values::str( $action['redirect_url'] ?? '' ), $unknown );
					break;
				case 'save':
					break;
				default:
					$notes[] = 'action_not_imported:' . $type;
			}
		}
		$confirmation = null;
		if ( null !== $redirect ) {
			$confirmation = array(
				'type' => 'redirect',
				'url'  => $redirect,
			);
			if ( null !== $message ) {
				$notes[] = 'success_message_replaced_by_redirect';
			}
		} elseif ( null !== $message ) {
			$confirmation = array(
				'type'    => 'message',
				'message' => $message,
			);
		}
		foreach ( array_unique( $unknown ) as $tag ) {
			$notes[] = 'template_tag_not_imported:' . $tag;
		}

		return new ImportedForm(
			'ninja-forms',
			$id,
			Values::str( $settings['title'] ?? $settings['form_title'] ?? '' ),
			$fields,
			$notifications,
			$confirmation,
			$submit,
			$notes
		);
	}

	/**
	 * Pages of the Multi-Part add-on with the keys of their fields, or null without parts.
	 *
	 * @param mixed $layout settings.formContentData.
	 * @return array<int,array<string,mixed>>|null
	 */
	private static function parts( $layout ): ?array {
		$layout = Values::unserialized( $layout );
		if ( ! is_array( $layout ) ) {
			return null;
		}
		$items = Values::items( $layout );
		if ( ! is_array( $items[0] ?? null ) || 'part' !== Values::str( $items[0]['type'] ?? '' ) ) {
			return array( array( 'keys' => self::keys( $items ) ) );
		}
		usort( $items, static fn( $a, $b ): int => (int) ( $a['order'] ?? 0 ) <=> (int) ( $b['order'] ?? 0 ) );
		$parts = array();
		foreach ( $items as $part ) {
			if ( is_array( $part ) ) {
				$parts[] = array(
					'title' => Values::str( $part['title'] ?? '' ),
					'key'   => Values::str( $part['key'] ?? '' ),
					'keys'  => self::keys( Values::items( $part['formContentData'] ?? array() ) ),
				);
			}
		}
		return $parts;
	}

	/**
	 * Field keys of a layout: a list of keys, or rows of cells with fields.
	 *
	 * @param array<int,mixed> $items Layout.
	 * @return string[]
	 */
	private static function keys( array $items ): array {
		$keys = array();
		usort(
			$items,
			static fn( $a, $b ): int => ( is_array( $a ) ? (int) ( $a['order'] ?? 0 ) : 0 ) <=> ( is_array( $b ) ? (int) ( $b['order'] ?? 0 ) : 0 )
		);
		foreach ( $items as $item ) {
			if ( is_string( $item ) || is_int( $item ) ) {
				$keys[] = (string) $item;
			} elseif ( is_array( $item ) ) {
				$keys = array_merge( $keys, self::keys( Values::items( $item['cells'] ?? $item['fields'] ?? array() ) ) );
			}
		}
		return $keys;
	}

	/**
	 * One field in the common shape, or null when it has nothing to take over.
	 *
	 * @param array<string,mixed> $field       Field settings.
	 * @param bool                $conditional Whether a condition shows or hides it.
	 * @param string[]            $notes       Notes (added to).
	 * @return array<string,mixed>|null
	 */
	private static function field( array $field, bool $conditional, array &$notes ): ?array {
		$nf = Values::str( $field['type'] ?? '' );
		if ( in_array( $nf, self::SKIPPED, true ) ) {
			return null;
		}
		$type = self::TYPES[ $nf ] ?? null;
		if ( null === $type ) {
			$notes[] = 'field_type_not_imported:' . $nf . ':' . Values::str( $field['label'] ?? '' );
			return null;
		}
		if ( 'date' === $type && 'time_only' === Values::str( $field['date_mode'] ?? '' ) ) {
			$type = 'time';
		}
		$options = array();
		$default = Values::str( $field['default'] ?? '' );
		$chosen  = array();
		$list    = Values::items( Values::unserialized( $field['options'] ?? array() ) );
		usort( $list, static fn( $a, $b ): int => ( is_array( $a ) ? (int) ( $a['order'] ?? 0 ) : 0 ) <=> ( is_array( $b ) ? (int) ( $b['order'] ?? 0 ) : 0 ) );
		foreach ( $list as $option ) {
			if ( ! is_array( $option ) ) {
				continue;
			}
			$label     = Values::str( $option['label'] ?? '' );
			$value     = Values::str( $option['value'] ?? '' );
			$options[] = array(
				'label' => $label,
				'value' => '' !== $value ? $value : $label,
			);
			if ( Values::flag( $option['selected'] ?? '' ) ) {
				$chosen[] = '' !== $value ? $value : $label;
			}
		}
		if ( 'select' === $type && array() === $options ) {
			$type = 'text';
		}
		if ( array() !== $chosen ) {
			$default = implode( ',', $chosen );
		}
		$label = Values::str( $field['label'] ?? '' );
		if ( 'terms' === $nf && '' === $label ) {
			$label = Values::str( $options[0]['label'] ?? '' );
		}
		$item = array(
			'id'          => Values::str( $field['key'] ),
			'type'        => $type,
			'label'       => $label,
			'required'    => Values::flag( $field['required'] ?? '' ),
			'placeholder' => Values::str( $field['placeholder'] ?? '' ),
			'description' => Values::str( $field['desc_text'] ?? '' ),
			'default'     => 'checkbox' === $nf ? '' : $default,
			'options'     => 'consent' === $type ? array() : $options,
			'multiple'    => 'listmultiselect' === $nf,
			'conditional' => $conditional,
		);
		if ( 'html' === $nf ) {
			$item['html'] = Values::str( $field['default'] ?? '' );
		} elseif ( 'hr' === $nf ) {
			$item['html'] = '<hr>';
		}
		if ( 'number' === $type ) {
			foreach ( array(
				'min'  => 'num_min',
				'max'  => 'num_max',
				'step' => 'num_step',
			) as $limit => $setting ) {
				if ( isset( $field[ $setting ] ) && is_numeric( $field[ $setting ] ) ) {
					$item[ $limit ] = $field[ $setting ];
				}
			}
		}
		if ( 'rating' === $type && is_numeric( $field['number_of_stars'] ?? null ) ) {
			$item['max'] = $field['number_of_stars'];
		}
		return $item;
	}

	/**
	 * Whether an action only runs under conditions (the builder stores empty ones on every action).
	 *
	 * @param array<string,mixed> $action Action.
	 */
	private static function has_conditions( array $action ): bool {
		$conditions = Values::unserialized( $action['conditions'] ?? null );
		if ( ! is_array( $conditions ) || ! Values::flag( $conditions['process'] ?? '1' ) ) {
			return false;
		}
		foreach ( Values::items( $conditions['when'] ?? array() ) as $when ) {
			if ( is_array( $when ) && '' !== Values::str( $when['key'] ?? '' ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * The first non-empty of two settings (newer and older name).
	 *
	 * @param array<string,mixed> $action Action.
	 * @param string              $name   Setting.
	 * @param string              $old    Older setting.
	 */
	private static function first( array $action, string $name, string $old ): string {
		$value = Values::str( $action[ $name ] ?? '' );
		return '' !== $value ? $value : Values::str( $action[ $old ] ?? '' );
	}

	/**
	 * Merge tags to builder tokens.
	 *
	 * @param string   $text    Text.
	 * @param string[] $unknown Unknown tags.
	 */
	private static function tags( string $text, array &$unknown ): string {
		return Values::tokens(
			$text,
			self::TAG,
			static function ( array $m ): ?string {
				$tag = strtolower( $m[1] );
				switch ( $tag ) {
					case 'fields_table':
					case 'all_fields_table':
					case 'field:all_fields':
					case 'field:all_fields_table':
						return '{{answers}}';
					case 'wp:admin_email':
					case 'system:admin_email':
						return '{{admin_email}}';
					case 'wp:site_title':
					case 'system:site_title':
						return '{{site_title}}';
					case 'wp:post_url':
					case 'other:post_url':
						return '{{page:url}}';
					case 'wp:post_title':
						return '{{page:title}}';
					case 'form:title':
						return '{{form:title}}';
					case 'submission:sequence':
					case 'submission:id':
						return '{{entry:id}}';
					case 'other:date':
					case 'system:date':
						return '{{entry:date}}';
				}
				if ( str_starts_with( $tag, 'field:' ) ) {
					return '{{src:' . substr( $m[1], 6 ) . '}}';
				}
				return null;
			},
			$unknown
		);
	}
}
